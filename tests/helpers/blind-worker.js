const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');

function loadBlindWorker(fetch) {
  const source = ['rv-judging-images.js', 'rv-blind-judging.js', 'ablty-worker.js'].map(file =>
    fs.readFileSync(path.join(root, file), 'utf8').replace(/^import .*;\n/gm, '')
      .replace('export default {', 'const worker = {').replace(/^export /gm, '')).join('\n');
  const context = vm.createContext({ fetch, crypto: require('node:crypto').webcrypto, TextEncoder,
    Uint8Array, Uint32Array, Request, Response, Headers, URL, AbortSignal, AbortController, btoa, atob,
    console, setTimeout, clearTimeout });
  vm.runInContext(source, context);
  return vm.runInContext('({ worker, handleGrade, handleRVAssign, chooseBlindSet, buildBlindRequest, buildGradingPrompt, parseBlindResponse, resultFromReceipt, submissionHash, rotationOrder, toCandidateOrder, sumTokenCounts, matchStrength, BLIND_ROTATIONS, fetchCandidateImage, RV_TARGET_POOL, RV_JUDGING_IMAGES, BLIND_DIMENSIONS })', context);
}
module.exports = { loadBlindWorker, root };
