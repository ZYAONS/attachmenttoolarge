/* ==========================================================================
   att CLI 自检 —— 真的跑一遍，不看代码

   用法： node tools/cli-test.mjs

   覆盖：
     1. limits / info 的输出与编码膨胀复算
     2. split → 分片数、清单、脚本是否齐全
     3. join → 重组后 SHA-256 必须与原文件完全一致
     4. 分片损坏 / 缺失时，必须拒绝写出文件且返回非 0
     5. 「收件人双击还原」这个承诺：真的执行生成的 .ps1 与 .cmd
     6. ndr 能否把退信翻译成人话
     7. 网站上的上限表与 data/limits.json 是否对得上
   ========================================================================== */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, unlinkSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CLI = join(ROOT, "cli", "att.mjs");

let failed = 0, total = 0; let lastSizeProbe = "?";
const results = [];
function ok(name, pass, detail = "") {
  total++;
  if (!pass) failed++;
  results.push({ name, pass: !!pass, detail: String(detail) });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name.padEnd(34)} ${detail}`);
}

function att(args, opts = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", input: opts.input, cwd: opts.cwd || ROOT });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
/** 删除文件但不在乎它是否存在 */
const rm = (p) => { try { unlinkSync(p); } catch { /* 不存在就算了 */ } };

/* ---------- 准备一个有内容的测试文件 ---------- */
const work = mkdtempSync(join(tmpdir(), "att-test-"));
process.on("uncaughtException", (e) => {
  console.error("\n测试脚本异常：", e.message);
  try { rmSync(work, { recursive: true, force: true }); } catch { /* 忽略 */ }
  process.exit(1);
});

const SIZE = 5 * 1024 * 1024 + 12345;          // 5.01 MB → 用 2MB 上限切应得 3 片
const buf = Buffer.allocUnsafe(SIZE);
let seed = 20250918;
for (let i = 0; i < SIZE; i++) {              // 可复现的伪随机内容
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  buf[i] = seed & 0xff;
}
// 塞一段中文，顺便测 UTF-8 文件名的处理
writeFileSync(join(work, "报价单_最终版.bin"), buf);
const src = join(work, "报价单_最终版.bin");
const srcHash = sha(src);

// 再准备一个「24.7 MB」级别的大文件 —— 这正是网站上那个故事的体积，
// 用来验证 info 是否真的会算出「Outlook.com 发不出去」。
const BIG = Math.round(24.7 * 1024 * 1024);
const bigPath = join(work, "大文件.bin");
{
  const big = Buffer.alloc(BIG, 0x41);
  for (let i = 0; i < big.length; i += 4096) big[i] = i & 0xff;
  writeFileSync(bigPath, big);
}
console.log(`测试文件：${src}\n  大小 ${SIZE} 字节 · SHA-256 ${srcHash.slice(0, 16)}…`);
console.log(`参考文件：${bigPath}\n  大小 ${BIG} 字节（24.7 MB）\n`);

/* ---------- 1. limits ---------- */
console.log("=== 1. att limits ===");
{
  const r = att(["limits", "outlook.com"]);
  ok("limits 返回 0", r.code === 0, "exit=" + r.code);
  ok("limits 命中 Outlook.com 20 MB", /Outlook\.com/.test(r.out) && /20 MB/.test(r.out), r.out.split("\n").find((l) => /Outlook\.com/.test(l))?.trim().slice(0, 46));
  const rj = att(["limits", "--json"]);
  let parsed = null;
  try { parsed = JSON.parse(rj.out); } catch { /* 解析失败即断言失败 */ }
  ok("limits --json 可解析", !!parsed && Array.isArray(parsed.services) && parsed.services.length >= 5, parsed ? parsed.services.length + " 个服务商" : "解析失败");
}

/* ---------- 2. info ---------- */
console.log("\n=== 2. att info ===");
{
  const r = att(["info", src, "--json"]);
  let j = null;
  try { j = JSON.parse(r.out); } catch { /* ignore */ }
  ok("info --json 可解析", !!j, j ? `${j.bytes} → ${j.encodedBytes}` : "解析失败");
  ok("字节数正确", j && j.bytes === SIZE, j?.bytes);
  ok("编码膨胀在 30–40% 之间", j && j.overheadPercent >= 30 && j.overheadPercent <= 40, j ? j.overheadPercent + "%" : "-");
  ok("小文件在 20 MB 内判为可发", j && j.verdict.some((v) => v.id === "outlook.com" && v.fits === true), j ? "encoded=" + j.encodedHuman : "-");

  // 24.7 MB：这才是网站上那个故事的体积，应该被判「Outlook.com 发不出去」
  const rb = att(["info", bigPath, "--json"]);
  let jb = null;
  try { jb = JSON.parse(rb.out); } catch { /* ignore */ }
  ok("24.7 MB 文件被 Outlook.com 拒绝", jb && jb.verdict.some((v) => v.id === "outlook.com" && v.fits === false), jb ? jb.encodedHuman + " 编码后" : "解析失败");
  ok("同一文件仍可通过 35 MB 档", jb && jb.verdict.some((v) => v.id === "exchange-online" && v.fits === true), jb ? jb.verdict.filter((v) => v.fits).map((v) => v.id).join(",") : "-");
  const rbt = att(["info", bigPath]);
  ok("人话输出给出分片建议", /needs\s*2\s*shards/.test(rbt.out), rbt.out.match(/needs[^\n]*/)?.[0].trim() || "-");
  ok("人话输出附带 split 命令", /att split/.test(rbt.out), rbt.out.match(/att split[^\n]*/)?.[0].trim().slice(0, 46) || "-");
}

/* ---------- 3. split ---------- */
console.log("\n=== 3. att split ===");
{
  const r = att(["split", src, "--limit", "2MB", "--json"]);
  let j = null;
  try { j = JSON.parse(r.out); } catch { /* ignore */ }
  ok("split 返回 0", r.code === 0, "exit=" + r.code);
  ok("切成 3 片", j && j.shards.length === 3, j ? j.shards.length + " 片" : "解析失败");
  ok("清单文件已写出", j && existsSync(join(work, j.manifest)), j?.manifest);
  const files = readdirSync(work);
  ok("还原脚本三件套齐全",
    files.some((f) => f.endsWith(".ps1")) && files.some((f) => f.endsWith(".cmd")) && files.some((f) => f.endsWith(".sh")),
    files.filter((f) => f.includes("reassemble")).join(" / "));
  ok("分片字节数之和等于原文件",
    j && j.shards.reduce((a, s) => a + s.bytes, 0) === SIZE,
    j ? j.shards.map((s) => s.bytes).join(" + ") + " = " + j.shards.reduce((a, s) => a + s.bytes, 0) : "-");
}

/* ---------- 4. join ---------- */
console.log("\n=== 4. att join ===");
const manifestPath = join(work, "报价单_最终版.bin.att.json");
const joined = join(work, "重组结果.bin");
{
  const r = att(["join", manifestPath, "--out", joined]);
  ok("join 返回 0", r.code === 0, "exit=" + r.code);
  ok("重组结果存在", existsSync(joined), existsSync(joined) ? statSync(joined).size + " 字节" : "缺失");
  ok("SHA-256 与原文件一致", existsSync(joined) && sha(joined) === srcHash, existsSync(joined) ? sha(joined).slice(0, 16) + "…" : "-");
  ok("join --json 报告 ok", JSON.parse(att(["join", manifestPath, "--out", joined, "--force", "--json"]).out).ok === true);
}

/* ---------- 5. 容错：损坏与缺失必须拒绝 ---------- */
console.log("\n=== 5. 分片损坏 / 缺失 ===");
{
  const shard2 = readdirSync(work).find((f) => f.includes(".att-part-002"));
  const shardPath = join(work, shard2);
  const original = readFileSync(shardPath);
  const damaged = Buffer.from(original);
  damaged[100] ^= 0xff;
  writeFileSync(shardPath, damaged);

  rm(joined);
  const r = att(["join", manifestPath, "--out", joined]);
  ok("损坏分片时返回非 0", r.code === 1, "exit=" + r.code);
  ok("损坏时拒绝写出文件", !existsSync(joined), existsSync(joined) ? "竟然写出来了" : "未写出（正确）");
  ok("错误信息指出是哪一片", /corrupt/.test(r.err) && new RegExp(shard2.replace(/\./g, "\\.")).test(r.err), r.err.split("\n").find((l) => /corrupt/.test(l))?.trim().slice(0, 50) || "-");

  writeFileSync(shardPath, original);
  const r2 = att(["join", manifestPath, "--out", joined]);
  ok("恢复分片后可正常重组", r2.code === 0 && sha(joined) === srcHash, "exit=" + r2.code);

  const shard3 = join(work, readdirSync(work).find((f) => f.includes(".att-part-003")));
  const saved = readFileSync(shard3);
  rm(shard3);
  const r3 = att(["join", manifestPath, "--out", join(work, "不该存在.bin")]);
  ok("缺失分片时返回非 0 并提示", r3.code === 1 && /missing/.test(r3.err), r3.err.split("\n").find((l) => /missing/.test(l))?.trim().slice(0, 40) || "-");
  writeFileSync(shard3, saved);
}

/* ---------- 6. 收件人双击还原（真跑脚本） ---------- */
/* 这一段只在 Windows 上有意义：PowerShell 与 cmd.exe 是那两个脚本的运行环境。
   在 Linux/macOS 上改为断言脚本本身可执行且带哈希校验，否则 CI 会误报失败。 */
console.log("\n=== 6. 收件人双击还原 ===");
if (process.platform !== "win32") {
  const sh = readdirSync(work).find((f) => f.endsWith(".att-reassemble.sh"));
  const shText = readFileSync(join(work, sh), "utf8");
  ok("生成 .sh 还原脚本", !!sh && /sha256sum/.test(shText), sh);
  const r = spawnSync("sh", [sh], { encoding: "utf8", cwd: work, timeout: 120000 });
  ok("sh 脚本可独立还原并校验", r.status === 0 && existsSync(join(work, "报价单_最终版.bin")) && sha(join(work, "报价单_最终版.bin")) === srcHash,
     ((r.stdout || "").trim().split("\n").pop() || "exit=" + r.status).slice(0, 52));
  ok("本平台跳过 Windows 双击测试", true, process.platform);
} else {
{
  const ps1 = readdirSync(work).find((f) => f.endsWith(".att-reassemble.ps1"));
  const cmd = readdirSync(work).find((f) => f.endsWith(".att-reassemble.cmd"));
  const target = join(work, "报价单_最终版.bin");
  const goodHash = srcHash;

  rm(target);
  const ps = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(work, ps1)], { encoding: "utf8", cwd: work });
  ok("生成的 .ps1 可独立还原", existsSync(target) && sha(target) === goodHash, (ps.stdout || "").trim().split("\n").pop()?.slice(0, 52) || "exit=" + ps.status);

  rm(target);
  const cm = spawnSync("cmd.exe", ["/c", join(work, cmd)], { encoding: "utf8", cwd: work, input: "\r\n" });
  ok("生成的 .cmd 双击可还原", existsSync(target) && sha(target) === goodHash, ((cm.stdout || "").includes("Verified") ? "校验通过" : "exit=" + cm.status));

  const sh = readdirSync(work).find((f) => f.endsWith(".att-reassemble.sh"));
  const shText = readFileSync(join(work, sh), "utf8");
  ok("生成的 .sh 含哈希校验逻辑", /sha256sum/.test(shText) && /expected=/.test(shText), sh);
}
}

/* ---------- 7. ndr ---------- */
console.log("\n=== 7. att ndr ===");
const sampleNdr = `Delivery has failed to these recipients or groups:

