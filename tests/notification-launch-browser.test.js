// Notification taps in headless Chrome with the real app.html and the real
// sw.js installed as the service worker. The test cannot tap a system
// notification, so it calls sw.js's own handleNotificationClick() inside the
// running service worker with the same notification data the push handler
// stores. Opening a window from a notification needs the user's tap, so
// clients.openWindow is replaced with a recorder and the test then loads the
// recorded URL itself, as the phone would.
//
// This is not a phone and not an installed Android app. It checks the app
// and service worker logic in a real browser.
//
// Run: NODE_PATH="$(npm root -g)" node tests/notification-launch-browser.test.js
// Exits 77 (skip) when Playwright or Chrome cannot start.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.log('SKIP  playwright is not installed (set NODE_PATH to a global install)');
  process.exit(77);
}

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const SHOTS = process.env.SCREENSHOT_DIR || '';

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.txt': 'text/plain' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  if (!fs.existsSync(CHROME)) {
    console.log('SKIP  Chrome not found at ' + CHROME);
    process.exit(77);
  }
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  } catch (e) {
    console.log('SKIP  Chrome could not be launched: ' + String(e.message || e).split('\n')[0]);
    server.close();
    process.exit(77);
  }

  let passed = 0;
  let failed = 0;
  async function check(name, fn) {
    try {
      await fn();
      passed += 1;
      console.log('PASS  ' + name);
    } catch (e) {
      failed += 1;
      console.log('FAIL  ' + name + '\n      ' + String(e.stack || e).split('\n').slice(0, 8).join('\n      '));
    }
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  // Installed-app display mode. `slowsplash=1` gives a first-run splash
  // (3 s instead of 2.2 s); `noob=1` starts with onboarding not done.
  await context.addInitScript(() => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q)
      ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
      : mm(q));
    if (location.pathname !== '/app.html') return;
    if (/noob=1/.test(location.search)) localStorage.removeItem('ablty_onboarded');
    else localStorage.setItem('ablty_onboarded', '1');
    if (/slowsplash=1/.test(location.search)) localStorage.removeItem('ablty_splash');
    else localStorage.setItem('ablty_splash', '1');
  });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.endsWith('.js') || url.includes('/gsi/client')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    return route.abort();
  });

  const errors = [];
  async function newPage() {
    const p = await context.newPage();
    p.on('pageerror', (e) => errors.push(String(e)));
    return p;
  }

  async function settle(page, pred, timeout = 9000) {
    const t0 = Date.now();
    for (;;) {
      try {
        const v = await page.evaluate(pred);
        if (v) return v;
      } catch (e) { /* navigation in progress */ }
      if (Date.now() - t0 > timeout) throw new Error('timed out waiting for ' + pred.toString().slice(0, 120));
      await page.waitForTimeout(100);
    }
  }
  const appState = (page) => page.evaluate(() => ({
    screen: currentScreen,
    rcActive: document.getElementById('screen-rc-task').classList.contains('active'),
    count: parseInt(localStorage.getItem('ablty_rc_task_count') || '0', 10),
    url: location.pathname + location.search + location.hash,
    state: history.state,
    splash: splashDone,
    wake: document.getElementById('wbtb-wake-screen').classList.contains('active'),
    wakeTitle: (document.querySelector('#wbtb-wake-screen .wbtb-wake-title') || {}).textContent || '',
  }));
  const appReady = (page) => settle(page, () => typeof splashDone !== 'undefined' && splashDone
    && !!navigator.serviceWorker.controller && document.readyState === 'complete');

  async function worker(page) {
    for (let i = 0; i < 40; i++) {
      const sw = context.serviceWorkers()[0];
      if (sw) {
        try {
          await sw.evaluate(() => {
            if (!self.__abltyTestPatched) {
              self.__abltyTestPatched = true;
              self.__opened = [];
              self.clients.openWindow = async (url) => { self.__opened.push(url); return null; };
            }
          });
          return sw;
        } catch (e) { /* worker was stopped; wake it below */ }
      }
      await page.evaluate(() => fetch('/version.json?wake=' + Date.now(), { cache: 'no-store' }).catch(() => {})).catch(() => {});
      await page.waitForTimeout(150);
    }
    throw new Error('service worker not available');
  }
  const tap = (sw, url) => sw.evaluate((u) => {
    self.__tapDone = false;
    self.__tapStarted = Date.now();
    handleNotificationClick({ data: { url: u }, close() {} }).then(() => {
      self.__tapDone = true;
      self.__tapMs = Date.now() - self.__tapStarted;
    });
  }, url);

  // First load installs sw.js; its activate step claims the page, and the
  // app reloads once on controllerchange.
  const app = await newPage();
  await app.goto(base + '/app.html', { waitUntil: 'domcontentloaded' });
  await appReady(app);
  await app.waitForTimeout(800);
  await appReady(app);
  let sw = await worker(app);

  await check('ordinary launch without a notification stays on Home', async () => {
    const s = await appState(app);
    assert.strictEqual(s.screen, 'home');
    assert.strictEqual(s.rcActive, false);
    assert.strictEqual(s.count, 0);
    assert.strictEqual(s.url, '/app.html');
  });

  await check('app already open, with the landing page open in another tab: the app opens Reality Check, the landing page is untouched', async () => {
    const landing = await newPage();
    await landing.goto(base + '/', { waitUntil: 'domcontentloaded' });
    const landingTitle = await landing.title();
    sw = await worker(app);
    await tap(sw, '/app.html?rc=1');
    await settle(app, () => currentScreen === 'rc-task');
    const s = await appState(app);
    assert.strictEqual(s.rcActive, true);
    assert.strictEqual(s.count, 1);
    assert.strictEqual(s.url, '/app.html');
    assert.strictEqual(new URL(landing.url()).pathname, '/');
    assert.strictEqual(await landing.title(), landingTitle);
    const opened = await sw.evaluate(() => self.__opened.length);
    assert.strictEqual(opened, 0, 'no new window was opened');
    await settle(app, () => true);
    const done = await sw.evaluate(() => self.__tapDone);
    assert.strictEqual(done, true, 'the tap finished with an acknowledgement');
    if (SHOTS) { await app.bringToFront(); await app.waitForTimeout(1000); await app.screenshot({ path: path.join(SHOTS, 'rc-open-app-tap.png') }); }
    await landing.close();
  });

  await check('a second tap while Reality Check is open does not reset or rotate the task', async () => {
    const before = await app.evaluate(() => document.getElementById('rc-task-question').textContent);
    await app.evaluate(() => { document.getElementById('rc-task-input') && (document.getElementById('rc-task-input').value = 'typed answer'); });
    sw = await worker(app);
    await tap(sw, '/app.html?rc=1');
    await app.waitForTimeout(600);
    const s = await appState(app);
    assert.strictEqual(s.count, 1);
    assert.strictEqual(await app.evaluate(() => document.getElementById('rc-task-question').textContent), before);
    const input = await app.evaluate(() => (document.getElementById('rc-task-input') || {}).value);
    assert.strictEqual(input, 'typed answer');
  });

  await check('the same intent delivered twice opens Reality Check once', async () => {
    await app.evaluate(() => navigate('home'));
    sw = await worker(app);
    await sw.evaluate(async () => {
      const list = await self.clients.matchAll({ type: 'window' });
      list.forEach((c) => {
        c.postMessage({ type: 'RC_OPEN', intentId: 'dup-browser-1' });
        c.postMessage({ type: 'RC_OPEN', intentId: 'dup-browser-1' });
      });
    });
    await settle(app, () => currentScreen === 'rc-task');
    await app.waitForTimeout(500);
    await app.evaluate(() => navigate('home'));
    await sw.evaluate(async () => {
      const list = await self.clients.matchAll({ type: 'window' });
      list.forEach((c) => c.postMessage({ type: 'RC_OPEN', intentId: 'dup-browser-1' }));
    });
    await app.waitForTimeout(500);
    const s = await appState(app);
    assert.strictEqual(s.count, 2, 'one more task, not two or three');
    assert.strictEqual(s.screen, 'home');
  });

  await check('WBTB wake and return taps still open their screens in the open app', async () => {
    sw = await worker(app);
    await tap(sw, '/app.html?wbtb=1');
    await settle(app, () => document.getElementById('wbtb-wake-screen').classList.contains('active'));
    await app.evaluate(() => closeWBTBWakeScreen());
    await tap(sw, '/app.html?wbtb=return');
    await settle(app, () => document.getElementById('wbtb-wake-screen').classList.contains('active'));
    const s = await appState(app);
    assert.strictEqual(s.wakeTitle, 'SLEEP NOW');
    await app.evaluate(() => closeWBTBWakeScreen());
    assert.strictEqual(s.count, 2, 'Reality Check not opened by WBTB taps');
  });

  await check('app window busy for 7 s when the tap arrives: not reloaded, unsaved text kept, Reality Check opens once it catches up', async () => {
    await app.evaluate(() => navigate('home'));
    sw = await worker(app);
    await app.evaluate(() => {
      window.__samePage = true;
      document.getElementById('dream-entry-body').value = 'unsaved dream text';
      setTimeout(() => { const end = Date.now() + 7000; while (Date.now() < end) { /* busy */ } }, 100);
    });
    await app.waitForTimeout(300);
    await tap(sw, '/app.html?rc=1');
    await app.waitForTimeout(7500);
    await settle(app, () => currentScreen === 'rc-task', 4000);
    const kept = await app.evaluate(() => ({
      same: window.__samePage === true,
      text: document.getElementById('dream-entry-body').value,
    }));
    assert.strictEqual(kept.same, true, 'the window was not reloaded');
    assert.strictEqual(kept.text, 'unsaved dream text');
    assert.strictEqual((await appState(app)).count, 3);
    assert.strictEqual(await sw.evaluate(() => self.__opened.length), 0, 'no window opened over it');
  });

  await app.close();

  await check('app fully closed: the tap opens /app.html?rc=1&nid=..., and Reality Check opens after a slow first-run splash', async () => {
    const holder = await newPage();
    await holder.goto(base + '/', { waitUntil: 'domcontentloaded' });
    sw = await worker(holder);
    await tap(sw, '/app.html?rc=1');
    const opened = await (async () => {
      for (let i = 0; i < 50; i++) {
        const o = await sw.evaluate(() => self.__opened.slice(-1)[0] || null);
        if (o) return o;
        await holder.waitForTimeout(100);
      }
      return null;
    })();
    assert.ok(opened, 'sw.js asked to open a window (the landing page tab was not used)');
    const u = new URL(opened);
    assert.strictEqual(u.pathname, '/app.html');
    assert.strictEqual(u.searchParams.get('rc'), '1');
    assert.ok(u.searchParams.get('nid'));
    const page = await newPage();
    const t0 = Date.now();
    await page.goto(opened + '&slowsplash=1&utm_source=a%20b', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    let s = await appState(page);
    assert.strictEqual(s.splash, false);
    assert.strictEqual(s.screen, 'home', 'not opened behind the splash');
    assert.ok(s.url.includes('rc=1'), 'marker kept until it opens');
    await settle(page, () => currentScreen === 'rc-task', 8000);
    s = await appState(page);
    assert.ok(Date.now() - t0 >= 2900, 'opened after the 3 s splash');
    assert.strictEqual(s.url, '/app.html?slowsplash=1&utm_source=a%20b', 'only the notification markers removed');
    assert.strictEqual(s.state && s.state.screen, 'rc-task');
    if (SHOTS) { await page.bringToFront(); await page.waitForTimeout(1000); await page.screenshot({ path: path.join(SHOTS, 'rc-open-fresh-launch.png') }); }
    await settle(page, () => true);
    const ack = await (async () => {
      for (let i = 0; i < 30; i++) {
        const d = await sw.evaluate(() => ({ done: self.__tapDone, ms: self.__tapMs }));
        if (d.done) return d;
        await page.waitForTimeout(100);
      }
      return { done: false };
    })();
    assert.strictEqual(ack.done, true, 'sw.js finished because the app claimed the intent (no 20 s wait)');
    assert.ok(ack.ms < 15000);
    await page.goBack().catch(() => {});
    await page.waitForTimeout(300);
    const backUrl = await page.evaluate(() => location.search);
    assert.ok(!/rc=1|nid=/.test(backUrl), 'Back does not bring the marker back');
    await page.close();
    await holder.close();
  });

  await check('app fully closed and the platform opens it without the notification URL: the app claims the tap', async () => {
    const holder = await newPage();
    await holder.goto(base + '/', { waitUntil: 'domcontentloaded' });
    sw = await worker(holder);
    const before = await sw.evaluate(() => self.__opened.length);
    await tap(sw, '/app.html?rc=1');
    for (let i = 0; i < 50; i++) {
      if ((await sw.evaluate(() => self.__opened.length)) > before) break;
      await holder.waitForTimeout(100);
    }
    const page = await newPage();
    await page.goto(base + '/app.html', { waitUntil: 'domcontentloaded' });
    await settle(page, () => currentScreen === 'rc-task', 8000);
    const s = await appState(page);
    assert.strictEqual(s.url, '/app.html');
    await page.close();
    await holder.close();
  });

  await check('onboarding not finished: Reality Check waits until onboarding is closed', async () => {
    const page = await newPage();
    await page.goto(base + '/app.html?rc=1&nid=onboard-1&noob=1', { waitUntil: 'domcontentloaded' });
    await settle(page, () => splashDone && document.getElementById('onboarding-screen').classList.contains('active'));
    await page.waitForTimeout(800);
    let s = await appState(page);
    assert.strictEqual(s.screen, 'home', 'not opened under onboarding');
    await page.evaluate(() => skipOnboarding());
    await settle(page, () => currentScreen === 'rc-task', 4000);
    s = await appState(page);
    assert.strictEqual(s.url, '/app.html?noob=1');
    await page.close();
  });

  await check('a fresh WBTB wake launch opens the wake screen after the splash', async () => {
    const page = await newPage();
    await page.goto(base + '/app.html?wbtb=1&nid=wake-browser-1', { waitUntil: 'domcontentloaded' });
    await settle(page, () => document.getElementById('wbtb-wake-screen').classList.contains('active'), 8000);
    const s = await appState(page);
    assert.strictEqual(s.splash, true);
    assert.strictEqual(s.url, '/app.html');
    await page.close();
  });

  await check('no page errors', async () => {
    assert.deepStrictEqual(errors, []);
  });

  await browser.close();
  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
