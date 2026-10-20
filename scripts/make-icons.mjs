// Draws the tray icons with no dependencies: a power-socket glyph (rounded plate, two slots).
// macOS: black on transparent, used as a template image (recolored for light/dark menu bars).
// Windows: white glyph on a teal rounded square, since the taskbar is usually dark.
import { writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const SUPERSAMPLE = 4;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function encodePng2(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Signed distance to a rounded rectangle centred at (cx, cy). Negative inside. */
function roundedRect(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - (halfW - radius);
  const qy = Math.abs(y - cy) - (halfH - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

const ring = (x, y, cx, cy, r, w) => Math.abs(Math.hypot(x - cx, y - cy) - r) < w;
const disc = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) < r;
const plateOutline = (x, y) => Math.abs(roundedRect(x, y, 0.5, 0.5, 0.40, 0.40, 0.14)) < 0.055;

/** Candidate glyphs: each answers "is (x, y) in the unit square ink?". */
const GLYPHS = {
  // A wall socket: plate, two slots, round ground hole.
  socket: (x, y) => {
    const slot = (cx) => roundedRect(x, y, cx, 0.41, 0.045, 0.1, 0.045) < 0;
    return plateOutline(x, y) || slot(0.37) || slot(0.63) || disc(x, y, 0.5, 0.66, 0.06);
  },
  // ":" in a rounded square: reads as ":3000", the way ports are written.
  colon: (x, y) => plateOutline(x, y) || disc(x, y, 0.5, 0.37, 0.085) || disc(x, y, 0.5, 0.63, 0.085),
  // A dot sending out two arcs: something listening / broadcasting.
  signal: (x, y) => {
    const right = x > 0.38;
    const arc = (r) => right && ring(x, y, 0.3, 0.5, r, 0.055) && Math.abs(y - 0.5) < (x - 0.3) * 1.3;
    return disc(x, y, 0.3, 0.5, 0.1) || arc(0.3) || arc(0.5);
  },
  // Two stacked server bars with status lights.
  stack: (x, y) => {
    const bar = (cy) => Math.abs(roundedRect(x, y, 0.5, cy, 0.4, 0.15, 0.08)) < 0.05;
    return bar(0.31) || bar(0.69) || disc(x, y, 0.3, 0.31, 0.055) || disc(x, y, 0.3, 0.69, 0.055);
  },
};
const ICON_GLYPH = process.env.GLYPH ?? 'stack';
let glyph = GLYPHS[ICON_GLYPH];

function render(size, { background, foreground }) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let fg = 0;
      let bg = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size;
          if (background && roundedRect(x, y, 0.5, 0.5, 0.5, 0.5, 0.22) < 0) bg += 1;
          // On a background, shrink the glyph a little so it sits inside the square.
          const inset = background ? 0.14 : 0;
          if (glyph((x - inset) / (1 - 2 * inset), (y - inset) / (1 - 2 * inset))) fg += 1;
        }
      }
      const n = SUPERSAMPLE * SUPERSAMPLE;
      const a = fg / n;
      const b = bg / n;
      const i = (py * size + px) * 4;
      if (background) {
        // foreground over background, background over transparent
        for (let c = 0; c < 3; c += 1) rgba[i + c] = Math.round(foreground[c] * a + background[c] * (1 - a));
        rgba[i + 3] = Math.round(255 * Math.max(b, a));
      } else {
        for (let c = 0; c < 3; c += 1) rgba[i + c] = foreground[c];
        rgba[i + 3] = Math.round(255 * a);
      }
    }
  }
  return encodePng(size, rgba);
}

/** ICO that embeds PNGs (supported since Windows Vista). */
function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...pngs.map(({ png }) => png)]);
}

const MAC = { background: null, foreground: [0, 0, 0] };
const WINDOWS = { background: [13, 148, 136], foreground: [255, 255, 255] };

const out = new URL('../assets/', import.meta.url);

/** `node scripts/make-icons.mjs --sheet` draws every glyph side by side for choosing. */
if (process.argv.includes('--sheet')) {
  const names = Object.keys(GLYPHS);
  const cell = 300;
  const W = cell * names.length;
  const H = 300;
  const sheet = Buffer.alloc(W * H * 4, 255);
  const blit = (png, size, ox, oy) => {
    // decode our own uncompressed-filter PNG: inflate IDAT, skip filter byte per row
    const idat = zlib.inflateSync(png.subarray(png.indexOf('IDAT') + 4, png.indexOf('IEND') - 8));
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const si = y * (size * 4 + 1) + 1 + x * 4;
      const a = idat[si + 3] / 255;
      const di = ((oy + y) * W + (ox + x)) * 4;
      for (let c = 0; c < 3; c += 1) sheet[di + c] = Math.round(idat[si + c] * a + sheet[di + c] * (1 - a));
    }
  };
  const fill = (x0, y0, w, h, rgb) => {
    for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) rgb.forEach((v, c) => (sheet[(y * W + x) * 4 + c] = v));
  };
  names.forEach((name, i) => {
    glyph = GLYPHS[name];
    const ox = i * cell;
    blit(render(160, WINDOWS), 160, ox + 70, 20);
    fill(ox + 20, 200, 260, 40, [236, 236, 236]); // light menu bar
    blit(render(36, MAC), 36, ox + 132, 202);
    fill(ox + 20, 245, 260, 40, [40, 40, 40]); // dark menu bar: template icons render white
    blit(render(36, { background: null, foreground: [255, 255, 255] }), 36, ox + 132, 247);
  });
  writeFileSync(new URL('icon-options.png', out), encodePng2(W, H, sheet));
  console.log(`wrote assets/icon-options.png: ${names.join(', ')} (left to right)`);
  process.exit(0);
}

writeFileSync(new URL('tray-icon.png', out), render(36, MAC));
writeFileSync(new URL('tray-icon.ico', out), encodeIco([16, 24, 32].map((size) => ({ size, png: render(size, WINDOWS) }))));
writeFileSync(new URL('icon-preview.png', out), render(256, WINDOWS));
console.log(`wrote assets/tray-icon.png, tray-icon.ico, icon-preview.png (glyph: ${ICON_GLYPH})`);
