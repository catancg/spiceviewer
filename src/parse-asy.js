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
