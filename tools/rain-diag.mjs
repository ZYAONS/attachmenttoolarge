#!/usr/bin/env node
/* ==========================================================================
   rain-diag.mjs — 连进真实窗口，问清楚雨为什么没画出来

   用法：先带调试端口启动，再跑这个
     dist\understudy.exe --debug-port 9333
     node tools/rain-diag.mjs 9333
   ========================================================================== */
const PORT = process.argv[2] || "9333";

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) { console.error("没有页面目标"); process.exit(1); }
console.log("目标：" + page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const waiting = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  const w = waiting.get(m.id);
  if (w) { waiting.delete(m.id); w(m); }
});
await new Promise((r) => ws.addEventListener("open", r));
const send = (method, params) => new Promise((r) => { const mid = ++id; waiting.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params })); });

const EXPR = `(() => {
  const host = document.querySelector("[data-rain]");
  const c = host && host.querySelector("canvas");
  const out = {
    rainJsLoaded: typeof window !== "undefined",
    hostFound: !!host,
    hostCSS: host ? host.clientWidth + "x" + host.clientHeight : null,
    canvasFound: !!c,
    canvasPx: c ? c.width + "x" + c.height : null,
    dpr: window.devicePixelRatio,
    reduce: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    visibility: document.visibilityState,
    scripts: [...document.scripts].map(s => (s.src || "inline").split("/").pop())
  };
  if (c && c.width > 10) {
    const g = c.getContext("2d");
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let mn = 255, mx = 0, sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 29) {
      const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (v < mn) mn = v; if (v > mx) mx = v; sum += v; n++;
    }
    const mean = sum / n;
    let vari = 0;
    for (let i = 0; i < d.length; i += 4 * 29) {
      const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      vari += (v - mean) * (v - mean);
    }
    out.canvasLum = Math.round(mn) + "–" + Math.round(mx);
    out.canvasVariance = Math.round((vari / n) * 10) / 10;
    out.canvasSamples = n;
  }
  return out;
})()`;

const res = await send("Runtime.evaluate", { expression: EXPR, returnByValue: true });
const v = res.result && res.result.value;
if (!v) { console.error("取不到诊断结果：" + JSON.stringify(res).slice(0, 300)); process.exit(1); }
console.log("\n诊断：");
for (const k of Object.keys(v)) console.log("  " + k.padEnd(16) + JSON.stringify(v[k]));
console.log("\n结论：");
if (!v.canvasFound) console.log("  canvas 根本不存在 —— rain.js 没跑起来");
else if (!v.canvasPx || v.canvasPx.split("x")[0] < 10) console.log("  canvas 尺寸为 0 —— 容器在脚本运行时还没有布局");
else if (v.canvasVariance < 20) console.log("  canvas 有尺寸但是纯色 —— 只画了背景，没画水（很可能是 reduce 或首帧时机）");
else console.log("  canvas 上确实有内容（方差 " + v.canvasVariance + "）");
ws.close();
