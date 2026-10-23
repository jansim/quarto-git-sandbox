// VS Code's integrated terminal, running the box's shell.
//
// xterm.js sends keystrokes and shows whatever we write back, so this is
// the line editing a real shell does (echo, cursor keys, history, Tab
// completion, Ctrl+C), with each finished line run through the box, where
// it counts for the tasks and Undo like a command typed there.
import { SimpleTerminalBackend, SimpleTerminalProcess } from '@codingame/monaco-vscode-terminal-service-override'
import { Emitter } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event'
import { current, hooks, onChange } from './session.js'

const ESC = '\x1b['
const COLORS = { g: ESC + '32m', r: ESC + '31m', y: ESC + '33m', b: ESC + '34m', w: ESC + '1m', '/': ESC + '0m' }

// the sandbox's {y}…{/} colour markers as ANSI, and newlines as a
// terminal wants them
function ansi (text) {
  return String(text).replace(/\{([grybw/])\}/g, (_m, k) => COLORS[k]).replace(/\r?\n/g, '\r\n')
}

const COMMANDS = ['git', 'ls', 'cat', 'echo', 'touch', 'rm', 'mkdir', 'cd', 'pwd', 'whoami', 'help', 'clear', 'undo', 'reset']
const GIT_COMMANDS = ['init', 'status', 'add', 'rm', 'commit', 'restore', 'reset', 'log', 'diff', 'branch', 'checkout',
  'switch', 'merge', 'remote', 'clone', 'push', 'pull', 'fetch', 'config', 'check-ignore']
const TAKES_BRANCH = ['checkout', 'switch', 'merge', 'branch', 'log', 'push', 'pull', 'diff', 'reset', 'restore']

let nextId = 1
const shells = new Set()

// Another box took the workbench over: its shells start afresh on that
// box's repository, rather than under the last one's scrollback
onChange((rebound) => {
  if (!rebound) return
  for (const sh of shells) {
    if (sh.running) continue
    sh.write(ESC + '2J' + ESC + '3J' + ESC + 'H')
    sh.banner()
  }
})

class SandboxShell extends SimpleTerminalProcess {
  constructor (data) {
    super(nextId, nextId++, '/', data.event)
    this.data = data
    this.line = ''
    this.cursor = 0
    this.history = []
    this.histIdx = 0
    this.running = false
    this.pending = ''
    // VS Code asks after each command where the shell now is
    this.refreshProperty = async (type) => (type === 'cwd' || type === 'initialCwd')
      ? (current() ? current().sandbox.pwd() : '~')
      : undefined
  }

  write (text) { this.data.fire(text) }

