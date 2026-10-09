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
  extractDecl('MAX_RV_LOCAL_SESSIONS'), extractDecl('RV_SKETCH_KEEP_RECENT'), extractDecl('MAX_ZENER_LOCAL_RUNS'), extractDecl('MAX_TS_LOCAL_TRIALS'),
  extractDecl('SYNC_PENDING_KEY'), extractDecl('SYNC_CONFIRMED_KEY'), extractDecl('MAX_SYNC_ATTEMPTS'),
  extractDecl('SYNC_VERIFY_RECENT'), extractDecl('SYNC_CONFIRMED_KEEP'),
  extractDecl('_syncFlushInFlight'), extractDecl('_syncMemoryQueue'), extractDecl('_syncConfirmedMemory'),
  extractDecl('_syncVerifyInFlight'), extractDecl('_syncVerifyFailed'), extractDecl('_syncVerifyLast'), extractDecl('_historyWarnAt'),
  extractDecl('SYNC_HELP_MAILTO_MAX'), extractMultiDecl('HISTORY_KEYS_BY_TABLE'), extractMultiDecl('HISTORY_LIMIT_BY_TABLE'),
  extractDecl('APP_VERSION'), extractDecl('OWNED_DATA_MIGRATED_KEY'), extractDecl('LEGACY_DATA_CLAIMANT_KEY'),
  'let _dataOwner = DATA_OWNER_GUEST;',
  'let currentScreen = "profile";',
  'let STATE = { sessions: [], settings: {} };',
];
const FNS = ['safeParseArray', 'ownedKeyFor', 'ownedKey', 'isLoggedIn', 'isAuthGenCurrent', 'beginAuthContext', 'endAuthContext',
  'getTSTrialHit', 'mapRVSessionRow', 'mapZenerRunRow', 'mapTSTrialRow',
  'trimRecent', 'persistHistory', 'warnHistoryNotSaved', 'pruneRvForStorage', 'saveState', 'loadState', 'loadZenerSessions', 'saveZenerSession',
  'describePendingSync', 'updateSyncStatus', 'refreshSyncStatus', 'retryPendingSync',
  'readPendingSync', 'writePendingSync', 'pendingSyncCount', 'syncSessionToSupabase',
  'readConfirmedSync', 'markConfirmedSync', 'recentLocalHistoryRows', 'unverifiedLocalRows', 'verifyRecentCloudCopies',
  'sameCloudValue', 'cloudRowMatchesSubmission', 'flushPendingSync',
  'describeSyncState', 'unverifiedNote', 'describeLastCloudCheck', 'listStorageKeys', 'buildSyncDiagnostics', 'ownersWithLocalData',
  'openSyncDetails', 'closeSyncDetails', 'copySyncDiagnostics', 'buildSyncHelpMailto', 'openSyncHelpEmail',
  'foreignCollisionItems', 'mapHistoryRow', 'isEmptyLocalValue', 'sameLocalValue', 'durableHistoryList', 'planLocalMove',
  'findRecoverableResults', 'moveLocalResult', 'offerForeignResultRecovery', 'confirmForeignResultRecovery'];
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
    'sync-details-modal': mkEl('sync-details-modal'), 'sync-details-summary': mkEl('sync-details-summary'), 'sync-details-report': mkEl('sync-details-report'),
    'sync-recover-wrap': mkEl('sync-recover-wrap'), 'sync-recover-text': mkEl('sync-recover-text'), 'sync-recover-btn': mkEl('sync-recover-btn') };
  const nav = { href: '' };
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
    window: { addEventListener() {}, location: nav },
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
    ctx, log, answers, holds, els, ls, cloudRows, storage, clipboard, nav,
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
    assert.strictEqual(t.label(), '1 result saved on this device, not backed up to the cloud yet. Tap to retry.');
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
    assert.strictEqual(t.label(), '2 results saved on this device, not backed up to the cloud yet. Tap to retry.');
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
    assert.strictEqual(t.label(), '1 result saved on this device, not backed up to the cloud yet. Tap to retry.', 'no false success');
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
    assert.strictEqual(t.label(), '1 result not saved on this device or in the cloud. It is held only until the app closes. Tap to retry the cloud save.');
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
    assert.strictEqual(t.label(), '1 result hasn\'t been backed up. It\'s saved on this device. Open Details for help.');
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
    assert.strictEqual(t.label(), '1 result hasn\'t been backed up. It\'s saved on this device. Open Details for help.');
    assert.ok(!t.label().includes('account'), 'the account conflict is explained in the report, not on the row');
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
    assert.strictEqual(t.label(), '1 result saved on this device, not backed up to the cloud yet. Tap to retry. 1 result hasn\'t been backed up. It\'s saved on this device. Open Details for help.');
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
    assert.ok(report.includes('guest (results stay on this device; no cloud backup)'), report);
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
    assert.ok(summary.startsWith('1 result hasn\'t been backed up. It\'s saved on this device.'), summary);
    assert.ok(!summary.includes('Open Details'), 'no pointer to itself');
    assert.ok(t.els['sync-details-report'].textContent.includes('status=id_collision'), 'the account conflict code is in the report');
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
    assert.ok(t.els['sync-details-summary'].textContent.startsWith('Everything in your recent history is saved on this device and backed up to the cloud.'));
  });

  // ── Review regressions: no false backup assurances ──

  await test('REGRESSION: empty queue, unverified history, failed cloud check: Details does not say "backed up"', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.storage.refuse = (k) => k.endsWith(':ablty_sync_pending');
    t.answers.push({ throws: true });
    t.ctx.STATE.sessions.unshift(rvSession(6001));
    t.ctx.saveState();
    await t.ctx.syncSessionToSupabase('rv_sessions', t.ctx.mapRVSessionRow(t.ctx.STATE.sessions[0]));
    // Reload offline: the queue is empty (it never reached storage), the
    // history is not, and the cloud cannot be asked.
    const r = reload(t, 'A');
    assert.deepStrictEqual(r.queue('A'), [], 'the queue is empty');
    r.setExistenceError({ code: 'PGRST000', message: 'offline' });
    r.ctx.refreshSyncStatus();
    // While the check is in flight, Details says so.
    assert.ok(r.ctx._syncVerifyInFlight.has('A'), 'check in flight');
    r.ctx.openSyncDetails();
    let summary = r.els['sync-details-summary'].textContent;
    assert.ok(summary.startsWith('Checking that 1 recent result reached the cloud. It is saved on this device.'), summary);
    assert.ok(!summary.includes('backed up to the cloud'), summary);
    await r.settle();
    // The check failed: the row and Details agree, and neither says backed up.
    assert.ok(r.label().startsWith('Could not confirm'), r.label());
    r.ctx.openSyncDetails();
    summary = r.els['sync-details-summary'].textContent;
    assert.ok(summary.startsWith('Could not confirm that 1 recent result reached the cloud. It is saved on this device. Tap the Data Sync row to check again'), summary);
    assert.ok(!summary.includes('backed up to the cloud'), 'an empty queue is not proof of a backup');
    assert.strictEqual(JSON.parse(JSON.stringify(r.ctx.describeSyncState('A'))).state, 'unverified');
    const report = r.els['sync-details-report'].textContent;
    assert.ok(report.includes('Recent results not yet checked against the cloud: 1'), report);
    assert.ok(report.includes('Last cloud check: failed'), report);
    // Back online, the tap re-checks and uploads; only then does Details say backed up.
    r.setExistenceError(null);
    r.ctx.retryPendingSync();
    await r.settle();
    assert.strictEqual(r.label(), 'Synced to cloud');
    r.ctx.openSyncDetails();
    assert.ok(r.els['sync-details-summary'].textContent.startsWith('Everything in your recent history is saved on this device and backed up to the cloud.'));
    assert.ok(r.els['sync-details-report'].textContent.includes('Last cloud check: ok'));
  });

  await test('REGRESSION: phone refused the save AND the id is held by another account: never "saved on this device"', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.storage.refuse = (k) => k.includes(':ablty_zener') || k.endsWith(':ablty_sync_pending');
    t.cloud('zener_runs', 7001, 'B', { hits: 5 });
    t.answers.push({ error: { code: '23505', message: 'duplicate key' } });
    t.ctx.saveZenerSession({ id: 7001, hits: 9, hitPct: 36, symbolStats: {}, timestamp: '2026-10-04T10:00:00.000Z' });
    await t.settle();
    const q = t.ctx.readPendingSync('A');
    assert.strictEqual(q.length, 1);
    assert.strictEqual(q[0].localSaved, false);
    assert.strictEqual(q[0].unresolved, 'id_collision');
    const label = t.label();
    assert.strictEqual(label, '1 result hasn\'t been backed up and isn\'t saved on this device. It is held only until the app closes. Open Details for help.');
    assert.ok(!/(It's|They're|It is|They are) saved on this device/.test(label) && !label.includes('safe'), 'no durable-storage claim: ' + label);
    assert.ok(!t.retryable(), 'a retry cannot help');
    t.ctx.openSyncDetails();
    const summary = t.els['sync-details-summary'].textContent;
    assert.ok(summary.startsWith('1 result hasn\'t been backed up and isn\'t saved on this device.'), summary);
    assert.ok(t.els['sync-details-report'].textContent.includes('status=id_collision last_error=id_collision NOT_SAVED_ON_PHONE'));
    assert.strictEqual(t.cloudRows.get('zener_runs:7001').user_id, 'B', 'B\'s row untouched');
    // Mixed queue: a kept conflict and a lost conflict are described separately.
    t.cloud('rv_sessions', 7002, 'B', { score: 50 });
    t.answers.push({ error: { code: '23505', message: 'duplicate key' } });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 7002, score: 50 });
    assert.strictEqual(t.label(), '1 result hasn\'t been backed up. It\'s saved on this device. Open Details for help. 1 result hasn\'t been backed up and isn\'t saved on this device. It is held only until the app closes. Open Details for help.');
  });

  await test('describePendingSync: the four groups never overlap and only kept results are called saved', async () => {
    const t = makeCtx();
    const d = (items) => JSON.parse(JSON.stringify(t.ctx.describePendingSync(items)));
    const all = d([
      { localSaved: false }, { localSaved: false },
      {}, {},
      { unresolved: 'id_collision' }, { unresolved: 'content_mismatch' }, { unresolved: 'id_collision' },
      { localSaved: false, unresolved: 'id_collision' },
    ]);
    assert.strictEqual(all.text,
      '2 results not saved on this device or in the cloud. They are held only until the app closes. Tap to retry the cloud save. '
      + '2 results saved on this device, not backed up to the cloud yet. Tap to retry. '
      + '3 results haven\'t been backed up. They\'re saved on this device. Open Details for help. '
      + '1 result hasn\'t been backed up and isn\'t saved on this device. It is held only until the app closes. Open Details for help.');
    assert.deepStrictEqual([all.retryable, all.volatile, all.stuck], [true, true, true]);
    const lostOnly = d([{ localSaved: false, unresolved: 'id_collision' }]);
    assert.ok(!/(It's|They're|It is|They are) saved on this device/.test(lostOnly.text), lostOnly.text);
    assert.deepStrictEqual([lostOnly.retryable, lostOnly.volatile, lostOnly.stuck], [false, true, true]);
    assert.strictEqual(d([]).text, '');
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
    assert.strictEqual(t.label(), '3 results haven\'t been backed up. They\'re saved on this device. Open Details for help.');
    assert.ok(!t.label().includes('save ID is already taken'), 'old wording gone');
    assert.ok(!t.label().includes('account') && !t.label().includes('ID'), 'conflict detail stays in the report');
    assert.ok(t.ctx.buildSyncDiagnostics('A').includes('status=id_collision'));
    assert.ok(!t.retryable());
  });

  // ── Stuck queue items must not block verification of the rest ──

  // A phone with two accounts: three Zener runs parked as id collisions
  // under account A (the cloud holds those ids under B), five other recent
  // results never checked against the cloud. Ids are synthetic.
  function zenerRun(id, extra = {}) {
    return { id, hits: 6, hitPct: 24, symbolStats: { circle: 2 }, timestamp: new Date(id).toISOString(), ...extra };
  }
  function parkedCollision(ctx, run) {
    return { key: 'zener_runs:' + run.id, table: 'zener_runs', row: ctx.mapZenerRunRow(run), attempts: ctx.MAX_SYNC_ATTEMPTS,
      queuedAt: '2026-10-06T10:00:00.000Z', unresolved: 'id_collision', lastError: 'id_collision', recovered: true };
  }
  const STUCK_IDS = [1700000001000, 1700000002000, 1700000003000];
  function twoAccountPhone(t, owner = 'A') {
    const stuck = STUCK_IDS.map((id) => zenerRun(id));
    const ownZener = [zenerRun(1790000000001), zenerRun(1790000000002)];
    t.ls.set('ablty_owned:' + owner + ':ablty_zener', JSON.stringify([...ownZener, ...stuck]));
    t.ls.set('ablty_owned:' + owner + ':ablty_sync_pending', JSON.stringify(stuck.map((r) => parkedCollision(t.ctx, r))));
    const ownRv = [rvSession(1790000000003), rvSession(1790000000004), rvSession(1790000000005)];
    t.ls.set('ablty_owned:' + owner + ':ablty_sessions', JSON.stringify(ownRv));
    return { stuck, ownZener, ownRv };
  }

  await test('REGRESSION: parked id collisions no longer stop the other recent results from being verified', async () => {
    const t = makeCtx();
    const { ownZener, ownRv } = twoAccountPhone(t);
    // Four of the five are in the cloud; one Zener run never got there.
    ownZener.slice(0, 1).forEach((r) => t.cloud('zener_runs', r.id, 'A', t.ctx.mapZenerRunRow(r)));
    ownRv.forEach((r) => t.cloud('rv_sessions', r.id, 'A', t.ctx.mapRVSessionRow(r)));
    t.signIn('A');
    t.ctx.loadState();
    assert.strictEqual(t.ctx.unverifiedLocalRows('A').length, 5, 'five results the cloud was never asked about');
    t.ctx.refreshSyncStatus();
    assert.ok(t.label().includes('Checking that 5 recent results reached the cloud.'), t.label());
    await t.settle();
    assert.strictEqual(t.log.existence.length, 2, 'both tables were asked, despite the parked items');
    const asked = t.log.existence.flatMap((q) => q.in.ids.map(String));
    assert.ok(STUCK_IDS.every((id) => !asked.includes(String(id))), 'the parked ids are not asked about again');
    assert.strictEqual(t.ctx.unverifiedLocalRows('A').length, 0, 'nothing unverified remains');
    assert.strictEqual(t.log.inserts.length, 1, 'the one missing result was uploaded');
    assert.strictEqual(t.log.inserts[0].row.id, ownZener[1].id);
    assert.strictEqual(t.log.inserts[0].row.user_id, 'A');
    const q = t.queue('A');
    assert.strictEqual(q.length, 3, 'only the parked items remain queued');
    assert.ok(q.every((it) => it.unresolved === 'id_collision'));
    assert.strictEqual(t.label(), '3 results haven\'t been backed up. They\'re saved on this device. Open Details for help.');
    assert.ok(!t.label().includes('Checking'), t.label());
    const report = t.ctx.buildSyncDiagnostics('A');
    assert.ok(report.includes('Recent results not yet checked against the cloud: 0'), report);
    assert.ok(/Last cloud check: ok at \d{4}-\d{2}-\d{2}T.* \(checked 5, found in cloud 4, re-queued 1\)/.test(report), report);
    // Opening Settings again asks nothing more.
    t.ctx.refreshSyncStatus();
    await t.settle();
    assert.strictEqual(t.log.existence.length, 2);
  });

  await test('parked items plus a cloud check that fails: the row says both, a tap re-checks, and nothing loops', async () => {
    const t = makeCtx();
    twoAccountPhone(t);
    t.signIn('A');
    t.ctx.loadState();
    t.setExistenceError({ code: 'PGRST000', message: 'offline' });
    t.ctx.refreshSyncStatus();
    await t.settle();
    assert.strictEqual(t.log.existence.length, 2, 'asked once per table, then stopped');
    assert.strictEqual(t.label(), '3 results haven\'t been backed up. They\'re saved on this device. Open Details for help. Could not confirm that 5 recent results reached the cloud. Tap to check again.');
    assert.ok(t.retryable(), 'the tap is offered for the re-check');
    assert.ok(t.ctx.buildSyncDiagnostics('A').includes('Last cloud check: failed at'), t.ctx.buildSyncDiagnostics('A'));
    t.ctx.openSyncDetails();
    const summary = t.els['sync-details-summary'].textContent;
    assert.ok(summary.includes('Could not confirm that 5 recent results reached the cloud. Tap the Data Sync row to check again.'), summary);
    assert.ok(summary.includes('If that account is also yours, sign in to it on this device and open Sync Details there to move them.'), summary);
    assert.strictEqual(t.els['sync-recover-wrap'].style.display, 'none', 'no recovery offer for the account that does not hold them');
    // Back online, the tap checks again; no insert attempt is made for the parked items.
    t.setExistenceError(null);
    t.ctx.retryPendingSync();
    await t.settle();
    assert.strictEqual(t.log.existence.length, 4);
    assert.strictEqual(t.log.inserts.filter((i) => STUCK_IDS.includes(i.row.id)).length, 0, 'parked items are never re-sent');
    assert.ok(!t.label().includes('Could not confirm'), t.label());
  });

  await test('report: "Last cloud check" tells not run, ok and failed apart', async () => {
    const t = makeCtx();
    t.signIn('A');
    assert.ok(t.ctx.buildSyncDiagnostics('A').includes('Last cloud check: not run yet in this app session'));
    t.ctx.STATE.sessions.unshift(rvSession(8001));
    t.ctx.saveState();
    t.setExistenceError({ code: 'PGRST000', message: 'offline' });
    t.ctx.refreshSyncStatus();
    assert.ok(t.ctx.buildSyncDiagnostics('A').includes('Last cloud check: in progress'));
    await t.settle();
    assert.ok(/Last cloud check: failed at \d{4}.*\(could not reach the cloud\)/.test(t.ctx.buildSyncDiagnostics('A')));
    t.setExistenceError(null);
    t.cloud('rv_sessions', 8001, 'A', t.ctx.mapRVSessionRow(t.ctx.STATE.sessions[0]));
    t.ctx.retryPendingSync();
    await t.settle();
    assert.ok(/Last cloud check: ok at .*\(checked 1, found in cloud 1, re-queued 0\)/.test(t.ctx.buildSyncDiagnostics('A')));
    // The record is per account.
    t.signOut(); t.signIn('B');
    assert.ok(t.ctx.buildSyncDiagnostics('B').includes('Last cloud check: not run yet in this app session'));
  });

  // ── Recovery: the account that holds the ids takes its results back ──

  await test('RECOVERY: signed in as the holding account, confirmed-identical results move from the other account\'s copy, cloud untouched', async () => {
    const t = makeCtx();
    const { stuck, ownZener, ownRv } = twoAccountPhone(t, 'A');
    ownZener.forEach((r) => t.cloud('zener_runs', r.id, 'A', t.ctx.mapZenerRunRow(r)));
    ownRv.forEach((r) => t.cloud('rv_sessions', r.id, 'A', t.ctx.mapRVSessionRow(r)));
    // The cloud holds the three parked ids under B, with exactly the same
    // contents (Postgres spellings included).
    stuck.forEach((r) => t.cloud('zener_runs', r.id, 'B', { ...t.ctx.mapZenerRunRow(r), hit_pct: '24', timestamp: new Date(r.id).toISOString().replace('.000Z', '+00:00') }));
    t.signIn('B');
    t.ctx.loadState();
    assert.strictEqual(t.ctx.foreignCollisionItems('B').length, 3);
    const found = await t.ctx.findRecoverableResults('B');
    assert.strictEqual(found.matches.length, 3);
    assert.deepStrictEqual([found.mismatches, found.notMine, found.errors], [0, 0, 0]);
    assert.strictEqual(t.log.lookups.length, 3, 'each row read back by id and owner');
    assert.ok(t.log.lookups.every((q) => q.filters.user_id === 'B'));
    const cloudBefore = JSON.stringify([...t.cloudRows.entries()]);
    t.ctx.openSyncDetails();
    await t.settle();
    assert.strictEqual(t.els['sync-recover-wrap'].style.display, 'block', 'the move is offered');
    assert.ok(t.els['sync-recover-text'].textContent.startsWith('3 results waiting under another account on this device are already in this account\'s cloud backup with the same contents.'), t.els['sync-recover-text'].textContent);
    assert.strictEqual(t.els['sync-recover-btn'].textContent, 'Move 3 results to this account');
    assert.deepStrictEqual(t.queue('A').length, 3, 'nothing moved before the tap');

    await t.ctx.confirmForeignResultRecovery();
    await t.settle();
    const aZener = JSON.parse(t.ls.get('ablty_owned:A:ablty_zener'));
    assert.deepStrictEqual(aZener.map((r) => r.id), ownZener.map((r) => r.id), 'A keeps only its own runs');
    assert.deepStrictEqual(t.queue('A'), [], 'A\'s queue is empty');
    const bZener = JSON.parse(t.ls.get('ablty_owned:B:ablty_zener'));
    assert.deepStrictEqual(bZener.map((r) => r.id).sort(), STUCK_IDS.slice().sort(), 'B now holds them on this device');
    assert.deepStrictEqual(bZener.find((r) => r.id === STUCK_IDS[0]).symbolStats, { circle: 2 }, 'the whole local object moved, not just the uploaded fields');
    assert.ok(STUCK_IDS.every((id) => t.confirmed('B').includes('zener_runs:' + id)), 'remembered as confirmed for B');
    assert.strictEqual(JSON.stringify([...t.cloudRows.entries()]), cloudBefore, 'no cloud row inserted, changed or removed');
    assert.strictEqual(t.log.inserts.length, 0);
    assert.ok(t.log.toasts.some((x) => x.type === 'success' && x.msg.startsWith('3 results moved to this account on this device. Nothing was changed in the cloud.')), JSON.stringify(t.log.toasts));
    assert.strictEqual(t.els['sync-recover-wrap'].style.display, 'none', 'offer gone once done');
    assert.strictEqual(t.label(), 'Synced to cloud', 'B: nothing waiting, nothing unverified');

    // Back as A: nothing is re-queued, A\'s own results verify, the row is clean.
    t.signOut(); t.signIn('A');
    t.ctx.loadState();
    t.ctx.refreshSyncStatus();
    await t.settle();
    assert.deepStrictEqual(t.queue('A'), []);
    assert.strictEqual(t.label(), 'Synced to cloud');
    assert.strictEqual(t.log.inserts.length, 0, 'the moved ids were never uploaded again');
    assert.strictEqual(t.ctx.foreignCollisionItems('B').length, 0);
  });

  await test('RECOVERY: different contents, someone else\'s row, or a failed read-back: nothing moves', async () => {
    const t = makeCtx();
    const { stuck } = twoAccountPhone(t, 'A');
    // id 0: B's with different contents; id 1: C's; id 2: identical but the read-back fails first time.
    t.cloud('zener_runs', stuck[0].id, 'B', { ...t.ctx.mapZenerRunRow(stuck[0]), hits: 1 });
    t.cloud('zener_runs', stuck[1].id, 'C', t.ctx.mapZenerRunRow(stuck[1]));
    t.cloud('zener_runs', stuck[2].id, 'B', t.ctx.mapZenerRunRow(stuck[2]));
    t.signIn('B');
    t.setLookupError({ code: 'PGRST000', message: 'offline' });
    let found = await t.ctx.findRecoverableResults('B');
    assert.deepStrictEqual([found.matches.length, found.errors], [0, 3]);
    t.setLookupError(null);
    found = await t.ctx.findRecoverableResults('B');
    assert.strictEqual(found.matches.length, 1);
    assert.strictEqual(found.matches[0].item.row.id, stuck[2].id);
    assert.deepStrictEqual([found.mismatches, found.notMine, found.errors], [1, 1, 0]);
    t.ctx.openSyncDetails();
    await t.settle();
    const text = t.els['sync-recover-text'].textContent;
    assert.ok(text.includes('1 result waiting under another account on this device is already in this account\'s cloud backup'), text);
    assert.ok(text.includes('1 result under another account has the same ID as one of yours but different contents, so it was left alone.'), text);
    await t.ctx.confirmForeignResultRecovery();
    const aQueue = t.queue('A');
    assert.deepStrictEqual(aQueue.map((it) => it.row.id).sort(), [stuck[0].id, stuck[1].id].sort(), 'the two unconfirmed stay parked under A');
    assert.deepStrictEqual(JSON.parse(t.ls.get('ablty_owned:A:ablty_zener')).map((r) => r.id).includes(stuck[2].id), false);
    assert.ok(JSON.parse(t.ls.get('ablty_owned:A:ablty_zener')).some((r) => r.id === stuck[0].id), 'A still has the mismatching run');
    assert.strictEqual(t.cloudRows.get('zener_runs:' + stuck[0].id).row.hits, 1, 'B\'s differing row untouched');
    assert.strictEqual(t.log.inserts.length, 0);
  });

  await test('RECOVERY: destination write refused: the source copy and queue are left exactly as they were', async () => {
    const t = makeCtx();
    const { stuck } = twoAccountPhone(t, 'A');
    stuck.forEach((r) => t.cloud('zener_runs', r.id, 'B', t.ctx.mapZenerRunRow(r)));
    t.signIn('B');
    const before = { zener: t.ls.get('ablty_owned:A:ablty_zener'), queue: t.ls.get('ablty_owned:A:ablty_sync_pending') };
    t.storage.refuse = (k) => k === 'ablty_owned:B:ablty_zener';
    assert.strictEqual(t.ctx.moveLocalResult('A', 'B', 'zener_runs', stuck[0].id), 'refused');
    assert.strictEqual(t.ls.get('ablty_owned:A:ablty_zener'), before.zener);
    assert.strictEqual(t.ls.get('ablty_owned:A:ablty_sync_pending'), before.queue);
    assert.strictEqual(t.ls.has('ablty_owned:B:ablty_zener'), false);
    assert.ok(!t.confirmed('B').length, 'not marked confirmed either');
    // Storage back: the move works, and an existing destination entry is kept with empty fields filled.
    t.storage.refuse = () => false;
    t.ls.set('ablty_owned:B:ablty_zener', JSON.stringify([{ ...zenerRun(stuck[1].id), symbolStats: null }]));
    assert.strictEqual(t.ctx.moveLocalResult('A', 'B', 'zener_runs', stuck[1].id), 'moved');
    const bZener = JSON.parse(t.ls.get('ablty_owned:B:ablty_zener'));
    assert.strictEqual(bZener.filter((r) => r.id === stuck[1].id).length, 1, 'no duplicate in the destination');
    assert.deepStrictEqual(bZener[0].symbolStats, { circle: 2 }, 'empty field filled from the moved copy');
    assert.strictEqual(t.queue('A').length, 2);
    // RV sessions of the account on screen go through STATE.sessions and saveState.
    const rv = rvSession(1790000000009);
    t.ls.set('ablty_owned:A:ablty_sessions', JSON.stringify([rv]));
    t.ls.set('ablty_owned:A:ablty_sync_pending', JSON.stringify([{ key: 'rv_sessions:' + rv.id, table: 'rv_sessions', row: t.ctx.mapRVSessionRow(rv), attempts: 5, queuedAt: 'x', unresolved: 'id_collision' }]));
    assert.strictEqual(t.ctx.moveLocalResult('A', 'B', 'rv_sessions', rv.id), 'moved');
    assert.strictEqual(t.ctx.STATE.sessions[0].id, rv.id, 'in memory for the owner on screen');
    assert.strictEqual(t.ctx.STATE.sessions[0].notes, 'tall, white');
    assert.strictEqual(JSON.parse(t.ls.get('ablty_owned:B:ablty_sessions'))[0].id, rv.id, 'and written');
    assert.deepStrictEqual(JSON.parse(t.ls.get('ablty_owned:A:ablty_sessions')), []);
  });

  // ── Review of PR #141: three ways the move used to lose or mix data ──

  // An RV session recorded earlier than B's own; `extra` tweaks it.
  function olderRv(id, extra = {}) {
    return rvSession(id, { timestamp: new Date(id).toISOString(), notes: 'older notes', sketchData: 'data:image/png;base64,OLDER=', ...extra });
  }
  function parkRv(t, owner, session) {
    t.ls.set('ablty_owned:' + owner + ':ablty_sessions', JSON.stringify([session]));
    t.ls.set('ablty_owned:' + owner + ':ablty_sync_pending', JSON.stringify([{ key: 'rv_sessions:' + session.id, table: 'rv_sessions', row: t.ctx.mapRVSessionRow(session), attempts: 5, queuedAt: '2026-10-06T10:00:00.000Z', unresolved: 'id_collision', lastError: 'id_collision', recovered: true }]));
  }

  await test('REGRESSION: full RV history: a recovered older session that saveState would trim or strip is refused, nothing removed', async () => {
    const t = makeCtx();
    const old = olderRv(1600000000000);
    parkRv(t, 'A', old);
    t.cloud('rv_sessions', old.id, 'B', t.ctx.mapRVSessionRow(old));
    // B already holds MAX_RV_LOCAL_SESSIONS newer sessions on this device.
    const newer = Array.from({ length: t.ctx.MAX_RV_LOCAL_SESSIONS }, (_, i) => rvSession(1790000100000 + i, { timestamp: new Date(1790000100000 + i).toISOString(), sketchData: null }));
    newer.sort((a, b) => b.id - a.id);
    t.ls.set('ablty_owned:B:ablty_sessions', JSON.stringify(newer));
    t.signIn('B');
    t.ctx.loadState();
    assert.strictEqual(t.ctx.STATE.sessions.length, t.ctx.MAX_RV_LOCAL_SESSIONS);
    const before = { a: t.ls.get('ablty_owned:A:ablty_sessions'), q: t.ls.get('ablty_owned:A:ablty_sync_pending'), b: t.ls.get('ablty_owned:B:ablty_sessions') };
    const found = await t.ctx.findRecoverableResults('B');
    assert.strictEqual(found.matches.length, 1, 'the cloud agrees it is B\'s');
    await t.ctx.confirmForeignResultRecovery();
    assert.ok(t.log.toasts.some((x) => x.type === 'warn' && x.msg.startsWith('Could not keep 1 result in full in this account on this device (history full). Nothing was moved or removed.')), JSON.stringify(t.log.toasts));
    assert.ok(!t.log.toasts.some((x) => x.type === 'success'));
    assert.strictEqual(t.ls.get('ablty_owned:A:ablty_sessions'), before.a, 'source kept, sketch included');
    assert.strictEqual(t.ls.get('ablty_owned:A:ablty_sync_pending'), before.q, 'queue kept');
    assert.strictEqual(t.ls.get('ablty_owned:B:ablty_sessions'), before.b, 'destination storage unchanged');
    assert.strictEqual(t.ctx.STATE.sessions.length, t.ctx.MAX_RV_LOCAL_SESSIONS, 'memory rolled back');
    assert.ok(!t.ctx.STATE.sessions.some((s) => s.id === old.id));
    assert.ok(!t.confirmed('B').includes('rv_sessions:' + old.id), 'not marked confirmed');
    // Fewer sessions, but still more than RV_SKETCH_KEEP_RECENT newer ones: the sketch would be stripped, so it is refused too.
    t.ls.set('ablty_owned:B:ablty_sessions', JSON.stringify(newer.slice(0, t.ctx.RV_SKETCH_KEEP_RECENT)));
    t.ctx.loadState();
    assert.strictEqual(t.ctx.moveLocalResult('A', 'B', 'rv_sessions', old.id), 'no_room');
    assert.strictEqual(t.ls.get('ablty_owned:A:ablty_sessions'), before.a);
    assert.strictEqual(JSON.parse(t.ls.get('ablty_owned:B:ablty_sessions')).length, t.ctx.RV_SKETCH_KEEP_RECENT);
    // With room for the sketch, it moves whole and survives a reload.
    t.ls.set('ablty_owned:B:ablty_sessions', JSON.stringify(newer.slice(0, t.ctx.RV_SKETCH_KEEP_RECENT - 1)));
    t.ctx.loadState();
    assert.strictEqual(t.ctx.moveLocalResult('A', 'B', 'rv_sessions', old.id), 'moved');
    const r = reload(t, 'B');
    const back = r.ctx.STATE.sessions.find((s) => s.id === old.id);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(back)), old, 'the complete session, sketch and local-only fields included, after a reload');
    assert.strictEqual(r.ctx.STATE.sessions.length, t.ctx.RV_SKETCH_KEEP_RECENT);
    assert.deepStrictEqual(JSON.parse(r.ls.get('ablty_owned:A:ablty_sessions')), []);
    assert.deepStrictEqual(r.queue('A'), []);
    assert.ok(r.confirmed('B').includes('rv_sessions:' + old.id));
    assert.strictEqual(r.ctx.foreignCollisionItems('B').length, 0);
  });

  await test('REGRESSION: destination already holds that id with different contents: refused, both copies kept; the local copy is what is checked, not the queued snapshot', async () => {
    const t = makeCtx();
    const { stuck } = twoAccountPhone(t, 'A');
    stuck.forEach((r) => t.cloud('zener_runs', r.id, 'B', t.ctx.mapZenerRunRow(r)));
    // id 0: B's own copy on this device differs (non-empty field, other value).
    // id 1: B's copy agrees where both have a value; only an empty field differs.
    // id 2: A's local copy was edited after it was queued; the snapshot still matches the cloud.
    t.ls.set('ablty_owned:B:ablty_zener', JSON.stringify([{ ...zenerRun(stuck[0].id), hits: 9 }, { ...zenerRun(stuck[1].id), symbolStats: null }]));
    const aZener = JSON.parse(t.ls.get('ablty_owned:A:ablty_zener')).map((r) => (r.id === stuck[2].id ? { ...r, hits: 7 } : r));
    t.ls.set('ablty_owned:A:ablty_zener', JSON.stringify(aZener));
    t.signIn('B');
    const before = { a: t.ls.get('ablty_owned:A:ablty_zener'), b: t.ls.get('ablty_owned:B:ablty_zener') };
    const found = await t.ctx.findRecoverableResults('B');
    assert.deepStrictEqual([found.matches.length, found.conflicts, found.mismatches, found.notMine, found.errors], [1, 1, 1, 0, 0]);
    assert.strictEqual(found.matches[0].item.row.id, stuck[1].id);
    assert.strictEqual(t.log.lookups.filter((q) => String(q.filters.id) === String(stuck[0].id)).length, 0, 'a local conflict is never even asked about');
    const edited = t.log.lookups.find((q) => String(q.filters.id) === String(stuck[2].id));
    assert.ok(edited.cols.includes('hits'), 'the edited local copy was compared, which is why it is a mismatch');
    t.ctx.openSyncDetails();
    await t.settle();
    const text = t.els['sync-recover-text'].textContent;
    assert.ok(text.includes('1 result under another account has the same ID as a result already in this account on this device, with different contents. Both copies are kept and nothing is moved.'), text);
    assert.strictEqual(t.els['sync-recover-btn'].textContent, 'Move 1 result to this account');
    assert.strictEqual(t.ctx.moveLocalResult('A', 'B', 'zener_runs', stuck[0].id), 'conflict', 'a direct call is refused as well');
    await t.ctx.confirmForeignResultRecovery();
    assert.strictEqual(t.ls.get('ablty_owned:A:ablty_zener') !== before.a, true, 'only the agreeing one left A');
    const aAfter = JSON.parse(t.ls.get('ablty_owned:A:ablty_zener'));
    assert.ok(aAfter.some((r) => r.id === stuck[0].id && r.hits === 6), 'A keeps its copy of the conflicting run');
    assert.ok(aAfter.some((r) => r.id === stuck[2].id && r.hits === 7), 'A keeps its edited run');
    const bAfter = JSON.parse(t.ls.get('ablty_owned:B:ablty_zener'));
    assert.strictEqual(bAfter.find((r) => r.id === stuck[0].id).hits, 9, 'B keeps its own different copy');
    assert.deepStrictEqual(bAfter.find((r) => r.id === stuck[1].id).symbolStats, { circle: 2 }, 'the empty field was filled');
    assert.deepStrictEqual(t.queue('A').map((it) => it.row.id).sort(), [stuck[0].id, stuck[2].id].sort(), 'conflict and mismatch stay parked');
    assert.ok(!t.confirmed('B').includes('zener_runs:' + stuck[0].id), 'conflict not marked confirmed');
    assert.ok(t.confirmed('B').includes('zener_runs:' + stuck[1].id));
    const r = reload(t, 'A');
    assert.strictEqual(r.queue('A').length, 2);
    assert.strictEqual(JSON.parse(r.ls.get('ablty_owned:A:ablty_zener')).length, 4);
  });

  await test('REGRESSION: source history write refused after the copy: queue kept, reported as partial, finished by the next attempt', async () => {
    const t = makeCtx();
    const { stuck } = twoAccountPhone(t, 'A');
    stuck.forEach((r) => t.cloud('zener_runs', r.id, 'B', t.ctx.mapZenerRunRow(r)));
    t.signIn('B');
    t.storage.refuse = (k) => k === 'ablty_owned:A:ablty_zener';
    await t.ctx.confirmForeignResultRecovery();
    assert.ok(t.log.toasts.some((x) => x.type === 'warn' && x.msg.startsWith('3 results copied to this account, but the copy under the other account could not be removed yet. Open Details again to finish; nothing is lost.')), JSON.stringify(t.log.toasts));
    assert.ok(!t.log.toasts.some((x) => x.type === 'success'), 'not called a success');
    assert.strictEqual(t.queue('A').length, 3, 'the queue items stay until the cleanup is done');
    assert.strictEqual(JSON.parse(t.ls.get('ablty_owned:A:ablty_zener')).length, 5, 'source still has them');
    assert.deepStrictEqual(JSON.parse(t.ls.get('ablty_owned:B:ablty_zener')).map((r) => r.id).sort(), STUCK_IDS.slice().sort(), 'destination holds them');
    assert.ok(STUCK_IDS.every((id) => t.confirmed('B').includes('zener_runs:' + id)));
    await t.settle();
    assert.strictEqual(t.els['sync-recover-wrap'].style.display, 'block', 'the offer is shown again so the user can finish');
    assert.strictEqual(t.els['sync-recover-btn'].textContent, 'Move 3 results to this account');
    // A reload as A shows the truth: three results still waiting.
    const a = reload(t, 'A');
    a.ctx.refreshSyncStatus();
    await a.settle();
    assert.strictEqual(a.label(), '3 results haven\'t been backed up. They\'re saved on this device. Open Details for help.');
    assert.strictEqual(a.log.inserts.filter((i) => STUCK_IDS.includes(i.row.id)).length, 0, 'never re-sent');
    // Storage back, second attempt: nothing is written twice, the cleanup completes.
    t.storage.refuse = () => false;
    const bBefore = t.ls.get('ablty_owned:B:ablty_zener');
    await t.ctx.confirmForeignResultRecovery();
    assert.ok(t.log.toasts.some((x) => x.type === 'success' && x.msg.startsWith('3 results moved')), JSON.stringify(t.log.toasts));
    assert.strictEqual(t.ls.get('ablty_owned:B:ablty_zener'), bBefore, 'destination untouched by the retry');
    assert.deepStrictEqual(t.queue('A'), []);
    assert.strictEqual(JSON.parse(t.ls.get('ablty_owned:A:ablty_zener')).length, 2);
    // Queue write refused instead: also partial, and a reload still sees the item until it can be cleared.
    const t2 = makeCtx();
    const s2 = twoAccountPhone(t2, 'A').stuck;
    s2.forEach((r) => t2.cloud('zener_runs', r.id, 'B', t2.ctx.mapZenerRunRow(r)));
    t2.signIn('B');
    t2.storage.refuse = (k) => k === 'ablty_owned:A:ablty_sync_pending';
    assert.strictEqual(t2.ctx.moveLocalResult('A', 'B', 'zener_runs', s2[0].id), 'partial');
    assert.strictEqual(reload(t2, 'A').queue('A').length, 3, 'the stored queue still lists it');
    t2.storage.refuse = () => false;
    assert.strictEqual(t2.ctx.moveLocalResult('A', 'B', 'zener_runs', s2[0].id), 'moved');
    assert.strictEqual(reload(t2, 'A').queue('A').length, 2);
    const r2 = reload(t2, 'B');
    assert.strictEqual(JSON.parse(r2.ls.get('ablty_owned:B:ablty_zener')).filter((r) => r.id === s2[0].id).length, 1, 'one copy after reload');
  });

  // ── Review of 773ced0: two more ways the move could lose a result ──

  await test('REGRESSION: destination holds the identical entry only in memory (its save was refused): nothing is removed until it is stored', async () => {
    const t = makeCtx();
    const old = olderRv(1600000000000);
    parkRv(t, 'A', old);
    t.cloud('rv_sessions', old.id, 'B', t.ctx.mapRVSessionRow(old));
    t.signIn('B');
    t.ctx.loadState();
    // B produced the same session earlier in this app session, but the phone refused to keep it.
    t.storage.refuse = (k) => k === 'ablty_owned:B:ablty_sessions';
    t.ctx.STATE.sessions.unshift(JSON.parse(JSON.stringify(old)));
    assert.strictEqual(t.ctx.saveState(), false);
    assert.strictEqual(t.ls.has('ablty_owned:B:ablty_sessions'), false);
    const plan = t.ctx.planLocalMove('A', 'B', 'rv_sessions', old.id);
    assert.strictEqual(plan.write, false, 'the plan sees nothing to change in the destination');
    const before = { a: t.ls.get('ablty_owned:A:ablty_sessions'), q: t.ls.get('ablty_owned:A:ablty_sync_pending') };
    assert.strictEqual(t.ctx.moveLocalResult('A', 'B', 'rv_sessions', old.id), 'refused');
    assert.strictEqual(t.ls.get('ablty_owned:A:ablty_sessions'), before.a, 'source kept');
    assert.strictEqual(t.ls.get('ablty_owned:A:ablty_sync_pending'), before.q, 'queue kept');
    assert.ok(!t.confirmed('B').includes('rv_sessions:' + old.id));
    assert.strictEqual(t.ctx.STATE.sessions.length, 1, 'memory copy still there');
    await t.ctx.confirmForeignResultRecovery();
    assert.ok(t.log.toasts.some((x) => x.type === 'warn' && x.msg.startsWith('Could not store 1 result on this device (storage full or blocked). Nothing was moved or removed.')), JSON.stringify(t.log.toasts));
    assert.strictEqual(t.ls.get('ablty_owned:A:ablty_sessions'), before.a);
    // A reload as either account still finds the result somewhere durable.
    assert.deepStrictEqual(JSON.parse(reload(t, 'A').ls.get('ablty_owned:A:ablty_sessions')), [old]);
    assert.strictEqual(reload(t, 'B').ctx.STATE.sessions.length, 0, 'B never had it stored');
    // Storage back, same session: the move stores it, reads it back, then clears the source.
    t.storage.refuse = () => false;
    assert.strictEqual(t.ctx.moveLocalResult('A', 'B', 'rv_sessions', old.id), 'moved');
    const r = reload(t, 'B');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r.ctx.STATE.sessions)), [old], 'complete entry, sketch and local-only fields included, after a reload');
    assert.deepStrictEqual(JSON.parse(r.ls.get('ablty_owned:A:ablty_sessions')), []);
    assert.deepStrictEqual(r.queue('A'), []);
    assert.ok(r.confirmed('B').includes('rv_sessions:' + old.id));
  });

  await test('REGRESSION: a failed queue cleanup keeps the unfinished item in the live queue, so Details can retry in the same session', async () => {
    const t = makeCtx();
    const { stuck } = twoAccountPhone(t, 'A');
    // Two parked items only.
    t.ls.set('ablty_owned:A:ablty_sync_pending', JSON.stringify(stuck.slice(0, 2).map((r) => parkedCollision(t.ctx, r))));
    stuck.forEach((r) => t.cloud('zener_runs', r.id, 'B', t.ctx.mapZenerRunRow(r)));
    t.signIn('B');
    t.storage.refuse = (k) => k === 'ablty_owned:A:ablty_sync_pending';
    assert.strictEqual(t.ctx.moveLocalResult('A', 'B', 'zener_runs', stuck[0].id), 'partial');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(t.ctx.readPendingSync('A').map((it) => it.row.id))), [stuck[0].id, stuck[1].id], 'the live queue still lists both');
    assert.deepStrictEqual(t.queue('A').map((it) => it.row.id), [stuck[0].id, stuck[1].id], 'as does storage');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(t.ctx.foreignCollisionItems('B').map((c) => c.item.row.id))), [stuck[0].id, stuck[1].id]);
    let found = await t.ctx.findRecoverableResults('B');
    assert.strictEqual(found.matches.length, 2, 'the recovery offer still covers the unfinished one');
    t.ctx.openSyncDetails();
    await t.settle();
    assert.strictEqual(t.els['sync-recover-btn'].textContent, 'Move 2 results to this account');
    // Still refused: the whole attempt is partial, nothing vanishes from the live queue.
    await t.ctx.confirmForeignResultRecovery();
    assert.ok(t.log.toasts.some((x) => x.type === 'warn' && x.msg.startsWith('2 results copied to this account, but the copy under the other account could not be removed yet.')), JSON.stringify(t.log.toasts));
    assert.strictEqual(t.ctx.readPendingSync('A').length, 2);
    assert.strictEqual(JSON.parse(t.ls.get('ablty_owned:A:ablty_zener')).length, 3, 'source copies already gone, only the queue is left to clear');
    const bBefore = t.ls.get('ablty_owned:B:ablty_zener');
    assert.strictEqual(JSON.parse(bBefore).length, 2, 'destination holds both');
    // Storage back, same session, reopening Details finishes it.
    t.storage.refuse = () => false;
    found = await t.ctx.findRecoverableResults('B');
    assert.strictEqual(found.matches.length, 2);
    await t.ctx.confirmForeignResultRecovery();
    assert.ok(t.log.toasts.some((x) => x.type === 'success' && x.msg.startsWith('2 results moved')), JSON.stringify(t.log.toasts));
    assert.strictEqual(t.ctx.readPendingSync('A').length, 0);
    assert.deepStrictEqual(t.queue('A'), []);
    assert.strictEqual(t.ls.get('ablty_owned:B:ablty_zener'), bBefore);
    const r = reload(t, 'A');
    assert.deepStrictEqual(r.queue('A'), []);
    assert.deepStrictEqual(JSON.parse(r.ls.get('ablty_owned:B:ablty_zener')).map((x) => x.id).sort(), [stuck[0].id, stuck[1].id].sort());
    assert.strictEqual(r.ctx.foreignCollisionItems('B').length, 0);
  });

  // ── Get help ──

  await test('Get help: opens a mailto to support with the report in the body, sends nothing itself, keeps long reports within limits', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.cloud('rv_sessions', 1, 'B', { score: 50 });
    t.answers.push({ error: { code: '23505', message: 'duplicate key' } });
    await t.ctx.syncSessionToSupabase('rv_sessions', { id: 1, score: 50, timestamp: '2026-10-05T09:00:00.000Z' });
    t.ctx.openSyncDetails();
    const report = t.els['sync-details-report'].textContent;
    t.ctx.openSyncHelpEmail();
    const url = t.nav.href;
    assert.ok(url.startsWith('mailto:abltyapp@gmail.com?subject='), url);
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    assert.strictEqual(params.get('subject'), 'ABLTY sync help (' + t.ctx.APP_VERSION + ')');
    assert.ok(params.get('body').includes(report), 'the full report is in the body');
    assert.ok(params.get('body').includes('no notes, sketches or scores'));
    assert.ok(!params.get('body').includes('tall, white'), 'no session contents');
    assert.strictEqual(t.log.inserts.length, 1, 'no network call made by Get help');
    assert.ok(t.log.toasts.some((x) => x.msg.includes('Press Send there')));
    assert.strictEqual(t.els['sync-details-modal'].style.display, 'flex', 'modal stays open for Copy report as a fallback');
    // A very long report is cut to fit and says so.
    const long = report + '\n' + 'x'.repeat(5000);
    const longUrl = t.ctx.buildSyncHelpMailto(long);
    assert.ok(longUrl.length <= t.ctx.SYNC_HELP_MAILTO_MAX, String(longUrl.length));
    const longBody = new URLSearchParams(longUrl.slice(longUrl.indexOf('?') + 1)).get('body');
    assert.ok(longBody.includes('Report cut short to fit. Use Copy report'), longBody.slice(-120));
    assert.ok(longBody.includes('ABLTY sync report'), 'the start of the report survives');
    // Buttons inside the modal do not close it; only the backdrop or Close does.
    t.ctx.closeSyncDetails({ target: t.els['sync-recover-btn'] });
    assert.strictEqual(t.els['sync-details-modal'].style.display, 'flex');
    t.ctx.closeSyncDetails({ target: t.els['sync-details-modal'] });
    assert.strictEqual(t.els['sync-details-modal'].style.display, 'none');
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
