/* End-to-end: load the RENDERED example.html (the author's guide) in jsdom,
   execute its real inlined scripts, and drive all seven demo boxes to
   completion.
   Run: node test-rendered.js ../example.html */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

// a path given on the command line is relative to where you ran node from
const target = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(__dirname, '..', 'example.html');
const html = fs.readFileSync(target, 'utf8');

const consoleErrors = [];
const vc = new VirtualConsole();
function brief(x) { return String((x && (x.message || x.stack)) || x).replace(/\s+/g, ' ').slice(0, 220); }
vc.on('jsdomError', (e) => { consoleErrors.push('jsdomError: ' + brief(e)); console.log('!! jsdomError:', brief(e)); });
vc.on('error', (...a) => consoleErrors.push('console.error: ' + a.map(brief).join(' ')));

const dom = new JSDOM(html, {
  url: 'https://academy.posit.co/lesson/',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.TextEncoder = TextEncoder;
    window.TextDecoder = TextDecoder;
    if (!window.crypto) window.crypto = require('crypto').webcrypto;
    // jsdom lacks these; Quarto's own theme JS uses them. Not our code.
    class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
    window.IntersectionObserver = window.IntersectionObserver || NoopObserver;
    window.ResizeObserver = window.ResizeObserver || NoopObserver;
    if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  }
});
const win = dom.window;

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(label + (detail ? '\n     ' + detail : '')); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, ms = 15000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (fn()) return true; } catch (e) { /* keep waiting */ }
    await sleep(80);
  }
  throw new Error('timed out waiting for ' + label);
}

// drive a sandbox the way a learner would: type into the input, press Enter
function typer(win, hostId) {
  const host = win.document.querySelector('#' + hostId);
  const form = host.querySelector('.gs-input-row');
  const input = host.querySelector('.gs-input');
  return async function type(line) {
    await waitFor(() => !input.disabled, 8000, 'input ready before "' + line + '"');
    input.value = line;
    form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => !input.disabled, 8000, 'command to finish: "' + line + '"');
    await sleep(20);
  };
}
function tasksState(win, hostId) {
  const host = win.document.querySelector('#' + hostId);
  const all = host.querySelectorAll('.gs-task');
  const done = host.querySelectorAll('.gs-task.is-done');
  return { total: all.length, done: done.length, text: host.querySelector('.gs-tasks').textContent };
}
function outText(win, hostId) {
  return win.document.querySelector('#' + hostId + ' .gs-out').textContent;
}

