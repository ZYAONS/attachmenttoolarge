/* ==========================================================================
   attachmenttoolarge — 浏览器端自检（CDP 驱动，零依赖）

   用法：
     node tools/browser-check.mjs                  # 默认检查 index.html
     node tools/browser-check.mjs rap.html         # 检查指定页面
     node tools/browser-check.mjs 全部             # 检查全部页面（含移动视口）

   启动无头 Edge，通过 Chrome DevTools Protocol 在真实页面里跑交互并回收结果：
   主题切换、主题音乐与 Rap 曲目（含离线渲染波形，证明确实出声）、
   歌词与 lyrics.js 的一致性、卡拉OK高亮、音效开关联动、复制按钮、Toast、
   附件体积计、表单 413 拦截、窄屏溢出、无 JS 时的可读性、未捕获异常。
   ========================================================================== */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/microsoft-edge",
  "/usr/bin/google-chrome"
];
const EDGE = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!EDGE) {
  console.error("找不到 Edge/Chrome，无法执行浏览器自检");
  process.exit(2);
}

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

function resolvePages(arg) {
  if (!arg) return ["index.html"];
  if (arg === "全部" || arg === "all") {
    return readdirSync(rootDir)
      .filter((f) => f.endsWith(".html"))
      .sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)));
  }
  return [arg];
}

const pages = resolvePages(process.argv[2]);
const port = 9333 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), "att-cdp-"));

const edge = spawn(EDGE, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--autoplay-policy=no-user-gesture-required",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank"
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page;
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error("CDP 未就绪");
}

function connect(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.addEventListener("open", () => res({
      send(method, params) {
        return new Promise((ok, no) => {
          const mid = ++id;
          pending.set(mid, { ok, no });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      on(fn) { listeners.push(fn); },
      close: () => ws.close()
    }));
    ws.addEventListener("error", rej);
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { ok, no } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? no(new Error(msg.error.message)) : ok(msg.result);
        return;
      }
      listeners.forEach((fn) => fn(msg));
    });
  });
}

