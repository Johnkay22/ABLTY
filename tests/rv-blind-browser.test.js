// Full app in Chromium with local assets and fake network edges. No live users.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { loadBlindWorker, root } = require('./helpers/blind-worker');
const api = loadBlindWorker(() => { throw new Error('No external calls allowed'); });
const single = [[1,1,1,1,1,1,1],[4,4,4,4,4,4,4],[4,4,4,4,4,4,4],[0,0,0,0,0,0,0],[2,2,2,2,2,2,2]];
// Five rotations. In the last one the two leading photos get a sensory 3, so
// they stay tied with a sensory average of 3.8 (target score 80, Strong match).
const receipt = { candidate_ids: ['T001','T002','T003','T004','T005'], target_index: 1, rubric: 'seven-dimensions-v1',
  rotation_matrices: [0,1,2,3,4].map(k => single.map((row, i) => k === 4 && (i === 1 || i === 2) ? [...row.slice(0, 6), 3] : row)), trn: '1234-5678' };
const result = JSON.parse(JSON.stringify(api.resultFromReceipt(receipt, api.RV_TARGET_POOL)));
const oldResult = JSON.parse(JSON.stringify(api.resultFromReceipt({ ...receipt, rubric: 'six-dimensions-v1', score_matrix: single.map(row => row.slice(0, 6)) }, api.RV_TARGET_POOL)));
// A blind result whose target has the given 0-100 score, rank and tie.
function withTarget(score, rank = 1, tied = false) {
  const copy = structuredClone(result);
  const t = copy.blind_judging.candidates.find(c => c.is_target);
  Object.assign(t, { score, rank, tied });
  Object.assign(copy.blind_judging, { target_rank: rank, tied, unique_first: rank === 1 && !tied });
  copy.overall_score = score;
  return copy;
}
const FEEDBACK = { version: 'feedback-v1', summary: 'You described a curved arch and an open space; both appear in the target.',
  signal: ['You wrote "curved arch"; the target has a large curved arch.', '<b>bold</b> stays text'],
  noise: [], missing: ['The water below the arch.'] };
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
      let feedbackMode = 'ready'; let feedbackCalls = 0;
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
        if (url.endsWith('/rv-feedback')) {
          feedbackCalls++;
          if (feedbackMode === 'missing-then-ready') { feedbackMode = 'ready'; return route.fulfill({ json: { status: 'missing' } }); }
          if (feedbackMode === 'ready') return route.fulfill({ json: { status: 'ready', feedback: FEEDBACK } });
          return route.fulfill({ json: { status: feedbackMode } });
        }
        if (url.endsWith('.js')) return route.fulfill({ contentType: 'text/javascript', body: '' });
        return route.abort();
      });
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/app.html');
      await page.waitForFunction(() => typeof STATE !== 'undefined' && typeof startRVSession === 'function');
      await page.waitForFunction(() => document.getElementById('splash-screen').style.display === 'none');
      await step(width + ': written-only submission shows the score ring, rank line, feedback and no decoys', async () => {
        await page.evaluate(async () => {
          startRVSession(); await rvGoStep(2); openCanvas();
          await new Promise(r => setTimeout(r, 100));
          document.getElementById('imp-form').value = 'Curved arch, large open space';
          document.getElementById('imp-texture').value = 'Rough surface';
          await Promise.all([submitSession(), submitSession()]);
        });
        assert.equal(calls, 1); assert.equal(submitted.sketch, '');
        assert.match(submitted.notes, /Curved arch/); assert.match(submitted.notes, /Rough surface/);
        assert.equal(await page.textContent('#score-pct'), '80');
        assert.equal(await page.locator('#result-score-den').isVisible(), true);
        assert.equal(await page.textContent('#result-score-label'), 'AI match score');
        await page.waitForTimeout(400);
        const offset = await page.evaluate(() => parseFloat(document.getElementById('score-ring').style.strokeDashoffset));
        assert.ok(Math.abs(offset - 364.4 * 0.2) < 0.5, 'ring filled 80%');
        assert.equal(await page.textContent('#result-rank-text'), 'Target tied for 1st out of 5 photos');
        assert.equal(await page.locator('#result-rank-line').isVisible(), true);
        // No decoy photo appears anywhere on the results screen.
        const judgingImgs = await page.evaluate(() => [...document.querySelectorAll('#screen-results img')].filter(i => (i.getAttribute('src') || '').includes('targets/judging/')).length);
        assert.equal(judgingImgs, 0);
        assert.equal(await page.locator('#screen-results .blind-candidate').count(), 0);
        // Written feedback arrives after the score.
        await page.waitForFunction(() => document.querySelectorAll('#result-feedback .rv-fb-card').length === 2);
        assert.equal(await page.textContent('#result-summary'), FEEDBACK.summary);
        assert.match(await page.textContent('#result-feedback'), /SignalMatching details/i);
        assert.match(await page.textContent('#result-feedback'), /curved arch/);
        assert.match(await page.textContent('#result-feedback'), /No clear contradictions identified\./);
        assert.match(await page.textContent('#result-feedback'), /Not addressed in your session: The water below the arch\./);
        assert.equal(await page.locator('#result-feedback b').count(), 0, 'feedback text is never HTML');
        assert.equal(await page.evaluate(() => STATE.sessions[0].feedback.status), 'ready');
        // Collapsed sections: the target's averaged ratings, the impressions, the method.
        const more = await page.locator('#result-more details').count();
        assert.equal(more, 3);
        assert.equal(await page.locator('#result-more .rv-rating-row').count(), 7);
        assert.match(await page.textContent('#result-more'), /Sensory impressions\s*3\.8 \/ 5/);
        assert.match(await page.textContent('#result-more'), /Form and shape\s*4\.0 \/ 5/);
        assert.match(await page.textContent('#result-notes-card'), /Rough surface/);
        assert.match(await page.textContent('#result-more'), /1 time in 5/);
        assert.equal(await page.locator('#rv-data-points-header').isVisible(), false);
        assert.equal(await page.locator('#score-reasoning-card').isVisible(), false);
      });
      await step(width + ': reopened history shows the same score, rank and saved feedback', async () => {
        const mapped = await page.evaluate(() => mapRVSessionRow(STATE.sessions[0]));
        const firstReceipt = 'b' + '1'.padStart(32, '0');
        assert.deepEqual(mapped.blind_judging, { ...result.blind_judging, assignment_id: firstReceipt });
        assert.equal(mapped.blind_receipt_id, firstReceipt, 'successful session saves its receipt id');
        assert.equal(mapped.score, 80);
        assert.equal('feedback' in mapped, false, 'feedback stays off the cloud row');
        await page.reload(); await page.waitForFunction(() => document.getElementById('splash-screen').style.display === 'none');
        const before = feedbackCalls;
        await page.evaluate(() => openSessionDetail('rv', STATE.sessions[0].id));
        assert.equal(await page.textContent('#detail-score-pct'), '80');
        assert.equal(await page.textContent('#detail-score-label'), 'AI match score');
        assert.equal(await page.textContent('#detail-rank-text'), 'Target tied for 1st out of 5 photos');
        assert.equal(await page.textContent('#detail-summary'), FEEDBACK.summary);
        assert.equal(await page.locator('#detail-feedback .rv-fb-card').count(), 2);
        assert.equal(feedbackCalls, before, 'saved feedback is shown without asking again');
        assert.match(await page.textContent('#detail-notes-card'), /Rough surface/);
        assert.equal(await page.locator('#detail-more .rv-rating-row').count(), 7);
        assert.equal(await page.locator('#detail-dimensions-wrap').isVisible(), false);
        assert.equal(await page.locator('#detail-data-points-wrap').isVisible(), false);
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('#screen-detail img')].filter(i => (i.getAttribute('src') || '').includes('targets/judging/')).length), 0);
      });
      await step(width + ': older six-dimension history retains scores and has no invented sensory rating', async () => {
        await page.evaluate(old => {
          renderResults({ ...old, feedback: { status: 'unavailable' } }, old.target, 'Synthetic older session');
          renderRVDetail({ ...old, score: old.overall_score, feedback: { status: 'unavailable' }, timestamp: new Date().toISOString() });
        }, oldResult);
        assert.equal(await page.textContent('#score-pct'), '80');
        assert.equal(await page.locator('#result-more .rv-rating-row').count(), 6);
        assert.equal(await page.locator('#detail-more .rv-rating-row').count(), 6);
        assert.ok(!(await page.textContent('#detail-more')).includes('Sensory'));
        assert.equal(await page.textContent('#detail-score-label'), 'AI match score');
        // Older single-pass ratings stay whole numbers.
        assert.match(await page.textContent('#result-more'), /Form and shape\s*4 \/ 5/);
      });
      await step(width + ': score, rank and summary follow the saved result in every case', async () => {
        const cases = [
          { name: 'first, high', score: 71, rank: 1, tied: false },
          { name: 'first, low', score: 16, rank: 1, tied: false },
          { name: 'second', score: 16, rank: 2, tied: false },
          { name: 'last', score: 3, rank: 5, tied: false },
          { name: 'tied first', score: 40, rank: 1, tied: true },
          { name: 'zero', score: 0, rank: 4, tied: true },
          { name: 'third, fairly high', score: 55, rank: 3, tied: false },
        ];
        const seen = await page.evaluate(async ({ cases, base }) => {
          const out = [];
          for (const c of cases) {
            const judged = structuredClone(base);
            const t = judged.blind_judging.candidates.find(x => x.is_target);
            Object.assign(t, { score: c.score, rank: c.rank, tied: c.tied });
            Object.assign(judged.blind_judging, { target_rank: c.rank, tied: c.tied });
            judged.overall_score = c.score;
            renderResults({ ...judged, feedback: { status: 'unavailable' } }, judged.target, 'Case check');
            await new Promise(r => setTimeout(r, 300));
            out.push({ pct: document.getElementById('score-pct').textContent,
              offset: parseFloat(document.getElementById('score-ring').style.strokeDashoffset),
              rank: document.getElementById('result-rank-text').textContent,
              summary: document.getElementById('result-summary').textContent,
              feedback: document.getElementById('result-feedback').textContent });
          }
          return out;
        }, { cases, base: result });
        assert.deepEqual(seen.map(x => x.pct), cases.map(c => String(c.score)));
        seen.forEach((x, i) => assert.ok(Math.abs(x.offset - 364.4 * (1 - cases[i].score / 100)) < 0.5, cases[i].name + ' ring fill'));
        assert.deepEqual(seen.map(x => x.rank), ['Target ranked 1st out of 5 photos', 'Target ranked 1st out of 5 photos',
          'Target ranked 2nd out of 5 photos', 'Target ranked 5th out of 5 photos', 'Target tied for 1st out of 5 photos',
          'Target tied for 4th out of 5 photos', 'Target ranked 3rd out of 5 photos']);
        for (const x of seen) assert.doesNotMatch(x.rank + x.summary, /\d\/5\b/);
        assert.match(seen[1].summary, /ranked first, but overall correspondence was limited/);
        assert.doesNotMatch(seen[0].summary, /limited/);
        assert.match(seen[6].summary, /another photo fit as well or better/);
        // Unavailable feedback never claims there were no contradictions.
        for (const x of seen) { assert.match(x.feedback, /Detailed feedback unavailable\./); assert.doesNotMatch(x.feedback, /No clear contradictions/); }
      });
      await step(width + ': history list and export show rank and score without strength labels', async () => {
        const seen = await page.evaluate(judged => {
          const saved = STATE.sessions;
          const session = { ...judged, id: 916, score: judged.overall_score, targetLabel: 'Synthetic target', timestamp: new Date().toISOString() };
          STATE.sessions = [session];
          buildCombinedLog([session], []);
          const card = document.querySelector('#combined-log-list .session-card');
          const exported = collectExportRows(['rv'])[0];
          STATE.sessions = saved;
          return { list: card.textContent, cls: card.querySelector('.session-score').className, exported };
        }, withTarget(16, 2));
        assert.match(seen.list, /Blind judged · 2nd of 5 · Synthetic target/);
        assert.match(seen.list, /16\/100/);
        assert.doesNotMatch(seen.list, /Weak|Moderate|Strong/);
        assert.ok(seen.cls.split(' ').includes('high'));
        assert.equal('match_strength' in seen.exported, false);
        assert.equal(seen.exported.target_rank, 2);
        // A legacy result keeps its older look and has no rank line.
        await page.evaluate(() => renderResults({ overall_score: 70, summary: 'old', hits: ['old hit'], noise: [] }, null, 'old'));
        assert.equal(await page.textContent('#score-pct'), '70%');
        assert.equal(await page.textContent('#result-score-label'), 'Legacy match');
        assert.equal(await page.locator('#result-rank-line').isVisible(), false);
        assert.equal(await page.locator('#result-score-den').isVisible(), false);
        assert.equal(await page.locator('#result-feedback').isVisible(), false);
        assert.equal(await page.locator('#hit-list .hit-item').count(), 1);
        assert.match(await page.textContent('#result-more'), /older method that knew the target/);
      });
      await step(width + ': feedback that is not started yet keeps polling instead of being saved as unavailable', async () => {
        const id = await page.evaluate(judged => {
          const s = { ...judged, id: 9301, score: judged.overall_score, notes: 'n', targetSrc: judged.target.src,
            blind_judging: { ...judged.blind_judging, assignment_id: 'b' + '9'.repeat(32) }, timestamp: new Date().toISOString() };
          STATE.sessions.unshift(s); return s.id;
        }, result);
        feedbackMode = 'missing-then-ready';
        const before = feedbackCalls;
        await page.evaluate(id => openSessionDetail('rv', id), id);
        assert.match(await page.textContent('#detail-feedback'), /Writing detailed feedback/);
        await page.waitForFunction(() => document.querySelectorAll('#detail-feedback .rv-fb-card').length === 2, null, { timeout: 8000 });
        assert.equal(feedbackCalls - before, 2, 'asked again after "missing"');
        assert.equal(await page.evaluate(id => STATE.sessions.find(s => s.id === id).feedback.status, id), 'ready');
        // A missing record is never kept as a final answer.
        feedbackMode = 'missing';
        const old = await page.evaluate(judged => {
          const s = { ...judged, id: 9302, score: judged.overall_score, notes: 'n', targetSrc: judged.target.src,
            blind_judging: { ...judged.blind_judging, assignment_id: 'b' + '8'.repeat(32) }, timestamp: '2026-10-01T00:00:00.000Z' };
          STATE.sessions.unshift(s); return s.id;
        }, result);
        const beforeOld = feedbackCalls;
        await page.evaluate(id => openSessionDetail('rv', id), old);
        await page.waitForFunction(() => /Detailed feedback unavailable/.test(document.getElementById('detail-feedback').textContent));
        assert.equal(feedbackCalls - beforeOld, 1, 'an older session asks once');
        assert.equal(await page.evaluate(id => STATE.sessions.find(s => s.id === id).feedback, old), undefined);
        assert.doesNotMatch(await page.textContent('#detail-feedback'), /No clear contradictions/);
        // A stored failure from the Worker is final and kept.
        feedbackMode = 'unavailable';
        await page.evaluate(id => openSessionDetail('rv', id), old);
        await page.waitForFunction(id => STATE.sessions.find(s => s.id === id).feedback?.status === 'unavailable', old);
        await page.evaluate(() => { STATE.sessions = STATE.sessions.filter(s => s.id !== 9301 && s.id !== 9302); saveState(); });
        feedbackMode = 'ready';
      });
      await step(width + ': info button and image enlargement open and close', async () => {
        await page.evaluate(judged => { renderResults({ ...judged, feedback: { status: 'unavailable' } }, judged.target, 'Viewer check'); showScreen('results', false); }, result);
        await page.waitForTimeout(500);
        await page.evaluate(() => { document.getElementById('target-reveal').src = 'targets/' + 'x.jpg'; });
        await page.click('#result-rank-line .rv-score-info-btn');
        assert.equal(await page.locator('#rv-score-info-modal').isVisible(), true);
        assert.match(await page.textContent('#rv-score-info-modal'), /not percentage accuracy, a probability, or proof of ability/);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#rv-score-info-modal').isVisible(), false);
        await page.evaluate(() => openRVImage(document.getElementById('target-reveal')));
        assert.equal(await page.locator('#rv-image-viewer').isVisible(), true);
        assert.match(await page.getAttribute('#rv-image-viewer-img', 'src'), /targets\/x\.jpg$/);
        await page.click('.rv-lightbox-close');
        assert.equal(await page.locator('#rv-image-viewer').isVisible(), false);
        assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('target-reveal')).objectFit), 'contain');
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
        assert.equal(await page.textContent('#detail-score-pct'), '99%');
        assert.equal(await page.locator('#detail-rank-line').isVisible(), false);
        assert.equal(await page.locator('#detail-feedback').isVisible(), false);
      });
      await step(width + ': HTML-like data and hostile image URLs never execute', async () => {
        await page.evaluate(result => {
          window.__injected = false;
          const bad = structuredClone(result);
          bad.blind_judging.candidates[0].src = 'x" onerror="window.__injected=true';
          renderResults(bad, bad.target, '<img src=x onerror="window.__injected=true">');
        }, result);
        assert.equal(await page.locator('#result-notes-card img').count(), 0);
        await page.evaluate(result => renderResults({ ...result, feedback: { status: 'ready', summary: '<img src=x onerror="window.__injected=true">',
          signal: ['<img src=x onerror="window.__injected=true">'], noise: [], missing: [] } }, result.target, 'x'), result);
        assert.equal(await page.locator('#result-feedback img, #result-summary img').count(), 0);
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.__injected), false);
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
        assert.equal(await page.locator('#detail-score-ring-wrap').isVisible(), false, 'no circle without a score');
        assert.equal(await page.locator('#detail-rank-line').isVisible(), false);
        assert.match(await page.textContent('#detail-summary'), /grading failed/i);
        fail = false;
        const failedRow = await page.evaluate(() => mapRVSessionRow(STATE.sessions[0]));
        assert.equal(failedRow.blind_receipt_id, null, 'failed session has no receipt link');
        assert.match(failedRow.blind_judging.assignment_id, /^b0{31}2$/);
        await page.evaluate(async () => retryGrading(STATE.sessions[0].id));
        assert.equal(await page.evaluate(() => mapRVSessionRow(STATE.sessions[0]).blind_receipt_id), failedRow.blind_judging.assignment_id,
          'retry path saves the receipt id');
        assert.equal(await page.getAttribute('#detail-target-img', 'src'), result.target.src);
        assert.equal(await page.locator('#detail-score-ring-wrap').isVisible(), true);
        assert.equal(await page.textContent('#detail-score-pct'), '80');
        await page.waitForFunction(() => document.querySelectorAll('#detail-feedback .rv-fb-card').length === 2);
        assert.equal(await page.locator('#detail-retry-card button').count(), 1);
        assert.equal(await page.locator('#detail-retry-card').isVisible(), false);
      });
      await step(width + ': mobile result cards fit and switching protocols clears them', async () => {
        await page.evaluate(() => openSessionDetail('rv', STATE.sessions[0].id));
        await page.waitForTimeout(800);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        const artifacts = process.env.ABLTY_TEST_ARTIFACTS || '/workspace/artifacts/blind-judging';
        fs.mkdirSync(artifacts, { recursive: true });
        await page.screenshot({ path: `${artifacts}/results-${width}.png`, fullPage: true });
        await page.evaluate(() => renderZenerDetail({ timestamp: new Date().toISOString(), hitPct: 20, hits: 5, symbolStats: {} }));
        assert.equal(await page.locator('#detail-rank-line').isVisible(), false);
        assert.equal(await page.locator('#detail-feedback').isVisible(), false);
        assert.equal(await page.locator('#detail-more').isVisible(), false);
        assert.equal(await page.locator('#detail-score-den').isVisible(), false);
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
        assert.equal(await page.textContent('#detail-score-pct'), '80');
        assert.equal(await page.textContent('#detail-rank-text'), 'Target tied for 1st out of 5 photos');
        // Feedback is not on the cloud row; the restored session fetches it again.
        await page.waitForFunction(() => document.querySelectorAll('#detail-feedback .rv-fb-card').length === 2);
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
