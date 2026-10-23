# Contributing

Thanks for looking. Bug reports and pull requests are both welcome.

## Getting set up

```bash
git clone https://github.com/ryjohnson09/quarto-git-sandbox
cd quarto-git-sandbox
npm install
./tests/run.sh
```

You need Node 18+ and Quarto 1.4+. `npm install` pulls development
dependencies only; the extension itself ships as plain files and needs no
build step to *use*.

## How the pieces fit together

```
_extensions/git-sandbox/
  git-sandbox.lua      the filter: reads the block, emits a div + config JSON
  yaml.lua             a small YAML subset parser
  resources/
    sandbox-core.js    in-memory filesystem, git and shell commands, graph model
    sandbox-when.js    the `when:` mini-language and the graph helpers it uses
    sandbox-tree.js    the optional learngitbranching-style commit tree
    sandbox-ui.js      terminal, editor, panels, task list; mounts the boxes
    git-sandbox.css    styling
    isomorphic-git.bundle.js   GENERATED from vendor/ by ./build.sh
    sandbox-vscode.js  loads the VS Code view on demand
    vscode/            GENERATED from vscode/src/ (see below)
vscode/
  src/main.js          boots the workbench; GitSandboxVSCode.attach()
  src/session.js       which box VS Code is bound to
  src/files.js         the box's in-memory files as VS Code's file://
  src/git.js           Source Control, explorer decorations, Git commands
  src/terminal.js      the integrated terminal's line editing
```

The scripts load in that order, each one a plain browser script (the first
three also work as Node modules, for the tests). What is in `resources/` is
what `quarto add` installs, so there is no build step for the sandbox
itself: edit the files and render.

At render time the filter turns each block into a container plus a
`window.__gsPending.push([...])` call. `sandbox-ui.js`, loaded after the
body, drains that queue. This keeps a 260 KB library off the critical path
while still letting per-exercise configuration sit inline where the author
wrote it.

## The VS Code view

`vscode: true` boxes get the real VS Code workbench, built from
[monaco-vscode-api](https://github.com/CodinGame/monaco-vscode-api). It is
the one part of the extension with a build step, because VS Code ships as
thousands of ES modules:

```bash
cd vscode
npm install
npm run build        # writes _extensions/git-sandbox/resources/vscode/
```

Commit the rebuilt `resources/vscode/` with the change to `vscode/src/`:
like the isomorphic-git bundle, it is what `quarto add` installs. The
`@codingame/*` packages are pinned to one exact version; bump them all
together.

The workbench never changes the repository itself. Every git action is a
command line run through the box (`vscBinding.run` in `sandbox-ui.js`),
and every file change goes through `vscBinding.mutate`, so tasks, Undo and
the panels see VS Code's work exactly as they see typed commands. Keep it
that way: a learner should always be able to find, in the box's terminal,
the command a click stood for.

## Tests

```bash
./tests/run.sh
```

| Suite | Covers |
|---|---|
| `tests/test_yaml.lua` | The option parser, run under Quarto's bundled Lua |
| `tests/test-core.js` | Git and shell commands against a real isomorphic-git |
| `tests/test-when.js` | Every `when:` condition, against real repository state |
| `tests/test-ui.js` | Terminal, staging diagram and commit graph, at DOM level |
| `tests/test-errors.js` | Bad options and bad conditions produce visible messages |
| `tests/test-embed.js` | The same widget on a plain HTML page, without Quarto |
| `tests/test-rendered.js` | The real rendered `example.qmd`, driven end to end |
| `tests/test-revealjs.js` | The rendered `example-revealjs.qmd`: boxes on reveal.js slides, one repository shared across two |
| `tests/test-realgit.js` | The same commands run in the sandbox and through the real `git` binary, with the terminal output compared |
| `tests/test-vscode.js` | The VS Code view in Chromium: loaded only on demand, then the terminal, Source Control and commit driven for real |

The UI and end-to-end suites use jsdom, so they run in CI without a browser.
`test-vscode.js` is the exception: it needs Playwright's Chromium
(`npx playwright install chromium`) and says it skipped the browser half
when that is missing.
`test-rendered.js` loads the actual rendered HTML, executes its real scripts,
and completes the exercises by submitting the form. If it passes, the
lesson works.

`test-realgit.js` needs `git` on your PATH. It normalises hashes, paths and
spacing, then checks that every line the sandbox prints also appears in real
git's output, in order (real git may print more), or, for steps marked
`exact`, that the two match line for line. When you add or change a command,
add a step there too, so the sandbox keeps saying what git says.

Please add tests with changes. New `when:` conditions in particular should get
both a true and a false case, plus an error case for bad syntax.

## Two things that will surprise you

**Quarto replaces the global `error` inside Lua filters** with its own logger.
Calling `error("...")` prints a message and then *returns*, so execution
continues with nil values and blows up somewhere unrelated. `assert` is
untouched, so `yaml.lua` raises through `assert(false, msg)` and `M.parse`
returns `nil, message` instead of raising. Do not add `error()` calls to the
Lua here expecting them to abort.

**Do not use `pandoc.read` to parse the block options.** Pandoc parses metadata
values as Markdown, which mangles the strings that matter most: `echo "# hi" >
f.txt` loses its quotes to smart punctuation, and a literal block's newlines
collapse into spaces. That is why `yaml.lua` exists. Markdown is applied
afterwards, and only to fields that should have it (`title`, `done-note`, task
`text`).

## Style

- Two-space indentation in Lua and JavaScript.
- The browser code is ES5-flavoured on purpose (`var`, no arrow functions in
  `resources/`) so it runs without transpilation in older embedded webviews. Tests may
  use modern syntax.
- Comments should explain *why*, not restate the code. If a line looks wrong but
  is deliberate, say why; the `Buffer` polyfill and the `assert` workaround are
  the model here.
- Error messages are read by lesson authors, not programmers. Name the thing
  that is wrong and what was expected.

## Accessibility and contrast

Every text and background pair in the widget meets WCAG AA, and status is never
conveyed by colour alone. If you add a colour, check the contrast ratio before
opening a pull request, and keep a non-colour signal alongside it.

## Releasing

1. Bump `version` in `_extensions/git-sandbox/_extension.yml`, `package.json`,
   and the `version` passed to `addHtmlDependency` in `git-sandbox.lua`.
2. Tag the release: `git tag v1.0.1 && git push --tags`.

`quarto add ryjohnson09/quarto-git-sandbox` installs from the **HEAD of `main`**,
not from the latest tag, so whatever is on `main` is what people get. Tags are
opt-in for users who ask for them:

```bash
quarto add ryjohnson09/quarto-git-sandbox        # HEAD of main
quarto add ryjohnson09/quarto-git-sandbox@v1.0.0 # a specific tag
```

Keep `main` releasable at all times: `_extensions/git-sandbox/resources/` on
`main` is exactly what users install.