/* ============================ 页面内断言 ============================ */
const SUITE = `(async () => {
  const results = [];
  const ok = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail === undefined ? "" : String(detail) });
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const frame = () => new Promise(r => requestAnimationFrame(() => r()));
  const vh = () => window.innerHeight;
  const inFirstScreen = (el) => el.getBoundingClientRect().top < vh() * 0.92;
  async function until(fn, ms = 6000, step = 100) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (fn()) return true; await wait(step); }
    return false;
  }
  const hiddenNow = () => [...document.querySelectorAll(".reveal")]
    .filter(e => e.offsetParent !== null)                       // 跳过 display:none 的东西（本就不该可见）
    .filter(e => inFirstScreen(e) && getComputedStyle(e).opacity !== "1").length;

  /* ---------- 基础 ---------- */
  ok("页面标题非空", document.title.length > 0, document.title);
  ok("样式表已加载", getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)", getComputedStyle(document.body).backgroundColor);
  ok("导航链接渲染", document.querySelectorAll("[data-nav-links] a").length >= 6, document.querySelectorAll("[data-nav-links] a").length + " 个");
  await until(() => hiddenNow() === 0, 4000);
  ok("首屏区块全部可见", hiddenNow() === 0, hiddenNow() + " 个首屏区块仍透明");
  ok("未横向溢出视口", document.documentElement.scrollWidth <= window.innerWidth + 1, document.documentElement.scrollWidth + " / " + window.innerWidth);
  ok("页脚年份已填充", /\\d{4}/.test(document.querySelector("[data-year]")?.textContent || ""), document.querySelector("[data-year]")?.textContent);

  /* ---------- 主题 ---------- */
  const themeBtn = document.querySelector("[data-theme-toggle]");
  const before = document.documentElement.getAttribute("data-theme");
  themeBtn.click(); await frame();
  const after = document.documentElement.getAttribute("data-theme");
  ok("主题切换生效", before !== after, before + " -> " + after);
  ok("主题按钮是 SVG 图标", !!themeBtn.querySelector("svg"));
  themeBtn.click(); await frame();
  ok("主题可切回", document.documentElement.getAttribute("data-theme") === before);

  /* ---------- 音乐：器乐 ---------- */
  const music = window.ATTMusic;
  ok("音乐模块已加载", !!music && typeof music.start === "function");
  const vs = ("speechSynthesis" in window) ? (window.speechSynthesis.getVoices() || []) : [];
  const zh = vs.filter(v => /zh|Chinese|Huihui|Xiaoxiao|Yunxi|Kangkang/i.test((v.lang || "") + (v.name || "")));
  ok("系统语音能力", true,
     !("speechSynthesis" in window) ? "本机不支持语音合成（Rap 降级为纯伴奏）"
       : vs.length === 0 ? "语音列表为空（未知）"
       : zh.length ? "中文语音 " + zh.length + "/" + vs.length + " 个 · " + zh[0].name
       : "共 " + vs.length + " 个语音但无中文（Rap 会降级）");
  const pill = document.querySelector("[data-music]");
  ok("音乐控件已注入", !!pill);
  ok("默认静音", music.isOn() === false);
  ok("静音时音效静默", window.attSfx("error") === false);
  music.selectTrack("lofi"); await wait(150);
  const rl = await music.renderOffline(6, "lofi");
  ok("器乐合成器有波形", rl.peak > 0.02 && rl.rms > 0.004, "peak=" + rl.peak + " rms=" + rl.rms);
  pill.querySelector("[data-music-toggle]").click(); await wait(450);
  ok("点击后进入播放态", music.isOn() === true);
  ok("控件反映播放状态", pill.classList.contains("is-playing"));
  ok("播放后音效放行", window.attSfx("blip") === true);
  music.setVolume(0.3); await wait(200);
  ok("音量设置生效", Math.abs(parseFloat(pill.querySelector("[data-music-vol]").value) - 30) < 1);
  pill.querySelector("[data-music-toggle]").click(); await wait(400);
  ok("再次点击可暂停", music.isOn() === false && !pill.classList.contains("is-playing"));
  ok("暂停后音效恢复静默", window.attSfx("error") === false);
  music.setVolume(0.6);

  /* ---------- 音乐：Rap 曲目 ---------- */
  const lines = music.lyrics();
  ok("歌词已加载", lines.length >= 30, lines.length + " 行");
  const rr = await music.renderOffline(6, "rap");
  ok("Rap 鼓组有波形", rr.peak > 0.02 && rr.rms > 0.004, "peak=" + rr.peak + " rms=" + rr.rms);
  ok("人声默认关闭（不朗读）", music.voiceOn() === false, "voiceOn=" + music.voiceOn());
  const switched = music.selectTrack("rap");
  await wait(200);
  ok("可切到 Rap 曲目", switched === "rap" && music.currentTrack().id === "rap", music.currentTrack().name);
  ok("控件显示 Rap", pill.classList.contains("is-rap") && /Rap/.test(pill.querySelector("[data-music-track]").textContent));
  ok("有独立的人声开关", !!pill.querySelector("[data-music-voice]"), pill.querySelector("[data-music-voice]").textContent);

  const heard = [];
  const off = music.onLine(p => { if (p) heard.push(p); });
  await until(() => music.externalReady(), 6000);
  const ext = music.externalState();
  ok("检测到 AI 成品歌（rap.mp3）", ext.ready === true && ext.ok === true, JSON.stringify(ext));

  music.start();
  await until(() => heard.length >= 1, 4000);
  ok("Rap 启动后有声部推进", heard.length >= 1 && music.isOn(), "已推进 " + heard.length + " 行 · ttsBroken=" + music.ttsBroken());
  if (ext.ok) {
    await wait(900);
    const ext2 = music.externalState();
    ok("成品歌正在播放", ext2.paused === false && ext2.time > 0, "paused=" + ext2.paused + " t=" + ext2.time + "s");
    ok("成品歌时长约 170 秒", ext2.duration >= 160 && ext2.duration <= 180, ext2.duration + "s");
    ok("放成品歌时不再叠合成伴奏", music.usingExternal() === true, "external mode");
  } else {
    ok("成品歌不可用（退回合成伴奏）", true, "skipped: " + JSON.stringify(ext));
  }
  ok("默认不放人声", !pill.querySelector("[data-music-voice]").classList.contains("is-on"), "voice off");
  await until(() => heard.length >= 2, 9000);
  ok("声部持续推进", heard.length >= 2, "累计 " + heard.length + " 行");
  ok("推进内容与歌词一致", heard.length > 0 && lines.some(l => l.text === heard[0].text), heard[0] ? heard[0].text : "无");

  // 显式开启人声：应当允许，并且开关状态正确
  music.setVoice(true); await wait(300);
  ok("可以显式开启人声", music.voiceOn() === true && pill.querySelector("[data-music-voice]").classList.contains("is-on"), pill.querySelector("[data-music-voice]").textContent);
  music.setVoice(false); await wait(200);
  ok("可以关回人声", music.voiceOn() === false, "voice off");

  const jumped = music.playFrom(12);
  await wait(300);
  ok("可从指定行开始", jumped === 12, "跳到第 " + (jumped + 1) + " 行");
  if (off) off();

  // 紧急静音：一键全停，并且之后拒绝播放
  music.stop(); await wait(200);
  music.panic(); await wait(200);
  ok("紧急静音生效", music.isMuted() === true && music.isOn() === false, "muted");
  ok("静音后拒绝播放", music.start() === false, "start() 返回 false");
  music.mute(false); await wait(150);
  ok("可以解除静音", music.isMuted() === false, "unmuted");
  ok("解除后仍保持不自动播放", music.isOn() === false, "still silent until asked");
  music.selectTrack("lofi"); await wait(150);

  /* ---------- 歌词页：HTML 与 lyrics.js 一致性 ---------- */
  const domLines = [...document.querySelectorAll("[data-lyrics] .lyric-line")];
  if (domLines.length) {
    const domTexts = domLines.map(el => el.querySelector(".mark") ? el.textContent.replace(el.querySelector(".mark").textContent, "").trim() : el.textContent.trim());
    const srcTexts = lines.map(l => l.text.trim());
    const same = domTexts.length === srcTexts.length && domTexts.every((t, i) => t === srcTexts[i]);
    ok("歌词页与歌词源一致", same, domTexts.length + " / " + srcTexts.length + " 行" + (same ? "" : " 首个不同: " + domTexts.find((t, i) => t !== srcTexts[i])));
    const idxOk = domLines.every((el, i) => parseInt(el.getAttribute("data-line"), 10) === i);
    ok("歌词行号连续", idxOk, domLines.length + " 行");
    document.querySelector("#play-song")?.click();
    await until(() => document.querySelector(".lyric-line.is-active"), 5000);
    ok("卡拉OK高亮生效", !!document.querySelector(".lyric-line.is-active"), (document.querySelector(".lyric-line.is-active")?.textContent || "无").slice(0, 22));
    music.stop(); await wait(200);
  }

  /* ---------- 复制按钮与 Toast ---------- */
  const copy = document.querySelector("[data-copy]");
  if (copy) {
    document.querySelectorAll(".toast").forEach(t => t.remove());
    copy.click(); await wait(400);
    const toasts = [...document.querySelectorAll(".toast")];
    const last = toasts[toasts.length - 1];
    ok("复制后有 Toast 反馈", !!last && /copied/i.test(last.textContent), last ? last.textContent.slice(0, 22) : "无");
  } else {
    ok("本页无需复制按钮", true, "跳过");
  }

  /* ---------- 附件体积计 ---------- */
  const meter = document.querySelector("[data-meter]");
  if (meter) {
    meter.scrollIntoView({ block: "center" });
    await until(() => meter.querySelector(".meter-fill").style.width === "100%", 9000, 120);
    const width = meter.querySelector(".meter-fill").style.width;
    ok("体积计填满", width === "100%", width);
    ok("体积计给出 550 结论", meter.querySelector(".meter-note").textContent.includes("550 5.3.4"), meter.querySelector(".meter-note").textContent.slice(0, 34));
  } else {
    ok("本页无体积计", true, "跳过");
  }

  /* ---------- 表单 413 拦截 ---------- */
  const form = document.querySelector("[data-size-guard]");
  if (form) {
    form.scrollIntoView({ block: "center" });
    const area = form.querySelector("textarea");
    area.value = "测试".repeat(9 * 1024 * 1024);   // 约 54 MB
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(250);
    const note = form.querySelector("[data-size-note]").textContent;
    ok("超限时表单报警", note.includes("550 5.3.4") && !!form.querySelector(".field.has-error"), note.slice(0, 30));
    document.querySelectorAll(".toast").forEach(t => t.remove());
    form.querySelector("button[type=submit]").click();
    await wait(400);
    const toasts = [...document.querySelectorAll(".toast")];
    const last = toasts[toasts.length - 1];
    ok("超限时拒绝提交", !!last && last.textContent.includes("550 5.3.4"), last ? last.textContent.slice(0, 24) : "无 Toast");
    area.value = "很短的一段";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(200);
    ok("恢复正常后解除报警", !form.querySelector(".field.has-error"));
  } else {
    ok("本页无表单", true, "跳过");
  }

  /* ---------- 注册链路（只在真的连着后端时跑） ---------- */
  const regForm = document.querySelector('[data-auth="register"]');
  if (regForm && window.ATTAuth) {
    const mode = window.ATTAuth.state().mode;
    if (mode === "server") {
      const stamp = Date.now();
      regForm.querySelector('[name="name"]').value = "浏览器自检员";
      regForm.querySelector('[name="email"]').value = "e2e-" + stamp + "@example.com";
      regForm.querySelector('[name="password"]').value = "BrowserCheck-2026";
      regForm.querySelector('[name="password2"]').value = "BrowserCheck-2026";
      regForm.querySelector('input[type=checkbox]').checked = true;
      regForm.querySelector("button[type=submit]").click();
      await until(() => document.querySelector("[data-member-card] .member-card"), 6000, 150);
      const card = document.querySelector("[data-member-card] .member-card");
      const serial = card ? (card.querySelector(".member-serial")?.textContent || "").trim() : "";
      ok("浏览器内可完成真实注册", !!card && /^ATT-20MB-\d{6}$/.test(serial), serial || "没有出现会员证");
      const dir = await fetch("/api/members").then(r => r.json()).catch(() => null);
      ok("新会员出现在公开名录", !!dir && dir.members.some(m => m.serial === serial), dir ? "在册 " + dir.count + " 位" : "取不到名录");
      ok("名录里没有邮箱", !!dir && !JSON.stringify(dir).includes("@"), "无 @ 字符");
      const me = await window.ATTAuth.me();
      ok("注册后会话已建立", me.authenticated === true && me.member.serial === serial, me.member?.rank || "");
    } else {
      ok("静态模式：显示无后端提示", !!document.querySelector("[data-static-notice]") && getComputedStyle(document.querySelector("[data-static-notice]")).display !== "none", "mode=" + mode);
    }
  }

  return { results, viewport: window.innerWidth + "x" + window.innerHeight };
})()`;

