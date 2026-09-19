// Runs the real auth / consent code extracted from app.html inside a VM with a
// mock Supabase client, localStorage, DOM and Google Identity object. The
// functions under test are the ones in app.html; nothing is re-implemented
// here. Run with:  node tests/auth-consent.test.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');

function extractFn(name) {
  const re = new RegExp(`^(async\\s+)?function\\s+${name}\\s*\\(`, 'm');
  const m = re.exec(html);
  if (!m) throw new Error('function not found: ' + name);
  // Skip the parameter list (it may contain default values such as `{}`)
  // and start counting braces at the function body.
  let i = html.indexOf(')', m.index + m[0].length);
  i = html.indexOf('{', i);
  let depth = 0;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) break; }
  }
  return html.slice(m.index, i + 1);
}
function extractDecl(name) {
  const re = new RegExp(`^(const|let)\\s+${name}\\s*=.*;$`, 'm');
  const m = re.exec(html);
  if (!m) throw new Error('declaration not found: ' + name);
  return m[0];
}

const DECLS = ['_authGen', '_activeAuthUserId', '_authEntries', '_passwordRecoveryPending', '_passwordRecoveryUserId', '_enteredUserId', 'LEGAL_VERSION', 'LEGAL_DRAFT_KEY', 'LEGAL_VERIFIED_KEY', '_legalGate', 'PROFILE_SESSION_COLUMNS', 'googleSignInInitialized', '_googleSignInAttempt', '_googleAdoption', '_googleRestoration', 'GOOGLE_SIGNIN_TIMEOUT_MS', 'SUPABASE_URL', 'SUPABASE_ANON', '_supabaseSdk'];
const FNS = ['legalPendingKey', 'normalizeEmailForLegal', 'readLegalRecord', 'readLegalDraft', 'setLegalDraft', 'clearLegalDraft',
  'readPendingLegalAcceptance', 'bindPendingLegalAcceptance', 'pendingLegalFieldsFor', 'discardUnboundLegalDraft',
  'profileHasLegalAcceptance', 'recordPendingLegalAcceptance', 'readLegalVerified', 'markLegalVerified', 'hasLegalVerified',
  'legalGateEl', 'setLegalGateMode', 'openLegalGate', 'resolveLegalGate', 'ensureLegalConsent', 'onLegalGateCheckChange',
  'submitLegalGate', 'retryLegalGate', 'legalGateSignOut', 'preflightLegalGate',
  'onSignupTosChange', 'openAuthScreen', 'closeAuthScreen', 'setAuthError', 'clearLocalAuthCache',
  'writeLocalAccountCache', 'readLocalAccountCache',
  'beginAuthContext', 'endAuthContext', 'isAuthGenCurrent', 'isAuthResultUsable', 'trackAuthEntry', 'untrackAuthEntry', 'authEntriesInFlight',
  'reconcileAuthState', 'checkAuthCallback', 'resumeSessionAfterPayment',
  'handleLogin', 'onPasswordRecoveryEvent', 'cancelPendingPasswordRecovery', 'tryOpenPendingPasswordRecovery', 'openChangePasswordModal', 'isLoggedIn', 'completeSignIn', 'hydrateProfileEntry',
  'ensureProfileRow', 'onSignedIn', 'hydrateProfileFromSession', 'handleSignup', 'validateUsername', 'checkUsernameTaken',
  'createGoogleStagingClient', 'restoreAfterStaleGoogleAdoption', 'settleSupersededGoogleRestoration', 'settleDiscardedGoogleAttempt', 'handleAuthStateChange', 'setGoogleSignInStatus', 'initGoogleSignIn',
  'renderSettingsState', 'getCurrentTier', 'mergeSessionArrays', 'loadAnalyticsFromCloud'];
const source = DECLS.map(extractDecl).join('\n') + '\n\n' + FNS.map(extractFn).join('\n\n');
new vm.Script(source); // compiles => extraction boundaries are right

// Guard rails on copy: no em dashes or emoji in the gate copy.
{
  const gateJs = extractFn('setLegalGateMode') + extractFn('submitLegalGate');
  const gateHtml = html.slice(html.indexOf('id="screen-legal-gate"'), html.indexOf('UPGRADE MODAL'));
  assert.ok(!/\u2014/.test(gateJs + gateHtml), 'no em dashes in gate copy');
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(gateJs + gateHtml), 'no emoji in gate copy');
}

function makeLocalStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _map: m,
  };
}

function makeSb(h) {
  const calls = [];
  let currentSession = null;
  let authListener = null;
  const client = {
    calls,
    from(table) {
      const q = { table };
      const b = {
        select(cols) { q.op = 'select'; q.cols = cols; return b; },
        eq(k, v) { q.eq = [k, v]; return b; },
        maybeSingle() { calls.push({ ...q }); return Promise.resolve(h.select(q)); },
        order() { return b; },
        limit() { q.list = true; calls.push({ ...q }); return Promise.resolve(h.select(q)); },
        upsert(row, opts) { const c = { table, op: 'upsert', row, opts }; calls.push(c); return Promise.resolve(h.upsert ? h.upsert(c) : { error: null }); },
        update(patch) {
          q.op = 'update'; q.patch = patch;
          return { eq(k, v) { q.eq = [k, v]; calls.push({ ...q }); return Promise.resolve(h.update ? h.update(q) : { error: null }); } };
        },
      };
      return b;
    },
    rpc(name, args) { calls.push({ op: 'rpc', name, args }); return Promise.resolve(h.rpc ? h.rpc(name, args) : { data: false, error: null }); },
    auth: {
      signUp: o => Promise.resolve(h.signUp ? h.signUp(o) : { data: { user: null }, error: null }),
      signInWithPassword: o => { calls.push({ op: 'signInWithPassword' }); return Promise.resolve(h.signInWithPassword ? h.signInWithPassword(o) : { data: { user: null }, error: null }); },
      signInWithIdToken: o => { calls.push({ op: 'signInWithIdToken' }); return Promise.resolve(h.signInWithIdToken ? h.signInWithIdToken(o) : { data: { user: null }, error: null }); },
      signOut: opts => {
        calls.push({ op: 'signOut', opts });
        if (h.signOut) return Promise.resolve(h.signOut(opts));
        currentSession = null;
        if (authListener) authListener('SIGNED_OUT', null);
        return Promise.resolve({ error: null });
      },
      getSession: () => Promise.resolve(h.getSession ? h.getSession() : { data: { session: currentSession } }),
      setSession: o => {
        calls.push({ op: 'setSession' });
        return Promise.resolve(h.setSession ? h.setSession(o) : { data: { user: null, session: null }, error: null }).then(result => {
          const user = result?.data?.user || result?.data?.session?.user;
          if (user) {
            currentSession = result.data.session || { user };
            if (authListener) authListener('SIGNED_IN', currentSession);
          }
          return result;
        });
      },
      onAuthStateChange: cb => { authListener = cb; return { data: { subscription: { unsubscribe() {} } } }; },
    },
  };
  client._emitAuth = (event, session) => {
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED' || event === 'PASSWORD_RECOVERY') currentSession = session || null;
    if (event === 'SIGNED_OUT') currentSession = null;
    return authListener ? authListener(event, session) : undefined;
  };
  client._session = () => currentSession;
  return client;
}

function makeDom(values = {}) {
  const els = {};
  const get = id => {
    if (!id) return null;
    if (!(id in els)) {
      const set = new Set();
      els[id] = {
        id, value: values[id] ?? '', checked: !!values[id + ':checked'], disabled: false, textContent: '', style: {},
        setAttribute(name, value) { this[name] = value; },
        classList: { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c), toggle(c, on) { on ? set.add(c) : set.delete(c); }, _set: set },
      };
    }
    return els[id];
  };
  return {
    getElementById: get,
    querySelector: () => null,
    querySelectorAll: selector => selector === '#ob-google-btn-wrap, #login-google-btn-wrap, #signup-google-btn-wrap'
      ? ['ob-google-btn-wrap', 'login-google-btn-wrap', 'signup-google-btn-wrap'].map(get)
      : [],
    _els: els,
  };
}

function makeCtx({ sbHandlers, dom, storage, timers } = {}) {
  const warns = [];
  const ls = storage || makeLocalStorage();
  const toasts = [];
  const handlers = sbHandlers || {};
  let stagedUser = null;
  const stagingClients = [];
  const sdkCalls = [];
  const mainHandlers = new Proxy(handlers, {
    get(target, property) {
      if (property === 'setSession' && !target.setSession) {
        return () => ({
          data: stagedUser
            ? { user: stagedUser, session: { user: stagedUser, access_token: 'main-access', refresh_token: 'main-refresh' } }
            : { user: null, session: null },
          error: null,
        });
      }
      return target[property];
    },
  });
  const sdk = {
    createClient(...args) {
      sdkCalls.push(args);
      const stagingHandlers = {
        ...handlers,
        async signInWithIdToken(options) {
          const result = await (handlers.signInWithIdToken
            ? handlers.signInWithIdToken(options)
            : { data: { user: null }, error: null });
          if (result?.data?.user) {
            stagedUser = result.data.user;
            if (!result.data.session) {
              result.data.session = { user: stagedUser, access_token: 'staged-access', refresh_token: 'staged-refresh' };
            }
          }
          return result;
        },
      };
      const client = makeSb(stagingHandlers);
      stagingClients.push(client);
      return client;
    },
  };
  const ctx = {
    console: { warn: (...a) => warns.push(a.map(String).join(' ')), log() {}, error: (...a) => warns.push('ERR ' + a.join(' ')) },
    localStorage: ls,
    sb: makeSb(mainHandlers),
    document: dom || makeDom({}),
    location: { reload() { ctx.reloads++; } }, reloads: 0,
    window: { location: { hash: '', search: '' }, supabase: sdk }, history: { replaceState() {} }, URLSearchParams,
    setTimeout: timers?.setTimeout || setTimeout, clearTimeout: timers?.clearTimeout || clearTimeout, atob,
    // onSignedIn side-effect stubs
    renderProfile() {}, renderHomeGreeting() {}, updateSyncStatus() {},
    hasLocalGuestData: () => false, renderAnalytics() {},
    STATE: { sessions: [] }, saveState() {}, loadZenerSessions: () => [], loadTimestampAll: () => [],
    renderDreamJournal() {}, renderDreamEntryDetail() {}, guestModalCalls: 0,
    showGuestDataModal: async () => { ctx.guestModalCalls++; return 'fresh'; },
    clearLocalGuestData() {}, syncLocalDataToSupabase: async () => {},
    currentScreen: 'home', _guestSyncHandled: false, resetDreamJournalState() {},
    // handleSignup / auth-screen stubs
    authErrors: [], clearAuthErrors() {}, renderGoogleButton() {}, skipOnboarding() {}, navigate() {},
    showToast: (msg, type) => toasts.push([msg, type]), toasts,
    GOOGLE_CLIENT_ID: 'test-client',
    Date, JSON, String, Object, Array, Error, Promise, RegExp, Number, Map, Set,
  };
  ctx.warns = warns;
  ctx.ls = ls;
  ctx.stagingClients = stagingClients;
  ctx.sdkCalls = sdkCalls;
  vm.createContext(ctx);
  vm.runInContext(source.replace(/^const SUPABASE_URL\s*=.*$/m, "const SUPABASE_URL = 'https://ghjajyxcjfqidcmqdzdp.supabase.co';"), ctx);
  ctx.eval = code => vm.runInContext(code, ctx);
  ctx.gate = () => ctx.eval('_legalGate');
  ctx.gateActive = () => !!ctx.document._els['screen-legal-gate']?.classList.contains('active');
  // Google Identity mock: captures the callback initGoogleSignIn registers.
  ctx.google = { accounts: { id: { initialize(cfg) { ctx.googleCallback = cfg.callback; }, renderButton() {} } } };
  ctx.initGoogleSignIn();
  return ctx;
}

const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const fakeTimers = () => {
  const jobs = [];
  return {
    jobs,
    setTimeout(fn, ms) { const job = { fn, ms, cleared: false }; jobs.push(job); return job; },
    clearTimeout(job) { if (job) job.cleared = true; },
    fire(ms) { for (const job of jobs.filter(j => j.ms === ms && !j.cleared)) { job.cleared = true; job.fn(); } },
  };
};
const googleTokenFor = email => {
  const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return enc({ alg: 'none' }) + '.' + enc({ email }) + '.sig';
};

