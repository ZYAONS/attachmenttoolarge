/* ==========================================================================
   UNDERSTUDY — 逻辑（game.js）
   --------------------------------------------------------------------------
   这个文件**不该由人来改**。所有文字都在 content.js 里。
   它只做四件事：把内容画出来、收玩家的选择、算漂移、把这一天结算掉。

   一天的结构（数据驱动）：
     检索 search → 会面 meeting → （可选）删改 redaction → 信 letter → 审计 audit → 下一天
   ========================================================================== */
(function () {
  "use strict";

  var C = window.UNDERSTUDY_CONTENT;
  if (!C) { console.error("content.js 没有加载"); return; }
  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 九十天的日程 ----------------
     写好的日子用正式内容；没写的按 content.structure 生成占位 ——
     这样整条时间线是走得通的，审计里会告诉你这一天属于哪一幕、有什么里程碑。 */
  function actOf(n) {
    var acts = (C.structure && C.structure.acts) || [];
    for (var i = 0; i < acts.length; i++) if (n >= acts[i].from && n <= acts[i].to) return acts[i];
    return null;
  }
  function buildSchedule() {
    var st = C.structure || {};
    var total = st.totalDays || 90;
    var byN = {};
    (C.days || []).forEach(function (d) { byN[d.n] = d; });
    var out = [];
    for (var n = 1; n <= total; n++) {
      if (byN[n]) { byN[n].act = actOf(n); byN[n].milestone = (st.milestones || {})[n]; out.push(byN[n]); continue; }
      var act = actOf(n);
      var ms = (st.milestones || {})[n];
      var ph = st.placeholder || {};
      out.push({
        n: n, label: "第 " + n + " 天", clock: "07:40", placeholder: true,
        act: act, milestone: ms,
        searchGoal: 0, searchObjects: [],
        meeting: { who: "（这一天还没有写）", questions: [ph.question || { q: "（待撰写）", chips: [] }] },
        letter: null,
        audit: { extra: "第 " + ((act && act.n) || "?") + " 幕「" + ((act && act.name) || "未命名") + "」"
          + (ms ? " · 里程碑：" + ms : "") + "　（待人工撰写）" }
      });
    }
    return out;
  }
  /* ---------------- 状态 ---------------- */
  var S = {
    dayIndex: 0,
    drift: 0,
    gaps: 0,
    budget: C.meta.budgetPerNight || 3,
    found: [],
    entries: [],
    phase: "search",
    qIndex: 0,
    sound: false,
    track: null,
    days: null
  };

  S.days = buildSchedule();
  function day() { return S.days[S.dayIndex]; }
  function bands() { return C.meta.driftBands || { mixed: 30, yours: 65 }; }
  function handFor() {
    if (S.drift < bands().mixed) return "his";
    if (S.drift < bands().yours) return "mixed";
    return "yours";
  }

  /* ---------------- 账本 ---------------- */
  function log(text, opts) {
    opts = opts || {};
    S.entries.push({ day: day() ? day().n : 1, text: text, repaired: false, voided: false });
    if (opts.drift) S.drift = Math.max(0, Math.min(C.meta.purgeAt, S.drift + opts.drift));
    if (opts.gap) S.gaps += opts.gap;
    renderLedger();
    return S.entries[S.entries.length - 1];
  }

  function renderLedger() {
    var pages = $("pages");
    if (!pages) return;
    pages.innerHTML = S.entries.map(function (e, i) {
      var cls = "entry " + (i === S.entries.length - 1 ? handFor() : "his");
      if (e.repaired) cls += " repaired";
      if (e.voided) cls += " void";
      return '<div class="' + cls + '"><span class="day">第 ' + e.day + ' 天</span>' + e.text + "</div>";
    }).join("") || '<div class="entry his">' + (C.ui.emptyLedger || "") + "</div>";

    var lbl = $("driftlabel");
    if (lbl) {
      lbl.textContent = (C.ui.driftLabel || "漂移 %P%").replace("%P%", Math.round(S.drift));
      lbl.style.color = S.drift < bands().mixed ? "rgba(231,224,207,.6)"
        : S.drift < bands().yours ? "#e0c179" : "#e2a08f";
    }
    if ($("budget")) $("budget").textContent = S.budget;
    if ($("gaps")) $("gaps").textContent = (C.ui.gaps || "%N").replace("%N", S.gaps);
  }

  /* ---------------- 桌面：按当天内容画 ---------------- */
  var SLOTS = [
    { l: "9%", b: "24%", w: 104, h: 78 }, { l: "23%", b: "34%", w: 96, h: 70 },
    { l: "36%", b: "21%", w: 26, h: 30 }, { l: "46%", b: "26%", w: 118, h: 82 },
    { l: "59%", b: "20%", w: 34, h: 52 }, { l: "67%", b: "30%", w: 46, h: 20 },
    { l: "16%", b: "9%", w: 104, h: 64 }, { l: "31%", b: "6%", w: 92, h: 70 },
    { l: "45%", b: "5%", w: 112, h: 86 }, { l: "62%", b: "9%", w: 90, h: 66 },
    { l: "75%", b: "20%", w: 84, h: 62 }, { l: "52%", b: "16%", w: 88, h: 64 }
  ];

  function objDef(id) {
    var base = C.objects[id] || {};
    var over = (day() && day().objectsOverride && day().objectsOverride[id]) || {};
    for (var k in over) base[k] = over[k];
    return base;
  }

  function renderDesk() {
    var d = day();
    if (!d) return;
    // 清掉动态生成的
    document.querySelectorAll(".obj[data-dynamic]").forEach(function (n) { n.remove(); });
    // 全部先隐藏
    document.querySelectorAll(".obj").forEach(function (n) { n.style.display = "none"; });

    d.searchObjects.forEach(function (id, i) {
      var def = objDef(id);
      var el = $(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        el.className = "obj";
        el.setAttribute("data-dynamic", "1");
        el.setAttribute("role", "button");
        el.setAttribute("tabindex", "0");
        var s = SLOTS[i % SLOTS.length];
        el.style.cssText = "left:" + s.l + ";bottom:" + s.b + ";width:" + s.w + "px;height:" + s.h + "px;" +
          "background:#e7e0cf;box-shadow:0 6px 15px rgba(0,0,0,.5);border-radius:2px";
        el.innerHTML = '<span class="label"></span>';
        document.querySelector(".room").appendChild(el);
      }
      el.style.display = "";
      var lab = el.querySelector(".label");
      if (lab) lab.textContent = def.title || id;
      el.classList.toggle("found", S.found.indexOf(id) >= 0);
      if (def.birthday) el.setAttribute("data-birthday", "1"); else el.removeAttribute("data-birthday");
      el.onclick = function () { inspect(id); };
      el.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inspect(id); } };
    });
    $("foundcount").textContent = S.found.length;
    $("daylabel").textContent = d.n;
    $("dayclock").textContent = d.clock || "";
  }

  /* ---------------- 检索 ---------------- */
  function inspect(id) {
    var def = objDef(id);
    $("sheet-title").textContent = def.title || id;
    $("sheet-meta").textContent = def.meta || "";
    $("sheet-body").innerHTML = def.body || "";
    $("sheet-hint").textContent = def.hint || "";
    $("loupe").classList.add("on");

    if (def.birthday && S.found.indexOf(id) < 0 && S.phase === "search") {
      S.found.push(id);
      var el = $(id); if (el) el.classList.add("found");
      $("foundcount").textContent = S.found.length;
      if (S.found.length >= (day().searchGoal || 1)) {
        $("crttext").textContent = crtLines([C.ui.searchDone, C.ui.footsteps]);
      }
    }
  }

  function closeLoupe() {
    $("loupe").classList.remove("on");
    if (S.phase === "search" && (day().searchGoal || 0) > 0 && S.found.length >= day().searchGoal) {
      S.phase = "meet";
      setTimeout(startMeet, 450);
    }
  }

  /* ---------------- 会面 ---------------- */
  function startMeet() {
    var m = day().meeting;
    if (!m) return nextPhase();
    S.qIndex = 0;
    $("meet").classList.add("on");
    showQuestion();
  }

  function showQuestion() {
    var m = day().meeting;
    var q = m.questions[S.qIndex];
    if (!q) return endMeet();
    $("meet-who").textContent = m.who + (q.trap ? " · 这一题档案里没有答案" : " · 第 " + (S.qIndex + 1) + " 问");
    $("meet-line").textContent = q.q;
    $("ammo").innerHTML = q.chips.map(function (c, i) {
      var tag = c.safe === true ? "他可能会这么说" : c.safe === false ? "风险" : "档案中无记录";
      return '<button class="chip' + (c.safe === false ? " risky" : "") + '" data-i="' + i + '" type="button">' +
        c.t + "<small>" + tag + "</small></button>";
    }).join("");
  }

  function answer(i) {
    var q = day().meeting.questions[S.qIndex];
    if (!q) return;
    var c = q.chips[i];
    if (!c) return;
    log("她说：「" + q.q + "」<br>我说：「" + c.t + "」<br><span style='color:#8b8371;font-size:13px'>" +
        (c.note || "") + "</span>", { drift: c.drift || 0 });
    S.qIndex++;
    if (S.qIndex >= day().meeting.questions.length) endMeet(); else showQuestion();
  }

  function endMeet() {
    $("meet").classList.remove("on");
    nextPhase();
  }

  /* ---------------- 删改 ---------------- */
  function showRedaction() {
    var r = day().redaction;
    $("meet-who").textContent = "共享档案 · 你自己决定";
    $("meet-line").textContent = r.prompt;
    $("ammo").innerHTML = r.options.map(function (o, i) {
      return '<button class="chip' + (o.risky ? " risky" : "") + '" data-redact="' + i + '" type="button">' +
        o.t + "<small>" + (o.gap ? "会留下档案缺口" : "不留缺口") + "</small></button>";
    }).join("");
    $("meet").classList.add("on");
  }

  function redact(i) {
    var r = day().redaction;
    if (!r) return;
    var o = r.options[i];
    if (!o) return;
    log(o.log || o.t, { drift: o.drift || 0, gap: o.gap || 0 });
    $("meet").classList.remove("on");
    nextPhase();
  }

  /* ---------------- 信 ---------------- */
  function showLetter() {
    var L = day().letter;
    if (!L) return nextPhase();
    $("letter-from").textContent = L.from || "";
    $("letter-body").innerHTML = L.paragraphs.map(function (p) { return "<p>" + p + "</p>"; }).join("");
    $("letter-act").innerHTML = L.choices.map(function (ch, i) {
      return '<button data-letter="' + i + '" type="button">' + ch.t + "</button>";
    }).join("");
    $("letter").classList.add("on");
  }

  function letterChoice(i) {
    var ch = day().letter.choices[i];
    if (!ch) return;
    log(ch.log || ch.t, { drift: ch.drift || 0 });
    $("letter").classList.remove("on");
    nextPhase();
  }

  /* ---------------- 一天之间的推进 ---------------- */
  function nextPhase() {
    var d = day();
    if (S.phase === "meet") {
      if (d.redaction) { S.phase = "redact"; return showRedaction(); }
      S.phase = "letter";
    } else if (S.phase === "redact") {
      S.phase = "letter";
    } else if (S.phase === "letter") {
      S.phase = "audit";
      return setTimeout(runAudit, 500);
    } else if (S.phase === "search") {
      S.phase = "meet";
      return setTimeout(startMeet, 300);
    }
    if (S.phase === "letter") return showLetter();
    nextPhase();
  }

  /* ---------------- 审计 ---------------- */
  function runAudit() {
    var d = day();
    var out = $("printout");
    out.innerHTML = "";
    $("audit").classList.add("on");
    var lines = [
      "MERIDIAN 连续性服务 / HALO CARE 转呈",
      "────────────────────────────────",
      "档案：" + C.meta.uid + "　　验证期：" + d.label,
      "检索：完成（" + S.found.length + "/" + (d.searchGoal || 1) + "）",
      "生活会面：完成",
      "档案缺口：" + S.gaps + " 处",
      "────────────────────────────────",
      "漂移值：<span class='drift'>" + Math.round(S.drift) + "%</span>",
      "结论：<b>" + (S.drift < bands().mixed ? "在容许范围内。继续。" : "超出容许范围。已记录。") + "</b>",
      "",
      "您的验证期仍在进行中。感谢您的配合。"
    ];
    if (d.audit && d.audit.extra) lines.push(d.audit.extra);
    var i = 0;
    (function tick() {
      if (i < lines.length) { out.innerHTML += lines[i] + "<br>"; i++; setTimeout(tick, 170); }
      else {
        var hasNext = S.dayIndex + 1 < S.days.length;
        var nd = hasNext ? S.days[S.dayIndex + 1] : null;
        var nlabel = nd
          ? (C.ui.nextDay || "进入第 %N 天").replace("%N", nd.n)
            + (nd.act ? "（第 " + nd.act.n + " 幕 · " + nd.act.name + (nd.milestone ? " · " + nd.milestone : "") + "）" : "")
          : "（已到最后一天）";
        out.innerHTML += "<div class='next'><button id='nextbtn' type='button'>" + nlabel + "</button></div>";
        var b = $("nextbtn");
        if (b) b.addEventListener("click", function () { hasNext ? nextDay() : closeAudit(); });
      }
    })();
  }

  function closeAudit() {
    $("audit").classList.remove("on");
    var d = day();
    if (d.nightAdds) {
      var na = d.nightAdds;
      C.objects[na.id] = { title: na.title, meta: na.meta, body: na.body, hint: na.hint, birthday: false };
      if (!$(na.id)) {
        var el = document.createElement("div");
        el.id = na.id; el.className = "obj"; el.setAttribute("data-dynamic", "1");
        el.style.cssText = "left:62%;bottom:4%;width:96px;height:70px;background:#4b3a2a;transform:rotate(-6deg);box-shadow:0 6px 16px rgba(0,0,0,.6)";
        el.innerHTML = '<span class="label">' + (na.label || na.title) + "</span>";
        document.querySelector(".room").appendChild(el);
        el.onclick = function () { inspect(na.id); };
      }
      $("crttext").textContent = crtLines(["桌上多了一样东西。", "不在训练集内。"]);
    }
    S.phase = "done";
  }

  function nextDay() {
    S.dayIndex = Math.min(S.dayIndex + 1, S.days.length - 1);
    S.phase = "search";
    S.found = [];
    S.qIndex = 0;
    S.budget = C.meta.budgetPerNight || 3;     // 每晚刷新整理额度
    $("audit").classList.remove("on");
    $("letter").classList.remove("on");
    $("meet").classList.remove("on");
    renderDesk();
    renderLedger();
    $("crttext").textContent = crtLines([C.meta.uid, "验证期 " + day().label, "检索中…"]);
  }

  /* ---------------- CRT 文本 ---------------- */
  function crtLines(arr) {
    return [C.meta.uid, "验证期 " + (day() ? day().label : ""), "────────────────"]
      .concat(arr.filter(Boolean)).join("\n");
  }

  /* ---------------- 漂移 → 音乐 ---------------- */
  /* 参数化引擎按漂移换气：低漂移是那条能无限循环的铺底，中段换成后摇，
     高漂移回到铺底但音量压低 —— "他越来越不像他" 听得出但不喧哗。 */
  function trackForDrift() {
    if (S.drift < bands().mixed) return "lofi";
    if (S.drift < bands().yours) return "postrock";
    return "lofi";
  }
  function applyMusic() {
    var want = trackForDrift();
    S.track = want;
    if (!S.sound || !window.ATTMusic) return;
    try { window.ATTMusic.selectTrack(want); window.ATTMusic.start(); } catch (e) { /* 无声环境 */ }
  }

  function toggleSound() {
    var btn = $("sound");
    try {
      if (!window.ATTMusic) { btn.textContent = C.ui.soundUnavailable; return; }
      if (!S.sound) {
        S.sound = true; btn.textContent = C.ui.soundOn;
        applyMusic();
      } else {
        S.sound = false; btn.textContent = C.ui.soundOff;
        window.ATTMusic.stop();
      }
    } catch (e) { btn.textContent = C.ui.soundUnavailable; }
  }

  /* ---------------- 事件 ---------------- */
  $("loupeclose").addEventListener("click", closeLoupe);
  $("loupe").addEventListener("click", function (e) { if (e.target === $("loupe")) closeLoupe(); });
  $("ammo").addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("button") : null;
    if (!t) return;
    if (t.hasAttribute("data-redact")) return redact(parseInt(t.getAttribute("data-redact"), 10));
    answer(parseInt(t.getAttribute("data-i"), 10));
  });
  $("letter-act").addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("button") : null;
    if (t) letterChoice(parseInt(t.getAttribute("data-letter"), 10));
  });
  $("openledger").addEventListener("click", function () { $("ledger").classList.toggle("on"); });
  $("closeledger").addEventListener("click", function () { $("ledger").classList.remove("on"); });
  $("sound").addEventListener("click", toggleSound);
  $("reset").addEventListener("click", function () { location.reload(); });
  if ($("driftup")) $("driftup").addEventListener("click", function () {
    S.drift = Math.min(C.meta.purgeAt, S.drift + 20); renderLedger(); applyMusic();
  });
  $("repair").addEventListener("click", function () {
    if (S.budget <= 0 || !S.entries.length) return;
    var last = S.entries[S.entries.length - 1];
    if (last.repaired) return;
    last.repaired = true;
    S.budget--;
    S.drift = Math.max(0, S.drift - 4);
    renderLedger();
  });
  window.addEventListener("keydown", function (e) {
    if (e.key === "l" || e.key === "L") $("ledger").classList.toggle("on");
    if (e.key === "Escape") closeLoupe();
  });

  /* ---------------- 启动 ---------------- */
  renderDesk();
  renderLedger();
  $("crttext").textContent = crtLines(["检索中…"]);

  /* ---------------- 自动化测试接口 ---------------- */
  window.__game = {
    state: function () {
      return {
        day: day() ? day().n : 0, days: S.days.length, drift: Math.round(S.drift), gaps: S.gaps,
        found: S.found.slice(), phase: S.phase, entries: S.entries.length,
        answers: S.qIndex, hand: handFor(), budget: S.budget, track: S.track || trackForDrift(),
        totalDays: S.days.length
      };
    },
    content: C,
    inspect: inspect, closeLoupe: closeLoupe, answer: answer, redact: redact,
    letter: letterChoice, audit: runAudit, closeAudit: closeAudit, nextDay: nextDay,
    repair: function () { $("repair").click(); },
    pushDrift: function (n) { S.drift = Math.min(C.meta.purgeAt, S.drift + (n || 20)); renderLedger(); applyMusic(); },
    ledgerText: function () { return ($("pages") || {}).textContent || ""; }
  };
})();
