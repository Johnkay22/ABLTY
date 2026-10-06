// Runs the real cloud save queue from app.html (syncSessionToSupabase,
// flushPendingSync, verifyRecentCloudCopies, updateSyncStatus and friends)
// against a controllable fake Supabase client and a storage that can be
// made to refuse writes. Checks that the Settings sync status tells the
// truth, that failed uploads stay queued and retry without duplicates, that
// a pending upload lost to a reload is recovered from local history, that a
// result the phone could not keep is called out as such, that a duplicate
// key is only "saved" when the existing row is this account's with the same
// contents, and that one account's rows are never uploaded with another
// account's session.
// Run with:  node tests/cloud-sync-status.test.js
const vm = require('vm');
const assert = require('assert');
const { extractFn, extractDecl, extractMultiDecl } = require('./helpers/extract-app-source');

const DECLS = [
  extractMultiDecl('store'), extractDecl('DATA_OWNER_GUEST'),
  extractDecl('_authGen'), extractDecl('_activeAuthUserId'), extractDecl('_enteredUserId'), extractDecl('_legalGate'),
  extractDecl('_passwordRecoveryPending'),
  extractDecl('MAX_RV_LOCAL_SESSIONS'), extractDecl('RV_SKETCH_KEEP_RECENT'), extractDecl('MAX_ZENER_LOCAL_RUNS'),
  extractDecl('SYNC_PENDING_KEY'), extractDecl('SYNC_CONFIRMED_KEY'), extractDecl('MAX_SYNC_ATTEMPTS'),
  extractDecl('SYNC_VERIFY_RECENT'), extractDecl('SYNC_CONFIRMED_KEEP'),
  extractDecl('_syncFlushInFlight'), extractDecl('_syncMemoryQueue'), extractDecl('_syncConfirmedMemory'),
  extractDecl('_syncVerifyInFlight'), extractDecl('_syncVerifyFailed'), extractDecl('_historyWarnAt'),
  extractDecl('APP_VERSION'), extractDecl('OWNED_DATA_MIGRATED_KEY'), extractDecl('LEGACY_DATA_CLAIMANT_KEY'),
  'let _dataOwner = DATA_OWNER_GUEST;',
  'let STATE = { sessions: [], settings: {} };',
];
const FNS = ['safeParseArray', 'ownedKeyFor', 'ownedKey', 'isLoggedIn', 'isAuthGenCurrent', 'beginAuthContext', 'endAuthContext',
  'getTSTrialHit', 'mapRVSessionRow', 'mapZenerRunRow', 'mapTSTrialRow',
  'persistHistory', 'warnHistoryNotSaved', 'saveState', 'loadState', 'loadZenerSessions', 'saveZenerSession',
  'describePendingSync', 'updateSyncStatus', 'refreshSyncStatus', 'retryPendingSync',
  'readPendingSync', 'writePendingSync', 'pendingSyncCount', 'syncSessionToSupabase',
  'readConfirmedSync', 'markConfirmedSync', 'recentLocalHistoryRows', 'unverifiedLocalRows', 'verifyRecentCloudCopies',
  'sameCloudValue', 'cloudRowMatchesSubmission', 'flushPendingSync',
  'listStorageKeys', 'buildSyncDiagnostics', 'ownersWithLocalData', 'openSyncDetails', 'closeSyncDetails', 'copySyncDiagnostics'];
const source = DECLS.join('\n').replace(/^(const|let) /gm, 'var ') + '\n\n' + FNS.map(extractFn).join('\n\n');
new vm.Script(source);

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setImmediate(r));

