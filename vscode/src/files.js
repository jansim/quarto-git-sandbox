// The box's in-memory project folder as VS Code's file:// filesystem.
//
// VS Code sees the project at /<name> (the folder in the box's prompt);
// underneath it is the sandbox's own store at sandbox.dir. Reads go
// straight to the store. Writes from the explorer or an editor go through
// the box (binding.mutate), so each one gets an undo entry and re-runs the
// task checks, exactly like a save in the Editor tab. Changes made anywhere
// else (a command, an undo, a Reset) are found by comparing the store with
// what was there last time, and reported to VS Code as file events.
import {
  FileChangeType,
  FileSystemProviderCapabilities,
  FileSystemProviderError,
  FileSystemProviderErrorCode,
  FileType
} from '@codingame/monaco-vscode-files-service-override'
import { Emitter } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event'
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri'
import { current, onChange } from './session.js'

const err = (message, code) => FileSystemProviderError.create(message, code)
const notFound = (uri) => err('No such file or directory: ' + uri.path, FileSystemProviderErrorCode.FileNotFound)

export class SandboxFileSystem {
  constructor (rootPath) {
    // e.g. /sales-analysis; fixed for the page's lifetime, since VS Code
    // cannot change a single-folder workspace without reloading
    this.root = rootPath
    this.rootUri = URI.file(rootPath)
    this.capabilities = FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.PathCaseSensitive
    this._onDidChangeFile = new Emitter()
    this.onDidChangeFile = this._onDidChangeFile.event
    this.onDidChangeCapabilities = new Emitter().event
    // store path -> node, as of the last scan
    this.seen = new Map()
    // store path -> how often its contents changed under VS Code's feet,
    // added to mtime so a changed file never looks unchanged to VS Code
    this.bumps = new Map()
    // store paths VS Code itself just wrote: no bump for those, or its own
    // next save would find the file "newer" than what it saved
    this.ownWrites = new Set()
    onChange(() => this.scan())
  }

  get sb () { return current().sandbox }

  // the store path behind a file:// URI, or null outside the project
  storePath (uri) {
    const p = uri.path
    if (p === this.root) return this.sb.dir
    if (p.startsWith(this.root + '/')) return this.sb.dir + p.slice(this.root.length)
    return null
  }

  uriOf (storePath) {
    return this.rootUri.with({ path: this.root + storePath.slice(this.sb.dir.length) })
  }

  // project-relative, as the sandbox's file API and git status spell paths
  relPath (storePath) {
    return storePath.slice(this.sb.dir.length + 1)
  }

  node (uri) {
    const p = this.storePath(uri)
    return p == null ? null : this.sb.fs._store.get(p) || null
  }

  watch () { return { dispose () {} } }

  // a folder above the project's, which holds nothing but the way down
  isAbove (path) {
    return path === '/' || (path !== this.root && this.root.startsWith(path + '/'))
  }

  async stat (uri) {
    if (this.isAbove(uri.path)) {
      return { type: FileType.Directory, ctime: 0, mtime: 0, size: 0 }
    }
    const n = this.node(uri)
    if (!n) throw notFound(uri)
    const p = this.storePath(uri)
    const mtime = (n.mtimeMs || 0) + (this.bumps.get(p) || 0)
    return {
      type: n.type === 'dir' ? FileType.Directory : FileType.File,
      ctime: mtime,
      mtime,
      size: n.type === 'dir' ? 0 : (n.content ? n.content.length : 0)
    }
  }

  async readdir (uri) {
    if (this.isAbove(uri.path)) {
      const rest = this.root.slice(uri.path === '/' ? 1 : uri.path.length + 1)
      return [[rest.split('/')[0], FileType.Directory]]
    }
    const n = this.node(uri)
    if (!n) throw notFound(uri)
    if (n.type !== 'dir') throw err('Not a directory: ' + uri.path, FileSystemProviderErrorCode.FileNotADirectory)
    const dir = this.storePath(uri)
    const names = await this.sb.fs.promises.readdir(dir)
    return names.map((name) => {
      const c = this.sb.fs._store.get(dir + '/' + name)
      return [name, c && c.type === 'dir' ? FileType.Directory : FileType.File]
    })
  }

  async readFile (uri) {
    const n = this.node(uri)
    if (!n) throw notFound(uri)
    if (n.type === 'dir') throw err('Is a directory: ' + uri.path, FileSystemProviderErrorCode.FileIsADirectory)
    return n.content.slice()
  }

  // Inside .git only git's own scratch files are written from VS Code
  // (COMMIT_EDITMSG, while a commit waits on its message), and mid-command
  // at that: no undo entry, no refresh, and no waiting for the box.
  isGitInternal (storePath) {
    return storePath === this.sb.dir + '/.git' || storePath.startsWith(this.sb.dir + '/.git/')
  }

