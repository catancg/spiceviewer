import { place, ROT, emptyBox, unionBox } from './transform.js';

const MARGIN = 48;
const DASH = { Dot: '2,6', ShortDash: '8,6', Dash: '16,8', LongDash: '24,8' };
// Placeholder box width/height for an unresolved symbol, in schematic units.
// Shared by computeBounds and renderPlaceholder so the two stay in sync.
const PLACEHOLDER = 96;

export function getSymbol(map, name) {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  // LTspice writes subdirectory-qualified names like "Opamps\\UniversalOpamp2".
  // A user-supplied .asy is stored under its basename, so try that too.
  const base = lower.split(/[\\/]/).pop();
  return map[name] ?? map[lower] ?? map[base];
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
      unionBox(b, inst.x + PLACEHOLDER - 32, inst.y + PLACEHOLDER - 32);
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
  for (const t of def.texts) pts.push([t.x, t.y]);
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
  for (const t of def.texts) {
    const [tx, ty] = P(t.x, t.y);
    out.push(textEl(tx, ty, t.just, t.size, [t.text], 'symtext'));
  }
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

  let delta = a1 - a0;
  while (delta <= 0) delta += Math.PI * 2;
  const largeArc = delta > Math.PI ? 1 : 0;

  const [tsx, tsy] = place(inst, sx, sy);
  const [tex, tey] = place(inst, ex, ey);
  // Increasing theta is clockwise in this y-down parametrisation, which is
  // SVG sweep-flag 1; largeArc is computed against that same direction.
  // A mirrored instance flips the handedness, so it takes the opposite flag.
  const mirrored = (inst.rot ?? 'R0').startsWith('M');
  const sweep = mirrored ? 0 : 1;

  // Radii swap under 90-degree orientations, same treatment as the CIRCLE
  // branch: run the untransformed half-extents through ROT and take abs.
  // Only the emitted radii change; angle maths and endpoints stay on the
  // untransformed ellipse.
  const [hx, hy] = ROT[inst.rot ?? 'R0'](rx, ry);
  const erx = Math.abs(hx), ery = Math.abs(hy);

  return `<path d="M ${tsx} ${tsy} A ${erx} ${ery} 0 ${largeArc} ${sweep} ${tex} ${tey}" ` +
    `fill="none"${dash(a.style)}/>`;
}

function renderPlaceholder(inst) {
  const w = PLACEHOLDER, h = PLACEHOLDER;
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
  .gnd { stroke: var(--ink, #111); }
  .net { fill: var(--net, #1d4ed8); }
  .directive { fill: var(--ink, #111); }
  .comment { fill: var(--muted, #4b5563); }
  .dataflag { fill: var(--probe, #047857); }
  .symtext { fill: var(--ink, #111); }
</style>
<g id="root">${body.join('\n')}</g>
</svg>`;
}

// LTspice text size codes 0-7, expressed in schematic units. Calibrated
// against the bundled real .asc fixtures.
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

    // WINDOW offsets are absolute offsets from the instance origin, applied
    // without rotation. See the spec's "Known unknown: WINDOW offset
    // coordinate space — RESOLVED" section for how this was established.
    const x = inst.x + win.x, y = inst.y + win.y;
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
