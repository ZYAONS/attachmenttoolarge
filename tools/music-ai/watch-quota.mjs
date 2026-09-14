#!/usr/bin/env node
/* ==========================================================================
   watch-quota.mjs — keep asking until the GPU quota comes back

   The diagnosis, recorded so nobody re-derives it:
     · the token is valid, the spaces are RUNNING on zero-a10g, and the same
       spaces' non-GPU endpoints answer fine — the request path is healthy;
     · every GPU-backed generation call returns an empty error event;
     · the same token and payload rendered three songs an hour earlier.
   That is a spent ZeroGPU allowance, and it resets on its own schedule.

   So this polls: every N minutes, try to render the pending song; the moment it
   succeeds, say so loudly and stop.

   Usage: node tools/music-ai/watch-quota.mjs [--every 10] [--tries 12] [--id folk]
   ========================================================================== */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };

const EVERY_MIN = parseFloat(String(flag("every", "10")));
const TRIES = parseInt(String(flag("tries", "12")), 10);
const ID = String(flag("id", "folk"));
const DURATION = String(flag("duration", "170"));

const tokenPath = join(ROOT, "tools", "music-ai", ".hf-token");
if (!existsSync(tokenPath)) { console.error("No token at tools/music-ai/.hf-token"); process.exit(1); }
process.env.HF_TOKEN = readFileSync(tokenPath, "utf8").trim();

const stamp = () => new Date().toTimeString().slice(0, 8);
const outMp3 = join(ROOT, "assets", "audio", ID + ".mp3");
const outWav = join(ROOT, "assets", "audio", ID + ".wav");

console.log(`[${stamp()}] watching for the GPU quota to return`);
console.log(`           song: ${ID} · every ${EVERY_MIN} min · up to ${TRIES} attempts`);
console.log(`           engines: ACE-Step first, then YuE2\n`);

for (let attempt = 1; attempt <= TRIES; attempt++) {
  // ACE-Step (the engine that has produced everything so far)
  let r = spawnSync(process.execPath, [join(ROOT, "tools", "music-ai", "generate-version.mjs"), ID, "--duration", DURATION],
    { encoding: "utf8", cwd: ROOT, timeout: 900000 });
  let hit = existsSync(outMp3);
  let engine = "ACE-Step";

  if (!hit) {
    // a different model family, in case only this one is saturated
    r = spawnSync(process.execPath, [join(ROOT, "tools", "music-ai", "generate-yue.mjs"), ID],
      { encoding: "utf8", cwd: ROOT, timeout: 1800000 });
    hit = existsSync(outMp3) || existsSync(outWav);
    engine = "YuE2";
  }

  if (hit) {
    const file = existsSync(outMp3) ? outMp3 : outWav;
    const mb = (readFileSync(file).length / 1048576).toFixed(2);
    console.log(`\n[${stamp()}] RECOVERED — attempt ${attempt} succeeded with ${engine}`);
    console.log(`           ${file} (${mb} MB)`);
    console.log(`           next: list it as track 05 on music.html and push.`);
    process.exit(0);
  }

  const tail = (r.stderr || r.stdout || "").split("\n").filter(Boolean).slice(-1)[0] || "";
  console.log(`[${stamp()}] attempt ${attempt}/${TRIES} — still refused  ${tail.slice(0, 70)}`);
  if (attempt < TRIES) await new Promise((res) => setTimeout(res, EVERY_MIN * 60 * 1000));
}

console.log(`\n[${stamp()}] gave up after ${TRIES} attempts (~${Math.round(EVERY_MIN * TRIES / 60)} h).`);
console.log("           Either the allowance is larger than expected to refill, or this account/IP");
console.log("           is being throttled. A different Hugging Face account is the quickest fix.");
process.exit(1);
