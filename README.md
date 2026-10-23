# quarto-git-sandbox

[![test](https://github.com/jansim/quarto-git-sandbox/actions/workflows/test.yml/badge.svg)](https://github.com/jansim/quarto-git-sandbox/actions/workflows/test.yml)

**[Try the live demo →](https://jansim.github.io/quarto-git-sandbox/)**

> [!NOTE]
> This repository is a separately developed fork of
> [ryjohnson09/quarto-git-sandbox](https://github.com/ryjohnson09/quarto-git-sandbox),
> created by [Ryan Johnson (@ryjohnson09)](https://github.com/ryjohnson09).
> It was unlinked from the original on GitHub so that it can have its own
> issues. Please report problems with this version
> [here](https://github.com/jansim/quarto-git-sandbox/issues), not on the
> original repository.

Interactive Git exercises for Quarto documents. Each exercise is a **real Git
repository running in the reader's browser**. Learners type real `git`
commands and watch a working-directory/staging/repository diagram, a live
diff of what changed, and a live commit graph update as they go; a chevron
on each commit in the graph opens what that commit changed. Exercises
can also add a **mock remote**: a second repository inside the page that
learners `push` to, `fetch` and `pull` from, drawn as its own commit graph
beside the local one, including realistic rejected pushes when the remote is ahead.

Nothing is installed, nothing is uploaded, nothing is written to disk.
Both repositories live in memory and disappear on reload.

![An annotated git-sandbox exercise: a terminal with hint buttons, a task checklist that ticks itself, and live diagrams of the repository](images/sandbox-tour.png)

```markdown
```git-sandbox
title: Your first commit
tasks:
  - text: Start tracking the folder with `git init`
    when: repo
  - text: Stage a file and commit it
    when: commits >= 1
```
```

Conditions are declarative, so lessons stay in Markdown and YAML. You do not
need to write JavaScript to author an exercise.

## Install

```bash
quarto add jansim/quarto-git-sandbox
```

Then add the filter to your document, and use a `git-sandbox` block wherever
you want an exercise:

```yaml
---
title: "Version control with Git"
format: html
filters:
  - git-sandbox
---
```

`example.qmd` in this repository is an author's guide built with the extension itself:
working boxes, each paired with the block that produced it, from a tour
of the panels through branching, merging, pushing to a remote, the
optional commit tree and the optional VS Code view.
Render it to see everything working:

```bash
quarto render example.qmd
```

Requires Quarto 1.4 or later, and an HTML output format.

## Writing an exercise

````markdown
```git-sandbox
id: first-commit
title: Exercise 1 - your first commit
prompt: "~/sales-analysis $"
intro: |
  You have an empty project folder. Nothing is tracked yet.
  Type {y}help{/} to see the available commands.
hints: [git init, git status, git add ., 'git commit -m "First commit"']
seed: |
  git init
  echo "# Sales analysis" > README.md
  git add .
  git commit -m "Add the project README"
done-note: Edit, stage, commit - that loop is most of Git.
tasks:
  - text: Create a branch called `report`
    when: branch report
  - text: Commit something on it
    when: commits on report >= 2
  - text: Merge it back into `main`
    when: on main and merged report into main
```
````

### Options

| Option | What it does |
|---|---|
| `id` | HTML id for the exercise. Defaults to `git-sandbox-1`, `-2`, … Useful for linking. |
| `title` | Shown in the exercise header. Markdown allowed. |
| `prompt` | Shell prompt. The current branch is appended automatically. Default `~/project $`. |
| `intro` | Lines printed in the terminal when the exercise loads. Verbatim; no Markdown. |
| `hints` | Clickable buttons that fill the input. Give learners the commands they need. |
| `seed` | Commands run before the learner arrives, to set up a starting history. |
| `done-note` | Shown once every task is complete. Markdown allowed. |
| `tasks` | The checklist. Each needs a `text:` and a `when:`. |
| `tree-view` | The commit tree beside the box, drawn like [Learn Git Branching](https://learngitbranching.js.org/). `true` shows it, `false` leaves it out, and `toggle` (the default) puts a button in the header that opens it. |
| `editor` | `false` removes the Editor tab, leaving a terminal-only box. Default `true`. |
| `vscode` | `true` adds a VS Code tab: the real VS Code workbench on the box's repository; see [The VS Code view](#the-vs-code-view). Default `false`. |
| `panels` | The views below the terminal (File Status, Changes, History, Remote). `true` shows them, `false` leaves them out, and `toggle` (the default) shows them with a chevron that folds them away. |
| `share` | The `id` of another exercise whose repository this box is a view of: same files and history, its own title, tasks and layout. Takes no `seed`. |
| `script` | Commands to play back one at a time, for live demos; see [Scripted commands on slides](#scripted-commands-on-slides). |
| `panel-tabs` | Which of those views to offer, e.g. `[files, history]`. Any of `files`, `changes`, `history`, `remote`; all four by default. The first one listed opens first. |

Two notes on quoting, because both bite:

- `intro` is terminal output, not Markdown. Use `{y}…{/}` for yellow, `{g}`
  green, `{r}` red, `{b}` blue, `{w}` bold, and `{/}` to end. Backticks will
  appear literally.
- In flow sequences like `hints: [...]`, wrap any entry containing a double
  quote in single quotes: `'git commit -m "First commit"'`.

`seed` failures are loud. If a seed command fails, the exercise says so rather
than dropping the learner into a half-built repository.

### Scripted commands on slides

In a reveal.js presentation, `script` lists commands for the box to type
and run as you step through the slide. Each command takes two steps: the
first types it into the prompt, the second runs it. Stepping back undoes
both, restoring the repository exactly as it was.

````markdown
```git-sandbox
title: A scripted demo
script: |
  git init
  echo "# Notes" > notes.md
  git add notes.md
  git commit -m "Start the notes"
```
````

The steps are ordinary reveal.js fragments, so the arrow keys, the
clicker, the slide URL and arriving at the slide from the one after it all
work as they do for any fragment. A counter at the right of the prompt
shows `[2/4]`, the command in the prompt (or the last one run) out of
all of them. Hover it for the full list: click a command to jump to it,
running any before it that have not run, or **Skip** the one waiting in
the prompt to move on without running it. Pressing Enter on a typed
command runs it as the next step would.

You can still type into the box between steps. Outside a presentation the
list has a **Next** button that steps through the script instead.
Give `git commit` a `-m`: without one, the script waits in vim until
someone saves.

### Seeding a remote

Running `git remote add origin <url>` in a seed (or by the learner) creates
the mock remote and reveals the **Remote (origin)** panel. To stage the
classic "a colleague pushed while you were away" scenario, make the
colleague's commits, push them, then use the authoring-only `rewind <n>`
command to move the local branch back, so the commits now exist only on the
remote, ready to be discovered with `git fetch` and brought in with
`git pull`:

```yaml
seed: |
  git init
  git remote add origin https://github.com/acme/sales-analysis
  echo "# Sales analysis" > README.md
  git add .
  git commit -m "Add the project README"
  git push -u origin main
  echo "arima(sales)" > forecast.R
  git add .
  git commit -m "Add a first forecast model"
  git push
  rewind 1
```

In the Remote panel, the local half draws remote-tracking refs such as
`origin/main` dashed: they are your repository's record of where the
remote's branches were at the last `push`, `fetch` or `pull`. The remote half
draws the remote's branches as they are now, with a solid outline.

Pushing when the remote is ahead is rejected with git's real `(fetch first)`
message, so the push → rejected → pull → push loop can be taught honestly.

### Seeding a clone exercise

To have learners start with `git clone`, build the remote in the seed as
above, then delete the local copy with `rm -rf .git *`. The remote stays
(it is "on GitHub"), the project folder is empty, and the learner's
`git clone <url>` brings it back with `origin`, the remote-tracking
branches and an upstream for the default branch, as real git does. Any
spelling of the remote's URL works (`git@github.com:acme/sales.git` for
`https://github.com/acme/sales`); a different URL is refused with a hint
naming the right one.

```yaml
seed: |
  git init
  git remote add origin https://github.com/acme/sales-analysis
  echo "# Sales analysis" > README.md
  git add .
  git commit -m "Add the project README"
  git push -u origin main
  rm -rf .git *
tasks:
  - text: Clone the project with `git clone https://github.com/acme/sales-analysis`
    when: repo
```

Since the repository always lives in the project folder, `git clone <url>`
clones into it, as `git clone <url> .` would, and prints `Cloning into
'.'...`. The `remote` condition is true from the start in such an exercise,
because the remote exists before the clone; use `repo` to check for the
clone itself.

### The commit tree

The commit tree is a pane down the right of the box that draws the history
the way [Learn Git Branching](https://learngitbranching.js.org/) does. By
default (`tree-view: toggle`) it is closed, and a small graph button in the
box's header opens and closes it. `tree-view: true` shows it from the start
(and widens the box into the page margin to make room for it); `tree-view:
false` takes the pane and its button away.

```yaml
tree-view: true
```

- Commits are circles named `C0`, `C1`, … in the order they were made, so
  `C0` is the first commit. Each also shows its short hash, which matches
  `git log --oneline` because this is a real repository.
- The first commit is at the top and history grows downwards. Each commit
  hangs under its first parent, and a merge commit sits below both of its
  parents.
- Branches are labels pointing at their tips. `main*` marks the branch
  `HEAD` is on; a detached `HEAD` gets a label of its own, and
  remote-tracking refs such as `origin/main` are dashed.
- A commit takes the colour of the branch it was made on, and keeps it.
- Every change animates: a new commit grows out of its parent, labels
  glide to their new tips, and commits that `undo` takes back shrink away.
  `undo` also hands back the names it took, so the next commit reuses
  them. Readers who ask their system for reduced motion get the same
  changes without the animation.

In Quarto the exercise widens into the right margin (`column-page-right`)
to make room for the pane. When the box is narrower than 760 px, the pane
moves below it instead. With `GitSandboxUI.mount()` the option is
`treeView: true`.

### The VS Code view

`vscode: true` adds a **VS Code** tab beside Terminal and Editor. It opens
the real VS Code workbench
([monaco-vscode-api](https://github.com/CodinGame/monaco-vscode-api)),
cut down to what working with git needs: the explorer, editors and diffs,
search, the Source Control view and the integrated terminal. There are no
extensions, no marketplace and no debugger.

```yaml
vscode: true
```

It works on the box's own repository, and everything it does goes through
the box:

- **Source Control** lists Staged Changes, Changes and, during a merge,
  Merge Changes, with VS Code's usual buttons to stage, unstage, discard,
  open a file or its diff, and commit from the message box (Ctrl+Enter).
  Each click runs the git command it stands for (`git add load.R`,
  `git restore --staged load.R`, `git commit -m "…"`), which appears in
  the box's terminal and in VS Code's **Git** output channel. So tasks
  tick, **Undo** takes the click back, and the panels below keep up.
- The **...** menu has Pull, Push, Fetch, Checkout to..., Create Branch...
  and Merge...; the status bar shows the branch (click it to switch) and,
  with a remote, how far ahead and behind it is (click to sync).
- The **explorer** colours and letters changed files (`M`, `U`, `A`,
  `D`, `!`), and the editor's gutter marks changed lines.
- The **terminal** is the box's shell: the same commands, with history,
  Tab completion and a git-aware prompt. `git commit` without `-m` opens
  the message in an editor tab instead of vim, as with `core.editor` set
  to `code --wait`; the ✓ in its title bar commits.
- Saving, creating, renaming or deleting files in VS Code changes the
  working directory like any command, with an undo entry.

The workbench is several megabytes, so nothing of it loads until a learner
first opens the tab (about 3.4 MB compressed, cached after that). Quarto
only copies it next to pages that use `vscode: true`. The button beside
**Undo** lets it fill the window.

VS Code's services are global, so a page has one workbench: opening the
VS Code tab of another box moves it there and onto that box's repository.
Its explorer keeps the folder name of the box that opened it first.

It needs the page served over http(s), not opened as a file, and does not
survive `embed-resources: true`, which cannot inline files a page fetches
later. On reveal.js slides it is better left out: the pane is taller than
most slides.

## Conditions: the `when:` language

A task ticks when its condition becomes true, and stays ticked afterwards, so
you can check for states the learner passes through.

| Condition | True when |
|---|---|
| `repo` | `git init` has been run |
| `clean` | No uncommitted or untracked changes |
| `staged` | Something is in the staging area |
| `commits >= 3` | At least three commits exist. `>`, `<`, `<=`, `==` and `=` also work; a bare number means `>=` |
| `commits on report >= 2` | Two commits are reachable from the `report` branch |
| `branch report` | A branch called `report` exists |
| `on main` | `HEAD` is on `main` |
| `detached` | `HEAD` points at a commit rather than a branch, after `git checkout <commit>` |
| `merged report into main` | A `git merge` (or `git pull`) has actually brought `report` into `main`, and its result is still in `main`'s history. Both fast-forward and merge-commit merges count; creating `report` from `main`'s tip does not, and neither does a merge that reports "Already up to date" |
| `merge commit` | Some commit has two parents |
| `merging` | A merge stopped on conflicts and has not been committed or aborted yet |
| `conflicts` | Some files still have unresolved conflicts (not yet marked with `git add`) |
| `file report.qmd` | That file exists in the working directory |
| `file report.qmd contains "Q3"` | It exists and contains that text. `/regex/` works too |
| `ran /git\s+status/` | The learner ran a matching command. Plain text matches as a substring |
| `remote` | A remote has been configured with `git remote add origin` |
| `pushed` | Every commit on the current branch is on the remote |

Combine with `and`, `or`, `not` and parentheses. `and` binds tighter than `or`.

```yaml
when: on main and merged report into main
when: not branch forecast and ran /git\s+branch\s+-[dD]/
when: (staged or commits >= 1) and file README.md
```

**Prefer state over `ran`.** `commits >= 1` is true however the learner got
there; `ran "git commit"` breaks the moment someone uses a different flag. Use
`ran` only when running a specific command *is* the point, such as checking
`git status`.

### Errors are visible

A condition that cannot be read shows the problem in place, next to the task,
naming what it expected. Bad block options produce a visible error box instead
of a silently missing exercise. You should never have to open the console to
find out why an exercise is not working.

### The `js:` escape hatch

For anything the language cannot express, use `js:` instead of `when:`. It
receives a context object `c`:

```yaml
tasks:
  - text: Write a commit message longer than ten characters
    js: c.graph.commits.some(x => x.message.length > 10)
```

| Field | Contents |
|---|---|
| `c.isRepo` | Boolean |
| `c.graph.commits` | `[{ oid, short, message, parents, refs, lane, timestamp, author }]`, children first |
| `c.graph.branches` | `[{ name, oid, isHead }]` |
| `c.graph.head` | Current branch name |
| `c.status` | `{ staged, modified, untracked, deleted, stagedDeleted, ignored }` |
| `c.files` | Filenames in the working directory |
| `c.history` | Every command typed, in order |
| `c.remote` | `null`, or `{ url, branch, tracked, ahead, behind, graph }` once a remote exists |
| `c.sb` | The sandbox, for `await c.sb.readFile('notes.txt')` |

`js:` uses `new Function`, so it needs `'unsafe-eval'` in your Content Security
Policy. `when:` does not, which is another reason to prefer it.

## What the sandbox supports

**Git:** `init`, `status [--ignored]`, `add [-f]`, `rm [--cached] [-r]`,
`check-ignore`, `commit [-a] [-m]`, `restore [--staged] [--source=<commit>]
<file>`, `reset [<file>]`, `reset [--soft|--mixed|--hard] [<commit>]`, `log [--oneline] [--all] [-<n>] [<branch|origin/branch|commit>]`,
`diff`, `branch [-d] [-a|-r] [<name> [<start>]]`,
`branch --set-upstream-to=origin/<branch>`, `checkout [-b] <branch>
[<start>]`, `checkout --track origin/<branch>`, `checkout <commit>`,
`switch [-c] <branch>`, `switch --detach <commit>`, `switch -`,
`merge <branch | origin/branch | commit>`, `remote [-v] | remote add origin
<url> | remove origin`, `clone <url>`, `push [-u origin <branch>]`, `fetch`,
`pull [origin <branch>]`, `config [--global] <key> [<value>]` (also `--list` and
`--unset`), and `-h` on any of them, as in `git commit -h`

**Shell:** `ls [-a] [dir]`, `cat`, `echo "…" > file`, `echo "…" >> file`,
`touch`, `rm [-rf]`, `mkdir`, `cd`, `pwd`, `whoami`, plus `help`, `clear`, `reset`,
`undo`, and the authoring-only `rewind <n>`

**`.gitignore`:** works as in real git, in the top folder and in
subfolders. Ignored files drop out of `git status` and `git add .`, naming
one in `git add` is refused with git's own hint to use `-f`, and `git status
--ignored` lists them. Files that were tracked before the rule was written
stay tracked until `git rm --cached <file>`, which takes them out of git but
leaves them on disk. In the panels an ignored file shows as a grey
"ignored" chip, and with a dim `I` in the editor's file browser. There is no
global `.gitignore`: the sandbox has no home folder to keep one in.

**Redirection:** `>` and `>>` work after any command, not only `echo`, so
`git init -h > library.txt` or `git log --oneline > history.txt` write the
output to a file. Errors still show in the terminal.

**Config:** `git config` with or without `--global` stores any key.
`user.name` and `user.email` sign the commits, and `init.defaultBranch`
names the branch `git init` creates; other keys are kept and read back but
change nothing (vim stays the editor, and `pull` always merges).

**Globs:** an unquoted `*`, `?` or `[…]` expands to the matching file
names before the command runs, as in bash, so `git add *.txt` stages the
`.txt` files in the current folder and `ls data/*.csv` lists the CSVs in
`data`. A pattern that matches nothing is passed on as typed. Quoted, the
pattern reaches git as a pathspec, where `*` also crosses folders: `git add
"*.txt"` stages every `.txt` file from here down, as real git does.

`cd` moves around inside the project folder, and the prompt shows where you
are. Relative paths in shell and git commands resolve from there, and
`git add .` stages only the current folder and below, as in real git. `cd`,
`cd ~` and `cd ~/path` are measured from the project's top folder, `cd -`
goes back to the previous folder, and nothing outside the project can be
reached. The repository always lives at the top, so `git init` must run there.

The remote is a bare repository elsewhere in the same in-memory filesystem.
Push and fetch move objects and refs between the two repositories with real
semantics: the first push needs `-u origin <branch>`, `origin/*` tracking
refs appear in the local graph after a fetch, and a non-fast-forward push is
rejected with `(fetch first)`. Upstreams live in `.git/config` as in git:
`git status` and `git checkout` then say whether the branch is ahead of,
behind, or diverged from `origin/<branch>` (as of the last fetch), and a
plain `git pull` on a branch without one fails with git's "no tracking
information" message. `git switch <branch>` (or `checkout`) for a branch
that exists only as `origin/<branch>` creates it, tracking the remote one,
as `git checkout --track origin/<branch>` does.

**vim:** `git commit` without `-m` does what real git usually does: it
drops you into vim on the commit message, in normal mode, where typing does
nothing useful. That is deliberate, so learners meet the famous "how do I
get out of vim" moment somewhere safe. Press `i` to type, `Esc` to stop,
then `:wq` (or `ZZ`) to save and commit, or `:q!` (or `ZQ`) to give up,
which aborts the commit. Lines starting with `#` are dropped, as in git.
`:q` refuses to leave unsaved changes, and Ctrl+C prints vim's own hint.
Seeds must still use `-m`: a seed that opens vim is reported as an error.

**Editor:** tabs in the exercise's title bar switch between the
**Terminal** and an **Editor** tab. The editor's file browser is a
collapsible tree of the working directory that follows `cd` (with
`U`/`M`/`A` git status letters), can step up to the folders above it with
the working directory labelled `WD`, and has a switch to show
hidden files, `.git` included (read-only). It opens any file, creates new
ones with `+`, and saves with the Save button or Ctrl/Cmd+S. Edits stay unsaved
drafts until then, so they reach `git status` only once saved; each save can
be undone like a command.

Up arrow recalls previous commands. **Undo** (the button, or typing `undo`)
takes back the last state-changing command as if it was never typed: repo,
checklist, history and terminal all rewind together, up to 20 steps. Like
`rewind`, it is a sandbox affordance, not a git command; it exists so a
wrong turn costs one keystroke instead of a restart. **Reset** returns the
exercise to its seeded state and clears the undo history.

## What it does not do, on purpose

- **No network remotes.** The remote is a mock that lives in the page:
  `git clone` copies that mock, and nothing talks to a real server. isomorphic-git can talk
  to GitHub through a CORS proxy, which is a real but separate piece of work.
- **No three-way merge tool.** A conflicting `merge` or `pull` behaves as in
  real git: it writes `<<<<<<<` / `=======` / `>>>>>>>` markers into the
  files, stages everything that merged cleanly, and stops. The learner edits
  the files (in the Editor tab, or with `echo`), marks them resolved with
  `git add`, and concludes with `git commit`; `git merge --abort` gives up.
  What it does not offer is a side-by-side merge editor.
- **No `rebase`, `stash`, `cherry-pick` or `revert`.** These
  could be added to the engine in
  `_extensions/git-sandbox/resources/sandbox-core.js`.

## Using it outside Quarto

`example-embed.html` is a plain HTML page with no Quarto and no build step:
copy the files from `_extensions/git-sandbox/resources/`, load the scripts
in the order the page does, add a container, and call `GitSandboxUI.mount()`
with the same options in JavaScript. Open it as `example-embed.html?record`
for a fixed-size frame suited to screen recordings.
Useful when a platform will take an HTML block or an iframe but not a Quarto
document.

For the VS Code view, also load `sandbox-vscode.js` and keep the `vscode/`
folder beside it; then pass `vscode: true` to `mount()`. The loader looks
for `vscode/workbench.js` next to itself; set
`window.GitSandboxVSCodeBase` to a URL ending in `/` to serve it from
elsewhere.

## Notes for platform and LMS embedding

- **Page weight.** The Git engine is 260 KB (80 KB gzipped) and loads after the
  body, so it never blocks first paint. The optional VS Code view adds a
  2 KB loader; its 3.4 MB (compressed) workbench is fetched only when a
  learner opens the tab. With `embed-resources: true` a lesson
  becomes a single self-contained file of roughly 2 MB, much of it embedded
  fonts. It is worth dropping the font `<link>` if your platform already serves Open
  Sans and Source Code Pro.
- **Content Security Policy.** `embed-resources: true` inlines scripts as
  `data:` URIs, so `script-src` needs `data:`. Without `embed-resources` the
  assets are ordinary files and no CSP exception is needed. Avoid `js:` if
  `'unsafe-eval'` is not available.
- **Non-HTML formats.** In PDF, Word and Markdown output, each exercise becomes
  a note that it is interactive plus a list of its tasks, rather than a hole.
- **Accessibility.** Terminal output is an `aria-live="polite"` region, the
  input is labelled, and every text/background pair meets WCAG AA. Status is
  never conveyed by colour alone.

## Development

```bash
npm install          # dev dependencies only; the extension itself needs none
./tests/run.sh       # all ten suites
./build.sh           # only to re-bundle isomorphic-git
(cd vscode && npm install && npm run build)   # only to rebuild the VS Code view
```

The sandbox's scripts in `_extensions/git-sandbox/resources/` are the
source: edit them directly, there is nothing to rebuild. The VS Code view
is the exception: its source is in `vscode/src/`, and
`resources/vscode/` is built from it. See `CONTRIBUTING.md`.

## Credits

quarto-git-sandbox was created by
[Ryan Johnson (@ryjohnson09)](https://github.com/ryjohnson09). The original
repository is
[ryjohnson09/quarto-git-sandbox](https://github.com/ryjohnson09/quarto-git-sandbox);
this fork is developed separately from it.

## Licence

MIT; see `LICENSE`. Bundled third-party software is listed in
`THIRD_PARTY_NOTICES.md`.

`_extensions/git-sandbox/resources/isomorphic-git.bundle.js` bundles
[isomorphic-git](https://isomorphic-git.org) and
[buffer](https://github.com/feross/buffer), both MIT. The bundle header records
both licences and the command that regenerates it.

The polyfill is not optional: isomorphic-git's index code calls a global
`Buffer`, which browsers do not provide, so a bare CDN copy of isomorphic-git
fails at the first `git add`.
