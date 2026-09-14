// LTspice writes cp1252 by default (0xB5 = micro sign) and UTF-16 with a BOM
// in some versions. Decoding as UTF-8 corrupts component values.
export function decode(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);

  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(b.subarray(2));
  }
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    // TextDecoder support for 'utf-16be' is inconsistent across runtimes,
    // so byte-swap into LE rather than relying on it.
    const body = b.subarray(2);
    const swapped = new Uint8Array(body.length);
    for (let i = 0; i + 1 < body.length; i += 2) {
      swapped[i] = body[i + 1];
      swapped[i + 1] = body[i];
    }
    return new TextDecoder('utf-16le').decode(swapped);
  }
  // LTspice also writes UTF-16LE with no BOM. Every .asc/.asy begins with the
  // ASCII text "Version", so a NUL in the second byte (or the first) is a
  // reliable signal — cp1252 text never starts that way.
  if (b.length >= 2 && b[0] !== 0x00 && b[1] === 0x00) {
    return new TextDecoder('utf-16le').decode(b);
  }
  if (b.length >= 2 && b[0] === 0x00 && b[1] !== 0x00) {
    const swapped = new Uint8Array(b.length);
    for (let i = 0; i + 1 < b.length; i += 2) {
      swapped[i] = b[i + 1];
      swapped[i + 1] = b[i];
    }
    return new TextDecoder('utf-16le').decode(swapped);
  }
  return new TextDecoder('windows-1252').decode(b);
}
