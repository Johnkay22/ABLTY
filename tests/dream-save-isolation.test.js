// Runs the real saveDreamEntry / postDreamTagsInBackground code from app.html
// against a controllable fake Supabase client and checks that a slow dream
// save (or its background tagging) never touches the screen of a different
// account, a guest, or a later login of the same account. The database row
// is always written for the account that pressed Save, or not at all.
// Run with:  node tests/dream-save-isolation.test.js
const vm = require('vm');
const assert = require('assert');
const { extractFn, extractDecl, extractMultiDecl } = require('./helpers/extract-app-source');

const DECLS = [
  extractDecl('DREAM_EMOTION_OPTIONS'), extractMultiDecl('DREAM_DEFAULT_FORM'), extractMultiDecl('DREAM_JOURNAL_STATE'),
  extractDecl('_authGen'), extractDecl('_activeAuthUserId'), extractDecl('_enteredUserId'), extractDecl('_legalGate'),
  extractDecl('_passwordRecoveryPending'), extractDecl('_dreamSaveSeq'), extractDecl('DATA_OWNER_GUEST'),
  'let _dataOwner = DATA_OWNER_GUEST;',
];
const FNS = ['isAuthGenCurrent', 'beginAuthContext', 'endAuthContext', 'isLoggedIn', 'getLoggedInUserId', 'mapDreamEntryRow',
  'clampDreamClarity', 'normalizeDreamLucid', 'normalizeDreamTags', 'normalizeDreamTagResponse', 'getDreamJournalErrorMessage',
  'resetDreamJournalState', 'beginDreamSaveContext', 'isDreamSaveContextCurrent', 'updateDreamEntryTags',
  'postDreamTagsInBackground', 'saveDreamEntry'];
// Top-level let/const live in the script scope, not on the context object;
// `var` makes them readable and writable from the test.
const source = DECLS.join('\n').replace(/^(const|let) /gm, 'var ') + '\n\n' + FNS.map(extractFn).join('\n\n');
new vm.Script(source);

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setImmediate(r));

