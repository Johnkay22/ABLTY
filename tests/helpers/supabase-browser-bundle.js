const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildSync } = require('esbuild');

// Build from the package's public Node resolution entry instead of depending
// on an undocumented dist/umd directory, which differs between releases.
function buildSupabaseBrowserBundle() {
  const entryPoint = require.resolve('@supabase/supabase-js');
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ablty-supabase-browser-'));
  const outputPath = path.join(outputDirectory, 'supabase-browser.js');

  buildSync({
    entryPoints: [entryPoint],
    outfile: outputPath,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'supabase',
    target: ['chrome120'],
    logLevel: 'warning',
  });

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    throw new Error(`Supabase browser bundle was not created: ${outputPath}`);
  }
  return outputPath;
}

module.exports = { buildSupabaseBrowserBundle };
