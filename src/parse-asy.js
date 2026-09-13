import { toLines, toWords } from './tokenize.js';

const N = (v) => parseInt(v, 10);

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
        sym.lines.push({ style: w[1], x1: N(w[2]), y1: N(w[3]), x2: N(w[4]), y2: N(w[5]) });
        break;
      case 'RECTANGLE':
        sym.rects.push({ style: w[1], x1: N(w[2]), y1: N(w[3]), x2: N(w[4]), y2: N(w[5]) });
        break;
      case 'CIRCLE':
        sym.circles.push({ style: w[1], x1: N(w[2]), y1: N(w[3]), x2: N(w[4]), y2: N(w[5]) });
        break;
      case 'ARC':
        sym.arcs.push({
          style: w[1], x1: N(w[2]), y1: N(w[3]), x2: N(w[4]), y2: N(w[5]),
          xs: N(w[6]), ys: N(w[7]), xe: N(w[8]), ye: N(w[9]),
        });
        break;
      case 'TEXT':
        sym.texts.push({
          x: N(w[1]), y: N(w[2]), just: w[3], size: N(w[4]),
          text: restAfter(raw, 5),
        });
        break;
      case 'WINDOW':
        sym.windows[N(w[1])] = { x: N(w[2]), y: N(w[3]), just: w[4], size: N(w[5]) };
        break;
      case 'SYMATTR':
        sym.attrs[w[1]] = restAfter(raw, 2);
        break;
      case 'PIN':
        sym.pins.push({ x: N(w[1]), y: N(w[2]), name: '', order: 0 });
        break;
      case 'PINATTR': {
        const pin = sym.pins[sym.pins.length - 1];
        if (!pin) { sym.unknown += 1; break; }
        if (w[1] === 'PinName') pin.name = restAfter(raw, 2);
        else if (w[1] === 'SpiceOrder') pin.order = N(w[2]);
        break;
      }
      default:
        sym.unknown += 1;
    }
  }
  return sym;
}

// Returns everything from word index `i` onward, with original inner spacing.
// Needed because TEXT bodies and SYMATTR values contain spaces.
function restAfter(raw, i) {
  const t = raw.trim();
  let idx = 0;
  for (let k = 0; k < i; k++) {
    while (idx < t.length && !/\s/.test(t[idx])) idx++;
    while (idx < t.length && /\s/.test(t[idx])) idx++;
  }
  return t.slice(idx);
}
