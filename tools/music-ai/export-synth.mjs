#!/usr/bin/env node
/* ==========================================================================
   export-synth.mjs — turn a browser-synthesised track into a file

   The in-house pieces (the porch loop, The Long Send) only exist as code: they
   are built note by note in the browser every time they play. That is fine for a
   website and useless as game material, so this renders one offline through the
   real engine — the same scheduler, the same voices — and writes the samples out
   as a WAV.

   It drives headless Edge over CDP, exactly as the page suite does, because the
   engine needs an OfflineAudioContext and Node has none.

   Usage:
     node tools/music-ai/export-synth.mjs folk 60
     node tools/music-ai/export-synth.mjs postrock 45
   ========================================================================== */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TRACK = process.argv[2] || "folk";
const SECONDS = parseFloat(process.argv[3] || "60");

const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/microsoft-edge"
].find((p) => existsSync(p));
if (!EDGE) { console.error("No Edge/Chrome found."); process.exit(1); }

const PORT = 9411;
const PAGE = pathToFileURL(join(ROOT, "music.html")).href;

/* The browser profile lives in the system temp directory, never in the repo: the first`n   version pointed at preview/ and committed thousands of files, including another`n   extension's assets. */
const PROFILE_DIR = mkdtempSync(join(tmpdir(), "att-cdp-"));
const edge = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
  "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE_DIR}`,
  PAGE
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error("headless browser never announced a page target");
}

function connect(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const waiting = new Map();
    ws.addEventListener("open", () => res({
      send(method, params) {
        const mid = ++id;
        ws.send(JSON.stringify({ id: mid, method, params }));
        return new Promise((ok, no) => waiting.set(mid, { ok, no }));
      },
      close() { ws.close(); }
    }));
    ws.addEventListener("error", rej);
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      if (m.error) w.no(new Error(m.error.message)); else w.ok(m.result);
    });
  });
}

try {
  const t = await target();
  const cdp = await connect(t.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await sleep(1200);                       // let the page's own scripts settle

  const ready = await cdp.send("Runtime.evaluate", {
    expression: "!!(window.ATTMusic && window.ATTMusic.exportWav)",
    returnByValue: true
  });
  if (!ready.result || !ready.result.value) throw new Error("ATTMusic.exportWav is not on the page");

  console.log(`Rendering "${TRACK}" for ${SECONDS}s through the real engine …`);
  const out = await cdp.send("Runtime.evaluate", {
    expression: `window.ATTMusic.exportWav(${SECONDS}, ${JSON.stringify(TRACK)})`,
    awaitPromise: true, returnByValue: true, timeout: 300000
  });
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.text || "render threw");
  const dataUrl = out.result && out.result.value;
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:audio/wav;base64,")) {
    throw new Error("unexpected result: " + String(dataUrl).slice(0, 80));
  }

  const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
  const dir = join(ROOT, "assets", "audio");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${TRACK}-export.wav`);
  writeFileSync(file, bytes);

  const sr = bytes.readUInt32LE(24);
  const ch = bytes.readUInt16LE(22);
  const secs = (bytes.length - 44) / (sr * ch * 2);
  console.log(`\n✓ ${file}`);
  console.log(`  ${(bytes.length / 1048576).toFixed(2)} MB · ${secs.toFixed(1)}s · ${sr} Hz · ${ch} channel(s)`);
  cdp.close();
} finally {
  edge.kill();
  try { rmSync(PROFILE_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  try { rmSync(PROFILE_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}
