// Notification taps (Reality Check, WBTB wake, WBTB return), both sides at
// once: the real sw.js and the real notification-intent code from app.html,
// connected through simulated windows. Each simulated window runs its own
// copy of the app code; only the screens it opens (openRCTask and the WBTB
// overlays) are stubs that record what happened.
//
// This is not a phone. It checks the hand-off logic: which window is picked,
// acknowledgement, fallback, startup waiting, duplicates and URL cleanup.
//
// Run with:  node tests/notification-intent.test.js
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { extractFn, extractDecl, extractMultiDecl } = require('./helpers/extract-app-source');

const ORIGIN = 'https://ablty.app';
const SW_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

// sw.js timings are scaled down so the suite runs quickly. Relative order
// is what matters: probe < ack < launch, and the app's 250ms retry.
const SCALE = 1 / 40;

const APP_DECLS = ['NOTIFICATION_INTENT_TYPES', 'NOTIFICATION_HANDLED_KEY', 'NOTIFICATION_PENDING_KEY',
  'NOTIFICATION_PENDING_MAX_AGE_MS', '_notifPending', '_notifDrainTimer', '_notifHandled']
  .map(extractDecl);
const APP_FNS = ['isStandaloneAppRuntime', 'cleanNotificationId', 'notificationHandledIds', 'rememberNotificationHandled',
  'storeNotificationPending', 'readStoredNotificationPending',
  'readNotificationIntentFromUrl', 'notificationUrlWithout', 'clearNotificationIntentFromUrl', 'notificationIntentReady',
  'acceptNotificationIntent', 'scheduleNotificationIntentDrain', 'drainNotificationIntent', 'onNotificationIntentMessage',
  'startNotificationIntents'];
const APP_SOURCE = [
  ...APP_DECLS,
  extractMultiDecl('NOTIFICATION_INTENT_HANDLERS'),
].join('\n').replace(/^(const|let) /gm, 'var ') + '\n\n' + APP_FNS.map(extractFn).join('\n\n');
new vm.Script(APP_SOURCE);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const later = (fn) => setTimeout(fn, 1);

