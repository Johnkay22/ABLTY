// Settings pull-to-close, exercised in headless Chrome with real touch events.
// This is not a physical phone. It checks the gesture rules in a browser.
//
// Run: NODE_PATH="$(npm root -g)" node tests/settings-pull-to-close.test.js
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

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/' || p === '/app') p = '/app.html';
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.txt': 'text/plain' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function readStateExpr() {
  return `(() => {
    const screen = document.getElementById('screen-profile');
    const home = document.getElementById('screen-home');
    const indicator = document.getElementById('profile-pull-indicator');
    const t = getComputedStyle(screen).transform;
    let y = 0;
    if (t && t !== 'none') y = new DOMMatrixReadOnly(t).m42;
    const topEl = document.elementFromPoint(195, 10);
    const ind = indicator.getBoundingClientRect();
    const signup = document.getElementById('screen-signup');
    const modal = document.getElementById('sync-details-modal');
    return {
      y: Math.round(y * 10) / 10,
      text: indicator.textContent,
      shown: indicator.classList.contains('show'),
      ready: indicator.classList.contains('ready'),
      screen: currentScreen,
      profileActive: screen.classList.contains('active'),
      homeVisible: getComputedStyle(home).visibility,
      homePointer: getComputedStyle(home).pointerEvents,
      greeting: document.getElementById('home-greeting').textContent,
      homeScroll: home.scrollTop,
      marker: home.dataset.marker || '',
      indicatorTop: Math.round(ind.top),
      topId: topEl ? (topEl.id || topEl.className || topEl.tagName) : '',
      signup: signup.classList.contains('active'),
      modal: modal.style.display,
      dragging: screen.classList.contains('profile-pull-dragging'),
      returning: screen.classList.contains('profile-pull-returning'),
      dismissing: screen.classList.contains('profile-pull-dismissing'),
      dismissed: screen.classList.contains('profile-pull-dismissed'),
      inlineTransform: screen.style.transform,
      scrimActive: document.getElementById('profile-pull-scrim').classList.contains('active'),
      scrimOpacity: Number(getComputedStyle(document.getElementById('profile-pull-scrim')).opacity),
      edgeActive: document.getElementById('profile-pull-edge').classList.contains('active'),
      edgeOpacity: Number(getComputedStyle(document.getElementById('profile-pull-edge')).opacity),
      edgeY: (() => { const et = getComputedStyle(document.getElementById('profile-pull-edge')).transform; return et && et !== 'none' ? Math.round(new DOMMatrixReadOnly(et).m42 * 10) / 10 : 0; })(),
      shieldActive: document.getElementById('profile-pull-shield').classList.contains('active'),
      homeRevealed: home.classList.contains('profile-pull-revealed'),
      homeLeft: Math.round(home.getBoundingClientRect().left),
      navPointer: document.getElementById('nav').style.pointerEvents,
    };
  })()`;
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
    browser = await chromium.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  } catch (e) {
    console.log('SKIP  Chrome could not be launched: ' + String(e.message || e).split('\n')[0]);
    server.close();
    process.exit(77);
  }

  const results = [];
  async function check(name, fn) {
    try {
      await fn();
      results.push(['PASS', name]);
      console.log('PASS  ' + name);
    } catch (e) {
      results.push(['FAIL', name]);
      console.log('FAIL  ' + name + '\n      ' + String(e.stack || e).split('\n').slice(0, 8).join('\n      '));
    }
  }

  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q)
      ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
      : mm(q));
    localStorage.setItem('ablty_onboarded', '1');
    localStorage.setItem('ablty_splash', '1');
  });
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.endsWith('.js')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + '/app.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof navigate === 'function' && typeof bindProfilePullToDismiss === 'function');
  await page.evaluate(() => {
    const splash = document.getElementById('splash-screen');
    if (splash) { splash.classList.add('hidden'); splash.style.display = 'none'; }
    const home = document.getElementById('screen-home');
    home.querySelector('.screen-inner').style.minHeight = '1800px';
    document.querySelector('#screen-profile .screen-inner').style.paddingBottom = '1400px';
    home.dataset.marker = 'kept';
    home.scrollTop = 80;
    document.getElementById('home-greeting').textContent = 'STAY-HOME';
  });

  const state = () => page.evaluate(readStateExpr());

  async function openSettings() {
    await page.evaluate(() => {
      const modal = document.getElementById('sync-details-modal');
      if (modal) modal.style.display = 'none';
      document.querySelectorAll('.auth-screen').forEach((el) => el.classList.remove('active'));
      if (currentScreen !== 'profile') navigate('profile');
      const screen = document.getElementById('screen-profile');
      screen.scrollTop = 0;
      screen.classList.remove('profile-pull-dismissed');
      if (!screen.classList.contains('profile-pull-dragging')) screen.style.transform = '';
    });
    await page.waitForFunction(() => currentScreen === 'profile');
    // A pull only starts once Settings has stopped scrolling for a moment.
    await page.waitForTimeout(280);
  }

  // Everything the pull adds is gone and Settings is back at rest.
  function assertCleanOpen(st, label) {
    assert.strictEqual(st.screen, 'profile', label + ': screen');
    assert.ok(Math.abs(st.y) < 1, label + ': y=' + st.y);
    assert.strictEqual(st.inlineTransform, '', label + ': inline transform left behind');
    assert.strictEqual(st.dragging || st.returning || st.dismissing || st.dismissed, false, label + ': pull class left behind');
    assert.strictEqual(st.scrimActive, false, label + ': dim layer still on');
    assert.strictEqual(st.edgeActive, false, label + ': edge glow still on');
    assert.strictEqual(st.shieldActive, false, label + ': tap shield still on');
    assert.strictEqual(st.homeRevealed, false, label + ': Home still revealed');
    assert.strictEqual(st.navPointer, '', label + ': nav still blocked');
    assert.strictEqual(st.shown, false, label + ': hint still showing');
  }

  // One Chrome touch for the whole gesture. A new debugger session cannot
  // end a finger that a previous session started.
  async function drag({ x = 200, y0 = 160, y1 = 160, ms = 0, steps = 8, release = true, cancel = false }) {
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: x, y: y0, id: 1 }],
    });
    const n = Math.max(1, steps);
    const slice = ms > 0 ? ms / n : 0;
    for (let i = 1; i <= n; i++) {
      const y = y0 + (y1 - y0) * (i / n);
      if (slice) await page.waitForTimeout(slice);
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x, y: y, id: 1 }],
      });
    }
    async function end(kind) {
      await client.send('Input.dispatchTouchEvent', {
        type: kind === 'cancel' ? 'touchCancel' : 'touchEnd',
        touchPoints: [],
      });
      await client.detach();
    }
    async function move(y) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x, y: y, id: 1 }],
      });
    }
    if (release || cancel) {
      await end(cancel ? 'cancel' : 'end');
      return null;
    }
    return { end, move };
  }

  // Timing-sensitive flicks. Debugger round trips are too slow to imitate a
  // finger that is only down for a fraction of a second, so this path fires
  // the same pointer listeners in one turn.
  async function flick({ y0, y1, pointerId }) {
    return page.evaluate(({ y0, y1, pointerId }) => {
      const target = document.querySelector('#screen-profile .display-lg');
      const t0 = performance.now();
      const fire = (type, y) => {
        const touch = new Touch({ identifier: pointerId, target: target, clientX: 200, clientY: y });
        const down = type !== 'touchend';
        target.dispatchEvent(new TouchEvent(type, {
          touches: down ? [touch] : [], targetTouches: down ? [touch] : [], changedTouches: [touch],
          bubbles: true, cancelable: true,
        }));
      };
      fire('touchstart', y0);
      for (let i = 1; i <= 6; i++) fire('touchmove', y0 + (y1 - y0) * (i / 6));
      fire('touchend', y1);
      return performance.now() - t0;
    }, { y0, y1, pointerId });
  }

  async function idle() {
    await page.waitForFunction(() => {
      const screen = document.getElementById('screen-profile');
      return !screen.classList.contains('profile-pull-dragging')
        && !screen.classList.contains('profile-pull-returning')
        && !screen.classList.contains('profile-pull-dismissing');
    });
    await page.waitForTimeout(120);
  }

  await check('page loads and the close hint uses the new wording', async () => {
    assert.deepStrictEqual(errors, []);
    const text = await page.evaluate(() => document.getElementById('profile-pull-indicator').textContent);
    assert.strictEqual(text, 'Pull down to close.');
    assert.ok(!/PULL TO CLOSE|RELEASE TO CLOSE/.test(await page.content()), 'old all-caps hint is gone');
  });

  await check('while the finger is down, Home shows through and Settings stays open', async () => {
    await openSettings();
    const before = await state();
    assert.strictEqual(before.greeting, 'STAY-HOME');
    assert.strictEqual(before.homeScroll, 80);
    assert.strictEqual(before.marker, 'kept');
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: 200, y: 140, id: 1 }],
    });
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await page.waitForTimeout(30);
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: 200, y: 140 + (320 * i) / steps, id: 1 }],
      });
    }
    const held = await state();
    assert.strictEqual(held.screen, 'profile', 'finger still down, Settings stays open');
    assert.ok(held.y > 200, 'panel kept moving past a small cap, y=' + held.y);
    assert.ok(held.y < 320, 'panel did not jump ahead of the finger, y=' + held.y);
    assert.strictEqual(held.homeLeft, 0, 'revealed Home sits in its final place, left=' + held.homeLeft);
    assert.strictEqual(held.scrimActive, true, 'exposed Home is dimmed and blurred');
    assert.ok(held.scrimOpacity > 0.95, 'past the close line the dim is at full strength, ' + held.scrimOpacity);
    assert.strictEqual(held.edgeActive, true, 'edge glow is on');
    assert.ok(held.edgeOpacity > 0.9, 'edge glow is visible, ' + held.edgeOpacity);
    assert.ok(Math.abs(held.edgeY - held.y) < 1, 'edge glow sits on the panel edge (' + held.edgeY + ' vs ' + held.y + ')');
    assert.strictEqual(held.text, 'Release to close.');
    assert.strictEqual(held.ready, true);
    assert.strictEqual(held.homeVisible, 'visible');
    assert.strictEqual(held.homePointer, 'none');
    assert.strictEqual(held.greeting, 'STAY-HOME');
    assert.strictEqual(held.homeScroll, 80);
    assert.strictEqual(held.marker, 'kept');
    assert.strictEqual(held.topId, 'profile-pull-shield', 'tap target in the revealed strip is the shield, got ' + held.topId);
    await page.screenshot({ path: '/opt/cursor/artifacts/settings-pull-reveals-home.png' });
    // Move back above the line and release, so this check does not close Settings.
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: 200, y: 220, id: 1 }],
    });
    await page.waitForTimeout(40);
    const back = await state();
    assert.strictEqual(back.text, 'Pull down to close.');
    assert.strictEqual(back.screen, 'profile');
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.detach();
    await idle();
    const done = await state();
    assertCleanOpen(done, 'after moving back and releasing');
  });

  await check('the hint moves with the panel and the close line can be undone', async () => {
    await openSettings();
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: 200, y: 150, id: 1 }],
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: 200, y: 280, id: 1 }],
    });
    await page.waitForTimeout(40);
    const mid = await state();
    assert.strictEqual(mid.text, 'Pull down to close.');
    assert.strictEqual(mid.screen, 'profile');
    assert.ok(mid.y > 80 && mid.y < 180, 'mid pull y=' + mid.y);
    assert.ok(mid.y < 130 - 10, 'resistance: panel moves less than the finger, y=' + mid.y);
    assert.ok(mid.scrimOpacity > 0.2 && mid.scrimOpacity < 0.85, 'dim follows the pull distance, ' + mid.scrimOpacity);
    const topMid = mid.indicatorTop;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: 200, y: 470, id: 1 }],
    });
    await page.waitForTimeout(40);
    const far = await state();
    assert.strictEqual(far.text, 'Release to close.');
    assert.ok(far.scrimOpacity > mid.scrimOpacity, 'dim grows with the pull');
    assert.ok(far.y > mid.y + 100, 'panel kept moving after the close line, y=' + far.y);
    assert.ok(far.indicatorTop > topMid + 80, 'hint moved with the panel (' + topMid + ' then ' + far.indicatorTop + ')');
    assert.strictEqual(far.screen, 'profile');
    assert.strictEqual(far.greeting, 'STAY-HOME');
    await page.screenshot({ path: '/opt/cursor/artifacts/settings-pull-release-to-close.png' });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: 200, y: 240, id: 1 }],
    });
    await page.waitForTimeout(40);
    const back = await state();
    assert.strictEqual(back.text, 'Pull down to close.');
    assert.ok(back.y < far.y, 'panel followed the finger back up');
    assert.strictEqual(back.screen, 'profile');
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.detach();
    await idle();
    const done = await state();
    assert.strictEqual(done.screen, 'profile');
    assert.strictEqual(done.profileActive, true);
    assert.ok(Math.abs(done.y) < 1, 'returned to the resting position, y=' + done.y);
    assert.strictEqual(done.shown, false);
    assert.strictEqual(done.greeting, 'STAY-HOME');
    assert.strictEqual(done.homeScroll, 80);
  });

  await check('release past the close line slides Settings away onto Home', async () => {
    await openSettings();
    const held = await drag({ y0: 140, y1: 480, ms: 480, steps: 14, release: false });
    const started = Date.now();
    await held.end('end');
    await page.waitForTimeout(40);
    const early = await state();
    assert.strictEqual(early.screen, 'profile', 'does not jump home while the close animation is still running');
    assert.ok(early.dismissing || early.y > 200, 'close animation is in progress');
    await page.waitForFunction(() => currentScreen === 'home', { timeout: 2000 });
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 250, 'close animation took ' + elapsed + 'ms, expected the 340ms slide');
    const done = await state();
    assert.strictEqual(done.screen, 'home');
    assert.strictEqual(done.profileActive, false);
    assert.strictEqual(done.greeting, 'STAY-HOME');
    assert.strictEqual(done.homeScroll, 80);
    assert.strictEqual(done.marker, 'kept');
    assert.strictEqual(done.homePointer, 'all');
    assert.strictEqual(done.homeLeft, 0);
    assert.strictEqual(done.homeRevealed, false);
    assert.strictEqual(done.scrimActive, false, 'Home is sharp and full brightness again');
    assert.strictEqual(done.edgeActive, false);
    assert.strictEqual(done.shieldActive, false);
    assert.strictEqual(done.navPointer, '');
    await page.screenshot({ path: '/opt/cursor/artifacts/settings-pull-closed-home.png' });
  });

  await check('a short pull returns Settings and leaves it open', async () => {
    await openSettings();
    await drag({ y0: 180, y1: 280, ms: 400, steps: 8, release: true });
    await idle();
    const done = await state();
    assertCleanOpen(done, 'short pull');
    assert.strictEqual(done.greeting, 'STAY-HOME');
  });

  await check('a quick flick does not close Settings', async () => {
    await openSettings();
    // Far enough to pass the distance line, but the finger is only down for
    // a few milliseconds. Speed is not allowed to close Settings.
    const elapsed = await flick({ y0: 150, y1: 470, pointerId: 4 });
    assert.ok(elapsed < 160, 'harness flick took ' + elapsed + 'ms');
    await idle();
    const done = await state();
    assert.strictEqual(done.screen, 'profile', 'fast flick stayed on Settings');
    assert.ok(Math.abs(done.y) < 1, 'y=' + done.y);
    // A short touch, sent as a real browser touch, also stays open.
    await drag({ y0: 200, y1: 270, ms: 40, steps: 3, release: true });
    await idle();
    const short = await state();
    assert.strictEqual(short.screen, 'profile');
    assert.ok(Math.abs(short.y) < 1, 'y=' + short.y);
  });

  await check('scrolling up to the top during one touch does not close Settings', async () => {
    await openSettings();
    const scrollTop = await page.evaluate(() => {
      const screen = document.getElementById('screen-profile');
      screen.scrollTop = 420;
      return screen.scrollTop;
    });
    assert.ok(scrollTop > 100, 'Settings did not keep a scrolled position, scrollTop=' + scrollTop);
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: 200, y: 300, id: 1 }],
    });
    await page.evaluate(() => { document.getElementById('screen-profile').scrollTop = 0; });
    for (let i = 1; i <= 8; i++) {
      await page.waitForTimeout(40);
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: 200, y: 300 + i * 40, id: 1 }],
      });
    }
    const mid = await state();
    assert.strictEqual(mid.screen, 'profile');
    assert.ok(Math.abs(mid.y) < 1, 'no dismiss drag while the touch began below the top, y=' + mid.y);
    assert.notStrictEqual(mid.text, 'Release to close.');
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.detach();
    await idle();
    const done = await state();
    assert.strictEqual(done.screen, 'profile');
    assert.ok(Math.abs(done.y) < 1, 'y=' + done.y);
  });

  await check('a cancelled pull settles back open', async () => {
    await openSettings();
    await drag({ y0: 140, y1: 480, ms: 400, steps: 10, release: false, cancel: true });
    await idle();
    const done = await state();
    assertCleanOpen(done, 'cancelled pull');
    assert.strictEqual(done.greeting, 'STAY-HOME');
  });

  await check('an open Sync Details modal does not start the close gesture', async () => {
    await openSettings();
    await page.evaluate(() => openSyncDetails());
    const opened = await state();
    assert.strictEqual(opened.modal, 'flex');
    await drag({ x: 195, y0: 200, y1: 520, ms: 400, steps: 8, release: true });
    await page.waitForTimeout(200);
    const afterTouch = await state();
    assert.strictEqual(afterTouch.screen, 'profile');
    assert.strictEqual(afterTouch.modal, 'flex');
    assert.ok(Math.abs(afterTouch.y) < 1, 'y=' + afterTouch.y);
    // A touch that reaches the Settings screen while the modal is open is ignored.
    await page.evaluate(() => {
      const target = document.querySelector('#screen-profile .display-lg');
      const fire = (type, y) => {
        const touch = new Touch({ identifier: 9, target: target, clientX: 180, clientY: y });
        const down = type !== 'touchend';
        target.dispatchEvent(new TouchEvent(type, {
          touches: down ? [touch] : [], targetTouches: down ? [touch] : [], changedTouches: [touch],
          bubbles: true, cancelable: true,
        }));
      };
      fire('touchstart', 120);
      for (let y = 140; y <= 460; y += 40) fire('touchmove', y);
      fire('touchend', 460);
    });
    await page.waitForTimeout(200);
    const after = await state();
    assert.strictEqual(after.screen, 'profile');
    assert.strictEqual(after.modal, 'flex');
    assert.ok(Math.abs(after.y) < 1, 'y=' + after.y);
    await page.evaluate(() => closeSyncDetails());
    const closed = await state();
    assert.strictEqual(closed.modal, 'none');
  });

  await check('buttons, a normal tap, and opening Settings again still work', async () => {
    await openSettings();
    await page.waitForTimeout(100);
    const box = await page.locator('#settings-logged-out button', { hasText: 'Create Account' }).boundingBox();
    assert.ok(box, 'Create Account button is visible');
    await drag({ x: box.x + box.width / 2, y0: box.y + box.height / 2, y1: box.y + box.height / 2, ms: 0, steps: 1, release: true });
    await page.waitForTimeout(150);
    const signup = await state();
    assert.strictEqual(signup.signup, true, 'a tap still opens Create Account');
    assert.strictEqual(signup.screen, 'profile');
    await page.evaluate(() => document.querySelectorAll('.auth-screen').forEach((el) => el.classList.remove('active')));
    // Close, open, close again.
    await drag({ y0: 140, y1: 480, ms: 460, steps: 12, release: true });
    await page.waitForFunction(() => currentScreen === 'home');
    await openSettings();
    let again = await state();
    assert.strictEqual(again.screen, 'profile');
    await drag({ y0: 140, y1: 480, ms: 460, steps: 12, release: true });
    await page.waitForFunction(() => currentScreen === 'home');
    again = await state();
    assert.strictEqual(again.screen, 'home');
    assert.strictEqual(again.greeting, 'STAY-HOME');
    assert.strictEqual(again.marker, 'kept');
    await openSettings();
    const homeClicks = await page.evaluate(() => {
      window.__homeClicks = 0;
      const card = document.querySelector('#screen-home .module-card');
      card.addEventListener('click', () => { window.__homeClicks++; });
      return true;
    });
    assert.strictEqual(homeClicks, true);
    const heldTouch = await drag({ y0: 140, y1: 420, ms: 300, steps: 8, release: false });
    const blocked = await page.evaluate(() => {
      const el = document.elementFromPoint(195, 10);
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return { top: el && el.id, clicks: window.__homeClicks, screen: currentScreen };
    });
    assert.strictEqual(blocked.top, 'profile-pull-shield');
    assert.strictEqual(blocked.clicks, 0, 'the revealed strip did not activate a Home control');
    assert.strictEqual(blocked.screen, 'profile');
    await heldTouch.end('end');
    await idle();
  });

  await check('normal scrolling still works in both directions', async () => {
    await openSettings();
    // At the top, a finger moving up scrolls Settings and never pulls it.
    await drag({ y0: 600, y1: 300, ms: 300, steps: 15, release: true });
    await page.waitForTimeout(150);
    const down = await state();
    const scrolled = await page.evaluate(() => document.getElementById('screen-profile').scrollTop);
    assert.ok(scrolled > 100, 'finger moving up scrolled Settings, scrollTop=' + scrolled);
    assertCleanOpen(down, 'after scrolling down the page');
    // Below the top, a finger moving down scrolls back up and never pulls.
    await page.waitForTimeout(300);
    await drag({ y0: 200, y1: 330, ms: 260, steps: 13, release: true });
    await page.waitForTimeout(150);
    const back = await page.evaluate(() => document.getElementById('screen-profile').scrollTop);
    assert.ok(back < scrolled, 'finger moving down scrolled back up (' + scrolled + ' then ' + back + ')');
    assertCleanOpen(await state(), 'after scrolling back up');
  });

  await check('a swipe right after a scroll reaches the top does not pull Settings', async () => {
    await openSettings();
    // A fast scroll glides to the top; the habitual next swipe lands while
    // it is still settling. That touch is a scroll, not a pull.
    await page.evaluate(() => {
      const screen = document.getElementById('screen-profile');
      screen.scrollTop = 300;
    });
    await page.waitForTimeout(30);
    await page.evaluate(() => { document.getElementById('screen-profile').scrollTop = 0; });
    await page.waitForTimeout(40);
    const held = await drag({ y0: 140, y1: 480, ms: 420, steps: 14, release: false });
    const mid = await state();
    assert.ok(Math.abs(mid.y) < 1, 'no pull while the scroll was still settling, y=' + mid.y);
    assert.strictEqual(mid.scrimActive, false);
    await held.end('end');
    await page.waitForTimeout(500);
    assertCleanOpen(await state(), 'after the swipe');
    // Once Settings has rested at the top, the same pull works.
    await page.waitForTimeout(300);
    const ok = await drag({ y0: 140, y1: 300, ms: 200, steps: 8, release: false });
    const pulling = await state();
    assert.ok(pulling.y > 60, 'a deliberate pull after resting moves the panel, y=' + pulling.y);
    await ok.end('cancel');
    await idle();
    assertCleanOpen(await state(), 'after cancelling the deliberate pull');
  });

  await check('pushing back up before letting go keeps Settings open', async () => {
    await openSettings();
    const held = await drag({ y0: 140, y1: 520, ms: 440, steps: 12, release: false });
    const past = await state();
    assert.strictEqual(past.text, 'Release to close.');
    // A quick move back up that is still past the close line, then release.
    await held.move(500);
    await held.move(485);
    await held.move(470);
    const still = await state();
    assert.strictEqual(still.text, 'Release to close.', 'still past the line when the finger lifts');
    await held.end('end');
    await idle();
    await page.waitForTimeout(300);
    assertCleanOpen(await state(), 'after pushing back up');
  });

  await check('released past the line, the panel keeps moving down without a jump', async () => {
    await openSettings();
    const held = await drag({ y0: 140, y1: 480, ms: 480, steps: 14, release: false });
    const atRelease = await state();
    await page.evaluate(() => {
      window.__pullTrace = [];
      const screen = document.getElementById('screen-profile');
      const t0 = performance.now();
      const tick = () => {
        const t = getComputedStyle(screen).transform;
        const y = t && t !== 'none' ? new DOMMatrixReadOnly(t).m42 : 0;
        const scrim = Number(getComputedStyle(document.getElementById('profile-pull-scrim')).opacity);
        window.__pullTrace.push({ y: y, scrim: scrim, screen: currentScreen });
        if (performance.now() - t0 < 600 && currentScreen === 'profile') requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await held.end('end');
    await page.waitForFunction(() => currentScreen === 'home', { timeout: 2000 });
    const trace = await page.evaluate(() => window.__pullTrace.filter((p) => p.screen === 'profile'));
    assert.ok(trace.length >= 4, 'enough frames sampled, ' + trace.length);
    assert.ok(trace[0].y >= atRelease.y - 2, 'no backward jump at release (' + atRelease.y + ' then ' + trace[0].y + ')');
    for (let i = 1; i < trace.length; i++) {
      assert.ok(trace[i].y >= trace[i - 1].y - 0.5, 'panel only moves down, frame ' + i + ': ' + trace[i - 1].y + ' then ' + trace[i].y);
      assert.ok(trace[i].scrim <= trace[i - 1].scrim + 0.01, 'dim only fades out, frame ' + i);
    }
    const done = await state();
    assert.strictEqual(done.scrimActive, false);
    assert.strictEqual(done.homeLeft, 0);
  });

  await check('opening another screen mid-pull leaves nothing behind', async () => {
    await openSettings();
    const held = await drag({ y0: 140, y1: 460, ms: 360, steps: 10, release: false });
    const mid = await state();
    assert.ok(mid.y > 150 && mid.scrimActive, 'pull in progress');
    // Something else opens a screen while the finger is still down, for
    // example a notification tap or the Android back button.
    await page.evaluate(() => navigate('analytics'));
    const after = await state();
    assert.strictEqual(after.screen, 'analytics');
    assert.strictEqual(after.inlineTransform, '');
    assert.strictEqual(after.dragging, false);
    assert.strictEqual(after.scrimActive, false);
    assert.strictEqual(after.edgeActive, false);
    assert.strictEqual(after.shieldActive, false);
    assert.strictEqual(after.homeRevealed, false);
    assert.strictEqual(after.navPointer, '');
    await held.end('end');
    await page.waitForTimeout(600);
    const later = await state();
    assert.strictEqual(later.screen, 'analytics', 'lifting the finger afterwards did nothing');
    // Settings opens and pulls normally afterwards.
    await openSettings();
    assertCleanOpen(await state(), 'reopened Settings');
    const again = await drag({ y0: 140, y1: 300, ms: 200, steps: 8, release: false });
    assert.ok((await state()).y > 60, 'a new pull works');
    await again.end('cancel');
    await idle();
    assertCleanOpen(await state(), 'after the new pull');
  });

  await check('opening another screen while Settings slides away cancels the close', async () => {
    await openSettings();
    const held = await drag({ y0: 140, y1: 480, ms: 480, steps: 14, release: false });
    await held.end('end');
    await page.waitForTimeout(60);
    await page.evaluate(() => navigate('psi'));
    await page.waitForTimeout(700);
    const st = await state();
    assert.strictEqual(st.screen, 'psi', 'the finished slide did not override the newer screen');
    assert.strictEqual(st.scrimActive, false);
    assert.strictEqual(st.shieldActive, false);
    assert.strictEqual(st.homeRevealed, false);
    assert.strictEqual(st.dismissing || st.dismissed, false);
    assert.strictEqual(st.navPointer, '');
  });

  await check('reopening Settings right after closing shows it immediately', async () => {
    await openSettings();
    await drag({ y0: 140, y1: 480, ms: 480, steps: 14, release: true });
    await page.waitForFunction(() => currentScreen === 'home', { timeout: 2000 });
    await page.evaluate(() => navigate('profile'));
    await page.waitForTimeout(300);
    const st = await state();
    assert.strictEqual(st.screen, 'profile');
    assert.strictEqual(st.dismissed, false, 'Settings is not still hidden by the close');
    assert.strictEqual(st.profileActive, true);
    assert.ok(Math.abs(st.y) < 1, 'y=' + st.y);
  });

  await check('reduced motion still closes, without the slide', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openSettings();
    const held = await drag({ y0: 140, y1: 480, ms: 420, steps: 10, release: false });
    const started = Date.now();
    await held.end('end');
    await page.waitForFunction(() => currentScreen === 'home', { timeout: 1500 });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 280, 'reduced motion reached Home in ' + elapsed + 'ms');
    const done = await state();
    assert.strictEqual(done.screen, 'home');
    assert.strictEqual(done.greeting, 'STAY-HOME');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });

  await check('no page errors', async () => {
    assert.deepStrictEqual(errors, []);
  });

  const failed = results.filter((r) => r[0] === 'FAIL').length;
  await browser.close();
  server.close();
  console.log((results.length - failed) + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
