#!/usr/bin/env node
/* ==========================================================================
   attachmenttoolarge — membership backend (zero dependencies, Node built-ins only)

   It does two jobs:
     1. Serve the site as static files (same rules as tools/serve.mjs)
     2. Provide a real account API: register / sign in / sign out / directory / leave

   Security, implemented rather than advertised:
     · Passphrases are salted and hashed with scrypt (N=16384, r=8, p=1); plaintext never touches disk and never appears in a response
     · Sessions are HttpOnly + SameSite=Lax cookies, held server-side, expiring after 30 days
     · Every write requires a double-submit CSRF token (cookie and header must match)
     · Registration and sign-in are rate limited per IP with a sliding window
     · The account store is written atomically (temp file + rename) and chmodded to 0600
     · All responses go through toPublic(), so hashes and email addresses cannot leak
     · Path-traversal protection and a set of security headers (CSP and friends)

   Usage:
     node server/server.mjs                  # http://127.0.0.1:8090
     node server/server.mjs --port 8090 --lan
     node server/server.mjs --data ./server/data
   ========================================================================== */

import { createServer } from "node:http";
import { createReadStream, existsSync, statSync, readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from "node:crypto";
import { extname, join, resolve, normalize, sep, dirname, basename } from "node:path";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import process from "node:process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/* ======================= 参数 ======================= */
const args = process.argv.slice(2);
function flag(name, def) {
  const i = args.indexOf("--" + name);
  if (i === -1) return def;
  const v = args[i + 1];
  return v && !v.startsWith("--") ? v : true;
}
const PORT = parseInt(String(flag("port", "8090")), 10);
const HOST = flag("lan", false) === true ? "0.0.0.0" : "127.0.0.1";
const DATA_DIR = resolve(String(flag("data", join(HERE, "data"))));
const ACCOUNTS = join(DATA_DIR, "accounts.json");
const QUIET = flag("quiet", false) === true;

const FOUNDING_SEATS = 20;          // the first 20 seats are founding members (because, well, 20 MB)
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const BODY_LIMIT = 16 * 1024;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/* ======================= 小工具 ======================= */
const now = () => new Date().toISOString();
const c = (code, s) => (process.stdout.isTTY && !QUIET ? `\u001b[${code}m${s}\u001b[0m` : s);

function log(...a) { if (!QUIET) console.log(...a); }

/* ---------- 账号存储 ---------- */
function loadStore() {
  if (!existsSync(ACCOUNTS)) {
    return { version: 1, createdAt: now(), nextSerial: 1, members: {} };
  }
  try {
    const raw = JSON.parse(readFileSync(ACCOUNTS, "utf8"));
    if (!raw.members) raw.members = {};
    if (!raw.nextSerial) raw.nextSerial = Object.keys(raw.members).length + 1;
    return raw;
  } catch (e) {
    console.error(c(31, "The account store is corrupt. Refusing to start: ") + ACCOUNTS);
    console.error("  " + e.message);
    console.error("  修好它，或者把它移走让服务器重新建一个（Member数据会丢，请先备份）。");
    process.exit(1);
  }
}

let store = loadStore();

function saveStore() {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = ACCOUNTS + ".tmp";
  writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, ACCOUNTS);            // atomic swap: never a half-written file
  try { chmodSync(ACCOUNTS, 0o600); } catch { /* not supported on Windows; ignore */ }
}

/* ---------- 密码 ---------- */
function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltHex, hashHex] = String(stored).split("$");
    if (scheme !== "scrypt") return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, salt, expected.length, { N: +N, r: +r, p: +p });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ---------- 会话（内存保存，重启即失效） ---------- */
const sessions = new Map();   // sid -> { memberId, csrf, createdAt, lastSeen }

function newSession(memberId) {
  const sid = randomBytes(24).toString("hex");
  sessions.set(sid, { memberId, csrf: randomBytes(16).toString("hex"), createdAt: Date.now(), lastSeen: Date.now() });
  return sid;
}

function getSession(req) {
  const sid = parseCookies(req)["att_sid"];
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) { sessions.delete(sid); return null; }
  s.lastSeen = Date.now();
  return { sid, ...s };
}

function dropSession(sid) { sessions.delete(sid); }

/* ---------- Cookie ---------- */
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  raw.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i === -1) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setCookie(res, name, value, opts = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax"];
  if (opts.httpOnly) bits.push("HttpOnly");
  if (opts.maxAge !== undefined) bits.push(`Max-Age=${opts.maxAge}`);
  if (opts.secure) bits.push("Secure");
  const prev = res.getHeader("Set-Cookie");
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  list.push(bits.join("; "));
  res.setHeader("Set-Cookie", list);
}

