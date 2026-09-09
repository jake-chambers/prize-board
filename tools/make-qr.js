#!/usr/bin/env node
/* ============================================================
   Regenerates assets/qr.svg and assets/qr.png from assets/qr.js.
   No dependencies beyond Node itself.

     node tools/make-qr.js                # encodes the live board URL
     node tools/make-qr.js https://...    # encodes something else
   ============================================================ */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const QR = require('../assets/qr.js');

const url = process.argv[2] || 'https://jake-chambers.github.io/prize-board/';
const ECL = 'M';        // 15% of the symbol can be damaged and still scan
const MARGIN = 4;       // quiet zone in modules, the spec minimum
const SCALE = 40;       // PNG pixels per module

const qr = QR.encode(url, ECL);
const assets = path.join(__dirname, '..', 'assets');

// ── SVG ───────────────────────────────────────────────────────
fs.writeFileSync(path.join(assets, 'qr.svg'), QR.toSVG(qr, { margin: MARGIN }) + '\n');

// ── PNG (1-bit greyscale, written by hand) ────────────────────
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const dim = (qr.size + MARGIN * 2) * SCALE;
const rowBytes = Math.ceil(dim / 8);
const raw = Buffer.alloc((rowBytes + 1) * dim, 0xff);   // 1 = white
for (let py = 0; py < dim; py++) {
  const rowStart = py * (rowBytes + 1);
  raw[rowStart] = 0;                                     // filter: none
  const my = Math.floor(py / SCALE) - MARGIN;
  for (let px = 0; px < dim; px++) {
    const mx = Math.floor(px / SCALE) - MARGIN;
    if (qr.get(mx, my)) raw[rowStart + 1 + (px >> 3)] &= ~(0x80 >> (px & 7));
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(dim, 0);
ihdr.writeUInt32BE(dim, 4);
ihdr[8] = 1;  // bit depth
ihdr[9] = 0;  // greyscale
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(path.join(assets, 'qr.png'), png);

console.log(`encoded  ${url}`);
console.log(`version  ${qr.version} (${qr.size}×${qr.size} modules), level ${ECL}, mask ${qr.mask}`);
console.log(`wrote    assets/qr.svg, assets/qr.png (${dim}×${dim}px)`);
