// Pre-beta step 7: during the beta, every Upgrade action tells the user
// "Premium subscriptions open at launch." and never opens the Stripe test
// checkout. Runs the real handleUpgradeCTA / openStripeCheckout /
// openCheckoutUrl from app.html with the app's own switch, then once more with
// the switch forced on to prove the Stripe path is preserved for launch.
// Run with:  node tests/upgrade-cta-beta.test.js
const vm = require('vm');
const assert = require('assert');
const { html, extractFn, extractDecl } = require('./helpers/extract-app-source');

const MESSAGE = 'Premium subscriptions open at launch.';
const FNS = ['handleUpgradeCTA', 'openStripeCheckout', 'openCheckoutUrl'];
const DECLS = ['PREMIUM_CHECKOUT_ENABLED', 'PREMIUM_CHECKOUT_CLOSED_MESSAGE'];

function build(overrideEnabled) {
  let decls = DECLS.map(extractDecl).join('\n');
  if (overrideEnabled !== undefined) {
    decls = decls.replace(/const PREMIUM_CHECKOUT_ENABLED = (true|false);/, 'const PREMIUM_CHECKOUT_ENABLED = ' + overrideEnabled + ';');
  }
  const source = decls + '\n\n' + FNS.map(extractFn).join('\n\n');
  new vm.Script(source);
  return source;
}

function makeCtx(source, { loggedIn, email }) {
  const calls = { toasts: [], opened: [], assigned: [], authScreens: [], modalClosed: 0, cacheCleared: 0 };
  const store = {};
  if (email) store.ablty_user_email = email;
  const ctx = {
    isLoggedIn: () => loggedIn,
    closeUpgradeModal: () => { calls.modalClosed += 1; },
    clearLocalAuthCache: () => { calls.cacheCleared += 1; },
    renderSettingsState() {}, renderProfile() {},
    showToast: (msg, type, duration) => calls.toasts.push({ msg, type, duration }),
    openAuthScreen: (mode) => calls.authScreens.push(mode),
    localStorage: { getItem: (k) => (k in store ? store[k] : null) },
    window: {
      open: (url) => { calls.opened.push(url); return { closed: false }; },
      location: { assign: (url) => calls.assigned.push(url) },
    },
    encodeURIComponent, String, console,
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return { ctx, calls };
}

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log('PASS  ' + name); }

const shipped = build();

test('the shipped switch is off', () => {
  assert.strictEqual(extractDecl('PREMIUM_CHECKOUT_ENABLED'), 'const PREMIUM_CHECKOUT_ENABLED = false;');
  assert.strictEqual(extractDecl('PREMIUM_CHECKOUT_CLOSED_MESSAGE'), "const PREMIUM_CHECKOUT_CLOSED_MESSAGE = 'Premium subscriptions open at launch.';");
});

test('signed-in user: Upgrade shows the launch message and opens nothing', () => {
  const { ctx, calls } = makeCtx(shipped, { loggedIn: true, email: 'tester@example.test' });
  ctx.handleUpgradeCTA();
  assert.strictEqual(calls.modalClosed, 1, 'upgrade modal closed');
  assert.deepStrictEqual(calls.toasts.map((t) => t.msg), [MESSAGE]);
  assert.strictEqual(calls.toasts[0].type, 'info');
  assert.deepStrictEqual(calls.opened, [], 'window.open never called');
  assert.deepStrictEqual(calls.assigned, [], 'location.assign never called');
  assert.deepStrictEqual(calls.authScreens, [], 'no auth screen for a signed-in user');
});

test('signed-in user without a cached email: still no checkout', () => {
  const { ctx, calls } = makeCtx(shipped, { loggedIn: true });
  ctx.handleUpgradeCTA();
  assert.deepStrictEqual(calls.toasts.map((t) => t.msg), [MESSAGE]);
  assert.deepStrictEqual(calls.opened.concat(calls.assigned), []);
});

