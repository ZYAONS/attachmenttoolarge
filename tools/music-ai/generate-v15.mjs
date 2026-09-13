#!/usr/bin/env node
/* ==========================================================================
   generate-v15.mjs — drive the ACE-Step v1.5 Space's /generation_wrapper

   That endpoint takes 49 positional arguments (it is a UI RPC, not a designed
   API). Rather than guess, this reads /gradio_api/info, takes every parameter's
   declared default, and overrides only the ones we care about. If the Space
   refuses anonymous requests (ZeroGPU quota), it says so immediately.

   Usage: node tools/music-ai/generate-v15.mjs [--token hf_xxx] [--duration 170]
   ========================================================================== */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };

const SPACE = String(flag("space", "ace-step-ace-step-v1-5.hf.space"));
const BASE = `https://${SPACE}`;
const TOKEN = String(flag("token", process.env.HF_TOKEN || ""));
const AUTH = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
const DURATION = parseFloat(String(flag("duration", "170")));
const ENDPOINT = String(flag("endpoint", "/generation_wrapper"));

/* ---------- lyrics from the single source of truth ---------- */
const sandbox = {};
new Function("window", readFileSync(join(ROOT, "assets/js/lyrics.js"), "utf8"))(sandbox);
const L = sandbox.ATTLYRICS;
const TAG = { INTRO: "intro", HOOK: "chorus", "VERSE 1": "verse", "VERSE 2": "verse", OUTRO: "outro" };
const lines = [];
for (const sec of L.sections) {
  const tag = TAG[sec.label] || "verse";
  if (lines[lines.length - 1] !== `[${tag}]`) lines.push(`[${tag}]`);
  for (const l of sec.lines) lines.push(l);
}
const LYRICS = lines.join("\n");
const STYLE = "boom-bap hip-hop, 88 bpm, warm upright bass, muted jazz piano loop, soft brushed drums, laid-back male rap vocal, storytelling flow, clear english diction, late-night office mood, melancholic but humorous";

/* ---------- read the signature ---------- */
console.log(`Reading ${ENDPOINT} signature from ${SPACE} …`);
const infoRes = await fetch(`${BASE}/gradio_api/info`, { headers: { Accept: "application/json", ...AUTH } });
if (!infoRes.ok) { console.error(`info failed: HTTP ${infoRes.status}`); process.exit(1); }
const info = await infoRes.json();
const ep = info.named_endpoints[ENDPOINT];
if (!ep) { console.error(`No such endpoint. Available: ${Object.keys(info.named_endpoints).join(", ")}`); process.exit(1); }

const params = ep.parameters || [];
console.log(`  ${params.length} parameters`);

/* ---------- defaults + overrides ---------- */
/* Gradio anonymised the names to param_N, but the order matches
   /capture_current_params, which does publish real names:
     0 selected_model  1 generation_mode  2 simple_query  3 simple_lang
     4 captions  5 lyrics  6 bpm  7 key_scale  8 time_signature  9 vocal_language
    10 inference_steps  11 guidance_scale  12 random_seed  13 seed  14 ref_audio
    15 audio_duration  16 batch_size  17 src_audio  18 code_string  19 repaint_start
    20 repaint_end  21 instruction  22 cover_strength  23 task_type ... 30 audio_format
   So we override by index, keeping every other declared default. */
const OVERRIDE = {
  1: "custom",
  4: STYLE,
  5: LYRICS,
  6: 88,
  7: "A minor",
  8: "4",
  9: "en",
  10: 8,              // the xl-turbo checkpoint is built for ~8 steps
  11: 7.0,
  15: DURATION,
  16: 1,              // one sample, not a batch of eight
  23: "text2music",
  30: "mp3"
};

const data = params.map((p, i) => {
  if (i in OVERRIDE) return OVERRIDE[i];
  const def = p.parameter_default;
  const type = p.python_type?.type || p.annotation || "";
  if (Array.isArray(def)) return def;
  if (def === undefined || def === null) {
    if (/list/.test(type)) return [];
    if (/str|Literal/.test(type)) return "";
    if (/filepath/.test(type)) return "";
    return 0;
  }
  return def;
});

