#!/usr/bin/env node
/* ==========================================================================
   attachmenttoolarge — 界面文案英文化（一次性迁移脚本，可以重复运行）

   为什么用字典而不是手改：字符串散落在 3 个文件里，手改容易漏；字典脚本
   能在改完后立刻报告「还剩哪些中文」，把遗漏变成可验证的输出。

   用法： node tools/i18n-en.mjs          （干跑，只报告）
          node tools/i18n-en.mjs --write  （真的写入）
   ========================================================================== */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WRITE = process.argv.includes("--write");

const MAP = {
  /* ---------------- assets/js/auth.js ---------------- */
  "无法取得 CSRF 令牌": "Could not obtain a CSRF token",
  " 年 ": " ", " 月 ": "-", " 日": "",
  '"创始会员"': '"Founding member"',
  "创始会员": "Founding member",
  "会员": "Member",
  "<dt>称谓</dt>": "<dt>Name</dt>",
  "<dt>身份</dt>": "<dt>Standing</dt>",
  " · 前 20 席": " · first 20 seats",
  "<dt>入会日期</dt>": "<dt>Joined</dt>",
  "<dt>会员编号</dt>": "<dt>Membership no.</dt>",
  "<dt>通信邮箱</dt>": "<dt>Email</dt>",
  "<dt>已分片</dt>": "<dt>Shards cut</dt>",
  " 个附件": " attachments",
  '"静态模式 · 无后端"': '"Static mode · no backend"',
  '"已连接后端"': '"Backend connected"',
  "口令至少 10 位。": "Your passphrase needs at least 10 characters.",
  "两次输入的口令不一致。": "The two passphrases do not match.",
  '"递交中…"': '"Submitting…"',
  '"正在递交申请书…"': '"Submitting your petition…"',
  '"创始人席位："': '"Founding seats: "',
  ' + " 个"': ' + ""',
  '"已入册。你的编号是 "': '"You are on the register. Your number is "',
  '"申请未通过，请检查填写内容。"': '"The application was not accepted. Please review the form."',
  '"无法连接后端。请确认服务器在运行（node server/server.mjs）。"': '"Cannot reach the backend. Make sure the server is running: node server/server.mjs"',
  '"递交申请书"': '"Submit petition"',
  '"核验中…"': '"Verifying…"',
  '"正在核验…"': '"Verifying…"',
  '"登录失败。"': '"Sign-in failed."',
  '"无法连接后端。请确认服务器在运行。"': '"Cannot reach the backend. Make sure the server is running."',
  '"登录"': '"Sign in"',
  "<b>尚未登录</b>": "<b>Not signed in</b>",
  "'会员证只发给在册会员。若你还没入会，请先<a href=\"register.html\" style=\"color:var(--accent)\">递交申请书</a>；'": "'A card is only issued to members on the register. Not a member yet? <a href=\"register.html\" style=\"color:var(--accent)\">Submit a petition</a>;'",
  "'已有编号的话，<a href=\"login.html\" style=\"color:var(--accent)\">到这里登录</a>。</div></div>'": "'if you already have a number, <a href=\"login.html\" style=\"color:var(--accent)\">sign in here</a>.</div></div>'",
  '"在册席位 "': '"Members on the register: "',
  ' + " / 创始席位 "': ' + " / founding seats: "',
  '"确认退会？这会从服务器上真正删除你的会员记录，无法撤回。"': '"Leave the society? This permanently deletes your membership record on the server. It cannot be undone."',
  '"已退会，编号 "': '"You have left. Number "',
  '" 已注销。感谢你来过。"': '" is now void. Thank you for having been here."',
  '"退会失败。"': '"Could not leave the society."',
  "<b>连不上后端</b>会员证需要后端服务。启动方式：": "<b>Backend unreachable</b>A membership card needs the backend. Start it with:",
  "名录还是空的 —— 你会是第一位会员。": "The register is still empty — you would be its first member.",
  "在册 ' + data.count + ' 位；名录只展示称谓与编号，不含任何邮箱或口令信息。": "on the register: ' + data.count + '. The directory shows names and numbers only — never email addresses or passphrases.",
  "<b>名录需要后端</b>": "<b>The directory needs the backend</b>",
  "'当前是静态模式（例如 GitHub Pages），浏览器无法直接读账号库。'": "'This is static mode (GitHub Pages, for example): a browser cannot read the account store directly. '",
  "'在本机运行 <code>node server/server.mjs</code> 后再打开这一页即可看到真实名录。</div></div>'": "'Run <code>node server/server.mjs</code> locally and reopen this page to see the real register.</div></div>'",

  /* ---------------- server/server.mjs ---------------- */
  '"账号文件损坏，拒绝启动："': '"The account store is corrupt. Refusing to start: "',
  '"  修好它，或者把它移走让服务器重新建一个（会员数据会丢，请先备份）。"': '"  Repair it, or move it aside so the server creates a new one (member data will be lost — back it up first)."',
  '"称谓请填 2–40 个字符。顺便，我们不接受空白称谓。"': '"Please give a name of 2–40 characters. Blank names are not accepted."',
  '"这个邮箱地址看起来不像能收信的。"': '"That does not look like an address that can receive mail."',
  '"口令至少 10 位。毕竟我们是靠统计「猜密码」起家的组织。"': '"A passphrase of at least 10 characters. We are, after all, a society founded on counting."',
  '"这个口令在排行榜上太靠前了，换一个。"': '"That passphrase ranks too highly on the leaderboard. Pick another."',
  '"入会理由请控制在 500 字内 —— 我们连 20 MB 都嫌大。"': '"Keep the reason under 500 characters — we consider 20 MB too large."',
  '"注册申请太密集了，请十分钟后再试。"': '"Too many applications in a row. Try again in ten minutes."',
  '"请求体无法解析或过大。"': '"The request body could not be parsed, or was too large."',
  '"缺少或错误的 CSRF 令牌，请刷新页面重试。"': '"Missing or invalid CSRF token. Refresh the page and try again."',
  '"申请书上有几处需要修改。"': '"A few fields on the petition need attention."',
  '"这个邮箱已经在册了。要去登录吗？"': '"This address is already on the register. Sign in instead?"',
  '"该邮箱已注册。"': '"That email is already registered."',
  '"尝试次数过多，请十分钟后再试。"': '"Too many attempts. Try again in ten minutes."',
  '"缺少或错误的 CSRF 令牌。"': '"Missing or invalid CSRF token."',
  '"邮箱或口令不正确。我们不会告诉你是哪一个 —— 这是有意的。"': '"Email or passphrase is incorrect. We will not say which — that is deliberate."',
  '"请先登录。"': '"Please sign in first."',
  '"会话已失效。"': '"Your session has expired."',
  '"请求体无法解析。"': '"The request body could not be parsed."',
  '"没有这个接口。"': '"No such endpoint."',
  '"服务器内部错误。"': '"Internal server error."',
  '"API 错误 "': '"API error "',
  '"启动失败："': '"Failed to start: "',
  '"attachmenttoolarge — 入会注册服务已启动"': '"attachmenttoolarge — membership server is up"',
  '"  局域网   "': '"  LAN      "',
  '"   （加 --lan 后同事才能访问）"': '"   (add --lan so colleagues can reach it)"',
  '"  密码用 scrypt 加盐哈希；会话在内存里，重启服务器需要重新登录。"': '"  Passphrases are salted and hashed with scrypt; sessions live in memory, so a restart requires signing in again."',
  '"\\n已停止。账号数据在 "': '"\\nStopped. Account data is in "',
  '"  站点     "': '"  Site     "',
  '"  入会     "': '"  Join     "',
  '"  名录     "': '"  Register "',
  '"  在册会员 "': '"  Members  "',
  ' 位 · 创始席位 ': ' on the register · founding seats: ',
  ' 个"': ' seats"',
  '"  账号文件 "': '"  Accounts "',
  "`端口 ${PORT} 已被占用`": "`Port ${PORT} is already in use`",
  "`，换一个：node server/server.mjs --port 8091`": "`, try another: node server/server.mjs --port 8091`",

  /* ---------------- data/limits.json ---------------- */
  "各邮件服务商的附件上限。limitMB 为 1024 进制（与多数客户端一致）。产品默认值会变，请以官方文档与实测为准。":
    "Attachment limits per mail service. limitMB is binary (1024-based), matching what most clients show. Product defaults change; confirm against official documentation and your own measurements.",
  "超出后提示「改为发送共享链接」，也就是 attachmenttoolarge 这个站名的来历。":
    "Above this it suggests sending a share link instead — the phrase this site is named after.",
  "客户端本身不设限，你撞上的是服务器或网关的上限。":
    "The client itself sets no limit — what you hit is the server or a gateway.",
  "整封邮件": "whole message",
  "附件": "attachment",
  "组织默认值，管理员可调整；入站与出站可以是两个不同的值。":
    "The organisation default; administrators can change it, and inbound may differ from outbound.",
  "十几年前的默认值，至今仍活在大量内网服务器上，因为没人敢动它。":
    "A default from the mid-2000s still alive on plenty of internal servers, because nobody dares touch it.",
  "不设限": "no limit",
  "企业 SMTP 网关（典型区间）": "Corporate SMTP gateway (typical range)",
  "通常是最先被撞上的那一层，也是最难查到的一层。":
    "Usually the first wall you hit, and the hardest one to find.",
  "Gmail（参照组）": "Gmail (reference)",
  "收录原因：用来校准我们的情绪。": "Included for calibration of our own feelings.",
  "QQ 邮箱（参照组）": "QQ Mail (reference)",
  "中文互联网的宽松角落，提醒我们世界并不统一。":
    "The generous corner of the Chinese internet, reminding us the world is not uniform.",
  "Outlook 桌面客户端": "Outlook desktop client",
  "本地 Exchange（出厂默认）": "On-premises Exchange (factory default)",
  "Exchange Online（Microsoft 365 默认）": "Exchange Online (Microsoft 365 default)",

  /* ---------------- 会员证落款（auth.js 里渲染的印章文字） ---------------- */
  "兹证明上述人士为本组织在册会员，<br>享有查阅上限数据库与吐槽 20 MB 之权利。":
    "Hereby certifies that the above is a member on the register,<br>entitled to consult the limits database and to complain about 20 MB.",
  "兹证明上述人士为本组织在册会员，": "Hereby certifies that the above is a member on the register, ",
  "享有查阅上限数据库与吐槽 20 MB 之权利。": "entitled to consult the limits database and to complain about 20 MB."
};