const DRAFT = 'ablty_pending_legal_acceptance';
const VERIFIED = 'ablty_legal_verified';
const V = '2026-07-19';
const ME = { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', email: 'Alice@Example.com' };
const BOB = { id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', email: 'bob@example.com' };
const keyFor = u => 'ablty_legal_acceptance_pending:' + u.id;
const AT = '2026-09-11T10:00:00.000Z';
const boundFor = (u, extra) => JSON.stringify({ at: AT, version: V, userId: u.id, email: String(u.email).toLowerCase(), ...extra });
const profileNoLegal = { username: 'alice', tier: 'free', username_changed_at: null, terms_accepted_at: null, privacy_accepted_at: null };
const profileWithLegal = { ...profileNoLegal, terms_accepted_at: AT, privacy_accepted_at: AT };
const FOUR = at => JSON.stringify({ terms_accepted_at: at, terms_version: V, privacy_accepted_at: at, privacy_version: V });

const updates = c => c.sb.calls.filter(x => x.op === 'update');
const upserts = c => c.sb.calls.filter(x => x.op === 'upsert' && x.table === 'profiles');

// A tiny in-memory "profiles table" so create -> read-back -> gate -> update -> read-back flows work end to end.
function makeDb(rows = {}) {
  const db = { rows, failSelect: false, failUpdate: false, failUpsert: null, hold: null };
  const answer = q => {
    if (q.list) return { data: [], error: null };
    return db.failSelect ? { data: null, error: { message: 'Failed to fetch' } } : { data: db.rows[q.eq[1]] ? { ...db.rows[q.eq[1]] } : null, error: null };
  };
  db.handlers = {
    // db.hold(q) may return a promise; the response is then delayed until it
    // resolves (and, if it resolves to an object, replaced by that object).
    select: q => {
      const h = db.hold && db.hold(q);
      if (h && typeof h.then === 'function') return h.then(v => (v && typeof v === 'object' && 'data' in v) ? v : answer(q));
      return answer(q);
    },
    upsert: c => {
      if (c.table !== 'profiles') return { error: null };
      if (db.failUpsert) return { error: db.failUpsert };
      const dup = Object.entries(db.rows).some(([id, r]) => id !== c.row.id && r.username === c.row.username);
      if (dup) return { error: { code: '23505', message: 'dup' } };
      db.rows[c.row.id] = { username_changed_at: null, terms_accepted_at: null, privacy_accepted_at: null, ...(db.rows[c.row.id] || {}), ...c.row };
      return { error: null };
    },
    update: q => {
      if (db.failUpdate) return { error: { message: 'network down' } };
      if (db.rows[q.eq[1]]) Object.assign(db.rows[q.eq[1]], q.patch);
      return { error: null };
    },
  };
  return db;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// Ticks the gate box and presses I AGREE.
async function agreeAtGate(c) {
  const cb = c.document.getElementById('legal-gate-check');
  cb.checked = true;
  c.onLegalGateCheckChange(cb);
  assert.strictEqual(c.document.getElementById('legal-gate-btn').disabled, false);
  await c.submitLegalGate();
  await tick();
}

// ═══════════════════════════════════════════════════════
//  PENDING ACCEPTANCE: owned records, retries, ownership
// ═══════════════════════════════════════════════════════
test('C1 existing profile, null legal, owned pending -> 4 fields written, pending removed, no gate', async () => {
  const db = makeDb({ [ME.id]: { ...profileNoLegal } });
  const c = makeCtx({ sbHandlers: db.handlers });
  c.ls.setItem(keyFor(ME), boundFor(ME));
  const entered = await c.onSignedIn(ME);
  assert.strictEqual(entered, true);
  const u = updates(c);
  assert.strictEqual(u.length, 1);
  assert.strictEqual(JSON.stringify(u[0].patch), FOUR(AT));
  assert.deepStrictEqual(u[0].eq, ['id', ME.id]);
  assert.strictEqual(c.ls.getItem(keyFor(ME)), null);
  assert.strictEqual(c.gateActive(), false);
  assert.strictEqual(JSON.parse(c.ls.getItem(VERIFIED)).userId, ME.id);
});

test('C2 existing profile, consent UPDATE fails -> pending retained, warning logged, gate asks again', async () => {
  const db = makeDb({ [ME.id]: { ...profileNoLegal } });
  db.failUpdate = true;
  const c = makeCtx({ sbHandlers: db.handlers });
  c.ls.setItem(keyFor(ME), boundFor(ME));
  const p = c.onSignedIn(ME);
  await tick();
  assert.strictEqual(c.ls.getItem(keyFor(ME)), boundFor(ME), 'pending record must survive a failed write');
  assert.ok(c.warns.some(w => /keeping it for retry/.test(w)));
  assert.strictEqual(c.gateActive(), true);
  assert.strictEqual(c.gate().mode, 'consent');
  // Network returns; the user agrees at the gate; the retained record is superseded and removed.
  db.failUpdate = false;
  await agreeAtGate(c);
  assert.strictEqual(await p, true);
  assert.strictEqual(c.ls.getItem(keyFor(ME)), null);
});

test('C3 existing profile already has consent, owned pending -> no write, pending removed as redundant', async () => {
  const c = makeCtx({ sbHandlers: makeDb({ [ME.id]: { ...profileWithLegal } }).handlers });
  c.ls.setItem(keyFor(ME), boundFor(ME));
  await c.onSignedIn(ME);
  assert.strictEqual(updates(c).length, 0);
  assert.strictEqual(c.ls.getItem(keyFor(ME)), null);
});

test('C3b existing profile with only terms set -> only privacy fields patched', async () => {
  const c = makeCtx({ sbHandlers: makeDb({ [ME.id]: { ...profileNoLegal, terms_accepted_at: '2026-01-01T00:00:00Z' } }).handlers });
  c.ls.setItem(keyFor(ME), boundFor(ME));
  await c.onSignedIn(ME);
  assert.strictEqual(JSON.stringify(updates(c)[0].patch), JSON.stringify({ privacy_accepted_at: AT, privacy_version: V }));
});

test('C4 no profile, owned pending -> upsert includes legal fields, pending removed after success, no gate', async () => {
  const c = makeCtx({ sbHandlers: makeDb().handlers });
  c.ls.setItem(keyFor(ME), boundFor(ME));
  const entered = await c.onSignedIn({ ...ME, user_metadata: { username: 'alice' } });
  assert.strictEqual(entered, true);
  const up = upserts(c);
  assert.strictEqual(up.length, 1);
  assert.strictEqual(up[0].row.terms_accepted_at, AT);
  assert.strictEqual(up[0].row.privacy_version, V);
  assert.strictEqual(c.ls.getItem(keyFor(ME)), null);
  assert.strictEqual(c.gateActive(), false);
});

test('C5 no profile, upsert fails (non-collision) -> pending retained, connection gate (nothing assumed)', async () => {
  const db = makeDb(); db.failUpsert = { code: 'PGRST000', message: 'offline' };
  const c = makeCtx({ sbHandlers: db.handlers });
  c.ls.setItem(keyFor(ME), boundFor(ME));
  const p = c.onSignedIn(ME);
  await tick();
  assert.strictEqual(upserts(c).length, 1);
  assert.strictEqual(c.ls.getItem(keyFor(ME)), boundFor(ME));
  assert.ok(c.warns.some(w => /Profile creation failed; keeping pending legal acceptance/.test(w)));
  assert.strictEqual(c.gate().mode, 'connection');
  // Try again once the database is reachable: the row is created WITH the retained acceptance.
  db.failUpsert = null;
  await c.retryLegalGate();
  await tick();
  assert.strictEqual(await p, true);
  assert.strictEqual(db.rows[ME.id].terms_accepted_at, AT);
  assert.strictEqual(c.ls.getItem(keyFor(ME)), null);
});

test('C5b no profile, username collision then fallback also fails -> pending retained', async () => {
  const c = makeCtx({ sbHandlers: { select: () => ({ data: null }), upsert: () => ({ error: { code: '23505', message: 'dup' } }) } });
  c.ls.setItem(keyFor(ME), boundFor(ME));
  const p = c.onSignedIn({ ...ME, user_metadata: { username: 'alice' } });
  await tick();
  const up = upserts(c);
  assert.strictEqual(up.length, 2, 'desired then fallback');
  assert.strictEqual(up[1].row.username, 'seeker_aaaaaaaa');
  assert.strictEqual(c.ls.getItem(keyFor(ME)), boundFor(ME));
  assert.strictEqual(c.gate().mode, 'connection');
  await c.legalGateSignOut();
  assert.strictEqual(await p, false);
});

test('C5c no profile, collision then fallback succeeds -> legal fields on the fallback row, pending removed', async () => {
  const db = makeDb({ [BOB.id]: { username: 'alice', tier: 'free', terms_accepted_at: AT, privacy_accepted_at: AT } });
  const c = makeCtx({ sbHandlers: db.handlers });
  c.ls.setItem(keyFor(ME), boundFor(ME));
  await c.onSignedIn({ ...ME, user_metadata: { username: 'alice' } });
  const up = upserts(c);
  assert.strictEqual(up[1].row.username, 'seeker_aaaaaaaa');
  assert.strictEqual(up[1].row.terms_accepted_at, AT);
  assert.strictEqual(c.ls.getItem(keyFor(ME)), null);
});

test('C6 pending owned by ANOTHER user, existing profile -> never written, retained; B is gated instead', async () => {
  const c = makeCtx({ sbHandlers: makeDb({ [ME.id]: { ...profileNoLegal } }).handlers });
  c.ls.setItem(keyFor(BOB), boundFor(BOB));
  const p = c.onSignedIn(ME);
  await tick();
  assert.strictEqual(updates(c).length, 0, 'no consent write for a different account');
  assert.strictEqual(c.ls.getItem(keyFor(BOB)), boundFor(BOB), 'other account\'s record left intact');
  assert.strictEqual(c.gate().mode, 'consent');
  await agreeAtGate(c);
  assert.strictEqual(await p, true);
  assert.strictEqual(c.ls.getItem(keyFor(BOB)), boundFor(BOB), 'still intact after A agrees');
  const u = updates(c);
  assert.strictEqual(u.length, 1);
  assert.notStrictEqual(u[0].patch.terms_accepted_at, AT, 'A\'s acceptance time is A\'s own, not B\'s tick time');
});

test('C6b pending owned by ANOTHER user, no profile -> created WITHOUT legal fields, record retained', async () => {
  const c = makeCtx({ sbHandlers: makeDb().handlers });
  c.ls.setItem(keyFor(BOB), boundFor(BOB));
  const p = c.onSignedIn(ME);
  await tick();
  const up = upserts(c);
  assert.strictEqual(up.length, 1);
  assert.ok(!('terms_accepted_at' in up[0].row) && !('privacy_accepted_at' in up[0].row), 'row must not carry someone else\'s consent');
  assert.strictEqual(c.ls.getItem(keyFor(BOB)), boundFor(BOB));
  assert.strictEqual(c.gate().mode, 'consent');
  await c.legalGateSignOut();
  assert.strictEqual(await p, false);
});

test('C7 record under A\'s key but carrying B\'s id -> invalid, removed with warning, never written', async () => {
  const c = makeCtx({ sbHandlers: makeDb({ [ME.id]: { ...profileNoLegal } }).handlers });
  c.ls.setItem(keyFor(ME), boundFor(BOB));
  const p = c.onSignedIn(ME);
  await tick();
  assert.strictEqual(updates(c).length, 0);
  assert.strictEqual(c.ls.getItem(keyFor(ME)), null);
  assert.ok(c.warns.some(w => /does not match its owner key/.test(w)));
  await c.legalGateSignOut();
  await p;
});

test('C8 legacy ownerless record at the draft key, sign-in from login -> discarded with warning, never written', async () => {
  const c = makeCtx({ sbHandlers: makeDb({ [ME.id]: { ...profileNoLegal } }).handlers });
  c.ls.setItem(DRAFT, JSON.stringify({ at: AT, version: V }));
  const p = c.onSignedIn(ME);
  await tick();
  assert.strictEqual(updates(c).length, 0);
  assert.strictEqual(c.ls.getItem(DRAFT), null);
  assert.ok(c.warns.some(w => /never tied to an account/.test(w)));
  await c.legalGateSignOut();
  await p;
});

test('C8b draft present while the signup screen is open (deep-link sign-in) -> left alone, never written', async () => {
  const dom = makeDom();
  dom.getElementById('screen-signup').classList.add('active');
  const c = makeCtx({ dom, sbHandlers: makeDb({ [ME.id]: { ...profileNoLegal } }).handlers });
  const draft = JSON.stringify({ at: AT, version: V, email: 'someone@example.com' });
  c.ls.setItem(DRAFT, draft);
  const p = c.onSignedIn(ME);
  await tick();
  assert.strictEqual(updates(c).length, 0);
  assert.strictEqual(c.ls.getItem(DRAFT), draft);
  await c.legalGateSignOut();
  await p;
});

test('C9 corrupt owned record -> removed with warning, no write', async () => {
  const c = makeCtx({ sbHandlers: makeDb({ [ME.id]: { ...profileWithLegal } }).handlers });
  c.ls.setItem(keyFor(ME), '{not json');
  await c.onSignedIn(ME);
  assert.strictEqual(updates(c).length, 0);
  assert.strictEqual(c.ls.getItem(keyFor(ME)), null);
  assert.ok(c.warns.some(w => /Corrupt ablty_legal_acceptance_pending/.test(w)));
});

test('C9b owned record missing at/version -> treated as corrupt', async () => {
  const c = makeCtx({ sbHandlers: makeDb({ [ME.id]: { ...profileWithLegal } }).handlers });
  c.ls.setItem(keyFor(ME), JSON.stringify({ userId: ME.id }));
  await c.onSignedIn(ME);
  assert.strictEqual(updates(c).length, 0);
  assert.strictEqual(c.ls.getItem(keyFor(ME)), null);
});

test('C10 no pending record, profile with consent -> no write, enters, cache set', async () => {
  const c = makeCtx({ sbHandlers: makeDb({ [ME.id]: { ...profileWithLegal } }).handlers });
  assert.strictEqual(await c.onSignedIn(ME), true);
  assert.strictEqual(updates(c).length, 0);
  assert.strictEqual(c.ls.getItem('ablty_username'), 'alice');
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), '1');
  assert.ok(c.hasLegalVerified(ME.id));
});

// --- retry on session restore ------------------------------------------------
test('C11 hydrateProfileFromSession retries an owned pending acceptance and removes it on success', async () => {
  const c = makeCtx({ sbHandlers: makeDb({ [ME.id]: { ...profileNoLegal } }).handlers });
  c.ls.setItem(keyFor(ME), boundFor(ME));
  await c.hydrateProfileFromSession(ME);
  assert.strictEqual(updates(c).length, 1);
  assert.strictEqual(c.ls.getItem(keyFor(ME)), null);
  assert.strictEqual(c.gateActive(), false);
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), '1');
});

test('C11b hydrateProfileFromSession leaves another account\'s record alone and gates this one', async () => {
  const c = makeCtx({ sbHandlers: makeDb({ [ME.id]: { ...profileNoLegal } }).handlers });
  c.ls.setItem(keyFor(BOB), boundFor(BOB));
  const p = c.hydrateProfileFromSession(ME);
  await tick();
  assert.strictEqual(updates(c).length, 0);
  assert.strictEqual(c.ls.getItem(keyFor(BOB)), boundFor(BOB));
  assert.strictEqual(c.gate().mode, 'consent');
  await c.legalGateSignOut();
  await p;
});

test('C11c hydrateProfileFromSession with consent already recorded makes no update call', async () => {
  const c = makeCtx({ sbHandlers: makeDb({ [ME.id]: { ...profileWithLegal } }).handlers });
  await c.hydrateProfileFromSession(ME);
  assert.strictEqual(updates(c).length, 0);
});

// ═══════════════════════════════════════════════════════
//  ISSUE 1: draft vs owned record; nothing on the signup screen can destroy
//  or inherit a retained acceptance
// ═══════════════════════════════════════════════════════
test('I1a tick creates a draft with normalized email; untick removes it; owned records untouched', async () => {
  const dom = makeDom({ 'signup-email': '  Alice@Example.com ' });
  const c = makeCtx({ dom });
  c.ls.setItem(keyFor(BOB), boundFor(BOB));
  c.onSignupTosChange({ checked: true });
  const rec = JSON.parse(c.ls.getItem(DRAFT));
  assert.strictEqual(rec.email, 'alice@example.com');
  assert.strictEqual(rec.version, V);
  assert.ok(!rec.userId);
  c.onSignupTosChange({ checked: false });
  assert.strictEqual(c.ls.getItem(DRAFT), null);
  assert.strictEqual(c.ls.getItem(keyFor(BOB)), boundFor(BOB));
});

test('I1b openAuthScreen(signup) clears only the unsubmitted draft, never an owned record', async () => {
  const c = makeCtx();
  c.ls.setItem(DRAFT, JSON.stringify({ at: AT, version: V }));
  c.ls.setItem(keyFor(ME), boundFor(ME));
  c.openAuthScreen('signup');
  assert.strictEqual(c.ls.getItem(DRAFT), null);
  assert.strictEqual(c.ls.getItem(keyFor(ME)), boundFor(ME));
  assert.strictEqual(c.document.getElementById('signup-tos-check').checked, false);
});

test('I1c handleSignup binds the draft to the returned user id and keeps the tick-time `at`', async () => {
  const dom = makeDom({ 'signup-tos-check:checked': true, 'signup-username': 'alice', 'signup-email': 'Alice@Example.com', 'signup-password': 'password123', 'signup-confirm': 'password123' });
  const c = makeCtx({ dom, sbHandlers: {
    rpc: () => ({ data: false, error: null }),
    signUp: () => ({ data: { user: { id: ME.id, identities: [{}] }, session: null }, error: null }),
  } });
  c.ls.setItem(DRAFT, JSON.stringify({ at: AT, version: V, email: 'alice@example.com' }));
  await c.handleSignup();
  const rec = JSON.parse(c.ls.getItem(keyFor(ME)));
  assert.strictEqual(rec.userId, ME.id);
  assert.strictEqual(rec.email, 'alice@example.com');
  assert.strictEqual(rec.at, AT, 'acceptance time is the tick time, not the signUp time');
  assert.strictEqual(c.ls.getItem(DRAFT), null, 'draft consumed');
  assert.strictEqual(c.ls.getItem('ablty_pending_username'), 'alice');
  assert.ok(c.sb.calls.some(x => x.op === 'rpc' && x.name === 'username_is_taken' && x.args.check_username === 'alice'));
});