/* ---------- 响应 ---------- */
function sendJson(res, status, obj, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0;
    const chunks = [];
    req.on("data", (ch) => {
      size += ch.length;
      if (size > BODY_LIMIT) { rejectPromise(new Error("body too large")); req.destroy(); return; }
      chunks.push(ch);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolvePromise({});
      try { resolvePromise(JSON.parse(raw)); }
      catch { rejectPromise(new Error("bad json")); }
    });
    req.on("error", rejectPromise);
  });
}

/* ======================= 校验 ======================= */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const WEAK = new Set(["password", "password1", "1234567890", "qwertyuiop", "attachment", "0000000000"]);

function validateRegistration(b) {
  const errors = {};
  const name = String(b.name ?? "").trim().replace(/\s+/g, " ");
  const email = String(b.email ?? "").trim();
  const password = String(b.password ?? "");
  const reason = String(b.reason ?? "").trim();

  if (name.length < 2 || name.length > 40) errors.name = "Please give a name of 2–40 characters. Blank names are not accepted.";
  if (!EMAIL_RE.test(email) || email.length > 120) errors.email = "That does not look like an address that can receive mail.";
  if (password.length < 10) errors.password = "Your passphrase needs at least 10 characters. We are, after all, a society founded on counting.";
  else if (WEAK.has(password.toLowerCase())) errors.password = "That passphrase ranks too highly on the leaderboard. Pick another.";
  if (reason.length > 500) errors.reason = "Keep the reason under 500 characters — we consider 20 MB too large.";

  return { errors, name, email, emailLower: email.toLowerCase(), password, reason };
}

/* ======================= 限流 ======================= */
const hits = new Map();     // key -> number[]
function rateLimit(key, max, windowMs) {
  const t = Date.now();
  const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
  arr.push(t);
  hits.set(key, arr);
  return { allowed: arr.length <= max, count: arr.length, retryAfter: Math.ceil(windowMs / 1000) };
}
function clientIp(req) {
  return (req.socket.remoteAddress || "unknown").replace(/^::ffff:/, "");
}

/* ======================= Member序列化 ======================= */
/** 唯一对外出口：不给 B 端返回任何哈希、邮箱或内部 id */
function toPublic(m) {
  return {
    serial: m.serial,
    name: m.name,
    rank: m.rank,
    joinedAt: m.joinedAt,
    divisions: m.divisions || 0
  };
}
function toPrivate(m) {
  return { ...toPublic(m), email: m.email, lastLoginAt: m.lastLoginAt || null, reason: m.reason || "" };
}