/* ============================ 无 JS 可读性 ============================ */
const NOJS = `(() => {
  const hidden = [...document.querySelectorAll(".reveal")].filter(e => getComputedStyle(e).opacity !== "1").length;
  const text = document.body.innerText.replace(/\\s+/g, "");
  return {
    hiddenReveals: hidden,
    chars: text.length,
    hasTitle: text.includes(document.title.slice(0, 6)),
    hasNav: document.querySelectorAll("[data-nav-links] a").length
  };
})()`;

/* ============================ 执行 ============================ */
const allRows = [];
let total = 0, failed = 0;

async function run() {
  const target = await pageTarget();
  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Log.enable").catch(() => {});

  for (const file of pages) {
    // file 可以是相对文件名，也可以是 http(s):// 地址（用来验证真正的服务器）
    const url = /^https?:\/\//i.test(file) ? file : pathToFileURL(join(rootDir, file)).href;
    for (const size of [
      { w: 1360, h: 900, mobile: false, label: "桌面 1360x900" },
      { w: 390, h: 780, mobile: true, label: "移动 390x780" }
    ]) {
      const errors = [];
      const collect = (msg) => {
        if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
        if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") errors.push(msg.params.entry.text);
      };
      cdp.on(collect);

      await cdp.send("Emulation.setDeviceMetricsOverride", { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: size.mobile });
      await cdp.send("Page.navigate", { url });
      await sleep(2400);

      const out = await cdp.send("Runtime.evaluate", { expression: SUITE, awaitPromise: true, returnByValue: true });
      const rows = [];
      if (out.exceptionDetails) {
        rows.push({ name: "页面内断言执行", pass: false, detail: (out.exceptionDetails.exception?.description || "异常").split("\n")[0].slice(0, 80) });
      } else {
        rows.push(...out.result.value.results);
      }
      rows.push({ name: "无未捕获 JS 异常", pass: errors.length === 0, detail: errors.length ? errors[0].split("\n")[0].slice(0, 66) : "0 个" });

      console.log(`\n=== ${file} · ${size.label} · 实测视口 ${out.result.value?.viewport ?? "?"} ===`);
      for (const row of rows) {
        total++;
        if (!row.pass) failed++;
        console.log(`  ${row.pass ? "PASS" : "FAIL"}  ${row.name.padEnd(22)} ${row.detail}`);
      }
      allRows.push({ file, label: size.label, rows });
    }
  }

  /* 无 JS 回退：禁用脚本后再看一次首屏 */
  await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: pathToFileURL(join(rootDir, "index.html")).href });
  await sleep(1500);
  const nojs = await cdp.send("Runtime.evaluate", { expression: NOJS, returnByValue: true });
  await cdp.send("Emulation.setScriptExecutionDisabled", { value: false });
  const n = nojs.result.value || {};
  console.log("\n=== 无 JavaScript 回退（index.html）===");
  const noJsRows = [
    { name: "内容默认可见", pass: n.hiddenReveals === 0, detail: (n.hiddenReveals ?? "?") + " 个透明区块" },
    { name: "正文有实际文本", pass: (n.chars || 0) > 1200, detail: (n.chars || 0) + " 字" },
    { name: "导航仍然渲染", pass: (n.hasNav || 0) >= 6, detail: (n.hasNav || 0) + " 个链接" }
  ];
  for (const row of noJsRows) {
    total++;
    if (!row.pass) failed++;
    console.log(`  ${row.pass ? "PASS" : "FAIL"}  ${row.name.padEnd(22)} ${row.detail}`);
  }

  /* 「永久静音」URL 参数：?sound=off 必须在加载时就把声音关死 */
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: pathToFileURL(join(rootDir, "index.html")).href + "?sound=off" });
  await sleep(1800);
  const muted = await cdp.send("Runtime.evaluate", {
    expression: `({ muted: window.ATTMusic ? ATTMusic.isMuted() : null,
                    startBlocked: window.ATTMusic ? ATTMusic.start() === false : null,
                    playing: window.ATTMusic ? ATTMusic.isOn() : null,
                    voice: window.ATTMusic ? ATTMusic.voiceOn() : null,
                    label: document.querySelector('[data-music-status]')?.textContent || '' })`,
    returnByValue: true
  });
  const m = muted.result.value || {};
  console.log("\n=== ?sound=off 永久静音 ===");
  const muteRows = [
    { name: "加载即处于静音", pass: m.muted === true, detail: String(m.muted) },
    { name: "start() 被拒绝", pass: m.startBlocked === true, detail: String(m.startBlocked) },
    { name: "没有在播放", pass: m.playing === false, detail: "playing=" + m.playing },
    { name: "人声也是关的", pass: m.voice === false, detail: "voice=" + m.voice },
    { name: "界面如实说明", pass: /sound off/i.test(m.label), detail: m.label.slice(0, 40) }
  ];
  for (const row of muteRows) {
    total++;
    if (!row.pass) failed++;
    console.log(`  ${row.pass ? "PASS" : "FAIL"}  ${row.name.padEnd(22)} ${row.detail}`);
  }

  cdp.close();
}

try {
  await run();
} catch (e) {
  console.error("自检失败：", e.message);
  failed++;
} finally {
  edge.kill();
  await sleep(400);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows 偶尔占用 */ }
}

console.log(`\n共 ${total} 项检查，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
