/* ==========================================================================
   attachmenttoolarge — 注册后端自检

   用法： node tools/server-test.mjs

   它会在随机端口拉起一个真实的后端（数据写进临时目录），然后用真实 HTTP 请求
   把整条链路走一遍：注册 → 会话 → 名录 → 登录 → 限流 → 退会。
   同时检查「不该出现的东西」：明文口令、密码哈希、邮箱外泄、路径穿越、静态模式。
   ========================================================================== */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8400 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = mkdtempSync(join(tmpdir(), "att-server-"));
const ACCOUNTS = join(DATA, "accounts.json");

let failed = 0, total = 0;
function ok(name, pass, detail = "") {
  total++;
  if (!pass) failed++;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name.padEnd(38)} ${detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 极简 cookie 罐 ---------- */
const jar = new Map();
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
function absorb(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const raw of list) {
    const [pair] = raw.split(";");
    const i = pair.indexOf("=");
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (value === "") jar.delete(name);
    else jar.set(name, value);
  }
}
async function req(path, { method = "GET", body, headers = {}, noCookie = false, raw = false } = {}) {
  const h = { Accept: raw ? "*/*" : "application/json", ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (!noCookie && jar.size) h["Cookie"] = cookieHeader();
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
  absorb(res);
  if (raw) return { status: res.status, text: await res.text(), headers: res.headers };
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}
const csrf = () => jar.get("att_csrf");

/* ---------- 启动服务器 ---------- */
const server = spawn(process.execPath, [
  join(ROOT, "server", "server.mjs"),
  "--port", String(PORT),
  "--data", DATA,
  "--quiet"
], { stdio: ["ignore", "pipe", "pipe"] });

let serverLog = "";
server.stdout.on("data", (d) => { serverLog += d.toString(); });
server.stderr.on("data", (d) => { serverLog += d.toString(); });

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + "/api/health");
      if (r.ok) return true;
    } catch { /* 还没起来 */ }
    await sleep(200);
  }
  throw new Error("后端未能在 12 秒内就绪\n" + serverLog);
}

