# LTspice Schematic Viewer — Design

**Date:** 2026-09-13
**Status:** Approved, ready for implementation planning

## Purpose

A viewer that renders LTspice `.asc` schematics on a phone. It draws circuits.
It does not simulate, netlist, or edit them.

The user opens an arbitrary `.asc` from the phone's file storage, sees the
schematic fitted to the screen, and pinch-zooms to read it.

## Non-goals

- No simulation, netlist generation, or SPICE evaluation.
- No editing, and no export.
- No `.raw` waveform or `.plt` plot handling.
- No parsing of `.lib`/`.model` files. `.include` directives render as text only.
- No server. The delivered artifact is a static file.

## Deliverables

1. `spiceviewer.html` — one self-contained file. All JS and symbol data inlined.
   No network, no dependencies, no build tooling required to open it.
2. `src/` — the modules the HTML is built from, maintainable and unit-testable.
3. `tools/` — the symbol generator and the build script.

Both (1) and (2) are real deliverables. The built HTML is meant to be handed
around and opened directly, not treated as a disposable bundle.

## Background: the `.asc` format

Findings from the two workspace files, verified by inspection.

### Encoding

Plain 8-bit text, LF line endings, **cp1252** — not UTF-8. `100µ` is stored as
byte `0xB5`; decoding as UTF-8 corrupts component values. Some LTspice files are
UTF-16 instead.

Decoding order:

1. UTF-16LE/BE if a BOM is present.
2. **UTF-16 with no BOM** — detected by a NUL in byte 0 or byte 1. Every `.asc`
   and `.asy` begins with the ASCII word `Version`, so cp1252 text never looks
   like this. (Discovered during implementation: `fraprobe.asy` in the stock
   library is BOM-less UTF-16LE. Without this branch it decoded to NUL-riddled
   text, parsed to zero geometry, and would have *resolved* — rendering as a
   blank component with no placeholder warning.)
3. cp1252 otherwise.

`tools/gen-symbols.mjs` exits non-zero if any symbol parses with unrecognised
lines, so a decoding regression fails the build instead of silently emitting
empty artwork.

### Grammar

Every line is `KEYWORD arg arg ...`, space-separated. The keywords observed:

| Keyword | Form | Meaning |
|---|---|---|
| `Version` | `Version 4` | file version (`4` and `4.1` both seen) |
| `SHEET` | `SHEET n w h` | nominal sheet size — **not** a bounding box |
| `WIRE` | `WIRE x1 y1 x2 y2` | wire segment; the only connectivity primitive |
| `FLAG` | `FLAG x y name` | net label; `name == "0"` means ground |
| `DATAFLAG` | `DATAFLAG x y "expr"` | probe annotation |
| `SYMBOL` | `SYMBOL name x y rot` | component instance |
| `WINDOW` | `WINDOW id x y just size` | attribute text placement override |
| `SYMATTR` | `SYMATTR key value` | instance attribute |
| `TEXT` | `TEXT x y just size ;text` | comment (`;`) or SPICE directive (`!`) |
| `RECTANGLE` | `RECTANGLE style x1 y1 x2 y2 lw` | drawn box |

`TEXT` bodies use a literal two-character backslash-n escape for line breaks.

### `SHEET` does not bound the content

`TPLAB v4.2.asc` declares `SHEET 1 3652 1136`, but its geometry spans
x = -464...3168 and y = -336...960. The true bounding box must be computed by
unioning all geometry. Trusting `SHEET` clips the left third of the circuit.

### Symbol geometry lives in separate `.asy` files

`SYMBOL npn 48 128 R0` carries no artwork. The drawing lives in `npn.asy`.
`.asy` uses the same line grammar and exactly five drawing primitives across
the entire 6,687-symbol library:

| Primitive | Form | Note |
|---|---|---|
| `LINE` | `LINE style x1 y1 x2 y2` | |
| `RECTANGLE` | `RECTANGLE style x1 y1 x2 y2` | |
| `CIRCLE` | `CIRCLE style x1 y1 x2 y2` | a **bounding box**, not centre+radius |
| `ARC` | `ARC style x1 y1 x2 y2 xs ys xe ye` | bounding box + start/end hints |
| `TEXT` | `TEXT x y just size text` | |

plus `PIN x y NONE 0` / `PINATTR` and `WINDOW`.

### Transform table — verified, not assumed

Local symbol coordinates are transformed, then offset by the instance origin:

```
R0 (x,y)    R90 (-y,x)   R180 (-x,-y)   R270 (y,-x)
M0 (-x,y)   M90 (y,x)    M180 (x,-y)    M270 (-y,-x)
```

Verified by computing every symbol pin position in both workspace files and
testing coincidence with wire endpoints: **TPLAB 98/102, v6 49/50**. All five
apparent misses are accounted for — four pins terminate directly on a `FLAG`
with no wire, and the remaining two (`Q1` base and `R18`) both resolve to
(16,176), a legal direct pin-to-pin connection. Effectively 152/152.

### Workspace files

| File | Version | Sheet | Symbols | Notes |
|---|---|---|---|---|
| `TPLAB v4.2.asc` | 4 | 3652x1136 | 45 | `.step param POT`, `{R1}` parameters |
| `v6_8_4ohm.asc` | 4.1 | 2144x1212 | 25 | needs custom `TIP121`/`TIP127` |

Stock symbols required: `npn`, `pnp`, `res`, `cap`, `voltage` — all present in
the local LTspice library at `~/AppData/Local/LTspice/lib/sym`.

`TIP121.asy` and `TIP127.asy` are **not** in the workspace and not in the stock
library. `v6_8_4ohm.asc` will render them as placeholders until the user
supplies those files.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| File input | Runtime picker, any `.asc` | Not limited to the two workspace files |
| Symbol library | Bundle 53 stock symbols (~95 KB raw, ~20 KB compressed); accept user `.asy` | Covers virtually all discrete schematics; the 26 MB vendor library is mostly generic boxes |
| Delivery | Single self-contained HTML file | No hosting, no publishing, nothing leaves the machine |
| Code organization | `src/` modules + build script | The `.asy`-to-JSON generator is mandatory anyway, so the build costs almost nothing |
| Rendering | SVG DOM | Vector-sharp at any zoom; free text layout; pan/zoom is one CSS transform |
| Navigation | Fit-on-open, pinch-zoom + pan | ~3,600-unit-wide schematics are unreadable when fitted to a 390 px screen |

### Rejected alternatives

- **Canvas 2D rendering.** Faster for very large files, but costs manual text
  metrics, hit-testing, and device-pixel-ratio handling. `TPLAB` produces about
  1,200 SVG nodes, which mobile browsers handle without effort.
- **Converting the full 26 MB symbol library.** A build pipeline to maintain for
  mostly vendor parts that draw as generic boxes.
- **Auto-reflow into swipeable tiles.** Breaks wires across tile boundaries and
  distorts how the circuit reads.
- **PWA with service worker.** More moving parts, and needs real hosting, for a
  viewer that is already offline-capable once loaded.

## Architecture

One-way pipeline, no shared mutable state:

```
File picker -> bytes
   -> decode()     sniff BOM: UTF-16LE/BE, else cp1252
   -> parseAsc()   text -> SchematicModel
   -> resolve()    SYMBOL names -> symbol defs (bundled + user-supplied)
   -> render()     model + symbols -> SVG element
   -> viewport     fit-to-screen, then pinch/pan via one CSS transform
```

### Modules

| Module | Input -> Output | Depends on |
|---|---|---|
| `src/decode.js` | `ArrayBuffer` -> `string` | — |
| `src/parse-asc.js` | `string` -> `SchematicModel` | — |
| `src/parse-asy.js` | `string` -> `SymbolDef` | — |
| `src/render.js` | `(model, symbolMap)` -> `SVGElement` | — |
| `src/app.js` | DOM wiring, picker, gestures | all |

