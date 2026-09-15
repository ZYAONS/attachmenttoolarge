#!/usr/bin/env node
/* ==========================================================================
   build-game-exe.mjs — UNDERSTUDY 打包成单个 Windows exe

   产出：dist/understudy.exe
     · 内嵌整套游戏（HTML / 逻辑 / 内容 / 雨 / 音乐引擎），不读外部文件
     · 启动时在 127.0.0.1 上随机端口起一个只服务内嵌资源的本地服务
     · 然后用"应用模式"开一个窗口：没有地址栏、没有标签页、没有浏览器界面

   关于"不依赖浏览器"这件事，必须说清楚：
     exe 本身是自包含的（Node 运行时 + 全部游戏资源都在里面，目标机器不需要装 Node）。
     但**渲染引擎**用的是系统自带的 WebView 组件（Windows 10/11 默认就有 Edge/WebView2）。
     要做到连渲染引擎也一起打包，得塞进 Electron/CEF —— 那会让体积从 ~110 MB 涨到
     ~250 MB 以上。这里的取舍是：单文件、启动快、无浏览器界面；代价是依赖系统组件。
     想要零依赖版本就说一声，那条路也能走。

   用法：
     node tools/build-game-exe.mjs
     node tools/build-game-exe.mjs --verify      # 构建后顺带起一次自检
   ========================================================================== */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync, rmSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "build");
const DIST = join(ROOT, "dist");
const NAME = "understudy";
const SENTINEL = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

/* 打包进 exe 的文件。路径就是运行时 URL 的路径。 */
const FILES = [
  "game/index.html",
  "game/game.js",
  "game/content.js",
  "game/rain.js",
  "assets/js/music.js"
];

const step = (n, s) => console.log(`[${n}] ${s}`);
const mb = (p) => (statSync(p).size / 1048576).toFixed(1) + " MB";

/* ---------- 0. 检查 ---------- */
step(0, "检查输入文件");
for (const f of FILES) {
  if (!existsSync(join(ROOT, f))) { console.error("    缺少：" + f); process.exit(1); }
}
const nodeRequire = createRequire(import.meta.url);
let esbuild = null;
try { esbuild = nodeRequire("esbuild"); } catch (e) { esbuild = null; }
if (!esbuild) { console.error("    没有 esbuild，请先 npm i -D esbuild"); process.exit(1); }
const postjectCli = join(ROOT, "node_modules", "postject", "dist", "cli.js");
if (!existsSync(postjectCli)) { console.error("    没有 postject，请先 npm i -D postject"); process.exit(1); }
console.log("    4 个游戏文件 + 音乐引擎，esbuild / postject 就位");

/* ---------- 1. 生成服务端入口 ---------- */
step(1, "生成内嵌资源的服务端入口");
mkdirSync(BUILD, { recursive: true });

const embed = {};
for (const f of FILES) embed[f] = readFileSync(join(ROOT, f), "utf8");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml"
};

const entry = `
"use strict";
const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

/* 打包进来的资源。键 = 请求路径 */
const EMBED = ${JSON.stringify(embed)};
const TYPES = ${JSON.stringify(TYPES)};

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

function serve(port) {
  return new Promise((res) => {
    const server = http.createServer((req, r) => {
      let p = decodeURIComponent((req.url || "/").split("?")[0]);
      if (p === "/" || p === "") { r.writeHead(302, { Location: "/game/index.html" }); return r.end(); }
      p = p.replace(/^\\//, "");
      let body = EMBED[p];
      if (!body && EMBED["game/" + p]) { p = "game/" + p; body = EMBED[p]; }
      if (!body) { r.writeHead(404, { "Content-Type": "text/plain" }); return r.end("not found"); }
      const ext = path.extname(p).toLowerCase();
      r.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-store" });
      r.end(body);
    });
    server.listen(port, "127.0.0.1", () => res(server));
  });
}

/* 找一个能开"应用窗口"的浏览器内核：无地址栏、无标签页 */
function findEngine() {
  const cands = [
    "C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe",
    "C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe",
    "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
    "C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe"
  ];
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return null;
}

(async () => {
  const wanted = parseInt(valOf("--port", "0"), 10);
  const server = await serve(wanted);
  const url = "http://127.0.0.1:" + server.address().port + "/";
  console.log("UNDERSTUDY  " + url);

  if (has("--serve-only")) { console.log("(serve only; 按 Ctrl+C 结束)"); return; }

  const engine = findEngine();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "understudy-"));
  if (engine) {
    const args = [
      "--app=" + url,                  // 应用模式：没有地址栏和标签页
      "--user-data-dir=" + profile,
      "--no-first-run", "--no-default-browser-check",
      "--window-size=1280,860",
      "--autoplay-policy=no-user-gesture-required"
    ];
    const dbg = valOf("--debug-port", "");
    if (dbg) args.push("--remote-debugging-port=" + dbg);
    const child = spawn(engine, args, { detached: true, stdio: "ignore" });
    child.unref();
    console.log("窗口已打开（应用模式，无浏览器界面）。关掉窗口即可退出。");
  } else {
    console.log("这台机器上没有找到 Edge/Chrome，改用默认浏览器打开。");
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  }
})();
`;

