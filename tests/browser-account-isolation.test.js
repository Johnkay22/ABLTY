// End-to-end check that local training data and Academy progress stay with
// their owner (the guest, or one account) across sign-in, sign-out, account
// switches, page refreshes and slow network responses.
//
// The real app.html runs unmodified in headless Chromium. Only the network
// edge is replaced: supabase-js is swapped for tests/helpers/fake-supabase.js
// (own-row visibility like the live RLS policies, holdable requests), and the
// grading Worker, Google script and fonts are answered locally.
//
// Run:  NODE_PATH="$(npm root -g)" node tests/browser-account-isolation.test.js
// Exits 77 (skip) when Playwright or Chromium is not available.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.log('SKIP  playwright is not installed (set NODE_PATH to a global install)');
  process.exit(77);
}

const ROOT = path.join(__dirname, '..');
const FAKE_SUPABASE = fs.readFileSync(path.join(__dirname, 'helpers', 'fake-supabase.js'), 'utf8');
const A = { id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'alice@example.test', password: 'pw-alice-123', username: 'alice' };
const B = { id: 'bbbbbbbb-0000-4000-8000-000000000002', email: 'bob@example.test', password: 'pw-bob-123', username: 'bob' };
const C = { id: 'cccccccc-0000-4000-8000-000000000003', email: 'carol@example.test', password: 'pw-carol-123', username: 'carol' };
const ACCEPTED = { terms_accepted_at: '2026-09-01T00:00:00Z', privacy_accepted_at: '2026-09-01T00:00:00Z' };

