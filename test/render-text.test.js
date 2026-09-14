import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode } from '../src/decode.js';
import { parseAsc } from '../src/parse-asc.js';
import { renderSvg, justAttrs, SIZE } from '../src/render.js';

const symbols = JSON.parse(readFileSync('symbols.json', 'utf8'));
const load = (f) => parseAsc(decode(readFileSync(f)));

test('size table covers all eight LTspice size codes', () => {
  assert.equal(SIZE.length, 8);
  for (const s of SIZE) assert.ok(s > 0);
});

test('justification maps to svg anchors', () => {
  assert.equal(justAttrs('Left').anchor, 'start');
  assert.equal(justAttrs('Right').anchor, 'end');
  assert.equal(justAttrs('Center').anchor, 'middle');
  assert.equal(justAttrs('VLeft').rotate, true);
  assert.equal(justAttrs('Left').rotate, false);
});

test('renders instance names and values', () => {
  const svg = renderSvg(load('v6_8_4ohm.asc'), symbols);
  assert.ok(svg.includes('>Q1<'), 'transistor instance name');
  assert.ok(svg.includes('>BC547B<'), 'transistor value');
  assert.ok(svg.includes('>RE1<'), 'resistor instance name');
  assert.ok(svg.includes('>7190<'), 'resistor value');
});

test('preserves the cp1252 micro sign end to end', () => {
  const svg = renderSvg(load('v6_8_4ohm.asc'), symbols);
  assert.ok(svg.includes('100µ'), 'capacitor value 100µ must reach the SVG');
});

test('hides attributes whose WINDOW size is zero', () => {
  // Neither fixture exercises this rule: v6's size-0 WINDOW 123 entries belong
  // to Vcc/Vee, which carry no Value2 at all, while Vs (which does) has
  // WINDOW 123 size 2 and legitimately renders. So assert the rule directly.
  const base = {
    sheet: { n: 1, w: 100, h: 100 },
    wires: [{ x1: 0, y1: 0, x2: 10, y2: 0 }],
    flags: [], dataflags: [], texts: [], shapes: [], unknown: 0,
  };
  const map = { probe: { type: 'CELL', lines: [], rects: [], circles: [],
    arcs: [], texts: [], pins: [], attrs: {}, unknown: 0,
    windows: { 123: { x: 0, y: 0, just: 'Left', size: 2 } } } };
  const inst = (size) => ({
    name: 'probe', x: 0, y: 0, rot: 'R0',
    attrs: { Value2: 'AC 1 0' },
    windows: { 123: { x: 8, y: 8, just: 'Left', size } },
  });

  const shown = renderSvg({ ...base, symbols: [inst(2)] }, map);
  assert.ok(shown.includes('AC 1 0'), 'size 2 must render Value2');

  const hidden = renderSvg({ ...base, symbols: [inst(0)] }, map);
  assert.ok(!hidden.includes('AC 1 0'), 'size 0 must suppress Value2');
});

test('Vs Value2 renders in the real file (WINDOW 123 size is 2 there)', () => {
  const svg = renderSvg(load('v6_8_4ohm.asc'), symbols);
  assert.ok(svg.includes('AC 1 0'), 'Vs carries WINDOW 123 size 2, so it shows');
});

test('renders net labels and the ground glyph', () => {
  const svg = renderSvg(load('v6_8_4ohm.asc'), symbols);
  assert.ok(svg.includes('>vcc<'));
  assert.ok(svg.includes('>vee<'));
  assert.ok(svg.includes('class="gnd"'), 'FLAG named 0 renders a ground glyph');
  assert.ok(!svg.includes('>0</text>'), 'ground is a glyph, not the literal text 0');
});

test('mirrored symbols do not mirror their text', () => {
  // TPLAB Q2 is M0. Its label must carry no negative scale transform.
  const svg = renderSvg(load('TPLAB v4.2.asc'), symbols);
  assert.ok(!/scale\(-1/.test(svg), 'no text may be mirrored');
});

test('multi-line comments become separate tspans', () => {
  const svg = renderSvg(load('v6_8_4ohm.asc'), symbols);
  assert.ok(svg.includes('La suma tiene'));
  assert.ok(svg.includes('que dar 1K'));
  assert.ok(svg.includes('<tspan'), 'line breaks use tspan');
});

test('annotations:false hides directives, comments and dataflags', () => {
  const m = load('v6_8_4ohm.asc');
  const on = renderSvg(m, symbols, { annotations: true });
  const off = renderSvg(m, symbols, { annotations: false });

  assert.ok(on.includes('.tran 0 80m 0 100'), 'directive shown when on');
  assert.ok(!off.includes('.tran 0 80m 0 100'), 'directive hidden when off');
  assert.ok(on.includes('Ic(Q1)'), 'dataflag shown when on');
  assert.ok(!off.includes('Ic(Q1)'), 'dataflag hidden when off');

  assert.ok(off.includes('>Q1<'), 'instance names stay visible when off');
  assert.ok(off.includes('>vcc<'), 'net labels stay visible when off');
});

test('empty dataflag expressions render nothing', () => {
  const svg = renderSvg(load('v6_8_4ohm.asc'), symbols, { annotations: true });
  assert.ok(!svg.includes('class="dataflag"></text>'), 'no empty dataflag elements');
});

test('symbol TEXT primitives render into the SVG', () => {
  // No bundled symbol uses TEXT, but vendor .asy files routinely carry a
  // part-label TEXT primitive — it must not silently vanish.
  const symbolMap = {
    withtext: {
      type: 'CELL', lines: [], rects: [], circles: [], arcs: [], pins: [],
      attrs: {}, unknown: 0, windows: {},
      texts: [{ x: 10, y: 10, just: 'Left', size: 2, text: 'PartLabel' }],
    },
  };
  const m = {
    sheet: { n: 1, w: 100, h: 100 },
    wires: [{ x1: 0, y1: 0, x2: 10, y2: 0 }],
    flags: [], dataflags: [], texts: [], shapes: [], unknown: 0,
    symbols: [{ name: 'withtext', x: 0, y: 0, rot: 'R0', attrs: {}, windows: {} }],
  };
  const svg = renderSvg(m, symbolMap);
  assert.ok(svg.includes('PartLabel'), 'symbol TEXT primitive must reach the SVG');
  assert.ok(svg.includes('class="symtext"'), 'symbol TEXT gets its own class');
});

test('escapes XML special characters in rendered labels', () => {
  const m = {
    sheet: { n: 1, w: 100, h: 100 },
    wires: [{ x1: 0, y1: 0, x2: 10, y2: 0 }],
    flags: [{ x: 0, y: 0, name: 'A&B<C>' }],
    dataflags: [], symbols: [], texts: [], shapes: [], unknown: 0,
  };
  const svg = renderSvg(m, {});
  assert.ok(svg.includes('A&amp;B&lt;C&gt;'));
  assert.ok(!svg.includes('A&B<C>'));
});
