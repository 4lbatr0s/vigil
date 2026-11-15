// Draws the Vigil mark (a ring with a dot: something keeping watch) into PNG icons, with no dependencies.
// Colors are the dark design tokens (--bg, --ink). Amber is not used: it is reserved for agent activity.
// Usage: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "static", "icons");
mkdirSync(out, { recursive: true });
const BG = [0x11, 0x11, 0x13];
const INK = [0xed, 0xed, 0xef];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** `scale` is the size of the mark relative to the canvas (0.5 leaves a safe margin for maskable icons); `rounded` rounds the square. */
function png(size, { scale, rounded }) {
  const ss = 4; // supersampling for smooth edges
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const ring = size * 0.5 * scale * 0.53;
  const stroke = size * 0.5 * scale * 0.12;
  const dot = size * 0.5 * scale * 0.15;
  const corner = rounded ? size * 0.1875 : 0;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let cover = 0;
      let inside = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          // rounded square mask
          const dx = Math.max(corner - px, 0, px - (size - corner));
          const dy = Math.max(corner - py, 0, py - (size - corner));
          if (dx * dx + dy * dy <= corner * corner) inside++;
          const d = Math.hypot(px - size / 2, py - size / 2);
          if (Math.abs(d - ring) <= stroke / 2 || d <= dot) cover++;
        }
      }
      const total = ss * ss;
      const a = inside / total;
      const t = cover / total;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(BG[c] * (1 - t) + INK[c] * t);
      raw[o + 3] = Math.round(255 * a);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

writeFileSync(path.join(out, "icon-192.png"), png(192, { scale: 1.2, rounded: true }));
writeFileSync(path.join(out, "icon-512.png"), png(512, { scale: 1.2, rounded: true }));
// Maskable: full-bleed square, mark kept inside the central safe zone (about 60%).
writeFileSync(path.join(out, "icon-maskable-512.png"), png(512, { scale: 1.1, rounded: false }));
writeFileSync(path.join(out, "apple-touch-icon.png"), png(180, { scale: 1.2, rounded: false }));
console.log("icons written to", out);
