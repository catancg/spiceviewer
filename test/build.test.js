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

test('the concatenated module script parses cleanly', () => {
  const html = readFileSync('spiceviewer.html', 'utf8');
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(m, 'built file must contain a module script');
  // new Function parses without executing, so undefined references like SYMBOLS
  // and document are fine. A duplicate top-level const/let/class in the
  // concatenated scope is a SyntaxError here — which is otherwise only
  // discoverable as a blank page in the browser.
  assert.doesNotThrow(() => new Function(m[1]),
    'concatenated module script must parse');
});

test('no duplicate top-level declarations across concatenated modules', () => {
  const html = readFileSync('spiceviewer.html', 'utf8');
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  const names = [...m[1].matchAll(/^(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)]
    .map((x) => x[1]);
  const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  assert.deepEqual(dupes, [], `duplicate top-level identifiers: ${dupes.join(', ')}`);
  assert.ok(names.length >= 30, `expected 30+ declarations, got ${names.length}`);
});

test('every src module reached the built output', () => {
  const html = readFileSync('spiceviewer.html', 'utf8');
  for (const f of ['tokenize', 'decode', 'parse-asy', 'parse-asc', 'transform', 'render', 'app']) {
    assert.ok(html.includes(`// ---- src/${f}.js ----`), `src/${f}.js missing from build`);
  }
});
