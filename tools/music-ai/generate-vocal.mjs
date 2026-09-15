#!/usr/bin/env node
/* ==========================================================================
   generate-vocal.mjs — a sung version, on a Space that needs no GPU allowance

   Every ZeroGPU Space was refusing, and the serverless Inference Providers route
   rejected the stored token (401 — the token in .hf-token is no longer valid).
   This one runs on cpu-basic, so there is no allowance to spend: it is simply
   slow. It sings: the endpoint takes a prompt and one of four voice types.

   Usage:
     node tools/music-ai/generate-vocal.mjs folk
     node tools/music-ai/generate-vocal.mjs folk --voice "Male Baritone" --out folk-vocal
   ========================================================================== */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const positional = args.filter((a) => !a.startsWith("--"));

const SPACE = String(flag("space", "vaishnavi0404-text-to-songgg.hf.space"));
const ENDPOINT = String(flag("endpoint", "/text_to_song"));
const BASE = `https://${SPACE}`;
const VOICE = String(flag("voice", "Male Baritone"));
const OUT = String(flag("out", "folk-vocal"));

let TOKEN = String(flag("token", process.env.HF_TOKEN || ""));
if (!TOKEN) {
  const f = join(ROOT, "tools", "music-ai", ".hf-token");
  if (existsSync(f)) TOKEN = readFileSync(f, "utf8").trim();
}
const AUTH = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};

/* ---------- the words, from the single source of truth ---------- */
const id = positional[0] || "folk";
const sandbox = {};
new Function("window", readFileSync(join(ROOT, "assets/js/recordings.js"), "utf8"))(sandbox);
const rec = (sandbox.ATTRECORDINGS || []).find((r) => r.id === id);
if (!rec) { console.error(`No such recording: ${id}`); process.exit(1); }

const LYRICS = rec.sections.map((s) => s.lines.join("\n")).join("\n");
const STYLE = "american folk ballad, G major, fingerpicked acoustic guitar, five-string banjo, " +
              "fiddle, upright bass, harmonica, close harmony, front porch, warm, unhurried";

/* A single prompt has to carry both the style and the words; this is how these
   demo spaces are built — there is no separate lyrics field to fill. The full
   lyric sheet is too long for this one, though: it accepts a short description
   and writes its own words, which is why --brief exists. */
const BRIEF = [
  "an american folk ballad about a man who cannot email a large file",
  "fingerpicked acoustic guitar, five-string banjo, fiddle, upright bass, harmonica",
  "warm, unhurried, front porch, storytelling"
].join(", ");

const PROMPT = args.includes("--brief") ? BRIEF : [
  STYLE,
  "",
  "Lyrics:",
  LYRICS
].join("\n");

console.log(`Space    ${SPACE}${ENDPOINT}   (cpu-basic: no GPU allowance to spend)`);
console.log(`Voice    ${VOICE}`);
console.log(`Words    ${LYRICS.split("\n").length} lines, from ${rec.title}`);
console.log(`Output   assets/audio/${OUT}\n`);

const submit = await fetch(`${BASE}/gradio_api/call${ENDPOINT}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...AUTH },
  body: JSON.stringify({ data: [PROMPT, VOICE] })
});
if (!submit.ok) { console.error(`Submit failed: HTTP ${submit.status} ${(await submit.text()).slice(0, 200)}`); process.exit(1); }
const { event_id: eventId } = await submit.json();
console.log(`event ${eventId} · waiting (a sung take on CPU is minutes) …`);

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
      console.error("\nThe Space returned an error event. Its logs are not visible from here;");
      console.error("try a shorter prompt, a different voice, or another cpu-basic Space.");
      process.exit(1);
    }
    if (ev === "process_status" && payload !== "null") console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${payload.slice(0, 90)}`);
    if (ev === "complete") { try { result = JSON.parse(payload); } catch { /* ignore */ } }
  }
  buf = "";
  if (result) break;
}
if (!result) { console.error("No result before the stream ended."); process.exit(1); }
console.log(`\nraw result: ${JSON.stringify(result).slice(0, 260)}`);

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
if (!url) { console.error("No audio in the result — the Space may have returned text only."); process.exit(1); }
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
  engine: "text_to_song (sung vocal)", space: SPACE, endpoint: ENDPOINT,
  voice: VOICE, style: STYLE, lyrics: LYRICS, file: OUT + ext, bytes: bytes.length
}, null, 2), "utf8");

console.log(`\n✓ saved ${out} (${(bytes.length / 1048576).toFixed(2)} MB, ${ext}) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