/* 第二遍：修正第一遍里被短词条切碎的混合字符串，并清掉剩余的注释。
   教训：替换必须「长串优先」，否则「会员」会先把整句切碎。 */
const MAP2 = {
  /* --- auth.js --- */
  'var API = "";                 // 与站点同源': 'var API = "";                 // same origin as the site',
  "'<h2>Member证</h2>' +": "'<h2>Membership card</h2>' +",
  '\'<div class="member-field"><dt>Member编号</dt><dd class="mono">\' +':
    '\'<div class="member-field"><dt>Membership no.</dt><dd class="mono">\' +',
  '\'兹证明上述人士为本组织在册Member，<br>entitled to consult the limits database and to complain about 20 MB.\' +':
    '\'Hereby certifies that the above is a member on the register,<br>\' +\n          \'entitled to consult the limits database and to complain about 20 MB.\' +',
  '\'Member证只发给在册Member。若你还没入会，请先<a href="register.html" style="color:var(--accent)">递交申请书</a>；\' +':
    '\'A card is issued only to members on the register. Not a member yet? \' +\n            \'<a href="register.html" style="color:var(--accent)">Submit a petition</a>; \' +',
  '"确认退会？这会从服务器上真正删除你的Member记录，无法撤回。"':
    '"Leave the society? This permanently deletes your membership record on the server and cannot be undone."',
  '\'<div class="callout callout-warn"><div><b>连不上后端</b>Member证需要后端服务。启动方式：\' +':
    '\'<div class="callout callout-warn"><div><b>Backend unreachable</b> A membership card needs the backend. Start it with: \' +',
  '\'<div class="callout"><div>名录还是空的 —— 你会是第一位Member。</div></div>\'':
    '\'<div class="callout"><div>The register is still empty — you would be its first member.</div></div>\'',
  '\'<thead><tr><th>Member编号</th><th>称谓</th><th>身份</th><th>入会日期</th></tr></thead>\' +':
    '\'<thead><tr><th>No.</th><th>Name</th><th>Standing</th><th>Joined</th></tr></thead>\' +',
  "attachmenttoolarge — 入会 / 登录前端": "attachmenttoolarge — membership: join and sign-in front end",
  "与 server/server.mjs 的真实 API 对接；没有后端时进入「静态模式」并如实说明。":
    "Talks to the real API in server/server.mjs; when there is no backend it falls back to static mode and says so.",
  "页面挂钩（写在 HTML 上即可，无需额外初始化代码）：":
    "Page hooks (declare them in the HTML; no extra init code needed):",
  "  入会申请": "  membership application",
  "  登录": "  sign in",
  "Member证区域（自动判断有没有登录）": "membership card area (detects sign-in state)",
  "Member名录": "member directory",
  "  退会": "  leave the society",
  "静态模式下才显示的提示块": "notice shown only in static mode",

  /* --- server/server.mjs --- */
  "attachmenttoolarge — 入会注册后端  (零依赖，只用 Node 内置模块)":
    "attachmenttoolarge — membership backend (zero dependencies, Node built-ins only)",
  "它同时做两件事：": "It does two jobs:",
  "1. 把站点作为静态文件伺服（和 tools/serve.mjs 同一套规则）":
    "1. Serve the site as static files (same rules as tools/serve.mjs)",
  "2. 提供真实的账号 API：注册 / 登录 / 退出 / Member名录 / 退会":
    "2. Provide a real account API: register / sign in / sign out / directory / leave",
  "安全设计（都是真做了的，不是写着好看）：": "Security, implemented rather than advertised:",
  "· 密码用 scrypt 加盐哈希（N=16384, r=8, p=1），从不落盘明文、从不出现在任何响应里":
    "· Passphrases are salted and hashed with scrypt (N=16384, r=8, p=1); plaintext never touches disk and never appears in a response",
  "· 会话是 HttpOnly + SameSite=Lax Cookie，服务端保存，30 天过期":
    "· Sessions are HttpOnly + SameSite=Lax cookies, held server-side, expiring after 30 days",
  "· 所有写操作要求 CSRF 双提交令牌（Cookie + 请求头必须一致）":
    "· Every write requires a double-submit CSRF token (cookie and header must match)",
  "· 注册/登录有按 IP 的滑动窗口限流": "· Registration and sign-in are rate limited per IP with a sliding window",
  "· 账号文件原子写入（临时文件 + rename），权限收到 0600":
    "· The account store is written atomically (temp file + rename) and chmodded to 0600",
  "· 响应统一走 toPublic()，从根上杜绝哈希/邮箱外泄":
    "· All responses go through toPublic(), so hashes and email addresses cannot leak",
  "· 路径穿越防护 + 一组安全响应头（CSP 等）": "· Path-traversal protection and a set of security headers (CSP and friends)",
  "用法：": "Usage:",
  "const FOUNDING_SEATS = 20;          // 前 20 位是「Founding member」（因为 20 MB）":
    "const FOUNDING_SEATS = 20;          // the first 20 seats are founding members (because, well, 20 MB)",
  '\'  修好它，或者把它移走让服务器重新建一个（Member数据会丢，请先备份）。\'':
    '\'  Repair it, or move it aside so the server starts a fresh one (member data will be lost — back it up first).\'',
  "renameSync(tmp, ACCOUNTS);            // 原子替换：不会出现写一半的文件":
    "renameSync(tmp, ACCOUNTS);            // atomic swap: never a half-written file",
  "catch { /* Windows 上可能不支持，忽略 */ }": "catch { /* not supported on Windows; ignore */ }",
  '"Your passphrase needs at least 10 characters.毕竟我们是靠统计「猜密码」起家的组织。"':
    '"Your passphrase needs at least 10 characters. We are, after all, a society founded on counting."',
  'log(`${c(33, "FAIL")} 登录失败 ${emailLower || "(空)"}`);':
    'log(`${c(33, "FAIL")} sign-in failed ${emailLower || "(empty)"}`);',
  "message: `请原样输入你的Member编号以确认：${member.serial}`":
    "message: `Type your membership number exactly to confirm: ${member.serial}`",
  '"script-src \'self\' \'unsafe-inline\'",     // 页面里有少量内联脚本（主题引导、歌词渲染）':
    '"script-src \'self\' \'unsafe-inline\'",     // a few inline scripts (theme bootstrap, lyric rendering)',
  '"style-src \'self\' \'unsafe-inline\'",      // 页面里用了内联样式微调':
    '"style-src \'self\' \'unsafe-inline\'",      // inline styles for small layout tweaks',
  "console.log(`  站点     ${c(36, `http://127.0.0.1:${PORT}/`)}`);":
    "console.log(`  Site     ${c(36, `http://127.0.0.1:${PORT}/`)}`);",
  "console.log(`  入会     ${c(36, `http://127.0.0.1:${PORT}/register.html`)}`);":
    "console.log(`  Join     ${c(36, `http://127.0.0.1:${PORT}/register.html`)}`);",
  "console.log(`  名录     ${c(36, `http://127.0.0.1:${PORT}/members.html`)}`);":
    "console.log(`  Register ${c(36, `http://127.0.0.1:${PORT}/members.html`)}`);",
  "console.log(`  局域网   ${c(36, `http://${lan[0]}:${PORT}/`)}":
    "console.log(`  LAN      ${c(36, `http://${lan[0]}:${PORT}/`)}",
  "console.log(`  在册Member ${members} on the register · founding seats: ${FOUNDING_SEATS} 个`);":
    "console.log(`  Members  ${members} on the register · founding seats: ${FOUNDING_SEATS}`);",
  "console.log(`  账号文件 ${ACCOUNTS}`);": "console.log(`  Accounts ${ACCOUNTS}`);",
  "try { saveStore(); } catch { /* 尽力而为 */ }": "try { saveStore(); } catch { /* best effort */ }",
  "/* 优雅退出：把内存里还没落盘的改动写回去 */": "/* Graceful shutdown: flush anything not yet written to disk */"
};

