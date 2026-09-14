// Concatenates src/ modules and symbols.json into one self-contained HTML file.
// Modules are inlined in dependency order into a single module scope, so
// top-level identifiers must be unique across files.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ORDER = [
  'src/tokenize.js',
  'src/decode.js',
  'src/parse-asy.js',
  'src/parse-asc.js',
  'src/transform.js',
  'src/render.js',
  'src/app.js',
];

function strip(src, path) {
  const out = src
    .split('\n')
    .filter((l) => !/^\s*import\s.*\bfrom\s+['"][^'"]+['"]\s*;?\s*(\/\/.*)?$/.test(l))
    .join('\n')
    .replace(/^export\s+/gm, '');
  // A multi-line import survives this and trips the guard below — loud, not silent.
  if (/^\s*import\s/m.test(out)) {
    throw new Error(`${path}: an import statement survived stripping`);
  }
  return `// ---- ${path} ----\n${out.trim()}\n`;
}

export function buildHtml() {
  // A future src/foo.js that nobody registers in ORDER must fail loudly here,
  // rather than being silently dropped from the build (ReferenceError at runtime).
  const onDisk = readdirSync('src').filter((f) => f.endsWith('.js')).sort();
  const listed = ORDER.map((p) => p.replace(/^src\//, '')).sort();
  if (onDisk.join() !== listed.join()) {
    throw new Error(
      `ORDER is out of sync with src/.\n  on disk: ${onDisk.join(', ')}\n  in ORDER: ${listed.join(', ')}`);
  }

  const modules = ORDER.map((p) => strip(readFileSync(p, 'utf8'), p)).join('\n');
  const symbols = readFileSync('symbols.json', 'utf8').trim();

  const html = readFileSync('src/template.html', 'utf8')
    .replace('/*<!--INJECT:SYMBOLS-->*/{}', symbols)
    .replace('<!--INJECT:MODULES-->', modules);

  if (html.includes('<!--INJECT:')) {
    throw new Error('unreplaced placeholder remains in template');
  }
  return html;
}

// Only write when run directly, so tests can import buildHtml without side effects.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const html = buildHtml();
  writeFileSync('spiceviewer.html', html);
  console.log(`Wrote spiceviewer.html: ${(html.length / 1024).toFixed(1)} KB`);
}
