// Local visual regression script. Boots era-streamer's HTTP server,
// drives the control panel with Puppeteer, and saves screenshots to
// scripts/screenshots/ so the assistant can inspect rendered state
// before pushing CSS / layout changes.
//
// Run:  node scripts/visual-test.js
//
// Outputs:
//   scripts/screenshots/<tab>-<state>.png
//
// Requires: puppeteer (devDependency), Node 18+.

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const puppeteer = require('puppeteer');
// server.js reads ERA_STREAMER_PORT at require-time, so set it before
// the require resolves (done inside main()). Imported lazily there.

const OVERLAY_DIR = path.join(__dirname, '..', 'overlay');
const UI_DIR      = path.join(__dirname, '..', 'ui');
const STATE_PATH  = path.join(os.tmpdir(), 'era-streamer-visual-test-state.json');
const OUT_DIR     = path.join(__dirname, 'screenshots');
const PORT        = 49125; // different from the live app's 49124 so it can run alongside

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Make server.js bind to our test port instead of fighting the live app.
  process.env.ERA_STREAMER_PORT = String(PORT);
  const { start } = require('../src/server');

  // Boot the same HTTP server era-streamer ships with. No Electron, no
  // bridge — just the routes that serve /control and /match.html so the
  // preview iframe can load.
  const server = await start({
    overlayDir: OVERLAY_DIR,
    uiDir:      UI_DIR,
    statePath:  STATE_PATH,
    appVersion: '0.0.0-test',
    onLog:      () => {},
  });
  console.log('test server listening on http://127.0.0.1:' + server.port);

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 1360, height: 940 },
    args: ['--disable-gpu', '--no-sandbox'],
  });
  const page = await browser.newPage();

  // Surface page errors in the test output so CSS issues that crash JS
  // aren't silent.
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  page.on('console',   (msg) => {
    if (msg.type() === 'error') console.log('[console.error]', msg.text());
  });

  async function snap(name) {
    const file = path.join(OUT_DIR, name + '.png');
    await page.screenshot({ path: file, fullPage: false });
    console.log('saved', file);
  }

  await page.goto('http://127.0.0.1:' + PORT + '/control', { waitUntil: 'networkidle0' });

  // Dismiss the first-run wizard so it doesn't cover the screenshots.
  await page.evaluate(() => {
    const skip = document.getElementById('wizardSkip');
    if (skip) skip.click();
  });

  // Give the preview iframe a beat to mount.
  await new Promise((r) => setTimeout(r, 600));

  await snap('main-tab');

  // Switch to Customize.
  await page.evaluate(() => {
    const btn = document.querySelector('.side-link[data-tab="customize"]');
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  await snap('customize-default');

  // Walk each sub-tab.
  for (const pane of ['visibility','card','banner','goal','stats']) {
    await page.evaluate((p) => {
      const t = document.querySelector('.cz-sub-tab[data-cz-pane="' + p + '"]');
      if (t) t.click();
    }, pane);
    await new Promise((r) => setTimeout(r, 300));
    await snap('customize-' + pane);
  }

  // Resize the preview via the splitter and snap a tall + a short layout
  // so the assistant can verify the contain pattern from both ends.
  await page.evaluate(() => {
    const tab = document.querySelector('.tab-pane[data-pane="customize"]');
    if (tab) tab.style.setProperty('--cz-preview-h', '500px');
  });
  await new Promise((r) => setTimeout(r, 300));
  await snap('customize-preview-tall');

  await page.evaluate(() => {
    const tab = document.querySelector('.tab-pane[data-pane="customize"]');
    if (tab) tab.style.setProperty('--cz-preview-h', '180px');
  });
  await new Promise((r) => setTimeout(r, 300));
  await snap('customize-preview-short');

  // Other tabs.
  for (const tab of ['archive','settings','main']) {
    await page.evaluate((t) => {
      const btn = document.querySelector('.side-link[data-tab="' + t + '"]');
      if (btn) btn.click();
    }, tab);
    await new Promise((r) => setTimeout(r, 300));
    await snap('tab-' + tab);
  }

  await browser.close();
  if (server.stop) server.stop();
  console.log('done');
  // Force exit in case any background timers in server are still alive.
  setTimeout(() => process.exit(0), 200);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
