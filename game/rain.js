/* ==========================================================================
   UNDERSTUDY — 雨（rain.js）
   --------------------------------------------------------------------------
   之前那版是 repeating-linear-gradient 画的斜线，滚动起来像贴纸。
   这一版画的是**玻璃上的水**，四层叠出来：

     1. 背景：夜里的街，远处有一点暖光（雨里的一切都糊）
     2. 挂水：不动的细小水珠，玻璃本身的湿
     3. 行水：会长大、到临界就下滑的水滴，滑过的地方留下一条会抖的痕
     4. 细流：几条一直在缓慢蜿蜒的水线

   全部用 canvas，无图片资源。prefers-reduced-motion 时只画一帧静态的。
   ========================================================================== */
(function () {
  "use strict";
  var host = document.querySelector("[data-rain]");
  if (!host) return;

  var canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  host.appendChild(canvas);
  var ctx = canvas.getContext("2d");
  var W = 0, H = 0, dpr = 1;

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = host.clientWidth || 320;
    H = host.clientHeight || 240;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------------- 粒子 ---------------- */
  var beads = [];      // 挂水：不动的
  var drops = [];      // 行水：会下滑的
  var rivulets = [];   // 细流

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function makeBead() {
    return { x: rnd(0, W), y: rnd(0, H), r: rnd(0.7, 2.4), a: rnd(0.10, 0.34) };
  }

  function makeDrop(atTop) {
    return {
      x: rnd(0, W),
      y: atTop ? rnd(-H * 0.3, 0) : rnd(0, H),
      r: rnd(1.6, 4.2),
      v: 0,                      // 速度由"重量"推起来
      grow: rnd(0.02, 0.10),     // 每秒长大多少
      wob: rnd(0.6, 2.4),        // 摆动的频率
      phase: rnd(0, 6.28),
      trail: [],                 // 滑过的位置（用来画痕）
      life: 0
    };
  }

  function seed() {
    beads = []; drops = []; rivulets = [];
    var beadCount = Math.round((W * H) / 1500);
    for (var i = 0; i < beadCount; i++) beads.push(makeBead());
    for (var d = 0; d < 26; d++) drops.push(makeDrop(false));
    for (var r = 0; r < 4; r++) {
      rivulets.push({
        x: rnd(0.1, 0.9) * W, y: rnd(-H, 0), v: rnd(6, 16),
        amp: rnd(3, 11), freq: rnd(0.6, 1.6), phase: rnd(0, 6.28), w: rnd(1.1, 2.6)
      });
    }
  }

  /* ---------------- 画面 ---------------- */
  function drawScene() {
    // 1) 夜里的街：垂直渐变 + 一团远处的暖光（被雨糊掉）
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#16202b");
    g.addColorStop(0.55, "#101823");
    g.addColorStop(1, "#0a0f16");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    var lampX = W * 0.28, lampY = H * 0.72;
    var lg = ctx.createRadialGradient(lampX, lampY, 0, lampX, lampY, Math.max(W, H) * 0.5);
    lg.addColorStop(0, "rgba(255,206,140,0.20)");
    lg.addColorStop(0.35, "rgba(255,190,120,0.06)");
    lg.addColorStop(1, "rgba(255,190,120,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, W, H);

    // 远处一点模糊的窗（对面楼）
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = "#cbb489";
    ctx.fillRect(W * 0.63, H * 0.36, 22, 16);
    ctx.fillRect(W * 0.72, H * 0.52, 16, 12);
    ctx.globalAlpha = 1;
  }

  function drawBeads() {
    beads.forEach(function (b) {
      // 挂水：亮边 + 中心暗，才像贴在玻璃上的一颗水
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, 6.283);
      ctx.fillStyle = "rgba(198,222,240," + b.a * 0.5 + ")";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.28, b.y - b.r * 0.28, b.r * 0.52, 0, 6.283);
      ctx.fillStyle = "rgba(255,255,255," + b.a * 0.55 + ")";
      ctx.fill();
    });
  }

  function drawRivulets(dt) {
    rivulets.forEach(function (r) {
      r.phase += dt * r.freq;
      r.y += r.v * dt;
      if (r.y > H + 40) { r.y = -40; r.x = rnd(0.1, 0.9) * W; }
      ctx.beginPath();
      for (var k = 0; k <= 18; k++) {
        var yy = r.y - k * 10;
        var xx = r.x + Math.sin(r.phase + k * 0.35) * r.amp;
        if (k === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.strokeStyle = "rgba(206,228,244,0.20)";
      ctx.lineWidth = r.w;
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = r.w * 0.4;
      ctx.stroke();
    });
  }

  function drawDrops(dt) {
    /* 一颗水滴的一生：挂在那儿慢慢变大 → 够重了开始滑 → 滑出一条会抖的痕 →
       到画面底部消失（或在中途被另一颗吃掉，原型里省略这一步）。 */
    drops.forEach(function (d) {
      d.life += dt;
      d.r += d.grow * dt;
      if (d.r > 2.6 && d.v < 0.5) d.v = rnd(8, 22);          // 够重了，开始滑

      if (d.v > 0) {
        d.phase += dt * d.wob;
        var dx = Math.sin(d.phase) * 0.7;                     // 左右轻微摆
        d.x += dx;
        d.y += d.v * dt;
        d.v += 7 * dt;                                        // 越滑越快
        d.trail.push({ x: d.x, y: d.y, r: d.r });
        if (d.trail.length > 42) d.trail.shift();
      }

      // 痕：一条细的、上宽下窄的湿线
      if (d.trail.length > 2) {
        ctx.beginPath();
        ctx.moveTo(d.trail[0].x, d.trail[0].y - d.r);
        for (var i = 1; i < d.trail.length; i++) ctx.lineTo(d.trail[i].x, d.trail[i].y - d.trail[i].r);
        ctx.strokeStyle = "rgba(214,234,248,0.19)";
        ctx.lineWidth = Math.max(1, d.r * 0.5);
        ctx.lineCap = "round";
        ctx.stroke();
      }

      // 水滴本体
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, d.r * 0.86, d.r * 1.12, 0, 0, 6.283);
      ctx.fillStyle = "rgba(188,214,234,0.30)";
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(d.x - d.r * 0.25, d.y - d.r * 0.34, d.r * 0.34, d.r * 0.42, 0, 0, 6.283);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fill();

      // 出界就换一颗新的，从上面重新落
      if (d.y - d.r > H + 8) {
        var fresh = makeDrop(true);
        for (var k in fresh) d[k] = fresh[k];
      }
    });
  }

  /* 玻璃反光：一道斜的、很淡的室内光带，压在所有东西上面 */
  function drawGlass() {
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "rgba(255,255,255,0.05)");
    g.addColorStop(0.35, "rgba(255,255,255,0.015)");
    g.addColorStop(0.55, "rgba(255,255,255,0)");
    g.addColorStop(1, "rgba(255,255,255,0.03)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  var last = 0;
  function frame(t) {
    var dt = last ? Math.min((t - last) / 1000, 0.05) : 0.016;
    last = t;
    ctx.clearRect(0, 0, W, H);
    drawScene();
    drawBeads();
    drawRivulets(dt);
    drawDrops(dt);
    drawGlass();
    if (!reduce) requestAnimationFrame(frame);
  }

  resize();
  seed();
  requestAnimationFrame(frame);

  var rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(function () { resize(); seed(); if (reduce) frame(0); }, 200);
  });
})();
