// VS Code's Git support, rebuilt on the sandbox: the Source Control view,
// file colours and letters in the explorer, change markers in the editor's
// gutter, the branch and sync items in the status bar, and the usual Git
// commands. Every action runs a real git command line through the box, as
// VS Code's own Git extension does, and logs it to the Git output channel:
// so the commands a click stands for are always one step away, the box's
// tasks see them, and Undo takes them back.
import { ExtensionHostKind, registerExtension } from '@codingame/monaco-vscode-api/extensions'
import { current, hooks, onChange } from './session.js'

const when = (group) => `scmProvider == git && scmResourceGroup == ${group}`

const manifest = {
  name: 'git-sandbox',
  publisher: 'quarto-git-sandbox',
  displayName: 'Git',
  version: '1.0.0',
  engines: { vscode: '*' },
  enabledApiProposals: ['scmActionButton'],
  contributes: {
    commands: [
      { command: 'git.init', title: 'Initialize Repository', category: 'Git', icon: '$(add)' },
      { command: 'git.clone', title: 'Clone', category: 'Git' },
      { command: 'git.refresh', title: 'Refresh', category: 'Git', icon: '$(refresh)' },
      { command: 'git.commit', title: 'Commit', category: 'Git', icon: '$(check)' },
      { command: 'git.stage', title: 'Stage Changes', category: 'Git', icon: '$(add)' },
      { command: 'git.stageAll', title: 'Stage All Changes', category: 'Git', icon: '$(add)' },
      { command: 'git.unstage', title: 'Unstage Changes', category: 'Git', icon: '$(remove)' },
      { command: 'git.unstageAll', title: 'Unstage All Changes', category: 'Git', icon: '$(remove)' },
      { command: 'git.clean', title: 'Discard Changes', category: 'Git', icon: '$(discard)' },
      { command: 'git.cleanAll', title: 'Discard All Changes', category: 'Git', icon: '$(discard)' },
      { command: 'git.openFile', title: 'Open File', category: 'Git', icon: '$(go-to-file)' },
      { command: 'git.openChange', title: 'Open Changes', category: 'Git', icon: '$(compare-changes)' },
      { command: 'git.checkout', title: 'Checkout to...', category: 'Git' },
      { command: 'git.branch', title: 'Create Branch...', category: 'Git' },
      { command: 'git.merge', title: 'Merge...', category: 'Git' },
      { command: 'git.pull', title: 'Pull', category: 'Git' },
      { command: 'git.push', title: 'Push', category: 'Git' },
      { command: 'git.fetch', title: 'Fetch', category: 'Git' },
      { command: 'git.sync', title: 'Sync', category: 'Git', icon: '$(sync)' },
      { command: 'git.showOutput', title: 'Show Git Output', category: 'Git' },
      { command: 'git.commitMessageAccept', title: 'Accept Commit Message', category: 'Git', icon: '$(check)' },
      { command: 'git.commitMessageDiscard', title: 'Discard Commit Message', category: 'Git', icon: '$(discard)' }
    ],
    menus: {
      commandPalette: [
        { command: 'git.commitMessageAccept', when: 'gitSandbox.waitingForMessage' },
        { command: 'git.commitMessageDiscard', when: 'gitSandbox.waitingForMessage' },
        { command: 'git.init', when: 'gitSandbox.state == noRepo' },
        { command: 'git.clone', when: 'gitSandbox.state == noRepo' }
      ],
      'scm/title': [
        { command: 'git.commit', group: 'navigation', when: 'scmProvider == git' },
        { command: 'git.refresh', group: 'navigation', when: 'scmProvider == git' },
        { command: 'git.pull', group: '1_sync@1', when: 'scmProvider == git' },
        { command: 'git.push', group: '1_sync@2', when: 'scmProvider == git' },
        { command: 'git.fetch', group: '1_sync@3', when: 'scmProvider == git' },
        { command: 'git.checkout', group: '2_branch@1', when: 'scmProvider == git' },
        { command: 'git.branch', group: '2_branch@2', when: 'scmProvider == git' },
        { command: 'git.merge', group: '2_branch@3', when: 'scmProvider == git' },
        { command: 'git.showOutput', group: '3_footer', when: 'scmProvider == git' }
      ],
      'scm/resourceGroup/context': [
        { command: 'git.stageAll', group: 'inline', when: when('merge') },
        { command: 'git.unstageAll', group: 'inline', when: when('index') },
        { command: 'git.cleanAll', group: 'inline', when: when('workingTree') },
        { command: 'git.stageAll', group: 'inline', when: when('workingTree') },
        { command: 'git.stageAll', group: '1_modification', when: when('merge') },
        { command: 'git.unstageAll', group: '1_modification', when: when('index') },
        { command: 'git.cleanAll', group: '1_modification', when: when('workingTree') },
        { command: 'git.stageAll', group: '1_modification', when: when('workingTree') }
      ],
      'scm/resourceState/context': [
        { command: 'git.openFile', group: 'inline', when: when('merge') },
        { command: 'git.stage', group: 'inline', when: when('merge') },
        { command: 'git.openFile', group: 'inline', when: when('index') },
        { command: 'git.unstage', group: 'inline', when: when('index') },
        { command: 'git.openFile', group: 'inline', when: when('workingTree') },
        { command: 'git.clean', group: 'inline', when: when('workingTree') },
        { command: 'git.stage', group: 'inline', when: when('workingTree') },
        { command: 'git.openChange', group: 'navigation', when: 'scmProvider == git' },
        { command: 'git.openFile', group: 'navigation', when: 'scmProvider == git' },
        { command: 'git.stage', group: '1_modification', when: `${when('merge')} || ${when('workingTree')}` },
        { command: 'git.unstage', group: '1_modification', when: when('index') },
        { command: 'git.clean', group: '1_modification', when: when('workingTree') }
      ],
      'editor/title': [
        { command: 'git.commitMessageAccept', group: 'navigation', when: 'resourceFilename == COMMIT_EDITMSG && gitSandbox.waitingForMessage' },
        { command: 'git.commitMessageDiscard', group: 'navigation', when: 'resourceFilename == COMMIT_EDITMSG && gitSandbox.waitingForMessage' },
        { command: 'git.openChange', group: 'navigation', when: 'resourceScheme == file && resourcePath in gitSandbox.changedPaths' }
      ]
    },
    // The colours VS Code's Git extension declares; the default themes
    // style them, but only once something has declared them.
    colors: [
      color('addedResourceForeground', 'Color for added resources.', '#81b88b', '#587c0c'),
      color('modifiedResourceForeground', 'Color for modified resources.', '#E2C08D', '#895503'),
      color('deletedResourceForeground', 'Color for deleted resources.', '#c74e39', '#ad0707'),
      color('untrackedResourceForeground', 'Color for untracked resources.', '#73C991', '#007100'),
      color('ignoredResourceForeground', 'Color for ignored resources.', '#8C8C8C', '#8E8E90'),
      color('stageModifiedResourceForeground', 'Color for modified resources which have been staged.', '#E2C08D', '#895503'),
      color('stageDeletedResourceForeground', 'Color for deleted resources which have been staged.', '#c74e39', '#ad0707'),
      color('conflictingResourceForeground', 'Color for resources with conflicts.', '#e4676b', '#ad0707')
    ],
    viewsWelcome: [
      {
        view: 'scm',
        contents: 'The folder currently open doesn\'t have a git repository. You can initialize a repository which will enable source control features powered by Git.\n[Initialize Repository](command:git.init)\nYou can also clone a repository.\n[Clone Repository](command:git.clone)',
        when: 'gitSandbox.state == noRepo'
      }
    ]
  }
}

