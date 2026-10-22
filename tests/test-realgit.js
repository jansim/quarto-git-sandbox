/* Compare the sandbox's terminal output with real git's.

   Each scenario is a list of command lines. Every line runs twice: in the
   sandbox, and through bash with the real git binary in a temporary folder.
   The outputs are then normalised (colour tags, hashes, paths and spacing
   removed) and compared.

   Most steps check that every line the sandbox prints also appears in real
   git's output, in the same order, possibly as part of a longer line. Real
   git prints more hints and statistics than the sandbox does, and that is
   fine; printing something real git would not is not. Steps marked `exact`
   must match line for line, and `firstLine` steps only on their first
   line (for `-h`, whose option lists change between git versions). Both
   sides must also agree on success, unless a step says otherwise with `ok`.
   A step with `minGit` is only compared when the installed git is at
   least that version, for output that changed between git releases; CI
   runs a current git, so there every step counts.

   Needs `git` on PATH. Run: node tests/test-realgit.js */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const git = require('isomorphic-git');
const Core = require('../src/sandbox-core.js');

const SANDBOX_URL = 'https://example.com/acme/project.git';

let pass = 0, fail = 0;
const failures = [];

function check(label, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(label + (detail ? '\n' + detail : '')); }
}

function strip(s) { return String(s).replace(/\{[gryb\/w]\}/g, ''); }