function makeWorld() {
  const world = { pages: [], opened: [], swMessages: [], log: [] };
  let nextId = 1;

  // ── Service worker ──
  const handlers = {};
  const swSelf = {
    addEventListener(type, fn) { handlers[type] = fn; },
    location: { origin: ORIGIN },
    registration: { active: null, showNotification: async () => {} },
    skipWaiting() {},
    clients: {
      async matchAll() { return world.pages.filter((p) => p.alive).map((p) => p.client); },
      async openWindow(url) { world.opened.push(url); if (world.onOpenWindow) world.onOpenWindow(url); return null; },
      claim: async () => {},
    },
  };
  const swCtx = {
    self: swSelf, URL, Map, Promise, Date, Math, console,
    setTimeout: (fn, ms) => setTimeout(fn, Math.max(1, Math.round((ms || 0) * SCALE))),
    clearTimeout,
    caches: { open: async () => ({ addAll: async () => {}, put: async () => {} }), keys: async () => [], match: async () => null },
    fetch: async () => ({ ok: true }),
  };
  vm.createContext(swCtx);
  vm.runInContext(SW_SOURCE, swCtx);
  world.sw = swCtx;
  world.swObject = {
    postMessage(data, fromPage) {
      world.swMessages.push(data);
      later(() => handlers.message({ data, source: fromPage ? fromPage.client : null }));
    },
  };

  world.tap = (url) => vm.runInContext('handleNotificationClick', swCtx)({ data: { url }, close() {} });

  // ── Windows ──
  // opts.standalone: the installed app (true) or a browser tab (false)
  // opts.app: the page runs app.html (false for the landing page)
  // opts.frozen: messages wait until focus(); opts.dead: never answers
  // opts.busyMs: main thread busy, messages are handled only after this long
  // opts.ready: start with the splash already done
  world.open = (url, opts = {}) => {
    const page = {
      id: 'c' + nextId++, alive: true, focusCount: 0, frozen: !!opts.frozen, dead: !!opts.dead,
      busyUntil: opts.busyMs ? Date.now() + opts.busyMs * SCALE : 0,
      standalone: opts.standalone !== false, app: opts.app !== false, focused: !!opts.focused,
      visible: !!(opts.focused || opts.visible), queue: [], received: [], rcOpens: 0, wbtbOpens: 0, wbtbReturns: 0,
      session: opts.session || {}, clock: opts.clock || null,
    };
    page.client = {
      id: page.id,
      type: 'window',
      get url() { return page.href; },
      get focused() { return page.focused; },
      get visibilityState() { return page.visible ? 'visible' : 'hidden'; },
      postMessage(data) {
        page.received.push(data);
        if (page.dead || !page.app) return;
        if (page.frozen) { page.queue.push(data); return; }
        const wait = Math.max(1, page.busyUntil - Date.now());
        setTimeout(() => page.deliver(data), wait);
      },
      async focus() {
        page.focusCount += 1;
        world.log.push('focus:' + page.id);
        page.focused = true; page.visible = true;
        if (page.frozen && !page.dead) {
          page.frozen = false;
          const q = page.queue.splice(0);
          q.forEach((d) => later(() => page.deliver(d)));
        }
        return page.client;
      },
      async navigate(url) {
        world.log.push('navigate:' + page.id);
        page.dead = false; page.frozen = false;
        page.boot(new URL(url, ORIGIN).href, { ready: false });
        return page.client;
      },
    };
    page.boot = (href, bootOpts) => {
      page.href = href;
      page.history = [{ state: null, href }];
      const u = () => new URL(page.href);
      const listeners = [];
      const ctx = {
        URL, JSON, console, Promise, Array, Object, String, Date: page.clock || Date,
        setTimeout, clearTimeout,
        sessionStorage: {
          getItem: (k) => (k in page.session ? page.session[k] : null),
          setItem: (k, v) => { page.session[k] = String(v); },
          removeItem: (k) => { delete page.session[k]; },
        },
        window: {
          get location() { return u(); },
          matchMedia: (q) => ({ matches: page.standalone && /standalone/.test(q) }),
          navigator: {},
        },
        document: {
          referrer: '',
          getElementById: (id) => (id === 'onboarding-screen' ? page.onboarding : null),
        },
        history: {
          get state() { return page.history[page.history.length - 1].state; },
          replaceState(state, _t, url) {
            const href2 = new URL(url === '' ? page.href : url, page.href).href;
            page.history[page.history.length - 1] = { state, href: href2 };
            page.href = href2;
          },
          pushState(state, _t, url) {
            const href2 = new URL(url === '' ? page.href : url, page.href).href;
            page.history.push({ state, href: href2 });
            page.href = href2;
          },
        },
        navigator: {
          serviceWorker: {
            controller: { postMessage: (d) => world.swObject.postMessage(d, page) },
            addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
          },
        },
        openRCTask() {
          page.rcOpens += 1;
          ctx.currentScreen = 'rc-task';
          ctx.history.pushState({ screen: 'rc-task' }, '', '');
        },
        openWBTBWakeScreen() { page.wbtbOpens += 1; },
        showWBTBReturnPrompt() { page.wbtbReturns += 1; },
        currentScreen: 'home',
        splashDone: !!(bootOpts && bootOpts.ready),
        _legalGate: null,
      };
      page.onboarding = null;
      vm.createContext(ctx);
      vm.runInContext(APP_SOURCE, ctx);
      page.ctx = ctx;
      page.deliver = (data) => {
        const ev = { data, source: { postMessage: (d) => world.swObject.postMessage(d, page) } };
        listeners.forEach((fn) => fn(ev));
      };
      vm.runInContext('startNotificationIntents()', ctx);
      // The app's DOMContentLoaded seeds history with the home state.
      ctx.history.replaceState({ screen: 'home' }, '', '');
    };
    page.ready = () => { page.ctx.splashDone = true; };
    page.close = () => { page.alive = false; };
    if (page.app) page.boot(new URL(url, ORIGIN).href, { ready: opts.ready });
    else { page.href = new URL(url, ORIGIN).href; page.ctx = null; }
    world.pages.push(page);
    return page;
  };

  return world;
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('PASS  ' + name);
  } catch (e) {
    failed += 1;
    console.log('FAIL  ' + name + '\n      ' + String(e.stack || e).split('\n').slice(0, 6).join('\n      '));
  }
}

const path_ = (href) => { const u = new URL(href); return u.pathname + u.search + u.hash; };

