/* ==========================================================================
   tactical-plus.js — make the lyrics window closable by thumb

   The handler already existed: assets/js/tactical.js wires .lyr-close and persists
   the choice in localStorage. So the fault was the gesture, not the logic —

     · the buttons are roughly twenty pixels across, which is not a tap target on a
       phone (the accepted minimum is about forty-four);
     · a full-height panel on a small screen offers no other way out: you either hit
       that small box or you sit there looking at lyrics.

   So this adds three ways out beside the button: a larger target, a tap anywhere
   outside the panel, and a downward swipe. Escape works with a keyboard. The
   chosen state is still remembered, so once hidden it stays hidden.

   Note on what is NOT here: an earlier draft also injected a cream "poster band"
   with very large black type, in the visual language of the livestream title plates
   supplied as references. The project's own contrast audit rejected it — the site's
   stylesheets repaint that plate, and black type then measured 1.10 against what it
   had actually become. Left out rather than left in with an override war on top.
   ========================================================================== */
(function () {
  if (typeof document === "undefined") return;

  var win = document.getElementById("lyrics");
  if (!win) return;

  var close = win.querySelector(".lyr-close");
  var KEY = "att.lyrics.hidden";

  var style = document.createElement("style");
  style.textContent = [
    /* a real tap target, still visible against the panel */
    "#lyrics .lyr-min,#lyrics .lyr-close{width:44px;height:44px;min-width:44px;",
    "display:flex;align-items:center;justify-content:center;font-size:15px;line-height:1;",
    "border:1px solid rgba(182,224,74,.45);background:rgba(10,16,12,.75);cursor:pointer;",
    "touch-action:manipulation;-webkit-tap-highlight-color:transparent}",
    "#lyrics .lyr-close{right:6px}",
    "@media (max-width:720px){#lyrics .lyr-min{right:56px}}",

    /* the way out when the panel covers the page */
    ".lyr-scrim{position:fixed;inset:0;z-index:60;background:rgba(4,8,6,.5);",
    "opacity:0;visibility:hidden;transition:opacity .2s ease,visibility .2s ease}",
    "body.lyr-behind .lyr-scrim{opacity:1;visibility:visible}",

    /* a grab handle, so the swipe is discoverable rather than a secret */
    ".lyr-grab{position:absolute;left:50%;top:6px;transform:translateX(-50%);width:52px;height:4px;",
    "border-radius:2px;background:rgba(182,224,74,.45);pointer-events:none}"
  ].join("");
  document.head.appendChild(style);

  function hideLyrics() {
    document.body.classList.add("lyrics-closed");
    document.body.classList.remove("lyr-behind");
    try { localStorage.setItem(KEY, "1"); } catch (e) { /* private mode */ }
  }

  /* a scrim behind the panel: tapping anywhere that is not the panel means "go away" */
  var scrim = document.createElement("div");
  scrim.className = "lyr-scrim";
  document.body.appendChild(scrim);
  scrim.addEventListener("click", hideLyrics);
  scrim.addEventListener("touchstart", hideLyrics, { passive: true });

  var grab = document.createElement("div");
  grab.className = "lyr-grab";
  win.appendChild(grab);

  /* the scrim follows whatever hides or shows the panel */
  function syncScrim() {
    var hidden = document.body.classList.contains("lyrics-closed");
    document.body.classList.toggle("lyr-behind", !hidden);
  }
  syncScrim();
  if (window.MutationObserver) {
    var pending = false;
    new MutationObserver(function () {
      /* never re-enter from inside the callback: an observer on the body's own class
         list becomes a busy loop the moment the callback writes to that list */
      if (pending) return;
      pending = true;
      setTimeout(function () { pending = false; syncScrim(); }, 0);
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  if (close) {
    /* pointerup as well as click: some mobile browsers deliver only the former when
       the panel is being scrolled at the same moment */
    close.addEventListener("pointerup", function (e) { e.preventDefault(); hideLyrics(); });
    close.addEventListener("click", hideLyrics);
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") hideLyrics();
  });

  /* swipe down on the panel to dismiss it */
  var startY = null;
  win.addEventListener("touchstart", function (e) {
    startY = e.touches && e.touches[0] ? e.touches[0].clientY : null;
  }, { passive: true });
  win.addEventListener("touchend", function (e) {
    if (startY === null) return;
    var endY = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : startY;
    if (endY - startY > 70) hideLyrics();
    startY = null;
  }, { passive: true });
})();
