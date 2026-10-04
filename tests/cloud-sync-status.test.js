// Runs the real cloud save queue from app.html (syncSessionToSupabase,
// flushPendingSync, updateSyncStatus and friends) against a controllable
// fake Supabase client. Checks that the Settings sync status tells the truth,
// that failed uploads stay queued and retry without duplicates, and that one
// account's rows are never uploaded with another account's session.
// Run with:  node tests/cloud-sync-status.test.js
const vm = require('vm');
const assert = require('assert');
const { extractFn, extractDecl, extractMultiDecl } = require('./helpers/extract-app-source');

const DECLS = [
  extractMultiDecl('store'), extractDecl('DATA_OWNER_GUEST'),
  extractDecl('_authGen'), extractDecl('_activeAuthUserId'), extractDecl('_enteredUserId'), extractDecl('_legalGate'),
  extractDecl('_passwordRecoveryPending'),
  extractDecl('SYNC_PENDING_KEY'), extractDecl('MAX_SYNC_ATTEMPTS'), extractDecl('_syncFlushInFlight'), extractDecl('_syncMemoryQueue'),
  'let _dataOwner = DATA_OWNER_GUEST;',
];
const FNS = ['safeParseArray', 'ownedKeyFor', 'isLoggedIn', 'isAuthGenCurrent', 'beginAuthContext', 'endAuthContext',
  'updateSyncStatus', 'refreshSyncStatus', 'retryPendingSync',
  'readPendingSync', 'writePendingSync', 'pendingSyncCount', 'syncSessionToSupabase', 'cloudRowBelongsToOwner', 'flushPendingSync'];
const source = DECLS.join('\n').replace(/^(const|let) /gm, 'var ') + '\n\n' + FNS.map(extractFn).join('\n\n');
new vm.Script(source);

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setImmediate(r));

