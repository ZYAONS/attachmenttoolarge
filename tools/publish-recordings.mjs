#!/usr/bin/env node
/* ==========================================================================
   publish-recordings.mjs — put the recordings somewhere with a public URL

   What this can and cannot do, stated plainly:

     · GitHub Releases — yes. A release is a real distribution channel with
       permanent links, and the API is open, so this publishes the three
       recordings, the cover and the words without anyone signing in.
     · NetEase, Spotify, Apple, Bandcamp, SoundCloud — no. Every one of them
       needs an account, phone or identity verification and a CAPTCHA, and an
       upload has to come from the account holder. No script changes that, and
       it should not try.
     · Internet Archive — yes, but only with keys: create a free account, then
       this can push the same bundle there too (--archive with IA_ACCESS /
       IA_SECRET set). It is the one streaming-ish host with a genuinely open
       upload API.

   Usage:
     node tools/publish-recordings.mjs --check
     node tools/publish-recordings.mjs --release
     node tools/publish-recordings.mjs --release --tag recordings-v2
   ========================================================================== */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const OWNER = "attachment-too-large";
const REPO = "attachmenttoolarge";

/* ---------- the token, from git's own credential store, never printed ---------- */
function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  const r = spawnSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n", encoding: "utf8", cwd: ROOT
  });
  const out = r.stdout || "";
  const m = out.match(/^password=(.+)$/m);
  return m ? m[1].trim() : "";
}
const TOKEN = githubToken();
if (!TOKEN) { console.error("No GitHub token available (git credential fill returned nothing)."); process.exit(1); }
const H = { Authorization: "Bearer " + TOKEN, "User-Agent": "att-tools", Accept: "application/vnd.github+json" };

/* ---------- what goes in the bundle ---------- */
const TRACKS = [
  { file: "assets/audio/rap.mp3", title: "Attachment Too Large", kind: "boom-bap rap", time: "2:50" },
  { file: "assets/audio/wire.mp3", title: "Wrong Side of the Wire", kind: "electric Memphis soul-blues", time: "2:48" },
  { file: "assets/audio/ninetynine.mp3", title: "Ninety-Nine Forever", kind: "80s neon synth-pop", time: "2:48" },
  { file: "assets/audio/folk.mp3", title: "The Twenty-Megabyte Line", kind: "american folk, sung", time: "2:50" }
];
const EXTRA = [
  { file: "assets/img/emblem.svg", name: "cover-emblem.svg" },
  { file: "assets/img/org-avatar.png", name: "cover-1024.png" }
];

/* the words, gathered into one text file so the release is self-contained */
function lyricsFile() {
  const sandbox = {};
  new Function("window", readFileSync(join(ROOT, "assets/js/lyrics.js"), "utf8"))(sandbox);
  new Function("window", readFileSync(join(ROOT, "assets/js/recordings.js"), "utf8"))(sandbox);
  const out = ["ATTACHMENT TOO LARGE — the words, as recorded", ""];
  const rap = sandbox.ATTLYRICS;
  if (rap) {
    out.push("=".repeat(60), "Attachment Too Large (boom-bap rap, 2:50)", "=".repeat(60), "");
    rap.sections.forEach(function (s) {
      out.push("[" + s.label.toLowerCase() + "]");
      s.lines.forEach(function (l) { out.push(l); });
      out.push("");
    });
  }
  (sandbox.ATTRECORDINGS || []).forEach(function (r) {
    out.push("=".repeat(60), r.title + " (" + r.style.split(",")[0] + ")", "=".repeat(60), "");
    r.sections.forEach(function (s) {
      out.push("[" + s.label.toLowerCase() + "]");
      s.lines.forEach(function (l) { out.push(l); });
      out.push("");
    });
  });
  const p = join(ROOT, "release", "lyrics.txt");
  mkdirSync(join(ROOT, "release"), { recursive: true });
  writeFileSync(p, out.join("\n"), "utf8");
  return p;
}