test('I1d FAILED consent write, then opening the signup screen -> the retained acceptance survives', async () => {
  const storage = makeLocalStorage();
  const db = makeDb({ [ME.id]: { ...profileNoLegal } });
  db.failUpdate = true;
  const c = makeCtx({ storage, sbHandlers: db.handlers });
  c.ls.setItem(keyFor(ME), boundFor(ME));
  const p = c.onSignedIn(ME);
  await tick();
  assert.strictEqual(storage.getItem(keyFor(ME)), boundFor(ME));
  await c.legalGateSignOut();
  assert.strictEqual(await p, false);
  // Someone opens the signup screen on this device, ticks and unticks.
  c.openAuthScreen('signup');
  c.onSignupTosChange({ checked: true });
  c.onSignupTosChange({ checked: false });
  c.openAuthScreen('signup');
  assert.strictEqual(storage.getItem(keyFor(ME)), boundFor(ME), 'A\'s acceptance must not be lost');
  // A signs in again once the network is back: it is recorded with A\'s original tick time.
  db.failUpdate = false;
  const c2 = makeCtx({ storage, sbHandlers: db.handlers });
  assert.strictEqual(await c2.onSignedIn(ME), true);
  assert.strictEqual(JSON.stringify(updates(c2)[0].patch), FOUR(AT));
  assert.strictEqual(storage.getItem(keyFor(ME)), null);
});

test('I1e another account signing up on the same device can neither destroy nor inherit A\'s retained acceptance', async () => {
  const storage = makeLocalStorage();
  storage.setItem(keyFor(ME), boundFor(ME));
  const dom = makeDom({ 'signup-username': 'bobby', 'signup-email': 'bob@example.com', 'signup-password': 'password123', 'signup-confirm': 'password123' });
  const c = makeCtx({ dom, storage, sbHandlers: {
    rpc: () => ({ data: false }),
    signUp: () => ({ data: { user: { id: BOB.id, identities: [{}] }, session: null }, error: null }),
  } });
  c.openAuthScreen('signup');
  const cb = dom.getElementById('signup-tos-check'); cb.checked = true; c.onSignupTosChange(cb);
  await c.handleSignup();
  const bobRec = JSON.parse(storage.getItem(keyFor(BOB)));
  assert.strictEqual(bobRec.userId, BOB.id);
  assert.notStrictEqual(bobRec.at, AT, 'B\'s record has B\'s own tick time, not A\'s');
  assert.strictEqual(storage.getItem(keyFor(ME)), boundFor(ME), 'A\'s record intact');
  assert.strictEqual(storage.getItem(DRAFT), null);
  // B confirms and signs in: B's row gets B's acceptance only.
  const db = makeDb({ [ME.id]: { ...profileNoLegal }, [BOB.id]: { ...profileNoLegal, username: 'bobby' } });
  const cB = makeCtx({ storage, sbHandlers: db.handlers });
  assert.strictEqual(await cB.onSignedIn(BOB), true);
  assert.strictEqual(db.rows[BOB.id].terms_accepted_at, bobRec.at);
  assert.strictEqual(db.rows[ME.id].terms_accepted_at, null);
  assert.strictEqual(storage.getItem(keyFor(ME)), boundFor(ME));
  // A signs in later and gets A's own acceptance.
  const cA = makeCtx({ storage, sbHandlers: db.handlers });
  assert.strictEqual(await cA.onSignedIn(ME), true);
  assert.strictEqual(db.rows[ME.id].terms_accepted_at, AT);
  assert.strictEqual(storage.getItem(keyFor(ME)), null);
});

test('I1f handleSignup: RPC says taken -> message shown, signUp never called, draft untouched', async () => {
  const dom = makeDom({ 'signup-tos-check:checked': true, 'signup-username': 'alice', 'signup-email': 'a@b.com', 'signup-password': 'password123', 'signup-confirm': 'password123' });
  let signUpCalls = 0;
  const c = makeCtx({ dom, sbHandlers: { rpc: () => ({ data: true, error: null }), signUp: () => { signUpCalls++; return { data: { user: null }, error: null }; } } });
  c.setAuthError = (f, e, msg) => { if (msg) c.authErrors.push([f, msg]); };
  c.ls.setItem(DRAFT, JSON.stringify({ at: AT, version: V }));
  await c.handleSignup();
  assert.strictEqual(signUpCalls, 0);
  assert.deepStrictEqual(c.authErrors, [['signup-username', 'That username is already being used. Try another.']]);
  assert.ok(c.ls.getItem(DRAFT));
});

test('I1g handleSignup: RPC errors (e.g. not deployed yet) -> signup proceeds', async () => {
  const dom = makeDom({ 'signup-tos-check:checked': true, 'signup-username': 'alice', 'signup-email': 'a@b.com', 'signup-password': 'password123', 'signup-confirm': 'password123' });
  let signUpCalls = 0;
  const c = makeCtx({ dom, sbHandlers: { rpc: () => ({ data: null, error: { message: 'function not found' } }), signUp: () => { signUpCalls++; return { data: { user: { id: ME.id, identities: [{}] } }, error: null }; } } });
  await c.handleSignup();
  assert.strictEqual(signUpCalls, 1);
  assert.ok(c.warns.some(w => /username_is_taken unavailable/.test(w)));
});

test('I1h handleSignup: name claimed after availability check -> confirmed username error, original auth error hidden', async () => {
  const dom = makeDom({ 'signup-tos-check:checked': true, 'signup-username': 'Alice', 'signup-email': 'a@b.com', 'signup-password': 'password123', 'signup-confirm': 'password123' });
  let checks = 0;
  const c = makeCtx({ dom, sbHandlers: {
    rpc: () => ({ data: ++checks > 1, error: null }),
    signUp: () => ({ data: null, error: { message: 'Database error saving new user' } }),
  } });
  c.setAuthError = (field, id, message) => { if (message) c.authErrors.push([field, message]); };
  await c.handleSignup();
  assert.deepStrictEqual(c.authErrors, [['signup-username', 'That username is already being used. Try another.']]);
});

test('I1i handleSignup: unrelated Auth error remains on email when post-error availability is false or unavailable', async () => {
  for (const second of [{ data: false, error: null }, { data: null, error: { message: 'offline' } }]) {
    const dom = makeDom({ 'signup-tos-check:checked': true, 'signup-username': 'Alice', 'signup-email': 'a@b.com', 'signup-password': 'password123', 'signup-confirm': 'password123' });
    let checks = 0;
    const c = makeCtx({ dom, sbHandlers: {
      rpc: () => (++checks === 1 ? { data: false, error: null } : second),
      signUp: () => ({ data: null, error: { message: 'Email rate limit exceeded' } }),
    } });
    c.setAuthError = (field, id, message) => { if (message) c.authErrors.push([field, message]); };
    await c.handleSignup();
    assert.deepStrictEqual(c.authErrors, [['signup-email', 'Email rate limit exceeded']]);
  }
});

// ═══════════════════════════════════════════════════════
//  ISSUE 2: Google sign-in and the consent gate
// ═══════════════════════════════════════════════════════
function googleCtx({ db, screen, ticked, storage, timers, signInWithIdToken } = {}) {
  const dom = makeDom({ 'signup-tos-check:checked': !!ticked });
  if (screen) dom.getElementById('screen-' + screen).classList.add('active');
  const c = makeCtx({ dom, storage, timers, sbHandlers: {
    ...db.handlers,
    signInWithIdToken: signInWithIdToken || (() => ({ data: { user: { id: ME.id, email: ME.email } }, error: null })),
  } });
  return c;
}
const GOOGLE_NEW_USER = () => makeDb(); // no profile row yet: signInWithIdToken just created the auth user

test('G1 brand-new Google user from the SIGNUP screen (box ticked) -> acceptance bound and written, no gate', async () => {
  const db = GOOGLE_NEW_USER();
  const c = googleCtx({ db, screen: 'signup', ticked: true });
  c.onSignupTosChange(c.document.getElementById('signup-tos-check'));
  await c.googleCallback({ credential: 'tok' });
  await tick();
  assert.strictEqual(c.sdkCalls[0][2].auth.persistSession, false);
  assert.strictEqual(c.sdkCalls[0][2].auth.autoRefreshToken, false);
  assert.strictEqual(c.sdkCalls[0][2].auth.detectSessionInUrl, false);
  assert.strictEqual(c.gateActive(), false);
  assert.ok(db.rows[ME.id].terms_accepted_at && db.rows[ME.id].privacy_accepted_at);
  assert.strictEqual(c.ls.getItem(DRAFT), null);
  assert.strictEqual(c.ls.getItem(keyFor(ME)), null);
  assert.deepStrictEqual(c.toasts, [['Signed in with Google.', 'success']]);
});

test('G2 brand-new Google user from the LOGIN screen -> gate before entering; agreeing writes consent; then enters', async () => {
  const db = GOOGLE_NEW_USER();
  const c = googleCtx({ db, screen: 'login' });
  const p = c.googleCallback({ credential: 'tok' });
  await tick();
  assert.ok(db.rows[ME.id], 'row created');
  assert.strictEqual(db.rows[ME.id].terms_accepted_at, null, 'no consent invented');
  assert.strictEqual(c.gateActive(), true);
  assert.strictEqual(c.gate().mode, 'consent');
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), null, 'not in the signed-in experience yet');
  assert.strictEqual(c.toasts.length, 0);
  await agreeAtGate(c);
  await p;
  assert.strictEqual(c.gateActive(), false);
  assert.ok(db.rows[ME.id].terms_accepted_at && db.rows[ME.id].privacy_accepted_at);
  assert.strictEqual(db.rows[ME.id].terms_version, V);
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), '1');
  assert.strictEqual(JSON.parse(c.ls.getItem(VERIFIED)).userId, ME.id);
  assert.deepStrictEqual(c.toasts, [['Signed in with Google.', 'success']]);
});

test('G3 brand-new Google user from ONBOARDING with a stale unrelated draft -> draft discarded, gate shown', async () => {
  const db = GOOGLE_NEW_USER();
  const c = googleCtx({ db });
  c.ls.setItem(DRAFT, JSON.stringify({ at: AT, version: V, email: 'someone-else@example.com' }));
  const p = c.googleCallback({ credential: 'tok' });
  await tick();
  assert.strictEqual(c.ls.getItem(DRAFT), null);
  assert.ok(c.warns.some(w => /never tied to an account/.test(w)));
  assert.strictEqual(db.rows[ME.id].terms_accepted_at, null);
  assert.strictEqual(c.gate().mode, 'consent');
  await agreeAtGate(c);
  await p;
  assert.notStrictEqual(db.rows[ME.id].terms_accepted_at, AT, 'the stale draft time was never used');
});

test('G4 existing Google user WITH recorded acceptance -> signs in normally, no gate, no write', async () => {
  const db = makeDb({ [ME.id]: { ...profileWithLegal } });
  const c = googleCtx({ db, screen: 'login' });
  await c.googleCallback({ credential: 'tok' });
  await tick();
  assert.strictEqual(c.gateActive(), false);
  assert.strictEqual(updates(c).length, 0);
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), '1');
  assert.deepStrictEqual(c.toasts, [['Signed in with Google.', 'success']]);
});

test('G5 existing Google user WITHOUT recorded acceptance (pre-existing account) -> asked once, then never again', async () => {
  const storage = makeLocalStorage();
  const db = makeDb({ [ME.id]: { ...profileNoLegal } });
  const c = googleCtx({ db, screen: 'login', storage });
  const p = c.googleCallback({ credential: 'tok' });
  await tick();
  assert.strictEqual(c.gate().mode, 'consent');
  await agreeAtGate(c);
  await p;
  // Next sign-in on the same account: no gate.
  const c2 = googleCtx({ db, screen: 'login', storage });
  await c2.googleCallback({ credential: 'tok' });
  await tick();
  assert.strictEqual(c2.gateActive(), false);
  assert.strictEqual(updates(c2).length, 0);
});

test('G6 cancelled Google auth (no credential) and failed signInWithIdToken -> error toast, no account work, no gate', async () => {
  const db = GOOGLE_NEW_USER();
  const c = googleCtx({ db, screen: 'login' });
  await c.googleCallback({});
  assert.deepStrictEqual(c.toasts, [['Google sign-in failed.', 'error']]);
  assert.strictEqual(c.sb.calls.length, 0);
  const c2 = makeCtx({ sbHandlers: { ...db.handlers, signInWithIdToken: () => ({ data: null, error: { message: 'Invalid token' } }) } });
  await c2.googleCallback({ credential: 'tok' });
  assert.deepStrictEqual(c2.toasts, [['Invalid token', 'error']]);
  assert.strictEqual(c2.sb.calls.filter(x => x.op !== 'signInWithIdToken').length, 0);
  assert.strictEqual(c2.gateActive(), false);
  assert.strictEqual(Object.keys(db.rows).length, 0);
});

test('G6b credential receipt shows progress immediately, blocks duplicate callbacks, and clears after failure', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const c = makeCtx({ sbHandlers: { signInWithIdToken: () => held } });
  const first = c.googleCallback({ credential: 'tok' });
  assert.ok(c.document.getElementById('google-signin-status').classList.contains('visible'));
  assert.strictEqual(c.document.getElementById('google-signin-status-label').textContent, 'Signing you in…');
  await c.googleCallback({ credential: 'duplicate' });
  assert.strictEqual(c.stagingClients[0].calls.filter(x => x.op === 'signInWithIdToken').length, 1);
  release({ data: null, error: { message: 'Rejected' } });
  await first;
  assert.strictEqual(c.document.getElementById('google-signin-status').classList.contains('visible'), false);
  assert.deepStrictEqual(c.toasts, [
    ['Your previous Google sign-in is still finishing. Please wait before trying again.', 'info'],
    ['Rejected', 'error'],
  ]);
});

test('G6c staged Google A cannot replace main-client B before timeout', async () => {
  const hold = deferred();
  const db = twoUsers();
  const c = makeCtx({ sbHandlers: { ...db.handlers, signInWithIdToken: () => hold.promise } });
  c.sb.auth.onAuthStateChange(c.handleAuthStateChange);
  const callback = c.googleCallback({ credential: googleTokenFor(ME.email) });
  await tick();
  c.sb._emitAuth('SIGNED_IN', { user: BOB, access_token: 'b-access', refresh_token: 'b-refresh' });
  await tick();
  c.stagingClients[0]._emitAuth('SIGNED_IN', { user: ME, access_token: 'a-staged', refresh_token: 'a-staged-refresh' });
  hold.resolve({ data: { user: ME }, error: null });
  await callback;
  assert.strictEqual(c.sb._session().user.id, BOB.id, 'main SDK session remains B');
  assert.strictEqual(c.eval('_activeAuthUserId'), BOB.id);
  assert.strictEqual(cacheOwner(c), BOB.id);
  assert.ok(!c.toasts.some(([message]) => message === 'Signed in with Google.'));
});

test('G6d timed-out staged Google A leaves both B SDK and B application state intact', async () => {
  const timers = fakeTimers();
  const hold = deferred();
  const db = twoUsers();
  const c = makeCtx({ timers, sbHandlers: { ...db.handlers, signInWithIdToken: () => hold.promise } });
  c.sb.auth.onAuthStateChange(c.handleAuthStateChange);
  const callback = c.googleCallback({ credential: googleTokenFor(ME.email) });
  timers.fire(45000);
  await callback;
  c.sb._emitAuth('SIGNED_IN', { user: BOB, access_token: 'b-access', refresh_token: 'b-refresh' });
  await tick();
  c.stagingClients[0]._emitAuth('SIGNED_IN', { user: ME, access_token: 'a-staged', refresh_token: 'a-staged-refresh' });
  hold.resolve({ data: { user: ME }, error: null });
  await tick();
  assert.strictEqual(c.sb._session().user.id, BOB.id, 'main SDK session remains B');
  assert.strictEqual(c.eval('_activeAuthUserId'), BOB.id);
  assert.strictEqual(c.eval('_enteredUserId'), BOB.id);
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), '1');
  assert.strictEqual(c.sb.calls.filter(x => x.op === 'signOut').length, 0);
});

