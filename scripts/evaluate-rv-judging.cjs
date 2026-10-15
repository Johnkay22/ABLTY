// Private, opt-in comparison. Default prints request count and makes NO calls.
// Input: JSON array of {target_id, notes, sketch_path?}, including owner-approved
// matched, mismatched and vague controls. All private input/output stays outside
// the repository. No production Worker, database, account or session is used.
const fs = require('node:fs');
const path = require('node:path');
const { randomInt } = require('node:crypto');
const { loadBlindWorker, root } = require('../tests/helpers/blind-worker');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const casesPath = option('--cases');
if (!casesPath) {
  console.log('Usage: node scripts/evaluate-rv-judging.cjs --cases /private/cases.json --output /private/results.json [--repeats 3] [--rotations 1] [--run-paid]');
  process.exit(0);
}
function outsideRepo(file, existing) {
  const resolved = existing ? fs.realpathSync(file) : path.join(fs.realpathSync(path.dirname(path.resolve(file))), path.basename(file));
  if (resolved === root || resolved.startsWith(root + path.sep)) throw new Error('Private input and output must be outside the repository');
  return resolved;
}
const input = outsideRepo(casesPath, true);
const output = outsideRepo(option('--output', path.join(path.dirname(input), 'judging-results.json')), false);
const repeats = Number(option('--repeats', 3));
const rotations = Number(option('--rotations', 1));
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3 || ![1,5].includes(rotations)) throw new Error('Use 1 to 3 repeats and 1 or 5 rotations');
const cases = JSON.parse(fs.readFileSync(input, 'utf8'));
if (!Array.isArray(cases) || !cases.length || cases.length > 30) throw new Error('Use 1 to 30 private cases');
const api = loadBlindWorker(() => { throw new Error('Worker requests disabled in evaluation'); });
const prepared = cases.map(c => {
  const target = api.RV_TARGET_POOL.find(t => t.id === c.target_id);
  if (!target || typeof c.notes !== 'string' || c.notes.length > 15000) throw new Error('Invalid private case');
  const canonical = api.RV_JUDGING_IMAGES[target.id].canonical;
  const others = api.RV_TARGET_POOL.filter(t => t.id !== canonical && api.RV_JUDGING_IMAGES[t.id]?.canonical === t.id && t.category === target.category);
  for (let i = 0; i < 4; i++) { const j = i + randomInt(others.length - i); [others[i], others[j]] = [others[j], others[i]]; }
  const ids = [canonical, ...others.slice(0, 4).map(t => t.id)];
  for (let i = 4; i > 0; i--) { const j = randomInt(i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  let sketch = '';
  if (c.sketch_path) sketch = fs.readFileSync(outsideRepo(path.resolve(path.dirname(input), c.sketch_path), true)).toString('base64');
  if (!sketch && !c.notes.trim()) throw new Error('Empty private case');
  return { target, canonical, ids, notes: c.notes, sketch };
});
const requestCount = cases.length * repeats * (1 + rotations);
console.log(`Prepared ${cases.length} cases; ${requestCount} model requests (legacy plus blind).`);
if (!args.includes('--run-paid')) { console.log('Dry run only. No API calls made. Paid evaluation requires --run-paid and ABLTY_GEMINI_TEST_KEY in the environment.'); process.exit(0); }
const key = process.env.ABLTY_GEMINI_TEST_KEY;
if (!key) throw new Error('Missing secure ABLTY_GEMINI_TEST_KEY binding; never put a key in arguments or chat');
const inputRate = Number(option('--input-usd-per-million', NaN));
const outputRate = Number(option('--output-usd-per-million', NaN));
const report = { model: 'gemini-2.5-flash', protocol: 'blind-five-v1', created_at: new Date().toISOString(), runs: [] };
function save() { fs.writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600 }); }
async function call(body) {
  const start = performance.now();
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error('Evaluation stopped at provider HTTP ' + response.status + '; private response body not logged');
  const data = await response.json();
  const usage = data.usageMetadata || null;
  const estimatedCost = usage && Number.isFinite(inputRate) && Number.isFinite(outputRate)
    ? ((usage.promptTokenCount || 0) * inputRate + ((usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0)) * outputRate) / 1000000 : null;
  return { data, elapsed_ms: Math.round(performance.now() - start), usage, estimated_usd_at_supplied_rates: estimatedCost };
}
(async () => {
  for (let i = 0; i < prepared.length; i++) {
    const c = prepared[i];
    for (let repeat = 0; repeat < repeats; repeat++) {
      const legacyParts = c.sketch ? [{ inlineData: { mimeType: 'image/jpeg', data: c.sketch } }] : [];
      legacyParts.push({ text: api.buildGradingPrompt(c.notes, c.target.label, c.target.descriptors) });
      const legacy = await call({ contents: [{ parts: legacyParts }], generationConfig: { temperature: 0.2, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } } });
      const old = JSON.parse(legacy.data?.candidates?.[0]?.content?.parts?.[0]?.text.replace(/```json|```/g, '').trim());
      const { data: _legacyData, ...legacyMetrics } = legacy;
      report.runs.push({ case_index: i, repeat, method: 'legacy', score: old.overall_score, ...legacyMetrics }); save();
      for (let rotation = 0; rotation < rotations; rotation++) {
        const ids = c.ids.slice(rotation).concat(c.ids.slice(0, rotation));
        const images = ids.map(id => ({ inlineData: { mimeType: 'image/jpeg', data: fs.readFileSync(path.join(root, api.RV_JUDGING_IMAGES[id].src)).toString('base64') } }));
        const response = await call(api.buildBlindRequest(c.notes, c.sketch, images));
        const numeric = api.parseBlindResponse(response.data);
        const result = api.resultFromReceipt({ candidate_ids: ids, target_index: ids.indexOf(c.canonical), ...numeric, trn: '' }, api.RV_TARGET_POOL);
        const { data: _blindData, ...metrics } = response;
        report.runs.push({ case_index: i, repeat, rotation, method: 'blind', score: result.overall_score,
          rank: result.blind_judging.target_rank, tied: result.blind_judging.tied, candidate_ids: ids, ...numeric, ...metrics }); save();
      }
    }
  }
  console.log('Evaluation complete. Numeric results saved privately; no session content was logged.');
})().catch(() => { save(); console.error('Evaluation stopped. Completed numeric runs are saved; inspect provider access privately before retrying.'); process.exitCode = 1; });
