import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

test('spiceviewer.html exists (run: node tools/build.mjs)', () => {
  assert.ok(existsSync('spiceviewer.html'), 'build output missing');
});

test('build output is fully self-contained', () => {
  const html = readFileSync('spiceviewer.html', 'utf8');
  assert.ok(!/<script[^>]+\bsrc=/.test(html), 'no external script tags');
  assert.ok(!/<link[^>]+\bhref=/.test(html), 'no external stylesheets');
  assert.ok(!/\bimport\s+\{/.test(html), 'import statements must be stripped');
  assert.ok(!/^export /m.test(html), 'export keywords must be stripped');
  assert.ok(!/\bfetch\s*\(/.test(html), 'nothing may be fetched at runtime');
});

test('build output embeds the symbol library', () => {
  const html = readFileSync('spiceviewer.html', 'utf8');
  assert.ok(html.includes('SYMBOLS'), 'symbol data must be inlined');
  for (const s of ['npn', 'pnp', 'res', 'cap', 'voltage']) {
    assert.ok(html.includes(`"${s}"`), `stock symbol ${s} must be embedded`);
  }
});

test('build output declares a mobile viewport', () => {
  const html = readFileSync('spiceviewer.html', 'utf8');
  assert.ok(html.includes('name="viewport"'));
  assert.ok(html.includes('width=device-width'));
});

test('no placeholder markers survive the build', () => {
  const html = readFileSync('spiceviewer.html', 'utf8');
  assert.ok(!html.includes('<!--INJECT:'), 'all placeholders must be replaced');
});