test('G6d2 fresh password session for A supersedes timed-out staged Google A without being signed out', async () => {
  const timers = fakeTimers();
  const hold = deferred();
  const db = makeDb({ [ME.id]: { ...profileWithLegal } });
  const c = makeCtx({ timers, sbHandlers: { ...db.handlers, signInWithIdToken: () => hold.promise } });
  c.sb.auth.onAuthStateChange(c.handleAuthStateChange);
  const callback = c.googleCallback({ credential: googleTokenFor(ME.email) });
  timers.fire(45000);
  await callback;
  c.sb._emitAuth('SIGNED_IN', { user: ME, access_token: 'fresh-password', refresh_token: 'fresh-password-refresh' });
  await tick();
  hold.resolve({ data: { user: ME }, error: null });
  await tick();
  assert.strictEqual(c.sb._session().access_token, 'fresh-password');
  assert.strictEqual(c.eval('_enteredUserId'), ME.id);
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), '1');
  assert.strictEqual(c.sb.calls.filter(x => x.op === 'signOut').length, 0);
});

test('G6d3 independent B during pending main adoption is restored after stale setSession(A) completes', async () => {
  const timers = fakeTimers();
  const adoption = deferred();
  const db = twoUsers();
  const c = makeCtx({ timers, sbHandlers: {
    ...db.handlers,
    signInWithIdToken: () => ({ data: { user: ME }, error: null }),
    setSession: tokens => tokens.access_token === 'staged-access'
      ? adoption.promise
      : { data: { user: BOB, session: { user: BOB, ...tokens } }, error: null },
  } });
  c.sb.auth.onAuthStateChange(c.handleAuthStateChange);
  const callback = c.googleCallback({ credential: googleTokenFor(ME.email) });
  await tick();
  c.sb._emitAuth('SIGNED_IN', { user: BOB, access_token: 'b-independent', refresh_token: 'b-refresh' });
  await tick();
  adoption.resolve({ data: { user: ME, session: { user: ME, access_token: 'staged-access', refresh_token: 'staged-refresh' } }, error: null });
  await tick();
  timers.fire(0);
  await tick();
  await callback;
  assert.strictEqual(c.sb._session().user.id, BOB.id);
  assert.strictEqual(c.sb._session().access_token, 'b-independent');
  assert.strictEqual(c.eval('_enteredUserId'), BOB.id);
  assert.strictEqual(cacheOwner(c), BOB.id);
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), '1');
});

test('G6d4 fresh same-user session during pending adoption is restored by exact token, not mistaken for Google', async () => {
  const timers = fakeTimers();
  const adoption = deferred();
  const db = makeDb({ [ME.id]: { ...profileWithLegal } });
  const c = makeCtx({ timers, sbHandlers: {
    ...db.handlers,
    signInWithIdToken: () => ({ data: { user: ME }, error: null }),
    setSession: tokens => tokens.access_token === 'staged-access'
      ? adoption.promise
      : { data: { user: ME, session: { user: ME, ...tokens } }, error: null },
  } });
  c.sb.auth.onAuthStateChange(c.handleAuthStateChange);
  const callback = c.googleCallback({ credential: googleTokenFor(ME.email) });
  await tick();
  c.sb._emitAuth('SIGNED_IN', { user: ME, access_token: 'fresh-password', refresh_token: 'fresh-password-refresh' });
  await tick();
  adoption.resolve({ data: { user: ME, session: { user: ME, access_token: 'staged-access', refresh_token: 'staged-refresh' } }, error: null });
  await tick();
  timers.fire(0);
  await tick();
  await callback;
  assert.strictEqual(c.sb._session().access_token, 'fresh-password');
  assert.strictEqual(c.eval('_enteredUserId'), ME.id);
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), '1');
  assert.ok(!c.toasts.some(([message]) => message === 'Signed in with Google.'));
});

test('G6d5 sign-out during pending adoption stays signed out after stale setSession completes', async () => {
  const timers = fakeTimers();
  const adoption = deferred();
  const db = makeDb({ [ME.id]: { ...profileWithLegal } });
  const c = makeCtx({ timers, sbHandlers: {
    ...db.handlers,
    signInWithIdToken: () => ({ data: { user: ME }, error: null }),
    setSession: () => adoption.promise,
  } });
  c.sb.auth.onAuthStateChange(c.handleAuthStateChange);
  const callback = c.googleCallback({ credential: googleTokenFor(ME.email) });
  await tick();
  c.sb._emitAuth('SIGNED_OUT', null);
  adoption.resolve({ data: { user: ME, session: { user: ME, access_token: 'staged-access', refresh_token: 'staged-refresh' } }, error: null });
  await tick();
  timers.fire(0);
  await tick();
  await callback;
  assert.strictEqual(c.sb._session(), null);
  assert.strictEqual(c.eval('_enteredUserId'), null);
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), null);
});

test('G6d5b sign-out during delayed restoration cannot be undone when restoration resolves', async () => {
  const timers = fakeTimers();
  const adoption = deferred();
  const restoration = deferred();
  const db = twoUsers();
  const c = makeCtx({ timers, sbHandlers: {
    ...db.handlers,
    signInWithIdToken: () => ({ data: { user: ME }, error: null }),
    setSession: tokens => {
      if (tokens.access_token === 'staged-access') return adoption.promise;
      if (tokens.access_token === 'b-independent') return restoration.promise;
      throw new Error('unexpected token');
    },
  } });
  c.sb.auth.onAuthStateChange(c.handleAuthStateChange);
  const callback = c.googleCallback({ credential: googleTokenFor(ME.email) });
  await tick();
  c.sb._emitAuth('SIGNED_IN', { user: BOB, access_token: 'b-independent', refresh_token: 'b-refresh' });
  await tick();
  adoption.resolve({ data: { user: ME, session: { user: ME, access_token: 'staged-access', refresh_token: 'staged-refresh' } }, error: null });
  await tick();
  timers.fire(0); // starts the held restoration of B
  await tick();
  c.sb._emitAuth('SIGNED_OUT', null);
  restoration.resolve({ data: { user: BOB, session: { user: BOB, access_token: 'b-independent', refresh_token: 'b-refresh' } }, error: null });
  await tick();
  timers.fire(0); // removes B because sign-out superseded its restoration
  await tick();
  await callback;
  assert.strictEqual(c.sb._session(), null);
  assert.strictEqual(c.eval('_enteredUserId'), null);
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), null);
});

test('G6d5c newer C during delayed restoration wins over restored B in SDK and application state', async () => {
  const timers = fakeTimers();
  const adoption = deferred();
  const restoration = deferred();
  const CAT = { id: 'cccccccc-3333-4333-8333-cccccccccccc', email: 'cat@example.com' };
  const db = makeDb({
    [ME.id]: { ...profileWithLegal },
    [BOB.id]: { ...profileWithLegal, username: 'bob' },
    [CAT.id]: { ...profileWithLegal, username: 'cat' },
  });
  const c = makeCtx({ timers, sbHandlers: {
    ...db.handlers,
    signInWithIdToken: () => ({ data: { user: ME }, error: null }),
    setSession: tokens => {
      if (tokens.access_token === 'staged-access') return adoption.promise;
      if (tokens.access_token === 'b-independent') return restoration.promise;
      if (tokens.access_token === 'c-newer') return { data: { user: CAT, session: { user: CAT, ...tokens } }, error: null };
      throw new Error('unexpected token');
    },
  } });
  c.sb.auth.onAuthStateChange(c.handleAuthStateChange);
  const callback = c.googleCallback({ credential: googleTokenFor(ME.email) });
  await tick();
  c.sb._emitAuth('SIGNED_IN', { user: BOB, access_token: 'b-independent', refresh_token: 'b-refresh' });
  adoption.resolve({ data: { user: ME, session: { user: ME, access_token: 'staged-access', refresh_token: 'staged-refresh' } }, error: null });
  await tick();
  timers.fire(0);
  await tick();
  c.sb._emitAuth('SIGNED_IN', { user: CAT, access_token: 'c-newer', refresh_token: 'c-refresh' });
  await tick();
  restoration.resolve({ data: { user: BOB, session: { user: BOB, access_token: 'b-independent', refresh_token: 'b-refresh' } }, error: null });
  await tick();
  timers.fire(0);
  await tick();
  await callback;
  assert.strictEqual(c.sb._session().user.id, CAT.id);
  assert.strictEqual(c.sb._session().access_token, 'c-newer');
  assert.strictEqual(c.eval('_enteredUserId'), CAT.id);
  assert.strictEqual(cacheOwner(c), CAT.id);
});

test('G6d5d already-active A keeps a fresh independent A session over older Google adoption', async () => {
  const timers = fakeTimers();
  const adoption = deferred();
  const db = makeDb({ [ME.id]: { ...profileWithLegal } });
  const c = makeCtx({ timers, sbHandlers: {
    ...db.handlers,
    signInWithIdToken: () => ({ data: { user: ME }, error: null }),
    setSession: tokens => tokens.access_token === 'staged-access'
      ? adoption.promise
      : { data: { user: ME, session: { user: ME, ...tokens } }, error: null },
  } });
  c.sb.auth.onAuthStateChange(c.handleAuthStateChange);
  c.sb._emitAuth('SIGNED_IN', { user: ME, access_token: 'original-a', refresh_token: 'original-a-refresh' });
  await tick();
  const callback = c.googleCallback({ credential: googleTokenFor(ME.email) });
  await tick();
  c.sb._emitAuth('SIGNED_IN', { user: ME, access_token: 'fresh-a', refresh_token: 'fresh-a-refresh' });
  adoption.resolve({ data: { user: ME, session: { user: ME, access_token: 'staged-access', refresh_token: 'staged-refresh' } }, error: null });
  await tick();
  timers.fire(0);
  await tick();
  await callback;
  assert.strictEqual(c.sb._session().access_token, 'fresh-a');
  assert.strictEqual(c.eval('_enteredUserId'), ME.id);
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), '1');
  assert.ok(!c.toasts.some(([message]) => message === 'Signed in with Google.'));
});

test('G6d6 superseded slow timer cannot revive Google progress or disable B controls', async () => {
  const timers = fakeTimers();
  const hold = deferred();
  const db = twoUsers();
  const c = makeCtx({ timers, sbHandlers: { ...db.handlers, signInWithIdToken: () => hold.promise } });
  c.sb.auth.onAuthStateChange(c.handleAuthStateChange);
  const callback = c.googleCallback({ credential: googleTokenFor(ME.email) });
  c.sb._emitAuth('SIGNED_IN', { user: BOB, access_token: 'b-access', refresh_token: 'b-refresh' });
  await tick();
  timers.fire(10000);
  assert.strictEqual(c.document.getElementById('google-signin-status').classList.contains('visible'), false);
  assert.strictEqual(c.document.getElementById('login-google-btn-wrap').style.pointerEvents, '');
  hold.resolve({ data: null, error: { message: 'superseded' } });
  await callback;
});

test('G6e retry stays blocked until a timed-out SDK operation settles, then a new attempt is allowed', async () => {
  const timers = fakeTimers();
  const first = deferred();
  let requests = 0;
  const c = makeCtx({ timers, sbHandlers: { signInWithIdToken: () => (++requests === 1 ? first.promise : { data: null, error: { message: 'second' } }) } });
  const original = c.googleCallback({ credential: googleTokenFor(ME.email) });
  timers.fire(45000);
  await original;
  await c.googleCallback({ credential: googleTokenFor(BOB.email) });
  assert.strictEqual(requests, 1);
  first.resolve({ data: null, error: { message: 'late failure' } });
  await tick();
  await c.googleCallback({ credential: googleTokenFor(BOB.email) });
  assert.strictEqual(requests, 2);
});

test('G6f account takeover suppresses stale timeout and late-error messages', async () => {
  const timers = fakeTimers();
  const hold = deferred();
  const db = twoUsers();
  const c = makeCtx({ timers, sbHandlers: { ...db.handlers, signInWithIdToken: () => hold.promise } });
  const callback = c.googleCallback({ credential: googleTokenFor(ME.email) });
  assert.strictEqual(await c.onSignedIn(BOB), true);
  timers.fire(45000);
  await callback;
  hold.resolve({ data: null, error: { message: 'late rejection' } });
  await tick();
  assert.deepStrictEqual(c.toasts, []);

  const hold2 = deferred();
  const c2 = makeCtx({ sbHandlers: { ...db.handlers, signInWithIdToken: () => hold2.promise } });
  const callback2 = c2.googleCallback({ credential: googleTokenFor(ME.email) });
  assert.strictEqual(await c2.onSignedIn(BOB), true);
  hold2.resolve({ data: null, error: { message: 'stale SDK error' } });
  await callback2;
  assert.deepStrictEqual(c2.toasts, []);
});

test('G6g Terms and guest-data decisions may exceed 45 seconds after the SDK exchange', async () => {
  const timers = fakeTimers();
  const db = makeDb({ [ME.id]: { ...profileNoLegal } });
  const c = googleCtx({ db, screen: 'login', timers });
  const p = c.googleCallback({ credential: googleTokenFor(ME.email) });
  await tick();
  assert.strictEqual(c.gate().mode, 'consent');
  timers.fire(45000);
  assert.ok(!c.toasts.some(([message]) => /too long/.test(message)));
  await agreeAtGate(c);
  await p;

  const timers2 = fakeTimers();
  const choice = deferred();
  const c2 = googleCtx({ db: makeDb({ [ME.id]: { ...profileWithLegal } }), screen: 'login', timers: timers2 });
  c2.hasLocalGuestData = () => true;
  c2.showGuestDataModal = () => choice.promise;
  const p2 = c2.googleCallback({ credential: googleTokenFor(ME.email) });
  await tick();
  timers2.fire(45000);
  assert.ok(!c2.toasts.some(([message]) => /too long/.test(message)));
  choice.resolve('fresh');
  await p2;
});

test('G7 pending consent belonging to a DIFFERENT account -> new Google user is gated, other record untouched, sign out from gate', async () => {
  const db = GOOGLE_NEW_USER();
  const c = googleCtx({ db, screen: 'login' });
  c.ls.setItem(keyFor(BOB), boundFor(BOB));
  const p = c.googleCallback({ credential: 'tok' });
  await tick();
  assert.strictEqual(db.rows[ME.id].terms_accepted_at, null);
  assert.strictEqual(c.gate().mode, 'consent');
  await c.legalGateSignOut();
  await p;
  assert.strictEqual(c.gateActive(), false);
  assert.strictEqual(c.ls.getItem(keyFor(BOB)), boundFor(BOB));
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), null);
  assert.strictEqual(c.toasts.length, 0, 'no "Signed in" toast after signing out at the gate');
  assert.ok(c.sb.calls.some(x => x.op === 'signOut'));
  // The auth screens were left as they were.
  assert.ok(c.document.getElementById('screen-login').classList.contains('active'));
});

test('G8 gate blocks guest-data merge until consent is given', async () => {
  const db = GOOGLE_NEW_USER();
  const c = googleCtx({ db, screen: 'login' });
  c.hasLocalGuestData = () => true;
  const p = c.googleCallback({ credential: 'tok' });
  await tick();
  assert.strictEqual(c.gate().mode, 'consent');
  assert.strictEqual(c.guestModalCalls, 0, 'guest data must not be touched before consent');
  await agreeAtGate(c);
  await p;
  assert.strictEqual(c.guestModalCalls, 1);
});

test('G9 gate write fails -> error shown, gate stays, retry succeeds', async () => {
  const db = makeDb({ [ME.id]: { ...profileNoLegal } });
  const c = googleCtx({ db, screen: 'login' });
  const p = c.googleCallback({ credential: 'tok' });
  await tick();
  db.failUpdate = true;
  await agreeAtGate(c);
  assert.strictEqual(c.gateActive(), true);
  assert.ok(/could not be saved/.test(c.document.getElementById('legal-gate-err').textContent));
  assert.strictEqual(c.document.getElementById('legal-gate-btn').disabled, false);
  assert.strictEqual(c.ls.getItem(VERIFIED), null);
  db.failUpdate = false;
  await c.submitLegalGate();
  await p;
  assert.strictEqual(c.gateActive(), false);
  assert.ok(db.rows[ME.id].terms_accepted_at);
});

