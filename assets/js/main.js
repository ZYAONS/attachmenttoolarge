/* ==========================================================================
   attachmenttoolarge — 站点交互脚本
   零依赖，file:// 直接打开也能跑
   ========================================================================== */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- 1. 主题切换 ---------- */
  var STORE_KEY = "att.theme";

  // 用内联 SVG 画图标，避免不同系统缺少 ☀ / ☾ 字形导致按钮变成空白
  var ICON_SUN =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4.2"/>' +
    '<path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2' +
    'M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/></svg>';
  var ICON_MOON =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M20.8 13.3A8.6 8.6 0 1 1 10.7 3.2a6.8 6.8 0 0 0 10.1 10.1z"/></svg>';

  function currentTheme() {
    try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(STORE_KEY, theme); } catch (e) { /* 隐私模式忽略 */ }
    $$("[data-theme-toggle]").forEach(function (btn) {
      var toLight = theme !== "light";
      btn.innerHTML = toLight ? ICON_SUN : ICON_MOON;
      btn.setAttribute("aria-label", toLight ? "Switch to light theme" : "Switch to dark theme");
      btn.setAttribute("title", toLight ? "Switch to light theme" : "Switch to dark theme");
    });
  }

  function initTheme() {
    // 允许用 ?theme=light / ?theme=dark 强制指定主题（方便截图与分享）
    var forced = /[?&]theme=(light|dark)(?:&|$|#)/.exec(location.search);
    if (forced) {
      applyTheme(forced[1]);
    } else {
      var saved = currentTheme();
      if (!saved) {
        var prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
        saved = prefersLight ? "light" : "dark";
      }
      applyTheme(saved);
    }
    $$("[data-theme-toggle]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        applyTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light");
      });
    });
  }

  /* ---------- 2. 移动端导航 ---------- */
  function initNav() {
    var toggle = $("[data-nav-toggle]");
    var links = $("[data-nav-links]");
    if (!toggle || !links) return;

    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    $$("a", links).forEach(function (a) {
      a.addEventListener("click", function () {
        links.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") links.classList.remove("is-open");
    });
  }

  /* ---------- 3. 当前页高亮 ---------- */
  function initActiveLink() {
    var here = location.pathname.split("/").pop() || "index.html";
    $$("[data-nav-links] a").forEach(function (a) {
      var target = a.getAttribute("href");
      if (!target) return;
      if (target === here || (here === "index.html" && target === "index.html")) {
        a.classList.add("is-active");
        a.setAttribute("aria-current", "page");
      }
    });
  }

  /* ---------- 4. 滚动入场 ---------- */
  function initReveal() {
    var items = $$(".reveal");
    if (!items.length) return;

    function revealAll() {
      items.forEach(function (el) { el.classList.add("is-visible"); });
    }

    if (!("IntersectionObserver" in window)) {
      revealAll();
      return;
    }

    var fired = 0;

    // 保险丝：只有在观察器「一次都没触发」时才兜底全显，
    // 这样正常环境保留滚动入场效果，坏掉的环境也不会白屏。
    setTimeout(function () { if (fired === 0) revealAll(); }, 2500);

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry, i) {
        if (!entry.isIntersecting) return;
        fired++;
        var el = entry.target;
        var delay = Math.min(i * 70, 280);
        setTimeout(function () { el.classList.add("is-visible"); }, delay);
        io.unobserve(el);
      });
    }, { rootMargin: "0px 0px -4% 0px", threshold: 0 });

    items.forEach(function (el) { io.observe(el); });
  }

  /* ---------- 5. 复制按钮 ---------- */
  function toast(code, title, body) {
    var el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.innerHTML =
      '<div><div class="toast-code">' + code + "</div><div>" + title + "</div>" +
      (body ? '<div class="small muted">' + body + "</div>" : "") + "</div>";
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add("is-shown"); });
    setTimeout(function () {
      el.classList.remove("is-shown");
      setTimeout(function () { el.remove(); }, 400);
    }, 3400);
  }
  window.attToast = toast;

  function initCopy() {
    $$("[data-copy]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var text = btn.getAttribute("data-copy");
        var done = function () {
          var old = btn.textContent;
          btn.textContent = "Copied ✓";
          if (window.attSfx) window.attSfx("blip");
          toast("200 OK", "Command copied to clipboard", "Paste it in a terminal — and mind the 20 MB limit.");
          setTimeout(function () { btn.textContent = old; }, 1800);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
        } else {
          fallback(text, done);
        }
      });
    });
  }

  function fallback(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { toast("403", "Copy refused", "Select the command by hand instead."); }
    ta.remove();
  }

  /* ---------- 6. Hero 附件容量计 ---------- */
  function initMeter() {
    var meter = $("[data-meter]");
    if (!meter) return;
    var fill = $(".meter-fill", meter);
    var value = $("[data-meter-value]", meter);
    var note = $(".meter-note", meter);
    var max = parseFloat(meter.getAttribute("data-meter-max")) || 20;
    var started = false;

    function run() {
      if (started) return;
      started = true;
      var pct = 0;
      fill.style.width = "0%";
      var timer = setInterval(function () {
        pct += 4 + Math.random() * 7;
        if (pct >= 100) { pct = 100; clearInterval(timer); }
        fill.style.width = pct + "%";
        value.textContent = (pct * max / 100).toFixed(1) + " MB / " + max.toFixed(1) + " MB";
        if (pct >= 100) {
          note.textContent = "550 5.3.4 Message size exceeds fixed maximum message size — of course, we never cared about that number.";
          if (window.attSfx) window.attSfx("error");
        } else if (pct > 62) {
          note.textContent = "Warning: Outlook is getting nervous. It just remembered OneDrive.";
        }
      }, 55);
    }

    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { run(); io.disconnect(); } });
      }, { threshold: 0.4 });
      io.observe(meter);
    } else {
      run();
    }
  }

  /* ---------- 7. 贡献表单的「附件体积」计量 ---------- */
  var MB_PER_CHAR_BYTES = 3; // UTF-8 中文约 3 字节

  function initSizeGuard() {
    var form = $("[data-size-guard]");
    if (!form) return;
    var LIMIT_MB = parseFloat(form.getAttribute("data-size-limit")) || 20;
    var area = $("textarea", form);
    var label = $("[data-size-value]", form);
    var bar = $("[data-size-bar]", form);
    var note = $("[data-size-note]", form);
    var field = area ? area.closest(".field") : null;
    var sent = false;

    function measure() {
      var bytes = new Blob([area.value]).size || area.value.length * MB_PER_CHAR_BYTES;
      var mb = bytes / 1048576;
      var pct = Math.min(100, (mb / LIMIT_MB) * 100);
      if (label) label.textContent = mb.toFixed(3) + " MB / " + LIMIT_MB.toFixed(3) + " MB";
      if (bar) {
        bar.style.width = pct + "%";
        bar.style.background = pct >= 100
          ? "var(--accent)"
          : pct > 80
            ? "linear-gradient(90deg, var(--warn), var(--accent))"
            : "linear-gradient(90deg, var(--ok), var(--warn))";
      }
      var over = mb >= LIMIT_MB;
      if (field) field.classList.toggle("has-error", over);
      if (note) {
        note.textContent = over
          ? "550 5.3.4 Message size exceeds fixed maximum message size — split this note into 4 messages."
          : pct > 80
            ? "Almost at the 20 MB line. Quick, before Outlook offers to send a link."
            : "";
      }
      return !over;
    }

    if (area) {
      area.addEventListener("input", measure);
      measure();
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!measure()) {
        if (window.attSfx) window.attSfx("error");
        toast("550 5.3.4", "Attachment too large — application not submitted", "This is the society's most classic failure.");
        return;
      }
      if (!form.checkValidity()) {
        toast("0x80040610", "A few fields are still empty", "Fields marked * are required. Servers are stubborn too.");
        return;
      }
      if (sent) return;
      sent = true;
      var btn = $("button[type=submit]", form);
      if (btn) { btn.disabled = true; btn.textContent = "Submitting…"; }
      setTimeout(function () {
        if (btn) { btn.disabled = false; btn.textContent = "Submit"; }
        toast("202 Accepted", "Queued (this demo site sends nothing for real)", "In production it would deliver your letter in 8 shards.");
        form.reset();
        measure();
      }, 700);
    });
  }

  /* ---------- 8. 彩蛋：单击页脚版本号 ---------- */
  function initEgg() {
    var egg = $("[data-egg]");
    if (!egg) return;
    var clicks = 0;
    egg.style.cursor = "pointer";
    egg.addEventListener("click", function () {
      clicks++;
      if (clicks === 3) {
        if (window.attSfx) window.attSfx("teapot");
        toast("418 I'm a teapot", "You found the easter egg", "Reminder: 20 MB is an Outlook.com policy, not a law of physics.");
        clicks = 0;
      }
    });
  }

  /* ---------- 9. 页脚年份 ---------- */
  function initYear() {
    $$("[data-year]").forEach(function (el) { el.textContent = String(new Date().getFullYear()); });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    initTheme();
    initNav();
    initActiveLink();
    initReveal();
    initCopy();
    initMeter();
    initSizeGuard();
    initEgg();
    initYear();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

/* ==========================================================================
   动效：滚动进度条 + 统计数字跳字（尊重 prefers-reduced-motion）
   ========================================================================== */
(function () {
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ① 顶部滚动进度：铜绿→黄金的细带 */
  var bar = document.createElement("div");
  bar.className = "scroll-progress";
  document.body.appendChild(bar);
  var ticking = false;
  function update() {
    var h = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0).toFixed(2) + "%";
    ticking = false;
  }
  window.addEventListener("scroll", function () {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  window.addEventListener("resize", update);
  update();

  /* ② 统计数字：进视口时从 0 跳到目标值 */
  var nums = [].slice.call(document.querySelectorAll(".stat-num"));
  if (!nums.length || reduce || !("IntersectionObserver" in window)) return;

  function animate(el) {
    var span = el.querySelector("span");
    var suffix = span ? span.outerHTML : "";
    var raw = (span ? el.textContent.replace(span.textContent, "") : el.textContent) || "";
    var text = raw.replace(/[^0-9.]/g, "");
    if (!text) return;
    var target = parseFloat(text);
    if (!isFinite(target)) return;
    var decimals = (text.split(".")[1] || "").length;
    var grouped = target >= 1000;
    var final = decimals ? target.toFixed(decimals) : (grouped ? target.toLocaleString("en-US") : String(target));

    var t0 = performance.now(), dur = 1100;
    function frame(now) {
      var p = Math.min(1, (now - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      var v = target * e;
      var txt = decimals ? v.toFixed(decimals) : String(Math.round(v));
      if (grouped) txt = Number(txt).toLocaleString("en-US");
      el.innerHTML = txt + suffix;
      if (p < 1) requestAnimationFrame(frame);
      else el.innerHTML = final + suffix;
    }
    requestAnimationFrame(frame);
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      animate(en.target);
      io.unobserve(en.target);
    });
  }, { threshold: 0.35 });
  nums.forEach(function (n) { io.observe(n); });
})();

/* ==========================================================================
   动效 · 进阶：终端逐行、卡片错位、色板扫入、鼠标视差
   每个观察目标都有保险丝：3 秒内没进视口也强制显示，绝不留下隐形内容。
   ========================================================================== */
(function () {
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  var targets = [];

  /* ⑪ 终端：给每行编号 */
  [].slice.call(document.querySelectorAll(".terminal .term-body")).forEach(function (body) {
    [].slice.call(body.querySelectorAll(".term-line")).forEach(function (line, i) {
      line.style.setProperty("--i", i);
    });
    body.classList.add("is-typing");
    targets.push(body);
  });

  /* ⑫ 卡片：给每张编号（父级进场后依次播放） */
  [].slice.call(document.querySelectorAll(".grid")).forEach(function (grid) {
    [].slice.call(grid.children).forEach(function (child, i) {
      child.style.setProperty("--i", i);
    });
    targets.push(grid);
  });

  /* ⑭ 色板：段落与页头 */
  [].slice.call(document.querySelectorAll(".section, .page-head")).forEach(function (s) {
    targets.push(s);
  });

  if (!targets.length) return;

  var fired = 0;
  function revealAll() { targets.forEach(function (t) { t.classList.add("is-in"); }); }

  /* 保险丝：无论如何，3 秒后内容必须可见 */
  setTimeout(function () { if (fired < targets.length) revealAll(); }, 3000);

  if (!("IntersectionObserver" in window)) { revealAll(); return; }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      en.target.classList.add("is-in");
      fired++;
      io.unobserve(en.target);
    });
  }, { threshold: 0.2, rootMargin: "0px 0px -6% 0px" });

  targets.forEach(function (t) { io.observe(t); });

  /* ⑬ 鼠标视差：只在精确指针设备上启用 */
  if (window.matchMedia && window.matchMedia("(pointer: fine)").matches) {
    var root = document.documentElement, pending = false, tx = 0, ty = 0;
    window.addEventListener("mousemove", function (e) {
      tx = (e.clientX / window.innerWidth - 0.5) * 2;
      ty = (e.clientY / window.innerHeight - 0.5) * 2;
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        root.style.setProperty("--mx", tx.toFixed(3));
        root.style.setProperty("--my", ty.toFixed(3));
        pending = false;
      });
    }, { passive: true });
  }
})();
