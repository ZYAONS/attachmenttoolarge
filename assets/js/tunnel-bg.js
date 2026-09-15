/* ==========================================================================
   tunnel-bg.js — a procedural light tunnel behind the page

   The reference is a photograph looking down a spiral of rings toward a black hole.
   This is not the photograph; it is the geometry that produced it, redrawn every
   frame so it can move.

   What it is now: alternating bands of tech green and white light, wound into a
   spiral, travelling inward toward the centre. The earlier version grew foliage
   between the rings, which read as butterflies, so the foliage is gone.

   How the motion works:
     · radius is  r = R0 * exp(t * k),  which is what perspective does to evenly
       spaced rings — far ones crowd together, near ones open out;
     · t counts down with time and wraps around, so every band travels toward the
       centre, disappears into the hole, and returns at the rim: the advance;
     · each band is rotated a little more than the one outside it, so the gaps
       between the dashes line up diagonally rather than radially: the spiral. It
       is phase rather than a drawn spiral, which is why it stays coherent while
       it moves;
     · brightness and thickness follow the band's current radius, so a band lights
       up as it comes toward the viewer and dims as it falls into the centre.

   Deterministic (seed 20260913), capped at 2x device pixel ratio, paused when the
   tab is hidden, and prefers-reduced-motion gets one still frame. Nothing fetched:
   no image, no texture, no dependency.
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

  var TAU = Math.PI * 2;
  var GREEN = "79,209,165";        // the site's verdigris
  var WHITE = "236,255,250";

  var seed = 20260913;
  function rnd() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }

  var W = 0, H = 0, DPR = 1, cx = 0, cy = 0, base = 0, maxR = 0;
  var BANDS = 26;
  var GROWTH = 0.175;               // how fast the rings open out with depth
  var phase = 0;

  /* per-band character, fixed once so nothing flickers while it travels */
  var band = [];
  for (var i = 0; i < BANDS; i++) {
    band.push({
      white: i % 2 === 1,                 // alternate: green, white, green, white
      spin: 0.16 + rnd() * 0.14,          // how much further this band turns than the one outside it
      dash: 7 + Math.floor(rnd() * 5),    // segments around the circle
      gap: 0.42 + rnd() * 0.26,           // how much of each segment stays dark
      bright: 0.72 + rnd() * 0.36,
      offset: rnd() * TAU
    });
  }

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
      img.data[i + 3] = 10 + Math.floor(rnd() * 20);
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
    cy = H * 0.46;                        // where the eye expects the vanishing point
    base = Math.min(W, H) * 0.03;
    maxR = base * Math.exp(BANDS * GROWTH);
    draw();
  }

  /** one band: a wide soft glow, then the bright core on top of it */
  function hoop(r, colour, alpha, core, width) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.lineWidth = width * 3.4;
    ctx.strokeStyle = "rgba(" + colour + "," + (alpha * 0.16).toFixed(3) + ")";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.lineWidth = width;
    ctx.strokeStyle = "rgba(" + colour + "," + (alpha * core).toFixed(3) + ")";
    ctx.stroke();
  }

  function draw() {
    var bg = ctx.createRadialGradient(cx, cy, base * 2, cx, cy, Math.max(W, H) * 0.8);
    bg.addColorStop(0, "#050d0a");
    bg.addColorStop(0.5, "#081512");
    bg.addColorStop(1, "#040a08");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    /* far to near, so nearer bands paint over further ones */
    for (var k = BANDS - 1; k >= 0; k--) {
      /* t counts down with time and wraps: every band travels toward the centre */
      var t = ((k - phase) % BANDS + BANDS) % BANDS;
      var r = base * Math.exp(t * GROWTH);
      if (r > maxR) continue;

      var near = Math.min(1, Math.max(0, Math.log(r / base) / Math.log(maxR / base)));
      var b = band[k];

      ctx.save();
      ctx.translate(cx, cy);
      /* the spiral: band k turns further than band k+1, and the whole set keeps
         turning, so the dashes line up diagonally and the pattern winds inward */
      ctx.rotate(b.offset + phase * 0.2 + k * b.spin);

      var width = Math.max(0.6, r * (0.004 + near * 0.013));
      var alpha = (0.06 + near * 0.26) * b.bright;
      hoop(r, b.white ? WHITE : GREEN, b.white ? alpha : alpha * 0.85, b.white ? 0.9 : 0.7, b.white ? width : width * 1.25);

      /* dashes: short arcs, so the band reads as structure rather than a solid hoop */
      ctx.beginPath();
      var seg = TAU / b.dash;
      for (var d = 0; d < b.dash; d++) {
        var a0 = d * seg;
        ctx.arc(0, 0, r, a0, a0 + seg * (1 - b.gap));
        ctx.moveTo(Math.cos(a0 + seg) * r, Math.sin(a0 + seg) * r);
      }
      ctx.lineWidth = width * 2.6;
      ctx.strokeStyle = "rgba(" + (b.white ? WHITE : GREEN) + "," + (alpha * 0.5).toFixed(3) + ")";
      ctx.stroke();
      ctx.restore();
    }

    /* the far end: light falling away into a hole */
    var bloom = ctx.createRadialGradient(cx, cy, base * 0.6, cx, cy, base * 7);
    bloom.addColorStop(0, "rgba(" + GREEN + ",0.10)");
    bloom.addColorStop(0.6, "rgba(" + GREEN + ",0.03)");
    bloom.addColorStop(1, "rgba(" + GREEN + ",0)");
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(cx, cy, base * 7, 0, TAU);
    ctx.fill();

    var hole = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 2.6);
    hole.addColorStop(0, "rgba(0,0,0,0.97)");
    hole.addColorStop(0.5, "rgba(0,0,0,0.7)");
    hole.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = hole;
    ctx.beginPath();
    ctx.arc(cx, cy, base * 2.6, 0, TAU);
    ctx.fill();

    var vig = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.3, cx, cy, Math.max(W, H) * 0.72);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    /* a scrim over the whole thing: the tunnel must never win against the text */
    ctx.fillStyle = "rgba(3,9,7,0.30)";
    ctx.fillRect(0, 0, W, H);

    if (gctx) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.drawImage(grain, 0, 0, W, H);
      ctx.restore();
    }
  }

  var running = false, last = 0, raf = 0;
  function frame(now) {
    if (!running) return;
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    phase += dt * 0.62;                    // inward travel, and the winding with it
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
  window.addEventListener("resize", resize);

  resize();
  if (reduce) draw(); else start();
})();
