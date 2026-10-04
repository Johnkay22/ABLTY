// A small in-page stand-in for supabase-js v2, used only by
// tests/browser-account-isolation.test.js. It is served in place of the CDN
// bundle so the real app.html runs unmodified against a backend the test
// controls. The "database" persists in localStorage (key __fake_backend) so
// it survives page reloads, and row visibility follows the same own-row rule
// as ABLTY's RLS policies (user_id, or id for profiles, must be the signed-in
// user). Any request can be held open by the test to simulate slow network.
(function () {
  const TOKEN_KEY = 'sb-ghjajyxcjfqidcmqdzdp-auth-token';
  const DB_KEY = '__fake_backend';
  const listeners = [];
  const holds = {};
  window.__fake = {
    log: [],
    // Holds the next request whose label starts with `label` until release().
    hold(label) {
      let release;
      const promise = new Promise((r) => { release = r; });
      holds[label] = { promise, release, hit: false };
    },
    release(label) {
      const h = holds[label];
      if (h) { delete holds[label]; h.release(); }
    },
    wasHit(label) { return !!(holds[label] && holds[label].hit); },
    db: () => readDb(),
  };

  function readDb() {
    try { return JSON.parse(localStorage.getItem(DB_KEY)) || { users: [], tables: {} }; }
    catch (e) { return { users: [], tables: {} }; }
  }
  function writeDb(db) { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
  function readSession() {
    try { return JSON.parse(localStorage.getItem(TOKEN_KEY)); } catch (e) { return null; }
  }
  function writeSession(s) {
    if (s) localStorage.setItem(TOKEN_KEY, JSON.stringify(s));
    else localStorage.removeItem(TOKEN_KEY);
  }
  async function gate(label) {
    window.__fake.log.push(label);
    for (const key of Object.keys(holds)) {
      if (label.startsWith(key)) {
        holds[key].hit = true;
        await holds[key].promise;
      }
    }
  }
  function emit(event, session) {
    setTimeout(() => listeners.forEach((cb) => { try { cb(event, session); } catch (e) {} }), 0);
  }
  const ownerCol = (table) => (table === 'profiles' ? 'id' : 'user_id');

  function query(table) {
    const q = { table, op: 'select', filters: [], inFilters: [], single: null, limit: null, order: null };
    const b = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (res, rej) => run(q).then(res, rej);
        if (prop === 'select') return () => { q.selectAfter = q.op !== 'select'; return b; };
        if (prop === 'insert') return (rows) => { q.op = 'insert'; q.rows = rows; return b; };
        if (prop === 'upsert') return (rows) => { q.op = 'upsert'; q.rows = rows; return b; };
        if (prop === 'update') return (vals) => { q.op = 'update'; q.vals = vals; return b; };
        if (prop === 'delete') return () => { q.op = 'delete'; return b; };
        if (prop === 'eq') return (k, v) => { q.filters.push([k, v]); return b; };
        if (prop === 'in') return (k, vals) => { q.inFilters.push([k, (vals || []).map(String)]); return b; };
        if (prop === 'maybeSingle') return () => { q.single = 'maybe'; return b; };
        if (prop === 'single') return () => { q.single = 'one'; return b; };
        if (prop === 'limit') return (n) => { q.limit = n; return b; };
        if (prop === 'order') return (col, o) => { q.order = [col, !(o && o.ascending)]; return b; };
        return () => b; // neq, gte, lte, is, range, ...: not needed for these checks
      },
    });
    return b;
  }

  async function run(q) {
    const who = readSession()?.user?.id || null;
    const label = `${q.op}:${q.table}:${who || 'anon'}:${(q.filters.find(f => f[0] === ownerCol(q.table)) || [])[1] || ''}`;
    await gate(label);
    const db = readDb();
    const rows = db.tables[q.table] || (db.tables[q.table] = []);
    const col = ownerCol(q.table);
    const visible = (r) => who && String(r[col]) === String(who);
    const match = (r) => q.filters.every(([k, v]) => String(r[k]) === String(v))
      && q.inFilters.every(([k, vals]) => vals.includes(String(r[k])));
    if (q.op === 'select') {
      let out = rows.filter((r) => visible(r) && match(r));
      if (q.order) out.sort((a, b) => (String(a[q.order[0]]) < String(b[q.order[0]]) ? 1 : -1) * (q.order[1] ? 1 : -1));
      if (q.limit) out = out.slice(0, q.limit);
      if (q.single) return { data: out[0] || null, error: null };
      return { data: out, error: null };
    }
    if (q.op === 'insert' || q.op === 'upsert') {
      const list = Array.isArray(q.rows) ? q.rows : [q.rows];
      for (const r of list) {
        if (!who || String(r[col]) !== String(who)) {
          return { data: null, error: { message: 'new row violates row-level security policy', code: '42501' } };
        }
      }
      for (const r of list) {
        const i = rows.findIndex((x) => x.id !== undefined && String(x.id) === String(r.id));
        if (i >= 0 && q.op === 'upsert') {
          if (!visible(rows[i])) return { data: null, error: { message: 'row-level security', code: '42501' } };
          rows[i] = { ...rows[i], ...r };
        } else if (i < 0) {
          rows.push({ ...r });
        }
      }
      writeDb(db);
      return { data: q.single ? list[0] : list, error: null };
    }
    if (q.op === 'update') {
      rows.forEach((r, i) => { if (visible(r) && match(r)) rows[i] = { ...r, ...q.vals }; });
      writeDb(db);
      const out = rows.filter((r) => visible(r) && match(r));
      return { data: q.single ? out[0] || null : out, error: null };
    }
    if (q.op === 'delete') {
      db.tables[q.table] = rows.filter((r) => !(visible(r) && match(r)));
      writeDb(db);
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }

  function makeSession(u) {
    return {
      access_token: 'tok-' + u.id + '-' + Math.random().toString(16).slice(2),
      refresh_token: 'refresh-' + u.id,
      user: { id: u.id, email: u.email, user_metadata: {} },
    };
  }

  function createClient() {
    return {
      from: query,
      rpc: async () => ({ data: false, error: null }),
      auth: {
        async getSession() {
          await gate('getSession:' + (readSession()?.user?.id || 'anon'));
          return { data: { session: readSession() }, error: null };
        },
        async getUser() { return { data: { user: readSession()?.user || null }, error: null }; },
        async signInWithPassword({ email, password }) {
          const u = readDb().users.find((x) => x.email === email && x.password === password);
          await gate('signIn:' + (u ? u.id : 'nobody'));
          if (!u) return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
          const s = makeSession(u);
          writeSession(s);
          emit('SIGNED_IN', s);
          return { data: { user: s.user, session: s }, error: null };
        },
        async signOut() {
          writeSession(null);
          emit('SIGNED_OUT', null);
          return { error: null };
        },
        async setSession() { return { data: { session: readSession(), user: readSession()?.user || null }, error: null }; },
        async refreshSession() { return { data: { session: readSession() }, error: null }; },
        async updateUser() { return { data: {}, error: null }; },
        async resetPasswordForEmail() { return { data: {}, error: null }; },
        async signUp() { return { data: { user: null, session: null }, error: { message: 'not in this test' } }; },
        async signInWithIdToken() { return { data: { user: null, session: null }, error: { message: 'not in this test' } }; },
        onAuthStateChange(cb) {
          listeners.push(cb);
          setTimeout(() => cb('INITIAL_SESSION', readSession()), 0);
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
    };
  }

  window.supabase = { createClient };
})();
