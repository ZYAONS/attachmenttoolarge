#!/usr/bin/env node
/* ==========================================================================
   rain-errors.mjs — 让页面自己说出雨为什么没跑起来

   注入一段错误捕获 → 重载 → 读回所有未捕获异常与加载失败。
   用法： node tools/rain-errors.mjs 9333
   ========================================================================== */
const PORT = process.argv[2] || "9333";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) { console.error("没有页面目标"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const waiting = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); w(m); }
});
await new Promise((r) => ws.addEventListener("open", r));
const send = (method, params) => new Promise((r) => { const mid = ++id; waiting.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params })); });
const evalJs = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;

await send("Page.enable");
await send("Runtime.enable");

/* 在任何脚本之前埋下捕获器 —— 连"脚本自身加载失败"也抓得到 */
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    window.__errs = [];
    window.addEventListener("error", function (e) {
      if (e.target && e.target.tagName === "SCRIPT") {
        window.__errs.push("SCRIPT FAILED: " + (e.target.src || "inline"));
      } else {
        window.__errs.push((e.message || "error") + " @ " + (e.filename || "?") + ":" + (e.lineno || 0) + ":" + (e.colno || 0));
      }
    }, true);
    window.addEventListener("unhandledrejection", function (e) {
      window.__errs.push("REJECTION: " + (e.reason && e.reason.message ? e.reason.message : e.reason));
    });
  `
});

console.log("重载页面，抓异常…");
await send("Page.reload", { ignoreCache: true });
await new Promise((r) => setTimeout(r, 3500));

const errs = await evalJs("JSON.stringify(window.__errs || [])");
const state = await evalJs(`JSON.stringify({
  canvases: document.querySelectorAll("canvas").length,
  rainHostChildren: (document.querySelector("[data-rain]") || {}).children ? document.querySelector("[data-rain]").children.length : -1,
  scripts: [...document.scripts].map(s => (s.src || "inline").split("/").pop())
})`);

console.log("\n未捕获异常：");
let list2 = [];
try { list2 = JSON.parse(errs || "[]"); } catch (e) { list2 = [String(errs)]; }
if (!list2.length) console.log("  （没有）");
else list2.forEach((e) => console.log("  ✗ " + e));

console.log("\n页面状态：");
const st = JSON.parse(state || "{}");
for (const k of Object.keys(st)) console.log("  " + k.padEnd(16) + JSON.stringify(st[k]));

ws.close();
