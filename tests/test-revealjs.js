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

  // ---- a scripted slide: two reveal.js fragments per command ----
  const R = win.Reveal;
  const sid = '#deck-script';
  const steps = win.document.querySelectorAll('.gs-step[data-gs-for="deck-script"]');
  check('the filter put two fragments per scripted command beside the box', steps.length === 12, steps.length);
  check('the fragments sit outside the box', !$(sid + ' .gs-step'));
  const count = () => $(sid + ' .gs-script-count').textContent;
  const sin = $(sid + ' .gs-input');
  const echoes = () => Array.from(win.document.querySelectorAll(sid + ' .gs-echo')).map(e => e.textContent);
  check('the counter starts at [0/6]', count() === '[0/6]', count());
  const slideEl = $(sid).closest('section');
  const idx = R.getIndices(slideEl);
  R.slide(idx.h, idx.v);
  await sleep(50);
  check('arriving forwards runs nothing', echoes().length === 0 && sin.value === '', echoes().join('|'));

  R.next();
  await waitFor(() => sin.value === 'git init', 4000, 'git init to be typed');
  check('the first fragment types the first command', sin.value === 'git init' && count() === '[1/6]', count());
  check('typing leaves the keyboard to reveal.js', win.document.activeElement !== sin);
  check('nothing ran yet', echoes().length === 0);
  R.next();
  await waitFor(() => echoes().length === 1 && !sin.disabled, 4000, 'git init to run');
  check('the second fragment runs it', /git init$/.test(echoes()[0]) && sin.value === '', echoes().join('|'));
  check('running leaves the keyboard to reveal.js', win.document.activeElement !== sin);

  R.next(); R.next();
  await waitFor(() => echoes().length === 2 && !sin.disabled, 4000, 'echo to run');
  R.next();
  await waitFor(() => sin.value === 'git status', 4000, 'git status to be typed');
  check('the counter follows along', count() === '[3/6]', count());

  R.prev();
  await waitFor(() => sin.value === '' && count() === '[2/6]', 4000, 'untyping git status');
  check('stepping back un-types the command', sin.value === '');
  R.prev();
  await waitFor(() => sin.value === 'echo "# Notes" > notes.md', 4000, 'echo to come back');
  check('stepping back past a run takes it back', echoes().length === 1, echoes().join('|'));
  check('the file it made is gone again', !/notes\.md/.test($(sid + ' .gs-stages').textContent));

  // the list: hover opens it; a click jumps, Skip passes a command by
  const scriptNode = $(sid + ' .gs-script');
  scriptNode.dispatchEvent(new win.MouseEvent('mouseenter'));
  check('hovering the counter opens the list', scriptNode.classList.contains('is-open'));
  const items = win.document.querySelectorAll(sid + ' .gs-script-item');
  check('the list holds every command', items.length === 6);
  check('the list marks what ran and what is in the prompt',
    items[0].classList.contains('is-ran') && items[1].classList.contains('is-current') && items[2].classList.contains('is-next'));
  items[3].click();
  await waitFor(() => sin.value === 'git add notes.md' && !sin.disabled, 6000, 'the jump to git add');
  check('jumping runs the commands before it', echoes().length === 3, echoes().join('|'));
  check('the jump moved the deck along', R.getIndices().f === Number(steps[6].getAttribute('data-fragment-index')), JSON.stringify(R.getIndices()));
  $(sid + ' .gs-script-skip').click();
  await waitFor(() => sin.value === 'git commit -m "Start the notes"', 6000, 'the skip');
  check('skip passes the command by without running it', echoes().length === 3, echoes().join('|'));
  check('the skipped command is struck out in the list',
    win.document.querySelectorAll(sid + ' .gs-script-item')[3].classList.contains('is-skipped'));
  scriptNode.dispatchEvent(new win.MouseEvent('mouseleave'));
  check('leaving the counter closes the list', !scriptNode.classList.contains('is-open'));

  // step back to the first fragment, leave, and come back from the slide
  // after: reveal.js shows every fragment, so every command runs
  R.next();
  await waitFor(() => echoes().length === 4 && !sin.disabled, 6000, 'the commit');
  R.slide(idx.h + 1, 0);
  await sleep(50);
  R.slide(idx.h, idx.v, 0);
  await sleep(50);
  R.slide(idx.h + 1, 0);
  await sleep(50);
  R.prev();
  await waitFor(() => count() === '[6/6]' && !sin.disabled, 8000, 'arriving backwards');
  check('arriving backwards runs every command', /git log --oneline$/.test(echoes()[echoes().length - 1]), echoes().join('|'));

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