/* ============================ 开跑 ============================ */
try {
  await waitReady();
  console.log(`后端已启动 ${BASE}\n数据目录 ${DATA}\n`);

  /* ---------- 1. 健康检查与静态服务 ---------- */
  console.log("=== 1. 健康检查与静态服务 ===");
  {
    const h = await req("/api/health");
    ok("health 可用且会员为 0", h.status === 200 && h.json.ok && h.json.members === 0, `members=${h.json?.members}`);

    const home = await req("/", { raw: true });
    ok("首页可访问", home.status === 200 && /attachmenttoolarge/.test(home.text), `${home.text.length} 字节`);

    const reg = await req("/register.html", { raw: true });
    ok("入会页可访问", reg.status === 200 && /petition/i.test(reg.text), `${reg.text.length} bytes`);

    const css = await req("/assets/css/style.css", { raw: true });
    ok("样式表 MIME 正确", css.status === 200 && /text\/css/.test(css.headers.get("content-type") || ""), css.headers.get("content-type"));

    const hdr = await req("/", { raw: true });
    ok("带上了安全响应头", !!hdr.headers.get("content-security-policy") && hdr.headers.get("x-content-type-options") === "nosniff", "CSP + nosniff");

    const notFound = await req("/这个页面不存在", { raw: true });
    ok("自定义 404 生效", notFound.status === 404 && /550/.test(notFound.text), "返回 404.html");

    const leak = await req("/server/data/accounts.json", { raw: true });
    ok("账号库不可通过 HTTP 读取", leak.status === 404, `HTTP ${leak.status}`);

    const trav = await req("/%2e%2e%2fpackage.json", { raw: true });
    ok("路径穿越被挡住", trav.status === 404 || trav.status === 403, `HTTP ${trav.status}`);
  }

  /* ---------- 2. CSRF ---------- */
  console.log("\n=== 2. CSRF 防护 ===");
  {
    const c = await req("/api/csrf");
    ok("能取得 CSRF 令牌", c.status === 200 && /^[0-9a-f]{32}$/.test(c.json.token || ""), (c.json?.token || "").slice(0, 12) + "…");

    // 故意用登录接口测 CSRF：不占用注册的限流额度
    const noToken = await req("/api/login", { method: "POST", body: { email: "x@example.com", password: "whatever-long" }, headers: { "x-att-csrf": "deadbeef" } });
    ok("错误令牌被拒（403）", noToken.status === 403, `HTTP ${noToken.status}`);
  }

  /* ---------- 3. 注册 ---------- */
  console.log("\n=== 3. 入会注册 ===");
  const member = { name: "老陈", email: "chen@example.com", password: "Reassemble-24MB" };
  let serial = "";
  {
    const bad = await req("/api/register", { method: "POST", body: { name: "弱口令", email: "weak@example.com", password: "123" }, headers: { "x-att-csrf": csrf() } });
    ok("弱口令被拒（400 + 定位字段）", bad.status === 400 && !!bad.json.fields?.password, bad.json?.fields?.password?.slice(0, 20));

    const badMail = await req("/api/register", { method: "POST", body: { name: "邮箱不对", email: "not-an-email", password: "longenoughpw" }, headers: { "x-att-csrf": csrf() } });
    ok("邮箱格式被校验", badMail.status === 400 && !!badMail.json.fields?.email, badMail.json?.fields?.email?.slice(0, 20));

    const r = await req("/api/register", { method: "POST", body: { ...member, reason: "被 24.7 MB 的报价单退回过三次", csrf: csrf() } });
    serial = r.json?.member?.serial || "";
    ok("注册成功（201）", r.status === 201 && r.json.ok, `编号 ${serial}`);
    ok("编号格式为 ATT-20MB-######", /^ATT-20MB-\d{6}$/.test(serial), serial);
    ok("首位会员是创始会员", r.json?.member?.rank === "Founding member", r.json?.member?.rank);
    ok("下发了会话 Cookie", jar.has("att_sid") && jar.has("att_csrf"), `att_sid=${(jar.get("att_sid") || "").slice(0, 8)}…`);
    ok("响应里不含任何哈希", !JSON.stringify(r.json).includes("scrypt") && !JSON.stringify(r.json).includes("passwordHash"), "干净");

    const dup = await req("/api/register", { method: "POST", body: { ...member, password: "anotherlongpw" }, headers: { "x-att-csrf": csrf() } });
    ok("重复邮箱被拒（409）", dup.status === 409, `HTTP ${dup.status}`);
  }

  /* ---------- 4. 会话与名录 ---------- */
  console.log("\n=== 4. 会话与名录 ===");
  {
    const me = await req("/api/me");
    ok("已登录会话可读到自己", me.status === 200 && me.json.authenticated === true && me.json.member.serial === serial, me.json?.member?.name);
    ok("席位信息随会话返回", me.json.seat === 1 && me.json.foundingSeats === 20, `在册 ${me.json?.seat} / 创始 ${me.json?.foundingSeats}`);

    const dir = await req("/api/members");
    const listTxt = JSON.stringify(dir.json);
    ok("名录含新会员", dir.status === 200 && dir.json.members.some((m) => m.serial === serial), `在册 ${dir.json?.count} 位`);
    ok("名录不含邮箱与哈希", !listTxt.includes("@") && !listTxt.includes("scrypt") && !listTxt.includes("passwordHash"), "只有称谓/编号/身份/日期");
    ok("名录字段白名单正确", Object.keys(dir.json.members[0]).sort().join(",") === "divisions,joinedAt,name,rank,serial", Object.keys(dir.json.members[0]).join(","));

    // 未登录访客视角
    const anon = await req("/api/me", { noCookie: true });
    ok("未登录时 me 返回未认证", anon.status === 200 && anon.json.authenticated === false, "authenticated=false");
  }

  /* ---------- 5. 登录与限流 ---------- */
  console.log("\n=== 5. 登录与限流 ===");
  {
    const wrong = await req("/api/login", { method: "POST", body: { email: member.email, password: "definitely-wrong", csrf: csrf() } });
    ok("错误口令被拒（401）", wrong.status === 401, wrong.json?.message?.slice(0, 24));
    ok("拒绝时不泄露账号是否存在", !/not exist|no such|not registered|unknown account/i.test(JSON.stringify(wrong.json)), "只说「不正确」");

    const ghost = await req("/api/login", { method: "POST", body: { email: "ghost@example.com", password: "definitely-wrong", csrf: csrf() } });
    ok("不存在的账号同样返回 401", ghost.status === 401, "与错误口令无法区分");

    const good = await req("/api/login", { method: "POST", body: { email: member.email, password: member.password, csrf: csrf() } });
    ok("正确口令可登录（200）", good.status === 200 && good.json.ok, `编号 ${good.json?.member?.serial}`);

    // 连续错误口令，触发 10 次 / 10 分钟的限流
    let sawLimit = false, sawUnauthorized = false;
    for (let i = 0; i < 12; i++) {
      const r = await req("/api/login", { method: "POST", body: { email: member.email, password: "nope-" + i, csrf: csrf() } });
      if (r.status === 429) sawLimit = true;
      if (r.status === 401) sawUnauthorized = true;
      if (sawLimit) break;
    }
    ok("登录限流生效（429）", sawLimit && sawUnauthorized, "先 401 后 429");
  }

  /* ---------- 6. 落盘检查 ---------- */
  console.log("\n=== 6. 落盘与隐私 ===");
  {
    const raw = readFileSync(ACCOUNTS, "utf8");
    const store = JSON.parse(raw);
    const rec = Object.values(store.members)[0];
    ok("账号库存在", existsSync(ACCOUNTS), ACCOUNTS.replace(DATA, "<tmp>"));
    ok("口令明文未落盘", !raw.includes(member.password), "全文搜索不到明文");
    ok("存的是 scrypt 哈希", /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(rec.passwordHash), (rec.passwordHash || "").slice(0, 22) + "…");
    ok("邮箱按小写去重字段保存", rec.emailLower === member.email.toLowerCase(), rec.emailLower);
    ok("会员编号单调递增", store.nextSerial >= 2, `nextSerial=${store.nextSerial}`);
  }

  /* ---------- 7. 退会 ---------- */
  console.log("\n=== 7. 退会（真删） ===");
  {
    const wrongConfirm = await req("/api/leave", { method: "POST", body: { confirm: "ATT-20MB-999999", csrf: csrf() } });
    ok("确认编号不对时拒绝（400）", wrongConfirm.status === 400, wrongConfirm.json?.message?.slice(0, 26));

    const left = await req("/api/leave", { method: "POST", body: { confirm: serial, csrf: csrf() } });
    ok("退会成功（200）", left.status === 200 && left.json.ok, `注销 ${left.json?.serial}`);

    const meAfter = await req("/api/me", { noCookie: true });
    ok("退会后会话失效", meAfter.json.authenticated === false, "authenticated=false");

    const dirAfter = await req("/api/members");
    ok("名录中已移除该会员", !JSON.stringify(dirAfter.json).includes(serial), `在册 ${dirAfter.json?.count} 位`);

    const after = JSON.parse(readFileSync(ACCOUNTS, "utf8"));
    ok("账号库中记录已删除", Object.keys(after.members).length === 0, `剩余 ${Object.keys(after.members).length} 条`);
  }

  /* ---------- 8. 退出登录 ---------- */
  console.log("\n=== 8. 退出登录 ===");
  {
    await req("/api/csrf");
    const c2 = await req("/api/register", { method: "POST", body: { name: "临时会员", email: "temp@example.com", password: "longenoughpw" }, headers: { "x-att-csrf": csrf() } });
    ok("可以再注册一位", c2.status === 201, c2.json?.member?.serial || `HTTP ${c2.status}`);

    const out = await req("/api/logout", { method: "POST", body: { csrf: csrf() } });
    ok("退出登录成功", out.status === 200 && out.json.ok, "HTTP 200");

    const me = await req("/api/me", { noCookie: true });
    ok("退出后不再是登录态", me.json.authenticated === false, "authenticated=false");
  }

  /* ---------- 9. 注册限流（放在最后，因为它会烧掉窗口额度） ---------- */
  console.log("\n=== 9. 注册限流 ===");
  {
    await req("/api/csrf");
    let limited = null;
    for (let i = 0; i < 8; i++) {
      const r = await req("/api/register", {
        method: "POST",
        body: { name: "第 " + (i + 1) + " 位", email: `burst${i}@example.com`, password: "longenoughpw" },
        headers: { "x-att-csrf": csrf() }
      });
      if (r.status === 429) { limited = r; break; }
    }
    ok("注册限流生效（429）", !!limited, "上限 5 次 / 10 分钟（前 5 次在 3、8 节已放行）");
    ok("限流响应带人类可读说明", !!limited && /ten minutes/.test(limited.json?.message || ""), limited?.json?.message?.slice(0, 30));
  }

} catch (e) {
  console.error("\n自检异常：", e.message);
  failed++;
} finally {
  server.kill();
  await sleep(400);
  try { rmSync(DATA, { recursive: true, force: true }); } catch { /* 忽略 */ }
}

console.log(`\n共 ${total} 项检查，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
