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
