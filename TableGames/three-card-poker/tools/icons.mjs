/**
 * The app icon, rasterised from shapes rather than drawn in an editor.
 *
 * The same approach as Dragon's Shrine's icon: no image toolchain exists in
 * this environment and none is wanted in the repo, so the mark is a handful of
 * analytic shapes painted with 4x4 supersampled coverage, and the artwork is
 * diffable text.
 *
 * The mark is three cards fanned on sapphire under a gold rim: two backs, one
 * from each of the table's two decks, and a face card in front with a single
 * red diamond. It also writes the favicon, as a 48px PNG in an ICO container.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// --- shape predicates, all in a 0..1 unit square ---
const roundedRect = (x, y, cx, cy, hw, hh, r) => {
  const dx = Math.abs(x - cx) - (hw - r);
  const dy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - r <= 0;
};
const ring = (x, y, cx, cy, r, w) => {
  const d = Math.hypot(x - cx, y - cy);
  return d <= r + w / 2 && d >= r - w / 2;
};

/** A point in a card's own frame: rotated by `deg` about its centre. */
function local(x, y, cx, cy, deg) {
  const a = (-deg * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
}

const CARD = { hw: 0.15, hh: 0.21, r: 0.03 };

/** Which card, if any, covers a point — front to back — and where in it. */
function cardAt(x, y) {
  const cards = [
    { cx: 0.5, cy: 0.53, deg: 0, kind: 'face' },
    { cx: 0.64, cy: 0.52, deg: 16, kind: 'backB' },
    { cx: 0.36, cy: 0.52, deg: -16, kind: 'backA' },
  ];
  for (const c of cards) {
    const [u, v] = local(x, y, c.cx, c.cy, c.deg);
    if (roundedRect(u, v, 0, 0, CARD.hw, CARD.hh, CARD.r)) return { ...c, u, v };
  }
  return null;
}

function shade(x, y) {
  // Sapphire cloth with a lamp from above.
  const rad = Math.hypot((x - 0.5) * 1.05, (y - 0.32) * 1.05);
  let col = mix([34, 96, 160], [5, 22, 44], smooth(0.02, 0.8, rad));
  let a = 1;

  // Gold rim.
  if (ring(x, y, 0.5, 0.5, 0.455, 0.03)) col = mix([240, 212, 132], [201, 162, 39], smooth(0.1, 0.9, y));

  const c = cardAt(x, y);
  if (c) {
    const edge = !roundedRect(c.u, c.v, 0, 0, CARD.hw - 0.012, CARD.hh - 0.012, CARD.r - 0.008);
    if (c.kind === 'face') {
      col = edge ? [150, 140, 120] : [251, 250, 244];
      // One red diamond, |u|+|v| < r in the card's frame.
      if (Math.abs(c.u) / 0.075 + Math.abs(c.v) / 0.105 <= 1) col = [212, 58, 48];
    } else if (c.kind === 'backA') {
      col = edge ? [40, 8, 14] : [122, 21, 36];
      if (!edge && (Math.floor((c.u + c.v) * 60) & 1) === 0) col = mix(col, [255, 255, 255], 0.1);
    } else {
      col = edge ? [10, 9, 6] : [23, 20, 12];
      if (!edge && (Math.floor((c.u - c.v) * 60) & 1) === 0) col = mix(col, [226, 188, 78], 0.22);
    }
  }

  if (!roundedRect(x, y, 0.5, 0.5, 0.5, 0.5, 0.22)) a = 0;
  return [col[0], col[1], col[2], a * 255];
}

/** Maskable icons must survive a circular crop, so their art is inset. */
function render(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const S = 4;
  const inset = maskable ? 0.8 : 1;
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          let u = (pxi + (sx + 0.5) / S) / size;
          let v = (py + (sy + 0.5) / S) / size;
          if (maskable) {
            u = (u - 0.5) / inset + 0.5;
            v = (v - 0.5) / inset + 0.5;
          }
          const c = maskable && (u < 0 || u > 1 || v < 0 || v > 1) ? [5, 22, 44, 255] : shade(u, v);
          r += c[0];
          g += c[1];
          b += c[2];
          a += c[3];
        }
      }
      const n = S * S;
      const o = (py * size + pxi) * 4;
      px[o] = r / n;
      px[o + 1] = g / n;
      px[o + 2] = b / n;
      px[o + 3] = a / n;
    }
  }
  return px;
}

// --- minimal PNG writer (truecolour + alpha, one IDAT) ---
function crc32(buf) {
  const table =
    crc32.t ||
    (crc32.t = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    }));
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
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

/** An ICO holding one PNG image — the format every browser since Vista-era IE reads. */
function ico(size, pngData) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = size;
  entry[1] = size;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngData.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, pngData]);
}

const [out, faviconDir] = process.argv.slice(2);
for (const [name, size, opts] of [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['apple-touch-icon.png', 180, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
]) {
  writeFileSync(`${out}/${name}`, png(size, render(size, opts)));
  console.log('wrote', name, size);
}
if (faviconDir) {
  writeFileSync(`${faviconDir}/favicon.ico`, ico(48, png(48, render(48))));
  console.log('wrote favicon.ico', 48);
}

/*
 * Usage:  node tools/icons.mjs public/icons src/app
 *
 * Regenerate whenever the mark changes.
 */