/* 第三遍：命令行工具 cli/att.mjs 的全部输出文案。
   这一遍很重要 —— 网站上的终端片段必须与工具真实输出一致，否则就是假证据。 */
const MAP3 = {
  "找不到上限数据文件：": "Limits data file not found: ",
  "没有匹配「": "No service matches \"",
  "」的服务商。试试 att limits 看全部。": "\". Run att limits to see them all.",
  "各服务商附件上限": "Attachment limits by service",
  "（数据校验于 ": "(data verified ",
  "  提示：文件在传输时会做 Base64 编码，体积膨胀约 33%。":
    "  Note: messages are Base64 encoded in transit, inflating size by about 33%.",
  "       不确定的话先跑 att info <文件>，它会按编码后的体积替你算一遍。":
    "        Unsure? Run att info <file> first — it does the arithmetic on the encoded size.",
  "用法：att info <文件>": "Usage: att info <file>",
  "文件不存在：": "File not found: ",
  "  文件大小        ": "  File size       ",
  " 字节)": " bytes)",
  "  编码后大小      ": "  Encoded size    ",
  "%，服务器看到的是这个数)": "% — this is what the server sees)",
  "  按 20 MB 算     ": "  At 20 MB        ",
  "需要切成 ": "needs ",
  " 片": " shards",
  "单片即可": "one message is enough",
  "  发得出去吗": "  Will it send?",
  "客户端不设限": "no client-side limit",
  " · 超出 ": " · over by ",
  "  数据校验于 ": "  Data verified ",
  "。产品默认值会变，请以官方文档与实测为准。": ". Defaults change; check the official documentation and your own measurements.",
  "  建议：": "  Try: ",
  "用法：att split <文件> [--limit 20MB] [--out 目录] [--keep-name]":
    "Usage: att split <file> [--limit 20MB] [--out DIR]",
  "--limit 不合法：": "Invalid --limit: ",
  "文件是空的，没什么可切的。": "The file is empty. Nothing to cut.",
  "✓ 已切成 ": "✓ Cut into ",
  " 片，每片上限 ": " shards, ",
  "  原始文件   ": "  Original  ",
  "  清单       ": "  Manifest  ",
  "（重组时用它校验每一片）": "(verifies every shard when rebuilding)",
  "  收件人怎么还原": "  Rebuilding on the recipient's side",
  "    Windows  双击 ": "    Windows      double-click ",
  "    有本工具的     ": "    With the CLI  ",
  "  分片与清单都在 ": "  Shards and manifest are in ",
  "# 《": "# Rebuild script for \"",
  "》重组脚本 —— 由 att v": "\" — generated by att v",
  "# 用法：右键「使用 PowerShell 运行」，或在 PowerShell 里执行 .\\":
    "# Usage: right-click → Run with PowerShell, or run .\\",
  " 生成": "",
  "Write-Host \"正在重组 $out（$($parts.Count) 片）…\" -ForegroundColor Cyan":
    "Write-Host \"Rebuilding $out ($($parts.Count) shards)…\" -ForegroundColor Cyan",
  "throw \"缺少分片：$p\"": "throw \"Missing shard: $p\"",
  "Write-Host \"✓ 校验通过，文件完整：$out\" -ForegroundColor Green":
    "Write-Host \"✓ Verified. File is complete: $out\" -ForegroundColor Green",
  "Write-Host \"✗ 校验失败！文件可能不完整：\" -ForegroundColor Red":
    "Write-Host \"✗ Verification failed. The file may be incomplete:\" -ForegroundColor Red",
  "Write-Host \"  期望 $expected\"": "Write-Host \"  expected $expected\"",
  "Write-Host \"  实际 $actual\"": "Write-Host \"  actual   $actual\"",
  "echo \"正在重组 $out（": "echo \"Rebuilding $out (",
  " 片）…\"": " shards)…\"",
  "echo \"（本机没有 sha256sum，跳过校验）\"; exit 0":
    "echo \"(no sha256sum on this machine — skipping verification)\"; exit 0",
  "echo \"✓ 校验通过，文件完整：$out\"": "echo \"✓ Verified. File is complete: $out\"",
  "echo \"✗ 校验失败！期望 $expected，实际 $actual\"; exit 1":
    "echo \"✗ Verification failed. Expected $expected, got $actual\"; exit 1",
  "用法：att join <清单.att.json | 任意一片> [--out 输出文件] [--force]":
    "Usage: att join <manifest.att.json | any shard> [--out FILE] [--force]",
  "找不到：": "Not found: ",
  "没有找到清单文件（*": "No manifest (*",
  "）。请把它和分片放在同一个目录里。": ") found. Keep it in the same folder as the shards.",
  "清单文件读不出来：": "Cannot read the manifest: ",
  "输出文件已存在：": "Output file already exists: ",
  "\\n      加 --force 覆盖，或用 --out 指定别的名字。": "\\n      add --force to overwrite, or use --out to choose another name.",
  "✗ 分片校验未通过，已中止（不会写出损坏的文件）":
    "✗ Shard verification failed. Aborted — no corrupt file was written.",
  "缺失": "missing",
  "损坏": "corrupt",
  "期望 ": "expected ",
  "实际 ": "actual   ",
  "\\n  缺 ": "\\n  ",
  " 片，损坏 ": " missing, ",
  " 片。请让发件人重发对应分片，再跑一次。": " corrupt. Ask the sender to resend those shards, then run this again.",
  "✓ 重组完成：": "✓ Reassembled: ",
  " 片全部校验通过 · ": " shards verified · ",
  "✗ 重组后哈希不一致，文件可能在传输中损坏":
    "✗ Hash mismatch after rebuilding — the file may have been damaged in transit.",
  "退信翻译": "Bounce, translated",
  "  错误码  ": "  Codes             ",
  "  内部码  ": "  Hex codes         ",
  "  文中提到的体积  ": "  Sizes mentioned   ",
  "  没认出这是哪种退信。": "  We do not recognise this bounce.",
  "  把这封退信原文（不要改写）发到 hello@attachmenttoolarge.org，":
    "  Send us the raw bounce — do not rewrite it — at hello@attachmenttoolarge.org,",
  "  我们会把它加进识别表 —— 顺便告诉你是哪一道门拦的。":
    "  and we will add it to the recognition table, then tell you which gate blocked you.",
  "    谁在拦    ": "    Who blocked it   ",
  "    什么意思  ": "    What it means    ",
  "    下一步": "    Next",
  "  别忘了：服务器算的是编码后的体积，比原文件大约多 33%。":
    "  Remember: the server measures the encoded size, roughly 33% larger than the file.",
  "  先跑一次 ": "  Run ",
  " 再决定切几片。": " before deciding how many shards.",
  "你这一侧（提交服务器或出站网关）": "your side (submission server or outbound gateway)",
  "整封邮件超过了服务器允许的上限，在你离开自己这边的路上就被拦下了。":
    "The message exceeded the size your own server allows and was stopped before it left.",
  "按编码后体积复算一遍（约 +33%），你算的通常比服务器小":
    "Redo the arithmetic on the encoded size (+33%): your figure is usually smaller than the server's",
  "分片发送：att split <文件> --limit 20MB": "Split it: att split <file> --limit 20MB",
  "若必须整封发出，请管理员放宽出站上限": "If it must go as one message, ask an admin to raise the outbound limit",
  "收件人那一侧": "the recipient's side",
  "你已经发出去了，是对方的邮箱或网关拒收。你改不了对方，只能把体积减小。":
    "It left your server and the recipient's mailbox or gateway refused it. You cannot change their settings, only the size.",
  "分片发送": "Split it",
  "或改用你与对方都认可的共享位置，把链接写进正文里":
    "Or use a shared location you both accept and put the link in the body",
  "Outlook 客户端提交到服务器时": "when the Outlook client submits to the server",
  "邮件总大小超过服务器为该用户设定的上限。附件加上编码膨胀，很容易比你以为的大。":
    "Total message size exceeded the per-user limit. Attachments plus encoding inflation grow faster than you expect.",
  "用 att info <文件> 看编码后的真实体积": "Use att info <file> to see the real encoded size",
  "客户端与服务器之间的传输": "the transfer between client and server",
  "多半不是体积被拒，而是上传太久超时 —— 大附件加慢上行带宽的经典组合。":
    "Usually a timeout rather than a size rejection: a large attachment plus a slow uplink, the classic pairing.",
  "分片，让每封邮件都更快送完": "Split it so each message finishes sooner",
  "换到更稳定的网络再重试": "Retry on a more stable connection",
  "网关的合规/反垃圾策略": "the gateway's compliance or anti-spam policy",
  "这次不是体积问题，是策略问题（附件类型、加密要求、发件人信誉等）。":
    "This is policy, not size: attachment type, encryption requirements, sender reputation.",
  "看退信里提到的具体策略名": "Read the policy name quoted in the bounce",
  "换成链接或让对方白名单，别在体积上白费功夫":
    "Switch to a link or get whitelisted — do not waste effort on size",
  "无法确定，通常是最小的一道门": "unknown; usually whichever gate is smallest",
  "退信被网关改写过了，错误码丢了。只能靠二分法量出真实上限。":
    "A gateway rewrote the bounce and lost the error code. Only measurement will find the real limit.",
  "从 5 MB 起翻倍发送，记录第一次被退回的体积":
    "Send 5 MB, then double, and note the first size that bounces",
  "把结果写进你们的内部文档，并标上日期": "Write the result into your internal docs with today's date",
  "未知命令：": "Unknown command: ",
  "  可用命令：limits / info / split / join / ndr（att --help 看全部）":
    "  Available: limits / info / split / join / ndr  (att --help for everything)"
};

