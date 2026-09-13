import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode } from '../src/decode.js';
import { parseAsc } from '../src/parse-asc.js';
import { computeBounds, junctionPoints, renderSvg, getSymbol } from '../src/render.js';

const symbols = JSON.parse(readFileSync('symbols.json', 'utf8'));
const load = (f) => parseAsc(decode(readFileSync(f)));

test('symbol lookup is case-insensitive', () => {
  assert.ok(getSymbol(symbols, 'RES'));
  assert.ok(getSymbol(symbols, 'res'));
  assert.equal(getSymbol(symbols, 'nope_not_real'), undefined);
});

test('bounds come from geometry, not the SHEET declaration', () => {
  const m = load('TPLAB v4.2.asc');
  assert.deepEqual(m.sheet, { n: 1, w: 3652, h: 1136 });
  const b = computeBounds(m, symbols);
  // Spec: geometry spans x -464..3168, y -336..960. Symbol bodies extend it
  // slightly further, so assert the SHEET box does not contain the content.
  assert.ok(b.minX <= -464, `minX ${b.minX} must reach the left-most wire`);
  assert.ok(b.maxX >= 3168, `maxX ${b.maxX} must reach the right-most wire`);
  assert.ok(b.minY <= -336, `minY ${b.minY} must reach the top-most wire`);
  assert.ok(b.minX < 0, 'trusting SHEET would clip negative-x content');
});

test('junction dots appear only where three or more connections meet', () => {
  const m = {
    sheet: { n: 1, w: 100, h: 100 },
    wires: [
      { x1: 0, y1: 0, x2: 10, y2: 0 },   // endpoints (0,0) (10,0)
      { x1: 10, y1: 0, x2: 20, y2: 0 },  // endpoints (10,0) (20,0)
      { x1: 10, y1: 0, x2: 10, y2: 10 }, // endpoints (10,0) (10,10)
    ],
    flags: [], dataflags: [], symbols: [], texts: [], shapes: [], unknown: 0,
  };
  const j = junctionPoints(m, {});
  assert.deepEqual(j, ['10,0'], 'only the 3-way meeting point is a junction');
});

test('a plain corner is not a junction', () => {
  const m = {
    sheet: { n: 1, w: 100, h: 100 },
    wires: [
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: 10, y1: 0, x2: 10, y2: 10 },
    ],
    flags: [], dataflags: [], symbols: [], texts: [], shapes: [], unknown: 0,
  };
  assert.deepEqual(junctionPoints(m, {}), []);
});

test('renders a well-formed svg document for both real files', () => {
  for (const f of ['TPLAB v4.2.asc', 'v6_8_4ohm.asc']) {
    const svg = renderSvg(load(f), symbols);
    assert.ok(svg.startsWith('<svg'), `${f}: must start with <svg`);
    assert.ok(svg.trimEnd().endsWith('</svg>'), `${f}: must end with </svg>`);
    assert.ok(svg.includes('viewBox='), `${f}: must set a viewBox`);
    assert.ok(svg.includes('vector-effect="non-scaling-stroke"'),
      `${f}: strokes must stay constant width at any zoom`);
  }
});

test('every wire produces a line element', () => {
  const m = load('v6_8_4ohm.asc');
  const svg = renderSvg(m, symbols);
  const count = (svg.match(/<line /g) || []).length;
  assert.ok(count >= m.wires.length,
    `expected at least ${m.wires.length} lines, got ${count}`);
});

test('unresolved symbols render as dashed placeholders', () => {
  const svg = renderSvg(load('v6_8_4ohm.asc'), symbols);
  assert.ok(svg.includes('class="placeholder"'),
    'TIP121/TIP127 must render as placeholders');
  assert.ok(svg.includes('TIP121'), 'placeholder must be labelled with its name');
});

test('escapes XML special characters in placeholder labels', () => {
  // Only the placeholder path emits text in this task; the flag/attribute
  // text layer arrives in Task 7 and is asserted there.
  const m = {
    sheet: { n: 1, w: 100, h: 100 },
    wires: [{ x1: 0, y1: 0, x2: 10, y2: 0 }],
    flags: [], dataflags: [], texts: [], shapes: [], unknown: 0,
    symbols: [{ name: 'nope', x: 0, y: 0, rot: 'R0',
                attrs: { InstName: 'A&B<C>' }, windows: {} }],
  };
  const svg = renderSvg(m, {});
  assert.ok(svg.includes('A&amp;B&lt;C&gt;'));
  assert.ok(!svg.includes('A&B<C>'));
});