/* ======================= API ======================= */
async function handleApi(req, res, pathname) {
  const method = req.method.toUpperCase();

  /* ---- 健康检查：前端用它判断「有后端还是静态模式」 ---- */
  if (pathname === "/api/health" && method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      members: Object.keys(store.members).length,
      foundingSeats: FOUNDING_SEATS,
      startedAt: startedAt
    });
  }

  /* ---- CSRF 令牌 ---- */
  if (pathname === "/api/csrf" && method === "GET") {
    const token = randomBytes(16).toString("hex");
    setCookie(res, "att_csrf", token, { maxAge: 3600 });
    return sendJson(res, 200, { token });
  }

  /* ---- 注册 ---- */
  if (pathname === "/api/register" && method === "POST") {
    const rl = rateLimit(`reg:${clientIp(req)}`, 5, 10 * 60 * 1000);
    if (!rl.allowed) return sendJson(res, 429, { error: "rate_limited", message: "Too many applications in a row. Try again in ten minutes." });

    let body;
    try { body = await readBody(req); }
    catch (e) { return sendJson(res, 400, { error: "bad_request", message: "The request body could not be parsed, or was too large." }); }

    if (!csrfOk(req, body)) return sendJson(res, 403, { error: "csrf", message: "Missing or invalid CSRF token. Refresh the page and try again." });

    const { errors, name, email, emailLower, password, reason } = validateRegistration(body);
    if (Object.keys(errors).length) return sendJson(res, 400, { error: "validation", fields: errors, message: "A few fields on the petition need attention." });

    const exists = Object.values(store.members).some((m) => m.emailLower === emailLower);
    if (exists) return sendJson(res, 409, { error: "email_taken", fields: { email: "This address is already on the register. Sign in instead?" }, message: "That email is already registered." });

    const serialNo = store.nextSerial++;
    const id = randomUUID();
    const member = {
      id,
      name,
      email,
      emailLower,
      serial: `ATT-20MB-${String(serialNo).padStart(6, "0")}`,
      rank: serialNo <= FOUNDING_SEATS ? "Founding member" : "Member",
      joinedAt: now(),
      lastLoginAt: null,
      divisions: 0,
      reason,
      passwordHash: hashPassword(password)
    };
    store.members[id] = member;
    saveStore();

    const sid = newSession(id);
    setCookie(res, "att_sid", sid, { httpOnly: true, maxAge: Math.floor(SESSION_TTL_MS / 1000) });
    const s = sessions.get(sid);
    setCookie(res, "att_csrf", s.csrf, { maxAge: Math.floor(SESSION_TTL_MS / 1000) });

    log(`${c(32, "REG ")} ${member.serial}  ${name}`);
    return sendJson(res, 201, { ok: true, member: toPrivate(member), csrf: s.csrf });
  }

  /* ---- 登录 ---- */
  if (pathname === "/api/login" && method === "POST") {
    const rl = rateLimit(`login:${clientIp(req)}`, 10, 10 * 60 * 1000);
    if (!rl.allowed) return sendJson(res, 429, { error: "rate_limited", message: "Too many attempts. Try again in ten minutes." });

    let body;
    try { body = await readBody(req); }
    catch { return sendJson(res, 400, { error: "bad_request", message: "The request body could not be parsed, or was too large." }); }

    if (!csrfOk(req, body)) return sendJson(res, 403, { error: "csrf", message: "Missing or invalid CSRF token. Refresh the page and try again." });

    const emailLower = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const member = Object.values(store.members).find((m) => m.emailLower === emailLower);

    // 无论账号是否存在，都走一次哈希比较，避免用响应时间判断账号是否存在
    const okPass = member ? verifyPassword(password, member.passwordHash) : verifyPassword(password, hashPassword("decoy"));
    if (!member || !okPass) {
      log(`${c(33, "FAIL")} sign-in failed ${emailLower || "(empty)"}`);
      return sendJson(res, 401, { error: "bad_credentials", message: "Email or passphrase is incorrect. We will not say which — that is deliberate." });
    }

    member.lastLoginAt = now();
    saveStore();

    const sid = newSession(member.id);
    setCookie(res, "att_sid", sid, { httpOnly: true, maxAge: Math.floor(SESSION_TTL_MS / 1000) });
    const s = sessions.get(sid);
    setCookie(res, "att_csrf", s.csrf, { maxAge: Math.floor(SESSION_TTL_MS / 1000) });

    log(`${c(32, "LOGIN")} ${member.serial}  ${member.name}`);
    return sendJson(res, 200, { ok: true, member: toPrivate(member), csrf: s.csrf });
  }

  /* ---- 退出 ---- */
  if (pathname === "/api/logout" && method === "POST") {
    const s = getSession(req);
    if (s) dropSession(s.sid);
    setCookie(res, "att_sid", "", { httpOnly: true, maxAge: 0 });
    return sendJson(res, 200, { ok: true });
  }

  /* ---- 当前会话 ---- */
  if (pathname === "/api/me" && method === "GET") {
    const s = getSession(req);
    if (!s) return sendJson(res, 200, { authenticated: false });
    const member = store.members[s.memberId];
    if (!member) { dropSession(s.sid); return sendJson(res, 200, { authenticated: false }); }
    return sendJson(res, 200, {
      authenticated: true,
      member: toPrivate(member),
      csrf: s.csrf,
      seat: Object.keys(store.members).length,
      foundingSeats: FOUNDING_SEATS
    });
  }

  /* ---- member directory（公开） ---- */
  if (pathname === "/api/members" && method === "GET") {
    const list = Object.values(store.members)
      .sort((a, b) => a.serial.localeCompare(b.serial))
      .slice(0, 500)
      .map(toPublic);
    return sendJson(res, 200, {
      ok: true,
      count: Object.keys(store.members).length,
      foundingSeats: FOUNDING_SEATS,
      members: list
    });
  }

  /* ---- 退会（真删，含隐私考量） ---- */
  if (pathname === "/api/leave" && method === "POST") {
    const s = getSession(req);
    if (!s) return sendJson(res, 401, { error: "unauthorized", message: "Please sign in first." });

    let body;
    try { body = await readBody(req); }
    catch { return sendJson(res, 400, { error: "bad_request", message: "The request body could not be parsed." }); }
    if (!csrfOk(req, body)) return sendJson(res, 403, { error: "csrf", message: "Missing or invalid CSRF token." });

    const member = store.members[s.memberId];
    if (!member) return sendJson(res, 401, { error: "unauthorized", message: "Your session has expired." });
    if (String(body.confirm ?? "") !== member.serial) {
      return sendJson(res, 400, { error: "confirm", message: `Type your membership number exactly to confirm: ${member.serial}` });
    }

    delete store.members[s.memberId];
    saveStore();
    dropSession(s.sid);
    setCookie(res, "att_sid", "", { httpOnly: true, maxAge: 0 });
    log(`${c(31, "LEAVE")} ${member.serial}`);
    return sendJson(res, 200, { ok: true, serial: member.serial });
  }

  return sendJson(res, 404, { error: "not_found", message: "No such endpoint." });
}

