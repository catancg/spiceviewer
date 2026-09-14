import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode } from '../src/decode.js';
import { classifyFile, symbolNameFromFilename } from '../src/app.js';

test('classifies a real schematic as asc', () => {
  assert.equal(classifyFile(decode(readFileSync('v6_8_4ohm.asc'))), 'asc');
  assert.equal(classifyFile(decode(readFileSync('TPLAB v4.2.asc'))), 'asc');
});

test('classifies a symbol file as asy', () => {
  assert.equal(classifyFile('Version 4\nSymbolType CELL\nLINE Normal 0 0 1 1\n'), 'asy');
});

test('classifies junk as unknown', () => {
  assert.equal(classifyFile('hello world'), 'unknown');
  assert.equal(classifyFile(''), 'unknown');
});

test('classification survives CRLF line endings', () => {
  assert.equal(classifyFile('Version 4\r\nSHEET 1 10 10\r\n'), 'asc');
  assert.equal(classifyFile('Version 4\r\nSymbolType CELL\r\n'), 'asy');
});

test('derives a lowercased symbol name from a filename', () => {
  assert.equal(symbolNameFromFilename('TIP121.asy'), 'tip121');
  assert.equal(symbolNameFromFilename('C:\\parts\\TIP127.ASY'), 'tip127');
  assert.equal(symbolNameFromFilename('/home/u/npn.asy'), 'npn');
});
