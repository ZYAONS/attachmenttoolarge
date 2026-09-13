#!/usr/bin/env node
/* ==========================================================================
   att — attachment splitting tool  v0.1.0
   The first real product from attachmenttoolarge (the Attachment Too Large Society).

   Zero dependencies: Node built-ins only. Five commands:
     att limits            attachment limits by mail service
     att info <file>       will it send? (does the Base64 arithmetic too)
     att split <file>      cut it into shards, write a double-clickable rebuild script
     att join <shard>      verify every shard, then rebuild
     att ndr <file|->      translate a bounce message into English

   Design principle: the recipient installs nothing. They double-click a script.
   ========================================================================== */

import {
  openSync, readSync, closeSync, writeSync, statSync, existsSync,
  mkdirSync, readFileSync, writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join as pjoin, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const VERSION = "0.1.0";

/* 兼容三种运行方式：
   1. 源码直跑        node cli/att.mjs           → 用 import.meta.url
   2. 打包成单文件 exe（SEA，CJS 形态）           → 用 __dirname
   3. 兜底                                      → 用可执行文件所在目录 */
function detectHere() {
  try { if (typeof __dirname === "string" && __dirname) return __dirname; } catch { /* ignore */ }
  try { return dirname(fileURLToPath(import.meta.url)); } catch { /* ignore */ }
  return dirname(process.execPath);
}
const HERE = detectHere();
const LIMITS_FILE = resolve(HERE, "..", "data", "limits.json");
const MANIFEST_SUFFIX = ".att.json";
const PART_TAG = ".att-part-";

/* ======================= 输出 ======================= */
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : String(s));
const dim = (s) => c("2", s);
const bold = (s) => c("1", s);
const red = (s) => c("31", s);
const green = (s) => c("32", s);
const yellow = (s) => c("33", s);
const cyan = (s) => c("36", s);

function say(...args) { console.log(...args); }
function die(msg, code = 1) { console.error(red("Error: ") + msg); process.exit(code); }

/* ======================= 工具 ======================= */
function human(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(n < 10 ? 2 : 1)) + " " + units[i];
}

/** 解析 "20MB" / "1.5GiB" / "512k" / "1048576" → 字节数（KB/MB/GB 按 1024 进制） */
function parseSize(text) {
  if (typeof text === "number") return Math.round(text);
  const m = String(text).trim().match(/^([0-9]*\.?[0-9]+)\s*([a-zA-Z]*)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] || "b").toLowerCase().replace(/ib$/, "b").replace(/bytes?$/, "b");
  const mult = { b: 1, k: 1024, kb: 1024, m: 1024 ** 2, mb: 1024 ** 2, g: 1024 ** 3, gb: 1024 ** 3, t: 1024 ** 4, tb: 1024 ** 4 }[unit];
  if (!mult) return null;
  return Math.round(n * mult);
}

/** Base64 编码后的近似体积：每 3 字节变 4 字符，再加换行与邮件头余量 */
function encodedSize(bytes) {
  const b64 = Math.ceil(bytes / 3) * 4;
  const crlf = Math.ceil(b64 / 76) * 2;          // a line break every 76 characters
  return b64 + crlf + 2048;                       // headroom for headers, body and signature
}

function sha256OfFile(path) {
  const size = statSync(path).size;
  const fd = openSync(path, "r");
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, null);
      if (n <= 0) break;
      hash.update(chunk.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return { hex: hash.digest("hex"), bytes: size };
}

function loadLimits() {
  // 打包成单文件 exe 时，构建脚本会把 data/limits.json 内联成这个常量
  // （exe 旁边不会有 data/ 目录，所以必须内联）
  if (typeof __ATT_LIMITS__ !== "undefined" && __ATT_LIMITS__) return __ATT_LIMITS__;
  if (!existsSync(LIMITS_FILE)) return null;
  try { return JSON.parse(readFileSync(LIMITS_FILE, "utf8")); } catch { return null; }
}

/* ======================= 参数解析 ======================= */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) { flags[k] = argv[++i]; }
      else flags[k] = true;
    } else if (a === "-h") flags.help = true;
    else if (a === "-j") flags.json = true;
    else positional.push(a);
  }
  return { positional, flags };
}

