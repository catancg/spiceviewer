// Verified empirically against both workspace schematics by testing that every
// transformed symbol pin coincides with a wire endpoint, flag, or other pin
// (152/152). Do not re-derive these from first principles.
export const ROT = {
  R0:   (x, y) => [x, y],
  R90:  (x, y) => [-y, x],
  R180: (x, y) => [-x, -y],
  R270: (x, y) => [y, -x],
  M0:   (x, y) => [-x, y],
  M90:  (x, y) => [y, x],
  M180: (x, y) => [x, -y],
  M270: (x, y) => [-y, -x],
};

export function place(inst, px, py) {
  const fn = ROT[inst.rot] ?? ROT.R0;
  const [dx, dy] = fn(px, py);
  return [inst.x + dx, inst.y + dy];
}

export function emptyBox() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function unionBox(box, x, y) {
  if (x < box.minX) box.minX = x;
  if (y < box.minY) box.minY = y;
  if (x > box.maxX) box.maxX = x;
  if (y > box.maxY) box.maxY = y;
  return box;
}