function makeCtx() {
  const log = { inserts: [], updates: [], toasts: [], navigations: [], renders: 0, fetches: 0 };
  const pending = { insert: null, tag: null, session: null };
  const ls = new Map([['ablty_logged_in', '1']]);
  let sessionUser = null;
  const el = { disabled: false, textContent: 'SAVE ENTRY', classList: { add() {}, remove() {} } };
  const ctx = {
    console: { warn() {}, log() {}, error() {} },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
    document: { getElementById: () => el, querySelector: () => el },
    STATE: { dreamEntries: [] },
    currentScreen: 'dream-journal',
    WORKER_URL: 'https://worker.test',
    SUPABASE_URL: 'https://proj.supabase.co',
    navigate: (s) => log.navigations.push(s),
    renderDreamJournal: () => { log.renders += 1; },
    renderDreamEntryDetail: () => { log.renders += 1; },
    showToast: (msg, kind) => log.toasts.push({ msg, kind }),
    showUpgradeModal: () => log.toasts.push({ msg: 'upgrade' }),
    syncDreamDraftFromForm() {},
    // Stand-ins for the parts of an account switch that are not under test.
    setDataOwner: (owner) => { ctx._dataOwner = owner ? String(owner) : ctx.DATA_OWNER_GUEST; },
    cancelPendingPasswordRecovery() {},
    resolveLegalGate() {},
    fetch: () => {
      log.fetches += 1;
      pending.tag = deferred();
      return pending.tag.promise.then((tags) => ({ json: async () => tags }));
    },
    sb: {
      auth: {
        getSession: () => {
          if (pending.session) return pending.session.promise.then(() => ({ data: { session: sessionUser ? { user: { id: sessionUser } } : null } }));
          return Promise.resolve({ data: { session: sessionUser ? { user: { id: sessionUser } } : null } });
        },
      },
      from(table) {
        return {
          insert(row) {
            log.inserts.push({ table, row });
            pending.insert = deferred();
            return { select() { return { single: () => pending.insert.promise }; } };
          },
          update(patch) {
            return { eq(k1, v1) { return { eq(k2, v2) {
              log.updates.push({ table, patch, [k1]: v1, [k2]: v2 });
              return Promise.resolve({ error: null });
            } }; } };
          },
        };
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const api = {
    ctx, log, pending, el,
    signIn(uid) { sessionUser = uid; ctx.beginAuthContext(uid); },
    signOut() { sessionUser = null; ctx.endAuthContext(); ctx.resetDreamJournalState(); },
    fillForm(body) { ctx.DREAM_JOURNAL_STATE.form = { ...ctx.DREAM_DEFAULT_FORM, body, clarity: 4, emotion: 'Calm' }; },
    row(id, uid, body) { return { data: { id, user_id: uid, created_at: '2026-10-04T00:00:00Z', clarity: 4, lucid: 'no', emotion: 'Calm', body, ai_tags: [] }, error: null }; },
    ids: () => JSON.parse(JSON.stringify(ctx.DREAM_JOURNAL_STATE.entries.map((e) => e.id))),
    tagsOf: (i) => JSON.parse(JSON.stringify(ctx.DREAM_JOURNAL_STATE.entries[i].ai_tags)),
  };
  return api;
}

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log('PASS  ' + name); }

(async () => {
  await test('normal save: entry appears for its owner, tags arrive later', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.fillForm('a dream');
    const p = t.ctx.saveDreamEntry();
    await tick();
    assert.strictEqual(t.log.inserts[0].row.user_id, 'A');
    assert.strictEqual(t.el.disabled, true);
    t.pending.insert.resolve(t.row('d1', 'A', 'a dream'));
    await p;
    assert.deepStrictEqual(t.ids(), ['d1']);
    assert.deepStrictEqual(t.log.navigations, ['dream-journal']);
    assert.strictEqual(t.el.disabled, false);
    assert.strictEqual(t.log.fetches, 1, 'tagging requested');
    t.pending.tag.resolve({ tags: ['water'] });
    await tick(); await tick(); await tick();
    assert.strictEqual(t.log.updates.length, 1);
    assert.strictEqual(t.log.updates[0].user_id, 'A');
    assert.deepStrictEqual(t.tagsOf(0), ['water']);
    assert.strictEqual(t.log.toasts.length, 0);
  });

  await test('switch to another account mid-save: row saved for A, B sees nothing', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.fillForm('secret');
    const p = t.ctx.saveDreamEntry();
    await tick();
    t.signOut(); t.signIn('B');
    t.pending.insert.resolve(t.row('d1', 'A', 'secret'));
    await p;
    assert.strictEqual(t.log.inserts[0].row.user_id, 'A', 'written under A');
    assert.deepStrictEqual(t.ids(), [], 'B list untouched');
    assert.deepStrictEqual(t.log.navigations, []);
    assert.strictEqual(t.log.renders, 0);
    assert.strictEqual(t.log.toasts.length, 0);
    assert.strictEqual(t.log.fetches, 0, 'no tagging started for a stale save');
    assert.strictEqual(t.el.disabled, false, 'shared button released');
  });

  await test('switch to guest (sign out) mid-save: guest sees nothing', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.fillForm('secret');
    const p = t.ctx.saveDreamEntry();
    await tick();
    t.signOut();
    t.pending.insert.resolve(t.row('d1', 'A', 'secret'));
    await p;
    assert.deepStrictEqual(t.ids(), []);
    assert.deepStrictEqual(t.log.navigations, []);
    assert.strictEqual(t.log.toasts.length, 0);
  });

  await test('log out and back in as the same account mid-save: the new login is not touched', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.fillForm('secret');
    const p = t.ctx.saveDreamEntry();
    await tick();
    t.signOut(); t.signIn('A');
    t.pending.insert.resolve(t.row('d1', 'A', 'secret'));
    await p;
    assert.deepStrictEqual(t.ids(), [], 'the fresh login reloads from the cloud instead');
    assert.deepStrictEqual(t.log.navigations, []);
    assert.strictEqual(t.log.toasts.length, 0);
  });

  await test('error arriving after a switch is not shown to the new account', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.fillForm('secret');
    const p = t.ctx.saveDreamEntry();
    await tick();
    t.signOut(); t.signIn('B');
    t.pending.insert.resolve({ data: null, error: { code: '500', message: 'boom' } });
    await p;
    assert.strictEqual(t.log.toasts.length, 0);
    assert.deepStrictEqual(t.ids(), []);
  });

  await test('error for the same account is shown to that account', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.fillForm('secret');
    const p = t.ctx.saveDreamEntry();
    await tick();
    t.pending.insert.resolve({ data: null, error: { code: '500', message: 'boom' } });
    await p;
    assert.strictEqual(t.log.toasts.length, 1);
    assert.strictEqual(t.log.toasts[0].kind, 'error');
    assert.strictEqual(t.el.disabled, false);
  });

  await test('account changes while the session is being read: nothing is written', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.fillForm('secret');
    t.pending.session = deferred();
    const p = t.ctx.saveDreamEntry();
    await tick();
    t.signOut(); t.signIn('B');
    t.pending.session.resolve();
    await p;
    assert.strictEqual(t.log.inserts.length, 0, 'no insert under B');
    assert.strictEqual(t.log.toasts.length, 0);
  });

  await test('tagging finishing after a switch: no write under B, B list untouched', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.fillForm('a dream');
    const p = t.ctx.saveDreamEntry();
    await tick();
    t.pending.insert.resolve(t.row('d1', 'A', 'a dream'));
    await p;
    assert.strictEqual(t.log.fetches, 1);
    t.signOut(); t.signIn('B');
    const rendersBefore = t.log.renders;
    t.pending.tag.resolve({ tags: ['water'] });
    await tick(); await tick(); await tick();
    assert.strictEqual(t.log.updates.length, 0, 'tags not written with another account\'s session');
    assert.deepStrictEqual(t.ids(), []);
    assert.strictEqual(t.log.renders, rendersBefore, 'B\'s screen not re-rendered');
  });

  await test('tagging finishing after sign-out then sign-in as A again: written for A, new login screen untouched', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.fillForm('a dream');
    const p = t.ctx.saveDreamEntry();
    await tick();
    t.pending.insert.resolve(t.row('d1', 'A', 'a dream'));
    await p;
    t.signOut(); t.signIn('A');
    t.ctx.DREAM_JOURNAL_STATE.entries = [t.ctx.mapDreamEntryRow(t.row('d1', 'A', 'a dream').data)];
    const rendersBefore = t.log.renders;
    t.pending.tag.resolve({ tags: ['water'] });
    await tick(); await tick(); await tick();
    assert.strictEqual(t.log.updates.length, 1, 'A\'s own session may still write A\'s tags');
    assert.deepStrictEqual(t.tagsOf(0), [], 'but the new login\'s screen is left alone');
    assert.strictEqual(t.log.renders, rendersBefore);
  });

  await test('a newer save keeps the button while an older stale save finishes', async () => {
    const t = makeCtx();
    t.signIn('A');
    t.fillForm('first');
    const p1 = t.ctx.saveDreamEntry();
    await tick();
    const insert1 = t.pending.insert;
    t.signOut(); t.signIn('B');
    t.fillForm('second');
    const p2 = t.ctx.saveDreamEntry();
    await tick();
    insert1.resolve(t.row('d1', 'A', 'first'));
    await p1;
    assert.strictEqual(t.el.disabled, true, 'B\'s save still owns the button');
    t.pending.insert.resolve(t.row('d2', 'B', 'second'));
    await p2;
    assert.strictEqual(t.el.disabled, false);
    assert.deepStrictEqual(t.ids(), ['d2']);
  });

  console.log(`\n${passed} passed, 0 failed`);
})().catch((e) => { console.error(e); process.exit(1); });