/* ======================= limits ======================= */
function cmdLimits(args) {
  const data = loadLimits();
  if (!data) die(`Limits data file not found: ${LIMITS_FILE}`);
  const q = (args.positional[0] || "").toLowerCase();

  let list = data.services;
  if (q) {
    list = list.filter((s) => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
    if (!list.length) die(`No service matches "${q}". Run att limits to see them all.`);
  }

  if (args.flags.json) {
    say(JSON.stringify({ updatedAt: data.updatedAt, services: list }, null, 2));
    return 0;
  }

  say(bold("Attachment limits by service") + dim(`(data verified ${data.updatedAt}）`));
  say("");
  const width = Math.max(...list.map((s) => displayWidth(s.name))) + 2;
  for (const s of list) {
    const limit = s.limitMB === null
      ? dim("no limit")
      : (s.minMB ? yellow(`${s.minMB}–${s.maxMB} MB`) : green(`${s.limitMB} MB`));
    say(`  ${s.name}${" ".repeat(Math.max(1, width - displayWidth(s.name)))}${pad(limit, 12)}  ${dim(s.note)}`);
  }
  say("");
  say(dim("  Note: messages are Base64 encoded in transit, inflating size by about 33%."));
  say(dim("        Unsure? Run att info <file> first — it does the arithmetic on the encoded size."));
  return 0;
}

/** 中文按两个宽度算，避免表格错位 */
function displayWidth(s) {
  let w = 0;
  for (const ch of s) w += /[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1;
  return w;
}
function pad(s, width) {
  const visible = displayWidth(s.replace(/\u001b\[[0-9;]*m/g, ""));
  return s + " ".repeat(Math.max(0, width - visible));
}

/* ======================= info ======================= */
function cmdInfo(args) {
  const file = args.positional[0];
  if (!file) die("Usage: att info <file>", 2);
  if (!existsSync(file)) die(`File not found: ${file}`);

  const size = statSync(file).size;
  const enc = encodedSize(size);
  const data = loadLimits();

  if (args.flags.json) {
    const verdict = (data?.services || []).filter((s) => s.limitMB !== null)
      .map((s) => ({ id: s.id, name: s.name, limitMB: s.limitMB, fits: enc <= s.limitMB * 1024 * 1024 }));
    say(JSON.stringify({ file: basename(file), bytes: size, human: human(size), encodedBytes: enc, encodedHuman: human(enc), overheadPercent: Math.round((enc / size - 1) * 100), verdict }, null, 2));
    return 0;
  }

  say(bold(basename(file)));
  say(`  File size       ${human(size)}  ${dim(`(${size} bytes)`)}`);
  say(`  Encoded size    ${yellow(human(enc))}  ${dim(`(Base64 inflates it ${Math.round((enc / size - 1) * 100)}% — this is what the server sees)`)}`);
  if (size > 0) {
    const parts20 = Math.ceil(enc / (20 * 1024 * 1024));
    say(`  At 20 MB        ${parts20 > 1 ? red(`needs ${parts20} shards`) : green("one message is enough")}`);
  }
  say("");

  if (data) {
    say(bold("  Will it send?"));
    for (const s of data.services) {
      if (s.limitMB === null) { say(`    ${dim("–")}  ${pad(s.name, 34)} ${dim("no client-side limit")}`); continue; }
      const limit = s.limitMB * 1024 * 1024;
      const fits = enc <= limit;
      say(`    ${fits ? green("✓") : red("✗")}  ${pad(s.name, 42)}${fits ? dim(`limit ${s.limitMB} MB`) : red(`limit ${s.limitMB} MB · over by ${human(enc - limit)}`)}`);
    }
    say("");
    say(dim(`  Data verified ${data.updatedAt}. Defaults change; check the official documentation and your own measurements.`));
  }

  if (enc > 20 * 1024 * 1024) {
    say("");
    say(`  Try: ${cyan(`att split "${basename(file)}" --limit 20MB`)}`);
  }
  return 0;
}

/* ======================= split ======================= */
function cmdSplit(args) {
  const file = args.positional[0];
  if (!file) die("Usage: att split <file> [--limit 20MB] [--out DIR]", 2);
  if (!existsSync(file)) die(`File not found: ${file}`);

  const limitBytes = parseSize(args.flags.limit || "20MB");
  if (!limitBytes || limitBytes < 1024) die(`Invalid --limit: ${args.flags.limit}`);

  const srcSize = statSync(file).size;
  if (srcSize === 0) die("The file is empty. Nothing to cut.");
  const srcHash = sha256OfFile(file).hex;
  const base = basename(file);
  const outDir = args.flags.out ? resolve(String(args.flags.out)) : dirname(resolve(file));
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const count = Math.ceil(srcSize / limitBytes);
  const pad0 = String(count).length < 3 ? 3 : String(count).length;
  const shards = [];
  const fd = openSync(file, "r");
  const buf = Buffer.allocUnsafe(limitBytes);
  try {
    for (let i = 0; i < count; i++) {
      const target = i * limitBytes;
      let filled = 0;
      while (filled < limitBytes) {
        const n = readSync(fd, buf, filled, limitBytes - filled, target + filled);
        if (n <= 0) break;
        filled += n;
      }
      const name = `${base}${PART_TAG}${String(i + 1).padStart(pad0, "0")}`;
      const full = pjoin(outDir, name);
      const data = buf.subarray(0, filled);
      writeFileSync(full, data);
      shards.push({ index: i + 1, name, bytes: filled, sha256: createHash("sha256").update(data).digest("hex") });
    }
  } finally {
    closeSync(fd);
  }

  const manifest = {
    tool: "att",
    version: VERSION,
    createdAt: new Date().toISOString(),
    original: { name: base, bytes: srcSize, sha256: srcHash },
    limitBytes,
    limitHuman: human(limitBytes),
    shardCount: shards.length,
    shards
  };
  const manifestName = `${base}${MANIFEST_SUFFIX}`;
  writeFileSync(pjoin(outDir, manifestName), JSON.stringify(manifest, null, 2), "utf8");

  // 收件人双击还原用的脚本（Windows 一条、POSIX 一条）
  const scriptBase = base.replace(/[\\/:*?"<>|]/g, "_");
  const files = { ps1: `${scriptBase}.att-reassemble.ps1`, cmd: `${scriptBase}.att-reassemble.cmd`, sh: `${scriptBase}.att-reassemble.sh` };
  // 注意：Windows PowerShell 5.1 在脚本没有 BOM 时会按 ANSI 解码，
  // 中文文件名会因此变成乱码并导致「缺少分片」。所以 .ps1 必须带 UTF-8 BOM。
  writeFileSync(pjoin(outDir, files.ps1), "\uFEFF" + reassemblePs1(manifest), "utf8");
  writeFileSync(pjoin(outDir, files.cmd), reassembleCmd(files.ps1), "utf8");
  writeFileSync(pjoin(outDir, files.sh), reassembleSh(manifest), "utf8");

  if (args.flags.json) {
    say(JSON.stringify({
      ok: true,
      outDir,
      manifest: manifestName,
      limitBytes,
      limitHuman: manifest.limitHuman,
      shardCount: shards.length,
      shards,
      scripts: files
    }, null, 2));
    return 0;
  }

  say(`${green("✓")} Cut into ${bold(String(shards.length))} shards, ${manifest.limitHuman} max each`);
  say("");
  for (const s of shards) {
    say(`  ${cyan(s.name)}  ${pad(human(s.bytes), 10)} ${dim(s.sha256.slice(0, 16) + "…")}`);
  }
  say("");
  say(`  Original  ${bold(base)}  ${human(srcSize)}`);
  say(`  SHA-256    ${dim(srcHash)}`);
  say(`  Manifest  ${cyan(manifestName)}  ${dim("(verifies every shard when rebuilding)")}`);
  say("");
  say(bold("  Rebuilding on the recipient's side"));
  say(`    Windows      double-click ${cyan(files.cmd)}`);
  say(`    macOS/Linux  ${cyan(`sh ${files.sh}`)}`);
  say(`    With the CLI  ${cyan(`att join "${manifestName}"`)}`);
  say("");
  say(dim(`  Shards and manifest are in ${outDir}`));
  return 0;
}

function psQuote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

function reassemblePs1(m) {
  const parts = m.shards.map((s) => `  ${psQuote(s.name)}`).join(",\n");
  return `# Rebuild script for "${m.original.name}" — generated by att v${m.version}
# Usage: right-click → Run with PowerShell, or run .\\${m.original.name}.att-reassemble.ps1
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$parts = @(
${parts}
)
$out = ${psQuote(m.original.name)}
$expected = ${psQuote(m.original.sha256)}

Write-Host "Rebuilding $out ($($parts.Count) shards)…" -ForegroundColor Cyan
$stream = [System.IO.File]::Create((Join-Path $PSScriptRoot $out))
try {
  foreach ($p in $parts) {
    $path = Join-Path $PSScriptRoot $p
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing shard: $p" }
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $stream.Write($bytes, 0, $bytes.Length)
  }
} finally {
  $stream.Close()
}

$actual = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $out) -Algorithm SHA256).Hash.ToLower()
if ($actual -eq $expected) {
  Write-Host "✓ Verified. File is complete: $out" -ForegroundColor Green
} else {
  Write-Host "✗ Verification failed. The file may be incomplete:" -ForegroundColor Red
  Write-Host "  expected $expected"
  Write-Host "  actual   $actual"
  exit 1
}
`;
}

function reassembleCmd(ps1Name) {
  // 刻意保持纯 ASCII，而且不写死脚本名：
  // cmd.exe 按当前 ANSI 代码页解析批处理文件，里面若出现中文文件名（UTF-8 字节）
  // 会变成乱码导致找不到脚本。这里用通配符让 cmd 自己去匹配（通配符是 ASCII）。
  return `@echo off
rem Double-click this file to reassemble the attachment.
rem The real work is done by the PowerShell script sitting next to it.
set "ATT_PS1="
for %%f in ("%~dp0*.att-reassemble.ps1") do if not defined ATT_PS1 set "ATT_PS1=%%f"
if not defined ATT_PS1 (
  echo Reassemble script not found next to this file.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%ATT_PS1%"
echo.
pause
`;
}

function reassembleSh(m) {
  const parts = m.shards.map((s) => `'${s.name.replace(/'/g, "'\\''")}'`).join(" ");
  return `#!/bin/sh
# Rebuild script for "${m.original.name}" — generated by att v${m.version}
set -e
cd "$(dirname "$0")"
out='${m.original.name.replace(/'/g, "'\\''")}'
expected='${m.original.sha256}'

echo "Rebuilding $out (${m.shards.length} shards)…"
cat ${parts} > "$out"

if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$out" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$out" | awk '{print $1}')
else
  echo "(no sha256sum on this machine — skipping verification)"; exit 0
fi

if [ "$actual" = "$expected" ]; then
  echo "✓ Verified. File is complete: $out"
else
  echo "✗ Verification failed. Expected $expected, got $actual"; exit 1
fi
`;
}

/* ======================= join ======================= */
function findManifest(target) {
  if (target.endsWith(MANIFEST_SUFFIX) && existsSync(target)) return resolve(target);
  const dir = dirname(resolve(target));
  const base = basename(target);
  const idx = base.indexOf(PART_TAG);
  const stem = idx >= 0 ? base.slice(0, idx) : base;
  const candidate = pjoin(dir, stem + MANIFEST_SUFFIX);
  if (existsSync(candidate)) return candidate;
  return null;
}

function cmdJoin(args) {
  const target = args.positional[0];
  if (!target) die("Usage: att join <manifest.att.json | any shard> [--out FILE] [--force]", 2);
  if (!existsSync(target)) die(`Not found: ${target}`);

  const manifestPath = findManifest(target);
  if (!manifestPath) {
    die(`No manifest (*${MANIFEST_SUFFIX}) found. Keep it in the same folder as the shards.`);
  }

  let m;
  try { m = JSON.parse(readFileSync(manifestPath, "utf8")); }
  catch (e) { die(`Cannot read the manifest: ${manifestPath}\n${e.message}`); }

  const dir = dirname(manifestPath);
  const outPath = args.flags.out ? resolve(String(args.flags.out)) : pjoin(dir, m.original.name);
  if (existsSync(outPath) && !args.flags.force) {
    die(`Output file already exists: ${outPath}\n      add --force to overwrite, or use --out to choose another name.`);
  }

  const report = [];
  let missing = 0, corrupt = 0;

  // 第一遍：逐片校验
  for (const s of m.shards) {
    const p = pjoin(dir, s.name);
    if (!existsSync(p)) { missing++; report.push({ ...s, status: "missing" }); continue; }
    const { hex, bytes } = sha256OfFile(p);
    if (bytes !== s.bytes || hex !== s.sha256) { corrupt++; report.push({ ...s, status: "corrupt", actual: hex, actualBytes: bytes }); }
    else report.push({ ...s, status: "ok" });
  }

  if (missing || corrupt) {
    console.error(red("✗ Shard verification failed. Aborted — no corrupt file was written."));
    for (const r of report) {
      if (r.status === "missing") console.error(`    ${red("missing")}  ${r.name}`);
      if (r.status === "corrupt") console.error(`    ${red("corrupt")}  ${r.name}  ${dim("expected " + r.sha256.slice(0, 12) + "… actual   " + String(r.actual).slice(0, 12) + "…")}`);
    }
    console.error(dim(`\n  ${missing} missing, ${corrupt} corrupt. Ask the sender to resend those shards, then run this again.`));
    return 1;
  }

  // 第二遍：按顺序拼接
  const fd = openSync(outPath, "w");
  const hasher = createHash("sha256");
  let written = 0;
  try {
    for (const s of m.shards) {
      const data = readFileSync(pjoin(dir, s.name));
      writeSync(fd, data);
      hasher.update(data);
      written += data.length;
    }
  } finally {
    closeSync(fd);
  }

  const finalHash = hasher.digest("hex");
  const ok = finalHash === m.original.sha256 && written === m.original.bytes;

  if (args.flags.json) {
    say(JSON.stringify({ ok, out: outPath, bytes: written, sha256: finalHash, expected: m.original.sha256 }, null, 2));
    return ok ? 0 : 1;
  }

  if (ok) {
    say(`${green("✓")} Reassembled: ${bold(outPath)}`);
    say(`  ${m.shards.length} shards verified · ${human(written)}`);
    say(`  SHA-256  ${dim(finalHash)}`);
    return 0;
  }

  console.error(red("✗ Hash mismatch after rebuilding — the file may have been damaged in transit."));
  console.error(`  expected ${m.original.sha256}`);
  console.error(`  actual   ${finalHash}`);
  return 1;
}

/* ======================= ndr ======================= */
const NDR_KNOWLEDGE = [
  {
    re: /5\.3\.4/i,
    title: "550 5.3.4 · Message size exceeds fixed maximum message size",
    who: "your side (submission server or outbound gateway)",
    mean: "The message exceeded the size your own server allows and was stopped before it left.",
    todo: ["Redo the arithmetic on the encoded size (+33%): your figure is usually smaller than the server's", "Split it: att split <file> --limit 20MB", "If it must go as one message, ask an admin to raise the outbound limit"]
  },
  {
    re: /5\.2\.3/i,
    title: "552 5.2.3 · Message size exceeds fixed maximum message size (recipient side)",
    who: "the recipient's side",
    mean: "It left your server and the recipient's mailbox or gateway refused it. You cannot change their settings, only the size.",
    todo: ["Split it", "Or use a shared location you both accept and put the link in the body"]
  },
  {
    re: /0x80040610/i,
    title: "0x80040610 · rejected at submission",
    who: "when the Outlook client submits to the server",
    mean: "Total message size exceeded the per-user limit. Attachments plus encoding inflation grow faster than you expect.",
    todo: ["Use att info <file> to see the real encoded size", "Split it"]
  },
  {
    re: /0x8004210B/i,
    title: "0x8004210B · timed out while sending",
    who: "the transfer between client and server",
    mean: "Usually a timeout rather than a size rejection: a large attachment plus a slow uplink, the classic pairing.",
    todo: ["Split it so each message finishes sooner", "Retry on a more stable connection"]
  },
  {
    re: /5\.7\.(0|1)/i,
    title: "550 5.7.x · policy or security block",
    who: "the gateway's compliance or anti-spam policy",
    mean: "This is policy, not size: attachment type, encryption requirements, sender reputation.",
    todo: ["Read the policy name quoted in the bounce", "Switch to a link or get whitelisted — do not waste effort on size"]
  },
  {
    re: /(message size exceeds|exceeds the maximum message size|attachment.{0,20}too large|file you're attaching is bigger)/i,
    title: "Generic \"message too large\" notice (no error code given)",
    who: "unknown; usually whichever gate is smallest",
    mean: "A gateway rewrote the bounce and lost the error code. Only measurement will find the real limit.",
    todo: ["Send 5 MB, then double, and note the first size that bounces", "Write the result into your internal docs with today's date"]
  }
];

function cmdNdr(args) {
  let text = "";
  const src = args.positional[0];
  if (src && src !== "-") {
    if (!existsSync(src)) die(`Bounce file not found: ${src}`);
    text = readFileSync(src, "utf8");
  } else {
    try { text = readFileSync(0, "utf8"); } catch { text = ""; }
  }
  if (!text.trim()) {
    die("No input. Usage: att ndr <bounce-file>, or cat bounce.txt | att ndr -", 2);
  }

  const hits = NDR_KNOWLEDGE.filter((k) => k.re.test(text));
  // 已经认出具体错误码时，就不再补一条「通用过大提示」，免得同一封退信解释两遍
  const specific = hits.filter((k) => !/^Generic/.test(k.title));
  const shown = specific.length ? specific : hits;
  const sizeHints = [...text.matchAll(/(\d[\d.,]*)\s*(KB|MB|GB|kilobytes|megabytes|gigabytes)/gi)]
    .map((mm) => `${mm[1]} ${mm[2]}`).slice(0, 6);
  const codes = [...new Set([...text.matchAll(/\b([245]\d\d[ .-]?\d\.\d+\.\d+)/g)].map((mm) => mm[1]))];
  const hex = [...new Set([...text.matchAll(/0x[0-9A-Fa-f]{8}/g)].map((mm) => mm[0]))];

  if (args.flags.json) {
    say(JSON.stringify({
      codes, hexCodes: hex, sizeHints,
      findings: shown.map((h) => ({ title: h.title, who: h.who, mean: h.mean, todo: h.todo }))
    }, null, 2));
    return 0;
  }

  say(bold("Bounce, translated"));
  if (codes.length) say(`  Codes             ${codes.map(cyan).join("  ")}`);
  if (hex.length) say(`  Hex codes         ${hex.map(cyan).join("  ")}`);
  if (sizeHints.length) say(`  Sizes mentioned   ${sizeHints.join(" / ")}`);
  say("");

  if (!shown.length) {
    say(yellow("  We do not recognise this bounce."));
    say(dim("  Send us the raw bounce — do not rewrite it — at hello@attachmenttoolarge.org,"));
    say(dim("  and we will add it to the recognition table, then tell you which gate blocked you."));
    return 0;
  }

  shown.forEach((h, i) => {
    say(`  ${bold(h.title)}`);
    say(`    Who blocked it   ${h.who}`);
    say(`    What it means    ${h.mean}`);
    say(`    Next`);
    h.todo.forEach((t) => say(`      · ${t}`));
    if (i < shown.length - 1) say("");
  });

  if (shown.some((h) => /5\.3\.4|0x80040610|Generic/.test(h.title))) {
    say("");
    say(dim("  Remember: the server measures the encoded size, roughly 33% larger than the file."));
    say(`  Run ${cyan("att info <file>")} before deciding how many shards.`);
  }
  return 0;
}

/* ======================= 帮助 ======================= */
function cmdHelp() {
  say(bold("att") + dim(` v${VERSION} — attachment splitting tool · attachmenttoolarge`));
  say("");
  say(bold("  Usage"));
  say("    att limits [keyword]            attachment limits by mail service");
  say("    att info <file>                 will it send? (also does the Base64 arithmetic)");
  say("    att split <file> [options]      cut it up, with a double-clickable rebuild script");
  say("    att join <manifest|shard>       verify every shard, then rebuild");
  say("    att ndr <file|->                translate a bounce message into English");
  say("");
  say(bold("  split options"));
  say("    --limit 20MB     maximum size per shard (default 20MB; KB/MB/GB are 1024-based)");
  say("    --out DIR        output directory (defaults to the source file's folder)");
  say("    --json           machine-readable output");
  say("");
  say(bold("  join options"));
  say("    --out FILE       output file name (defaults to the name in the manifest)");
  say("    --force          overwrite an existing output file");
  say("");
  say(bold("  Examples"));
  say(`    ${cyan('att info "Q3-report_v7_final-FINAL.xlsx"')}`);
  say(`    ${cyan('att split "Q3-report_v7_final-FINAL.xlsx" --limit 20MB')}`);
  say(`    ${cyan('att join "Q3-report_v7_final-FINAL.xlsx.att.json"')}`);
  say(`    ${cyan("cat bounce.txt | att ndr -")}`);
  say("");
  say(dim("  Splitting uploads nothing — it all happens on your machine, and the"));
  say(dim("  recipient needs no software at all."));
  return 0;
}

/* ======================= 入口 ======================= */
function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("--help") || argv.includes("-h") || argv[0] === "help") return cmdHelp();
  if (argv[0] === "--version" || argv[0] === "-v" || argv[0] === "version") { say(VERSION); return 0; }

  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));
  switch (cmd) {
    case "limits": return cmdLimits(args);
    case "info": return cmdInfo(args);
    case "split": return cmdSplit(args);
    case "join": return cmdJoin(args);
    case "ndr": return cmdNdr(args);
    default:
      console.error(red(`Unknown command: ${cmd}`));
      console.error(dim("  Available: limits / info / split / join / ndr  (att --help for everything)"));
      return 2;
  }
}

process.exit(main());
