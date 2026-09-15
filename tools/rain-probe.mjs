#!/usr/bin/env node
/* ==========================================================================
   rain-probe.mjs — rain.js 到底有没有被加载、有没有被执行

   问三件事：
     1. rain.js 的 script 标签在不在，资源条目有没有（加载失败就没有）
     2. 把服务端那份 rain.js 抓下来，看内容和文件是否一致
     3. 手动执行一遍那份代码，看会不会生成 canvas（区分"代码有问题"和"没跑到"）
   ========================================================================== */
const PORT = process.argv[2] || "9334";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) { console.error("没有页面目标"); process.exit(1); }
console.log("目标：" + page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const waiting = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); w(m); }
});
await new Promise((r) => ws.addEventListener("open", r));
const send = (method, params) => new Promise((r) => { const mid = ++id; waiting.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params })); });
const evalJs = async (expression, awaitPromise = false) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  if (r.result && r.result.exceptionDetails) return { error: r.result.exceptionDetails.text };
  return r.result && r.result.result ? r.result.result.value : undefined;
};

console.log("\n1. 脚本与资源");
console.log("   " + await evalJs(`JSON.stringify({
  tag: !!document.querySelector('script[src="rain.js"]'),
  tagIndex: [...document.scripts].findIndex(s => (s.src||"").endsWith("rain.js")),
  resources: performance.getEntriesByType("resource").filter(r => /rain|game|content|music/.test(r.name))
    .map(r => r.name.split("/").pop() + ":" + Math.round(r.duration) + "ms:" + (r.transferSize||0) + "B"),
  canvases: document.querySelectorAll("canvas").length,
  rainHost: !!document.querySelector("[data-rain]")
}, null, 0)`));

console.log("\n2. 服务端那份 rain.js");
const served = await evalJs(`fetch("/game/rain.js").then(r => r.text()).then(t => t.length + " chars · first line: " + t.split("\\n")[0].slice(0,40))`, true);
console.log("   " + served);

console.log("\n3. 手动执行一遍");
const manual = await evalJs(`(async () => {
  const src = await (await fetch("/game/rain.js")).text();
  try {
    const fn = new Function(src);
    fn();
    return "执行成功 · 现在 canvas 数 = " + document.querySelectorAll("canvas").length;
  } catch (e) {
    return "执行抛错：" + (e && e.message ? e.message : String(e));
  }
})()`, true);
console.log("   " + manual);

ws.close();
