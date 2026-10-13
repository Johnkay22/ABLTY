// WBTB wake screen countdown: the real functions from app.html with a fake
// clock and a fake wake screen. The alarm opens the wake screen and also shows
// the wake notification, and tapping that notification opens the screen
// again; there must only ever be one countdown.
//
// Run with:  node tests/wbtb-wake-countdown.test.js
const vm = require('vm');
const assert = require('assert');
const { html, extractFn, extractDecl } = require('./helpers/extract-app-source');

const duration = /^const WBTB_WAKE_DURATION\s*=\s*([^;]+);/m.exec(html);
if (!duration) throw new Error('declaration not found: WBTB_WAKE_DURATION');
const SOURCE = [
  extractDecl('wbtbWakeTimer'),
  'const WBTB_WAKE_DURATION = ' + duration[1] + ';',
  ...['openWBTBWakeScreen', 'closeWBTBWakeScreen', 'startWBTBWakeCountdown', 'updateWBTBWakeDisplay',
    'showWBTBReturnPrompt'].map(extractFn),
].join('\n\n');

function makeApp() {
  const timers = new Map();
  let nextId = 1;
  const el = (id) => ({ id, textContent: '', innerHTML: '' });
  const classes = new Set();
  const screen = {
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    querySelector: (sel) => parts[sel] || null,
  };
  const parts = { '.wbtb-wake-title': el('t'), '.wbtb-wake-sub': el('s'), '.wbtb-wake-tip': el('tip') };
  const nodes = {
    'wbtb-wake-screen': screen,
    'wbtb-wake-countdown': el('wbtb-wake-countdown'),
    'wbtb-wake-countdown-label': el('wbtb-wake-countdown-label'),
  };
  const ctx = {
    String, Math,
    document: { getElementById: (id) => nodes[id] || null },
    setInterval: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearInterval: (id) => { timers.delete(id); },
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  const app = {
    ctx,
    timers,
    run: (name) => vm.runInContext(name + '()', ctx),
    display: () => nodes['wbtb-wake-countdown'].textContent,
    active: () => classes.has('active'),
    // Advance the fake clock by whole seconds, firing every live interval.
    tick(seconds) {
      const seen = [];
      for (let i = 0; i < seconds; i++) {
        [...timers.values()].forEach((t) => t.fn());
        seen.push(app.display());
      }
      return seen;
    },
  };
  return app;
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log('PASS  ' + name); }
  catch (e) { failed += 1; console.log('FAIL  ' + name + '\n      ' + String(e.stack || e).split('\n').slice(0, 5).join('\n      ')); }
}

test('alarm opens the wake screen, then the notification tap opens it again: one countdown, not restarted', () => {
  const app = makeApp();
  app.run('openWBTBWakeScreen');
  app.tick(30);
  assert.strictEqual(app.display(), '24:30');
  app.run('openWBTBWakeScreen');
  assert.strictEqual(app.timers.size, 1, 'one countdown');
  assert.strictEqual(app.display(), '24:30', 'the tap does not reset it to 25:00');
  assert.deepStrictEqual(app.tick(3), ['24:29', '24:28', '24:27'], 'one second per second, never backwards');
});

test('closing the wake screen stops the countdown; nothing keeps running in the background', () => {
  const app = makeApp();
  app.run('openWBTBWakeScreen');
  app.run('openWBTBWakeScreen');
  app.run('closeWBTBWakeScreen');
  assert.strictEqual(app.timers.size, 0);
  const before = app.display();
  app.tick(5);
  assert.strictEqual(app.display(), before);
  assert.strictEqual(app.active(), false);
});

test('opening the wake screen again after closing it starts a fresh 25 minute countdown', () => {
  const app = makeApp();
  app.run('openWBTBWakeScreen');
  app.tick(90);
  app.run('closeWBTBWakeScreen');
  app.run('openWBTBWakeScreen');
  assert.strictEqual(app.display(), '25:00');
  assert.strictEqual(app.timers.size, 1);
  assert.deepStrictEqual(app.tick(2), ['24:59', '24:58']);
});

test('starting the countdown twice directly still leaves one timer', () => {
  const app = makeApp();
  app.run('startWBTBWakeCountdown');
  app.run('startWBTBWakeCountdown');
  assert.strictEqual(app.timers.size, 1);
});

test('the countdown ends at Sleep now and stops itself', () => {
  const app = makeApp();
  app.run('openWBTBWakeScreen');
  app.tick(25 * 60);
  assert.strictEqual(app.display(), 'Sleep now');
  assert.strictEqual(app.timers.size, 0);
  assert.strictEqual(vm.runInContext('wbtbWakeTimer', app.ctx), null);
});

test('the return prompt stops the wake countdown', () => {
  const app = makeApp();
  app.run('openWBTBWakeScreen');
  app.run('showWBTBReturnPrompt');
  assert.strictEqual(app.timers.size, 0);
  assert.strictEqual(app.active(), true);
  assert.strictEqual(app.display(), '');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
