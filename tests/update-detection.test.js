// Runs the real update-detection code from app.html (registerSW,
// watchInstallingWorker, checkForWaitingUpdate, runUpdateCheck,
// checkVersionManifestUpdate, renderUpdateStatus, applyUpdate) against a
// fake service worker registration and a fake network, and the fetch
// handler of sw.js against a fake cache. Checks that an update found by the
// very first reg.update() is announced (the race that hid the banner), that
// Settings shows the running version and tells "latest version" apart from
// "could not check", and that update probes are not stored in the cache.
// Run with:  node tests/update-detection.test.js
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { extractFn, extractDecl, html } = require('./helpers/extract-app-source');

const DECLS = [
  extractDecl('APP_BOOT_LAST_MODIFIED'), extractDecl('APP_VERSION'), extractDecl('VERSION_MANIFEST_PATH'),
  extractDecl('_updateCheck'), extractDecl('_updateCheckInFlight'), extractDecl('_swWatchedWorkers'),
];
const FNS = ['setUpdateCheckState', 'renderUpdateStatus', 'handleVersionRowTap', 'fetchManifestVersion',
  'checkVersionManifestUpdate', 'checkHtmlUpdateFallback', 'watchInstallingWorker', 'checkForWaitingUpdate',
  'runUpdateCheck', 'registerSW', 'showUpdateBanner', 'getPendingServiceWorker', 'applyUpdate'];
const source = DECLS.join('\n').replace(/^(const|let) /gm, 'var ') + '\n\n' + FNS.map(extractFn).join('\n\n');
new vm.Script(source);

const tick = () => new Promise((r) => setImmediate(r));
async function settle(n = 6) { for (let i = 0; i < n; i++) await tick(); }

class Emitter {
  constructor() { this.listeners = {}; }
  addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  dispatch(type, ev = {}) { (this.listeners[type] || []).slice().forEach((fn) => fn(ev)); }
  count(type) { return (this.listeners[type] || []).length; }
}

function fakeWorker(state) {
  const w = new Emitter();
  w.state = state;
  w.posted = [];
  w.postMessage = (m) => w.posted.push(m);
  w.setState = (s) => { w.state = s; w.dispatch('statechange'); };
  return w;
}

// opts.manifest: version string the server answers, null for a bad answer,
// 'throw' for no network. opts.onUpdate(reg, env) runs inside reg.update().
// opts.controller === false means a first install (page not yet controlled).
// opts.serviceWorker === false means a browser without service workers.
function makeEnv(opts = {}) {
  const env = { fetches: [], reloads: 0, intervals: [], els: {}, manifest: 'manifest' in opts ? opts.manifest : null };
  const mkEl = (id) => ({ id, style: {}, textContent: '', innerHTML: '', addEventListener() {} });
  env.els['app-version-label'] = mkEl('app-version-label');
  env.els['update-status-label'] = mkEl('update-status-label');

  const reg = new Emitter();
  reg.installing = null;
  reg.waiting = opts.waiting || null;
  reg.active = fakeWorker('activated');
  reg.updateCalls = 0;
  reg.update = async () => {
    reg.updateCalls += 1;
    if (opts.onUpdate) await opts.onUpdate(reg, env);
  };
  env.reg = reg;

  const swc = new Emitter();
  swc.controller = opts.controller === false ? null : {};
  swc.register = async () => { env.registered = true; return reg; };
  env.swc = swc;

  const navigator = opts.serviceWorker === false ? {} : { serviceWorker: swc };
  const document = {
    lastModified: '10/05/2026 10:00:00',
    visibilityState: 'visible',
    getElementById: (id) => env.els[id] || null,
    createElement: (tag) => mkEl(''),
    body: { appendChild: (el) => { env.els[el.id] = el; } },
    addEventListener() {},
  };
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    navigator, document,
    window: { addEventListener() {}, location: { reload() { env.reloads += 1; } } },
    setInterval: (fn, ms) => { env.intervals.push({ fn, ms }); return 1; },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)),
    Date, Promise,
    fetch: async (url, init = {}) => {
      env.fetches.push({ url, init });
      if (env.manifest === 'throw') throw new TypeError('Failed to fetch');
      if (url.startsWith('/version.json')) {
        if (env.manifest === null) return { ok: false };
        return { ok: true, json: async () => ({ version: env.manifest }) };
      }
      return { ok: true, headers: { get: () => '' } };
    },
    validatePushSubscription() {}, openRCTask() {}, openWBTBWakeScreen() {}, showWBTBReturnPrompt() {},
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  env.ctx = ctx;
  env.banner = () => env.els['update-banner'] || null;
  env.status = () => env.els['update-status-label'].textContent;
  env.version = () => env.els['app-version-label'].textContent;
  env.state = () => ctx._updateCheck.state;
  return env;
}

