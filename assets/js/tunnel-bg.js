/* ==========================================================================
   tunnel-bg.js — a procedural tunnel behind the page

   The reference is a photograph looking down a spiral of rings, foliage growing
   between them, a black hole at the far end. This is not the photograph: it is
   the geometry that produced it, drawn every frame so it can move.

   How it works, and why it looks like depth rather than flat circles:
     · rings are placed by  r = R0 * exp(t * k),  which is what perspective does to
       evenly spaced rings — far ones crowd together, near ones open out;
     · `phase` slides that distribution inward, so the whole set flows toward the
       centre the way it would if the camera were moving forward;
     · each ring carries its own seeded clusters of leaves, so the foliage stays
       attached to its ring as it travels instead of flickering;
     · thickness, brightness and blur all grow with the radius, which is the other
       half of the depth cue.
   Everything is drawn from the seed 20260913, so the same tunnel comes back every
   load. It pauses when the tab is hidden, and respects prefers-reduced-motion by
   drawing one still frame instead of animating.
   ========================================================================== */
(function () {
  if (typeof document === "undefined") return;

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var canvas = document.createElement("canvas");
  canvas.className = "tunnel-bg";
  canvas.setAttribute("aria-hidden", "true");
  var ctx = canvas.getContext ? canvas.getContext("2d") : null;
  if (!ctx) return;

  var style = document.createElement("style");
  style.textContent = ".tunnel-bg{position:fixed;inset:0;width:100%;height:100%;" +
    "z-index:-1;pointer-events:none;display:block}";
  document.head.appendChild(style);
  (document.body || document.documentElement).insertBefore(canvas, document.body ? document.body.firstChild : null);

  /* ---------- a small deterministic generator, so the tunnel is the same ---------- */
  var seed = 20260913;
  function rnd() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }

  var W = 0, H = 0, DPR = 1, cx = 0, cy = 0, base = 0;
  var RINGS = 15;
  var GROWTH = 0.42;                 // how fast rings open out with depth
  var phase = 0;

  /* per-ring character: how many leaf clusters, how light the structure is */
  var ring = [];
  for (var i = 0; i < RINGS + 4; i++) {
    var clusters = [];
    var n = 3 + Math.floor(rnd() * 5);
    for (var c = 0; c < n; c++) {
      clusters.push({ a: rnd() * Math.PI * 2, r: 0.82 + rnd() * 0.3, s: 0.5 + rnd() * 0.9, d: rnd() * 0.5 + 0.5 });
    }
    ring.push({ clusters: clusters, light: 0.35 + rnd() * 0.5, dash: 0.5 + rnd() * 0.6, turn: 0.06 + rnd() * 0.12 });
  }

  /* a grain plate, generated once: the photograph is grainy and flat colour is not */
  var grain = document.createElement("canvas");
  var gctx = null;
  (function () {
    grain.width = 128; grain.height = 128;
    gctx = grain.getContext("2d");
    if (!gctx) return;
    var img = gctx.createImageData(128, 128);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = 120 + Math.floor(rnd() * 90);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 12 + Math.floor(rnd() * 22);
    }
    gctx.putImageData(img, 0, 0);
  })();

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx = W * 0.5;
    cy = H * 0.46;                   // a touch above centre, where the eye expects the vanishing point
    base = Math.min(W, H) * 0.052;   // radius of the innermost ring
    draw();
  }

  function leaf(x, y, s, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rnd() * Math.PI);
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.7, s * 0.75, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(96,132,92," + alpha.toFixed(3) + ")";
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    /* base: deep green-black, slightly lighter toward the rim */
    var bg = ctx.createRadialGradient(cx, cy, base * 2, cx, cy, Math.max(W, H) * 0.75);
    bg.addColorStop(0, "#07100d");
    bg.addColorStop(0.55, "#0b1a15");
    bg.addColorStop(1, "#050b09");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    /* the rings, far to near */
    for (var i = RINGS - 1; i >= 0; i--) {
      var t = i + phase;
      var r = base * Math.exp(t * GROWTH);
      if (r > Math.max(W, H) * 1.25) continue;
      var depth = i / RINGS;                     // 0 = nearest, 1 = furthest
      var near = 1 - depth;
      var rr = ring[i % ring.length];
      var alpha = (0.05 + rr.light * 0.22) * (0.35 + near * 0.65);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(phase * rr.turn);

      /* the structure: a ring of light, dashed like the walkway in the photograph */
      ctx.beginPath();
      ctx.setLineDash([r * 0.5 * rr.dash, r * 0.22]);
      ctx.lineWidth = Math.max(0.6, r * 0.018);
      ctx.strokeStyle = "rgba(206,224,206," + alpha.toFixed(3) + ")";
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      /* a darker ring just inside it, to read as the wall of the tunnel */
      ctx.beginPath();
      ctx.lineWidth = Math.max(1, r * 0.03);
      ctx.strokeStyle = "rgba(6,12,10," + (0.18 + near * 0.3).toFixed(3) + ")";
      ctx.arc(0, 0, r * 0.985, 0, Math.PI * 2);
      ctx.stroke();

      /* foliage attached to this ring */
      if (r > base * 1.6) {
        for (var k = 0; k < rr.clusters.length; k++) {
          var cl = rr.clusters[k];
          ctx.save();
          ctx.rotate(cl.a);
          var lx = r * cl.r, ly = 0;
          var size = Math.max(1.2, r * 0.05 * cl.s * (0.4 + near));
          for (var m = 0; m < 4; m++) {
            leaf(lx + (rnd() - 0.5) * size * 2.6, ly + (rnd() - 0.5) * size * 2.6, size, (0.10 + near * 0.22) * cl.d);
          }
          ctx.restore();
        }
      }
      ctx.restore();
    }

    /* the far end: a hole, soft-edged so it reads as depth rather than a dot */
    var hole = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 1.5);
    hole.addColorStop(0, "rgba(0,0,0,0.96)");
    hole.addColorStop(0.55, "rgba(0,0,0,0.72)");
    hole.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = hole;
    ctx.beginPath();
    ctx.arc(cx, cy, base * 1.5, 0, Math.PI * 2);
    ctx.fill();

    /* vignette + grain, to sit under text without fighting it */
    var vig = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.28, cx, cy, Math.max(W, H) * 0.72);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    if (gctx) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.drawImage(grain, 0, 0, W, H);
      ctx.restore();
    }
  }

  /* ---------- the animation ---------- */
  var running = false, last = 0, raf = 0;
  function frame(now) {
    if (!running) return;
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    phase += dt * 0.055;                     // the walk into the tunnel
    draw();
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (running || reduce) return;
    running = true;
    last = performance.now ? performance.now() : Date.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else start();
  });
  window.addEventListener("resize", function () { resize(); });

  resize();
  if (reduce) draw(); else start();
})();
