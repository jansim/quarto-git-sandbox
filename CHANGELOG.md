# Changelog

## Unreleased

- `git checkout <commit>` (and `git switch --detach <commit>`) moves HEAD
  to a commit instead of a branch. A commit can be named by its hash, full
  or abbreviated, or as `HEAD~2`, `main^` and the like. The learner sees
  git's own "detached HEAD" note; `git status`, `git branch` and `git log`
  show the detached HEAD; commits made there print `[detached HEAD …]`;
  and switching back to a branch warns about any commits that would be
  left behind, naming them. `git switch <commit>` without `--detach` is
  refused with git's hint. A new `when: detached` condition checks for it.
- `git checkout` and `git switch` refuse to move HEAD when uncommitted
  changes would be overwritten, as git does, instead of silently
  discarding them.
- The File Status animations are paced to be followed. `git add` eases files
  across instead of snapping them over, and the files left behind close the
  gap afterwards. On `git commit` the staged files morph together into one
  commit node, drawn like the commits in the graph, which glides into the
  repository; the new commit count fades in as it lands.
- The demo gains a second page, `example-revealjs.qmd`: a reveal.js deck
  with a box on one slide and another view of the same repository on a
  later slide. The demo site publishes it next to the guide.
- Boxes now work inside reveal.js. The panels below the terminal were
  `<section>` elements, which reveal.js took for slides of their own (and
  then threw on); they are `<div>`s now. On a slide, the box also resets
  the list and font styles reveal.js applies, and fills the rest of its
  slide at a fixed height: the terminal takes up the slack and the views
  below get a fixed, scrolling area, so `git add` or `git commit` no longer
  make the box grow, shrink or jump.
- The guide (`example.qmd`) links to the repository and the deck, and only
  its first box keeps `hints`, so the rest no longer give the answers away.
- New `share: <id>` option: a box can be another view of an earlier
  exercise's repository, with its own title, tasks, terminal and layout but
  the same files and history. Work in either view shows up in both, so a
  lesson (or a later reveal.js slide) can come back to a repository without
  starting over. The shared repository is seeded by the exercise it
  belongs to; Reset in any view starts it over, and Undo takes back the
  latest change only from the view that made it. A `share` naming no
  exercise is reported when rendering.
- More of the box can be configured per exercise:
  - `tree-view` now takes `true`, `false` or `toggle`, and `toggle` is the
    new default: every box gets a small commit-graph button in its header
    that opens and closes the commit tree. `true` shows it from the start,
    as before; `false` removes it and its button.
  - `panels: true | false | toggle` does the same for the views below the
    terminal. With `toggle` (the default) a chevron at the end of the tab
    row folds them away, leaving the tabs and their badges; clicking a tab
    unfolds them. `false` leaves them out.
  - `panel-tabs: [files, changes, history, remote]` picks which of those
    views an exercise offers; the first listed opens first.
  - `editor: false` removes the Editor tab for a terminal-only box.
- Each commit in the **History** graph has a chevron at the end of its row
  that opens the commit's contents underneath it, as `git show` would: the
  full hash, author, date and message, and every file it added, changed or
  deleted with a line diff. Merge commits are compared with their first
  parent, so they show what the merge brought in. Several commits can be
  open at once, they stay open as the learner keeps working, and the
  chevrons are keyboard buttons. The sandbox API gains `commitDetails(oid)`.
- `git commit` no longer switches the panels below the terminal to
  **History**; it stays on **File Status**, where the commit can now be
  seen happening. The File Status view animates: `git add` glides a file's
  chip from the working directory into the staging area, `git commit`
  flies the staged chips into the repository, and other chips slide or
  fade into their new places. The motion is skipped for readers who ask
  for reduced motion.
- Merge conflicts now behave as in real git instead of failing with an
  error. A conflicting `git merge` or `git pull` writes conflict markers into
  the files, stages what merged cleanly, and stops with `CONFLICT (content):
  Merge conflict in …`. `git status` lists the unmerged paths, the prompt
  reads `(main|MERGING)`, and the File Status view outlines conflicted files.
  `git add` (or `git rm`) marks a file resolved, `git commit` (with or
  without `-m`) concludes the merge with a two-parent commit, and `git merge
  --abort` returns to the last commit. Committing, merging, pulling or
  switching branches with unresolved files is refused as real git refuses
  it. Undo takes back a conflicting merge like any other command.
- New `when:` conditions `merging` and `conflicts`, and seeds may end on a
  conflicting merge so an exercise can start mid-conflict.
- `git commit` without `-m` now opens a small vim in the terminal pane, on a
  commit message template like real git's, instead of refusing. It starts in
  normal mode; `i`/`a`/`o` and friends start typing, `Esc` stops, and `:wq`,
  `:x` or `ZZ` save and commit, while `:q!` or `ZQ` abort. `:q` with unsaved
  changes gives `E37`, and Ctrl+C prints vim's "Type :qa! …" hint. `help`
  says how to get out. `git commit -m ""` still aborts, and `git commit` with
  nothing staged now says "nothing to commit" as git does.
