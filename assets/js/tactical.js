/* ==========================================================================
   tactical.js — builds the briefing frame and hangs it on the page

   The frame is decoration, not content: corner brackets, the wash, the side
   cluster, the briefing block. Building it here rather than pasting forty
   elements into the page keeps the markup readable and means one file to change
   when the design moves.
   ========================================================================== */
(function () {
  "use strict";
  var page = document.body;
  if (!page || !page.classList.contains("tactical")) return;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* ---------- the wash: scanlines and vignette ---------- */
  document.body.appendChild(el("div", "tac-wash"));

  /* ---------- grain, drawn once into a data URI ---------- */
  (function grain() {
    var c = document.createElement("canvas");
    c.width = c.height = 180;
    var g = c.getContext("2d");
    var img = g.createImageData(180, 180);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = 120 + Math.random() * 135;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    var layer = el("div", "tac-grain");
    layer.style.backgroundImage = "url(" + c.toDataURL("image/png") + ")";
    document.body.appendChild(layer);
  })();

  /* ---------- corner brackets ---------- */
  ["tl", "tr", "bl", "br"].forEach(function (c) {
    document.body.appendChild(el("div", "tac-corner " + c));
  });

  /* ---------- the log column and the briefing block ---------- */
  var poem = el("div", "tac-poem");
  poem.innerHTML =
    "<b>Let us praise the twenty-megabyte wall.</b><br>" +
    "That the sender's hope broke against it.<br><br>" +
    "Let us praise the six shards,<br>and the double-click that rebuilds them.<br><br>" +
    "Whoever has a heavy file,<br>let them carry it in pieces to the other side.";
  document.body.appendChild(poem);

  var foot = el("div", "tac-foot");
  foot.appendChild(el("div", "tac-cap", "OPERATION WINDOW"));
  foot.appendChild(el("div", "tac-big", "2026-09-13 <b>19:59</b>"));
  foot.appendChild(el("div", "tac-title", "Critical Phase Transition"));
  foot.appendChild(el("div", "tac-sub", "the attachment too large society"));
  foot.appendChild(el("div", "tac-code", "<span>E</span><span>P</span><span>1</span><span>7</span>"));
  document.body.appendChild(foot);


  /* ---------- the lyrics window: collapse, hide, bring back ---------- */
  (function lyricsWindow() {
    var win = document.getElementById("lyrics");
    if (!win) return;
    var min = win.querySelector(".lyr-min");
    var close = win.querySelector(".lyr-close");
    var reopen = document.querySelector(".lyr-reopen");
    var KEY = "att.lyrics.hidden";

    if (localStorage.getItem(KEY) === "1") document.body.classList.add("lyrics-closed");
    if (min) min.addEventListener("click", function () { win.classList.toggle("is-min"); });
    if (close) close.addEventListener("click", function () {
      document.body.classList.add("lyrics-closed");
      localStorage.setItem(KEY, "1");
    });
    if (reopen) reopen.addEventListener("click", function () {
      document.body.classList.remove("lyrics-closed");
      localStorage.setItem(KEY, "0");
    });

    /* the section's own heading is redundant once it is a window */
    var head = win.querySelector(".section-head .eyebrow");
    if (head) head.textContent = "LYRICS";
    win.setAttribute("role", "complementary");
    win.setAttribute("aria-label", "Lyrics, following the current track");
  })();
})();