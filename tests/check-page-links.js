// Checks that every link to a page on ablty.app that a tester can reach from
// the public pages, the app shell, the manifest and the service worker
// points at a file that actually exists in this repository. Catches things
// like "ablty.app/install.html" (a page that never existed).
// Run with:  node tests/check-page-links.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const FILES = ['index.html', 'earlybetaaccess.html', 'app.html', 'manifest.json', 'sw.js'];

// Published files are everything in the repository except what Jekyll is
// told to exclude (and underscore / dot folders, which it skips on its own).
function readExcludes() {
  const cfg = fs.readFileSync(path.join(root, '_config.yml'), 'utf8');
  return cfg.split('\n')
    .map((l) => l.match(/^\s*-\s+(.+?)\s*$/))
    .filter(Boolean)
    .map((m) => m[1].replace(/\/$/, ''));
}
const EXCLUDED = readExcludes();

function isPublished(rel) {
  if (!rel || rel.startsWith('_') || rel.startsWith('.')) return false;
  const top = rel.split('/')[0];
  if (EXCLUDED.includes(rel) || EXCLUDED.includes(top)) return false;
  const abs = path.join(root, rel);
  return fs.existsSync(abs) && fs.statSync(abs).isFile();
}

function normalize(target) {
  let t = target.trim().replace(/[?#].*$/, '');
  t = t.replace(/^https?:\/\/(www\.)?ablty\.app/, '');
  t = t.replace(/^(www\.)?ablty\.app/, '');
  if (t === '' || t === '/') return 'index.html';
  return t.replace(/^\//, '');
}

function collect(text) {
  const found = new Set();
  const add = (raw) => {
    if (!raw) return;
    const v = raw.trim();
    if (!v || v.startsWith('#') || v.includes('${') || v.includes("' +") || v.includes('" +')) return;
    if (/^(mailto:|tel:|data:|javascript:|blob:)/i.test(v)) return;
    if (/^https?:\/\//i.test(v) && !/^https?:\/\/(www\.)?ablty\.app(\/|$)/i.test(v)) return;
    if (/^\/\//.test(v)) return;
    found.add(v);
  };
  // href="..." / src="..." in markup
  for (const m of text.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) add(m[1]);
  // window.location.href = '...' and location.href = '...'
  for (const m of text.matchAll(/location\.href\s*=\s*['"]([^'"]+)['"]/g)) add(m[1]);
  // Plain mentions of ablty.app/<page> in copy
  for (const m of text.matchAll(/\b(?:https?:\/\/)?(?:www\.)?ablty\.app\/[A-Za-z0-9._\/-]*/g)) add(m[0]);
  // JSON string values that look like site paths (manifest, service worker)
  for (const m of text.matchAll(/["'](\/[A-Za-z0-9._\/-]+)["']/g)) add(m[1]);
  return Array.from(found);
}

let failed = 0;
let checked = 0;
for (const file of FILES) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  for (const target of collect(text)) {
    const rel = normalize(target);
    // Only page and asset paths; skip API-looking paths and bare folders.
    if (!/\.[A-Za-z0-9]+$/.test(rel)) continue;
    checked += 1;
    if (!isPublished(rel)) {
      failed += 1;
      console.log(`FAIL  ${file}: "${target}" -> ${rel} is missing or not published`);
    }
  }
}

console.log(`${checked} local link(s) checked across ${FILES.length} file(s), ${failed} failed`);
process.exit(failed ? 1 : 0);