- New `tree-view: true` block option (off by default) that adds a
  **commit tree** pane to the right of the box, drawn in the style of
  [Learn Git Branching](https://learngitbranching.js.org/). Commits are
  named `C0`, `C1`, … in the order they were made, each with its short
  hash; the first commit is at the top; branches are labels pointing at
  their tips, with `*` on the checked-out one. Changes animate: new commits
  grow out of their parent, branch labels glide to their new tips, and
  commits taken back by `undo` shrink away. The exercise widens into the
  right margin in Quarto, and the pane drops below the box when the box is
  narrow.
- The History graph now matches the commit tree's look: commits are
  outlined in their lane colour over a pale tint of it, and branch labels
  are tinted boxes outlined in the branch colour (bold for `HEAD`, dashed
  grey for remote-tracking refs) instead of solid pills.
- New `cd` command for moving between folders inside the project. The prompt
  shows the current folder, relative paths in shell and git commands resolve
  from it, and `git add .` stages only that folder and below. `cd`, `cd ~`
  and `cd ~/path` start from the project's top folder, and `cd -` goes back
  to the previous one. Leaving the project is refused with a message saying
  why.
- `ls` accepts a folder to list, e.g. `ls src`.
- The exercise title bar now carries two tabs, **Terminal** and **Editor**,
  that open onto the dark pane below; the title moves aside to make room
  (and onto its own row above the tabs on narrow screens). The Editor tab is a file browser plus a text editor over
  the same working directory the terminal sees, so learners can edit a file
  properly instead of only through `echo "…" > file`.
- The tabs are part of the title bar's chrome: full bar height, flush left,
  in the same uppercase mono as the title and the Undo/Reset buttons.
- The file browser is a tree headed by the working directory's name. Folders
  (empty ones too) collapse and expand with a chevron; a dot marks folders
  with changes inside, and files carry their git status letter (`U`
  untracked, `M` modified, `A` staged).
- The browser is rooted at the working directory and follows `cd`. An up
  arrow walks to its parent folders, through the project and then the
  folders of the prompt path above it (e.g. `~/demo-project` to `~`); the
  working directory stays in view labelled `WD`, and a home button comes
  back.
- A "Show hidden files" switch at the foot of the sidebar reveals dotfiles
  and `.git`. Files inside `.git` open read-only, and binary ones (git's
  compressed objects) say so instead of showing noise.
- The `+` button creates files named from the working directory, as
  `touch` would, also in new folders (`data/notes.md`).
- The sandbox's file API (`readFile`, `writeFile`, `readBytes`) takes paths
  from the project's top folder rather than the shell's current folder, so
  the editor and `file x contains "y"` conditions mean the same file after a
  `cd`. `cwdPath()` reports the current folder relative to the project.
- Edits are drafts until saved (Save button or Ctrl/Cmd+S), so nothing shows
  up in `git status` before the learner means it to. Drafts survive switching
  files, and an unsaved dot on the file and on the Editor tab says so.
- A save is a state change like any command: it re-runs the task checks and
  can be taken back with Undo. Changes made from the terminal (an `echo`, a
  `git checkout`) reload in the editor unless it holds an unsaved draft.

## 1.1.0

A layout rework so complex exercises stay one screen tall instead of a long
scroll. No information was removed — panels folded behind tabs keep a live
summary badge.

- The four visualisation panels (Files, Changes, History, Remote) are now
  tabs showing one panel at a time. Each tab carries a live badge: a count
  means something is there, a green check means clean or in sync.
- The active tab follows the last command — `git add` shows Files,
  `git commit` shows History, `git push` shows Remote — matching where a
  learner would look next. Clicking a tab holds it until the next command
  with an opinion.
- The task checklist moved from the bottom of the box to directly under the
  terminal, so progress is visible while typing. A just-completed task
  briefly flashes green.
- Long diffs and deep commit graphs scroll inside their panel instead of
  stretching the whole box.
- The Remote tab only exists once `git remote add origin` has run, and all
  panels print expanded (tabs are a screen affordance).
- New `undo` command (and an Undo button next to Reset): takes back the last
  state-changing command as if it was never typed. Repository, task ticks,
  command history and terminal all rewind together, up to 20 steps deep.
  Read-only commands are skipped, so undo never appears to do nothing.
  Reset clears the undo history. Like `rewind`, undo is a sandbox
  affordance, not a git command.

## 1.0.2

- `merged X into Y` now requires a merge to have actually happened. It was an
  ancestry check, which is trivially true the moment X is branched off Y's tip,
  so "merge X into Y" tasks checked off before any merge occurred. The sandbox
  now records ref-moving merges (`git merge` and `git pull`, fast-forward or
  merge commit; not "Already up to date"), and the condition requires one, plus
  the merge result still being in Y's history. Compound guards like
  `merged X into Y and commits on X >= N` are no longer needed.
- `merged X into Y` also stays true after the merged branch is deleted.
- The `GitSandboxUI.isMerged(graph, name, into)` helper follows the same
  semantics, using the new `graph.merges` record.

## 1.0.1

- Reset now clears the command history, so tasks checked with `ran "..."`
  no longer re-complete themselves immediately after a reset.
- Reset also clears any text left in the terminal input.
- Typing `reset` as a command no longer leaves the word `reset` itself in
  the freshly cleared history.

## 1.0.0

First release.

- A `git-sandbox` code block that renders a real Git repository in the browser,
  running isomorphic-git against an in-memory filesystem.
- A terminal supporting `init`, `status`, `add`, `rm`, `commit`, `log`, `diff`,
  `branch`, `checkout`, `switch`, `merge` and `config`, plus enough shell
  (`ls`, `cat`, `echo >`, `touch`, `rm`, `mkdir`, `pwd`) to create something to
  commit.
- A working-directory/staging/repository diagram and a lane-assigned commit
  graph, both updating after every command.
- Declarative task conditions via `when:`, so lessons need no JavaScript, with a
  `js:` escape hatch for the rest.
- Author-facing error reporting: unreadable options render a visible error box,
  unreadable conditions are flagged next to the task they belong to.
- A static fallback for non-HTML formats.
- `example.qmd`, a three-exercise lesson on committing, branching and merging.