test('G9b gate update "succeeds" but read-back still shows null -> not treated as consent', async () => {
  const db = makeDb({ [ME.id]: { ...profileNoLegal } });
  const handlers = { ...db.handlers, update: () => ({ error: null }) }; // silently matches nothing
  const c = makeCtx({ sbHandlers: handlers });
  const p = c.onSignedIn(ME);
  await tick();
  await agreeAtGate(c);
  assert.strictEqual(c.gateActive(), true);
  assert.strictEqual(c.ls.getItem(VERIFIED), null);
  await c.legalGateSignOut();
  assert.strictEqual(await p, false);
});

// --- offline / profile load failure ------------------------------------------
test('O1 profile load fails, no cached verification -> connection gate, no acceptance assumed; retry when online', async () => {
  const db = makeDb({ [ME.id]: { ...profileWithLegal } });
  db.failSelect = true;
  const c = makeCtx({ sbHandlers: db.handlers });
  const p = c.onSignedIn(ME);
  await tick();
  assert.strictEqual(c.gate().mode, 'connection');
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), null);
  assert.strictEqual(upserts(c).length, 0, 'no blind upsert when the row could not be read');
  db.failSelect = false;
  await c.retryLegalGate();
  await tick();
  assert.strictEqual(await p, true);
  assert.strictEqual(c.gateActive(), false);
  assert.ok(c.hasLegalVerified(ME.id));
});

test('O2 profile load fails, cached verification for THIS user and version -> enters offline, no gate', async () => {
  const db = makeDb(); db.failSelect = true;
  const c = makeCtx({ sbHandlers: db.handlers });
  c.ls.setItem(VERIFIED, JSON.stringify({ userId: ME.id, version: V, at: AT }));
  assert.strictEqual(await c.onSignedIn(ME), true);
  assert.strictEqual(c.gateActive(), false);
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), '1');
});

test('O3 profile load fails, cache is for a DIFFERENT user -> connection gate', async () => {
  const db = makeDb(); db.failSelect = true;
  const c = makeCtx({ sbHandlers: db.handlers });
  c.ls.setItem(VERIFIED, JSON.stringify({ userId: BOB.id, version: V, at: AT }));
  const p = c.onSignedIn(ME);
  await tick();
  assert.strictEqual(c.gate().mode, 'connection');
  await c.legalGateSignOut();
  assert.strictEqual(await p, false);
});

test('O4 profile load fails, cache is for an OUTDATED legal version -> connection gate', async () => {
  const db = makeDb(); db.failSelect = true;
  const c = makeCtx({ sbHandlers: db.handlers });
  c.ls.setItem(VERIFIED, JSON.stringify({ userId: ME.id, version: '2025-01-01', at: AT }));
  const p = c.hydrateProfileFromSession(ME);
  await tick();
  assert.strictEqual(c.gate().mode, 'connection');
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), null);
  await c.legalGateSignOut();
  await p;
});

test('O5 profile load fails, corrupt cache -> removed with warning, connection gate', async () => {
  const db = makeDb(); db.failSelect = true;
  const c = makeCtx({ sbHandlers: db.handlers });
  c.ls.setItem(VERIFIED, '{nope');
  const p = c.onSignedIn(ME);
  await tick();
  assert.strictEqual(c.ls.getItem(VERIFIED), null);
  assert.ok(c.warns.some(w => /Corrupt ablty_legal_verified/.test(w)));
  assert.strictEqual(c.gate().mode, 'connection');
  await c.legalGateSignOut();
  await p;
});

// --- local account cache during profile-load failure -------------------------
const CHANGED = '2026-08-01T00:00:00.000Z';
function seedVerifiedPremium(c, user) {
  c.writeLocalAccountCache(user.id, 'alice_prem', 'premium', CHANGED);
  c.ls.setItem(VERIFIED, JSON.stringify({ userId: user.id, version: V, at: AT }));
}
const cacheOf = c => ({ id: c.ls.getItem('ablty_cache_user_id'), username: c.ls.getItem('ablty_username'), tier: c.ls.getItem('ablty_tier'), changedAt: c.ls.getItem('ablty_username_changed_at') });

test('A1 verified Premium account, profile load fails -> enters and stays Premium locally (onSignedIn)', async () => {
  const db = makeDb(); db.failSelect = true;
  const c = makeCtx({ sbHandlers: db.handlers });
  seedVerifiedPremium(c, ME);
  assert.strictEqual(await c.onSignedIn(ME), true);
  assert.strictEqual(c.gateActive(), false);
  assert.deepStrictEqual(cacheOf(c), { id: ME.id, username: 'alice_prem', tier: 'premium', changedAt: CHANGED });
});

test('A2 same via session restore (hydrateProfileFromSession): username, tier and changed_at preserved', async () => {
  const db = makeDb(); db.failSelect = true;
  const c = makeCtx({ sbHandlers: db.handlers });
  seedVerifiedPremium(c, ME);
  await c.hydrateProfileFromSession(ME);
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), '1');
  assert.deepStrictEqual(cacheOf(c), { id: ME.id, username: 'alice_prem', tier: 'premium', changedAt: CHANGED });
});

test('A3 a DIFFERENT user cannot inherit the cached Premium username/tier (onSignedIn and hydrate)', async () => {
  const db = makeDb(); db.failSelect = true;
  const c = makeCtx({ sbHandlers: db.handlers });
  seedVerifiedPremium(c, BOB);                       // cache and verification belong to Bob
  c.ls.setItem(VERIFIED, JSON.stringify({ userId: ME.id, version: V, at: AT })); // Alice verified earlier on this device too
  assert.strictEqual(await c.onSignedIn(ME), true);
  assert.deepStrictEqual(cacheOf(c), { id: ME.id, username: 'Seeker', tier: 'free', changedAt: '' });
  const c2 = makeCtx({ sbHandlers: db.handlers });
  seedVerifiedPremium(c2, BOB);
  c2.ls.setItem(VERIFIED, JSON.stringify({ userId: ME.id, version: V, at: AT }));
  await c2.hydrateProfileFromSession(ME);
  assert.deepStrictEqual(cacheOf(c2), { id: ME.id, username: 'Seeker', tier: 'free', changedAt: '' });
});

test('A3b legacy unbound cache (no ablty_cache_user_id) is not trusted for anyone', async () => {
  const db = makeDb(); db.failSelect = true;
  const c = makeCtx({ sbHandlers: db.handlers });
  c.ls.setItem('ablty_username', 'someone'); c.ls.setItem('ablty_tier', 'premium');
  c.ls.setItem(VERIFIED, JSON.stringify({ userId: ME.id, version: V, at: AT }));
  assert.strictEqual(await c.onSignedIn(ME), true);
  assert.deepStrictEqual(cacheOf(c), { id: ME.id, username: 'Seeker', tier: 'free', changedAt: '' });
});

test('A4 no cached account state, profile load fails, verified -> safe Free fallback', async () => {
  const db = makeDb(); db.failSelect = true;
  const c = makeCtx({ sbHandlers: db.handlers });
  c.ls.setItem(VERIFIED, JSON.stringify({ userId: ME.id, version: V, at: AT }));
  assert.strictEqual(await c.onSignedIn(ME), true);
  assert.deepStrictEqual(cacheOf(c), { id: ME.id, username: 'Seeker', tier: 'free', changedAt: '' });
});

test('A5 successful profile load: database values win over the cache in both directions', async () => {
  // Cache says premium, database says free -> free.
  const c = makeCtx({ sbHandlers: makeDb({ [ME.id]: { ...profileWithLegal, username: 'alice_db', tier: 'free', username_changed_at: null } }).handlers });
  seedVerifiedPremium(c, ME);
  assert.strictEqual(await c.onSignedIn(ME), true);
  assert.deepStrictEqual(cacheOf(c), { id: ME.id, username: 'alice_db', tier: 'free', changedAt: '' });
  // Cache says free, database says premium -> premium (also via hydrate).
  const c2 = makeCtx({ sbHandlers: makeDb({ [ME.id]: { ...profileWithLegal, username: 'alice_db', tier: 'premium', username_changed_at: CHANGED } }).handlers });
  c2.writeLocalAccountCache(ME.id, 'old_name', 'free', '');
  await c2.hydrateProfileFromSession(ME);
  assert.deepStrictEqual(cacheOf(c2), { id: ME.id, username: 'alice_db', tier: 'premium', changedAt: CHANGED });
});

test('A6 sign-out clears the bound cache so the next account starts clean', async () => {
  const c = makeCtx();
  c.writeLocalAccountCache(ME.id, 'alice_prem', 'premium', CHANGED);
  c.clearLocalAuthCache();
  assert.deepStrictEqual(cacheOf(c), { id: null, username: null, tier: null, changedAt: null });
  assert.strictEqual(c.readLocalAccountCache(ME.id), null);
});

// --- password recovery vs consent gate ---------------------------------------
const modalOpen = c => c.document.getElementById('change-password-modal').style.display === 'flex';
const recoveryToasts = c => c.toasts.filter(t => t[0] === 'Please set your new password.').length;
const pending = c => c.eval('_passwordRecoveryPending');

test('R1 PASSWORD_RECOVERY, account WITH consent: modal opens once the sign-in has entered (event mid-flight or after)', async () => {
  // Event arrives while onSignedIn (from checkAuthCallback's setSession) is still loading the profile.
  const c = makeCtx({ sbHandlers: makeDb({ [ME.id]: { ...profileWithLegal } }).handlers });
  const p = c.onSignedIn(ME);
  c.onPasswordRecoveryEvent();
  assert.strictEqual(modalOpen(c), false, 'not before the sign-in has entered');
  await p;
  assert.strictEqual(modalOpen(c), true);
  assert.strictEqual(recoveryToasts(c), 1);
  assert.strictEqual(pending(c), false);
  // Event arrives after the sign-in already entered: opens immediately.
  const c2 = makeCtx({ sbHandlers: makeDb({ [ME.id]: { ...profileWithLegal } }).handlers });
  await c2.onSignedIn(ME);
  assert.strictEqual(modalOpen(c2), false);
  c2.onPasswordRecoveryEvent();
  assert.strictEqual(modalOpen(c2), true);
  assert.strictEqual(recoveryToasts(c2), 1);
});

test('R1b stale ablty_logged_in from a previous launch does not let the modal open before this load has entered', async () => {
  const db = makeDb({ [ME.id]: { ...profileNoLegal } });
  const c = makeCtx({ sbHandlers: db.handlers });
  c.ls.setItem('ablty_logged_in', '1');                // left over from an earlier session on this device
  c.onPasswordRecoveryEvent();                          // arrives before any sign-in of this page load
  assert.strictEqual(modalOpen(c), false);
  const p = c.onSignedIn(ME);
  await tick();
  assert.strictEqual(c.gate().mode, 'consent');
  assert.strictEqual(modalOpen(c), false, 'never on top of the gate');
  await agreeAtGate(c);
  await p;
  assert.strictEqual(modalOpen(c), true);
  assert.strictEqual(recoveryToasts(c), 1);
});

test('R2 PASSWORD_RECOVERY, account MISSING consent: gate first, modal not opened underneath it', async () => {
  const db = makeDb({ [ME.id]: { ...profileNoLegal } });
  const c = makeCtx({ sbHandlers: db.handlers });
  const p = c.onSignedIn(ME);
  c.onPasswordRecoveryEvent();
  await tick();
  assert.strictEqual(c.gateActive(), true);
  assert.strictEqual(c.gate().mode, 'consent');
  assert.strictEqual(modalOpen(c), false);
  assert.strictEqual(pending(c), true, 'recovery stays pending');
  await c.legalGateSignOut();
  await p;
});

test('R3 after consent succeeds the modal opens automatically exactly once, even with overlapping onSignedIn + hydrate', async () => {
  const db = makeDb({ [ME.id]: { ...profileNoLegal } });
  const c = makeCtx({ sbHandlers: db.handlers });
  const p1 = c.onSignedIn(ME);          // checkAuthCallback -> setSession().then(onSignedIn)
  const p2 = c.onSignedIn(ME);          // SIGNED_IN from the same setSession
  const p3 = c.hydrateProfileFromSession(ME); // INITIAL_SESSION
  c.onPasswordRecoveryEvent();
  await tick();
  assert.strictEqual(c.gate().mode, 'consent');
  assert.strictEqual(modalOpen(c), false);
  await agreeAtGate(c);
  await Promise.all([p1, p2, p3]);
  assert.strictEqual(modalOpen(c), true);
  assert.strictEqual(recoveryToasts(c), 1, 'exactly one prompt');
  assert.strictEqual(pending(c), false);
  // Later ordinary events do not re-open it.
  c.document.getElementById('change-password-modal').style.display = 'none';
  await c.hydrateProfileFromSession(ME);
  await c.onSignedIn(ME);
  assert.strictEqual(modalOpen(c), false);
  assert.strictEqual(recoveryToasts(c), 1);
});

test('R4 consent save fails: recovery stays pending, modal does not open; opens after the retry succeeds', async () => {
  const db = makeDb({ [ME.id]: { ...profileNoLegal } });
  const c = makeCtx({ sbHandlers: db.handlers });
  const p = c.onSignedIn(ME);
  c.onPasswordRecoveryEvent();
  await tick();
  db.failUpdate = true;
  await agreeAtGate(c);
  assert.strictEqual(c.gateActive(), true);
  assert.strictEqual(modalOpen(c), false);
  assert.strictEqual(pending(c), true);
  db.failUpdate = false;
  await c.submitLegalGate();
  await p;
  assert.strictEqual(modalOpen(c), true);
  assert.strictEqual(recoveryToasts(c), 1);
});

test('R5 connection-required gate: recovery pending; retry succeeds -> enters, then modal opens', async () => {
  const db = makeDb({ [ME.id]: { ...profileWithLegal } });
  db.failSelect = true;
  const c = makeCtx({ sbHandlers: db.handlers });
  const p = c.onSignedIn(ME);
  c.onPasswordRecoveryEvent();
  await tick();
  assert.strictEqual(c.gate().mode, 'connection');
  assert.strictEqual(modalOpen(c), false);
  assert.strictEqual(pending(c), true);
  db.failSelect = false;
  await c.retryLegalGate();
  await tick();
  assert.strictEqual(await p, true);
  assert.strictEqual(modalOpen(c), true);
  assert.strictEqual(recoveryToasts(c), 1);
});

test('R6 signing out from the consent gate cancels the pending recovery', async () => {
  const db = makeDb({ [ME.id]: { ...profileNoLegal } });
  const c = makeCtx({ sbHandlers: db.handlers });
  const p = c.onSignedIn(ME);
  c.onPasswordRecoveryEvent();
  await tick();
  await c.legalGateSignOut();
  assert.strictEqual(await p, false);
  assert.strictEqual(pending(c), false);
  assert.strictEqual(modalOpen(c), false);
  // A later normal sign-in (even with consent present) does not open it.
  db.rows[ME.id] = { ...profileWithLegal };
  await c.onSignedIn(ME);
  assert.strictEqual(modalOpen(c), false);
  assert.strictEqual(recoveryToasts(c), 0);
});

test('R7 ordinary SIGNED_IN / INITIAL_SESSION / TOKEN_REFRESHED / Google flows never open the password modal', async () => {
  const db = makeDb({ [ME.id]: { ...profileWithLegal } });
  const c = makeCtx({ sbHandlers: db.handlers });
  await c.onSignedIn(ME);                  // SIGNED_IN
  await c.hydrateProfileFromSession(ME);   // INITIAL_SESSION
  await c.hydrateProfileFromSession(ME);   // TOKEN_REFRESHED
  assert.strictEqual(modalOpen(c), false);
  assert.strictEqual(pending(c), false);
  const g = googleCtx({ db: GOOGLE_NEW_USER(), screen: 'login' });
  const pg = g.googleCallback({ credential: 'tok' });
  await tick();
  await agreeAtGate(g);
  await pg;
  assert.strictEqual(modalOpen(g), false);
  assert.strictEqual(recoveryToasts(g), 0);
  // The Settings entry point still works on its own.
  c.openChangePasswordModal();
  assert.strictEqual(modalOpen(c), true);
});

