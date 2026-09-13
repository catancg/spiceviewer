import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode } from '../src/decode.js';
import { toLines, toWords } from '../src/tokenize.js';

test('decodes cp1252 micro sign (0xB5) correctly', () => {
  const bytes = new Uint8Array([0x31, 0x30, 0x30, 0xB5]); // "100µ"
  assert.equal(decode(bytes), '100µ');
});

test('does not mangle the workspace schematic values', () => {
  const text = decode(readFileSync('v6_8_4ohm.asc'));
  assert.ok(text.includes('SYMATTR Value 100µ'),
    'capacitor value 100µ must survive decoding');
  assert.ok(!text.includes('�'), 'no replacement characters');
});

test('decodes UTF-16LE when a BOM is present', () => {
  const bytes = new Uint8Array([0xFF, 0xFE, 0x41, 0x00, 0x42, 0x00]);
  assert.equal(decode(bytes), 'AB');
});

test('decodes UTF-16BE when a BOM is present', () => {
  const bytes = new Uint8Array([0xFE, 0xFF, 0x00, 0x41, 0x00, 0x42]);
  assert.equal(decode(bytes), 'AB');
});

test('toLines strips CR from CRLF input', () => {
  assert.deepEqual(toLines('a\r\nb\nc'), ['a', 'b', 'c']);
});

test('toWords collapses runs of whitespace', () => {
  assert.deepEqual(toWords('  WIRE   10  20 '), ['WIRE', '10', '20']);
});
