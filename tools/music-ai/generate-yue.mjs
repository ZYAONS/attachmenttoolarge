#!/usr/bin/env node
/* ==========================================================================
   generate-yue.mjs — render a recording with YuE2 (a different model entirely)

   Why this exists: ACE-Step started refusing requests (its mirrors all answer 503),
   and YuE2 is built for exactly what we need — lyrics plus a style line in, a sung
   song out. Its endpoint is a plain five-argument call, so there is no guessing:

     style · lyrics · planning mode · render quality · seed

   Usage:
     node tools/music-ai/generate-yue.mjs folk
     node tools/music-ai/generate-yue.mjs folk --space mrfakename-yue2-3b.hf.space
     node tools/music-ai/generate-yue.mjs --list
   ========================================================================== */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const positional = args.filter((a) => !a.startsWith("--"));

let TOKEN = String(flag("token", process.env.HF_TOKEN || ""));
if (!TOKEN) {
  const f = join(ROOT, "tools", "music-ai", ".hf-token");
  if (existsSync(f)) TOKEN = readFileSync(f, "utf8").trim();
}
const AUTH = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};

/* this one is a five-argument call, so both the space and the endpoint are known */
const SPACES = [
  { space: "mrfakename-yue2-3b.hf.space", endpoint: "/generate_song",
    build: (style, lyrics, seed, quality) => [style, lyrics, "full", quality, seed] },
  { space: "mehdisabori66-yue2-3b.hf.space", endpoint: "/generate_song",
    build: (style, lyrics, seed, quality) => [style, lyrics, "full", quality, seed] },
  { space: "directedbykobyperez-yue2-create.hf.space", endpoint: "/generate",
    build: (style, lyrics, seed) => [style, lyrics, "full", seed, 1.5] }
];

const sandbox = {};
new Function("window", readFileSync(join(ROOT, "assets/js/recordings.js"), "utf8"))(sandbox);
const RECORDINGS = sandbox.ATTRECORDINGS || [];

if (args.includes("--list") || !positional.length) {
  console.log("Versions in assets/js/recordings.js:");
  for (const r of RECORDINGS) {
    const p = join(ROOT, "assets", "audio", r.id + ".mp3");
    const w = join(ROOT, "assets", "audio", r.id + ".wav");
    const have = existsSync(p) ? "✓ mp3" : existsSync(w) ? "✓ wav" : "· not rendered";
    console.log(`  ${r.id.padEnd(11)} ${r.title.padEnd(28)} ${have}`);
  }
  process.exit(0);
}

const id = positional[0];
const rec = RECORDINGS.find((r) => r.id === id);
if (!rec) { console.error(`No such version: ${id}. Known: ${RECORDINGS.map((r) => r.id).join(", ")}`); process.exit(1); }

/* YuE wants a compact style line: genre, language, vocal, instrumentation, mood */
const STYLE = String(flag("style", [
  "American folk ballad",
  "English",
  "plainspoken male lead",
  "fingerpicked acoustic guitar, five-string banjo, fiddle, upright bass, harmonica",
  "close two-part harmony on the refrain",
  "front-porch recording, singalong chorus, warm and unhurried"
].join(", ")));

/* flatten with the section tags YuE understands */
const TAG = { HOOK: "chorus", CHORUS: "chorus", BRIDGE: "bridge", "PRE-CHORUS": "verse", INTRO: "intro", OUTRO: "outro" };
const lines = [];
for (const sec of rec.sections) {
  const tag = TAG[sec.label] || "verse";
  if (lines[lines.length - 1] !== `[${tag}]`) lines.push(`[${tag}]`);
  for (const l of sec.lines) lines.push(l);
}
const LYRICS = lines.join("\n");
const SEED = parseInt(String(flag("seed", "20260913")), 10);
const QUALITY = String(flag("quality", "32"));

console.log(`Song      ${rec.title}`);
console.log(`Engine    YuE2 (a different model from ACE-Step)`);
console.log(`Style     ${STYLE}`);
console.log(`Lyrics    ${rec.sections.reduce((n, s) => n + s.lines.length, 0)} lines\n`);

const spaceArg = String(flag("space", ""));
const order = spaceArg ? SPACES.filter((s) => s.space === spaceArg) : SPACES;
if (!order.length) { console.error(`Unknown space: ${spaceArg}`); process.exit(1); }

for (const { space, endpoint, build } of order) {
  const BASE = `https://${space}`;
  console.log(`── trying ${space}${endpoint} ${TOKEN ? "(token)" : "(anonymous)"}`);

  /* The two signatures are NOT the same shape, which is why the first attempt failed:
       /generate_song  (style, lyrics, planning_mode, render_quality, seed)
       /generate       (style, lyrics, cot, seed, cfg_scale)
     Sending them in the wrong order makes the space throw, not answer. */
  const data = build(STYLE, LYRICS, SEED, QUALITY);

  let submit;
  try {
    submit = await fetch(`${BASE}/gradio_api/call${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ data })
    });
  } catch (e) { console.log(`   submit failed: ${e.message}`); continue; }
  if (!submit.ok) { console.log(`   HTTP ${submit.status} — ${(await submit.text()).slice(0, 90)}`); continue; }
  const { event_id: eventId } = await submit.json();
  console.log(`   event ${eventId} · rendering (YuE is slower than ACE-Step) …`);

  const stream = await fetch(`${BASE}/gradio_api/call${endpoint}/${eventId}`, { headers: { Accept: "text/event-stream", ...AUTH } });
  if (!stream.ok || !stream.body) { console.log(`   stream HTTP ${stream.status}`); continue; }

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
      if (ev === "error") { console.log("   the space returned an error event"); result = "error"; break; }
      if ((ev === "process_status" || ev === "progress") && payload !== "null" && payload.length < 120) {
        console.log(`   [${((Date.now() - t0) / 1000).toFixed(0)}s] ${payload}`);
      }
      if (ev === "complete") { try { result = JSON.parse(payload); } catch { /* keep waiting */ } }
    }
    buf = "";
    if (result) break;
  }
  if (!result || result === "error") continue;

  const first = Array.isArray(result) ? result.find((x) => typeof x === "string" && /\.(mp3|wav|flac|ogg)/i.test(x)) : null;
  const url = first || (Array.isArray(result) ? result[0]?.url || result[0]?.path : null);
  if (!url) { console.log("   no audio in the result"); continue; }
  console.log(`   remote file: ${String(url).slice(0, 100)}`);

  const full = url.startsWith("http") ? url : `${BASE}/gradio_api/file=${url}`;
  const dl = await fetch(full, { headers: { ...AUTH } });
  if (!dl.ok) { console.log(`   download HTTP ${dl.status}`); continue; }
  const bytes = Buffer.from(await dl.arrayBuffer());
  const head = bytes.subarray(0, 4).toString("latin1");
  const ext = head.startsWith("fLaC") ? ".flac" : head.startsWith("RIFF") ? ".wav" : ".mp3";

  const outDir = join(ROOT, "assets", "audio");
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, rec.id + ext);
  writeFileSync(out, bytes);
  writeFileSync(join(outDir, rec.id + ".generation.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    engine: "YuE2", space, endpoint,
    title: rec.title, style: STYLE, lyrics: LYRICS, seed: SEED, quality: QUALITY,
    file: rec.id + ext, bytes: bytes.length
  }, null, 2), "utf8");
  console.log(`\n✓ saved ${out} (${(bytes.length / 1048576).toFixed(2)} MB, ${ext}) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  process.exit(0);
}

console.error("\nEvery YuE2 space refused. Try again later, or set --space to one that is running.");
process.exit(1);
