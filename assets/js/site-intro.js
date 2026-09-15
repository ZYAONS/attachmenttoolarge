/* ==========================================================================
   site-intro.js — the way in

   The reference is the entrance on ignoredone.space: a full-screen plate that holds
   the screen for a moment, runs two numbered panels past the eye, fills a line, and
   then gets out of the way. It is a door, not a loading screen — nothing is being
   fetched and nothing is waiting on anything; the page is already there behind it.

   Behaviour that matters:
     · it shows once per session (sessionStorage), so navigating around the site does
       not make anyone sit through it again;
     · any click, any key, or two and a half seconds gets you through;
     · prefers-reduced-motion skips it entirely — a door that cannot be walked
       through quickly is worse than no door;
     · scrolling is locked while it is up, and the lock is always released, including
       on the early exits.
   ========================================================================== */
(function () {
  if (typeof document === "undefined") return;

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  var KEY = "att.intro.seen";
  try { if (window.sessionStorage && sessionStorage.getItem(KEY) === "1") return; } catch (e) { /* private mode */ }

  var CSS = [
    "html.intro-lock{overflow:hidden}",
    ".intro{position:fixed;inset:0;z-index:9999;overflow:hidden;cursor:pointer;",
    "display:flex;align-items:center;justify-content:center;",
    "background:radial-gradient(120% 90% at 50% 46%,#06110c 0%,#030806 58%,#010403 100%);",
    "font-family:Consolas,'Cascadia Mono',ui-monospace,monospace;color:#dfe9e2;",
    "transition:opacity .5s ease,visibility .5s ease}",
    ".intro.is-out{opacity:0;visibility:hidden}",

    /* the plate */
    ".intro__plate{position:relative;width:min(620px,86vw);padding:30px 34px 26px;",
    "border:1px solid rgba(79,209,165,.42);",
    "background:linear-gradient(180deg,rgba(11,22,18,.80),rgba(6,13,11,.90));",
    "box-shadow:0 0 0 1px rgba(201,169,97,.18) inset,0 30px 80px rgba(0,0,0,.55)}",
    ".intro__plate::before,.intro__plate::after{content:'';position:absolute;width:16px;height:16px;",
    "border:1px solid #c9a961;opacity:.75}",
    ".intro__plate::before{top:-1px;left:-1px;border-right:0;border-bottom:0}",
    ".intro__plate::after{bottom:-1px;right:-1px;border-left:0;border-top:0}",

    /* the mark */
    ".intro__mark{width:60px;height:60px;margin:0 auto 16px;display:block}",
    ".intro__mark path{stroke:#4fd1a5;stroke-width:16;fill:none}",
    ".intro__mark .hex{fill:none;stroke:rgba(201,169,97,.85);stroke-width:8}",

    /* the numbered panels, one at a time */
    ".intro__panel{text-align:center;min-height:86px}",
    ".intro__no{font-size:.62rem;letter-spacing:.34em;color:#7c8b96}",
    ".intro__big{font-size:clamp(1.5rem,4.6vw,2.4rem);letter-spacing:.20em;font-weight:700;margin:6px 0 0;color:#f2f1ec}",
    ".intro__sub{font-size:.66rem;letter-spacing:.30em;color:#c9a961;margin-top:8px}",
    ".intro__swap{animation:intro-swap .42s ease both}",
    "@keyframes intro-swap{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}",

    /* the line, and where it has got to */
    ".intro__bar{position:relative;height:2px;margin:24px 0 12px;background:rgba(255,255,255,.10)}",
    ".intro__bar i{position:absolute;inset:0 auto 0 0;width:0;",
    "background:linear-gradient(90deg,#4fd1a5,#c9a961);animation:intro-fill 2400ms cubic-bezier(.4,0,.2,1) forwards}",
    "@keyframes intro-fill{to{width:100%}}",
    ".intro__foot{display:flex;justify-content:space-between;font-size:.6rem;letter-spacing:.22em;color:#7c8b96}",
    ".intro__foot b{color:#4fd1a5;font-weight:400}",

    /* the hairline grid that gives the plate its technical feel */
    ".intro__grid{position:absolute;inset:0;pointer-events:none;opacity:.20;",
    "background-image:linear-gradient(rgba(79,209,165,.35) 1px,transparent 1px),",
    "linear-gradient(90deg,rgba(79,209,165,.35) 1px,transparent 1px);background-size:44px 44px}"
  ].join("");

  var style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  var root = document.createElement("div");
  root.className = "intro";
  root.setAttribute("role", "presentation");
  root.innerHTML =
    '<div class="intro__plate">' +
      '<div class="intro__grid"></div>' +
      '<svg class="intro__mark" viewBox="0 0 512 512" aria-hidden="true">' +
        '<path d="M310 96 H336 V416 H310 Z"/>' +
        '<path d="M256 140 A30 30 0 0 1 316 140 V416 H286 V150 H256 Z"/>' +
        '<path d="M256 140 V416 H226 V150 Z"/>' +
        '<path class="hex" d="M256 44 L430 144 V344 L256 444 L82 344 V144 Z"/>' +
      '</svg>' +
      '<div class="intro__panel" data-intro-panel>' +
        '<div class="intro__no">#0</div>' +
        '<div class="intro__big">ATT-20MB</div>' +
        '<div class="intro__sub">THE 20 MB WALL</div>' +
      '</div>' +
      '<div class="intro__bar"><i></i></div>' +
      '<div class="intro__foot"><span>ATTACHMENT TOO LARGE SOCIETY</span><span><b>CLICK TO ENTER</b></span></div>' +
    '</div>';

  document.documentElement.classList.add("intro-lock");
  (document.body || document.documentElement).appendChild(root);

  var panel = root.querySelector("[data-intro-panel]");
  var PANELS = [
    { no: "#0", big: "ATT-20MB", sub: "THE 20 MB WALL" },
    { no: "#1", big: "19:59", sub: "FOUNDED 13 SEP 2026" },
    { no: "#2", big: "SPLIT · SEND · JOIN", sub: "NOTHING IS UPLOADED" }
  ];

  var swap = 0;
  var timer = setInterval(function () {
    swap++;
    if (swap >= PANELS.length) { clearInterval(timer); return; }
    var p = PANELS[swap];
    panel.innerHTML = '<div class="intro__no">' + p.no + '</div>' +
      '<div class="intro__big">' + p.big + '</div>' +
      '<div class="intro__sub">' + p.sub + '</div>';
    panel.classList.remove("intro__swap");
    void panel.offsetWidth;                 // restart the animation
    panel.classList.add("intro__swap");
  }, 780);

  var done = false;
  function leave() {
    if (done) return;
    done = true;
    clearInterval(timer);
    document.documentElement.classList.remove("intro-lock");
    try { if (window.sessionStorage) sessionStorage.setItem(KEY, "1"); } catch (e) { /* ignore */ }
    root.classList.add("is-out");
    setTimeout(function () { if (root.parentNode) root.parentNode.removeChild(root); }, 600);
    document.removeEventListener("keydown", leave);
    document.removeEventListener("click", leave);
    document.removeEventListener("touchstart", leave);
  }

  var auto = setTimeout(leave, 2500);
  function leaveNow() { clearTimeout(auto); leave(); }
  document.addEventListener("keydown", leaveNow);
  document.addEventListener("click", leaveNow);
  document.addEventListener("touchstart", leaveNow, { passive: true });
})();
