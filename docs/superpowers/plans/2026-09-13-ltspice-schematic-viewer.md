# LTspice Schematic Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single self-contained HTML file that renders LTspice `.asc` schematics on a phone, with pinch-zoom and pan.

**Architecture:** A one-way pipeline — decode bytes, parse `.asc` to a plain-object model, resolve `SYMBOL` names against bundled and user-supplied `.asy` geometry, emit an SVG string, then pan/zoom it with a single CSS transform. Parsers and renderer are pure functions with no DOM access, so they run under `node --test` without a browser. A build script concatenates the modules and the generated symbol data into one dependency-free HTML file.

**Tech Stack:** Vanilla ES modules, no runtime dependencies. Node 24 (`node:test`, `node:assert`) for tests and the build. SVG for rendering. Pointer Events for gestures.

**Spec:** `docs/superpowers/specs/2026-09-13-ltspice-schematic-viewer-design.md`

## Global Constraints

- **Zero runtime dependencies.** No npm packages in the shipped HTML. Nothing is fetched at runtime.
- **Zero build dependencies.** `node --test` and `node tools/*.mjs` only. No bundler, no test framework install. `package.json` declares `"type": "module"` and no `dependencies`.
- **Node >= 18** required to build and test (uses `node:test`). Developed against v24.14.0.
- **Top-level identifiers must be unique across all `src/*.js` files.** The build concatenates modules into one scope, stripping `export` keywords and `import` statements. A name collision between two modules is a silent bug.
- **`src/` modules must not touch the DOM** except `src/app.js`. This is what keeps them testable in Node.
- **Encoding:** decode as UTF-16LE/BE on BOM, otherwise **cp1252**. Never UTF-8.
- **`.asc`/`.asy` fixtures are byte-exact.** `.gitattributes` pins them to `-text -diff`. Never rewrite their line endings.
- **Transform table** (verified 152/152 in the spec) — copy verbatim, do not re-derive:
  `R0 (x,y)` · `R90 (-y,x)` · `R180 (-x,-y)` · `R270 (y,-x)` · `M0 (-x,y)` · `M90 (y,x)` · `M180 (x,-y)` · `M270 (-y,-x)`
- **Commit after every task.** Conventional commit prefixes (`feat:`, `test:`, `chore:`, `fix:`).

## Deviations from the spec (deliberate)

1. **`render()` returns an SVG string**, not an `SVGElement`. The spec specified an element. A string is testable under `node --test` with no DOM and no jsdom dependency, which upholds the zero-dependency constraint. `app.js` assigns it with `innerHTML`.
2. **`symbols.json` is committed to the repo.** The spec treats it as generated. Committing it means a fresh clone can build and test without an LTspice installation; `tools/gen-symbols.mjs` regenerates it when the library is present.

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | `"type": "module"`, test/build scripts. No dependencies. |
| `src/tokenize.js` | Line/word splitting (CRLF-safe), int parsing, and rest-of-line extraction that preserves inner spacing. Shared by both parsers. |
| `src/decode.js` | `ArrayBuffer` to string. BOM sniffing, cp1252 fallback. |
| `src/parse-asy.js` | `.asy` text to `SymbolDef`. |
| `src/parse-asc.js` | `.asc` text to `SchematicModel`. |
| `src/transform.js` | Rotation/mirror table, pin placement, bounding-box union. |
| `src/render.js` | `(model, symbolMap)` to SVG string. Geometry and text. |
| `src/app.js` | File picker, content sniffing, symbol cache, gestures, UI. DOM-only module. |
| `src/template.html` | HTML shell with `<!--INJECT:*-->` placeholders. |
| `tools/gen-symbols.mjs` | Stock `.asy` files to `symbols.json`, via `src/parse-asy.js`. |
| `tools/build.mjs` | Inline modules + `symbols.json` into `spiceviewer.html`. |
| `symbols.json` | Generated, committed. The 53 stock symbols. |
| `spiceviewer.html` | Generated, committed. The deliverable. |
| `test/*.test.js` | One test file per `src/` module, plus the structural invariant. |

Files that change together live together: both parsers sit beside the tokenizer they share; the renderer owns both geometry and text because they share the coordinate conventions.

---

### Task 1: Project scaffolding and byte decoding

**Files:**
- Create: `package.json`
- Create: `src/decode.js`
- Create: `src/tokenize.js`
- Test: `test/decode.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `decode(buf: ArrayBuffer | Uint8Array) -> string`
  - `toLines(text: string) -> string[]` — splits on `\n`, strips a trailing `\r`
  - `toWords(line: string) -> string[]` — trims, splits on runs of whitespace
  - `toInt(v: string) -> number` — `parseInt(v, 10)`
  - `restFrom(raw: string, i: number) -> string` — everything from word index `i`
    onward, preserving original inner spacing. Both parsers need this because
    `TEXT` bodies and `SYMATTR` values contain spaces, and collapsing runs of
    whitespace would corrupt them. (Added during execution: the plan originally
    duplicated this body as `restAfter` in Task 2 and `tail` in Task 3.)

- [ ] **Step 1: Write the failing test**

Create `test/decode.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode } from '../src/decode.js';
import { toLines, toWords } from '../src/tokenize.js';

test('decodes cp1252 micro sign (0xB5) correctly', () => {
  const bytes = new Uint8Array([0x31, 0x30, 0x30, 0xB5]); // "100µ"
  assert.equal(decode(bytes), '100\u00B5');
});

