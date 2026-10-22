/* =====================================================================
   git-sandbox.js — a real git repository that lives entirely in the page.

   Runs isomorphic-git (MIT) against an in-memory filesystem, and renders a
   terminal, a working-directory/staging/repository diagram, and a live commit
   graph. Nothing is sent to a server; nothing is written to disk.

   GENERATED FILE — do not edit. Built from src/ by ./build.sh.
   ===================================================================== */

/* ------------------------------------------------------------------
   git sandbox core: in-memory fs + shell/git command engine + graph model
   No DOM. Works in Node (for tests) and in the browser.
   Requires a global `git` (isomorphic-git UMD).
   ------------------------------------------------------------------ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GitSandboxCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------- memory fs ---------------------------- */

  function createMemFS() {
    var store = new Map();
    var enc = new TextEncoder();
    var dec = new TextDecoder();
    var inode = 1;

    function norm(p) {
      p = String(p).replace(/\\/g, '/');
      if (p.charAt(0) !== '/') p = '/' + p;
      var parts = [];
      p.split('/').forEach(function (seg) {
        if (seg === '' || seg === '.') return;
        if (seg === '..') { parts.pop(); return; }
        parts.push(seg);
      });
      return '/' + parts.join('/');
    }
    function dirname(p) {
      p = norm(p);
      if (p === '/') return '/';
      var i = p.lastIndexOf('/');
      return i <= 0 ? '/' : p.slice(0, i);
    }
    function basename(p) {
      p = norm(p);
      return p.slice(p.lastIndexOf('/') + 1);
    }
    function mkErr(code, path) {
      var msgs = {
        ENOENT: 'no such file or directory',
        EEXIST: 'file already exists',
        ENOTDIR: 'not a directory',
        EISDIR: 'illegal operation on a directory',
        ENOTEMPTY: 'directory not empty',
        EINVAL: 'invalid argument'
      };
      var e = new Error(code + ': ' + (msgs[code] || code) + ", '" + path + "'");
      e.code = code;
      e.path = path;
      e.errno = -1;
      return e;
    }
    function statObj(node) {
      var isDir = node.type === 'dir';
      var isLink = node.type === 'symlink';
      return {
        type: node.type,
        mode: node.mode,
        size: isDir ? 0 : (node.content ? node.content.length : 0),
        ino: node.ino,
        mtimeMs: node.mtimeMs,
        ctimeMs: node.mtimeMs,
        uid: 1, gid: 1, dev: 1,
        isFile: function () { return node.type === 'file'; },
        isDirectory: function () { return isDir; },
        isSymbolicLink: function () { return isLink; }
      };
    }
    function get(p) { return store.get(norm(p)); }
    function requireParentDir(p) {
      var d = dirname(p);
      var pn = store.get(d);
      if (!pn) throw mkErr('ENOENT', p);
      if (pn.type !== 'dir') throw mkErr('ENOTDIR', p);
    }

    store.set('/', { type: 'dir', mode: 16877, mtimeMs: Date.now(), ino: inode++ });

    var promises = {
      readFile: function (p, opts) {
        return Promise.resolve().then(function () {
          var n = get(p);
          if (!n) throw mkErr('ENOENT', p);
          if (n.type === 'dir') throw mkErr('EISDIR', p);
          var encoding = typeof opts === 'string' ? opts : (opts && opts.encoding);
          return encoding ? dec.decode(n.content) : n.content.slice();
        });
      },
      writeFile: function (p, data, opts) {
        return Promise.resolve().then(function () {
          requireParentDir(p);
          var bytes = typeof data === 'string' ? enc.encode(data)
            : (data instanceof Uint8Array ? new Uint8Array(data) : enc.encode(String(data)));
          var mode = (opts && typeof opts === 'object' && opts.mode) || 33188;
          var existing = get(p);
          store.set(norm(p), {
            type: 'file', content: bytes, mode: existing ? existing.mode : mode,
            mtimeMs: Date.now(), ino: existing ? existing.ino : inode++
          });
        });
      },
      unlink: function (p) {
        return Promise.resolve().then(function () {
          var n = get(p);
          if (!n) throw mkErr('ENOENT', p);
          if (n.type === 'dir') throw mkErr('EISDIR', p);
          store.delete(norm(p));
        });
      },
      readdir: function (p) {
        return Promise.resolve().then(function () {
          var d = norm(p);
          var n = store.get(d);
          if (!n) throw mkErr('ENOENT', p);
          if (n.type !== 'dir') throw mkErr('ENOTDIR', p);
          var prefix = d === '/' ? '/' : d + '/';
          var out = [];
          store.forEach(function (_v, k) {
            if (k === d || k.indexOf(prefix) !== 0) return;
            var rest = k.slice(prefix.length);
            if (rest.indexOf('/') === -1 && rest !== '') out.push(rest);
          });
          return out.sort();
        });
      },
      mkdir: function (p, opts) {
        return Promise.resolve().then(function () {
          var d = norm(p);
          if (store.has(d)) {
            if (opts && opts.recursive) return;
            throw mkErr('EEXIST', p);
          }
          if (opts && opts.recursive) {
            var parts = d.split('/').filter(Boolean);
            var cur = '';
            parts.forEach(function (seg) {
              cur += '/' + seg;
              if (!store.has(cur)) store.set(cur, { type: 'dir', mode: 16877, mtimeMs: Date.now(), ino: inode++ });
            });
            return;
          }
          requireParentDir(d);
          store.set(d, { type: 'dir', mode: 16877, mtimeMs: Date.now(), ino: inode++ });
        });
      },
      rmdir: function (p) {
        return Promise.resolve().then(function () {
          var d = norm(p);
          var n = store.get(d);
          if (!n) throw mkErr('ENOENT', p);
          if (n.type !== 'dir') throw mkErr('ENOTDIR', p);
          var prefix = d === '/' ? '/' : d + '/';
          var empty = true;
          store.forEach(function (_v, k) { if (k !== d && k.indexOf(prefix) === 0) empty = false; });
          if (!empty) throw mkErr('ENOTEMPTY', p);
          store.delete(d);
        });
      },
      stat: function (p) {
        return Promise.resolve().then(function () {
          var n = get(p);
          if (!n) throw mkErr('ENOENT', p);
          return statObj(n);
        });
      },
      lstat: function (p) { return promises.stat(p); },
      readlink: function (p) {
        return Promise.resolve().then(function () {
          var n = get(p);
          if (!n || n.type !== 'symlink') throw mkErr('EINVAL', p);
          return n.target;
        });
      },
      symlink: function (target, p) {
        return Promise.resolve().then(function () {
          requireParentDir(p);
          store.set(norm(p), { type: 'symlink', target: target, mode: 41453, mtimeMs: Date.now(), ino: inode++ });
        });
      },
      chmod: function (p, mode) {
        return Promise.resolve().then(function () {
          var n = get(p);
          if (!n) throw mkErr('ENOENT', p);
          n.mode = mode;
        });
      },
      rm: function (p, opts) {
        return Promise.resolve().then(function () {
          var d = norm(p);
          var n = store.get(d);
          if (!n) {
            if (opts && opts.force) return;
            throw mkErr('ENOENT', p);
          }
          if (n.type === 'dir' && opts && opts.recursive) {
            var prefix = d === '/' ? '/' : d + '/';
            var kill = [];
            store.forEach(function (_v, k) { if (k === d || k.indexOf(prefix) === 0) kill.push(k); });
            kill.forEach(function (k) { store.delete(k); });
            return;
          }
          if (n.type === 'dir') throw mkErr('EISDIR', p);
          store.delete(d);
        });
      }
    };

    return {
      promises: promises,
      _store: store,
      _norm: norm,
      _dirname: dirname,
      _basename: basename
    };
  }

  /* --------------------------- tokenizing --------------------------- */

  // Split a command line into words, honouring single/double quotes, and
  // pull out redirection operators (> and >>). Each word is { text, glob }:
  // glob is true when it holds an unquoted *, ? or [, which the shell
  // expands into matching file names, as bash does.
  function tokenizeWords(line) {
    var words = [];
    var cur = '';
    var has = false;
    var glob = false;
    var quote = null;
    function push() { words.push({ text: cur, glob: glob }); cur = ''; has = false; glob = false; }
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (quote) {
        if (ch === quote) { quote = null; }
        else if (ch === '\\' && quote === '"' && i + 1 < line.length) { cur += line[++i]; has = true; }
        else { cur += ch; has = true; }
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; has = true; continue; }
      if (ch === ' ' || ch === '\t') {
        if (has) push();
        continue;
      }
      if (ch === '>' ) {
        if (has) push();
        if (line[i + 1] === '>') { words.push({ text: '>>', glob: false }); i++; } else { words.push({ text: '>', glob: false }); }
        continue;
      }
      if (ch === '*' || ch === '?' || ch === '[') glob = true;
      cur += ch; has = true;
    }
    if (has) push();
    if (quote) throw new Error('unmatched quote');
    return words;
  }

  function tokenize(line) {
    return tokenizeWords(line).map(function (w) { return w.text; });
  }

  function hasGlob(s) { return /[*?[]/.test(s); }

  // A glob as a regular expression. In the shell (`pathSep` true) * and ?
  // stop at a slash; in a git pathspec they do not, so `git add '*.txt'`
  // also stages notes/b.txt, as real git does.
  function globRegex(pattern, pathSep) {
    var any = pathSep ? '[^/]' : '.';
    var re = '';
    for (var i = 0; i < pattern.length; i++) {
      var ch = pattern[i];
      if (ch === '*') re += any + '*';
      else if (ch === '?') re += any;
      else if (ch === '[') {
        var end = pattern.indexOf(']', i + 2);
        if (end === -1) { re += '\\['; continue; }
        var set = pattern.slice(i + 1, end);
        if (set.charAt(0) === '!') set = '^' + set.slice(1);
        re += '[' + set.replace(/\\/g, '\\\\') + ']';
        i = end;
      } else re += ch.replace(/[.+^${}()|\\\]]/g, '\\$&');
    }
    return new RegExp('^' + re + '$');
  }

  function splitRedirect(tokens) {
    var out = { args: [], redirect: null, target: null };
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i] === '>' || tokens[i] === '>>') {
        out.redirect = tokens[i];
        out.target = tokens[i + 1] || null;
        i++;
        continue;
      }
      out.args.push(tokens[i]);
    }
    return out;
  }

  /* ------------------------------ -h help ---------------------------- */

  // What `git <command> -h` prints. The usage lines are git's own (as of
  // git 2.55; tests/test-realgit.js checks them against the git it finds); the
  // options are only those this sandbox understands, laid out the way
  // git lays out its option lists, so what a learner copies into their
  // notes is both real and something they can try here.
  function opt(flags, desc) {
    var pad = '    ' + flags;
    return pad.length < 26 ? pad + new Array(27 - pad.length).join(' ') + desc
      : pad + '\n' + new Array(27).join(' ') + desc;
  }

  var HELP = {
    init: ['usage: git init [-q | --quiet] [--bare] [--template=<template-directory>]',
      '                [--separate-git-dir <git-dir>] [--object-format=<format>]',
      '                [--ref-format=<format>]',
      '                [-b <branch-name> | --initial-branch=<branch-name>]',
      '                [--shared[=<permissions>]] [<directory>]', '',
      opt('-b, --initial-branch <name>', 'override the name of the initial branch')],
    status: ['usage: git status [<options>] [--] [<pathspec>...]', '',
      opt('--ignored', 'show ignored files')],
    add: ['usage: git add [<options>] [--] <pathspec>...', '',
      opt('-f, --force', 'allow adding otherwise ignored files'),
      opt('-A, --all', 'add changes from all tracked and untracked files')],
    commit: ['usage: git commit [-a | --interactive | --patch] [-s] [-v] [-u[<mode>]] [--amend]',
      '                  [--dry-run] [(-c | -C | --squash) <commit> | --fixup [(amend|reword):]<commit>]',
      '                  [-F <file> | -m <msg>] [--reset-author] [--allow-empty]',
      '                  [--allow-empty-message] [--no-verify] [-e] [--author=<author>]',
      '                  [--date=<date>] [--cleanup=<mode>] [--[no-]status]',
      '                  [-i | -o] [--pathspec-from-file=<file> [--pathspec-file-nul]]',
      '                  [(--trailer <token>[(=|:)<value>])...] [-S[<keyid>]]',
      '                  [--] [<pathspec>...]', '',
      'Commit message options',
      opt('-m, --message <message>', 'commit message'), '',
      'Commit contents options',
      opt('-a, --all', 'commit all changed files')],
    rm: ['usage: git rm [-f | --force] [-n] [-r] [--cached] [--ignore-unmatch]',
      '              [--quiet] [--pathspec-from-file=<file> [--pathspec-file-nul]]',
      '              [--] [<pathspec>...]', '',
      opt('--cached', 'only remove from the index'),
      opt('-r', 'allow recursive removal')],
    restore: ['usage: git restore [<options>] [--source=<branch>] <file>...', '',
      opt('-s, --source <tree-ish>', 'which tree-ish to checkout from'),
      opt('-S, --staged', 'restore the index'),
      opt('-W, --worktree', 'restore the working tree (default)')],
    reset: ['usage: git reset [--mixed | --soft | --hard | --merge | --keep] [-q] [<commit>]',
      '   or: git reset [-q] [<tree-ish>] [--] <pathspec>...',
      '   or: git reset [-q] [--pathspec-from-file [--pathspec-file-nul]] [<tree-ish>]',
      '   or: git reset --patch [<tree-ish>] [--] [<pathspec>...]', '',
      opt('--mixed', 'reset HEAD and index'),
      opt('--soft', 'reset only HEAD'),
      opt('--hard', 'reset HEAD, index and working tree')],
    log: ['usage: git log [<options>] [<revision-range>] [[--] <path>...]',
      '   or: git show [<options>] <object>...', '',
      opt('--oneline', 'show each commit on a single line')],
    diff: ['usage: git diff [<options>] [<commit>] [--] [<path>...]',
      '   or: git diff [<options>] --cached [--merge-base] [<commit>] [--] [<path>...]',
      '   or: git diff [<options>] [--merge-base] <commit> [<commit>...] <commit> [--] [<path>...]',
      '   or: git diff [<options>] <commit>...<commit> [--] [<path>...]',
      '   or: git diff [<options>] <blob> <blob>',
      '   or: git diff [<options>] --no-index [--] <path> <path> [<pathspec>...]'],
    branch: ['usage: git branch [<options>] [-r | -a] [--merged] [--no-merged]',
      '   or: git branch [<options>] [-f] [--recurse-submodules] <branch-name> [<start-point>]',
      '   or: git branch [<options>] [-l] [<pattern>...]',
      '   or: git branch [<options>] [-r] (-d | -D) <branch-name>...',
      '   or: git branch [<options>] (-m | -M) [<old-branch>] <new-branch>',
      '   or: git branch [<options>] (-c | -C) [<old-branch>] <new-branch>',
      '   or: git branch [<options>] [-r | -a] [--points-at]',
      '   or: git branch [<options>] [-r | -a] [--format]', '',
      opt('-d, --delete', 'delete fully merged branch'),
      opt('-D', 'delete branch (even if not merged)')],
    checkout: ['usage: git checkout [<options>] <branch>',
      '   or: git checkout [<options>] [<branch>] -- <file>...', '',
      opt('-b <branch>', 'create and checkout a new branch'),
      opt('--detach', 'detach HEAD at named commit')],
    switch: ['usage: git switch [<options>] [<branch>]', '',
      opt('-c, --create <branch>', 'create and switch to a new branch'),
      opt('-d, --detach', 'detach HEAD at named commit')],
    merge: ['usage: git merge [<options>] [<commit>...]',
      '   or: git merge --abort',
      '   or: git merge --continue', '',
      opt('--abort', 'abort the current in-progress merge'),
      opt('--continue', 'continue the current in-progress merge')],
    remote: ['usage: git remote [-v | --verbose]',
      '   or: git remote add [-t <branch>] [-m <master>] [-f] [--tags | --no-tags] [--mirror=<fetch|push>] <name> <url>',
      '   or: git remote rename [--[no-]progress] <old> <new>',
      '   or: git remote remove <name>',
      '   or: git remote set-head <name> (-a | --auto | -d | --delete | <branch>)',
      '   or: git remote [-v | --verbose] show [-n] <name>',
      '   or: git remote prune [-n | --dry-run] <name>',
      '   or: git remote [-v | --verbose] update [-p | --prune] [(<group> | <remote>)...]',
      '   or: git remote set-branches [--add] <name> <branch>...',
      '   or: git remote get-url [--push] [--all] <name>',
      '   or: git remote set-url [--push] <name> <newurl> [<oldurl>]',
      '   or: git remote set-url --add <name> <newurl>',
      '   or: git remote set-url --delete <name> <url>', '',
      opt('-v, --verbose', 'be verbose; must be placed before a subcommand')],
    push: ['usage: git push [<options>] [<repository> [<refspec>...]]', '',
      opt('-u, --set-upstream', 'set upstream for git pull/status')],
    pull: ['usage: git pull [<options>] [<repository> [<refspec>...]]'],
    fetch: ['usage: git fetch [<options>] [<repository> [<refspec>...]]',
      '   or: git fetch [<options>] <group>',
      '   or: git fetch --multiple [<options>] [(<repository>|<group>)...]',
      '   or: git fetch --all [<options>]'],
    clone: ['usage: git clone [<options>] [--] <repo> [<dir>]'],
    config: ['usage: git config list [<file-option>] [<display-option>] [--includes]',
      '   or: git config get [<file-option>] [<display-option>] [--includes] [--all] [--regexp] [--value=<pattern>] [--fixed-value] [--default=<default>] [--url=<url>] <name>',
      '   or: git config set [<file-option>] [--type=<type>] [--all] [--value=<pattern>] [--fixed-value] <name> <value>',
      '   or: git config unset [<file-option>] [--all] [--value=<pattern>] [--fixed-value] <name>',
      '   or: git config rename-section [<file-option>] <old-name> <new-name>',
      '   or: git config remove-section [<file-option>] <name>',
      '   or: git config edit [<file-option>]',
      '   or: git config [<file-option>] --get-colorbool <name> [<stdout-is-tty>]', '',
      'Config file location',
      opt('--global', 'use global config file'),
      opt('--local', 'use repository config file')],
    stash: ['usage: git stash list [<log-options>]',
      '   or: git stash show [-u | --include-untracked | --only-untracked] [<diff-options>] [<stash>]',
      '   or: git stash drop [-q | --quiet] [<stash>]',
      '   or: git stash pop [--index] [-q | --quiet] [<stash>]',
      '   or: git stash apply [--index] [-q | --quiet] [--label-ours=<label>] [--label-theirs=<label>] [--label-base=<label>] [<stash>]',
      '   or: git stash branch <branchname> [<stash>]',
      '   or: git stash [push] [-p | --patch] [-S | --staged] [-k | --[no-]keep-index] [-q | --quiet]',
      '                 [-u | --include-untracked] [-a | --all] [(-m | --message) <message>]',
      '                 [--pathspec-from-file=<file> [--pathspec-file-nul]]',
      '                 [--] [<pathspec>...]',
      '   or: git stash save [-p | --patch] [-S | --staged] [-k | --[no-]keep-index] [-q | --quiet]',
      '                 [-u | --include-untracked] [-a | --all] [<message>]',
      '   or: git stash clear',
      '   or: git stash create [<message>]',
      '   or: git stash store [(-m | --message) <message>] [-q | --quiet] <commit>',
      '   or: git stash export (--print | --to-ref <ref>) [<stash>...]',
      '   or: git stash import <commit>'],
    'check-ignore': ['usage: git check-ignore [<options>] <pathname>...',
      '   or: git check-ignore [<options>] --stdin']
  };

  /* ------------------------------ engine ---------------------------- */

  function createSandbox(options) {
    options = options || {};
    var gitlib = options.git || (typeof self !== 'undefined' ? self.git : null);
    if (!gitlib) throw new Error('isomorphic-git not found');

    var fs = createMemFS();
    var dir = options.dir || '/project';
    // Path shown to the user in messages and pwd; the real in-memory fs
    // stays rooted at `dir` regardless of what the prompt displays.
    var displayDir = options.displayDir || '~' + dir;
    // Mock remote: a bare repository elsewhere in the same in-memory fs,
    // created by `git remote add origin <url>`. Push/pull/fetch move objects
    // and refs between it and the local repo — nothing leaves the page.
    var remoteGitdir = '/origin';
    // The mock remote's URL once it exists, "on GitHub". Whether the local
    // repository knows it is a separate matter, kept where git keeps it:
    // remote.origin.url in .git/config (see originUrl). The two differ
    // before a clone, or after the learner deletes .git.
    var remoteUrl = null;
    // where HEAD was before the last checkout or switch (a branch name or
    // a commit), for `git switch -`
    var prevHead = null;
    // Merges that actually moved a ref ({ from, into }), via `git merge` or
    // `git pull`. The graph alone cannot distinguish "freshly branched off Y"
    // from "fast-forward merged into Y" — both leave X's tip an ancestor of
    // Y's — so `merged X into Y` conditions need this record.
    var mergesDone = [];
    var author = { name: 'Your Name', email: 'you@example.com' };
    // `git config --global` settings other than user.*, keyed in lower
    // case. The sandbox has no home folder, so they live here; the only
    // one that changes anything is init.defaultBranch.
    var globalConfig = {};
    var defaultBranch = options.defaultBranch || 'main';
    var repoReady = false;
    // Shell working directory, always `dir` or a folder inside it. The
    // repository itself stays at `dir`; only relative paths follow `cd`.
    var cwd = dir;
    var prevCwd = dir;

    var base = { fs: fs, dir: dir };
    function opts(extra) {
      var o = { fs: fs, dir: dir };
      for (var k in extra) o[k] = extra[k];
      return o;
    }

    function abs(p) {
      if (!p) return cwd;
      return p.charAt(0) === '/' ? fs._norm(p) : fs._norm(cwd + '/' + p);
    }
    // like abs(), but relative paths start at the project's top, not cwd
    function fromRoot(p) {
      if (!p) return dir;
      return p.charAt(0) === '/' ? fs._norm(p) : fs._norm(dir + '/' + p);
    }
    function rel(p) {
      var a = abs(p);
      return a.indexOf(dir + '/') === 0 ? a.slice(dir.length + 1) : a.replace(/^\//, '');
    }

    // What the shell makes of an unquoted glob: the matching paths, sorted,
    // spelled as the learner typed the pattern, or null when nothing
    // matches (bash then passes the pattern on unchanged). Dot files only
    // match a pattern segment that starts with a dot.
    async function expandGlob(pattern) {
      var absolute = pattern.charAt(0) === '/';
      var found = [{ at: absolute ? '' : cwd, shown: absolute ? '' : null }];
      var segs = pattern.split('/');
      for (var i = 0; i < segs.length; i++) {
        var seg = segs[i];
        var last = i === segs.length - 1;
        if (seg === '' && (i === 0 || last)) continue;
        var next = [];
        for (var f = 0; f < found.length; f++) {
          var here = found[f];
          var join = function (name) {
            return { at: here.at + '/' + name, shown: here.shown === null ? name : here.shown + '/' + name };
          };
          if (!hasGlob(seg)) { next.push(join(seg)); continue; }
          var names;
          try { names = await fs.promises.readdir(here.at || '/'); } catch (e) { continue; }
          var re = globRegex(seg, true);
          names.forEach(function (n) {
            if (n.charAt(0) === '.' && seg.charAt(0) !== '.') return;
            if (re.test(n)) next.push(join(n));
          });
        }
        found = next;
      }
      var out = [];
      for (var k = 0; k < found.length; k++) {
        try { await fs.promises.stat(found[k].at); } catch (e) { continue; }
        out.push(found[k].shown === null ? '.' : (absolute ? '/' : '') + found[k].shown);
      }
      return out.length ? out.sort() : null;
    }

    // A git pathspec as a test on repository paths (relative to the top,
    // like statusMatrix reports them). Relative specs start at cwd, so
    // `git add .` in a subfolder means that folder. A plain spec matches
    // the path itself or anything below it; one with *, ? or [ is a glob
    // over the whole path. Null if the spec points outside the project.
    function pathspec(spec) {
      var full = abs(spec);
      if (!insideProject(full)) return null;
      var base = full === dir ? '' : full.slice(dir.length + 1);
      if (hasGlob(base)) {
        var re = globRegex(base, false);
        return function (p) { return re.test(p); };
      }
      return function (p) { return !base || p === base || p.indexOf(base + '/') === 0; };
    }

    async function ensureWorkdir() {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    // cwd as the learner sees it, e.g. ~/project/src
    function displayCwd() {
      return cwd === dir ? displayDir : displayDir + cwd.slice(dir.length);
    }

    function insideProject(p) {
      return p === dir || p.indexOf(dir + '/') === 0;
    }

    // A checkout or reset can delete the folder the learner is standing in.
    // A real shell would leave them in a ghost directory; here we step back
    // to the project root so every later command still works.
    async function ensureCwd() {
      if (cwd === dir) return;
      try {
        if ((await fs.promises.stat(cwd)).isDirectory()) return;
      } catch (e) {}
      cwd = dir;
    }

    async function isRepo() {
      try { await fs.promises.stat(dir + '/.git'); return true; }
      catch (e) { return false; }
    }

    async function currentBranch() {
      try { return (await gitlib.currentBranch(opts({ fullname: false }))) || null; }
      catch (e) { return null; }
    }

    // Where HEAD was detached, so `git status` can say "detached at" until
    // a commit moves HEAD on, and "detached from" after, as real git does.
    var detachPoint = null;

    // The first line of `git status`: "On branch main", or the detached form.
    async function headLine() {
      var br = await currentBranch();
      if (br) return 'On branch ' + br;
      var oid = null;
      try { oid = await gitlib.resolveRef(opts({ ref: 'HEAD' })); } catch (e) {}
      if (!oid) return 'On branch ' + defaultBranch;
      if (!detachPoint) detachPoint = oid;
      return 'HEAD detached ' + (oid === detachPoint ? 'at ' : 'from ') + detachPoint.slice(0, 7);
    }

    // A commit named the ways a learner is likely to type it: a full or
    // abbreviated hash, HEAD, a branch, or any of those followed by ~n or ^.
    // Returns the full oid, or null if nothing matches.
    async function resolveCommit(spec) {
      var m = /^(.+?)((?:[~^]\d*)*)$/.exec(spec);
      if (!m) return null;
      var oid = null;
      try { oid = await gitlib.resolveRef(opts({ ref: m[1] })); } catch (e) {}
      if (!oid && /^[0-9a-f]{4,40}$/i.test(m[1])) {
        try { oid = await gitlib.expandOid(opts({ oid: m[1].toLowerCase() })); } catch (e) {}
      }
      if (!oid) return null;
      try { if ((await gitlib.readObject(opts({ oid: oid }))).type !== 'commit') return null; }
      catch (e) { return null; }
      var steps = m[2].match(/[~^]\d*/g) || [];
      for (var i = 0; i < steps.length; i++) {
        var n = steps[i].length > 1 ? parseInt(steps[i].slice(1), 10) : 1;
        // ~n walks n first parents; ^n picks the nth parent
        var walk = steps[i].charAt(0) === '~' ? n : (n ? 1 : 0);
        var pick = steps[i].charAt(0) === '^' ? n - 1 : 0;
        for (var w = 0; w < walk; w++) {
          var ps = (await gitlib.readCommit(opts({ oid: oid }))).commit.parent || [];
          oid = ps[w === walk - 1 ? pick : 0];
          if (!oid) return null;
        }
      }
      return oid;
    }

    // Files with uncommitted changes that moving HEAD to `oid` would
    // replace, because the two commits hold different versions of them.
    // isomorphic-git's checkout overwrites these without a word; git refuses.
    async function overwrittenBy(oid, st) {
      var headOid = null;
      try { headOid = await gitlib.resolveRef(opts({ ref: 'HEAD' })); } catch (e) { return []; }
      var changed = st.staged.map(function (x) { return x.file; })
        .concat(st.modified, st.deleted, st.stagedDeleted);
      async function blobAt(commit, f) {
        try { return (await gitlib.readBlob(opts({ oid: commit, filepath: f }))).oid; }
        catch (e) { return null; }
      }
      var out = [];
      for (var i = 0; i < changed.length; i++) {
        if (out.indexOf(changed[i]) !== -1) continue;
        if ((await blobAt(headOid, changed[i])) !== (await blobAt(oid, changed[i]))) out.push(changed[i]);
      }
      return out.sort();
    }

    async function subjectOf(oid) {
      return ((await gitlib.readCommit(opts({ oid: oid }))).commit.message || '').split('\n')[0];
    }

    // Commits reachable from `oid` but from no branch: what leaving a
    // detached HEAD would abandon. Newest first.
    async function orphanedFrom(oid) {
      var kept = {};
      var names = await gitlib.listBranches(opts());
      for (var i = 0; i < names.length; i++) {
        var tip = null;
        try { tip = await gitlib.resolveRef(opts({ ref: names[i] })); } catch (e) { continue; }
        var r = await reachableFrom(tip, opts);
        for (var k in r) kept[k] = true;
      }
      var out = [];
      var o = oid;
      while (o && !kept[o]) {
        var c = await gitlib.readCommit(opts({ oid: o }));
        out.push({ oid: o, message: (c.commit.message || '').split('\n')[0] });
        o = (c.commit.parent || [])[0];
      }
      return out;
    }

    // What git prints when HEAD leaves a detached commit: either where it
    // was, or a warning naming the commits nothing points at any more.
    async function leavingDetached(oldOid) {
      var lost = await orphanedFrom(oldOid);
      if (!lost.length) return 'Previous HEAD position was ' + oldOid.slice(0, 7) + ' ' + await subjectOf(oldOid) + '\n';
      var n = lost.length;
      return '{y}Warning: you are leaving ' + n + ' commit' + (n === 1 ? '' : 's') + ' behind, not connected to\n' +
        'any of your branches:{/}\n\n' +
        lost.slice(0, 5).map(function (c) { return '  ' + c.oid.slice(0, 7) + ' ' + c.message; }).join('\n') +
        (n > 5 ? '\n ... and ' + (n - 5) + ' more.' : '') + '\n\n' +
        'If you want to keep ' + (n === 1 ? 'it' : 'them') + ' by creating a new branch, this may be a good time\n' +
        'to do so with:\n\n' +
        ' git branch <new-branch-name> ' + oldOid.slice(0, 7) + '\n\n';
    }

    // list tracked+untracked files in the workdir (excluding .git)
    async function listFiles() {
      var out = [];
      var prefix = dir + '/';
      fs._store.forEach(function (v, k) {
        if (k.indexOf(prefix) !== 0) return;
        if (k.indexOf(dir + '/.git') === 0) return;
        if (v.type !== 'file') return;
        out.push(k.slice(prefix.length));
      });
      return out.sort();
    }

    // Every file and folder under the workdir, .git included, as
    // [{ path, type: 'file' | 'dir' }] relative to it. The editor's file
    // browser needs folders (empty ones too) and hidden files, which
    // listFiles leaves out on purpose.
    async function listTree() {
      var out = [];
      var prefix = dir + '/';
      fs._store.forEach(function (v, k) {
        if (k.indexOf(prefix) !== 0) return;
        out.push({ path: k.slice(prefix.length), type: v.type === 'dir' ? 'dir' : 'file' });
      });
      return out.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
    }

    /* ------------------------------ remote -------------------------- */

    // options builder for commands that read the remote's bare repo
    function ropts(extra) {
      var o = { fs: fs, gitdir: remoteGitdir };
      for (var k in extra) o[k] = extra[k];
      return o;
    }

    async function remoteBranchOid(name) {
      try { return (await fs.promises.readFile(remoteGitdir + '/refs/heads/' + name, 'utf8')).trim(); }
      catch (e) { return null; }
    }

    async function listRemoteBranchNames() {
      try { return (await fs.promises.readdir(remoteGitdir + '/refs/heads')).sort(); }
      catch (e) { return []; }
    }

    // Copy every git object file present under `from` but missing under `to`.
    // Both repos live in the same in-memory fs, so a push/fetch "transfer"
    // is a plain file copy.
    async function copyObjects(fromGitdir, toGitdir) {
      var prefix = fromGitdir + '/objects/';
      var paths = [];
      fs._store.forEach(function (v, k) {
        if (v.type === 'file' && k.indexOf(prefix) === 0) paths.push(k);
      });
      for (var i = 0; i < paths.length; i++) {
        var dest = toGitdir + paths[i].slice(fromGitdir.length);
        try { await fs.promises.stat(dest); continue; } catch (e) { /* missing: copy */ }
        await fs.promises.mkdir(dest.slice(0, dest.lastIndexOf('/')), { recursive: true });
        await fs.promises.writeFile(dest, await fs.promises.readFile(paths[i]));
      }
    }

    // set of commit oids reachable from `oid`, read via the given options builder
    async function reachableFrom(oid, optsFn) {
      var seen = {};
      var queue = [oid];
      while (queue.length) {
        var o = queue.shift();
        if (!o || seen[o]) continue;
        var c;
        try { c = await gitlib.readCommit(optsFn({ oid: o })); } catch (e) { continue; }
        seen[o] = true;
        (c.commit.parent || []).forEach(function (p) { queue.push(p); });
      }
      return seen;
    }

    // remote.origin.url, or null when this repository has no origin
    async function originUrl() {
      if (!(await isRepo())) return null;
      try { return (await gitlib.getConfig(opts({ path: 'remote.origin.url' }))) || null; }
      catch (e) { return null; }
    }

    // One spelling of a URL for comparing: `git@github.com:a/b.git`,
    // `https://github.com/a/b` and `https://github.com/a/b.git/` all agree.
    function urlKey(u) {
      return String(u).trim().toLowerCase()
        .replace(/^[a-z+]+:\/\//, '').replace(/^[^@\/]+@/, '').replace(/^([^\/:]+):/, '$1/')
        .replace(/\/+$/, '').replace(/\.git$/, '');
    }

    // origin/x (or remotes/origin/x, refs/remotes/origin/x) -> x, else null
    function trackingName(spec) {
      var m = /^(?:refs\/)?(?:remotes\/)?origin\/(.+)$/.exec(spec || '');
      return m ? m[1] : null;
    }

    async function trackingOid(name) {
      try { return await gitlib.resolveRef(opts({ ref: 'refs/remotes/origin/' + name })); }
      catch (e) { return null; }
    }

    // the branches `git fetch` has recorded from origin, sorted; not
    // origin/HEAD, which only points at one of them
    async function trackingNames() {
      var out = [];
      async function walk(sub) {
        var names = [];
        try { names = await fs.promises.readdir(dir + '/.git/refs/remotes/origin' + sub); } catch (e) { return; }
        for (var i = 0; i < names.length; i++) {
          if (!sub && names[i] === 'HEAD') continue;
          var p = dir + '/.git/refs/remotes/origin' + sub + '/' + names[i];
          if ((await fs.promises.stat(p)).isDirectory()) await walk(sub + '/' + names[i]);
          else out.push((sub + '/' + names[i]).slice(1));
        }
      }
      await walk('');
      return out.sort();
    }

    // The branch origin/HEAD points at (the remote's default branch, which
    // fetch and clone record), or null
    async function originHead() {
      try {
        var t = await fs.promises.readFile(dir + '/.git/refs/remotes/origin/HEAD', 'utf8');
        var m = /^ref: refs\/remotes\/origin\/(.+)$/.exec(t.trim());
        return m ? m[1] : null;
      } catch (e) { return null; }
    }

    // A branch's upstream lives in .git/config, as in git, so it survives
    // undo and is what `git pull` and `git status` consult. Returns the
    // remote branch's name, or null.
    async function upstreamOf(branch) {
      var merge = null;
      try { merge = await gitlib.getConfig(opts({ path: 'branch.' + branch + '.merge' })); } catch (e) {}
      return merge ? String(merge).replace(/^refs\/heads\//, '') : null;
    }

    // remoteBranch null removes the upstream
    async function setUpstream(branch, remoteBranch) {
      await gitlib.setConfig(opts({ path: 'branch.' + branch + '.remote', value: remoteBranch ? 'origin' : undefined }));
      await gitlib.setConfig(opts({ path: 'branch.' + branch + '.merge', value: remoteBranch ? 'refs/heads/' + remoteBranch : undefined }));
    }

    // Where a new branch starts: { oid, tracks } where tracks names the
    // remote branch when the start point is origin/x, as git then sets it
    // as the upstream. Null if `spec` names nothing.
    async function startPoint(spec) {
      var t = trackingName(spec);
      if (t) {
        var toid = await trackingOid(t);
        if (toid) return { oid: toid, tracks: t };
      }
      var oid = await resolveCommit(spec);
      return oid ? { oid: oid, tracks: null } : null;
    }

    // What `git status` and `git checkout` say about a branch and its
    // upstream: "Your branch is ahead of 'origin/main' by 1 commit." and the
    // like. Compares with the remote-tracking branch, so news on the remote
    // shows only after `git fetch`, as in git. Empty without an upstream.
    async function trackingLines(branch) {
      var up = await upstreamOf(branch);
      if (!up) return [];
      var name = "'origin/" + up + "'";
      var theirs = await trackingOid(up);
      if (!theirs) return ['Your branch is based on ' + name + ', but the upstream is gone.',
        '  (use "git branch --unset-upstream" to fixup)'];
      var mine;
      try { mine = await gitlib.resolveRef(opts({ ref: branch })); } catch (e) { return []; }
      var a = await reachableFrom(mine, opts), b = await reachableFrom(theirs, opts);
      var ahead = Object.keys(a).filter(function (o) { return !b[o]; }).length;
      var behind = Object.keys(b).filter(function (o) { return !a[o]; }).length;
      var n = function (k) { return k + ' commit' + (k === 1 ? '' : 's'); };
      if (!ahead && !behind) return ['Your branch is up to date with ' + name + '.'];
      if (!behind) return ['Your branch is ahead of ' + name + ' by ' + n(ahead) + '.',
        '  (use "git push" to publish your local commits)'];
      if (!ahead) return ['Your branch is behind ' + name + ' by ' + n(behind) + ', and can be fast-forwarded.',
        '  (use "git pull" to update your local branch)'];
      return ['Your branch and ' + name + ' have diverged,',
        'and have ' + ahead + ' and ' + behind + ' different commits each, respectively.',
        '  (use "git pull" if you want to integrate the remote branch with yours)'];
    }

    function prefixLines(lines) { return lines.length ? '\n' + lines.join('\n') : ''; }

    async function setTrackingRef(branch, oid) {
      await gitlib.writeRef(opts({ ref: 'refs/remotes/origin/' + branch, value: oid, force: true }));
    }

    /* ------------------------- merge conflicts ---------------------- */

    // A merge that stops on conflicts leaves MERGE_HEAD and MERGE_MSG in
    // .git, as real git does, plus sandbox-merge.json: what is being merged
    // into what, and which files are still unresolved. isomorphic-git keeps
    // the unmerged index entries (and refuses to commit over them) but has
    // no API to list them, so the list lives here and shrinks as the learner
    // runs `git add` or `git rm`. Everything is in the in-memory fs, so undo
    // snapshots carry a half-finished merge along with the rest.
    var MERGE_STATE = '/.git/sandbox-merge.json';

    async function mergeState() {
      try { return JSON.parse(await fs.promises.readFile(dir + MERGE_STATE, 'utf8')); }
      catch (e) { return null; }
    }

    async function saveMergeState(st) {
      await fs.promises.writeFile(dir + '/.git/MERGE_HEAD', st.oid + '\n');
      await fs.promises.writeFile(dir + '/.git/MERGE_MSG', st.message + '\n');
      await fs.promises.writeFile(dir + MERGE_STATE, JSON.stringify(st));
    }

    async function clearMergeState() {
      ['/.git/MERGE_HEAD', '/.git/MERGE_MSG', MERGE_STATE].forEach(function (f) {
        fs._store.delete(dir + f);
      });
    }

    // `git add` / `git rm` on a conflicted path marks it resolved
    async function markResolved(paths) {
      var st = await mergeState();
      if (!st) return;
      st.unresolved = st.unresolved.filter(function (c) { return paths.indexOf(c.file) === -1; });
      await fs.promises.writeFile(dir + MERGE_STATE, JSON.stringify(st));
    }

    function unmergedError(verb) {
      return {
        out: 'error: ' + verb + ' is not possible because you have unmerged files.\n' +
             "hint: Fix them up in the work tree, and then use 'git add/rm <file>'\n" +
             'hint: as appropriate to mark resolution and make a commit.\n' +
             'fatal: Exiting because of an unresolved conflict.',
        ok: false
      };
    }

    // Working files (not .git) as path -> bytes, to tell afterwards which
    // ones a merge touched.
    function workdirBytes() {
      var out = {};
      var prefix = dir + '/';
      fs._store.forEach(function (v, k) {
        if (k.indexOf(prefix) !== 0 || k.indexOf(dir + '/.git/') === 0 || v.type !== 'file') return;
        out[k.slice(prefix.length)] = v.content;
      });
      return out;
    }

    function sameBytes(a, b) {
      if (!a || !b || a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    }

    // Merge `theirs` (a ref) into the checked-out branch `ours`; `label` is
    // what the learner calls the other side, and goes into the conflict
    // markers and the merge record. Shared by `git merge` and `git pull`.
    // Returns isomorphic-git's result, or { conflict: <command result> }.
    async function mergeInto(ours, theirs, label, message) {
      var before = workdirBytes();
      var result;
      try {
        result = await gitlib.merge(opts({
          ours: ours, theirs: theirs, theirName: label,
          abortOnConflict: false,
          author: { name: author.name, email: author.email },
          message: message
        }));
      } catch (e) {
        if (e.code !== 'MergeConflictError') throw e;
        return { conflict: await stopOnConflicts(ours, theirs, label, message, before, e.data) };
      }
      // bring the working directory in line with the new ref
      await gitlib.checkout(opts({ ref: ours, force: true }));
      if (!result.alreadyMerged) mergesDone.push({ from: label, into: ours });
      return result;
    }

    async function stopOnConflicts(ours, theirs, label, message, before, data) {
      var conflicted = data.filepaths || [];
      var kindOf = function (f) {
        if ((data.deleteByUs || []).indexOf(f) !== -1) return 'deleted by us';
        if ((data.deleteByTheirs || []).indexOf(f) !== -1) return 'deleted by them';
        return 'both modified';
      };
      // isomorphic-git writes the cleanly merged files to the working
      // directory but leaves them out of the index. Real git stages them, so
      // they go into the merge commit without a `git add`; do the same, but
      // only for files the merge actually changed, so the learner's own
      // unstaged edits stay unstaged.
      var after = workdirBytes();
      var seen = {};
      Object.keys(before).concat(Object.keys(after)).forEach(function (f) { seen[f] = true; });
      var paths = Object.keys(seen).sort();
      for (var i = 0; i < paths.length; i++) {
        var f = paths[i];
        if (conflicted.indexOf(f) !== -1 || sameBytes(before[f], after[f])) continue;
        if (after[f]) await gitlib.add(opts({ filepath: f }));
        else await gitlib.remove(opts({ filepath: f }));
      }
      var unresolved = conflicted.map(function (f) { return { file: f, kind: kindOf(f) }; });
      await saveMergeState({
        from: label, into: ours, message: message,
        oid: await gitlib.resolveRef(opts({ ref: theirs })),
        files: conflicted.slice(), unresolved: unresolved
      });
      var lines = [];
      unresolved.forEach(function (c) {
        if (c.kind === 'both modified') {
          lines.push('Auto-merging ' + c.file);
          lines.push('{r}CONFLICT (content){/}: Merge conflict in ' + c.file);
        } else {
          var gone = c.kind === 'deleted by us' ? 'HEAD' : label;
          var kept = c.kind === 'deleted by us' ? label : 'HEAD';
          lines.push('{r}CONFLICT (modify/delete){/}: ' + c.file + ' deleted in ' + gone +
            ' and modified in ' + kept + '. Version ' + kept + ' of ' + c.file + ' left in tree.');
        }
      });
      lines.push('Automatic merge failed; fix conflicts and then commit the result.');
      return { out: lines.join('\n'), ok: false, conflict: true };
    }

    /* ------------------------- graph model ------------------------- */

    // Shared commit-graph builder. refEntries: [{ name, oid, isHead, remote }].
    // Walks history from the given refs (plus extraSeeds), reading commits
    // with optsFn — opts for the local repo, ropts for the remote.
    async function buildGraph(refEntries, extraSeeds, optsFn) {
      var seeds = refEntries.map(function (e) { return e.oid; })
        .concat(extraSeeds || [])
        .filter(Boolean);

      var seen = new Map();
      var queue = seeds.slice();
      while (queue.length) {
        var oid2 = queue.shift();
        if (!oid2 || seen.has(oid2)) continue;
        var c;
        try { c = await gitlib.readCommit(optsFn({ oid: oid2 })); }
        catch (e) { continue; }
        seen.set(oid2, {
          oid: oid2,
          short: oid2.slice(0, 7),
          message: (c.commit.message || '').split('\n')[0],
          parents: c.commit.parent || [],
          timestamp: c.commit.author.timestamp,
          author: c.commit.author.name,
          refs: []
        });
        (c.commit.parent || []).forEach(function (p) { queue.push(p); });
      }

      // Topological order, children before parents, preferring newer commits.
      // A plain timestamp sort is not enough: commits made in the same second
      // (which happens whenever we seed a repo programmatically) would tie.
      var all = Array.from(seen.values());
      var childCount = {};
      all.forEach(function (c) { childCount[c.oid] = 0; });
      all.forEach(function (c) {
        (c.parents || []).forEach(function (p) {
          if (p in childCount) childCount[p]++;
        });
      });
      var ready = all.filter(function (c) { return childCount[c.oid] === 0; });
      var commits = [];
      var guard = all.length + 1;
      while (ready.length && guard-- > 0) {
        ready.sort(function (a, b) { return b.timestamp - a.timestamp; });
        var next = ready.shift();
        commits.push(next);
        (next.parents || []).forEach(function (p) {
          if (!(p in childCount)) return;
          childCount[p]--;
          if (childCount[p] === 0) ready.push(seen.get(p));
        });
      }
      // safety net: if a cycle ever appeared, fall back to timestamp order
      if (commits.length !== all.length) {
        commits = all.slice().sort(function (a, b) { return b.timestamp - a.timestamp; });
      }

      refEntries.forEach(function (e) {
        var node = seen.get(e.oid);
        if (node) node.refs.push({ name: e.name, isHead: !!e.isHead, remote: !!e.remote });
      });

      // lane assignment: walk newest -> oldest keeping a set of open lanes
      var lanes = [];
      var laneOf = {};
      commits.forEach(function (c2) {
        var lane = lanes.indexOf(c2.oid);
        if (lane === -1) {
          lane = lanes.indexOf(null);
          if (lane === -1) { lane = lanes.length; lanes.push(null); }
        }
        lanes[lane] = null;
        laneOf[c2.oid] = lane;
        c2.lane = lane;
        var ps = c2.parents || [];
        if (ps.length) {
          lanes[lane] = ps[0];
          for (var j = 1; j < ps.length; j++) {
            if (lanes.indexOf(ps[j]) !== -1) continue;
            var free = lanes.indexOf(null);
            if (free === -1) { lanes.push(ps[j]); } else { lanes[free] = ps[j]; }
          }
        }
      });

      return commits;
    }

    async function graphModel() {
      if (!(await isRepo())) return { commits: [], branches: [], head: null, detached: false, merges: [] };

      var branches = await gitlib.listBranches(opts());
      var head = await currentBranch();
      var refs = {};
      var refEntries = [];

      for (var i = 0; i < branches.length; i++) {
        try {
          var oid = await gitlib.resolveRef(opts({ ref: branches[i] }));
          refs[branches[i]] = oid;
          refEntries.push({ name: branches[i], oid: oid, isHead: branches[i] === head });
        } catch (e) { /* unborn branch */ }
      }

      // remote-tracking refs (origin/*) appear as grey pills, like real git log
      if (remoteUrl) {
        // origin/HEAD is left out: a pill saying where the remote's
        // default branch is would only crowd the graph
        var tracked = await trackingNames();
        for (var t = 0; t < tracked.length; t++) {
          try {
            var toid = await gitlib.resolveRef(opts({ ref: 'refs/remotes/origin/' + tracked[t] }));
            refEntries.push({ name: 'origin/' + tracked[t], oid: toid, remote: true });
          } catch (e) { /* dangling tracking ref */ }
        }
      }

      // include HEAD in case it is detached
      var headOid = null;
      try { headOid = await gitlib.resolveRef(opts({ ref: 'HEAD' })); }
      catch (e) { /* no commits yet */ }

      var commits = await buildGraph(refEntries, headOid ? [headOid] : [], opts);

      return {
        commits: commits,
        branches: branches.map(function (b) { return { name: b, oid: refs[b] || null, isHead: b === head }; }),
        head: head,
        headOid: headOid,
        detached: head === null && headOid !== null,
        merges: mergesDone.slice()
      };
    }

    // What the mock remote looks like "on GitHub": its own commit graph plus
    // how the learner's current branch compares to it. Null until
    // `git remote add origin <url>` has run. `remotes` lists every remote's
    // name; there is only ever `origin` for now, so `name` picks it.
    async function remoteModel(name) {
      if (!remoteUrl) return null;
      var remotes = ['origin'];
      name = remotes.indexOf(name) !== -1 ? name : remotes[0];
      var names = await listRemoteBranchNames();
      var refEntries = [];
      for (var i = 0; i < names.length; i++) {
        refEntries.push({ name: 'origin/' + names[i], oid: await remoteBranchOid(names[i]), remote: true });
      }
      var commits = await buildGraph(refEntries, [], ropts);

      var branch = await currentBranch();
      var tracked = false, ahead = 0, behind = 0;
      if (branch) {
        var remoteOid = await remoteBranchOid(branch);
        if (remoteOid) {
          tracked = true;
          var localOid = null;
          try { localOid = await gitlib.resolveRef(opts({ ref: branch })); } catch (e) {}
          var localSet = localOid ? await reachableFrom(localOid, opts) : {};
          var remoteSet = await reachableFrom(remoteOid, ropts);
          Object.keys(localSet).forEach(function (o) { if (!remoteSet[o]) ahead++; });
          Object.keys(remoteSet).forEach(function (o) { if (!localSet[o]) behind++; });
        }
      }
      return {
        name: name, remotes: remotes,
        url: remoteUrl,
        graph: { commits: commits, branches: names, head: null, detached: false },
        branch: branch, tracked: tracked, ahead: ahead, behind: behind
      };
    }

    /* --------------------------- git status ------------------------ */

    // returns { staged:[], modified:[], untracked:[], deleted:[], stagedDeleted:[], ignored:[] }
    // isomorphic-git statusMatrix rows are [filepath, HEAD, WORKDIR, STAGE] where
    //   HEAD:    0 = absent,               1 = present
    //   WORKDIR: 0 = absent,               1 = same as HEAD, 2 = different from HEAD
    //   STAGE:   0 = absent, 1 = same as HEAD, 2 = same as WORKDIR, 3 = different from both
    //
    // During a merge that stopped on conflicts, `merging` is true and the
    // files still to resolve are in `conflicted` ([{ file, kind }]) and in
    // none of the other lists.
    async function statusModel() {
      var matrix = await gitlib.statusMatrix(opts());
      var merge = await mergeState();
      var res = {
        staged: [], modified: [], untracked: [], deleted: [], stagedDeleted: [],
        conflicted: merge ? merge.unresolved.slice() : [], merging: !!merge,
        ignored: []
      };
      // statusMatrix lists every working file except those .gitignore
      // matches (and does not track), so whatever it leaves out is ignored
      var listed = {};
      matrix.forEach(function (row) { listed[row[0]] = true; });
      (await listFiles()).forEach(function (f) { if (!listed[f]) res.ignored.push(f); });
      var skip = {};
      res.conflicted.forEach(function (c) { skip[c.file] = true; });
      // a file taken out of git (`git rm --cached`) but still on disk
      var leftOnDisk = [];
      matrix.forEach(function (row) {
        var file = row[0], head = row[1], workdir = row[2], stage = row[3];
        if (skip[file]) return;

        if (head === 0) {
          // file is not in the last commit
          if (stage === 0) { if (workdir !== 0) res.untracked.push(file); return; }
          res.staged.push({ file: file, kind: 'new file' });
          if (workdir === 0) res.deleted.push(file);       // staged then deleted on disk
          else if (stage === 3) res.modified.push(file);   // staged, then edited again
          return;
        }

        // file was in the last commit
        if (stage === 0) { res.stagedDeleted.push(file); if (workdir !== 0) leftOnDisk.push(file); return; }
        if (workdir === 0) { res.deleted.push(file); return; }
        if (stage === 1) { if (workdir === 2) res.modified.push(file); return; }
        // stage 2 or 3 => something is staged
        if (workdir === 2 || stage === 3) {
          res.staged.push({ file: file, kind: 'modified' });
          if (stage === 3) res.modified.push(file);        // staged one version, edited again
        }
      });
      // statusMatrix still lists it because HEAD has it, so ask .gitignore
      for (var i = 0; i < leftOnDisk.length; i++) {
        if (await gitlib.isIgnored(opts({ filepath: leftOnDisk[i] }))) res.ignored.push(leftOnDisk[i]);
        else res.untracked.push(leftOnDisk[i]);
      }
      res.ignored.sort();
      return res;
    }

    // Untracked (or ignored) files as `git status` lists them: a folder
    // holding nothing else git knows about shows once, as `notes/`, instead
    // of file by file. `others` are paths that keep a folder from
    // collapsing on top of the tracked ones.
    async function untrackedShown(untracked, others) {
      var known = (await gitlib.statusMatrix(opts()))
        .filter(function (row) { return row[1] !== 0 || row[3] !== 0; })
        .map(function (row) { return row[0]; })
        .concat(others || []);
      var shown = [];
      untracked.forEach(function (f) {
        var parts = f.split('/');
        var name = f;
        for (var i = 1; i < parts.length; i++) {
          var d = parts.slice(0, i).join('/') + '/';
          if (!known.some(function (k) { return k.indexOf(d) === 0; })) { name = d; break; }
        }
        if (shown.indexOf(name) === -1) shown.push(name);
      });
      return shown.sort();
    }

    // `git rm` deletes a folder once its last file has gone, as git does
    async function removeFileAndEmptyParents(p) {
      try { await fs.promises.unlink(p); } catch (e) { return; }
      var d = fs._dirname(p);
      while (d !== dir && insideProject(d)) {
        try { await fs.promises.rmdir(d); } catch (e) { return; }
        d = fs._dirname(d);
      }
    }

    // path -> blob oid for everything in the staging area
    async function indexEntries() {
      var out = {};
      await gitlib.walk(opts({
        trees: [gitlib.STAGE()],
        map: async function (fp, entries) {
          if (!entries[0]) return null;
          if (fp !== '.' && (await entries[0].type()) === 'blob') out[fp] = await entries[0].oid();
          return true;
        }
      }));
      return out;
    }

    function ambiguous(word) {
      return {
        out: "fatal: ambiguous argument '" + word + "': unknown revision or path not in the working tree.\n" +
          "Use '--' to separate paths from revisions, like this:\n" +
          "'git <command> [<revision>...] -- [<file>...]'",
        ok: false
      };
    }

    // Is `spec` a path git could mean: on disk, staged, or in the last commit?
    async function knownPath(spec) {
      var match = pathspec(spec);
      if (!match) return false;
      try { await fs.promises.stat(abs(spec)); return true; } catch (e) {}
      var pool = await gitlib.listFiles(opts());
      try { pool = pool.concat(Object.keys(await flatTree(await gitlib.resolveRef(opts({ ref: 'HEAD' }))))); } catch (e) {}
      return pool.some(match);
    }

    // What `git reset` prints after it has unstaged things: every tracked
    // file whose working copy now differs from the staging area.
    async function unstagedSummary() {
      var st = await statusModel();
      var rows = st.modified.map(function (f) { return 'M\t' + f; })
        .concat(st.deleted.map(function (f) { return 'D\t' + f; }));
      rows.sort(function (a, b) { return a.slice(2) < b.slice(2) ? -1 : 1; });
      return rows.length ? 'Unstaged changes after reset:\n' + rows.join('\n') : '';
    }

    // Put the staged copy of each matching path back to how commit `oid`
    // has it (or take it out of the staging area, if `oid` lacks it or
    // there is no commit yet). Shared by `git reset <path>` and
    // `git restore --staged <path>`; the working files are not touched.
    async function unstagePaths(specs, oid, verb) {
      var pool = {};
      (await gitlib.listFiles(opts())).forEach(function (f) { pool[f] = true; });
      if (oid) Object.keys(await flatTree(oid)).forEach(function (f) { pool[f] = true; });
      var hits = [];
      for (var i = 0; i < specs.length; i++) {
        var match = pathspec(specs[i]);
        var h = match ? Object.keys(pool).filter(match) : [];
        if (!h.length) {
          return verb === 'reset'
            ? ambiguous(specs[i])
            : { out: "error: pathspec '" + specs[i] + "' did not match any file(s) known to git", ok: false };
        }
        h.forEach(function (f) { if (hits.indexOf(f) === -1) hits.push(f); });
      }
      for (var j = 0; j < hits.length; j++) {
        if (oid) await gitlib.resetIndex(opts({ filepath: hits[j], ref: oid }));
        else await gitlib.remove(opts({ filepath: hits[j] }));
      }
      await markResolved(hits);
      return { out: verb === 'reset' ? await unstagedSummary() : '', ok: true };
    }

    // `git reset [--soft|--mixed|--hard] <commit>`: move the current branch
    // (or a detached HEAD) to `oid`; --mixed also resets the staging area
    // to it, --hard the working files too. Any merge in progress is
    // dropped, as in git.
    async function resetTo2(oid, mode) {
      var branch = await currentBranch();
      var tracked = await gitlib.listFiles(opts());
      await gitlib.writeRef(opts(branch
        ? { ref: 'refs/heads/' + branch, value: oid, force: true }
        : { ref: 'HEAD', value: oid, force: true }));
      await clearMergeState();
      if (mode === 'soft') return { out: '', ok: true };
      var target = await flatTree(oid);
      if (mode === 'hard') {
        await gitlib.checkout(opts({ ref: branch || oid, force: true }));
        // files git tracked that the commit does not have go away
        for (var i = 0; i < tracked.length; i++) {
          if (!target[tracked[i]]) await removeFileAndEmptyParents(dir + '/' + tracked[i]);
        }
        return { out: 'HEAD is now at ' + oid.slice(0, 7) + ' ' + await subjectOf(oid), ok: true };
      }
      var all = {};
      tracked.concat(Object.keys(target)).forEach(function (f) { all[f] = true; });
      var paths = Object.keys(all);
      for (var j = 0; j < paths.length; j++) await gitlib.resetIndex(opts({ filepath: paths[j], ref: oid }));
      return { out: await unstagedSummary(), ok: true };
    }

    // .git/config as `git config --list` prints it: section.key=value
    async function localConfigLines() {
      var text = '';
      try { text = await fs.promises.readFile(dir + '/.git/config', 'utf8'); } catch (e) { return []; }
      var out = [], section = '';
      text.split('\n').forEach(function (line) {
        var sec = /^\s*\[([^\s\]"]+)(?:\s+"([^"]*)")?\]/.exec(line);
        if (sec) { section = sec[1].toLowerCase() + (sec[2] !== undefined ? '.' + sec[2] : ''); return; }
        var kv = /^\s*([A-Za-z][\w-]*)\s*=\s*(.*)$/.exec(line);
        if (kv && section) out.push(section + '.' + kv[1].toLowerCase() + '=' + kv[2].trim());
      });
      return out;
    }

    /* ---------------------------- commits --------------------------- */

    async function makeCommit(msg, st) {
      var o = { message: msg, author: { name: author.name, email: author.email } };
      var merge = await mergeState();
      var root = false;
      try { await gitlib.resolveRef(opts({ ref: 'HEAD' })); } catch (e) { root = true; }
      // concluding a conflicted merge: the commit gets both parents
      if (merge) o.parent = [await gitlib.resolveRef(opts({ ref: 'HEAD' })), merge.oid];
      var sha = await gitlib.commit(opts(o));
      var branch = await currentBranch();
      if (merge) {
        await clearMergeState();
        mergesDone.push({ from: merge.from, into: merge.into });
      }
      var nFiles = st.staged.length + st.stagedDeleted.length;
      return {
        out: '[' + (branch || 'detached HEAD') + (root ? ' (root-commit)' : '') + ' ' + sha.slice(0, 7) + '] ' + msg.split('\n')[0] + '\n ' + nFiles + ' file' + (nFiles === 1 ? '' : 's') + ' changed',
        ok: true
      };
    }

    // Can `git commit` go ahead? Null if so, else the refusal. A merge
    // commit may record no change of its own (the learner kept their side
    // of every conflict), so only an ordinary commit needs something staged.
    async function commitBlocker(st) {
      if (st.conflicted.length) return unmergedError('Committing');
      if (st.merging || st.staged.length || st.stagedDeleted.length) return null;
      var extra = st.untracked.length || st.modified.length
        ? '\nUse `git add <file>` to stage changes first.' : '';
      return { out: (await headLine()) + '\nnothing to commit, working tree clean' + extra, ok: false };
    }

    // what `git commit` without -m puts in the editor, as real git does
    async function commitTemplate(st) {
      var merge = await mergeState();
      var lines = merge ? [merge.message, ''] : [''];
      if (merge && merge.files.length) {
        lines.push('# Conflicts:');
        merge.files.forEach(function (f) { lines.push('#\t' + f); });
        lines.push('#');
      }
      lines = lines.concat([
        '# Please enter the commit message for your changes. Lines starting',
        "# with '#' will be ignored, and an empty message aborts the commit.",
        '#',
        '# ' + (await headLine())
      ]);
      if (merge) lines.push('# All conflicts fixed but you are still merging.');
      lines = lines.concat([
        '#',
        '# Changes to be committed:'
      ]);
      st.staged.forEach(function (s) { lines.push('#\t' + s.kind + ':   ' + s.file); });
      st.stagedDeleted.forEach(function (f) { lines.push('#\tdeleted:    ' + f); });
      lines.push('#');
      return lines.join('\n') + '\n';
    }

    // Second half of an editor commit: `text` is the saved COMMIT_EDITMSG,
    // or null if the editor quit without saving.
    async function finishCommit(text) {
      var msg = String(text == null ? '' : text).split('\n')
        .filter(function (l) { return l.charAt(0) !== '#'; })
        .map(function (l) { return l.replace(/\s+$/, ''); })
        .join('\n').replace(/^\n+|\n+$/g, '');
      if (!msg) return { out: 'Aborting commit due to empty commit message.', ok: false, kind: 'git' };
      var st = await statusModel();
      var blocked = await commitBlocker(st);
      if (blocked) {
        blocked.kind = 'git';
        return blocked;
      }
      var r = await makeCommit(msg, st);
      r.kind = 'git';
      return r;
    }

    /* -------------------------- git commands ----------------------- */

    async function gitCommand(args) {
      var sub = args[0];
      var rest = args.slice(1);

      if (!sub) return { out: usageGit(), ok: false };

      // `git <command> -h` works anywhere, even outside a repository.
      // Real git exits with 129 here; the sandbox counts it as success so
      // the text is not shown as an error, and `> file` captures it.
      if (rest.length === 1 && (rest[0] === '-h' || rest[0] === '--help') && HELP[sub]) {
        return { out: HELP[sub].join('\n'), ok: true };
      }
      if (sub === 'help' && rest[0] && HELP[rest[0]]) return { out: HELP[rest[0]].join('\n'), ok: true };

      if (sub !== 'init' && sub !== 'clone' && sub !== 'help' && sub !== 'config' && !(await isRepo())) {
        return { out: 'fatal: not a git repository (or any of the parent directories): .git\nHint: run `git init` first.', ok: false };
      }

      switch (sub) {
        case 'init': {
          if (cwd !== dir && !(await isRepo())) {
            return { out: 'This sandbox keeps the repository at the top of the project.\nRun `cd ~` first, then `git init`.', ok: false };
          }
          if (await isRepo()) return { out: 'Reinitialized existing Git repository in ' + displayDir + '/.git/', ok: true };
          var initial = globalConfig['init.defaultbranch'] || defaultBranch;
          for (var ib = 0; ib < rest.length; ib++) {
            if (rest[ib] === '-b' || rest[ib] === '--initial-branch') initial = rest[++ib] || initial;
            else if (rest[ib].indexOf('--initial-branch=') === 0) initial = rest[ib].slice(17);
          }
          await gitlib.init(opts({ defaultBranch: initial }));
          detachPoint = null;
          prevHead = null;
          repoReady = true;
          return { out: 'Initialized empty Git repository in ' + displayDir + '/.git/', ok: true };
        }

        case 'config': {
          var global = false, list = false, unset = false;
          var cw = [];
          // git 2.46+ spells the actions as subcommands: list, get, set, unset
          var action = ['list', 'get', 'set', 'unset'].indexOf(rest[0]) !== -1 ? rest[0] : null;
          if (action === 'list') list = true;
          if (action === 'unset') unset = true;
          rest.slice(action ? 1 : 0).forEach(function (a) {
            if (a === '--global' || a === '--system') global = true;
            else if (a === '-l' || a === '--list') list = true;
            else if (a === '--unset') unset = true;
            else if (a === '--local' || a === '--get' || a === '--add' || a === '--replace-all') { /* the default */ }
            else cw.push(a);
          });
          var inRepo = await isRepo();
          if (list) {
            var all = ['user.name=' + author.name, 'user.email=' + author.email];
            Object.keys(globalConfig).sort().forEach(function (k) { all.push(k + '=' + globalConfig[k]); });
            if (!global && inRepo) all = all.concat(await localConfigLines());
            return { out: all.join('\n'), ok: true };
          }
          if (!cw.length) return { out: HELP.config.join('\n'), ok: false };
          var key = cw[0];
          // section and variable names are case-insensitive in git
          var lk = key.toLowerCase();
          if (lk.indexOf('.') <= 0 || lk.charAt(lk.length - 1) === '.') {
            return { out: 'error: key does not contain a section: ' + key, ok: false };
          }
          var value = cw.length > 1 ? cw.slice(1).join(' ') : null;
          if (action === 'get' && value !== null) return { out: 'error: wrong number of arguments, should be 1', ok: false };
          if (action === 'set' && value === null) return { out: 'error: wrong number of arguments, should be 2', ok: false };
          // user.name and user.email sign the sandbox's commits, whichever file they are set in
          if (lk === 'user.name' || lk === 'user.email') {
            var field = lk === 'user.name' ? 'name' : 'email';
            if (value === null && !unset) return { out: author[field], ok: true };
            author[field] = unset ? (field === 'name' ? 'Your Name' : 'you@example.com') : value;
            return { out: '', ok: true };
          }
          if (!global && !inRepo) {
            if (value === null && !unset && lk in globalConfig) return { out: globalConfig[lk], ok: true };
            return { out: 'fatal: not in a git directory', ok: false };
          }
          if (global) {
            if (unset) delete globalConfig[lk];
            else if (value === null) return lk in globalConfig ? { out: globalConfig[lk], ok: true } : { out: '', ok: false };
            else globalConfig[lk] = value;
            return { out: '', ok: true };
          }
          if (unset) { await gitlib.setConfig(opts({ path: key, value: undefined })); return { out: '', ok: true }; }
          if (value === null) {
            var got = await gitlib.getConfig(opts({ path: key }));
            if (got === undefined || got === null) {
              return lk in globalConfig ? { out: globalConfig[lk], ok: true } : { out: '', ok: false };
            }
            return { out: String(got), ok: true };
          }
          await gitlib.setConfig(opts({ path: key, value: value }));
          return { out: '', ok: true };
        }

        case 'status': {
          var st = await statusModel();
          var lines = [await headLine()];
          var stBranch = await currentBranch();
          if (stBranch) lines = lines.concat(await trackingLines(stBranch));
          var anyCommit = true;
          try { await gitlib.resolveRef(opts({ ref: 'HEAD' })); }
          catch (e) { anyCommit = false; }
          if (!anyCommit) lines.push('', 'No commits yet');
          if (st.conflicted.length) {
            lines.push('You have unmerged paths.',
              '  (fix conflicts and run "git commit")',
              '  (use "git merge --abort" to abort the merge)');
          } else if (st.merging) {
            lines.push('All conflicts fixed but you are still merging.',
              '  (use "git commit" to conclude merge)');
          }

          if (st.staged.length || st.stagedDeleted.length) {
            lines.push('', 'Changes to be committed:',
              anyCommit ? '  (use "git restore --staged <file>..." to unstage)' : '  (use "git rm --cached <file>..." to unstage)');
            st.staged.forEach(function (s) { lines.push('  {g}' + s.kind + ':   ' + s.file + '{/}'); });
            st.stagedDeleted.forEach(function (f) { lines.push('  {g}deleted:    ' + f + '{/}'); });
          }
          if (st.conflicted.length) {
            lines.push('', 'Unmerged paths:', '  (use "git add <file>..." to mark resolution)');
            st.conflicted.forEach(function (c) { lines.push('  {r}' + c.kind + ':   ' + c.file + '{/}'); });
          }
          if (st.modified.length || st.deleted.length) {
            lines.push('', 'Changes not staged for commit:',
              '  (use "git ' + (st.deleted.length ? 'add/rm' : 'add') + ' <file>..." to update what will be committed)',
              '  (use "git restore <file>..." to discard changes in working directory)');
            st.modified.forEach(function (f) { lines.push('  {r}modified:   ' + f + '{/}'); });
            st.deleted.forEach(function (f) { lines.push('  {r}deleted:    ' + f + '{/}'); });
          }
          if (st.untracked.length) {
            lines.push('', 'Untracked files:', '  (use "git add <file>..." to include in what will be committed)');
            (await untrackedShown(st.untracked)).forEach(function (f) { lines.push('  {r}' + f + '{/}'); });
          }
          if (rest.indexOf('--ignored') !== -1 && st.ignored.length) {
            lines.push('', 'Ignored files:', '  (use "git add -f <file>..." to include in what will be committed)');
            (await untrackedShown(st.ignored, st.untracked)).forEach(function (f) { lines.push('  {r}' + f + '{/}'); });
          }
          var anyStaged = st.staged.length || st.stagedDeleted.length;
          if (!anyStaged) {
            if (st.modified.length || st.deleted.length || st.conflicted.length) {
              lines.push('', 'no changes added to commit (use "git add" and/or "git commit -a")');
            } else if (st.untracked.length) {
              lines.push('', 'nothing added to commit but untracked files present (use "git add" to track)');
            } else if (!anyCommit) {
              lines.push('', 'nothing to commit (create/copy files and use "git add" to track)');
            } else {
              lines.push('', 'nothing to commit, working tree clean');
            }
          }
          return { out: lines.join('\n'), ok: true };
        }

        case 'add': {
          if (!rest.length) return { out: "Nothing specified, nothing added.\nhint: try 'git add .' or 'git add <file>'", ok: false };
          var added = [];
          // statusMatrix leaves out files .gitignore matches; -f takes them too
          var force = rest.indexOf('-f') !== -1 || rest.indexOf('--force') !== -1;
          var m = await gitlib.statusMatrix(opts());
          var st0 = await statusModel();
          var conflictedNow = st0.conflicted.map(function (c) { return c.file; });
          var ignoredNamed = [];
          for (var i = 0; i < rest.length; i++) {
            var spec = rest[i];
            if (spec === '--' || (spec.charAt(0) === '-' && spec !== '-A' && spec !== '--all')) continue;
            // -A is repo-wide; `.` means here and below, as in real git
            var match = spec === '-A' || spec === '--all' ? pathspec(dir) : pathspec(spec);
            if (!match) return { out: "fatal: " + spec + ": '" + spec + "' is outside repository at '" + displayDir + "'", ok: false };
            var hit = m.filter(function (row) { return match(row[0]); }).map(function (row) { return row[0]; });
            // a conflicted file the learner deleted: staging the deletion resolves it
            conflictedNow.forEach(function (c) { if (match(c) && hit.indexOf(c) === -1) hit.push(c); });
            if (force) {
              st0.ignored.forEach(function (f) {
                if (match(f) && hit.indexOf(f) === -1) hit.push(f);
              });
            }
            if (!hit.length) {
              var exists = true;
              try { await fs.promises.stat(abs(spec)); } catch (e) { exists = false; }
              // Naming an ignored file outright is refused (but the other
              // paths still go in); a folder or glob that only reaches
              // ignored files just matches nothing, as in real git.
              if (exists && !hasGlob(spec) && await gitlib.isIgnored(opts({ filepath: rel(spec) }))) {
                ignoredNamed.push(spec);
                continue;
              }
              if (exists) continue;    // an empty folder: nothing to add, no complaint
              return { out: "fatal: pathspec '" + spec + "' did not match any files", ok: false };
            }
            for (var j = 0; j < hit.length; j++) {
              var gone = true;
              try { gone = !(await fs.promises.stat(dir + '/' + hit[j])).isFile(); } catch (e) {}
              if (gone) await gitlib.remove(opts({ filepath: hit[j] }));
              else await gitlib.add(opts({ filepath: hit[j], force: force }));
              added.push(hit[j]);
            }
          }
          await markResolved(added);
          if (ignoredNamed.length) {
            return {
              out: 'The following paths are ignored by one of your .gitignore files:\n' +
                ignoredNamed.join('\n') + '\n' +
                '{y}hint: Use -f if you really want to add them.{/}',
              ok: false
            };
          }
          return { out: '', ok: true, silentNote: added.length + ' path(s) staged' };
        }

        case 'rm': {
          var cached = rest.indexOf('--cached') !== -1;
          var recursive = rest.some(function (a) { return /^-[a-zA-Z]*r/.test(a) && a.charAt(1) !== '-'; });
          var dashes = rest.indexOf('--');
          var rmSpecs = rest.filter(function (a, n) { return (dashes !== -1 && n > dashes) || (a.charAt(0) !== '-'); });
          if (!rmSpecs.length) return { out: 'usage: git rm [--cached] [-r] [--] <file>...', ok: false };
          // only what git tracks can be removed: the index, plus files
          // still in conflict
          var inIndex = await gitlib.listFiles(opts());
          (await mergeState() || { unresolved: [] }).unresolved.forEach(function (c) {
            if (inIndex.indexOf(c.file) === -1) inIndex.push(c.file);
          });
          var doomed = [];
          // check every path first: git removes nothing if one is wrong
          for (var ri = 0; ri < rmSpecs.length; ri++) {
            var rmMatch = pathspec(rmSpecs[ri]);
            var rmHit = rmMatch ? inIndex.filter(rmMatch) : [];
            if (!rmHit.length) return { out: "fatal: pathspec '" + rmSpecs[ri] + "' did not match any files", ok: false };
            if (!recursive && !hasGlob(rmSpecs[ri]) && rmHit.some(function (f) { return f !== rel(rmSpecs[ri]); })) {
              return { out: "fatal: not removing '" + rmSpecs[ri] + "' recursively without -r", ok: false };
            }
            rmHit.forEach(function (f) { if (doomed.indexOf(f) === -1) doomed.push(f); });
          }
          doomed.sort();
          for (var rd = 0; rd < doomed.length; rd++) {
            await gitlib.remove(opts({ filepath: doomed[rd] }));
            // --cached takes the file out of git only; it stays on disk
            if (!cached) await removeFileAndEmptyParents(dir + '/' + doomed[rd]);
          }
          await markResolved(doomed);
          return { out: doomed.map(function (f) { return "rm '" + f + "'"; }).join('\n'), ok: true };
        }

        case 'check-ignore': {
          var ciPaths = rest.filter(function (a) { return a.charAt(0) !== '-'; });
          if (!ciPaths.length) return { out: 'fatal: no path specified', ok: false };
          var ignoredOnes = [];
          for (var ci = 0; ci < ciPaths.length; ci++) {
            if (await gitlib.isIgnored(opts({ filepath: rel(ciPaths[ci]) }))) ignoredOnes.push(ciPaths[ci]);
          }
          // like git: prints the ignored ones, and fails if there were none
          return { out: ignoredOnes.join('\n'), ok: ignoredOnes.length > 0 };
        }

        case 'commit': {
          // each -m is a paragraph of the message, as in git
          var msgs = [];
          var stageAll = false;
          for (var k = 0; k < rest.length; k++) {
            var ca = rest[k];
            if (ca === '-m' || ca === '--message') { msgs.push(rest[++k] || ''); continue; }
            if (ca.indexOf('--message=') === 0) { msgs.push(ca.slice(10)); continue; }
            if (ca === '-a' || ca === '--all') { stageAll = true; continue; }
            // bundled short options, as in `-am "message"` or `-mText`
            if (/^-[a-zA-Z]/.test(ca)) {
              for (var ck = 1; ck < ca.length; ck++) {
                if (ca.charAt(ck) === 'a') stageAll = true;
                else if (ca.charAt(ck) === 'm') {
                  msgs.push(ck + 1 < ca.length ? ca.slice(ck + 1) : (rest[++k] || ''));
                  break;
                }
              }
            }
          }
          var msg = msgs.length ? msgs.filter(Boolean).join('\n\n') : null;
          if (msg === '') return { out: 'Aborting commit due to empty commit message.', ok: false };
          var st2 = await statusModel();
          if (st2.conflicted.length) return unmergedError('Committing');
          if (stageAll) {
            // -a stages every change to a file git already tracks, never
            // an untracked one
            var cm = await gitlib.statusMatrix(opts());
            for (var cr = 0; cr < cm.length; cr++) {
              if (cm[cr][1] === 0 && cm[cr][3] === 0) continue;
              if (cm[cr][2] === 0) await gitlib.remove(opts({ filepath: cm[cr][0] }));
              else await gitlib.add(opts({ filepath: cm[cr][0] }));
            }
            st2 = await statusModel();
          }
          var blocked = await commitBlocker(st2);
          if (blocked) return blocked;
          if (msg === null) {
            // Without -m, real git opens an editor (usually vim) on
            // COMMIT_EDITMSG. The engine has no screen, so it hands the
            // template back; the UI runs the editor and passes what was
            // saved to finishCommit. Nothing has changed yet.
            return { out: '', ok: true, editor: { file: '.git/COMMIT_EDITMSG', text: await commitTemplate(st2) } };
          }
          return makeCommit(msg, st2);
        }

        case 'log': {
          var oneline = rest.indexOf('--oneline') !== -1;
          // `git log origin/main`: start from a branch, remote-tracking
          // branch or commit instead of HEAD
          var logFrom = null;
          for (var lf = 0; lf < rest.length; lf++) {
            if (rest[lf] === '-n') { lf++; continue; }
            if (rest[lf].charAt(0) === '-') continue;
            var tn = trackingName(rest[lf]);
            logFrom = (tn && await trackingOid(tn)) || await resolveCommit(rest[lf]);
            if (!logFrom) {
              return { out: "fatal: ambiguous argument '" + rest[lf] + "': unknown revision or path not in the working tree.\n" +
                "Use '--' to separate paths from revisions, like this:\n" +
                "'git <command> [<revision>...] -- [<file>...]'", ok: false };
            }
            break;
          }
          var commits;
          try { commits = await gitlib.log(opts({ depth: 50, ref: logFrom || 'HEAD' })); }
          catch (e) { return { out: "fatal: your current branch does not have any commits yet", ok: false }; }
          if (!commits.length) return { out: 'fatal: your current branch does not have any commits yet', ok: false };
          // isomorphic-git's log revisits shared history once per merge parent
          var logSeen = {};
          commits = commits.filter(function (c) {
            if (logSeen[c.oid]) return false;
            logSeen[c.oid] = true;
            return true;
          });
          var g = await graphModel();
          // --all: every commit any branch or origin/* reaches, newest first
          if (rest.indexOf('--all') !== -1) {
            commits = [];
            for (var ga = 0; ga < g.commits.length; ga++) commits.push(await gitlib.readCommit(opts({ oid: g.commits[ga].oid })));
          }
          // -3, -n 3, --max-count=3
          var maxCount = null;
          for (var lr = 0; lr < rest.length; lr++) {
            if (/^-\d+$/.test(rest[lr])) maxCount = parseInt(rest[lr].slice(1), 10);
            else if (rest[lr] === '-n') maxCount = parseInt(rest[lr + 1], 10);
            else if (rest[lr].indexOf('--max-count=') === 0) maxCount = parseInt(rest[lr].slice(12), 10);
          }
          if (maxCount !== null && !isNaN(maxCount)) commits = commits.slice(0, maxCount);
          var refsByOid = {};
          g.commits.forEach(function (c) { if (c.refs.length) refsByOid[c.oid] = c.refs; });
          // a detached HEAD points at a commit, not a branch: `(HEAD, main)`
          if (g.detached) refsByOid[g.headOid] = [{ name: 'HEAD' }].concat(refsByOid[g.headOid] || []);
          var remoteHead = await originHead();
          var rhOid = remoteHead ? await trackingOid(remoteHead) : null;
          if (rhOid) refsByOid[rhOid] = (refsByOid[rhOid] || []).concat([{ name: 'origin/HEAD' }]);
          var outLines = [];
          commits.forEach(function (c) {
            var decor = refsByOid[c.oid]
              ? ' {y}(' + refsByOid[c.oid].slice().sort(function (x, y) { return (y.isHead || y.name === 'HEAD') - (x.isHead || x.name === 'HEAD'); })
                  .map(function (r) { return r.isHead ? 'HEAD -> ' + r.name : r.name; }).join(', ') + '){/}'
              : '';
            if (oneline) {
              outLines.push('{y}' + c.oid.slice(0, 7) + '{/}' + decor + ' ' + c.commit.message.split('\n')[0]);
            } else {
              outLines.push('{y}commit ' + c.oid + '{/}' + decor);
              outLines.push('Author: ' + c.commit.author.name + ' <' + c.commit.author.email + '>');
              outLines.push('Date:   ' + gitDate(c.commit.author));
              outLines.push('');
              outLines.push('    ' + c.commit.message.split('\n')[0]);
              outLines.push('');
            }
          });
          return { out: outLines.join('\n'), ok: true };
        }

        case 'branch': {
          var del = false, listAll = false, listRemote = false, upTo = null, unsetUp = false;
          var names = [];
          for (var bi = 0; bi < rest.length; bi++) {
            var ba = rest[bi];
            if (ba === '-d' || ba === '-D' || ba === '--delete') del = true;
            else if (ba === '-a' || ba === '--all') listAll = true;
            else if (ba === '-r' || ba === '--remotes') listRemote = true;
            else if (ba === '-u' || ba === '--set-upstream-to') upTo = rest[++bi] || '';
            else if (ba.indexOf('--set-upstream-to=') === 0) upTo = ba.slice(18);
            else if (ba === '--unset-upstream') unsetUp = true;
            else if (ba.charAt(0) !== '-') names.push(ba);
          }
          var all = await gitlib.listBranches(opts());
          var cur = await currentBranch();
          if (del && listRemote) {
            // `git branch -d -r origin/x` forgets a remote-tracking branch
            var gone = trackingName(names[0] || '');
            var goneOid = gone ? await trackingOid(gone) : null;
            if (!goneOid) return { out: "error: remote-tracking branch '" + (names[0] || '') + "' not found.", ok: false };
            await gitlib.deleteRef(opts({ ref: 'refs/remotes/origin/' + gone }));
            return { out: 'Deleted remote-tracking branch origin/' + gone + ' (was ' + goneOid.slice(0, 7) + ').', ok: true };
          }
          if (del) {
            if (!names.length) return { out: 'fatal: branch name required', ok: false };
            if (names[0] === cur) return { out: "error: cannot delete branch '" + names[0] + "' checked out at '" + displayDir + "'", ok: false };
            if (all.indexOf(names[0]) === -1) return { out: "error: branch '" + names[0] + "' not found.", ok: false };
            var delOid = await gitlib.resolveRef(opts({ ref: names[0] }));
            await gitlib.deleteBranch(opts({ ref: names[0] }));
            await setUpstream(names[0], null);
            return { out: 'Deleted branch ' + names[0] + ' (was ' + delOid.slice(0, 7) + ').', ok: true };
          }
          if (upTo !== null || unsetUp) {
            var forBranch = names[0] || cur;
            if (!forBranch) return { out: 'fatal: could not set upstream of HEAD when it does not point to any branch.', ok: false };
            if (all.indexOf(forBranch) === -1) return { out: "fatal: branch '" + forBranch + "' does not exist", ok: false };
            if (unsetUp) {
              if (!(await upstreamOf(forBranch))) return { out: "fatal: branch '" + forBranch + "' has no upstream information", ok: false };
              await setUpstream(forBranch, null);
              return { out: '', ok: true };
            }
            var upName = trackingName(upTo);
            if (!upName || !(await trackingOid(upName))) {
              return {
                out: "fatal: the requested upstream branch '" + upTo + "' does not exist\n" +
                  'hint:\n' +
                  'hint: If you are planning on basing your work on an upstream\n' +
                  'hint: branch that already exists at the remote, you may need to\n' +
                  'hint: run "git fetch" to retrieve it.\n' +
                  'hint:\n' +
                  'hint: If you are planning to push out a new local branch that\n' +
                  'hint: will track its remote counterpart, you may want to use\n' +
                  'hint: "git push -u" to set the upstream config as you push.',
                ok: false
              };
            }
            await setUpstream(forBranch, upName);
            return { out: "branch '" + forBranch + "' set up to track 'origin/" + upName + "'.", ok: true };
          }
          if (!names.length) {
            var listed = listRemote ? [] : all.map(function (b) { return b === cur ? '{g}* ' + b + '{/}' : '  ' + b; });
            if (!listRemote && !cur && all.length) listed.unshift('{g}* (' + (await headLine()) + '){/}');
            if (listAll || listRemote) {
              var oh = await originHead();
              if (oh) listed.push('  {r}' + (listAll ? 'remotes/' : '') + 'origin/HEAD{/} -> origin/' + oh);
              (await trackingNames()).forEach(function (t) {
                listed.push('  {r}' + (listAll ? 'remotes/' : '') + 'origin/' + t + '{/}');
              });
            }
            return { out: listed.join('\n'), ok: true };
          }
          if (all.indexOf(names[0]) !== -1) return { out: "fatal: a branch named '" + names[0] + "' already exists", ok: false };
          if (names[1]) {
            // `git branch <name> <start-point>`; starting from origin/x tracks it
            var start = await startPoint(names[1]);
            if (!start) return { out: "fatal: not a valid object name: '" + names[1] + "'", ok: false };
            await gitlib.writeRef(opts({ ref: 'refs/heads/' + names[0], value: start.oid }));
            if (start.tracks) {
              await setUpstream(names[0], start.tracks);
              return { out: "branch '" + names[0] + "' set up to track 'origin/" + start.tracks + "'.", ok: true };
            }
            return { out: '', ok: true, silentNote: 'created branch ' + names[0] };
          }
          try { await gitlib.branch(opts({ ref: names[0] })); }
          catch (e) { return { out: 'fatal: ' + e.message, ok: false }; }
          return { out: '', ok: true, silentNote: 'created branch ' + names[0] };
        }

        case 'switch':
        case 'checkout': {
          var create = null, track = false, detach = false, names2 = [];
          for (var si = 0; si < rest.length; si++) {
            var sa = rest[si];
            if (sa === '-b' || sa === '-c' || sa === '--create') {
              create = rest[++si];
              if (!create) return { out: "error: switch `" + sa.replace(/^-+/, '') + "' requires a value", ok: false };
            }
            else if (sa === '-t' || sa === '--track') track = true;
            else if (sa === '--detach' || sa === '-d') detach = true;
            else if (sa === '-' || sa.charAt(0) !== '-') names2.push(sa);
          }
          // `--track origin/x` names the new branch after the remote one
          if (track && !create) {
            if (!names2[0] || !trackingName(names2[0])) {
              return { out: 'fatal: missing branch name; try -' + (sub === 'switch' ? 'c' : 'b'), ok: false };
            }
            create = trackingName(names2[0]);
          }
          if (!create && !names2.length) return { out: 'fatal: missing branch name', ok: false };
          var name = names2[0];
          // `-` is the branch (or commit) you were on before
          if (name === '-' && !create) {
            if (!prevHead) return { out: 'fatal: invalid reference: @{-1}', ok: false };
            name = prevHead;
            // back to a detached commit: checkout does that; switch wants --detach
            if (/^[0-9a-f]{40}$/.test(name) && sub === 'checkout') detach = true;
          }
          var all2 = await gitlib.listBranches(opts());
          var midMerge = await statusModel();
          if (midMerge.conflicted.length) {
            return {
              out: 'error: you need to resolve your current index first\n' +
                midMerge.conflicted.map(function (c) { return c.file + ': needs merge'; }).join('\n'),
              ok: false
            };
          }
          // What to switch to: an existing branch (target2 null), a new
          // branch at newStart, or a commit to detach at (target2).
          var target2 = null, newStart = null;
          if (!create && !detach && all2.indexOf(name) === -1 && await trackingOid(name)) {
            // git's guess: `git switch feature` when only origin/feature exists
            create = name;
            name = 'origin/' + name;
          }
          if (create) {
            if (all2.indexOf(create) !== -1) return { out: "fatal: a branch named '" + create + "' already exists", ok: false };
            if (name) {
              newStart = await startPoint(name);
              if (!newStart) {
                return { out: "fatal: '" + name + "' is not a commit and a branch '" + create + "' cannot be created from it", ok: false };
              }
            }
          } else {
            target2 = all2.indexOf(name) !== -1 && !detach ? null : await resolveCommit(name);
            if (all2.indexOf(name) === -1 && !target2) {
              return { out: (sub === 'switch' ? 'fatal: invalid reference: ' + name
                  : "error: pathspec '" + name + "' did not match any file(s) known to git") +
                '\nhint: use `git ' + sub + ' ' + (sub === 'switch' ? '-c ' : '-b ') + name + '` to create it', ok: false };
            }
            // `git switch` only moves between branches unless told to detach
            if (target2 && sub === 'switch' && !detach) {
              return { out: "fatal: a branch is expected, got commit '" + name + "'\n" +
                'hint: If you want to detach HEAD at the commit, try again with the --detach option.', ok: false };
            }
          }
          var wasBranch = await currentBranch();
          var wasOid = null;
          try { wasOid = await gitlib.resolveRef(opts({ ref: 'HEAD' })); } catch (e) {}
          if (create && !newStart) {
            // a new branch right here: nothing to check out, and it works
            // before the first commit too
            if (midMerge.merging) await clearMergeState();
            await gitlib.branch(opts({ ref: create, checkout: true }));
            prevHead = wasBranch || wasOid;
            return { out: "Switched to a new branch '" + create + "'", ok: true };
          }
          var branchTo = create || (target2 ? null : name);
          var newOid = target2 || (newStart ? newStart.oid : await gitlib.resolveRef(opts({ ref: name })));
          var clobbered = midMerge.merging ? [] : await overwrittenBy(newOid, midMerge);
          if (clobbered.length) {
            return { out: 'error: Your local changes to the following files would be overwritten by checkout:\n' +
              clobbered.map(function (f) { return '\t' + f; }).join('\n') + '\n' +
              'Please commit your changes or stash them before you switch branches.\nAborting', ok: false };
          }
          if (branchTo && branchTo === wasBranch) {
            return { out: "Already on '" + branchTo + "'" + prefixLines(await trackingLines(branchTo)), ok: true };
          }
          if (midMerge.merging) await clearMergeState();
          var tracksNote = '';
          if (create) {
            await gitlib.writeRef(opts({ ref: 'refs/heads/' + create, value: newOid }));
            // starting from origin/x sets it as the upstream, as git does
            if (newStart.tracks) {
              await setUpstream(create, newStart.tracks);
              tracksNote = "\nbranch '" + create + "' set up to track 'origin/" + newStart.tracks + "'.";
            }
          }
          // isomorphic-git's checkout rewrites the index and working tree
          // even when the target is the commit we are already on, dropping
          // staged and modified files; real git carries them over, so when
          // nothing differs only HEAD moves
          if (wasOid && wasOid === newOid) {
            await gitlib.writeRef(opts(target2 ? { ref: 'HEAD', value: target2, force: true }
              : { ref: 'HEAD', value: 'refs/heads/' + branchTo, symbolic: true, force: true }));
          } else {
            try { await gitlib.checkout(opts({ ref: target2 || branchTo })); }
            catch (e) { return { out: 'fatal: ' + e.message, ok: false }; }
          }
          prevHead = wasBranch || wasOid;
          var leaving = !wasBranch && wasOid && wasOid !== target2 ? await leavingDetached(wasOid) : '';
          if (create) return { out: leaving + "Switched to a new branch '" + create + "'" + tracksNote, ok: true };
          if (!target2) {
            return { out: leaving + "Switched to branch '" + name + "'" + prefixLines(await trackingLines(name)), ok: true };
          }
          detachPoint = target2;
          var landed = 'HEAD is now at ' + target2.slice(0, 7) + ' ' + await subjectOf(target2);
          if (!wasBranch) return { out: leaving + landed, ok: true };
          return {
            out: "Note: switching to '" + name + "'.\n\n" +
              "{y}You are in 'detached HEAD' state.{/} You can look around, make experimental\n" +
              'changes and commit them, and you can discard any commits you make in this\n' +
              'state without impacting any branches by switching back to a branch.\n\n' +
              'If you want to create a new branch to retain commits you create, you may\n' +
              'do so (now or later) by using -c with the switch command. Example:\n\n' +
              '  git switch -c <new-branch-name>\n\n' +
              'Or undo this operation with:\n\n' +
              '  git switch -\n\n' +
              'Turn off this advice by setting config variable advice.detachedHead to false\n\n' +
              landed,
            ok: true
          };
        }

        case 'merge': {
          var inMerge = await statusModel();
          if (rest[0] === '--abort') {
            if (!inMerge.merging) return { out: 'fatal: There is no merge to abort (MERGE_HEAD missing).', ok: false };
            // back to the last commit, as `git reset --merge` does; files the
            // merge brought in are staged, so the forced checkout drops them
            await gitlib.checkout(opts({ ref: await currentBranch(), force: true }));
            await clearMergeState();
            return { out: '', ok: true };
          }
          if (rest[0] === '--continue') {
            if (!inMerge.merging) return { out: 'fatal: There is no merge in progress (MERGE_HEAD missing).', ok: false };
            return gitCommand(['commit']);
          }
          if (inMerge.conflicted.length) return unmergedError('Merging');
          if (inMerge.merging) {
            return { out: 'fatal: You have not concluded your merge (MERGE_HEAD exists).\n' +
              'Please, commit your changes before you merge.', ok: false };
          }
          var theirs = rest.filter(function (a) { return a.charAt(0) !== '-'; })[0];
          if (!theirs) return { out: 'usage: git merge <branch>', ok: false };
          var ours = await currentBranch();
          if (!ours) {
            return { out: 'fatal: this sandbox can only merge into a branch, and HEAD is detached.\n' +
              'Switch to a branch first, or create one here with `git switch -c <name>`.', ok: false };
          }
          if (theirs === ours) return { out: 'Already up to date.', ok: true };
          // a local branch, a remote-tracking branch such as origin/main
          // (what `git fetch` brought in), or any commit
          var known = await gitlib.listBranches(opts());
          var theirRef = null, mergeMsg;
          // git leaves " into main" out of the message (merge.suppressDest)
          var into = ours === 'main' || ours === 'master' ? '' : ' into ' + ours;
          if (known.indexOf(theirs) !== -1) {
            theirRef = theirs;
            mergeMsg = "Merge branch '" + theirs + "'" + into;
          } else if (trackingName(theirs) && await trackingOid(trackingName(theirs))) {
            theirRef = 'refs/remotes/origin/' + trackingName(theirs);
            mergeMsg = "Merge remote-tracking branch '" + theirs + "'" + into;
          } else {
            theirRef = await resolveCommit(theirs);
            mergeMsg = "Merge commit '" + theirs + "'" + into;
          }
          if (!theirRef) return { out: 'merge: ' + theirs + ' - not something we can merge', ok: false };
          var oursBefore = await gitlib.resolveRef(opts({ ref: ours }));
          var result;
          try {
            result = await mergeInto(ours, theirRef, theirs, mergeMsg);
          } catch (e) {
            return { out: 'fatal: ' + e.message, ok: false };
          }
          if (result.conflict) return result.conflict;
          if (result.alreadyMerged) return { out: 'Already up to date.', ok: true };
          if (result.fastForward) return { out: 'Updating ' + oursBefore.slice(0, 7) + '..' + (result.oid || '').slice(0, 7) + '\nFast-forward', ok: true };
          return { out: "Merge made by the 'ort' strategy.", ok: true };
        }

        case 'remote': {
          var linked = await originUrl();
          if (rest[0] === 'add') {
            if (!rest[1] || !rest[2]) return { out: 'usage: git remote add <name> <url>', ok: false };
            if (rest[1] !== 'origin') {
              return { out: 'This sandbox has a single remote, and it must be called origin:\n' +
                '  git remote add origin ' + rest[2], ok: false };
            }
            if (linked) return { out: 'error: remote origin already exists.', ok: false };
            // the first `remote add` creates the mock remote; after that
            // (say, in a fresh `git init`) it only links to it again
            if (!remoteUrl) {
              await gitlib.init({ fs: fs, gitdir: remoteGitdir, bare: true, defaultBranch: defaultBranch });
              remoteUrl = rest[2];
            }
            await gitlib.addRemote(opts({ remote: 'origin', url: rest[2] }));
            return { out: '', ok: true };
          }
          if (rest[0] === 'remove' || rest[0] === 'rm') {
            if (rest[1] !== 'origin' || !linked) return { out: "error: No such remote: '" + (rest[1] || '') + "'", ok: false };
            await gitlib.deleteRemote(opts({ remote: 'origin' }));
            await fs.promises.rm(dir + '/.git/refs/remotes/origin', { recursive: true, force: true });
            return { out: '', ok: true };
          }
          if (!rest.length) return { out: linked ? 'origin' : '', ok: true };
          if (rest[0] === '-v') {
            if (!linked) return { out: '', ok: true };
            return { out: 'origin\t' + linked + ' (fetch)\norigin\t' + linked + ' (push)', ok: true };
          }
          return { out: 'usage: git remote [-v] | git remote add origin <url> | git remote remove origin', ok: false };
        }

        case 'clone': {
          var cargs = rest.filter(function (a) { return a.charAt(0) !== '-'; });
          var curl = cargs[0];
          if (!curl) return { out: 'fatal: You must specify a repository to clone.\n\n' + HELP.clone.join('\n'), ok: false };
          if (cargs[1] && cargs[1] !== '.') {
            return { out: 'This sandbox keeps the repository in the project folder itself,\n' +
              'so `git clone <url>` clones into it, as `git clone <url> .` would.', ok: false };
          }
          if (cwd !== dir) {
            return { out: 'This sandbox keeps the repository at the top of the project.\nRun `cd ~` first, then `git clone`.', ok: false };
          }
          if (!remoteUrl || urlKey(curl) !== urlKey(remoteUrl)) {
            return { out: "fatal: repository '" + curl + "' does not exist" +
              (remoteUrl ? "\nhint: this exercise's remote is " + remoteUrl : ''), ok: false };
          }
          if ((await isRepo()) || (await fs.promises.readdir(dir)).length) {
            return { out: "fatal: destination path '.' already exists and is not an empty directory.", ok: false };
          }
          var rbranches = await listRemoteBranchNames();
          var rhead = null;
          try { rhead = (await fs.promises.readFile(remoteGitdir + '/HEAD', 'utf8')).replace(/^ref: refs\/heads\//, '').trim(); } catch (e) {}
          if (rbranches.indexOf(rhead) === -1) rhead = rbranches[0] || rhead || defaultBranch;
          await gitlib.init(opts({ defaultBranch: rhead }));
          await gitlib.addRemote(opts({ remote: 'origin', url: curl }));
          detachPoint = null;
          prevHead = null;
          if (!rbranches.length) {
            return { out: "Cloning into '.'...\nwarning: You appear to have cloned an empty repository.", ok: true };
          }
          await copyObjects(remoteGitdir, dir + '/.git');
          for (var cb = 0; cb < rbranches.length; cb++) await setTrackingRef(rbranches[cb], await remoteBranchOid(rbranches[cb]));
          // like git: one local branch, the remote's default, tracking it
          await gitlib.writeRef(opts({ ref: 'refs/heads/' + rhead, value: await remoteBranchOid(rhead) }));
          await gitlib.writeRef(opts({ ref: 'refs/remotes/origin/HEAD', value: 'refs/remotes/origin/' + rhead, symbolic: true }));
          await setUpstream(rhead, rhead);
          await gitlib.checkout(opts({ ref: rhead }));
          return { out: "Cloning into '.'...\ndone.", ok: true };
        }

        case 'push': {
          var pushUrl = await originUrl();
          if (!pushUrl) return { out: 'fatal: No configured push destination.\nAdd a remote first: git remote add origin <url>', ok: false };
          var setUp = rest.indexOf('-u') !== -1 || rest.indexOf('--set-upstream') !== -1;
          var words = rest.filter(function (a) { return a.charAt(0) !== '-'; });
          if (words[0] && words[0] !== 'origin') return { out: "fatal: '" + words[0] + "' does not appear to be a git repository", ok: false };
          var pbr = words[1] || (await currentBranch());
          if (!pbr) return { out: 'fatal: you are not currently on a branch.', ok: false };
          var locals = await gitlib.listBranches(opts());
          if (locals.indexOf(pbr) === -1) return { out: 'error: src refspec ' + pbr + ' does not match any', ok: false };
          if (!words[1] && !(await upstreamOf(pbr))) {
            return {
              out: 'fatal: The current branch ' + pbr + ' has no upstream branch.\n' +
                   'To push the current branch and set the remote as upstream, use\n\n' +
                   '    git push -u origin ' + pbr,
              ok: false
            };
          }
          var localOid = await gitlib.resolveRef(opts({ ref: pbr }));
          var remoteOid = await remoteBranchOid(pbr);
          var upNote = '';
          if (setUp && (await upstreamOf(pbr)) !== pbr) {
            await setUpstream(pbr, pbr);
            upNote = "branch '" + pbr + "' set up to track 'origin/" + pbr + "'.";
          }
          if (remoteOid === localOid) return { out: (upNote ? upNote + '\n' : '') + 'Everything up-to-date', ok: true };
          if (remoteOid) {
            // only fast-forward pushes are allowed, like a real remote
            var pushedSet = await reachableFrom(localOid, opts);
            if (!pushedSet[remoteOid]) {
              return {
                out: 'To ' + pushUrl + '\n' +
                     ' {r}! [rejected]{/}        ' + pbr + ' -> ' + pbr + ' (fetch first)\n' +
                     'hint: Updates were rejected because the remote contains work that you do\n' +
                     'hint: not have locally. Pull the remote changes ({y}git pull{/}) before pushing again.',
                ok: false
              };
            }
          }
          await copyObjects(dir + '/.git', remoteGitdir);
          await fs.promises.mkdir(remoteGitdir + '/refs/heads', { recursive: true });
          await fs.promises.writeFile(remoteGitdir + '/refs/heads/' + pbr, localOid + '\n');
          await setTrackingRef(pbr, localOid);
          var pushOut = ['To ' + pushUrl];
          pushOut.push(remoteOid
            ? '   ' + remoteOid.slice(0, 7) + '..' + localOid.slice(0, 7) + '  ' + pbr + ' -> ' + pbr
            : ' * [new branch]      ' + pbr + ' -> ' + pbr);
          if (upNote) pushOut.push(upNote);
          return { out: pushOut.join('\n'), ok: true };
        }

        case 'fetch': {
          var fetchUrl = await originUrl();
          if (!fetchUrl) return { out: "fatal: 'origin' does not appear to be a git repository", ok: false };
          var rnames = await listRemoteBranchNames();
          await copyObjects(remoteGitdir, dir + '/.git');
          var updated = [];
          for (var fi = 0; fi < rnames.length; fi++) {
            var rOid = await remoteBranchOid(rnames[fi]);
            var cur = null;
            try { cur = await gitlib.resolveRef(opts({ ref: 'refs/remotes/origin/' + rnames[fi] })); } catch (e) {}
            if (cur === rOid) continue;
            await setTrackingRef(rnames[fi], rOid);
            updated.push(cur
              ? '   ' + cur.slice(0, 7) + '..' + rOid.slice(0, 7) + '  ' + rnames[fi] + '       -> origin/' + rnames[fi]
              : ' * [new branch]      ' + rnames[fi] + '       -> origin/' + rnames[fi]);
          }
          // like git 2.48+, the first fetch also records which branch is the
          // remote's default, as origin/HEAD (silently)
          if (!(await originHead())) {
            var rhead = null;
            try { rhead = (await fs.promises.readFile(remoteGitdir + '/HEAD', 'utf8')).replace(/^ref: refs\/heads\//, '').trim(); } catch (e) {}
            if (rhead && rnames.indexOf(rhead) !== -1) {
              await gitlib.writeRef(opts({ ref: 'refs/remotes/origin/HEAD', value: 'refs/remotes/origin/' + rhead, symbolic: true, force: true }));
            }
          }
          if (!updated.length) return { out: '', ok: true };
          return { out: ['From ' + fetchUrl].concat(updated).join('\n'), ok: true };
        }

        case 'pull': {
          var pullUrl = await originUrl();
          if (!pullUrl) return { out: "fatal: 'origin' does not appear to be a git repository", ok: false };
          if (rest.indexOf('--rebase') !== -1 || rest.indexOf('-r') !== -1) {
            return { out: 'This sandbox has no rebase, so `git pull` always merges.\nRun `git pull` without --rebase.', ok: false };
          }
          var inMerge2 = await statusModel();
          if (inMerge2.conflicted.length) return unmergedError('Pulling');
          if (inMerge2.merging) {
            return { out: 'fatal: You have not concluded your merge (MERGE_HEAD exists).\n' +
              'Please, commit your changes before you merge.', ok: false };
          }
          var lbr = await currentBranch();
          if (!lbr) return { out: 'fatal: you are not currently on a branch.', ok: false };
          var pwords = rest.filter(function (a) { return a.charAt(0) !== '-'; });
          if (pwords[0] && pwords[0] !== 'origin') {
            return { out: "fatal: '" + pwords[0] + "' does not appear to be a git repository\n" +
              'fatal: Could not read from remote repository.\n\n' +
              'Please make sure you have the correct access rights\nand the repository exists.', ok: false };
          }
          // `git pull origin <branch>` names the branch; plain `git pull`
          // takes the upstream that `push -u`, `clone` or `--track` set
          var fromBranch = pwords[1] || await upstreamOf(lbr);
          var fetched = await gitCommand(['fetch']);
          var prefix2 = fetched.out ? fetched.out + '\n' : '';
          if (!fromBranch) {
            return {
              out: prefix2 + (pwords[0]
                ? "You asked to pull from the remote 'origin', but did not specify\n" +
                  'a branch. Because this is not the default configured remote\n' +
                  'for your current branch, you must specify a branch on the command line.'
                : 'There is no tracking information for the current branch.\n' +
                  'Please specify which branch you want to merge with.\n' +
                  'See git-pull(1) for details.\n\n' +
                  '    git pull <remote> <branch>\n\n' +
                  'If you wish to set tracking information for this branch you can do so with:\n\n' +
                  '    git branch --set-upstream-to=origin/<branch> ' + lbr),
              ok: false
            };
          }
          var theirOid = await remoteBranchOid(fromBranch);
          if (!theirOid) return { out: prefix2 + "fatal: couldn't find remote ref " + fromBranch, ok: false };
          var oursOid = await gitlib.resolveRef(opts({ ref: lbr }));
          if (theirOid === oursOid) return { out: prefix2 + 'Already up to date.', ok: true };
          var pres;
          try {
            pres = await mergeInto(lbr, 'refs/remotes/origin/' + fromBranch, 'origin/' + fromBranch,
              "Merge branch '" + fromBranch + "' of " + pullUrl);
          } catch (e) {
            return { out: prefix2 + 'fatal: ' + e.message, ok: false };
          }
          if (pres.conflict) {
            pres.conflict.out = prefix2 + pres.conflict.out;
            return pres.conflict;
          }
          if (pres.alreadyMerged) return { out: prefix2 + 'Already up to date.', ok: true };
          if (pres.fastForward) return { out: prefix2 + 'Updating ' + oursOid.slice(0, 7) + '..' + theirOid.slice(0, 7) + '\nFast-forward', ok: true };
          return { out: prefix2 + "Merge made by the 'ort' strategy.", ok: true };
        }

        case 'diff': {
          var st3 = await statusModel();
          // a conflicted file shows its markers against the last commit
          var diffFiles = st3.modified.concat(st3.conflicted
            .filter(function (c) { return c.kind === 'both modified'; })
            .map(function (c) { return c.file; })).sort();
          if (!diffFiles.length) return { out: '', ok: true };
          var chunks = [];
          for (var d = 0; d < diffFiles.length; d++) {
            var file = diffFiles[d];
            var headOid = await gitlib.resolveRef(opts({ ref: 'HEAD' }));
            var blob = await gitlib.readBlob(opts({ oid: headOid, filepath: file }));
            var oldTxt = new TextDecoder().decode(blob.blob);
            var newTxt = await fs.promises.readFile(dir + '/' + file, 'utf8');
            chunks.push('{w}diff --git a/' + file + ' b/' + file + '{/}');
            chunks.push(simpleDiff(oldTxt, newTxt));
          }
          return { out: chunks.join('\n'), ok: true };
        }

        case 'reset': {
          var mode = null;
          var before = [], after = [], seenDashes = false;
          for (var ra = 0; ra < rest.length; ra++) {
            var a1 = rest[ra];
            if (seenDashes) { after.push(a1); continue; }
            if (a1 === '--') { seenDashes = true; continue; }
            if (a1 === '--soft' || a1 === '--mixed' || a1 === '--hard') { mode = a1.slice(2); continue; }
            if (a1 === '--merge' || a1 === '--keep') { mode = 'hard'; continue; }
            if (a1.charAt(0) === '-') continue;
            before.push(a1);
          }
          // the first word may name a commit; everything else is a path
          var resetTo = null;
          if (before.length) {
            resetTo = await resolveCommit(before[0]);
            if (resetTo) before.shift();
          }
          var resetPaths = before.concat(after);
          var headNow = null;
          try { headNow = await gitlib.resolveRef(opts({ ref: 'HEAD' })); } catch (e) {}
          if (resetPaths.length) {
            // a word before `--` that is neither a commit nor a known path
            if (!seenDashes && !(await knownPath(before[0] || resetPaths[0]))) return ambiguous(before[0] || resetPaths[0]);
            if (mode === 'soft' || mode === 'hard') {
              return { out: 'fatal: Cannot do ' + mode + ' reset with paths.', ok: false };
            }
            return unstagePaths(resetPaths, resetTo || headNow, 'reset');
          }
          if (!headNow) {
            // nothing committed yet: emptying the staging area is all a reset can do
            var staged0 = await gitlib.listFiles(opts());
            for (var s0 = 0; s0 < staged0.length; s0++) await gitlib.remove(opts({ filepath: staged0[s0] }));
            return { out: '', ok: true };
          }
          return resetTo2(resetTo || headNow, mode || 'mixed');
        }

        case 'restore': {
          var staged = false, worktree = false, source = null, rPaths = [], dashes2 = false;
          for (var rs = 0; rs < rest.length; rs++) {
            var a2 = rest[rs];
            if (dashes2) { rPaths.push(a2); continue; }
            if (a2 === '--') { dashes2 = true; continue; }
            if (a2 === '--staged' || a2 === '-S') staged = true;
            else if (a2 === '--worktree' || a2 === '-W') worktree = true;
            else if (a2 === '-SW' || a2 === '-WS') { staged = true; worktree = true; }
            else if (a2 === '-s' || a2 === '--source') source = rest[++rs];
            else if (a2.indexOf('--source=') === 0) source = a2.slice(9);
            else if (a2.indexOf('-s') === 0 && a2.length > 2) source = a2.slice(2);
            else if (a2.charAt(0) !== '-') rPaths.push(a2);
          }
          if (!staged) worktree = true;
          if (!rPaths.length) return { out: 'fatal: you must specify path(s) to restore', ok: false };
          var sourceOid = null;
          if (source) {
            sourceOid = await resolveCommit(source);
            if (!sourceOid) return { out: 'fatal: could not resolve ' + source, ok: false };
          }
          var unresolved = (await statusModel()).conflicted.map(function (c) { return c.file; });
          var headOid2 = null;
          try { headOid2 = await gitlib.resolveRef(opts({ ref: 'HEAD' })); } catch (e) {}
          if (staged) {
            // before the first commit, unstaging takes the file out of the index
            var unstaged = await unstagePaths(rPaths, sourceOid || headOid2, 'restore');
            if (!unstaged.ok || !worktree) return unstaged.ok ? { out: '', ok: true } : unstaged;
          }
          // the working copy comes back from the source commit if one was
          // given (or with --staged, from HEAD), else from the staging area
          var fromCommit = sourceOid || (staged ? headOid2 : null);
          var known = fromCommit ? await flatTree(fromCommit) : await indexEntries();
          var inIndexNow = await indexEntries();
          var targets = [];
          for (var rp = 0; rp < rPaths.length; rp++) {
            var rm2 = pathspec(rPaths[rp]);
            var pool = Object.keys(known);
            // with a source, files the source lacks are removed again
            if (fromCommit) Object.keys(inIndexNow).forEach(function (f) { if (pool.indexOf(f) === -1) pool.push(f); });
            var rh = rm2 ? pool.filter(rm2) : [];
            if (!rh.length) return { out: "error: pathspec '" + rPaths[rp] + "' did not match any file(s) known to git", ok: false };
            for (var u = 0; u < rh.length; u++) {
              if (unresolved.indexOf(rh[u]) !== -1) return { out: "error: path '" + rh[u] + "' is unmerged", ok: false };
              if (targets.indexOf(rh[u]) === -1) targets.push(rh[u]);
            }
          }
          for (var t = 0; t < targets.length; t++) {
            var where = dir + '/' + targets[t];
            if (!known[targets[t]]) { await removeFileAndEmptyParents(where); continue; }
            var bytes = (await gitlib.readBlob(opts({ oid: known[targets[t]] }))).blob;
            await fs.promises.mkdir(fs._dirname(where), { recursive: true });
            await fs.promises.writeFile(where, bytes);
          }
          return { out: '', ok: true };
        }

        case 'help':
          return { out: usageGit(), ok: true };

        default:
          return { out: "git: '" + sub + "' is not supported in this sandbox.\n" + usageGit(), ok: false };
      }
    }

    // Line-by-line diff as data: [{ t: ' '|'+'|'-', text, a, b }] where a/b
    // are 1-based line numbers in the old/new file (absent on the other side).
    function diffLines(oldTxt, newTxt) {
      var a = oldTxt.split('\n'), b = newTxt.split('\n');
      var out = [];
      var i = 0, j = 0;
      while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) { out.push({ t: ' ', text: a[i], a: i + 1, b: j + 1 }); i++; j++; }
        else if (j < b.length && (i >= a.length || a.indexOf(b[j], i) === -1)) { out.push({ t: '+', text: b[j], b: j + 1 }); j++; }
        else if (i < a.length) { out.push({ t: '-', text: a[i], a: i + 1 }); i++; }
        else break;
      }
      return out;
    }

    // A commit's date as `git log` prints it: "Thu Oct 22 21:36:29 2026 +0000",
    // in the author's own timezone. isomorphic-git stores the offset the way
    // Date#getTimezoneOffset does, in minutes and with the sign flipped.
    function gitDate(who) {
      var off = -(who.timezoneOffset || 0);
      var d = new Date((who.timestamp + off * 60) * 1000);
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      var a = Math.abs(off);
      return days[d.getUTCDay()] + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCDate() + ' ' +
        pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' ' +
        d.getUTCFullYear() + ' ' + (off < 0 ? '-' : '+') + pad(Math.floor(a / 60)) + pad(a % 60);
    }

    function simpleDiff(oldTxt, newTxt) {
      return diffLines(oldTxt, newTxt).map(function (l) {
        if (l.t === '+') return '{g}+' + l.text + '{/}';
        if (l.t === '-') return '{r}-' + l.text + '{/}';
        return ' ' + l.text;
      }).join('\n');
    }

    // Working directory vs the last commit, structured for rendering:
    // { files: [{ file, kind: 'new'|'modified'|'deleted', lines: [...] }] }
    // or null when there is no repository yet.
    async function diffModel() {
      if (!(await isRepo())) return null;
      var headOid = null;
      try { headOid = await gitlib.resolveRef(opts({ ref: 'HEAD' })); } catch (e) {}
      var matrix = await gitlib.statusMatrix(opts());
      var files = [];
      for (var r = 0; r < matrix.length; r++) {
        var file = matrix[r][0], head = matrix[r][1], workdir = matrix[r][2];
        if (head === workdir) continue;                       // unchanged or absent
        var kind = head === 0 ? 'new' : (workdir === 0 ? 'deleted' : 'modified');
        var oldTxt = '', newTxt = '';
        if (head === 1 && headOid) {
          var blob = await gitlib.readBlob(opts({ oid: headOid, filepath: file }));
          oldTxt = new TextDecoder().decode(blob.blob);
        }
        if (workdir !== 0) newTxt = await fs.promises.readFile(dir + '/' + file, 'utf8');
        files.push({ file: file, kind: kind, lines: fileDiff(kind, oldTxt, newTxt) });
      }
      return { files: files };
    }

    // One file's lines for the diff views; kind is 'new', 'modified' or
    // 'deleted'. One trailing newline per side is dropped so the panel never
    // shows a phantom blank last line.
    function fileDiff(kind, oldTxt, newTxt) {
      oldTxt = oldTxt.replace(/\n$/, '');
      newTxt = newTxt.replace(/\n$/, '');
      if (kind === 'new') return newTxt.split('\n').map(function (t, k) { return { t: '+', text: t, b: k + 1 }; });
      if (kind === 'deleted') return oldTxt.split('\n').map(function (t, k) { return { t: '-', text: t, a: k + 1 }; });
      return diffLines(oldTxt, newTxt);
    }

    // path -> blob oid for every file in a commit's tree
    async function flatTree(commitOid) {
      var out = {};
      async function walkTree(treeOid, prefix) {
        var t = await gitlib.readTree(opts({ oid: treeOid }));
        for (var i = 0; i < t.tree.length; i++) {
          var e = t.tree[i];
          if (e.type === 'tree') await walkTree(e.oid, prefix + e.path + '/');
          else if (e.type === 'blob') out[prefix + e.path] = e.oid;
        }
      }
      var c = await gitlib.readCommit(opts({ oid: commitOid }));
      await walkTree(c.commit.tree, '');
      return out;
    }

    async function blobText(oid) {
      var b = await gitlib.readBlob(opts({ oid: oid }));
      if (b.blob.indexOf(0) !== -1) return null;
      try { return new TextDecoder('utf-8', { fatal: true }).decode(b.blob); }
      catch (e) { return null; }
    }

    // What `git show` would tell you about one commit: who, when, the full
    // message, and what it changed. A merge commit is compared with its
    // first parent, as `git show --first-parent` does, so it lists what the
    // merge brought in. files: [{ file, kind, lines, binary }].
    async function commitDetails(oid) {
      var c = await gitlib.readCommit(opts({ oid: oid }));
      var parents = c.commit.parent || [];
      var mine = await flatTree(oid);
      var theirs = parents.length ? await flatTree(parents[0]) : {};
      var paths = {};
      Object.keys(mine).concat(Object.keys(theirs)).forEach(function (p) { paths[p] = true; });
      var files = [];
      var sorted = Object.keys(paths).sort();
      for (var i = 0; i < sorted.length; i++) {
        var f = sorted[i];
        if (mine[f] === theirs[f]) continue;
        var kind = !theirs[f] ? 'new' : (!mine[f] ? 'deleted' : 'modified');
        var oldTxt = theirs[f] ? await blobText(theirs[f]) : '';
        var newTxt = mine[f] ? await blobText(mine[f]) : '';
        if (oldTxt === null || newTxt === null) { files.push({ file: f, kind: kind, lines: [], binary: true }); continue; }
        files.push({ file: f, kind: kind, lines: fileDiff(kind, oldTxt, newTxt) });
      }
      var a = c.commit.author;
      return {
        oid: oid, short: oid.slice(0, 7), parents: parents,
        author: a.name, email: a.email, timestamp: a.timestamp,
        message: (c.commit.message || '').replace(/\n+$/, ''),
        files: files
      };
    }

    function usageGit() {
      return [
        'Supported git commands in this sandbox:',
        '  git init                      git status',
        '  git add <file> | .            git commit [-a] -m "message"',
        '  git restore [--staged] <file> git reset [<file>]',
        '  git reset [--hard] <commit>',
        '  git rm [--cached] <file>      git check-ignore <file>',
        '  git log [--oneline]           git diff',
        '  git branch [name] [-d name]   git checkout [-b] <branch>',
        '  git checkout <commit>         git switch --detach <commit>',
        '  git switch [-c] <branch>      git merge <branch> | --abort',
        '  git remote add origin <url>   git push [-u origin <branch>]',
        '  git fetch                     git pull',
        '  git clone <url>',
        '  git config user.name "..."'
      ].join('\n');
    }

    /* ------------------------- shell commands ---------------------- */

    async function shellCommand(cmd, args, redirect, target) {
      switch (cmd) {
        case 'ls': {
          var showAll = args.indexOf('-a') !== -1 || args.indexOf('-la') !== -1 || args.indexOf('-al') !== -1;
          var lsArgs = args.filter(function (a) { return a.charAt(0) !== '-'; });
          if (!lsArgs.length) lsArgs = [null];
          // like ls: files named on the line first, then each folder's contents
          var lsFiles = [], lsDirs = [], lsErrs = [];
          for (var la = 0; la < lsArgs.length; la++) {
            var ls1;
            try { ls1 = await fs.promises.stat(abs(lsArgs[la])); }
            catch (e) { lsErrs.push('ls: ' + lsArgs[la] + ': No such file or directory'); continue; }
            if (ls1.isDirectory()) lsDirs.push(lsArgs[la]); else lsFiles.push(lsArgs[la]);
          }
          var blocks = lsFiles.length ? [lsFiles.join('  ')] : [];
          for (var ld = 0; ld < lsDirs.length; ld++) {
            var lsDir = abs(lsDirs[ld]);
            var entries = await fs.promises.readdir(lsDir);
            if (!showAll) entries = entries.filter(function (e) { return e.charAt(0) !== '.'; });
            var marked = [];
            for (var i = 0; i < entries.length; i++) {
              var s = await fs.promises.stat(lsDir + '/' + entries[i]);
              marked.push(s.isDirectory() ? '{b}' + entries[i] + '/{/}' : entries[i]);
            }
            var heading = lsArgs.length > 1 ? lsDirs[ld] + ':\n' : '';
            if (heading || marked.length) blocks.push(heading + marked.join('  '));
          }
          var lsOut = lsErrs.concat(blocks).join('\n\n');
          return { out: lsOut, ok: !lsErrs.length };
        }
        case 'cat': {
          if (!args.length) return { out: 'usage: cat <file>', ok: false };
          var txt = '';
          for (var ci = 0; ci < args.length; ci++) {
            try { txt += await fs.promises.readFile(abs(args[ci]), 'utf8'); }
            catch (e) { return { out: (txt ? txt.replace(/\n$/, '') + '\n' : '') + 'cat: ' + args[ci] + ': No such file or directory', ok: false }; }
          }
          return { out: txt.replace(/\n$/, ''), ok: true };
        }
        case 'echo': {
          var text = args.join(' ');
          if (redirect && target) {
            var p = abs(target);
            var prev = '';
            if (redirect === '>>') { try { prev = await fs.promises.readFile(p, 'utf8'); } catch (e) {} }
            await fs.promises.writeFile(p, prev + text + '\n');
            return { out: '', ok: true, silentNote: 'wrote ' + rel(target) };
          }
          return { out: text, ok: true };
        }
        case 'touch': {
          if (!args.length) return { out: 'usage: touch <file>', ok: false };
          for (var t = 0; t < args.length; t++) {
            var pt = abs(args[t]);
            try { await fs.promises.stat(pt); }
            catch (e) { await fs.promises.writeFile(pt, ''); }
          }
          return { out: '', ok: true, silentNote: 'touched ' + args.join(' ') };
        }
        case 'rm': {
          var rmFlags = args.filter(function (a) { return /^-[a-zA-Z]+$/.test(a); }).join('');
          var rmRecursive = /[rR]/.test(rmFlags), rmForce = /f/.test(rmFlags);
          var files = args.filter(function (a) { return a.charAt(0) !== '-'; });
          if (!files.length) return rmForce ? { out: '', ok: true } : { out: 'usage: rm [-rf] <file>...', ok: false };
          var rmErrs = [];
          for (var r = 0; r < files.length; r++) {
            var rp = abs(files[r]);
            // the project folder itself, or anything outside it (where the
            // mock remote lives), is off limits
            if (rp === dir || !insideProject(rp)) { rmErrs.push("rm: refusing to remove '" + files[r] + "'"); continue; }
            var rst = null;
            try { rst = await fs.promises.stat(rp); } catch (e) {}
            if (!rst) { if (!rmForce) rmErrs.push("rm: cannot remove '" + files[r] + "': No such file or directory"); continue; }
            if (rst.isDirectory() && !rmRecursive) { rmErrs.push("rm: cannot remove '" + files[r] + "': Is a directory"); continue; }
            await fs.promises.rm(rp, { recursive: true });
          }
          return { out: rmErrs.join('\n'), ok: !rmErrs.length };
        }
        case 'mkdir': {
          if (!args.length) return { out: 'usage: mkdir <dir>', ok: false };
          await fs.promises.mkdir(abs(args[args.length - 1]), { recursive: true });
          return { out: '', ok: true };
        }
        case 'pwd':
          return { out: displayCwd(), ok: true };
        case 'cd': {
          var to = args[0];
          var dest;
          // `~` is the project root: the prompt shows it as ~/project, and
          // there is nothing above it to visit.
          if (!to || to === '~' || to === '~/') dest = dir;
          else if (to === '-') dest = prevCwd;
          else if (to.indexOf('~/') === 0) dest = fs._norm(dir + '/' + to.slice(2));
          else dest = abs(to);
          if (!insideProject(dest)) {
            return { out: 'cd: ' + to + ': this sandbox only has the project folder.\nUse `cd ~` to get back to its top.', ok: false };
          }
          var dst;
          try { dst = await fs.promises.stat(dest); }
          catch (e) { return { out: 'cd: ' + to + ': No such file or directory', ok: false }; }
          if (!dst.isDirectory()) return { out: 'cd: ' + to + ': Not a directory', ok: false };
          prevCwd = cwd;
          cwd = dest;
          return { out: to === '-' ? displayCwd() : '', ok: true };
        }
        // Authoring helper for seeds: move the current branch back n commits
        // (first parent), so a previously-pushed commit exists only on the
        // remote — the "colleague pushed while you were away" setup.
        case 'rewind': {
          var back = parseInt(args[0] || '1', 10);
          if (!(back > 0)) return { out: 'usage: rewind <n>', ok: false };
          var rbr = await currentBranch();
          if (!rbr) return { out: 'rewind: not on a branch', ok: false };
          var roid = await gitlib.resolveRef(opts({ ref: rbr }));
          for (var rw = 0; rw < back; rw++) {
            var rc = await gitlib.readCommit(opts({ oid: roid }));
            var rp = rc.commit.parent || [];
            if (!rp.length) return { out: 'rewind: not enough history to rewind ' + back, ok: false };
            roid = rp[0];
          }
          await gitlib.writeRef(opts({ ref: 'refs/heads/' + rbr, value: roid, force: true }));
          // keep the tracking ref in step so the learner discovers the newer
          // remote commits with `git fetch`, not automatically
          try {
            await gitlib.resolveRef(opts({ ref: 'refs/remotes/origin/' + rbr }));
            await setTrackingRef(rbr, roid);
          } catch (e) { /* no tracking ref yet */ }
          await gitlib.checkout(opts({ ref: rbr, force: true }));
          return { out: '', ok: true, silentNote: 'rewound ' + rbr + ' by ' + back };
        }
        case 'whoami':
          return { out: author.name + ' <' + author.email + '>', ok: true };
        default:
          return null;
      }
    }

    /* ---------------------------- dispatch -------------------------- */

    async function run(line) {
      line = String(line || '').trim();
      if (!line) return { out: '', ok: true, kind: 'empty' };

      var words;
      try { words = tokenizeWords(line); }
      catch (e) { return { out: 'sh: ' + e.message, ok: false, kind: 'error' }; }

      await ensureWorkdir();
      await ensureCwd();

      var tokens = [];
      for (var w = 0; w < words.length; w++) {
        var afterRedirect = w > 0 && (words[w - 1].text === '>' || words[w - 1].text === '>>');
        var expanded = words[w].glob && !afterRedirect ? await expandGlob(words[w].text) : null;
        if (expanded) tokens = tokens.concat(expanded);
        else tokens.push(words[w].text);
      }

      var parsed = splitRedirect(tokens);
      var args = parsed.args;
      var cmd = args[0];

      try {
        if (cmd === 'git') {
          var r = await gitCommand(args.slice(1));
          r.kind = 'git';
          // a checkout or merge may have removed the folder we are in
          await ensureCwd();
          return await redirectOutput(r, parsed);
        }
        var sh = await shellCommand(cmd, args.slice(1), parsed.redirect, parsed.target);
        if (sh) {
          sh.kind = 'shell';
          return cmd === 'echo' ? sh : await redirectOutput(sh, parsed);
        }
        return {
          out: cmd + ': command not found\nType `help` to see what this sandbox supports.',
          ok: false, kind: 'error'
        };
      } catch (e) {
        return { out: 'error: ' + (e && e.message ? e.message : String(e)), ok: false, kind: 'error' };
      }
    }

    // `command > file` / `>> file`: what the command printed goes into the
    // file instead of the terminal, as in a shell. Errors stay on screen,
    // as stderr would; `echo` handles its own redirection.
    async function redirectOutput(r, parsed) {
      if (!parsed.redirect || r.editor) return r;
      if (!parsed.target) return { out: 'sh: syntax error near unexpected token `newline\'', ok: false, kind: 'error' };
      if (!r.ok) return r;
      var p = abs(parsed.target);
      var text = r.out ? String(r.out).replace(/\{[gryb\/w]\}/g, '') + '\n' : '';
      var prev = '';
      if (parsed.redirect === '>>') { try { prev = await fs.promises.readFile(p, 'utf8'); } catch (e) {} }
      try { await fs.promises.writeFile(p, prev + text); }
      catch (e) { return { out: 'sh: ' + parsed.target + ': No such file or directory', ok: false, kind: r.kind }; }
      return { out: '', ok: true, kind: r.kind, silentNote: 'wrote ' + rel(parsed.target) };
    }

    /* ------------------------- undo snapshots ------------------------ */

    // Everything a command can change lives in the in-memory store (working
    // files, .git, the bare mock remote) plus a few closure variables, so a
    // full state snapshot is a clone of both. Repos here are a few KB, so
    // cloning per command is cheap.
    function cloneStore(src) {
      var out = new Map();
      src.forEach(function (node, key) {
        var copy = {};
        for (var k in node) copy[k] = node[k];
        if (node.content instanceof Uint8Array) copy.content = new Uint8Array(node.content);
        out.set(key, copy);
      });
      return out;
    }

    function snapshot() {
      return {
        store: cloneStore(fs._store),
        remoteUrl: remoteUrl,
        prevHead: prevHead,
        merges: mergesDone.map(function (m) { return { from: m.from, into: m.into }; }),
        author: { name: author.name, email: author.email },
        globalConfig: JSON.parse(JSON.stringify(globalConfig)),
        repoReady: repoReady,
        cwd: cwd,
        prevCwd: prevCwd
      };
    }

    function restore(snap) {
      var cloned = cloneStore(snap.store);
      // mutate the existing store so every closure holding `fs` stays valid
      fs._store.clear();
      cloned.forEach(function (v, k) { fs._store.set(k, v); });
      remoteUrl = snap.remoteUrl;
      prevHead = snap.prevHead || null;
      mergesDone = snap.merges.map(function (m) { return { from: m.from, into: m.into }; });
      author = { name: snap.author.name, email: snap.author.email };
      globalConfig = JSON.parse(JSON.stringify(snap.globalConfig || {}));
      repoReady = snap.repoReady;
      cwd = snap.cwd || dir;
      prevCwd = snap.prevCwd || dir;
    }

    // Did anything meaningful change since the snapshot? Compares content,
    // not mtimes, so rewriting a file with identical bytes does not count.
    function changedSince(snap) {
      if (remoteUrl !== snap.remoteUrl) return true;
      if (mergesDone.length !== snap.merges.length) return true;
      if (author.name !== snap.author.name || author.email !== snap.author.email) return true;
      if (JSON.stringify(globalConfig) !== JSON.stringify(snap.globalConfig || {})) return true;
      if (fs._store.size !== snap.store.size) return true;
      var diff = false;
      fs._store.forEach(function (node, key) {
        if (diff) return;
        var old = snap.store.get(key);
        if (!old || old.type !== node.type) { diff = true; return; }
        var a = node.content, b = old.content;
        if (!a !== !b) { diff = true; return; }
        if (a && b) {
          if (a.length !== b.length) { diff = true; return; }
          for (var i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) { diff = true; return; }
          }
        }
      });
      return diff;
    }

    async function reset(seed) {
      fs = createMemFS();
      base.fs = fs;
      repoReady = false;
      remoteUrl = null;
      prevHead = null;
      mergesDone = [];
      author = { name: 'Your Name', email: 'you@example.com' };
      globalConfig = {};
      cwd = dir;
      prevCwd = dir;
      await ensureWorkdir();
      if (seed) {
        await seed(api);
        // seeds may `cd` to set things up; the learner always starts at the top
        cwd = dir;
        prevCwd = dir;
      }
    }

    var api = {
      run: run,
      finishCommit: finishCommit,
      reset: reset,
      snapshot: snapshot,
      restore: restore,
      changedSince: changedSince,
      graphModel: graphModel,
      statusModel: statusModel,
      diffModel: diffModel,
      commitDetails: commitDetails,
      remoteModel: remoteModel,
      pwd: displayCwd,
      // cwd relative to the project folder: '' at its top, 'src/lib' below
      cwdPath: function () { return cwd === dir ? '' : cwd.slice(dir.length + 1); },
      isRepo: isRepo,
      currentBranch: currentBranch,
      // { from, into, files, unresolved } while a merge is stopped on
      // conflicts, else null
      mergeState: mergeState,
      listFiles: listFiles,
      listTree: listTree,
      // The file API below takes paths from the project's top folder, not
      // from the shell's cwd: callers (the editor, `file x` conditions) hold
      // project-relative paths, just as git status reports them, and must
      // not change meaning when the learner runs `cd`.
      readFile: function (p) { return fs.promises.readFile(fromRoot(p), 'utf8'); },
      readBytes: function (p) { return fs.promises.readFile(fromRoot(p)); },
      // Creates missing parent folders, so the editor can make `data/notes.md`
      // without a separate mkdir.
      writeFile: function (p, c) {
        var target = fromRoot(p);
        return ensureWorkdir()
          .then(function () { return fs.promises.mkdir(fs._dirname(target), { recursive: true }); })
          .then(function () { return fs.promises.writeFile(target, c); });
      },
      get fs() { return fs; },
      get dir() { return dir; },
      git: gitlib
    };
    return api;
  }

  return {
    createSandbox: createSandbox,
    createMemFS: createMemFS,
    tokenize: tokenize,
    tokenizeWords: tokenizeWords,
    splitRedirect: splitRedirect
  };
});


/* ------------------------------------------------------------------
   The `when:` mini-language.

   Lesson authors describe what a learner must achieve as a condition on
   repository state rather than as JavaScript:

     when: repo
     when: commits >= 2
     when: commits on report >= 3
     when: branch report and on main
     when: detached
     when: merged report into main
     when: merge commit
     when: merging and not conflicts
     when: file report.qmd contains "Q3"
     when: ran /git\s+status/
     when: not clean

   compileWhen(src) returns a predicate (ctx) => boolean, or throws an Error
   with an author-facing message. Compilation happens once at mount time so
   mistakes surface immediately rather than on the learner's tenth command.
   ------------------------------------------------------------------ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GitSandboxWhen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEYWORDS = ['and', 'or', 'not'];

  /* ------------------------------ tokenizer ------------------------------ */

  function tokenize(src) {
    var tokens = [];
    var i = 0;
    var n = src.length;
    while (i < n) {
      var c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '(' || c === ')') { tokens.push({ t: c, v: c, at: i }); i++; continue; }
      if (c === '"' || c === "'") {
        var q = c, buf = '', start = i;
        i++;
        while (i < n && src[i] !== q) {
          if (src[i] === '\\' && i + 1 < n) { buf += src[i + 1]; i += 2; }
          else { buf += src[i]; i++; }
        }
        if (i >= n) throw new Error('unterminated string starting at character ' + (start + 1));
        i++;
        tokens.push({ t: 'str', v: buf, at: start });
        continue;
      }
      if (c === '/') {
        var rstart = i, rbuf = '';
        i++;
        while (i < n && src[i] !== '/') {
          if (src[i] === '\\' && i + 1 < n) { rbuf += src[i] + src[i + 1]; i += 2; }
          else { rbuf += src[i]; i++; }
        }
        if (i >= n) throw new Error('unterminated /regex/ starting at character ' + (rstart + 1));
        i++;
        var flags = '';
        while (i < n && /[a-z]/.test(src[i])) { flags += src[i]; i++; }
        tokens.push({ t: 'regex', v: rbuf, flags: flags, at: rstart });
        continue;
      }
      var opMatch = /^(>=|<=|==|=|>|<)/.exec(src.slice(i));
      if (opMatch) { tokens.push({ t: 'op', v: opMatch[1], at: i }); i += opMatch[1].length; continue; }
      var wordMatch = /^[^\s()]+/.exec(src.slice(i));
      if (!wordMatch) throw new Error('unexpected character ' + JSON.stringify(c));
      var w = wordMatch[0];
      if (/^\d+$/.test(w)) tokens.push({ t: 'num', v: parseInt(w, 10), at: i });
      else if (KEYWORDS.indexOf(w) !== -1) tokens.push({ t: w, v: w, at: i });
      else tokens.push({ t: 'word', v: w, at: i });
      i += w.length;
    }
    return tokens;
  }

  /* ------------------------------ predicates ----------------------------- */

  function ui() {
    return (typeof self !== 'undefined' && self.GitSandboxUI) || null;
  }
  function branchOid(ctx, name) {
    var b = (ctx.graph.branches || []).filter(function (x) { return x.name === name; })[0];
    return b ? b.oid : null;
  }
  function reaches(ctx, from, target) {
    if (!from || !target) return false;
    if (from === target) return true;
    var byOid = {};
    ctx.graph.commits.forEach(function (c) { byOid[c.oid] = c; });
    var stack = [from], seen = {};
    while (stack.length) {
      var oid = stack.pop();
      if (oid === target) return true;
      if (seen[oid]) continue;
      seen[oid] = true;
      var c = byOid[oid];
      if (c) (c.parents || []).forEach(function (p) { stack.push(p); });
    }
    return false;
  }
  function commitCount(ctx, name) {
    if (!name) return ctx.graph.commits.length;
    var tip = branchOid(ctx, name);
    if (!tip) return 0;
    var byOid = {};
    ctx.graph.commits.forEach(function (c) { byOid[c.oid] = c; });
    var stack = [tip], seen = {}, count = 0;
    while (stack.length) {
      var oid = stack.pop();
      if (seen[oid]) continue;
      seen[oid] = true;
      count++;
      var c = byOid[oid];
      if (c) (c.parents || []).forEach(function (p) { stack.push(p); });
    }
    return count;
  }
  function compare(op, left, right) {
    switch (op) {
      case '>=': return left >= right;
      case '>': return left > right;
      case '<=': return left <= right;
      case '<': return left < right;
      case '==':
      case '=': return left === right;
    }
    return false;
  }

  /* -------------------------------- parser ------------------------------- */

  function parse(src) {
    var tokens = tokenize(src);
    var pos = 0;

    function peek(k) { return tokens[pos + (k || 0)]; }
    function next() { return tokens[pos++]; }
    function describe(tok) {
      if (!tok) return 'end of expression';
      return JSON.stringify(String(tok.v));
    }
    function expectWord(what) {
      var tok = peek();
      if (!tok || (tok.t !== 'word' && tok.t !== 'str' && tok.t !== 'num')) {
        throw new Error('expected ' + what + ' but found ' + describe(tok));
      }
      return String(next().v);
    }

    function parseOr() {
      var left = parseAnd();
      while (peek() && peek().t === 'or') {
        next();
        var right = parseAnd();
        left = (function (a, b) {
          return function (ctx) { return a(ctx) || b(ctx); };
        })(left, right);
      }
      return left;
    }

    function parseAnd() {
      var left = parseNot();
      while (peek() && peek().t === 'and') {
        next();
        var right = parseNot();
        left = (function (a, b) {
          return function (ctx) { return a(ctx) && b(ctx); };
        })(left, right);
      }
      return left;
    }

    function parseNot() {
      if (peek() && peek().t === 'not') {
        next();
        var inner = parseNot();
        return function (ctx) { return !inner(ctx); };
      }
      if (peek() && peek().t === '(') {
        next();
        var expr = parseOr();
        if (!peek() || peek().t !== ')') {
          throw new Error('missing closing parenthesis');
        }
        next();
        return expr;
      }
      return parsePredicate();
    }

    function parsePredicate() {
      var tok = peek();
      if (!tok) throw new Error('expression ended early; expected a condition');
      if (tok.t !== 'word') {
        throw new Error('expected a condition but found ' + describe(tok));
      }
      var word = String(next().v);

      switch (word) {
        case 'repo':
          return function (ctx) { return !!ctx.isRepo; };

        case 'clean':
          return function (ctx) {
            var s = ctx.status;
            return ctx.isRepo && s.staged.length === 0 && s.modified.length === 0 &&
                   s.untracked.length === 0 && s.deleted.length === 0 &&
                   s.stagedDeleted.length === 0 && !(s.conflicted || []).length;
          };

        // a merge stopped on conflicts and not yet committed or aborted
        case 'merging':
          return function (ctx) { return !!ctx.status.merging; };

        // ...with files whose conflicts are not yet marked resolved
        case 'conflicts':
          return function (ctx) { return (ctx.status.conflicted || []).length > 0; };

        case 'staged':
          return function (ctx) {
            return ctx.status.staged.length > 0 || ctx.status.stagedDeleted.length > 0;
          };

        case 'merge': {
          var m = peek();
          if (!m || String(m.v) !== 'commit') {
            throw new Error('expected "merge commit" but found "merge ' +
              (m ? String(m.v) : '') + '"');
          }
          next();
          return function (ctx) {
            return ctx.graph.commits.some(function (c) { return (c.parents || []).length > 1; });
          };
        }

        case 'commits': {
          var branch = null;
          if (peek() && peek().t === 'word' && String(peek().v) === 'on') {
            next();
            branch = expectWord('a branch name after "commits on"');
          }
          var op = '>=';
          if (peek() && peek().t === 'op') op = String(next().v);
          var numTok = peek();
          if (!numTok || numTok.t !== 'num') {
            throw new Error('expected a number after "commits' +
              (branch ? ' on ' + branch : '') + (op !== '>=' ? ' ' + op : '') +
              '" but found ' + describe(numTok));
          }
          next();
          var want = numTok.v;
          return function (ctx) { return compare(op, commitCount(ctx, branch), want); };
        }

        case 'branch': {
          var bname = expectWord('a branch name after "branch"');
          return function (ctx) {
            return (ctx.graph.branches || []).some(function (b) { return b.name === bname; });
          };
        }

        case 'on': {
          var onName = expectWord('a branch name after "on"');
          return function (ctx) { return ctx.graph.head === onName; };
        }

        // HEAD points at a commit rather than a branch (`git checkout <commit>`)
        case 'detached':
          return function (ctx) { return !!ctx.graph.detached; };

        case 'merged': {
          var from = expectWord('a branch name after "merged"');
          var into = peek();
          if (!into || String(into.v) !== 'into') {
            throw new Error('expected "merged ' + from + ' into <branch>" but found ' +
              describe(into) + ' after the branch name');
          }
          next();
          var target = expectWord('a branch name after "into"');
          // Ancestry alone would be trivially true the moment X is branched
          // off Y (X's tip is already an ancestor of Y's), so a real merge
          // must also have been recorded by the sandbox. The ancestry check
          // still matters: it goes false again if Y is later rewound past
          // the merge. When either branch no longer exists (deleted after
          // merging, or a remote-tracking name), the record alone decides.
          return function (ctx) {
            var recorded = (ctx.graph.merges || []).some(function (m) {
              return m.from === from && m.into === target;
            });
            if (!recorded) return false;
            var fromOid = branchOid(ctx, from);
            var intoOid = branchOid(ctx, target);
            if (!fromOid || !intoOid) return true;
            return reaches(ctx, intoOid, fromOid);
          };
        }

        case 'file': {
          var fname = expectWord('a filename after "file"');
          if (peek() && peek().t === 'word' && String(peek().v) === 'contains') {
            next();
            var needleTok = peek();
            if (!needleTok || (needleTok.t !== 'str' && needleTok.t !== 'word' && needleTok.t !== 'regex')) {
              throw new Error('expected text or /regex/ after "contains" but found ' + describe(needleTok));
            }
            next();
            if (needleTok.t === 'regex') {
              var fre = new RegExp(needleTok.v, needleTok.flags || '');
              return function (ctx) { return fre.test(ctx._fileText(fname)); };
            }
            var needle = String(needleTok.v);
            return function (ctx) { return ctx._fileText(fname).indexOf(needle) !== -1; };
          }
          return function (ctx) { return ctx.files.indexOf(fname) !== -1; };
        }

        case 'remote':
          return function (ctx) { return !!ctx.remote; };

        // true once the current branch's latest commit is on the remote
        case 'pushed':
          return function (ctx) {
            return !!(ctx.remote && ctx.remote.tracked && ctx.remote.ahead === 0);
          };

        case 'ran': {
          var rTok = peek();
          if (!rTok || (rTok.t !== 'regex' && rTok.t !== 'str' && rTok.t !== 'word')) {
            throw new Error('expected /regex/ or "text" after "ran" but found ' + describe(rTok));
          }
          next();
          if (rTok.t === 'regex') {
            var re = new RegExp(rTok.v, rTok.flags || '');
            return function (ctx) { return (ctx.history || []).some(function (h) { return re.test(h); }); };
          }
          var text = String(rTok.v);
          return function (ctx) {
            return (ctx.history || []).some(function (h) { return h.indexOf(text) !== -1; });
          };
        }

        default:
          throw new Error('unknown condition "' + word + '". Available: repo, clean, staged, ' +
            'commits, commits on <branch>, branch <name>, on <branch>, detached, merged <a> into <b>, ' +
            'merge commit, merging, conflicts, file <name> [contains "text"], ran /regex/, remote, pushed');
      }
    }

    var fn = parseOr();
    if (pos < tokens.length) {
      throw new Error('unexpected ' + describe(peek()) + ' after a complete condition');
    }
    return fn;
  }

  /* -------------------------------- public ------------------------------- */

  function compileWhen(src) {
    if (typeof src !== 'string' || src.trim() === '') {
      throw new Error('`when:` is empty');
    }
    var fn;
    try {
      fn = parse(src);
    } catch (e) {
      throw new Error('cannot read `when: ' + src + '` — ' + e.message);
    }
    return function (ctx) {
      // `file ... contains` needs file contents, which are async; the UI
      // pre-loads them into ctx._files before evaluating.
      return fn(ctx);
    };
  }

  // Which filenames does this expression need the contents of? The UI reads
  // them before evaluating so predicates can stay synchronous.
  function filesNeeded(src) {
    var out = [];
    try {
      var tokens = tokenize(src);
      for (var i = 0; i < tokens.length - 2; i++) {
        if (tokens[i].t === 'word' && String(tokens[i].v) === 'file' &&
            tokens[i + 2] && tokens[i + 2].t === 'word' && String(tokens[i + 2].v) === 'contains') {
          out.push(String(tokens[i + 1].v));
        }
      }
    } catch (e) { /* compileWhen will report it */ }
    return out;
  }

  function compileJs(src) {
    var body = /(^|[\s;{])return[\s(]/.test(src) ? src : 'return (' + src + ');';
    try {
      /* eslint-disable no-new-func */
      var fn = new Function('c', body);
      return function (ctx) { return fn(ctx); };
    } catch (e) {
      throw new Error('cannot compile `js:` block — ' + e.message);
    }
  }

  return { compileWhen: compileWhen, compileJs: compileJs, filesNeeded: filesNeeded, tokenize: tokenize };
});


/* ------------------------------------------------------------------
   The commit tree: an optional side pane that draws the history the way
   learngitbranching.js.org does. Commits are circles named C0, C1, …
   in the order they came into being (plus a short hash, since this is a
   real repository), the first commit sits at the top, branches are
   labels pointing at their tips, and `main*` marks the branch HEAD is on.

   Every change animates: a new commit grows out of its parent and slides
   into place, branch labels glide to their new tips, and commits that
   are no longer reachable shrink away. That motion is the point of the
   pane; it lets learners see what a command did rather than diff two
   pictures in their head.

   createTreeView(svg) returns { update(graph, instant), reset(),
   redraw(), snapshot(), restore(snap), labelOf(oid) }. update takes the
   graph from sandbox.graphModel() and returns the layout it drew: commit
   positions by oid, and the scale the tree was drawn at.
   ------------------------------------------------------------------ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GitSandboxTree = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  // Same palette as the History graph, so a branch keeps its colour across
  // panels. Labels and commits use a pale tint with dark text: white text
  // on the teal and green would miss WCAG AA at these sizes.
  var COLORS = ['#447099', '#419599', '#72994E', '#9A4665', '#EE6331', '#3276B5'];
  var DETACHED = '#717171';

  var R = 18;          // commit radius
  var ROW_H = 72;      // vertical distance between generations
  var PAD_TOP = 34;
  var PAD_X = 24;
  var REF_GAP = 22;    // node edge to label, room for the arrow
  var REF_H = 22;
  var REF_STEP = 26;   // vertical distance between stacked labels
  var CHAR_W = 7.3;    // 12px Source Code Pro
  var DURATION = 600;

  function tint(hex, amount) {
    var n = parseInt(hex.slice(1), 16);
    var mix = function (c) { return Math.round(c + (255 - c) * amount); };
    var r = mix(n >> 16), g = mix((n >> 8) & 255), b = mix(n & 255);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  function ease(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function refWidth(text) { return Math.round(text.length * CHAR_W + 16); }

  function createTreeView(svg) {
    var doc = svg.ownerDocument;
    var win = doc.defaultView || {};

    function make(tag, attrs, parent) {
      var n = doc.createElementNS(NS, tag);
      Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      if (parent) parent.appendChild(n);
      return n;
    }

    /* ---------------------------- naming ---------------------------- */

    // oid -> { n, color }. Names are handed out once and kept, so C3 stays
    // C3 however the tree is rearranged; undo and reset rewind them along
    // with the repository through snapshot()/restore().
    var names = {};
    var nextN = 0;
    var branchColors = {};
    var nextColor = 0;

    function colorFor(branch) {
      if (branch == null) return DETACHED;
      if (!(branch in branchColors)) branchColors[branch] = nextColor++ % COLORS.length;
      return COLORS[branchColors[branch]];
    }

    // A commit takes the colour of the branch it was made on. For commits
    // that arrive in bulk (the seed, a fetch) that is the first ref that can
    // reach them, trying the checked-out branch first.
    function nameNewCommits(graph) {
      var fresh = graph.commits.filter(function (c) { return !(c.oid in names); });
      if (!fresh.length) return;
      var byOid = {};
      graph.commits.forEach(function (c) { byOid[c.oid] = c; });

      var tips = [];
      if (graph.head) tips.push({ branch: graph.head, oid: graph.headOid });
      else if (graph.headOid) tips.push({ branch: null, oid: graph.headOid });
      var others = [];
      graph.commits.forEach(function (c) {
        (c.refs || []).forEach(function (r) { if (r.name !== graph.head) others.push({ name: r.name, oid: c.oid, remote: r.remote }); });
      });
      others.sort(function (a, b) {
        if (a.remote !== b.remote) return a.remote ? 1 : -1;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
      others.forEach(function (r) {
        tips.push({ branch: r.remote ? r.name.replace(/^origin\//, '') : r.name, oid: r.oid });
      });

      var owner = {};
      tips.forEach(function (t) {
        var stack = [t.oid], seen = {};
        while (stack.length) {
          var oid = stack.pop();
          if (!oid || seen[oid] || !byOid[oid]) continue;
          seen[oid] = true;
          if (!(oid in owner)) owner[oid] = t.branch;
          byOid[oid].parents.forEach(function (p) { stack.push(p); });
        }
      });

      // graph.commits is children first; name oldest first so C0 is the root
      for (var i = graph.commits.length - 1; i >= 0; i--) {
        var c = graph.commits[i];
        if (c.oid in names) continue;
        names[c.oid] = { n: nextN++, color: colorFor(c.oid in owner ? owner[c.oid] : graph.head) };
      }
    }

    /* ---------------------------- layout ---------------------------- */

    // learngitbranching's layout: each commit hangs under its first parent,
    // one generation per row, and a commit's children share out the width
    // beneath it. A merge commit sits below the lower of its parents.
    function layout(graph, width) {
      var commits = graph.commits;
      var present = {};
      commits.forEach(function (c) { present[c.oid] = c; });
      var depth = {};
      var kids = {};
      var roots = [];
      for (var i = commits.length - 1; i >= 0; i--) {
        var c = commits[i];
        var d = 0;
        c.parents.forEach(function (p) { if (p in depth) d = Math.max(d, depth[p] + 1); });
        depth[c.oid] = d;
        kids[c.oid] = [];
        var first = c.parents.filter(function (p) { return p in present; })[0];
        if (first) kids[first].push(c.oid); else roots.push(c.oid);
      }
      var byN = function (a, b) { return names[a].n - names[b].n; };
      roots.sort(byN);
      Object.keys(kids).forEach(function (k) { kids[k].sort(byN); });

      var span = {};
      function measure(oid) {
        var w = 0;
        kids[oid].forEach(function (k) { w += measure(k); });
        span[oid] = Math.max(1, w);
        return span[oid];
      }
      var units = 0;
      roots.forEach(function (r) { units += measure(r); });

      // Column width leaves room for the widest label beside a commit, so a
      // branch name never runs into the next column.
      var refs = refLayout(graph);
      var widest = 0;
      Object.keys(refs).forEach(function (k) { widest = Math.max(widest, refs[k].w); });
      var colW = Math.max(72, R + REF_GAP + widest + 30);
      // from the leftmost commit's rim to the end of the rightmost label
      var treeW = (units - 1) * colW + 2 * R + (widest ? REF_GAP + widest : 0);
      var fullW = Math.max(width, treeW + PAD_X * 2);
      var offset = (fullW - treeW) / 2;

      var pos = {};
      function place(oid, start) {
        pos[oid] = { x: offset + (start + span[oid] / 2) * colW - colW / 2 + R, y: PAD_TOP + depth[oid] * ROW_H };
        var s = start;
        kids[oid].forEach(function (k) { place(k, s); s += span[k]; });
      }
      var s0 = 0;
      roots.forEach(function (r) { place(r, s0); s0 += span[r]; });

      var maxDepth = 0;
      Object.keys(depth).forEach(function (k) { maxDepth = Math.max(maxDepth, depth[k]); });
      return { pos: pos, refs: refs, width: Math.ceil(fullW), height: PAD_TOP + maxDepth * ROW_H + R + 34 };
    }

    // Labels per commit, local branches first, the checked-out one on top.
    function refLayout(graph) {
      var out = {};
      graph.commits.forEach(function (c) {
        var list = (c.refs || []).map(function (r) {
          return { key: r.name, text: r.name + (r.isHead ? '*' : ''), head: !!r.isHead, remote: !!r.remote };
        });
        if (graph.detached && c.oid === graph.headOid) list.unshift({ key: 'HEAD', text: 'HEAD', head: true, detached: true });
        list.sort(function (a, b) {
          if (a.head !== b.head) return a.head ? -1 : 1;
          if (a.remote !== b.remote) return a.remote ? 1 : -1;
          return 0;
        });
        list.forEach(function (r, i) {
          r.oid = c.oid;
          r.dy = (i - (list.length - 1) / 2) * REF_STEP;
          r.w = refWidth(r.text);
          out[r.key] = r;
        });
      });
      return out;
    }

    /* ---------------------------- drawing --------------------------- */

    var edgeLayer = make('g', { 'class': 'gs-tree-edges' }, svg);
    var nodeLayer = make('g', { 'class': 'gs-tree-nodes' }, svg);
    var refLayer = make('g', { 'class': 'gs-tree-refs' }, svg);
    var emptyText = null;

    // Everything on screen is an item with a current state ({x, y, s, o},
    // plus dy for labels) that tweens towards a target.
    var nodes = {};   // oid -> item
    var edges = {};   // 'child parent' -> item
    var labels = {};  // ref key -> item
    var raf = null;

    function applyNode(it) {
      it.g.setAttribute('transform', 'translate(' + it.cur.x.toFixed(1) + ',' + it.cur.y.toFixed(1) + ') scale(' + it.cur.s.toFixed(3) + ')');
      it.g.setAttribute('opacity', it.cur.o.toFixed(3));
    }

    function applyLabel(it) {
      var c = it.cur;
      it.g.setAttribute('transform', 'translate(' + c.x.toFixed(1) + ',' + c.y.toFixed(1) + ')');
      it.g.setAttribute('opacity', c.o.toFixed(3));
      it.box.setAttribute('y', (c.dy - REF_H / 2).toFixed(1));
      it.text.setAttribute('y', (c.dy + 4).toFixed(1));
      // arrow from the label's left edge to the commit's rim
      var tx = R + 3, ty = 0, fx = R + REF_GAP, fy = c.dy;
      var ang = Math.atan2(fy - ty, fx - tx);
      var a1 = ang + 0.45, a2 = ang - 0.45, L = 7;
      it.arrow.setAttribute('d',
        'M' + fx.toFixed(1) + ',' + fy.toFixed(1) + ' L' + tx.toFixed(1) + ',' + ty.toFixed(1) +
        ' M' + (tx + L * Math.cos(a1)).toFixed(1) + ',' + (ty + L * Math.sin(a1)).toFixed(1) +
        ' L' + tx.toFixed(1) + ',' + ty.toFixed(1) +
        ' L' + (tx + L * Math.cos(a2)).toFixed(1) + ',' + (ty + L * Math.sin(a2)).toFixed(1));
    }

    function applyEdge(it) {
      var a = nodes[it.child], b = nodes[it.parent];
      if (!a || !b) return;
      var x1 = a.cur.x, y1 = a.cur.y, x2 = b.cur.x, y2 = b.cur.y;
      var my = (y1 + y2) / 2;
      it.path.setAttribute('d', 'M' + x1.toFixed(1) + ',' + y1.toFixed(1) +
        ' C' + x1.toFixed(1) + ',' + my.toFixed(1) + ' ' + x2.toFixed(1) + ',' + my.toFixed(1) +
        ' ' + x2.toFixed(1) + ',' + y2.toFixed(1));
      it.path.setAttribute('opacity', (Math.min(a.cur.o, b.cur.o) * 0.9).toFixed(3));
    }

    function newNode(oid, c) {
      var nm = names[oid];
      var g = make('g', { 'class': 'gs-tree-node', 'data-oid': oid }, nodeLayer);
      var title = make('title', {}, g);
      title.textContent = 'C' + nm.n + ' ' + c.short + ': ' + c.message;
      var circle = make('circle', { r: R, fill: tint(nm.color, 0.8), stroke: nm.color, 'stroke-width': 2.5 }, g);
      var label = make('text', { 'class': 'gs-tree-c', 'text-anchor': 'middle', y: 5 }, g);
      label.textContent = 'C' + nm.n;
      var sha = make('text', { 'class': 'gs-tree-sha', 'text-anchor': 'middle', y: R + 14 }, g);
      sha.textContent = c.short;
      return { g: g, circle: circle, cur: null, from: null, to: null };
    }

    function newLabel(r) {
      var g = make('g', { 'class': 'gs-tree-ref', 'data-ref': r.key }, refLayer);
      var color = r.detached ? '#111C26' : r.remote ? '#717171' : colorFor(r.key);
      var arrow = make('path', { fill: 'none', stroke: color, 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
      var box = make('rect', { x: R + REF_GAP, height: REF_H, rx: 5 }, g);
      var text = make('text', { x: R + REF_GAP + 8 }, g);
      return { g: g, arrow: arrow, box: box, text: text, color: color, cur: null };
    }

    function styleLabel(it, r) {
      it.text.textContent = r.text;
      it.box.setAttribute('width', r.w);
      var cls = 'gs-tree-ref-text' + (r.head ? ' is-head' : '') + (r.remote ? ' is-remote' : '');
      it.text.setAttribute('class', cls);
      if (r.detached) {
        it.box.setAttribute('fill', '#111C26');
        it.box.setAttribute('stroke', '#111C26');
        it.text.setAttribute('class', cls + ' is-detached');
      } else if (r.remote) {
        it.box.setAttribute('fill', '#FFFFFF');
        it.box.setAttribute('stroke', '#717171');
        it.box.setAttribute('stroke-dasharray', '3 2');
      } else {
        it.box.setAttribute('fill', tint(it.color, r.head ? 0.62 : 0.85));
        it.box.setAttribute('stroke', it.color);
      }
      it.box.setAttribute('stroke-width', r.head ? 2 : 1.2);
    }

    function frame() {
      raf = null;
      var now = Date.now();
      var busy = false;
      function step(it, apply) {
        if (!it.to) return;
        var t = it.t0 == null ? 1 : Math.min(1, (now - it.t0) / DURATION);
        var e = ease(t);
        Object.keys(it.to).forEach(function (k) { it.cur[k] = lerp(it.from[k], it.to[k], e); });
        apply(it);
        if (t < 1) busy = true;
        else it.to = null;
      }
      Object.keys(nodes).forEach(function (k) { step(nodes[k], applyNode); });
      Object.keys(labels).forEach(function (k) { step(labels[k], applyLabel); });
      Object.keys(edges).forEach(function (k) { applyEdge(edges[k]); });
      if (busy) { schedule(); return; }
      // the tween is over: drop what faded out
      [nodes, labels, edges].forEach(function (set) {
        Object.keys(set).forEach(function (k) {
          if (set[k].dying) {
            var n = set[k].g || set[k].path;
            if (n.parentNode) n.parentNode.removeChild(n);
            delete set[k];
          }
        });
      });
    }

    function animated() {
      if (typeof win.requestAnimationFrame !== 'function') return false;
      try {
        if (win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
      } catch (e) { /* no matchMedia */ }
      return true;
    }

    function schedule() {
      if (raf == null) raf = win.requestAnimationFrame(frame);
    }

    function go(it, to, instant) {
      it.from = {};
      Object.keys(to).forEach(function (k) { it.from[k] = it.cur[k]; });
      it.to = to;
      it.t0 = instant ? null : Date.now();
    }

    var lastGraph = null;

    function update(graph, instant) {
      lastGraph = graph;
      instant = instant || !animated();
      nameNewCommits(graph);
      // the scroll box's width: the svg's own is whatever it was last drawn at
      var width = (svg.parentNode && svg.parentNode.clientWidth) || 300;
      var lay = layout(graph, width);
      // A tree wider than the pane shrinks to fit, as learngitbranching's
      // does, but only so far: past that, small text is worse than a
      // sideways scroll.
      lay.scale = Math.max(0.7, Math.min(1, width / lay.width));
      svg.setAttribute('viewBox', '0 0 ' + lay.width + ' ' + lay.height);
      svg.setAttribute('width', String(Math.floor(lay.width * lay.scale)));
      svg.setAttribute('height', String(Math.ceil(lay.height * lay.scale)));

      if (!graph.commits.length) {
        if (!emptyText) {
          emptyText = make('text', { 'class': 'gs-empty-text', 'text-anchor': 'middle', y: 40 }, svg);
          emptyText.textContent = 'No commits yet.';
        }
        emptyText.setAttribute('x', String(width / 2));
      } else if (emptyText) {
        svg.removeChild(emptyText);
        emptyText = null;
      }

      var byOid = {};
      graph.commits.forEach(function (c) { byOid[c.oid] = c; });

      // Nodes: new ones start on their first parent, small, and grow out of
      // it. Oldest first, so a run of new commits unrolls from one point.
      graph.commits.slice().reverse().forEach(function (c) {
        var p = lay.pos[c.oid];
        var it = nodes[c.oid];
        if (!it || it.dying) {
          if (it) { it.g.parentNode.removeChild(it.g); }
          it = nodes[c.oid] = newNode(c.oid, c);
          var parent = nodes[c.parents[0]];
          var start = parent && !parent.dying ? parent.cur : p;
          it.cur = { x: start.x, y: start.y, s: 0.2, o: 0 };
        }
        it.dying = false;
        go(it, { x: p.x, y: p.y, s: 1, o: 1 }, instant);
      });
      Object.keys(nodes).forEach(function (oid) {
        if (byOid[oid]) return;
        var it = nodes[oid];
        it.dying = true;
        go(it, { s: 0.2, o: 0 }, instant);
      });

      // edges follow their nodes every frame
      var wanted = {};
      graph.commits.forEach(function (c) {
        c.parents.forEach(function (p) {
          if (!byOid[p]) return;
          var key = c.oid + ' ' + p;
          wanted[key] = true;
          if (!edges[key] || edges[key].dying) {
            if (edges[key]) edgeLayer.removeChild(edges[key].path);
            edges[key] = { child: c.oid, parent: p, path: make('path', { 'class': 'gs-tree-edge', fill: 'none' }, edgeLayer) };
          }
          edges[key].dying = false;
          edges[key].path.setAttribute('stroke', names[c.oid].color);
        });
      });
      Object.keys(edges).forEach(function (k) { if (!wanted[k]) edges[k].dying = true; });

      // labels glide from tip to tip; a brand-new label fades in where it lands
      Object.keys(lay.refs).forEach(function (key) {
        var r = lay.refs[key];
        var p = lay.pos[r.oid];
        var it = labels[key];
        if (!it || it.dying) {
          if (it) refLayer.removeChild(it.g);
          it = labels[key] = newLabel(r);
          var n = nodes[r.oid];
          var from = n && n.cur ? n.cur : p;
          it.cur = { x: from.x, y: from.y, dy: r.dy, o: 0 };
        }
        it.dying = false;
        styleLabel(it, r);
        go(it, { x: p.x, y: p.y, dy: r.dy, o: 1 }, instant);
      });
      Object.keys(labels).forEach(function (key) {
        if (lay.refs[key]) return;
        labels[key].dying = true;
        go(labels[key], { o: 0 }, instant);
      });

      // Screen readers get the tree in words: what each branch points at.
      var heads = Object.keys(lay.refs).map(function (k) {
        var r = lay.refs[k];
        return r.text + ' at C' + names[r.oid].n;
      });
      svg.setAttribute('aria-label', graph.commits.length
        ? 'Commit tree, ' + graph.commits.length + ' commit' + (graph.commits.length === 1 ? '' : 's') +
          (heads.length ? ': ' + heads.join(', ') : '')
        : 'Commit tree, no commits yet');

      if (instant) frame(); else schedule();
      return lay;
    }

    function clear() {
      [nodes, labels, edges].forEach(function (set) {
        Object.keys(set).forEach(function (k) {
          var n = set[k].g || set[k].path;
          if (n.parentNode) n.parentNode.removeChild(n);
          delete set[k];
        });
      });
    }

    return {
      update: update,
      // forget every name, as a fresh repository would
      reset: function () {
        names = {}; nextN = 0; branchColors = {}; nextColor = 0;
        clear();
      },
      // redraw the last graph at the pane's current width, without motion
      redraw: function () { if (lastGraph) update(lastGraph, true); },
      snapshot: function () {
        return { names: Object.assign({}, names), nextN: nextN,
                 branchColors: Object.assign({}, branchColors), nextColor: nextColor };
      },
      restore: function (s) {
        names = Object.assign({}, s.names); nextN = s.nextN;
        branchColors = Object.assign({}, s.branchColors); nextColor = s.nextColor;
      },
      labelOf: function (oid) { return names[oid] ? 'C' + names[oid].n : null; }
    };
  }

  // tint is shared with the History graph, so both panels draw alike
  return { createTreeView: createTreeView, tint: tint };
});


/* ------------------------------------------------------------------
   git sandbox UI: terminal + file editor + staging diagram + commit graph.
   Depends on window.GitSandboxCore and window.git (isomorphic-git UMD).
   ------------------------------------------------------------------ */
(function (root) {
  'use strict';

  // Small stroke icons for the file browser; currentColor keeps them on theme.
  function icon(d) {
    return '<svg class="gs-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  var ICON_CHEVRON = icon('M6 4l4 4-4 4');
  var ICON_UP = icon('M8 13V3M4 7l4-4 4 4');
  var ICON_HOME = icon('M3 8l5-4.5L13 8M4.5 7v6h7V7');
  var ICON_PLUS = icon('M8 3v10M3 8h10');
  // a small commit graph: two branches off a trunk
  var ICON_TREE = '<svg class="gs-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
    '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">' +
    '<path d="M5 5.3v5.4M5 10c0-2.5 6-2 6-4.7"/>' +
    '<circle cx="5" cy="3.5" r="1.8"/><circle cx="5" cy="12.5" r="1.8"/><circle cx="11" cy="3.5" r="1.8"/></g></svg>';

  var PANEL_NAMES = ['files', 'changes', 'history', 'remote'];

  // `tree-view` and `panels` take true (always shown), false (left out
  // entirely) or 'toggle' (shown, with a button to fold it away). Anything
  // else falls back to the default.
  function showMode(v, dflt) {
    if (v === true || v === false || v === 'toggle') return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    return dflt;
  }

  var LANE_COLORS = ['#447099', '#419599', '#72994E', '#9A4665', '#EE6331', '#3276B5'];

  function tint(hex, amount) { return root.GitSandboxTree.tint(hex, amount); }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // {g} green {r} red {y} yellow {b} blue {w} bold {/} reset
  function markup(s) {
    var map = { g: 'tg', r: 'tr', y: 'ty', b: 'tb', w: 'tw' };
    var out = esc(s);
    out = out.replace(/\{([grybw])\}/g, function (_m, k) { return '<span class="' + map[k] + '">'; });
    out = out.replace(/\{\/\}/g, '</span>');
    return out;
  }

  /* --------------------- config normalisation ------------------------ */

  // Authors can describe a task three ways:
  //   check: async (c) => ...     a JavaScript predicate (hand-written qmd)
  //   when:  'commits >= 2'       the declarative mini-language (extension)
  //   js:    'c.isRepo'           an escape hatch for the extension
  // Normalise all three to a `check` function, recording any compile error so
  // it can be shown in place instead of failing silently.
  function normaliseTasks(tasks) {
    var W = root.GitSandboxWhen;
    return (tasks || []).map(function (t) {
      var task = { text: t.text, _done: false, _error: null, _files: [] };
      if (typeof t.check === 'function') {
        task.check = t.check;
        return task;
      }
      if (!W) {
        task._error = 'the `when:` compiler is not loaded';
        task.check = function () { return false; };
        return task;
      }
      try {
        if (typeof t.when === 'string' && t.when.trim() !== '') {
          task._files = W.filesNeeded(t.when);
          var pred = W.compileWhen(t.when);
          task.check = function (ctx) { return pred(ctx); };
        } else if (typeof t.js === 'string' && t.js.trim() !== '') {
          var jsPred = W.compileJs(t.js);
          task.check = function (ctx) { return jsPred(ctx); };
        } else {
          throw new Error('a task needs one of `when:`, `js:` or a `check` function');
        }
      } catch (e) {
        task._error = e.message;
        task.check = function () { return false; };
      }
      return task;
    });
  }

  // `seed` may be a function or a block of commands from YAML.
  function normaliseSeed(seed) {
    if (!seed) return null;
    if (typeof seed === 'function') return seed;
    var lines = String(seed).split('\n')
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l !== '' && l.charAt(0) !== '#'; });
    if (!lines.length) return null;
    return async function (sb) {
      for (var i = 0; i < lines.length; i++) {
        var r = await sb.run(lines[i]);
        if (r.editor) {
          throw new Error('seed command opened an editor: ' + lines[i] + ' — give git commit a message with -m');
        }
        // a seed may leave a merge stopped on conflicts for the learner to resolve
        if (!r.ok && !r.conflict) {
          // A broken seed is an authoring bug, so make it loud rather than
          // leaving the learner in a half-built repository.
          throw new Error('seed command failed: ' + lines[i] + ' — ' + String(r.out).split('\n')[0]);
        }
      }
    };
  }

  function normaliseIntro(intro) {
    if (!intro) return [];
    if (Array.isArray(intro)) return intro;
    return String(intro).replace(/\n$/, '').split('\n');
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* --------------------------- commit graph -------------------------- */

  // x where a commit row's text (refs, sha, message) starts
  function graphTextX(model) {
    var maxLane = 0;
    model.commits.forEach(function (c) { if (c.lane > maxLane) maxLane = c.lane; });
    return 22 + maxLane * 24 + 22 + 6;
  }

  // `extra`, for the local history only: { onToggle(oid), open: { oid: px } }.
  // Each row then gets a chevron that opens the commit's contents, and an
  // open row grows by its px so the details (an HTML layer the caller
  // places) fit beneath it with the lanes running on past them. Returns
  // { detailTop: { oid: y } } for that placement.
  function renderGraph(svg, model, extra) {
    extra = extra || {};
    var open = extra.open || {};
    var layout = { detailTop: {} };
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var NS = 'http://www.w3.org/2000/svg';

    // Draw at the SVG's real pixel width so nothing overflows sideways; the
    // graph never needs a horizontal scrollbar.
    var W = svg.clientWidth || 640;

    if (!model.commits.length) {
      svg.setAttribute('viewBox', '0 0 ' + W + ' 60');
      svg.setAttribute('height', '60');
      var t = document.createElementNS(NS, 'text');
      t.setAttribute('x', String(W / 2)); t.setAttribute('y', '34');
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('class', 'gs-empty-text');
      t.textContent = 'No commits yet.';
      svg.appendChild(t);
      return layout;
    }

    var rowH = 44, laneW = 24, padTop = 26, padLeft = 22, lineH = 17;
    var graphW = graphTextX(model) - 6;
    var toggleW = extra.onToggle ? 28 : 0;

    // Wrap a commit message to a character budget, breaking on spaces and
    // hard-breaking any single word longer than the line.
    function wrapWords(text, maxChars) {
      var words = String(text).split(/\s+/), lines = [], cur = '';
      words.forEach(function (w) {
        if (!cur) cur = w;
        else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
        else { lines.push(cur); cur = w; }
      });
      if (cur) lines.push(cur);
      var out = [];
      lines.forEach(function (l) {
        while (l.length > maxChars) { out.push(l.slice(0, maxChars)); l = l.slice(maxChars); }
        out.push(l);
      });
      return out.length ? out : [''];
    }

    // First pass: place refs/sha/message per row and measure the wrapped height.
    var rows = model.commits.map(function (c) {
      var tx = graphW + 6;
      var refLayouts = (c.refs || []).map(function (r) {
        var label = (r.isHead ? 'HEAD → ' : '') + r.name;
        var w = label.length * (r.isHead ? 7.1 : 6.6) + 14;  // the HEAD label is bold
        var lay = { label: label, x: tx, w: w, isHead: r.isHead, remote: r.remote };
        tx += w + 6;
        return lay;
      });
      var shaX = tx, msgX = tx + 62;
      var maxChars = Math.max(8, Math.floor((W - msgX - 12 - toggleW) / 6.8));
      var lines = wrapWords(c.message, maxChars);
      var baseH = Math.max(rowH, lines.length * lineH + 20);
      return { refLayouts: refLayouts, shaX: shaX, msgX: msgX, lines: lines,
               baseH: baseH, h: baseH + (open[c.oid] || 0) };
    });

    // Second pass: stack rows so a wrapped message never overlaps the next.
    var tops = [], acc = padTop;
    rows.forEach(function (r) { tops.push(acc); acc += r.h; });
    var height = acc + 6;

    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + height);
    svg.setAttribute('height', String(height));
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');

    var index = {};
    model.commits.forEach(function (c, i) { index[c.oid] = i; });
    var x = function (lane) { return padLeft + lane * laneW; };
    var cyOf = function (i) { return tops[i] + 16; };

    drawEdges(svg, model, index, x, cyOf);

    model.commits.forEach(function (c, i) {
      var cx = x(c.lane), cy = cyOf(i), row = rows[i];
      var color = LANE_COLORS[c.lane % LANE_COLORS.length];
      drawNode(svg, c, cx, cy, 7);

      row.refLayouts.forEach(function (rl) {
        drawRef(svg, rl, rl.x, cy, 20, 7, color);
      });

      var sha = document.createElementNS(NS, 'text');
      sha.setAttribute('x', row.shaX); sha.setAttribute('y', cy + 4);
      sha.setAttribute('class', 'gs-sha');
      sha.textContent = c.short;
      svg.appendChild(sha);

      var msg = document.createElementNS(NS, 'text');
      msg.setAttribute('y', cy + 4);
      msg.setAttribute('class', 'gs-msg');
      row.lines.forEach(function (line, li) {
        var ts = document.createElementNS(NS, 'tspan');
        ts.setAttribute('x', row.msgX);
        ts.setAttribute('dy', li === 0 ? '0' : String(lineH));
        ts.textContent = line;
        msg.appendChild(ts);
      });
      svg.appendChild(msg);

      if (extra.onToggle) {
        svg.appendChild(commitToggle(NS, c, W - 22, cy, !!open[c.oid], extra.onToggle));
        if (open[c.oid]) layout.detailTop[c.oid] = tops[i] + row.baseH - 6;
      }
    });
    return layout;
  }

  // parent links, drawn before the nodes so the nodes sit on top
  function drawEdges(svg, model, index, x, cyOf) {
    var NS = 'http://www.w3.org/2000/svg';
    model.commits.forEach(function (c, i) {
      (c.parents || []).forEach(function (p, pi) {
        if (!(p in index)) return;
        var j = index[p];
        var x1 = x(c.lane), y1 = cyOf(i), x2 = x(model.commits[j].lane), y2 = cyOf(j);
        var path = document.createElementNS(NS, 'path');
        var d;
        if (x1 === x2) {
          d = 'M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2;
        } else {
          var mid = y1 + (y2 - y1) * 0.55;
          d = 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + mid + ' ' + x2 + ',' + (y2 - (y2 - y1) * 0.45) + ' ' + x2 + ',' + y2;
        }
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', LANE_COLORS[(pi === 0 ? c.lane : model.commits[j].lane) % LANE_COLORS.length]);
        path.setAttribute('stroke-width', '2');
        path.setAttribute('opacity', '0.55');
        svg.appendChild(path);
      });
    });
  }

  // Outlined in the lane colour over a pale tint of it, as in the commit
  // tree; merge commits stay hollow.
  function drawNode(svg, c, cx, cy, r) {
    var color = LANE_COLORS[c.lane % LANE_COLORS.length];
    var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx); circle.setAttribute('cy', cy);
    circle.setAttribute('r', r);
    circle.setAttribute('fill', (c.parents || []).length > 1 ? '#FFFFFF' : tint(color, 0.8));
    circle.setAttribute('stroke', color);
    circle.setAttribute('stroke-width', r > 5 ? '2.5' : '2');
    svg.appendChild(circle);
  }

  // A ref label centred on y, styled like the commit tree's: a tinted box
  // outlined in the branch colour, bolder for HEAD, grey for remote refs:
  // dashed for the local repo's remote-tracking copies, solid for the
  // remote's own branches. `rl` is { label, w, isHead, remote, onRemote }.
  function drawRef(svg, rl, x, y, h, padX, color) {
    var NS = 'http://www.w3.org/2000/svg';
    var rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', x); rect.setAttribute('y', y - h / 2);
    rect.setAttribute('width', rl.w); rect.setAttribute('height', h);
    rect.setAttribute('rx', h / 4);
    if (rl.remote) {
      rect.setAttribute('fill', '#FFFFFF');
      rect.setAttribute('stroke', '#717171');
      if (!rl.onRemote) rect.setAttribute('stroke-dasharray', '3 2');
    } else {
      rect.setAttribute('fill', tint(color, rl.isHead ? 0.62 : 0.85));
      rect.setAttribute('stroke', color);
    }
    rect.setAttribute('stroke-width', rl.isHead ? '2' : '1.2');
    svg.appendChild(rect);
    var lt = document.createElementNS(NS, 'text');
    lt.setAttribute('x', x + padX); lt.setAttribute('y', y + h / 5);
    lt.setAttribute('class', rl.isHead ? 'gs-ref gs-ref-head' : (rl.remote ? 'gs-ref gs-ref-remote' : 'gs-ref'));
    lt.textContent = rl.label;
    svg.appendChild(lt);
  }

  // The commit graph squeezed into half a panel, for the side-by-side
  // local/remote view. Narrower lanes and smaller type; ref labels get a
  // line of their own above the sha and message (wrapping onto more lines
  // when they don't fit), and the message is cut to one line, with the
  // full text on hover. `onRemote` marks the remote's own graph, whose
  // labels are its branches rather than tracking copies of them.
  function renderCompactGraph(svg, model, onRemote) {
    var NS = 'http://www.w3.org/2000/svg';
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var W = svg.clientWidth || 320;

    if (!model.commits.length) {
      svg.setAttribute('viewBox', '0 0 ' + W + ' 44');
      svg.setAttribute('height', '44');
      var t = document.createElementNS(NS, 'text');
      t.setAttribute('x', String(W / 2)); t.setAttribute('y', '26');
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('class', 'gs-empty-text');
      t.textContent = 'No commits yet.';
      svg.appendChild(t);
      return;
    }

    var laneW = 14, padLeft = 12, padTop = 10, refH = 16, refGap = 4, textH = 18, rowGap = 8;
    var maxLane = 0;
    model.commits.forEach(function (c) { if (c.lane > maxLane) maxLane = c.lane; });
    var textX = padLeft + maxLane * laneW + 14;
    var avail = W - textX - 6;

    var rows = model.commits.map(function (c) {
      // ref labels flow left to right, onto a new line when one won't fit
      var refLines = [], line = [], lx = textX;
      (c.refs || []).forEach(function (r) {
        var label = (r.isHead ? 'HEAD → ' : '') + r.name;
        var w = label.length * (r.isHead ? 6.5 : 6.1) + 10;
        if (line.length && lx + w > W - 6) { refLines.push(line); line = []; lx = textX; }
        line.push({ label: label, x: lx, w: w, isHead: r.isHead, remote: r.remote, onRemote: !!onRemote });
        lx += w + 4;
      });
      if (line.length) refLines.push(line);
      var msgX = textX + 52;
      var maxChars = Math.max(4, Math.floor((W - msgX - 6) / 6.3));
      var msg = String(c.message).split('\n')[0];
      var cut = msg.length > maxChars;
      return {
        refLines: refLines, msgX: msgX, msg: cut ? msg.slice(0, maxChars - 1) + '…' : msg, cut: cut,
        h: refLines.length * (refH + refGap) + textH + rowGap
      };
    });

    var tops = [], acc = padTop;
    rows.forEach(function (r) { tops.push(acc); acc += r.h; });
    var height = acc - rowGap + padTop;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + height);
    svg.setAttribute('height', String(height));
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');

    var index = {};
    model.commits.forEach(function (c, i) { index[c.oid] = i; });
    var x = function (lane) { return padLeft + lane * laneW; };
    // the node sits level with the first line of its row
    var cyOf = function (i) {
      return tops[i] + (rows[i].refLines.length ? refH / 2 : textH / 2);
    };

    drawEdges(svg, model, index, x, cyOf);

    model.commits.forEach(function (c, i) {
      var row = rows[i], top = tops[i];
      var color = LANE_COLORS[c.lane % LANE_COLORS.length];
      drawNode(svg, c, x(c.lane), cyOf(i), 5);
      row.refLines.forEach(function (l, li) {
        var cy = top + li * (refH + refGap) + refH / 2;
        l.forEach(function (rl) { drawRef(svg, rl, rl.x, cy, refH, 5, color); });
      });
      var ty = top + row.refLines.length * (refH + refGap) + textH / 2 + 4;
      var sha = document.createElementNS(NS, 'text');
      sha.setAttribute('x', textX); sha.setAttribute('y', ty);
      sha.setAttribute('class', 'gs-sha');
      sha.textContent = c.short;
      svg.appendChild(sha);
      var msg = document.createElementNS(NS, 'text');
      msg.setAttribute('x', row.msgX); msg.setAttribute('y', ty);
      msg.setAttribute('class', 'gs-msg');
      msg.textContent = row.msg;
      if (row.cut) {
        var title = document.createElementNS(NS, 'title');
        title.textContent = c.message;
        msg.appendChild(title);
      }
      svg.appendChild(msg);
    });
  }

  // The chevron at the end of a history row: a keyboard-reachable SVG
  // button that opens or closes the commit's contents.
  function commitToggle(NS, c, x, cy, isOpen, onToggle) {
    var g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'gs-cd-toggle' + (isOpen ? ' is-open' : ''));
    g.setAttribute('role', 'button');
    g.setAttribute('tabindex', '0');
    g.setAttribute('data-oid', c.oid);
    g.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    g.setAttribute('aria-label', (isOpen ? 'Hide' : 'Show') + ' the contents of commit ' + c.short);
    var title = document.createElementNS(NS, 'title');
    title.textContent = isOpen ? 'Hide contents' : 'Show contents';
    g.appendChild(title);
    var hit = document.createElementNS(NS, 'rect');
    hit.setAttribute('x', x - 11); hit.setAttribute('y', cy - 11);
    hit.setAttribute('width', 22); hit.setAttribute('height', 22);
    hit.setAttribute('rx', 5);
    hit.setAttribute('class', 'gs-cd-toggle-bg');
    g.appendChild(hit);
    var chev = document.createElementNS(NS, 'path');
    // points right when closed and down when open, like the file browser's
    chev.setAttribute('d', isOpen
      ? 'M' + (x - 4) + ',' + (cy - 2) + ' l4,4 l4,-4'
      : 'M' + (x - 2) + ',' + (cy - 4) + ' l4,4 l-4,4');
    chev.setAttribute('class', 'gs-cd-chev');
    g.appendChild(chev);
    g.addEventListener('click', function () { onToggle(c.oid); });
    g.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(c.oid); }
    });
    return g;
  }

  /* ------------------------------ diff panel ------------------------- */

  function renderDiff(node, model) {
    if (!model) {
      node.innerHTML = '<div class="gs-diff-empty">Nothing is tracked yet — run <code>git init</code> to start.</div>';
      return;
    }
    if (!model.files.length) {
      node.innerHTML = '<div class="gs-diff-empty">Working directory clean — no changes since the last commit.</div>';
      return;
    }
    node.innerHTML = model.files.map(diffFileHtml).join('');
  }

  // one file's block in a diff view (the Changes panel, a commit's contents)
  function diffFileHtml(f) {
    var rows = f.binary
      ? '<div class="gs-diff-line"><span class="gs-diff-text">Binary file, not shown.</span></div>'
      : f.lines.map(function (l) {
          var cls = l.t === '+' ? ' gs-diff-add' : (l.t === '-' ? ' gs-diff-del' : '');
          return '<div class="gs-diff-line' + cls + '">' +
            '<span class="gs-diff-num">' + (l.a || '') + '</span>' +
            '<span class="gs-diff-num">' + (l.b || '') + '</span>' +
            '<span class="gs-diff-sign">' + (l.t === ' ' ? '' : l.t) + '</span>' +
            '<span class="gs-diff-text">' + esc(l.text) + '</span>' +
          '</div>';
        }).join('');
    return '<div class="gs-diff-file">' +
      '<div class="gs-diff-filehead">' +
        '<span class="gs-diff-name">' + esc(f.file) + '</span>' +
        '<span class="gs-diff-kind gs-diff-kind-' + f.kind + '">' + f.kind + '</span>' +
      '</div>' + rows +
    '</div>';
  }

  // The contents of one commit, shown under its row in the History graph.
  function commitDetailsHtml(d) {
    var when = new Date(d.timestamp * 1000);
    var whenText = isNaN(when.getTime()) ? '' : when.toLocaleString();
    var note = d.parents.length > 1
      ? '<div class="gs-cd-note">A merge of ' + d.parents.map(function (p) { return '<code>' + p.slice(0, 7) + '</code>'; }).join(' and ') +
        '. Changes are shown against the first parent, so they are what the merge brought in.</div>'
      : (!d.parents.length ? '<div class="gs-cd-note">The first commit: everything in it is new.</div>' : '');
    var files = d.files.length
      ? d.files.map(diffFileHtml).join('')
      : '<div class="gs-diff-empty">No file changes.</div>';
    return '<div class="gs-cd-meta"><code class="gs-cd-oid">' + esc(d.oid) + '</code>' +
        '<span>' + esc(d.author) + ' &lt;' + esc(d.email) + '&gt;</span>' +
        (whenText ? '<span>' + esc(whenText) + '</span>' : '') + '</div>' +
      '<div class="gs-cd-msg">' + esc(d.message) + '</div>' + note +
      '<div class="gs-cd-files" aria-label="Files changed">' + files + '</div>';
  }

  /* -------------------------- staging diagram ------------------------ */

  function renderStages(node, status, graph, files, isRepo) {
    var needAdd = (status.conflicted || []).map(function (c) { return { f: c.file, k: 'conflict: ' + c.kind, conflict: true }; })
      .concat(status.untracked.map(function (f) { return { f: f, k: 'untracked' }; }))
      .concat(status.modified.map(function (f) { return { f: f, k: 'modified' }; }))
      .concat(status.deleted.map(function (f) { return { f: f, k: 'deleted' }; }));
    var staged = status.staged.map(function (s) { return { f: s.file, k: s.kind }; })
      .concat(status.stagedDeleted.map(function (f) { return { f: f, k: 'deleted' }; }));

    // The working directory lists only what has changed since the last
    // commit; committed-and-clean files would crowd the changes out. Before
    // `git init` there is no git status at all, so every file shows, as a
    // quiet grey chip: calling them "untracked" would use a git-status word
    // while no git status exists yet.
    var accounted = {};
    needAdd.concat(staged).forEach(function (it) { accounted[it.f] = true; });
    var clean = isRepo ? [] : (files || [])
      .filter(function (f) { return !accounted[f]; })
      .map(function (f) { return { f: f, k: 'not in git yet' }; });
    // Files .gitignore matches are there on disk but invisible to git, so
    // they show as quiet chips: proof that the ignore rule works.
    var ignored = isRepo ? (status.ignored || []).map(function (f) { return { f: f, k: 'ignored', quiet: true }; }) : [];

    function col(title, note, items, kind) {
      var chips = items.length
        ? items.map(function (it) {
            var quiet = it.k === 'not in git yet' || it.quiet;
            var cls = 'gs-chip gs-chip-' + kind + (quiet ? ' gs-chip-clean' : '') +
              (it.conflict ? ' gs-chip-conflict' : '');
            return '<span class="' + cls + '" data-col="' + kind + '" data-file="' + esc(it.f) + '">' + esc(it.f) +
                   '<span class="gs-chip-k">' + esc(it.k) + '</span></span>';
          }).join('')
        : '<span class="gs-chip gs-chip-empty">empty</span>';
      return '<div class="gs-col">' +
             '<div class="gs-col-h">' + esc(title) + '</div>' +
             '<div class="gs-col-n">' + esc(note) + '</div>' +
             '<div class="gs-chips">' + chips + '</div></div>';
    }

    var nCommits = graph.commits.length;
    var repoItems = nCommits
      ? [{ f: nCommits + ' commit' + (nCommits === 1 ? '' : 's'), k: graph.head || 'detached' }]
      : [];

    node.innerHTML =
      col('Working directory', 'what you edit', needAdd.concat(clean, ignored), 'work') +
      '<div class="gs-arrow"><span>git add</span><i class="gs-arrow-g">→</i></div>' +
      col('Staging area', 'what goes in next commit', staged, 'stage') +
      '<div class="gs-arrow"><span>git commit</span><i class="gs-arrow-g">→</i></div>' +
      col('Repository', 'permanent history', repoItems, 'repo');
  }

  // Where each file chip sits, keyed by column and file ("stage:a.txt"): a
  // file can be in two columns at once (staged, then edited again).
  function chipRects(node) {
    var out = {};
    node.querySelectorAll('.gs-chip[data-file]').forEach(function (c) {
      var r = chipBox(node, c);
      if (!r.w) return;
      r.el = c;
      out[c.getAttribute('data-col') + ':' + c.getAttribute('data-file')] = r;
    });
    return out;
  }

  // How much the page is scaled between `node`'s CSS pixels and the screen.
  // reveal.js scales each slide to fit the window, so on a slide the
  // on-screen rectangles are larger or smaller than the lengths the
  // animations set; without this the chips fly off past their targets.
  function layoutScale(node) {
    var r = node.getBoundingClientRect();
    return node.offsetWidth && r.width ? r.width / node.offsetWidth : 1;
  }

  // Show files travelling between the columns after a re-render, so
  // `git add` visibly carries a file from the working directory to the
  // staging area and `git commit` turns the staged files into a commit in
  // the repository. `before` is chipRects() from just before the render.
  // Chips that changed column glide across one after another (FLIP), chips
  // that only shifted within a column settle into place, and new ones fade
  // in once the travellers have left. On a commit (`commitColor` is the new
  // commit's lane colour) the staged chips morph together into one commit
  // node, drawn like the nodes in the graph, which then glides into the
  // repository. A no-op where the Web Animations API is missing, the panel
  // is hidden, or the reader asked for reduced motion.
  function animateStages(node, before, commitColor) {
    if (!before || typeof node.animate !== 'function') return;
    if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!node.getBoundingClientRect().width || !Object.keys(before).length) return;
    var now = chipRects(node);
    var repo = node.querySelector('.gs-chip-repo');
    var repoBox = repo ? chipBox(node, repo) : null;
    var STAGGER = 40, MAX_STAGGER = 200;
    var claimed = {}, travellers = 0, committing = [];

    function stagger(n) { return Math.min(n * STAGGER, MAX_STAGGER); }

    // across columns: slow enough to follow
    function glide(el, from, to) {
      var dx = from.x - to.x, dy = from.y - to.y;
      if (!dx && !dy) return;
      el.animate([{ transform: 'translate(' + dx + 'px, ' + dy + 'px)' }, { transform: 'none' }],
        { duration: 520, delay: stagger(travellers++), easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'backwards' });
    }

    // within a column: closing the gap a departing chip left behind
    function settle(el, from, to) {
      var dx = from.x - to.x, dy = from.y - to.y;
      if (!dx && !dy) return;
      el.animate([{ transform: 'translate(' + dx + 'px, ' + dy + 'px)' }, { transform: 'none' }],
        { duration: 380, delay: 120, easing: 'cubic-bezier(0.3, 0, 0.2, 1)', fill: 'backwards' });
    }

    Object.keys(before).forEach(function (key) {
      var old = before[key];
      var colName = key.slice(0, key.indexOf(':'));
      var file = key.slice(key.indexOf(':') + 1);
      if (now[key]) { settle(now[key].el, old, now[key]); claimed[key] = true; return; }
      if (colName === 'stage' && commitColor && repoBox) { committing.push(old); return; }
      // across to the other column: `git add` (work -> stage) or back
      var other = (colName === 'work' ? 'stage' : 'work') + ':' + file;
      if (now[other] && !before[other]) { glide(now[other].el, old, now[other]); claimed[other] = true; }
    });

    var landed = committing.length ? commitIntoRepo(node, committing, repo, repoBox, commitColor) : 0;

    // newcomers wait until the travellers are under way
    var lastStart = stagger(Math.max(travellers - 1, 0));
    Object.keys(now).forEach(function (key) {
      // the repository chip is relabelled ("3 commits"), not new
      if (claimed[key] || before[key] || key.indexOf('repo:') === 0) return;
      now[key].el.animate([{ opacity: 0 }, { opacity: 1 }],
        { duration: 360, delay: (committing.length ? 300 : 120) + lastStart, easing: 'ease-out', fill: 'backwards' });
    });
    if (landed) {
      // the new count fades in as the commit lands
      var ink = (root.getComputedStyle && root.getComputedStyle(repo).color) || '#22384C';
      repo.animate([{ color: 'rgba(0,0,0,0)' }, { color: 'rgba(0,0,0,0)', offset: landed / (landed + 240) }, { color: ink }],
        { duration: landed + 240 });
    }
  }

  // The commit half of animateStages: the staged chips (`olds`, chipRects()
  // entries from before the render) become one shape that morphs into a
  // commit node, a circle drawn like the graph's, and glides into the
  // repository chip. Returns when, in ms, the node lands.
  var NODE = 16, MORPH = 480, MOVE = 520;
  function commitIntoRepo(node, olds, repo, repoBox, color) {
    // one box around all the staged chips, holding copies of them
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    olds.forEach(function (o) {
      x0 = Math.min(x0, o.x); y0 = Math.min(y0, o.y);
      x1 = Math.max(x1, o.x + o.w); y1 = Math.max(y1, o.y + o.h);
    });
    var shape = document.createElement('span');
    shape.className = 'gs-chip-ghost gs-commit-node';
    node.appendChild(shape);
    var parts = olds.map(function (old) {
      var part = old.el.cloneNode(true);
      // not a real chip: keep it out of the next chipRects()
      part.removeAttribute('data-col');
      part.removeAttribute('data-file');
      part.classList.add('gs-chip-part');
      part.style.left = old.x - x0 + 'px';
      part.style.top = old.y - y0 + 'px';
      part.style.width = old.w + 'px';
      shape.appendChild(part);
      return part;
    });
    // the copies are attached now, so they have the staged chips' colour
    var cs = root.getComputedStyle ? root.getComputedStyle(parts[0]) : null;
    var green = (cs && cs.backgroundColor) || '#DBE6D3';

    var total = MORPH + MOVE, formed = MORPH / total, landed = (MORPH + MOVE * 0.85) / total;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var tx = repoBox.x + repoBox.w / 2, ty = repoBox.y + repoBox.h / 2;
    var ease = 'cubic-bezier(0.45, 0, 0.25, 1)';
    function frame(x, y, w, h, offset, look) {
      return {
        left: x - w / 2 + 'px', top: y - h / 2 + 'px', width: w + 'px', height: h + 'px',
        borderRadius: look.r, backgroundColor: look.bg, boxShadow: 'inset 0 0 0 ' + look.ring + 'px ' + color,
        opacity: look.op, offset: offset, easing: ease
      };
    }
    var commit = { r: '50%', bg: tint(color, 0.8), ring: 2.5, op: 1 };
    shape.animate([
      frame(cx, cy, x1 - x0, y1 - y0, 0, { r: '4px', bg: 'rgba(0,0,0,0)', ring: 0, op: 1 }),
      // the chips have merged into one block
      frame(cx, cy, (x1 - x0) * 0.8, (y1 - y0) * 0.8, formed * 0.35, { r: '6px', bg: green, ring: 0, op: 1 }),
      frame(cx, cy, NODE, NODE, formed, commit),
      frame(tx, ty, NODE, NODE, landed, commit),
      frame(tx, ty, NODE, NODE, 1, { r: '50%', bg: tint(color, 0.8), ring: 2.5, op: 0 })
    ], { duration: total, fill: 'forwards' }).onfinish = function () {
      if (shape.parentNode) shape.parentNode.removeChild(shape);
    };
    // the files' own labels and colours give way to the one block
    parts.forEach(function (part) {
      part.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MORPH * 0.35, easing: 'ease-in', fill: 'forwards' });
    });
    return Math.round(MORPH + MOVE * 0.85);
  }

  // The lane colour of the commit HEAD points at, as the graph draws it.
  function commitColor(graph) {
    var head = graph.commits.filter(function (c) { return c.oid === graph.headOid; })[0];
    return LANE_COLORS[(head ? head.lane : 0) % LANE_COLORS.length];
  }

  // `el`'s box relative to `node`, in node's own (unscaled) CSS pixels.
  function chipBox(node, el) {
    var base = node.getBoundingClientRect(), r = el.getBoundingClientRect();
    var k = layoutScale(node);
    return { x: (r.left - base.left) / k, y: (r.top - base.top) / k, w: r.width / k, h: r.height / k };
  }

  /* ------------------------------- mount ----------------------------- */

  // Exercises that share one repository (`share: <id>`), by that id. The
  // exercise with the id is the origin and seeds it; every view of it gets
  // the same sandbox, and they keep each other up to date. The undo stack
  // belongs to the group: it holds the repository's history, whichever
  // view a change was made in.
  var groups = {};

  function groupFor(key, config) {
    var g = key ? groups[key] : null;
    if (g) return g;
    g = {
      sb: root.GitSandboxCore.createSandbox({
        git: root.git,
        displayDir: (config.prompt || '~/project').replace(/\s*\$\s*$/, '')
      }),
      seed: null,
      ready: Promise.resolve(),
      undo: [],
      members: []
    };
    if (key) groups[key] = g;
    return g;
  }

  function mount(selector, config) {
    config = config || {};
    var host = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!host) return null;

    if (!root.git || typeof root.git.init !== 'function') {
      host.classList.add('gs');
      host.innerHTML = '<div class="gs-loading">This exercise could not start: the git library did not load. ' +
        'Check that isomorphic-git.bundle.js is reachable from this page.</div>';
      return null;
    }
    if (typeof root.Buffer === 'undefined') {
      // isomorphic-git's index code calls a global Buffer. The bundle shipped with
      // this lesson provides one; a bare CDN copy of isomorphic-git does not.
      host.classList.add('gs');
      host.innerHTML = '<div class="gs-loading">This exercise could not start: no Buffer polyfill is present. ' +
        'Load isomorphic-git.bundle.js (which includes one) rather than isomorphic-git on its own.</div>';
      return null;
    }

    // `share: <id>` makes this box another view of exercise <id>'s
    // repository: its own title, tasks, terminal and layout, the same files
    // and history.
    var shareKey = config.share ? String(config.share) : null;
    var group = groupFor(shareKey || host.id || null, config);
    var isOrigin = !shareKey;
    var sb = group.sb;
    var self = {};
    group.members.push(self);
    var history = [];
    var histIdx = -1;
    var busy = false;
    var tasks = normaliseTasks(config.tasks);
    var seed = normaliseSeed(config.seed);
    // only the origin seeds a shared repository; a view that mounts before
    // its origin starts empty and catches up when the origin arrives
    if (isOrigin) group.seed = seed;
    var intro = normaliseIntro(config.intro);
    // The learngitbranching-style pane: `tree-view: true` shows it beside
    // the box, 'toggle' (the default) puts a button in the header that
    // opens it, and false leaves it out.
    var treeMode = root.GitSandboxTree ? showMode(config.treeView, 'toggle') : false;
    var treeOn = treeMode !== false;
    var treeShown = treeMode === true;
    // The editor tab (and with it the tab strip) can be turned off.
    var editorOn = config.editor !== false && config.editor !== 'false';
    // The panels below the terminal: the same three modes, here 'toggle'
    // starts open with a chevron to fold them. `panelTabs` picks which
    // panels there are at all.
    var panelTabs = Array.isArray(config.panelTabs)
      ? PANEL_NAMES.filter(function (n) { return config.panelTabs.indexOf(n) !== -1; })
      : PANEL_NAMES.slice();
    var panelMode = panelTabs.length ? showMode(config.panels, 'toggle') : false;
    var panelsOpen = panelMode !== false;

    host.classList.add('gs');
    host.classList.toggle('gs-has-tree', treeShown);
    host.innerHTML =
      '<div class="gs-head">' +
        // The workspace tabs live in the title bar and open onto the dark
        // pane below it: the terminal and the file editor share that pane,
        // one at a time, like tabs in a code editor.
        (editorOn
          ? '<div class="gs-titlebar" role="tablist" aria-label="Workspace">' +
              '<button type="button" class="gs-wtab is-active" role="tab" aria-selected="true" data-view="terminal">' +
                '<span class="gs-wtab-icon" aria-hidden="true">&gt;_</span>Terminal</button>' +
              '<button type="button" class="gs-wtab" role="tab" aria-selected="false" data-view="editor">' +
                '<span class="gs-wtab-icon" aria-hidden="true">{ }</span>Editor' +
                '<span class="gs-wtab-dirty" title="Unsaved changes" hidden>●<span class="gs-sr"> (unsaved changes)</span></span></button>' +
            '</div>'
          : '') +
        '<span class="gs-eyebrow">' + esc(config.title || 'Git sandbox') + '</span>' +
        '<span class="gs-state"></span>' +
        '<button type="button" class="gs-undo" disabled>Undo</button>' +
        '<button type="button" class="gs-reset">Reset</button>' +
        (treeMode === 'toggle'
          ? '<button type="button" class="gs-tree-btn" aria-pressed="false" aria-label="Commit tree"' +
            ' title="Show the commit tree">' + ICON_TREE + '</button>'
          : '') +
      '</div>' +
      '<div class="gs-body">' +
        '<div class="gs-term-wrap">' +
          '<div class="gs-view" role="tabpanel" data-view="terminal">' +
            '<div class="gs-out" role="log" aria-live="polite" aria-label="Terminal output"></div>' +
            '<form class="gs-input-row" autocomplete="off">' +
              '<label class="gs-prompt" for="' + (host.id || 'gs') + '-in">' + esc(config.prompt || '~/project $') + '</label>' +
              '<input class="gs-input" id="' + (host.id || 'gs') + '-in" type="text" spellcheck="false"' +
              ' autocapitalize="off" autocorrect="off" aria-label="Type a git command"' +
              ' placeholder="type a command and press Enter">' +
            '</form>' +
            // `git commit` without -m opens this, as real git opens vim
            '<div class="gs-vim" hidden>' +
              '<textarea class="gs-vim-text" spellcheck="false" autocapitalize="off" autocorrect="off"' +
              ' aria-label="vim, editing the commit message"></textarea>' +
              '<div class="gs-vim-status" role="status"></div>' +
            '</div>' +
            '<div class="gs-hints"></div>' +
          '</div>' +
          '<div class="gs-view gs-view-editor" role="tabpanel" data-view="editor" hidden>' +
            '<div class="gs-fb">' +
              '<div class="gs-fb-head">' +
                '<button type="button" class="gs-fb-btn gs-fb-up" aria-label="Up one folder" title="Up one folder">' + ICON_UP + '</button>' +
                '<span class="gs-fb-title"></span>' +
                '<button type="button" class="gs-fb-btn gs-fb-home" aria-label="Back to the working directory" title="Back to the working directory" hidden>' + ICON_HOME + '</button>' +
                '<button type="button" class="gs-fb-btn gs-fb-new" aria-label="New file" title="New file">' + ICON_PLUS + '</button>' +
              '</div>' +
              '<form class="gs-fb-create" autocomplete="off" hidden>' +
                '<input class="gs-fb-name" type="text" spellcheck="false" autocapitalize="off" autocorrect="off"' +
                ' aria-label="New file name" placeholder="name, e.g. notes.md">' +
                '<div class="gs-fb-err" role="alert"></div>' +
              '</form>' +
              '<ul class="gs-fb-list" aria-label="Files"></ul>' +
              '<label class="gs-fb-foot">' +
                '<input type="checkbox" class="gs-fb-hidden" role="switch">' +
                '<span class="gs-switch" aria-hidden="true"></span>Show hidden files' +
              '</label>' +
            '</div>' +
            '<div class="gs-ed">' +
              '<div class="gs-ed-head">' +
                '<span class="gs-ed-name"></span>' +
                '<span class="gs-ed-status" role="status"></span>' +
                '<button type="button" class="gs-ed-btn gs-ed-revert" disabled>Revert</button>' +
                '<button type="button" class="gs-ed-btn gs-ed-save" disabled>Save</button>' +
              '</div>' +
              '<textarea class="gs-ed-text" spellcheck="false" autocapitalize="off" autocorrect="off"' +
              ' aria-label="File contents" hidden></textarea>' +
              '<div class="gs-ed-empty"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="gs-tasks"></div>' +
        '<div class="gs-viz"' + (panelMode === false ? ' hidden' : '') + '>' +
          // One panel at a time; each tab carries a live badge so the folded
          // panels still tell you what they hold at a glance.
          '<div class="gs-tabs" role="tablist" aria-label="Repository views">' +
            '<button type="button" class="gs-tab is-active" role="tab" aria-selected="true" data-tab="files">File Status<span class="gs-tab-badge" hidden></span></button>' +
            '<button type="button" class="gs-tab" role="tab" aria-selected="false" data-tab="changes">Changes<span class="gs-tab-badge" hidden></span></button>' +
            '<button type="button" class="gs-tab" role="tab" aria-selected="false" data-tab="history">History<span class="gs-tab-badge" hidden></span></button>' +
            '<button type="button" class="gs-tab" role="tab" aria-selected="false" data-tab="remote" hidden>Remote<span class="gs-tab-badge" hidden></span></button>' +
            (panelMode === 'toggle'
              ? '<button type="button" class="gs-viz-toggle" aria-expanded="true" aria-label="Repository views"' +
                ' title="Hide these views">' + ICON_CHEVRON + '</button>'
              : '') +
          '</div>' +
          // divs, not <section>s: reveal.js takes every section for a slide
          '<div class="gs-panel" role="tabpanel" data-panel="files">' +
            '<div class="gs-stages"></div>' +
          '</div>' +
          '<div class="gs-panel" role="tabpanel" data-panel="changes" hidden>' +
            '<div class="gs-diff"></div>' +
          '</div>' +
          '<div class="gs-panel" role="tabpanel" data-panel="history" hidden>' +
            '<div class="gs-graph-scroll"><svg class="gs-graph" xmlns="http://www.w3.org/2000/svg"></svg>' +
              '<div class="gs-cd-layer"></div></div>' +
          '</div>' +
          '<div class="gs-panel" role="tabpanel" data-panel="remote" hidden>' +
            '<div class="gs-remote" hidden>' +
              // the learner's repository and the remote side by side, so a
              // push or pull can be watched moving commits across
              '<div class="gs-split">' +
                '<div class="gs-side gs-side-local">' +
                  '<div class="gs-side-head"><span class="gs-side-label">Local</span></div>' +
                  '<div class="gs-graph-scroll"><svg class="gs-local-graph gs-graph-compact" xmlns="http://www.w3.org/2000/svg"></svg></div>' +
                '</div>' +
                '<div class="gs-side gs-side-remote">' +
                  '<div class="gs-side-head"><span class="gs-side-label">Remote</span>' +
                    '<span class="gs-remote-name"></span></div>' +
                  '<div class="gs-graph-scroll"><svg class="gs-remote-graph gs-graph-compact" xmlns="http://www.w3.org/2000/svg"></svg></div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      (treeOn
        // Beside the whole box rather than in a tab, so learners can keep
        // an eye on the tree while they type.
        // A div, not an <aside>: Quarto's page grid sends asides to the margin.
        ? '<div class="gs-tree" role="complementary" aria-label="Commit tree"' + (treeShown ? '' : ' hidden') + '>' +
            '<div class="gs-tree-inner">' +
            '<div class="gs-tree-head"><span class="gs-eyebrow">Commit tree</span></div>' +
            '<div class="gs-tree-scroll"><svg class="gs-tree-svg" xmlns="http://www.w3.org/2000/svg" role="img"></svg></div>' +
          '</div></div>'
        : '');

    // a long title is cut short to fit the bar; the full one is on hover
    var titleNode = host.querySelector('.gs-head > .gs-eyebrow');
    titleNode.title = titleNode.textContent;

    var out = host.querySelector('.gs-out');
    var form = host.querySelector('.gs-input-row');
    var input = host.querySelector('.gs-input');
    var hintsNode = host.querySelector('.gs-hints');
    var stagesNode = host.querySelector('.gs-stages');
    var diffNode = host.querySelector('.gs-diff');
    var svg = host.querySelector('.gs-graph');
    var cdLayer = host.querySelector('.gs-cd-layer');
    // History rows opened to show what the commit changed. Details are
    // cached by oid: a commit never changes, it can only go away.
    var openCommits = {};
    var commitInfo = {};
    var remoteWrap = host.querySelector('.gs-remote');
    var remoteSvg = host.querySelector('.gs-remote-graph');
    var localSvg = host.querySelector('.gs-local-graph');
    var remoteNameNode = host.querySelector('.gs-remote-name');
    // the remote shown on the right; with more than one, a dropdown picks it
    var remoteName = null;
    var tasksNode = host.querySelector('.gs-tasks');
    var resetBtn = host.querySelector('.gs-reset');
    var undoBtn = host.querySelector('.gs-undo');
    var vimNode = host.querySelector('.gs-vim');
    var vimText = host.querySelector('.gs-vim-text');
    var vimStatus = host.querySelector('.gs-vim-status');
    // the open vim session, if any: { abandon() }
    var vim = null;
    var treeScroll = host.querySelector('.gs-tree-scroll');
    var tree = treeOn ? root.GitSandboxTree.createTreeView(host.querySelector('.gs-tree-svg')) : null;
    // the first drawing after a reset appears at once; later ones animate
    var treeInstant = true;

    // Undo is full time travel: each entry restores the repo, the task
    // ticks, the command history and the terminal together, so the undone
    // command leaves no trace anywhere. Only commands that actually changed
    // state get an entry, so `undo` never appears to do nothing.
    var undoStack = group.undo;
    var UNDO_DEPTH = 20;

    function pushUndo(snap) {
      snap.owner = self;
      undoStack.push(snap);
      if (undoStack.length > UNDO_DEPTH) undoStack.shift();
    }

    // can this view undo? only its own change, and only the latest one:
    // undoing past a change made in another view would take that back too
    function canUndo() {
      var top = undoStack[undoStack.length - 1];
      return !!top && top.owner === self;
    }

    // the other views of a shared repository redraw after every change
    // here; `note` is a line for their terminals
    function notifyViews(note) {
      group.members.forEach(function (m) {
        if (m === self || !m.refresh) return;
        if (note) m.note(note);
        m.refresh();
      });
    }

    function captureUndo(line) {
      return {
        line: line,
        core: sb.snapshot(),
        outHtml: out.innerHTML,
        prompt: host.querySelector('.gs-prompt').textContent,
        histLen: history.length,
        done: tasks.map(function (t) { return !!t._done; }),
        tree: tree ? tree.snapshot() : null
      };
    }

    function doUndo() {
      if (!canUndo()) {
        write('<span class="gs-echo-prompt">' +
          esc(host.querySelector('.gs-prompt').textContent) + '</span> undo', 'gs-echo');
        writeText(undoStack.length
          ? 'The last change was made in another view of this repository. Undo it there.'
          : 'Nothing to undo.');
        return;
      }
      var entry = undoStack.pop();
      sb.restore(entry.core);
      // C-names given out since the snapshot are handed back, so the next
      // commit reuses the undone one's name
      if (tree) tree.restore(entry.tree);
      out.innerHTML = entry.outHtml;
      history.length = entry.histLen;
      histIdx = history.length;
      tasks.forEach(function (t, i) { t._done = entry.done[i]; t._wasDone = entry.done[i]; });
      write('<span class="gs-echo-prompt">' + esc(entry.prompt) + '</span> undo', 'gs-echo');
      writeText('Undid: {y}' + entry.line + '{/}');
    }

    /* ------------------------------ tabs ------------------------------ */

    var tabButtons = {};
    var tabPanels = {};
    host.querySelectorAll('.gs-tab').forEach(function (b) { tabButtons[b.getAttribute('data-tab')] = b; });
    host.querySelectorAll('.gs-panel').forEach(function (p) { tabPanels[p.getAttribute('data-panel')] = p; });
    var panelOn = {};
    panelTabs.forEach(function (n) { panelOn[n] = true; });
    // panels left out by `panel-tabs` never show; Remote also waits for a remote
    PANEL_NAMES.forEach(function (n) { if (!panelOn[n]) tabButtons[n].hidden = true; });
    var defaultTab = panelTabs.filter(function (n) { return n !== 'remote'; })[0] || 'remote';
    var activeTab = defaultTab;
    var vizToggle = host.querySelector('.gs-viz-toggle');

    // `fromUser`: a click on a tab also unfolds folded panels; a command
    // choosing a tab for the learner leaves them folded.
    function selectTab(name, fromUser) {
      if (!tabButtons[name] || tabButtons[name].hidden || !panelOn[name]) return;
      activeTab = name;
      if (fromUser && !panelsOpen) setPanelsOpen(true);
      showPanels();
    }

    function showPanels() {
      Object.keys(tabButtons).forEach(function (k) {
        var on = k === activeTab;
        tabButtons[k].classList.toggle('is-active', on);
        tabButtons[k].setAttribute('aria-selected', on ? 'true' : 'false');
        tabPanels[k].hidden = !on || !panelsOpen;
      });
      // A graph drawn while its panel was hidden used the fallback width;
      // now that it has a real width, redraw at it.
      redrawGraph();
    }

    function setPanelsOpen(open) {
      panelsOpen = open;
      host.querySelector('.gs-viz').classList.toggle('is-folded', !open);
      if (vizToggle) {
        vizToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        vizToggle.title = open ? 'Hide these views' : 'Show these views';
      }
      showPanels();
    }

    Object.keys(tabButtons).forEach(function (k) {
      tabButtons[k].addEventListener('click', function () { selectTab(k, true); });
    });
    if (vizToggle) vizToggle.addEventListener('click', function () { setPanelsOpen(!panelsOpen); });
    if (activeTab !== 'files') showPanels();

    function setBadge(name, text) {
      var badge = tabButtons[name].querySelector('.gs-tab-badge');
      badge.hidden = !text;
      badge.textContent = text || '';
      badge.classList.toggle('gs-tab-badge-ok', text === '✓');
    }

    // Which tab would a learner look at after this command? Only a shell
    // edit has an opinion (the file it touched); git commands leave the
    // learner's chosen view alone.
    function tabFor(line) {
      var c = line.trim().split(/\s+/)[0];
      if (/^(echo|touch|rm|mkdir)$/.test(c)) return 'files';
      return null;
    }

    // The graph is drawn at the SVG's current pixel width, so a later resize
    // would scale it like an image (tiny text on narrow screens). Redraw the
    // last model whenever the width actually changes.
    var lastGraph = null;
    var lastGraphW = 0;
    var lastCommitCount = 0;
    var stagesInstant = true;
    var lastRemoteGraph = null;
    var lastRemoteGraphW = 0;
    var lastLocalGraphW = 0;
    function redrawGraph() {
      var w = svg.clientWidth;
      if (lastGraph && w && w !== lastGraphW) {
        lastGraphW = w;
        drawHistory(lastGraph);
      }
      var rw = remoteSvg.clientWidth;
      if (lastRemoteGraph && rw && rw !== lastRemoteGraphW) {
        lastRemoteGraphW = rw;
        renderCompactGraph(remoteSvg, lastRemoteGraph, true);
      }
      var lw = localSvg.clientWidth;
      if (lastRemoteGraph && lastGraph && lw && lw !== lastLocalGraphW) {
        lastLocalGraphW = lw;
        renderCompactGraph(localSvg, lastGraph);
      }
    }
    if (typeof ResizeObserver !== 'undefined') {
      var graphObserver = new ResizeObserver(redrawGraph);
      graphObserver.observe(svg.parentNode);
      graphObserver.observe(localSvg.parentNode);
      graphObserver.observe(remoteSvg.parentNode);
    } else {
      root.addEventListener('resize', redrawGraph);
    }

    // The tree pane sits beside the box while there is room for both, and
    // drops below it when the box gets too narrow to share.
    var lastTreeW = 0;
    function fitTree() {
      var w = host.clientWidth;
      host.classList.toggle('gs-tree-below', !!w && w < 760);
      placeTreeBtn();
      var tw = treeScroll.clientWidth;
      if (tw && tw !== lastTreeW) {
        lastTreeW = tw;
        tree.redraw();
      }
    }
    if (tree) {
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitTree).observe(host);
      else root.addEventListener('resize', fitTree);
      fitTree();
    }

    // `tree-view: toggle`: the header button opens and closes the pane. The
    // tree keeps up with every command while closed, so it opens current.
    var treeBtn = host.querySelector('.gs-tree-btn');
    // The button sits in the top right corner of the box: in the tree's own
    // header while the tree is open beside the box, in the box's header
    // otherwise, so opening and closing the tree never moves it.
    function placeTreeBtn() {
      if (!treeBtn) return;
      var beside = treeShown && !host.classList.contains('gs-tree-below');
      var bar = host.querySelector(beside ? '.gs-tree-head' : '.gs-head');
      if (treeBtn.parentNode === bar) return;
      var focused = host.ownerDocument.activeElement === treeBtn;
      bar.appendChild(treeBtn);
      if (focused) treeBtn.focus();
    }
    function setTreeShown(on) {
      treeShown = on;
      host.classList.toggle('gs-has-tree', on);
      host.querySelector('.gs-tree').hidden = !on;
      placeTreeBtn();
      treeBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      treeBtn.title = on ? 'Hide the commit tree' : 'Show the commit tree';
      if (on) {
        lastTreeW = 0;
        fitTree();
      }
    }
    if (treeBtn) treeBtn.addEventListener('click', function () { setTreeShown(!treeShown); });

    // On a reveal.js slide the box fills the rest of the slide at a fixed
    // height (see .gs-fill in the CSS): the terminal takes up the slack and
    // the views below get a fixed area that scrolls, so neither the box nor
    // anything around it moves as the repository changes.
    var slide = host.closest ? host.closest('.reveal .slides section') : null;
    if (slide) {
      host.classList.add('gs-fill');
      var fillSlide = function () {
        // offsets are only real while the slide is displayed
        if (!host.offsetParent) return;
        var deck = root.Reveal && root.Reveal.getConfig ? root.Reveal.getConfig() : null;
        var slideH = deck && typeof deck.height === 'number' ? deck.height : 700;
        var top = 0;
        for (var n = host; n && n !== slide && slide.contains(n); n = n.offsetParent) top += n.offsetTop;
        var h = Math.max(320, Math.floor(slideH - top - 8));
        if (host.style.height !== h + 'px') host.style.height = h + 'px';
      };
      var hookDeck = function () {
        if (!root.Reveal || !root.Reveal.on || hookDeck.done) return;
        hookDeck.done = true;
        ['ready', 'slidechanged', 'resize'].forEach(function (ev) { root.Reveal.on(ev, fillSlide); });
      };
      fillSlide();
      hookDeck();
      root.addEventListener('load', function () { hookDeck(); fillSlide(); });
    }

    /* ------------------------ workspace views ------------------------- */

    var viewButtons = {};
    var viewPanes = {};
    host.querySelectorAll('.gs-wtab').forEach(function (b) { viewButtons[b.getAttribute('data-view')] = b; });
    host.querySelectorAll('.gs-view').forEach(function (p) { viewPanes[p.getAttribute('data-view')] = p; });
    var activeView = 'terminal';

    function selectView(name, focus) {
      if (!viewButtons[name]) return;
      activeView = name;
      Object.keys(viewButtons).forEach(function (k) {
        var on = k === name;
        viewButtons[k].classList.toggle('is-active', on);
        viewButtons[k].setAttribute('aria-selected', on ? 'true' : 'false');
        viewPanes[k].hidden = !on;
      });
      // lets narrow screens give the stacked file tree + editor more room
      host.querySelector('.gs-term-wrap').classList.toggle('is-editor', name === 'editor');
      if (!focus) return;
      if (name === 'terminal') input.focus();
      else if (openFile) edText.focus();
    }

    Object.keys(viewButtons).forEach(function (k) {
      viewButtons[k].addEventListener('click', function () { selectView(k, true); });
    });

    /* ------------------------- file editor ---------------------------- */

    var fbList = host.querySelector('.gs-fb-list');
    var fbTitle = host.querySelector('.gs-fb-title');
    var fbUp = host.querySelector('.gs-fb-up');
    var fbHome = host.querySelector('.gs-fb-home');
    var fbHidden = host.querySelector('.gs-fb-hidden');
    var fbNewBtn = host.querySelector('.gs-fb-new');
    var fbCreate = host.querySelector('.gs-fb-create');
    var fbName = host.querySelector('.gs-fb-name');
    var fbErr = host.querySelector('.gs-fb-err');
    var edName = host.querySelector('.gs-ed-name');
    var edStatus = host.querySelector('.gs-ed-status');
    var edText = host.querySelector('.gs-ed-text');
    var edEmpty = host.querySelector('.gs-ed-empty');
    var edSave = host.querySelector('.gs-ed-save');
    var edRevert = host.querySelector('.gs-ed-revert');
    var dirtyDot = host.querySelector('.gs-wtab-dirty');

    var openFile = null;   // path of the file shown in the editor
    var openKind = 'text'; // 'text', 'readonly' (inside .git) or 'binary'
    var savedText = '';    // that file's contents on disk
    // Unsaved edits per file, so hopping between files never loses work and
    // nothing reaches the working directory (or git status) until Save.
    var drafts = {};
    var lastTree = [];     // [{ path, type }] under the working directory
    var fileSet = {};      // path -> true for every file in lastTree
    var lastStatus = null;
    var edNote = '';

    // The browser opens on the working directory and follows `cd`. "Up"
    // walks real folders while inside the project, then the folders of the
    // prompt's path above it (~/demo-project -> ~); those hold nothing but
    // the way back down, which is the truth as far as this page's
    // filesystem goes. Tree keys stay project-relative throughout, so drafts
    // and git status line up wherever the view is rooted.
    var pathSegs = (config.prompt || '~/project').replace(/\s*\$\s*$/, '').split('/');
    if (pathSegs[0] === '') pathSegs[0] = '/';
    pathSegs = pathSegs.filter(function (x) { return x !== ''; });
    var projIdx = pathSegs.length - 1;   // index of the project folder
    var wdPath = '';       // sb.cwdPath() as of the last refresh
    var upLevels = 0;      // how far above the working directory the view is
    var expanded = {};     // folder key -> true; real folders use their path
    var showHidden = false;

    function fullSegs() { return pathSegs.concat(wdPath ? wdPath.split('/') : []); }
    function wdKey() { return wdPath || '../' + projIdx; }

    // Hidden means a dot-named segment below the working directory or off
    // its path; a learner who has `cd .git` still sees where they are.
    function isHidden(path) {
      if (wdPath && (path === wdPath || wdPath.indexOf(path + '/') === 0)) return false;
      if (wdPath && path.indexOf(wdPath + '/') === 0) path = path.slice(wdPath.length + 1);
      return path.split('/').some(function (seg) { return seg.charAt(0) === '.'; });
    }

    function fileMark(f, status) {
      if (!status) return null;
      if ((status.conflicted || []).some(function (c) { return c.file === f; })) return { k: '!', label: 'conflict', cls: 'conflict' };
      if (status.untracked.indexOf(f) !== -1) return { k: 'U', label: 'untracked', cls: 'new' };
      if (status.modified.indexOf(f) !== -1) return { k: 'M', label: 'modified', cls: 'mod' };
      if (status.staged.some(function (s) { return s.file === f; })) return { k: 'A', label: 'staged', cls: 'new' };
      if ((status.ignored || []).indexOf(f) !== -1) return { k: 'I', label: 'ignored', cls: 'ignored', quiet: true };
      return null;
    }

    function buildTree() {
      var top = { children: {} };
      lastTree.forEach(function (e) {
        if (!showHidden && isHidden(e.path)) return;
        var parts = e.path.split('/'), node = top;
        parts.forEach(function (part, i) {
          if (!node.children[part]) {
            node.children[part] = {
              name: part, key: parts.slice(0, i + 1).join('/'),
              type: i === parts.length - 1 ? e.type : 'dir', children: {}
            };
          }
          node = node.children[part];
        });
      });
      var viewIdx = fullSegs().length - 1 - upLevels;
      if (viewIdx >= projIdx) {
        // inside the project: root the view at that real folder
        fullSegs().slice(projIdx + 1, viewIdx + 1).forEach(function (part) {
          top = top.children[part] || { children: {} };
        });
        return top;
      }
      // above it: wrap the project in the prompt path's folders
      for (var seg = projIdx; seg > viewIdx; seg--) {
        var wrap = { children: {} };
        wrap.children[pathSegs[seg]] = {
          name: pathSegs[seg], key: '../' + seg, type: 'dir', children: top.children
        };
        top = wrap;
      }
      return top;
    }

    function changedUnder(node) {
      if (node.type === 'file') {
        var m = fileMark(node.key, lastStatus);
        return !!m && !m.quiet;
      }
      return Object.keys(node.children).some(function (k) { return changedUnder(node.children[k]); });
    }

    function treeRows(node, depth) {
      var kids = Object.keys(node.children).map(function (k) { return node.children[k]; });
      kids.sort(function (x, y) {
        if (x.type !== y.type) return x.type === 'dir' ? -1 : 1;
        return x.name < y.name ? -1 : x.name > y.name ? 1 : 0;
      });
      return kids.map(function (n) {
        if (n.type === 'dir') {
          var open = !!expanded[n.key];
          var wd = n.key === wdKey();
          var inner = Object.keys(n.children).length
            ? treeRows(n, depth + 1)
            : '<li class="gs-fb-none" data-depth="' + (depth + 1) + '">empty</li>';
          return '<li><button type="button" class="gs-fb-row gs-fb-folder' + (wd ? ' is-wd' : '') + '"' +
            ' aria-expanded="' + open + '" data-dir="' + esc(n.key) + '" data-depth="' + depth + '">' +
            '<span class="gs-fb-chev">' + ICON_CHEVRON + '</span>' +
            '<span class="gs-fb-fname">' + esc(n.name) + '/</span>' +
            (wd ? '<span class="gs-fb-wd" title="working directory">WD</span>' : '') +
            (changedUnder(n) ? '<span class="gs-fb-changed" title="contains changes">●<span class="gs-sr"> (contains changes)</span></span>' : '') +
            '</button>' + (open ? '<ul role="group">' + inner + '</ul>' : '') + '</li>';
        }
        var mark = fileMark(n.key, lastStatus);
        var on = n.key === openFile;
        return '<li><button type="button" class="gs-fb-row gs-fb-file' + (on ? ' is-open' : '') + '"' +
          (on ? ' aria-current="true"' : '') + ' data-file="' + esc(n.key) + '" data-depth="' + depth + '">' +
          '<span class="gs-fb-fname">' + esc(n.name) + '</span>' +
          (n.key in drafts ? '<span class="gs-fb-dirty" title="Unsaved changes">●<span class="gs-sr"> (unsaved)</span></span>' : '') +
          (mark ? '<span class="gs-fb-mark gs-fb-mark-' + mark.cls + '" title="' + mark.label + '">' + mark.k +
            '<span class="gs-sr"> (' + mark.label + ')</span></span>' : '') +
          '</button></li>';
      }).join('');
    }

    function renderFileBrowser() {
      var segs = fullSegs();
      fbTitle.textContent = segs[segs.length - 1 - upLevels] || '';
      fbTitle.title = segs.slice(0, segs.length - upLevels).join('/').replace(/^\/\//, '/');
      fbUp.disabled = upLevels >= segs.length - 1;
      fbHome.hidden = upLevels === 0;
      fbName.placeholder = 'new file in ' + (segs[segs.length - 1] || '');
      var html = treeRows(buildTree(), 0);
      fbList.innerHTML = html || '<li class="gs-fb-none" data-depth="0">No files yet.</li>';
      // Indent through the CSSOM rather than style="" attributes, which a
      // strict Content Security Policy would block.
      fbList.querySelectorAll('[data-depth]').forEach(function (n) {
        n.style.paddingLeft = (10 + Number(n.getAttribute('data-depth')) * 14 +
          (n.classList.contains('gs-fb-folder') ? 0 : 16)) + 'px';
      });
    }

    function revealInTree(f) {
      var parts = f.split('/');
      for (var i = 1; i < parts.length; i++) expanded[parts.slice(0, i).join('/')] = true;
    }

    function renderEditor() {
      var dirty = !!openFile && openKind === 'text' && edText.value !== savedText;
      var showText = !!openFile && openKind !== 'binary';
      edText.hidden = !showText;
      edText.readOnly = openKind !== 'text';
      edEmpty.hidden = showText;
      edEmpty.textContent = openFile
        ? 'This file is binary (git stores objects compressed), so there is nothing readable to show.'
        : (Object.keys(fileSet).length ? 'Pick a file on the left to open it here.'
          : 'No files yet. Use + to create one.');
      edName.textContent = openFile || '';
      edSave.disabled = !dirty;
      edRevert.disabled = !dirty;
      edStatus.textContent = dirty ? 'unsaved'
        : openFile && openKind !== 'text' ? 'read-only' + (openKind === 'readonly' ? ', managed by git' : '')
        : edNote;
      if (dirtyDot) dirtyDot.hidden = !Object.keys(drafts).length;
    }

    // Read the open file and decide how it can be shown. Anything under
    // .git is git's own bookkeeping: viewable, but editing it by hand is how
    // repositories get broken, so it is read-only.
    async function loadOpenFile() {
      var bytes;
      try { bytes = await sb.readBytes(openFile); } catch (e) { bytes = new Uint8Array(0); }
      var text = null;
      if (bytes.indexOf(0) === -1) {
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { text = null; }
      }
      openKind = text === null ? 'binary' : (/^\.git(\/|$)/.test(openFile) ? 'readonly' : 'text');
      savedText = text || '';
    }

    async function openInEditor(f) {
      openFile = f;
      edNote = '';
      revealInTree(f);
      await loadOpenFile();
      edText.value = f in drafts ? drafts[f] : savedText;
      renderFileBrowser();
      renderEditor();
    }

    // After any command, undo or reset, pick up what changed on disk. A file
    // with an unsaved draft keeps the draft: the learner's typing wins.
    async function syncEditor() {
      var wdNow = sb.cwdPath();
      if (wdNow !== wdPath) {
        // a `cd` moves the browser along with the shell
        wdPath = wdNow;
        upLevels = 0;
      }
      if (openFile && !fileSet[openFile] && !(openFile in drafts)) {
        openFile = null;
        openKind = 'text';
        edText.value = '';
        savedText = '';
      }
      if (openFile) {
        await loadOpenFile();
        if (!(openFile in drafts) && edText.value !== savedText) edText.value = savedText;
      }
      renderFileBrowser();
      renderEditor();
    }

    // Writing a file from the editor is a state change like any command:
    // it gets an undo entry and re-runs the task checks.
    async function editorWrite(name, text, label) {
      if (busy) return false;
      busy = true;
      input.disabled = true;
      var snap = captureUndo(label);
      try {
        await sb.writeFile(name, text);
      } catch (e) {
        edNote = 'could not save: ' + e.message;
        busy = false;
        input.disabled = false;
        renderEditor();
        return false;
      }
      if (sb.changedSince(snap.core)) pushUndo(snap);
      await refresh();
      notifyViews();
      input.disabled = false;
      busy = false;
      return true;
    }

    async function saveFile() {
      if (!openFile || edText.value === savedText) return;
      var name = openFile, text = edText.value;
      delete drafts[name];
      if (await editorWrite(name, text, 'save ' + name)) {
        edNote = 'saved';
        renderEditor();
      } else {
        drafts[name] = text;
      }
    }

    function revertFile() {
      if (!openFile) return;
      delete drafts[openFile];
      edText.value = savedText;
      edNote = '';
      renderFileBrowser();
      renderEditor();
      edText.focus();
    }

    // New files are named from the working directory, as `touch` would be,
    // and must land inside the project and outside .git; a lesson never
    // needs anything else, and git would refuse most of the rest.
    function fromWd(name) {
      var out = wdPath ? wdPath.split('/') : [];
      var parts = name.split('/');
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] === '' || parts[i] === '.') continue;
        if (parts[i] === '..') { if (!out.length) return null; out.pop(); }
        else out.push(parts[i]);
      }
      return out.join('/');
    }

    function badFileName(raw, name) {
      if (!raw) return 'Type a file name.';
      if (/\s/.test(raw)) return 'Leave spaces out of file names; they make commands harder to type.';
      if (/\/$/.test(raw)) return 'That is a folder name. Add a file name after the slash.';
      if (/^\//.test(raw) || !name) return 'Use a name inside the project, like notes.md or data/notes.md.';
      if (/^\.git(\/|$)/.test(name)) return 'Files inside .git belong to git. Pick another name.';
      if (lastTree.some(function (e) { return e.path === name && e.type === 'dir'; })) return 'A folder already has that name.';
      return null;
    }

    async function createFile(raw) {
      raw = raw.trim();
      var name = fromWd(raw);
      var problem = badFileName(raw, name);
      if (problem) { fbErr.textContent = problem; return; }
      fbErr.textContent = '';
      fbCreate.hidden = true;
      fbName.value = '';
      if (!fileSet[name]) {
        if (!(await editorWrite(name, '', 'create ' + name))) return;
      }
      await openInEditor(name);
      edText.focus();
    }

    fbList.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.gs-fb-row') : null;
      if (!b) return;
      if (b.hasAttribute('data-dir')) {
        var k = b.getAttribute('data-dir');
        expanded[k] = !expanded[k];
        renderFileBrowser();
        var again = fbList.querySelector('[data-dir="' + k.replace(/["\\]/g, '\\$&') + '"]');
        if (again) again.focus();
        return;
      }
      openInEditor(b.getAttribute('data-file')).then(function () { if (!edText.hidden) edText.focus(); });
    });
    fbUp.addEventListener('click', function () {
      var segs = fullSegs();
      if (upLevels >= segs.length - 1) return;
      upLevels++;
      // open the way back down so the working directory stays in view
      for (var seg = segs.length - 1 - upLevels + 1; seg <= projIdx; seg++) expanded['../' + seg] = true;
      var parts = wdPath ? wdPath.split('/') : [];
      for (var i = 1; i <= parts.length; i++) expanded[parts.slice(0, i).join('/')] = true;
      renderFileBrowser();
    });
    fbHome.addEventListener('click', function () {
      upLevels = 0;
      renderFileBrowser();
      fbUp.focus();
    });
    fbHidden.addEventListener('change', function () {
      showHidden = fbHidden.checked;
      renderFileBrowser();
    });
    edText.addEventListener('input', function () {
      if (!openFile) return;
      var was = openFile in drafts;
      if (edText.value === savedText) delete drafts[openFile];
      else drafts[openFile] = edText.value;
      edNote = '';
      if (was !== (openFile in drafts)) renderFileBrowser();
      renderEditor();
    });
    edText.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        saveFile();
      }
    });
    edSave.addEventListener('click', function () { saveFile(); });
    edRevert.addEventListener('click', revertFile);
    fbNewBtn.addEventListener('click', function () {
      fbCreate.hidden = !fbCreate.hidden;
      fbErr.textContent = '';
      if (!fbCreate.hidden) fbName.focus();
    });
    fbCreate.addEventListener('submit', function (e) {
      e.preventDefault();
      createFile(fbName.value);
    });
    fbName.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { fbCreate.hidden = true; fbName.value = ''; fbErr.textContent = ''; fbNewBtn.focus(); }
    });

    function write(html, cls) {
      var line = el('div', 'gs-line' + (cls ? ' ' + cls : ''), html);
      out.appendChild(line);
      out.scrollTop = out.scrollHeight;
    }
    function writeText(text, cls) {
      if (text === '' || text == null) return;
      write(markup(text), cls);
    }

    function renderHints() {
      var hints = config.hints || [];
      if (!hints.length) { hintsNode.innerHTML = ''; return; }
      hintsNode.innerHTML = '<span class="gs-hints-label">Try:</span>';
      hints.forEach(function (h) {
        var b = el('button', 'gs-hint', esc(h));
        b.type = 'button';
        b.addEventListener('click', function () { input.value = h; input.focus(); });
        hintsNode.appendChild(b);
      });
    }

    function renderTasks() {
      if (!tasks.length) { tasksNode.innerHTML = ''; return; }
      var done = 0;
      var rows = tasks.map(function (t) {
        if (t._error) {
          return '<li class="gs-task gs-task-broken">' +
                 '<span class="gs-task-mark" aria-hidden="true">!</span>' +
                 '<span class="gs-task-txt">' + t.text +
                 '<span class="gs-task-err">Authoring error: ' + esc(t._error) + '</span></span></li>';
        }
        var ok = !!t._done;
        if (ok) done++;
        // A task that ticked on this render gets a brief highlight, so the
        // completion registers even while the eye is on the terminal.
        var fresh = ok && !t._wasDone;
        t._wasDone = ok;
        return '<li class="gs-task' + (ok ? ' is-done' : '') + (fresh ? ' is-just-done' : '') + '">' +
               '<span class="gs-task-mark" aria-hidden="true">' + (ok ? '✓' : '') + '</span>' +
               '<span class="gs-task-txt">' + t.text + '</span></li>';
      }).join('');
      var broken = tasks.some(function (t) { return !!t._error; });
      var all = !broken && done === tasks.length;
      var note = config.doneNote || 'That is the whole exercise.';
      tasksNode.innerHTML =
        '<div class="gs-tasks-h">Tasks <span class="gs-count">' + done + ' of ' + tasks.length + '</span></div>' +
        '<ul class="gs-task-list">' + rows + '</ul>' +
        (all ? '<div class="gs-done">' + note + '</div>' : '');
    }

    async function refresh() {
      var graph = await sb.graphModel();
      var isRepo = await sb.isRepo();
      var status = isRepo ? await sb.statusModel()
        : { staged: [], modified: [], untracked: [], deleted: [], stagedDeleted: [], conflicted: [], merging: false, ignored: [] };
      var files = await sb.listFiles();
      var diff = await sb.diffModel();
      var chipsBefore = chipRects(stagesNode);
      renderStages(stagesNode, status, graph, files, isRepo);
      // a reset (or the first drawing) appears at once, like the tree
      if (!stagesInstant) {
        animateStages(stagesNode, chipsBefore,
          graph.commits.length > lastCommitCount ? commitColor(graph) : null);
      }
      stagesInstant = false;
      lastCommitCount = graph.commits.length;
      renderDiff(diffNode, diff);
      lastGraph = graph;
      drawHistory(graph);
      lastTree = await sb.listTree();
      fileSet = {};
      lastTree.forEach(function (e) { if (e.type === 'file') fileSet[e.path] = true; });
      lastStatus = isRepo ? status : null;
      await syncEditor();
      lastGraphW = svg.clientWidth;
      if (tree) drawTree(graph);

      var remote = await sb.remoteModel(remoteName);
      if (remote) {
        remoteWrap.hidden = false;
        remoteName = remote.name;
        drawRemoteName(remote);
        renderCompactGraph(localSvg, graph);
        renderCompactGraph(remoteSvg, remote.graph, true);
        lastRemoteGraph = remote.graph;
        lastRemoteGraphW = remoteSvg.clientWidth;
        lastLocalGraphW = localSvg.clientWidth;
      } else {
        remoteWrap.hidden = true;
        lastRemoteGraph = null;
      }

      // Tab badges: enough signal that folded panels lose nothing you would
      // catch at a glance. A count means "something here"; ✓ means clean.
      var changed = (status.conflicted || []).length + status.untracked.length + status.modified.length +
        status.deleted.length + status.staged.length + status.stagedDeleted.length;
      setBadge('files', isRepo ? (changed ? String(changed) : '✓')
        : (files.length ? String(files.length) : ''));
      setBadge('changes', !isRepo ? '' : (diff && diff.files.length ? String(diff.files.length) : '✓'));
      setBadge('history', graph.commits.length ? String(graph.commits.length) : '');
      tabButtons.remote.hidden = !remote || !panelOn.remote;
      if (remote) {
        setBadge('remote', !remote.tracked ? ''
          : (!remote.ahead && !remote.behind) ? '✓'
          : ((remote.ahead ? '⇡' + remote.ahead : '') +
             (remote.ahead && remote.behind ? ' ' : '') +
             (remote.behind ? '⇣' + remote.behind : '')));
      } else if (activeTab === 'remote') {
        selectTab(defaultTab);
      }

      // `file x contains "y"` needs file contents; read them up front so the
      // compiled predicates can stay synchronous.
      var contents = {};
      for (var f = 0; f < tasks.length; f++) {
        for (var g = 0; g < (tasks[f]._files || []).length; g++) {
          var name = tasks[f]._files[g];
          if (name in contents) continue;
          try { contents[name] = await sb.readFile(name); }
          catch (e) { contents[name] = ''; }
        }
      }

      var ctx = {
        sb: sb, graph: graph, status: status, files: files,
        history: history, isRepo: isRepo, remote: remote,
        _fileText: function (name) { return contents[name] || ''; }
      };
      for (var i = 0; i < tasks.length; i++) {
        if (tasks[i]._done || tasks[i]._error) continue;
        try { tasks[i]._done = !!(await tasks[i].check(ctx)); }
        catch (e) { tasks[i]._done = false; }
      }
      renderTasks();

      undoBtn.disabled = !canUndo();

      var br = graph.head;
      // follows `cd`, so the prompt always says which folder paths resolve in
      // a stopped merge shows as (main|MERGING), as git's own prompt does
      host.querySelector('.gs-prompt').textContent =
        sb.pwd() + (br ? ' (' + br + (status.merging ? '|MERGING' : '') + ')' : '') + ' $';
    }

    // The history graph, with the contents of each opened commit laid out
    // under its row: the details are HTML (diffs need text layout), placed
    // over a gap the graph leaves for them.
    function drawHistory(graph) {
      cdLayer.innerHTML = '';
      var heights = {}, nodes = {};
      var left = graphTextX(graph);
      var width = Math.max(160, (svg.clientWidth || 640) - left - 40);
      graph.commits.forEach(function (c) {
        if (!openCommits[c.oid] || !commitInfo[c.oid]) return;
        var n = el('div', 'gs-cd', commitDetailsHtml(commitInfo[c.oid]));
        n.setAttribute('data-oid', c.oid);
        n.style.left = left + 'px';
        n.style.width = width + 'px';
        cdLayer.appendChild(n);
        nodes[c.oid] = n;
        // jsdom (and a hidden panel) has no layout: estimate instead
        heights[c.oid] = (n.offsetHeight || 90 + commitInfo[c.oid].files.reduce(function (sum, f) {
          return sum + 30 + f.lines.length * 18;
        }, 0)) + 14;
      });
      var lay = renderGraph(svg, graph, { open: heights, onToggle: toggleCommit });
      Object.keys(nodes).forEach(function (oid) { nodes[oid].style.top = lay.detailTop[oid] + 'px'; });
    }

    async function toggleCommit(oid) {
      if (openCommits[oid]) {
        delete openCommits[oid];
      } else {
        if (!commitInfo[oid]) {
          try { commitInfo[oid] = await sb.commitDetails(oid); }
          catch (e) { return; }
        }
        openCommits[oid] = true;
      }
      if (lastGraph) drawHistory(lastGraph);
      // the redraw replaced the button; keep keyboard focus on it
      var again = svg.querySelector('.gs-cd-toggle[data-oid="' + oid + '"]');
      if (again && again.focus) again.focus();
    }

    function drawTree(graph) {
      var lay = tree.update(graph, treeInstant);
      treeInstant = false;
      // keep the commit HEAD points at in view as the tree grows downwards
      var p = graph.headOid && lay.pos[graph.headOid];
      if (!p || !treeScroll.clientHeight) return;
      var top = treeScroll.scrollTop, h = treeScroll.clientHeight, py = p.y * lay.scale;
      if (py - 40 < top || py + 50 > top + h) {
        var y = Math.max(0, py - h / 2);
        if (treeScroll.scrollTo) treeScroll.scrollTo({ top: y, behavior: 'smooth' });
        else treeScroll.scrollTop = y;
      }
    }

    /* ------------------------------ vim ------------------------------ */

    // A small modal vim, just enough to write a commit message and, more to
    // the point, to show learners why "how do I quit vim" is a famous
    // question. It starts in normal mode where typing does nothing useful,
    // and only the real ways out (:wq, :x, ZZ, :q!, ZQ) leave it. Resolves
    // with what was last written to the file, the way git reads it back.
    function openVim(file, text) {
      var saved = text;
      var mode = 'normal';
      var cmd = '';
      var pending = '';
      var nLines = function (t) { return t.replace(/\n$/, '').split('\n').length; };
      var info = '"' + file + '" ' + nLines(text) + 'L, ' + text.length + 'B';

      function status(msg, isErr) {
        vimStatus.textContent = msg;
        vimStatus.classList.toggle('is-err', !!isErr);
      }
      function caret(pos) {
        pos = Math.max(0, Math.min(vimText.value.length, pos));
        vimText.selectionStart = vimText.selectionEnd = pos;
      }
      function lineStart(pos) { return vimText.value.lastIndexOf('\n', pos - 1) + 1; }
      function lineEnd(pos) {
        var e = vimText.value.indexOf('\n', pos);
        return e === -1 ? vimText.value.length : e;
      }
      function setMode(m) {
        mode = m;
        vimNode.classList.toggle('is-insert', m === 'insert');
        if (m === 'insert') status('-- INSERT --');
        else if (m === 'normal') status('');
      }
      function moveLine(dir) {
        var pos = vimText.selectionStart, s = lineStart(pos), col = pos - s;
        if (dir < 0) {
          if (s === 0) return;
          var ps = lineStart(s - 1);
          caret(Math.min(ps + col, s - 1));
        } else {
          var e = lineEnd(pos);
          if (e === vimText.value.length) return;
          caret(Math.min(e + 1 + col, lineEnd(e + 1)));
        }
      }
      function write() {
        saved = vimText.value;
        status('"' + file + '" ' + nLines(saved) + 'L, ' + saved.length + 'B written');
      }
      function runCmd(c) {
        var bang = /!$/.test(c);
        var name = c.replace(/!$/, '');
        if (name === 'w') { write(); return; }
        if (name === 'wq' || name === 'x' || name === 'wqa' || name === 'xa') { write(); close(saved); return; }
        if (name === 'q' || name === 'qa') {
          if (!bang && vimText.value !== saved) {
            status('E37: No write since last change (add ! to override)', true);
            return;
          }
          close(saved);
          return;
        }
        status('E492: Not an editor command: ' + c, true);
      }
      // `result` is what git reads back; undefined means the session was
      // abandoned by Reset and there is no commit to finish
      function close(result) {
        vim = null;
        vimNode.hidden = true;
        out.hidden = false;
        form.hidden = false;
        hintsNode.hidden = false;
        vimText.removeEventListener('keydown', onKey);
        vimText.removeEventListener('beforeinput', onBeforeInput);
        resolve(result);
      }

      function onBeforeInput(e) {
        // phones type through beforeinput, not keydown; only insert mode edits
        if (mode !== 'insert') e.preventDefault();
      }

      function onKey(e) {
        var k = e.key;
        if (mode === 'insert') {
          if (k === 'Escape' || (e.ctrlKey && k === 'c')) {
            e.preventDefault();
            setMode('normal');
            // like vim, leaving insert mode steps back onto the last character
            var p = vimText.selectionStart;
            if (p > lineStart(p)) caret(p - 1);
          }
          return;
        }
        if (mode === 'cmd') {
          e.preventDefault();
          if (k === 'Escape' || (e.ctrlKey && k === 'c')) { setMode('normal'); return; }
          if (k === 'Enter') { setMode('normal'); runCmd(cmd.slice(1).trim()); return; }
          if (k === 'Backspace') {
            cmd = cmd.slice(0, -1);
            if (!cmd) { setMode('normal'); return; }
          } else if (k.length === 1) {
            cmd += k;
          }
          status(cmd);
          return;
        }

        // normal mode: arrows, Home, End and paging keep their usual meaning
        if (/^(Arrow|Page)|^(Home|End|Tab|Shift|Control|Alt|Meta)$/.test(k)) return;
        if (e.metaKey || (e.altKey && !e.ctrlKey)) return;
        e.preventDefault();
        if (e.ctrlKey) {
          if (k === 'c') status('Type  :qa!  and press <Enter> to abandon all changes and exit Vim');
          return;
        }
        var pos = vimText.selectionStart;
        var v = vimText.value;
        var two = pending + k;
        pending = '';
        if (two === 'ZZ') { if (v !== saved) write(); close(saved); return; }
        if (two === 'ZQ') { close(saved); return; }
        if (two === 'dd') {
          var s0 = lineStart(pos), e0 = lineEnd(pos);
          vimText.value = v.slice(0, s0) + v.slice(e0 + 1);
          caret(s0);
          return;
        }
        if (two === 'gg') { caret(0); return; }
        switch (k) {
          case 'i': setMode('insert'); return;
          case 'a': if (pos < lineEnd(pos)) caret(pos + 1); setMode('insert'); return;
          case 'I': caret(lineStart(pos)); setMode('insert'); return;
          case 'A': caret(lineEnd(pos)); setMode('insert'); return;
          case 'o':
            var eo = lineEnd(pos);
            vimText.value = v.slice(0, eo) + '\n' + v.slice(eo);
            caret(eo + 1); setMode('insert'); return;
          case 'O':
            var so = lineStart(pos);
            vimText.value = v.slice(0, so) + '\n' + v.slice(so);
            caret(so); setMode('insert'); return;
          case 'h': if (pos > lineStart(pos)) caret(pos - 1); return;
          case 'l': if (pos < lineEnd(pos) - 1) caret(pos + 1); return;
          case 'j': moveLine(1); return;
          case 'k': moveLine(-1); return;
          case '0': caret(lineStart(pos)); return;
          case '$': caret(Math.max(lineStart(pos), lineEnd(pos) - 1)); return;
          case 'G': caret(lineStart(v.length > 0 && v.charAt(v.length - 1) === '\n' ? v.length - 1 : v.length)); return;
          case 'x':
            if (pos < lineEnd(pos)) { vimText.value = v.slice(0, pos) + v.slice(pos + 1); caret(pos); }
            return;
          case ':': mode = 'cmd'; cmd = ':'; status(cmd); return;
          case 'Z': case 'd': case 'g': pending = k; return;
          case 'Escape': return;
        }
      }

      var resolve;
      var done = new Promise(function (r) { resolve = r; });
      vim = { abandon: function () { close(undefined); } };
      out.hidden = true;
      form.hidden = true;
      hintsNode.hidden = true;
      vimNode.hidden = false;
      vimText.value = text;
      vimText.addEventListener('keydown', onKey);
      vimText.addEventListener('beforeinput', onBeforeInput);
      setMode('normal');
      status(info);
      selectView('terminal');
      vimText.focus();
      caret(0);
      return done;
    }

    async function submit(line) {
      if (busy) return;
      busy = true;
      input.disabled = true;
      var trimmed = line.trim();
      if (trimmed === 'undo') {
        // never reaches the engine: undo is a sandbox affordance, not git
        doUndo();
        await refresh();
        notifyViews();
        input.disabled = false;
        busy = false;
        input.focus();
        return;
      }
      var snap = captureUndo(line);
      write('<span class="gs-echo-prompt">' + esc(host.querySelector('.gs-prompt').textContent) + '</span> ' + esc(line), 'gs-echo');
      history.push(line);
      histIdx = history.length;
      var r = await sb.run(line);
      if (r.editor) {
        var saved = await openVim(r.editor.file, r.editor.text);
        // Reset closes the editor from underneath us and starts afresh
        if (saved === undefined) return;
        r = await sb.finishCommit(saved);
      }
      if (trimmed === 'clear') { out.innerHTML = ''; }
      else if (trimmed === 'help') { writeText(helpText()); }
      else if (trimmed === 'reset') { await doReset(); }
      else { writeText(r.out, r.ok ? '' : 'gs-err'); }
      // a merge that stops on conflicts fails but still changes the repo,
      // and undoing it is the quickest way back out
      var changed = sb.changedSince(snap.core);
      if (trimmed !== 'reset' && changed) pushUndo(snap);
      // Switch before the refresh too, so the panel is on screen while its
      // chips move; and after, for a tab the refresh has just revealed.
      var want = r.ok ? tabFor(line) : null;
      if (want) selectTab(want);
      await refresh();
      if (want) selectTab(want);
      if (changed && trimmed !== 'reset') notifyViews();
      input.disabled = false;
      busy = false;
      input.focus();
    }

    // The remote half's heading names the remote shown; with several it is
    // a dropdown. Only rebuilt when the names change, so an open dropdown
    // keeps its focus across refreshes.
    var lastRemoteNames = '';
    function drawRemoteName(r) {
      var names = r.remotes || [r.name];
      var key = names.join('\n');
      if (key !== lastRemoteNames) {
        lastRemoteNames = key;
        if (names.length > 1) {
          remoteNameNode.innerHTML = '<select class="gs-remote-select" aria-label="Remote">' +
            names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('') +
            '</select>';
          remoteNameNode.firstChild.addEventListener('change', function (e) {
            remoteName = e.target.value;
            refresh();
          });
        } else {
          remoteNameNode.textContent = r.name;
        }
      }
      if (names.length > 1) remoteNameNode.firstChild.value = r.name;
    }

    function helpText() {
      return [
        '{w}This sandbox runs real git{/} (isomorphic-git) on a repo that lives only in this page.',
        '',
        '{y}git{/}    init, status, add [-f], rm [--cached], commit [-a] [-m], log [--oneline], diff,',
        '       restore [--staged], reset [--soft|--hard] [<commit>|<file>],',
        '       branch [-d] [-a], checkout [-b] <branch|commit>, checkout --track,',
        '       switch [-c|--detach] <branch>, switch -,',
        '       merge [--abort], config [--global],',
        '       remote add origin, clone, push [-u], pull [origin <branch>], fetch',
        '{y}shell{/}  ls, cat, echo "text" > file, echo "text" >> file, touch, rm [-r],',
        '       mkdir, cd, pwd',
        '       any command > file (or >> file) writes its output to a file',
        '{y}other{/}  help, clear, reset, undo',
        '       {y}*{/} and {y}?{/} match file names: git add *.txt',
        '',
        '{y}git <command> -h{/} shows how a git command is used.',
        '',
        '{y}git commit{/} without -m opens {y}vim{/}, as real git usually does.',
        'Press {y}i{/} to type, {y}Esc{/} to stop typing, then {y}:wq{/} and Enter to',
        'save and commit, or {y}:q!{/} and Enter to give up.',
        '',
        'A {y}merge{/} that conflicts leaves {y}<<<<<<<{/} markers in the files: edit them',
        'to keep what you want, then {y}git add{/} and {y}git commit{/}. {y}git merge --abort{/}',
        'gives up.',
        '',
        '{y}undo{/} takes back your last state-changing command (a sandbox',
        'nicety, not a git command — real git has no undo).'
      ].concat(editorOn ? [
        '',
        'The {y}Editor{/} tab above the terminal opens files for editing.',
        'Saved edits land in the working directory, ready for git add.'
      ] : []).join('\n');
    }

    // `initial`: the box is mounting, not being reset by the learner. A
    // view of a shared repository then shows it as it stands instead of
    // starting it over.
    async function doReset(initial) {
      if (vim) {
        // abandon the commit in progress; the submit waiting on it bows out
        vim.abandon();
        busy = false;
        input.disabled = false;
      }
      out.innerHTML = '';
      input.value = '';
      // Tasks checked with `ran "..."` read the command history, so it has to
      // go too or they re-complete themselves on the very next refresh.
      history.length = 0;
      histIdx = 0;
      if (!(initial && !isOrigin)) undoStack.length = 0;
      tasks.forEach(function (t) { t._done = false; t._wasDone = false; });
      selectTab(defaultTab);
      // unsaved drafts belong to the run being thrown away
      drafts = {};
      openFile = null;
      openKind = 'text';
      edText.value = '';
      savedText = '';
      edNote = '';
      fbCreate.hidden = true;
      upLevels = 0;
      expanded = {};
      if (tree) { tree.reset(); treeInstant = true; }
      openCommits = {};
      commitInfo = {};
      stagesInstant = true;
      try {
        if (initial && !isOrigin) {
          await group.ready;
        } else {
          // a view's Reset starts the shared repository over from its seed
          var resetting = sb.reset(group.seed);
          group.ready = resetting.then(function () {}, function () {});
          await resetting;
        }
      } catch (e) {
        writeText('{r}This exercise could not be set up: ' + e.message + '{/}', 'gs-err');
        await refresh();
        return;
      }
      intro.forEach(function (l) { writeText(l); });
      await refresh();
      if (!(initial && !isOrigin)) notifyViews(initial ? '' : '{y}This repository was reset from another view.{/}');
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value;
      input.value = '';
      if (!v.trim()) return;
      submit(v);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp') {
        if (!history.length) return;
        e.preventDefault();
        histIdx = Math.max(0, histIdx - 1);
        input.value = history[histIdx] || '';
      } else if (e.key === 'ArrowDown') {
        if (!history.length) return;
        e.preventDefault();
        histIdx = Math.min(history.length, histIdx + 1);
        input.value = history[histIdx] || '';
      }
    });

    resetBtn.addEventListener('click', function () { doReset(); });
    undoBtn.addEventListener('click', function () { submit('undo'); });
    host.querySelector('.gs-out').addEventListener('click', function () { input.focus(); });

    renderHints();
    var ready = doReset(true);
    self.refresh = function () { return ready.then(refresh); };
    self.note = function (text) { writeText(text); };

    return { sandbox: sb, refresh: refresh, run: submit, ready: ready, tasks: tasks, tree: tree };
  }

  /* ------------------- helpers for exercise checks ------------------- */

  // oid a branch currently points at, or null
  function branchOid(graph, name) {
    var b = (graph.branches || []).filter(function (x) { return x.name === name; })[0];
    return b ? b.oid : null;
  }

  // is `target` reachable by walking parents back from `from`?
  function reaches(graph, from, target) {
    if (!from || !target) return false;
    if (from === target) return true;
    var byOid = {};
    graph.commits.forEach(function (c) { byOid[c.oid] = c; });
    var stack = [from];
    var seen = {};
    while (stack.length) {
      var oid = stack.pop();
      if (oid === target) return true;
      if (seen[oid]) continue;
      seen[oid] = true;
      var c = byOid[oid];
      if (c) (c.parents || []).forEach(function (p) { stack.push(p); });
    }
    return false;
  }

  // Has branch `name` been merged into branch `into`? Requires a merge the
  // sandbox actually recorded, not just ancestry — a branch freshly created
  // from `into`'s tip is already an ancestor of it, and a completed
  // fast-forward merge leaves the identical graph, so ancestry alone cannot
  // tell the two apart.
  function isMerged(graph, name, into) {
    var recorded = (graph.merges || []).some(function (m) {
      return m.from === name && m.into === into;
    });
    if (!recorded) return false;
    var fromOid = branchOid(graph, name);
    var intoOid = branchOid(graph, into);
    if (!fromOid || !intoOid) return true;
    return reaches(graph, intoOid, fromOid);
  }

  // how many commits are reachable from a branch tip
  function commitCount(graph, name) {
    var tip = branchOid(graph, name);
    if (!tip) return 0;
    var byOid = {};
    graph.commits.forEach(function (c) { byOid[c.oid] = c; });
    var stack = [tip], seen = {}, n = 0;
    while (stack.length) {
      var oid = stack.pop();
      if (seen[oid]) continue;
      seen[oid] = true; n++;
      var c = byOid[oid];
      if (c) (c.parents || []).forEach(function (p) { stack.push(p); });
    }
    return n;
  }

  function hasMergeCommit(graph) {
    return graph.commits.some(function (c) { return (c.parents || []).length > 1; });
  }

  function boot() {
    var pending = root.__gsPending || [];
    pending.forEach(function (p) { mount(p[0], p[1]); });
    root.__gsPending = { push: function (p) { mount(p[0], p[1]); } };
  }

  root.GitSandboxUI = {
    mount: mount,
    boot: boot,
    branchOid: branchOid,
    reaches: reaches,
    isMerged: isMerged,
    commitCount: commitCount,
    hasMergeCommit: hasMergeCommit
  };
})(window);