  promptText () {
    const b = current()
    const p = b ? b.prompt() : '$'
    // "~/project (main) $": the folder in green, the branch in cyan, as a
    // git-aware bash prompt colours them
    const m = /^(.*?)(\s\([^)]*\))?\s*\$$/.exec(p)
    if (!m) return p + ' '
    return ESC + '32m' + m[1] + ESC + '0m' + (m[2] ? ESC + '36m' + m[2] + ESC + '0m' : '') + ' $ '
  }

  prompt () {
    this.line = ''
    this.cursor = 0
    this.write(this.promptText())
  }

  // redraw the input line after an edit, leaving the cursor in place
  redraw () {
    this.write('\r' + ESC + 'K' + this.promptText() + this.line)
    const back = this.line.length - this.cursor
    if (back > 0) this.write(ESC + back + 'D')
  }

  banner () {
    this.write(ansi('{w}Git sandbox shell{/}: real git commands on this exercise\'s repository.\nType {y}help{/} to see what it supports.\n\n'))
    this.prompt()
  }

  async start () {
    shells.add(this)
    this.banner()
    return undefined
  }

  shutdown () { shells.delete(this) }
  resize () {}
  clearBuffer () {}
  sendSignal () {}

  input (data) {
    if (this.running) {
      // the only key that means anything while git waits on the editor
      if (data.includes('\x03') && hooks.cancelMessage) hooks.cancelMessage()
      return
    }
    // a paste of several lines runs them one by one
    this.pending += data
    this.drain()
  }

  drain () {
    while (this.pending && !this.running) {
      const d = this.pending
      let used = 1
      const c = d[0]
      if (c === '\x1b') {
        const m = /^\x1b(\[[0-9;]*[A-Za-z~]|O[A-Za-z])/.exec(d)
        used = m ? m[0].length : 1
        this.key(m ? m[1] : '')
      } else if (c === '\r' || c === '\n') {
        if (c === '\r' && d[1] === '\n') used = 2
        this.pending = d.slice(used)
        this.enter()
        continue
      } else if (c === '\x7f' || c === '\b') {
        if (this.cursor > 0) {
          this.line = this.line.slice(0, this.cursor - 1) + this.line.slice(this.cursor)
          this.cursor--
          this.redraw()
        }
      } else if (c === '\x03') {
        this.write('^C\r\n')
        this.prompt()
      } else if (c === '\x0c') {
        this.write(ESC + '2J' + ESC + '3J' + ESC + 'H')
        this.redraw()
      } else if (c === '\x01') {
        this.cursor = 0
        this.redraw()
      } else if (c === '\x05') {
        this.cursor = this.line.length
        this.redraw()
      } else if (c === '\x15') {
        this.line = this.line.slice(this.cursor)
        this.cursor = 0
        this.redraw()
      } else if (c === '\t') {
        this.pending = d.slice(1)
        this.complete()
        return
      } else if (c >= ' ') {
        const m = /^[^\x00-\x1f\x7f]+/.exec(d)
        used = m[0].length
        this.line = this.line.slice(0, this.cursor) + m[0] + this.line.slice(this.cursor)
        this.cursor += m[0].length
        if (this.cursor === this.line.length) this.write(m[0])
        else this.redraw()
      }
      this.pending = d.slice(used)
    }
  }

  key (seq) {
    switch (seq) {
      case '[A': // up
        if (this.histIdx > 0) {
          this.histIdx--
          this.line = this.history[this.histIdx]
          this.cursor = this.line.length
          this.redraw()
        }
        return
      case '[B': // down
        if (this.histIdx < this.history.length) {
          this.histIdx++
          this.line = this.history[this.histIdx] || ''
          this.cursor = this.line.length
          this.redraw()
        }
        return
      case '[C': if (this.cursor < this.line.length) { this.cursor++; this.write(ESC + 'C') } return
      case '[D': if (this.cursor > 0) { this.cursor--; this.write(ESC + 'D') } return
      case '[H': case 'OH': case '[1~': this.cursor = 0; this.redraw(); return
      case '[F': case 'OF': case '[4~': this.cursor = this.line.length; this.redraw(); return
      case '[3~':
        if (this.cursor < this.line.length) {
          this.line = this.line.slice(0, this.cursor) + this.line.slice(this.cursor + 1)
          this.redraw()
        }
    }
  }

  async enter () {
    const line = this.line
    this.write('\r\n')
    if (!line.trim()) { this.prompt(); return }
    if (this.history[this.history.length - 1] !== line) this.history.push(line)
    this.histIdx = this.history.length
    const b = current()
    if (!b) { this.prompt(); return }
    this.running = true
    try {
      await b.run(line, {
        write: (text) => { if (text) this.write(ansi(text) + '\r\n') },
        clear: () => this.write(ESC + '2J' + ESC + '3J' + ESC + 'H'),
        editor: async (file, text) => {
          this.write('hint: Waiting for your editor to close the file... ')
          const saved = hooks.editMessage ? await hooks.editMessage(file, text) : ''
          this.write(ESC + '2K\r')
          return saved
        },
        abandon: () => { if (hooks.abandonMessage) hooks.abandonMessage() }
      })
    } catch (e) {
      this.write(ansi('{r}' + (e && e.message ? e.message : e) + '{/}\n'))
    }
    this.running = false
    this.prompt()
    this.drain()
  }

  // Tab: commands, git subcommands, branch names and file names, as
  // bash-completion offers them
  async complete () {
    const b = current()
    if (!b) return
    const sb = b.sandbox
    const before = this.line.slice(0, this.cursor)
    const words = before.split(/\s+/)
    const word = words[words.length - 1]
    let options = []
    if (words.length === 1) {
      options = COMMANDS.filter((c) => c.startsWith(word)).map((c) => c + ' ')
    } else if (words[0] === 'git' && words.length === 2) {
      options = GIT_COMMANDS.filter((c) => c.startsWith(word)).map((c) => c + ' ')
    } else {
      if (words[0] === 'git' && TAKES_BRANCH.includes(words[1])) {
        try {
          const o = { fs: sb.fs, dir: sb.dir }
          const names = (await sb.git.listBranches(o)).concat(
            ...(await Promise.all((await sb.git.listRemotes(o)).map(async (r) =>
              (await sb.git.listBranches({ ...o, remote: r.remote })).filter((x) => x !== 'HEAD').map((x) => r.remote + '/' + x)))))
          options = names.filter((n) => n.startsWith(word)).map((n) => n + ' ')
        } catch (e) {}
      }
      const slash = word.lastIndexOf('/')
      const folder = slash === -1 ? '' : word.slice(0, slash + 1)
      const stem = word.slice(slash + 1)
      const cwd = sb.dir + (sb.cwdPath() ? '/' + sb.cwdPath() : '')
      const base = folder.startsWith('/') ? folder : cwd + '/' + folder
      try {
        for (const name of await sb.fs.promises.readdir(base.replace(/\/+$/, '') || '/')) {
          if (!name.startsWith(stem) || (name.startsWith('.') && !stem.startsWith('.'))) continue
          const n = sb.fs._store.get(sb.fs._norm(base + '/' + name))
          options.push(folder + name + (n && n.type === 'dir' ? '/' : ' '))
        }
      } catch (e) {}
    }
    options = [...new Set(options)]
    if (!options.length) { this.drain(); return }
    let common = options[0]
    for (const o of options) while (!o.startsWith(common)) common = common.slice(0, -1)
    if (common.length > word.length) {
      const add = common.slice(word.length)
      this.line = before + add + this.line.slice(this.cursor)
      this.cursor += add.length
      this.redraw()
    } else if (options.length > 1) {
      this.write('\r\n' + options.map((o) => o.trim()).join('  ') + '\r\n')
      this.redraw()
    }
    this.drain()
  }
}

export class SandboxTerminalBackend extends SimpleTerminalBackend {
  getDefaultSystemShell = async () => 'bash'
  createProcess = async () => new SandboxShell(new Emitter())
}