/* ---------- report ---------- */
if (args.includes("--check") || !args.length) {
  console.log("Owner/repo   " + OWNER + "/" + REPO);
  console.log("Token        from git credential fill" + (process.env.GITHUB_TOKEN ? " (env)" : "") + "\n");
  const u = await fetch("https://api.github.com/repos/" + OWNER + "/" + REPO, { headers: H });
  console.log("Repo access  HTTP " + u.status);
  const rel = await fetch("https://api.github.com/repos/" + OWNER + "/" + REPO + "/releases", { headers: H });
  const list = rel.ok ? await rel.json() : [];
  console.log("Releases     " + (Array.isArray(list) ? list.length : 0) + (list[0] ? " · latest " + list[0].tag_name : ""));
  console.log("\nBundle:");
  for (const t of TRACKS) {
    const p = join(ROOT, t.file);
    console.log("  " + (existsSync(p) ? (statSync(p).size / 1048576).toFixed(2) + " MB" : "MISSING ") + "  " + t.file + "  —  " + t.title);
  }
  console.log("  lyrics       " + lyricsFile());
  process.exit(0);
}

/* ---------- publish ---------- */
if (args.includes("--release")) {
  const TAG = String(flag("tag", "recordings-v1"));
  const lyricPath = lyricsFile();

  const NOTES = [
    "Three recordings of one complaint — a 24.7 MB file, a 20 MB wall, an evening at 19:59.",
    "",
    "| # | Track | Kind | Length |",
    "|---|-------|------|--------|",
    "| 02 | Attachment Too Large | boom-bap rap, male vocal | 2:50 |",
    "| 03 | Wrong Side of the Wire | electric Memphis soul-blues, twelve-bar AAB | 2:48 |",
    "| 04 | Ninety-Nine Forever | 80s neon synth-pop | 2:48 |",
    "",
    "320 kbps, 48 kHz. The words are in `lyrics.txt`; the arrangement and the words are ours,",
    "and each recording was generated from those words by ACE-Step, an open-source model,",
    "running on a Hugging Face Space. The parameters are stored beside each mp3 in the",
    "repository as `<name>.generation.json`.",
    "",
    "Track 01, *Failed at 19:59*, is not here: it is not a file at all. It is synthesised note by",
    "note in the browser, has no percussion and no hiss, and loops forever. Hear the whole set at",
    "https://attachment-too-large.github.io/attachmenttoolarge/music.html"
  ].join("\n");

  console.log("Creating release " + TAG + " …");
  let rel = await fetch("https://api.github.com/repos/" + OWNER + "/" + REPO + "/releases", {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ tag_name: TAG, target_commitish: "main", name: "Recordings — " + TAG, body: NOTES, draft: false, prerelease: false })
  });
  let relJson = await rel.json();
  if (rel.status === 422) {
    console.log("  tag already released, reusing it");
    const g = await fetch("https://api.github.com/repos/" + OWNER + "/" + REPO + "/releases/tags/" + TAG, { headers: H });
    relJson = await g.json();
  } else if (!rel.ok) {
    console.error("  failed: HTTP " + rel.status + " " + JSON.stringify(relJson).slice(0, 200));
    process.exit(1);
  }
  console.log("  " + relJson.html_url);

  const existing = new Set(((relJson.assets) || []).map((a) => a.name));
  const uploads = TRACKS.map((t) => ({ path: join(ROOT, t.file), name: basename(t.file), type: "audio/mpeg" }))
    .concat(EXTRA.map((e) => ({ path: join(ROOT, e.file), name: e.name, type: e.name.endsWith(".png") ? "image/png" : "image/svg+xml" })))
    .concat([{ path: lyricPath, name: "lyrics.txt", type: "text/plain" }]);

  for (const up of uploads) {
    if (!existsSync(up.path)) { console.log("  skip (missing): " + up.name); continue; }
    if (existing.has(up.name)) { console.log("  already uploaded: " + up.name); continue; }
    const bytes = readFileSync(up.path);
    const r = await fetch("https://uploads.github.com/repos/" + OWNER + "/" + REPO + "/releases/" + relJson.id + "/assets?name=" + encodeURIComponent(up.name), {
      method: "POST", headers: { ...H, "Content-Type": up.type, "Content-Length": String(bytes.length) }, body: bytes
    });
    const j = await r.json();
    console.log("  " + (r.ok ? "uploaded  " : "FAILED    ") + up.name + "  " + (j.browser_download_url || ("HTTP " + r.status)));
  }

  console.log("\nDone. " + relJson.html_url);
}