function makeCtx() {
  const ls = new Map();
  const log = { inserts: [], lookups: [] };
  let sessionUser = null;
  // Each insert answers from this list in order; `{}` means success.
  const answers = [];
  const holds = [];
  // Rows "in the cloud" for the ownership lookup after a duplicate-key answer: key `${table}:${id}` -> user_id.
  const cloudRows = new Map();
  let lookupError = null;
  // Set to true to make the phone's storage refuse the queue write.
  const storage = { refusePending: false };
  const mkEl = (id) => ({ id, className: '', textContent: '', classList: { _s: new Set(), toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } } });
  const els = { 'sync-dot': mkEl('sync-dot'), 'sync-status-label': mkEl('sync-status-label'), 'sync-status-row': mkEl('sync-status-row') };
  const ctx = {
    console: { warn() {}, log() {}, error() {} },
    localStorage: {
      getItem: (k) => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => {
        if (storage.refusePending && k.endsWith(':ablty_sync_pending')) throw new DOMException('QuotaExceededError');
        ls.set(k, String(v));
      },
      removeItem: (k) => ls.delete(k),
      key: (i) => Array.from(ls.keys())[i], get length() { return ls.size; },
    },
    document: { getElementById: (id) => els[id] || null, visibilityState: 'visible', addEventListener() {} },
    window: { addEventListener() {} },
    setDataOwner: (owner) => { ctx._dataOwner = owner ? String(owner) : ctx.DATA_OWNER_GUEST; },
    cancelPendingPasswordRecovery() {},
    resolveLegalGate() {},
    sb: {
      auth: { getSession: () => Promise.resolve({ data: { session: sessionUser ? { user: { id: sessionUser } } : null } }) },
      from(table) {
        return {
          insert(row) {
            log.inserts.push({ table, row });
            const a = answers.length ? answers.shift() : {};
            if (a.hold) { const d = deferred(); holds.push(d); return d.promise; }
            if (a.throws) return Promise.reject(new TypeError('Failed to fetch'));
            return Promise.resolve({ error: a.error || null });
          },
          select(cols) {
            const q = { table, cols, filters: {} };
            const b = {
              eq(k, v) { q.filters[k] = v; return b; },
              maybeSingle() {
                log.lookups.push(q);
                if (lookupError) return Promise.resolve({ data: null, error: lookupError });
                const ownerOfRow = cloudRows.get(table + ':' + q.filters.id);
                const mine = ownerOfRow !== undefined && String(ownerOfRow) === String(q.filters.user_id);
                return Promise.resolve({ data: mine ? { id: q.filters.id } : null, error: null });
              },
            };
            return b;
          },
          // The queue must never touch an existing row.
          update() { throw new Error('update must not be called by the sync queue'); },
          upsert() { throw new Error('upsert must not be called by the sync queue'); },
          delete() { throw new Error('delete must not be called by the sync queue'); },
        };
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return {
    ctx, log, answers, holds, els, ls, cloudRows, storage,
    setLookupError(e) { lookupError = e; },
    signIn(uid) { sessionUser = uid; ls.set('ablty_logged_in', '1'); ctx.beginAuthContext(uid); },
    signOut() { sessionUser = null; ls.delete('ablty_logged_in'); ctx.endAuthContext(); },
    label: () => els['sync-status-label'].textContent,
    dot: () => els['sync-dot'].className,
    queue: (owner) => JSON.parse(ls.get('ablty_owned:' + owner + ':ablty_sync_pending') || '[]'),
  };
}

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log('PASS  ' + name); }

(async () => {
  await test('success: row uploaded under its owner and status says synced', async () => {
    const t = makeCtx();
    t.signIn('A');
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1, score: 50 });
    assert.strictEqual(t.log.inserts.length, 1);
    assert.strictEqual(t.log.inserts[0].row.user_id, 'A');
    assert.deepStrictEqual(t.queue('A'), []);
    assert.strictEqual(t.label(), 'Synced to cloud');
    assert.ok(t.dot().includes('sync-dot-synced'));
  });

  await test('database error: honest status, row kept in the queue', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.answers.push({ error: { code: '42501', message: 'permission denied' } });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1, score: 50 });
    assert.strictEqual(t.queue('A').length, 1);
    assert.strictEqual(t.queue('A')[0].attempts, 1);
    assert.strictEqual(t.label(), '1 result not saved to cloud yet. Tap to retry.');
    assert.ok(t.dot().includes('sync-dot-pending'));
    assert.ok(t.els['sync-status-row'].classList.contains('sync-retryable'));
  });

  await test('no internet: insert throws, status is pending, nothing lost', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.answers.push({ throws: true });
    await t.ctx.syncSessionToSupabase('zener_runs', { id: 2, hits: 7 });
    assert.strictEqual(t.queue('A').length, 1);
    assert.ok(t.label().includes('not saved to cloud yet'));
  });

  await test('retry: a later flush uploads the same row once and clears the status', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.answers.push({ throws: true });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1, score: 50 });
    await t.ctx.flushPendingSync('A');
    assert.strictEqual(t.log.inserts.length, 2, 'one retry');
    assert.strictEqual(t.log.inserts[1].row.id, 1, 'same row, not a copy');
    assert.deepStrictEqual(t.queue('A'), []);
    assert.strictEqual(t.label(), 'Synced to cloud');
  });

  await test('duplicate key on retry counts as saved (earlier attempt landed)', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.cloudRows.set('rv_sessions:1', 'A');
    t.answers.push({ throws: true }, { error: { code: '23505', message: 'duplicate key' } });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1, score: 50 });
    await t.ctx.flushPendingSync('A');
    assert.deepStrictEqual(t.queue('A'), []);
    assert.strictEqual(t.label(), 'Synced to cloud');
  });

  await test('a new session also retries older queued ones, two items counted', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.answers.push({ throws: true });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1 });
    t.answers.push({ throws: true }, { throws: true });
    await t.ctx.syncSessionToSupabase('zener_runs', { id: 2 });
    assert.strictEqual(t.queue('A').length, 2);
    assert.strictEqual(t.label(), '2 results not saved to cloud yet. Tap to retry.');
    await t.ctx.flushPendingSync('A');
    assert.deepStrictEqual(t.queue('A'), []);
    assert.strictEqual(t.label(), 'Synced to cloud');
  });

  await test('attempt limit: automatic retries stop, tapping the row retries again', async () => {
    const t = makeCtx();
    t.signIn('A');
    for (let i = 0; i < t.ctx.MAX_SYNC_ATTEMPTS; i++) t.answers.push({ throws: true });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1 });
    for (let i = 1; i < t.ctx.MAX_SYNC_ATTEMPTS; i++) await t.ctx.flushPendingSync('A');
    assert.strictEqual(t.log.inserts.length, t.ctx.MAX_SYNC_ATTEMPTS);
    await t.ctx.flushPendingSync('A');
    assert.strictEqual(t.log.inserts.length, t.ctx.MAX_SYNC_ATTEMPTS, 'no automatic attempt past the limit');
    assert.ok(t.label().includes('Tap to retry'));
    t.ctx.retryPendingSync();
    await tick(); await tick(); await tick();
    assert.strictEqual(t.log.inserts.length, t.ctx.MAX_SYNC_ATTEMPTS + 1, 'manual retry attempted');
    assert.deepStrictEqual(t.queue('A'), []);
    assert.strictEqual(t.label(), 'Synced to cloud');
  });

  await test('switching accounts while a save is pending: nothing crosses over', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.answers.push({ throws: true });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1 });
    assert.strictEqual(t.queue('A').length, 1);

    t.signOut(); t.signIn('B');
    t.ctx.refreshSyncStatus();
    assert.strictEqual(t.label(), 'Synced to cloud', 'B is not shown A\'s pending state');
    await t.ctx.flushPendingSync('A');
    assert.strictEqual(t.log.inserts.length, 1, 'A\'s row is not uploaded with B\'s session');
    assert.strictEqual(t.queue('A').length, 1, 'A\'s row still waits for A');

    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 9 });
    assert.strictEqual(t.log.inserts[1].row.user_id, 'B');
    assert.strictEqual(t.log.inserts[1].row.id, 9);
    assert.deepStrictEqual(t.queue('B'), []);

    t.signOut(); t.signIn('A');
    await t.ctx.flushPendingSync('A');
    assert.strictEqual(t.log.inserts[2].row.user_id, 'A');
    assert.strictEqual(t.log.inserts[2].row.id, 1);
    assert.deepStrictEqual(t.queue('A'), []);
    assert.strictEqual(t.label(), 'Synced to cloud');
  });

  await test('account changes while an upload is in flight: the rest waits, B\'s status untouched', async () => {
    const t = makeCtx();
    t.signIn('A');
    // First save: one failed attempt. Second save: retries the first (fails) and tries the second (fails).
    t.answers.push({ throws: true }, { throws: true }, { throws: true });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1 });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 2 });
    assert.strictEqual(t.queue('A').length, 2);
    t.answers.push({ hold: true });
    const p = t.ctx.flushPendingSync('A');
    await tick();
    assert.strictEqual(t.log.inserts.length, 4, 'first retry in flight');
    t.signOut(); t.signIn('B');
    t.ctx.updateSyncStatus('synced');
    t.holds[0].resolve({ error: null });
    await p;
    assert.strictEqual(t.log.inserts.length, 4, 'second row not sent with B\'s token');
    assert.strictEqual(t.queue('A').length, 1, 'the confirmed row left the queue, the other waits');
    assert.strictEqual(t.label(), 'Synced to cloud', 'B\'s status not changed by A\'s flush');
  });

  await test('queue write refused by storage: upload still attempted, synced only after the database confirmed', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.storage.refusePending = true;
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1, score: 50 });
    assert.strictEqual(t.log.inserts.length, 1, 'uploaded directly even though the queue could not be stored');
    assert.strictEqual(t.log.inserts[0].row.user_id, 'A');
    assert.strictEqual(t.label(), 'Synced to cloud');
    assert.strictEqual(t.ctx.pendingSyncCount('A'), 0);
    assert.strictEqual(t.ls.has('ablty_owned:A:ablty_sync_pending'), false);
  });

  await test('queue write refused AND upload fails: clear not-saved state, retried later', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.storage.refusePending = true;
    t.answers.push({ throws: true });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1, score: 50 });
    assert.strictEqual(t.log.inserts.length, 1);
    assert.strictEqual(t.label(), '1 result not saved to cloud yet. Tap to retry.', 'no false success');
    assert.ok(t.dot().includes('sync-dot-pending'));
    assert.strictEqual(t.ctx.pendingSyncCount('A'), 1, 'held in memory');
    // Storage recovers and the retry lands.
    t.storage.refusePending = false;
    await t.ctx.flushPendingSync('A');
    assert.strictEqual(t.log.inserts.length, 2);
    assert.strictEqual(t.label(), 'Synced to cloud');
    assert.strictEqual(t.ctx.pendingSyncCount('A'), 0);
  });

  await test('duplicate key, row belongs to this owner: treated as saved (earlier upload landed, answer was lost)', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.answers.push({ throws: true });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1, score: 50 });
    // The first attempt actually reached the database even though the answer was lost.
    t.cloudRows.set('rv_sessions:1', 'A');
    t.answers.push({ error: { code: '23505', message: 'duplicate key' } });
    await t.ctx.flushPendingSync('A');
    assert.strictEqual(t.log.lookups.length, 1, 'ownership looked up');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(t.log.lookups[0].filters)), { id: 1, user_id: 'A' });
    assert.deepStrictEqual(t.queue('A'), []);
    assert.strictEqual(t.label(), 'Synced to cloud');
  });

  await test('duplicate key, row belongs to someone else: stays queued as unresolved, other row untouched', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.cloudRows.set('rv_sessions:1', 'B');
    t.answers.push({ error: { code: '23505', message: 'duplicate key' } });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1, score: 50 });
    assert.strictEqual(t.log.lookups.length, 1);
    const q = t.queue('A');
    assert.strictEqual(q.length, 1, 'still queued');
    assert.strictEqual(q[0].unresolved, 'id_collision');
    assert.strictEqual(q[0].lastError, 'id_collision');
    assert.strictEqual(t.label(), '1 result not saved to cloud yet. Tap to retry.');
    // Neither automatic flushes nor a manual retry try again or touch B's row.
    await t.ctx.flushPendingSync('A');
    t.ctx.retryPendingSync();
    await tick(); await tick(); await tick();
    assert.strictEqual(t.log.inserts.length, 1, 'no further insert attempts');
    assert.strictEqual(t.queue('A').length, 1);
    assert.strictEqual(t.cloudRows.get('rv_sessions:1'), 'B');
  });

  await test('duplicate key but the ownership check itself fails: kept queued and retried, not deleted', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.setLookupError({ code: 'PGRST000', message: 'offline' });
    t.answers.push({ error: { code: '23505', message: 'duplicate key' } });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1, score: 50 });
    assert.strictEqual(t.queue('A').length, 1);
    assert.strictEqual(t.queue('A')[0].attempts, 1);
    assert.strictEqual(t.queue('A')[0].unresolved, undefined);
    t.setLookupError(null);
    t.cloudRows.set('rv_sessions:1', 'A');
    t.answers.push({ error: { code: '23505', message: 'duplicate key' } });
    await t.ctx.flushPendingSync('A');
    assert.deepStrictEqual(t.queue('A'), []);
    assert.strictEqual(t.label(), 'Synced to cloud');
  });

  await test('guest sessions are never queued or uploaded', async () => {
    const t = makeCtx();
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1 });
    assert.strictEqual(t.log.inserts.length, 0);
    assert.strictEqual(t.ls.size, 0);
  });

  console.log(`\n${passed} passed, 0 failed`);
})().catch((e) => { console.error(e); process.exit(1); });
