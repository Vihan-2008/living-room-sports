import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { qrMatrix, qrSvg } from '../qr.js';
import { createApp } from '../server.js';

// Read the rendered modules back as a version 5-L scanner would, independently
// reserving function regions and verifying all 26 Reed-Solomon syndromes.
function decode(matrix) {
  assert.equal(matrix.length, 37);
  const reserved = (x, y) => x === 6 || y === 6 ||
    (x <= 8 && y <= 8) || (x >= 29 && y <= 8) || (x <= 8 && y >= 29) ||
    (x >= 28 && x <= 32 && y >= 28 && y <= 32);
  const bits = [];
  for (let col = 36, stripe = 0; col > 0; col -= 2, stripe++) {
    if (col === 6) col = 5;
    for (let row = 0; row < 37; row++) {
      const y = stripe % 2 ? row : 36 - row;
      for (const x of [col, col - 1]) if (!reserved(x, y)) bits.push(Number(matrix[y][x]) ^ Number((x + y) % 2 === 0));
    }
  }
  assert.equal(bits.length, 1079); // 134 codewords and seven remainder bits.
  assert.deepEqual(bits.slice(1072), Array(7).fill(0));
  const value = (start, count) => bits.slice(start, start + count).reduce((n, b) => n * 2 + b, 0);
  const words = Array.from({ length: 134 }, (_, i) => value(i * 8, 8));
  const exp = [1], log = Array(256).fill(0);
  for (let i = 1; i < 255; i++) { let v = exp[i - 1] * 2; if (v > 255) v ^= 285; exp.push(v); }
  exp.forEach((v, i) => { log[v] = i; });
  for (let i = 0; i < 26; i++) {
    const syndrome = words.reduce((acc, word) => (acc ? exp[(log[acc] + i) % 255] : 0) ^ word, 0);
    assert.equal(syndrome, 0, `RS syndrome ${i}`);
  }
  assert.equal(value(0, 4), 4);
  const length = value(4, 8);
  return new TextDecoder().decode(Uint8Array.from({ length }, (_, i) => value(12 + i * 8, 8)));
}

test('QR modules round-trip LAN, HTTPS, Unicode and capacity-boundary payloads with valid error correction', () => {
  for (const url of ['http://192.168.1.40:3000/remote?code=123456', 'https://sports.example:8443/remote?code=123456', 'é'.repeat(53), 'a'.repeat(106)]) {
    const matrix = qrMatrix(url);
    assert.equal(decode(matrix), url);
    // L/mask-0 format string and fixed dark module, as seen by a scanner.
    assert.equal([0,1,2,3,4,5,7,8].map(y => Number(matrix[y][8])).join(''), '00100011');
    assert.equal(matrix[29][8], true);
    assert.deepEqual(matrix[0].slice(0, 8), [true,true,true,true,true,true,true,false]);
  }
  assert.throws(() => qrMatrix('a'.repeat(107)), RangeError);
});

test('SVG has a four-module quiet zone and contains no raw URL markup', () => {
  const svg = qrSvg('https://example.test/remote?code=123456&x=<script>');
  assert.match(svg, /viewBox="0 0 45 45"/);
  assert.match(svg, /fill="white"/); assert.match(svg, /M4,4h1v1h-1z/);
  assert.ok(!svg.includes('<script>')); assert.ok(!svg.includes('example.test'));
});

test('QR endpoint serves room URLs locally and rejects invalid or oversized requests', async t => {
  const app = createApp(); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const target = `https://sports.example/remote?code=${app.code}`;
  const response = await fetch(`${base}/qr?url=${encodeURIComponent(target)}`);
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/svg+xml');
  assert.equal(await response.text(), qrSvg(target));
  for (const url of ['', 'javascript:alert(1)', `${base}/remote?code=wrong`, `${base}/other?code=${app.code}`,
    `https://${'a'.repeat(90)}.example/remote?code=${app.code}`]) {
    assert.equal((await fetch(`${base}/qr?url=${encodeURIComponent(url)}`)).status, 400);
  }
});
