#!/usr/bin/env node
/* ==========================================================================
   make-icon.mjs — society emblem → a real multi-resolution Windows .ico

   Why this is not just six screenshots: headless Edge clamps its window to a
   minimum width (~504 px), so asking it for a 16 px window gives you a *crop* of
   a 504 px render, not a 16 px icon. Instead we render once at 1024 px and do
   the down-scaling ourselves: decode the PNG, box-filter it, re-encode, then
   pack the six sizes into an ICO by hand. No image library needed — zlib and a
   CRC table are enough.

   Usage: node tools/make-icon.mjs [svg] [out.ico]
   ========================================================================== */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync, deflateSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SVG = resolve(process.argv[2] || join(ROOT, "assets", "img", "emblem.svg"));
const OUT = resolve(process.argv[3] || join(ROOT, "assets", "img", "favicon.ico"));
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const MASTER = 1024;

const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/microsoft-edge"
].find((p) => existsSync(p));
if (!EDGE) { console.error("No Edge/Chrome found to rasterise the SVG."); process.exit(1); }
if (!existsSync(SVG)) { console.error("SVG not found: " + SVG); process.exit(1); }

/* ---------------- PNG decode (8-bit RGBA, non-interlaced) ---------------- */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let at = 8, width = 0, height = 0, depth = 0, color = 0, interlace = 0;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; color = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    at += 12 + len;
  }
  if (depth !== 8 || color !== 6) throw new Error(`unsupported PNG (depth ${depth}, colour type ${color})`);
  if (interlace) throw new Error("interlaced PNG not supported");

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, data: out };
}

/* ---------------- box-filter downscale ---------------- */
function resize(img, size) {
  const { width, height, data } = img;
  const out = Buffer.alloc(size * size * 4);
  const fx = width / size, fy = height / size;
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1 && sy < height; sy++) {
        for (let sx = x0; sx < x1 && sx < width; sx++) {
          const i = (sy * width + sx) * 4;
          const al = data[i + 3];
          r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al; a += al; n++;
        }
      }
      const o = (y * size + x) * 4;
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width: size, height: size, data: out };
}

/* ---------------- PNG encode ---------------- */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return (buf) => { let c = 0xffffffff; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(img) {
  const { width, height, data } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;                                    // filter: none
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---------------- render once, at a size Edge will not clamp ---------------- */
const work = mkdtempSync(join(tmpdir(), "att-ico-"));
const master = join(work, "master.png");
console.log(`Rasterising ${basename(SVG)} at ${MASTER}px (headless Edge clamps small windows, so we render big and scale ourselves)`);
const r = spawnSync(EDGE, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars",
  "--default-background-color=00000000",
  `--window-size=${MASTER},${MASTER}`, `--screenshot=${master}`, pathToFileURL(SVG).href
], { encoding: "utf8", timeout: 90000 });
if (!existsSync(master)) { console.error("render failed: " + (r.stderr || "").slice(0, 200)); process.exit(1); }

const img = decodePng(readFileSync(master));
console.log(`  master: ${img.width}×${img.height} RGBA`);
if (img.width < MASTER * 0.9) {
  console.warn(`  ! Edge gave us ${img.width}px — scaling from what we actually got`);
}

/* ---------------- build the icon set ---------------- */
mkdirSync(dirname(OUT), { recursive: true });
const entries = SIZES.map((size) => {
  const small = resize(img, size);
  const png = encodePng(small);
  console.log(`  ✓ ${String(size).padStart(3)}px  ${(png.length / 1024).toFixed(1)} KB`);
  return { size, png };
});

const HEADER = 6, ENTRY = 16;
const dir = Buffer.alloc(HEADER + ENTRY * entries.length);
dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(entries.length, 4);
let offset = HEADER + ENTRY * entries.length;
entries.forEach((e, i) => {
  const at = HEADER + i * ENTRY;
  dir.writeUInt8(e.size >= 256 ? 0 : e.size, at);
  dir.writeUInt8(e.size >= 256 ? 0 : e.size, at + 1);
  dir.writeUInt8(0, at + 2); dir.writeUInt8(0, at + 3);
  dir.writeUInt16LE(1, at + 4); dir.writeUInt16LE(32, at + 6);
  dir.writeUInt32LE(e.png.length, at + 8);
  dir.writeUInt32LE(offset, at + 12);
  offset += e.png.length;
});
writeFileSync(OUT, Buffer.concat([dir, ...entries.map((e) => e.png)]));

/* a 512px square PNG for the GitHub organisation avatar, plus the transparent 256 */
writeFileSync(join(dirname(OUT), "org-avatar-512.png"), encodePng(resize(img, 512)));
writeFileSync(join(dirname(OUT), "org-avatar-256.png"), encodePng(resize(img, 256)));
writeFileSync(join(dirname(OUT), "org-avatar.png"), encodePng(resize(img, 1024)));

console.log(`\n✓ ${OUT}  (${entries.length} resolutions, ${(readFileSync(OUT).length / 1024).toFixed(1)} KB)`);
console.log("✓ assets/img/org-avatar.png (1024) · org-avatar-512.png · org-avatar-256.png");
rmSync(work, { recursive: true, force: true });
