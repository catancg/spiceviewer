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

  const sentences = [];
  if (missing.length > 0) {
    sentences.push(
      `${missing.length} symbol${missing.length > 1 ? 's' : ''} unresolved: ` +
      `${missing.join(', ')} — tap to add .asy files`);
  }
  // Spec: "Parsers skip unrecognized keywords and count them, surfacing
  // 'N unrecognized lines' as a note" — shown whether or not symbols are missing.
  if (model.unknown > 0) {
    sentences.push(`${model.unknown} unrecognized line${model.unknown > 1 ? 's' : ''}`);
  }

  if (sentences.length === 0) {
    el.hidden = true;
    return;
  }
  $('banner-msg').textContent = sentences.join('. ');
  el.hidden = false;
}

export function showSchematic(model, keepView = false) {
  currentModel = model;
  const stage = $('stage');
  stage.innerHTML = renderSvg(model, allSymbols(), { annotations });
  showBanner(model);
  // innerHTML replaced the <svg>, so the transform has to be re-applied to the
  // new element rather than merely left alone.
  if (keepView) applyView();
  else resetView();
}

async function handleFiles(fileList) {
  // e.target.value is reset to '' right after this call is fired (see wireUp
  // below) so the same file can be re-picked later. That's safe only because
  // an async function body runs synchronously up to its first `await`: the
  // spread here captures the FileList's entries before the input is cleared.
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
  $('banner-dismiss').addEventListener('click', (e) => {
    // Stop the click from bubbling to the banner's own handler, which would
    // reopen the file picker instead of just dismissing.
    e.stopPropagation();
    $('banner').hidden = true;
  });
  $('file').addEventListener('change', (e) => {
    handleFiles(e.target.files).catch(() => { $('name').textContent = 'Could not read that file'; });
    e.target.value = ''; // allow re-picking the same file
  });

  $('ann').addEventListener('click', () => {
    annotations = !annotations;
    $('ann').setAttribute('aria-pressed', String(annotations));
    if (currentModel) showSchematic(currentModel, true);
  });

  const stage = $('stage');
  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files).catch(() => { $('name').textContent = 'Could not read that file'; });
  });
}

const view = { x: 0, y: 0, k: 1 };
const pointers = new Map();
let pinchStart = null;
let lastTap = 0;
let lastTapPos = null;
const DOUBLE_TAP_SLOP = 20; // px; a tap that starts a drag must not be misread as the second tap

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
    if (pointers.size === 2) {
      pinchStart = midpoint();
      // A second finger joining is never the second tap of a double-tap —
      // otherwise pinch, lift, then a single tap misreads as a double-tap.
      lastTap = 0;
    }

    if (pointers.size === 1) {
      const now = Date.now();
      const moved = lastTapPos &&
        Math.hypot(e.clientX - lastTapPos.x, e.clientY - lastTapPos.y) > DOUBLE_TAP_SLOP;
      if (now - lastTap < 300 && !moved) resetView();
      lastTap = now;
      lastTapPos = { x: e.clientX, y: e.clientY };
    }
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

if (typeof document !== 'undefined') {
  wireUp();
  initGestures();
}
