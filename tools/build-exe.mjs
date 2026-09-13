/* ==========================================================================
   attachmenttoolarge — 把 att 打包成单个 Windows exe（Node SEA）

   原理：
     1. node --experimental-sea-config 把 cli/att.mjs 压成一个 blob
     2. 复制一份 node.exe 当外壳
     3. 用 postject 把 blob 注入进这份 node.exe（改动 NODE_SEA_FUSE 标记位）
     4. 跑一遍产物自检：--version / limits / 真实分片重组

   用法：
     node tools/build-exe.mjs                # 产出 dist/att.exe
     node tools/build-exe.mjs --no-verify    # 跳过产物自检
     node tools/build-exe.mjs --out dist/att-0.1.0-win-x64.exe

   说明：Node 的 SEA 只能产出「当前平台」的可执行文件，
   所以在 Windows 上构建得到 .exe，在 macOS 上得到对应的二进制。
   多平台产物由 .github/workflows/release.yml 在各平台 runner 上分别构建。
   ========================================================================== */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, writeFileSync, statSync, rmSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const has = (f) => args.includes("--" + f);
const val = (f, d) => {
  const i = args.indexOf("--" + f);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};

const isWin = process.platform === "win32";
const OUT = resolve(ROOT, val("out", join("dist", isWin ? "att.exe" : "att")));
const BUILD = join(ROOT, "build");
const BLOB = join(BUILD, "att.blob");
const SEA_CONFIG = join(BUILD, "sea-config.json");
const SENTINEL = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const NODE_BIN = process.execPath;

const c = (code, s) => (process.stdout.isTTY ? `\u001b[${code}m${s}\u001b[0m` : s);
const step = (n, s) => console.log(`${c(36, "[" + n + "]")} ${s}`);
const run = (cmd, argv, opts = {}) =>
  spawnSync(cmd, argv, { encoding: "utf8", cwd: ROOT, shell: false, ...opts });

/* ---------- 0. 前置检查 ---------- */
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
console.log("");
console.log(c(1, `构建 att ${pkg.version} · ${process.platform}-${process.arch} · Node ${process.version}`));
console.log("");

if (!existsSync(join(ROOT, "cli", "att.mjs"))) {
  console.error(c(31, "找不到 cli/att.mjs"));
  process.exit(1);
}

mkdirSync(BUILD, { recursive: true });
mkdirSync(dirname(OUT), { recursive: true });

/* ---------- 1. 准备 postject（SEA 注入器） ---------- */
step(1, "检查 postject");
const postjectBin = join(ROOT, "node_modules", "postject", "dist", "cli.js");
if (!existsSync(postjectBin)) {
  console.log("    本机没有 postject，正在用 npm 安装（仅作为开发依赖）…");

  // Windows 上不能直接 spawn npm.cmd（Node 18.20+ 对 .cmd/.bat 需要 shell），
  // 所以直接调用 npm 的 JS 入口，跨平台且不依赖 shell。
  const npmCli = join(dirname(NODE_BIN), "node_modules", "npm", "bin", "npm-cli.js");
  const npmArgs = ["install", "--no-audit", "--no-fund", "--save-dev", "postject"];
  const ins = existsSync(npmCli)
    ? run(NODE_BIN, [npmCli, ...npmArgs], { timeout: 180000 })
    : run(isWin ? "npm.cmd" : "npm", npmArgs, { shell: isWin, timeout: 180000 });

  if (ins.status !== 0 || !existsSync(postjectBin)) {
    console.error(c(31, "    安装 postject 失败："));
    console.error("    " + String(ins.error?.message || ins.stderr || ins.stdout || "（没有输出）").trim().split("\n").slice(-6).join("\n    "));
    console.error(c(2, "    可以手动执行： npm i -D postject"));
    process.exit(1);
  }
}
if (!existsSync(postjectBin)) {
  console.error(c(31, "    postject 仍不可用，构建中止。"));
  process.exit(1);
}
console.log(`    就绪 · ${postjectBin.replace(ROOT + (isWin ? "\\" : "/"), "")}`);

/* ---------- 2. 先把 ESM 的 CLI 打成单个 CJS 文件 ---------- */
step(2, "用 esbuild 把 cli/att.mjs 打成单文件 CJS");
let esbuild = null;
try {
  esbuild = await import("esbuild");
} catch {
  console.log("    本机没有 esbuild，正在安装（仅作为开发依赖）…");
  const npmCli2 = join(dirname(NODE_BIN), "node_modules", "npm", "bin", "npm-cli.js");
  const npmArgs2 = ["install", "--no-audit", "--no-fund", "--save-dev", "esbuild"];
  const ins2 = existsSync(npmCli2)
    ? run(NODE_BIN, [npmCli2, ...npmArgs2], { timeout: 300000 })
    : run(isWin ? "npm.cmd" : "npm", npmArgs2, { shell: isWin, timeout: 300000 });
  if (ins2.status !== 0) {
    console.error(c(31, "    安装 esbuild 失败："));
    console.error("    " + String(ins2.error?.message || ins2.stderr || ins2.stdout || "").trim().split("\n").slice(-4).join("\n    "));
    process.exit(1);
  }
  esbuild = await import("esbuild");
}

const LIMITS_JSON = readFileSync(join(ROOT, "data", "limits.json"), "utf8");
const BUNDLE = join(BUILD, "att.cjs");

await esbuild.build({
  entryPoints: [join(ROOT, "cli", "att.mjs")],
  outfile: BUNDLE,
  bundle: true,
  platform: "node",
  format: "cjs",            // SEA 只可靠地支持 CJS 入口
  target: "node18",
  legalComments: "none",
  logLevel: "warning",
  // 把上限数据内联进去：单文件 exe 旁边不会有 data/ 目录
  define: { __ATT_LIMITS__: LIMITS_JSON }
});
console.log(`    ${(statSync(BUNDLE).size / 1024).toFixed(1)} KB → build/att.cjs`);

