// Render each boost-bg variant against the actual overlay (overlay/match.html)
// in demo mode. One PNG per variant, plus a control panel screenshot of the
// new BOOST BG sub-tab.

const path = require('path');
const fs = require('fs');
const os = require('os');
const puppeteer = require('puppeteer');

const OVERLAY_DIR = path.join(__dirname, '..', 'overlay');
const UI_DIR      = path.join(__dirname, '..', 'ui');
const STATE_PATH  = path.join(os.tmpdir(), 'era-streamer-boost-bg-shoot.json');
const OUT_DIR     = path.join(__dirname, 'screenshots');
const PORT        = 49126;

const VARIANTS = ['none', 'a', 'b', 'c', 'd', 'e', 'f'];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  process.env.ERA_STREAMER_PORT = String(PORT);
  const { start } = require('../src/server');

  const server = await start({
    overlayDir: OVERLAY_DIR,
    uiDir:      UI_DIR,
    statePath:  STATE_PATH,
    appVersion: '0.0.0-test',
    onLog:      () => {},
  });
  console.log('server on http://127.0.0.1:' + server.port);

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 1280, height: 720 },  // matches a real broadcast canvas
    args: ['--disable-gpu', '--no-sandbox'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('http://127.0.0.1:' + PORT + '/match.html?demo=1', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 600));

  // Simulate a real broadcast scene under the overlay. OBS browser sources
  // render over a game video; the bare overlay HTML defaults to a white
  // browser background, which makes dark/translucent backdrops invisible.
  // Inject a stadium-ish gradient + a busy diagonal pattern so each variant
  // is judged against something that resembles a real broadcast.
  // match.html sets `body { background:transparent !important }` for OBS.
  // Override with a fixed-position fake-scene element painted UNDER everything.
  await page.evaluate(() => {
    const scene = document.createElement('div');
    scene.id = 'fake-scene';
    scene.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:-1', 'pointer-events:none',
      'background:'
        + 'linear-gradient(180deg, rgba(20,28,40,0.85) 0%, rgba(10,16,26,0.95) 60%, rgba(0,5,12,1) 100%),'
        + 'repeating-linear-gradient(45deg, #2b2620 0 18px, #1f1c18 18px 36px)',
      'background-blend-mode:multiply',
    ].join(';');
    document.body.appendChild(scene);
  });

  // For each variant: force the bg class, set a clear boost value, crop the
  // bottom-right region. Crop region: gauge sits at right:24, bottom:24, with
  // a 200x200 footprint plus up to ~20px of bg overflow.
  const cropW = 320, cropH = 320;
  const cropX = 1280 - cropW;     // anchor right edge
  const cropY = 720 - cropH;      // anchor bottom edge

  for (const v of VARIANTS) {
    await page.evaluate((style) => {
      if (typeof applyBoostBgStyle === 'function') applyBoostBgStyle(style);
      if (typeof setBoostIndicator === 'function') {
        // Use a teal-ish team color so the bg's team-color elements light up
        setBoostIndicator(73, '#4ea8ff');
      } else {
        // Manual fallback if the function name differs.
        const el = document.getElementById('boostIndicator');
        if (el) {
          el.classList.add('visible');
          el.style.setProperty('--team-color', '#4ea8ff');
          const val = document.getElementById('boostValue');
          if (val) val.textContent = '73';
          const fill = document.getElementById('boostFill');
          if (fill) {
            const RING = 282.74, ARC = 212;
            const visible = ARC * 73 / 100;
            fill.style.strokeDasharray = visible + ' ' + (RING - visible);
            fill.classList.add('has-fill');
          }
        }
      }
    }, v);
    await new Promise((r) => setTimeout(r, 250));
    const file = path.join(OUT_DIR, 'boost-bg-' + v + '.png');
    await page.screenshot({ path: file, clip: { x: cropX, y: cropY, width: cropW, height: cropH } });
    console.log('saved', file);
  }

  // Also snap the control panel's new sub-tab so we can verify the picker UI.
  await page.goto('http://127.0.0.1:' + PORT + '/control', { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    const skip = document.getElementById('wizardSkip');
    if (skip) skip.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  // Open Customize → BOOST BG sub-tab.
  await page.evaluate(() => {
    const sl = document.querySelector('.side-link[data-tab="customize"]');
    if (sl) sl.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    const t = document.querySelector('.cz-sub-tab[data-cz-pane="boostbg"]');
    if (t) t.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  const ctrlFile = path.join(OUT_DIR, 'control-boost-bg-tab.png');
  await page.screenshot({ path: ctrlFile, fullPage: false });
  console.log('saved', ctrlFile);

  await browser.close();
  if (server.stop) server.stop();
  setTimeout(() => process.exit(0), 200);
}

main().catch((e) => { console.error(e); process.exit(1); });
