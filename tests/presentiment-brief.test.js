// Introduction-only browser regression checks with isolated guest history.
// No requests leave the local server. No trial results are created or uploaded.
// Run: CHROME_PATH=/path/to/chromium node tests/presentiment-brief.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

async function main() {
  const server = http.createServer((req, res) => {
    const requested = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const pathname = requested === '/' ? '/index.html' : requested;
    const file = path.resolve(ROOT, '.' + pathname);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.mp4': 'video/mp4', '.webp': 'image/webp' }[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      localStorage.setItem('ablty_onboarded', '1');
      localStorage.setItem('ablty_splash', '1');
      const mm = window.matchMedia.bind(window);
      window.matchMedia = q => q.includes('display-mode: standalone')
        ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
        : mm(q);
    });
    const base = 'http://127.0.0.1:' + server.address().port;
    await context.route('**/*', route => {
      if (route.request().url().startsWith(base + '/')) return route.continue();
      if (route.request().url().endsWith('.js')) return route.fulfill({ contentType: 'text/javascript', body: '' });
      return route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    async function open() {
      await page.goto(base + '/app.html', { waitUntil: 'networkidle' });
      await page.evaluate(() => {
        document.getElementById('splash-screen').style.display = 'none';
        navigate('timestamp');
      });
    }
    async function seed(kind) {
      await page.evaluate(kind => {
        const taps = kind === 'empty' || kind === 'miss' ? [] : [2, 4, 6].slice(0, kind === 'one' ? 1 : 3).map((d, i) => ({
          id: 1700000000000 + i, timestamp: new Date(1700000000000 + i).toISOString(),
          eventTime: 12, tapTime: 12 - d, delta: -d, miss: false,
        }));
        const all = kind === 'full' || kind === 'miss' ? [...taps, {
          id: 1700000000004, timestamp: new Date(1700000000004).toISOString(), eventTime: 12, tapTime: null, delta: null, miss: true,
        }] : taps;
        localStorage.setItem(ownedKey('ablty_timestamp'), JSON.stringify(taps));
        localStorage.setItem(ownedKey('ablty_timestamp_all'), JSON.stringify(all));
        localStorage.removeItem(ownedKey('ablty_ts_pending'));
        renderTimestampBrief();
      }, kind);
    }
    async function stats() {
      return page.evaluate(() => ['ts-brief-trials', 'ts-brief-mean', 'ts-brief-std'].map(id => document.getElementById(id).textContent));
    }
    const motion = () => page.locator('.ts-intro-video').evaluateAll(els => els.map(el => ({
      paused: el.paused, time: el.currentTime, shown: el.hasAttribute('data-playing'),
      muted: el.muted, inline: el.playsInline, source: el.getAttribute('src'),
    })));
    const playing = () => page.waitForFunction(() => [...document.querySelectorAll('.ts-intro-video')]
      .every(el => !el.paused && el.readyState >= 2 && el.hasAttribute('data-playing')));
    let passed = 0;
    async function check(name, fn) { await fn(); passed++; console.log('PASS  ' + name); }
    await open();
    await check('empty, one-tap, miss-only and populated history keep their actual rules', async () => {
      await seed('empty'); assert.deepEqual(await stats(), ['0', '--', '--']);
      assert.equal(await page.locator('#ts-view-results-btn').isVisible(), false);
      for (const kind of ['one', 'miss']) {
        await seed(kind); assert.deepEqual(await stats(), ['1', '--', '--']);
        assert.equal(await page.locator('#ts-view-results-btn').isVisible(), true);
      }
      await seed('full'); assert.deepEqual(await stats(), ['4', '4.0s', '1.6s']);
      await open(); assert.deepEqual(await stats(), ['4', '4.0s', '1.6s']);
    });
    for (const [width, height] of [[360, 800], [390, 844], [430, 932], [360, 640]]) {
      await check(`layout and reachable controls at ${width}x${height}, including font fallback`, async () => {
        await page.setViewportSize({ width, height });
        const layout = await page.evaluate(() => {
          const screen = document.getElementById('screen-timestamp-brief');
          const copy = screen.querySelector('.ts-intro-copy').getBoundingClientRect();
          const orbit = screen.querySelector('.ts-intro-orbit').getBoundingClientRect();
          return { width: screen.clientWidth, scrollWidth: screen.scrollWidth, copyRight: copy.right, orbitLeft: orbit.left,
            font: parseFloat(getComputedStyle(screen.querySelector('.ts-intro-copy')).fontSize) };
        });
        assert.ok(layout.scrollWidth <= layout.width, JSON.stringify(layout));
        assert.ok(layout.copyRight <= layout.orbitLeft, 'artwork is separate from instructions');
        assert.ok(layout.font >= 14, 'readable body text');
        for (const selector of ['.ts-intro-back', '.ts-intro-begin', '#ts-view-results-btn']) {
          const button = page.locator(selector);
          await button.scrollIntoViewIfNeeded();
          const box = await button.boundingBox();
          assert.ok(box.width >= 44 && box.height >= 44, 'touch target ' + selector);
          assert.ok(box.x >= 0 && box.x + box.width <= width + 1, 'horizontal fit');
          assert.ok(box.y >= 0 && box.y + box.height <= height - 72 + 1, 'above navigation');
          assert.ok(await button.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), 'not covered');
        }
      });
    }
    await check('artwork cannot intercept taps and controls have visible keyboard focus', async () => {
      assert.ok(await page.locator('.ts-intro-planet, .ts-intro-orbit').evaluateAll(els => els.every(el => el.getAttribute('aria-hidden') === 'true' && getComputedStyle(el).pointerEvents === 'none')));
      await page.locator('.ts-intro-back').focus();
      await page.keyboard.press('Tab');
      assert.ok(await page.locator('.ts-intro-begin').evaluate(el => el.matches(':focus-visible') && parseFloat(getComputedStyle(el).outlineWidth) >= 2));
    });
    await check('silent inline video advances, pauses off-screen, and resumes on return', async () => {
      await playing();
      const first = await motion();
      assert.ok(first.every(v => !v.paused && v.muted && v.inline && v.shown));
      await page.waitForTimeout(180);
      assert.ok((await motion()).every((v, i) => v.time !== first[i].time));
      await page.locator('.ts-intro-back').click();
      assert.equal(await page.evaluate(() => currentScreen), 'psi');
      const paused = await motion(); assert.ok(paused.every(v => v.paused && !v.shown));
      await page.waitForTimeout(180); assert.deepEqual(await motion(), paused);
      await page.evaluate(() => navigate('timestamp')); await playing();
      assert.ok(await page.locator('#nav-psi').evaluate(el => el.classList.contains('active')));
    });
    await check('visibility-change handling pauses decoration without changing trial state', async () => {
      // Simulate document visibility, not a physical device background/resume.
      const snapshot = await page.evaluate(() => JSON.stringify(TS_STATE));
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
      const paused = await motion(); assert.ok(paused.every(v => v.paused && !v.shown));
      await page.waitForTimeout(180); assert.deepEqual(await motion(), paused);
      await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
      await playing(); assert.equal(await page.evaluate(() => JSON.stringify(TS_STATE)), snapshot);
    });
    await check('reduced motion pauses video and displays loaded still images', async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => [...document.querySelectorAll('.ts-intro-video')].every(v => v.paused));
      assert.ok((await motion()).every(v => v.paused && !v.shown));
      assert.ok(await page.locator('.ts-intro-planet img, .ts-intro-orbit img').evaluateAll(els => els.every(el => el.complete && el.naturalWidth > 0)));
      await page.emulateMedia({ reducedMotion: 'no-preference' }); await playing();
    });
    await check('initial reduced motion shows stills without loading video sources', async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(); assert.ok((await motion()).every(v => v.source === null && v.paused));
      await page.emulateMedia({ reducedMotion: 'no-preference' }); await playing();
    });
    await check('unavailable video leaves still artwork and usable controls', async () => {
      await context.route('**/assets/presentiment/*.mp4', route => route.abort());
      await open(); await page.waitForTimeout(300);
      assert.ok((await motion()).every(v => !v.shown));
      assert.ok(await page.locator('.ts-intro-planet img, .ts-intro-orbit img').evaluateAll(els => els.every(el => el.complete && el.naturalWidth > 0)));
      assert.deepEqual(await stats(), ['4', '4.0s', '1.6s']);
      await context.unroute('**/assets/presentiment/*.mp4');
      await page.locator('.ts-intro-back').click();
      await page.evaluate(() => navigate('timestamp')); await playing();
    });
    await check('blocked autoplay keeps still artwork without a page error', async () => {
      await page.evaluate(() => {
        window.__platePlay = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('Blocked by test', 'NotAllowedError'));
        navigate('psi');
      });
      await page.evaluate(() => navigate('timestamp'));
      await page.waitForTimeout(80); assert.ok((await motion()).every(v => v.paused && !v.shown));
      await page.evaluate(() => { HTMLMediaElement.prototype.play = window.__platePlay; delete window.__platePlay; navigate('psi'); });
      await page.evaluate(() => navigate('timestamp')); await playing();
    });
    await check('analysis and Begin Trials retain their real destinations', async () => {
      await page.locator('#ts-view-results-btn').click();
      assert.equal(await page.evaluate(() => currentScreen), 'timestamp-results');
      await page.evaluate(() => navigate('timestamp'));
      await page.locator('.ts-intro-begin').click();
      assert.deepEqual(await page.evaluate(() => ({ screen: currentScreen, active: TS_STATE.trialActive, trial: TS_STATE.trialNum })), { screen: 'timestamp-session', active: true, trial: 1 });
      assert.equal(await page.locator('#nav').isVisible(), false);
      await page.locator('#screen-timestamp-session button', { hasText: 'End' }).click();
      assert.equal(await page.evaluate(() => TS_STATE.trialActive), false);
      await page.evaluate(() => navigate('timestamp')); assert.deepEqual(await stats(), ['4', '4.0s', '1.6s']);
    });
    await check('new introduction CSS does not affect Home, PSI, Settings or navigation', async () => {
      await page.evaluate(() => navigate('home'));
      const selector = '#screen-home, #screen-home .module-card, #screen-home .screen-title, #screen-psi, #screen-profile, #screen-profile button, #nav, .nav-item';
      const read = () => page.locator(selector).evaluateAll(els => els.map(el => {
        const css = getComputedStyle(el);
        return ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'padding', 'borderRadius', 'display', 'position'].map(key => css[key]);
      }));
      const before = await read();
      await page.evaluate(() => {
        const style = document.querySelector('style');
        style.textContent = style.textContent.replace(/\/\* Presentiment introduction only\.[\s\S]*?(?=\/\* Results screen \*\/)/, '');
      });
      assert.deepEqual(await read(), before);
    });
    await check('the real local service worker serves artwork and video after an offline reload', async () => {
      const offlineContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
      try {
        await offlineContext.addInitScript(() => {
          localStorage.setItem('ablty_onboarded', '1'); localStorage.setItem('ablty_splash', '1');
          const mm = window.matchMedia.bind(window);
          window.matchMedia = q => q.includes('display-mode: standalone')
            ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q);
        });
        await offlineContext.route('**/*', route => {
          if (route.request().url().startsWith(base + '/')) return route.continue();
          if (route.request().url().endsWith('.js')) return route.fulfill({ contentType: 'text/javascript', body: '' });
          return route.abort();
        });
        const offlinePage = await offlineContext.newPage();
        offlinePage.on('pageerror', e => errors.push(e.message));
        await offlinePage.goto(base + '/app.html', { waitUntil: 'networkidle' });
        await offlinePage.evaluate(() => navigator.serviceWorker.register('/sw.js'));
        await offlinePage.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
        assert.ok(await offlinePage.evaluate(async () => {
          const paths = ['menu-planet.webp', 'menu-orbit.webp', 'menu-planet.mp4', 'menu-orbit.mp4', 'trial-horizon.webp', 'trial-horizon.mp4'];
          const cached = await Promise.all(paths.map(p => caches.match('/assets/presentiment/' + p)));
          return cached.every(r => r && r.status === 200);
        }));
        await offlineContext.setOffline(true);
        await offlinePage.reload({ waitUntil: 'domcontentloaded' });
        await offlinePage.evaluate(() => { document.getElementById('splash-screen').style.display = 'none'; navigate('timestamp'); });
        await offlinePage.waitForFunction(() => [...document.querySelectorAll('.ts-intro-video')].every(v => !v.paused && v.readyState >= 2 && v.currentTime > 0));
        assert.ok(await offlinePage.locator('.ts-intro-planet img, .ts-intro-orbit img').evaluateAll(els => els.every(el => el.complete && el.naturalWidth > 0)));
        await offlinePage.evaluate(() => { Math.random = () => .95; });
        await offlinePage.locator('.ts-intro-begin').click();
        await offlinePage.waitForFunction(() => { const v = document.querySelector('.ts-trial-video'); return !v.paused && v.readyState >= 2 && v.currentTime > 0; });
        assert.equal(await offlinePage.evaluate(() => currentScreen), 'timestamp-session');
        await offlinePage.locator('#screen-timestamp-session button', { hasText: 'End' }).click();
      } finally { await offlineContext.close(); }
    });
    await check('no JavaScript errors', async () => assert.deepEqual(errors, []));
    console.log(passed + ' passed');
  } finally { if (browser) await browser.close(); server.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
