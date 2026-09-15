#!/usr/bin/env node
/* ==========================================================================
   game-check.mjs — does the UNDERSTUDY slice actually work?

   Drives the page over CDP and plays it: finds the three birthday objects,
   answers Xiaoman's five questions, makes the letter choice, listens to the
   audit, then pushes drift to 70% and checks that the ledger's handwriting has
   changed hands — which is the one system this whole design rests on.

   Usage: node tools/game-check.mjs
   ========================================================================== */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/microsoft-edge"
].find((p) => existsSync(p));
if (!EDGE) { console.error("No Edge/Chrome found."); process.exit(1); }

const PORT = 9413;
const PAGE = pathToFileURL(join(ROOT, "game", "index.html")).href;

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
      const p = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch { /* not up */ }
    await sleep(300);
  }
  throw new Error("headless browser never announced a page");
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

const SUITE = `(async () => {
  const out = [];
  const ok = (n, pass, detail) => out.push({ name: n, pass: !!pass, detail: detail == null ? "" : String(detail) });
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const G = window.__game;
  if (!G) return [{ name: "页面加载了逻辑", pass: false, detail: "window.__game 不存在" }];
  const visible = () => [...document.querySelectorAll(".obj")].filter(n => n.style.display !== "none").length;

  // ---- 第 1 天：检索 ----
  let s = G.state();
  ok("第 1 天从检索开始", s.day === 1 && s.phase === "search", JSON.stringify(s));
  ok("桌上是当天定义的那些东西", visible() === s.content ? true : visible() >= 9, visible() + " 件可见");
  ok("内容文件已加载", !!G.content && Array.isArray(G.content.days), "days=" + (G.content ? G.content.days.length : 0));
  ok("日程里还有待人工撰写的日子", !!G.content.pendingDays && Object.keys(G.content.pendingDays).length >= 5,
     Object.keys(G.content.pendingDays || {}).length + " 天待写");

  G.inspect("pills"); G.closeLoupe();
  ok("非目标物件不推进检索", G.state().found.length === 0, JSON.stringify(G.state().found));
  for (const id of ["card", "cake", "drawing"]) G.inspect(id);
  ok("三件目标全部识别", G.state().found.length === 3, JSON.stringify(G.state().found));
  G.closeLoupe(); await wait(800);
  ok("检索完成进入会面", G.state().phase === "meet", G.state().phase);

  // ---- 第 1 天：五问 ----
  for (let i = 0; i < 5; i++) {
    const chips = document.querySelectorAll("#ammo .chip");
    if (!chips.length) break;
    chips[0].click(); await wait(110);
  }
  ok("五问都写进了账本", G.state().entries === 5, G.state().entries + " 条");
  await wait(700);
  ok("第 1 天没有删改环节", !document.querySelector('[data-redact]'), "no redaction step");

  // ---- 信件与审计 ----
  const lb = document.querySelector("#letter-act button");
  ok("信件由内容文件生成选项", !!lb, lb ? lb.textContent : "missing");
  lb.click(); await wait(800);
  ok("选择后进入审计", G.state().phase === "audit", G.state().phase);
  await wait(3600);
  const printed = document.getElementById("printout").textContent || "";
  ok("审计打出漂移值", /漂移值/.test(printed), (printed.match(/漂移值[^\\n]*/) || [""])[0]);
  ok("审计打出当天自己的那句额外行", /不在训练集内/.test(printed), "day-1 extra line");
  const nb = document.getElementById("nextbtn");
  ok("审计末尾给出下一天", !!nb && /第 2 天/.test(nb.textContent), nb ? nb.textContent : "missing");
  nb.click(); await wait(300);

  // ---- 第 2 天：新桌面 + 删改 ----
  s = G.state();
  ok("推进到第 2 天", s.day === 2 && s.phase === "search", JSON.stringify(s));
  ok("第 2 天换了一批物件", visible() >= 2 && visible() <= 6, visible() + " 件");
  ok("整理额度每晚刷新", s.budget === 3, "budget=" + s.budget);
  for (const id of ["receipt", "guitar"]) G.inspect(id);
  G.closeLoupe(); await wait(800);
  for (let i = 0; i < 2; i++) { const ch = document.querySelectorAll("#ammo .chip"); if (ch.length) ch[0].click(); await wait(110); }
  await wait(500);
  const red = document.querySelectorAll("[data-redact]");
  ok("第 2 天出现删改环节", red.length >= 2, red.length + " 个选项");
  const before = G.state();
  red[0].click(); await wait(400);          // 抹除
  const after = G.state();
  ok("抹除会降低漂移", after.drift < before.drift, before.drift + "% → " + after.drift + "%");
  ok("抹除会留下档案缺口", after.gaps === 1, "缺口 " + after.gaps);

  // ---- 账本：加固 ----
  const b0 = G.state().budget;
  G.repair(); await wait(150);
  const b1 = G.state();
  ok("加固消耗整理额度", b1.budget === b0 - 1, b0 + " → " + b1.budget);
  const repRow = document.querySelector("#pages .entry:last-child");
  // （已加固）是 CSS 伪元素画出来的，不在 textContent 里 —— 要看类名
  ok("加固会标记在账本上", repRow && repRow.className.indexOf("repaired") >= 0, repRow ? repRow.className : "none");

  // ---- 漂移 → 音乐 ----
  G.pushDrift(30); await wait(120);
  ok("中段漂移换成另一条曲子", G.state().track === "postrock", "track=" + G.state().track);
  G.pushDrift(40); await wait(120);
  ok("高漂移时字迹换手", G.state().hand === "yours", G.state().hand);
  ok("高漂移时音乐回到铺底", G.state().track === "lofi", "track=" + G.state().track);
  const lastEntry = document.querySelector("#pages .entry:last-child");
  ok("账本最后一条已换字迹", lastEntry && lastEntry.className.indexOf("yours") >= 0, lastEntry ? lastEntry.className : "none");

  ok("账本页数等于记录数", document.querySelectorAll("#pages .entry").length === G.state().entries,
     document.querySelectorAll("#pages .entry").length + " / " + G.state().entries);
  ok("没有未捕获异常", !window.__errors || window.__errors.length === 0, (window.__errors || []).join(" | "));
  return out;
})()`;
let cdp;
try {
  const t = await target();
  cdp = await connect(t.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await sleep(1400);

  // 收集页面里的未捕获异常
  await cdp.send("Runtime.evaluate", {
    expression: "window.__errors=[];window.addEventListener('error',e=>window.__errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>window.__errors.push('rejection: '+e.reason));true",
    returnByValue: true
  });

  const res = await cdp.send("Runtime.evaluate", { expression: SUITE, awaitPromise: true, returnByValue: true, timeout: 120000 });
  if (res.exceptionDetails) {
    console.error("suite threw:", res.exceptionDetails.text || JSON.stringify(res.exceptionDetails).slice(0, 300));
    process.exit(1);
  }
  const rows = res.result.value || [];
  let failed = 0;
  console.log("UNDERSTUDY — 垂直切片验收\n");
  for (const r of rows) {
    if (!r.pass) failed++;
    console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  —  " + r.detail : ""}`);
  }
  console.log(`\n共 ${rows.length} 项检查，失败 ${failed} 项`);
  cdp.close();
  edge.kill();
  process.exit(failed ? 1 : 0);
} catch (e) {
  console.error("check failed:", e.message);
  if (cdp) cdp.close();
  edge.kill();
  process.exit(1);
}
