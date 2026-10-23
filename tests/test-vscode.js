/* The VS Code view in a real browser: renders tests/fixtures/vscode.qmd,
   serves it, and drives the workbench with Playwright (Chromium).
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
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'vscode.qmd'), path.join(work, 'vscode.qmd'));
  execFileSync('quarto', ['render', 'vscode.qmd', '--quiet'], { cwd: work, stdio: ['ignore', 'pipe', 'pipe'] });
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

(async () => {
  const work = render();
  const html = fs.readFileSync(path.join(work, 'vscode.html'), 'utf8');
  const lib = path.join(work, 'vscode_files', 'libs', 'quarto-contrib', 'git-sandbox-vscode-1.1.0');
  check('the page loads the small VS Code loader', /git-sandbox-vscode-1\.1\.0\/sandbox-vscode\.js/.test(html));
  check('the page does not load the workbench itself', !/workbench\.js/.test(html));
  check('the workbench is copied next to the page', fs.existsSync(path.join(lib, 'vscode', 'workbench.js')));
  check('with its workers and assets', fs.existsSync(path.join(lib, 'vscode', 'workers')) && fs.existsSync(path.join(lib, 'vscode', 'assets')));

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
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const fetched = [];
  page.on('request', (r) => fetched.push(r.url()));
  const shadow = (sel) => page.evaluate((s) => {
    const host = document.querySelector('#in-vscode .gs-vsc > div');
    return host ? host.shadowRoot.querySelectorAll(s).length : -1;
  }, sel);
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/vscode.html`);
    await page.waitForSelector('#in-vscode .gs-input');
    await page.waitForTimeout(500);
    check('nothing of VS Code is fetched before its tab is opened',
      !fetched.some((u) => /\/vscode\//.test(u)), fetched.filter((u) => /\/vscode\//.test(u)).join('\n'));
    check('a box without `vscode: true` has no VS Code tab', (await page.$$('#plain .gs-wtab[data-view="vscode"]')).length === 0);

    await page.click('#in-vscode .gs-wtab[data-view="vscode"]');
    await page.waitForFunction(() => document.querySelector('#in-vscode .gs-vsc-msg').hidden, null, { timeout: 60000 });
    check('opening the tab fetches the workbench', fetched.some((u) => /\/vscode\/workbench\.js$/.test(u)));
    await page.waitForFunction(() => {
      const host = document.querySelector('#in-vscode .gs-vsc > div');
      return host && host.shadowRoot.querySelector('.xterm-helper-textarea');
    }, null, { timeout: 30000 });
    check('the workbench draws inside a shadow root', (await shadow('.monaco-workbench')) === 1);
    check('the explorer shows the project folder by its name',
      await page.evaluate(() => /sales-analysis/i.test(document.querySelector('#in-vscode .gs-vsc > div').shadowRoot.querySelector('.explorer-folders-view, .pane-header').closest('.split-view-view').textContent)));
    await page.waitForTimeout(1000);
    check('the explorer marks the untracked file as untracked',
      await page.evaluate(() => [...document.querySelector('#in-vscode .gs-vsc > div').shadowRoot.querySelectorAll('.explorer-item')]
        .some((r) => /analysis\.R • Untracked$/.test(r.getAttribute('aria-label') || ''))));

    // a command typed in VS Code's terminal runs in the box
    const vs = page.locator('#in-vscode .gs-vsc');
    await vs.locator('.xterm-helper-textarea').first().focus();
    await page.keyboard.type('git add analysis.R');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /git add analysis\.R/.test(document.querySelector('#in-vscode .gs-out').textContent), null, { timeout: 10000 });
    await page.waitForTimeout(500);
    check('a command typed in VS Code\'s terminal ticks the box\'s task',
      await page.evaluate(() => document.querySelectorAll('#in-vscode .gs-task.is-done, #in-vscode .gs-task.done').length >= 1 ||
        /1 of 2/.test(document.querySelector('#in-vscode .gs-tasks').textContent)));

    // Source Control: the staged file, then a commit from the message box
    await page.keyboard.press('Control+Shift+G');
    await page.waitForTimeout(1000);
    check('Source Control lists the staged file under Staged Changes',
      await page.evaluate(() => /Staged Changes[\s\S]*analysis\.R/.test(document.querySelector('#in-vscode .gs-vsc > div').shadowRoot.querySelector('.scm-view').textContent)));
    await vs.locator('.scm-editor .view-lines').first().click();
    await page.keyboard.type('Add the analysis');
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => /git commit -m "Add the analysis"/.test(document.querySelector('#in-vscode .gs-out').textContent), null, { timeout: 10000 });
    await page.waitForTimeout(800);
    check('committing from Source Control runs git commit and ticks the task',
      /2 of 2/.test(await page.textContent('#in-vscode .gs-tasks')), await page.textContent('#in-vscode .gs-tasks'));

    // keys pressed outside the workbench stay with the page
    await page.click('#in-vscode .gs-wtab[data-view="terminal"]');
    await page.click('#in-vscode .gs-input');
    await page.keyboard.press('Control+p');
    await page.keyboard.type('pwd');
    check('VS Code shortcuts do not fire outside it',
      (await page.inputValue('#in-vscode .gs-input')) === 'pwd' && (await shadow('.quick-input-widget[style*="display: block"], .quick-input-widget:not([style*="display: none"])')) === 0,
      await page.inputValue('#in-vscode .gs-input'));
    check('no page errors', errors.length === 0, errors.join('\n'));
  } catch (e) {
    check('the browser run finished', false, e.stack);
  } finally {
    await browser.close();
    server.close();
  }
  report();
})().catch((e) => { console.error(e); process.exit(1); });
