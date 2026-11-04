/* The git-sandbox-vscode extension in a real browser: renders
   tests/fixtures/vscode.qmd, serves it, and drives the workbench with
   Playwright (Chromium).
   Run: node tests/test-vscode.js            (from the repo root)
   Needs Playwright's Chromium (`npx playwright install chromium`); without
   it the browser half is skipped, loudly. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(label + (detail ? '\n     ' + detail : '')); }
}
function report() {
  console.log('===== VS Code view =====');
  console.log('passed: ' + pass + '   failed: ' + fail);
  if (failures.length) {
    console.log('\nFAILURES:');
    failures.forEach(f => console.log(' - ' + f));
    process.exit(1);
  }
}

function render() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-vsc-'));
  fs.cpSync(path.join(root, '_extensions'), path.join(work, '_extensions'), { recursive: true });
  for (const f of ['vscode.qmd', 'vscode-unused.qmd']) {
    fs.copyFileSync(path.join(__dirname, 'fixtures', f), path.join(work, f));
    execFileSync('quarto', ['render', f, '--quiet'], { cwd: work, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  return work;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end(); return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function loadPlaywright() {
  for (const name of ['playwright', 'playwright-core']) {
    try { return require(name); } catch (e) {}
  }
  return null;
}

// In the page: the workbench's shadow root, if exercise `id` holds it
function workbench(id) {
  const f = [...document.querySelectorAll('#' + id + ' .gs-ext > div')].find((d) => d.shadowRoot);
  return f ? f.shadowRoot : null;
}

(async () => {
  const work = render();
  const html = fs.readFileSync(path.join(work, 'vscode.html'), 'utf8');
  const lib = path.join(work, 'vscode_files', 'libs', 'quarto-contrib', 'git-sandbox-vscode-1.1.0');
  check('the page loads the small VS Code loader', /git-sandbox-vscode-1\.1\.0\/sandbox-vscode\.js/.test(html));
  check('the page does not load the workbench itself', !/workbench\.js/.test(html));
  check('the workbench is copied next to the page', fs.existsSync(path.join(lib, 'vscode', 'workbench.js')));
  check('with its workers and assets', fs.existsSync(path.join(lib, 'vscode', 'workers')) && fs.existsSync(path.join(lib, 'vscode', 'assets')));
  check('git-sandbox-vscode blocks become exercises', (html.match(/git-sandbox-view-vscode/g) || []).length === 2);
  const unused = fs.readFileSync(path.join(work, 'vscode-unused.html'), 'utf8');
  check('a page with the filter but no VS Code exercise gets none of its files',
    !/sandbox-vscode\.js/.test(unused) &&
      !fs.existsSync(path.join(work, 'vscode-unused_files', 'libs', 'quarto-contrib', 'git-sandbox-vscode-1.1.0')));

  const pw = loadPlaywright();
  let browser = null;
  if (pw) {
    try { browser = await pw.chromium.launch(); } catch (e) { console.log('(could not start Chromium: ' + e.message.split('\n')[0] + ')'); }
  }
  if (!browser) {
    console.log('SKIPPED the browser half: Playwright\'s Chromium is not installed (npx playwright install chromium).');
    report();
    return;
  }

  const server = await serve(work);
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  await page.addInitScript(`window.__workbench = ${workbench.toString()}`);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const fetched = [];
  page.on('request', (r) => fetched.push(r.url()));
  const holds = (id) => page.evaluate((i) => !!window.__workbench(i), id);
  const tasks = (id) => page.textContent('#' + id + ' .gs-tasks');
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/vscode.html`);
    await page.waitForSelector('#in-vscode .gs-ext-msg');
    await page.waitForTimeout(800);
    check('nothing of VS Code is fetched while no VS Code exercise is in view',
      !fetched.some((u) => /\/vscode\//.test(u)), fetched.filter((u) => /\/vscode\//.test(u)).join('\n'));
    check('a VS Code exercise has no Terminal/Editor tabs', (await page.$$('#in-vscode .gs-wtab')).length === 0);
    check('a plain box keeps its terminal', (await page.$$('#plain .gs-input')).length === 1);
    check('a VS Code exercise waiting to start says so',
      /scrolls into view/.test(await page.textContent('#in-vscode .gs-ext')), await page.textContent('#in-vscode .gs-ext'));

    await page.locator('#in-vscode').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const wb = window.__workbench('in-vscode');
      return wb && wb.querySelector('.xterm-helper-textarea');
    }, null, { timeout: 60000 });
    check('scrolling it into view fetches the workbench', fetched.some((u) => /\/vscode\/workbench\.js$/.test(u)));
    check('the workbench draws inside a shadow root',
      await page.evaluate(() => window.__workbench('in-vscode').querySelectorAll('.monaco-workbench').length === 1));
    await page.waitForTimeout(1500);
    check('the explorer marks the untracked file as untracked',
      await page.evaluate(() => [...window.__workbench('in-vscode').querySelectorAll('.explorer-item')]
        .some((r) => /analysis\.R • Untracked$/.test(r.getAttribute('aria-label') || ''))));

    // a command typed in VS Code's terminal runs in the exercise
    const vs = page.locator('#in-vscode .gs-ext');
    await vs.locator('.xterm-helper-textarea').first().focus();
    await page.keyboard.type('git add analysis.R');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /git add analysis\.R/.test(document.querySelector('#in-vscode .gs-out').textContent), null, { timeout: 10000 });
    await page.waitForTimeout(500);
    check('a command typed in VS Code\'s terminal ticks the task', /1 of 2/.test(await tasks('in-vscode')), await tasks('in-vscode'));

    // Source Control: the staged file, then a commit from the message box
    await page.keyboard.press('Control+Shift+G');
    await page.waitForTimeout(1000);
    check('Source Control lists the staged file under Staged Changes',
      await page.evaluate(() => /Staged Changes[\s\S]*analysis\.R/.test(window.__workbench('in-vscode').querySelector('.scm-view').textContent)));
    await vs.locator('.scm-editor .view-lines').first().click();
    await page.keyboard.type('Add the analysis');
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => /git commit -m "Add the analysis"/.test(document.querySelector('#in-vscode .gs-out').textContent), null, { timeout: 10000 });
    await page.waitForTimeout(800);
    check('committing from Source Control runs git commit and ticks the task', /2 of 2/.test(await tasks('in-vscode')), await tasks('in-vscode'));

    // keys pressed outside the workbench stay with the page
    await page.locator('#plain').scrollIntoViewIfNeeded();
    await page.click('#plain .gs-input');
    await page.keyboard.press('Control+p');
    await page.keyboard.type('pwd');
    check('VS Code shortcuts do not fire outside it',
      (await page.inputValue('#plain .gs-input')) === 'pwd' &&
        await page.evaluate(() => ![...window.__workbench('in-vscode').querySelectorAll('.quick-input-widget')]
          .some((w) => getComputedStyle(w).display !== 'none')),
      await page.inputValue('#plain .gs-input'));

    // the workbench follows the reader to the next VS Code exercise
    await page.locator('#shared').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => !!window.__workbench('shared'), null, { timeout: 20000 });
    await page.waitForTimeout(1500);
    check('it moves to the VS Code exercise scrolled to', (await holds('shared')) && !(await holds('in-vscode')));
    check('the one it left offers to bring it back',
      /Open VS Code here/.test(await page.textContent('#in-vscode .gs-ext')), await page.textContent('#in-vscode .gs-ext'));
    await page.locator('#shared .gs-ext .xterm-helper-textarea').first().focus();
    await page.keyboard.press('Control+Shift+E');
    await page.waitForTimeout(800);
    check('a shared exercise shows the files of the box it shares',
      await page.evaluate(() => [...window.__workbench('shared').querySelectorAll('.explorer-item')].map((r) => r.textContent).join(',') === 'README.md'));
    await page.locator('#shared .gs-ext .xterm-helper-textarea').first().focus();
    await page.keyboard.type('git switch -c feature');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /1 of 1/.test(document.querySelector('#shared .gs-tasks').textContent), null, { timeout: 10000 });
    check('its commands reach the shared repository',
      /\(feature\)/.test(await page.textContent('#plain .gs-prompt')), await page.textContent('#plain .gs-prompt'));
    check('no page errors', errors.length === 0, errors.join('\n'));
  } catch (e) {
    check('the browser run finished', false, e.stack);
    if (process.env.GS_SHOT) await page.screenshot({ path: process.env.GS_SHOT });
  } finally {
    await browser.close();
    server.close();
  }
  report();
})().catch((e) => { console.error(e); process.exit(1); });
