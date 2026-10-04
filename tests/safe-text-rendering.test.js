// Runs the real RV results and session-detail renderers from app.html against
// a fake DOM and checks that text typed by the viewer (notes) and text written
// by the grader (score reasoning, hits, noise, AOL, error reason) is shown as
// characters, never as markup.
// Run with:  node tests/safe-text-rendering.test.js
const vm = require('vm');
const assert = require('assert');
const { html, extractFn } = require('./helpers/extract-app-source');

const FNS = ['escapeHtml', 'renderHitListHtml', 'getRVSessionScore', 'isRVGradingFailed', 'setEl', 'renderResults', 'renderRVDetail'];
const source = FNS.map(extractFn).join('\n\n');
new vm.Script(source);

function makeEl(id) {
  const classes = new Set();
  return {
    id, innerHTML: '', textContent: '', src: '', style: {}, className: '',
    parentNode: { insertBefore() {} }, nextSibling: null,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
  };
}

function makeCtx() {
  const els = {};
  const get = (id) => { if (!(id in els)) els[id] = makeEl(id); return els[id]; };
  const ctx = {
    document: {
      getElementById: get,
      querySelector: (sel) => get('qs:' + sel),
      createElement: () => makeEl('created'),
    },
    setTimeout: () => 0, setInterval: () => 0, clearInterval() {},
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return { ctx, els, get };
}

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const textOf = (markup) => markup.replace(/<[^>]*>/g, '');

const HOSTILE = '<img src=x onerror="alert(1)"> & <b>bold</b> "quoted" it\'s';
let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log('PASS  ' + name); }

test('results screen shows viewer notes as text, keeps line breaks', () => {
  const { ctx, els } = makeCtx();
  const notes = 'line one\n' + HOSTILE + '\nline three';
  ctx.renderResults({ gestalt_score: 50, hits: [], noise: [], aol: [] }, {}, notes);
  const out = els['result-notes-card'].innerHTML;
  assert.ok(!out.includes('<img'), 'no raw <img> tag');
  assert.ok(!out.includes('<b>'), 'no raw <b> tag');
  assert.ok(out.includes('white-space:pre-wrap'), 'pre-wrap layout kept');
  assert.ok(out.includes('\n'), 'newlines kept');
  assert.strictEqual(decode(textOf(out)), 'Your Impressions' + notes, 'text round-trips exactly');
});

test('results screen shows grader data points and error reason as text', () => {
  const { ctx, els } = makeCtx();
  ctx.renderResults({ gestalt_score: 70, hits: [HOSTILE], noise: ['<i>n</i>'], aol: ['<u>a</u>'] }, {}, '');
  const list = els['hit-list'].innerHTML;
  assert.ok(!list.includes('<img') && !list.includes('<i>') && !list.includes('<u>'), 'data points escaped');
  assert.strictEqual((list.match(/class="hit-item"/g) || []).length, 3, 'three rows rendered');
  assert.ok(list.includes('hit-badge hit') && list.includes('hit-badge noise') && list.includes('hit-badge aol'), 'badges kept');

  ctx.renderResults({ grading_failed: true, grading_error: '<script>x()</script> timed out' }, {}, '');
  const err = els['rv-grade-error'].innerHTML;
  assert.ok(!err.includes('<script>'), 'error reason escaped');
  assert.ok(err.includes('Reason: &lt;script&gt;'), 'reason prefix kept');
});

test('results screen score reasoning uses textContent', () => {
  const { ctx, els } = makeCtx();
  ctx.renderResults({ gestalt_score: 60, score_reasoning: HOSTILE }, {}, '');
  assert.strictEqual(els['score-reasoning-text'].textContent, HOSTILE);
  assert.strictEqual(els['score-reasoning-text'].innerHTML, '');
});

test('session detail shows notes, reasoning, data points and dimension labels as text', () => {
  const { ctx, els } = makeCtx();
  const s = {
    id: 1, timestamp: new Date().toISOString(), score: 55, notes: HOSTILE, score_reasoning: HOSTILE,
    summary: HOSTILE, hits: [HOSTILE], noise: [], aol: [HOSTILE], sketchData: 'data:x', targetSrc: 't.jpg',
    dimension_scores: { '<x>': '<y>', geometric_form: 4 },
  };
  ctx.renderRVDetail(s);
  for (const id of ['detail-notes-card', 'detail-reasoning-card', 'detail-hit-list', 'detail-dimensions']) {
    const out = els[id].innerHTML;
    assert.ok(!out.includes('<img') && !out.includes('<b>') && !out.includes('<x>') && !out.includes('<y>'), id + ' escaped');
  }
  assert.strictEqual(decode(textOf(els['detail-notes-card'].innerHTML)), 'Your Impressions' + HOSTILE);
  assert.strictEqual(decode(textOf(els['detail-reasoning-card'].innerHTML)), 'Next Session Tip' + HOSTILE);
  assert.strictEqual(els['detail-summary'].textContent, HOSTILE, 'summary already used textContent');
  assert.ok(els['detail-dimensions'].innerHTML.includes('Geometric Form'), 'known dimension label kept');
});

test('plain text with ampersands and quotes is unchanged after rendering', () => {
  const { ctx, els } = makeCtx();
  const notes = 'Rock & water, "cold", it\'s moving > 2 m/s';
  ctx.renderResults({ gestalt_score: 40 }, {}, notes);
  assert.strictEqual(decode(textOf(els['result-notes-card'].innerHTML)), 'Your Impressions' + notes);
});

test('source safeguard: no raw interpolation of notes or grader text remains', () => {
  const bad = [/\$\{notes\}/, /\$\{s\.notes\}/, /\+\s*s\.score_reasoning\s*\+/, /class="hit-text">\$\{[a-z]\}<\/div>/, /\$\{gradingErrorMsg\}/, /\$\{email\}/];
  for (const re of bad) assert.ok(!re.test(html), 'app.html still contains ' + re);
});

console.log(`\n${passed} passed, 0 failed`);