/* ---------- 3. 生成 SEA blob ---------- */
step(3, "生成 SEA blob");
writeFileSync(SEA_CONFIG, JSON.stringify({
  main: "build/att.cjs",
  output: "build/att.blob",
  disableExperimentalSEAWarning: true
}, null, 2) + "\n", "utf8");

const blobRun = run(NODE_BIN, ["--experimental-sea-config", SEA_CONFIG]);
if (!existsSync(BLOB)) {
  console.error(c(31, "    blob 生成失败："));
  console.error("    " + (blobRun.stderr || blobRun.stdout || "").trim());
  process.exit(1);
}
console.log(`    ${(statSync(BLOB).size / 1024).toFixed(1)} KB → build/att.blob`);

/* ---------- 4. 复制 node 外壳 ---------- */
step(4, "复制 Node 运行时作为外壳");
rmSync(OUT, { force: true });
copyFileSync(NODE_BIN, OUT);
console.log(`    ${NODE_BIN}`);
console.log(`    → ${OUT.replace(ROOT + (isWin ? "\\" : "/"), "")}  ${(statSync(OUT).size / 1048576).toFixed(1)} MB`);

/* ---------- 5. 注入 ---------- */
step(5, "用 postject 注入 blob");
const inject = run(NODE_BIN, [
  postjectBin, OUT, "NODE_SEA_BLOB", BLOB,
  "--sentinel-fuse", SENTINEL
]);
if (inject.status !== 0) {
  console.error(c(31, "    注入失败："));
  console.error("    " + (inject.stderr || inject.stdout || "").trim().split("\n").slice(-6).join("\n    "));
  process.exit(1);
}
console.log("    完成");

/* ---------- 6. 产物自检 ---------- */
if (!has("no-verify")) {
  step(6, "产物自检（真的运行这个 exe）");
  const checks = [];

  const v = run(OUT, ["--version"]);
  checks.push(["att.exe --version", v.status === 0 && (v.stdout || "").trim() === pkg.version, (v.stdout || v.stderr || "").trim().split("\n")[0]]);

  const help = run(OUT, ["--help"]);
  checks.push(["att.exe --help", help.status === 0 && /Usage/.test(help.stdout || ""), "prints usage"]);

  const limits = run(OUT, ["limits", "outlook"]);
  checks.push(["att.exe limits outlook", limits.status === 0 && /20 MB/.test(limits.stdout || ""), (limits.stdout || "").match(/Outlook\.com\s+\S+\s+\S+/)?.[0]?.trim() || "—"]);

  // 真实的端到端：造一个 5 MB 文件，用 exe 分片再用 exe 重组，比对哈希
  const work = join(BUILD, "verify");
  mkdirSync(work, { recursive: true });
  const src = join(work, "报告_最终版.bin");
  const big = Buffer.alloc(5 * 1024 * 1024 + 4321);
  let seed = 7;
  for (let i = 0; i < big.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; big[i] = seed & 0xff; }
  writeFileSync(src, big);
  const srcHash = createHash("sha256").update(big).digest("hex");

  const sp = run(OUT, ["split", src, "--limit", "2MB", "--json"]);
  let spJson = null;
  try { spJson = JSON.parse(sp.stdout); } catch { /* 断言会失败 */ }
  checks.push(["att.exe split", sp.status === 0 && spJson?.shards?.length === 3, spJson ? `${spJson.shards.length} 片 · 上限 ${spJson.limitHuman}` : "失败"]);

  const outFile = join(work, "重组.bin");
  const jn = run(OUT, ["join", join(work, "报告_最终版.bin.att.json"), "--out", outFile, "--json"]);
  let jnJson = null;
  try { jnJson = JSON.parse(jn.stdout); } catch { /* 断言会失败 */ }
  const jnHash = existsSync(outFile) ? createHash("sha256").update(readFileSync(outFile)).digest("hex") : "";
  checks.push(["att.exe join 哈希一致", jn.status === 0 && jnHash === srcHash, jnHash ? jnHash.slice(0, 16) + "…" : "失败"]);

  const ndr = run(OUT, ["ndr", "-"], { input: "550 5.3.4 Message size exceeds fixed maximum message size" });
  checks.push(["att.exe ndr", ndr.status === 0 && /5\.3\.4/.test(ndr.stdout || ""), "识别 550 5.3.4"]);

  let failed = 0;
  for (const [name, pass, detail] of checks) {
    if (!pass) failed++;
    console.log(`    ${pass ? c(32, "PASS") : c(31, "FAIL")}  ${name.padEnd(26)} ${detail}`);
  }
  rmSync(work, { recursive: true, force: true });
  if (failed) {
    console.error(c(31, `\n产物自检失败 ${failed} 项，exe 可能不可用。`));
    process.exit(1);
  }
}

/* ---------- 6. 汇总 ---------- */
const size = statSync(OUT).size;
const exeHash = createHash("sha256").update(readFileSync(OUT)).digest("hex");
console.log("");
console.log(c(32, "✓ 构建完成"));
console.log(`  产物    ${OUT}`);
console.log(`  大小    ${(size / 1048576).toFixed(1)} MB（内含 Node 运行时，所以不小）`);
console.log(`  SHA-256 ${exeHash}`);
console.log("");
console.log(c(2, "  这个 exe 不需要目标机器安装 Node，双击或放进 PATH 即可用。"));
console.log(c(2, "  用法：att.exe info \"某个大文件.xlsx\""));
console.log("");
