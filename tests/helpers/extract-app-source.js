// Pulls real function and declaration source out of app.html so tests run
// the code the app ships, not a re-implementation.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'app.html'), 'utf8');

function extractFn(name) {
  const re = new RegExp(`^(async\\s+)?function\\s+${name}\\s*\\(`, 'm');
  const m = re.exec(html);
  if (!m) throw new Error('function not found: ' + name);
  let i = html.indexOf(')', m.index + m[0].length);
  i = html.indexOf('{', i);
  let depth = 0;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) break; }
  }
  return html.slice(m.index, i + 1);
}

function extractDecl(name) {
  const re = new RegExp(`^(const|let)\\s+${name}\\s*=.*;$`, 'm');
  const m = re.exec(html);
  if (!m) throw new Error('declaration not found: ' + name);
  return m[0];
}

// A top-level `const X = [ ... ];` or `const X = { ... };` spanning lines.
function extractMultiDecl(name) {
  const m = new RegExp(`^const\\s+${name}\\s*=\\s*[\\[{]\\s*$`, 'm').exec(html);
  if (!m) throw new Error('multi-line declaration not found: ' + name);
  const end = /^[\]}];$/m.exec(html.slice(m.index));
  if (!end) throw new Error('end of declaration not found: ' + name);
  return html.slice(m.index, m.index + end.index + 2);
}

module.exports = { html, extractFn, extractDecl, extractMultiDecl };