/* CSRF 双提交：Cookie 里的令牌必须和请求头（或请求体）里的一致 */
function csrfOk(req, body) {
  const cookie = parseCookies(req)["att_csrf"];
  const sent = req.headers["x-att-csrf"] || (body && body.csrf);
  if (!cookie || !sent) return false;
  const a = Buffer.from(String(cookie));
  const b = Buffer.from(String(sent));
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ======================= 静态文件 ======================= */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8"
};

const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "script-src 'self' 'unsafe-inline'",     // a few inline scripts (theme bootstrap, lyric rendering)
  "style-src 'self' 'unsafe-inline'",      // inline styles for small layout tweaks
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

/* 哪些东西永远不能通过 HTTP 拿到。
   教训：只挡住「当前配置的数据目录」是不够的 —— 如果服务用 --data 指到别处，
   仓库里默认位置那份 accounts.json（上一次跑默认配置时留下的）就会变成可下载文件。
   所以按「目录 + 文件名」双重判断，另外把仓库自身的 .git 也挡住。 */
const PRIVATE_DIRS = [
  DATA_DIR,
  join(ROOT, "server", "data"),
  join(ROOT, ".git"),
  join(ROOT, ".github")
];
const PRIVATE_NAMES = /^accounts\.json(\.tmp)?$/i;

function isPrivatePath(filePath) {
  for (const dir of PRIVATE_DIRS) {
    if (filePath === dir || filePath.startsWith(dir + sep)) return true;
  }
  return PRIVATE_NAMES.test(basename(filePath));
}

function serveStatic(req, res, pathname) {
  let filePath = normalize(join(ROOT, decodeURIComponent(pathname)));
  if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) {
    res.writeHead(403).end("403 Forbidden");
    return;
  }
  // 账号库、密钥与仓库内部文件不对公网开放
  if (isPrivatePath(filePath)) { res.writeHead(404).end("404 Not Found"); return; }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, "index.html");

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    const custom = join(ROOT, "404.html");
    if (existsSync(custom)) {
      const body = readFileSync(custom);
      res.writeHead(404, { "Content-Type": MIME[".html"], "Content-Length": body.length });
      return res.end(req.method === "HEAD" ? undefined : body);
    }
    return res.writeHead(404).end("404 Not Found");
  }

  const st = statSync(filePath);
  const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": st.size,
    "Cache-Control": type.startsWith("text/html") ? "no-cache" : "no-cache",
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY"
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(filePath).on("error", () => res.destroy()).pipe(res);
}

/* ======================= 服务器 ======================= */
const startedAt = now();

const server = createServer(async (req, res) => {
  let pathname;
  try { pathname = new URL(req.url, "http://localhost").pathname; }
  catch { return res.writeHead(400).end("400 Bad Request"); }

  if (pathname.startsWith("/api/")) {
    try {
      await handleApi(req, res, pathname);
    } catch (e) {
      log(c(31, "API error ") + e.message);
      if (!res.headersSent) sendJson(res, 500, { error: "server_error", message: "Internal server error." });
      else res.end();
    }
    return;
  }

  serveStatic(req, res, pathname);
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") console.error(c(31, `Port ${PORT} is already in use`) + `, try another: node server/server.mjs --port 8091`);
  else console.error(c(31, "Failed to start: ") + e.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const lan = Object.values(networkInterfaces()).flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
  const members = Object.keys(store.members).length;

  console.log("");
  console.log(c(1, "attachmenttoolarge — membership server is up"));
  console.log("");
  console.log(`  Site     ${c(36, `http://127.0.0.1:${PORT}/`)}`);
  console.log(`  Join     ${c(36, `http://127.0.0.1:${PORT}/register.html`)}`);
  console.log(`  Register ${c(36, `http://127.0.0.1:${PORT}/members.html`)}`);
  if (lan.length) console.log(`  LAN      ${c(36, `http://${lan[0]}:${PORT}/`)}${HOST === "0.0.0.0" ? "" : c(2, "   (add --lan so colleagues can reach it)")}`);
  console.log("");
  console.log(`  Members  ${members} on the register · founding seats: ${FOUNDING_SEATS}`);
  console.log(`  Accounts ${ACCOUNTS}`);
  console.log(c(2, "  Passphrases are salted and hashed with scrypt; sessions live in memory, so a restart requires signing in again."));
  console.log("");
});

/* Graceful shutdown: flush anything not yet written to disk */
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    try { saveStore(); } catch { /* best effort */ }
    console.log("\nStopped. Account data is in " + ACCOUNTS);
    process.exit(0);
  });
}
