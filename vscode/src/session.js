// Which box VS Code is working on. The workbench is one per page, so
// opening it from another box rebinds everything here to that box.
//
// A binding comes from sandbox-ui.js (see vscBinding there):
//   sandbox         the box's GitSandboxCore sandbox
//   name            the project folder's name, e.g. sales-analysis
//   prompt()        the box's prompt, e.g. "~/sales-analysis (main) $"
//   run(line, io)   runs a command line as if typed in the box
//   mutate(label, fn)  a file change, with an undo entry
//   onRefresh(fn)   fn runs after the box redraws; returns an unsubscribe

// Set by git.js for the terminal: editMessage(file, text) opens a commit
// message for editing and resolves with what was saved; cancelMessage()
// gives up on it (Ctrl+C)
export const hooks = {}

const listeners = new Set()
let binding = null
let unhook = null

export function current () {
  return binding
}

// `fn(rebound)` runs whenever the repository may have changed: after every
// refresh of the bound box, and (with rebound true) when another box binds
export function onChange (fn) {
  listeners.add(fn)
  return { dispose: () => listeners.delete(fn) }
}

function emit (rebound) {
  for (const fn of [...listeners]) {
    try { fn(rebound) } catch (e) { console.error(e) }
  }
}

export function bind (b) {
  if (b === binding) return
  if (unhook) unhook()
  binding = b
  unhook = b.onRefresh(() => emit(false))
  emit(true)
}
