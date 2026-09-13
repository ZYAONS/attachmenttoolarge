#!/usr/bin/env node
/* ==========================================================================
   generate-version.mjs — render one of the alternate recordings

   Same remote Space as the rap (no model is downloaded here), but the lyrics and
   the style prompt come from assets/js/recordings.js, and each version is written
   to its own file so the site can offer them side by side.

   Usage:
     node tools/music-ai/generate-version.mjs blues
     node tools/music-ai/generate-version.mjs pop --duration 165
     node tools/music-ai/generate-version.mjs --list
   ========================================================================== */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const positional = args.filter((a) => !a.startsWith("--"));

/* token: --token, else HF_TOKEN, else the gitignored local file */
let TOKEN = String(flag("token", process.env.HF_TOKEN || ""));
if (!TOKEN) {
  const f = join(ROOT, "tools", "music-ai", ".hf-token");
  if (existsSync(f)) TOKEN = readFileSync(f, "utf8").trim();
}
const AUTH = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
const SPACE = String(flag("space", "ace-step-ace-step.hf.space"));
const BASE = `https://${SPACE}`;

/* ---------- load the recordings ---------- */
const sandbox = {};
new Function("window", readFileSync(join(ROOT, "assets/js/recordings.js"), "utf8"))(sandbox);
const RECORDINGS = sandbox.ATTRECORDINGS || [];

if (args.includes("--list") || !positional.length) {
  console.log("Available versions (in assets/js/recordings.js):");
  for (const r of RECORDINGS) {
    const out = join(ROOT, "assets", "audio", r.id + ".mp3");
    const have = existsSync(out) ? `  ✓ rendered (${(statSync(out).size / 1048576).toFixed(2)} MB)` : "  · not rendered yet";
    console.log(`  ${r.id.padEnd(8)} ${r.title}${have}`);
  }
  console.log(`\nUsage: node tools/music-ai/generate-version.mjs <id> [--duration 170]`);
  process.exit(0);
}

const id = positional[0];
const rec = RECORDINGS.find((r) => r.id === id);
if (!rec) {
  console.error(`No such version: ${id}. Known: ${RECORDINGS.map((r) => r.id).join(", ")}`);
  process.exit(1);
}
const DURATION = parseFloat(String(flag("duration", "170")));

/* ---------- flatten the lyrics with ACE-Step structure tags ---------- */
const TAG = {
  INTRO: "intro", OUTRO: "outro", CHORUS: "chorus", HOOK: "chorus",
  BRIDGE: "bridge", "PRE-CHORUS": "pre-chorus"
};
const lines = [];
for (const sec of rec.sections) {
  const tag = TAG[sec.label] || "verse";
  if (lines[lines.length - 1] !== `[${tag}]`) lines.push(`[${tag}]`);
  for (const l of sec.lines) lines.push(l);
}
const LYRICS = lines.join("\n");
const STYLE = rec.style;

console.log(`Recording    ${rec.title}`);
console.log(`Style        ${STYLE}`);
console.log(`Lyrics       ${rec.sections.reduce((n, s) => n + s.lines.length, 0)} lines · ${lines.length} with structure`);
console.log(`Duration     ${DURATION} s`);
console.log(`Space        ${BASE}${TOKEN ? "  (authenticated)" : "  (anonymous — may be refused)"}\n`);
console.log(LYRICS);
console.log("");

/* ---------- the ACE-Step v1 payload, same shape that worked for the rap ---------- */
const DATA = [
  DURATION, STYLE, LYRICS,
  60, 15, "euler", "apg", 10, null,
  0.5, 0, 3, true, false, true, null, 0, 0,
  false, 0.5, null, "none"
];

const submit = await fetch(`${BASE}/gradio_api/call/__call__`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...AUTH },
  body: JSON.stringify({ data: DATA })
});
if (!submit.ok) { console.error(`Submit failed: HTTP ${submit.status} ${(await submit.text()).slice(0, 200)}`); process.exit(1); }
const { event_id: eventId } = await submit.json();
console.log(`event ${eventId} · waiting …`);

const stream = await fetch(`${BASE}/gradio_api/call/__call__/${eventId}`, { headers: { Accept: "text/event-stream", ...AUTH } });
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
      console.error("\nThe Space refused this request (empty error event).");
      console.error("Most likely the anonymous GPU allowance is spent — a token fixes it:");
      console.error("  node tools/music-ai/generate-version.mjs " + id + " --token hf_xxx");
      process.exit(1);
    }
    if (ev === "process_status" && payload !== "null") console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${payload.slice(0, 90)}`);
    if (ev === "complete") { try { result = JSON.parse(payload); } catch { /* ignore */ } }
  }
  buf = "";
  if (result) break;
}
if (!result) { console.error("No result before the stream ended."); process.exit(1); }

const audio = Array.isArray(result) ? result[0] : result;
const url = typeof audio === "string" ? audio : audio?.url || audio?.path;
if (!url) { console.error("No audio in the result:", JSON.stringify(result).slice(0, 300)); process.exit(1); }
console.log(`\nremote file: ${url}`);

const full = url.startsWith("http") ? url : `${BASE}/gradio_api/file=${url}`;
const dl = await fetch(full, { headers: { ...AUTH } });
if (!dl.ok) { console.error(`Download failed: HTTP ${dl.status}`); process.exit(1); }
const bytes = Buffer.from(await dl.arrayBuffer());

const outDir = join(ROOT, "assets", "audio");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, rec.id + ".mp3");
writeFileSync(out, bytes);
writeFileSync(join(outDir, rec.id + ".generation.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: "ACE-Step via Hugging Face Space (remote; nothing downloaded locally)",
  space: SPACE, title: rec.title, style: STYLE, duration: DURATION,
  lyrics: LYRICS, file: rec.id + ".mp3", bytes: bytes.length
}, null, 2), "utf8");

console.log(`✓ saved ${out} (${(bytes.length / 1048576).toFixed(2)} MB) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
