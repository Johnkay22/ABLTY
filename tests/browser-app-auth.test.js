// Browser integration for ABLTY's actual Google ownership/restoration code.
// The functions below are extracted verbatim from app.html. The browser and
// disposable backend use real supabase-js sessions; only Google ID-token
// issuance and profile/consent storage are simulated at the documented edge.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.API_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('Missing local Supabase API_URL/ANON_KEY/SERVICE_ROLE_KEY environment.');
  process.exit(2);
}

const html = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');
function extractFn(name) {
  const match = new RegExp(`^(async\\s+)?function\\s+${name}\\s*\\(`, 'm').exec(html);
  if (!match) throw new Error(`app.html function not found: ${name}`);
  let index = html.indexOf(')', match.index + match[0].length);
  index = html.indexOf('{', index);
  let depth = 0;
  for (; index < html.length; index++) {
    if (html[index] === '{') depth++;
    if (html[index] === '}' && --depth === 0) break;
  }
  return html.slice(match.index, index + 1);
}

const appFunctions = [
  'beginAuthContext', 'endAuthContext', 'isAuthGenCurrent', 'isAuthResultUsable',
  'trackAuthEntry', 'untrackAuthEntry', 'onSignedIn', 'clearLocalAuthCache',
  'createGoogleStagingClient', 'restoreAfterStaleGoogleAdoption',
  'settleSupersededGoogleRestoration', 'settleDiscardedGoogleAttempt',
  'handleAuthStateChange', 'setGoogleSignInStatus', 'initGoogleSignIn',
].map(extractFn).join('\n\n');

const sdkMain = require.resolve('@supabase/supabase-js');
const sdkUmd = path.resolve(path.dirname(sdkMain), '..', 'umd', 'supabase.js');
const password = 'Local-test-password-42!';
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const alice = `app-alice-${suffix}@example.test`;
const bob = `app-bob-${suffix}@example.test`;

async function createUser(email) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!response.ok) throw new Error(`createUser(${email}) failed: ${response.status} ${await response.text()}`);
  return response.json();
}

const harness = `
let _authGen = 0;
let _activeAuthUserId = null;
let _authEntries = new Set();
let _enteredUserId = null;
let _passwordRecoveryPending = false;
let _passwordRecoveryUserId = null;
let _legalGate = null;
let _guestSyncHandled = false;
let _googleSignInAttempt = null;
let _googleAdoption = null;
let _googleRestoration = null;
let googleSignInInitialized = false;
const GOOGLE_SIGNIN_TIMEOUT_MS = 120;
const SUPABASE_URL = window.__testConfig.url;
const SUPABASE_ANON = window.__testConfig.key;
const GOOGLE_CLIENT_ID = 'simulated-integration-client';
const sb = window.authClient;
const _realSdk = window.supabase;
const _supabaseSdk = {
  createClient(url, key, options) {
    const client = _realSdk.createClient(url, key, options);
    client.auth.signInWithIdToken = ({ token }) => window.__stagingExchange(client, token);
    return client;
  }
};
let currentScreen = 'home';
const toasts = [];
function showToast(message, type) { toasts.push({ message, type }); }
function cancelPendingPasswordRecovery() { _passwordRecoveryPending = false; _passwordRecoveryUserId = null; }
function resolveLegalGate() { _legalGate = null; }
function resetDreamJournalState() {}
function renderSettingsState() {}
function renderProfile() {}
function renderHomeGreeting() {}
function navigate() {}
function onPasswordRecoveryEvent() {}
function hydrateProfileFromSession() { return Promise.resolve(); }
function closeAuthScreen() {}
function skipOnboarding() {}
function readLegalDraft() { return null; }
function setLegalDraft() {}
function bindPendingLegalAcceptance() {}
function tryOpenPendingPasswordRecovery() {}
async function completeSignIn(user) {
  beginAuthContext(user.id);
  localStorage.setItem('ablty_logged_in', '1');
  localStorage.setItem('ablty_user_email', user.email || '');
  localStorage.setItem('ablty_cache_user_id', String(user.id));
  return true;
}
${appFunctions}
window.__googleCallback = null;
window.google = { accounts: { id: {
  initialize(options) { window.__googleCallback = options.callback; },
  renderButton() {}
} } };
window.__stagingGates = new Map();
window.__stagingExchange = async (client, token) => {
  const account = window.__testConfig.accounts[token];
  if (!account) throw new Error('unknown simulated Google credential');
  const gate = window.__stagingGates.get(token);
  if (gate) await gate.promise;
  return client.auth.signInWithPassword({ email: account.email, password: account.password });
};
window.__delayStaging = token => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  window.__stagingGates.set(token, { promise, release });
};
window.__releaseStaging = token => window.__stagingGates.get(token)?.release();
window.__delayNextAdoption = () => {
  const original = sb.auth.setSession.bind(sb.auth);
  let release;
  let startedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let delayed = false;
  sb.auth.setSession = async tokens => {
    if (!delayed) { delayed = true; startedResolve(); await gate; }
    return original(tokens);
  };
  window.__adoptionGate = { started, release };
};
window.__state = async () => ({
  sdkUserId: (await sb.auth.getSession()).data.session?.user?.id || null,
  sdkAccessToken: (await sb.auth.getSession()).data.session?.access_token || null,
  enteredUserId: _enteredUserId,
  activeUserId: _activeAuthUserId,
  loggedIn: localStorage.getItem('ablty_logged_in'),
  progressVisible: !!document.getElementById('google-signin-status')?.classList.contains('visible'),
  toasts: toasts.slice(),
});
initGoogleSignIn();
sb.auth.onAuthStateChange(handleAuthStateChange);
`;
new Function(harness); // Fail locally if extraction produced invalid browser JS.