// --- password login honours the consent gate result ---------------------------
function loginCtx(db) {
  const dom = makeDom({ 'login-email': 'alice@example.com', 'login-password': 'password123' });
  dom.getElementById('screen-login').classList.add('active');
  const c = makeCtx({ dom, sbHandlers: { ...db.handlers, signInWithPassword: () => ({ data: { user: { id: ME.id, email: ME.email } }, error: null }) } });
  c.setAuthError = (f, e, msg) => { if (msg) c.authErrors.push([f, msg]); };
  return c;
}
const loginOpen = c => c.document.getElementById('screen-login').classList.contains('active');
const signedInToasts = c => c.toasts.filter(t => t[0] === 'Signed in.').length;

test('L1 password login + valid consent -> login screen closes, "Signed in." shown once', async () => {
  const c = loginCtx(makeDb({ [ME.id]: { ...profileWithLegal } }));
  await c.handleLogin();
  assert.strictEqual(loginOpen(c), false);
  assert.strictEqual(signedInToasts(c), 1);
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), '1');
  assert.strictEqual(c.document.getElementById('login-btn').disabled, false);
});

test('L2 password login + consent gate + acceptance -> success only after the gate, then normal', async () => {
  const c = loginCtx(makeDb({ [ME.id]: { ...profileNoLegal } }));
  const p = c.handleLogin();
  await tick();
  assert.strictEqual(c.gate().mode, 'consent');
  assert.strictEqual(loginOpen(c), true, 'login screen still there under the gate');
  assert.strictEqual(signedInToasts(c), 0, 'no premature success toast');
  await agreeAtGate(c);
  await p;
  assert.strictEqual(loginOpen(c), false);
  assert.strictEqual(signedInToasts(c), 1);
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), '1');
});

test('L3 password login + consent gate + Sign out -> no success toast, login screen stays, nothing marks a login', async () => {
  const c = loginCtx(makeDb({ [ME.id]: { ...profileNoLegal } }));
  const p = c.handleLogin();
  await tick();
  assert.strictEqual(c.gate().mode, 'consent');
  await c.legalGateSignOut();
  await p;
  assert.strictEqual(c.gateActive(), false);
  assert.strictEqual(loginOpen(c), true, 'login screen left as it was');
  assert.strictEqual(signedInToasts(c), 0);
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), null);
  assert.strictEqual(c.ls.getItem('ablty_cache_user_id'), null);
  assert.ok(c.sb.calls.some(x => x.op === 'signOut'));
  assert.strictEqual(c.document.getElementById('login-btn').disabled, false, 'button usable again');
});

test('L4 Google callback behaviour unchanged: gate + Sign out -> no toast, screens untouched; consent present -> toast once', async () => {
  const g = googleCtx({ db: makeDb({ [ME.id]: { ...profileNoLegal } }), screen: 'login' });
  const p = g.googleCallback({ credential: 'tok' });
  await tick();
  await g.legalGateSignOut();
  await p;
  assert.strictEqual(g.toasts.length, 0);
  assert.ok(g.document.getElementById('screen-login').classList.contains('active'));
  const g2 = googleCtx({ db: makeDb({ [ME.id]: { ...profileWithLegal } }), screen: 'login' });
  await g2.googleCallback({ credential: 'tok' });
  await tick();
  assert.deepStrictEqual(g2.toasts, [['Signed in with Google.', 'success']]);
  assert.strictEqual(g2.document.getElementById('screen-login').classList.contains('active'), false);
});

// --- a stale completion for another account never touches the current gate ----
test('E1 stale successful profile load for A cannot close B\'s consent gate', async () => {
  const db = makeDb({ [BOB.id]: { ...profileNoLegal, username: 'bob' }, [ME.id]: { ...profileWithLegal } });
  const c = makeCtx({ sbHandlers: db.handlers });
  const pB = c.onSignedIn(BOB);
  await tick();
  assert.strictEqual(c.gate().userId, BOB.id);
  assert.strictEqual(c.gate().mode, 'consent');
  // A's request, started earlier, completes now with valid consent.
  const okA = await c.ensureLegalConsent(ME, { profile: { ...profileWithLegal }, unavailable: false }, null);
  assert.strictEqual(okA, true);
  assert.strictEqual(c.gateActive(), true, 'B\'s gate still showing');
  assert.strictEqual(c.gate().userId, BOB.id);
  assert.strictEqual(c.gate().mode, 'consent');
  await agreeAtGate(c);
  assert.strictEqual(await pB, true, 'B still enters through B\'s own acceptance');
  assert.ok(db.rows[BOB.id].terms_accepted_at);
});

test('E2 stale verified-cache completion for A cannot close B\'s consent gate', async () => {
  const db = makeDb({ [BOB.id]: { ...profileNoLegal, username: 'bob' } });
  const c = makeCtx({ sbHandlers: db.handlers });
  const pB = c.onSignedIn(BOB);
  await tick();
  assert.strictEqual(c.gate().userId, BOB.id);
  c.ls.setItem(VERIFIED, JSON.stringify({ userId: ME.id, version: V, at: AT }));
  const okA = await c.ensureLegalConsent(ME, { profile: null, unavailable: true }, null);
  assert.strictEqual(okA, true);
  assert.strictEqual(c.gateActive(), true);
  assert.strictEqual(c.gate().userId, BOB.id);
  await c.legalGateSignOut();
  assert.strictEqual(await pB, false, 'B\'s gate resolved only by B\'s own action');
});

test('E3 same-user completion still resolves its own gate (consent read back, and cache path)', async () => {
  const db = makeDb({ [ME.id]: { ...profileNoLegal } });
  const c = makeCtx({ sbHandlers: db.handlers });
  const p = c.onSignedIn(ME);
  await tick();
  assert.strictEqual(c.gate().userId, ME.id);
  // Consent was recorded elsewhere (another device); a later same-user completion sees it.
  const ok = await c.ensureLegalConsent(ME, { profile: { ...profileWithLegal }, unavailable: false }, null);
  assert.strictEqual(ok, true);
  assert.strictEqual(c.gateActive(), false);
  assert.strictEqual(await p, true, 'the waiting sign-in enters');
  // Cache path for the same user while in the connection state.
  const db2 = makeDb(); db2.failSelect = true;
  const c2 = makeCtx({ sbHandlers: db2.handlers });
  const p2 = c2.onSignedIn(ME);
  await tick();
  assert.strictEqual(c2.gate().mode, 'connection');
  c2.ls.setItem(VERIFIED, JSON.stringify({ userId: ME.id, version: V, at: AT }));
  assert.strictEqual(await c2.ensureLegalConsent(ME, { profile: null, unavailable: true }, null), true);
  assert.strictEqual(c2.gateActive(), false);
  assert.strictEqual(await p2, true);
});

test('E4 legitimate account switch: a new gate for B supersedes A\'s gate (A resolves false), B proceeds normally', async () => {
  const db = makeDb({ [ME.id]: { ...profileNoLegal }, [BOB.id]: { ...profileNoLegal, username: 'bob' } });
  const c = makeCtx({ sbHandlers: db.handlers });
  const pA = c.onSignedIn(ME);
  await tick();
  assert.strictEqual(c.gate().userId, ME.id);
  const pB = c.onSignedIn(BOB);
  await tick();
  assert.strictEqual(await pA, false, 'A\'s superseded gate resolves false');
  assert.strictEqual(c.gate().userId, BOB.id);
  assert.strictEqual(c.gate().mode, 'consent');
  await agreeAtGate(c);
  assert.strictEqual(await pB, true);
  assert.ok(db.rows[BOB.id].terms_accepted_at);
  assert.strictEqual(db.rows[ME.id].terms_accepted_at, null, 'A never received B\'s acceptance');
});

// --- boot preflight and concurrency -----------------------------------------
const TOKEN_KEY = 'sb-ghjajyxcjfqidcmqdzdp-auth-token';
test('P1 preflight: stored session without cached verification -> gate raised in checking mode before anything renders', async () => {
  const c = makeCtx();
  c.ls.setItem(TOKEN_KEY, JSON.stringify({ access_token: 'x', user: { id: ME.id } }));
  c.preflightLegalGate();
  assert.strictEqual(c.gateActive(), true);
  assert.strictEqual(c.gate().mode, 'checking');
  assert.strictEqual(c.document.getElementById('legal-gate-signout-row').style.display, 'none');
  c.resolveLegalGate(false);
});

test('P2 preflight: stored session WITH matching cached verification -> no gate; no session -> no gate', async () => {
  const c = makeCtx();
  c.ls.setItem(TOKEN_KEY, JSON.stringify({ user: { id: ME.id } }));
  c.ls.setItem(VERIFIED, JSON.stringify({ userId: ME.id, version: V }));
  c.preflightLegalGate();
  assert.strictEqual(c.gateActive(), false);
  const c2 = makeCtx();
  c2.preflightLegalGate();
  assert.strictEqual(c2.gateActive(), false);
});

test('P3 preflight gate is resolved by session restore: with acceptance it hides, without it turns into consent', async () => {
  const db = makeDb({ [ME.id]: { ...profileWithLegal } });
  const c = makeCtx({ sbHandlers: db.handlers });
  c.ls.setItem(TOKEN_KEY, JSON.stringify({ user: { id: ME.id } }));
  c.preflightLegalGate();
  await c.hydrateProfileFromSession(ME);
  assert.strictEqual(c.gateActive(), false);
  const db2 = makeDb({ [ME.id]: { ...profileNoLegal } });
  const c2 = makeCtx({ sbHandlers: db2.handlers });
  c2.ls.setItem(TOKEN_KEY, JSON.stringify({ user: { id: ME.id } }));
  c2.preflightLegalGate();
  const p = c2.hydrateProfileFromSession(ME);
  await tick();
  assert.strictEqual(c2.gate().mode, 'consent');
  await agreeAtGate(c2);
  await p;
  assert.strictEqual(c2.ls.getItem('ablty_logged_in'), '1');
});

test('P4 preflight gate for a stale token is dismissed when the session turns out to be gone', async () => {
  const c = makeCtx();
  c.ls.setItem(TOKEN_KEY, JSON.stringify({ user: { id: ME.id } }));
  c.preflightLegalGate();
  c.clearLocalAuthCache();
  assert.strictEqual(c.gateActive(), false);
});

test('P5 two concurrent session restores share one gate; one agreement resolves both; a repeat does not reset the tick', async () => {
  const db = makeDb({ [ME.id]: { ...profileNoLegal } });
  const c = makeCtx({ sbHandlers: db.handlers });
  const p1 = c.hydrateProfileFromSession(ME);
  const p2 = c.hydrateProfileFromSession(ME);
  await tick();
  assert.strictEqual(c.gate().mode, 'consent');
  const cb = c.document.getElementById('legal-gate-check'); cb.checked = true; c.onLegalGateCheckChange(cb);
  const p3 = c.hydrateProfileFromSession(ME); // e.g. TOKEN_REFRESHED while reading
  await tick();
  assert.strictEqual(cb.checked, true, 'repeat call must not reset the ticked box');
  await c.submitLegalGate();
  await Promise.all([p1, p2, p3]);
  assert.strictEqual(c.gateActive(), false);
  assert.strictEqual(updates(c).length, 1, 'one write for one agreement');
});

// ═══════════════════════════════════════════════════════
//  STALE COMPLETIONS: a late result for one account never
//  touches another account's gate, cache, flags or data
// ═══════════════════════════════════════════════════════
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const cacheOwner = c => c.ls.getItem('ablty_cache_user_id');
const enteredUser = c => c.eval('_enteredUserId');
// Mirrors the SIGNED_OUT branch of the onAuthStateChange handler in app.html.
const signedOutEvent = c => { c.cancelPendingPasswordRecovery(); c.clearLocalAuthCache(); };
const isReadBack = q => q.op === 'select' && /terms_accepted_at, privacy_accepted_at$/.test(q.cols || '') && !/username/.test(q.cols || '');

test('S1 Blocker 1: A\'s delayed consent read-back after B\'s gate replaced it does not approve B', async () => {
  const db = makeDb({ [ME.id]: { ...profileNoLegal }, [BOB.id]: { ...profileNoLegal, username: 'bob' } });
  const c = makeCtx({ sbHandlers: db.handlers });
  const pA = c.onSignedIn(ME);
  await tick();
  assert.strictEqual(c.gate().userId, ME.id);
  // A ticks and submits; the read-back after the update is held.
  const hold = deferred();
  db.hold = q => (isReadBack(q) && q.eq[1] === ME.id) ? hold.promise : null;
  const cb = c.document.getElementById('legal-gate-check'); cb.checked = true; c.onLegalGateCheckChange(cb);
  const pSubmit = c.submitLegalGate();
  await tick();
  assert.ok(db.rows[ME.id].terms_accepted_at, 'A\'s acceptance reached the database');
  // B signs in on the same device and gets their own gate.
  const pB = c.onSignedIn(BOB);
  await tick();
  assert.strictEqual(await pA, false, 'A\'s superseded sign-in did not enter');
  assert.strictEqual(c.gate().userId, BOB.id);
  assert.strictEqual(c.gate().mode, 'consent');
  // A's read-back arrives now.
  hold.resolve();
  await pSubmit;
  await tick();
  assert.strictEqual(c.gateActive(), true, 'B\'s gate is still showing');
  assert.strictEqual(c.gate().userId, BOB.id, 'B\'s gate was not replaced');
  assert.strictEqual(c.document.getElementById('legal-gate-err').textContent, '', 'no error shown on B\'s gate');
  assert.strictEqual(c.ls.getItem(VERIFIED), null, 'B is not marked verified, and A\'s cache is not written over B\'s context');
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), null, 'nobody entered');
  assert.strictEqual(db.rows[BOB.id].terms_accepted_at, null, 'B never accepted');
  // B accepts and enters as B; A's recorded acceptance is intact.
  await agreeAtGate(c);
  assert.strictEqual(await pB, true);
  assert.strictEqual(cacheOwner(c), BOB.id);
  assert.ok(db.rows[ME.id].terms_accepted_at && db.rows[BOB.id].terms_accepted_at);
});

test('S1b Blocker 1: A signs out from the gate mid-save and returns to the same account; the old save cannot resolve the new gate', async () => {
  const db = makeDb({ [ME.id]: { ...profileNoLegal } });
  const c = makeCtx({ sbHandlers: db.handlers });
  const p1 = c.onSignedIn(ME);
  await tick();
  const g1 = c.gate();
  // Hold the UPDATE so the database does not have the acceptance yet.
  const hold = deferred();
  db.handlers.update = q => hold.promise.then(() => { Object.assign(db.rows[q.eq[1]], q.patch); return { error: null }; });
  const cb = c.document.getElementById('legal-gate-check'); cb.checked = true; c.onLegalGateCheckChange(cb);
  const pSubmit = c.submitLegalGate();
  await tick();
  await c.legalGateSignOut();
  assert.strictEqual(await p1, false);
  // A signs in again: the database still has null fields, so a NEW gate opens.
  const p2 = c.onSignedIn(ME);
  await tick();
  const g2 = c.gate();
  assert.ok(g2 && g2 !== g1 && g2.userId === ME.id, 'a fresh gate for the same account');
  hold.resolve();
  await pSubmit;
  await tick();
  assert.strictEqual(c.gate(), g2, 'the old submission did not resolve or replace the new gate');
  assert.strictEqual(c.gateActive(), true);
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), null, 'A has not entered yet');
  assert.ok(db.rows[ME.id].terms_accepted_at, 'the original acceptance is recorded for A');
  // A agrees on the new gate and enters normally.
  await agreeAtGate(c);
  assert.strictEqual(await p2, true);
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), '1');
});