function normalise(text, replacements) {
  let s = strip(text);
  replacements.forEach(([from, to]) => { s = s.split(from).join(to); });
  return s
    .replace(/\b[0-9a-f]{40}\b/g, '<hash>')
    .replace(/\b[0-9a-f]{7,12}\b/g, '<hash>')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// every sandbox line appears, in order, within real git's lines
function subsetInOrder(mine, theirs) {
  let j = 0;
  for (let i = 0; i < mine.length; i++) {
    while (j < theirs.length && theirs[j].indexOf(mine[i]) === -1) j++;
    if (j === theirs.length) return mine[i];
    j++;
  }
  return null;
}

function realGit(line, cwd, env) {
  const r = spawnSync('bash', ['-c', line + ' 2>&1'], { cwd, env, encoding: 'utf8' });
  return { out: r.stdout, ok: r.status === 0 };
}

function versionOf(text) {
  const m = /(\d+)\.(\d+)/.exec(text || '');
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}
const GIT_VERSION = versionOf(spawnSync('git', ['--version'], { encoding: 'utf8' }).stdout);
function gitAtLeast(v) {
  const [maj, min] = versionOf(v);
  return GIT_VERSION[0] > maj || (GIT_VERSION[0] === maj && GIT_VERSION[1] >= min);
}
let skipped = 0;

async function scenario(name, steps) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gs-real-')));
  const work = path.join(tmp, 'project');
  const remote = path.join(tmp, 'remote.git');
  fs.mkdirSync(work);
  fs.writeFileSync(path.join(tmp, '.gitconfig'),
    '[user]\n\tname = Your Name\n\temail = you@example.com\n' +
    '[init]\n\tdefaultBranch = main\n' +
    '[advice]\n\tdetachedHead = true\n' +
    '[pull]\n\trebase = false\n' +
    // a terminal shows branch names in `git log`; a pipe would not
    '[log]\n\tdecorate = short\n' +
    '[core]\n\teditor = true\n');
  spawnSync('git', ['init', '--bare', '-q', '-b', 'main', remote]);
  const env = Object.assign({}, process.env, {
    HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(tmp, '.gitconfig'),
    LANG: 'C', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0'
  });
  const sb = Core.createSandbox({ git });
  const reps = [[work, '~/project'], [remote, '<remote>'], [SANDBOX_URL, '<remote>']];

  try {
    for (const step of steps) {
      const s = typeof step === 'string' ? { cmd: step } : step;
      const real = realGit(s.cmd.split('$REMOTE').join(remote), work, env);
      // the sandbox has no `&&`, so a chain runs one command at a time
      let mine;
      for (const part of s.cmd.split(' && ')) {
        mine = await sb.run(part.split('$REMOTE').join(SANDBOX_URL));
        if (s.setup && !mine.ok) throw new Error('setup failed in the sandbox: ' + part + '\n' + mine.out);
      }
      if (s.setup) {
        if (!real.ok) throw new Error('setup failed in git: ' + s.cmd + '\n' + real.out);
        continue;
      }
      if (s.minGit && !gitAtLeast(s.minGit)) { skipped++; continue; }
      const label = name + ' :: ' + s.cmd;
      const a = normalise(mine.out, reps).filter((l) => !(s.ignore || []).some((re) => re.test(l)));
      const b = normalise(real.out, reps);
      const detail = '     sandbox:\n       ' + a.join('\n       ') + '\n     git:\n       ' + b.join('\n       ');
      check(label + ' (success)', mine.ok === (s.ok === undefined ? real.ok : s.ok),
        '     sandbox ok=' + mine.ok + ', git ok=' + real.ok + '\n' + detail);
      if (s.firstLine) {
        check(label + ' (first line)', a[0] === b[0], detail);
      } else if (s.exact) {
        check(label + ' (exact)', a.join('\n') === b.join('\n'), detail);
      } else {
        const missing = subsetInOrder(a, b);
        check(label, missing === null, '     not in git output: ' + missing + '\n' + detail);
      }
    }
  } catch (e) {
    fail++;
    failures.push(name + ' :: THREW ' + e.stack);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

(async () => {
  if (spawnSync('git', ['--version']).status !== 0) {
    console.log('git is not installed; skipping the real-git comparison');
    return;
  }

  // The sandbox adds a few hints of its own for beginners. `ignore` lists
  // them, so the comparison still covers the rest of the output.
  const SANDBOX_HINT = /^hint: (use `git|run `git)/i;

  await scenario('first commit', [
    { cmd: 'git status', ignore: [SANDBOX_HINT] },
    { cmd: 'git init' },
    { cmd: 'git status', exact: true },
    { cmd: 'echo "# Project" > README.md', setup: true },
    { cmd: 'git status', exact: true },
    'git add README.md',
    { cmd: 'git status', exact: true },
    'git commit -m "First commit"',
    { cmd: 'git status', exact: true },
    { cmd: 'git commit -m "Nothing"' },
    'git log --oneline',
    'git log'
  ]);

  await scenario('modify and diff', [
    { cmd: 'git init', setup: true },
    { cmd: 'echo hello > a.txt', setup: true },
    { cmd: 'git add . && git commit -q -m one', setup: true },
    { cmd: 'echo world >> a.txt', setup: true },
    { cmd: 'git status', exact: true },
    'git diff',
    'git add .',
    { cmd: 'git status', exact: true },
    'git commit -m two',
    { cmd: 'rm a.txt', setup: true },
    { cmd: 'git status', exact: true },
    'git rm a.txt',
    { cmd: 'git status', exact: true }
  ]);

  await scenario('branches and merging', [
    { cmd: 'git init', setup: true },
    { cmd: 'echo a > a.txt && git add . && git commit -q -m one', setup: true },
    'git branch feature',
    { cmd: 'git branch', exact: true },
    'git branch feature',
    'git checkout feature',
    { cmd: 'echo b > b.txt && git add . && git commit -q -m two', setup: true },
    'git checkout main',
    'git merge feature',
    'git checkout -b other',
    'git switch main',
    { cmd: 'git switch nope', ignore: [SANDBOX_HINT] },
    'git branch -d other',
    { cmd: 'git log --oneline', exact: true }
  ]);

  await scenario('merge conflict', [
    { cmd: 'git init', setup: true },
    { cmd: 'echo base > f.txt && git add . && git commit -q -m base', setup: true },
    { cmd: 'git checkout -q -b side && echo theirs > f.txt && git add . && git commit -q -m side', setup: true },
    { cmd: 'git checkout -q main && echo ours > f.txt && git add . && git commit -q -m ours', setup: true },
    'git merge side',
    { cmd: 'git status', exact: true },
    'git commit -m oops',
    'git merge --abort',
    { cmd: 'git status', exact: true }
  ]);

  await scenario('detached head', [
    { cmd: 'git init', setup: true },
    { cmd: 'echo a > a.txt && git add . && git commit -q -m one', setup: true },
    { cmd: 'echo b > a.txt && git add . && git commit -q -m two', setup: true },
    // the sandbox has no `git switch -`, so it names the branch instead
    { cmd: 'git checkout HEAD~1', ignore: [/^Or go back to where you were with:$/, /^git switch main$/] },
    { cmd: 'git status', exact: true },
    'git checkout main'
  ]);

  await scenario('remote', [
    { cmd: 'git init', setup: true },
    { cmd: 'echo a > a.txt && git add . && git commit -q -m one', setup: true },
    { cmd: 'git push', ignore: [/^Add a remote first/] },
    'git remote add origin $REMOTE',
    { cmd: 'git remote -v', exact: true },
    // the lessons teach `-u`, so the sandbox suggests it over --set-upstream
    { cmd: 'git push', ignore: [/^git push -u origin main$/] },
    'git push -u origin main',
    'git push',
    'git fetch',
    'git pull'
  ]);

  await scenario('globs', [
    { cmd: 'git init', setup: true },
    { cmd: 'echo a > a.txt && echo b > b.txt && echo c > c.csv && mkdir notes && echo n > notes/n.txt', setup: true },
    { cmd: 'echo *.txt', exact: true },
    { cmd: 'echo *.pdf', exact: true },
    'git add *.txt',
    { cmd: 'git status', exact: true },
    'git add "*.pdf"',
    'git add "*.txt"',
    { cmd: 'git status', exact: true }
  ]);

  await scenario('gitignore', [
    { cmd: 'git init', setup: true },
    { cmd: 'echo n > notes.txt && echo p > cheatsheet.pdf && mkdir build && echo b > build/out.pdf', setup: true },
    { cmd: 'echo "*.pdf" > .gitignore', setup: true },
    { cmd: 'git status', exact: true },
    { cmd: 'git status --ignored', exact: true },
    'git add cheatsheet.pdf',
    'git add notes.txt cheatsheet.pdf',
    'git add "*.pdf"',
    { cmd: 'git check-ignore cheatsheet.pdf notes.txt', exact: true },
    { cmd: 'git check-ignore notes.txt', exact: true },
    'git add -f cheatsheet.pdf',
    'git add .',
    { cmd: 'git commit -q -m "All of it"', setup: true },
    { cmd: 'git rm --cached cheatsheet.pdf', exact: true },
    { cmd: 'git status', exact: true },
    { cmd: 'git rm --cached nope.txt', exact: true },
    { cmd: 'mkdir docs && echo a > docs/a.md && git add docs && git commit -q -m docs', setup: true },
    { cmd: 'git rm docs', exact: true },
    { cmd: 'git rm -r docs', exact: true },
    { cmd: 'git status', exact: true }
  ]);

  await scenario('undoing changes', [
    { cmd: 'git init', setup: true },
    { cmd: 'echo hello > example.txt && echo keep > other.txt', setup: true },
    'git add .',
    { cmd: 'git reset', exact: true },
    { cmd: 'git status', exact: true },
    { cmd: 'git add . && git commit -q -m one', setup: true },
    { cmd: 'echo world >> example.txt && echo more >> other.txt', setup: true },
    'git add .',
    { cmd: 'git status', exact: true },
    { cmd: 'git reset example.txt', exact: true },
    { cmd: 'git status', exact: true },
    { cmd: 'git reset', exact: true },
    { cmd: 'git restore example.txt', exact: true },
    { cmd: 'git status', exact: true },
    { cmd: 'git add . && git commit -q -m two', setup: true },
    { cmd: 'rm example.txt', setup: true },
    { cmd: 'git status', exact: true },
    { cmd: 'git restore example.txt', exact: true },
    { cmd: 'cat example.txt', exact: true },
    { cmd: 'git restore nope.txt', exact: true },
    { cmd: 'echo x > new.txt && git add new.txt', setup: true },
    { cmd: 'git restore --staged new.txt', exact: true },
    { cmd: 'git status', exact: true },
    { cmd: 'echo three >> example.txt', setup: true },
    { cmd: 'git commit -am "three"', ignore: [/insertion|create mode/] },
    { cmd: 'git status', exact: true },
    { cmd: 'git reset --soft HEAD~1', exact: true },
    { cmd: 'git status', exact: true },
    { cmd: 'git reset HEAD~1', exact: true },
    { cmd: 'git status', exact: true },
    { cmd: 'git reset --hard', exact: true },
    { cmd: 'git status', exact: true },
    { cmd: 'git reset --hard HEAD~1', exact: true },
    { cmd: 'echo four >> example.txt && echo gone > extra.txt && git add . && git commit -q -m four', setup: true },
    { cmd: 'git reset --hard HEAD~1', exact: true },
    { cmd: 'cat extra.txt', exact: true },
    { cmd: 'git log --oneline', exact: true },
    { cmd: 'git reset --hard example.txt', exact: true },
    { cmd: 'git reset nope.txt', exact: true }
  ]);

  await scenario('help, config and redirection', [
    // git exits 129 after -h; the sandbox treats it as success
    ...['init', 'status', 'add', 'commit', 'rm', 'restore', 'reset', 'log', 'branch', 'checkout',
      'switch', 'merge', 'remote', 'push', 'pull', 'fetch', 'clone', 'config', 'stash', 'check-ignore']
      .map((c) => ({ cmd: 'git ' + c + ' -h', firstLine: true, ok: true })),
    { cmd: 'git config pull.rebase false', exact: true },
    { cmd: 'git config --global user.name "Ada Lovelace"', exact: true },
    { cmd: 'git config user.name', exact: true },
    { cmd: 'git config --global init.defaultBranch trunk', exact: true },
    { cmd: 'git config --global core.editor "code --wait"', exact: true },
    { cmd: 'git config --global core.editor', exact: true },
    { cmd: 'git config nosection', exact: true },
    'git init',
    // outside a repository, git diff -h describes --no-index instead
    { cmd: 'git diff -h', firstLine: true, ok: true },
    { cmd: 'git status', exact: true },
    { cmd: 'git config pull.rebase false', exact: true },
    { cmd: 'git config pull.rebase', exact: true },
    { cmd: 'git config no.such.key', exact: true },
    { cmd: 'echo a > a.txt && git add . && git commit -q -m one', setup: true },
    { cmd: 'git log --oneline > log.txt', exact: true },
    { cmd: 'cat log.txt', exact: true },
    { cmd: 'git status >> log.txt', exact: true },
    { cmd: 'cat log.txt', exact: true },
    { cmd: 'git nope > out.txt', ok: false, ignore: [/./] },
    { cmd: 'git init -h > library.txt', ok: true }
  ]);

  console.log('\n===== real git comparison =====');
  console.log('passed: ' + pass + '   failed: ' + fail +
    (skipped ? '   (' + skipped + ' steps skipped: they need a newer git than ' + GIT_VERSION.join('.') + ')' : ''));
  if (fail) {
    console.log('\nFAILURES:');
    failures.forEach((f) => console.log('  ✗ ' + f));
    process.exit(1);
  }
})();
