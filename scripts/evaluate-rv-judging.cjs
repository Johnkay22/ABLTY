// Private, opt-in comparison. Default makes no API calls. Private cases and
// numeric reports stay outside the repository; no production sessions are used.
const fs = require('node:fs');
const path = require('node:path');
const { randomInt } = require('node:crypto');
const { loadBlindWorker, root } = require('../tests/helpers/blind-worker');
const MODELS = ['gemini-2.5-flash', 'gemini-3.8-flash'];

function parseOptions(args) {
  const values = {};
  const valueOptions = ['--cases', '--output', '--repeats', '--rotations', '--thinking-budget', '--thinking-level', '--model', '--input-usd-per-million', '--output-usd-per-million'];
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (Object.hasOwn(values, name)) throw new Error('Duplicate option');
    if (name === '--run-paid') values[name] = true;
    else if (valueOptions.includes(name) && args[i + 1] && !args[i + 1].startsWith('--')) values[name] = args[++i];
    else throw new Error('Unknown option or missing value');
  }
  const models = (values['--model'] || MODELS[0]).split(',');
  if (new Set(models).size !== models.length || models.some(m => !MODELS.includes(m))) throw new Error('Use gemini-2.5-flash, gemini-3.8-flash, or both separated by a comma');
  const thinkingBudget = Number(values['--thinking-budget'] ?? 0);
  if (!Number.isSafeInteger(thinkingBudget) || thinkingBudget < 0 || thinkingBudget > 24576) throw new Error('Use a thinking budget between 0 and 24576');
  const thinkingLevel = values['--thinking-level'] || 'medium';
  if (!['low', 'medium', 'high'].includes(thinkingLevel)) throw new Error('Use low, medium or high thinking for Gemini 3.8');
  if (values['--thinking-budget'] !== undefined && !models.includes(MODELS[0])) throw new Error('Thinking budgets apply only to Gemini 2.5; use --thinking-level for Gemini 3.8');
  if (values['--thinking-level'] !== undefined && !models.includes(MODELS[1])) throw new Error('Thinking levels apply only to Gemini 3.8');
  const repeats = Number(values['--repeats'] ?? 3);
  const rotations = Number(values['--rotations'] ?? 1);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3 || ![1, 5].includes(rotations)) throw new Error('Use 1 to 3 repeats and 1 or 5 rotations');
  const inputRate = Number(values['--input-usd-per-million'] ?? NaN);
  const outputRate = Number(values['--output-usd-per-million'] ?? NaN);
  if (['--input-usd-per-million', '--output-usd-per-million'].some(k => values[k] !== undefined && (!Number.isFinite(Number(values[k])) || Number(values[k]) < 0))) throw new Error('Rates must be nonnegative numbers');
  if (models.length > 1 && (Number.isFinite(inputRate) || Number.isFinite(outputRate))) throw new Error('Supply model-specific prices only in a single-model run');
  return { casesPath: values['--cases'], outputPath: values['--output'], models, thinkingBudget, thinkingLevel, repeats, rotations,
    paid: values['--run-paid'] === true, inputRate, outputRate };
}

function outsideRepo(file, existing) {
  const resolved = existing ? fs.realpathSync(file) : path.join(fs.realpathSync(path.dirname(path.resolve(file))), path.basename(file));
  if (resolved === root || resolved.startsWith(root + path.sep)) throw new Error('Private input and output must be outside the repository');
  return resolved;
}

function configureRequest(body, model, options) {
  const request = structuredClone(body);
  const config = request.generationConfig;
  if (model === 'gemini-2.5-flash') {
    config.thinkingConfig = { thinkingBudget: options.thinkingBudget };
    // Thinking shares the output limit. Preserve the original answer allowance.
    config.maxOutputTokens += options.thinkingBudget;
  } else {
    config.thinkingConfig = { thinkingLevel: options.thinkingLevel.toUpperCase() };
    delete config.temperature;
    delete config.topP;
    delete config.topK;
    delete config.candidateCount;
    config.maxOutputTokens = 65536;
  }
  return request;
}

