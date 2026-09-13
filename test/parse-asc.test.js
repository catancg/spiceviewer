import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode } from '../src/decode.js';
import { parseAsc } from '../src/parse-asc.js';

const SAMPLE = `Version 4.1
SHEET 1 2144 1212
WIRE 1392 -240 1376 -240
FLAG -352 32 0
FLAG 208 464 vee
DATAFLAG 1392 -240 "V(vx,ve1)"
DATAFLAG 416 32 ""
SYMBOL npn 48 128 R0
WINDOW 0 54 21 Left 2
SYMATTR InstName Q1
SYMATTR Value BC547B
SYMBOL res 128 400 R180
SYMATTR InstName RE1
TEXT -448 528 Left 2 !.tran 0 80m 0 100
TEXT 688 424 Left 2 ;La suma tiene\\nque dar 1K
RECTANGLE Normal 1408 720 880 112 2
`;

test('parses the sheet declaration', () => {
  assert.deepEqual(parseAsc(SAMPLE).sheet, { n: 1, w: 2144, h: 1212 });
});

test('parses wires', () => {
  assert.deepEqual(parseAsc(SAMPLE).wires[0], { x1: 1392, y1: -240, x2: 1376, y2: -240 });
});

test('parses flags including ground', () => {
  const f = parseAsc(SAMPLE).flags;
  assert.deepEqual(f[0], { x: -352, y: 32, name: '0' });
  assert.deepEqual(f[1], { x: 208, y: 464, name: 'vee' });
});

test('strips quotes from dataflag expressions', () => {
  const d = parseAsc(SAMPLE).dataflags;
  assert.equal(d[0].expr, 'V(vx,ve1)');
  assert.equal(d[1].expr, '');
});

test('attaches SYMATTR and WINDOW to the preceding SYMBOL', () => {
  const s = parseAsc(SAMPLE).symbols;
  assert.equal(s.length, 2);
  assert.equal(s[0].name, 'npn');
  assert.equal(s[0].rot, 'R0');
  assert.equal(s[0].attrs.InstName, 'Q1');
  assert.equal(s[0].attrs.Value, 'BC547B');
  assert.deepEqual(s[0].windows[0], { x: 54, y: 21, just: 'Left', size: 2 });
  assert.equal(s[1].attrs.InstName, 'RE1');
  assert.deepEqual(s[1].windows, {}, 'second symbol must not inherit the first window');
});

test('classifies directive and comment text', () => {
  const t = parseAsc(SAMPLE).texts;
  assert.equal(t[0].kind, 'directive');
  assert.deepEqual(t[0].lines, ['.tran 0 80m 0 100']);
  assert.equal(t[1].kind, 'comment');
});

test('expands the literal backslash-n escape in TEXT into separate lines', () => {
  const t = parseAsc(SAMPLE).texts[1];
  assert.deepEqual(t.lines, ['La suma tiene', 'que dar 1K']);
});

test('parses schematic-level rectangles', () => {
  assert.deepEqual(parseAsc(SAMPLE).shapes[0],
    { type: 'rect', style: 'Normal', x1: 1408, y1: 720, x2: 880, y2: 112 });
});

test('counts unrecognised lines instead of throwing', () => {
  const m = parseAsc('SHEET 1 10 10\nBUSTAP 1 2 3 4\n');
  assert.equal(m.unknown, 1);
});

test('parses both real workspace files without unknown lines', () => {
  for (const f of ['TPLAB v4.2.asc', 'v6_8_4ohm.asc']) {
    const m = parseAsc(decode(readFileSync(f)));
    assert.equal(m.unknown, 0, `${f} produced unrecognised lines`);
    assert.ok(m.symbols.length > 0);
    assert.ok(m.wires.length > 0);
  }
});

test('symbol counts match the spec survey', () => {
  const tplab = parseAsc(decode(readFileSync('TPLAB v4.2.asc')));
  const v6 = parseAsc(decode(readFileSync('v6_8_4ohm.asc')));
  assert.equal(tplab.symbols.length, 45);
  assert.equal(v6.symbols.length, 25);
});