test('S1c a failing stale save shows no error on the current account\'s gate', async () => {
  const db = makeDb({ [ME.id]: { ...profileNoLegal }, [BOB.id]: { ...profileNoLegal, username: 'bob' } });
  const c = makeCtx({ sbHandlers: db.handlers });
  const pA = c.onSignedIn(ME);
  await tick();
  const hold = deferred();
  db.handlers.update = () => hold.promise.then(() => ({ error: { message: 'network down' } }));
  const cb = c.document.getElementById('legal-gate-check'); cb.checked = true; c.onLegalGateCheckChange(cb);
  const pSubmit = c.submitLegalGate();
  await tick();
  const pB = c.onSignedIn(BOB);
  await tick();
  assert.strictEqual(await pA, false);
  const bobCb = c.document.getElementById('legal-gate-check');
  assert.strictEqual(bobCb.checked, false, 'B\'s gate starts unticked');
  hold.resolve();
  await pSubmit;
  await tick();
  assert.strictEqual(c.document.getElementById('legal-gate-err').textContent, '');
  assert.strictEqual(c.gate().userId, BOB.id);
  assert.strictEqual(c.document.getElementById('legal-gate-btn').textContent, 'I AGREE');
  await c.legalGateSignOut();
  assert.strictEqual(await pB, false);
});

test('S2 Blocker 2: A\'s delayed Premium sign-in after B entered as Free does not overwrite B\'s cache or entry', async () => {
  const db = makeDb({ [ME.id]: { ...profileWithLegal, username: 'alice', tier: 'premium' }, [BOB.id]: { ...profileWithLegal, username: 'bob', tier: 'free' } });
  const c = makeCtx({ sbHandlers: db.handlers });
  const hold = deferred();
  db.hold = q => q.eq[1] === ME.id ? hold.promise : null;
  const pA = c.onSignedIn(ME);
  await tick();
  const pB = c.onSignedIn(BOB);
  assert.strictEqual(await pB, true);
  assert.strictEqual(cacheOwner(c), BOB.id);
  assert.strictEqual(c.getCurrentTier(), 'free');
  hold.resolve();
  assert.strictEqual(await pA, false, 'stale sign-in reports no entry');
  await tick();
  assert.strictEqual(cacheOwner(c), BOB.id, 'cache owner still B');
  assert.strictEqual(c.ls.getItem('ablty_username'), 'bob');
  assert.strictEqual(c.getCurrentTier(), 'free', 'B did not become Premium');
  assert.strictEqual(enteredUser(c), BOB.id);
  assert.strictEqual(c.ls.getItem('ablty_user_email'), BOB.email);
  assert.strictEqual(c.gateActive(), false, 'no gate raised for the stale account');
});

test('S3 Blocker 2: delayed session restore after sign-out does not restore ablty_logged_in or the cache', async () => {
  const db = makeDb({ [ME.id]: { ...profileWithLegal, username: 'alice', tier: 'premium' } });
  const c = makeCtx({ sbHandlers: db.handlers });
  const hold = deferred();
  db.hold = q => hold.promise;
  const pH = c.hydrateProfileFromSession(ME);
  await tick();
  signedOutEvent(c);
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), null);
  hold.resolve();
  await pH;
  await tick();
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), null, 'not logged back in');
  assert.strictEqual(cacheOwner(c), null);
  assert.strictEqual(c.ls.getItem('ablty_tier'), null, 'no Premium cache restored');
  assert.strictEqual(c.ls.getItem('ablty_user_email'), null);
  assert.strictEqual(enteredUser(c), null);
  assert.strictEqual(c.getCurrentTier(), 'guest');
});

test('S3b delayed settings profile refresh after sign-out and B\'s sign-in does not write A\'s profile into B\'s cache', async () => {
  const db = makeDb({ [ME.id]: { ...profileWithLegal, username: 'alice', tier: 'premium' }, [BOB.id]: { ...profileWithLegal, username: 'bob', tier: 'free' } });
  const c = makeCtx({ sbHandlers: db.handlers });
  assert.strictEqual(await c.onSignedIn(ME), true);
  // Settings screen refresh for A: the session says A, the profile read is held.
  c.sb.auth.getSession = () => Promise.resolve({ data: { session: { user: { id: ME.id } } } });
  const hold = deferred();
  db.hold = q => q.eq[1] === ME.id ? hold.promise : null;
  const pR = c.renderSettingsState();
  await tick();
  signedOutEvent(c);
  c.sb.auth.getSession = () => Promise.resolve({ data: { session: null } });
  assert.strictEqual(await c.onSignedIn(BOB), true);
  assert.strictEqual(cacheOwner(c), BOB.id);
  hold.resolve();
  await pR;
  await tick();
  assert.strictEqual(cacheOwner(c), BOB.id, 'A\'s late profile did not replace B\'s cache');
  assert.strictEqual(c.ls.getItem('ablty_username'), 'bob');
  assert.strictEqual(c.getCurrentTier(), 'free');
});

test('S4 A -> B -> A: an operation from A\'s first login stays invalid after A returns', async () => {
  const db = makeDb({ [ME.id]: { ...profileWithLegal, username: 'alice', tier: 'free' }, [BOB.id]: { ...profileWithLegal, username: 'bob', tier: 'free' } });
  const c = makeCtx({ sbHandlers: db.handlers });
  // A's FIRST profile read is held and, when released, answers with a stale row.
  const hold = deferred();
  let firstA = true;
  db.hold = q => {
    if (q.eq[1] === ME.id && firstA) { firstA = false; return hold.promise.then(() => ({ data: { ...profileWithLegal, username: 'stale_alice', tier: 'premium' }, error: null })); }
    return null;
  };
  const pA1 = c.onSignedIn(ME);
  await tick();
  assert.strictEqual(await c.onSignedIn(BOB), true);
  signedOutEvent(c);
  const pA2 = c.onSignedIn(ME);
  assert.strictEqual(await pA2, true);
  assert.strictEqual(c.ls.getItem('ablty_username'), 'alice');
  hold.resolve();
  assert.strictEqual(await pA1, false, 'the first login\'s operation is obsolete even though the same account is active again');
  await tick();
  assert.strictEqual(c.ls.getItem('ablty_username'), 'alice', 'stale row not applied');
  assert.strictEqual(c.getCurrentTier(), 'free', 'no Premium from the stale row');
  assert.strictEqual(cacheOwner(c), ME.id);
  assert.strictEqual(enteredUser(c), ME.id);
});

test('S5 same account: overlapping sign-in, session restores and token refresh all complete normally', async () => {
  const db = makeDb({ [ME.id]: { ...profileWithLegal, username: 'alice', tier: 'premium' } });
  const c = makeCtx({ sbHandlers: db.handlers });
  const hold = deferred();
  db.hold = q => hold.promise;
  const p1 = c.onSignedIn(ME);           // explicit login
  const p2 = c.hydrateProfileFromSession(ME); // INITIAL_SESSION
  const p3 = c.hydrateProfileFromSession(ME); // TOKEN_REFRESHED
  await tick();
  assert.strictEqual(c.authEntriesInFlight(), true);
  hold.resolve();
  assert.strictEqual(await p1, true);
  await Promise.all([p2, p3]);
  assert.strictEqual(c.eval('_authGen'), 1, 'one generation for one account');
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), '1');
  assert.strictEqual(c.getCurrentTier(), 'premium');
  assert.strictEqual(enteredUser(c), ME.id);
  assert.strictEqual(c.authEntriesInFlight(), false);
  // A later refresh for the same account still cooperates.
  db.hold = null;
  await c.hydrateProfileFromSession(ME);
  assert.strictEqual(c.eval('_authGen'), 1);
  assert.strictEqual(c.getCurrentTier(), 'premium');
});

test('S6 recovery waits behind consent, opens exactly once for its own account, and is cancelled by sign-out or another account', async () => {
  // Opens once after the gate for the recovering account.
  const db = makeDb({ [ME.id]: { ...profileNoLegal } });
  const c = makeCtx({ sbHandlers: db.handlers });
  c.onPasswordRecoveryEvent({ user: { id: ME.id } });
  const p = c.onSignedIn(ME);
  await tick();
  assert.strictEqual(c.gate().mode, 'consent');
  assert.strictEqual(modalOpen(c), false, 'not underneath the gate');
  await agreeAtGate(c);
  assert.strictEqual(await p, true);
  assert.strictEqual(modalOpen(c), true);
  c.document.getElementById('change-password-modal').style.display = 'none';
  await c.hydrateProfileFromSession(ME);
  assert.strictEqual(modalOpen(c), false, 'opened exactly once');

  // Another account taking over cancels A's pending recovery.
  const c2 = makeCtx({ sbHandlers: makeDb({ [ME.id]: { ...profileNoLegal }, [BOB.id]: { ...profileWithLegal, username: 'bob' } }).handlers });
  c2.onPasswordRecoveryEvent({ user: { id: ME.id } });
  const pA = c2.onSignedIn(ME);
  await tick();
  assert.strictEqual(c2.gate().userId, ME.id);
  assert.strictEqual(await c2.onSignedIn(BOB), true);
  assert.strictEqual(await pA, false);
  assert.strictEqual(modalOpen(c2), false, 'never opens for another account');
  assert.strictEqual(c2.eval('_passwordRecoveryPending'), false, 'cancelled by the account replacement');

  // A recovery bound to A never opens when only B enters.
  const c3 = makeCtx({ sbHandlers: makeDb({ [BOB.id]: { ...profileWithLegal, username: 'bob' } }).handlers });
  c3.onPasswordRecoveryEvent({ user: { id: ME.id } });
  assert.strictEqual(await c3.onSignedIn(BOB), true);
  assert.strictEqual(modalOpen(c3), false);
  assert.strictEqual(c3.eval('_passwordRecoveryPending'), false);

  // Sign-out cancels it.
  const c4 = makeCtx({ sbHandlers: makeDb({ [ME.id]: { ...profileWithLegal } }).handlers });
  c4.onPasswordRecoveryEvent({ user: { id: ME.id } });
  signedOutEvent(c4);
  assert.strictEqual(await c4.onSignedIn(ME), true);
  assert.strictEqual(modalOpen(c4), false);

  // A hung stale operation from an earlier generation does not block the prompt.
  const db5 = makeDb({ [ME.id]: { ...profileWithLegal } });
  const c5 = makeCtx({ sbHandlers: db5.handlers });
  const never = deferred();
  let first = true;
  db5.hold = q => { if (first) { first = false; return never.promise; } return null; };
  const hung = c5.onSignedIn(ME);
  await tick();
  signedOutEvent(c5);
  c5.onPasswordRecoveryEvent({ user: { id: ME.id } });
  assert.strictEqual(await c5.onSignedIn(ME), true);
  assert.strictEqual(modalOpen(c5), true, 'prompt opens although a stale entry never finished');
  void hung;
});

test('S7 gate sign-out during password login produces no success, and the next account\'s login is unaffected', async () => {
  const db = makeDb({ [ME.id]: { ...profileNoLegal }, [BOB.id]: { ...profileWithLegal, username: 'bob' } });
  const c = loginCtx(db);
  const p = c.handleLogin();
  await tick();
  assert.strictEqual(c.gate().mode, 'consent');
  await c.legalGateSignOut();
  await p;
  assert.strictEqual(signedInToasts(c), 0);
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), null);
  assert.strictEqual(enteredUser(c), null);
  c.sb.auth.signInWithPassword = () => Promise.resolve({ data: { user: { id: BOB.id, email: BOB.email } }, error: null });
  await c.handleLogin();
  assert.strictEqual(signedInToasts(c), 1);
  assert.strictEqual(cacheOwner(c), BOB.id);
  assert.strictEqual(loginOpen(c), false);
});

test('S8 offline Premium is preserved for the matching user, isolated from another user, and a stale offline entry cannot bring it back', async () => {
  const db = makeDb({ [BOB.id]: { ...profileWithLegal, username: 'bob', tier: 'free' } });
  const c = makeCtx({ sbHandlers: db.handlers });
  c.writeLocalAccountCache(ME.id, 'alice', 'premium', '2026-01-01T00:00:00Z');
  c.ls.setItem(VERIFIED, JSON.stringify({ userId: ME.id, version: V, at: AT }));
  // A offline: profile unreadable, verified cache matches -> stays Premium.
  const hold = deferred();
  db.hold = q => q.eq[1] === ME.id ? hold.promise.then(() => ({ data: null, error: { message: 'Failed to fetch' } })) : null;
  const pA = c.onSignedIn(ME);
  await tick();
  // B signs in (online, Free) before A's failed read returns.
  assert.strictEqual(await c.onSignedIn(BOB), true);
  assert.strictEqual(c.getCurrentTier(), 'free');
  assert.strictEqual(cacheOwner(c), BOB.id);
  hold.resolve();
  assert.strictEqual(await pA, false);
  assert.strictEqual(c.getCurrentTier(), 'free', 'A\'s stale offline entry did not make B Premium');
  assert.strictEqual(c.ls.getItem('ablty_username'), 'bob');
  // Now A alone, offline, in a fresh context with their own cache: Premium preserved.
  const db2 = makeDb(); db2.failSelect = true;
  const c2 = makeCtx({ sbHandlers: db2.handlers });
  c2.writeLocalAccountCache(ME.id, 'alice', 'premium', '2026-01-01T00:00:00Z');
  c2.ls.setItem(VERIFIED, JSON.stringify({ userId: ME.id, version: V, at: AT }));
  assert.strictEqual(await c2.onSignedIn(ME), true);
  assert.strictEqual(c2.getCurrentTier(), 'premium');
  assert.strictEqual(c2.ls.getItem('ablty_username'), 'alice');
  // A different user with the same device cache does not inherit it.
  const c3 = makeCtx({ sbHandlers: db2.handlers });
  c3.writeLocalAccountCache(ME.id, 'alice', 'premium', '');
  c3.ls.setItem(VERIFIED, JSON.stringify({ userId: BOB.id, version: V, at: AT }));
  assert.strictEqual(await c3.onSignedIn(BOB), true);
  assert.strictEqual(c3.getCurrentTier(), 'free');
  assert.strictEqual(c3.ls.getItem('ablty_username'), 'Seeker');
});

