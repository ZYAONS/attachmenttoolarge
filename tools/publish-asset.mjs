#!/usr/bin/env node
/* ==========================================================================
   publish-asset.mjs — 把一个文件发到 GitHub Release

   给不需要走音乐那套清单的产物用（比如 understudy.exe）。

   Usage:
     node tools/publish-asset.mjs dist/understudy.exe --tag understudy-v0.1.0 --title "UNDERSTUDY 0.1.0" --notes notes.md
   ========================================================================== */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { basename, resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = "attachment-too-large";
const REPO = "attachmenttoolarge";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const file = args.find((a) => !a.startsWith("--") && (a.includes("/") || a.includes("\\") || a.endsWith(".exe")));
if (!file) { console.error("需要一个文件路径"); process.exit(1); }
const TAG = String(flag("tag", "understudy-v0.1.0"));
const TITLE = String(flag("title", "UNDERSTUDY"));
const NOTES_FILE = String(flag("notes", ""));
const path = resolve(ROOT, file);
if (!existsSync(path)) { console.error("找不到：" + path); process.exit(1); }

let token = process.env.GITHUB_TOKEN || "";
if (!token) {
  const r = spawnSync("git", ["credential", "fill"], { input: "protocol=https\nhost=github.com\n\n", encoding: "utf8", cwd: ROOT });
  const m = (r.stdout || "").match(/^password=(.+)$/m);
  token = m ? m[1].trim() : "";
}
if (!token) { console.error("没有可用的 GitHub 令牌"); process.exit(1); }
const H = { Authorization: "Bearer " + token, "User-Agent": "att-tools", Accept: "application/vnd.github+json" };

const notes = NOTES_FILE && existsSync(resolve(ROOT, NOTES_FILE))
  ? readFileSync(resolve(ROOT, NOTES_FILE), "utf8")
  : "UNDERSTUDY — 单文件桌面版。";

let rel = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
  method: "POST", headers: { ...H, "Content-Type": "application/json" },
  body: JSON.stringify({ tag_name: TAG, target_commitish: "main", name: TITLE + " — " + TAG, body: notes, draft: false, prerelease: false })
});
let rj = await rel.json();
if (rel.status === 422) {
  const g = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`, { headers: H });
  rj = await g.json();
  console.log("已存在该 release，复用：" + rj.html_url);
} else if (!rel.ok) {
  console.error("创建 release 失败：HTTP " + rel.status + " " + JSON.stringify(rj).slice(0, 200));
  process.exit(1);
} else {
  console.log(rj.html_url);
}

const name = basename(path);
if ((rj.assets || []).some((a) => a.name === name)) { console.log("资产已存在：" + name); process.exit(0); }
const bytes = readFileSync(path);
const up = await fetch(`https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${rj.id}/assets?name=${encodeURIComponent(name)}`, {
  method: "POST",
  headers: { ...H, "Content-Type": "application/octet-stream", "Content-Length": String(bytes.length) },
  body: bytes
});
const uj = await up.json();
console.log((up.ok ? "已上传 " : "失败 HTTP " + up.status + " ") + name + "  " + (uj.browser_download_url || ""));
console.log("大小：" + (statSync(path).size / 1048576).toFixed(1) + " MB");
