#!/usr/bin/env node
/* ==========================================================================
   generate-cpu.mjs — render music on a Space that does not use the GPU

   Why this exists: every ZeroGPU Space started refusing (the account's GPU
   allowance), and the serverless Inference Providers route needs a token
   permission that is not currently enabled. This Space runs on cpu-basic, so it
   has no GPU allowance to spend — it is simply slow.

   Honest about the trade: MusicGen does not sing. This produces an instrumental
   folk arrangement, not a vocal. It is saved as folk-instrumental so nothing
   downstream can mistake it for the sung version.

   Usage: node tools/music-ai/generate-cpu.mjs [--prompt "..."] [--out folk-instrumental]
   ========================================================================== */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };

let TOKEN = String(flag("token", process.env.HF_TOKEN || ""));
if (!TOKEN) {
  const f = join(ROOT, "tools", "music-ai", ".hf-token");
  if (existsSync(f)) TOKEN = readFileSync(f, "utf8").trim();
}
const AUTH = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
const SPACE = String(flag("space", "aach456-music-gen-ai.hf.space"));
const ENDPOINT = String(flag("endpoint", "/generate_music"));
const BASE = `https://${SPACE}`;
const OUT = String(flag("out", "folk-instrumental"));

const PROMPT = String(flag("prompt",
  "american folk ballad, front porch recording, fingerpicked acoustic guitar, five-string banjo, " +
  "fiddle, upright bass, harmonica, close two-part harmony, warm and unhurried, no drums"));

console.log(`Space    ${SPACE}${ENDPOINT}  (cpu-basic: no GPU allowance to spend, just slow)`);
console.log(`Prompt   ${PROMPT}`);
console.log(`Output   assets/audio/${OUT}.mp3\n`);

const submit = await fetch(`${BASE}/gradio_api/call${ENDPOINT}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...AUTH },
  body: JSON.stringify({ data: [PROMPT, false, false] })     // prompt, use_gpu, unconditional
});
if (!submit.ok) { console.error(`Submit failed: HTTP ${submit.status} ${(await submit.text()).slice(0, 200)}`); process.exit(1); }
const { event_id: eventId } = await submit.json();
console.log(`event ${eventId} · waiting (CPU rendering is minutes, not seconds) …`);

const stream = await fetch(`${BASE}/gradio_api/call${ENDPOINT}/${eventId}`, { headers: { Accept: "text/event-stream", ...AUTH } });
if (!stream.ok || !stream.body) { console.error(`Stream failed: HTTP ${stream.status}`); process.exit(1); }

const reader = stream.body.getReader();
const dec = new TextDecoder();
let buf = "", ev = "", result = null;
const t0 = Date.now();
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  for (const raw of buf.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("event:")) { ev = line.slice(6).trim(); continue; }
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (ev === "error") {
      console.error("\nThe Space returned an error event.");
      console.error("If it mentions CUDA or a missing model, it wants use_gpu=true, which is the");
      console.error("path we cannot take right now — try another cpu-basic Space with --space.");
      process.exit(1);
    }
    if (ev === "process_status" && payload !== "null") console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${payload.slice(0, 90)}`);
    if (ev === "complete") { try { result = JSON.parse(payload); } catch { /* ignore */ } }
  }
  buf = "";
  if (result) break;
}
if (!result) { console.error("No result before the stream ended."); process.exit(1); }
console.log(`\nraw result: ${JSON.stringify(result).slice(0, 240)}`);

function findAudio(node, depth = 0) {
  if (depth > 6 || node === null || node === undefined) return null;
  if (typeof node === "string" && /\.(mp3|wav|flac|ogg)(\?|$)/i.test(node)) return node;
  if (typeof node === "object") {
    if (node.url && /\.(mp3|wav|flac|ogg)/i.test(node.url)) return node.url;
    for (const k of Object.keys(node)) { const r = findAudio(node[k], depth + 1); if (r) return r; }
  }
  return null;
}
const url = findAudio(result);
if (!url) { console.error("No audio in the result."); process.exit(1); }
console.log(`remote file: ${url}`);

const full = url.startsWith("http") ? url : `${BASE}/gradio_api/file=${url}`;
const dl = await fetch(full, { headers: { ...AUTH } });
if (!dl.ok) { console.error(`Download failed: HTTP ${dl.status}`); process.exit(1); }
const bytes = Buffer.from(await dl.arrayBuffer());
const head = bytes.subarray(0, 4).toString("latin1");
const ext = head.startsWith("RIFF") ? ".wav" : head.startsWith("fLaC") ? ".flac" : ".mp3";

const dir = join(ROOT, "assets", "audio");
mkdirSync(dir, { recursive: true });
const out = join(dir, OUT + ext);
writeFileSync(out, bytes);
writeFileSync(join(dir, OUT + ".generation.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  engine: "MusicGen (instrumental — it does not sing)",
  space: SPACE, endpoint: ENDPOINT, prompt: PROMPT,
  file: OUT + ext, bytes: bytes.length
}, null, 2), "utf8");

console.log(`\n✓ saved ${out} (${(bytes.length / 1048576).toFixed(2)} MB, ${ext}) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log("  It is instrumental. There are no vocals in this file.");
