// Presentiment session checks in a real browser with synthetic guest data.
// Trial-flow checks inject Playwright's clock and a fixed random draw in the browser only.
// ABLTY_TEST_APP may point at an extracted baseline app.html for behavior-only comparisons.
// Run: CHROME_PATH=/path/to/chromium node tests/presentiment-session.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const baseline = process.env.ABLTY_TEST_APP;

async function main() {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    let file = path.resolve(ROOT, '.' + (p === '/' ? '/index.html' : p));
    if (p === '/app.html' && baseline) file = path.resolve(baseline);
    if ((!file.startsWith(ROOT + path.sep) && file !== path.resolve(baseline || ROOT)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.mp4': 'video/mp4', '.webp': 'image/webp' }[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  const results = [];
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    async function fixture(clock = true) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
      await context.addInitScript(() => {
        localStorage.setItem('ablty_onboarded', '1'); localStorage.setItem('ablty_splash', '1');
        const mm = window.matchMedia.bind(window);
        window.matchMedia = q => q.includes('display-mode: standalone')
          ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q);
      });
      await context.route('**/*', route => {
        if (route.request().url().startsWith(base + '/')) return route.continue();
        if (route.request().url().endsWith('.js')) return route.fulfill({ contentType: 'text/javascript', body: '' });
        return route.abort();
      });
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(base + '/app.html', { waitUntil: 'networkidle' });
      await page.evaluate(() => { document.getElementById('splash-screen').style.display = 'none'; navigate('timestamp'); });
      if (clock) {
        const epoch = new Date('2026-01-01T12:00:00Z');
        await page.clock.install({ time: epoch }); await page.clock.pauseAt(new Date(epoch.getTime() + 1000));
      }
      await page.evaluate(() => { Math.random = () => .5; });
      return { context, page, errors };
    }
    async function check(name, fn, clock = true) {
      const f = await fixture(clock);
      try { await fn(f); assert.deepEqual(f.errors, []); results.push(true); console.log('PASS  ' + name); }
      catch (e) { results.push(false); console.error('FAIL  ' + name + '\n' + e.stack); }
      finally { await f.context.close(); }
    }
    const start = p => p.locator('#screen-timestamp-brief button[onclick="openTimestampSession()"] ').click();
    const end = p => p.locator('#screen-timestamp-session button', { hasText: 'End' }).click();
    const state = p => p.evaluate(() => ({
      screen: currentScreen, trial: TS_STATE.trialNum, active: TS_STATE.trialActive,
      event: TS_STATE.eventTime, start: TS_STATE.trialStart, tap: TS_STATE.tapTime,
      count: document.getElementById('ts-countdown-num').textContent,
      ring: parseFloat(document.getElementById('ts-ring-fill').style.strokeDashoffset),
      progress: parseFloat(document.getElementById('ts-progress-bar').style.width),
      mean: document.getElementById('ts-batch-mean').textContent,
      saved: loadTimestampAll(), taps: loadTimestampTrials(),
      feedback: document.getElementById('ts-delta-feedback').classList.contains('visible'),
    }));

    await check('complete three-trial batch: countdown, tap, miss, repeated taps, score, save and reload', async ({ page: p }) => {
      await start(p); let s = await state(p);
      assert.equal(s.trial, 1); assert.equal(s.count, '30'); assert.equal(s.event, 15);
      assert.equal(s.ring, 0); assert.equal(s.progress, 0);
      await p.clock.runFor(1000); s = await state(p);
      assert.equal(s.count, '29'); assert.ok(Math.abs(s.ring - 515.22 / 30) < .001);
      assert.ok(Math.abs(s.progress - 100 / 30) < .001);
      await p.locator('#ts-trial-area').click();
      await p.evaluate(() => { for (let i = 0; i < 8; i++) timestampTap(); });
      assert.equal((await state(p)).tap, 1);
      await p.clock.runFor(1500);
      assert.ok(await p.locator('#ts-flash-overlay').evaluate(el => el.classList.contains('firing')));
      await p.clock.runFor(400); s = await state(p);
      assert.equal(s.saved.length, 1); assert.equal(s.saved[0].delta, -14); assert.equal(s.saved[0].miss, false);
      assert.equal(s.feedback, true); assert.equal(s.mean, 'Avg: 14.0s');
      assert.equal(await p.locator('#ts-delta-value').textContent(), '14.0s');
      await p.clock.runFor(2200); assert.equal((await state(p)).trial, 2);
      await p.clock.runFor(15400); s = await state(p);
      assert.equal(s.saved.length, 2); assert.equal(s.saved.filter(t => t.miss).length, 1);
      assert.equal(s.mean, 'Avg: 14.0s'); assert.equal(await p.locator('#ts-delta-value').textContent(), 'MISS');
      await p.clock.runFor(2200); assert.equal((await state(p)).trial, 3);
      await p.clock.runFor(4000);
      if (baseline) await p.locator('#ts-trial-area').click();
      else { await p.locator('#ts-trial-area').focus(); await p.keyboard.press('Space'); }
      await p.evaluate(() => { for (let i = 0; i < 8; i++) timestampTap(); });
      await p.clock.runFor(4100); s = await state(p);
      assert.equal(s.screen, 'timestamp-results'); assert.equal(s.saved.length, 3); assert.equal(s.taps.length, 2);
      assert.equal(new Set(s.saved.map(t => t.id)).size, 3);
      assert.equal(await p.locator('#ts-result-mean').textContent(), '12.5s');
      assert.equal(await p.locator('#ts-result-missrate').textContent(), '33%');
      await p.evaluate(() => navigate('timestamp'));
      assert.equal(await p.locator('#ts-brief-trials').textContent(), '3');
      assert.equal(await p.locator('#ts-brief-mean').textContent(), '--');
      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.evaluate(() => { document.getElementById('splash-screen').style.display = 'none'; navigate('timestamp'); });
      assert.equal((await state(p)).saved.length, 3);
      await p.locator('#ts-view-results-btn').click();
      assert.equal(await p.locator('#ts-result-mean').textContent(), '12.5s');
    });

    for (const phase of ['countdown', 'fast-forward', 'flash', 'miss flash', 'feedback', 'transition']) {
      await check('End during ' + phase + ' stops the batch without later trials or results', async ({ page: p }) => {
        await start(p); await p.clock.runFor(1000);
        if (phase === 'miss flash') await p.clock.runFor(14100);
        else if (phase !== 'countdown') {
          await p.locator('#ts-trial-area').click();
          await p.clock.runFor({ 'fast-forward': 500, flash: 1600, feedback: 1900, transition: 4000 }[phase]);
        }
        const before = await state(p); await end(p);
        assert.equal((await state(p)).screen, 'timestamp-results');
        await p.clock.runFor(35000); const after = await state(p);
        assert.equal(after.active, false); assert.equal(after.trial, before.trial);
        assert.equal(after.saved.length, before.saved.length);
      });
    }

    for (const phase of ['flash', 'feedback', 'transition', 'final feedback', 'final transition']) {
      await check('new batch after End during ' + phase + ' is unaffected by the old callbacks', async ({ page: p }) => {
        await start(p);
        if (phase.startsWith('final')) {
          for (let i = 0; i < 2; i++) {
            await p.clock.runFor(1000); await p.locator('#ts-trial-area').click();
            await p.clock.runFor(4100);
          }
          assert.equal((await state(p)).trial, 3);
        }
        await p.clock.runFor(1000); await p.locator('#ts-trial-area').click();
        await p.clock.runFor(phase === 'flash' ? 1600 : phase.endsWith('transition') ? 4000 : 1900);
        const completed = (await state(p)).saved;
        await end(p); await p.evaluate(() => navigate('timestamp')); await start(p);
        const fresh = await state(p); assert.equal(fresh.trial, 1);
        await p.clock.runFor(3000); const after = await state(p);
        assert.equal(after.screen, 'timestamp-session'); assert.equal(after.trial, 1);
        assert.equal(after.active, true); assert.equal(after.start, fresh.start);
        assert.equal(after.tap, null); assert.equal(after.count, '27');
        assert.deepEqual(after.saved, completed);
        await p.locator('#ts-trial-area').click(); await p.clock.runFor(1900);
        const result = await state(p);
        assert.equal(result.saved.length, completed.length + 1);
        const newResults = result.saved.filter(t => !completed.some(old => old.id === t.id));
        assert.equal(newResults.length, 1); assert.equal(newResults[0].delta, -12);
        await end(p); await p.clock.runFor(35000);
        assert.deepEqual((await state(p)).saved, result.saved);
      });
    }

    if (!baseline) {
      for (const [width, height] of [[360, 800], [390, 844], [430, 932], [360, 640]]) {
        await check(`trial layout and real tap target at ${width}x${height}`, async ({ page: p }) => {
          await p.setViewportSize({ width, height }); await start(p); await p.clock.runFor(1000);
          const layout = await p.evaluate(() => {
            const s = document.getElementById('screen-timestamp-session');
            const rect = selector => { const r = s.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
            return { width: s.clientWidth, scrollWidth: s.scrollWidth, end: rect('.ts-session-end'), ring: rect('.ts-countdown-wrap'), prompt: rect('#ts-tap-prompt'), header: rect('.ts-session-header'),
              nav: getComputedStyle(document.getElementById('nav')).display,
              radius: document.getElementById('ts-ring-fill').getAttribute('r'), circumference: document.getElementById('ts-ring-fill').getAttribute('stroke-dasharray') };
          });
          assert.ok(layout.scrollWidth <= layout.width); assert.ok(layout.end.height >= 44);
          for (const key of ['end', 'ring', 'prompt']) {
            assert.ok(layout[key].left >= 0 && layout[key].right <= width + 1, key + ' fits width');
            assert.ok(layout[key].top >= 0 && layout[key].bottom <= height, key + ' fits height');
          }
          assert.ok(layout.ring.top > layout.header.bottom); assert.ok(layout.prompt.top > layout.ring.bottom);
          assert.equal(await p.locator('#nav').isVisible(), false);
          assert.equal(layout.radius, '82'); assert.equal(layout.circumference, '515.22');
          assert.ok(await p.locator('.ts-trial-horizon').evaluate(el => el.getAttribute('aria-hidden') === 'true' && getComputedStyle(el).pointerEvents === 'none'));
          const r = layout.ring; await p.mouse.click((r.left + r.right) / 2, (r.top + r.bottom) / 2);
          assert.equal((await state(p)).tap, 1);
          await end(p);
        });
      }
      await check('horizon playback is silent, independent, and pauses with visibility/reduced motion', async ({ page: p }) => {
        await start(p);
        const playing = () => p.waitForFunction(() => { const v = document.querySelector('.ts-trial-video'); return !v.paused && v.readyState >= 2 && v.hasAttribute('data-playing'); });
        await playing();
        assert.ok(await p.locator('.ts-trial-video').evaluate(v => v.muted && v.playsInline));
        assert.ok(await p.locator('.ts-intro-video').evaluateAll(vs => vs.every(v => v.paused)));
        const before = await state(p);
        await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
        assert.equal(await p.locator('.ts-trial-video').evaluate(v => v.paused), true);
        await p.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
        await playing();
        await p.emulateMedia({ reducedMotion: 'reduce' });
        await p.waitForFunction(() => document.querySelector('.ts-trial-video').paused);
        assert.ok(await p.locator('.ts-trial-horizon img').evaluate(img => img.complete && img.naturalWidth > 0));
        const after = await state(p); assert.equal(after.event, before.event); assert.equal(after.start, before.start); assert.equal(after.trial, before.trial);
        await p.emulateMedia({ reducedMotion: 'no-preference' }); await playing();
        await end(p); assert.equal(await p.locator('.ts-trial-video').evaluate(v => v.paused), true);
      });
      await check('new trial CSS does not change introduction, Zener or navigation styles', async ({ page: p }) => {
        const selector = '#screen-timestamp-brief, #screen-timestamp-brief button, #screen-zener-brief, #screen-zener-session, #screen-zener-session button, .nav-item';
        const read = () => p.locator(selector).evaluateAll(els => els.map(el => {
          const css = getComputedStyle(el); return ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'padding', 'borderRadius', 'display', 'position'].map(k => css[k]);
        }));
        const before = await read();
        await p.evaluate(() => { const style = document.querySelector('style'); style.textContent = style.textContent.replace(/\/\* Presentiment trial visuals\.[\s\S]*?(?=\/\* Brief screen stats \*\/)/, ''); });
        assert.deepEqual(await read(), before);
      }, false);
    }
    const failed = results.filter(r => !r).length;
    console.log((results.length - failed) + ' passed, ' + failed + ' failed');
    if (failed) process.exitCode = 1;
  } finally { if (browser) await browser.close(); server.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