const FILES = [
  "assets/js/auth.js",
  "server/server.mjs",
  "data/limits.json",
  "cli/att.mjs"
];

let totalApplied = 0;
let leftovers = 0;

for (const rel of FILES) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) { console.log(`跳过（不存在）：${rel}`); continue; }
  let text = readFileSync(path, "utf8");
  let applied = 0;
  // 长串优先：否则短词条会先把长句切碎，长词条就再也匹配不上了
  const ordered = [...Object.entries(MAP), ...Object.entries(MAP2), ...Object.entries(MAP3)]
    .sort((a, b) => b[0].length - a[0].length);
  for (const [zh, en] of ordered) {
    if (text.includes(zh)) {
      const before = text;
      text = text.split(zh).join(en);
      if (text !== before) applied++;
    }
  }
  totalApplied += applied;

  const remaining = [...new Set([...text.matchAll(/[\u4e00-\u9fff]+/g)].map((m) => m[0]))];
  console.log(`${applied.toString().padStart(3)} 处替换  ${rel.padEnd(22)} 剩余中文片段 ${remaining.length}`);
  if (remaining.length) {
    leftovers += remaining.length;
    console.log("      剩余：" + remaining.slice(0, 40).join(" | "));
  }

  if (WRITE && applied) writeFileSync(path, text, "utf8");
}

console.log("");
console.log(`${WRITE ? "已写入" : "干跑（未写入，加 --write 生效）"} · 共替换 ${totalApplied} 处 · 剩余中文片段 ${leftovers} 处`);
process.exit(0);
