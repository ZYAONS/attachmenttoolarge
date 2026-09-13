#!/usr/bin/env node
/* ==========================================================================
   gen-image.mjs — generate site artwork with FLUX.1-schnell via Hugging Face

   Same arrangement as the music: the model runs on Hugging Face's servers, only
   the finished image comes back. The token is read from tools/music-ai/.hf-token
   (gitignored) unless --token is given.

   Usage:
     node tools/gen-image.mjs --preset helmet
     node tools/gen-image.mjs --prompt "..." --out assets/img/foo.png
     node tools/gen-image.mjs --preset helmet --width 832 --height 1216 --steps 4
   ========================================================================== */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };

let TOKEN = String(flag("token", process.env.HF_TOKEN || ""));
if (!TOKEN) {
  const f = join(ROOT, "tools", "music-ai", ".hf-token");
  if (existsSync(f)) TOKEN = readFileSync(f, "utf8").trim();
}
const AUTH = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
const SPACE = String(flag("space", "black-forest-labs-flux-1-schnell.hf.space"));
const BASE = `https://${SPACE}`;

/* ---------- presets ---------- */
const PRESETS = {
  helmet: {
    out: "assets/img/hoplite.png",
    prompt:
      "Ancient Greek Corinthian helmet of a Spartan hoplite, hammered bronze with dark patina and " +
      "scratches, a tall horsehair crest in alternating black and ivory stripes sweeping backwards, " +
      "cheek guards, narrow eye slits, a vertical nose guard. Museum object photograph, plain white " +
      "background, dramatic raking side light, sharp focus, fine metal texture, shallow depth of field, " +
      "centered, full helmet in frame, no text, no watermark, no people"
  }
};

const presetName = String(flag("preset", Object.keys(PRESETS)[0]));
const preset = PRESETS[presetName] || PRESETS.helmet;
const PROMPT = String(flag("prompt", preset.prompt));
const OUT = resolve(ROOT, String(flag("out", preset.out)));
const WIDTH = parseInt(String(flag("width", "896")), 10);
const HEIGHT = parseInt(String(flag("height", "1152")), 10);
const STEPS = parseInt(String(flag("steps", "4")), 10);      // schnell is built for 4
const SEED = parseInt(String(flag("seed", "0")), 10);

console.log(`Model    ${SPACE}${TOKEN ? "  (authenticated)" : "  (anonymous)"}`);
console.log(`Preset   ${presetName}`);
console.log(`Size     ${WIDTH}×${HEIGHT} · ${STEPS} steps`);
console.log(`Output   ${OUT}`);
console.log(`Prompt   ${PROMPT}\n`);

/* ---------- read the signature so the payload matches the Space, not a guess ---------- */
const infoRes = await fetch(`${BASE}/gradio_api/info`, { headers: { Accept: "application/json", ...AUTH } });
if (!infoRes.ok) { console.error(`info failed: HTTP ${infoRes.status}`); process.exit(1); }
const info = await infoRes.json();
const ep = info.named_endpoints["/infer"];
if (!ep) { console.error("No /infer endpoint. Available: " + Object.keys(info.named_endpoints).join(", ")); process.exit(1); }

const values = {
  prompt: PROMPT, seed: SEED, randomize_seed: true,
  width: WIDTH, height: HEIGHT, num_inference_steps: STEPS, guidance_scale: 3.5
};
const data = ep.parameters.map((p) => {
  const n = p.parameter_name;
  if (n in values) return values[n];
  const def = p.parameter_default;
  const type = p.python_type?.type || p.annotation || "";
  if (def !== undefined && def !== null) return def;
  if (/bool/.test(type)) return false;
  if (/float|int/.test(type)) return 0;
  return "";
});

const submit = await fetch(`${BASE}/gradio_api/call/infer`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...AUTH },
  body: JSON.stringify({ data })
});
if (!submit.ok) { console.error(`Submit failed: HTTP ${submit.status} ${(await submit.text()).slice(0, 200)}`); process.exit(1); }
const { event_id: eventId } = await submit.json();
console.log(`event ${eventId} · rendering …`);

const stream = await fetch(`${BASE}/gradio_api/call/infer/${eventId}`, { headers: { Accept: "text/event-stream", ...AUTH } });
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
      console.error("\nThe Space refused this request. With a valid token that usually means the GPU");
      console.error("allowance for this account is spent for now — try again later, or another image Space.");
      process.exit(1);
    }
    if (ev === "process_status" && payload !== "null") console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${payload.slice(0, 80)}`);
    if (ev === "complete") { try { result = JSON.parse(payload); } catch { /* ignore */ } }
  }
  buf = "";
  if (result) break;
}
if (!result) { console.error("No result before the stream ended."); process.exit(1); }

/* ---------- the image is the first filepath-looking string in the outputs ---------- */
function findImage(node, depth = 0) {
  if (depth > 6 || node === null || node === undefined) return null;
  if (typeof node === "string" && /\.(png|jpe?g|webp)(\?|$)/i.test(node)) return node;
  if (typeof node === "object") {
    if (typeof node.url === "string" && /\.(png|jpe?g|webp)/i.test(node.url)) return node.url;
    if (typeof node.path === "string" && /\.(png|jpe?g|webp)/i.test(node.path)) return node.path;
    for (const k of Object.keys(node)) { const r = findImage(node[k], depth + 1); if (r) return r; }
  }
  return null;
}
const remote = findImage(result);
if (!remote) { console.error("No image in the result:", JSON.stringify(result).slice(0, 300)); process.exit(1); }
console.log(`\nremote file: ${remote}`);

const full = remote.startsWith("http") ? remote : `${BASE}/gradio_api/file=${remote}`;
const dl = await fetch(full, { headers: { ...AUTH } });
if (!dl.ok) { console.error(`Download failed: HTTP ${dl.status}`); process.exit(1); }
const bytes = Buffer.from(await dl.arrayBuffer());

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, bytes);
console.log(`✓ saved ${OUT} (${(bytes.length / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
