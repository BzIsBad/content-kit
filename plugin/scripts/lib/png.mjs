// Minimal RGB image canvas, PNG encoder and a tiny bitmap font for timestamp labels.
// Remotion's ffmpeg has no tile or drawtext filters, so contact sheets are composed here.

import zlib from 'node:zlib';

export class Canvas {
  constructor(w, h, rgb = [24, 24, 24]) {
    this.w = w;
    this.h = h;
    this.px = Buffer.alloc(w * h * 3);
    this.fill(0, 0, w, h, rgb);
  }

  fill(x, y, w, h, [r, g, b]) {
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) {
        const i = (yy * this.w + xx) * 3;
        this.px[i] = r;
        this.px[i + 1] = g;
        this.px[i + 2] = b;
      }
    }
  }

  /** Paste a raw RGB buffer of size w x h at (x, y). */
  blit(rgb, w, h, x, y) {
    for (let row = 0; row < h; row++) {
      const ty = y + row;
      if (ty < 0 || ty >= this.h) continue;
      const src = row * w * 3;
      const dst = (ty * this.w + x) * 3;
      rgb.copy(this.px, dst, src, src + Math.min(w, this.w - x) * 3);
    }
  }

  /** Draw text with the 5x7 font, each font pixel drawn as scale x scale. */
  text(str, x, y, scale = 2, rgb = [255, 255, 255]) {
    let cx = x;
    for (const ch of str) {
      const glyph = FONT[ch] || FONT[' '];
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (glyph[row] & (1 << (4 - col))) this.fill(cx + col * scale, y + row * scale, scale, scale, rgb);
        }
      }
      cx += 6 * scale;
    }
    return cx - x;
  }

  toPng() {
    return encodePng(this.w, this.h, this.px);
  }
}

export function textWidth(str, scale = 2) {
  return [...str].length * 6 * scale;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encode 8-bit RGB pixels as a PNG. */
export function encodePng(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 5x7 glyphs, one byte per row, low 5 bits used (bit 4 = leftmost column).
const FONT = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12],
  ':': [0, 12, 12, 0, 12, 12, 0],
  '.': [0, 0, 0, 0, 0, 12, 12],
  '-': [0, 0, 0, 31, 0, 0, 0],
  '#': [10, 10, 31, 10, 31, 10, 10],
};
