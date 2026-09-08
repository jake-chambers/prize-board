/* ============================================================
   qr.js — a self-contained QR code encoder. No dependencies,
   no network, no third-party service in the loop.

   Implements ISO/IEC 18004 byte mode for versions 1–40 with
   Reed–Solomon error correction and automatic mask selection.

   Usage (browser or Node):
     const qr = QR.encode('https://example.com/', 'M');
     qr.size            // modules per side
     qr.get(x, y)       // true = dark module
     QR.toSVG(qr, { margin: 4, dark: '#000', light: '#fff' })
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QR = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Error-correction levels ────────────────────────────────
  // ordinal indexes the tables below; formatBits go in the format info.
  const ECL = {
    L: { ordinal: 0, formatBits: 1 },
    M: { ordinal: 1, formatBits: 0 },
    Q: { ordinal: 2, formatBits: 3 },
    H: { ordinal: 3, formatBits: 2 },
  };

  // Error-correction codewords per block, indexed [ecl.ordinal][version].
  const ECC_CODEWORDS_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];

  // Number of error-correction blocks, indexed [ecl.ordinal][version].
  const NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];

  const PENALTY_N1 = 3, PENALTY_N2 = 3, PENALTY_N3 = 40, PENALTY_N4 = 10;

  // ── Capacity helpers ───────────────────────────────────────
  function numRawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  function numDataCodewords(ver, ecl) {
    return Math.floor(numRawDataModules(ver) / 8)
      - ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
  }

  function alignmentPositions(ver) {
    if (ver === 1) return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26
      : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  // ── Reed–Solomon over GF(2^8), primitive polynomial 0x11D ──
  function rsMultiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  function rsGenerator(degree) {
    let result = new Array(degree - 1).fill(0).concat([1]);
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = rsMultiply(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = rsMultiply(root, 0x02);
    }
    return result;
  }

  function rsRemainder(data, generator) {
    const result = generator.map(() => 0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      generator.forEach((coef, i) => { result[i] ^= rsMultiply(coef, factor); });
    }
    return result;
  }

  // ── Bit buffer ─────────────────────────────────────────────
  function appendBits(buf, val, len) {
    for (let i = len - 1; i >= 0; i--) buf.push((val >>> i) & 1);
  }
  function getBit(x, i) { return ((x >>> i) & 1) !== 0; }

  // ── UTF-8 (so any URL, including non-ASCII paths, encodes) ─
  function toUtf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(str));
    const out = [];
    const s = unescape(encodeURIComponent(str));
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  // ── The code itself ────────────────────────────────────────
  class QrCode {
    constructor(version, ecl, dataCodewords, mask) {
      this.version = version;
      this.size = version * 4 + 17;
      this.ecl = ecl;
      this.modules = [];
      this.isFunction = [];
      for (let i = 0; i < this.size; i++) {
        this.modules.push(new Array(this.size).fill(false));
        this.isFunction.push(new Array(this.size).fill(false));
      }

      this.drawFunctionPatterns();
      const allCodewords = this.addEccAndInterleave(dataCodewords);
      this.drawCodewords(allCodewords);

      if (mask === -1) {
        let minPenalty = Infinity;
        for (let i = 0; i < 8; i++) {
          this.applyMask(i);
          this.drawFormatBits(i);
          const penalty = this.getPenaltyScore();
          if (penalty < minPenalty) { mask = i; minPenalty = penalty; }
          this.applyMask(i); // undo (XOR is its own inverse)
        }
      }
      this.mask = mask;
      this.applyMask(mask);
      this.drawFormatBits(mask);
      this.isFunction = null;
    }

    get(x, y) {
      return x >= 0 && x < this.size && y >= 0 && y < this.size && this.modules[y][x];
    }

    // -- function patterns --
    drawFunctionPatterns() {
      for (let i = 0; i < this.size; i++) {
        this.setFunctionModule(6, i, i % 2 === 0);
        this.setFunctionModule(i, 6, i % 2 === 0);
      }
      this.drawFinderPattern(3, 3);
      this.drawFinderPattern(this.size - 4, 3);
      this.drawFinderPattern(3, this.size - 4);

      const alignPos = alignmentPositions(this.version);
      const n = alignPos.length;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const isCorner = (i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0);
          if (!isCorner) this.drawAlignmentPattern(alignPos[i], alignPos[j]);
        }
      }
      this.drawFormatBits(0); // placeholder, overwritten after masking
      this.drawVersion();
    }

    drawFormatBits(mask) {
      const data = (this.ecl.formatBits << 3) | mask;
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;

      for (let i = 0; i <= 5; i++) this.setFunctionModule(8, i, getBit(bits, i));
      this.setFunctionModule(8, 7, getBit(bits, 6));
      this.setFunctionModule(8, 8, getBit(bits, 7));
      this.setFunctionModule(7, 8, getBit(bits, 8));
      for (let i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, getBit(bits, i));

      for (let i = 0; i < 8; i++) this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
      for (let i = 8; i < 15; i++) this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
      this.setFunctionModule(8, this.size - 8, true); // the always-dark module
    }

    drawVersion() {
      if (this.version < 7) return;
      let rem = this.version;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const bits = (this.version << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = getBit(bits, i);
        const a = this.size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.setFunctionModule(a, b, bit);
        this.setFunctionModule(b, a, bit);
      }
    }

    drawFinderPattern(x, y) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
            this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
          }
        }
      }
    }

    drawAlignmentPattern(x, y) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }

    setFunctionModule(x, y, isDark) {
      this.modules[y][x] = isDark;
      this.isFunction[y][x] = true;
    }

    // -- codewords --
    addEccAndInterleave(data) {
      const ver = this.version, ecl = this.ecl;
      const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
      const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver];
      const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
      const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
      const shortBlockLen = Math.floor(rawCodewords / numBlocks);

      const blocks = [];
      const gen = rsGenerator(blockEccLen);
      for (let i = 0, k = 0; i < numBlocks; i++) {
        const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
        const dat = data.slice(k, k + datLen);
        k += datLen;
        const ecc = rsRemainder(dat, gen);
        if (i < numShortBlocks) dat.push(0); // placeholder, skipped below
        blocks.push(dat.concat(ecc));
      }

      const result = [];
      for (let i = 0; i < blocks[0].length; i++) {
        blocks.forEach((block, j) => {
          if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
        });
      }
      return result;
    }

    drawCodewords(data) {
      let i = 0;
      for (let right = this.size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < this.size; vert++) {
          for (let j = 0; j < 2; j++) {
            const x = right - j;
            const upward = ((right + 1) & 2) === 0;
            const y = upward ? this.size - 1 - vert : vert;
            if (!this.isFunction[y][x] && i < data.length * 8) {
              this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
              i++;
            }
            // remaining modules stay light (remainder bits are zero)
          }
        }
      }
    }

    // -- masking --
    applyMask(mask) {
      for (let y = 0; y < this.size; y++) {
        for (let x = 0; x < this.size; x++) {
          let invert;
          switch (mask) {
            case 0: invert = (x + y) % 2 === 0; break;
            case 1: invert = y % 2 === 0; break;
            case 2: invert = x % 3 === 0; break;
            case 3: invert = (x + y) % 3 === 0; break;
            case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
            case 5: invert = (x * y) % 2 + (x * y) % 3 === 0; break;
            case 6: invert = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
            case 7: invert = ((x + y) % 2 + (x * y) % 3) % 2 === 0; break;
            default: throw new Error('bad mask');
          }
          if (!this.isFunction[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
        }
      }
    }

    getPenaltyScore() {
      let result = 0;
      const size = this.size, modules = this.modules;

      // Adjacent same-colour runs, and finder-like patterns, in rows and columns.
      for (let y = 0; y < size; y++) {
        let runColor = false, runX = 0;
        const runHistory = [0, 0, 0, 0, 0, 0, 0];
        for (let x = 0; x < size; x++) {
          if (modules[y][x] === runColor) {
            runX++;
            if (runX === 5) result += PENALTY_N1;
            else if (runX > 5) result++;
          } else {
            this.finderPenaltyAddHistory(runX, runHistory);
            if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
            runColor = modules[y][x];
            runX = 1;
          }
        }
        result += this.finderPenaltyTerminateAndCount(runColor, runX, runHistory) * PENALTY_N3;
      }
      for (let x = 0; x < size; x++) {
        let runColor = false, runY = 0;
        const runHistory = [0, 0, 0, 0, 0, 0, 0];
        for (let y = 0; y < size; y++) {
          if (modules[y][x] === runColor) {
            runY++;
            if (runY === 5) result += PENALTY_N1;
            else if (runY > 5) result++;
          } else {
            this.finderPenaltyAddHistory(runY, runHistory);
            if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
            runColor = modules[y][x];
            runY = 1;
          }
        }
        result += this.finderPenaltyTerminateAndCount(runColor, runY, runHistory) * PENALTY_N3;
      }

      // 2×2 blocks of the same colour.
      for (let y = 0; y < size - 1; y++) {
        for (let x = 0; x < size - 1; x++) {
          const c = modules[y][x];
          if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += PENALTY_N2;
        }
      }

      // Balance of dark and light.
      let dark = 0;
      for (const row of modules) for (const m of row) if (m) dark++;
      const total = size * size;
      const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
      result += k * PENALTY_N4;
      return result;
    }

    finderPenaltyCountPatterns(h) {
      const n = h[1];
      const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
      return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0)
           + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
    }

    finderPenaltyTerminateAndCount(currentRunColor, currentRunLength, h) {
      if (currentRunColor) {
        this.finderPenaltyAddHistory(currentRunLength, h);
        currentRunLength = 0;
      }
      currentRunLength += this.size;
      this.finderPenaltyAddHistory(currentRunLength, h);
      return this.finderPenaltyCountPatterns(h);
    }

    finderPenaltyAddHistory(currentRunLength, h) {
      if (h[0] === 0) currentRunLength += this.size;
      h.pop();
      h.unshift(currentRunLength);
    }
  }

  // ── Public API ─────────────────────────────────────────────
  function encode(text, eclName, opts) {
    opts = opts || {};
    const ecl = ECL[eclName || 'M'];
    if (!ecl) throw new Error('ecl must be L, M, Q or H');
    const bytes = toUtf8Bytes(String(text));
    const minVersion = opts.minVersion || 1;
    const maxVersion = opts.maxVersion || 40;

    // Byte mode: 4-bit mode indicator, then an 8- or 16-bit length field.
    let version, dataUsedBits;
    for (version = minVersion; ; version++) {
      const capacityBits = numDataCodewords(version, ecl) * 8;
      const countBits = version <= 9 ? 8 : 16;
      const needed = 4 + countBits + bytes.length * 8;
      if (needed <= capacityBits) { dataUsedBits = needed; break; }
      if (version >= maxVersion) throw new Error('data too long for a QR code');
    }

    const bits = [];
    appendBits(bits, 0x4, 4);
    appendBits(bits, bytes.length, version <= 9 ? 8 : 16);
    for (const b of bytes) appendBits(bits, b, 8);

    const capacityBits = numDataCodewords(version, ecl) * 8;
    appendBits(bits, 0, Math.min(4, capacityBits - bits.length));   // terminator
    appendBits(bits, 0, (8 - bits.length % 8) % 8);                   // to byte boundary
    for (let pad = 0xEC; bits.length < capacityBits; pad ^= 0xEC ^ 0x11) appendBits(bits, pad, 8);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      codewords.push(b);
    }

    const mask = typeof opts.mask === 'number' ? opts.mask : -1;
    return new QrCode(version, ecl, codewords, mask);
  }

  function toSVG(qr, opts) {
    opts = opts || {};
    const margin = opts.margin == null ? 4 : opts.margin;   // quiet zone, in modules
    const dark = opts.dark || '#000000';
    const light = opts.light || '#ffffff';
    const dim = qr.size + margin * 2;
    const parts = [];
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.get(x, y)) parts.push(`M${x + margin} ${y + margin}h1v1h-1z`);
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">` +
      `<rect width="${dim}" height="${dim}" fill="${light}"/>` +
      `<path d="${parts.join('')}" fill="${dark}"/></svg>`;
  }

  // Draws to a <canvas>; scale = pixels per module.
  function toCanvas(qr, canvas, opts) {
    opts = opts || {};
    const margin = opts.margin == null ? 4 : opts.margin;
    const scale = opts.scale || 10;
    const dim = (qr.size + margin * 2) * scale;
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = opts.light || '#ffffff';
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = opts.dark || '#000000';
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.get(x, y)) ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
      }
    }
    return canvas;
  }

  // Plain 0/1 matrix, handy for tests or other renderers.
  function toMatrix(qr) {
    const rows = [];
    for (let y = 0; y < qr.size; y++) {
      const row = [];
      for (let x = 0; x < qr.size; x++) row.push(qr.get(x, y) ? 1 : 0);
      rows.push(row);
    }
    return rows;
  }

  return { encode, toSVG, toCanvas, toMatrix };
});
