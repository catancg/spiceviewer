import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode } from '../src/decode.js';
import { parseAsc } from '../src/parse-asc.js';
import { place } from '../src/transform.js';

const symbols = JSON.parse(readFileSync('symbols.json', 'utf8'));

// Structural invariant: a transformed symbol pin must land on a wire endpoint
// or a flag. Anchors deliberately EXCLUDE other pins — letting a pin be
// satisfied by another pin makes the assertion tautological (every pin sits on
// itself) and also lets a transform that collapses all pins onto one point pass.
// The few genuine direct pin-to-pin connections are asserted explicitly instead.
function checkPins(file, placeFn = place) {
  const model = parseAsc(decode(readFileSync(file)));
  const key = (x, y) => `${x},${y}`;

  const anchors = new Set();
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
    for (const p of def.pins) pinPoints.push(placeFn(inst, p.x, p.y));
  }

  const offAnchor = pinPoints
    .map(([x, y]) => key(x, y))
    .filter((k) => !anchors.has(k));

  return {
    total: pinPoints.length,
    onAnchor: pinPoints.length - offAnchor.length,
    offAnchor,
    unresolved: [...unresolved],
  };
}

test('TPLAB v4.2.asc: pins land on wires or flags', () => {
  const r = checkPins('TPLAB v4.2.asc');
  assert.deepEqual(r.unresolved, [], 'all TPLAB symbols must resolve from stock');
  assert.equal(r.total, 102);
  assert.equal(r.onAnchor, 100, `off-anchor pins: ${r.offAnchor.join(' ')}`);
});

test('TPLAB: the only off-anchor pins are the documented pin-to-pin pair', () => {
  // Q1's base and R18 connect directly to each other at (16,176) with no wire
  // between them, which LTspice permits.
  const r = checkPins('TPLAB v4.2.asc');
  assert.deepEqual(r.offAnchor, ['16,176', '16,176']);
});

test('v6_8_4ohm.asc: every resolved pin lands on a wire or flag', () => {
  const r = checkPins('v6_8_4ohm.asc');
  assert.deepEqual(r.unresolved.sort(), ['TIP121', 'TIP127']);
  assert.equal(r.total, 50);
  assert.equal(r.onAnchor, 50, `off-anchor pins: ${r.offAnchor.join(' ')}`);
  assert.deepEqual(r.offAnchor, []);
});

test('the invariant is not tautological: a wrong transform must fail it', () => {
  // Ignore rotation entirely. If the assertion had any self-referential
  // anchoring left, this would still score perfectly.
  const ignoreRotation = (inst, px, py) => [inst.x + px, inst.y + py];
  const r = checkPins('TPLAB v4.2.asc', ignoreRotation);
  assert.equal(r.total, 102);
  assert.equal(r.onAnchor, 73,
    'ignoring rotation must drop TPLAB from 100 anchored pins to 73');
});
