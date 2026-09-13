export function toLines(text) {
  return text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

export function toWords(line) {
  const t = line.trim();
  return t === '' ? [] : t.split(/\s+/);
}
