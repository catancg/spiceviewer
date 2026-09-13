// Converts the stock LTspice .asy symbols into symbols.json, using the same
// parser the app uses at runtime so bundled and user-supplied symbols can
// never render differently.
//
// Usage:  node tools/gen-symbols.mjs [path-to-lib/sym]
// The output is committed, so a fresh clone builds without LTspice installed.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { decode } from '../src/decode.js';
import { parseAsy } from '../src/parse-asy.js';

const CANDIDATES = [
  process.argv[2],
  process.env.LTSPICE_SYM,
  join(homedir(), 'AppData', 'Local', 'LTspice', 'lib', 'sym'),
  join(homedir(), 'Documents', 'LTspiceXVII', 'lib', 'sym'),
  'C:/Program Files/ADI/LTspice/lib/sym',
].filter(Boolean);

const dir = CANDIDATES.find((d) => existsSync(d));
if (!dir) {
  console.error('LTspice symbol directory not found. Tried:\n  ' + CANDIDATES.join('\n  '));
  console.error('Pass one explicitly: node tools/gen-symbols.mjs <path>');
  process.exit(1);
}

// Top-level .asy files only: these are the generic primitives (res, cap, npn,
// voltage, ...). Subdirectories are vendor part libraries, 26 MB of mostly
// generic boxes, deliberately excluded.
const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.asy'));

const out = {};
for (const f of files) {
  const name = f.slice(0, -4).toLowerCase();
  out[name] = parseAsy(decode(readFileSync(join(dir, f))));
}

writeFileSync('symbols.json', JSON.stringify(out) + '\n');

const bytes = JSON.stringify(out).length;
console.log(`Wrote symbols.json: ${files.length} symbols, ${(bytes / 1024).toFixed(1)} KB`);

const required = ['npn', 'pnp', 'res', 'cap', 'voltage'];
const missing = required.filter((r) => !out[r]);
if (missing.length) {
  console.error(`FAIL: required symbols missing: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`Required symbols present: ${required.join(', ')}`);
