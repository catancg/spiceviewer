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

test('symbol names with a library subdirectory resolve via basename', () => {
  // LTspice writes "SYMBOL Opamps\UniversalOpamp2 ..." for symbols outside the
  // top level; a user-supplied .asy is stored under its basename only.
  const map = { npn: symbols.npn };
  assert.equal(getSymbol(map, 'Opamps\\npn'), map.npn);
  assert.equal(getSymbol(map, 'Opamps/npn'), map.npn);
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
    assert.ok(/vector-effect:\s*non-scaling-stroke/.test(svg),
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

// SVG 1.1 Appendix F.6.5 endpoint-to-centre conversion. Recovers the point a
// browser actually draws at parameter t, so these tests check real geometry
// instead of mirroring the renderer's own maths back at it.
function svgArcPoint(x1, y1, rx, ry, fa, fs, x2, y2, t) {
  const x1p = (x1 - x2) / 2;
  const y1p = (y1 - y2) / 2;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const sign = fa !== fs ? 1 : -1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cxp + (x1 + x2) / 2;
  const cy = cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const d = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
    const a = Math.acos(Math.min(1, Math.max(-1, d)));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (fs === 0 && dth > 0) dth -= 2 * Math.PI;
  if (fs === 1 && dth < 0) dth += 2 * Math.PI;
  const th = th1 + dth * t;
  return [cx + rx * Math.cos(th), cy + ry * Math.sin(th)];
}

const FB_ARC = { style: 'Normal', x1: 16, y1: 4, x2: -16, y2: 12, xs: -16, ys: 8, xe: 16, ye: 8 };
const arcSymbol = (arc) => ({
  fb: {
    type: 'CELL', lines: [], rects: [], circles: [], texts: [], pins: [],
    attrs: {}, unknown: 0, windows: {}, arcs: [arc],
  },
});
const arcModel = (rot) => ({
  sheet: { n: 1, w: 100, h: 100 },
  wires: [{ x1: 0, y1: 0, x2: 10, y2: 0 }],
  flags: [], dataflags: [], texts: [], shapes: [], unknown: 0,
  symbols: [{ name: 'fb', x: 0, y: 0, rot, attrs: {}, windows: {} }],
});

test('ARC draws the curve on the side LTspice intended', () => {
  const svg = renderSvg(arcModel('R0'), arcSymbol(FB_ARC));
  const m = svg.match(/M (-?[\d.]+) (-?[\d.]+) A ([\d.]+) ([\d.]+) 0 (\d) (\d) (-?[\d.]+) (-?[\d.]+)/);
  assert.ok(m, `expected an arc path, got: ${svg}`);
  const [, sx, sy, rx, ry, fa, fs, ex, ey] = m.map(Number);

  // LTspice's own semantics: sweep from the start angle towards the end angle
  // by increasing theta, around the bounding box's centre.
  const cx = (FB_ARC.x1 + FB_ARC.x2) / 2;
  const cy = (FB_ARC.y1 + FB_ARC.y2) / 2;
  const lrx = Math.abs(FB_ARC.x2 - FB_ARC.x1) / 2;
  const lry = Math.abs(FB_ARC.y2 - FB_ARC.y1) / 2;
  const ang = (px, py) => Math.atan2((py - cy) / lry, (px - cx) / lrx);
  let delta = ang(FB_ARC.xe, FB_ARC.ye) - ang(FB_ARC.xs, FB_ARC.ys);
  while (delta <= 0) delta += Math.PI * 2;
  const mid = ang(FB_ARC.xs, FB_ARC.ys) + delta / 2;
  const intended = [cx + lrx * Math.cos(mid), cy + lry * Math.sin(mid)];

  const drawn = svgArcPoint(sx, sy, rx, ry, fa, fs, ex, ey, 0.5);
  const err = Math.hypot(drawn[0] - intended[0], drawn[1] - intended[1]);
  assert.ok(err < 0.01,
    `arc midpoint off by ${err.toFixed(3)}: drawn ${drawn} vs intended ${intended}`);
});

test('ARC swaps its radii under a 90-degree rotation, as CIRCLE does', () => {
  const radii = (rot) => {
    const svg = renderSvg(arcModel(rot), arcSymbol(FB_ARC));
    const m = svg.match(/A ([\d.]+) ([\d.]+) /);
    assert.ok(m, `expected an arc path for ${rot}`);
    return [Number(m[1]), Number(m[2])];
  };
  assert.deepEqual(radii('R0'), [16, 4], 'unrotated radii come straight from the bbox');
  assert.deepEqual(radii('R90'), [4, 16], 'R90 must swap rx and ry');
  assert.deepEqual(radii('R270'), [4, 16], 'R270 must swap rx and ry');
  assert.deepEqual(radii('R180'), [16, 4], 'R180 must NOT swap');
});