writeFileSync(join(BUILD, "game-entry.cjs"), entry, "utf8");
console.log("    入口已写入 build/game-entry.cjs（内嵌 " +
  (FILES.reduce((n, f) => n + embed[f].length, 0) / 1024).toFixed(0) + " KB 资源）");

/* ---------- 2. 打包成单文件 ---------- */
step(2, "esbuild 打成单个 CJS");
const bundled = join(BUILD, "game-bundle.cjs");
await esbuild.build({
  entryPoints: [join(BUILD, "game-entry.cjs")],
  bundle: true, platform: "node", target: "node20", format: "cjs",
  outfile: bundled, logLevel: "error"
});
console.log("    " + mb(bundled));

/* ---------- 3. SEA 配置与 blob ---------- */
step(3, "生成 SEA blob");
const seaConfig = join(BUILD, "sea-config.json");
writeFileSync(seaConfig, JSON.stringify({
  main: bundled,
  output: join(BUILD, "sea-prep.blob"),
  disableExperimentalSEAWarning: true
}, null, 2));

const seaRun = spawnSync(process.execPath, ["--experimental-sea-config", seaConfig], { encoding: "utf8" });
if (seaRun.status !== 0) {
  console.error("    SEA 配置失败：\n" + (seaRun.stderr || "").slice(0, 600));
  process.exit(1);
}
const blob = join(BUILD, "sea-prep.blob");
console.log("    " + mb(blob));

/* ---------- 4. 注入 ---------- */
step(4, "复制 node 运行时并注入 blob");
mkdirSync(DIST, { recursive: true });
const exe = join(DIST, NAME + ".exe");
rmSync(exe, { force: true });
copyFileSync(process.execPath, exe);

/* 资源名必须是 NODE_SEA_BLOB —— 这是 Node 的 SEA 加载器去找的名字。
   把它写成 sentinel 字符串会让注入"成功"，但产物一启动就访问冲突（0xC0000005），
   而且没有任何输出，很难看出是这里的问题。 */
const inject = spawnSync(process.execPath, [
  postjectCli, exe, "NODE_SEA_BLOB", blob,
  "--sentinel-fuse", SENTINEL
], { encoding: "utf8" });
if (inject.status !== 0) {
  console.error("    注入失败：\n" + (inject.stderr || inject.stdout || "").slice(0, 600));
  process.exit(1);
}
console.log("    " + exe + "  " + mb(exe));

/* ---------- 5. 自检：启动 exe，抓一次页面 ---------- */
if (process.argv.includes("--verify")) {
  step(5, "启动 exe 并抓取页面（--serve-only）");
  const port = 8712;
  const child = spawnSync(exe, ["--serve-only", "--port", String(port)], {
    encoding: "utf8", timeout: 25000, killSignal: "SIGKILL"
  });
  // spawnSync 会等它退出；用后台方式替代：
  if (child.error) {
    console.log("    直接运行不可行（" + child.error.code + "），改后台方式验证");
  }
}
console.log("\n完成。用法：\n    dist\\" + NAME + ".exe              （开窗口）\n    dist\\" + NAME +
  ".exe --serve-only --port 8712   （只起服务，便于调试）");

/* ---------- 6. 后台自检 ---------- */
if (process.argv.includes("--verify")) {
  const { spawn } = await import("node:child_process");
  const port = 8713;
  const child = spawn(join(DIST, NAME + ".exe"), ["--serve-only", "--port", String(port)], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 2500));
  let ok = 0, bad = 0;
  /* 按页面自己写的 src 去抓 —— 上一版只试了硬编码的路径，
     正好绕过了"根路径下相对路径解析错"这个坑。 */
  const rootRes = await fetch(`http://127.0.0.1:${port}/`);
  const html = await rootRes.text();
  const docUrl = rootRes.url;
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  console.log(`    文档地址 ${docUrl} · 页面声明了 ${srcs.length} 个脚本`);
  for (const s of srcs) {
    const u = new URL(s, docUrl).href;
    try {
      const res = await fetch(u);
      const body = await res.text();
      const isJs = /\\.js$/i.test(s);
      if (res.ok && body.length > (isJs ? 200 : 50)) { ok++; console.log(`    ✓ ${s}  ${res.status} · ${body.length} B`); }
      else { bad++; console.log(`    ✗ ${s}  ${res.status} · ${body.length} B`); }
    } catch (e) { bad++; console.log(`    ✗ ${s}  ${e.message}`); }
  }
  child.kill();
  console.log(bad === 0 ? "    自检通过：exe 能独立把整套游戏喂给渲染引擎" : "    自检失败");
  process.exit(bad === 0 ? 0 : 1);
}