test('guest: Upgrade still leads to free-account signup, with the launch message', () => {
  const { ctx, calls } = makeCtx(shipped, { loggedIn: false });
  ctx.handleUpgradeCTA();
  assert.strictEqual(calls.cacheCleared, 1);
  assert.deepStrictEqual(calls.authScreens, ['signup'], 'signup screen opened');
  assert.strictEqual(calls.toasts.length, 1);
  assert.ok(calls.toasts[0].msg.startsWith(MESSAGE), 'toast starts with the launch message: ' + calls.toasts[0].msg);
  assert.ok(/free account/i.test(calls.toasts[0].msg), 'toast still points to the free account');
  assert.deepStrictEqual(calls.opened.concat(calls.assigned), [], 'no checkout for a guest');
});

test('popup blocked: the shipped build never reaches the popup error either', () => {
  const { ctx, calls } = makeCtx(shipped, { loggedIn: true, email: 'a@b.test' });
  ctx.window.open = () => null;
  ctx.window.location.assign = () => { throw new Error('blocked'); };
  ctx.handleUpgradeCTA();
  assert.deepStrictEqual(calls.toasts.map((t) => t.msg), [MESSAGE]);
});

test('Stripe path is only reachable through openStripeCheckout, from handleUpgradeCTA, behind the switch', () => {
  const stripeLinks = html.match(/buy\.stripe\.com/g) || [];
  const stripeBody = extractFn('openStripeCheckout');
  const inStripeFn = (stripeBody.match(/buy\.stripe\.com/g) || []).length;
  assert.strictEqual(stripeLinks.length, inStripeFn, 'every buy.stripe.com link in app.html lives inside openStripeCheckout');
  const callers = html.match(/openStripeCheckout\(\)/g) || [];
  assert.strictEqual(callers.length, 2, 'openStripeCheckout() appears exactly twice: its definition and the one call');
  const cta = extractFn('handleUpgradeCTA');
  assert.ok(cta.includes('openStripeCheckout()'), 'the one call is in handleUpgradeCTA');
  assert.ok(cta.indexOf('if (!PREMIUM_CHECKOUT_ENABLED)') < cta.indexOf('openStripeCheckout()'), 'the switch is checked before the call');
  const checkoutCallers = html.match(/openCheckoutUrl\(/g) || [];
  assert.strictEqual(checkoutCallers.length, 2, 'openCheckoutUrl( appears exactly twice: its definition and the call inside openStripeCheckout');
  assert.ok(stripeBody.includes('openCheckoutUrl('), 'that call is inside openStripeCheckout');
  const onclickCount = (html.match(/onclick="handleUpgradeCTA\(\)"/g) || []).length;
  assert.strictEqual(onclickCount, 5, 'the five Upgrade buttons all route through handleUpgradeCTA');
});

test('launch readiness: with the switch on, the Stripe link opens with the prefilled email (path preserved)', () => {
  const on = build(true);
  const { ctx, calls } = makeCtx(on, { loggedIn: true, email: 'tester@example.test' });
  ctx.handleUpgradeCTA();
  assert.strictEqual(calls.opened.length, 1, 'checkout opened once');
  assert.ok(calls.opened[0].startsWith('https://buy.stripe.com/'), calls.opened[0]);
  assert.ok(calls.opened[0].includes('prefilled_email=tester%40example.test'));
  assert.deepStrictEqual(calls.toasts, [], 'no toast on a successful open');
});

test('launch readiness: with the switch on, a guest gets the original signup nudge', () => {
  const on = build(true);
  const { ctx, calls } = makeCtx(on, { loggedIn: false });
  ctx.handleUpgradeCTA();
  assert.deepStrictEqual(calls.toasts.map((t) => t.msg), ['Create a free account first, then upgrade.']);
  assert.deepStrictEqual(calls.authScreens, ['signup']);
});

test('launch readiness: with the switch on and popups blocked, the popup error still shows', () => {
  const on = build(true);
  const { ctx, calls } = makeCtx(on, { loggedIn: true, email: 'a@b.test' });
  ctx.window.open = () => null;
  ctx.window.location.assign = () => { throw new Error('blocked'); };
  ctx.handleUpgradeCTA();
  assert.deepStrictEqual(calls.toasts.map((t) => t.msg), ['Could not open checkout. Please allow popups.']);
});

console.log(`\n${passed} tests passed`);
