import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROT, place, emptyBox, unionBox } from '../src/transform.js';

test('all eight orientations are defined', () => {
  assert.deepEqual(Object.keys(ROT).sort(),
    ['M0', 'M180', 'M270', 'M90', 'R0', 'R180', 'R270', 'R90']);
});

test('rotation table matches the verified spec values', () => {
  assert.deepEqual(ROT.R0(3, 5), [3, 5]);
  assert.deepEqual(ROT.R90(3, 5), [-5, 3]);
  assert.deepEqual(ROT.R180(3, 5), [-3, -5]);
  assert.deepEqual(ROT.R270(3, 5), [5, -3]);
  assert.deepEqual(ROT.M0(3, 5), [-3, 5]);
  assert.deepEqual(ROT.M90(3, 5), [5, 3]);
  assert.deepEqual(ROT.M180(3, 5), [3, -5]);
  assert.deepEqual(ROT.M270(3, 5), [-5, -3]);
});

test('R180 resistor RE1 pins land where the spec says', () => {
  // SYMBOL res 128 400 R180, res.asy pins at (16,16) and (16,96)
  assert.deepEqual(place({ x: 128, y: 400, rot: 'R180' }, 16, 16), [112, 384]);
  assert.deepEqual(place({ x: 128, y: 400, rot: 'R180' }, 16, 96), [112, 304]);
});

test('R90 resistor R10 pins land where the spec says', () => {
  // SYMBOL res 384 928 R90
  assert.deepEqual(place({ x: 384, y: 928, rot: 'R90' }, 16, 16), [368, 944]);
  assert.deepEqual(place({ x: 384, y: 928, rot: 'R90' }, 16, 96), [288, 944]);
});

test('M0 npn Q2 pins land where the spec says', () => {
  // SYMBOL npn 400 128 M0, npn.asy pins C(64,0) B(0,48) E(64,96)
  const q2 = { x: 400, y: 128, rot: 'M0' };
  assert.deepEqual(place(q2, 64, 0), [336, 128]);
  assert.deepEqual(place(q2, 0, 48), [400, 176]);
  assert.deepEqual(place(q2, 64, 96), [336, 224]);
});

test('unionBox grows to contain every point', () => {
  let b = emptyBox();
  b = unionBox(b, 10, -5);
  b = unionBox(b, -3, 40);
  assert.deepEqual(b, { minX: -3, minY: -5, maxX: 10, maxY: 40 });
});