async function eventually(fn, description) {
  const deadline = Date.now() + 10000;
  let value;
  while (Date.now() < deadline) {
    value = await fn();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}; last value: ${JSON.stringify(value)}`);
}

(async () => {
  const [aliceUser, bobUser] = await Promise.all([createUser(alice), createUser(bob)]);
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><div id="google-signin-status"><span id="google-signin-status-label"></span></div><div id="ob-google-btn-wrap"></div><div id="login-google-btn-wrap"></div><div id="signup-google-btn-wrap"></div>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });

  async function scenario() {
    const context = await browser.newContext();
    const app = await context.newPage();
    const peer = await context.newPage();
    for (const page of [app, peer]) {
      await page.goto(origin);
      await page.addScriptTag({ path: sdkUmd });
    }
    const config = { url: SUPABASE_URL, key: ANON_KEY, accounts: { alice: { email: alice, password }, bob: { email: bob, password } } };
    await app.evaluate(config => {
      window.__testConfig = config;
      window.authClient = window.supabase.createClient(config.url, config.key, {
        auth: { storageKey: 'ablty-app-integration', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
      });
    }, config);
    await app.addScriptTag({ content: harness });
    await peer.evaluate(config => {
      window.peerClient = window.supabase.createClient(config.url, config.key, {
        auth: { storageKey: 'ablty-app-integration', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
      });
    }, config);
    return { context, app, peer };
  }

  async function peerSignIn(peer, email) {
    return peer.evaluate(async ({ email, password }) => {
      const { data, error } = await window.peerClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return { userId: data.user.id, accessToken: data.session.access_token };
    }, { email, password });
  }

  try {
    // Google issuance is simulated, but the delayed staging exchange and B
    // session use the real isolated/persistent SDK clients and Auth backend.
    {
      const { context, app, peer } = await scenario();
      await peerSignIn(peer, bob);
      await eventually(async () => (await app.evaluate(() => __state())).enteredUserId === bobUser.id, 'B to enter ABLTY');
      await app.evaluate(() => { __delayStaging('alice'); __googleCallback({ credential: 'alice' }); });
      await new Promise(resolve => setTimeout(resolve, 180));
      await app.evaluate(() => __releaseStaging('alice'));
      await new Promise(resolve => setTimeout(resolve, 200));
      const state = await app.evaluate(() => __state());
      assert.strictEqual(state.sdkUserId, bobUser.id);
      assert.strictEqual(state.enteredUserId, bobUser.id);
      assert.strictEqual(state.loggedIn, '1');
      assert.strictEqual(state.progressVisible, false);
      console.log('PASS app functions: timed-out staged completion cannot replace B');
      await context.close();
    }

    // Sign-out while main-client adoption is delayed must win in both SDK
    // state and ABLTY's entered/logged-in state.
    {
      const { context, app, peer } = await scenario();
      await peerSignIn(peer, bob);
      await eventually(async () => (await app.evaluate(() => __state())).enteredUserId === bobUser.id, 'B to enter ABLTY');
      await app.evaluate(() => { __delayNextAdoption(); __googleCallback({ credential: 'alice' }); });
      await app.evaluate(() => __adoptionGate.started);
      await peer.evaluate(() => peerClient.auth.signOut());
      await eventually(async () => (await app.evaluate(() => __state())).enteredUserId === null, 'ABLTY sign-out');
      await app.evaluate(() => __adoptionGate.release());
      const state = await eventually(async () => {
        const value = await app.evaluate(() => __state());
        return value.sdkUserId === null && value.enteredUserId === null ? value : null;
      }, 'stale adoption cleanup after sign-out');
      assert.strictEqual(state.loggedIn, null);
      console.log('PASS app functions: sign-out wins during delayed adoption/restoration');
      await context.close();
    }

    // Independent other-account and same-account sessions both supersede the
    // old adoption. Exact access-token equality proves the fresh session wins.
    for (const replacement of [
      { label: 'other-account', email: bob, userId: bobUser.id },
      { label: 'same-account', email: alice, userId: aliceUser.id },
    ]) {
      const { context, app, peer } = await scenario();
      await app.evaluate(() => { __delayNextAdoption(); __googleCallback({ credential: 'alice' }); });
      await app.evaluate(() => __adoptionGate.started);
      const fresh = await peerSignIn(peer, replacement.email);
      await eventually(async () => (await app.evaluate(() => __state())).sdkAccessToken === fresh.accessToken, `${replacement.label} replacement`);
      await app.evaluate(() => __adoptionGate.release());
      const state = await eventually(async () => {
        const value = await app.evaluate(() => __state());
        return value.sdkAccessToken === fresh.accessToken && value.enteredUserId === replacement.userId ? value : null;
      }, `${replacement.label} restoration`);
      assert.strictEqual(state.sdkUserId, replacement.userId);
      assert.strictEqual(state.loggedIn, '1');
      console.log(`PASS app functions: ${replacement.label} session supersedes delayed Google adoption`);
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