test('does not mangle the workspace schematic values', () => {
  const text = decode(readFileSync('v6_8_4ohm.asc'));
  assert.ok(text.includes('SYMATTR Value 100\u00B5'),
    'capacitor value 100µ must survive decoding');
  assert.ok(!text.includes('\uFFFD'), 'no replacement characters');
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/decode.test.js`
Expected: FAIL — `Cannot find module '../src/decode.js'`

- [ ] **Step 3: Write the implementation**

Create `package.json`:

```json
{
  "name": "spiceviewer",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Mobile viewer for LTspice .asc schematics",
  "scripts": {
    "test": "node --test",
    "build": "node tools/build.mjs",
    "gen-symbols": "node tools/gen-symbols.mjs"
  }
}
```

Create `src/tokenize.js`:

```js
export function toLines(text) {
  return text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

export function toWords(line) {
  const t = line.trim();
  return t === '' ? [] : t.split(/\s+/);
}
```

Create `src/decode.js`:

```js
// LTspice writes cp1252 by default (0xB5 = micro sign) and UTF-16 with a BOM
// in some versions. Decoding as UTF-8 corrupts component values.
export function decode(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);

  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(b.subarray(2));
  }
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    // TextDecoder support for 'utf-16be' is inconsistent across runtimes,
    // so byte-swap into LE rather than relying on it.
    const body = b.subarray(2);
    const swapped = new Uint8Array(body.length);
    for (let i = 0; i + 1 < body.length; i += 2) {
      swapped[i] = body[i + 1];
      swapped[i + 1] = body[i];
    }
    return new TextDecoder('utf-16le').decode(swapped);
  }
  return new TextDecoder('windows-1252').decode(b);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/decode.test.js`
Expected: PASS, 6 tests.

If `windows-1252` throws `RangeError`, the Node build lacks full ICU. Confirm with `node -e "console.log(new TextDecoder('windows-1252').encoding)"`. On a small-ICU build, replace the final return with an inline 0x80–0x9F lookup table; every other byte in cp1252 maps to the identical code point.

- [ ] **Step 5: Commit**

```bash
git add package.json src/decode.js src/tokenize.js test/decode.test.js
git commit -m "feat: add cp1252/UTF-16 decoder and line tokenizer"
```

---

### Task 2: Symbol file parser

**Files:**
- Create: `src/parse-asy.js`
- Test: `test/parse-asy.test.js`

**Interfaces:**
- Consumes: `toLines`, `toWords`, `toInt`, `restFrom` from `src/tokenize.js`.
- Produces: `parseAsy(text: string) -> SymbolDef` where

```js
SymbolDef = {
  type: string,                                   // from SymbolType, e.g. 'CELL'
  lines:    [{ style, x1, y1, x2, y2 }],
  rects:    [{ style, x1, y1, x2, y2 }],
  circles:  [{ style, x1, y1, x2, y2 }],          // bounding box, NOT centre+radius
  arcs:     [{ style, x1, y1, x2, y2, xs, ys, xe, ye }],
  texts:    [{ x, y, just, size, text }],
  pins:     [{ x, y, name, order }],
  windows:  { [id:number]: { x, y, just, size } },
  attrs:    { [key:string]: string },             // SYMATTR
  unknown:  number,                               // count of unrecognised lines
}
```

- [ ] **Step 1: Write the failing test**

Create `test/parse-asy.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/parse-asy.test.js`
Expected: FAIL — `Cannot find module '../src/parse-asy.js'`

- [ ] **Step 3: Write the implementation**

Create `src/parse-asy.js`:

```js
import { toLines, toWords, toInt, restFrom } from './tokenize.js';

export function parseAsy(text) {
  const sym = {
    type: '', lines: [], rects: [], circles: [], arcs: [], texts: [],
    pins: [], windows: {}, attrs: {}, unknown: 0,
  };

  for (const raw of toLines(text)) {
    const w = toWords(raw);
    if (w.length === 0) continue;
    const kw = w[0];

    switch (kw) {
      case 'Version':
        break;
      case 'SymbolType':
        sym.type = w[1] ?? '';
        break;
      case 'LINE':
        sym.lines.push({ style: w[1], x1: toInt(w[2]), y1: toInt(w[3]), x2: toInt(w[4]), y2: toInt(w[5]) });
        break;
      case 'RECTANGLE':
        sym.rects.push({ style: w[1], x1: toInt(w[2]), y1: toInt(w[3]), x2: toInt(w[4]), y2: toInt(w[5]) });
        break;
      case 'CIRCLE':
        sym.circles.push({ style: w[1], x1: toInt(w[2]), y1: toInt(w[3]), x2: toInt(w[4]), y2: toInt(w[5]) });
        break;
      case 'ARC':
        sym.arcs.push({
          style: w[1], x1: toInt(w[2]), y1: toInt(w[3]), x2: toInt(w[4]), y2: toInt(w[5]),
          xs: toInt(w[6]), ys: toInt(w[7]), xe: toInt(w[8]), ye: toInt(w[9]),
        });
        break;
      case 'TEXT':
        sym.texts.push({
          x: toInt(w[1]), y: toInt(w[2]), just: w[3], size: toInt(w[4]),
          text: restFrom(raw, 5),
        });
        break;
      case 'WINDOW':
        sym.windows[toInt(w[1])] = { x: toInt(w[2]), y: toInt(w[3]), just: w[4], size: toInt(w[5]) };
        break;
      case 'SYMATTR':
        sym.attrs[w[1]] = restFrom(raw, 2);
        break;
      case 'PIN':
        sym.pins.push({ x: toInt(w[1]), y: toInt(w[2]), name: '', order: 0 });
        break;
      case 'PINATTR': {
        const pin = sym.pins[sym.pins.length - 1];
        if (!pin) { sym.unknown += 1; break; }
        if (w[1] === 'PinName') pin.name = restFrom(raw, 2);
        else if (w[1] === 'SpiceOrder') pin.order = toInt(w[2]);
        break;
      }
      default:
        sym.unknown += 1;
    }
  }
  return sym;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/parse-asy.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/parse-asy.js test/parse-asy.test.js
git commit -m "feat: add .asy symbol file parser"
```

---

### Task 3: Schematic file parser

**Files:**
- Create: `src/parse-asc.js`
- Test: `test/parse-asc.test.js`

**Interfaces:**
- Consumes: `toLines`, `toWords`, `toInt`, `restFrom` from `src/tokenize.js`.
- Produces: `parseAsc(text: string) -> SchematicModel` where

```js
SchematicModel = {
  sheet:     { n, w, h },
  wires:     [{ x1, y1, x2, y2 }],
  flags:     [{ x, y, name }],                    // name '0' means ground
  dataflags: [{ x, y, expr }],
  symbols:   [{ name, x, y, rot, attrs: {}, windows: {} }],
  texts:     [{ x, y, just, size, kind, lines: [] }],  // kind 'comment'|'directive'
  shapes:    [{ type: 'rect', style, x1, y1, x2, y2 }],
  unknown:   number,
}
```

`WINDOW` and `SYMATTR` lines attach to the most recently seen `SYMBOL`.

- [ ] **Step 1: Write the failing test**

Create `test/parse-asc.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/parse-asc.test.js`
Expected: FAIL — `Cannot find module '../src/parse-asc.js'`

- [ ] **Step 3: Write the implementation**

Create `src/parse-asc.js`:

```js
import { toLines, toWords, toInt, restFrom } from './tokenize.js';

export function parseAsc(text) {
  const model = {
    sheet: { n: 1, w: 0, h: 0 },
    wires: [], flags: [], dataflags: [], symbols: [], texts: [], shapes: [],
    unknown: 0,
  };
  let current = null; // most recent SYMBOL, target for WINDOW/SYMATTR

  for (const raw of toLines(text)) {
    const w = toWords(raw);
    if (w.length === 0) continue;

    switch (w[0]) {
      case 'Version':
        break;
      case 'SHEET':
        model.sheet = { n: toInt(w[1]), w: toInt(w[2]), h: toInt(w[3]) };
        break;
      case 'WIRE':
        model.wires.push({ x1: toInt(w[1]), y1: toInt(w[2]), x2: toInt(w[3]), y2: toInt(w[4]) });
        break;
      case 'FLAG':
        model.flags.push({ x: toInt(w[1]), y: toInt(w[2]), name: restFrom(raw, 3) });
        break;
      case 'DATAFLAG':
        model.dataflags.push({
          x: toInt(w[1]), y: toInt(w[2]), expr: restFrom(raw, 3).replace(/^"|"$/g, ''),
        });
        break;
      case 'SYMBOL':
        current = {
          name: w[1], x: toInt(w[2]), y: toInt(w[3]), rot: w[4] ?? 'R0',
          attrs: {}, windows: {},
        };
        model.symbols.push(current);
        break;
      case 'WINDOW':
        if (current) {
          current.windows[toInt(w[1])] =
            { x: toInt(w[2]), y: toInt(w[3]), just: w[4], size: toInt(w[5]) };
        } else model.unknown += 1;
        break;
      case 'SYMATTR':
        if (current) current.attrs[w[1]] = restFrom(raw, 2);
        else model.unknown += 1;
        break;
      case 'TEXT': {
        const body = restFrom(raw, 5);
        const kind = body.startsWith('!') ? 'directive'
                   : body.startsWith(';') ? 'comment' : 'comment';
        model.texts.push({
          x: toInt(w[1]), y: toInt(w[2]), just: w[3], size: toInt(w[4]), kind,
          // LTspice stores line breaks as the two characters \ and n.
          lines: body.replace(/^[!;]/, '').split('\\n'),
        });
        break;
      }
      case 'RECTANGLE':
        model.shapes.push({
          type: 'rect', style: w[1],
          x1: toInt(w[2]), y1: toInt(w[3]), x2: toInt(w[4]), y2: toInt(w[5]),
        });
        break;
      default:
        model.unknown += 1;
    }
  }
  return model;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/parse-asc.test.js`
Expected: PASS, 11 tests. In particular the last two must confirm 45 and 25 symbols and zero unrecognised lines across both real files.

- [ ] **Step 5: Commit**

```bash
git add src/parse-asc.js test/parse-asc.test.js
git commit -m "feat: add .asc schematic parser"
```

---

### Task 4: Transform table and the structural invariant

This is the highest-value test in the project. It simultaneously covers the transform table, both parsers, and the symbol geometry.

**Files:**
- Create: `src/transform.js`
- Test: `test/transform.test.js`
- Test: `test/invariant.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ROT: { [rot:string]: (x:number, y:number) => [number, number] }`
  - `place(inst: {x,y,rot}, px: number, py: number) -> [number, number]`
  - `unionBox(box: {minX,minY,maxX,maxY} | null, x: number, y: number) -> box` — mutates and returns
  - `emptyBox() -> {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity}`

- [ ] **Step 1: Write the failing tests**

Create `test/transform.test.js`:

```js
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
```

Create `test/invariant.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode } from '../src/decode.js';
import { parseAsc } from '../src/parse-asc.js';
import { place } from '../src/transform.js';

const symbols = JSON.parse(readFileSync('symbols.json', 'utf8'));

// Structural invariant: a transformed symbol pin must land on a wire endpoint
// or a flag. Anchors deliberately EXCLUDE other pins — letting a pin be
// satisfied by another pin makes the assertion tautological (every pin sits on
// itself) and also lets a transform that collapses all pins onto one point pass.
// The few genuine direct pin-to-pin connections are asserted explicitly instead.
function checkPins(file, placeFn = place) {
  const model = parseAsc(decode(readFileSync(file)));
  const key = (x, y) => `${x},${y}`;

  const anchors = new Set();
  for (const w of model.wires) {
    anchors.add(key(w.x1, w.y1));
    anchors.add(key(w.x2, w.y2));
  }
  for (const f of model.flags) anchors.add(key(f.x, f.y));

  const pinPoints = [];
  const unresolved = new Set();
  for (const inst of model.symbols) {
    const def = symbols[inst.name.toLowerCase()];
    if (!def) { unresolved.add(inst.name); continue; }
    for (const p of def.pins) pinPoints.push(placeFn(inst, p.x, p.y));
  }

  const offAnchor = pinPoints
    .map(([x, y]) => key(x, y))
    .filter((k) => !anchors.has(k));

  return {
    total: pinPoints.length,
    onAnchor: pinPoints.length - offAnchor.length,
    offAnchor,
    unresolved: [...unresolved],
  };
}

test('TPLAB v4.2.asc: pins land on wires or flags', () => {
  const r = checkPins('TPLAB v4.2.asc');
  assert.deepEqual(r.unresolved, [], 'all TPLAB symbols must resolve from stock');
  assert.equal(r.total, 102);
  assert.equal(r.onAnchor, 100, `off-anchor pins: ${r.offAnchor.join(' ')}`);
});

test('TPLAB: the only off-anchor pins are the documented pin-to-pin pair', () => {
  // Q1's base and R18 connect directly to each other at (16,176) with no wire
  // between them, which LTspice permits.
  const r = checkPins('TPLAB v4.2.asc');
  assert.deepEqual(r.offAnchor, ['16,176', '16,176']);
});

test('v6_8_4ohm.asc: every resolved pin lands on a wire or flag', () => {
  const r = checkPins('v6_8_4ohm.asc');
  assert.deepEqual(r.unresolved.sort(), ['TIP121', 'TIP127']);
  assert.equal(r.total, 50);
  assert.equal(r.onAnchor, 50, `off-anchor pins: ${r.offAnchor.join(' ')}`);
  assert.deepEqual(r.offAnchor, []);
});

test('the invariant is not tautological: a wrong transform must fail it', () => {
  // Ignore rotation entirely. If the assertion had any self-referential
  // anchoring left, this would still score perfectly.
  const ignoreRotation = (inst, px, py) => [inst.x + px, inst.y + py];
  const r = checkPins('TPLAB v4.2.asc', ignoreRotation);
  assert.equal(r.total, 102);
  assert.equal(r.onAnchor, 73,
    'ignoring rotation must drop TPLAB from 100 anchored pins to 73');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/transform.test.js test/invariant.test.js`
Expected: `transform.test.js` FAILs with `Cannot find module '../src/transform.js'`; `invariant.test.js` FAILs on missing `symbols.json` (built in Task 5). Both failures are expected at this point.

- [ ] **Step 3: Write the implementation**

Create `src/transform.js`:

```js
// Verified empirically against both workspace schematics by testing that every
// transformed symbol pin coincides with a wire endpoint, flag, or other pin
// (152/152). Do not re-derive these from first principles.
export const ROT = {
  R0:   (x, y) => [x, y],
  R90:  (x, y) => [-y, x],
  R180: (x, y) => [-x, -y],
  R270: (x, y) => [y, -x],
  M0:   (x, y) => [-x, y],
  M90:  (x, y) => [y, x],
  M180: (x, y) => [x, -y],
  M270: (x, y) => [-y, -x],
};

export function place(inst, px, py) {
  const fn = ROT[inst.rot] ?? ROT.R0;
  const [dx, dy] = fn(px, py);
  return [inst.x + dx, inst.y + dy];
}

export function emptyBox() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function unionBox(box, x, y) {
  if (x < box.minX) box.minX = x;
  if (y < box.minY) box.minY = y;
  if (x > box.maxX) box.maxX = x;
  if (y > box.maxY) box.maxY = y;
  return box;
}
```

- [ ] **Step 4: Run the transform tests to verify they pass**

Run: `node --test test/transform.test.js`
Expected: PASS, 6 tests.

`invariant.test.js` still fails on missing `symbols.json`. That is expected and is resolved in Task 5 — do not stub `symbols.json` to make it pass now.

- [ ] **Step 5: Commit**

```bash
git add src/transform.js test/transform.test.js test/invariant.test.js
git commit -m "feat: add verified symbol transform table and pin invariant test"
```

---

### Task 5: Symbol library generator

**Files:**
- Create: `tools/gen-symbols.mjs`
- Create: `symbols.json` (generated output, committed)

**Interfaces:**
- Consumes: `parseAsy` from `src/parse-asy.js`, `decode` from `src/decode.js`.
- Produces: `symbols.json`, a JSON object mapping lowercase symbol name to `SymbolDef`. Lookup by the renderer and by `test/invariant.test.js` is **case-insensitive**: `.asc` files write `res` and `TIP121` inconsistently, so keys are stored lowercased and every lookup lowercases its query.

- [ ] **Step 1: Write the generator**

Create `tools/gen-symbols.mjs`:

```js
// Converts the stock LTspice .asy symbols into symbols.json, using the same
// parser the app uses at runtime so bundled and user-supplied symbols can
// never render differently.
//
// Usage:  node tools/gen-symbols.mjs [path-to-lib/sym]
// The output is committed, so a fresh clone builds without LTspice installed.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { decode } from '../src/decode.js';
import { parseAsy } from '../src/parse-asy.js';

const CANDIDATES = [
  process.argv[2],
  process.env.LTSPICE_SYM,
  join(homedir(), 'AppData', 'Local', 'LTspice', 'lib', 'sym'),
  join(homedir(), 'Documents', 'LTspiceXVII', 'lib', 'sym'),
  'C:/Program Files/ADI/LTspice/lib/sym',
].filter(Boolean);

const dir = CANDIDATES.find((d) => existsSync(d));
if (!dir) {
  console.error('LTspice symbol directory not found. Tried:\n  ' + CANDIDATES.join('\n  '));
  console.error('Pass one explicitly: node tools/gen-symbols.mjs <path>');
  process.exit(1);
}

// Top-level .asy files only: these are the generic primitives (res, cap, npn,
// voltage, ...). Subdirectories are vendor part libraries, 26 MB of mostly
// generic boxes, deliberately excluded.
const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.asy'));

const out = {};
for (const f of files) {
  const name = f.slice(0, -4).toLowerCase();
  out[name] = parseAsy(decode(readFileSync(join(dir, f))));
}

writeFileSync('symbols.json', JSON.stringify(out) + '\n');

const bytes = JSON.stringify(out).length;
console.log(`Wrote symbols.json: ${files.length} symbols, ${(bytes / 1024).toFixed(1)} KB`);

const required = ['npn', 'pnp', 'res', 'cap', 'voltage'];
const missing = required.filter((r) => !out[r]);
if (missing.length) {
  console.error(`FAIL: required symbols missing: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`Required symbols present: ${required.join(', ')}`);
```

- [ ] **Step 2: Run the generator**

Run: `node tools/gen-symbols.mjs`
Expected output, approximately:

```
Wrote symbols.json: 53 symbols, <size> KB
Required symbols present: npn, pnp, res, cap, voltage
```

If the symbol directory is not found, pass it explicitly. On this machine it is `~/AppData/Local/LTspice/lib/sym`.

- [ ] **Step 3: Run the invariant test, which now has its data**

Run: `node --test test/invariant.test.js`
Expected: PASS, 4 tests. TPLAB must report 102 total pins with 100 anchored (the 2 off-anchor pins are the documented (16,176) pair). v6 must report 50/50 anchored with `TIP121`/`TIP127` as the only unresolved symbols. The mutation test must confirm that ignoring rotation drops TPLAB to 73 anchored pins.

This is the checkpoint the whole parsing layer was built toward. If either test fails, the failure message lists the exact unmatched coordinates — fix the parser or the transform, **do not relax the assertion**.

- [ ] **Step 4: Run the whole suite**

Run: `node --test`
Expected: PASS, all tests across 5 files.

- [ ] **Step 5: Commit**

```bash
git add tools/gen-symbols.mjs symbols.json
git commit -m "feat: generate bundled stock symbol library from LTspice .asy files"
```

---

### Task 6: Renderer — geometry

**Files:**
- Create: `src/render.js`
- Test: `test/render-geometry.test.js`

**Interfaces:**
- Consumes: `place`, `ROT`, `emptyBox`, `unionBox` from `src/transform.js`.
- Produces:
  - `computeBounds(model, symbolMap) -> {minX,minY,maxX,maxY}`
  - `junctionPoints(model, symbolMap) -> string[]` — `"x,y"` keys where 3+ connections meet
  - `renderSvg(model, symbolMap, opts?) -> string` — full `<svg>…</svg>` document
  - `opts = { annotations?: boolean }`, default `true`
  - `getSymbol(symbolMap, name) -> SymbolDef | undefined` — case-insensitive lookup

- [ ] **Step 1: Write the failing test**

Create `test/render-geometry.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/render-geometry.test.js`
Expected: FAIL — `Cannot find module '../src/render.js'`

- [ ] **Step 3: Write the implementation**

Create `src/render.js`. This task implements geometry; Task 7 adds the text layer into the marked place.

```js
import { place, ROT, emptyBox, unionBox } from './transform.js';

const MARGIN = 48;
const DASH = { Dot: '2,6', ShortDash: '8,6', Dash: '16,8', LongDash: '24,8' };

export function getSymbol(map, name) {
  if (!name) return undefined;
  return map[name] ?? map[name.toLowerCase()];
}

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dash(style) {
  const d = DASH[style];
  return d ? ` stroke-dasharray="${d}"` : '';
}

export function computeBounds(model, symbolMap) {
  const b = emptyBox();
  for (const w of model.wires) {
    unionBox(b, w.x1, w.y1);
    unionBox(b, w.x2, w.y2);
  }
  for (const f of model.flags) unionBox(b, f.x, f.y);
  for (const d of model.dataflags) unionBox(b, d.x, d.y);
  for (const t of model.texts) unionBox(b, t.x, t.y);
  for (const s of model.shapes) {
    unionBox(b, s.x1, s.y1);
    unionBox(b, s.x2, s.y2);
  }
  for (const inst of model.symbols) {
    const def = getSymbol(symbolMap, inst.name);
    if (!def) {
      unionBox(b, inst.x - 32, inst.y - 32);
      unionBox(b, inst.x + 64, inst.y + 64);
      continue;
    }
    for (const p of allSymbolPoints(def)) {
      const [x, y] = place(inst, p[0], p[1]);
      unionBox(b, x, y);
    }
  }
  if (!isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  return b;
}

function allSymbolPoints(def) {
  const pts = [];
  for (const l of def.lines) pts.push([l.x1, l.y1], [l.x2, l.y2]);
  for (const r of def.rects) pts.push([r.x1, r.y1], [r.x2, r.y2]);
  for (const c of def.circles) pts.push([c.x1, c.y1], [c.x2, c.y2]);
  for (const a of def.arcs) pts.push([a.x1, a.y1], [a.x2, a.y2]);
  for (const p of def.pins) pts.push([p.x, p.y]);
  return pts;
}

export function junctionPoints(model, symbolMap) {
  const count = new Map();
  const bump = (x, y) => {
    const k = `${x},${y}`;
    count.set(k, (count.get(k) ?? 0) + 1);
  };
  for (const w of model.wires) {
    bump(w.x1, w.y1);
    bump(w.x2, w.y2);
  }
  for (const inst of model.symbols) {
    const def = getSymbol(symbolMap, inst.name);
    if (!def) continue;
    for (const p of def.pins) {
      const [x, y] = place(inst, p.x, p.y);
      bump(x, y);
    }
  }
  return [...count.entries()].filter(([, n]) => n >= 3).map(([k]) => k);
}

function renderSymbolBody(def, inst) {
  const out = [];
  const P = (x, y) => place(inst, x, y);

  for (const l of def.lines) {
    const [x1, y1] = P(l.x1, l.y1);
    const [x2, y2] = P(l.x2, l.y2);
    out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${dash(l.style)}/>`);
  }
  for (const r of def.rects) {
    const [ax, ay] = P(r.x1, r.y1);
    const [bx, by] = P(r.x2, r.y2);
    out.push(`<rect x="${Math.min(ax, bx)}" y="${Math.min(ay, by)}" ` +
      `width="${Math.abs(bx - ax)}" height="${Math.abs(by - ay)}" ` +
      `fill="none"${dash(r.style)}/>`);
  }
  for (const c of def.circles) {
    // CIRCLE gives a bounding box. Transform its centre; radii swap under the
    // 90-degree orientations, which is what applying ROT to the half-extents does.
    const cx = (c.x1 + c.x2) / 2, cy = (c.y1 + c.y2) / 2;
    const [tcx, tcy] = P(cx, cy);
    const [hx, hy] = ROT[inst.rot ?? 'R0'](Math.abs(c.x2 - c.x1) / 2, Math.abs(c.y2 - c.y1) / 2);
    out.push(`<ellipse cx="${tcx}" cy="${tcy}" rx="${Math.abs(hx)}" ry="${Math.abs(hy)}" ` +
      `fill="none"${dash(c.style)}/>`);
  }
  for (const a of def.arcs) out.push(renderArc(a, inst));
  return out;
}

// ARC carries a bounding box plus start/end hint points. The hints are not
// guaranteed to lie exactly on the ellipse, so project them by angle and
// rebuild exact endpoints before emitting an elliptical-arc path.
function renderArc(a, inst) {
  const cx = (a.x1 + a.x2) / 2, cy = (a.y1 + a.y2) / 2;
  const rx = Math.abs(a.x2 - a.x1) / 2, ry = Math.abs(a.y2 - a.y1) / 2;
  if (rx === 0 || ry === 0) return '';

  const ang = (px, py) => Math.atan2((py - cy) / ry, (px - cx) / rx);
  const a0 = ang(a.xs, a.ys);
  const a1 = ang(a.xe, a.ye);
  const onEllipse = (t) => [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];

  const [sx, sy] = onEllipse(a0);
  const [ex, ey] = onEllipse(a1);

  // LTspice draws arcs counter-clockwise from start to end in its own
  // y-down space, which is sweep-flag 0 in SVG.
  let delta = a1 - a0;
  while (delta <= 0) delta += Math.PI * 2;
  const largeArc = delta > Math.PI ? 1 : 0;

  const [tsx, tsy] = place(inst, sx, sy);
  const [tex, tey] = place(inst, ex, ey);
  const mirrored = (inst.rot ?? 'R0').startsWith('M');
  const sweep = mirrored ? 1 : 0;

  return `<path d="M ${tsx} ${tsy} A ${rx} ${ry} 0 ${largeArc} ${sweep} ${tex} ${tey}" ` +
    `fill="none"${dash(a.style)}/>`;
}

function renderPlaceholder(inst) {
  const w = 96, h = 96;
  const label = [inst.attrs.InstName, inst.name, inst.attrs.Value]
    .filter(Boolean).map(esc);
  const rows = label.map((t, i) =>
    `<text x="${inst.x + w / 2}" y="${inst.y + 24 + i * 20}" text-anchor="middle" ` +
    `class="lbl">${t}</text>`).join('');
  return `<g class="placeholder"><rect x="${inst.x}" y="${inst.y}" width="${w}" ` +
    `height="${h}" fill="none" stroke-dasharray="8,6"/>${rows}</g>`;
}

export function renderSvg(model, symbolMap, opts = {}) {
  const annotations = opts.annotations !== false;
  const b = computeBounds(model, symbolMap);
  const x = b.minX - MARGIN, y = b.minY - MARGIN;
  const w = (b.maxX - b.minX) + MARGIN * 2;
  const h = (b.maxY - b.minY) + MARGIN * 2;

  const body = [];

  for (const s of model.shapes) {
    body.push(`<rect x="${Math.min(s.x1, s.x2)}" y="${Math.min(s.y1, s.y2)}" ` +
      `width="${Math.abs(s.x2 - s.x1)}" height="${Math.abs(s.y2 - s.y1)}" ` +
      `fill="none" class="shape"${dash(s.style)}/>`);
  }

  for (const wire of model.wires) {
    body.push(`<line x1="${wire.x1}" y1="${wire.y1}" x2="${wire.x2}" y2="${wire.y2}"/>`);
  }

  for (const inst of model.symbols) {
    const def = getSymbol(symbolMap, inst.name);
    if (!def) { body.push(renderPlaceholder(inst)); continue; }
    body.push(`<g class="sym">${renderSymbolBody(def, inst).join('')}</g>`);
  }

  for (const k of junctionPoints(model, symbolMap)) {
    const [jx, jy] = k.split(',');
    body.push(`<circle cx="${jx}" cy="${jy}" r="4" class="junction"/>`);
  }

  // TEXT LAYER INSERTED IN TASK 7
  body.push(renderTextLayer(model, symbolMap, annotations));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}">
<style>
  line, rect, ellipse, path, circle { stroke: var(--ink, #111); fill: none;
    stroke-width: 1.5; vector-effect: non-scaling-stroke; }
  circle.junction { fill: var(--ink, #111); stroke: none; }
  text { fill: var(--ink, #111); stroke: none;
    font-family: ui-monospace, Menlo, Consolas, monospace; }
  .placeholder rect { stroke: var(--warn, #b45309); }
  .placeholder text { fill: var(--warn, #b45309); }
</style>
<g id="root">${body.join('\n')}</g>
</svg>`;
}

// Replaced with the real implementation in Task 7.
function renderTextLayer() {
  return '';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/render-geometry.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render.js test/render-geometry.test.js
git commit -m "feat: render schematic geometry to SVG"
```

---

### Task 7: Renderer — text layer

**Files:**
- Modify: `src/render.js` (replace the `renderTextLayer` stub)
- Test: `test/render-text.test.js`

**Interfaces:**
- Consumes: everything from Task 6.
- Produces (internal to `src/render.js`, but exported for testing):
  - `SIZE: number[]` — index by LTspice size code 0–7, yields font size in schematic units
  - `justAttrs(just: string) -> { anchor: string, baseline: string, rotate: boolean }`
  - `renderTextLayer(model, symbolMap, annotations: boolean) -> string`
  - `GROUND_PATH: string` — the ground glyph as a path `d`, relative to the flag point

- [ ] **Step 1: Write the failing test**

Create `test/render-text.test.js`:

```js
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
  assert.ok(svg.includes('100\u00B5'), 'capacitor value 100µ must reach the SVG');
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/render-text.test.js`
Expected: FAIL — `justAttrs` and `SIZE` are not exported; label assertions fail because `renderTextLayer` returns `''`.

- [ ] **Step 3: Write the implementation**

In `src/render.js`, delete the `renderTextLayer` stub at the bottom and append the following. Also add `place` usage as already imported.

```js
// LTspice text size codes 0-7, expressed in schematic units. These are an
// initial calibration; Task 11 tunes them against the real files.
export const SIZE = [10, 13, 16, 20, 26, 34, 48, 64];

export function justAttrs(just = 'Left') {
  const rotate = just.startsWith('V');
  const base = rotate ? just.slice(1) : just;
  const anchor =
    base === 'Right' ? 'end' :
    base === 'Center' ? 'middle' :
    base === 'Top' || base === 'Bottom' ? 'middle' : 'start';
  const baseline =
    base === 'Top' ? 'hanging' :
    base === 'Bottom' ? 'auto' : 'central';
  return { anchor, baseline, rotate };
}

// The ground symbol has no .asy file, so it is drawn directly. A stub down
// from the flag point into an open triangle, in LTspice's grid units.
export const GROUND_PATH = 'M 0 0 L 0 12 M -16 12 L 16 12 L 0 28 Z';

function textEl(x, y, just, sizeCode, lines, cls) {
  const { anchor, baseline, rotate } = justAttrs(just);
  const fs = SIZE[sizeCode] ?? SIZE[2];
  // Text is never mirrored: only rotation is applied, never a negative scale.
  const tf = rotate ? ` transform="rotate(-90 ${x} ${y})"` : '';
  const body = lines.length === 1
    ? esc(lines[0])
    : lines.map((l, i) =>
        `<tspan x="${x}" dy="${i === 0 ? 0 : fs * 1.2}">${esc(l)}</tspan>`).join('');
  return `<text x="${x}" y="${y}" font-size="${fs}" text-anchor="${anchor}" ` +
    `dominant-baseline="${baseline}" class="${cls}"${tf}>${body}</text>`;
}

// WINDOW id -> the SYMATTR key it positions.
const WINDOW_ATTR = { 0: 'InstName', 3: 'Value', 123: 'Value2', 39: 'SpiceLine' };

function renderInstanceText(inst, def) {
  const out = [];
  for (const [idStr, key] of Object.entries(WINDOW_ATTR)) {
    const id = Number(idStr);
    const value = inst.attrs[key];
    if (!value) continue;

    // Instance WINDOW overrides the symbol's default WINDOW.
    const win = inst.windows[id] ?? def.windows[id];
    if (!win) continue;
    if (win.size === 0) continue; // size 0 means hidden

    // WINDOW offsets are read as pre-transform symbol-local coordinates.
    // Task 11 calibrates this against the rendered output.
    const [x, y] = place(inst, win.x, win.y);
    out.push(textEl(x, y, win.just, win.size, [value], 'lbl'));
  }
  return out.join('');
}

export function renderTextLayer(model, symbolMap, annotations) {
  const out = [];

  for (const f of model.flags) {
    if (f.name === '0') {
      out.push(`<path class="gnd" d="${GROUND_PATH}" fill="none" ` +
        `transform="translate(${f.x} ${f.y})"/>`);
    } else {
      out.push(textEl(f.x, f.y - 8, 'Center', 2, [f.name], 'net'));
    }
  }

  for (const inst of model.symbols) {
    const def = getSymbol(symbolMap, inst.name);
    if (!def) continue; // placeholders carry their own labels
    out.push(renderInstanceText(inst, def));
  }

  if (annotations) {
    for (const d of model.dataflags) {
      if (!d.expr) continue; // most dataflags carry empty expressions
      out.push(textEl(d.x + 8, d.y, 'Left', 2, [d.expr], 'dataflag'));
    }
    for (const t of model.texts) {
      out.push(textEl(t.x, t.y, t.just, t.size, t.lines,
        t.kind === 'directive' ? 'directive' : 'comment'));
    }
  }

  return out.join('\n');
}
```

Extend the `<style>` block inside `renderSvg` with:

```css
  .gnd { stroke: var(--ink, #111); }
  .net { fill: var(--net, #1d4ed8); }
  .directive { fill: var(--ink, #111); }
  .comment { fill: var(--muted, #4b5563); }
  .dataflag { fill: var(--probe, #047857); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/render-text.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run the full suite**

Run: `node --test`
Expected: PASS across all 7 test files.

- [ ] **Step 6: Commit**

```bash
git add src/render.js test/render-text.test.js
git commit -m "feat: render net labels, ground glyph, attributes and annotations"
```

---

### Task 8: HTML template and build script

**Files:**
- Create: `src/template.html`
- Create: `tools/build.mjs`
- Create: `spiceviewer.html` (generated, committed)
- Test: `test/build.test.js`

**Interfaces:**
- Consumes: all `src/*.js`, `symbols.json`.
- Produces: `spiceviewer.html` — one file, no external references.

The build concatenates modules in dependency order, stripping `import` statements and the `export` keyword. This is why top-level identifiers must be unique across modules.

- [ ] **Step 1: Write the failing test**

Create `test/build.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/build.test.js`
Expected: FAIL — `spiceviewer.html` does not exist.

- [ ] **Step 3: Write the template and build script**

Create `src/template.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>LTspice Schematic Viewer</title>
<style>
  :root {
    --bg: #fbfbf9; --ink: #111; --muted: #4b5563; --net: #1d4ed8;
    --probe: #047857; --warn: #b45309; --bar: #ffffff; --line: #d4d4d8;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14151a; --ink: #e8e8ea; --muted: #9ca3af; --net: #7dd3fc;
      --probe: #6ee7b7; --warn: #fbbf24; --bar: #1c1d23; --line: #2e3038;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden;
    background: var(--bg); color: var(--ink);
    font: 15px/1.4 system-ui, -apple-system, Segoe UI, sans-serif; }
  #bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px;
    background: var(--bar); border-bottom: 1px solid var(--line); }
  #name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; color: var(--muted); }
  button { min-height: 44px; min-width: 44px; padding: 0 12px;
    background: none; border: 1px solid var(--line); border-radius: 8px;
    color: var(--ink); font: inherit; }
  button[aria-pressed="true"] { background: var(--ink); color: var(--bar); }
  #stage { position: absolute; inset: 57px 0 0 0; overflow: hidden;
    touch-action: none; }
  #stage svg { position: absolute; top: 0; left: 0;
    width: 100%; height: 100%; transform-origin: 0 0; }
  #banner { position: absolute; left: 8px; right: 8px; bottom: 8px;
    padding: 10px 12px; border-radius: 10px; background: var(--bar);
    border: 1px solid var(--warn); color: var(--warn); }
  #banner[hidden] { display: none; }
  #empty { position: absolute; inset: 0; display: grid; place-items: center;
    padding: 24px; text-align: center; color: var(--muted); }
  #file { display: none; }
</style>
</head>
<body>
<div id="bar">
  <button id="open">Open</button>
  <span id="name">No file</span>
  <button id="ann" aria-pressed="true">Notes</button>
  <button id="fit">Fit</button>
</div>
<div id="stage">
  <div id="empty">Tap <b>Open</b> and choose an .asc file.<br>
    Select its .asy symbol files at the same time if it uses custom parts.</div>
</div>
<div id="banner" hidden></div>
<input id="file" type="file" multiple>
<script>
const SYMBOLS = /*<!--INJECT:SYMBOLS-->*/{};
</script>
<script type="module">
<!--INJECT:MODULES-->
</script>
</body>
</html>
```

Note: **no `accept` attribute** on the file input. `.asc` has no registered UTI, and setting `accept` greys the files out in iOS Files.

Create `tools/build.mjs`:

```js
// Concatenates src/ modules and symbols.json into one self-contained HTML file.
// Modules are inlined in dependency order into a single module scope, so
// top-level identifiers must be unique across files.
import { readFileSync, writeFileSync } from 'node:fs';

const ORDER = [
  'src/tokenize.js',
  'src/decode.js',
  'src/parse-asy.js',
  'src/parse-asc.js',
  'src/transform.js',
  'src/render.js',
  'src/app.js',
];

function strip(src, path) {
  const out = src
    .replace(/^\s*import\s[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  if (/\bimport\s/.test(out)) {
    throw new Error(`${path}: an import statement survived stripping`);
  }
  return `// ---- ${path} ----\n${out.trim()}\n`;
}

const modules = ORDER.map((p) => strip(readFileSync(p, 'utf8'), p)).join('\n');
const symbols = readFileSync('symbols.json', 'utf8').trim();

const html = readFileSync('src/template.html', 'utf8')
  .replace('/*<!--INJECT:SYMBOLS-->*/{}', symbols)
  .replace('<!--INJECT:MODULES-->', modules);

if (html.includes('<!--INJECT:')) {
  throw new Error('unreplaced placeholder remains in template');
}

writeFileSync('spiceviewer.html', html);
console.log(`Wrote spiceviewer.html: ${(html.length / 1024).toFixed(1)} KB`);
```

Create a minimal `src/app.js` so the build has all its inputs. Task 9 fills it in:

```js
// Filled in by Task 9.
```

- [ ] **Step 4: Run the build and the test**

Run: `node tools/build.mjs && node --test test/build.test.js`
Expected: the build prints a size, then PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/template.html src/app.js tools/build.mjs spiceviewer.html test/build.test.js
git commit -m "feat: add HTML template and self-contained build script"
```

---

### Task 9: App shell — file handling and symbol resolution

**Files:**
- Modify: `src/app.js`
- Modify: `spiceviewer.html` (rebuild)

**Interfaces:**
- Consumes: `decode`, `parseAsc`, `parseAsy`, `renderSvg`, `getSymbol`.
- Produces (internal to `app.js`):
  - `classifyFile(text) -> 'asc' | 'asy' | 'unknown'`
  - `symbolNameFromFilename(filename) -> string` — basename, lowercased, `.asy` removed
  - `loadUserSymbols() -> object` / `saveUserSymbol(name, def)` — `localStorage`, both `try`/`catch` wrapped
  - `showSchematic(model)` — renders and mounts

- [ ] **Step 1: Write the implementation**

Replace `src/app.js` entirely:

```js
const LS_KEY = 'spiceviewer.symbols.v1';

let userSymbols = loadUserSymbols();
let currentModel = null;
let annotations = true;

const $ = (id) => document.getElementById(id);

export function classifyFile(text) {
  if (/^SymbolType\s/m.test(text)) return 'asy';
  if (/^SHEET\s/m.test(text)) return 'asc';
  return 'unknown';
}

export function symbolNameFromFilename(filename) {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.replace(/\.asy$/i, '').toLowerCase();
}

export function loadUserSymbols() {
  // Private-mode browsers throw on localStorage access; the app must still run.
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveUserSymbol(name, def) {
  userSymbols[name] = def;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(userSymbols));
  } catch {
    /* quota or private mode: the symbol still works for this session */
  }
}

function allSymbols() {
  return { ...SYMBOLS, ...userSymbols };
}

function unresolvedNames(model) {
  const map = allSymbols();
  const missing = new Set();
  for (const inst of model.symbols) {
    if (!getSymbol(map, inst.name)) missing.add(inst.name);
  }
  return [...missing];
}

function showBanner(model) {
  const missing = unresolvedNames(model);
  const el = $('banner');
  if (missing.length === 0) {
    el.hidden = true;
    return;
  }
  el.textContent =
    `${missing.length} symbol${missing.length > 1 ? 's' : ''} unresolved: ` +
    `${missing.join(', ')} — tap to add .asy files`;
  el.hidden = false;
}

export function showSchematic(model) {
  currentModel = model;
  const stage = $('stage');
  stage.innerHTML = renderSvg(model, allSymbols(), { annotations });
  showBanner(model);
  resetView();
}

async function handleFiles(fileList) {
  const files = [...fileList];
  let schematic = null;
  let schematicName = '';
  let added = 0;

  for (const f of files) {
    const text = decode(await f.arrayBuffer());
    const kind = classifyFile(text);
    if (kind === 'asy') {
      saveUserSymbol(symbolNameFromFilename(f.name), parseAsy(text));
      added += 1;
    } else if (kind === 'asc' && !schematic) {
      schematic = parseAsc(text);
      schematicName = f.name;
    }
  }

  if (schematic) {
    $('name').textContent = schematicName;
    showSchematic(schematic);
  } else if (added > 0 && currentModel) {
    showSchematic(currentModel); // re-render with the newly supplied symbols
  } else if (added === 0) {
    $('name').textContent = 'Not a schematic file';
  }
}

function wireUp() {
  $('open').addEventListener('click', () => $('file').click());
  $('banner').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', (e) => {
    handleFiles(e.target.files);
    e.target.value = ''; // allow re-picking the same file
  });

  $('ann').addEventListener('click', () => {
    annotations = !annotations;
    $('ann').setAttribute('aria-pressed', String(annotations));
    if (currentModel) showSchematic(currentModel);
  });

  const stage = $('stage');
  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  });
}

if (typeof document !== 'undefined') wireUp();
```

`resetView` and the gesture handlers arrive in Task 10. Add a temporary definition at the end of `src/app.js` so the build produces a runnable page:

```js
function resetView() { /* replaced in Task 10 */ }
```

- [ ] **Step 2: Rebuild**

Run: `node tools/build.mjs && node --test`
Expected: build succeeds; all existing tests still PASS.

- [ ] **Step 3: Verify by hand in a browser**

Open `spiceviewer.html`, tap **Open**, choose `TPLAB v4.2.asc`.
Expected: the schematic renders; the banner stays hidden because all 40 symbols resolve from stock.

Then open `v6_8_4ohm.asc`.
Expected: the schematic renders and the banner reads `2 symbols unresolved: TIP121, TIP127 — tap to add .asy files`.

Record what you actually observe. If the banner text differs, fix it before committing.

- [ ] **Step 4: Commit**

```bash
git add src/app.js spiceviewer.html
git commit -m "feat: add file picker, symbol caching and unresolved-symbol banner"
```

---

### Task 10: App shell — pan, zoom and fit

**Files:**
- Modify: `src/app.js`
- Modify: `spiceviewer.html` (rebuild)

**Interfaces:**
- Consumes: Task 9's `showSchematic`.
- Produces: `resetView()`, replacing the temporary stub. Pan/zoom state lives in module-scope `view = { x, y, k }` applied as one CSS transform on the mounted `<svg>`.

- [ ] **Step 1: Write the implementation**

In `src/app.js`, replace the temporary `resetView` stub with:

```js
const view = { x: 0, y: 0, k: 1 };
const pointers = new Map();
let pinchStart = null;
let lastTap = 0;

function svgEl() {
  return $('stage').querySelector('svg');
}

function applyView() {
  const el = svgEl();
  if (el) el.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
}

function resetView() {
  view.x = 0;
  view.y = 0;
  view.k = 1;
  applyView();
}

// Zoom about a fixed screen point so content under the fingers stays put.
function zoomAbout(cx, cy, factor) {
  const next = Math.min(40, Math.max(0.2, view.k * factor));
  const ratio = next / view.k;
  view.x = cx - (cx - view.x) * ratio;
  view.y = cy - (cy - view.y) * ratio;
  view.k = next;
  applyView();
}

// zoomAbout works in stage-relative coordinates, so convert here rather than
// hardcoding the top-bar height.
function midpoint() {
  const pts = [...pointers.values()];
  const r = $('stage').getBoundingClientRect();
  return {
    x: (pts[0].x + pts[1].x) / 2 - r.left,
    y: (pts[0].y + pts[1].y) / 2 - r.top,
    d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
  };
}

function initGestures() {
  const stage = $('stage');

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) pinchStart = midpoint();

    const now = Date.now();
    if (pointers.size === 1 && now - lastTap < 300) resetView();
    lastTap = now;
  });

  stage.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, next);

    if (pointers.size === 1) {
      view.x += next.x - prev.x;
      view.y += next.y - prev.y;
      applyView();
    } else if (pointers.size === 2 && pinchStart) {
      const m = midpoint();
      if (pinchStart.d > 0) {
        zoomAbout(m.x, m.y, m.d / pinchStart.d);
        view.x += m.x - pinchStart.x;
        view.y += m.y - pinchStart.y;
        applyView();
      }
      pinchStart = m;
    }
  });

  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  // Desktop convenience; harmless on touch devices. The stage origin is read
  // from layout rather than hardcoded, so the CSS bar height stays the single
  // source of truth for it.
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAbout(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.002));
  }, { passive: false });

  $('fit').addEventListener('click', resetView);
}
```

Change the bottom of `src/app.js` to initialise gestures:

```js
if (typeof document !== 'undefined') {
  wireUp();
  initGestures();
}
```

The SVG's `viewBox` already fits the content to the element box, and the element is sized `width:100%; height:100%`. So "fit" is exactly `translate(0,0) scale(1)` — no measurement needed.

- [ ] **Step 2: Rebuild and run the suite**

Run: `node tools/build.mjs && node --test`
Expected: build succeeds; all tests PASS.

- [ ] **Step 3: Verify gestures by hand**

Open `spiceviewer.html` in a browser and confirm each of these, at a 390 px wide window (Chrome DevTools device toolbar, iPhone preset):

1. `TPLAB v4.2.asc` opens fitted, with the whole circuit visible including its negative-x region.
2. Dragging with one pointer pans.
3. Pinch (or ctrl+scroll in DevTools) zooms about the pointer, not the corner.
4. Double-tap returns to fit.
5. **Fit** does the same.
6. Wire strokes stay a constant thickness at every zoom level, and are clearly visible when fitted.
7. The page itself never scrolls or rubber-bands while panning.
8. **Notes** toggles the SPICE directives and comments off and on; `Q1`, `RE1` and `vcc` stay visible either way.

Record the actual result of each. Any that fail must be fixed before committing.

- [ ] **Step 4: Commit**

```bash
git add src/app.js spiceviewer.html
git commit -m "feat: add pinch-zoom, pan and fit gestures"
```

---

### Task 11: Visual calibration and final verification

This task closes the two open items the spec carried forward.

**Files:**
- Modify: `src/render.js` (`SIZE` table, and the `WINDOW` coordinate-space reading if wrong)
- Create: `README.md`
- Modify: `spiceviewer.html` (rebuild)

**Interfaces:**
- Consumes: everything.
- Produces: no new API. Adjusts constants and documents the project.

- [ ] **Step 1: Calibrate the WINDOW coordinate space**

Open `spiceviewer.html` and load `v6_8_4ohm.asc`. Inspect rotated instances specifically — `RE1` (`res … R180`), `R10` (`res … R90`), `C6` (`cap … R90`), `Q2` (`pnp … R180`).

The current code reads `WINDOW` offsets as pre-transform symbol-local coordinates (`place(inst, win.x, win.y)` in `renderInstanceText`).

Decide from what you see:

- **Labels sit beside their components** on rotated instances: the reading is correct. Leave it, and delete the "Task 11 calibrates this" comment.
- **Labels sit on top of, or far from, their components** only on rotated instances while `R0` instances look right: the offsets are already-transformed. Change that line to:

```js
    const x = inst.x + win.x, y = inst.y + win.y;
```

Then re-check the same four instances.

- [ ] **Step 2: Calibrate the text size table**

With the same file open, compare label size against wire spacing. LTspice's grid is 16 units; a size-2 label should read comfortably without colliding with neighbouring components.

Adjust `SIZE` in `src/render.js` if labels are noticeably too large or small. Rebuild after each change with `node tools/build.mjs`.

Record the final table in your commit message.

- [ ] **Step 3: Write the README**

Create `README.md`:

````markdown
# spiceviewer

A mobile viewer for LTspice `.asc` schematics. It draws circuits — it does not
simulate, netlist, or edit them.

## Use

Open `spiceviewer.html` in any browser. Tap **Open** and choose an `.asc` file.
Pinch to zoom, drag to pan, double-tap or press **Fit** to reset.

The file is fully self-contained: no server, no network, no dependencies.
Copy it to a phone and open it directly.

### Custom symbols

`.asc` files reference component artwork stored in separate `.asy` files. The
53 stock LTspice symbols (resistors, capacitors, transistors, sources…) are
bundled. For anything else — vendor parts such as `TIP121` — select the `.asy`
files alongside the `.asc` in the same picker. They are remembered for next
time.

Unresolved symbols render as dashed placeholder boxes. Their pin positions are
unknown, so wires will not meet them correctly.

## Develop

```bash
node --test          # run the test suite
node tools/gen-symbols.mjs # regenerate symbols.json (needs LTspice installed)
node tools/build.mjs       # rebuild spiceviewer.html
```

Requires Node 18+. No dependencies to install.

`src/` holds the modules; `tools/build.mjs` concatenates them into one scope,
so **top-level identifiers must be unique across `src/*.js`**.

## Docs

- Design: `docs/superpowers/specs/2026-09-13-ltspice-schematic-viewer-design.md`
- Plan: `docs/superpowers/plans/2026-09-13-ltspice-schematic-viewer.md`
````

- [ ] **Step 4: Run the full verification**

Run each and record the real output:

```bash
node --test
node tools/build.mjs
```

Expected: every test passes; the build reports a size.

Then, in a 390 px viewport, confirm and record:

1. `TPLAB v4.2.asc` renders with all 45 components, no placeholder boxes.
2. `v6_8_4ohm.asc` renders with 23 resolved components plus 2 dashed placeholders and the banner.
3. Component values read correctly at zoom, `100µ` included with its micro sign.
4. Net labels `vcc`, `vee`, `Vo`, `Vin-` are visible and legible.
5. Ground glyphs appear at every `FLAG … 0`.
6. Junction dots appear at genuine T-junctions and not at plain corners.
7. **Notes** hides and shows the directives, comments and probe labels.

- [ ] **Step 5: Commit and push**

```bash
git add -A
git commit -m "fix: calibrate WINDOW offsets and text sizing; add README"
git push
```

---

## Verification Summary

At completion, all of the following must hold, each confirmed by actual output rather than assumption:

| Check | Command / method |
|---|---|
| All tests pass | `node --test` |
| Both files parse with zero unknown lines | `test/parse-asc.test.js` |
| Pin invariant holds (TPLAB 100/102 anchored, v6 50/50) and is non-tautological | `test/invariant.test.js` |
| Build is self-contained | `test/build.test.js` |
| cp1252 `µ` survives end to end | `test/render-text.test.js` |
| Renders correctly at phone width | Manual, Task 11 Step 4 |

## Self-Review Notes

Checked against the spec:

- **Spec coverage.** Every spec section maps to a task: encoding (1), grammar (2, 3), transform table (4), `SHEET`-is-not-bounds (6), five `.asy` primitives (2, 6), junction dots (6), ground glyph and net labels (7), `WINDOW` ids and size-0 hiding (7), no-text-mirroring (7), `vector-effect` (6), annotations toggle (7, 10), no-`accept`-attribute (8), `localStorage` in `try`/`catch` (9), missing-symbol banner (9), gestures and `touch-action` (8, 10), unrecognised-line tolerance (2, 3), hard errors (9 via `classifyFile`), testing strategy (4, 5, 11).
- **Two spec items were promoted to their own task** rather than left as prose: the `WINDOW` coordinate-space calibration and text sizing are Task 11, with a concrete decision procedure instead of "adjust as needed".
- **Type consistency.** `getSymbol`, `place`, `renderSvg`, `renderTextLayer`, `justAttrs`, `SIZE`, `computeBounds`, `junctionPoints`, `classifyFile`, `symbolNameFromFilename`, `loadUserSymbol`/`saveUserSymbol`, `showSchematic`, `resetView` are each defined once and referenced with the same name and signature throughout.
- **One name was corrected during review:** `loadUserSymbols` (plural, returns the whole map) versus `saveUserSymbol` (singular, writes one). The asymmetry is intentional and consistent across Tasks 9 and 10.