function color (id, description, dark, light) {
  return {
    id: 'gitDecoration.' + id,
    description,
    defaults: { dark, light, highContrast: dark, highContrastLight: light }
  }
}

// A word as the sandbox's shell reads it: quoted only when it has to be.
function q (word) {
  return /^[\w./@:+,=-]+$/.test(word) ? word : '"' + word.replace(/(["\\])/g, '\\$1') + '"'
}

const strip = (text) => String(text || '').replace(/\{[grybw/]\}/g, '')

export async function startGit (files) {
  const { getApi } = registerExtension(manifest, ExtensionHostKind.LocalProcess, { system: true })
  const vscode = await getApi()
  const out = vscode.window.createOutputChannel('Git')
  const sb = () => current().sandbox
  const setContext = (key, value) => vscode.commands.executeCommand('setContext', key, value)

  const fileUri = (rel) => vscode.Uri.file(files.root + '/' + rel)
  const relOf = (uri) => uri.path.startsWith(files.root + '/') ? uri.path.slice(files.root.length + 1) : null
  // a file's committed (ref HEAD) or staged (ref ~) version, as VS Code's
  // Git extension names them
  const gitUri = (rel, ref) => fileUri(rel).with({ scheme: 'git', query: JSON.stringify({ path: rel, ref }) })

  // Paths in commands are relative to the shell's folder, as a learner
  // would type them after `cd`.
  function fromCwd (rel) {
    const cwd = sb().cwdPath()
    if (!cwd) return rel
    const here = cwd.split('/')
    const there = rel.split('/')
    let i = 0
    while (i < here.length && i < there.length - 1 && here[i] === there[i]) i++
    return '../'.repeat(here.length - i) + there.slice(i).join('/')
  }

  /* ------------------------------ running ------------------------------ */

  // One command line through the box, logged as VS Code logs git's.
  async function git (line, { quiet } = {}) {
    out.appendLine('> ' + line)
    const r = await current().run(line, { editor: editMessage, abandon: abandonMessage })
    if (!r) return { ok: false, out: '' }
    if (r.out) out.appendLine(strip(r.out))
    if (!r.ok && !quiet) {
      const first = strip(r.out).split('\n').filter(Boolean)
      const choice = await vscode.window.showErrorMessage(first.slice(0, 2).join(' ') || 'Git: ' + line + ' failed.', 'Open Git Log')
      if (choice) out.show()
    }
    return r
  }

  /* ------------------------------- state ------------------------------- */

  let scm = null
  let groups = null
  let status = null
  let isRepo = false
  // resource state -> { group, kind, rel }
  const info = new WeakMap()
  const decorations = new Map()
  const onDecorations = new vscode.EventEmitter()
  const onContent = new vscode.EventEmitter()

  function resource (group, rel, kind, letter, tooltip, extra) {
    const state = {
      resourceUri: fileUri(rel),
      decorations: { tooltip, strikeThrough: kind === 'deleted', ...extra },
      contextValue: kind,
      command: { title: 'Open', command: 'git.openChange' }
    }
    state.command.arguments = [state]
    info.set(state, { group, kind, rel, letter })
    return state
  }

  function makeScm () {
    scm = vscode.scm.createSourceControl('git', 'Git', files.rootUri)
    groups = {
      merge: scm.createResourceGroup('merge', 'Merge Changes'),
      index: scm.createResourceGroup('index', 'Staged Changes'),
      workingTree: scm.createResourceGroup('workingTree', 'Changes')
    }
    groups.merge.hideWhenEmpty = true
    groups.index.hideWhenEmpty = true
    scm.acceptInputCommand = { command: 'git.commit', title: 'Commit' }
    scm.quickDiffProvider = {
      provideOriginalResource (uri) {
        const rel = relOf(uri)
        if (rel == null || !status || status.untracked.includes(rel)) return undefined
        return gitUri(rel, '~')
      }
    }
  }

  let updating = Promise.resolve()
  function update (rebound) {
    updating = updating.then(() => doUpdate(rebound)).catch((e) => console.error(e))
    return updating
  }

  async function doUpdate (rebound) {
    if (!current()) return
    const s = sb()
    if (rebound && scm) { scm.dispose(); scm = null }
    isRepo = await s.isRepo()
    await setContext('gitSandbox.state', isRepo ? 'repo' : 'noRepo')
    if (!isRepo) {
      if (scm) { scm.dispose(); scm = null }
      status = null
      decorations.clear()
      onDecorations.fire(undefined)
      await setContext('gitSandbox.changedPaths', [])
      return
    }
    if (!scm) makeScm()
    const st = status = await s.statusModel()
    const branch = await s.currentBranch()
    let head = null
    try { head = await s.git.resolveRef({ fs: s.fs, dir: s.dir, ref: 'HEAD' }) } catch (e) {}
    const remote = await s.remoteModel()

    const merge = (st.conflicted || []).map((c) => resource('merge', c.file, 'conflict', '!', 'Conflict: ' + c.kind))
    const index = st.staged.map((x) => x.kind === 'new file'
      ? resource('index', x.file, 'added', 'A', 'Index Added')
      : resource('index', x.file, 'modified', 'M', 'Index Modified'))
      .concat(st.stagedDeleted.map((f) => resource('index', f, 'deleted', 'D', 'Index Deleted')))
    const conflicted = new Set((st.conflicted || []).map((c) => c.file))
    const wt = st.modified.filter((f) => !conflicted.has(f)).map((f) => resource('workingTree', f, 'modified', 'M', 'Modified'))
      .concat(st.deleted.map((f) => resource('workingTree', f, 'deleted', 'D', 'Deleted')))
      .concat(st.untracked.map((f) => resource('workingTree', f, 'untracked', 'U', 'Untracked')))
    const byName = (a, b) => (a.resourceUri.path < b.resourceUri.path ? -1 : 1)
    groups.merge.resourceStates = merge.sort(byName)
    groups.index.resourceStates = index.sort(byName)
    groups.workingTree.resourceStates = wt.sort(byName)
    const count = merge.length + index.length + wt.length
    scm.count = count

    const where = branch || (head ? head.slice(0, 7) : 'main')
    scm.inputBox.placeholder = `Message (Ctrl+Enter to commit on "${where}")`
    if (st.merging && !scm.inputBox.value) {
      try { scm.inputBox.value = (await s.readFile('.git/MERGE_MSG')).replace(/\n+$/, '') } catch (e) {}
    }

    // the status bar: branch (with * when there are changes), then sync
    const bar = [{
      command: 'git.checkout',
      title: (branch ? '$(git-branch) ' : '$(git-commit) ') + where + (count ? '*' : '') + (st.merging ? ' (Merging)' : ''),
      tooltip: (branch ? where : 'HEAD detached at ' + where) + ', Checkout Branch/Tag...'
    }]
    if (remote && branch) {
      bar.push(remote.tracked
        ? {
            command: 'git.sync',
            title: '$(sync)' + (remote.behind || remote.ahead ? ` ${remote.behind}$(arrow-down) ${remote.ahead}$(arrow-up)` : ''),
            tooltip: `Synchronize Changes: pull ${remote.behind} and push ${remote.ahead} commits between ${branch} and ${remote.name || 'origin'}/${branch}`
          }
        : { command: 'git.push', title: '$(cloud-upload)', tooltip: 'Publish Branch' })
    }
    scm.statusBarCommands = bar

    try {
      scm.actionButton = remote && branch && remote.tracked && !count && (remote.ahead || remote.behind)
        ? { command: { command: 'git.sync', title: `$(sync) Sync Changes ${remote.behind ? remote.behind + '$(arrow-down) ' : ''}${remote.ahead ? remote.ahead + '$(arrow-up)' : ''}` }, enabled: true }
        : { command: { command: 'git.commit', title: '$(check) Commit' }, enabled: count > 0 || st.merging }
    } catch (e) {}

    // explorer colours and letters; working tree changes win over staged
    decorations.clear()
    const deco = (rel, badge, colorId, tooltip, propagate = true) =>
      decorations.set(fileUri(rel).toString(), { badge, tooltip, propagate, color: new vscode.ThemeColor('gitDecoration.' + colorId) })
    st.staged.forEach((x) => deco(x.file, x.kind === 'new file' ? 'A' : 'M', x.kind === 'new file' ? 'addedResourceForeground' : 'stageModifiedResourceForeground', x.kind === 'new file' ? 'Index Added' : 'Index Modified'))
    st.stagedDeleted.forEach((f) => deco(f, 'D', 'stageDeletedResourceForeground', 'Index Deleted'))
    st.modified.forEach((f) => deco(f, 'M', 'modifiedResourceForeground', 'Modified'))
    st.deleted.forEach((f) => deco(f, 'D', 'deletedResourceForeground', 'Deleted'))
    st.untracked.forEach((f) => deco(f, 'U', 'untrackedResourceForeground', 'Untracked'))
    ;(st.conflicted || []).forEach((c) => deco(c.file, '!', 'conflictingResourceForeground', 'Conflict'))
    ;(st.ignored || []).forEach((f) => deco(f, undefined, 'ignoredResourceForeground', 'Ignored', false))
    onDecorations.fire(undefined)
    await setContext('gitSandbox.changedPaths', [...new Set(wt.concat(index).filter((r) => {
      const i = info.get(r)
      return i.kind === 'modified'
    }).map((r) => r.resourceUri.path))])

    // the committed and staged versions shown in open diffs follow along
    vscode.workspace.textDocuments.filter((d) => d.uri.scheme === 'git').forEach((d) => onContent.fire(d.uri))
  }

  vscode.window.registerFileDecorationProvider({
    onDidChangeFileDecorations: onDecorations.event,
    provideFileDecoration (uri) {
      const d = decorations.get(uri.toString())
      if (!d) return undefined
      const fd = new vscode.FileDecoration(d.badge, d.tooltip, d.color)
      fd.propagate = d.propagate
      return fd
    }
  })

  vscode.workspace.registerTextDocumentContentProvider('git', {
    onDidChange: onContent.event,
    async provideTextDocumentContent (uri) {
      const { path, ref } = JSON.parse(uri.query)
      const s = sb()
      const opts = { fs: s.fs, dir: s.dir }
      try {
        let oid
        if (ref === '~') {
          const found = await s.git.walk({
            ...opts,
            trees: [s.git.STAGE()],
            map: async (fp, [e]) => {
              if (fp === '.') return undefined
              if (fp === path) return e ? e.oid() : undefined
              return path.startsWith(fp + '/') ? undefined : null
            }
          })
          oid = found[0]
          if (!oid) return ''
        } else {
          const commit = await s.git.resolveRef({ ...opts, ref })
          oid = (await s.git.readBlob({ ...opts, oid: commit, filepath: path })).oid
        }
        const { blob } = await s.git.readBlob({ ...opts, oid })
        return new TextDecoder().decode(blob)
      } catch (e) {
        return ''
      }
    }
  })

  /* ----------------------------- arguments ----------------------------- */

  // The files a command was invoked on: resource states from the Source
  // Control view (one, or all those selected), a group's header, a URI from
  // an editor's title, or with nothing, the file in the active editor.
  function targets (args) {
    const found = []
    const seen = new Set()
    const add = (state) => {
      const i = info.get(state)
      if (i && !seen.has(state)) { seen.add(state); found.push(i) }
    }
    const visit = (a) => {
      if (!a) return
      if (Array.isArray(a)) { a.forEach(visit); return }
      if (info.has(a)) { add(a); return }
      if (a.resourceStates) { a.resourceStates.forEach(add); return }
      if (a instanceof vscode.Uri || (a.scheme && a.path)) {
        const rel = relOf(a)
        if (rel != null) found.push(describe(rel))
      }
    }
    args.forEach(visit)
    if (!args.length && vscode.window.activeTextEditor) visit(vscode.window.activeTextEditor.document.uri)
    return found
  }

  // what the latest status says about a file, as a Source Control row would
  function describe (rel) {
    for (const g of ['merge', 'workingTree', 'index']) {
      const state = groups && groups[g].resourceStates.find((r) => relOf(r.resourceUri) === rel)
      if (state) return info.get(state)
    }
    return { group: null, kind: 'unmodified', rel }
  }

  const paths = (list) => list.map((t) => q(fromCwd(t.rel))).join(' ')

  /* ------------------------------ commands ----------------------------- */

  const cmd = (id, fn) => vscode.commands.registerCommand(id, async (...args) => {
    if (!current()) return
    try { await fn(...args) } catch (e) { vscode.window.showErrorMessage(String(e && e.message ? e.message : e)) }
  })

  cmd('git.refresh', () => update())
  cmd('git.showOutput', () => out.show())
  cmd('git.init', () => git('git init'))
  cmd('git.clone', async () => {
    const remote = await sb().remoteModel()
    const url = await vscode.window.showInputBox({
      prompt: 'Provide repository URL',
      placeHolder: 'https://github.com/owner/repo',
      value: remote && remote.url ? remote.url : '',
      ignoreFocusOut: true
    })
    if (url) await git('git clone ' + q(url))
  })

  cmd('git.stage', async (...args) => {
    const list = targets(args).filter((t) => t.group !== 'index')
    if (list.length) await git('git add ' + paths(list))
  })
  cmd('git.stageAll', async (group) => {
    const list = group && group.resourceStates ? targets([group]) : targets([groups.merge, groups.workingTree])
    if (list.length) await git('git add ' + paths(list))
  })

  async function unstage (list) {
    if (!list.length) return
    const s = sb()
    let hasHead = true
    try { await s.git.resolveRef({ fs: s.fs, dir: s.dir, ref: 'HEAD' }) } catch (e) { hasHead = false }
    // before the first commit there is nothing to restore from
    await git((hasHead ? 'git restore --staged ' : 'git rm --cached ') + paths(list))
  }
  cmd('git.unstage', (...args) => unstage(targets(args).filter((t) => t.group === 'index')))
  cmd('git.unstageAll', () => unstage(targets([groups.index])))

  async function discard (list) {
    list = list.filter((t) => t.group === 'workingTree')
    if (!list.length) return
    const untracked = list.filter((t) => t.kind === 'untracked')
    const tracked = list.filter((t) => t.kind !== 'untracked')
    const name = (t) => t.rel.split('/').pop()
    let message, yes
    if (list.length === 1 && untracked.length) {
      message = `Are you sure you want to DELETE the following untracked file: '${name(list[0])}'?\n\nThis is IRREVERSIBLE!\nThis file will be FOREVER LOST if you proceed.`
      yes = 'Delete File'
    } else if (list.length === 1) {
      message = `Are you sure you want to discard changes in '${name(list[0])}'?`
      yes = 'Discard File'
    } else {
      message = `Are you sure you want to discard ALL changes in ${list.length} files?` +
        (untracked.length ? `\n\nThis will DELETE ${untracked.length} untracked files!\nThis is IRREVERSIBLE!` : '')
      yes = untracked.length ? `Discard All ${list.length} Files` : 'Discard All Changes'
    }
    const pick = await vscode.window.showWarningMessage(message, { modal: true }, yes)
    if (pick !== yes) return
    if (tracked.length) await git('git restore ' + paths(tracked))
    if (untracked.length) await git('rm ' + paths(untracked))
  }
  cmd('git.clean', (...args) => discard(targets(args)))
  cmd('git.cleanAll', () => discard(targets([groups.workingTree])))

  cmd('git.openFile', async (...args) => {
    const list = targets(args)
    for (const t of list) {
      if (t.kind === 'deleted') await vscode.commands.executeCommand('vscode.open', gitUri(t.rel, t.group === 'index' ? 'HEAD' : '~'))
      else await vscode.commands.executeCommand('vscode.open', fileUri(t.rel))
    }
  })

  cmd('git.openChange', async (...args) => {
    for (const t of targets(args)) {
      const name = t.rel.split('/').pop()
      if (t.group === 'index') {
        if (t.kind === 'deleted') await vscode.commands.executeCommand('vscode.open', gitUri(t.rel, 'HEAD'))
        else await vscode.commands.executeCommand('vscode.diff', gitUri(t.rel, 'HEAD'), gitUri(t.rel, '~'), `${name} (Index)`)
      } else if (t.group === 'workingTree' && t.kind === 'modified') {
        await vscode.commands.executeCommand('vscode.diff', gitUri(t.rel, '~'), fileUri(t.rel), `${name} (Working Tree)`)
      } else if (t.group === 'workingTree' && t.kind === 'deleted') {
        await vscode.commands.executeCommand('vscode.open', gitUri(t.rel, '~'))
      } else {
        await vscode.commands.executeCommand('vscode.open', fileUri(t.rel))
      }
    }
  })

  cmd('git.commit', async () => {
    if (!isRepo) return
    const st = status
    const staged = st.staged.length + st.stagedDeleted.length
    const changes = st.modified.length + st.deleted.length + st.untracked.length
    let stageFirst = false
    if (!staged && !st.merging) {
      if (!changes) {
        vscode.window.showInformationMessage('There are no changes to commit.')
        return
      }
      const pick = await vscode.window.showWarningMessage(
        'There are no staged changes to commit.\n\nWould you like to stage all your changes and commit them directly?',
        { modal: true }, 'Yes')
      if (pick !== 'Yes') return
      stageFirst = true
    }
    let message = scm.inputBox.value.trim()
    if (!message) {
      message = (await vscode.window.showInputBox({ placeHolder: 'Commit message', prompt: 'Please provide a commit message', ignoreFocusOut: true }) || '').trim()
      if (!message) return
    }
    if (stageFirst && !(await git('git add -A')).ok) return
    const r = await git('git commit -m ' + q(message))
    if (r.ok) scm.inputBox.value = ''
  })

  async function branchPicks (withRemote) {
    const s = sb()
    const o = { fs: s.fs, dir: s.dir }
    const here = await s.currentBranch()
    const items = []
    for (const b of await s.git.listBranches(o)) {
      if (b === here) continue
      const oid = await s.git.resolveRef({ ...o, ref: b }).catch(() => '')
      items.push({ label: b, description: oid.slice(0, 7), ref: b, local: true })
    }
    if (withRemote) {
      for (const r of await s.git.listRemotes(o)) {
        for (const b of await s.git.listBranches({ ...o, remote: r.remote })) {
          if (b === 'HEAD') continue
          const oid = await s.git.resolveRef({ ...o, ref: `refs/remotes/${r.remote}/${b}` }).catch(() => '')
          items.push({ label: `${r.remote}/${b}`, description: 'Remote branch at ' + oid.slice(0, 7), ref: `${r.remote}/${b}`, remote: r.remote, name: b })
        }
      }
    }
    return items
  }

  async function createBranch () {
    const name = (await vscode.window.showInputBox({ placeHolder: 'Branch name', prompt: 'Please provide a new branch name', ignoreFocusOut: true }) || '').trim()
    if (name) await git('git switch -c ' + q(name.replace(/\s+/g, '-')))
  }

  cmd('git.branch', createBranch)
  cmd('git.checkout', async () => {
    const create = { label: '$(plus) Create new branch...', create: true, alwaysShow: true }
    const items = [create, { label: 'branches', kind: vscode.QuickPickItemKind.Separator }].concat(await branchPicks(true))
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select a ref to checkout' })
    if (!pick) return
    if (pick.create) return createBranch()
    // a remote branch checks out as a local one tracking it, as `git
    // switch <name>` does when only origin/<name> exists
    await git('git switch ' + q(pick.local ? pick.ref : pick.name))
  })
  cmd('git.merge', async () => {
    const pick = await vscode.window.showQuickPick(await branchPicks(true), { placeHolder: 'Select a branch to merge from' })
    if (pick) await git('git merge ' + q(pick.ref))
  })
  cmd('git.fetch', () => git('git fetch'))
  cmd('git.pull', () => git('git pull'))

  async function push () {
    const s = sb()
    const remote = await s.remoteModel()
    const branch = await s.currentBranch()
    if (!remote) {
      vscode.window.showWarningMessage('Your repository has no remotes configured to push to.')
      return { ok: false }
    }
    if (!branch) {
      vscode.window.showWarningMessage('Please check out a branch to push to a remote.')
      return { ok: false }
    }
    if (!remote.tracked) {
      const yes = 'OK'
      const pick = await vscode.window.showInformationMessage(`The branch '${branch}' has no remote branch. Would you like to publish this branch?`, { modal: true }, yes)
      if (pick !== yes) return { ok: false }
      return git(`git push -u ${q(remote.name || 'origin')} ${q(branch)}`)
    }
    return git('git push')
  }
  cmd('git.push', push)
  cmd('git.sync', async () => {
    const remote = await sb().remoteModel()
    if (!remote || !remote.tracked) return push()
    if (remote.behind && !(await git('git pull')).ok) return
    if ((await sb().remoteModel()).ahead) await git('git push')
  })

  /* -------------------------- commit messages -------------------------- */

  // `git commit` without -m, typed in VS Code's terminal: git opens the
  // message in the editor, as with core.editor set to `code --wait`, and
  // waits for its tab to close.
  let waiting = null

  async function editMessage (file, text) {
    const s = sb()
    const storePath = s.dir + '/' + file
    await s.fs.promises.writeFile(storePath, text)
    const uri = files.uriOf(storePath)
    files.touch(storePath)
    await setContext('gitSandbox.waitingForMessage', true)
    const doc = await vscode.workspace.openTextDocument(uri)
    if (doc.isDirty) await vscode.commands.executeCommand('workbench.action.files.revert', uri)
    await vscode.window.showTextDocument(doc, { preview: false })
    return new Promise((resolve) => {
      const isOpen = () => vscode.window.tabGroups.all.some((g) => g.tabs.some((t) =>
        t.input && t.input.uri && t.input.uri.toString() === uri.toString()))
      const finish = async (value) => {
        if (!waiting) return
        waiting = null
        sub.dispose()
        await setContext('gitSandbox.waitingForMessage', false)
        if (value === null) {
          // the tab closed: whatever was saved is the message
          try { value = await s.fs.promises.readFile(storePath, 'utf8') } catch (e) { value = '' }
        }
        resolve(value)
      }
      const sub = vscode.window.tabGroups.onDidChangeTabs(() => { if (!isOpen()) finish(null) })
      waiting = {
        uri,
        finish,
        // Reset, or Ctrl+C in the terminal: close the tab, keep nothing
        abandon: async (value) => {
          await finish(value)
          const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input && t.input.uri && t.input.uri.toString() === uri.toString())
          if (tabs.length) {
            await vscode.commands.executeCommand('workbench.action.files.revert', uri).then(undefined, () => {})
            await vscode.window.tabGroups.close(tabs).then(undefined, () => {})
          }
        }
      }
    })
  }

  function abandonMessage () {
    if (waiting) waiting.abandon(undefined)
  }

  // for the terminal's Ctrl+C: git then aborts on the empty message
  hooks.cancelMessage = () => { if (waiting) waiting.abandon('') }
  hooks.editMessage = editMessage
  hooks.abandonMessage = abandonMessage

  cmd('git.commitMessageAccept', async () => {
    if (!waiting) return
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === waiting.uri.toString())
    if (doc && doc.isDirty) await doc.save()
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input && t.input.uri && t.input.uri.toString() === waiting.uri.toString())
    await vscode.window.tabGroups.close(tabs)
  })
  cmd('git.commitMessageDiscard', async () => {
    if (waiting) await waiting.abandon('')
  })

  // no "Generate Commit Message" sparkle: there is no AI here
  await setContext('chatSetupHidden', true)
  onChange((rebound) => update(rebound))
  await update(true)
  return vscode
}
