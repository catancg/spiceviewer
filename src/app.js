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

function resetView() { /* replaced in Task 10 */ }