async function runEvaluation(options, { fetchImpl = fetch, env = process.env } = {}) {
  if (!options.casesPath) {
    console.log('Usage: node scripts/evaluate-rv-judging.cjs --cases /private/cases.json --output /private/results.json [--model gemini-2.5-flash,gemini-3.8-flash] [--thinking-budget 0] [--thinking-level medium] [--repeats 3] [--rotations 1] [--run-paid]');
    return;
  }
  const input = outsideRepo(options.casesPath, true);
  const output = outsideRepo(options.outputPath || path.join(path.dirname(input), 'judging-results.json'), false);
  // Never truncate an earlier comparison or overwrite a symlink to another file.
  if (fs.existsSync(output) || fs.lstatSync(output, { throwIfNoEntry: false })) throw new Error('Choose a new private output filename');
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
    if (sketch.length > 5 * 1024 * 1024) throw new Error('Private sketch exceeds the production size limit');
    return { target, canonical, ids, notes: c.notes, sketch };
  });
  const requestCount = cases.length * options.repeats * (1 + options.rotations) * options.models.length;
  console.log(`Prepared ${cases.length} cases; ${requestCount} model requests (legacy plus blind). Models: ${options.models.join(', ')}.`);
  if (!options.paid) {
    console.log('Dry run only. No API calls made. Paid evaluation requires --run-paid and ABLTY_GEMINI_TEST_KEY in the environment.');
    return { request_count: requestCount };
  }
  const key = env.ABLTY_GEMINI_TEST_KEY;
  if (!key) throw new Error('Missing secure ABLTY_GEMINI_TEST_KEY binding; never put a key in arguments or chat');
  const report = { models: options.models, protocol: 'blind-five-v1', rubric: 'seven-dimensions-v1', created_at: new Date().toISOString(),
    request_count: requestCount, status: 'running', runs: [] };
  const fd = fs.openSync(output, 'wx', 0o600);
  function save() { const bytes = Buffer.from(JSON.stringify(report, null, 2)); fs.writeSync(fd, bytes, 0, bytes.length, 0); fs.ftruncateSync(fd, bytes.length); }
  async function call(body, model) {
    const request = configureRequest(body, model, options);
    const start = performance.now();
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(request), signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) throw new Error('Provider request failed');
    const data = await response.json();
    const elapsed_ms = Math.round(performance.now() - start);
    const count = name => Number.isSafeInteger(data.usageMetadata?.[name]) && data.usageMetadata[name] >= 0 ? data.usageMetadata[name] : null;
    const usage = { promptTokenCount: count('promptTokenCount'), candidatesTokenCount: count('candidatesTokenCount'),
      thoughtsTokenCount: count('thoughtsTokenCount'), totalTokenCount: count('totalTokenCount'), cachedContentTokenCount: count('cachedContentTokenCount') };
    const estimatedCost = [usage.promptTokenCount, usage.candidatesTokenCount, usage.thoughtsTokenCount].every(n => n !== null)
      && Number.isFinite(options.inputRate) && Number.isFinite(options.outputRate)
      ? (usage.promptTokenCount * options.inputRate + (usage.candidatesTokenCount + usage.thoughtsTokenCount) * options.outputRate) / 1000000 : null;
    return { data, model, elapsed_ms, thinking_tokens: usage.thoughtsTokenCount, usage,
      token_counts: { input: usage.promptTokenCount, output: usage.candidatesTokenCount, thinking: usage.thoughtsTokenCount },
      generation_config: request.generationConfig, estimated_usd_at_supplied_rates: estimatedCost };
  }
  try {
    save();
    for (let i = 0; i < prepared.length; i++) {
      const c = prepared[i];
      for (let repeat = 0; repeat < options.repeats; repeat++) {
        for (const model of options.models) {
          const legacyParts = c.sketch ? [{ inlineData: { mimeType: 'image/jpeg', data: c.sketch } }] : [];
          legacyParts.push({ text: api.buildGradingPrompt(c.notes, c.target.label, c.target.descriptors) });
          const legacy = await call({ contents: [{ parts: legacyParts }], generationConfig: { temperature: 0.2, maxOutputTokens: 4096 } }, model);
          const candidate = legacy.data?.candidates?.[0];
          if (candidate?.finishReason !== 'STOP') throw new Error('Incomplete legacy judgment');
          const answer = candidate.content?.parts?.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
          const old = JSON.parse(answer.replace(/```json|```/g, '').trim());
          if (!Number.isFinite(old.overall_score) || old.overall_score < 0 || old.overall_score > 100) throw new Error('Invalid legacy score');
          const { data: _legacyData, ...legacyMetrics } = legacy;
          report.runs.push({ case_index: i, repeat, method: 'legacy', score: old.overall_score, rank: null, ...legacyMetrics }); save();
          for (let rotation = 0; rotation < options.rotations; rotation++) {
            const ids = c.ids.slice(rotation).concat(c.ids.slice(0, rotation));
            const images = ids.map(id => ({ inlineData: { mimeType: 'image/jpeg', data: fs.readFileSync(path.join(root, api.RV_JUDGING_IMAGES[id].src)).toString('base64') } }));
            const response = await call(api.buildBlindRequest(c.notes, c.sketch, images), model);
            const numeric = api.parseBlindResponse(response.data);
            const result = api.resultFromReceipt({ candidate_ids: ids, target_index: ids.indexOf(c.canonical), ...numeric, trn: '', rubric: report.rubric, model }, api.RV_TARGET_POOL);
            const { data: _blindData, ...metrics } = response;
            report.runs.push({ case_index: i, repeat, rotation, method: 'blind', score: result.overall_score,
              rank: result.blind_judging.target_rank, tied: result.blind_judging.tied, candidate_ids: ids,
              candidate_scores: result.blind_judging.candidates.map(c => ({ label: c.label, score: c.score, rank: c.rank, tied: c.tied })),
              score_matrix: numeric.score_matrix, ...metrics }); save();
          }
        }
      }
    }
    report.status = 'complete'; save();
    console.log('Evaluation complete. Numeric results saved privately; no session content was logged.');
    return report;
  } catch (_) {
    report.status = 'stopped'; save();
    throw new Error('Evaluation stopped. Completed numeric runs are saved; no automatic retry was made.');
  } finally { fs.closeSync(fd); }
}

module.exports = { parseOptions, configureRequest, runEvaluation };
if (require.main === module) {
  let options;
  try { options = parseOptions(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exit(1); }
  runEvaluation(options).catch(() => {
    console.error('Evaluation stopped. Check the options, private file paths and secure model access. Completed numeric runs, if any, are saved. No automatic retry was made.');
    process.exitCode = 1;
  });
}