buyer@example.com
The message you sent exceeds the maximum message size allowed by the recipient.
Remote Server returned '550 5.3.4 Message size exceeds fixed maximum message size'

Diagnostic information for administrators:
Generating server: EXCH01.contoso.com
Attachment size: 24.7 MB
Original message headers: ...
`;
writeFileSync(join(work, "退信.txt"), sampleNdr, "utf8");
{
  const r = att(["ndr", join(work, "退信.txt")]);
  ok("ndr 返回 0", r.code === 0, "exit=" + r.code);
  ok("识别出 550 5.3.4", /5\.3\.4/.test(r.out) && /your side/.test(r.out), r.out.includes("your side") ? "指出在你这一侧" : "-");
  ok("给出下一步动作", /att split/.test(r.out), r.out.match(/att split[^\n]*/)?.[0].trim().slice(0, 44) || "-");
  ok("提取出文中的体积", /24\.7 MB/.test(r.out), r.out.match(/Sizes mentioned[^\n]*/)?.[0].trim() || "-");

  const piped = att(["ndr", "-"], { input: "0x80040610 The message being sent exceeds the message size" });
  ok("支持从标准输入读", piped.code === 0 && /0x80040610/.test(piped.out), piped.out.match(/0x80040610[^\n]*/)?.[0].trim().slice(0, 40) || "-");

  const unknown = att(["ndr", "-"], { input: "something completely unrelated" });
  ok("认不出时给出求助渠道", /do not recognise/.test(unknown.out) && /hello@/.test(unknown.out), "提示发邮件给我们");
}

/* ---------- 8. 参数健壮性 ---------- */
console.log("\n=== 8. 参数与错误处理 ===");
{
  ok("空参数打印帮助", /Usage/.test(att([]).out), "att --help");
  ok("未知命令返回 2", att(["frobnicate"]).code === 2, "exit=" + att(["frobnicate"]).code);
  ok("不存在的文件报错非 0", att(["info", join(work, "没有这个文件.bin")]).code === 1, "exit=1");
  ok("非法 --limit 被拒绝", att(["split", src, "--limit", "banana"]).code === 1, "banana → 报错");
  ok("size 解析支持多种写法", (() => {
    const r = att(["split", src, "--limit", "1.5MB", "--json", "--out", join(work, "alt")]);
    try { lastSizeProbe = String(JSON.parse(r.out).limitBytes); return JSON.parse(r.out).limitBytes === Math.round(1.5 * 1024 * 1024); }
    catch { lastSizeProbe = "exit=" + r.code + " out=" + (r.out || r.err || "").trim().slice(0, 60); return false; }
  })(), "1.5MB → " + lastSizeProbe);
}

/* ---------- 9. 网站表格与 CLI 数据一致性 ---------- */
console.log("\n=== 9. 网站与 CLI 数据一致性 ===");
{
  const limits = JSON.parse(readFileSync(join(ROOT, "data", "limits.json"), "utf8"));
  const html = readFileSync(join(ROOT, "projects.html"), "utf8");
  const missing = limits.services
    .filter((s) => s.limitMB !== null && !s.minMB)
    .filter((s) => !new RegExp(`>\\s*${s.limitMB} MB\\s*<|>\\s*${s.limitMB}\\s*<`).test(html))
    .map((s) => `${s.id}=${s.limitMB}MB`);
  ok("projects.html 列出了 JSON 里的上限数", missing.length === 0, missing.length ? "缺失：" + missing.join(", ") : limits.services.filter((s) => s.limitMB && !s.minMB).length + " 个数字全部对得上");
  const range = limits.services.find((s) => s.minMB);
  ok("区间型上限也出现在页面上", !range || new RegExp(`${range.minMB}–${range.maxMB}`).test(html), range ? `${range.minMB}–${range.maxMB} MB` : "无区间项");
}

/* ---------- 收尾 ---------- */
rmSync(work, { recursive: true, force: true });

console.log(`\n共 ${total} 项检查，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
