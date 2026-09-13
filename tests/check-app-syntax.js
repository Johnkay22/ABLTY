// Extract every inline <script> block from app.html and compile each with
// vm.Script. Run with:  node tests/check-app-syntax.js [path/to/app.html]
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const html = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'app.html'), 'utf8');
const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
let m, n = 0, failed = 0;
while ((m = re.exec(html))) {
  const attrs = m[1];
  if (/type\s*=\s*["'](?!(text\/javascript|module|application\/javascript))/i.test(attrs)) continue;
  n++;
  const lineOffset = html.slice(0, m.index).split('\n').length;
  try {
    new vm.Script(m[2], { filename: `app.html:script#${n}@line${lineOffset}` });
  } catch (e) {
    failed++;
    console.error(`FAIL script #${n} (starts line ${lineOffset}): ${e.message}`);
    if (e.stack) console.error(e.stack.split('\n').slice(0, 4).join('\n'));
  }
}
console.log(`${n} inline script block(s) checked, ${failed} failed`);
process.exit(failed ? 1 : 0);