test('S9 guest data: no transfer before consent, and a stale guest-data choice or cloud load cannot act for another account', async () => {
  // Before consent (gate open) nothing is asked or moved.
  const db = makeDb({ [ME.id]: { ...profileNoLegal }, [BOB.id]: { ...profileWithLegal, username: 'bob' } });
  const c = makeCtx({ sbHandlers: db.handlers });
  let guestCalls = 0;
  c.hasLocalGuestData = () => guestCalls++ === 0; // only A's sign-in sees guest data
  const synced = []; c.syncLocalDataToSupabase = async id => { synced.push(id); };
  let cleared = 0; c.clearLocalGuestData = () => { cleared++; };
  const choice = deferred();
  c.showGuestDataModal = () => choice.promise;
  const pA = c.onSignedIn(ME);
  await tick();
  assert.strictEqual(c.gate().mode, 'consent');
  assert.deepStrictEqual(synced, []);
  await agreeAtGate(c);
  await tick();
  // A is in; the guest-data choice is open. B signs in and enters meanwhile.
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), '1');
  assert.strictEqual(await c.onSignedIn(BOB), true);
  assert.strictEqual(cacheOwner(c), BOB.id);
  choice.resolve('save');
  assert.strictEqual(await pA, false, 'A\'s sign-in is reported as not completed');
  await tick();
  assert.deepStrictEqual(synced, [], 'guest data was not uploaded to any account');
  assert.strictEqual(cleared, 0);
  assert.strictEqual(c.ls.getItem('ablty_guest_sync_done_' + ME.id), null, 'not marked handled for A');

  // A stale cloud load (real loadAnalyticsFromCloud) for A after B entered does not merge A's rows.
  const c2 = makeCtx({ sbHandlers: {
    select: q => {
      if (q.list && q.table === 'rv_sessions' && q.eq[1] === ME.id) return c2.rvHold.promise.then(() => ({ data: [{ id: 1, trn: 'A1', timestamp: '2026-01-01T00:00:00Z' }], error: null }));
      if (q.list) return { data: [], error: null };
      return { data: q.eq[1] === ME.id ? { ...profileWithLegal } : { ...profileWithLegal, username: 'bob' }, error: null };
    },
  } });
  c2.rvHold = deferred();
  const pLoad = c2.loadAnalyticsFromCloud(ME.id);
  await tick();
  assert.strictEqual(await c2.onSignedIn(BOB), true);
  c2.rvHold.resolve();
  await pLoad;
  assert.deepStrictEqual(c2.STATE.sessions, [], 'A\'s cloud rows were not merged into B\'s local state');
  assert.strictEqual(c2.ls.getItem('ablty_rv_cloud_cache'), null);
});

// ═══════════════════════════════════════════════════════
//  OUTER CALLERS: the session/auth result itself arrives
//  late, before hydration or onSignedIn has even begun
// ═══════════════════════════════════════════════════════
const activeUser = c => c.eval('_activeAuthUserId');
const sessionFor = u => ({ data: { session: u ? { user: { id: u.id, email: u.email } } : null } });
// Delays only the FIRST getSession call (the one under test); later calls,
// such as the settings refresh during another account's entry, answer at once.
const holdFirstGetSession = (c, hold, answer) => {
  let first = true;
  c.sb.auth.getSession = () => { if (first) { first = false; return hold.promise.then(answer); } return Promise.resolve(sessionFor(null)); };
};
const twoUsers = () => makeDb({ [ME.id]: { ...profileWithLegal, username: 'alice', tier: 'premium' }, [BOB.id]: { ...profileWithLegal, username: 'bob', tier: 'free' } });
const assertBobIntact = c => {
  assert.strictEqual(c.ls.getItem('ablty_logged_in'), '1', 'B still logged in');
  assert.strictEqual(cacheOwner(c), BOB.id);
  assert.strictEqual(c.ls.getItem('ablty_username'), 'bob');
  assert.strictEqual(c.getCurrentTier(), 'free');
  assert.strictEqual(activeUser(c), BOB.id);
  assert.strictEqual(enteredUser(c), BOB.id);
  assert.strictEqual(c.gateActive(), false);
};

test('T1 reconcileAuthState: a delayed "no session" answer after B logged in does not clear B', async () => {
  const c = makeCtx({ sbHandlers: twoUsers().handlers });
  const hold = deferred();
  holdFirstGetSession(c, hold, () => sessionFor(null));
  const pR = c.reconcileAuthState();
  await tick();
  assert.strictEqual(await c.onSignedIn(BOB), true);
  hold.resolve();
  await pR;
  await tick();
  assertBobIntact(c);
  // Same for a late error from getSession.
  const c2 = makeCtx({ sbHandlers: twoUsers().handlers });
  const hold2 = deferred();
  holdFirstGetSession(c2, hold2, () => { throw new Error('boom'); });
  const pR2 = c2.reconcileAuthState();
  await tick();
  assert.strictEqual(await c2.onSignedIn(BOB), true);
  hold2.resolve();
  await pR2;
  assertBobIntact(c2);
  // With nothing else happening, "no session" still clears a stale local login.
  const c3 = makeCtx({ sbHandlers: twoUsers().handlers });
  c3.ls.setItem('ablty_logged_in', '1');
  await c3.reconcileAuthState();
  assert.strictEqual(c3.ls.getItem('ablty_logged_in'), null);
});

test('T2 reconcileAuthState: a delayed session for A after B took over never starts A\'s context or replaces B\'s gate', async () => {
  // B is at its consent gate.
  const db = makeDb({ [ME.id]: { ...profileWithLegal, username: 'alice' }, [BOB.id]: { ...profileNoLegal, username: 'bob' } });
  const c = makeCtx({ sbHandlers: db.handlers });
  const hold = deferred();
  holdFirstGetSession(c, hold, () => sessionFor(ME));
  const pR = c.reconcileAuthState();
  await tick();
  const pB = c.onSignedIn(BOB);
  await tick();
  assert.strictEqual(c.gate().userId, BOB.id);
  const genBefore = c.eval('_authGen');
  hold.resolve();
  await pR;
  await tick();
  assert.strictEqual(c.gate().userId, BOB.id, 'B\'s gate untouched');
  assert.strictEqual(c.gate().mode, 'consent');
  assert.strictEqual(activeUser(c), BOB.id, 'A never became active');
  assert.strictEqual(c.eval('_authGen'), genBefore, 'no new generation from the stale answer');
  assert.ok(!c.sb.calls.some(x => x.op === 'select' && x.eq && x.eq[1] === ME.id), 'A\'s profile was never loaded');
  await agreeAtGate(c);
  assert.strictEqual(await pB, true);
  // B already entered.
  const c2 = makeCtx({ sbHandlers: twoUsers().handlers });
  const hold2 = deferred();
  holdFirstGetSession(c2, hold2, () => sessionFor(ME));
  const pR2 = c2.reconcileAuthState();
  await tick();
  assert.strictEqual(await c2.onSignedIn(BOB), true);
  hold2.resolve();
  await pR2;
  await tick();
  assertBobIntact(c2);
});

test('T2b reconcileAuthState: a delayed session for the SAME account that meanwhile logged in still cooperates', async () => {
  const c = makeCtx({ sbHandlers: twoUsers().handlers });
  const hold = deferred();
  holdFirstGetSession(c, hold, () => sessionFor(ME));
  const pR = c.reconcileAuthState();
  await tick();
  assert.strictEqual(await c.onSignedIn(ME), true);
  hold.resolve();
  await pR;
  assert.strictEqual(c.eval('_authGen'), 1, 'one generation for one account');
  assert.strictEqual(cacheOwner(c), ME.id);
  assert.strictEqual(c.getCurrentTier(), 'premium');
  assert.strictEqual(enteredUser(c), ME.id);
});

test('T3 checkAuthCallback: a delayed setSession result for A after B entered does not enter A; a normal callback still enters', async () => {
  const c = makeCtx({ sbHandlers: twoUsers().handlers });
  c.window.location.hash = '#access_token=at&refresh_token=rt&type=signup';
  const hold = deferred();
  c.sb.auth.setSession = () => hold.promise.then(() => ({ data: { user: { id: ME.id, email: ME.email }, session: {} }, error: null }));
  c.checkAuthCallback();
  await tick();
  assert.strictEqual(await c.onSignedIn(BOB), true);
  hold.resolve();
  await tick();
  assertBobIntact(c);
  const c2 = makeCtx({ sbHandlers: twoUsers().handlers });
  c2.window.location.hash = '#access_token=at&refresh_token=rt';
  c2.sb.auth.setSession = () => Promise.resolve({ data: { user: { id: ME.id, email: ME.email }, session: {} }, error: null });
  c2.checkAuthCallback();
  await tick();
  assert.strictEqual(c2.ls.getItem('ablty_logged_in'), '1');
  assert.strictEqual(cacheOwner(c2), ME.id);
});

test('T4 handleLogin: a delayed password sign-in for A after B entered is not announced and does not take over; the SDK\'s own SIGNED_IN for the same user still cooperates', async () => {
  const db = twoUsers();
  const c = loginCtx(db);
  const hold = deferred();
  c.sb.auth.signInWithPassword = () => hold.promise.then(() => ({ data: { user: { id: ME.id, email: ME.email } }, error: null }));
  const pL = c.handleLogin();
  await tick();
  assert.strictEqual(await c.onSignedIn(BOB), true);
  hold.resolve();
  await pL;
  await tick();
  assertBobIntact(c);
  assert.strictEqual(signedInToasts(c), 0, 'no "Signed in." for the stale login');
  assert.strictEqual(loginOpen(c), true, 'login screen not closed as a success');
  assert.strictEqual(c.document.getElementById('login-btn').disabled, false);
  // Same account: SIGNED_IN(A) from the SDK lands before signInWithPassword resolves.
  const c2 = loginCtx(twoUsers());
  c2.sb.auth.signInWithPassword = async () => { c2.onSignedIn(ME); await tick(); return { data: { user: { id: ME.id, email: ME.email } }, error: null }; };
  await c2.handleLogin();
  await tick();
  assert.strictEqual(signedInToasts(c2), 1);
  assert.strictEqual(loginOpen(c2), false);
  assert.strictEqual(cacheOwner(c2), ME.id);
  assert.strictEqual(c2.eval('_authGen'), 1);
});

test('T5 Google callback: a delayed signInWithIdToken for A after B entered is not announced and does not take over', async () => {
  const hold = deferred();
  const g = googleCtx({
    db: twoUsers(),
    screen: 'login',
    signInWithIdToken: () => hold.promise.then(() => ({ data: { user: { id: ME.id, email: ME.email } }, error: null })),
  });
  const pG = g.googleCallback({ credential: 'tok' });
  await tick();
  assert.strictEqual(await g.onSignedIn(BOB), true);
  hold.resolve();
  await pG;
  await tick();
  assertBobIntact(g);
  assert.strictEqual(g.toasts.length, 0);
  assert.ok(g.document.getElementById('screen-login').classList.contains('active'), 'login screen left as it was');
});

test('T6 payment return: a delayed getSession for A after B entered does not re-enter A; normally it re-enters the stored session', async () => {
  const c = makeCtx({ sbHandlers: twoUsers().handlers });
  const hold = deferred();
  holdFirstGetSession(c, hold, () => sessionFor(ME));
  c.resumeSessionAfterPayment();
  await tick();
  assert.strictEqual(await c.onSignedIn(BOB), true);
  hold.resolve();
  await tick();
  assertBobIntact(c);
  const c2 = makeCtx({ sbHandlers: twoUsers().handlers });
  c2.sb.auth.getSession = () => Promise.resolve(sessionFor(ME));
  c2.resumeSessionAfterPayment();
  await tick();
  assert.strictEqual(cacheOwner(c2), ME.id);
  assert.strictEqual(c2.getCurrentTier(), 'premium');
});

// ═══════════════════════════════════════════════════════
//  RECOVERY FOR THE ACCOUNT BEING ENTERED
// ═══════════════════════════════════════════════════════
test('V1 A has entered, PASSWORD_RECOVERY arrives for B, then B enters -> opens exactly once, for B', async () => {
  const c = makeCtx({ sbHandlers: twoUsers().handlers });
  assert.strictEqual(await c.onSignedIn(ME), true);
  c.onPasswordRecoveryEvent({ user: { id: BOB.id } });
  assert.strictEqual(modalOpen(c), false, 'not opened for A');
  assert.strictEqual(c.eval('_passwordRecoveryPending'), true, 'retained for B');
  assert.strictEqual(activeUser(c), BOB.id, 'the recovery session\'s account is now the active one');
  await c.hydrateProfileFromSession(BOB);
  assert.strictEqual(modalOpen(c), true);
  assert.strictEqual(enteredUser(c), BOB.id);
  assert.strictEqual(cacheOwner(c), BOB.id);
  c.document.getElementById('change-password-modal').style.display = 'none';
  await c.onSignedIn(BOB);
  assert.strictEqual(modalOpen(c), false, 'exactly once');
});

test('V2 A is at its consent gate, PASSWORD_RECOVERY arrives for B, then B enters -> A superseded, opens once for B (with and without B needing consent)', async () => {
  const db = makeDb({ [ME.id]: { ...profileNoLegal }, [BOB.id]: { ...profileWithLegal, username: 'bob' } });
  const c = makeCtx({ sbHandlers: db.handlers });
  const pA = c.onSignedIn(ME);
  await tick();
  assert.strictEqual(c.gate().userId, ME.id);
  c.onPasswordRecoveryEvent({ user: { id: BOB.id } });
  assert.strictEqual(await pA, false, 'A\'s gate was superseded');
  assert.strictEqual(c.gateActive(), false);
  assert.strictEqual(modalOpen(c), false);
  assert.strictEqual(await c.onSignedIn(BOB), true);
  assert.strictEqual(modalOpen(c), true);
  assert.strictEqual(enteredUser(c), BOB.id);
  assert.strictEqual(db.rows[ME.id].terms_accepted_at, null, 'A never received an acceptance');
  // B itself needs consent: the modal waits behind B's gate.
  const db2 = makeDb({ [ME.id]: { ...profileNoLegal }, [BOB.id]: { ...profileNoLegal, username: 'bob' } });
  const c2 = makeCtx({ sbHandlers: db2.handlers });
  const pA2 = c2.onSignedIn(ME);
  await tick();
  c2.onPasswordRecoveryEvent({ user: { id: BOB.id } });
  assert.strictEqual(await pA2, false);
  const pB2 = c2.onSignedIn(BOB);
  await tick();
  assert.strictEqual(c2.gate().userId, BOB.id);
  assert.strictEqual(modalOpen(c2), false, 'not underneath B\'s gate');
  await agreeAtGate(c2);
  assert.strictEqual(await pB2, true);
  assert.strictEqual(modalOpen(c2), true);
  c2.document.getElementById('change-password-modal').style.display = 'none';
  await c2.hydrateProfileFromSession(BOB);
  assert.strictEqual(modalOpen(c2), false, 'exactly once');
});

test('V3 recovery is still cancelled by sign-out, by a later unrelated login, and dropped for an obsolete event', async () => {
  const CAT = { id: 'cccccccc-3333-4333-8333-cccccccccccc', email: 'cat@example.com' };
  const db = makeDb({ [BOB.id]: { ...profileWithLegal, username: 'bob' }, [CAT.id]: { ...profileWithLegal, username: 'cat' } });
  // Later unrelated login replaces it.
  const c = makeCtx({ sbHandlers: db.handlers });
  c.onPasswordRecoveryEvent({ user: { id: BOB.id } });
  assert.strictEqual(await c.onSignedIn(CAT), true);
  assert.strictEqual(modalOpen(c), false);
  assert.strictEqual(c.eval('_passwordRecoveryPending'), false);
  // Sign-out cancels it.
  const c2 = makeCtx({ sbHandlers: db.handlers });
  c2.onPasswordRecoveryEvent({ user: { id: BOB.id } });
  signedOutEvent(c2);
  assert.strictEqual(c2.eval('_passwordRecoveryPending'), false);
  assert.strictEqual(await c2.onSignedIn(BOB), true);
  assert.strictEqual(modalOpen(c2), false);
  // Obsolete: the event's account never enters; a different account does.
  const c3 = makeCtx({ sbHandlers: db.handlers });
  c3.onPasswordRecoveryEvent({ user: { id: 'dddddddd-4444-4444-8444-dddddddddddd' } });
  assert.strictEqual(await c3.onSignedIn(CAT), true);
  assert.strictEqual(modalOpen(c3), false);
  assert.strictEqual(c3.eval('_passwordRecoveryPending'), false);
});

(async () => {
  let pass = 0, fail = 0;
  // Optional filter: node tests/auth-consent.test.js S6
  const only = process.argv[2];
  for (const t of tests) {
    if (only && !t.name.startsWith(only + ' ')) continue;
    try { await t.fn(); console.log('PASS ', t.name); pass++; }
    catch (e) { console.log('FAIL ', t.name, '\n      ', e.stack.split('\n').slice(0, 8).join('\n      ')); fail++; }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
