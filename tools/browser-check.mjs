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
  const termLines = [...document.querySelectorAll(".terminal .term-line")];
  if (termLines.length) {
    await until(() => termLines.every(l => getComputedStyle(l).opacity === "1"), 5000, 150);
    const hidden = termLines.filter(l => getComputedStyle(l).opacity !== "1").length;
    ok("终端文字可见（动画未藏内容）", hidden === 0, termLines.length + " 行，隐藏 " + hidden);
  }
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
  ok("器乐没有嘶声杂音", rl.hf < 0.25, "hf=" + rl.hf + " (high-frequency energy share)");
  const twoLoops = await music.renderOffline(Math.ceil(music.loopSeconds() * 2) + 1, "lofi");
  const ratio = twoLoops.rmsSecondHalf / Math.max(twoLoops.rmsFirstHalf, 1e-9);
  ok("器乐可以一直循环（不衰减）", ratio > 0.6 && ratio < 1.6,
     "first half " + twoLoops.rmsFirstHalf + " / second half " + twoLoops.rmsSecondHalf +
     " · ratio " + ratio.toFixed(2) + " · over " + Math.round(music.loopSeconds() * 2) + "s");
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

  /* ---------- 播放器：只有器乐一条曲目 ---------- */
  const lines = music.lyrics();
  ok("歌词已加载", lines.length >= 30, lines.length + " 行");
  const rr = await music.renderOffline(6, "rap");
  ok("合成器能渲染说唱鼓组（引擎仍在）", rr.peak > 0.02 && rr.rms > 0.004, "peak=" + rr.peak);
  ok("播放器不提供说唱切换", !pill.querySelector("[data-music-track]"), "no track switcher");
  ok("播放器不提供人声朗读开关", !pill.querySelector("[data-music-voice]"), "no voice switch");
  ok("站点背景音乐是器乐而非人声", ["postrock", "lofi"].indexOf(music.currentTrack().id) >= 0, music.currentTrack().name + " (" + music.currentTrack().id + ")");
  ok("入口指向唱片页", /music\.html/.test(pill.querySelector("[data-music-lyrics]")?.getAttribute("href") || ""),
     (pill.querySelector("[data-music-lyrics]")?.textContent || "").trim());

  const heard = [];
  const off = music.onLine(p => { if (p) heard.push(p); });
  music.start();
  await wait(1200);
  ok("器乐播放中", music.isOn() === true, "playing");
  ok("器乐不朗读歌词", heard.length === 0, "no lyric narration from the background track");
  if (off) off();

  // 紧急静音：一键全停，并且之后拒绝播放
  music.stop(); await wait(200);
  music.panic(); await wait(200);
  ok("紧急静音生效", music.isMuted() === true && music.isOn() === false, "muted");
  ok("静音后拒绝播放", music.start() === false, "start() 返回 false");
  music.mute(false); await wait(150);
  ok("可以解除静音", music.isMuted() === false, "unmuted");
  ok("解除后仍保持不自动播放", music.isOn() === false, "still silent until asked");

  /* ---------- 唱片页：四首曲目、真实播放、歌词跟随 ---------- */
  const trackList = document.querySelector("[data-ms-tracks]");
  if (trackList) {
    const rows = [...trackList.querySelectorAll(".ms-track")];
    /* The count is not fixed — tracks keep being added, and a hard-coded number
       only ever fails for the wrong reason. What matters is that every row is
       playable and that the known ones are present. */
    ok("曲目表不为空且每条都可播放", rows.length >= 5 && rows.every(r => r.hasAttribute("data-track")),
       rows.length + " rows, each with a data-track");
    const names = rows.map(r => r.querySelector(".ms-name")?.textContent || "");
    ok("曲目名完整", /Failed at 19:59/.test(names[0]) && /Wrong Side of the Wire/.test(names[2]) && /Ninety-Nine Forever/.test(names[3]) && /The Long Send/.test(names[4]), names.join(" · ").slice(0, 78));

    /* the in-house Ark-flavoured score: composed here, not fetched from anywhere */
    const ark = await music.renderOffline(22, "postrock");   // a whole eight-bar build, not just the intro
    ok("后摇曲有波形", ark.peak > 0.02 && ark.rms > 0.004, "peak=" + ark.peak + " rms=" + ark.rms);
    /* The comparison that was actually asked for: the two pieces by their spectrum.
       Percussion is a layer on top of whatever bed is underneath, so counting hits
       per second cannot tell "a different piece" from "the same piece with drums" —
       which is exactly the mistake this test used to make. The spectral centroid and
       the low/mid/high energy shares can tell: a piece with its own pad, bass and
       arpeggio sits elsewhere in the spectrum before a single drum plays. */
    const centroidGap = Math.abs(ark.centroidHz - rl.centroidHz) / Math.max(ark.centroidHz, rl.centroidHz, 1);
    const bandGap = Math.max(
      Math.abs(ark.lowShare - rl.lowShare),
      Math.abs(ark.midShare - rl.midShare),
      Math.abs(ark.highShare - rl.highShare)
    );
    const differs = (centroidGap >= 0.15 ? 1 : 0) + (bandGap >= 0.10 ? 1 : 0);
    ok("后摇与铺底是两首不同的曲子（按频谱）", differs >= 2,
       "centroid " + rl.centroidHz + "Hz vs " + ark.centroidHz + "Hz (gap " + (centroidGap * 100).toFixed(0) + "%) · " +
       "low/mid/high " + rl.lowShare + "/" + rl.midShare + "/" + rl.highShare + " vs " +
       ark.lowShare + "/" + ark.midShare + "/" + ark.highShare + " (max band gap " + (bandGap * 100).toFixed(0) + "%)");
    const arkRow = document.querySelector('[data-track="postrock"]');
    if (arkRow) {
      arkRow.click(); await wait(400);
      ok("选到后摇曲目", music.currentTrack().id === "postrock" && /The Long Send/.test(music.currentTrack().name),
         music.currentTrack().id + " · " + music.currentTrack().name);
      ok("后摇曲目在播", music.isOn() === true, "playing");
      arkRow.click(); await wait(200);   // stop it again
    }

    /* the words below the list must follow whichever track is selected */
    const msTitle = () => (document.querySelector("[data-lyrics-title]") || {}).textContent || "";
    const msCount = () => document.querySelectorAll("[data-lyrics] .lyric-line").length;
    const msRow = (id) => document.querySelector('[data-track="' + id + '"]');
    ok("删掉了那段说明文字", !/real recordings, generated from their own lyrics/.test(document.body.innerText), "removed");
    if (msRow("wire")) {
      msRow("wire").click(); await wait(300);
      ok("歌词随曲目切换 · wire", /Wrong Side of the Wire/.test(msTitle()) && msCount() > 15, msTitle() + " · " + msCount() + " lines");
      msRow("ninetynine").click(); await wait(300);
      ok("歌词随曲目切换 · ninetynine", /Ninety-Nine Forever/.test(msTitle()), msTitle());
      msRow("lofi").click(); await wait(300);
      ok("器乐不冒充别人的歌词", msTitle() === "No words" && msCount() === 0, msTitle());
      msRow("rap").click(); await wait(300);
      ok("切回说唱是它自己的词", /Attachment Too Large/.test(msTitle()) && msCount() >= 30, msTitle() + " · " + msCount() + " lines");
      /* Leave the player stopped: the page stops the current track when its row is
         clicked again, and a later assertion clicking "rap" then starts it properly.
         (The page's stopAll() lives in a closure and is not reachable from here.) */
      msRow("rap").click(); await wait(200);
    }

    /* ---------- switching between tracks: the file player and the live synth ---------- */
    if (msRow("wire") && msRow("lofi")) {
      const el = document.querySelector("audio");
      const src = () => (el && (el.currentSrc || el.src)) || "";
      const short = () => src().split("/").pop();

      msRow("wire").click();
      await until(() => /wire\.mp3/.test(src()) && !el.paused, 6000, 150);
      ok("切到 03：音轨换成 wire 并在播", /wire\.mp3/.test(src()) && !el.paused, short() + " paused=" + el.paused);

      msRow("ninetynine").click();
      await until(() => /ninetynine\.mp3/.test(src()) && !el.paused, 6000, 150);
      ok("03 直接切 04 不卡住", /ninetynine\.mp3/.test(src()) && !el.paused, short() + " paused=" + el.paused);

      msRow("lofi").click();
      await until(() => music.isOn(), 6000, 150);
      ok("切到器乐：录音停下、合成器接管", el.paused === true && music.isOn() === true,
         "audio paused=" + el.paused + " synth=" + music.isOn());

      msRow("rap").click();
      await until(() => /rap\.mp3/.test(src()) && !el.paused, 6000, 150);
      ok("从器乐切回录音：合成器让位", /rap\.mp3/.test(src()) && !el.paused && music.isOn() === false,
         short() + " paused=" + el.paused + " synth=" + music.isOn());

      msRow("rap").click(); await wait(250);            // stop again, leaving the page quiet
      ok("连点两次同一行会停下", el.paused === true, "paused=" + el.paused);
    }
    ok("播放器在 DOM 里", !!document.querySelector("audio"), "hidden audio element");

    // 点击说唱那条：应当切到 rap.mp3 并开始播放
    const rapRow = rows.find(r => /rap\.mp3/.test(r.getAttribute("data-src") || ""));
    rapRow.click();
    await until(() => { const a = document.querySelector("audio"); return a && /rap\.mp3/.test(a.currentSrc || a.src) && a.duration > 0; }, 9000, 200);
    const a1 = document.querySelector("audio");
    ok("点击后切到该曲目", /rap\.mp3/.test(a1.currentSrc || a1.src), (a1.currentSrc || a1.src).split("/").pop());
    ok("该曲目时长正确", a1.duration > 150 && a1.duration < 200, Math.round(a1.duration) + "s");
    await until(() => !a1.paused, 4000, 150);
    ok("真的在播放", !a1.paused, "paused=" + a1.paused);
    ok("该行高亮", rapRow.classList.contains("is-playing"), "row marked");

    // 歌词：38 行（一致性由下面那条通用断言负责），点一行会跳到对应位置并高亮
    const lyricLines = [...document.querySelectorAll("[data-lyrics] .lyric-line")];
    ok("唱片页带说唱歌词", lyricLines.length === 38, lyricLines.length + " lines");
    lyricLines[12].click();
    await until(() => document.querySelector(".lyric-line.is-active"), 4000, 150);
    ok("点歌词会定位并高亮", !!document.querySelector(".lyric-line.is-active"),
       (document.querySelector(".lyric-line.is-active")?.textContent || "").slice(0, 30));

    // 切到合成器乐那条：不该有音频文件在放
    rows[0].click();
    await wait(600);
    const a2 = document.querySelector("audio");
    ok("切到实时合成器乐会停掉文件", a2.paused === true, "file audio paused");
    ok("播放条反映状态", /Failed at 19:59/.test(document.querySelector("[data-ms-state]")?.textContent || ""),
       document.querySelector("[data-ms-state]")?.textContent?.slice(0, 40));
    if (window.ATTMusic && ATTMusic.isOn()) ATTMusic.stop();
  } else if (document.querySelector('audio[src*="rap.mp3"]')) {
    ok("旧版说唱页（已退役为跳转）", true, "legacy page");
  } else {
    ok("本页无唱片播放器（跳过）", true, "N/A on this page");

    /* ---------- 设计审计：把已经犯过的错变成断言 ---------- */
    /* No regular expressions anywhere in here on purpose: this whole suite is a
       template literal in the host file, which swallows backslashes — a regex
       written with escaped parentheses silently becomes a different regex and
       takes the suite down with it (it happened: 12 checks instead of 102). */
    function lumOfTriplet(r, g, b, a) {
      if (a !== undefined && a === 0) return -1;
      const f = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    }
    function colorsIn(str) {
      const out = [];
      const s = String(str || "");
      const parts = s.split("rgb");
      for (let i = 1; i < parts.length; i++) {
        const seg = parts[i];
        const a = seg.indexOf("("), b = seg.indexOf(")");
        if (a < 0 || b < 0) continue;
        const nums = seg.slice(a + 1, b).split(",").map(x => parseFloat(x));
        if (nums.length >= 3 && nums.slice(0, 3).every(v => !isNaN(v))) out.push(nums);
      }
      for (let i = 0; i < s.length; i++) {
        if (s[i] !== "#") continue;
        const hex = s.slice(i + 1, i + 7);
        if (hex.length >= 6 && /^[0-9a-fA-F]{6}$/.test(hex)) {
          out.push([parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]);
        }
      }
      return out;
    }
    function lumOf(c) {
      const list = colorsIn(c);
      if (!list.length) return -1;
      const v = list[0];
      return lumOfTriplet(v[0], v[1], v[2], v.length > 3 ? v[3] : undefined);
    }
    /* A panel can be light because of a background-image gradient rather than a
       background-color — which is exactly how a bone-white plate with white text
       on it slipped past the first version of this audit. So gradients count too:
       every colour stop in the image is averaged and treated as the backdrop. */
    function bgLum(el) {
      let n = el, fromImage = -1;
      while (n && n !== document.documentElement) {
        const cs = getComputedStyle(n);
        const bg = cs.backgroundColor;
        const solid = colorsIn(bg);
        if (solid.length && !(solid[0].length > 3 && solid[0][3] === 0)) {
          return lumOfTriplet(solid[0][0], solid[0][1], solid[0][2]);
        }
        if (cs.backgroundImage && cs.backgroundImage !== "none") {
          const stops = colorsIn(cs.backgroundImage);
          if (stops.length) {
            const ls = stops.map(s => lumOfTriplet(s[0], s[1], s[2]));
            return ls.reduce((a, b) => a + b, 0) / ls.length;   // nearest visible fill wins
          }
        }
        n = n.parentElement;
      }
      return 0;
    }
    const auditRoots = [...document.querySelectorAll("main h1, main h2, main h3, main p, main li, main a, main span, main button, main label")]
      .filter(el => el.offsetParent !== null && el.textContent.trim().length > 3
        && !el.closest(".hud-rail,.hud-timer,.hud-crumb,.music-pill,.bg-fx"));
    const lowContrast = [];
    for (const el of auditRoots) {
      const cs = getComputedStyle(el);
      const fgRaw = cs.webkitTextFillColor && cs.webkitTextFillColor !== "rgb(0, 0, 0)" ? cs.webkitTextFillColor : cs.color;
      const L1 = lumOf(fgRaw);
      if (L1 < 0) { lowContrast.push("transparent fill: " + el.tagName + " " + el.textContent.trim().slice(0, 20)); continue; }
      const L2 = bgLum(el);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      if (ratio < 2.4) lowContrast.push(el.tagName + " '" + el.textContent.trim().slice(0, 18) + "' ratio=" + ratio.toFixed(2));
    }
    ok("审计: 文字对比度足够", lowContrast.length === 0,
       lowContrast.length ? lowContrast.slice(0, 3).join(" | ") : auditRoots.length + " 处文字全部达标");

    const invisibleHeads = [...document.querySelectorAll("main h1, main h2")].filter(h => {
      const r = h.getBoundingClientRect();
      const cs = getComputedStyle(h);
      const fill = cs.webkitTextFillColor || cs.color;
      return r.height < 8 || lumOf(fill) < 0;
    }).map(h => h.tagName + " " + h.textContent.trim().slice(0, 20) + " h=" + Math.round(h.getBoundingClientRect().height));
    ok("审计: 标题可见（非透明、有高度）", invisibleHeads.length === 0, invisibleHeads.join(" | ") || "all visible");

    const fixed = [...document.querySelectorAll(".hud-crumb,.hud-rail,.hud-timer,.music-pill")]
      .filter(el => el.offsetParent !== null || getComputedStyle(el).position === "fixed")
      .map(el => ({ n: el.className.split(" ")[0], r: el.getBoundingClientRect() }))
      .filter(o => o.r.width > 0 && o.r.height > 0);
    const clashes = [];
    for (let a = 0; a < fixed.length; a++) for (let b = a + 1; b < fixed.length; b++) {
      const A = fixed[a].r, B = fixed[b].r;
      const ox = Math.min(A.right, B.right) - Math.max(A.left, B.left);
      const oy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
      if (ox > 4 && oy > 4) clashes.push(fixed[a].n + " × " + fixed[b].n);
    }
    ok("审计: 固定控件互不重叠", clashes.length === 0, clashes.join(", ") || fixed.length + " 个固定控件无交叠");

    const fx = document.querySelector(".bg-fx");
    if (fx) {
      const col = document.querySelector("main .container") || document.querySelector("main");
      const c = col.getBoundingClientRect();
      const mid = document.elementFromPoint(Math.round(c.left + c.width / 2), Math.round(c.top + Math.min(120, c.height / 2)));
      ok("审计: 装饰层未挡住正文", !(mid && mid.closest(".bg-fx")), mid ? mid.tagName + "." + String(mid.className).split(" ")[0] : "n/a");
    }
    const stamps = [...document.querySelectorAll("link[rel=stylesheet]")].map(l => { const h = l.getAttribute("href") || ""; const i = h.indexOf("?v="); return i < 0 ? "" : h.slice(i + 3); }).filter(Boolean);
    ok("审计: 样式表缓存戳一致", new Set(stamps).size <= 1, stamps.join(", "));
  }

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
