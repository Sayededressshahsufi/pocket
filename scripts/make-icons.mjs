/**
 * Renders the app icon to PNG with zero dependencies (supersampled SDF shapes
 * + a minimal PNG encoder). Mirrors icons/icon.svg.
 *
 *   node scripts/make-icons.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const OUT = new URL("../icons/", import.meta.url);

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const FROM = [0x8b, 0x7b, 0xff];
const TO = [0x44, 0x33, 0xd6];
const GAP_CENTER = (-45 * Math.PI) / 180;
const GAP_HALF = (35 * Math.PI) / 180;

function render(size, { radius, scale }) {
  const SS = 4;
  const px = Buffer.alloc(size * size * 4);
  const R = 0.25 * scale, T = 0.086 * scale, DOT = 0.043 * scale;
  const caps = [GAP_CENTER - GAP_HALF, GAP_CENTER + GAP_HALF].map((a) => [Math.cos(a) * R, Math.sin(a) * R]);
  const dot = [Math.cos(GAP_CENTER) * R, Math.sin(GAP_CENTER) * R];

  const inBg = (u, v) => {
    if (!radius) return true;
    const qx = Math.max(Math.abs(u - 0.5) - (0.5 - radius), 0);
    const qy = Math.max(Math.abs(v - 0.5) - (0.5 - radius), 0);
    return Math.hypot(qx, qy) <= radius;
  };
  const inGlyph = (u, v) => {
    const x = u - 0.5, y = v - 0.5;
    const d = Math.hypot(x, y);
    let delta = Math.abs(Math.atan2(y, x) - GAP_CENTER);
    if (delta > Math.PI) delta = 2 * Math.PI - delta;
    if (delta > GAP_HALF && Math.abs(d - R) <= T / 2) return true;
    if (caps.some(([cx, cy]) => Math.hypot(x - cx, y - cy) <= T / 2)) return true;
    return Math.hypot(x - dot[0], y - dot[1]) <= DOT;
  };

  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let bg = 0, glyph = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (pxl + (sx + 0.5) / SS) / size;
          const v = (py + (sy + 0.5) / SS) / size;
          if (inBg(u, v)) {
            bg++;
            if (inGlyph(u, v)) glyph++;
          }
        }
      }
      const t = (pxl + py) / (2 * size);
      const i = (py * size + pxl) * 4;
      const g = bg ? glyph / bg : 0;
      for (let c = 0; c < 3; c++) {
        const base = FROM[c] + (TO[c] - FROM[c]) * t;
        px[i + c] = Math.round(base + (255 - base) * g);
      }
      px[i + 3] = Math.round((bg / (SS * SS)) * 255);
    }
  }
  return encodePNG(size, px);
}

mkdirSync(OUT, { recursive: true });
const targets = [
  ["icon-192.png", 192, { radius: 0.225, scale: 1 }],
  ["icon-512.png", 512, { radius: 0.225, scale: 1 }],
  ["maskable-512.png", 512, { radius: 0, scale: 0.8 }], // glyph inside the 80% safe zone
  ["apple-touch-icon.png", 180, { radius: 0, scale: 0.92 }], // iOS applies its own mask
];
for (const [name, size, opts] of targets) {
  writeFileSync(new URL(name, OUT), render(size, opts));
  console.log(`wrote icons/${name}`);
}
