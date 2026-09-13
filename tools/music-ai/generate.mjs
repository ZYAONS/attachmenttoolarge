/* ==========================================================================
   用远程 Hugging Face Space 生成《Attachment Too Large》的人声版

   原则：**不下载任何模型**。生成发生在 Hugging Face 的服务器上，
   本地只接收生成出来的音频文件（几 MB），存到 assets/audio/。

   用法：
     node tools/music-ai/generate.mjs                  # 生成并保存到 assets/audio/
     node tools/music-ai/generate.mjs --duration 170
     node tools/music-ai/generate.mjs --space ace-step-ace-step.hf.space
     node tools/music-ai/generate.mjs --dry-run        # 只打印将要提交的参数

   模型：ACE-Step（开源音乐生成基础模型，带人声）
   ========================================================================== */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf("--" + name);
  if (i === -1) return def;
  const v = args[i + 1];
  return v && !v.startsWith("--") ? v : true;
};

const SPACE = String(flag("space", "ace-step-ace-step.hf.space"));
const BASE = `https://${SPACE}`;
const DURATION = parseFloat(String(flag("duration", "170")));
const DRY = args.includes("--dry-run");
const OUTDIR = resolve(ROOT, String(flag("out", "assets/audio")));

/* ---------- 1. 读歌词（复用一个事实来源 assets/js/lyrics.js） ---------- */
const lyricSrc = readFileSync(join(ROOT, "assets/js/lyrics.js"), "utf8");
const sandbox = {};
new Function("window", lyricSrc)(sandbox);
const L = sandbox.ATTLYRICS;
if (!L) { console.error("读不到 assets/js/lyrics.js 里的 ATTLYRICS"); process.exit(1); }

/* ACE-Step 用 [verse] / [chorus] / [intro] / [outro] 这样的结构标记 */
const TAG_MAP = { INTRO: "intro", HOOK: "chorus", "VERSE 1": "verse", "VERSE 2": "verse", OUTRO: "outro" };
const lines = [];
for (const sec of L.sections) {
  const tag = TAG_MAP[sec.label] || "verse";
  if (lines[lines.length - 1] !== `[${tag}]`) lines.push(`[${tag}]`);
  for (const line of sec.lines) lines.push(line);
}
const LYRICS = lines.join("\n");
const RAP_LINES = L.sections.reduce((n, s) => n + s.lines.length, 0);

const STYLE = [
  "boom-bap hip-hop", "88 bpm", "dusty vinyl crackle",
  "warm upright bass", "jazz-muted piano loop", "soft brushed drums",
  "laid-back male rap vocal", "storytelling flow", "clear english diction",
  "late-night office mood", "melancholic but humorous"
].join(", ");

console.log(`曲目        ${L.title} (${L.subtitle})`);
console.log(`人声        male rap vocal（写在风格提示里）`);
console.log(`歌词        ${RAP_LINES} 行 · ${lines.length} 个结构行`);
console.log(`风格提示    ${STYLE}`);
console.log(`时长        ${DURATION} 秒`);
console.log(`生成位置    ${BASE}（远程 GPU，本地不下载模型）`);
console.log(`输出目录    ${OUTDIR}`);
console.log("");
console.log("--- 提交给模型的歌词 ---");
console.log(LYRICS);
console.log("----------------------\n");

/* 22 个参数，顺序严格对应 /gradio_api/info 里的签名 */
const DATA = [
  DURATION,        // 0  audio_duration
  STYLE,           // 1  prompt
  LYRICS,          // 2  lyrics
  60,              // 3  infer_step
  15,              // 4  guidance_scale
  "euler",         // 5  scheduler_type
  "apg",           // 6  cfg_type
  10,              // 7  omega_scale
  null,            // 8  manual_seeds
  0.5,             // 9  guidance_interval
  0,               // 10 guidance_interval_decay
  3,               // 11 min_guidance_scale
  true,            // 12 use_erg_tag
  false,           // 13 use_erg_lyric
  true,            // 14 use_erg_diffusion
  null,            // 15 oss_steps
  0,               // 16 guidance_scale_text
  0,               // 17 guidance_scale_lyric
  false,           // 18 audio2audio_enable
  0.5,             // 19 ref_audio_strength
  null,            // 20 ref_audio_input
  "none"           // 21 lora_name_or_path
];

if (DRY) {
  console.log("--dry-run：参数已就绪，未提交生成。");
  process.exit(0);
}