(async () => {
  await new Promise(r => win.addEventListener('load', r, { once: true }));
  await sleep(300);

  check('isomorphic-git loaded from the page', typeof win.git === 'object' && typeof win.git.init === 'function');
  check('sandbox library loaded from the page', typeof win.GitSandboxUI === 'object');
  check('helpers exported', typeof win.GitSandboxUI.isMerged === 'function');

  // whichever ids the page used (hand-written qmd or the extension)
  const ALL_IDS = Array.from(win.document.querySelectorAll('.git-sandbox')).map(d => d.id);
  check('page has seven demo boxes', ALL_IDS.length === 7, JSON.stringify(ALL_IDS));
  // the conflict box is looked up by id; the others by position
  const IDS = ALL_IDS.filter(id => id !== 'conflict-flow');
  const [ID1, ID2, ID3, ID4, ID5, ID6] = IDS;

  for (const id of ALL_IDS) {
    await waitFor(() => win.document.querySelector('#' + id + ' .gs-input'), 15000, id + ' to mount');
    check(id + ' mounted', !!win.document.querySelector('#' + id + ' .gs-input'));
    check(id + ' loading placeholder replaced',
      !/Loading the Git sandbox/.test(win.document.querySelector('#' + id).textContent));
  }

  /* ---------------- box 1: anatomy tour ---------------- */
  {
    const id = ID1;
    const type = typer(win, id);
    const diffText = () => win.document.querySelector('#' + id + ' .gs-diff').textContent;
    check('anatomy seeded with 2 commits',
      win.document.querySelectorAll('#' + id + ' .gs-graph circle').length === 2,
      String(win.document.querySelectorAll('#' + id + ' .gs-graph circle').length));
    check('anatomy starts at 0 done', tasksState(win, id).done === 0, tasksState(win, id).text);
    check('anatomy has 4 tasks', tasksState(win, id).total === 4);
    check('anatomy diff panel starts clean', /clean/.test(diffText()), diffText());

    await type('git status');
    check('anatomy task 1 ticks on status', tasksState(win, id).done >= 1, tasksState(win, id).text);

    await type('echo "A new line." >> README.md');
    check('anatomy edit shows in diff panel',
      /README\.md/.test(diffText()) && /A new line/.test(diffText()), diffText());
    check('anatomy task 2 ticks on edit', tasksState(win, id).done >= 2, tasksState(win, id).text);

    await type('git add .');
    check('anatomy staged chip in staging column',
      /README\.md/.test(win.document.querySelectorAll('#' + id + ' .gs-col')[1].textContent),
      win.document.querySelectorAll('#' + id + ' .gs-col')[1].textContent);
    check('anatomy task 3 ticks on stage', tasksState(win, id).done >= 3, tasksState(win, id).text);

    await type('git commit -m "Extend the README"');
    const st = tasksState(win, id);
    check('anatomy all 4 tasks complete', st.done === 4, st.text);
    check('anatomy done note shown', /feedback loop/.test(st.text), st.text);
    check('anatomy graph has 3 commits',
      win.document.querySelectorAll('#' + id + ' .gs-graph circle').length === 3);
  }

  /* ---------------- box 2: minimal block ---------------- */
  {
    const id = ID2;
    const type = typer(win, id);
    check('minimal starts with no repo',
      /No commits yet/.test(win.document.querySelector('#' + id + ' .gs-graph').textContent));
    check('minimal has 4 hint buttons', win.document.querySelectorAll('#' + id + ' .gs-hint').length === 4);
    check('minimal remote panel hidden', win.document.querySelector('#' + id + ' .gs-remote').hidden === true);

    await type('git init');
    check('minimal task 1 ticks', tasksState(win, id).done >= 1, tasksState(win, id).text);
    check('minimal prompt shows branch',
      /\(main\)/.test(win.document.querySelector('#' + id + ' .gs-prompt').textContent));

    await type('echo "hello" > notes.txt');
    await type('git add notes.txt');
    await type('git commit -m "First note"');
    const st = tasksState(win, id);
    check('minimal both tasks complete', st.done === 2, st.text);
    check('minimal graph has 1 commit',
      win.document.querySelectorAll('#' + id + ' .gs-graph circle').length === 1);
  }

  /* ---------------- box 3: when-language playground ---------------- */
  {
    const id = ID3;
    const type = typer(win, id);
    check('playground seeded with 1 commit',
      win.document.querySelectorAll('#' + id + ' .gs-graph circle').length === 1,
      String(win.document.querySelectorAll('#' + id + ' .gs-graph circle').length));

    await type('git checkout -b docs');
    check('playground branch condition ticks', tasksState(win, id).done >= 1, tasksState(win, id).text);

    await type('echo "## Setup" > SETUP.md');
    check('playground file-contains condition ticks', tasksState(win, id).done >= 2, tasksState(win, id).text);

    await type('git add .');
    await type('git commit -m "Describe the setup"');
    await type('git checkout main');
    await type('git merge docs');
    const st = tasksState(win, id);
    check('playground all 3 tasks complete', st.done === 3, st.text);
    check('playground merge was fast-forward (2 commits)',
      win.document.querySelectorAll('#' + id + ' .gs-graph circle').length === 2);
  }

  /* ---------------- box 4: merge flow ---------------- */
  {
    const id = ID4;
    const type = typer(win, id);
    check('merge-flow seeded with a diverged branch',
      win.document.querySelectorAll('#' + id + ' .gs-graph circle').length === 3,
      String(win.document.querySelectorAll('#' + id + ' .gs-graph circle').length));
    await type('git branch');
    check('merge-flow forecast branch exists', /forecast/.test(outText(win, id)));
    check('merge-flow starts on main', /\(main\)/.test(win.document.querySelector('#' + id + ' .gs-prompt').textContent));

    await type('echo "fixed the parser" > hotfix.md');
    await type('git add .');
    await type('git commit -m "Fix the date parsing"');
    check('merge-flow task 1 ticks (branches diverged)', tasksState(win, id).done >= 1, tasksState(win, id).text);

    await type('git merge forecast');
    check('merge-flow merge made a merge commit', /Merge made by/.test(outText(win, id)), outText(win, id).slice(-200));
    check('merge-flow tasks 2 and 3 tick', tasksState(win, id).done >= 3, tasksState(win, id).text);

    await type('ls');
    const lsOut = outText(win, id).split('$ ls').pop();
    check('merge-flow both branches\' files present after merge',
      /forecast\.R/.test(lsOut) && /hotfix\.md/.test(lsOut), lsOut.slice(0, 160));

    await type('git branch -d forecast');
    const st = tasksState(win, id);
    check('merge-flow all 4 tasks complete', st.done === 4, st.text);
    check('merge-flow graph has 5 commits',
      win.document.querySelectorAll('#' + id + ' .gs-graph circle').length === 5,
      String(win.document.querySelectorAll('#' + id + ' .gs-graph circle').length));
    check('merge-flow has a merge node (hollow circle)',
      Array.from(win.document.querySelectorAll('#' + id + ' .gs-graph circle'))
        .some(c => c.getAttribute('fill') === '#FFFFFF'));

    // reset button restores the seeded state
    win.document.querySelector('#' + id + ' .gs-reset').dispatchEvent(new win.Event('click'));
    await sleep(600);
    check('merge-flow reset restores the seed (3 commits)',
      win.document.querySelectorAll('#' + id + ' .gs-graph circle').length === 3,
      String(win.document.querySelectorAll('#' + id + ' .gs-graph circle').length));
    check('merge-flow reset unticks tasks', tasksState(win, id).done === 0, tasksState(win, id).text);
  }

  /* ---------------- merge conflict ---------------- */
  {
    const id = 'conflict-flow';
    const type = typer(win, id);
    const prompt = () => win.document.querySelector('#' + id + ' .gs-prompt').textContent;
    check('conflict-flow has 3 tasks', tasksState(win, id).total === 3);
    await type('git merge title');
    check('conflict-flow merge stops on a conflict',
      /CONFLICT \(content\): Merge conflict in README\.md/.test(outText(win, id)), outText(win, id).slice(-250));
    check('conflict-flow prompt shows MERGING', /\(main\|MERGING\)/.test(prompt()), prompt());
    check('conflict-flow task 1 ticks', tasksState(win, id).done === 1, tasksState(win, id).text);
    await type('cat README.md');
    check('conflict-flow markers in the file', /<<<<<<< main/.test(outText(win, id)) && />>>>>>> title/.test(outText(win, id)),
      outText(win, id).slice(-200));
    await type('echo "# Quarterly sales analysis 2026" > README.md');
    await type('git add README.md');
    check('conflict-flow task 2 ticks', tasksState(win, id).done === 2, tasksState(win, id).text);
    await type('git commit -m "Merge the new title"');
    const st = tasksState(win, id);
    check('conflict-flow all 3 tasks complete', st.done === 3, st.text);
    check('conflict-flow prompt back to normal', /\(main\) \$$/.test(prompt()), prompt());
  }

  /* ---------------- box 5: remote flow (pull, work, push) ---------------- */
  {
    const id = ID5;
    const type = typer(win, id);
    const remoteEl = () => win.document.querySelector('#' + id + ' .gs-remote');
    const remoteCircles = () => win.document.querySelectorAll('#' + id + ' .gs-remote-graph circle').length;
    const localCircles = () => win.document.querySelectorAll('#' + id + ' .gs-graph circle').length;
    const syncText = () => win.document.querySelector('#' + id + ' .gs-remote-sync').textContent;

    check('remote-flow panel is visible', !remoteEl().hidden);
    check('remote-flow seeded ahead: 2 remote vs 1 local',
      remoteCircles() === 2 && localCircles() === 1,
      'remote=' + remoteCircles() + ' local=' + localCircles());
    check('remote-flow sync line says pull', /git pull/.test(syncText()), syncText());

    await type('git push');
    check('remote-flow stale push rejected', /\[rejected\]/.test(outText(win, id)) && /fetch first/.test(outText(win, id)),
      outText(win, id).slice(-250));

    await type('git fetch');
    check('remote-flow task 1 ticks after fetch', tasksState(win, id).done >= 1, tasksState(win, id).text);
    check('remote-flow origin/main pill appears locally',
      /origin\/main/.test(win.document.querySelector('#' + id + ' .gs-graph').textContent),
      win.document.querySelector('#' + id + ' .gs-graph').textContent);

    await type('git pull');
    check('remote-flow pull fast-forwards', /Fast-forward/.test(outText(win, id)), outText(win, id).slice(-200));
    check('remote-flow local caught up', localCircles() === 2, String(localCircles()));
    check('remote-flow task 2 ticks', tasksState(win, id).done >= 2, tasksState(win, id).text);

    await type('echo "sales <- read_csv(\'sales.csv\')" > load.R');
    await type('git add .');
    await type('git commit -m "Load the sales data"');
    check('remote-flow task 3 ticks', tasksState(win, id).done >= 3, tasksState(win, id).text);
    check('remote-flow sync line says push', /git push/.test(syncText()), syncText());

    await type('git push');
    const st = tasksState(win, id);
    check('remote-flow all 4 tasks complete', st.done === 4, st.text);
    check('remote-flow graphs agree', remoteCircles() === 3 && localCircles() === 3,
      'remote=' + remoteCircles() + ' local=' + localCircles());
    check('remote-flow sync line says in sync', /in sync/.test(syncText()), syncText());
  }

  /* ---------------- box 6: the commit tree (tree-view) ---------------- */
  {
    const id = ID6;
    const type = typer(win, id);
    const host = win.document.querySelector('#' + id);
    const names = () => Array.from(host.querySelectorAll('.gs-tree-node .gs-tree-c')).map(n => n.textContent).sort().join(' ');
    const label = () => host.querySelector('.gs-tree-svg').getAttribute('aria-label');

    check('tree-flow widens into the right margin', host.classList.contains('column-page-right'));
    check('tree-flow has the commit tree pane', !!host.querySelector('.gs-tree .gs-tree-svg'));
    check('other boxes have no commit tree', win.document.querySelectorAll('.gs-tree').length === 1);
    check('tree-flow seed drawn as C0 and C1', names() === 'C0 C1', names());

    await type('git checkout -b report');
    check('tree-flow star moves to report', /report\* at C1/.test(label()) && /main at C1/.test(label()), label());
    check('tree-flow task 1 ticks', tasksState(win, id).done >= 1, tasksState(win, id).text);
    await type('echo "# Q3" > report.md');
    await type('git add .');
    await type('git commit -m "Start the report"');
    check('tree-flow new commit is C2', names() === 'C0 C1 C2' && /report\* at C2/.test(label()), names() + ' :: ' + label());
    await type('git checkout main');
    await type('git merge report');
    const st = tasksState(win, id);
    check('tree-flow all 3 tasks complete', st.done === 3, st.text);
    check('tree-flow fast-forward moves main to C2', /main\* at C2/.test(label()), label());
  }

  /* ---------------- isolation between boxes ---------------- */
  check('box 1 unaffected by later boxes',
    win.document.querySelectorAll('#' + ID1 + ' .gs-graph circle').length === 3);
  check('box 2 unaffected by later boxes',
    win.document.querySelectorAll('#' + ID2 + ' .gs-graph circle').length === 1);
  check('no authoring errors anywhere on the page',
    win.document.querySelectorAll('.gs-task-broken, .gs-config-error').length === 0,
    win.document.querySelector('.gs-task-err') ? win.document.querySelector('.gs-task-err').textContent : '');

  /* ---------------- page-level checks ---------------- */
  check('no page script errors', consoleErrors.length === 0, consoleErrors.join('\n     '));
  check('guide title present', /Building interactive Git exercises/.test(win.document.title), win.document.title);
  check('copyable block source is shown on the page',
    /```git-sandbox/.test(win.document.body.textContent));
  check('all sandboxes have an accessible label',
    Array.from(win.document.querySelectorAll('.gs-input')).every(i => i.getAttribute('aria-label')));
  check('terminal output is a live region',
    Array.from(win.document.querySelectorAll('.gs-out')).every(o => o.getAttribute('aria-live') === 'polite'));

  console.log('\n===== RESULTS (rendered page, end to end) =====');
  console.log('passed: ' + pass + '   failed: ' + fail);
  if (failures.length) {
    console.log('\nFAILURES:');
    failures.forEach(f => console.log(' - ' + f));
    process.exit(1);
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
