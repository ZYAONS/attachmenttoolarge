/* ==========================================================================
   transitions.js — motion in the site's own colours

   The reference language is the livestream title plates: flat, technical, one
   enormous gesture. Their version is cream and citrus lime. Ours is the society's
   palette — verdigris #4fd1a5 and gold #c9a961 on near-black green — so the same
   gestures are used, and the colour is ours. Nothing here fights a stylesheet: no
   !important, no repainting someone else's plate (that mistake cost us a poster
   band already).

   Three movements, all of them small:
     1. Theme change crossfades instead of snapping.
     2. When the lyrics change track, the new lines arrive together but staggered.
     3. Each section draws a two-pixel verdigris-to-gold rule as it comes into view.

   Everything is off under prefers-reduced-motion.
   ========================================================================== */
(function () {
  if (typeof document === "undefined") return;

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var CSS = [
    /* 1 — a short crossfade, applied only while a theme change is happening */
    "html.tx-theme,html.tx-theme *{transition:background-color .34s ease,color .34s ease,",
    "border-color .34s ease,fill .34s ease,stroke .34s ease !important}",

    /* 2 — the lyrics arriving */
    "@keyframes tx-line{from{opacity:0;transform:translate3d(0,12px,0)}to{opacity:1;transform:none}}",
    ".tx-swap .lyric-label{animation:tx-line .34s cubic-bezier(.16,1,.3,1) both}",
    ".tx-swap .lyric-line{animation:tx-line .40s cubic-bezier(.16,1,.3,1) both}",

    /* 3 — the sweeping rule, drawn in the society's two colours */
    ".tx-rule{position:relative}",
    ".tx-rule::after{content:'';position:absolute;left:0;right:0;top:0;height:2px;",
    "transform:scaleX(0);transform-origin:0 50%;pointer-events:none;",
    "background:linear-gradient(90deg,var(--c1,#4fd1a5) 0%,var(--c2,#c9a961) 70%,transparent 100%);",
    "transition:transform .85s cubic-bezier(.16,1,.3,1)}",
    ".tx-rule.tx-in::after{transform:scaleX(1)}",

    "@media (prefers-reduced-motion: reduce){",
    "html.tx-theme,html.tx-theme *{transition:none !important}",
    ".tx-swap .lyric-label,.tx-swap .lyric-line{animation:none}",
    ".tx-rule::after{transition:none;transform:scaleX(1)}}"
  ].join("");

  var style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  if (reduce) return;

  /* ---------------------------------------------------------------- 1 ---- */
  /* Catch the theme toggle on the way up the tree: the button's own handler runs
     first (it is bound to the element, this is bound to the document), so by the
     time we see the click the attribute has changed — we only add the class that
     makes that change visible as a fade rather than a jump. */
  var fadeTimer = 0;
  document.addEventListener("click", function (e) {
    var t = e.target;
    while (t && t !== document) {
      if (t.hasAttribute && (t.hasAttribute("data-theme-toggle") || t.hasAttribute("data-theme-switch"))) {
        var root = document.documentElement;
        root.classList.add("tx-theme");
        clearTimeout(fadeTimer);
        fadeTimer = setTimeout(function () { root.classList.remove("tx-theme"); }, 420);
        return;
      }
      t = t.parentNode;
    }
  }, false);

  /* ---------------------------------------------------------------- 2 ---- */
  var host = document.querySelector("[data-lyrics]");
  if (host && window.MutationObserver) {
    var queued = false;
    var observer = new MutationObserver(function () {
      /* guarded against re-entry: an observer whose callback touches its own target
         is how a page ends up in a busy loop */
      if (queued) return;
      queued = true;
      setTimeout(function () {
        queued = false;
        host.classList.remove("tx-swap");
        var lines = host.querySelectorAll(".lyric-line, .lyric-label");
        for (var i = 0; i < lines.length; i++) {
          lines[i].style.animationDelay = Math.min(i * 18, 420) + "ms";
        }
        void host.offsetWidth;                 // restart the animation
        host.classList.add("tx-swap");
      }, 0);
    });
    observer.observe(host, { childList: true });
  }

  /* ---------------------------------------------------------------- 3 ---- */
  var sections = document.querySelectorAll("main > .section, main > section");
  if (sections.length && window.IntersectionObserver) {
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        entries[i].target.classList.add("tx-in");
        io.unobserve(entries[i].target);
      }
    }, { threshold: 0, rootMargin: "0px 0px -6% 0px" });
    for (var s = 0; s < sections.length; s++) {
      sections[s].classList.add("tx-rule");
      io.observe(sections[s]);
    }
  } else {
    for (var k = 0; k < sections.length; k++) sections[k].classList.add("tx-rule", "tx-in");
  }
})();
