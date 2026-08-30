/**
 * The app icon, rasterised from shapes rather than drawn in an editor.
 *
 * No image toolchain exists in this environment and none is wanted in the
 * repo, so the icon is defined as a handful of analytic shapes and painted
 * with 4x4 supersampled coverage. That is enough antialiasing for a maskable
 * icon and it means the artwork is diffable text.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

// --- shape predicates, all in a 0..1 unit square ---
const roundedRect = (x, y, cx, cy, hw, hh, r) => {
  const dx = Math.abs(x - cx) - (hw - r), dy = Math.abs(y - cy) - (hh - r);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside - r <= 0;
};
const disc = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) <= r;
const ring = (x, y, cx, cy, r, w) => { const d = Math.hypot(x - cx, y - cy); return d <= r + w / 2 && d >= r - w / 2; };
const band = (x, y, x0, x1, y0, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/**
 * The gate. A torii is two tapered posts, a straight tie-beam, and a lintel
 * that lifts at the ends -- the lift is the whole silhouette, so it is a
 * parabola rather than a rectangle.
 */
function torii(x, y) {
  // Lintel: sweeps upward toward the edges.
  const lift = 0.045 * Math.pow((x - 0.5) / 0.40, 2);
  if (band(x, y, 0.10, 0.90, 0.255 - lift, 0.315 - lift)) return true;
  // A second, thinner shadow rail under it.
  if (band(x, y, 0.145, 0.855, 0.325 - lift * 0.7, 0.352 - lift * 0.7)) return true;
  // Tie-beam.
  if (band(x, y, 0.185, 0.815, 0.455, 0.505)) return true;
  // Posts, tapering outward as they descend.
  const t = smooth(0.30, 0.80, y) * 0.022;
  if (band(x, y, 0.245 - t, 0.315 - t, 0.30, 0.80)) return true;
  if (band(x, y, 0.685 + t, 0.755 + t, 0.30, 0.80)) return true;
  return false;
}

function shade(x, y) {
  // Background: lacquered black warming to a deep cinnabar at the base.
  const rad = Math.hypot((x - 0.5) * 1.05, (y - 0.34) * 1.05);
  let col = mix([26, 12, 22], [5, 6, 10], smooth(0.05, 0.78, rad));
  col = mix(col, [74, 13, 13], smooth(0.62, 1.0, y) * 0.55);
  let a = 1;

  // The pearl's glow sits under everything else.
  const glow = 1 - smooth(0.0, 0.30, Math.hypot(x - 0.5, y - 0.175));
  col = mix(col, [255, 224, 138], glow * 0.42);

  // Gold rim.
  if (ring(x, y, 0.5, 0.5, 0.455, 0.032)) col = mix([224, 179, 58], [255, 240, 194], smooth(0.9, 0.1, y));
  // The gate itself, lit from above.
  if (torii(x, y)) col = mix([255, 240, 194], [150, 112, 26], smooth(0.22, 0.85, y));
  // The pearl.
  if (disc(x, y, 0.5, 0.175, 0.072)) col = mix([255, 255, 245], [240, 190, 70], smooth(0.10, 0.25, y));

  // Clip to a rounded square so the "any" icon is not a bare rectangle.
  if (!roundedRect(x, y, 0.5, 0.5, 0.5, 0.5, 0.22)) a = 0;
  return [col[0], col[1], col[2], a * 255];
}

/** Maskable icons must survive a circular crop, so their art is inset. */
function render(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const S = 4, inset = maskable ? 0.80 : 1;
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          let u = (pxi + (sx + 0.5) / S) / size;
          let v = (py + (sy + 0.5) / S) / size;
          if (maskable) { u = (u - 0.5) / inset + 0.5; v = (v - 0.5) / inset + 0.5; }
          const c = maskable && (u < 0 || u > 1 || v < 0 || v > 1) ? [5, 6, 10, 255] : shade(u, v);
          r += c[0]; g += c[1]; b += c[2]; a += c[3];
        }
      }
      const n = S * S, o = (py * size + pxi) * 4;
      px[o] = r / n; px[o + 1] = g / n; px[o + 2] = b / n; px[o + 3] = a / n;
    }
  }
  return px;
}

// --- minimal PNG writer (truecolour + alpha, one IDAT) ---
function crc32(buf) {
  let c, table = crc32.t || (crc32.t = Array.from({ length: 256 }, (_, n) => {
    c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // Filter type 0 on every scanline: the art is smooth gradients and deflate
  // handles it well enough that adaptive filtering is not worth the code.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = process.argv[2];
for (const [name, size, opts] of [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['apple-touch-icon.png', 180, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
]) {
  writeFileSync(`${out}/${name}`, png(size, render(size, opts)));
  console.log('wrote', name, size);
}

/*
 * Usage:  node tools/icons.mjs public/icons
 *
 * Regenerate whenever the mark changes. The favicon is the same art at 48px
 * wrapped in an ICO container; see the repository history for that step.
 */