/* ---------- 2. 提交生成任务 ---------- */
const callUrl = `${BASE}/gradio_api/call/__call__`;
console.log(`POST ${callUrl}`);
const submit = await fetch(callUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ data: DATA })
});

if (!submit.ok) {
  console.error(`提交失败：HTTP ${submit.status}`);
  console.error((await submit.text()).slice(0, 400));
  process.exit(1);
}
const { event_id: eventId } = await submit.json();
console.log(`事件 id ${eventId} · 等待生成（远程排队 + 推理，通常 1–5 分钟）…\n`);

/* ---------- 3. 读 SSE 流，等结果 ---------- */
const streamRes = await fetch(`${BASE}/gradio_api/call/__call__/${eventId}`, {
  headers: { Accept: "text/event-stream" }
});
if (!streamRes.ok || !streamRes.body) {
  console.error(`无法读取结果流：HTTP ${streamRes.status}`);
  process.exit(1);
}

const reader = streamRes.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let eventName = "";
let resultData = null;
let lastMessage = "";
const started = Date.now();

for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  const chunks = buffer.split("\n");
  buffer = chunks.pop();
  for (const raw of chunks) {
    const line = raw.trimEnd();
    if (line.startsWith("event:")) { eventName = line.slice(6).trim(); continue; }
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();

    if (eventName === "error") {
      console.error("Space 返回错误：", payload.slice(0, 500));
      process.exit(1);
    }
    if (eventName === "process_status" || eventName === "progress") {
      if (payload !== lastMessage && payload !== "null") {
        lastMessage = payload;
        console.log(`  [${((Date.now() - started) / 1000).toFixed(0)}s] ${payload.slice(0, 120)}`);
      }
      continue;
    }
    if (eventName === "complete") {
      try { resultData = JSON.parse(payload); } catch { resultData = null; }
    }
  }
  if (resultData) break;
}

if (!resultData) {
  console.error("没有拿到结果（流结束但无 complete 事件）");
  process.exit(1);
}

/* ---------- 4. 下载音频 ---------- */
console.log(`\n生成完成，用时 ${((Date.now() - started) / 1000).toFixed(0)} 秒`);
const audio = Array.isArray(resultData) ? resultData[0] : resultData;
const audioUrl = typeof audio === "string" ? audio : audio?.url || audio?.path;
if (!audioUrl) {
  console.error("结果里没有音频：", JSON.stringify(resultData).slice(0, 400));
  process.exit(1);
}
console.log("远端文件:", audioUrl);

const full = audioUrl.startsWith("http") ? audioUrl : `${BASE}/gradio_api/file=${audioUrl}`;
const dl = await fetch(full);
if (!dl.ok) { console.error(`下载失败：HTTP ${dl.status}`); process.exit(1); }
const bytes = Buffer.from(await dl.arrayBuffer());

/* 按内容猜扩展名（Space 一般返回 wav/flac/mp3） */
const head = bytes.subarray(0, 4).toString("latin1");
let ext = ".wav";
if (head.startsWith("fLaC")) ext = ".flac";
else if (head.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) ext = ".mp3";
else if (head.startsWith("OggS")) ext = ".ogg";

mkdirSync(OUTDIR, { recursive: true });
const outName = String(flag("name", "rap")) + ext;
const outPath = join(OUTDIR, outName);
writeFileSync(outPath, bytes);

/* 顺手存一份参数与歌词，方便日后复现 */
const sidecar = {
  generatedAt: new Date().toISOString(),
  source: "ACE-Step via Hugging Face Space (remote; no model downloaded locally)",
  space: SPACE,
  duration: DURATION,
  style: STYLE,
  lyrics: LYRICS,
  file: outName,
  bytes: bytes.length,
  params: { infer_step: 60, guidance_scale: 15, scheduler_type: "euler", cfg_type: "apg", omega_scale: 10, lora: "none" }
};
writeFileSync(join(OUTDIR, "rap.generation.json"), JSON.stringify(sidecar, null, 2), "utf8");

console.log(`\n✓ 已保存 ${outPath}  (${(statSync(outPath).size / 1048576).toFixed(2)} MB, ${ext})`);
console.log(`  参数与歌词记录在 ${join(OUTDIR, "rap.generation.json")}`);
if (ext !== ".mp3") {
  console.log(`\n提示：浏览器播放 ${ext} 没问题，但若想省空间可以转成 mp3（需要 ffmpeg）。`);
}
