/* ==========================================================================
   UNDERSTUDY — 窗外的天气（rain.js）
   --------------------------------------------------------------------------
   这里原来画的是"玻璃挂水"：一颗亮头拖一条尾巴。
   结果它看起来像精子，不像雨。撤了。

   现在画的是**雾**，四个层次：

     1. 夜里的街：远处几盏灯，全部糊成光晕（雾天看不见轮廓）
     2. 雾团：九个大而极淡的圆，缓慢平移，出界就绕回来
     3. 水膜：四条宽而极淡的竖条，慢慢往下淌（是"流下来的一层水"，
        不是一颗颗水珠 —— 所以没有头也没有尾巴）
     4. 玻璃：一层奶白色的薄雾贴在玻璃上，加一次性生成的噪点防色带

   平静、缓慢、不用盯着看。prefers-reduced-motion 时只画一帧。
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

  function rnd(a, b) { return a + Math.random() * (b - a); }

  var puffs = [];      // 雾团
  var films = [];      // 水膜
  var grainPat = null; // 噪点（防色带）

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = host.clientWidth || 320;
    H = host.clientHeight || 240;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function makeGrain() {
    var g = document.createElement("canvas");
    g.width = g.height = 64;
    var gc = g.getContext("2d");
    var img = gc.createImageData(64, 64);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = 128 + (Math.random() * 2 - 1) * 34;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    gc.putImageData(img, 0, 0);
    grainPat = ctx.createPattern(g, "repeat");
  }

  function seed() {
    puffs = [];
    var big = Math.max(W, H);
    for (var i = 0; i < 9; i++) {
      puffs.push({
        x: rnd(-0.15, 1.15) * W,
        y: rnd(0.05, 1.05) * H,
        r: rnd(0.28, 0.68) * big,
        a: rnd(0.05, 0.14),
        vx: rnd(-3.5, 3.5),
        vy: rnd(-1.2, 1.2)
      });
    }
    films = [];
    for (var k = 0; k < 4; k++) {
      films.push({
        x: rnd(0.05, 0.95) * W,
        y: rnd(-H, H),
        w: rnd(12, 30),
        v: rnd(2.2, 5.5),
        a: rnd(0.020, 0.045)
      });
    }
  }

  function drawNight() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1b2531");
    g.addColorStop(0.5, "#151d27");
    g.addColorStop(1, "#101720");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* 远处的灯：雾里只剩光晕，没有轮廓 */
  function drawLights() {
    var lights = [[0.26, 0.74, 0.52, 0.30], [0.72, 0.42, 0.30, 0.13], [0.55, 0.86, 0.36, 0.15]];
    lights.forEach(function (L) {
      var cx = L[0] * W, cy = L[1] * H, rr = L[2] * Math.max(W, H);
      var rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      rg.addColorStop(0, "rgba(255,206,142," + L[3] + ")");
      rg.addColorStop(0.4, "rgba(250,196,138," + (L[3] * 0.35) + ")");
      rg.addColorStop(1, "rgba(240,190,130,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    });
  }

  function drawPuffs(dt) {
    ctx.globalCompositeOperation = "lighter";
    puffs.forEach(function (p) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      var m = p.r * 1.1;
      if (p.x < -m) p.x = W + m; else if (p.x > W + m) p.x = -m;
      if (p.y < -m) p.y = H + m; else if (p.y > H + m) p.y = -m;
      var rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      rg.addColorStop(0, "rgba(196,210,224," + p.a + ")");
      rg.addColorStop(0.55, "rgba(186,202,218," + (p.a * 0.45) + ")");
      rg.addColorStop(1, "rgba(180,196,214,0)");
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.283);
      ctx.fill();
    });
    ctx.globalCompositeOperation = "source-over";
  }

  /* 水膜：宽、极淡、慢慢往下淌 —— 没有头，也没有尾巴 */
  function drawFilms(dt) {
    films.forEach(function (f) {
      f.y += f.v * dt;
      if (f.y - H * 0.5 > H) { f.y = -H * 0.5; f.x = rnd(0.05, 0.95) * W; f.w = rnd(12, 30); }
      var lg = ctx.createLinearGradient(f.x - f.w, 0, f.x + f.w, 0);
      lg.addColorStop(0, "rgba(214,232,246,0)");
      lg.addColorStop(0.5, "rgba(214,232,246," + f.a + ")");
      lg.addColorStop(1, "rgba(214,232,246,0)");
      ctx.fillStyle = lg;
      var hh = H * 1.4;
      ctx.fillRect(f.x - f.w, f.y - hh * 0.5, f.w * 2, hh);
    });
  }

  /* 贴在玻璃上的奶白薄雾 + 一层反光 + 噪点 */
  function drawGlass() {
    var v = ctx.createLinearGradient(0, 0, 0, H);
    v.addColorStop(0, "rgba(226,236,244,0.070)");
    v.addColorStop(0.45, "rgba(226,236,244,0.028)");
    v.addColorStop(1, "rgba(226,236,244,0.050)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);

    var s = ctx.createLinearGradient(0, 0, W, H);
    s.addColorStop(0, "rgba(255,255,255,0.055)");
    s.addColorStop(0.4, "rgba(255,255,255,0.012)");
    s.addColorStop(1, "rgba(255,255,255,0.030)");
    ctx.fillStyle = s;
    ctx.fillRect(0, 0, W, H);

    if (grainPat) {
      ctx.save();
      ctx.globalAlpha = 0.030;
      ctx.globalCompositeOperation = "overlay";
      ctx.fillStyle = grainPat;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  var last = 0, running = false;
  function frame(t) {
    var dt = last ? Math.min((t - last) / 1000, 0.05) : 0.016;
    last = t;
    ctx.clearRect(0, 0, W, H);
    drawNight();
    drawLights();
    drawPuffs(dt);
    drawFilms(dt);
    drawGlass();
    if (!reduce) requestAnimationFrame(frame); else running = false;
  }

  resize();
  makeGrain();
  seed();
  running = !reduce;
  frame(0);
  if (!reduce) requestAnimationFrame(frame);

  var rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(function () { resize(); makeGrain(); seed(); last = 0; if (reduce || !running) frame(0); }, 200);
  });
})();
