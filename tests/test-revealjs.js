/* The reveal.js demo deck: boxes on slides, one repository shared by two
   of them. Loads the RENDERED example-revealjs.html in jsdom and drives it.
   Run: node tests/test-revealjs.js example-revealjs.html */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const target = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(__dirname, '..', 'example-revealjs.html');
const html = fs.readFileSync(target, 'utf8');

// Any script error counts (a box that confuses reveal.js shows up as one
// of reveal's), except resources this offline test cannot fetch.
const ourErrors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => {
  const text = String((e && (e.stack || e.message)) || e);
  if (/Could not load (script|link)/.test(text)) return;
  ourErrors.push(text.slice(0, 300));
});

const dom = new JSDOM(html, {
  url: 'https://example.org/deck/',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.TextEncoder = TextEncoder;
    window.TextDecoder = TextDecoder;
    if (!window.crypto) window.crypto = require('crypto').webcrypto;
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
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (fn()) return; } catch (e) { /* keep waiting */ }
    await sleep(80);
  }
  throw new Error('timed out waiting for ' + label);
}

(async () => {
  await new Promise(r => win.addEventListener('load', r, { once: true }));
  const $ = (s) => win.document.querySelector(s);

  await waitFor(() => $('#deck-repo .gs-input') && $('#deck-branch .gs-input'), 15000, 'both boxes to mount');
  check('both boxes mount on their slides',
    !!$('section #deck-repo .gs-input') && !!$('section #deck-branch .gs-input'));
  check('no <section> inside a box (reveal.js would take it for a slide)',
    win.document.querySelectorAll('.gs section').length === 0);
  check('boxes on slides switch to the fill-the-slide layout',
    $('#deck-repo').classList.contains('gs-fill') && $('#deck-branch').classList.contains('gs-fill'));
  check('the slide box offers the editor', !!$('#deck-repo .gs-wtab[data-view="editor"]'));
  check('the slide box has a button for the commit tree, closed to start',
    !!$('#deck-repo .gs-tree-btn') && $('#deck-repo .gs-tree').hidden);
  check('the slide box offers two views',
    Array.from(win.document.querySelectorAll('#deck-repo .gs-tab')).filter(t => !t.hidden).length === 2);
  check('the later slide shows the tree', $('#deck-branch .gs-tree') && !$('#deck-branch .gs-tree').hidden);
  check('the later slide has no panels', $('#deck-branch .gs-viz').hidden === true);

  const type = async (id, line) => {
    const input = $('#' + id + ' .gs-input');
    await waitFor(() => !input.disabled, 8000, 'input ready');
    input.value = line;
    $('#' + id + ' .gs-input-row').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => !input.disabled, 8000, line);
    await sleep(40);
  };
  const done = (id) => win.document.querySelectorAll('#' + id + ' .gs-task.is-done').length;

  for (const l of ['git init', 'echo "hi" > a.txt', 'git add .', 'git commit -m "First"']) await type('deck-repo', l);
  check('the first slide\'s tasks complete', done('deck-repo') === 2, done('deck-repo'));
  await sleep(100);
  check('the later slide sees the first slide\'s commit',
    /C0/.test($('#deck-branch .gs-tree-svg').textContent), $('#deck-branch .gs-tree-svg').textContent);

  for (const l of ['git checkout -b idea', 'echo "idea" > idea.txt', 'git add .', 'git commit -m "Idea"',
    'git checkout main', 'git merge idea']) await type('deck-branch', l);
  check('the later slide\'s tasks complete', done('deck-branch') === 3,
    $('#deck-branch .gs-tasks').textContent);
  check('the first slide follows along', /idea/.test($('#deck-repo .gs-graph').textContent),
    $('#deck-repo .gs-graph').textContent);

  check('no script errors on the page', ourErrors.length === 0, ourErrors.join('\n     '));

  console.log('\n===== RESULTS (reveal.js deck) =====');
  console.log('passed: ' + pass + '   failed: ' + fail);
  if (failures.length) {
    console.log('\nFAILURES:');
    failures.forEach(f => console.log(' - ' + f));
    process.exit(1);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