function seedBackend() {
  const profile = (u, tier) => ({ id: u.id, username: u.username, tier, username_changed_at: null, ...ACCEPTED });
  const rv = (u, n) => Array.from({ length: n }, (_, i) => ({
    id: Number(u.id.slice(-1)) * 1000 + i, user_id: u.id, session_type: 'personal', trn: `${u.username}-RV${i}`,
    target_id: 1, target_src: 'targets/x.jpg', target_label: 'x', category: 'nature', score: 50 + i,
    dimension_scores: {}, hits: [], noise: [], aol: [], summary: '', notes: '', duration: 60, sketch_data: null,
    timestamp: `2026-09-2${i}T12:00:00Z`, tags: [],
  }));
  return {
    users: [A, B, C].map(u => ({ id: u.id, email: u.email, password: u.password })),
    tables: {
      profiles: [profile(A, 'premium'), profile(B, 'free'), profile(C, 'free')],
      user_settings: [], zener_runs: [], ts_trials: [],
      rv_sessions: [...rv(A, 2), ...rv(B, 3)],
    },
  };
}

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/' || p === '/app') p = '/app.html';
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.txt': 'text/plain' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('PASS  ' + name); }
  catch (e) { results.push(['FAIL', name]); console.log('FAIL  ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 6).join('\n      ')); }
}

async function main() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    console.log('SKIP  Chromium could not be launched: ' + e.message.split('\n')[0]);
    server.close();
    process.exit(77);
  }

  async function newDevice() {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const grade = { hold: null, calls: 0, assigned: 0 };
    await context.addInitScript(() => {
      // Run as the installed PWA, past the first-run splash and onboarding.
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q)
        ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
        : mm(q));
      if (!localStorage.getItem('ablty_onboarded')) localStorage.setItem('ablty_onboarded', '1');
      if (!localStorage.getItem('ablty_splash')) localStorage.setItem('ablty_splash', '1');
      window.confirm = () => true;
    });
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      if (url.includes('@supabase/supabase-js')) return route.fulfill({ contentType: 'text/javascript', body: FAKE_SUPABASE });
      if (url.includes('abltygrader') && url.endsWith('/grade')) {
        grade.calls++;
        if (grade.hold) await grade.hold.promise;
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
          gestalt_score: 61, dimension_scores: {}, hits: ['water'], noise: [], aol: [], summary: 'graded',
          target: { id: 'T001', src: 'targets/x.jpg', label: 'Lake', category: 'nature' },
        }) });
      }
      if (url.includes('abltygrader') && url.endsWith('/rv-assign')) {
        grade.assigned++;
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
          assignment_id: 'asg-' + grade.assigned, trn: `${4000 + grade.assigned}-${5000 + grade.assigned}`,
        }) });
      }
      if (url.includes('abltygrader')) return route.fulfill({ contentType: 'application/json', body: '{}' });
      if (url.endsWith('.js')) return route.fulfill({ contentType: 'text/javascript', body: '' });
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', e => { page.errors = (page.errors || []).concat(String(e)); });
    const load = async () => {
      await page.goto(base + '/app.html');
      await page.waitForFunction(() => typeof ACAD !== 'undefined' && typeof handleLogin === 'function');
      await settle();
    };
    const settle = async () => { await page.waitForTimeout(150); };
    return { context, page, grade, load, settle };
  }

  // ── in-page helpers ────────────────────────────────
  const snapshot = (page) => page.evaluate(() => {
    ACAD.renderLanding();
    renderAnalytics();
    const text = (id) => (document.getElementById(id)?.textContent || '').trim();
    const owned = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('ablty_owned:')) owned[k] = localStorage.getItem(k);
    }
    return {
      owner: _dataOwner,
      loggedIn: localStorage.getItem('ablty_logged_in') === '1',
      username: localStorage.getItem('ablty_username'),
      academy: JSON.parse(JSON.stringify(ACAD.progress)),
      // What the Academy landing shows: the fresh first-visit copy, or the stat boxes.
      landing: (() => {
        const root = document.getElementById('acad-landing-root');
        const stats = [...root.querySelectorAll('.acad-statbox')]
          .map(b => b.querySelector('.acad-sv').textContent + ' ' + b.querySelector('.acad-sl').textContent);
        return stats.length ? stats.join(' | ') : root.textContent.replace(/\s+/g, ' ');
      })(),
      rv: STATE.sessions.map(s => s.trn),
      zener: loadZenerSessions().map(r => r.id),
      kpiTotal: text('kpi-total-sessions'),
      kpiSub: text('kpi-total-sessions-sub'),
      kpiDays: text('kpi-active-days'),
      owned,
      unprefixed: ['ablty_sessions', 'ablty_zener', 'ablty_academy_progress'].filter(k => localStorage.getItem(k) !== null),
    };
  });
  // Records Academy progress exactly where ACAD's saveProgress writes it.
  const recordAcademy = (page, done, reps, breaks) => page.evaluate(([done, reps, breaks]) => {
    const p = { done: Object.fromEntries(done.map(id => [id, true])), recaps: {}, reps, breaks };
    store.set(ownedKey(ACAD_PROG_KEY), JSON.stringify(p));
    ACAD.reload();
  }, [done, reps, breaks]);
  const zenerRun = (page, id) => page.evaluate((id) => {
    saveZenerSession({ id, hits: 6, hitPct: 24, symbolStats: {}, timestamp: new Date().toISOString() });
  }, id);
  const startLogin = (page, u) => page.evaluate(([email, pw]) => {
    document.getElementById('login-email').value = email;
    document.getElementById('login-password').value = pw;
    window.__loginDone = false;
    handleLogin().finally(() => { window.__loginDone = true; });
  }, [u.email, u.password]);
  const finishLogin = async (page, guestChoice) => {
    await page.waitForFunction(() => window.__loginDone || document.getElementById('guest-data-modal').classList.contains('visible'));
    const modal = await page.evaluate(() => document.getElementById('guest-data-modal').classList.contains('visible'));
    if (modal) {
      assert.ok(guestChoice, 'guest-data modal appeared unexpectedly');
      await page.click(guestChoice === 'save' ? '#guest-data-save-btn' : '#guest-data-fresh-btn');
    } else {
      assert.ok(!guestChoice, 'expected the guest-data modal (' + guestChoice + ')');
    }
    await page.waitForFunction(() => window.__loginDone);
    await page.waitForTimeout(150);
    return modal;
  };
  const login = async (page, u, guestChoice) => { await startLogin(page, u); return finishLogin(page, guestChoice); };
  const logout = async (page) => { await page.evaluate(() => handleSignOut()); await page.waitForTimeout(150); };
  const backend = (page) => page.evaluate(() => window.__fake.db());
  // Starts a real RV session through the app's own flow: category step,
  // Worker assignment, canvas (which starts the timer), then typed notes.
  const startRV = (page, note) => page.evaluate(async (note) => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('ablty_rv_daily_')) localStorage.removeItem(k);
    }
    localStorage.setItem('ablty_rv_protocol', '1');
    startRVSession();
    await rvGoStep(2);
    openCanvas();
    document.getElementById('imp-form').value = note;
    document.getElementById('imp-color').value = note + ' colour';
    return STATE.currentTRN;
  }, note);
  // Submits the session on screen with the Worker's grade held open.
  const submitHeld = async (page, grade) => {
    let release;
    grade.hold = { promise: new Promise(r => { release = r; }) };
    const before = grade.calls;
    await page.evaluate(() => { window.__submit = submitSession(); });
    await page.waitForFunction(() => document.getElementById('grading-overlay')?.style.display === 'flex');
    for (let i = 0; i < 60 && grade.calls === before; i++) await page.waitForTimeout(50);
    assert.strictEqual(grade.calls, before + 1, 'the grade request is in flight');
    return async () => { grade.hold = null; release(); await page.evaluate(() => window.__submit); await page.waitForTimeout(150); };
  };
  // Everything the RV session on screen consists of.
  const rvScreen = (page) => page.evaluate(() => ({
    screen: currentScreen,
    assignmentId: STATE.currentAssignmentId,
    trn: STATE.currentTRN,
    notes: ['imp-form', 'imp-texture', 'imp-motion', 'imp-emotion', 'imp-color'].map(id => document.getElementById(id).value),
    trnDisplay: document.getElementById('trn-display').textContent,
    canvasTrn: document.getElementById('canvas-trn').textContent,
    timerRunning: STATE.timerInterval,
    timerSeconds: STATE.timerSeconds,
    overlay: document.getElementById('grading-overlay').style.display,
    targetReveal: document.getElementById('target-reveal').getAttribute('src'),
    resultTrn: document.getElementById('result-trn-label').textContent,
    resultsHtml: document.getElementById('screen-results').innerHTML.length,
    history: STATE.sessions.map(x => x.trn + ':' + x.score),
    storedHistory: localStorage.getItem(ownedKey('ablty_sessions')),
  }));
  const assertUntouched = (before, after) => {
    const { timerSeconds: t0, ...b } = before;
    const { timerSeconds: t1, ...a } = after;
    assert.deepStrictEqual(a, b);
    assert.ok(t1 >= t0, 'timer kept counting, not reset');
  };
  const storedFor = (page, owner) => page.evaluate((owner) =>
    JSON.parse(localStorage.getItem(ownedKeyFor(owner, 'ablty_sessions')) || '[]').map(x => x.trn + ':' + x.score), owner);

  // ═════════════════════════════════════════════════
  // 1. A -> logout -> guest -> B -> A, with refreshes
  // ═════════════════════════════════════════════════
  {
    const { page, load } = await newDevice();
    await page.goto(base + '/app.html');
    await page.evaluate((db) => localStorage.setItem('__fake_backend', JSON.stringify(db)), seedBackend());
    await load();

    await step('fresh device starts as an empty guest with the sample analytics', async () => {
      const s = await snapshot(page);
      assert.strictEqual(s.owner, 'guest');
      assert.strictEqual(s.kpiTotal, '47');
      assert.strictEqual(s.kpiSub, 'Example data');
      assert.ok(/Begin Lesson 01/.test(s.landing));
    });

    await step('account A signs in (no guest data, no prompt) and sees only its own cloud rows', async () => {
      await login(page, A);
      const s = await snapshot(page);
      assert.strictEqual(s.owner, A.id);
      assert.strictEqual(s.username, 'alice');
      assert.deepStrictEqual(s.rv.sort(), ['alice-RV0', 'alice-RV1']);
    });

    await step('A trains: Academy progress and a Zener run are recorded for A', async () => {
      await recordAcademy(page, ['01', '02'], 3, 1);
      await zenerRun(page, 111);
      const s = await snapshot(page);
      assert.ok(/2 lessons done/.test(s.landing) && /3 blind reps/.test(s.landing), s.landing);
      assert.deepStrictEqual(s.zener, [111]);
      assert.strictEqual(s.kpiTotal, '3');
      assert.ok((await backend(page)).tables.zener_runs.some(r => r.id === 111 && r.user_id === A.id), 'A\'s run synced under A');
    });

    await step('refresh while signed in as A keeps A\'s data', async () => {
      await load();
      const s = await snapshot(page);
      assert.strictEqual(s.owner, A.id);
      assert.ok(/2 lessons done/.test(s.landing), s.landing);
      assert.deepStrictEqual(s.zener, [111]);
    });

    await step('logout: Academy, sessions and stats show nothing of A; analytics is the guest sample', async () => {
      await logout(page);
      const s = await snapshot(page);
      assert.strictEqual(s.owner, 'guest');
      assert.strictEqual(s.loggedIn, false);
      assert.deepStrictEqual(s.academy, { done: {}, reps: 0, breaks: 0, recaps: {} });
      assert.ok(/Begin Lesson 01/.test(s.landing), s.landing);
      assert.deepStrictEqual(s.rv, []);
      assert.deepStrictEqual(s.zener, []);
      assert.strictEqual(s.kpiTotal, '47');
      assert.strictEqual(s.kpiSub, 'Example data');
      // A's copy is still on the device, untouched.
      assert.ok(s.owned[`ablty_owned:${A.id}:ablty_academy_progress`]);
      assert.ok(s.owned[`ablty_owned:${A.id}:ablty_zener`]);
      assert.ok(!Object.keys(s.owned).some(k => k.startsWith('ablty_owned:guest:')), 'guest copy is empty');
    });

    await step('refresh while signed out stays an empty guest', async () => {
      await load();
      const s = await snapshot(page);
      assert.strictEqual(s.owner, 'guest');
      assert.ok(/Begin Lesson 01/.test(s.landing));
      assert.deepStrictEqual(s.zener, []);
    });

    await step('guest trains: guest Academy lesson 01 and one guest Zener run', async () => {
      await recordAcademy(page, ['01'], 1, 0);
      await zenerRun(page, 222);
      const s = await snapshot(page);
      assert.ok(/1 lessons done/.test(s.landing), s.landing);
      assert.deepStrictEqual(s.zener, [222]);
      assert.strictEqual(s.kpiTotal, '47', 'guest analytics stays the sample');
    });

    await step('account B signs in, is offered ONLY the guest data, saves it; sees no trace of A', async () => {
      const prompted = await login(page, B, 'save');
      assert.strictEqual(prompted, true);
      const s = await snapshot(page);
      assert.strictEqual(s.owner, B.id);
      assert.deepStrictEqual(s.academy.done, { '01': true }, 'guest lesson only, not A\'s two lessons');
      assert.strictEqual(s.academy.reps, 1);
      assert.deepStrictEqual(s.zener, [222]);
      assert.deepStrictEqual(s.rv.sort(), ['bob-RV0', 'bob-RV1', 'bob-RV2']);
      assert.strictEqual(s.kpiTotal, '4');
      const db = await backend(page);
      assert.ok(db.tables.zener_runs.some(r => r.id === 222 && r.user_id === B.id), 'guest run uploaded to B');
      assert.ok(!db.tables.zener_runs.some(r => r.id === 111 && r.user_id === B.id), 'A\'s run never offered to B');
      assert.ok(!Object.keys(s.owned).some(k => k.startsWith('ablty_owned:guest:')), 'saved guest data now belongs to B');
    });

    await step('logout B, then guest is empty again', async () => {
      await logout(page);
      const s = await snapshot(page);
      assert.strictEqual(s.owner, 'guest');
      assert.deepStrictEqual(s.academy.done, {});
      assert.deepStrictEqual(s.zener, []);
      assert.deepStrictEqual(s.rv, []);
    });

    await step('account A signs back in: its progress is restored exactly, nothing from B or the guest', async () => {
      await login(page, A);
      const s = await snapshot(page);
      assert.strictEqual(s.owner, A.id);
      assert.deepStrictEqual(s.academy.done, { '01': true, '02': true });
      assert.strictEqual(s.academy.reps, 3);
      assert.strictEqual(s.academy.breaks, 1);
      assert.deepStrictEqual(s.zener, [111]);
      assert.deepStrictEqual(s.rv.sort(), ['alice-RV0', 'alice-RV1']);
      assert.strictEqual(s.kpiTotal, '3');
    });

    await step('refresh as A, then B again after an account switch without logout: each sees only its own', async () => {
      await load();
      let s = await snapshot(page);
      assert.strictEqual(s.owner, A.id);
      assert.deepStrictEqual(s.academy.done, { '01': true, '02': true });
      await login(page, B);
      s = await snapshot(page);
      assert.strictEqual(s.owner, B.id);
      assert.deepStrictEqual(s.academy.done, { '01': true });
      assert.deepStrictEqual(s.zener, [222]);
      assert.deepStrictEqual(s.rv.sort(), ['bob-RV0', 'bob-RV1', 'bob-RV2']);
      await logout(page);
    });

    await step('"Start fresh" clears only the guest copy', async () => {
      await recordAcademy(page, ['01'], 5, 0);
      await zenerRun(page, 333);
      await login(page, C, 'fresh');
      let s = await snapshot(page);
      assert.strictEqual(s.owner, C.id);
      assert.deepStrictEqual(s.academy.done, {});
      assert.deepStrictEqual(s.zener, []);
      assert.ok(!(await backend(page)).tables.zener_runs.some(r => r.id === 333), 'fresh uploads nothing');
      await logout(page);
      s = await snapshot(page);
      assert.deepStrictEqual(s.zener, []);
      assert.ok(s.owned[`ablty_owned:${A.id}:ablty_academy_progress`], 'A untouched');
      assert.ok(s.owned[`ablty_owned:${B.id}:ablty_academy_progress`], 'B untouched');
    });

    await step('no page errors during the run', async () => {
      assert.deepStrictEqual(page.errors || [], []);
    });
  }

  // ═════════════════════════════════════════════════
  // 2. Delayed network responses
  // ═════════════════════════════════════════════════
  {
    const { page, load, grade } = await newDevice();
    await page.goto(base + '/app.html');
    await page.evaluate((db) => localStorage.setItem('__fake_backend', JSON.stringify(db)), seedBackend());
    await load();

    await step('A\'s cloud rows arrive after A signed out: nothing lands in the guest', async () => {
      await page.evaluate((id) => window.__fake.hold('select:rv_sessions:' + id), A.id);
      await startLogin(page, A);
      await page.waitForFunction((id) => window.__fake.wasHit('select:rv_sessions:' + id), A.id);
      await logout(page);
      await page.evaluate((id) => window.__fake.release('select:rv_sessions:' + id), A.id);
      await page.waitForFunction(() => window.__loginDone);
      await page.waitForTimeout(200);
      const s = await snapshot(page);
      assert.strictEqual(s.owner, 'guest');
      assert.deepStrictEqual(s.rv, []);
      assert.ok(!Object.keys(s.owned).some(k => k.startsWith('ablty_owned:guest:')), 'guest copy untouched');
      assert.strictEqual(s.kpiTotal, '47');
    });

    await step('A\'s cloud rows arrive after B took over: nothing lands in B', async () => {
      await login(page, A);
      await page.evaluate((id) => window.__fake.hold('select:rv_sessions:', id), A.id);
      // A background refresh for A is in flight...
      await page.evaluate(() => { window.__refresh = refreshCloudDataCaches(true); });
      await page.waitForFunction(() => window.__fake.wasHit('select:rv_sessions:'));
      // ...B signs in on the same device, then A's delayed rows come back.
      await startLogin(page, B);
      await page.waitForTimeout(100);
      await page.evaluate(() => window.__fake.release('select:rv_sessions:'));
      await page.waitForFunction(() => window.__loginDone);
      await page.evaluate(() => window.__refresh);
      await page.waitForTimeout(200);
      const s = await snapshot(page);
      assert.strictEqual(s.owner, B.id);
      assert.deepStrictEqual(s.rv.sort(), ['bob-RV0', 'bob-RV1', 'bob-RV2']);
      await logout(page);
    });

    await step('a slow RV grading result after sign-out is filed with A, not shown to or synced as the guest', async () => {
      await login(page, A);
      await page.evaluate(() => { STATE.currentAssignmentId = 'asg-1'; STATE.currentTRN = 'SLOW-1'; });
      let release;
      grade.hold = { promise: new Promise(r => { release = r; }) };
      await page.evaluate(() => { window.__submit = submitSession(); });
      await page.waitForFunction(() => document.getElementById('grading-overlay')?.style.display === 'flex');
      await page.waitForTimeout(1200); // past the encoding delay, into the Worker call
      assert.strictEqual(grade.calls, 1);
      await logout(page);
      release();
      await page.evaluate(() => window.__submit);
      await page.waitForTimeout(200);
      const s = await snapshot(page);
      assert.strictEqual(s.owner, 'guest');
      assert.deepStrictEqual(s.rv, [], 'guest does not see A\'s session');
      const aList = JSON.parse(s.owned[`ablty_owned:${A.id}:ablty_sessions`] || '[]');
      assert.ok(aList.some(x => x.trn === 'SLOW-1'), 'the session is kept in A\'s copy');
      const db = await backend(page);
      assert.ok(!db.tables.rv_sessions.some(r => r.trn === 'SLOW-1'), 'not inserted under anyone else');
      grade.hold = null;
      await login(page, A);
      const back = await snapshot(page);
      assert.ok(back.rv.includes('SLOW-1'), 'A sees it after signing back in');
      await logout(page);
    });

    await step('A\'s grade returns after the user switched to B and B started a new RV session: B untouched, A keeps it', async () => {
      await login(page, A);
      const aTrn = await startRV(page, 'alice tower');
      const release = await submitHeld(page, grade);
      await logout(page);
      await login(page, B);
      const bTrn = await startRV(page, 'bob river');
      assert.notStrictEqual(bTrn, aTrn);
      await page.waitForTimeout(1100); // B's timer is running
      const before = await rvScreen(page);
      assert.strictEqual(before.screen, 'canvas');
      assert.ok(before.assignmentId && before.timerRunning);
      await release();
      const after = await rvScreen(page);
      assertUntouched(before, after);
      assert.ok(!after.history.some(h => h.startsWith(aTrn)), 'not in B\'s history');
      assert.ok((await storedFor(page, A.id)).includes(aTrn + ':61'), 'A keeps the graded session');
      const db = await backend(page);
      assert.ok(!db.tables.rv_sessions.some(r => r.trn === aTrn), 'not uploaded under B');
      await page.evaluate(() => stopTimer());
      await logout(page);
      await login(page, A);
      assert.ok((await snapshot(page)).rv.includes(aTrn), 'A sees it after signing back in');
      await logout(page);
    });

    await step('A\'s grade returns after logout and back into A with a new RV session: new session untouched, old result in A\'s history once', async () => {
      await login(page, A);
      const oldTrn = await startRV(page, 'first look');
      const release = await submitHeld(page, grade);
      await logout(page);
      await login(page, A);
      const newTrn = await startRV(page, 'second look');
      await page.waitForTimeout(1100);
      const before = await rvScreen(page);
      await release();
      const after = await rvScreen(page);
      const { history: h0, storedHistory: s0, ...b } = before;
      const { history: h1, storedHistory: s1, ...a } = after;
      assertUntouched(b, a);
      assert.strictEqual(after.trn, newTrn);
      assert.deepStrictEqual(h1, [oldTrn + ':61', ...h0], 'old result added once, nothing else changed');
      assert.ok((await storedFor(page, A.id)).includes(oldTrn + ':61'));
      const db = await backend(page);
      assert.strictEqual(db.tables.rv_sessions.filter(r => r.trn === oldTrn && r.user_id === A.id).length, 1, 'synced under A once');
      await page.evaluate(() => stopTimer());
      await logout(page);
    });

    await step('A\'s grade returns after A started a newer RV session (no auth change): newer session untouched', async () => {
      await login(page, A);
      const oldTrn = await startRV(page, 'older');
      const release = await submitHeld(page, grade);
      const newTrn = await startRV(page, 'newer');
      await page.waitForTimeout(1100);
      const before = await rvScreen(page);
      await release();
      const after = await rvScreen(page);
      const { history: h0, storedHistory: s0, ...b } = before;
      const { history: h1, storedHistory: s1, ...a } = after;
      assertUntouched(b, a);
      assert.strictEqual(after.trn, newTrn);
      assert.deepStrictEqual(h1, [oldTrn + ':61', ...h0]);
      assert.ok((await storedFor(page, A.id)).includes(oldTrn + ':61'));
      await page.evaluate(() => stopTimer());
      await logout(page);
    });

    await step('control: an undisturbed submit still shows its result and clears its assignment', async () => {
      await login(page, A);
      const trn = await startRV(page, 'normal');
      const release = await submitHeld(page, grade);
      await release();
      const s = await rvScreen(page);
      assert.strictEqual(s.overlay, 'none');
      assert.ok(/targets\/x\.jpg$/.test(s.targetReveal));
      assert.strictEqual(s.assignmentId, null);
      assert.strictEqual(s.history[0], trn + ':61');
      await logout(page);
    });

    await step('no page errors during delayed-response checks', async () => {
      assert.deepStrictEqual(page.errors || [], []);
    });
  }

  // ═════════════════════════════════════════════════
  // 3. Upgrading a device that has pre-ownership data
  // ═════════════════════════════════════════════════
  const legacyDevice = async (seed) => {
    const dev = await newDevice();
    await dev.page.goto(base + '/robots.txt');
    await dev.page.evaluate(([db, seed]) => {
      localStorage.clear();
      localStorage.setItem('__fake_backend', JSON.stringify(db));
      Object.entries(seed).forEach(([k, v]) => localStorage.setItem(k, v));
    }, [seedBackend(), seed]);
    await dev.load();
    return dev;
  };
  const legacyProgress = JSON.stringify({ done: { '01': true, '02': true, '03': true }, recaps: {}, reps: 7, breaks: 2 });
  const tokenFor = (u) => JSON.stringify({ access_token: 'tok-legacy', refresh_token: 'r', user: { id: u.id, email: u.email } });

  await step('legacy, signed in as A at upgrade: the data becomes A\'s; logout shows an empty guest', async () => {
    const { page, context } = await legacyDevice({
      ablty_academy_progress: legacyProgress, ablty_logged_in: '1', ablty_cache_user_id: A.id,
      ablty_username: 'alice', ablty_tier: 'premium',
      'sb-ghjajyxcjfqidcmqdzdp-auth-token': tokenFor(A),
      ablty_legal_verified: JSON.stringify({ userId: A.id, version: '2026-07-19', at: 'x' }),
    });
    let s = await snapshot(page);
    assert.strictEqual(s.owner, A.id);
    assert.strictEqual(s.academy.reps, 7);
    assert.deepStrictEqual(s.unprefixed, []);
    await logout(page);
    s = await snapshot(page);
    assert.deepStrictEqual(s.academy.done, {});
    await login(page, A);
    s = await snapshot(page);
    assert.strictEqual(s.academy.reps, 7);
    await context.close();
  });

  await step('legacy, signed out, no account ever used the device: it stays the guest\'s', async () => {
    const { page, context } = await legacyDevice({ ablty_academy_progress: legacyProgress });
    const s = await snapshot(page);
    assert.strictEqual(s.owner, 'guest');
    assert.strictEqual(s.academy.reps, 7);
    assert.deepStrictEqual(s.unprefixed, []);
    await context.close();
  });

  await step('legacy, signed out after A used the device: hidden from the guest and B, restored to A', async () => {
    const { page, context } = await legacyDevice({
      ablty_academy_progress: legacyProgress,
      ablty_rv_cloud_cache: '[]',
      [`ablty_guest_sync_done_${A.id}`]: '1',
      [`ablty_guest_sync_done_${B.id}`]: '1',
      ablty_legal_verified: JSON.stringify({ userId: A.id, version: '2026-07-19', at: 'x' }),
    });
    let s = await snapshot(page);
    assert.strictEqual(s.owner, 'guest');
    assert.deepStrictEqual(s.academy.done, {}, 'unknown-owner data is not shown to the guest');
    assert.ok(s.unprefixed.includes('ablty_academy_progress'), 'kept, not deleted');
    await login(page, B);
    s = await snapshot(page);
    assert.deepStrictEqual(s.academy.done, {}, 'B does not receive it');
    await logout(page);
    await login(page, A);
    s = await snapshot(page);
    assert.strictEqual(s.academy.reps, 7, 'A, the last verified account on the device, gets it back');
    assert.deepStrictEqual(s.unprefixed, []);
    await logout(page);
    s = await snapshot(page);
    assert.deepStrictEqual(s.academy.done, {});
    await context.close();
  });

  await step('legacy, signed out, several accounts and no record of the last one: nobody claims it automatically', async () => {
    const { page, context } = await legacyDevice({
      ablty_academy_progress: legacyProgress,
      [`ablty_guest_sync_done_${A.id}`]: '1',
      [`ablty_guest_sync_done_${B.id}`]: '1',
    });
    await login(page, A);
    let s = await snapshot(page);
    assert.deepStrictEqual(s.academy.done, {});
    assert.ok(s.unprefixed.includes('ablty_academy_progress'), 'still parked, never deleted');
    await context.close();
  });

  await browser.close();
  server.close();
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