// What the real sw.js does when reg.update() finds a new file: a new worker
// appears as `installing`, `updatefound` fires, the worker's install step
// posts UPDATE_READY to the page, and update() resolves while the worker is
// still installing. It only reaches `installed` afterwards.
function updateFindsNewWorker(reg, env) {
  const w = fakeWorker('installing');
  reg.installing = w;
  env.newWorker = w;
  reg.dispatch('updatefound');
  env.swc.dispatch('message', { data: { type: 'UPDATE_READY' } });
}

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log('PASS  ' + name); }

(async () => {
  await test('Settings shows the running APP_VERSION, which matches version.json', async () => {
    const env = makeEnv({ manifest: env0Version() });
    env.ctx.renderUpdateStatus();
    assert.strictEqual(env.version(), 'v' + env.ctx.APP_VERSION);
    assert.notStrictEqual(env.ctx.APP_VERSION, '0.1.0');
    assert.ok(!html.includes('v0.1.0 Alpha'), 'the hardcoded version string is gone');
    assert.strictEqual(env0Version(), env.ctx.APP_VERSION, 'version.json and APP_VERSION agree');
    const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    const cacheName = /const CACHE_NAME = 'ablty-v(\d+)'/.exec(sw)[1];
    const header = /^\/\/ ABLTY Service Worker v(\d+)/.exec(sw)[1];
    assert.strictEqual(header, cacheName, 'sw.js header comment matches CACHE_NAME');
  });

  await test('RACE: an update found by the startup reg.update() is announced as soon as it installs, with no poll', async () => {
    const env = makeEnv({ manifest: env0Version(), onUpdate: updateFindsNewWorker });
    await env.ctx.registerSW();
    await settle();
    assert.ok(env.registered);
    assert.strictEqual(env.reg.updateCalls, 1);
    assert.ok(env.newWorker, 'a new worker was found during the startup check');
    assert.strictEqual(env.banner(), null, 'nothing to announce while it is still installing');
    assert.strictEqual(env.reg.count('updatefound'), 1, 'updatefound listener was attached before update()');
    // The worker finishes installing. Nothing else happens: no poll, no
    // visibility change.
    env.newWorker.setState('installed');
    await settle();
    assert.ok(env.banner(), 'banner shown as soon as the worker installed');
    assert.ok(env.banner().innerHTML.includes('Update available'));
    assert.strictEqual(env.ctx.window._swPendingWorker, env.newWorker);
    assert.strictEqual(env.state(), 'available');
    assert.ok(env.status().startsWith('Update available'), env.status());
    assert.ok(env.status().includes('Tap to install'), env.status());
    assert.strictEqual(env.intervals.length, 1, 'the minute poll is still set up');
    assert.strictEqual(env.intervals[0].ms, 60000);
  });

  await test('RACE: the same worker seen by updatefound, UPDATE_READY and a poll shows exactly one banner', async () => {
    const env = makeEnv({ manifest: env0Version(), onUpdate: updateFindsNewWorker });
    await env.ctx.registerSW();
    await settle();
    let created = 0;
    const orig = env.ctx.document.body.appendChild;
    env.ctx.document.body.appendChild = (el) => { created += 1; orig(el); };
    // A poll and another UPDATE_READY arrive while it is still installing.
    env.reg.update = async () => {};
    await env.intervals[0].fn();
    env.swc.dispatch('message', { data: { type: 'UPDATE_READY' } });
    env.newWorker.setState('installed');
    await settle();
    assert.strictEqual(created, 1, 'one banner');
    assert.strictEqual(env.newWorker.count('statechange'), 1, 'one statechange listener on the worker');
  });

  await test('reopen with a worker already waiting: banner at once, applying it posts SKIP_WAITING and reloads', async () => {
    const waiting = fakeWorker('installed');
    const env = makeEnv({ manifest: env0Version(), waiting });
    await env.ctx.registerSW();
    await settle();
    assert.ok(env.banner());
    assert.strictEqual(env.state(), 'available');
    assert.strictEqual(env.ctx.getPendingServiceWorker(), waiting);
    env.ctx.handleVersionRowTap();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(waiting.posted)), [{ type: 'SKIP_WAITING' }]);
    env.swc.dispatch('controllerchange');
    assert.ok(env.reloads >= 1, 'page reloaded onto the new version');
  });

  await test('up to date: no new worker and version.json matches, so Settings says latest and no banner appears', async () => {
    const env = makeEnv({ manifest: env0Version() });
    await env.ctx.registerSW();
    await settle();
    assert.strictEqual(env.banner(), null);
    assert.strictEqual(env.state(), 'latest');
    assert.ok(env.status().startsWith('You have the latest version.'), env.status());
    assert.ok(env.status().includes('Checked at'), env.status());
    assert.ok(env.status().includes('Tap to check again'), env.status());
    assert.ok(env.fetches.some((f) => f.url.startsWith('/version.json?update_check=') && f.init.cache === 'no-store'));
    // Tapping the row checks again instead of reloading.
    const before = env.fetches.length;
    env.ctx.handleVersionRowTap();
    await settle();
    assert.strictEqual(env.reg.updateCalls, 2, 'sw.js re-fetched');
    assert.ok(env.fetches.length > before, 'version.json re-fetched');
    assert.strictEqual(env.reloads, 0);
    assert.strictEqual(env.state(), 'latest');
  });

  await test('cannot check: version.json unreachable is reported as a failed check, never as "latest"', async () => {
    const env = makeEnv({ manifest: 'throw' });
    await env.ctx.registerSW();
    await settle();
    assert.strictEqual(env.banner(), null);
    assert.strictEqual(env.state(), 'failed');
    assert.ok(env.status().startsWith('Could not check for updates.'), env.status());
    assert.ok(!env.status().includes('latest'));
    // A bad answer (for example a captive portal page) counts as failed too.
    const env2 = makeEnv({ manifest: null });
    await env2.ctx.registerSW();
    await settle();
    assert.strictEqual(env2.state(), 'failed');
    // Back online, the row tap finds it current.
    env2.manifest = env0Version();
    env2.ctx.handleVersionRowTap();
    await settle();
    assert.strictEqual(env2.state(), 'latest');
  });

  await test('version.json newer than the running page: banner and "Update available (vX)" even with no worker change', async () => {
    const env = makeEnv({ manifest: '2099.01.01.1' });
    await env.ctx.registerSW();
    await settle();
    assert.ok(env.banner());
    assert.strictEqual(env.state(), 'available');
    assert.strictEqual(env.status(), 'Update available (v2099.01.01.1). Tap to install.');
    assert.strictEqual(env.ctx.window._pendingManifestVersion, '2099.01.01.1');
    // A later failed or matching check does not take the update away.
    env.manifest = 'throw';
    await env.ctx.runUpdateCheck();
    assert.strictEqual(env.state(), 'available');
    env.manifest = env0Version();
    await env.ctx.runUpdateCheck();
    assert.strictEqual(env.state(), 'available');
    // With no waiting worker the row tap reloads straight away.
    env.ctx.handleVersionRowTap();
    assert.strictEqual(env.reloads, 1);
  });

  await test('first install (page not yet controlled): the installing worker is not offered as an update', async () => {
    const env = makeEnv({ manifest: env0Version(), controller: false, onUpdate: updateFindsNewWorker });
    await env.ctx.registerSW();
    await settle();
    env.newWorker.setState('installed');
    await settle();
    assert.strictEqual(env.banner(), null);
    assert.strictEqual(env.state(), 'latest');
  });

  await test('no service worker support: the version file alone decides latest vs failed', async () => {
    const env = makeEnv({ manifest: env0Version(), serviceWorker: false });
    await env.ctx.registerSW();
    await settle();
    assert.strictEqual(env.registered, undefined);
    assert.strictEqual(env.state(), 'latest');
    assert.strictEqual(env.version(), 'v' + env.ctx.APP_VERSION);
  });

  await test('the minute poll does not flicker the Settings row back to "Checking"', async () => {
    const env = makeEnv({ manifest: env0Version() });
    await env.ctx.registerSW();
    await settle();
    const seen = [];
    const el = env.els['update-status-label'];
    Object.defineProperty(el, 'textContent', { set(v) { seen.push(v); }, get() { return seen[seen.length - 1] || ''; } });
    await env.intervals[0].fn();
    assert.ok(seen.length > 0);
    assert.ok(seen.every((t) => !t.startsWith('Checking')), JSON.stringify(seen));
  });

  // ── sw.js ──

  await test('sw.js: update probes fetched with cache "no-store" are served from the network and not stored', async () => {
    const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    const puts = [];
    const cache = { addAll: async () => {}, put: async (req, res) => { puts.push(req.url); } };
    const self = new Emitter();
    self.location = { origin: 'https://ablty.app' };
    self.registration = { active: null, showNotification: async () => {} };
    self.clients = { matchAll: async () => [], claim: async () => {} };
    self.skipWaiting = () => {};
    const ctx = {
      self, caches: { open: async () => cache, match: async () => undefined, keys: async () => [], delete: async () => true },
      clients: self.clients, console,
      fetch: async (req) => ({ ok: true, clone() { return this; } }),
      Promise,
    };
    vm.createContext(ctx);
    vm.runInContext(sw, ctx);
    const request = (url, cacheMode) => ({ method: 'GET', url, mode: 'cors', cache: cacheMode, headers: { get: () => 'application/json' } });
    const dispatchFetch = async (req) => {
      let response;
      self.dispatch('fetch', { request: req, respondWith: (p) => { response = p; } });
      return response;
    };
    await dispatchFetch(request('https://ablty.app/version.json?update_check=1', 'no-store'));
    await dispatchFetch(request('https://ablty.app/version.json?update_check=2', 'no-store'));
    await settle();
    assert.deepStrictEqual(puts, [], 'nothing stored for the probes');
    await dispatchFetch(request('https://ablty.app/icon-192.png', 'default'));
    await settle();
    assert.deepStrictEqual(puts, ['https://ablty.app/icon-192.png'], 'ordinary assets are still cached');
  });

  console.log(`\n${passed} passed, 0 failed`);
})().catch((e) => { console.error(e); process.exit(1); });

function env0Version() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8')).version;
}
