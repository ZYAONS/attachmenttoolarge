/* 打印某个 Gradio 端点（含主生成端点 /__call__）的完整参数与输出签名
   用法： node tools/music-ai/probe-space.mjs --endpoint /__call__ */
const SPACE = "ace-step-ace-step.hf.space";
const BASE = `https://${SPACE}`;

const res = await fetch(`${BASE}/gradio_api/info`, { headers: { Accept: "application/json" } });
const info = await res.json();
const want = process.argv.includes("--endpoint") ? process.argv[process.argv.indexOf("--endpoint") + 1] : "/__call__";
const ep = (info.named_endpoints || {})[want];

if (!ep) {
  console.log("找不到端点", want, "· 现有：", Object.keys(info.named_endpoints || {}).join(" "));
  process.exit(1);
}

console.log(`=== ${want} ===`);
console.log("输入参数（按调用顺序）:");
(ep.parameters || []).forEach((p, i) => {
  const type = p.python_type?.type || p.annotation || "?";
  const def = JSON.stringify(p.parameter_default);
  console.log(`  ${String(i).padStart(2)}. ${String(p.parameter_name).padEnd(28)} ${String(type).slice(0, 46).padEnd(48)} 默认 ${def === undefined ? "-" : String(def).slice(0, 40)}`);
});
console.log("\n返回值:");
(ep.returns || []).forEach((r, i) => {
  console.log(`  ${i}. ${r.label || r.python_type?.type || r.component || JSON.stringify(r).slice(0, 80)}`);
});