  async change (label, storePath, fn) {
    if (this.isGitInternal(storePath)) return fn(this.sb)
    this.ownWrites.add(storePath)
    try {
      return await current().mutate(label, fn)
    } finally {
      this.ownWrites.delete(storePath)
    }
  }

  async writeFile (uri, content, opts) {
    const p = this.storePath(uri)
    if (p == null) throw err('Files can only be saved inside the project folder.', FileSystemProviderErrorCode.NoPermissions)
    const n = this.sb.fs._store.get(p)
    if (n && n.type === 'dir') throw err('Is a directory: ' + uri.path, FileSystemProviderErrorCode.FileIsADirectory)
    if (n && opts && !opts.overwrite) throw err('File exists: ' + uri.path, FileSystemProviderErrorCode.FileExists)
    if (!n && opts && !opts.create) throw notFound(uri)
    const rel = this.relPath(p)
    await this.change((n ? 'save ' : 'create ') + rel, p, (sb) => sb.writeFile(rel, content))
  }

  async mkdir (uri) {
    const p = this.storePath(uri)
    if (p == null) throw err('Folders can only be made inside the project folder.', FileSystemProviderErrorCode.NoPermissions)
    if (this.sb.fs._store.get(p)) throw err('File exists: ' + uri.path, FileSystemProviderErrorCode.FileExists)
    await this.change('mkdir ' + this.relPath(p), p, (sb) => sb.fs.promises.mkdir(p, { recursive: true }))
  }

  async delete (uri, opts) {
    const p = this.storePath(uri)
    if (p == null || p === this.sb.dir) throw err('The project folder itself cannot be deleted.', FileSystemProviderErrorCode.NoPermissions)
    if (!this.sb.fs._store.get(p)) throw notFound(uri)
    await this.change('delete ' + this.relPath(p), p, (sb) => sb.fs.promises.rm(p, { recursive: !!(opts && opts.recursive) }))
  }

  async rename (from, to, opts) {
    const a = this.storePath(from)
    const b = this.storePath(to)
    if (a == null || b == null || a === this.sb.dir) throw err('Only files inside the project folder can be renamed.', FileSystemProviderErrorCode.NoPermissions)
    if (!this.sb.fs._store.get(a)) throw notFound(from)
    if (this.sb.fs._store.get(b) && !(opts && opts.overwrite)) throw err('File exists: ' + to.path, FileSystemProviderErrorCode.FileExists)
    // the store has no rename: move every node at or under the old path
    await this.change('rename ' + this.relPath(a) + ' to ' + this.relPath(b), b, async (sb) => {
      const store = sb.fs._store
      await sb.fs.promises.mkdir(b.slice(0, b.lastIndexOf('/')) || '/', { recursive: true })
      await sb.fs.promises.rm(b, { recursive: true, force: true })
      const moves = []
      store.forEach((n, k) => { if (k === a || k.startsWith(a + '/')) moves.push([k, n]) })
      for (const [k, n] of moves) {
        store.delete(k)
        store.set(b + k.slice(a.length), { ...n, mtimeMs: Date.now() })
      }
    })
  }

  // A file inside .git changed outside VS Code's view (scan skips .git)
  touch (storePath) {
    this.bumps.set(storePath, (this.bumps.get(storePath) || 0) + 1)
    this._onDidChangeFile.fire([{ type: FileChangeType.UPDATED, resource: this.uriOf(storePath) }])
  }

  // What changed in the store since the last look, as VS Code file events.
  scan () {
    const b = current()
    if (!b) return
    const dir = this.sb.dir
    const git = dir + '/.git'
    const now = new Map()
    this.sb.fs._store.forEach((n, k) => {
      if ((k === dir || k.startsWith(dir + '/')) && k !== git && !k.startsWith(git + '/')) now.set(k, n)
    })
    const events = []
    now.forEach((n, k) => {
      const old = this.seen.get(k)
      if (!old) {
        events.push({ type: FileChangeType.ADDED, resource: this.uriOf(k) })
      } else if (old !== n && (old.type !== n.type || !sameBytes(old.content, n.content))) {
        if (!this.ownWrites.has(k)) this.bumps.set(k, (this.bumps.get(k) || 0) + 1)
        events.push({ type: FileChangeType.UPDATED, resource: this.uriOf(k) })
      }
    })
    this.seen.forEach((_n, k) => {
      if (!now.has(k)) events.push({ type: FileChangeType.DELETED, resource: this.uriOf(k) })
    })
    this.seen = now
    if (events.length) this._onDidChangeFile.fire(events)
  }
}

function sameBytes (a, b) {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
