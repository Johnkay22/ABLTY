// Full app in Chromium with local assets and fake network edges. No live users.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { loadBlindWorker, root } = require('./helpers/blind-worker');
const api = loadBlindWorker(() => { throw new Error('No external calls allowed'); });
const receipt = { candidate_ids: ['T001','T002','T003','T004','T005'], target_index: 1,
  rubric: 'seven-dimensions-v1',
  score_matrix: [[1,1,1,1,1,1,1],[4,4,4,4,4,4,4],[4,4,4,4,4,4,4],[0,0,0,0,0,0,0],[2,2,2,2,2,2,2]], trn: '1234-5678' };
const result = JSON.parse(JSON.stringify(api.resultFromReceipt(receipt, api.RV_TARGET_POOL)));
const oldResult = JSON.parse(JSON.stringify(api.resultFromReceipt({ ...receipt, rubric: 'six-dimensions-v1', score_matrix: receipt.score_matrix.map(row => row.slice(0, 6)) }, api.RV_TARGET_POOL)));
let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log('PASS ' + name); }

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://test').pathname);
    if (!file.startsWith(root + '/') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  try {
    for (const width of [390, 412]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
      let calls = 0; let submitted; let fail = false; let assigned = 0; let gradeHold = null;
      // Like the Worker: each assignment is its own receipt, results name it,
      // and the same assignment and writing again is a replay.
      const graded = new Map();
      await context.addInitScript(() => {
        const mm = window.matchMedia.bind(window);
        window.matchMedia = q => /display-mode:\s*standalone/.test(q) ? { matches: true, addEventListener() {}, removeEventListener() {} } : mm(q);
        localStorage.setItem('ablty_onboarded', '1'); localStorage.setItem('ablty_splash', '1'); localStorage.setItem('ablty_guest_mode', '1'); localStorage.setItem('ablty_rv_protocol', '1');
      });
      await context.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(base)) return route.continue();
        if (url.includes('@supabase/supabase-js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(root, 'tests/helpers/fake-supabase.js'), 'utf8') });
        if (url.endsWith('/rv-assign')) return route.fulfill({ json: { assignment_id: 'b' + String(++assigned).padStart(32, '0'), trn: '1234-5678', judging_protocol: 'blind-five-v1' } });
        if (url.endsWith('/grade')) {
          calls++; submitted = route.request().postDataJSON();
          const body = submitted;
          const answer = () => {
            if (fail) return { grading_failed: true, retryable: true, target: null, grading_error: 'Test service unavailable' };
            const replayed = graded.get(body.assignment_id) === body.notes;
            graded.set(body.assignment_id, body.notes);
            const linked = { ...result, blind_judging: { ...result.blind_judging, assignment_id: body.assignment_id } };
            return replayed ? { ...linked, receipt_replayed: true } : linked;
          };
          if (gradeHold) return gradeHold.then(() => route.fulfill({ json: answer() }));
          return route.fulfill({ json: answer() });
        }
        if (url.endsWith('.js')) return route.fulfill({ contentType: 'text/javascript', body: '' });
        return route.abort();
      });
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/app.html');
      await page.waitForFunction(() => typeof STATE !== 'undefined' && typeof startRVSession === 'function');
      await page.waitForFunction(() => document.getElementById('splash-screen').style.display === 'none');
      await step(width + ': written-only submission, duplicate tap ignored, tied rank shown', async () => {
        await page.evaluate(async () => {
          startRVSession(); await rvGoStep(2); openCanvas();
          await new Promise(r => setTimeout(r, 100));
          document.getElementById('imp-form').value = 'Curved arch, large open space';
          document.getElementById('imp-texture').value = 'Rough surface';
          await Promise.all([submitSession(), submitSession()]);
        });
        assert.equal(calls, 1); assert.equal(submitted.sketch, '');
        assert.match(submitted.notes, /Curved arch/); assert.match(submitted.notes, /Rough surface/);
        assert.equal(await page.textContent('#score-pct'), '1/5');
        assert.equal(await page.textContent('#result-score-label'), 'Tied rank');
        assert.equal(await page.locator('#result-blind-judging .blind-candidate').count(), 5);
        assert.match(await page.textContent('#result-blind-judging'), /tied at rank 1 of 5/);
        assert.match(await page.textContent('#result-blind-judging'), /Sensory impression: 4 \/ 5/);
        assert.equal(await page.locator('#result-blind-judging details').first().locator('div').count(), 7);
      });
      await step(width + ': rankings survive local history reload and cloud row mapping', async () => {
        const mapped = await page.evaluate(() => mapRVSessionRow(STATE.sessions[0]));
        const firstReceipt = 'b' + '1'.padStart(32, '0');
        assert.deepEqual(mapped.blind_judging, { ...result.blind_judging, assignment_id: firstReceipt });
        assert.equal(mapped.blind_receipt_id, firstReceipt, 'successful session saves its receipt id');
        await page.reload(); await page.waitForFunction(() => document.getElementById('splash-screen').style.display === 'none');
        await page.evaluate(() => openSessionDetail('rv', STATE.sessions[0].id));
        assert.equal(await page.locator('#detail-blind-judging .blind-candidate').count(), 5);
        assert.equal(await page.textContent('#detail-score-pct'), '1/5');
        assert.match(await page.textContent('#detail-notes-card'), /Rough surface/);
        assert.match(await page.textContent('#detail-dimensions'), /Sensory Impression/);
        assert.equal(await page.locator('#detail-blind-judging details').first().locator('div').count(), 7);
      });
      await step(width + ': older six-dimension history retains scores and has no invented sensory rating', async () => {
        await page.evaluate(old => {
          renderResults(old, old.target, 'Synthetic older session');
          renderRVDetail({ ...old, score: old.overall_score, timestamp: new Date().toISOString() });
        }, oldResult);
        assert.match(await page.textContent('#result-blind-judging'), /80\/100 correspondence/);
        assert.equal(await page.locator('#result-blind-judging details').first().locator('div').count(), 6);
        assert.equal(await page.locator('#detail-blind-judging details').first().locator('div').count(), 6);
        assert.ok(!(await page.textContent('#detail-dimensions')).includes('Sensory'));
        assert.equal(await page.textContent('#detail-score-label'), 'Tied rank');
      });
      await step(width + ': sensory averages omit older unmeasured sessions instead of counting them as zero', async () => {
        const text = await page.evaluate(({ old, current }) => {
          buildDimStrengths([old, current]);
          return document.getElementById('dim-strength-wrap').textContent;
        }, { old: oldResult, current: result });
        assert.match(text, /Sensory Impression\s+4\/5/);
        await page.evaluate(old => buildDimStrengths([old, old]), oldResult);
        assert.ok(!(await page.textContent('#dim-strength-wrap')).includes('Sensory'));
      });
      await step(width + ': legacy results stay labelled and are excluded from blind trends', async () => {
        const compared = await page.evaluate(() => {
          const old = { id: 12, score: 99, notes: 'old', timestamp: new Date().toISOString(), dimension_scores: {} };
          const ids = comparableRVSessions([old, STATE.sessions[0]]).map(s => s.id);
          renderRVDetail(old); return ids;
        });
        assert.equal(compared.length, 1);
        assert.equal(await page.textContent('#detail-score-label'), 'Legacy match');
        assert.equal(await page.locator('#detail-blind-judging').isVisible(), false);
      });
      await step(width + ': HTML-like data and hostile image URLs never execute', async () => {
        await page.evaluate(result => {
          window.__injected = false;
          const bad = structuredClone(result);
          bad.blind_judging.candidates[0].src = 'x" onerror="window.__injected=true';
          renderResults(bad, bad.target, '<img src=x onerror="window.__injected=true">');
        }, result);
        assert.equal(await page.locator('#result-notes-card img').count(), 0);
        assert.equal(await page.evaluate(() => window.__injected), false);
        assert.equal(await page.locator('#result-blind-judging .blind-candidate').count(), 0);
      });
      await step(width + ': failed written-only session retries and reveals target only after success', async () => {
        fail = true;
        await page.evaluate(async () => {
          for (const key of Object.keys(localStorage)) if (key.startsWith('ablty_rv_daily_')) localStorage.removeItem(key);
          startRVSession(); await rvGoStep(2); openCanvas(); await new Promise(r => setTimeout(r, 100));
          document.getElementById('imp-form').value = 'Second written session'; await submitSession();
          openSessionDetail('rv', STATE.sessions[0].id);
        });
        assert.equal(await page.getAttribute('#detail-target-img', 'src'), '');
        assert.equal(await page.locator('#detail-retry-card button').isVisible(), true);
        fail = false;
        const failedRow = await page.evaluate(() => mapRVSessionRow(STATE.sessions[0]));
        assert.equal(failedRow.blind_receipt_id, null, 'failed session has no receipt link');
        assert.match(failedRow.blind_judging.assignment_id, /^b0{31}2$/);
        await page.evaluate(async () => retryGrading(STATE.sessions[0].id));
        assert.equal(await page.evaluate(() => mapRVSessionRow(STATE.sessions[0]).blind_receipt_id), failedRow.blind_judging.assignment_id,
          'retry path saves the receipt id');
        assert.equal(await page.getAttribute('#detail-target-img', 'src'), result.target.src);
        assert.equal(await page.locator('#detail-blind-judging .blind-candidate').count(), 5);
        assert.equal(await page.locator('#detail-retry-card button').count(), 1);
        assert.equal(await page.locator('#detail-retry-card').isVisible(), false);
      });
      await step(width + ': mobile result cards fit and switching protocols clears them', async () => {
        await page.evaluate(() => openSessionDetail('rv', STATE.sessions[0].id));
        await page.waitForTimeout(800);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        const artifacts = process.env.ABLTY_TEST_ARTIFACTS || '/workspace/artifacts/blind-judging';
        fs.mkdirSync(artifacts, { recursive: true });
        await page.screenshot({ path: `${artifacts}/results-${width}.png` });
        await page.evaluate(() => renderZenerDetail({ timestamp: new Date().toISOString(), hitPct: 20, hits: 5, symbolStats: {} }));
        assert.equal(await page.locator('#detail-blind-judging').isVisible(), false);
        assert.deepEqual(errors, []);
      });
      await step(width + ': real cloud-loading function restores rankings only for the active owner', async () => {
        await page.evaluate(async () => {
          const owner = 'aaaaaaaa-0000-4000-8000-000000000001';
          const row = { ...mapRVSessionRow(STATE.sessions[0]), user_id: owner };
          // Older rows saved before the receipt link: no blind_receipt_id at all.
          const legacy = { id: 11, user_id: owner, trn: '1111-2222', score: 70, notes: 'older legacy', timestamp: '2026-09-01T12:00:00Z' };
          const six = { ...row, id: 12, timestamp: '2026-10-01T12:00:00Z',
            blind_judging: { ...row.blind_judging, rubric: 'six-dimensions-v1', assignment_id: undefined } };
          delete six.blind_receipt_id;
          localStorage.setItem('__fake_backend', JSON.stringify({ users: [], tables: { rv_sessions: [row, legacy, six], zener_runs: [], ts_trials: [] } }));
          localStorage.setItem('sb-ghjajyxcjfqidcmqdzdp-auth-token', JSON.stringify({ user: { id: owner }, access_token: 'synthetic-test-only' }));
          beginAuthContext(owner); _dataOwner = owner; STATE.sessions = [];
          await loadAnalyticsFromCloud(owner);
          window.__restored = STATE.sessions.map(s => ({ id: s.id, assignmentId: s.assignmentId, receipt: mapRVSessionRow(s).blind_receipt_id, score: s.score }));
          window.__receipt = row.blind_receipt_id;
          openSessionDetail('rv', STATE.sessions[0].id);
        });
        const restored = await page.evaluate(() => ({ list: window.__restored, receipt: window.__receipt }));
        assert.equal(restored.list.length, 3, 'old sessions without a receipt id still load');
        assert.equal(restored.list[0].receipt, restored.receipt); assert.equal(restored.list[0].assignmentId, restored.receipt);
        assert.deepEqual(restored.list.slice(1).map(s => [s.id, s.receipt, s.score]), [[12, null, 80], [11, null, 70]]);
        assert.equal(await page.textContent('#detail-score-pct'), '1/5');
        assert.equal(await page.locator('#detail-blind-judging .blind-candidate').count(), 5);
        const count = await page.evaluate(async () => {
          const other = 'bbbbbbbb-0000-4000-8000-000000000002';
          localStorage.setItem('sb-ghjajyxcjfqidcmqdzdp-auth-token', JSON.stringify({ user: { id: other }, access_token: 'synthetic-test-only' }));
          beginAuthContext(other); _dataOwner = other; STATE.sessions = [];
          await loadAnalyticsFromCloud(other); return STATE.sessions.length;
        });
        assert.equal(count, 0);
      });
      await step(width + ': account switch during grading files one linked copy; resubmitting the leftover assignment saves it unlinked', async () => {
        const assignmentId = await page.evaluate(async () => {
          localStorage.removeItem('sb-ghjajyxcjfqidcmqdzdp-auth-token');
          endAuthContext(); _dataOwner = DATA_OWNER_GUEST; reloadOwnedState();
          for (const key of Object.keys(localStorage)) if (key.startsWith('ablty_rv_daily_')) localStorage.removeItem(key);
          startRVSession(); await rvGoStep(2); openCanvas(); await new Promise(r => setTimeout(r, 100));
          document.getElementById('imp-form').value = 'Switch during grading';
          return STATE.currentAssignmentId;
        });
        let release; gradeHold = new Promise(r => { release = r; });
        const before = calls;
        await page.evaluate(() => { window.__switchSubmit = submitSession(); });
        await page.waitForFunction(() => document.getElementById('grading-overlay')?.style.display === 'flex');
        while (calls === before) await page.waitForTimeout(50);
        const other = 'cccccccc-0000-4000-8000-000000000003';
        await page.evaluate(owner => { beginAuthContext(owner); _dataOwner = owner; reloadOwnedState(); }, other);
        gradeHold = null; release();
        const filed = await page.evaluate(async ({ owner, assignmentId }) => {
          await window.__switchSubmit;
          const guest = safeParseArray(localStorage.getItem(ownedKeyFor(DATA_OWNER_GUEST, 'ablty_sessions')))
            .filter(s => s.notes && s.notes.includes('Switch during grading'));
          return { guest: guest.map(s => mapRVSessionRow(s).blind_receipt_id), owner: STATE.sessions.length,
            ownerQueue: readPendingSync(owner).length, leftover: STATE.currentAssignmentId === assignmentId };
        }, { owner: other, assignmentId });
        assert.deepEqual(filed.guest, [assignmentId], 'exactly one copy, filed with the original owner and linked');
        assert.equal(filed.owner, 0); assert.equal(filed.ownerQueue, 0);
        assert.equal(filed.leftover, true, 'the assignment is still loaded, so the same writing can be resubmitted');
        const copy = await page.evaluate(async () => {
          openCanvas(); await new Promise(r => setTimeout(r, 100));
          document.getElementById('imp-form').value = 'Switch during grading';
          await submitSession();
          return { receipt: mapRVSessionRow(STATE.sessions[0]).blind_receipt_id, ranks: getBlindJudging(STATE.sessions[0])?.candidates.length };
        });
        assert.equal(copy.receipt, null, 'the replayed second copy saves a null receipt id');
        assert.equal(copy.ranks, 5, 'it still shows its ranking');
        assert.deepEqual(errors, []);
      });
      await context.close();
    }
    console.log(passed + ' browser checks passed');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