// `opts.ls` / `opts.cloudRows` let a second context share the same phone
// storage and the same cloud, which is what a reload looks like.
function makeCtx(opts = {}) {
  const ls = opts.ls || new Map();
  const log = { inserts: [], lookups: [], existence: [], toasts: [] };
  let sessionUser = null;
  // Each insert answers from this list in order; `{}` means success.
  const answers = [];
  const holds = [];
  // Rows "in the cloud": key `${table}:${id}` -> { user_id, row }.
  const cloudRows = opts.cloudRows || new Map();
  let lookupError = null;
  let existenceError = null;
  // Which storage keys the phone refuses to write (full, private mode).
  const storage = { refuse: () => false };
  const mkEl = (id) => ({ id, className: '', textContent: '', style: { display: '' }, classList: { _s: new Set(), toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } } });
  const els = { 'sync-dot': mkEl('sync-dot'), 'sync-status-label': mkEl('sync-status-label'), 'sync-status-row': mkEl('sync-status-row'),
    'sync-details-modal': mkEl('sync-details-modal'), 'sync-details-summary': mkEl('sync-details-summary'), 'sync-details-report': mkEl('sync-details-report') };
  const clipboard = { written: [], fail: false };
  const ctx = {
    console: { warn() {}, log() {}, error() {} },
    localStorage: {
      getItem: (k) => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => {
        if (storage.refuse(k)) throw new DOMException('QuotaExceededError');
        ls.set(k, String(v));
      },
      removeItem: (k) => ls.delete(k),
      key: (i) => Array.from(ls.keys())[i], get length() { return ls.size; },
    },
    document: { getElementById: (id) => els[id] || null, visibilityState: 'visible', addEventListener() {} },
    window: { addEventListener() {} },
    navigator: { onLine: true, clipboard: { writeText: (t) => (clipboard.fail ? Promise.reject(new Error('denied')) : (clipboard.written.push(t), Promise.resolve())) } },
    setDataOwner: (owner) => { ctx._dataOwner = owner ? String(owner) : ctx.DATA_OWNER_GUEST; },
    cancelPendingPasswordRecovery() {},
    resolveLegalGate() {},
    showToast(msg, type) { log.toasts.push({ msg, type }); },
    sb: {
      auth: { getSession: () => Promise.resolve({ data: { session: sessionUser ? { user: { id: sessionUser } } : null } }) },
      from(table) {
        return {
          insert(row) {
            log.inserts.push({ table, row });
            const a = answers.length ? answers.shift() : {};
            if (a.hold) { const d = deferred(); holds.push(d); return d.promise; }
            if (a.throws) return Promise.reject(new TypeError('Failed to fetch'));
            if (!a.error) cloudRows.set(table + ':' + row.id, { user_id: row.user_id, row: { ...row } });
            return Promise.resolve({ error: a.error || null });
          },
          select(cols) {
            const q = { table, cols, filters: {} };
            const b = {
              eq(k, v) { q.filters[k] = v; return b; },
              // Read-back of one row by id and owner (duplicate-key check).
              maybeSingle() {
                log.lookups.push(q);
                if (lookupError) return Promise.resolve({ data: null, error: lookupError });
                const hit = cloudRows.get(table + ':' + q.filters.id);
                const mine = hit && String(hit.user_id) === String(q.filters.user_id);
                return Promise.resolve({ data: mine ? { user_id: hit.user_id, ...hit.row } : null, error: null });
              },
              // "Which of these ids does this owner have?" (recent-history check).
              in(k, ids) {
                q.in = { k, ids: ids.slice() };
                log.existence.push(q);
                if (existenceError) return Promise.resolve({ data: null, error: existenceError });
                const data = ids
                  .filter((id) => { const hit = cloudRows.get(table + ':' + id); return hit && String(hit.user_id) === String(q.filters.user_id); })
                  .map((id) => ({ id }));
                return Promise.resolve({ data, error: null });
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
    ctx, log, answers, holds, els, ls, cloudRows, storage, clipboard,
    setLookupError(e) { lookupError = e; },
    setExistenceError(e) { existenceError = e; },
    signIn(uid) { sessionUser = uid; ls.set('ablty_logged_in', '1'); ctx.beginAuthContext(uid); },
    signOut() { sessionUser = null; ls.delete('ablty_logged_in'); ctx.endAuthContext(); },
    label: () => els['sync-status-label'].textContent,
    dot: () => els['sync-dot'].className,
    retryable: () => els['sync-status-row'].classList.contains('sync-retryable'),
    queue: (owner) => JSON.parse(ls.get('ablty_owned:' + owner + ':ablty_sync_pending') || '[]'),
    confirmed: (owner) => JSON.parse(ls.get('ablty_owned:' + owner + ':ablty_sync_confirmed') || '[]'),
    // Puts a row in the cloud as `owner`'s, as an earlier upload would have.
    cloud(table, id, owner, row) { cloudRows.set(table + ':' + id, { user_id: owner, row: { ...row, id, user_id: owner } }); },
    // Lets the background verification and any flush it started finish.
    async settle() {
      for (let i = 0; i < 4; i++) {
        const v = ctx._syncVerifyInFlight.get(ctx._dataOwner);
        if (v) await v;
        const f = ctx._syncFlushInFlight.get(ctx._dataOwner);
        if (f) await f;
        await tick();
      }
    },
  };
}

// A phone reload: same storage and cloud, fresh script state (memory
// queue, confirmed-id cache and in-flight maps all gone).
function reload(t, uid) {
  const r = makeCtx({ ls: t.ls, cloudRows: t.cloudRows });
  r.signIn(uid);
  r.ctx.loadState();
  return r;
}

// The RV session shape submitSession() stores, as saveState() would.
function rvSession(id, extra = {}) {
  return { id, trn: '1234-5678', targetId: 'target-7', targetSrc: 'targets/7.jpg', targetLabel: 'Lighthouse', category: 'structure',
    score: 61, dimension_scores: { form: 3, color: 2 }, hits: ['tall'], noise: [], aol: [], summary: 'ok', score_reasoning: '',
    grading_failed: false, grading_error: null, notes: 'tall, white', duration: 120, timestamp: '2026-10-04T10:00:00.000Z', sketchData: 'data:image/png;base64,AAA=', ...extra };
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
    assert.deepStrictEqual(t.confirmed('A'), ['rv_sessions:1'], 'the confirmed id is remembered durably');
  });

  await test('database error: honest status, row kept in the queue', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.answers.push({ error: { code: '42501', message: 'permission denied' } });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1, score: 50 });
    assert.strictEqual(t.queue('A').length, 1);
    assert.strictEqual(t.queue('A')[0].attempts, 1);
    assert.strictEqual(t.label(), '1 result saved on this phone, not backed up to the cloud yet. Tap to retry.');
    assert.ok(t.dot().includes('sync-dot-pending'));
    assert.ok(t.retryable());
  });

  await test('no internet: insert throws, status is pending, nothing lost', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.answers.push({ throws: true });
    await t.ctx.syncSessionToSupabase('zener_runs', { id: 2, hits: 7 });
    assert.strictEqual(t.queue('A').length, 1);
    assert.ok(t.label().includes('not backed up to the cloud yet'));
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

  await test('a new session also retries older queued ones, two items counted', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.answers.push({ throws: true });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1 });
    t.answers.push({ throws: true }, { throws: true });
    await t.ctx.syncSessionToSupabase('zener_runs', { id: 2 });
    assert.strictEqual(t.queue('A').length, 2);
    assert.strictEqual(t.label(), '2 results saved on this phone, not backed up to the cloud yet. Tap to retry.');
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
    assert.ok(t.retryable());
    t.ctx.retryPendingSync();
    await t.settle();
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

  // ── Storage failures ──

  await test('queue write refused by storage: upload still attempted, synced only after the database confirmed', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.storage.refuse = (k) => k.endsWith(':ablty_sync_pending');
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
    t.storage.refuse = (k) => k.endsWith(':ablty_sync_pending');
    t.answers.push({ throws: true });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1, score: 50 });
    assert.strictEqual(t.log.inserts.length, 1);
    assert.strictEqual(t.label(), '1 result saved on this phone, not backed up to the cloud yet. Tap to retry.', 'no false success');
    assert.ok(t.dot().includes('sync-dot-pending'));
    assert.strictEqual(t.ctx.pendingSyncCount('A'), 1, 'held in memory');
    // Storage recovers and the retry lands.
    t.storage.refuse = () => false;
    await t.ctx.flushPendingSync('A');
    assert.strictEqual(t.log.inserts.length, 2);
    assert.strictEqual(t.label(), 'Synced to cloud');
    assert.strictEqual(t.ctx.pendingSyncCount('A'), 0);
  });

  await test('reload after queue write and upload both failed: the result is recovered from local history and uploaded', async () => {
    const t = makeCtx();
    t.signIn('A');
    // History is kept, only the queue key is refused (the history write used the last of the space).
    t.storage.refuse = (k) => k.endsWith(':ablty_sync_pending') || k.endsWith(':ablty_sync_confirmed');
    t.answers.push({ throws: true });
    t.ctx.STATE.sessions.unshift(rvSession(1001));
    assert.strictEqual(t.ctx.saveState(), true, 'history preserved');
    await t.ctx.syncSessionToSupabase('rv_sessions', t.ctx.mapRVSessionRow(t.ctx.STATE.sessions[0]), { localSaved: true });
    assert.ok(t.label().includes('not backed up to the cloud yet'));
    assert.strictEqual(t.ls.has('ablty_owned:A:ablty_sync_pending'), false, 'the queue never reached storage');

    // The phone reloads: the memory queue is gone, the history is not.
    const r = reload(t, 'A');
    r.ctx.refreshSyncStatus();
    assert.notStrictEqual(r.label(), 'Synced to cloud', 'an empty queue is not read as success');
    assert.ok(r.label().startsWith('Checking'), r.label());
    await r.settle();
    assert.strictEqual(r.log.existence.length, 1, 'recent history checked against the cloud once');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r.log.existence[0].in.ids)), [1001]);
    assert.strictEqual(r.log.inserts.length, 1, 'the missing result was uploaded');
    assert.strictEqual(r.log.inserts[0].row.id, 1001);
    assert.strictEqual(r.log.inserts[0].row.user_id, 'A');
    assert.strictEqual(r.log.inserts[0].row.notes, 'tall, white', 'rebuilt from the stored session');
    assert.strictEqual(r.label(), 'Synced to cloud');
    assert.deepStrictEqual(r.queue('A'), []);
    assert.ok(r.confirmed('A').includes('rv_sessions:1001'));
    // Another reload asks nothing more: the id is remembered as confirmed.
    const r2 = reload(t, 'A');
    r2.ctx.refreshSyncStatus();
    assert.strictEqual(r2.label(), 'Synced to cloud');
    assert.strictEqual(r2.log.existence.length, 0);
  });

  await test('reload while still offline: status is unverified, never "synced"; tapping checks again', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.storage.refuse = (k) => k.endsWith(':ablty_sync_pending');
    t.answers.push({ throws: true });
    t.ctx.STATE.sessions.unshift(rvSession(1002));
    t.ctx.saveState();
    await t.ctx.syncSessionToSupabase('rv_sessions', t.ctx.mapRVSessionRow(t.ctx.STATE.sessions[0]));

    const r = reload(t, 'A');
    r.setExistenceError({ code: 'PGRST000', message: 'offline' });
    r.ctx.refreshSyncStatus();
    await r.settle();
    assert.strictEqual(r.log.inserts.length, 0);
    assert.strictEqual(r.label(), 'Could not confirm that your latest results reached the cloud. Tap to check again.');
    assert.ok(r.dot().includes('sync-dot-pending'));
    assert.ok(r.retryable());
    // Opening Settings again does not say synced either.
    r.ctx.refreshSyncStatus();
    assert.ok(r.label().startsWith('Could not confirm'));
    // Back online: the tap re-checks, finds the row missing, uploads it.
    r.setExistenceError(null);
    r.ctx.retryPendingSync();
    await r.settle();
    assert.strictEqual(r.log.inserts.length, 1);
    assert.strictEqual(r.log.inserts[0].row.id, 1002);
    assert.strictEqual(r.label(), 'Synced to cloud');
  });

  await test('recent history that the cloud already holds is confirmed without any upload', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.ctx.STATE.sessions.unshift(rvSession(1003));
    t.ctx.saveState();
    t.cloud('rv_sessions', 1003, 'A', t.ctx.mapRVSessionRow(t.ctx.STATE.sessions[0]));
    const r = reload(t, 'A');
    r.ctx.refreshSyncStatus();
    await r.settle();
    assert.strictEqual(r.log.inserts.length, 0);
    assert.strictEqual(r.label(), 'Synced to cloud');
    assert.deepStrictEqual(r.confirmed('A'), ['rv_sessions:1003']);
  });

  await test('history AND queue persistence both fail: the user is warned the result is only held temporarily', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.storage.refuse = (k) => k.includes(':ablty_zener') || k.endsWith(':ablty_sync_pending');
    t.answers.push({ throws: true });
    t.ctx.saveZenerSession({ id: 2001, hits: 9, hitPct: 36, symbolStats: {}, timestamp: '2026-10-04T10:00:00.000Z' });
    await t.settle();
    assert.strictEqual(t.log.toasts.length, 1, 'warned once');
    assert.ok(t.log.toasts[0].msg.startsWith('Could not save this result on your phone'), t.log.toasts[0].msg);
    assert.ok(t.log.toasts[0].msg.includes('held only until the app closes'), t.log.toasts[0].msg);
    assert.strictEqual(t.ctx.pendingSyncCount('A'), 1, 'still held in memory for retry');
    assert.strictEqual(t.ctx.readPendingSync('A')[0].localSaved, false);
    assert.strictEqual(t.label(), '1 result not saved on this phone or in the cloud. It is held only until the app closes. Tap to retry the cloud save.');
    assert.ok(t.dot().includes('sync-dot-pending'));
    assert.ok(t.retryable());
    assert.strictEqual(t.ls.has('ablty_owned:A:ablty_zener'), false, 'nothing pretended to be on the phone');
    // The cloud save goes through later: the result is safe there and the status says so.
    await t.ctx.flushPendingSync('A');
    assert.strictEqual(t.log.inserts.length, 2);
    assert.strictEqual(t.label(), 'Synced to cloud');
  });

  await test('history write fails but the cloud save succeeds: warned about the phone, cloud status truthful', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.storage.refuse = (k) => k.includes(':ablty_zener');
    t.ctx.saveZenerSession({ id: 2002, hits: 5, hitPct: 20, symbolStats: {}, timestamp: '2026-10-04T10:00:00.000Z' });
    await t.settle();
    assert.strictEqual(t.log.toasts.length, 1);
    assert.ok(t.log.toasts[0].msg.includes('unless the cloud save succeeds'));
    assert.strictEqual(t.log.inserts.length, 1);
    assert.strictEqual(t.label(), 'Synced to cloud');
  });

  await test('guest whose phone refuses the history write is told it will be lost when the app closes', async () => {
    const t = makeCtx();
    t.storage.refuse = (k) => k.includes(':ablty_zener');
    t.ctx.saveZenerSession({ id: 2003, hits: 5, hitPct: 20, symbolStats: {}, timestamp: '2026-10-04T10:00:00.000Z' });
    assert.strictEqual(t.log.toasts.length, 1);
    assert.ok(t.log.toasts[0].msg.includes('will be lost when the app closes'), t.log.toasts[0].msg);
    assert.strictEqual(t.log.inserts.length, 0, 'guests never upload');
  });

  await test('history write warning is rate limited: a run of Presentiment taps does not stack toasts', async () => {
    const t = makeCtx();
    t.storage.refuse = (k) => k.includes(':ablty_zener');
    for (let i = 0; i < 5; i++) t.ctx.saveZenerSession({ id: 2100 + i, hits: 5, hitPct: 20, symbolStats: {} });
    assert.strictEqual(t.log.toasts.length, 1);
  });

  await test('saveState reports whether the history write was kept', async () => {
    const t = makeCtx();
    t.ctx.STATE.sessions.unshift(rvSession(3001));
    assert.strictEqual(t.ctx.saveState(), true);
    t.storage.refuse = (k) => k.includes(':ablty_sessions');
    assert.strictEqual(t.ctx.saveState(), false);
    assert.strictEqual(t.log.toasts.length, 0, 'saveState itself does not toast; the result-saving callers do');
  });

  // ── Duplicate keys ──

  await test('duplicate key on retry, same owner, same contents: counts as saved (earlier attempt landed, answer was lost)', async () => {
    const t = makeCtx();
    t.signIn('A');
    const row = t.ctx.mapRVSessionRow(rvSession(4001));
    t.answers.push({ throws: true });
    await t.ctx.syncSessionToSupabase('rv_sessions', row);
    // The first attempt actually reached the database. Postgres hands the
    // row back in its own spelling: numeric as string, timestamp with an
    // offset, JSON keys in another order.
    t.cloud('rv_sessions', 4001, 'A', { ...row, score: '61', duration: '120', timestamp: '2026-10-04T10:00:00+00:00', dimension_scores: { color: 2, form: 3 } });
    t.answers.push({ error: { code: '23505', message: 'duplicate key' } });
    await t.ctx.flushPendingSync('A');
    assert.strictEqual(t.log.lookups.length, 1, 'existing row read back');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(t.log.lookups[0].filters)), { id: 4001, user_id: 'A' });
    assert.ok(t.log.lookups[0].cols.includes('notes') && t.log.lookups[0].cols.includes('score'), 'the saved fields are requested');
    assert.deepStrictEqual(t.queue('A'), []);
    assert.strictEqual(t.label(), 'Synced to cloud');
    assert.ok(t.confirmed('A').includes('rv_sessions:4001'));
  });

  await test('decimal RV score: the row is sent as the integer Postgres stores, so a retry read-back is a match, not a false mismatch', async () => {
    const t = makeCtx();
    t.signIn('A');
    // The grader may answer with a decimal; the phone keeps it as is.
    const local = rvSession(4005, { score: 61.5 });
    const row = t.ctx.mapRVSessionRow(local);
    assert.strictEqual(row.score, 62, 'rounded half up like the integer column');
    assert.strictEqual(local.score, 61.5, 'the local session is not changed');
    assert.strictEqual(t.ctx.mapRVSessionRow(rvSession(1, { score: 61.4 })).score, 61);
    assert.strictEqual(t.ctx.mapRVSessionRow(rvSession(1, { score: null })).score, null, 'a failed grading still has no score');
    // First attempt reached the database (which stored the integer) but the answer was lost.
    t.answers.push({ throws: true });
    await t.ctx.syncSessionToSupabase('rv_sessions', row);
    t.cloud('rv_sessions', 4005, 'A', { ...row, score: 62 });
    t.answers.push({ error: { code: '23505', message: 'duplicate key' } });
    await t.ctx.flushPendingSync('A');
    assert.deepStrictEqual(t.queue('A'), [], 'not parked as content_mismatch');
    assert.strictEqual(t.label(), 'Synced to cloud');
    assert.ok(t.confirmed('A').includes('rv_sessions:4005'));
  });

  await test('duplicate key, same owner, DIFFERENT contents: stays unresolved, existing row untouched, no retry offered', async () => {
    const t = makeCtx();
    t.signIn('A');
    const mine = t.ctx.mapRVSessionRow(rvSession(4002, { notes: 'second session, same millisecond', score: 12 }));
    const existing = t.ctx.mapRVSessionRow(rvSession(4002));
    t.cloud('rv_sessions', 4002, 'A', existing);
    t.answers.push({ error: { code: '23505', message: 'duplicate key' } });
    await t.ctx.syncSessionToSupabase('rv_sessions', mine);
    const q = t.queue('A');
    assert.strictEqual(q.length, 1, 'still queued');
    assert.strictEqual(q[0].unresolved, 'content_mismatch');
    assert.strictEqual(q[0].lastError, 'content_mismatch');
    assert.strictEqual(t.cloudRows.get('rv_sessions:4002').row.notes, 'tall, white', 'the existing result was not overwritten');
    assert.strictEqual(t.label(), '1 result saved on this phone but not backed up: this account\'s cloud backup already holds a different result with the same ID. It is safe on this phone. Open Details to copy a report for support.');
    assert.ok(!t.label().includes('Tap to retry'));
    assert.ok(!t.label().includes('content_mismatch'), 'the code stays in the report, not on the row');
    assert.ok(!t.retryable(), 'the row is not offered as tappable');
    assert.ok(!t.confirmed('A').includes('rv_sessions:4002'));
    await t.ctx.flushPendingSync('A');
    t.ctx.retryPendingSync();
    await t.settle();
    assert.strictEqual(t.log.inserts.length, 1, 'no further insert attempts');
    assert.strictEqual(t.cloudRows.get('rv_sessions:4002').row.notes, 'tall, white');
  });

  await test('duplicate key, row belongs to someone else: stays queued as unresolved, other row untouched, no retry offered', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.cloud('rv_sessions', 1, 'B', { score: 50 });
    t.answers.push({ error: { code: '23505', message: 'duplicate key' } });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1, score: 50 });
    assert.strictEqual(t.log.lookups.length, 1);
    const q = t.queue('A');
    assert.strictEqual(q.length, 1, 'still queued');
    assert.strictEqual(q[0].unresolved, 'id_collision');
    assert.strictEqual(q[0].lastError, 'id_collision');
    assert.strictEqual(t.label(), '1 result saved on this phone but not backed up: another account\'s cloud backup already holds a result with the same ID. It is safe on this phone. Open Details to copy a report for support.');
    assert.ok(!t.label().includes('Tap to retry'));
    assert.ok(!t.label().includes('id_collision'), 'the code stays in the report, not on the row');
    assert.ok(!t.retryable());
    // Neither automatic flushes nor a manual retry try again or touch B's row.
    await t.ctx.flushPendingSync('A');
    t.ctx.retryPendingSync();
    await t.settle();
    assert.strictEqual(t.log.inserts.length, 1, 'no further insert attempts');
    assert.strictEqual(t.queue('A').length, 1);
    assert.strictEqual(t.cloudRows.get('rv_sessions:1').user_id, 'B');
  });

  await test('one unresolved and one retryable item: the row says both, and only the retryable one is retried', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.cloud('rv_sessions', 1, 'B', { score: 50 });
    t.answers.push({ error: { code: '23505', message: 'duplicate key' } });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1, score: 50 });
    t.answers.push({ throws: true });
    await t.ctx.syncSessionToSupabase('zener_runs', { id: 2, hits: 7 });
    assert.strictEqual(t.label(), '1 result saved on this phone, not backed up to the cloud yet. Tap to retry. 1 result saved on this phone but not backed up: another account\'s cloud backup already holds a result with the same ID. It is safe on this phone. Open Details to copy a report for support.');
    assert.ok(t.retryable());
    t.ctx.retryPendingSync();
    await t.settle();
    assert.strictEqual(t.log.inserts.length, 3, 'only the Zener run was retried');
    assert.strictEqual(t.log.inserts[2].table, 'zener_runs');
    assert.strictEqual(t.queue('A').length, 1);
    assert.strictEqual(t.queue('A')[0].unresolved, 'id_collision');
  });

  await test('duplicate key but the read-back itself fails: kept queued and retried, not deleted', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.setLookupError({ code: 'PGRST000', message: 'offline' });
    t.answers.push({ error: { code: '23505', message: 'duplicate key' } });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1, score: 50 });
    assert.strictEqual(t.queue('A').length, 1);
    assert.strictEqual(t.queue('A')[0].attempts, 1);
    assert.strictEqual(t.queue('A')[0].unresolved, undefined);
    t.setLookupError(null);
    t.cloud('rv_sessions', 1, 'A', { score: 50 });
    t.answers.push({ error: { code: '23505', message: 'duplicate key' } });
    await t.ctx.flushPendingSync('A');
    assert.deepStrictEqual(t.queue('A'), []);
    assert.strictEqual(t.label(), 'Synced to cloud');
  });

  // ── Sync details report ──

  await test('sync report: lists each waiting result by table, id, time and status code, with no session contents', async () => {
    const t = makeCtx();
    t.signIn('A');
    // One result another account's backup already holds, one plain retry.
    const session = rvSession(5001, { notes: 'very private impression', summary: 'secret summary' });
    t.cloud('rv_sessions', 5001, 'B', { score: 50 });
    t.answers.push({ error: { code: '23505', message: 'duplicate key' } });
    await t.ctx.syncSessionToSupabase('rv_sessions', t.ctx.mapRVSessionRow(session));
    t.answers.push({ throws: true });
    await t.ctx.syncSessionToSupabase('zener_runs', { id: 5002, hits: 7, timestamp: '2026-10-05T09:00:00.000Z' });
    const report = t.ctx.buildSyncDiagnostics('A');
    assert.ok(report.includes('App version: ' + t.ctx.APP_VERSION), report);
    assert.ok(report.includes('Waiting for cloud backup: 2'), report);
    assert.ok(/rv_sessions id=5001 result_time=2026-10-04T10:00:00\.000Z/.test(report), report);
    assert.ok(/status=id_collision last_error=id_collision/.test(report), 'the technical code is in the report');
    assert.ok(/zener_runs id=5002 .*\n.*attempts=1 status=will retry last_error=Failed to fetch/.test(report), report);
    assert.ok(!report.includes('very private impression') && !report.includes('secret summary'), 'no notes or summary');
    assert.ok(!report.includes('base64') && !report.includes('tall, white'), 'no sketch or notes');
    assert.ok(!report.includes('score=') && !report.includes('hits='), 'no scores');
    assert.ok(report.includes('Account: A'), 'short account id');
    assert.ok(report.includes('other accounts with data on this phone=0'), report);
    assert.ok(report.includes('legacy data sort done=no'), report);
  });

  await test('sync report: a long account id is truncated and other accounts on the phone are counted, not listed in full', async () => {
    const t = makeCtx();
    const me = 'aaaaaaaa-1111-2222-3333-444444444444';
    const other = 'bbbbbbbb-5555-6666-7777-888888888888';
    t.signIn(me);
    t.ls.set('ablty_owned:' + me + ':ablty_zener', '[]');
    t.ls.set('ablty_owned:' + other + ':ablty_zener', '[]');
    t.ls.set('ablty_owned:guest:ablty_zener', '[]');
    t.ls.set('ablty_owned_data_v1', '1');
    const report = t.ctx.buildSyncDiagnostics(me);
    assert.ok(report.includes('Account: aaaaaaaa...'), report);
    assert.ok(!report.includes(me), 'full own id absent');
    assert.ok(!report.includes(other), 'full other id absent');
    assert.ok(report.includes('other accounts with data on this phone=1 (bbbbbbbb...)'), report);
    assert.ok(report.includes('guest data present=yes'), report);
    assert.ok(report.includes('legacy data sort done=yes'), report);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(t.ctx.ownersWithLocalData())).sort(), [me, other, 'guest'].sort());
  });

  await test('sync report for a guest says results stay on the phone and lists nothing', async () => {
    const t = makeCtx();
    const report = t.ctx.buildSyncDiagnostics(t.ctx.DATA_OWNER_GUEST);
    assert.ok(report.includes('guest (results stay on this phone; no cloud backup)'), report);
    assert.ok(!report.includes('Waiting for cloud backup'));
  });

  await test('Details modal: plain summary plus report, copy goes to the clipboard, nothing in the queue is changed', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.cloud('rv_sessions', 1, 'B', { score: 50 });
    t.answers.push({ error: { code: '23505', message: 'duplicate key' } });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1, score: 50, timestamp: '2026-10-05T09:00:00.000Z' });
    const before = JSON.stringify(t.queue('A'));
    t.ctx.openSyncDetails();
    assert.strictEqual(t.els['sync-details-modal'].style.display, 'flex');
    const summary = t.els['sync-details-summary'].textContent;
    assert.ok(summary.startsWith('1 result saved on this phone but not backed up: another account'), summary);
    assert.ok(!summary.includes('Open Details'), 'no pointer to itself');
    assert.ok(summary.includes('never your notes, sketches or scores'), summary);
    assert.ok(t.els['sync-details-report'].textContent.includes('rv_sessions id=1'));
    await t.ctx.copySyncDiagnostics();
    assert.strictEqual(t.clipboard.written.length, 1);
    assert.strictEqual(t.clipboard.written[0], t.els['sync-details-report'].textContent);
    assert.ok(t.log.toasts.some((x) => x.type === 'success' && x.msg.startsWith('Report copied')), JSON.stringify(t.log.toasts));
    assert.strictEqual(JSON.stringify(t.queue('A')), before, 'viewing or copying the report changes nothing');
    assert.strictEqual(t.log.inserts.length, 1, 'no upload attempted');
    assert.strictEqual(t.cloudRows.get('rv_sessions:1').user_id, 'B');
    // Clipboard refused: the user is told how to copy by hand instead.
    t.clipboard.fail = true;
    await t.ctx.copySyncDiagnostics();
    assert.ok(t.log.toasts.some((x) => x.type === 'warn' && x.msg.includes('Press and hold')), JSON.stringify(t.log.toasts));
    t.ctx.closeSyncDetails();
    assert.strictEqual(t.els['sync-details-modal'].style.display, 'none');
  });

  await test('Details modal when everything is backed up says so', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.ctx.openSyncDetails();
    assert.ok(t.els['sync-details-summary'].textContent.startsWith('Everything in your recent history is saved on this phone and backed up to the cloud.'));
  });

  await test('three results held by another account read as one plain sentence (the case on Johnny\'s phone)', async () => {
    const t = makeCtx();
    t.signIn('A');
    for (const id of [11, 12, 13]) {
      t.cloud('rv_sessions', id, 'B', { score: 50 });
      t.answers.push({ error: { code: '23505', message: 'duplicate key' } });
      await t.ctx.syncSessionToSupabase('rv_sessions', { id, score: 50 });
    }
    assert.strictEqual(t.queue('A').length, 3);
    assert.strictEqual(t.label(), '3 results saved on this phone but not backed up: another account\'s cloud backup already holds results with the same ID. They are safe on this phone. Open Details to copy a report for support.');
    assert.ok(!t.label().includes('save ID is already taken'), 'old wording gone');
    assert.ok(!t.retryable());
  });

  await test('sameCloudValue: database spellings are not differences, real changes are', async () => {
    const t = makeCtx();
    const same = t.ctx.sameCloudValue;
    assert.strictEqual(same(61, '61'), true);
    assert.strictEqual(same(null, undefined), true);
    assert.strictEqual(same('2026-10-04T10:00:00.000Z', '2026-10-04T10:00:00+00:00'), true);
    assert.strictEqual(same({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }), true);
    assert.strictEqual(same(true, true), true);
    assert.strictEqual(same(61, 62), false);
    assert.strictEqual(same('tall, white', 'tall'), false);
    assert.strictEqual(same(null, 0), false);
    assert.strictEqual(same(true, false), false);
    assert.strictEqual(same(['x'], ['y']), false);
    assert.strictEqual(same('2026-10-04T10:00:00.000Z', '2026-10-04T10:00:01.000Z'), false);
  });

  await test('guest sessions are never queued, uploaded or checked', async () => {
    const t = makeCtx();
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1 });
    t.ctx.refreshSyncStatus();
    await t.settle();
    assert.strictEqual(t.log.inserts.length, 0);
    assert.strictEqual(t.log.existence.length, 0);
    assert.strictEqual(t.ls.size, 0);
  });

  console.log(`\n${passed} passed, 0 failed`);
})().catch((e) => { console.error(e); process.exit(1); });
