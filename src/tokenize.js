export function toLines(text) {
  return text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

export function toWords(line) {
  const t = line.trim();
  return t === '' ? [] : t.split(/\s+/);
}

export function toInt(v) {
  return parseInt(v, 10);
}

// Returns everything from word index `i` onward, with original inner spacing.
// Needed because TEXT bodies and SYMATTR values contain spaces.
export function restFrom(raw, i) {
  const t = raw.trim();
  let idx = 0;
  for (let k = 0; k < i; k++) {
    while (idx < t.length && !/\s/.test(t[idx])) idx++;
    while (idx < t.length && /\s/.test(t[idx])) idx++;
  }
  return t.slice(idx);
}