(async () => {
  await test('1. app fully closed: the tap opens /app.html with the notification URL and Reality Check opens after startup', async () => {
    const w = makeWorld();
    let launched = null;
    w.onOpenWindow = (url) => { later(() => { launched = w.open(url); }); };
    const done = w.tap('/app.html?rc=1');
    await sleep(40);
    assert.strictEqual(w.opened.length, 1);
    const u = new URL(w.opened[0]);
    assert.strictEqual(u.origin + u.pathname, ORIGIN + '/app.html');
    assert.strictEqual(u.searchParams.get('rc'), '1');
    assert.ok(u.searchParams.get('nid'), 'the URL carries the notification id');
    assert.ok(launched, 'the platform loaded the URL');
    await sleep(300);
    assert.strictEqual(launched.rcOpens, 0, 'nothing opens before the splash is done');
    launched.ready();
    await sleep(350);
    assert.strictEqual(launched.rcOpens, 1);
    assert.strictEqual(launched.ctx.currentScreen, 'rc-task');
    assert.strictEqual(path_(launched.href), '/app.html');
    const t0 = Date.now();
    await done;
    assert.ok(Date.now() - t0 < 20000 * SCALE, 'sw.js stops waiting once the app claimed the intent');
  });

  await test('1b. app closed and the platform opens the app without the notification URL: the app claims the tap from sw.js', async () => {
    const w = makeWorld();
    let launched = null;
    w.onOpenWindow = () => { later(() => { launched = w.open('/app.html'); }); };
    const done = w.tap('/app.html?rc=1');
    await sleep(60);
    launched.ready();
    await sleep(350);
    assert.strictEqual(launched.rcOpens, 1);
    assert.ok(w.swMessages.some((m) => m.type === 'NOTIFICATION_INTENT_ACK' && m.accepted), 'the app acknowledged the claimed intent');
    await done;
  });

  await test('2. app starting slowly: the intent waits through the splash, onboarding and the Terms gate, then opens once', async () => {
    const w = makeWorld();
    const page = w.open('/app.html?rc=1&nid=slow-1');
    page.onboarding = { classList: { contains: (c) => c === 'active' }, style: { display: '' } };
    page.ctx._legalGate = { userId: 'u1' };
    await sleep(400);
    page.ready();
    await sleep(600);
    assert.strictEqual(page.rcOpens, 0, 'onboarding still showing');
    page.onboarding = { classList: { contains: () => false }, style: {} };
    await sleep(600);
    assert.strictEqual(page.rcOpens, 0, 'Terms gate still showing');
    assert.ok(new URL(page.href).searchParams.get('rc'), 'the URL keeps the marker until the exercise opens');
    page.ctx._legalGate = null;
    await sleep(600);
    assert.strictEqual(page.rcOpens, 1);
    assert.strictEqual(path_(page.href), '/app.html');
  });

  await test('2b. a message that arrives while the app is starting is kept, acknowledged, and opened once ready', async () => {
    const w = makeWorld();
    const page = w.open('/app.html', { visible: true });
    const done = w.tap('/app.html?rc=1');
    await sleep(80);
    assert.ok(w.swMessages.some((m) => m.type === 'NOTIFICATION_INTENT_ACK' && m.accepted));
    assert.strictEqual(page.rcOpens, 0);
    await done;
    page.ready();
    await sleep(350);
    assert.strictEqual(page.rcOpens, 1);
    assert.strictEqual(w.opened.length, 0, 'no second window');
  });

  await test('2c. a reload during startup (update banner, first install) keeps a tap that arrived as a message', async () => {
    const w = makeWorld();
    const session = {};
    const page = w.open('/app.html', { session, visible: true });
    await w.tap('/app.html?rc=1');
    assert.strictEqual(page.rcOpens, 0);
    page.close();
    const reloaded = w.open('/app.html', { session });
    reloaded.ready();
    await sleep(350);
    assert.strictEqual(reloaded.rcOpens, 1);
    assert.ok(!('ablty_notification_pending' in session), 'cleared once opened');
    reloaded.close();
    const again = w.open('/app.html', { session, ready: true });
    await sleep(60);
    assert.strictEqual(again.rcOpens, 0, 'not opened a second time on the next reload');
  });

  await test('2d. a held tap older than five minutes is dropped instead of opening later by surprise', async () => {
    const w = makeWorld();
    const session = { ablty_notification_pending: JSON.stringify({ kind: 'rc', id: 'old-1', at: Date.now() - 6 * 60 * 1000 }) };
    const page = w.open('/app.html', { session, ready: true });
    await sleep(60);
    assert.strictEqual(page.rcOpens, 0);
    assert.ok(!('ablty_notification_pending' in session));
  });

  await test('3. app in the background: the app window is focused and opens Reality Check, no new window', async () => {
    const w = makeWorld();
    const page = w.open('/app.html', { ready: true });
    await w.tap('/app.html?rc=1');
    await sleep(20);
    assert.strictEqual(page.focusCount, 1);
    assert.strictEqual(page.rcOpens, 1);
    assert.strictEqual(w.opened.length, 0);
    assert.ok(!w.log.some((l) => l.startsWith('navigate')), 'not reloaded');
  });

  await test('3b. app window frozen in the background: it answers once focused and is not reloaded', async () => {
    const w = makeWorld();
    const page = w.open('/app.html', { ready: true, frozen: true });
    await w.tap('/app.html?rc=1');
    await sleep(20);
    assert.strictEqual(page.focusCount, 1);
    assert.strictEqual(page.rcOpens, 1);
    assert.ok(!w.log.some((l) => l.startsWith('navigate')));
    assert.strictEqual(w.opened.length, 0);
  });

  await test('3c. app window busy for longer than any timeout: never reloaded, opens Reality Check once it catches up', async () => {
    const w = makeWorld();
    const page = w.open('/app.html', { ready: true, busyMs: 9000 });
    page.ctx.unsavedDraft = 'flying over a red bridge';
    const done = w.tap('/app.html?rc=1');
    await sleep(6000 * SCALE);
    assert.strictEqual(page.rcOpens, 0, 'still busy');
    await sleep(3000 * SCALE + 120);
    assert.strictEqual(page.rcOpens, 1);
    assert.strictEqual(page.ctx.unsavedDraft, 'flying over a red bridge', 'same page, nothing lost');
    assert.ok(!w.log.some((l) => l.startsWith('navigate')), 'not reloaded');
    assert.strictEqual(w.opened.length, 0, 'no window opened over it');
    await done;
  });

  await test('3d. app window that never answers is left alone; if it restarts by itself it still gets the tap', async () => {
    const w = makeWorld();
    const session = {};
    const page = w.open('/app.html', { ready: true, dead: true, session });
    const done = w.tap('/app.html?rc=1');
    await sleep(8000 * SCALE);
    assert.ok(!w.log.some((l) => l.startsWith('navigate')), 'not reloaded');
    assert.strictEqual(w.opened.length, 0, 'no window opened over it');
    page.close();
    const restarted = w.open('/app.html', { session, ready: true });
    await sleep(350);
    assert.strictEqual(restarted.rcOpens, 1, 'the restarted window claimed the tap');
    const t0 = Date.now();
    await done;
    assert.ok(Date.now() - t0 < 20000 * SCALE, 'sw.js stops waiting once the app claimed the intent');
  });

  await test('4. app already open on Home: same working behaviour, one task opened, no reload', async () => {
    const w = makeWorld();
    const page = w.open('/app.html', { ready: true, focused: true });
    await w.tap('/app.html?rc=1');
    await sleep(20);
    assert.strictEqual(page.rcOpens, 1);
    assert.strictEqual(page.ctx.currentScreen, 'rc-task');
    assert.strictEqual(w.opened.length, 0);
  });

  await test('5. landing page, install page and a browser tab of app.html are never taken for the app', async () => {
    const w = makeWorld();
    const landing = w.open('/', { app: false, focused: true });
    const install = w.open('/earlybetaaccess.html', { app: false, visible: true });
    const tab = w.open('/app.html', { standalone: false, ready: true, visible: true });
    let launched = null;
    w.onOpenWindow = (url) => { later(() => { launched = w.open(url, { ready: true }); }); };
    const done = w.tap('/app.html?rc=1');
    await sleep(80);
    assert.strictEqual(landing.received.length, 0, 'landing page gets no message');
    assert.strictEqual(install.received.length, 0);
    assert.strictEqual(landing.focusCount + install.focusCount + tab.focusCount, 0, 'no wrong window focused');
    assert.strictEqual(tab.rcOpens, 0, 'browser tab declined');
    assert.strictEqual(w.opened.length, 1, 'the installed app is opened instead');
    await sleep(350);
    assert.strictEqual(launched.rcOpens, 1);
    await done;
  });

  await test('5b. an app window still at "/" (left there by the old code) is not trusted; the app is opened at /app.html', async () => {
    const w = makeWorld();
    const old = w.open('/', { app: false, focused: true });
    w.onOpenWindow = () => {};
    const done = w.tap('/app.html?rc=1');
    await sleep(40);
    assert.strictEqual(old.received.length, 0);
    assert.strictEqual(new URL(w.opened[0]).pathname, '/app.html');
    await done;
  });

  await test('6. duplicate delivery of one tap (URL and message, or the message twice) opens Reality Check once', async () => {
    const w = makeWorld();
    const page = w.open('/app.html?rc=1&nid=dup-1', { ready: true });
    page.deliver({ type: 'RC_OPEN', intentId: 'dup-1' });
    page.deliver({ type: 'RC_OPEN', intentId: 'dup-1' });
    await sleep(60);
    assert.strictEqual(page.rcOpens, 1);
    page.deliver({ type: 'RC_OPEN', intentId: 'dup-1' });
    await sleep(30);
    assert.strictEqual(page.rcOpens, 1, 'late duplicate ignored');
    page.ctx.currentScreen = 'home';
    page.deliver({ type: 'RC_OPEN', intentId: 'dup-1' });
    await sleep(30);
    assert.strictEqual(page.rcOpens, 1, 'a duplicate after finishing the task does not open a second one');
    const acks = w.swMessages.filter((m) => m.type === 'NOTIFICATION_INTENT_ACK');
    assert.strictEqual(acks.length, 4);
    assert.ok(acks.every((a) => a.accepted), 'duplicates are still acknowledged, so sw.js does not fall back');
  });

  await test('6b. a reload that still has the handled URL does not open it again', async () => {
    const w = makeWorld();
    const session = {};
    const page = w.open('/app.html?rc=1&nid=dup-2', { ready: true, session });
    await sleep(30);
    assert.strictEqual(page.rcOpens, 1);
    page.close();
    const again = w.open('/app.html?rc=1&nid=dup-2&keep=1', { ready: true, session });
    await sleep(30);
    assert.strictEqual(again.rcOpens, 0);
    assert.strictEqual(path_(again.href), '/app.html?keep=1', 'stale marker removed, other parameter kept');
  });

  await test('6c. a new tap while the Reality Check is open does not reset or rotate it', async () => {
    const w = makeWorld();
    const page = w.open('/app.html', { ready: true, focused: true });
    await w.tap('/app.html?rc=1');
    await sleep(20);
    await w.tap('/app.html?rc=1');
    await sleep(20);
    assert.strictEqual(page.rcOpens, 1);
    assert.strictEqual(page.ctx.currentScreen, 'rc-task');
  });

  await test('7. ordinary launch with no notification: nothing opens, sw.js sends nothing back', async () => {
    const w = makeWorld();
    const page = w.open('/app.html');
    page.ready();
    await sleep(350);
    assert.strictEqual(page.rcOpens + page.wbtbOpens + page.wbtbReturns, 0);
    assert.strictEqual(page.ctx.currentScreen, 'home');
    assert.deepStrictEqual(w.swMessages.map((m) => m.type), ['NOTIFICATION_INTENT_CLAIM']);
    assert.strictEqual(page.received.length, 0);
    assert.strictEqual(path_(page.href), '/app.html');
  });

  await test('8. WBTB wake and return taps reach their screens, from a fresh launch and in an open app', async () => {
    const w = makeWorld();
    let launched = null;
    w.onOpenWindow = (url) => { later(() => { launched = w.open(url); }); };
    const done = w.tap('/app.html?wbtb=1');
    await sleep(60);
    assert.strictEqual(new URL(w.opened[0]).searchParams.get('wbtb'), '1');
    await sleep(300);
    assert.strictEqual(launched.wbtbOpens, 0, 'waits for the splash');
    launched.ready();
    await sleep(350);
    assert.strictEqual(launched.wbtbOpens, 1);
    assert.strictEqual(launched.rcOpens, 0);
    assert.strictEqual(path_(launched.href), '/app.html');
    await done;

    const w2 = makeWorld();
    const open = w2.open('/app.html', { ready: true, focused: true });
    await w2.tap('/app.html?wbtb=return');
    await sleep(20);
    assert.strictEqual(open.wbtbReturns, 1);
    await w2.tap('/app.html?wbtb=1');
    await sleep(20);
    assert.strictEqual(open.wbtbOpens, 1);
    assert.strictEqual(open.rcOpens, 0);

    const w3 = makeWorld();
    const ret = w3.open('/app.html?wbtb=return&nid=r-1');
    ret.onboarding = { classList: { contains: (c) => c === 'active' }, style: { display: '' } };
    ret.ready();
    await sleep(30);
    assert.strictEqual(ret.wbtbReturns, 1, 'WBTB keeps its old rule: open once the splash is done');

    // A second openWBTBWakeScreen would start a second countdown timer.
    const w4 = makeWorld();
    const wake = w4.open('/app.html?wbtb=1&nid=wake-1', { ready: true });
    wake.deliver({ type: 'WBTB_OPEN', intentId: 'wake-1' });
    await sleep(30);
    wake.deliver({ type: 'WBTB_OPEN', intentId: 'wake-1' });
    await sleep(30);
    assert.strictEqual(wake.wbtbOpens, 1, 'one tap delivered twice starts the wake countdown once');
  });

  await test('9. URL cleanup removes only the notification markers and keeps other parameters, sign-in hash and history state', async () => {
    const w = makeWorld();
    const page = w.open('/app.html?utm_source=x%20y&rc=1&keep=a+b&nid=clean-1#access_token=abc&type=recovery', { ready: true });
    page.ctx.history.replaceState({ screen: 'home', marker: 7 }, '', '');
    await sleep(30);
    assert.strictEqual(page.rcOpens, 1);
    assert.strictEqual(path_(page.href), '/app.html?utm_source=x%20y&keep=a+b#access_token=abc&type=recovery');
    assert.deepStrictEqual(page.history[0].state, { screen: 'home', marker: 7 }, 'the entry beneath keeps its state');
    assert.strictEqual(path_(page.history[0].href), '/app.html?utm_source=x%20y&keep=a+b#access_token=abc&type=recovery',
      'the entry beneath is clean too, so Back does not bring the marker back');

    const fn = (href, kind) => vm.runInContext('notificationUrlWithout', page.ctx)(href, kind);
    assert.strictEqual(fn(ORIGIN + '/app.html#reality-check', 'rc'), '/app.html');
    assert.strictEqual(fn(ORIGIN + '/app.html?a=1#reality-check', 'rc'), '/app.html?a=1');
    assert.strictEqual(fn(ORIGIN + '/app.html?a=1', 'rc'), null, 'nothing to remove');
    assert.strictEqual(fn(ORIGIN + '/app.html?rc=2&a=1', 'rc'), null, 'only rc=1 is a notification marker');
    assert.strictEqual(fn(ORIGIN + '/app.html?wbtb=return&rc=1', 'wbtb_return'), '/app.html?rc=1');
    assert.strictEqual(fn(ORIGIN + '/app.html?code=pkce123&rc=1', 'rc'), '/app.html?code=pkce123', 'sign-in code kept');
  });

  await test('compat: a message from the previous service worker (no id) still opens Reality Check, without an ACK', async () => {
    const w = makeWorld();
    const page = w.open('/app.html', { ready: true });
    page.deliver({ type: 'RC_OPEN' });
    await sleep(30);
    assert.strictEqual(page.rcOpens, 1);
    assert.ok(!w.swMessages.some((m) => m.type === 'NOTIFICATION_INTENT_ACK'));
  });

  await test('the notification id from the URL is validated before use', async () => {
    const w = makeWorld();
    const page = w.open('/app.html?rc=1&nid=%3Cscript%3E', { ready: true });
    await sleep(30);
    assert.strictEqual(page.rcOpens, 1);
    assert.strictEqual((vm.runInContext('_notifHandled', page.ctx) || []).length, 0, 'an invalid id is not stored');
    assert.deepStrictEqual(page.session, {});
  });

  await test('sw.js: only exact-origin /app.html windows are app candidates', async () => {
    const w = makeWorld();
    const isApp = vm.runInContext('isAppWindowUrl', w.sw);
    assert.strictEqual(isApp(ORIGIN + '/app.html?x=1'), true);
    assert.strictEqual(isApp(ORIGIN + '/app'), true);
    assert.strictEqual(isApp(ORIGIN + '/'), false);
    assert.strictEqual(isApp(ORIGIN + '/index.html'), false);
    assert.strictEqual(isApp(ORIGIN + '/earlybetaaccess.html'), false);
    assert.strictEqual(isApp('https://ablty.app.evil.example/app.html'), false);
    assert.strictEqual(isApp('https://evil.example/https://ablty.app/app.html'), false);
    const target = vm.runInContext('notificationTarget', w.sw);
    assert.strictEqual(target({ data: { url: 'https://evil.example/app.html?rc=1' } }).url.origin, ORIGIN, 'a foreign URL falls back to the app');
    assert.strictEqual(target({ data: { url: '/app.html?wbtb=return' } }).type, 'WBTB_RETURN');
    assert.strictEqual(target({ data: { url: '/app.html?wbtb=1' } }).type, 'WBTB_OPEN');
    assert.strictEqual(target({}).type, 'RC_OPEN');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