const set = {};
params.forEach((p, i) => { set[i] = data[i]; });
console.log("Payload:");
for (const i of [1, 4, 5, 6, 9, 10, 15, 16, 23, 30]) {
  console.log(`  [${String(i).padStart(2)}] ${String(set[i]).slice(0, 52).replace(/\n/g, " / ")}`);
}

/* ---------- submit ---------- */
const submit = await fetch(`${BASE}/gradio_api/call${ENDPOINT}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...AUTH },
  body: JSON.stringify({ data })
});
if (!submit.ok) { console.error(`Submit failed: HTTP ${submit.status} ${(await submit.text()).slice(0, 200)}`); process.exit(1); }
const { event_id: eventId } = await submit.json();
console.log(`\nevent ${eventId} · waiting …`);

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
      console.error("\nThe generation endpoint rejected this request (empty error event).");
      console.error("Evidence, so this is not a guess:");
      console.error("  · trivial endpoints on this Space answer fine anonymously");
      console.error("    (/load_random_simple_description returned real data)");
      console.error("  · so the request path and our connection are fine, and");
      console.error("  · the endpoints that do not touch the GPU work, while generation does not");
      console.error("ZeroGPU gates *GPU* functions behind a per-user quota, so the practical fix is a");
      console.error("free Hugging Face token — signed-in users get a far larger allowance:");
      console.error("    https://huggingface.co/settings/tokens   (Inference permission is enough)");
      console.error(`    node tools/music-ai/generate-v15.mjs --token hf_xxxxxxxx --duration ${DURATION}`);
      console.error("The lyrics and parameters are ready; only the trigger is missing.");
      process.exit(1);
    }
    if (ev === "process_status" && payload !== "null") console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${payload.slice(0, 100)}`);
    if (ev === "complete") { try { result = JSON.parse(payload); } catch { /* ignore */ } }
  }
  buf = "";
  if (result) break;
}
if (!result) { console.error("No result before the stream ended."); process.exit(1); }

/* ---------- pull the audio out of the result ----------
   Output 8 is "All Generated Files (Download)" — a list of filepaths — and outputs
   0..7 are the eight audio samples. Prefer the list, fall back to a deep scan. */
function findAudio(node, depth = 0) {
  if (depth > 8 || node === null || node === undefined) return null;
  if (typeof node === "string" && /\.(mp3|flac|wav|ogg)(\?|$)/i.test(node)) return node;
  if (typeof node === "object") {
    if (typeof node.url === "string" && /\.(mp3|flac|wav|ogg)/i.test(node.url)) return node.url;
    for (const k of Object.keys(node)) { const r = findAudio(node[k], depth + 1); if (r) return r; }
  }
  return null;
}
const listOut = Array.isArray(result) ? result[8] : null;
const firstAudio = Array.isArray(result) ? result.find((x) => typeof x === "string" && /\.(mp3|flac|wav|ogg)/i.test(x)) : null;
const audioUrl = (Array.isArray(listOut) && listOut.length ? listOut[0] : null) || firstAudio || findAudio(result);
if (!audioUrl) { console.error("No audio in the result:", JSON.stringify(result).slice(0, 400)); process.exit(1); }
console.log(`\nremote file: ${audioUrl}`);

const full = audioUrl.startsWith("http") ? audioUrl : `${BASE}/gradio_api/file=${audioUrl}`;
const dl = await fetch(full, { headers: { ...AUTH } });
if (!dl.ok) { console.error(`Download failed: HTTP ${dl.status}`); process.exit(1); }
const bytes = Buffer.from(await dl.arrayBuffer());
const head = bytes.subarray(0, 4).toString("latin1");
const ext = head.startsWith("fLaC") ? ".flac" : (bytes[0] === 0xff || head.startsWith("ID3")) ? ".mp3" : ".wav";

const outDir = join(ROOT, "assets", "audio");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, "rap" + ext);
writeFileSync(out, bytes);
writeFileSync(join(outDir, "rap.generation.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  space: SPACE, endpoint: ENDPOINT, duration: DURATION, style: STYLE, lyrics: LYRICS,
  file: "rap" + ext, bytes: bytes.length
}, null, 2), "utf8");

console.log(`✓ saved ${out} (${(bytes.length / 1048576).toFixed(2)} MB, ${ext})`);
