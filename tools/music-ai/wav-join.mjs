#!/usr/bin/env node
/* ==========================================================================
   wav-join.mjs — stitch several WAV renders into one piece

   MusicGen on a cpu-basic Space returns a few seconds at a time, so a listenable
   piece means several renders joined end to end. All the parts come from the same
   Space, so they share a format; this checks that before touching anything, reads
   the chunk layout properly rather than assuming a 44-byte header, and rewrites
   the RIFF and data sizes.

   Usage: node tools/music-ai/wav-join.mjs out.wav in1.wav in2.wav ...
   ========================================================================== */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [outArg, ...inArgs] = process.argv.slice(2);
if (!outArg || inArgs.length < 2) {
  console.error("Usage: node tools/music-ai/wav-join.mjs out.wav in1.wav in2.wav [...]");
  process.exit(1);
}

/** read the canonical chunks: fmt for the format, data for the samples */
function readWav(file) {
  const b = readFileSync(file);
  if (b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WAVE") {
    throw new Error(file + " is not a RIFF/WAVE file");
  }
  let at = 12, fmt = null, data = null;
  while (at + 8 <= b.length) {
    const id = b.toString("latin1", at, at + 4);
    const size = b.readUInt32LE(at + 4);
    const body = b.subarray(at + 8, at + 8 + size);
    if (id === "fmt ") fmt = body;
    else if (id === "data") { data = body; break; }
    at += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(file + " has no fmt or data chunk");
  return {
    fmt,
    data,
    channels: fmt.readUInt16LE(2),
    sampleRate: fmt.readUInt32LE(4),
    bits: fmt.readUInt16LE(14),
    seconds: data.length / (fmt.readUInt16LE(2) * (fmt.readUInt32LE(4)) * (fmt.readUInt16LE(14) / 8))
  };
}

const parts = inArgs.map((f) => ({ file: resolve(f), ...readWav(resolve(f)) }));
const first = parts[0];
for (const p of parts) {
  if (p.channels !== first.channels || p.sampleRate !== first.sampleRate || p.bits !== first.bits) {
    console.error(`Format mismatch: ${p.file} is ${p.channels}ch/${p.sampleRate}Hz/${p.bits}bit, ` +
                  `expected ${first.channels}ch/${first.sampleRate}Hz/${first.bits}bit`);
    process.exit(1);
  }
  console.log(`  ${p.seconds.toFixed(2)}s  ${p.file.split(/[\\/]/).pop()}`);
}

const data = Buffer.concat(parts.map((p) => p.data));
const total = parts.reduce((s, p) => s + p.seconds, 0);
const header = Buffer.alloc(44);
header.write("RIFF", 0, "latin1");
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8, "latin1");
header.write("fmt ", 12, "latin1");
header.writeUInt32LE(16, 16);
first.fmt.copy(header, 20, 0, 16);
header.write("data", 36, "latin1");
header.writeUInt32LE(data.length, 40);

const out = resolve(outArg);
writeFileSync(out, Buffer.concat([header, data]));
console.log(`\n✓ ${out}`);
console.log(`  ${total.toFixed(2)}s · ${first.channels}ch · ${first.sampleRate}Hz · ${first.bits}bit · ` +
            `${(data.length / 1048576).toFixed(2)} MB`);
