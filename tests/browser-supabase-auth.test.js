// Browser integration for the session mechanics used by ABLTY's Google flow.
// Uses real supabase-js + a disposable local Supabase Auth server. Google ID
// token issuance is intentionally NOT exercised: a delayed password grant is
// used to produce a real isolated SDK session with controllable timing.
const assert = require('assert');
const http = require('http');
const { chromium } = require('playwright');
const { buildSupabaseBrowserBundle } = require('./helpers/supabase-browser-bundle');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.API_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('Missing local Supabase API_URL/ANON_KEY/SERVICE_ROLE_KEY environment.');
  process.exit(2);
}

const sdkBrowserBundle = buildSupabaseBrowserBundle();
const password = 'Local-test-password-42!';
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const alice = `alice-${suffix}@example.test`;
const bob = `bob-${suffix}@example.test`;

async function createUser(email) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!response.ok) throw new Error(`createUser(${email}) failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function session(page) {
  return page.evaluate(async () => (await window.authClient.auth.getSession()).data.session);
}

async function waitForUser(page, userId) {
  const deadline = Date.now() + 10000;
  do {
    const current = await session(page);
    if ((current?.user?.id || null) === userId) return current;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`timed out waiting for SDK user ${userId}`);
}

async function signIn(page, email) {
  const result = await page.evaluate(async ({ email, password }) => {
    const { data, error } = await window.authClient.auth.signInWithPassword({ email, password });
    return { userId: data.user?.id || null, error: error?.message || null };
  }, { email, password });
  assert.strictEqual(result.error, null);
  return result.userId;
}

(async () => {
  const [aliceUser, bobUser] = await Promise.all([createUser(alice), createUser(bob)]);
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><meta charset="utf-8"><title>ABLTY auth integration</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  async function pageWithPersistentClient() {
    const page = await context.newPage();
    await page.goto(origin);
    await page.addScriptTag({ path: sdkBrowserBundle });
    await page.evaluate(({ url, key }) => {
      window.authEvents = [];
      window.authClient = window.supabase.createClient(url, key, {
        auth: {
          storageKey: 'ablty-browser-integration',
          persistSession: true,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      window.authClient.auth.onAuthStateChange((event, value) => {
        window.authEvents.push({ event, userId: value?.user?.id || null, accessToken: value?.access_token || null });
      });
    }, { url: SUPABASE_URL, key: ANON_KEY });
    return page;
  }

  const first = await pageWithPersistentClient();
  const second = await pageWithPersistentClient();
  try {
    // Ordinary success and actual cross-tab propagation.
    assert.strictEqual(await signIn(first, alice), aliceUser.id);
    await waitForUser(second, aliceUser.id);
    console.log('PASS ordinary sign-in and cross-tab session propagation');

    // Cross-tab account replacement.
    assert.strictEqual(await signIn(second, bob), bobUser.id);
    await waitForUser(first, bobUser.id);
    assert.strictEqual((await session(first)).user.id, bobUser.id);
    assert.strictEqual((await session(second)).user.id, bobUser.id);
    console.log('PASS cross-tab account replacement keeps SDK sessions aligned');

    // Delay a real Auth token response on an isolated, nonpersistent client.
    let releaseAlice;
    let intercepted;
    const interceptedRequest = new Promise(resolve => { intercepted = resolve; });
    const releaseRequest = new Promise(resolve => { releaseAlice = resolve; });
    await first.route('**/auth/v1/token?grant_type=password', async route => {
      const body = route.request().postDataJSON();
      if (body?.email === alice) {
        intercepted();
        await releaseRequest;
      }
      await route.continue();
    });
    const stagedPromise = first.evaluate(async ({ url, key, email, password }) => {
      const staged = window.supabase.createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data, error } = await staged.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      window.stagedSession = data.session;
      return data.user.id;
    }, { url: SUPABASE_URL, key: ANON_KEY, email: alice, password });
    await interceptedRequest;

    // Application timeout/supersession is simulated here; the delayed token
    // response and resulting sessions are real SDK/backend behavior.
    const timeoutWinner = await Promise.race([
      stagedPromise.then(() => 'sdk'),
      new Promise(resolve => setTimeout(() => resolve('application-timeout'), 100)),
    ]);
    assert.strictEqual(timeoutWinner, 'application-timeout');
    assert.strictEqual((await session(first)).user.id, bobUser.id);
    releaseAlice();
    assert.strictEqual(await stagedPromise, aliceUser.id);
    assert.strictEqual((await session(first)).user.id, bobUser.id);
    assert.strictEqual((await session(second)).user.id, bobUser.id);
    console.log('PASS delayed isolated completion cannot replace persistent B session');

    // Adopt the real staged tokens and verify replacement reaches both tabs.
    const adopted = await first.evaluate(async () => {
      const { data, error } = await window.authClient.auth.setSession({
        access_token: window.stagedSession.access_token,
        refresh_token: window.stagedSession.refresh_token,
      });
      return { userId: data.user?.id || null, error: error?.message || null };
    });
    assert.deepStrictEqual(adopted, { userId: aliceUser.id, error: null });
    await waitForUser(second, aliceUser.id);
    console.log('PASS explicit staged-session adoption replaces both persistent tabs');

    // Real cross-tab sign-out must clear SDK state everywhere.
    await second.evaluate(() => window.authClient.auth.signOut());
    await waitForUser(first, null);
    assert.strictEqual(await session(first), null);
    assert.strictEqual(await session(second), null);
    console.log('PASS cross-tab sign-out clears both SDK sessions');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
