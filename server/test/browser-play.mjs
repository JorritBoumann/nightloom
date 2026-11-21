// One browser session: a page plays one shift online with the server-side bot
// as its partner. The page's own test autopilot presses real key events
// (window.NIGHTLOOM_AUTOPILOT; the seat joins as a test bot), so the real
// keyboard path, the lobby, the network and the recording are all used.
//
//   node test/browser-play.mjs local --server ws://HOST:PORT [--shift 1] [--helper <sandboxed-browser.mjs>] [--dns a,b]
//   node test/browser-play.mjs frame --handoff <file> [--shift 1] [--helper ...] [--dns ...]
//
// local: serves dist/index.html at http://nightloom.test/ through request
//        interception (the server needs EXTRA_ORIGINS=http://nightloom.test).
// frame: opens the Stateloop play page from a preview handoff file
//        ({previewLaunchEndpoint, previewLaunchToken}); the file is read once and never printed.
// With --helper the browser runs in that sandbox (launchSandboxedChromium); without it, plain Playwright.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const mode = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SHIFT = Number(opt('--shift', 1));
const OUT = opt('--out', '/tmp/opencode/nl/browser');
const HELPER = opt('--helper', '');
const DNS = String(opt('--dns', '')).split(',').filter(Boolean);
const MAX_S = Number(opt('--max-s', 320));
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function launch() {
  const chromeArgs = ['--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'];
  // local mode: the page and the game server are on a private address; allow that in the test browser only
  if (mode === 'local') chromeArgs.push('--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults');
  if (HELPER) {
    const { launchSandboxedChromium } = await import(path.resolve(HELPER));
    return launchSandboxedChromium({ args: chromeArgs, dns: DNS, memory: '3g' });
  }
  const { chromium } = await import('playwright');
  return chromium.launch({ args: chromeArgs });
}

async function gameFrame(page) {
  for (let i = 0; i < 120; i++) {
    for (const f of page.frames()) {
      try { if (await f.evaluate(() => !!(window.__nightloom && window.__nightloom.net))) return f; } catch { /* not ready */ }
    }
    await page.waitForTimeout(500);
  }
  throw new Error('game frame with the test handle not found');
}

async function main() {
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block' });
  await context.addInitScript(() => { window.NIGHTLOOM_AUTOPILOT = true; window.NIGHTLOOM_TEST = true; });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' && !(mode === 'local' && /Failed to load resource: net::ERR_FAILED/.test(m.text()))) errors.push(m.text().slice(0, 300)); });
  if (mode === 'local') {
    const server = opt('--server', 'ws://172.17.0.1:2599');
    const html = fs.readFileSync(new URL('../../dist/index.html', import.meta.url));
    await page.route('http://nightloom.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await page.goto(`http://nightloom.test/index.html?COOP_SERVER_URL=${encodeURIComponent(server)}`, { waitUntil: 'load' });
  } else if (mode === 'frame') {
    const file = opt('--handoff', '');
    const h = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!h.previewLaunchEndpoint || !h.previewLaunchToken) throw new Error('handoff file has no launch endpoint or token');
    // The play page takes the launch token by POST (as Creator's preview button does).
    await page.setContent(`<form id=f method=post action="${h.previewLaunchEndpoint.replace(/"/g, '')}"><input type=hidden name=token></form>`);
    await page.evaluate((tok) => { const f = document.getElementById('f'); f.token.value = tok; f.submit(); }, h.previewLaunchToken);
    await page.waitForLoadState('load');
  } else {
    throw new Error('mode must be local or frame');
  }
  const frame = await gameFrame(page);
  log('game frame', frame.url().replace(/\?.*$/, ''));
  const avail = await frame.evaluate(() => window.__nightloom.net.available());
  if (!avail) throw new Error('online play is not available in this build (no server URL or no client)');
  const storage = await frame.evaluate(() => { try { localStorage.setItem('nl-test', '1'); return localStorage.getItem('nl-test') === '1'; } catch (e) { return String(e).slice(0, 80); } });
  log('localStorage in the game frame:', storage);
  // Title -> Play online -> name -> Play with the bot (real clicks)
  await frame.click('#online');
  await frame.fill('#nlName', 'Browser test');
  await frame.click('#nlBot');
  try {
    await frame.waitForSelector('#nlReady', { timeout: 20000 });
  } catch (e) {
    const msg = await frame.evaluate(() => (document.getElementById('nlMsg') || {}).textContent || document.getElementById('overlay').innerText.slice(0, 400));
    await page.screenshot({ path: `${OUT}/lobby-fail.png` });
    log('lobby did not appear:', msg);
    for (const x of errors.slice(0, 10)) log('  error:', x);
    throw e;
  }
  await frame.click('[data-comms="none"]');
  await frame.waitForTimeout(500);
  const chip = await frame.$(`.chip[data-i="${SHIFT}"]`);
  if (chip) { await chip.click(); await frame.waitForTimeout(500); }
  await frame.click('#nlReady');
  log('ready; waiting for the round');
  const t0 = Date.now();
  let shot = 0, phase = '', last = '';
  while (Date.now() - t0 < MAX_S * 1000) {
    await page.waitForTimeout(5000);
    const s = await frame.evaluate(() => {
      const n = window.__nightloom.net, S = window.__nightloom.state();
      return { phase: n.phase(), stats: n.stats(), tick: S ? S.tick : 0, score: S ? S.score : 0, delivered: S ? S.delivered : 0, fps: 0 };
    });
    phase = s.phase;
    const line = `phase=${s.phase} tick=${s.tick} score=${s.score} delivered=${s.delivered} ${JSON.stringify(s.stats)}`;
    if (line !== last) log(line);
    last = line;
    if (s.phase === 'playing' && shot < 2 && s.tick > 600 * (shot + 1)) { await page.screenshot({ path: `${OUT}/play-${shot}.png` }); shot++; }
    if (s.phase === 'ended') break;
  }
  await page.screenshot({ path: `${OUT}/end.png` });
  const fps = await frame.evaluate(() => new Promise((r) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
  log(`final phase ${phase}; page fps ${fps}; page errors ${errors.length}`);
  for (const e of errors.slice(0, 10)) log('  error:', e);
  try { await frame.click('#nlLeave'); await page.waitForTimeout(1000); } catch { /* already gone */ }
  await browser.close();
  process.exit(phase === 'ended' && errors.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
