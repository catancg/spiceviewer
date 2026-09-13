import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode } from '../src/decode.js';
import { parseAsc } from '../src/parse-asc.js';
import { place } from '../src/transform.js';

const symbols = JSON.parse(readFileSync('symbols.json', 'utf8'));

// Structural invariant: every transformed symbol pin must coincide with a wire
// endpoint, a flag, or another symbol's pin. This single assertion covers the
// transform table, both parsers, and the generated symbol geometry at once.
function checkPins(file) {
  const model = parseAsc(decode(readFileSync(file)));
  const anchors = new Set();
  const key = (x, y) => `${x},${y}`;

  for (const w of model.wires) {
    anchors.add(key(w.x1, w.y1));
    anchors.add(key(w.x2, w.y2));
  }
  for (const f of model.flags) anchors.add(key(f.x, f.y));

  const pinPoints = [];
  const unresolved = new Set();
  for (const inst of model.symbols) {
    const def = symbols[inst.name.toLowerCase()];
    if (!def) { unresolved.add(inst.name); continue; }
    for (const p of def.pins) pinPoints.push(place(inst, p.x, p.y));
  }
  for (const [x, y] of pinPoints) anchors.add(key(x, y));

  let hit = 0;
  const misses = [];
  for (const [x, y] of pinPoints) {
    if (anchors.has(key(x, y))) hit += 1;
    else misses.push(`${x},${y}`);
  }
  return { total: pinPoints.length, hit, misses, unresolved: [...unresolved] };
}

test('TPLAB v4.2.asc: every resolved pin lands on an anchor', () => {
  const r = checkPins('TPLAB v4.2.asc');
  assert.deepEqual(r.unresolved, [], 'all TPLAB symbols must resolve from stock');
  assert.equal(r.total, 102);
  assert.equal(r.hit, r.total, `unmatched pins: ${r.misses.join(' ')}`);
});

test('v6_8_4ohm.asc: every resolved pin lands on an anchor', () => {
  const r = checkPins('v6_8_4ohm.asc');
  // TIP121/TIP127 are user-supplied and absent from the stock library.
  assert.deepEqual(r.unresolved.sort(), ['TIP121', 'TIP127']);
  assert.equal(r.hit, r.total, `unmatched pins: ${r.misses.join(' ')}`);
  assert.ok(r.total >= 48);
});
