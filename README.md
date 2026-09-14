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
