import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAsy } from '../src/parse-asy.js';

const NPN = `Version 4
SymbolType CELL
LINE Normal 44 76 36 84
LINE Normal 16 48 0 48
WINDOW 0 56 32 Left 2
WINDOW 3 56 68 Left 2
SYMATTR Value NPN
SYMATTR Prefix QN
PIN 64 0 NONE 0
PINATTR PinName C
PINATTR SpiceOrder 1
PIN 0 48 NONE 0
PINATTR PinName B
PINATTR SpiceOrder 2
`;

test('parses symbol type', () => {
  assert.equal(parseAsy(NPN).type, 'CELL');
});

test('parses LINE primitives with style', () => {
  const s = parseAsy(NPN);
  assert.equal(s.lines.length, 2);
  assert.deepEqual(s.lines[0], { style: 'Normal', x1: 44, y1: 76, x2: 36, y2: 84 });
});

test('parses WINDOW entries keyed by id', () => {
  const w = parseAsy(NPN).windows;
  assert.deepEqual(w[0], { x: 56, y: 32, just: 'Left', size: 2 });
  assert.deepEqual(w[3], { x: 56, y: 68, just: 'Left', size: 2 });
});

test('parses SYMATTR into attrs', () => {
  assert.equal(parseAsy(NPN).attrs.Value, 'NPN');
  assert.equal(parseAsy(NPN).attrs.Prefix, 'QN');
});

test('attaches PINATTR to the preceding PIN', () => {
  const p = parseAsy(NPN).pins;
  assert.equal(p.length, 2);
  assert.deepEqual(p[0], { x: 64, y: 0, name: 'C', order: 1 });
  assert.deepEqual(p[1], { x: 0, y: 48, name: 'B', order: 2 });
});

test('parses CIRCLE as a bounding box', () => {
  const s = parseAsy('CIRCLE Normal -32 24 32 88\n');
  assert.deepEqual(s.circles[0], { style: 'Normal', x1: -32, y1: 24, x2: 32, y2: 88 });
});

test('parses ARC bounding box plus start and end points', () => {
  const s = parseAsy('ARC Normal 0 0 64 64 64 32 32 0\n');
  assert.deepEqual(s.arcs[0],
    { style: 'Normal', x1: 0, y1: 0, x2: 64, y2: 64, xs: 64, ys: 32, xe: 32, ye: 0 });
});

test('TEXT keeps the remainder of the line intact, spaces included', () => {
  const s = parseAsy('TEXT 16 32 Center 2 Hello there world\n');
  assert.deepEqual(s.texts[0],
    { x: 16, y: 32, just: 'Center', size: 2, text: 'Hello there world' });
});

test('counts unrecognised lines instead of throwing', () => {
  const s = parseAsy('LINE Normal 0 0 1 1\nFUTUREKEYWORD 1 2 3\n');
  assert.equal(s.unknown, 1);
  assert.equal(s.lines.length, 1);
});

test('ignores blank lines', () => {
  assert.equal(parseAsy('\n\n   \n').unknown, 0);
});
