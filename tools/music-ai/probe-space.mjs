/* 探测 Hugging Face Space 的 Gradio HTTP API 表面（只读，不生成、不下载模型）
   用法： node tools/music-ai/probe-space.mjs [space-subdomain] */
const SPACE = process.argv[2] || "ace-step-ace-step.hf.space";
const BASE = `https://${SPACE}`;

async function getJson(path) {
  const res = await fetch(BASE + path, { headers: { Accept: "application/json" } });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, json: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, text: text.slice(0, 300) }; }
}

const info = await getJson("/gradio_api/info");
console.log("=== /gradio_api/info ===", info.status);
if (info.json) {
  const named = info.json.named_endpoints || {};
  for (const [name, ep] of Object.entries(named)) {
    console.log(`  端点 ${name}  (参数 ${ep.parameters?.length ?? "?"} 个)`);
    (ep.parameters || []).forEach((p) => console.log(`      - ${p.parameter_name}: ${p.python_type?.type || p.annotation || ""}`));
  }
  if (!Object.keys(named).length) console.log("  （无命名端点，看下面的 dependencies）");
} else {
  console.log("  非 JSON:", info.text);
}

const cfg = await getJson("/config");
if (!cfg.json) {
  console.log("=== /config 不可读 ===", cfg.status, cfg.text);
  process.exit(1);
}

const components = {};
(cfg.json.components || []).forEach((c) => { components[c.id] = c; });

console.log("\n=== 可调用端点（dependencies）===");
let listed = 0;
for (const d of cfg.json.dependencies || []) {
  const api = d.api_name;
  if (!api || d.api_visibility === "private" || api === false) continue;
  if (d.targets && d.targets.length && d.targets[0] !== null && d.targets[0] !== undefined && !api) continue;
  listed++;
  const ins = (d.inputs || []).map((id) => {
    const c = components[id];
    return c ? `${c.type}${c.props?.label ? "(" + c.props.label + ")" : ""}` : id;
  });
  const outs = (d.outputs || []).map((id) => components[id]?.type || id);
  console.log(`  [${d.id}] ${api}`);
  console.log(`        输入: ${ins.join(", ")}`);
  console.log(`        输出: ${outs.join(", ")}`);
}
if (!listed) console.log("  （没有公开端点）");

console.log("\n=== Space 运行状态 ===");
const host = await getJson("/");
console.log("  GET / →", host.status, host.json ? "JSON" : (host.text || "").slice(0, 80).replace(/\s+/g, " "));
