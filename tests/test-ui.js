/* DOM-level test of the sandbox UI using jsdom. Run: node test-ui.js */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const git = require('isomorphic-git');

const dom = new JSDOM('<!doctype html><html><body><div id="box"></div></body></html>', {
  runScripts: 'outside-only', pretendToBeVisual: true
});
const win = dom.window;
win.TextEncoder = TextEncoder;
win.TextDecoder = TextDecoder;
global.window = win;
global.document = win.document;
global.navigator = win.navigator;

// expose libs the way the CDN script tags will
win.git = git;
win.Buffer = Buffer; // the shipped bundle provides this in the browser
win.GitSandboxCore = require('../src/sandbox-core.js');
win.GitSandboxTree = require('../src/sandbox-tree.js');

// evaluate the UI file in the jsdom window context
const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'sandbox-ui.js'), 'utf8');
new Function('window', 'document', uiSrc)(win, win.document);

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(label + (detail ? '\n     ' + detail : '')); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const tasks = [
    { text: 'Create a repo', check: async (c) => c.isRepo },
    { text: 'Make a commit', check: async (c) => c.graph.commits.length >= 1 },
    { text: 'Create and merge a branch', check: async (c) => c.graph.commits.length >= 3 && c.graph.head === 'main' }
  ];

  const inst = win.GitSandboxUI.mount('#box', {
    title: 'Test sandbox',
    prompt: '~/project $',
    intro: ['Welcome to the {y}sandbox{/}.'],
    hints: ['git init', 'git status'],
    tasks,
    doneNote: 'Well done.'
  });
  await sleep(120);

  const host = win.document.querySelector('#box');
  check('mounted', !!host.querySelector('.gs-out'), host.innerHTML.slice(0, 200));
  check('intro rendered with markup', /class="ty"/.test(host.querySelector('.gs-out').innerHTML),
    host.querySelector('.gs-out').innerHTML);
  check('hint buttons rendered', host.querySelectorAll('.gs-hint').length === 2);
  check('input has a type-here placeholder',
    /press Enter/.test(host.querySelector('.gs-input').getAttribute('placeholder') || ''),
    host.querySelector('.gs-input').outerHTML);
  check('empty graph message', /No commits yet/.test(host.querySelector('.gs-graph').textContent),
    host.querySelector('.gs-graph').textContent);
  check('stages render 3 columns', host.querySelectorAll('.gs-col').length === 3);
  check('diff panel prompts for init', /Nothing is tracked yet/.test(host.querySelector('.gs-diff').textContent),
    host.querySelector('.gs-diff').textContent);
  check('remote panel hidden without a remote', host.querySelector('.gs-remote').hidden === true);
  check('no state pill before init', host.querySelector('.gs-state').textContent === '',
    host.querySelector('.gs-state').innerHTML);
  check('tasks render', host.querySelectorAll('.gs-task').length === 3);
  check('task heading reads Tasks', /^Tasks/.test(host.querySelector('.gs-tasks-h').textContent),
    host.querySelector('.gs-tasks-h').textContent);
  check('first tab reads File Status',
    /^File Status/.test(host.querySelector('.gs-tab[data-tab="files"]').textContent),
    host.querySelector('.gs-tab[data-tab="files"]').textContent);
  check('0 of 3 to start', /0 of 3/.test(host.querySelector('.gs-tasks').textContent),
    host.querySelector('.gs-tasks').textContent);

  // tabs: the panels fold into one visible at a time
  const activeTab = () => host.querySelector('.gs-tab.is-active').getAttribute('data-tab');
  const panel = (n) => host.querySelector('.gs-panel[data-panel="' + n + '"]');
  const badge = (n) => host.querySelector('.gs-tab[data-tab="' + n + '"] .gs-tab-badge');
  check('files tab active by default', activeTab() === 'files');
  check('only the files panel is visible',
    panel('files').hidden === false && panel('changes').hidden === true &&
    panel('history').hidden === true && panel('remote').hidden === true);
  check('remote tab hidden without a remote',
    host.querySelector('.gs-tab[data-tab="remote"]').hidden === true);
  check('tasks sit between the terminal and the panels',
    host.querySelector('.gs-term-wrap').nextElementSibling.className.indexOf('gs-tasks') !== -1,
    host.querySelector('.gs-body').innerHTML.slice(0, 120));

  const run = async (line) => { await inst.run(line); await sleep(30); };

  await run('git init');
  check('task 1 ticks', host.querySelectorAll('.gs-task.is-done').length === 1,
    host.querySelector('.gs-tasks').textContent);
  check('prompt shows branch', /\(main\)/.test(host.querySelector('.gs-prompt').textContent),
    host.querySelector('.gs-prompt').textContent);
  await run('mkdir docs');
  await run('cd docs');
  check('prompt follows cd', host.querySelector('.gs-prompt').textContent === '~/project/docs (main) $',
    host.querySelector('.gs-prompt').textContent);
  await run('cd ..');
  check('prompt back at the root', host.querySelector('.gs-prompt').textContent === '~/project (main) $',
    host.querySelector('.gs-prompt').textContent);
  check('no state pill after init without a remote', host.querySelector('.gs-state').textContent === '',
    host.querySelector('.gs-state').innerHTML);
  check('diff panel clean after init', /clean/.test(host.querySelector('.gs-diff').textContent),
    host.querySelector('.gs-diff').textContent);

  await run('echo "# Project" > README.md');
  check('untracked chip in working dir col',
    /README\.md/.test(host.querySelectorAll('.gs-col')[0].textContent) &&
    /untracked/.test(host.querySelectorAll('.gs-col')[0].textContent),
    host.querySelectorAll('.gs-col')[0].textContent);
  check('diff panel shows new file with + line',
    /README\.md/.test(host.querySelector('.gs-diff').textContent) &&
    host.querySelectorAll('.gs-diff-add').length >= 1 &&
    /# Project/.test(host.querySelector('.gs-diff').textContent),
    host.querySelector('.gs-diff').innerHTML.slice(0, 300));

  await run('git add README.md');
  check('staged chip moves to staging col',
    /README\.md/.test(host.querySelectorAll('.gs-col')[1].textContent),
    host.querySelectorAll('.gs-col')[1].textContent);
  check('working dir col now empty',
    /empty/.test(host.querySelectorAll('.gs-col')[0].textContent),
    host.querySelectorAll('.gs-col')[0].textContent);

  await run('git commit -m "First commit"');
  check('repo col shows 1 commit',
    /1 commit/.test(host.querySelectorAll('.gs-col')[2].textContent),
    host.querySelectorAll('.gs-col')[2].textContent);
  check('graph has 1 node', host.querySelectorAll('.gs-graph circle').length === 1);
  check('diff panel clean after commit', /clean/.test(host.querySelector('.gs-diff').textContent),
    host.querySelector('.gs-diff').textContent);
  check('graph shows HEAD ref', /HEAD → main/.test(host.querySelector('.gs-graph').textContent),
    host.querySelector('.gs-graph').textContent);
  check('task 2 ticks', host.querySelectorAll('.gs-task.is-done').length === 2);
  check('a just-ticked task flashes', host.querySelectorAll('.gs-task.is-just-done').length === 1,
    host.querySelector('.gs-tasks').innerHTML);
  check('git commit stays on the files tab', activeTab() === 'files');
  check('history badge counts commits', badge('history').textContent === '1',
    badge('history').outerHTML);

  const workCol = () => host.querySelectorAll('.gs-col')[0];
  check('committed file shows as unchanged chip in working dir',
    /README\.md/.test(workCol().textContent) &&
    workCol().querySelectorAll('.gs-chip-clean').length === 1,
    workCol().innerHTML);

  await run('echo "edited" > README.md');
  check('editing swaps unchanged chip for modified',
    /modified/.test(workCol().textContent) &&
    workCol().querySelectorAll('.gs-chip-clean').length === 0,
    workCol().innerHTML);

  await run('echo "# Project" > README.md');
  check('restoring committed content brings the unchanged chip back',
    workCol().querySelectorAll('.gs-chip-clean').length === 1,
    workCol().innerHTML);

  await run('git checkout -b feature');
  await run('echo "feature" > feature.txt');
  await run('git add .');
  await run('git commit -m "Feature work"');
  await run('git checkout main');
  await run('echo "fix" > fix.txt');
  await run('git add .');
  await run('git commit -m "Hotfix"');
  await run('git merge feature');

  check('graph has 4 nodes', host.querySelectorAll('.gs-graph circle').length === 4,
    'got ' + host.querySelectorAll('.gs-graph circle').length);
  check('graph has curved edges', host.querySelectorAll('.gs-graph path').length >= 4,
    'got ' + host.querySelectorAll('.gs-graph path').length);
  check('all tasks done', host.querySelectorAll('.gs-task.is-done').length === 3,
    host.querySelector('.gs-tasks').textContent);
  check('done note appears', /Well done/.test(host.querySelector('.gs-tasks').textContent));
  check('flash class is not re-applied on later renders',
    host.querySelectorAll('.gs-task.is-just-done').length <= 1,
    host.querySelector('.gs-tasks').innerHTML);
  check('files badge shows clean check after merge', badge('files').textContent === '✓',
    badge('files').outerHTML);
  check('changes badge shows clean check', badge('changes').textContent === '✓',
    badge('changes').outerHTML);
  check('history badge counts all commits', badge('history').textContent === '4',
    badge('history').outerHTML);

  // manual tab click holds; a shell edit pulls focus back to files
  host.querySelector('.gs-tab[data-tab="changes"]').dispatchEvent(new win.Event('click'));
  check('clicking a tab selects it', activeTab() === 'changes' && panel('changes').hidden === false);
  await run('echo "tweak" > fix.txt');
  check('editing a file auto-switches to files', activeTab() === 'files');
  check('files badge counts the modified file', badge('files').textContent === '1',
    badge('files').outerHTML);
  await run('git checkout fix.txt');

  // the remote tab appears once origin exists
  await run('git remote add origin https://example.com/demo.git');
  check('remote tab appears with a remote',
    host.querySelector('.gs-tab[data-tab="remote"]').hidden === false);
  check('git remote auto-switches to the remote tab', activeTab() === 'remote');

  // undo: full time travel over the last state-changing command
  check('undo button enabled once something is undoable',
    host.querySelector('.gs-undo').disabled === false);
  await run('undo');
  check('undo removes the remote again',
    host.querySelector('.gs-tab[data-tab="remote"]').hidden === true);
  check('undo falls back off the vanished remote tab', activeTab() === 'files');
  check('the undone command vanishes from the terminal echo',
    !Array.from(host.querySelectorAll('.gs-line.gs-echo'))
      .some((l) => /remote add/.test(l.textContent)),
    host.querySelector('.gs-out').textContent.slice(-300));
  check('undo confirms what it undid',
    /Undid: git remote add/.test(host.querySelector('.gs-out').textContent),
    host.querySelector('.gs-out').textContent.slice(-200));

  const vb = host.querySelector('.gs-graph').getAttribute('viewBox');
  check('viewBox set', /^0 0 \d+ \d+$/.test(vb), vb);

  // error path
  await run('git frobnicate');
  const lines = host.querySelectorAll('.gs-line');
  check('error line styled', host.querySelectorAll('.gs-line.gs-err').length >= 1);

  // help + clear
  await run('help');
  check('help printed', /isomorphic-git/.test(host.querySelector('.gs-out').textContent));
  await run('clear');
  check('clear empties terminal', host.querySelector('.gs-out').children.length === 0,
    String(host.querySelector('.gs-out').children.length));

  // reset button
  host.querySelector('.gs-reset').dispatchEvent(new win.Event('click'));
  await sleep(150);
  check('reset clears graph', /No commits yet/.test(host.querySelector('.gs-graph').textContent),
    host.querySelector('.gs-graph').textContent);
  check('reset unticks tasks', host.querySelectorAll('.gs-task.is-done').length === 0,
    host.querySelector('.gs-tasks').textContent);
  check('reset restores intro', /sandbox/.test(host.querySelector('.gs-out').textContent));
  check('reset clears the state pill', host.querySelector('.gs-state').textContent === '',
    host.querySelector('.gs-state').innerHTML);
  check('reset returns to the files tab', activeTab() === 'files');
  check('reset hides the remote tab again',
    host.querySelector('.gs-tab[data-tab="remote"]').hidden === true);
  check('reset empties the undo stack', host.querySelector('.gs-undo').disabled === true);
  await run('undo');
  check('undo with nothing to undo says so',
    /Nothing to undo/.test(host.querySelector('.gs-out').textContent),
    host.querySelector('.gs-out').textContent.slice(-200));

  // pre-init files are just files, not "untracked"
  await run('echo hi > pre.txt');
  check('pre-init file renders as grey "not in git yet" chip',
    /pre\.txt/.test(workCol().textContent) &&
    /not in git yet/.test(workCol().textContent) &&
    !/untracked/.test(workCol().textContent) &&
    workCol().querySelectorAll('.gs-chip-clean').length === 1,
    workCol().innerHTML);

  // rebuild a graph and dump the SVG for visual inspection
  await run('git init');
  check('pre-init file becomes untracked once a repo exists',
    /untracked/.test(workCol().textContent) &&
    workCol().querySelectorAll('.gs-chip-clean').length === 0,
    workCol().innerHTML);

  // undo restores task ticks along with the repo
  check('git init ticks the repo task again', host.querySelectorAll('.gs-task.is-done').length === 1);
  await run('undo');
  check('undo reverses git init', !/\(main\)/.test(host.querySelector('.gs-prompt').textContent),
    host.querySelector('.gs-prompt').textContent);
  check('undo unticks the task git init had ticked',
    host.querySelectorAll('.gs-task.is-done').length === 0,
    host.querySelector('.gs-tasks').textContent);
  await run('git init');
  await run('echo a > a.txt'); await run('git add .'); await run('git commit -m "Add the project README"');
  await run('echo b > b.txt'); await run('git add .'); await run('git commit -m "Set up the data folder"');
  await run('git checkout -b analysis');
  await run('echo c > c.txt'); await run('git add .'); await run('git commit -m "Draft the regression model"');
  await run('git checkout main');
  await run('echo d > d.txt'); await run('git add .'); await run('git commit -m "Fix a typo in the README"');
  await run('git merge analysis');

  await run('git remote add origin https://example.com/demo.git');
  check('state shows origin pill once a remote exists',
    /origin/.test(host.querySelector('.gs-state').textContent),
    host.querySelector('.gs-state').innerHTML);

  // workspace title bar: Terminal and Editor tabs over the dark pane
  const view = () => host.querySelector('.gs-wtab.is-active').getAttribute('data-view');
  const pane = (n) => host.querySelector('.gs-view[data-view="' + n + '"]');
  const click = (n) => n.dispatchEvent(new win.Event('click', { bubbles: true }));
  const fileBtn = (f) => host.querySelector('.gs-fb-file[data-file="' + f + '"]');
  const edText = host.querySelector('.gs-ed-text');
  const type = (text) => { edText.value = text; edText.dispatchEvent(new win.Event('input')); };
  check('title bar has Terminal and Editor tabs',
    host.querySelectorAll('.gs-titlebar .gs-wtab').length === 2 &&
    host.querySelector('.gs-titlebar').getAttribute('role') === 'tablist');
  check('the tabs live in the exercise title bar, before the title',
    host.querySelector('.gs-head > .gs-titlebar') !== null &&
    host.querySelector('.gs-titlebar').nextElementSibling.classList.contains('gs-eyebrow'));
  check('terminal view shows by default', view() === 'terminal' &&
    pane('terminal').hidden === false && pane('editor').hidden === true);
  click(host.querySelector('.gs-wtab[data-view="editor"]'));
  check('clicking Editor swaps the views', view() === 'editor' &&
    pane('terminal').hidden === true && pane('editor').hidden === false &&
    host.querySelector('.gs-wtab[data-view="editor"]').getAttribute('aria-selected') === 'true');
  check('file browser lists the working directory',
    ['a.txt', 'b.txt', 'c.txt', 'd.txt'].every((f) => !!fileBtn(f)),
    host.querySelector('.gs-fb-list').innerHTML);
  check('editor prompts to pick a file', edText.hidden === true &&
    /Pick a file/.test(host.querySelector('.gs-ed-empty').textContent));

  click(fileBtn('a.txt')); await sleep(30);
  check('clicking a file opens it', edText.hidden === false && edText.value === 'a\n' &&
    host.querySelector('.gs-ed-name').textContent === 'a.txt' &&
    fileBtn('a.txt').classList.contains('is-open'), JSON.stringify(edText.value));
  check('save is disabled while nothing changed', host.querySelector('.gs-ed-save').disabled === true);

  type('a\nmore\n');
  check('typing marks the file unsaved',
    host.querySelector('.gs-ed-save').disabled === false &&
    !!fileBtn('a.txt').querySelector('.gs-fb-dirty') &&
    host.querySelector('.gs-wtab-dirty').hidden === false);
  check('an unsaved edit does not reach the working directory',
    badge('files').textContent === '✓', badge('files').outerHTML);

  click(fileBtn('b.txt')); await sleep(30);
  check('switching files keeps the draft', edText.value === 'b\n' && !!fileBtn('a.txt').querySelector('.gs-fb-dirty'));
  click(fileBtn('a.txt')); await sleep(30);
  check('the draft comes back', edText.value === 'a\nmore\n', JSON.stringify(edText.value));

  click(host.querySelector('.gs-ed-save')); await sleep(60);
  check('save writes the working directory',
    (await inst.sandbox.readFile('a.txt')) === 'a\nmore\n');
  check('saved file shows as modified in git terms',
    badge('files').textContent === '1' &&
    /M/.test(fileBtn('a.txt').querySelector('.gs-fb-mark').textContent),
    fileBtn('a.txt').outerHTML);
  check('saving clears the unsaved markers',
    !fileBtn('a.txt').querySelector('.gs-fb-dirty') &&
    host.querySelector('.gs-wtab-dirty').hidden === true &&
    /saved/.test(host.querySelector('.gs-ed-status').textContent));
  check('a save is undoable', host.querySelector('.gs-undo').disabled === false);

  click(host.querySelector('.gs-undo')); await sleep(60);
  check('undo reverts the save, and the open editor follows',
    edText.value === 'a\n' && badge('files').textContent === '✓', JSON.stringify(edText.value));
  check('undo names the save', /Undid: save a\.txt/.test(host.querySelector('.gs-out').textContent));

  type('changed\n');
  click(host.querySelector('.gs-ed-revert'));
  check('revert drops the draft', edText.value === 'a\n' &&
    host.querySelector('.gs-wtab-dirty').hidden === true);

  // a terminal command that rewrites the open file updates the editor
  await run('echo fresh > a.txt');
  check('editor reloads a file changed from the terminal', edText.value === 'fresh\n',
    JSON.stringify(edText.value));
  await run('echo a > a.txt');

  // new files, including in a folder that does not exist yet
  click(host.querySelector('.gs-fb-new'));
  const nameIn = host.querySelector('.gs-fb-name');
  check('+ New reveals a name field', host.querySelector('.gs-fb-create').hidden === false);
  nameIn.value = '../escape.txt';
  host.querySelector('.gs-fb-create').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await sleep(30);
  check('a name outside the project is refused in place',
    /inside the project/.test(host.querySelector('.gs-fb-err').textContent),
    host.querySelector('.gs-fb-err').textContent);
  nameIn.value = 'notes/todo.md';
  host.querySelector('.gs-fb-create').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await sleep(60);
  check('a new file is created and opened', !!fileBtn('notes/todo.md') &&
    host.querySelector('.gs-ed-name').textContent === 'notes/todo.md' &&
    /U/.test(fileBtn('notes/todo.md').querySelector('.gs-fb-mark').textContent),
    host.querySelector('.gs-fb-list').innerHTML);
  type('- write tests\n');
  edText.dispatchEvent(new win.KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }));
  await sleep(60);
  check('Ctrl+S saves', (await inst.sandbox.readFile('notes/todo.md')) === '- write tests\n');
  await run('git add .');
  check('the saved file stages from the terminal',
    /A/.test(fileBtn('notes/todo.md').querySelector('.gs-fb-mark').textContent),
    fileBtn('notes/todo.md').outerHTML);
  await run('git rm notes/todo.md');
  check('a deleted open file closes the editor', edText.hidden === true && !fileBtn('notes/todo.md'));

  // the browser is a tree rooted at the working directory
  const fbTitle = () => host.querySelector('.gs-fb-title').textContent;
  const folder = (k) => host.querySelector('.gs-fb-folder[data-dir="' + k + '"]');
  check('browser header shows the working directory name only', fbTitle() === 'project', fbTitle());
  await run('mkdir data/raw');
  await run('echo x > data/raw/q3.csv');
  await run('mkdir empty');
  click(folder('notes')); // close the folder the new file opened
  check('folders list before files, each with a chevron, collapsed',
    !!folder('data') && folder('data').getAttribute('aria-expanded') === 'false' &&
    !!folder('data').querySelector('.gs-fb-chev svg') && !fileBtn('data/raw/q3.csv') &&
    host.querySelector('.gs-fb-row').classList.contains('gs-fb-folder'),
    host.querySelector('.gs-fb-list').innerHTML.slice(0, 400));
  check('a folder with changes inside says so', !!folder('data').querySelector('.gs-fb-changed'));
  click(folder('data'));
  check('a chevron click shows the children', folder('data').getAttribute('aria-expanded') === 'true' &&
    !!folder('data/raw') && !fileBtn('data/raw/q3.csv'));
  click(folder('data/raw'));
  check('nested folders expand too', !!fileBtn('data/raw/q3.csv'));
  check('nested rows are indented deeper',
    parseInt(fileBtn('data/raw/q3.csv').style.paddingLeft, 10) > parseInt(folder('data/raw').style.paddingLeft, 10) &&
    parseInt(folder('data/raw').style.paddingLeft, 10) > parseInt(folder('data').style.paddingLeft, 10));
  click(folder('empty'));
  check('an empty folder says so', /empty/.test(folder('empty').parentNode.textContent));
  click(folder('data'));
  check('collapsing hides the subtree', !folder('data/raw'));

  // hidden files
  check('hidden files are off by default', !folder('.git'));
  const hiddenToggle = host.querySelector('.gs-fb-foot .gs-fb-hidden');
  check('the hidden-files toggle sits at the foot of the sidebar',
    !!hiddenToggle && host.querySelector('.gs-fb').lastElementChild.classList.contains('gs-fb-foot'));
  hiddenToggle.checked = true; hiddenToggle.dispatchEvent(new win.Event('change'));
  check('the toggle reveals .git', !!folder('.git'));
  click(folder('.git'));
  click(fileBtn('.git/HEAD')); await sleep(30);
  check('.git files open read-only', edText.readOnly === true && /ref: refs\/heads\/main/.test(edText.value) &&
    /read-only/.test(host.querySelector('.gs-ed-status').textContent),
    host.querySelector('.gs-ed-status').textContent);
  hiddenToggle.checked = false; hiddenToggle.dispatchEvent(new win.Event('change'));
  check('turning it off hides them again', !folder('.git'));

  // moving up from the working directory
  check('home button hidden at the working directory', host.querySelector('.gs-fb-home').hidden === true);
  click(host.querySelector('.gs-fb-up'));
  check('up shows the parent folder by name', fbTitle() === '~', fbTitle());
  check('the working directory shows inside it, open and labelled WD',
    folder('../1') && folder('../1').getAttribute('aria-expanded') === 'true' &&
    !!folder('../1').querySelector('.gs-fb-wd') &&
    folder('../1').querySelector('.gs-fb-wd').textContent === 'WD' && !!fileBtn('a.txt'));
  check('cannot go above the top of the prompt path', host.querySelector('.gs-fb-up').disabled === true);
  click(host.querySelector('.gs-fb-home'));
  check('home returns to the working directory', fbTitle() === 'project' && !folder('../1'));

  // the browser follows `cd`; paths stay project-relative underneath
  click(fileBtn('a.txt')); await sleep(30);
  await run('cd data');
  check('cd re-roots the browser at the new working directory', fbTitle() === 'data' &&
    !!folder('data/raw') && !fileBtn('a.txt') && host.querySelector('.gs-fb-home').hidden === true,
    fbTitle() + ' ' + host.querySelector('.gs-fb-list').innerHTML.slice(0, 200));
  type('a\nfrom data\n');
  click(host.querySelector('.gs-ed-save')); await sleep(60);
  check('saving after cd writes the file it opened, not one relative to cwd',
    (await inst.sandbox.readFile('a.txt')) === 'a\nfrom data\n' &&
    !(await inst.sandbox.listTree()).some((e) => e.path === 'data/a.txt'));
  click(host.querySelector('.gs-fb-up'));
  check('up from a subfolder shows the real parent, with WD on the subfolder',
    fbTitle() === 'project' && !!fileBtn('a.txt') &&
    !!folder('data').querySelector('.gs-fb-wd') && folder('data').getAttribute('aria-expanded') === 'true');
  click(host.querySelector('.gs-fb-up'));
  check('then on above the project', fbTitle() === '~' && !!folder('../1') && !!folder('data').querySelector('.gs-fb-wd'));
  click(host.querySelector('.gs-fb-home'));
  check('home returns to the subfolder', fbTitle() === 'data');
  click(host.querySelector('.gs-fb-new'));
  nameIn.value = 'q4.csv';
  host.querySelector('.gs-fb-create').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await sleep(60);
  check('new files are named from the working directory, like touch',
    host.querySelector('.gs-ed-name').textContent === 'data/q4.csv' && !!fileBtn('data/q4.csv'),
    host.querySelector('.gs-ed-name').textContent);
  click(host.querySelector('.gs-fb-new'));
  nameIn.value = '../../out.txt';
  host.querySelector('.gs-fb-create').dispatchEvent(new win.Event('submit', { cancelable: true }));
  await sleep(30);
  check('..-paths that leave the project are refused',
    /inside the project/.test(host.querySelector('.gs-fb-err').textContent));
  host.querySelector('.gs-fb-name').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
  await run('cd ..');
  check('cd .. follows back to the top', fbTitle() === 'project' && !!folder('data').querySelector('.gs-fb-wd') === false);

  click(host.querySelector('.gs-wtab[data-view="terminal"]'));
  check('clicking Terminal swaps back', view() === 'terminal' && pane('editor').hidden === true);

  /* ---------------- vim: git commit without -m ---------------- */
  {
    const box3 = win.document.createElement('div');
    box3.id = 'vimbox';
    win.document.body.appendChild(box3);
    const v = win.GitSandboxUI.mount('#vimbox', { seed: 'git init\necho a > a.txt\ngit add .' });
    await v.ready;
    const vimNode = box3.querySelector('.gs-vim');
    const text = box3.querySelector('.gs-vim-text');
    const status = () => box3.querySelector('.gs-vim-status').textContent;
    const key = (k, opts) => {
      const e = new win.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {}));
      text.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const keys = (s) => s.split('').forEach((k) => key(k));
    const commits = async () => (await v.sandbox.graphModel()).commits.length;

    let pending = v.run('git commit');
    await sleep(60);
    check('vim opens over the terminal', !vimNode.hidden && box3.querySelector('.gs-out').hidden &&
      box3.querySelector('.gs-input-row').hidden);
    check('vim shows the template', /# Please enter the commit message/.test(text.value), text.value);
    check('vim names the file', /"\.git\/COMMIT_EDITMSG" \d+L, \d+B/.test(status()), status());
    check('normal mode swallows typing', key('q') === true && text.value.indexOf('q') !== 0);
    key('c', { ctrlKey: true });
    check('ctrl-c says how to really quit', /:qa!/.test(status()), status());
    keys(':q');
    check('command line echoes', status() === ':q', status());
    key('Escape');
    check('Esc cancels the command line', status() === '' && !vimNode.hidden, status());
    keys(':wat'); key('Enter');
    check('unknown command is E492', /E492: Not an editor command: wat/.test(status()), status());

    key('i');
    check('i enters insert mode', status() === '-- INSERT --' && vimNode.classList.contains('is-insert'), status());
    check('insert mode lets keys through', key('x') === false);
    text.value = 'First line from vim' + text.value;
    key('Escape');
    check('Esc leaves insert mode', status() === '' && !vimNode.classList.contains('is-insert'), status());
    keys(':q'); key('Enter');
    check(':q with changes is E37', /E37: No write since last change/.test(status()) && !vimNode.hidden, status());
    keys(':wq'); key('Enter');
    await pending; await sleep(30);
    check(':wq closes vim', vimNode.hidden && !box3.querySelector('.gs-out').hidden && !box3.querySelector('.gs-input-row').hidden);
    check(':wq commits', (await commits()) === 1);
    check('commit summary printed', /\[main [0-9a-f]{7}\] First line from vim/.test(box3.querySelector('.gs-out').textContent),
      box3.querySelector('.gs-out').textContent.slice(-200));
    check('vim commit can be undone', box3.querySelector('.gs-undo').disabled === false);

    await v.run('echo b > b.txt'); await v.run('git add .');
    pending = v.run('git commit');
    await sleep(60);
    key('o');
    text.value = text.value + 'never saved';
    key('Escape');
    keys(':q!'); key('Enter');
    await pending; await sleep(30);
    check(':q! aborts the commit', (await commits()) === 1 &&
      /Aborting commit due to empty commit message/.test(box3.querySelector('.gs-out').textContent));

    pending = v.run('git commit');
    await sleep(60);
    key('i'); text.value = 'Via ZZ\n' + text.value; key('Escape');
    keys('ZZ');
    await pending; await sleep(30);
    check('ZZ saves and commits', (await commits()) === 2);

    await v.run('echo c > c.txt'); await v.run('git add .');
    pending = v.run('git commit');
    await sleep(60);
    box3.querySelector('.gs-reset').dispatchEvent(new win.Event('click'));
    await pending; await sleep(200);
    check('reset closes vim', vimNode.hidden && !box3.querySelector('.gs-input-row').hidden);
    check('input usable after reset', box3.querySelector('.gs-input').disabled === false);
    await v.run('echo d > d.txt');
    check('commands run after reset', /d\.txt/.test(box3.querySelector('.gs-stages').textContent));

    const bad = win.document.createElement('div');
    bad.id = 'vimseed';
    win.document.body.appendChild(bad);
    const b = win.GitSandboxUI.mount('#vimseed', { seed: 'git init\necho a > a.txt\ngit add .\ngit commit' });
    await b.ready;
    check('a seed that opens vim fails loudly', /opened an editor/.test(bad.querySelector('.gs-out').textContent),
      bad.querySelector('.gs-out').textContent);
  }

  /* ---------------- commit contents in the History view ---------------- */
  {
    const box = win.document.createElement('div');
    box.id = 'cdbox';
    win.document.body.appendChild(box);
    const h = win.GitSandboxUI.mount('#cdbox', {
      seed: 'git init\necho "hello" > a.txt\ngit add .\ngit commit -m "First"\necho "world" >> a.txt\n' +
        'echo "<b>" > tag.txt\ngit add .\ngit commit -m "Second line" -m "With a body"'
    });
    await h.ready;
    const toggles = () => box.querySelectorAll('.gs-graph .gs-cd-toggle');
    check('every history row has a contents toggle', toggles().length === 2, toggles().length);
    check('toggles are keyboard buttons', Array.from(toggles()).every(t =>
      t.getAttribute('role') === 'button' && t.getAttribute('tabindex') === '0' &&
      t.getAttribute('aria-expanded') === 'false' && /Show the contents of commit [0-9a-f]{7}/.test(t.getAttribute('aria-label'))));
    check('nothing open to begin with', box.querySelectorAll('.gs-cd').length === 0);
    const svgH = () => Number(box.querySelector('.gs-graph').getAttribute('height'));
    const closedH = svgH();
    toggles()[0].dispatchEvent(new win.Event('click'));
    await sleep(60);
    const cd = box.querySelector('.gs-cd');
    check('clicking the toggle opens the commit', !!cd);
    check('details show the message, files and a diff',
      !!cd && /Second line/.test(cd.textContent) && /a\.txt/.test(cd.textContent) && /tag\.txt/.test(cd.textContent) &&
      cd.querySelectorAll('.gs-diff-add').length === 2, cd ? cd.textContent : '');
    check('file text is escaped', !!cd && !cd.querySelector('b') && /<b>/.test(cd.textContent));
    check('details show the full hash', !!cd && /[0-9a-f]{40}/.test(cd.querySelector('.gs-cd-oid').textContent));
    check('the graph makes room for the details', svgH() > closedH, svgH() + ' vs ' + closedH);
    check('the toggle says it is open', toggles()[0].getAttribute('aria-expanded') === 'true' &&
      /Hide the contents/.test(toggles()[0].getAttribute('aria-label')));
    check('details sit below their row', parseFloat(cd.style.top) > 20, cd.style.top);

    toggles()[1].dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(60);
    check('Enter opens a second commit', box.querySelectorAll('.gs-cd').length === 2);
    check('the first commit says it is the first', /first commit/.test(box.querySelectorAll('.gs-cd')[1].textContent));
    await h.run('echo "more" > b.txt');
    check('open commits stay open across commands', box.querySelectorAll('.gs-cd').length === 2);
    toggles()[0].dispatchEvent(new win.Event('click'));
    await sleep(30);
    check('clicking again closes it', box.querySelectorAll('.gs-cd').length === 1);
    await h.run('reset');
    check('reset closes everything', box.querySelectorAll('.gs-cd').length === 0);
    check('remote graphs have no toggles', box.querySelectorAll('.gs-remote-graph .gs-cd-toggle').length === 0);
  }

  /* ---------------- File Status animations ---------------- */
  {
    // jsdom has no layout and no Web Animations API, so stand in for both:
    // a chip's x comes from its column, its y from its place in the column.
    const proto = win.Element.prototype;
    const realRect = proto.getBoundingClientRect;
    const calls = [];
    const colX = { work: 0, stage: 200, repo: 400 };
    proto.getBoundingClientRect = function () {
      if (this.classList.contains('gs-stages')) return { left: 0, top: 0, width: 600, height: 200 };
      const col = this.getAttribute('data-col');
      if (col) {
        const i = Array.prototype.indexOf.call(this.parentNode.children, this);
        return { left: colX[col], top: 30 * i, width: 120, height: 24 };
      }
      return realRect.call(this);
    };
    proto.animate = function (frames, opts) {
      calls.push({ el: this, frames, opts });
      return { onfinish: null };
    };
    const box = win.document.createElement('div');
    box.id = 'animbox';
    win.document.body.appendChild(box);
    const a = win.GitSandboxUI.mount('#animbox', { seed: 'git init\necho a > a.txt' });
    await a.ready;
    check('no animation for the first drawing', calls.length === 0, calls.length);
    await a.run('git add a.txt');
    const moved = calls.find(c => c.el.getAttribute && c.el.getAttribute('data-col') === 'stage' &&
      c.el.getAttribute('data-file') === 'a.txt');
    check('git add glides the chip from the working directory to staging',
      !!moved && /translate\(-200px/.test(moved.frames[0].transform), JSON.stringify(calls.map(c => c.frames)));
    calls.length = 0;
    await a.run('git commit -m one');
    check('git commit stays on File Status', box.querySelector('.gs-tab.is-active').getAttribute('data-tab') === 'files');
    const ghost = calls.find(c => c.el.classList && c.el.classList.contains('gs-chip-ghost'));
    check('git commit flies the staged chip into the repository',
      !!ghost && /translate\(200px/.test(ghost.frames[2].transform) && ghost.frames[2].opacity === 0,
      JSON.stringify(calls.map(c => c.frames)));
    check('the ghost is a copy of the staged chip', !!ghost && /a\.txt/.test(ghost.el.textContent));
    calls.length = 0;
    await a.run('reset');
    check('no animation after a reset', calls.length === 0, calls.length);
    delete proto.animate;
    proto.getBoundingClientRect = realRect;
  }

  /* ---------------- merge conflicts ---------------- */
  {
    const box = win.document.createElement('div');
    box.id = 'conflictbox';
    win.document.body.appendChild(box);
    // the seed ends on the conflicting merge, as a lesson might
    const c = win.GitSandboxUI.mount('#conflictbox', {
      seed: 'git init\necho base > f.txt\ngit add .\ngit commit -m one\ngit checkout -b feat\n' +
        'echo theirs > f.txt\ngit add .\ngit commit -m feat\ngit checkout main\necho ours > f.txt\n' +
        'git add .\ngit commit -m mine\ngit merge feat',
      tasks: [{ text: 'Resolve it', check: (ctx) => win.GitSandboxUI.isMerged(ctx.graph, 'feat', 'main') }]
    });
    await c.ready;
    const prompt = () => box.querySelector('.gs-prompt').textContent;
    check('a seed may end on a conflict', !/could not be set up/.test(box.querySelector('.gs-out').textContent),
      box.querySelector('.gs-out').textContent);
    check('prompt shows MERGING', prompt() === '~/project (main|MERGING) $', prompt());
    const chip = box.querySelector('.gs-chip-conflict');
    check('conflicted file chip in the working directory', !!chip && /f\.txt/.test(chip.textContent) &&
      /conflict: both modified/.test(chip.textContent), box.querySelector('.gs-stages').textContent);
    check('files badge counts the conflict',
      box.querySelector('.gs-tab[data-tab="files"] .gs-tab-badge').textContent === '1');
    check('file browser marks the conflict', !!box.querySelector('.gs-fb-mark-conflict'));

    await c.run('git merge --abort');
    check('abort clears MERGING from the prompt', prompt() === '~/project (main) $', prompt());
    await c.run('git merge feat');
    check('conflicting merge typed by the learner', /CONFLICT/.test(box.querySelector('.gs-out').textContent));
    await c.run('undo');
    check('a conflicting merge can be undone', prompt() === '~/project (main) $', prompt());
    await c.run('git merge feat');
    await c.run('echo both > f.txt');
    await c.run('git add f.txt');
    check('resolved file leaves the conflict list', !box.querySelector('.gs-chip-conflict'));
    check('still merging until the commit', /MERGING/.test(prompt()), prompt());
    await c.run('git commit -m "Merge feat"');
    check('merge concluded', prompt() === '~/project (main) $', prompt());
    check('resolving counts as merging feat into main', box.querySelectorAll('.gs-task.is-done').length === 1,
      box.querySelector('.gs-tasks').textContent);
  }

  /* ---------------- commit tree (tree-view option) ---------------- */
  check('by default the commit tree is closed behind a header button',
    host.querySelector('.gs-tree').hidden === true && !host.classList.contains('gs-has-tree') &&
    host.querySelector('.gs-head .gs-tree-btn').getAttribute('aria-pressed') === 'false');
  host.querySelector('.gs-tree-btn').dispatchEvent(new win.Event('click'));
  check('the header button opens the tree', host.querySelector('.gs-tree').hidden === false &&
    host.classList.contains('gs-has-tree') && host.querySelector('.gs-tree-btn').getAttribute('aria-pressed') === 'true');
  check('an opened tree already shows the history', host.querySelectorAll('.gs-tree-node').length >= 1,
    host.querySelectorAll('.gs-tree-node').length);
  host.querySelector('.gs-tree-btn').dispatchEvent(new win.Event('click'));
  check('and closes it again', host.querySelector('.gs-tree').hidden === true && !host.classList.contains('gs-has-tree'));

  /* ---------------- configurability ---------------- */
  {
    const mk = async (id, cfg) => {
      const b = win.document.createElement('div');
      b.id = id;
      win.document.body.appendChild(b);
      const inst = win.GitSandboxUI.mount('#' + id, cfg);
      await inst.ready;
      return { b, inst };
    };

    let { b } = await mk('cfg-tree-off', { treeView: false });
    check('tree-view: false leaves no tree and no button', !b.querySelector('.gs-tree') && !b.querySelector('.gs-tree-btn'));
    ({ b } = await mk('cfg-tree-on', { treeView: true }));
    check('tree-view: true shows the tree with no button',
      b.querySelector('.gs-tree').hidden === false && b.classList.contains('gs-has-tree') && !b.querySelector('.gs-tree-btn'));

    ({ b } = await mk('cfg-no-editor', { editor: false }));
    check('editor: false removes the workspace tabs', !b.querySelector('.gs-titlebar') && !b.querySelector('.gs-wtab'));
    check('editor: false keeps the editor out of sight', b.querySelector('.gs-view-editor').hidden === true);
    check('editor: false keeps the terminal', b.querySelector('.gs-view[data-view="terminal"]').hidden === false);
    let r = await mk('cfg-no-editor-help', { editor: false });
    await r.inst.run('help');
    check('help leaves out the Editor tab when it is off', !/Editor/.test(r.b.querySelector('.gs-out').textContent));

    ({ b } = await mk('cfg-panels-off', { panels: false }));
    check('panels: false hides the views', b.querySelector('.gs-viz').hidden === true);
    check('panels: false still shows tasks', !!b.querySelector('.gs-tasks'));

    r = await mk('cfg-panels-on', { panels: true });
    check('panels: true has no fold button', !r.b.querySelector('.gs-viz-toggle'));

    r = await mk('cfg-panels-toggle', {});
    const vt = r.b.querySelector('.gs-viz-toggle');
    const pnl = (n) => r.b.querySelector('.gs-panel[data-panel="' + n + '"]');
    check('panels default to open with a fold button', !!vt && vt.getAttribute('aria-expanded') === 'true' && pnl('files').hidden === false);
    vt.dispatchEvent(new win.Event('click'));
    check('the fold button hides every panel', vt.getAttribute('aria-expanded') === 'false' &&
      ['files', 'changes', 'history', 'remote'].every(n => pnl(n).hidden) &&
      r.b.querySelector('.gs-viz').classList.contains('is-folded'));
    await r.inst.run('git init');
    await r.inst.run('echo a > a.txt');
    await r.inst.run('git add .');
    await r.inst.run('git commit -m one');
    check('commands do not unfold the panels', pnl('files').hidden === true);
    check('badges still update while folded',
      r.b.querySelector('.gs-tab[data-tab="history"] .gs-tab-badge').textContent === '1');
    r.b.querySelector('.gs-tab[data-tab="history"]').dispatchEvent(new win.Event('click'));
    check('clicking a tab unfolds onto that panel', pnl('history').hidden === false && vt.getAttribute('aria-expanded') === 'true');

    r = await mk('cfg-tabs', { panelTabs: ['history', 'changes'] });
    const shown = Array.from(r.b.querySelectorAll('.gs-tab')).filter(t => !t.hidden).map(t => t.getAttribute('data-tab'));
    check('panel-tabs picks the panels', JSON.stringify(shown) === '["changes","history"]', JSON.stringify(shown));
    check('the first chosen panel is open', r.b.querySelector('.gs-tab.is-active').getAttribute('data-tab') === 'changes' &&
      r.b.querySelector('.gs-panel[data-panel="changes"]').hidden === false &&
      r.b.querySelector('.gs-panel[data-panel="files"]').hidden === true);
    await r.inst.run('git init');
    await r.inst.run('echo a > a.txt');
    check('a command cannot open a left-out panel', r.b.querySelector('.gs-panel[data-panel="files"]').hidden === true &&
      r.b.querySelector('.gs-tab.is-active').getAttribute('data-tab') === 'changes');
    await r.inst.run('git remote add origin https://example.com/x.git');
    check('Remote stays away when not chosen', r.b.querySelector('.gs-tab[data-tab="remote"]').hidden === true);

    r = await mk('cfg-tabs-none', { panelTabs: [] });
    check('an empty panel-tabs hides the views', r.b.querySelector('.gs-viz').hidden === true);
  }
  {
    const box2 = win.document.createElement('div');
    box2.id = 'treebox';
    win.document.body.appendChild(box2);
    const t = win.GitSandboxUI.mount('#treebox', {
      title: 'Tree', treeView: true,
      seed: 'git init\necho a > a.txt\ngit add .\ngit commit -m "one"\necho b > b.txt\ngit add .\ngit commit -m "two"'
    });
    await t.ready;
    const tr = (line) => t.run(line).then(() => sleep(30));
    const nodeText = () => Array.from(box2.querySelectorAll('.gs-tree-node .gs-tree-c')).map(n => n.textContent).sort();
    const refText = (name) => {
      const g = box2.querySelector('.gs-tree-ref[data-ref="' + name + '"]');
      return g ? g.querySelector('text').textContent : null;
    };
    const nodeOf = (oid) => box2.querySelector('.gs-tree-node[data-oid="' + oid + '"]');
    const graph = async () => t.sandbox.graphModel();

    check('tree pane present when tree-view is on',
      !!box2.querySelector('.gs-tree .gs-tree-svg') && box2.classList.contains('gs-has-tree'));
    check('tree pane is not an <aside> (Quarto sends those to the margin)',
      box2.querySelector('.gs-tree').tagName === 'DIV' &&
      box2.querySelector('.gs-tree').getAttribute('role') === 'complementary');
    check('seeded commits named C0 and C1', JSON.stringify(nodeText()) === '["C0","C1"]', JSON.stringify(nodeText()));
    let g = await graph();
    const [c1, c0] = g.commits;
    check('C0 is the root commit', t.tree.labelOf(c0.oid) === 'C0' && t.tree.labelOf(c1.oid) === 'C1');
    check('each commit shows its short hash',
      nodeOf(c0.oid).querySelector('.gs-tree-sha').textContent === c0.short &&
      nodeOf(c1.oid).querySelector('.gs-tree-sha').textContent === c1.short);
    check('checked-out branch is starred', refText('main') === 'main*', refText('main'));
    check('root sits above its child',
      /translate\([\d.]+,([\d.]+)\)/.exec(nodeOf(c0.oid).getAttribute('transform'))[1] * 1 <
      /translate\([\d.]+,([\d.]+)\)/.exec(nodeOf(c1.oid).getAttribute('transform'))[1] * 1);
    check('tree has an accessible summary',
      /2 commits: main\* at C1/.test(box2.querySelector('.gs-tree-svg').getAttribute('aria-label')),
      box2.querySelector('.gs-tree-svg').getAttribute('aria-label'));

    await tr('git checkout -b report');
    check('star moves to the new branch', refText('report') === 'report*' && refText('main') === 'main',
      refText('report') + ' / ' + refText('main'));
    await tr('echo r > r.txt');
    await tr('git add .');
    await tr('git commit -m "three"');
    g = await graph();
    const c2 = g.commits[0];
    check('a new commit takes the next name', t.tree.labelOf(c2.oid) === 'C2', t.tree.labelOf(c2.oid));
    check('the branch label follows its new tip',
      box2.querySelector('.gs-tree-ref[data-ref="report"]') && t.tree.labelOf(c2.oid) === 'C2' &&
      /report\* at C2/.test(box2.querySelector('.gs-tree-svg').getAttribute('aria-label')),
      box2.querySelector('.gs-tree-svg').getAttribute('aria-label'));
    check('a chain of three commits has two edges', box2.querySelectorAll('.gs-tree-edge').length === 2);

    await tr('undo');
    await sleep(800); // let the undone commit shrink away
    check('undo takes the commit out of the tree', !nodeOf(c2.oid) && nodeText().length === 2, JSON.stringify(nodeText()));
    await tr('git checkout main');
    await tr('echo m > m.txt');
    await tr('git add .');
    await tr('git commit -m "on main"');
    g = await graph();
    check('the name an undone commit had is handed out again', t.tree.labelOf(g.commits[0].oid) === 'C2',
      t.tree.labelOf(g.commits[0].oid));

    await tr('git checkout report');
    await tr('echo r2 > r2.txt');
    await tr('git add .');
    await tr('git commit -m "report work"');
    await tr('git checkout main');
    await tr('git merge report');
    g = await graph();
    const merge = g.commits[0];
    check('a merge commit is drawn with both edges', merge.parents.length === 2 &&
      box2.querySelectorAll('.gs-tree-edge').length === 5, String(box2.querySelectorAll('.gs-tree-edge').length));
    check('merge commit is C4', t.tree.labelOf(merge.oid) === 'C4', t.tree.labelOf(merge.oid));
    check('merge commit is a single circle like any other', nodeOf(merge.oid).querySelectorAll('circle').length === 1);

    box2.querySelector('.gs-reset').dispatchEvent(new win.Event('click'));
    await t.ready; await sleep(400);
    check('reset starts naming again from C0', JSON.stringify(nodeText()) === '["C0","C1"]', JSON.stringify(nodeText()));
  }

  // detached HEAD gets its own label; the sandbox has no command for it yet,
  // so draw a hand-made graph
  {
    const svgD = win.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    win.document.body.appendChild(svgD);
    const tv = win.GitSandboxTree.createTreeView(svgD);
    tv.update({
      head: null, headOid: 'b'.repeat(40), detached: true,
      commits: [
        { oid: 'b'.repeat(40), short: 'bbbbbbb', message: 'two', parents: ['a'.repeat(40)], refs: [] },
        { oid: 'a'.repeat(40), short: 'aaaaaaa', message: 'one', parents: [], refs: [{ name: 'main', isHead: false }] }
      ]
    }, true);
    check('detached HEAD has its own label',
      !!svgD.querySelector('.gs-tree-ref[data-ref="HEAD"]') &&
      svgD.querySelector('.gs-tree-ref[data-ref="main"] text').textContent === 'main',
      svgD.innerHTML.slice(0, 200));
  }

  const svg = host.querySelector('.gs-graph');
  const style = `<style>
    .gs-sha{font-family:monospace;font-size:12px;fill:#717171}
    .gs-msg{font-family:sans-serif;font-size:13px;fill:#404041}
    .gs-ref{font-family:monospace;font-size:11px;fill:#22384C}
    .gs-ref-head{fill:#fff}
    .gs-empty-text{font-family:sans-serif;font-size:13px;fill:#717171}
  </style>`;
  const svgOut = svg.outerHTML.replace('>', ' width="640">').replace(/^(<svg[^>]*>)/, '$1' + style);
  fs.writeFileSync(path.join(__dirname, 'graph-preview.svg'),
    '<?xml version="1.0"?>' + svgOut.replace('<svg', '<svg style="background:#fff"'));

  console.log('\n===== TERMINAL RENDER (last run) =====');
  console.log(host.querySelector('.gs-out').textContent.trim().split('\n').slice(-14).join('\n'));
  console.log('\n===== STAGING =====');
  console.log(Array.from(host.querySelectorAll('.gs-col')).map(c => c.textContent.trim()).join('\n---\n'));

  console.log('\n===== RESULTS =====');
  console.log('passed: ' + pass + '   failed: ' + fail);
  if (failures.length) {
    console.log('\nFAILURES:');
    failures.forEach(f => console.log(' - ' + f));
    process.exit(1);
  }
})().catch(e => { console.error(e); process.exit(1); });
