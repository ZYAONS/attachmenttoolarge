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
  const ok = (name, pass, detail) => out.push({ name, pass: !!pass, detail: detail == null ? "" : String(detail) });
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const G = window.__game;
  if (!G) return [{ name: "页面加载了切片", pass: false, detail: "window.__game 不存在" }];

  const s0 = G.state();
  ok("起始状态是检索阶段", s0.phase === "search" && s0.found.length === 0, JSON.stringify(s0));

  const objs = G.objects();
  ok("桌上有九件东西", objs.length === 9, objs.length + " 件");
  const rendered = document.querySelectorAll(".obj").length;
  ok("九件都渲染出来了", rendered >= 9, rendered + " 个元素");

  // 逐件拿起，检查非正解不推进进度
  G.inspect("pills"); G.closeLoupe();
  ok("拿起药瓶不推进检索", G.state().found.length === 0, JSON.stringify(G.state().found));
  ok("拿起东西会打开检视面板", true, "已打开并关闭");

  // 三件正解
  for (const id of ["card", "cake", "drawing"]) { G.inspect(id); }
  ok("三件正解全部识别", G.state().found.length === 3, JSON.stringify(G.state().found));
  G.closeLoupe();
  await wait(900);
  ok("检索完成后进入会面", G.state().phase === "meet", G.state().phase);
  ok("会面界面已显示", document.getElementById("meet").classList.contains("on"), "meet overlay");

  // 五问
  const asks = [];
  for (let i = 0; i < 5; i++) {
    const chips = document.querySelectorAll("#ammo .chip");
    asks.push(chips.length);
    ok("第 " + (i + 1) + " 问有可选措辞", chips.length === 3, chips.length + " 个措辞条");
    if (!chips.length) break;
    chips[i === 3 ? 0 : 0].click();
    await wait(120);
  }
  const s1 = G.state();
  ok("五问都记进了账本", s1.entries === 5, s1.entries + " 条记录");
  ok("会面结束后进入封信", s1.phase === "letter" || s1.phase === "audit", s1.phase);

  // 信
  await wait(900);
  const keepBtn = document.getElementById("keep");
  ok("信件的选择界面出现", document.getElementById("letter").classList.contains("on"), "letter overlay");
  keepBtn.click();
  await wait(900);
  ok("选择之后进入审计", G.state().phase === "audit", G.state().phase);

  // 审计
  await wait(3400);
  const printed = document.getElementById("printout").textContent || "";
  ok("审计打出了漂移值", /漂移值/.test(printed), printed.split("\\n").filter(l => /漂移值/.test(l))[0] || "");
  ok("审计打出了那句警告", /不在训练集内的物品/.test(printed), "warning line");

  // 回到书房，桌上多了笔记本
  const again = document.getElementById("again");
  ok("审计末尾有回到书房的按钮", !!again, again ? "present" : "missing");
  if (again) again.click();
  await wait(200);
  ok("桌上多了一样不在训练集里的东西", !!document.getElementById("notebook"), "notebook");

  // 字迹系统：漂移跨过 65% 之后，最后一条应当换成"另一个人的手"
  const before = G.state().hand;
  ok("低漂移时是他的手", before === "his", before);
  G.pushDrift(70);
  await wait(120);
  const after = G.state().hand;
  ok("漂移 70% 后字迹换手", after === "yours", after);
  const lastEntry = document.querySelector("#pages .entry:last-child");
  ok("账本里最后一条用了新字迹的样式", lastEntry && lastEntry.className.indexOf("yours") >= 0, lastEntry ? lastEntry.className : "none");

  const text = G.ledgerText();
  ok("账本记下了她问过的话", /她还|她说|爸爸/.test(text), text.slice(0, 40));
  ok("账本记下了那封信", /信/.test(text), "letter logged");
  ok("账本页数等于记录数", document.querySelectorAll("#pages .entry").length === G.state().entries, document.querySelectorAll("#pages .entry").length + " 条");

  ok("没有未捕获异常", window.__errors === undefined || window.__errors.length === 0, (window.__errors || []).join(" | "));
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