`parse-asc` and `parse-asy` share a line grammar but produce different schemas,
so they stay separate over a small shared `tokenize()` helper. Neither touches
the DOM, which makes both testable in Node without a browser.

### Data schemas

```js
SchematicModel = {
  sheet:     { w, h },
  wires:     [{ x1, y1, x2, y2 }],
  flags:     [{ x, y, name }],
  dataflags: [{ x, y, expr }],
  symbols:   [{ name, x, y, rot, attrs: {}, windows: {} }],
  texts:     [{ x, y, just, size, kind: 'comment'|'directive', lines: [] }],
  shapes:    [{ type: 'rect', style, x1, y1, x2, y2 }],
}

SymbolDef = {
  lines: [], circles: [], arcs: [], rects: [], texts: [],
  pins:  [{ x, y, name, order }],
  windows: { id: { x, y, just, size } },
}
```

### Build

`tools/gen-symbols.mjs` reads the 53 stock `.asy` files from the local LTspice
install **through `src/parse-asy.js`** — the same parser the app uses at
runtime — and writes `symbols.json`. Using one parser for both paths guarantees
a bundled symbol and a user-dropped `.asy` can never render differently.

`tools/build.mjs` inlines the modules and `symbols.json` into an HTML template,
emitting `spiceviewer.html`. Roughly 25 lines: read, string-replace, write.

Node is required to rebuild. It is not required to run the output.

## Rendering

### Coordinate system

LTspice's y-axis points down, as does SVG's. Geometry maps 1:1 with no flip.
Schematic units become SVG user units; `viewBox` is set from the computed
bounding box plus a small margin.

### Schematic elements

- **Wires** render as `<line>`. Where **three or more** wire endpoints coincide,
  draw a filled junction dot. Two-endpoint meetings are corners and get nothing.
  Without this, T-junctions and mere crossings are visually identical and the
  circuit is ambiguous to read.
- **`FLAG` named `0`** renders the ground glyph, hardcoded (it has no `.asy`).
- **`FLAG` otherwise** renders net label text. These carry the real signal names
  (`vcc`, `vee`, `Vo`, `vc1`, `Vin-`) and are how a partially-wired circuit is
  followed.
- **`RECTANGLE`** renders as outline only. `v6_8_4ohm` uses two as grouping boxes.
- **`TEXT`** renders comments and SPICE directives; the literal backslash-n
  escape expands to `<tspan>` lines.

### Attribute text

`WINDOW` ids: `0` = InstName, `3` = Value, `123` = Value2, `39` = SpiceLine.

Defaults come from the symbol's own `.asy` `WINDOW` lines; `.asc` `WINDOW` lines
override them per instance.

**Size `0` means hidden.** This is how `SYMATTR Value2 AC 1 0` on the voltage
sources is suppressed in LTspice. Honoring it keeps the drawing from filling
with text LTspice does not show.

Justification: `Left`, `Right`, `Center`, `Top`, `Bottom`, and `V`-prefixed
vertical variants.

Mirrored instances (`M0`, `M180`, ...) must **not** mirror their text — LTspice
never renders backwards labels. Geometry receives the full transform; attribute
text receives position only.

### Known unknown: `WINDOW` offset coordinate space

It is not yet determined whether `.asc` `WINDOW` offsets are in pre-transform
symbol-local space or are already-transformed offsets from the instance origin.
For `R0` instances the two readings are identical, so the workspace files cannot
distinguish them by inspection.

**RESOLVED during implementation — offsets are absolute.** Both `.asy` defaults
and `.asc` overrides are offsets from the instance origin in the placed frame,
applied without rotation:

```js
const x = inst.x + win.x, y = inst.y + win.y;
```

