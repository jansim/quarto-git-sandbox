/* Headless tests for the git sandbox engine. Run: node test-core.js */
const git = require('isomorphic-git');
const Core = require('../src/sandbox-core.js');

let pass = 0, fail = 0;
const failures = [];

function check(label, cond, detail) {
  if (cond) { pass++; }
  else { fail++; failures.push(label + (detail ? '\n     ' + detail : '')); }
}
function strip(s) { return String(s).replace(/\{[gryb\/w]\}/g, ''); }

async function scenario(name, fn) {
  const sb = Core.createSandbox({ git });
  const log = [];
  const run = async (line) => {
    const r = await sb.run(line);
    log.push('$ ' + line + '\n' + strip(r.out));
    return { ...r, out: strip(r.out) };
  };
  try {
    await fn({ sb, run, check: (label, cond, detail) => check(name + ' :: ' + label, cond, detail) });
  } catch (e) {
    fail++;
    failures.push(name + ' :: THREW ' + e.stack);
  }
  return log;
}

(async () => {

  /* ---------------- 1. memory fs sanity ---------------- */
  await scenario('memfs', async ({ sb, check }) => {
    const fs = sb.fs.promises;
    await fs.mkdir('/a/b/c', { recursive: true });
    await fs.writeFile('/a/b/c/f.txt', 'hello');
    check('readFile utf8', (await fs.readFile('/a/b/c/f.txt', 'utf8')) === 'hello');
    check('readFile bytes', (await fs.readFile('/a/b/c/f.txt')) instanceof Uint8Array);
    check('readdir', JSON.stringify(await fs.readdir('/a/b/c')) === '["f.txt"]');
    check('stat isFile', (await fs.stat('/a/b/c/f.txt')).isFile() === true);
    check('stat isDirectory', (await fs.stat('/a/b')).isDirectory() === true);
    let code = null;
    try { await fs.stat('/nope'); } catch (e) { code = e.code; }
    check('ENOENT on missing', code === 'ENOENT', 'got ' + code);
    code = null;
    try { await fs.mkdir('/a'); } catch (e) { code = e.code; }
    check('EEXIST on dup mkdir', code === 'EEXIST', 'got ' + code);
    code = null;
    try { await fs.mkdir('/zzz/deep'); } catch (e) { code = e.code; }
    check('ENOENT on orphan mkdir', code === 'ENOENT', 'got ' + code);
    code = null;
    try { await fs.rmdir('/a/b'); } catch (e) { code = e.code; }
    check('ENOTEMPTY', code === 'ENOTEMPTY', 'got ' + code);
    await fs.unlink('/a/b/c/f.txt');
    check('unlink', (await fs.readdir('/a/b/c')).length === 0);
  });

  /* ---------------- 2. tokenizer ---------------- */
  {
    const t = Core.tokenize('git commit -m "my first commit"');
    check('tokenize quoted', JSON.stringify(t) === '["git","commit","-m","my first commit"]', JSON.stringify(t));
    const t2 = Core.tokenize('echo "hello world" > notes.txt');
    check('tokenize redirect', JSON.stringify(t2) === '["echo","hello world",">","notes.txt"]', JSON.stringify(t2));
    const t3 = Core.tokenize("echo 'a b' >> f.txt");
    check('tokenize append', JSON.stringify(t3) === '["echo","a b",">>","f.txt"]', JSON.stringify(t3));
    const s = Core.splitRedirect(t2);
    check('splitRedirect', s.args.join('|') === 'echo|hello world' && s.redirect === '>' && s.target === 'notes.txt');
    const t4 = Core.tokenize('echo hello>f.txt');
    check('tokenize no-space redirect', JSON.stringify(t4) === '["echo","hello",">","f.txt"]', JSON.stringify(t4));
  }

  /* ---------------- 3. guardrails before init ---------------- */
  await scenario('guardrails', async ({ run, check }) => {
    let r = await run('git status');
    check('status w/o repo errors', !r.ok && /not a git repository/.test(r.out), r.out);
    r = await run('frobnicate');
    check('unknown command', !r.ok && /command not found/.test(r.out), r.out);
    r = await run('git commit -m "x"');
    check('commit w/o repo', !r.ok, r.out);
  });

  /* ---------------- 4. core happy path ---------------- */
  const mainLog = await scenario('core', async ({ sb, run, check }) => {
    let r = await run('git init');
    check('init', r.ok && /Initialized empty Git repository/.test(r.out), r.out);
    check('branch is main', (await sb.currentBranch()) === 'main', String(await sb.currentBranch()));

    r = await run('git status');
    check('status: no commits yet', /No commits yet/.test(r.out), r.out);
    check('status: clean tree', /nothing to commit/.test(r.out), r.out);

    await run('echo "# My Project" > README.md');
    r = await run('ls');
    check('ls shows file', /README\.md/.test(r.out), r.out);
    r = await run('cat README.md');
    check('cat', r.out === '# My Project', r.out);

    r = await run('git status');
    check('status: untracked', /Untracked files/.test(r.out) && /README\.md/.test(r.out), r.out);

    r = await run('git commit -m "too soon"');
    check('commit w/o staging fails', !r.ok && /nothing to commit/.test(r.out), r.out);

    await run('git add README.md');
    r = await run('git status');
    check('status: staged new file', /Changes to be committed/.test(r.out) && /new file:\s+README\.md/.test(r.out), r.out);

    r = await run('git commit -m "First commit"');
    check('commit ok', r.ok && /\[main \(root-commit\) [0-9a-f]{7}\] First commit/.test(r.out), r.out);
    check('commit reports 1 file', /1 file changed/.test(r.out), r.out);

    r = await run('git status');
    check('status clean after commit', /nothing to commit, working tree clean/.test(r.out), r.out);

    r = await run('git log --oneline');
    check('log oneline', /First commit/.test(r.out) && /HEAD -> main/.test(r.out), r.out);

    // modify -> unstaged change
    await run('echo "Now with docs." >> README.md');
    r = await run('git status');
    check('status: modified unstaged', /Changes not staged/.test(r.out) && /modified:\s+README\.md/.test(r.out), r.out);
    r = await run('git diff');
    check('diff shows addition', /\+Now with docs\./.test(r.out), r.out);

    await run('git add .');
    await run('git commit -m "Add a description"');
    r = await run('git log --oneline');
    check('two commits in log', r.out.trim().split('\n').length === 2, r.out);
  });

  /* ---------------- 5. branching + merging ---------------- */
  await scenario('branching', async ({ sb, run, check }) => {
    await run('git init');
    await run('echo "line one" > notes.txt');
    await run('git add .');
    await run('git commit -m "Start notes"');

    let r = await run('git checkout -b feature');
    check('checkout -b', r.ok && /Switched to a new branch 'feature'/.test(r.out), r.out);
    check('on feature', (await sb.currentBranch()) === 'feature');

    r = await run('git branch');
    check('branch list marks current', /\* feature/.test(r.out) && /main/.test(r.out), r.out);

    await run('echo "line two" >> notes.txt');
    await run('git add notes.txt');
    r = await run('git commit -m "Add line two"');
    check('commit on feature', r.ok && /\[feature /.test(r.out), r.out);

    r = await run('git checkout main');
    check('back to main', r.ok && /Switched to branch 'main'/.test(r.out), r.out);
    r = await run('cat notes.txt');
    check('workdir reverted on checkout', r.out === 'line one', JSON.stringify(r.out));

    r = await run('git merge feature');
    check('fast-forward merge', r.ok && /Fast-forward/.test(r.out), r.out);
    r = await run('cat notes.txt');
    check('workdir updated after merge', r.out === 'line one\nline two', JSON.stringify(r.out));

    r = await run('git merge feature');
    check('merge again = up to date', /Already up to date/.test(r.out), r.out);

    r = await run('git branch -d feature');
    check('delete branch', r.ok && /Deleted branch feature/.test(r.out), r.out);
    r = await run('git branch');
    check('feature gone', !/feature/.test(r.out), r.out);
  });

  /* ---------------- 6. true merge commit (divergent history) ---------------- */
  const mergeLog = await scenario('true-merge', async ({ sb, run, check }) => {
    await run('git init');
    await run('echo "base" > base.txt');
    await run('git add .');
    await run('git commit -m "Base"');

    await run('git checkout -b feature');
    await run('echo "feature work" > feature.txt');
    await run('git add .');
    await run('git commit -m "Feature work"');

    await run('git checkout main');
    await run('echo "hotfix" > hotfix.txt');
    await run('git add .');
    await run('git commit -m "Hotfix on main"');

    let r = await run('git merge feature');
    check('recursive merge', r.ok && /Merge made by/.test(r.out), r.out);

    r = await run('ls');
    check('both files present after merge', /feature\.txt/.test(r.out) && /hotfix\.txt/.test(r.out), r.out);

    const g = await sb.graphModel();
    check('graph has 4 commits', g.commits.length === 4, 'got ' + g.commits.length);
    const merge = g.commits.find(c => c.parents.length === 2);
    check('graph has a merge commit', !!merge, JSON.stringify(g.commits.map(c => [c.message, c.parents.length])));
    check('graph head is main', g.head === 'main', g.head);
    const laneCount = new Set(g.commits.map(c => c.lane)).size;
    check('graph uses >1 lane for divergent history', laneCount >= 2, 'lanes=' + JSON.stringify(g.commits.map(c => [c.message, c.lane])));
    const headNode = g.commits.find(c => c.refs.some(x => x.isHead));
    check('graph marks HEAD ref', !!headNode && headNode.oid === merge.oid, JSON.stringify(g.commits.map(c => [c.message, c.refs])));
    // parents must appear after children in the ordering
    let orderOk = true;
    g.commits.forEach((c, i) => {
      (c.parents || []).forEach(p => {
        const pi = g.commits.findIndex(x => x.oid === p);
        if (pi !== -1 && pi < i) orderOk = false;
      });
    });
    check('graph ordering: children before parents', orderOk, JSON.stringify(g.commits.map(c => c.message)));
  });

  /* ---------------- 7. exercise checkers ---------------- */
  await scenario('checkers', async ({ sb, run, check }) => {
    await run('git init');
    await run('echo hi > a.txt');
    await run('git add a.txt');
    await run('git commit -m "one"');
    await run('git checkout -b topic');
    await run('echo yo > b.txt');
    await run('git add b.txt');
    await run('git commit -m "two"');
    await run('git checkout main');
    await run('git merge topic');

    const g = await sb.graphModel();
    check('checker: >=2 commits', g.commits.length >= 2, 'got ' + g.commits.length);
    check('checker: branch topic exists', g.branches.some(b => b.name === 'topic'));
    check('checker: on main', g.head === 'main', g.head);
    const files = await sb.listFiles();
    check('checker: listFiles', JSON.stringify(files) === '["a.txt","b.txt"]', JSON.stringify(files));
    const st = await sb.statusModel();
    check('checker: clean status', st.staged.length === 0 && st.modified.length === 0 && st.untracked.length === 0, JSON.stringify(st));
  });

  /* ---------------- 8. reset ---------------- */
  await scenario('reset', async ({ sb, run, check }) => {
    await run('git init');
    await run('echo x > x.txt');
    await run('git add .');
    await run('git commit -m "x"');
    await sb.reset();
    check('repo gone after reset', (await sb.isRepo()) === false);
    check('files gone after reset', (await sb.listFiles()).length === 0);
    const r = await sb.run('git status');
    check('status errors after reset', !r.ok, r.out);
    const r2 = await sb.run('git init');
    check('can re-init after reset', r2.ok, r2.out);
  });

  /* ---------------- 8b. checking out a commit (detached HEAD) ---------------- */
  await scenario('detached HEAD', async ({ sb, run, check }) => {
    await run('git init');
    await run('echo "one" > notes.txt');
    await run('git add .');
    const first = (await run('git commit -m "First"')).out.match(/ ([0-9a-f]{7})\]/)[1];
    await run('echo "one two" > notes.txt');
    await run('git add .');
    await run('git commit -m "Second"');

    let r = await run('git checkout ' + first);
    check('checkout by short hash', r.ok && /detached HEAD/.test(r.out), r.out);
    check('advice names the way back', /git switch -$/m.test(r.out), r.out);
    check('says where HEAD is', new RegExp('HEAD is now at ' + first + ' First').test(r.out), r.out);
    check('no current branch', (await sb.currentBranch()) === null);
    check('workdir is the old commit', (await run('cat notes.txt')).out === 'one');
    check('graph model is detached', (await sb.graphModel()).detached === true);

    r = await run('git status');
    check('status says detached at', new RegExp('^HEAD detached at ' + first).test(r.out), r.out);
    r = await run('git branch');
    check('branch lists the detached HEAD', new RegExp('\\* \\(HEAD detached at ' + first + '\\)').test(r.out), r.out);
    r = await run('git log --oneline');
    check('log decorates HEAD alone', /\(HEAD\) First/.test(r.out), r.out);

    await run('echo "experiment" > idea.txt');
    await run('git add .');
    r = await run('git commit -m "Try something"');
    check('commit on a detached HEAD', r.ok && /^\[detached HEAD [0-9a-f]{7}\] Try something/.test(r.out), r.out);
    r = await run('git status');
    check('status says detached from', new RegExp('^HEAD detached from ' + first).test(r.out), r.out);
    r = await run('git merge main');
    check('merge refused while detached', !r.ok && /detached/.test(r.out), r.out);

    r = await run('git checkout main');
    check('leaving warns about the orphaned commit',
      r.ok && /leaving 1 commit behind/.test(r.out) && /Try something/.test(r.out) &&
      /Switched to branch 'main'/.test(r.out), r.out);
    check('back on main', (await sb.currentBranch()) === 'main');

    r = await run('git switch HEAD~1');
    check('switch to a commit needs --detach', !r.ok && /a branch is expected/.test(r.out) && /--detach/.test(r.out), r.out);
    r = await run('git switch --detach HEAD~1');
    check('switch --detach HEAD~1', r.ok && new RegExp('HEAD is now at ' + first).test(r.out), r.out);
    r = await run('git checkout main');
    check('leaving without orphans names the old position',
      r.ok && new RegExp('Previous HEAD position was ' + first).test(r.out), r.out);

    r = await run('git checkout main^');
    check('branch^ resolves', r.ok && new RegExp('HEAD is now at ' + first).test(r.out), r.out);
    r = await run('git switch -c rescue');
    check('a branch can be made from a detached HEAD', r.ok && (await sb.currentBranch()) === 'rescue', r.out);
    await run('git checkout main');

    await run('echo "unsaved edits here" > notes.txt');
    r = await run('git checkout ' + first);
    check('refuses to overwrite local changes',
      !r.ok && /would be overwritten by checkout/.test(r.out) && /notes\.txt/.test(r.out), r.out);
    check('local changes kept', (await run('cat notes.txt')).out === 'unsaved edits here');
    check('still on main', (await sb.currentBranch()) === 'main');

    r = await run('git checkout 0000000');
    check('unknown hash', !r.ok && /did not match/.test(r.out), r.out);
  });

  /* ---------------- 9. misc error handling ---------------- */
  await scenario('errors', async ({ run, check }) => {
    await run('git init');
    let r = await run('git add missing.txt');
    check('add missing file', !r.ok && /did not match any files/.test(r.out), r.out);
    r = await run('git checkout nope');
    check('checkout unknown branch', !r.ok && /did not match/.test(r.out), r.out);
    r = await run('git merge nope');
    check('merge unknown branch', !r.ok && /not something we can merge/.test(r.out), r.out);
    r = await run('cat nope.txt');
    check('cat missing', !r.ok && /No such file/.test(r.out), r.out);
    r = await run('git commit');
    check('commit without -m and nothing staged', !r.ok && /nothing to commit/.test(r.out) && !r.editor, r.out);
    r = await run('git commit -m ""');
    check('commit with an empty -m', !r.ok && /empty commit message/.test(r.out), r.out);
    r = await run('git log');
    check('log with no commits', !r.ok && /does not have any commits/.test(r.out), r.out);
    r = await run('git bogus');
    check('unsupported subcommand', !r.ok && /not supported in this sandbox/.test(r.out), r.out);
    r = await run('');
    check('empty line is a no-op', r.ok && r.out === '', r.out);
  });

  /* ---------------- 9b. commit without -m opens an editor ---------------- */
  await scenario('commit editor', async ({ sb, run, check }) => {
    await run('git init');
    await run('echo hi > a.txt');
    await run('git add a.txt');
    let r = await run('git commit');
    check('hands back an editor', r.ok && r.editor && r.editor.file === '.git/COMMIT_EDITMSG', JSON.stringify(r));
    check('template lists the staged file', /#\tnew file:   a\.txt/.test(r.editor.text), r.editor.text);
    check('template names the branch', /# On branch main/.test(r.editor.text), r.editor.text);
    check('nothing committed yet', (await sb.graphModel()).commits.length === 0);

    r = await sb.finishCommit(r.editor.text);
    check('untouched template aborts', !r.ok && /empty commit message/.test(r.out), r.out);
    r = await sb.finishCommit(null);
    check('quitting without saving aborts', !r.ok && /empty commit message/.test(r.out), r.out);

    const t = (await run('git commit')).editor.text;
    r = await sb.finishCommit('Add a greeting\n\nLonger body.  \n' + t);
    check('saved message commits', r.ok && /^\[main \(root-commit\) [0-9a-f]{7}\] Add a greeting\n 1 file changed$/.test(r.out), r.out);
    const log = await sb.git.log({ fs: sb.fs, dir: sb.dir, depth: 1 });
    check('comment lines dropped, body kept', log[0].commit.message.trim() === 'Add a greeting\n\nLonger body.',
      JSON.stringify(log[0].commit.message));
  });

  /* ---------------- 10. topological ordering with same-second commits ---------------- */
  await scenario('topo-order', async ({ sb, run, check }) => {
    // every one of these lands in the same second, so timestamps all tie
    await run('git init');
    for (const n of ['a', 'b', 'c']) {
      await run(`echo ${n} > ${n}.txt`);
      await run('git add .');
      await run(`git commit -m "main ${n}"`);
    }
    await run('git checkout -b side');
    for (const n of ['d', 'e']) {
      await run(`echo ${n} > ${n}.txt`);
      await run('git add .');
      await run(`git commit -m "side ${n}"`);
    }
    await run('git checkout main');
    await run('echo f > f.txt');
    await run('git add .');
    await run('git commit -m "main f"');
    const r = await run('git merge side');
    check('merge succeeded', r.ok, r.out);

    const g = await sb.graphModel();
    check('7 commits total', g.commits.length === 7, 'got ' + g.commits.length);

    const ts = new Set(g.commits.map(c => c.timestamp));
    check('timestamps really do collide (test is meaningful)', ts.size < g.commits.length,
      'distinct timestamps: ' + ts.size);

    let orderOk = true, offender = null;
    g.commits.forEach((c, i) => {
      (c.parents || []).forEach(p => {
        const pi = g.commits.findIndex(x => x.oid === p);
        if (pi !== -1 && pi < i) { orderOk = false; offender = c.message + ' before parent'; }
      });
    });
    check('children always listed before parents', orderOk, offender);
    check('merge commit is first (it is the tip)', g.commits[0].parents.length === 2, g.commits[0].message);
    check('two lanes used', new Set(g.commits.map(c => c.lane)).size === 2,
      JSON.stringify(g.commits.map(c => [c.message, c.lane])));
    check('every commit has a lane', g.commits.every(c => typeof c.lane === 'number'));
  });

  /* ---------------- 11. seeded repo (as the lesson uses it) ---------------- */
  await scenario('seed', async ({ sb, check }) => {
    await sb.reset(async (api) => {
      await api.run('git init');
      await api.run('echo "# Sales analysis" > README.md');
      await api.run('git add .');
      await api.run('git commit -m "Add the project README"');
      await api.run('echo "library(tidyverse)" > analysis.R');
      await api.run('git add .');
      await api.run('git commit -m "Start the analysis script"');
    });
    check('seeded repo exists', (await sb.isRepo()) === true);
    const g = await sb.graphModel();
    check('seeded 2 commits', g.commits.length === 2, 'got ' + g.commits.length);
    check('seeded head is main', g.head === 'main', String(g.head));
    check('seed order correct', g.commits[0].message === 'Start the analysis script',
      JSON.stringify(g.commits.map(c => c.message)));
    const st = await sb.statusModel();
    check('seeded tree is clean',
      st.staged.length === 0 && st.modified.length === 0 && st.untracked.length === 0,
      JSON.stringify(st));
    const files = await sb.listFiles();
    check('seeded files present', JSON.stringify(files) === '["README.md","analysis.R"]', JSON.stringify(files));
  });

  /* ---------------- diff model ---------------- */
  await scenario('diffModel', async ({ sb, run, check }) => {
    check('null before init', (await sb.diffModel()) === null);
    await run('git init');
    let m = await sb.diffModel();
    check('empty after init', m.files.length === 0, JSON.stringify(m));

    await run('echo "one" > a.txt');
    m = await sb.diffModel();
    check('new file appears', m.files.length === 1 && m.files[0].kind === 'new' && m.files[0].file === 'a.txt',
      JSON.stringify(m));
    check('new file is all additions', m.files[0].lines.every(l => l.t === '+'), JSON.stringify(m.files[0].lines));

    await run('git add .');
    await run('git commit -m "Add a"');
    m = await sb.diffModel();
    check('clean after commit', m.files.length === 0, JSON.stringify(m));

    await run('echo "two" >> a.txt');
    m = await sb.diffModel();
    check('edited file is modified', m.files.length === 1 && m.files[0].kind === 'modified', JSON.stringify(m));
    const added = m.files[0].lines.filter(l => l.t === '+');
    check('addition carries new line number', added.length === 1 && added[0].text === 'two' && added[0].b === 2,
      JSON.stringify(m.files[0].lines));
    check('context line numbered on both sides',
      m.files[0].lines[0].t === ' ' && m.files[0].lines[0].a === 1 && m.files[0].lines[0].b === 1,
      JSON.stringify(m.files[0].lines));

    await run('rm a.txt');
    m = await sb.diffModel();
    check('removed file is deleted, all removals',
      m.files.length === 1 && m.files[0].kind === 'deleted' && m.files[0].lines.every(l => l.t === '-'),
      JSON.stringify(m));
  });

  /* ---------------- remote: push / fetch / pull ---------------- */
  await scenario('remote', async ({ sb, run, check }) => {
    await run('git init');
    let r = await run('git push');
    check('push without remote fails', !r.ok && /No configured push destination/.test(r.out), r.out);

    await run('git remote add origin https://github.com/acme/sales');
    r = await run('git remote -v');
    check('remote -v lists origin', /origin\thttps:\/\/github\.com\/acme\/sales \(fetch\)/.test(r.out), r.out);
    check('remoteModel exists and is empty', (await sb.remoteModel()).graph.commits.length === 0);

    await run('echo "# Sales" > README.md'); await run('git add .'); await run('git commit -m "Add README"');
    r = await run('git push');
    check('push without upstream fails helpfully', !r.ok && /git push -u origin main/.test(r.out), r.out);

    r = await run('git push -u origin main');
    check('first push says new branch', r.ok && /\* \[new branch\]\s+main -> main/.test(r.out), r.out);
    check('first push sets upstream', /set up to track 'origin\/main'/.test(r.out), r.out);
    let m = await sb.remoteModel();
    check('remote has the commit', m.graph.commits.length === 1 && m.ahead === 0 && m.behind === 0, JSON.stringify(m.graph.commits));

    r = await run('git push');
    check('repeat push is up-to-date', r.ok && /Everything up-to-date/.test(r.out), r.out);

    // colleague pushes while we were away: commit, push, rewind
    await run('echo "arima(sales)" > forecast.R'); await run('git add .'); await run('git commit -m "Colleague forecast"');
    await run('git push');
    r = await run('rewind 1');
    check('rewind ok', r.ok, r.out);
    m = await sb.remoteModel();
    check('remote is ahead after rewind', m.behind === 1 && m.ahead === 0, JSON.stringify({ ahead: m.ahead, behind: m.behind }));
    let g = await sb.graphModel();
    check('local graph does not know yet', g.commits.length === 1, String(g.commits.length));

    r = await run('git push');
    check('stale push rejected', !r.ok && /\[rejected\]/.test(r.out) && /fetch first/.test(r.out), r.out);

    r = await run('git fetch');
    check('fetch reports the new commit', r.ok && /-> origin\/main/.test(r.out), r.out);
    g = await sb.graphModel();
    check('origin/main pill appears after fetch',
      g.commits.length === 2 && g.commits.some(c => c.refs.some(rf => rf.name === 'origin/main' && rf.remote)),
      JSON.stringify(g.commits.map(c => c.refs)));

    r = await run('git pull');
    check('pull fast-forwards', r.ok && /Fast-forward/.test(r.out), r.out);
    r = await run('git pull');
    check('second pull up to date', r.ok && /Already up to date/.test(r.out), r.out);

    // diverge: remote-only commit + local-only commit -> pull merges
    await run('echo "x" > x.md'); await run('git add .'); await run('git commit -m "Remote-only"');
    await run('git push');
    await run('rewind 1');
    await run('echo "y" > y.md'); await run('git add .'); await run('git commit -m "Local-only"');
    r = await run('git pull');
    check('diverged pull makes a merge commit', r.ok && /Merge made by/.test(r.out), r.out);
    r = await run('git log --oneline');
    const shas = r.out.trim().split('\n').map(l => l.slice(0, 7));
    check('log has no duplicates after merge', new Set(shas).size === shas.length, r.out);

    r = await run('git push');
    check('push after merge succeeds', r.ok && /main -> main/.test(r.out), r.out);
    m = await sb.remoteModel();
    check('in sync at the end', m.ahead === 0 && m.behind === 0, JSON.stringify({ ahead: m.ahead, behind: m.behind }));

    await sb.reset();
    check('reset clears the remote', (await sb.remoteModel()) === null);
  });

  /* ---------------- snapshot / restore / changedSince ---------------- */
  await scenario('undo snapshots', async ({ sb, run, check }) => {
    await run('git init');
    await run('echo one > a.txt');
    await run('git add .');
    await run('git commit -m "one"');

    const snap = sb.snapshot();
    check('nothing changed right after a snapshot', sb.changedSince(snap) === false);

    await run('git status');
    check('read-only command does not count as a change', sb.changedSince(snap) === false);

    await run('echo two > b.txt');
    check('writing a file counts as a change', sb.changedSince(snap) === true);
    await run('git add b.txt');
    await run('git commit -m "two"');
    check('two commits before restore', (await sb.graphModel()).commits.length === 2);

    sb.restore(snap);
    check('restore rewinds the commit graph', (await sb.graphModel()).commits.length === 1);
    check('restore removes the file', (await sb.listFiles()).indexOf('b.txt') === -1);
    check('restored state matches the snapshot', sb.changedSince(snap) === false);

    // the snapshot survives later mutation of live state (deep clone)
    await run('echo three > c.txt');
    sb.restore(snap);
    check('a snapshot can be restored twice', (await sb.listFiles()).length === 1);

    // remote bookkeeping travels with the snapshot
    await run('git remote add origin https://example.com/x.git');
    check('adding a remote counts as a change', sb.changedSince(snap) === true);
    sb.restore(snap);
    check('restore forgets the remote', (await sb.remoteModel()) === null);

    // merge record travels with the snapshot
    await run('git checkout -b topic');
    await run('echo t > t.txt');
    await run('git add .');
    await run('git commit -m "topic"');
    await run('git checkout main');
    const beforeMerge = sb.snapshot();
    await run('git merge topic');
    check('merge recorded after merging', (await sb.graphModel()).merges.length === 1);
    sb.restore(beforeMerge);
    check('restore forgets the merge record', (await sb.graphModel()).merges.length === 0);
  });

  /* ---------------- cd ---------------- */
  await scenario('cd', async ({ sb, run, check }) => {
    await run('git init');
    await run('echo top > top.txt');
    let r = await run('mkdir src');
    r = await run('cd src');
    check('cd into a folder', r.ok && r.out === '', r.out);
    r = await run('pwd');
    check('pwd follows cd', r.out === '~/project/src', r.out);
    check('api pwd follows cd', sb.pwd() === '~/project/src', sb.pwd());
    check('api cwdPath is project-relative', sb.cwdPath() === 'src', sb.cwdPath());
    // the file API is anchored at the project, so the editor and `file x`
    // conditions mean the same file wherever the shell is
    await sb.writeFile('top.txt', 'top, via the api\n');
    check('api writeFile ignores cd', (await sb.listTree()).some((e) => e.path === 'top.txt') &&
      !(await sb.listTree()).some((e) => e.path === 'src/top.txt'));
    check('api readFile ignores cd', (await sb.readFile('top.txt')) === 'top, via the api\n');

    await run('echo "x" > app.js');
    check('relative write lands in cwd', (await sb.listFiles()).indexOf('src/app.js') !== -1,
      JSON.stringify(await sb.listFiles()));
    r = await run('cat app.js');
    check('cat resolves against cwd', r.ok && r.out === 'x', r.out);
    r = await run('ls');
    check('ls lists cwd', r.out === 'app.js', r.out);
    r = await run('ls ..');
    check('ls takes a path', /top\.txt/.test(r.out) && /src\//.test(r.out), r.out);

    r = await run('git add .');
    let st = await sb.statusModel();
    check('git add . stages only the current folder',
      st.staged.some(s => s.file === 'src/app.js') && st.untracked.indexOf('top.txt') !== -1,
      JSON.stringify(st));
    r = await run('git add ../top.txt');
    st = await sb.statusModel();
    check('git add with a relative parent path', st.staged.some(s => s.file === 'top.txt'), JSON.stringify(st));
    r = await run('git commit -m "from a subfolder"');
    check('commit works from a subfolder', r.ok, r.out);

    r = await run('cd ..');
    check('cd .. back to the root', r.ok && sb.pwd() === '~/project', sb.pwd());
    r = await run('cd -');
    check('cd - returns to the previous folder', r.ok && r.out === '~/project/src', r.out);
    r = await run('cd');
    check('bare cd goes to the project root', sb.pwd() === '~/project', sb.pwd());
    await run('cd src');
    r = await run('cd ~');
    check('cd ~ goes to the project root', sb.pwd() === '~/project', sb.pwd());
    r = await run('cd ~/src');
    check('cd ~/path is rooted at the project', sb.pwd() === '~/project/src', sb.pwd());

    r = await run('cd nope');
    check('cd to a missing folder fails', !r.ok && /No such file or directory/.test(r.out), r.out);
    r = await run('cd app.js');
    check('cd to a file fails', !r.ok && /Not a directory/.test(r.out), r.out);
    await run('cd ~');
    r = await run('cd ..');
    check('cannot leave the project', !r.ok && /only has the project folder/.test(r.out) && sb.pwd() === '~/project', r.out);
    r = await run('cd /');
    check('cannot cd to /', !r.ok && sb.pwd() === '~/project', r.out);

    // if the folder we are in disappears, the next command runs from the root
    await run('mkdir gone');
    await run('cd gone');
    await sb.fs.promises.rmdir(sb.dir + '/gone');
    r = await run('pwd');
    check('a vanished cwd falls back to the root', r.out === '~/project', r.out);

    // undo snapshots carry the folder
    await run('cd src');
    const snap = sb.snapshot();
    check('cd alone is not a state change', sb.changedSince(snap) === false);
    await run('cd ..');
    sb.restore(snap);
    check('restore brings back the folder', sb.pwd() === '~/project/src', sb.pwd());

    await sb.reset();
    check('reset returns to the root', sb.pwd() === '~/project', sb.pwd());
  });

  await scenario('cd before init', async ({ run, check }) => {
    await run('mkdir sub');
    await run('cd sub');
    const r = await run('git init');
    check('git init in a subfolder explains', !r.ok && /cd ~/.test(r.out), r.out);
  });

  /* ---------------- commit details (History view) ---------------- */
  await scenario('commit details', async ({ sb, run, check }) => {
    for (const l of ['git init', 'mkdir src', 'echo "one" > a.txt', 'echo "x" > src/b.txt', 'git add .',
      'git commit -m "First"', 'echo "two" >> a.txt', 'git rm src/b.txt', 'echo "c" > c.txt', 'git add .',
      'git commit -m "Second"']) await run(l);
    const g = await sb.graphModel();
    const second = await sb.commitDetails(g.commits[0].oid);
    check('details carry the full message and author', second.message === 'Second' && second.author === 'Your Name' &&
      second.oid === g.commits[0].oid && second.parents.length === 1, JSON.stringify(second));
    check('details list changed files with their kind',
      JSON.stringify(second.files.map(f => [f.file, f.kind])) ===
      JSON.stringify([['a.txt', 'modified'], ['c.txt', 'new'], ['src/b.txt', 'deleted']]),
      JSON.stringify(second.files.map(f => [f.file, f.kind])));
    const a = second.files[0];
    check('a modified file carries a line diff',
      a.lines.some(l => l.t === '+' && l.text === 'two') && a.lines.some(l => l.t === ' ' && l.text === 'one'),
      JSON.stringify(a.lines));
    const first = await sb.commitDetails(g.commits[1].oid);
    check('the first commit compares with nothing', first.parents.length === 0 &&
      first.files.every(f => f.kind === 'new') && first.files.length === 2, JSON.stringify(first.files));

    await run('git checkout -b side');
    await run('echo "s" > s.txt');
    await run('git add .');
    await run('git commit -m "Side"');
    await run('git checkout main');
    await run('echo "m" > m.txt');
    await run('git add .');
    await run('git commit -m "Main"');
    await run('git merge side');
    const merge = await sb.commitDetails((await sb.graphModel()).commits[0].oid);
    check('a merge shows what it brought in (against the first parent)',
      merge.parents.length === 2 && JSON.stringify(merge.files.map(f => f.file)) === '["s.txt"]',
      JSON.stringify(merge.files));
  });

  /* ---------------- merge conflicts ---------------- */
  const conflictSetup = async (run) => {
    for (const l of ['git init', 'echo "base" > f.txt', 'echo "keep" > d.txt', 'git add .', 'git commit -m one',
      'git checkout -b feat', 'echo "theirs" > f.txt', 'echo "new" > g.txt', 'echo "changed" > d.txt',
      'git add .', 'git commit -m feat', 'git checkout main', 'echo "ours" > f.txt', 'git rm d.txt',
      'git add .', 'git commit -m mine']) await run(l);
  };

  await scenario('merge conflict', async ({ sb, run, check }) => {
    await conflictSetup(run);
    await run('echo "scratch" > notes.txt');   // the learner's own untracked file
    let r = await run('git merge feat');
    check('conflicting merge fails like git',
      !r.ok && r.conflict && /CONFLICT \(content\): Merge conflict in f\.txt/.test(r.out) &&
      /Automatic merge failed; fix conflicts and then commit the result\./.test(r.out), r.out);
    check('modify/delete conflict reported',
      /CONFLICT \(modify\/delete\): d\.txt deleted in HEAD and modified in feat/.test(r.out), r.out);
    check('markers written to the file',
      (await sb.readFile('f.txt')) === '<<<<<<< main\nours\n=======\ntheirs\n>>>>>>> feat\n',
      JSON.stringify(await sb.readFile('f.txt')));
    let st = await sb.statusModel();
    check('status model is merging', st.merging === true);
    check('conflicted files listed with their kind',
      JSON.stringify(st.conflicted) === JSON.stringify([{ file: 'd.txt', kind: 'deleted by us' }, { file: 'f.txt', kind: 'both modified' }]),
      JSON.stringify(st.conflicted));
    check('cleanly merged file is staged', st.staged.some(s => s.file === 'g.txt'), JSON.stringify(st));
    check('learner\'s untracked file stays untracked', st.untracked.indexOf('notes.txt') !== -1, JSON.stringify(st));
    check('conflicted files are not also modified', st.modified.indexOf('f.txt') === -1, JSON.stringify(st));
    check('MERGE_HEAD written', /^[0-9a-f]{40}\n$/.test(await sb.readFile('.git/MERGE_HEAD')));

    r = await run('git status');
    check('status says unmerged paths', /You have unmerged paths/.test(r.out) &&
      /both modified:   f\.txt/.test(r.out) && /deleted by us:   d\.txt/.test(r.out), r.out);
    r = await run('git diff');
    check('diff shows the markers', /\+<<<<<<< main/.test(r.out), r.out);

    r = await run('git commit -m "too soon"');
    check('commit refused with unresolved files', !r.ok && /Committing is not possible because you have unmerged files/.test(r.out), r.out);
    r = await run('git merge feat');
    check('second merge refused', !r.ok && /Merging is not possible/.test(r.out), r.out);
    r = await run('git checkout feat');
    check('checkout refused', !r.ok && /resolve your current index first/.test(r.out) && /f\.txt: needs merge/.test(r.out), r.out);

    await run('echo "both" > f.txt');
    r = await run('git add f.txt');
    st = await sb.statusModel();
    check('git add marks one file resolved', st.conflicted.length === 1 && st.conflicted[0].file === 'd.txt', JSON.stringify(st.conflicted));
    await run('rm d.txt');
    r = await run('git add d.txt');
    check('git add of a deleted conflicted file resolves it', r.ok, r.out);
    st = await sb.statusModel();
    check('no conflicts left', st.conflicted.length === 0 && st.merging === true, JSON.stringify(st));
    r = await run('git status');
    check('status says all conflicts fixed', /All conflicts fixed but you are still merging/.test(r.out), r.out);
    r = await run('git merge feat');
    check('merging again before committing is refused', !r.ok && /MERGE_HEAD exists/.test(r.out), r.out);

    r = await run('git commit');
    check('commit without -m offers the merge message',
      r.ok && r.editor && /^Merge branch 'feat'\n/.test(r.editor.text) && /# Conflicts:\n#\td\.txt\n#\tf\.txt/.test(r.editor.text),
      JSON.stringify(r.editor));
    r = await sb.finishCommit(r.editor.text);
    check('finishing the editor commit concludes the merge', r.ok, r.out);
    const g = await sb.graphModel();
    check('merge commit has two parents', g.commits[0].parents.length === 2, JSON.stringify(g.commits[0]));
    check('merge recorded for `merged feat into main`', g.merges.some(m => m.from === 'feat' && m.into === 'main'), JSON.stringify(g.merges));
    st = await sb.statusModel();
    check('merge state cleared', !st.merging && !(await sb.mergeState()));
    check('resolution committed', (await sb.readFile('f.txt')) === 'both\n');
    r = await run('git log --oneline');
    check('log shows the merge', /Merge branch 'feat'$/m.test(r.out), r.out);
  });

  await scenario('merge conflict, abort and undo', async ({ sb, run, check }) => {
    await conflictSetup(run);
    let r = await run('git merge --abort');
    check('abort with no merge', !r.ok && /There is no merge to abort/.test(r.out), r.out);
    const before = sb.snapshot();
    await run('git merge feat');
    check('conflict changes state (so it can be undone)', sb.changedSince(before));
    r = await run('git merge --abort');
    check('abort succeeds', r.ok, r.out);
    const st = await sb.statusModel();
    check('abort clears the merge', !st.merging && !st.conflicted.length);
    check('abort restores our file', (await sb.readFile('f.txt')) === 'ours\n');
    check('abort removes files the merge brought in', (await sb.listFiles()).indexOf('g.txt') === -1, JSON.stringify(await sb.listFiles()));
    check('abort leaves a clean tree', !st.staged.length && !st.modified.length && !st.untracked.length, JSON.stringify(st));
    r = await run('git commit -m "nothing"');
    check('nothing to commit after abort', !r.ok && /nothing to commit/.test(r.out), r.out);

    await run('git merge feat');
    sb.restore(before);
    check('restoring a snapshot leaves the merge', !(await sb.statusModel()).merging);

    // -m commits while merging, even when the resolution keeps our side
    await run('git merge feat');
    await run('echo "ours" > f.txt');
    await run('git add .');
    r = await run('git commit -m "Keep ours"');
    check('-m concludes the merge', r.ok && /Keep ours/.test(r.out), r.out);
    check('merge commit with two parents', (await sb.graphModel()).commits[0].parents.length === 2);
  });

  await scenario('merge --continue and switching away', async ({ sb, run, check }) => {
    await conflictSetup(run);
    await run('git merge feat');
    let r = await run('git merge --continue');
    check('--continue refused while unresolved', !r.ok && /unmerged files/.test(r.out), r.out);
    await run('git add .');
    r = await run('git merge --continue');
    check('--continue opens the editor once resolved', r.ok && !!r.editor, JSON.stringify(r));
    r = await run('git switch -c side');
    check('switching away once resolved works', r.ok, r.out);
    check('and drops the merge', !(await sb.statusModel()).merging);
  });

  await scenario('switching between branches on the same commit keeps changes', async ({ sb, run, check }) => {
    for (const l of ['git init', 'echo a > a.txt', 'git add .', 'git commit -m one',
      'echo zzzz > a.txt', 'git add .', 'echo bbbbbb > b.txt']) await run(l);
    let r = await run('git switch -c x');
    check('switch -c works', r.ok, r.out);
    r = await run('git checkout main');
    check('checkout back works', r.ok && /Switched to branch 'main'/.test(r.out), r.out);
    check('on main again', (await run('git branch')).out.indexOf('* main') !== -1);
    r = await run('cat a.txt');
    check('staged edit survives', r.out === 'zzzz', JSON.stringify(r.out));
    r = await run('cat b.txt');
    check('untracked file survives', r.out === 'bbbbbb', JSON.stringify(r.out));
    const st = await sb.statusModel();
    check('change still staged', st.staged.some(f => f.file === 'a.txt' && f.kind === 'modified'), JSON.stringify(st));
    await run('echo yyyyyyy > a.txt');
    r = await run('git switch x');
    check('switch to x works', r.ok, r.out);
    check('unstaged edit survives', (await run('cat a.txt')).out === 'yyyyyyy');
    r = await run('git switch --detach main');
    check('detaching at the same commit works', r.ok && /HEAD is now at/.test(r.out), r.out);
    check('and keeps the edit', (await run('cat a.txt')).out === 'yyyyyyy');
    check('and the staged change', (await sb.statusModel()).staged.some(f => f.file === 'a.txt'));
  });

  await scenario('pull conflict', async ({ sb, run, check }) => {
    for (const l of ['git init', 'git remote add origin https://example.com/r.git', 'echo "base" > f.txt',
      'git add .', 'git commit -m one', 'git push -u origin main', 'echo "remote" > f.txt', 'git add .',
      'git commit -m remote', 'git push', 'rewind 1', 'echo "local" > f.txt', 'git add .', 'git commit -m local']) await run(l);
    let r = await run('git pull');
    check('conflicting pull stops with markers', !r.ok && /CONFLICT \(content\)/.test(r.out) &&
      /<<<<<<< main\nlocal\n=======\nremote\n>>>>>>> origin\/main/.test(await sb.readFile('f.txt')), r.out + '\n' + await sb.readFile('f.txt'));
    r = await run('git pull');
    check('second pull refused', !r.ok && /Pulling is not possible/.test(r.out), r.out);
    await run('echo "merged" > f.txt');
    await run('git add f.txt');
    r = await run('git commit -m "Merge the remote"');
    check('commit concludes the pull', r.ok, r.out);
    check('pull merge recorded', (await sb.graphModel()).merges.some(m => m.from === 'origin/main' && m.into === 'main'));
    r = await run('git push');
    check('push after resolving', r.ok && /main -> main/.test(r.out), r.out);
  });

  /* ---------------- globs ---------------- */
  await scenario('globs', async ({ sb, run, check }) => {
    const words = Core.tokenizeWords('git add *.txt "*.md" \'a?\'');
    check('unquoted * is a glob', words[2].glob === true && words[3].glob === false && words[4].glob === false, JSON.stringify(words));
    await run('git init');
    await run('echo a > a.txt');
    await run('echo b > b.txt');
    await run('echo c > c.csv');
    await run('echo h > .hidden.txt');
    await run('mkdir notes');
    await run('echo n > notes/n.txt');
    let r = await run('echo *.txt');
    check('shell expands *.txt, sorted, no dot files', r.out === 'a.txt b.txt', r.out);
    r = await run('echo .*.txt');
    check('a leading dot matches dot files', r.out === '.hidden.txt', r.out);
    r = await run('echo notes/*');
    check('glob below a folder', r.out === 'notes/n.txt', r.out);
    r = await run('echo *.pdf');
    check('no match leaves the pattern as typed', r.out === '*.pdf', r.out);
    r = await run('echo "*.txt"');
    check('quoted glob is not expanded', r.out === '*.txt', r.out);
    r = await run('echo [ab].txt ?.csv');
    check('[set] and ? work', r.out === 'a.txt b.txt c.csv', r.out);
    r = await run('ls *.txt');
    check('ls lists the matching files', r.ok && r.out === 'a.txt  b.txt', r.out);
    r = await run('cat *.txt');
    check('cat several files', r.out === 'a\nb', r.out);

    r = await run('git add *.txt');
    let st = await sb.statusModel();
    check('git add *.txt stages the top-level txt files', r.ok &&
      st.staged.map(x => x.file).join() === 'a.txt,b.txt', JSON.stringify(st.staged));
    await sb.git.remove({ fs: sb.fs, dir: sb.dir, filepath: 'a.txt' });
    await sb.git.remove({ fs: sb.fs, dir: sb.dir, filepath: 'b.txt' });
    r = await run('git add "*.txt"');
    st = await sb.statusModel();
    check('quoted pathspec glob also matches in subfolders, like git', r.ok &&
      st.staged.map(x => x.file).join() === '.hidden.txt,a.txt,b.txt,notes/n.txt', JSON.stringify(st.staged));
    r = await run('git add "*.pdf"');
    check('pathspec glob with no match fails', !r.ok && /pathspec '\*\.pdf' did not match any files/.test(r.out), r.out);
    await run('git commit -m "Text files"');
    await run('rm a.txt');
    r = await run('git add "*.txt"');
    st = await sb.statusModel();
    check('pathspec glob stages a deletion', r.ok && st.stagedDeleted.join() === 'a.txt', JSON.stringify(st));
    await run('cd notes');
    await run('echo m > m.txt');
    await run('echo x > ../x.txt');
    r = await run('git add "*.txt"');
    st = await sb.statusModel();
    check('pathspec glob is relative to the current folder', r.ok &&
      st.staged.map(x => x.file).join() === 'notes/m.txt', JSON.stringify(st.staged));
  });

  /* ---------------- .gitignore ---------------- */
  await scenario('gitignore', async ({ sb, run, check }) => {
    await run('git init');
    await run('echo notes > notes.txt');
    await run('echo pdf > cheatsheet.pdf');
    await run('mkdir build');
    await run('echo bin > build/out.pdf');
    await run('echo "*.pdf" > .gitignore');
    let r = await run('git status');
    check('ignored files are not untracked', !/cheatsheet\.pdf|build/.test(r.out) && /\.gitignore/.test(r.out), r.out);
    let st = await sb.statusModel();
    check('statusModel lists ignored files', st.ignored.join() === 'build/out.pdf,cheatsheet.pdf', JSON.stringify(st.ignored));
    r = await run('git status --ignored');
    check('status --ignored shows them, folders collapsed', /Ignored files:\n.*git add -f.*\n\s+build\/\n\s+cheatsheet\.pdf/.test(r.out), r.out);
    r = await run('git add .');
    st = await sb.statusModel();
    check('git add . skips ignored files', r.ok && st.staged.map(x => x.file).join() === '.gitignore,notes.txt', JSON.stringify(st.staged));
    r = await run('git add cheatsheet.pdf');
    check('naming an ignored file is refused', !r.ok && /ignored by one of your \.gitignore files:\ncheatsheet\.pdf/.test(r.out) && /-f/.test(r.out), r.out);
    r = await run('git add *');
    check('git add * stages the rest, then refuses the ignored file', !r.ok && /cheatsheet\.pdf/.test(r.out), r.out);
    r = await run('git add "*.pdf"');
    check('a glob that only reaches ignored files matches nothing', !r.ok && /did not match any files/.test(r.out), r.out);
    r = await run('git check-ignore cheatsheet.pdf notes.txt');
    check('check-ignore prints the ignored paths', r.ok && r.out === 'cheatsheet.pdf', r.out);
    r = await run('git check-ignore notes.txt');
    check('check-ignore fails when nothing is ignored', !r.ok && r.out === '', r.out);
    r = await run('git add -f cheatsheet.pdf');
    st = await sb.statusModel();
    check('-f adds an ignored file', r.ok && st.staged.some(x => x.file === 'cheatsheet.pdf') &&
      st.ignored.indexOf('cheatsheet.pdf') === -1, JSON.stringify(st));
    await run('git commit -m "Track it all"');
    await run('echo changed > cheatsheet.pdf');
    st = await sb.statusModel();
    check('a tracked file stays tracked though it matches .gitignore', st.modified.indexOf('cheatsheet.pdf') !== -1, JSON.stringify(st));
    await run('git add cheatsheet.pdf');
    await run('git commit -m "Change it"');

    // "once it's in, it's too late": take it out of git, keep the file
    r = await run('git rm --cached cheatsheet.pdf');
    check('rm --cached says what it removed', r.ok && r.out === "rm 'cheatsheet.pdf'", r.out);
    check('rm --cached keeps the file on disk', (await sb.readFile('cheatsheet.pdf')) === 'changed\n');
    st = await sb.statusModel();
    check('rm --cached stages the deletion; the file is now ignored', st.stagedDeleted.join() === 'cheatsheet.pdf' &&
      st.ignored.indexOf('cheatsheet.pdf') !== -1 && st.untracked.indexOf('cheatsheet.pdf') === -1, JSON.stringify(st));
    r = await run('git rm --cached nope.txt');
    check('rm of an unknown path fails', !r.ok && /pathspec 'nope\.txt' did not match any files/.test(r.out), r.out);
  });

  /* ---------------- git rm ---------------- */
  await scenario('git rm', async ({ sb, run, check }) => {
    await run('git init');
    await run('mkdir docs');
    await run('echo a > docs/a.md');
    await run('echo b > docs/b.md');
    await run('echo c > c.txt');
    await run('git add .');
    await run('git commit -m "Files"');
    let r = await run('git rm docs');
    check('a folder needs -r', !r.ok && /not removing 'docs' recursively without -r/.test(r.out), r.out);
    r = await run('git rm -r docs c.txt');
    check('rm -r removes every file, in order', r.ok && r.out === "rm 'c.txt'\nrm 'docs/a.md'\nrm 'docs/b.md'", r.out);
    check('the emptied folder is gone too', (await sb.listTree()).every(e => e.path.indexOf('docs') !== 0), JSON.stringify(await sb.listTree()));
    const st = await sb.statusModel();
    check('the deletions are staged', st.stagedDeleted.join() === 'c.txt,docs/a.md,docs/b.md', JSON.stringify(st));
  });

  /* ---------------- undoing changes ---------------- */
  await scenario('undo', async ({ sb, run, check }) => {
    await run('git init');
    await run('echo hello > example.txt');
    await run('git add .');
    let r = await run('git reset');
    let st = await sb.statusModel();
    check('reset before the first commit empties the staging area', r.ok && !st.staged.length && st.untracked.join() === 'example.txt', JSON.stringify(st));
    await run('git add .');
    await run('git commit -m "Hello"');

    await run('echo world >> example.txt');
    await run('git add .');
    r = await run('git reset example.txt');
    st = await sb.statusModel();
    check('reset <file> unstages it and reports what is left', r.ok && r.out === 'Unstaged changes after reset:\nM\texample.txt' &&
      !st.staged.length && st.modified.join() === 'example.txt', r.out + JSON.stringify(st));
    check('reset <file> keeps the edit on disk', (await sb.readFile('example.txt')) === 'hello\nworld\n');

    r = await run('git restore example.txt');
    check('restore throws the edit away', r.ok && (await sb.readFile('example.txt')) === 'hello\n');
    check('...and the tree is clean', /working tree clean/.test((await run('git status')).out));

    await run('rm example.txt');
    r = await run('git restore example.txt');
    check('restore brings back a deleted file', r.ok && (await sb.readFile('example.txt')) === 'hello\n');
    r = await run('git restore nope.txt');
    check('restore of an unknown path fails', !r.ok && /pathspec 'nope\.txt' did not match/.test(r.out), r.out);
    r = await run('git restore');
    check('restore needs a path', !r.ok && /must specify path/.test(r.out), r.out);

    await run('echo staged > example.txt');
    await run('git add example.txt');
    await run('echo unstaged > example.txt');
    r = await run('git restore example.txt');
    check('restore takes the staged copy, not the committed one', (await sb.readFile('example.txt')) === 'staged\n');
    r = await run('git restore --staged example.txt');
    st = await sb.statusModel();
    check('restore --staged unstages but keeps the file', r.ok && !st.staged.length && st.modified.join() === 'example.txt' &&
      (await sb.readFile('example.txt')) === 'staged\n', JSON.stringify(st));
    await run('git add example.txt');
    r = await run('git restore --staged --worktree example.txt');
    check('restore --staged --worktree goes back to the commit', r.ok && (await sb.readFile('example.txt')) === 'hello\n' &&
      /working tree clean/.test((await run('git status')).out));

    // commit -a
    await run('echo more >> example.txt');
    await run('echo new > untracked.txt');
    r = await run('git commit -am "More"');
    st = await sb.statusModel();
    check('commit -am stages tracked edits and commits', r.ok && /\] More/.test(r.out) && !st.modified.length, r.out);
    check('commit -a leaves untracked files alone', st.untracked.join() === 'untracked.txt', JSON.stringify(st));
    await run('rm untracked.txt');
    await run('echo again >> example.txt');
    r = await run('git commit -a -m "Again" -m "With a body"');
    const head = (await sb.graphModel()).commits[0];
    check('commit -a -m with two paragraphs', r.ok && head.message === 'Again', head.message);
    check('commit -a with nothing to commit', !(await run('git commit -am "Nothing"')).ok);

    // reset to a commit
    r = await run('git reset --soft HEAD~1');
    st = await sb.statusModel();
    check('reset --soft keeps the change staged', r.ok && r.out === '' && st.staged.map(x => x.file).join() === 'example.txt', JSON.stringify(st));
    r = await run('git reset HEAD');
    st = await sb.statusModel();
    check('reset HEAD unstages', r.ok && st.modified.join() === 'example.txt' && !st.staged.length, JSON.stringify(st));
    r = await run('git reset --hard');
    check('reset --hard throws away the edit', r.ok && /^HEAD is now at [0-9a-f]{7} More$/.test(r.out) &&
      /working tree clean/.test((await run('git status')).out), r.out);
    await run('echo extra > extra.txt');
    await run('git add .');
    await run('git commit -m "Extra"');
    r = await run('git reset --hard HEAD~1');
    check('reset --hard to an older commit removes files it lacks', r.ok && /HEAD is now at [0-9a-f]{7} More/.test(r.out) &&
      (await sb.listFiles()).join() === 'example.txt', r.out + (await sb.listFiles()).join());
    check('the branch moved back', (await sb.graphModel()).commits.length === 2);
    r = await run('git reset --hard HEAD~5');
    check('an unknown revision is ambiguous', !r.ok && /ambiguous argument 'HEAD~5'/.test(r.out), r.out);
    r = await run('git reset --hard example.txt');
    check('--hard with a path is refused', !r.ok && /Cannot do hard reset with paths/.test(r.out), r.out);
  });

  /* ---------------- reset during a merge ---------------- */
  await scenario('reset aborts a merge', async ({ sb, run, check }) => {
    await run('git init');
    await run('echo base > f.txt');
    await run('git add .');
    await run('git commit -m base');
    await run('git checkout -b side');
    await run('echo theirs > f.txt');
    await run('git commit -am side');
    await run('git checkout main');
    await run('echo ours > f.txt');
    await run('git commit -am ours');
    await run('git merge side');
    check('merge stopped', !!(await sb.mergeState()));
    const r = await run('git reset --hard');
    check('reset --hard ends the merge', r.ok && !(await sb.mergeState()) && (await sb.readFile('f.txt')) === 'ours\n');
  });

  /* ---------------- -h, config, redirection ---------------- */
  await scenario('help and config', async ({ sb, run, check }) => {
    let r = await run('git init -h');
    check('init -h works before git init', r.ok && /^usage: git init /.test(r.out) && /--initial-branch/.test(r.out), r.out);
    r = await run('git stash -h');
    check('stash -h shows the usage though stash is not supported', r.ok && /^usage: git stash list/.test(r.out), r.out);
    r = await run('git help commit');
    check('git help <command>', r.ok && /^usage: git commit /.test(r.out), r.out);
    r = await run('git commit -m "-h"');
    check('-h as a message is not help', !/usage:/.test(r.out), r.out);

    // the slides' "command library" exercise
    await run('git init');
    r = await run('git init -h > library.txt');
    check('-h output can go into a file', r.ok && r.out === '' && /^usage: git init /.test(await sb.readFile('library.txt')), await sb.readFile('library.txt'));
    r = await run('git commit -h >> library.txt');
    const lib = await sb.readFile('library.txt');
    check('>> appends', /usage: git init[\s\S]*usage: git commit/.test(lib), lib);
    check('no colour codes in files', !/\{[gryb\/w]\}/.test(lib));
    r = await run('git status > status.txt');
    check('any command output can be redirected', /^On branch main/.test(await sb.readFile('status.txt')));
    r = await run('git frobnicate > err.txt');
    check('errors still show on screen', !r.ok && /not supported/.test(r.out), r.out);
    r = await run('ls > nope/listing.txt');
    check('redirect into a missing folder fails', !r.ok && /No such file/.test(r.out), r.out);

    r = await run('git config --global user.name "Ada Lovelace"');
    check('config --global user.name', r.ok && (await run('git config user.name')).out === 'Ada Lovelace');
    await run('git config --global user.email ada@example.com');
    await run('git add library.txt');
    await run('git commit -m "Library"');
    check('commits use the configured name', (await sb.graphModel()).commits[0].author === 'Ada Lovelace');
    r = await run('git config pull.rebase false');
    check('a local key is stored', r.ok && (await run('git config pull.rebase')).out === 'false');
    check('...in .git/config', /rebase = false/.test(await sb.fs.promises.readFile(sb.dir + '/.git/config', 'utf8')));
    r = await run('git config --global core.editor "code --wait"');
    check('a global key with spaces', r.ok && (await run('git config core.editor')).out === 'code --wait');
    r = await run('git config --list');
    check('config --list', /user\.name=Ada Lovelace/.test(r.out) && /core\.editor=code --wait/.test(r.out) && /pull\.rebase=false/.test(r.out), r.out);
    r = await run('git config no.such.key');
    check('a missing key fails quietly', !r.ok && r.out === '', r.out);
    r = await run('git config nosection');
    check('a key needs a section', !r.ok && /key does not contain a section/.test(r.out), r.out);
    r = await run('git config --unset pull.rebase');
    check('--unset', r.ok && !(await run('git config pull.rebase')).ok);

    const snap = sb.snapshot();
    await run('git config --global init.defaultBranch trunk');
    check('changing a global key counts as a change', sb.changedSince(snap));
    sb.restore(snap);
    check('undo restores global config', !(await run('git config --global init.defaultBranch')).ok);
  });

  await scenario('init.defaultBranch', async ({ sb, run, check }) => {
    await run('git config --global init.defaultBranch trunk');
    await run('git init');
    check('init uses init.defaultBranch', (await run('git status')).out.indexOf('On branch trunk') === 0);
  });

  await scenario('init -b', async ({ sb, run, check }) => {
    const r = await run('git init -b develop');
    check('init -b names the first branch', r.ok && (await run('git status')).out.indexOf('On branch develop') === 0);
  });

  /* ---------------- remote-tracking branches ---------------- */
  await scenario('tracking', async ({ sb, run, check }) => {
    await run('git init');
    await run('echo a > a.txt');
    await run('git add .');
    await run('git commit -m one');
    await run('git remote add origin https://example.com/acme/repo.git');
    let r = await run('git pull');
    check('pull without an upstream explains itself', !r.ok && /no tracking information/.test(r.out) &&
      /--set-upstream-to=origin\/<branch> main/.test(r.out), r.out);
    await run('git push -u origin main');
    check('push -u records the upstream in .git/config',
      /\[branch "main"\][^[]*merge = refs\/heads\/main/.test(await sb.fs.promises.readFile(sb.dir + '/.git/config', 'utf8')) &&
      /\[branch "main"\][^[]*remote = origin/.test(await sb.fs.promises.readFile(sb.dir + '/.git/config', 'utf8')));
    r = await run('git status');
    check('status: up to date', /^On branch main\nYour branch is up to date with 'origin\/main'\./.test(r.out), r.out);
    await run('echo b > b.txt');
    await run('git add .');
    await run('git commit -m two');
    r = await run('git status');
    check('status: ahead', /ahead of 'origin\/main' by 1 commit\./.test(r.out), r.out);
    await run('git push');
    await run('echo c > c.txt');
    await run('git add .');
    await run('git commit -m colleague');
    await run('git push');
    await run('rewind 1');
    r = await run('git status');
    check('status: news on the remote shows only after fetch', /up to date with/.test(r.out), r.out);
    await run('git fetch');
    r = await run('git status');
    check('status: behind after fetch', /behind 'origin\/main' by 1 commit, and can be fast-forwarded/.test(r.out), r.out);
    r = await run('git merge origin/main');
    check('merge origin/main fast-forwards', r.ok && /Fast-forward/.test(r.out), r.out);
    check('merge origin/main is recorded', (await sb.graphModel()).merges.some(m => m.from === 'origin/main' && m.into === 'main'));

    // a colleague's branch
    await run('git checkout -b feature');
    await run('echo f > f.txt');
    await run('git add .');
    await run('git commit -m feature');
    await run('git push -u origin feature');
    await run('git checkout main');
    r = await run('git branch -D feature');
    check('branch -D says what it deleted', r.ok && /^Deleted branch feature \(was [0-9a-f]{7}\)\.$/.test(r.out), r.out);
    r = await run('git branch -a');
    check('branch -a lists remote-tracking branches', /remotes\/origin\/feature/.test(r.out) && /remotes\/origin\/main/.test(r.out), r.out);
    r = await run('git switch feature');
    check('switch guesses the remote branch', r.ok && /Switched to a new branch 'feature'\nbranch 'feature' set up to track 'origin\/feature'\./.test(r.out), r.out);
    check('...and checks it out', (await sb.currentBranch()) === 'feature' && (await sb.readFile('f.txt')) === 'f\n');
    r = await run('git switch -');
    check('switch - goes back', r.ok && (await sb.currentBranch()) === 'main', r.out);
    r = await run('git checkout -');
    check('checkout - too', r.ok && (await sb.currentBranch()) === 'feature', r.out);
    r = await run('git checkout feature');
    check('already on it', r.ok && /^Already on 'feature'\nYour branch is up to date with 'origin\/feature'\.$/.test(r.out), r.out);
    await run('git checkout main');
    await run('git branch -D feature');
    r = await run('git checkout --track origin/feature');
    check('checkout --track', r.ok && (await sb.currentBranch()) === 'feature' && /set up to track 'origin\/feature'/.test(r.out), r.out);
    r = await run('git pull');
    check('pull uses the upstream', r.ok && /Already up to date/.test(r.out), r.out);
    await run('git checkout -b copy origin/main');
    check('-b with a start point starts there, tracking it', !(await sb.listFiles()).includes('f.txt') &&
      /up to date with 'origin\/main'/.test((await run('git status')).out));
    r = await run('git pull origin feature');
    check('pull origin <branch> merges that branch', r.ok && (await sb.readFile('f.txt')) === 'f\n', r.out);
    r = await run('git pull --rebase');
    check('pull --rebase is explained', !r.ok && /no rebase/.test(r.out), r.out);
    r = await run('git branch --set-upstream-to=origin/feature');
    check('--set-upstream-to', r.ok && /'copy' set up to track 'origin\/feature'/.test(r.out), r.out);
    r = await run('git branch --unset-upstream');
    check('--unset-upstream', r.ok && !/Your branch/.test((await run('git status')).out));

    const snap = sb.snapshot();
    await run('git checkout main');
    sb.restore(snap);
    r = await run('git switch -');
    check('undo restores where switch - goes', r.ok && (await sb.currentBranch()) === 'feature', r.out);
  });

  /* ---------------- report ---------------- */
  console.log('\n===== TRANSCRIPT: core happy path =====');
  console.log(mainLog.join('\n'));
  console.log('\n===== TRANSCRIPT: true merge =====');
  console.log(mergeLog.join('\n'));

  console.log('\n===== RESULTS =====');
  console.log('passed: ' + pass + '   failed: ' + fail);
  if (failures.length) {
    console.log('\nFAILURES:');
    failures.forEach(f => console.log(' - ' + f));
    process.exit(1);
  }
})();
