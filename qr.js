// QR Model 2, version 5-L, byte mode, mask 0. One RS block; 106 UTF-8 bytes.
// Fixed sizing keeps LAN pairing dependency-free, offline and private.
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 106) throw new RangeError('Pairing URL exceeds QR capacity');
  const bits = [];
  const append = (value, count) => { for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  append(4, 4); append(bytes.length, 8);
  for (const byte of bytes) append(byte, 8);
  append(0, Math.min(4, 864 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => a * 2 + b, 0));
  for (let pad = 0; data.length < 108; pad++) data.push(pad % 2 ? 0x11 : 0xec);
  const multiply = (a, b) => {
    let result = 0;
    for (; b; b >>>= 1) { if (b & 1) result ^= a; a <<= 1; if (a & 256) a ^= 0x11d; }
    return result;
  };
  let generator = [1], root = 1;
  for (let i = 0; i < 26; i++) {
    const next = Array(generator.length + 1).fill(0);
    generator.forEach((v, j) => { next[j] ^= v; next[j + 1] ^= multiply(v, root); });
    generator = next; root = multiply(root, 2);
  }
  const remainder = [...data, ...Array(26).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const factor = remainder[i];
    generator.forEach((v, j) => { remainder[i + j] ^= multiply(v, factor); });
  }
  const message = [...data, ...remainder.slice(108)];
  const size = 37, matrix = Array.from({ length: size }, () => Array(size).fill(null));
  const set = (x, y, dark) => { matrix[y][x] = !!dark; };
  for (const [cx, cy] of [[3, 3], [33, 3], [3, 33]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, distance = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && y >= 0 && x < size && y < size) set(x, y, distance !== 2 && distance !== 4);
    }
  }
  for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(30 + dx, 30 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  // BCH-encoded format for L / mask 0, XORed with the QR format mask.
  const format = 0x77c4, bit = i => (format >>> i) & 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
  let index = 0, up = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right--;
    for (let row = 0; row < size; row++) {
      const y = up ? size - 1 - row : row;
      for (let col = 0; col < 2; col++) {
        const x = right - col;
        if (matrix[y][x] !== null) continue;
        const value = index < message.length * 8 ? (message[index >>> 3] >>> (7 - index % 8)) & 1 : 0;
        set(x, y, value ^ ((x + y) % 2 === 0 ? 1 : 0)); index++;
      }
    }
    up = !up;
  }
  return matrix;
}

export function qrSvg(text) {
  const matrix = qrMatrix(text), border = 4, size = matrix.length + border * 2;
  const path = matrix.flatMap((row, y) => row.flatMap((dark, x) => dark ? [`M${x + border},${y + border}h1v1h-1z`] : [])).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${path}" fill="black"/></svg>`;
}