Determined by rendering in a browser and then measuring label-vs-body overlap
across every attribute in both fixtures: all-local scored 75 overlaps,
all-absolute 38, a hybrid 48. R0 is identical under every hypothesis (it is the
identity); every rotated orientation improves sharply under absolute, with R180,
R270 and M0 reaching zero.

### Mobile specifics

- Strokes use `vector-effect: non-scaling-stroke`, holding a constant ~1.5 px at
  every zoom level. Without it, a fitted view of `TPLAB` draws sub-pixel
  hairlines that vanish on a phone screen.
- Text deliberately does **not** use it. Text scales with zoom, which is the
  reason to zoom in.

### Layers

A single **Annotations** toggle covers `DATAFLAG` probes, `!` directives and
`;` comments. Default **on** — two of those are the user's own design notes, and
hiding them by default would be surprising.

Wires, symbols, junction dots, net labels and InstName/Value are always drawn.

## App shell

### File input

`.asc` has no registered MIME type or UTI. Setting `accept=".asc"` causes iOS
Files and some Android pickers to **grey out the target files**. Therefore: no
`accept` filter. Validate by content — a file is a schematic if it parses a
`SHEET` line, a symbol if it parses `SymbolType`.

The picker is `multiple`, so `v6_8_4ohm.asc` and `TIP121.asy`/`TIP127.asy` can
be selected together. Desktop additionally supports drag-and-drop.

### User symbol persistence

User-supplied `.asy` files are cached in `localStorage` keyed by symbol name (a
few KB each), so reopening a schematic does not require re-picking its symbols.
All access is wrapped in `try`/`catch` — private-mode browsers throw, and the
app must still render.

### Missing symbols

An unresolved `SYMBOL` renders as a dashed placeholder box carrying its name,
InstName and Value, plus a dismissible banner: "2 symbols unresolved: TIP121,
TIP127 — add .asy files", which reopens the picker.

Honest limitation: without the `.asy`, pin positions are unknown. The box is
placed at the instance origin and **wires will not meet it correctly**. The
dashed styling signals a stand-in rather than implying a connection not drawn.

### Gestures

Pointer Events, for one unified path across mouse and touch:

- one finger drags
- two fingers pinch-zoom about the midpoint
- double-tap resets to fit

The SVG container sets `touch-action: none` so the browser does not capture the
gestures for page scrolling. Pan/zoom is a single `transform` on the root `<g>`;
nothing re-renders, so it stays smooth on a phone.

### Error handling

Never fail a whole render for one bad line. Parsers skip unrecognized keywords
and count them, surfacing "N unrecognized lines" as a note. LTspice has
accumulated keywords across versions, and a `.asc` from a newer build should
still draw its wires and parts.

Hard errors are reserved for genuinely unusable input: no `SHEET` line, or bytes
that decode to nothing.

### UI

A single top bar: file name, **Open**, **Annotations** toggle, **Fit**. Tap
targets at 44 px. Nothing else; the schematic gets the screen.

## Testing

- Unit tests in Node for `decode`, `parse-asc`, `parse-asy`.
- `ARC` tested against library symbols that use it (6,193 occurrences exist,
  though none in the five symbols these files need — it is written and tested
  now rather than discovered later).
- **Structural invariant:** every transformed symbol pin must land on a wire
  endpoint, a flag, or another symbol's pin. This single assertion covers the
  transform table, the parsers, and the symbol geometry simultaneously. It
  scores 152/152 on the workspace files today, so it starts green.
- Both workspace files rendered and checked at phone-width viewport.

Verification output is to be reported as actual results, not assurances.

## Open items carried into implementation

1. ~~Calibrate the `WINDOW` offset coordinate space~~ — RESOLVED, see above.
2. Source `TIP121.asy` / `TIP127.asy`, or accept placeholder rendering for
   `v6_8_4ohm.asc`.
