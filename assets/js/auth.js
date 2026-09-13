/* ==========================================================================
   attachmenttoolarge — membership: join and sign-in front end
   Talks to the real API in server/server.mjs; when there is no backend it falls back to static mode and says so.

   Page hooks (declare them in the HTML; no extra init code needed):
     <form data-auth="register">    membership application
     <form data-auth="login">       sign in
     <div  data-auth="member">      membership card area (detects sign-in state)
     <div  data-auth="members">     member directory
     <form data-auth="leave">       leave the society
     <div  data-static-notice>      notice shown only in static mode
   ========================================================================== */
(function () {
  "use strict";

  var API = "";                 // same origin as the site
  var state = { mode: "unknown", member: null, csrf: null, health: null };

  /* ---------- 基础请求 ---------- */
  function request(path, options) {
    var opts = options || {};
    var headers = { "Accept": "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.method && opts.method !== "GET" && state.csrf) headers["x-att-csrf"] = state.csrf;

    return fetch(API + path, {
      method: opts.method || "GET",
      headers: headers,
      credentials: "same-origin",
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { status: res.status, ok: res.ok, data: data };
      });
    });
  }

  /* ---------- 探测后端 ---------- */
  function probe() {
    // file:// 下不可能有同源后端，直接判定为静态模式：
    // 既省一次必然失败的请求，也避免浏览器在控制台里报一条 CORS 错误。
    if (location.protocol === "file:") {
      state.mode = "static";
      return Promise.resolve("static");
    }
    return fetch(API + "/api/health", { headers: { "Accept": "application/json" }, credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.ok) {
          state.mode = "server";
          state.health = j;
        } else {
          state.mode = "static";
        }
        return state.mode;
      })
      .catch(function () {
        state.mode = "static";
        return "static";
      });
  }

  function ensureCsrf() {
    if (state.csrf) return Promise.resolve(state.csrf);
    return request("/api/csrf").then(function (r) {
      if (r.ok && r.data.token) { state.csrf = r.data.token; return state.csrf; }
      throw new Error("Could not obtain a CSRF token");
    });
  }

  /* ---------- API ---------- */
  function register(payload) {
    return ensureCsrf().then(function () { return request("/api/register", { method: "POST", body: payload }); });
  }
  function login(payload) {
    return ensureCsrf().then(function () { return request("/api/login", { method: "POST", body: payload }); });
  }
  function logout() {
    return ensureCsrf().then(function () { return request("/api/logout", { method: "POST" }); })
      .then(function (r) { state.member = null; state.csrf = null; return r; });
  }
  function me() {
    return request("/api/me").then(function (r) {
      state.member = r.data && r.data.authenticated ? r.data.member : null;
      if (r.data && r.data.csrf) state.csrf = r.data.csrf;
      return r.data;
    });
  }
  function members() { return request("/api/members").then(function (r) { return r.data; }); }
  function leave(confirmSerial) {
    return ensureCsrf().then(function () { return request("/api/leave", { method: "POST", body: { confirm: confirmSerial } }); });
  }

  /* ---------- 小工具 ---------- */
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.getFullYear() + " " + (d.getMonth() + 1) + "-" + d.getDate() + "";
  }
  function msg(el, kind, text) {
    if (!el) return;
    el.className = "form-msg is-shown " + (kind === "ok" ? "is-ok" : "is-error");
    el.textContent = text;
  }
  function clearFields(form) {
    Array.prototype.forEach.call(form.querySelectorAll(".field.has-error"), function (f) {
      f.classList.remove("has-error");
    });
  }
  function markFields(form, fields) {
    Object.keys(fields || {}).forEach(function (key) {
      var input = form.querySelector('[name="' + key + '"]');
      if (input) {
        var wrap = input.closest(".field");
        if (wrap) wrap.classList.add("has-error");
      }
    });
  }

  /* ---------- Member证渲染 ---------- */
  function renderMemberCard(member, opts) {
    opts = opts || {};
    var founding = member.rank === "Founding member";
    return '' +
      '<div class="member-card">' +
        '<div class="member-head">' +
          '<img src="assets/img/emblem.svg" alt="" width="52" height="52">' +
          '<div>' +
            '<h2>Membership card</h2>' +
            '<div class="member-serial">' + esc(member.serial) + '</div>' +
          '</div>' +
        '</div>' +
        '<dl class="member-fields">' +
          '<div class="member-field"><dt>Name</dt><dd>' + esc(member.name) + '</dd></div>' +
          '<div class="member-field"><dt>Standing</dt><dd>' + esc(member.rank) + (founding ? ' · first 20 seats' : '') + '</dd></div>' +
          '<div class="member-field"><dt>Joined</dt><dd>' + esc(fmtDate(member.joinedAt)) + '</dd></div>' +
          '<div class="member-field"><dt>Membership no.</dt><dd class="mono">' + esc(member.serial) + '</dd></div>' +
          (member.email ? '<div class="member-field"><dt>Email</dt><dd class="mono">' + esc(member.email) + '</dd></div>' : '') +
          '<div class="member-field"><dt>Shards cut</dt><dd>' + esc(member.divisions || 0) + ' attachments</dd></div>' +
        '</dl>' +
        '<div class="member-foot">' +
          '<div class="seal">ATT<br>20MB</div>' +
          '<div class="petition-sign">' +
            'Hereby certifies that the above is a member on the register,<br>' +
          'entitled to consult the limits database and to complain about 20 MB.' +
            (opts.footNote ? '<br>' + esc(opts.footNote) : '') +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ---------- 静态模式提示 ---------- */
  function applyMode() {
    var isStatic = state.mode === "static";
    Array.prototype.forEach.call(document.querySelectorAll("[data-static-notice]"), function (el) {
      el.style.display = isStatic ? "" : "none";
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-server-only]"), function (el) {
      el.style.display = isStatic ? "none" : "";
    });
    var badge = document.querySelector("[data-mode-badge]");
    if (badge) {
      badge.textContent = isStatic ? "Static mode · no backend" : "Backend connected";
      badge.className = "badge " + (isStatic ? "badge-warn" : "badge-ok");
    }
  }

  /* ---------- 页面装配 ---------- */
  function wire() {
    /* 入会申请书 */
    var regForm = document.querySelector('[data-auth="register"]');
    if (regForm) {
      var regMsg = regForm.querySelector("[data-form-msg]");
      regForm.addEventListener("submit", function (e) {
        e.preventDefault();
        clearFields(regForm);
        var fd = new FormData(regForm);
        var pwd = String(fd.get("password") || "");
        var pwd2 = String(fd.get("password2") || "");
        if (pwd.length < 10) { markFields(regForm, { password: 1 }); return msg(regMsg, "error", "Your passphrase needs at least 10 characters."); }
        if (pwd !== pwd2) { markFields(regForm, { password2: 1 }); return msg(regMsg, "error", "The two passphrases do not match."); }

        var btn = regForm.querySelector("button[type=submit]");
        if (btn) { btn.disabled = true; btn.textContent = "Submitting…"; }
        msg(regMsg, "ok", "Submitting your petition…");

        register({
          name: fd.get("name"), email: fd.get("email"),
          password: pwd, reason: fd.get("reason") || "", csrf: state.csrf
        }).then(function (r) {
          if (r.status === 201) {
            state.member = r.data.member;
            if (r.data.csrf) state.csrf = r.data.csrf;
            var host = document.querySelector("[data-member-card]");
            if (host) {
              host.innerHTML = renderMemberCard(r.data.member, { footNote: "Founding seats: " + (state.health ? state.health.foundingSeats : 20) + "" });
              host.scrollIntoView({ block: "center", behavior: "smooth" });
            }
            regForm.style.display = "none";
            msg(regMsg, "ok", "You are on the register. Your number is " + r.data.member.serial + "。");
            return;
          }
          markFields(regForm, r.data.fields);
          msg(regMsg, "error", r.data.message || "The application was not accepted. Please review the form.");
        }).catch(function () {
          msg(regMsg, "error", "Cannot reach the backend. Make sure the server is running: node server/server.mjs");
        }).then(function () {
          if (btn) { btn.disabled = false; btn.textContent = "Submit petition"; }
        });
      });
    }

    /* 登录 */
    var logForm = document.querySelector('[data-auth="login"]');
    if (logForm) {
      var logMsg = logForm.querySelector("[data-form-msg]");
      logForm.addEventListener("submit", function (e) {
        e.preventDefault();
        clearFields(logForm);
        var fd = new FormData(logForm);
        var btn = logForm.querySelector("button[type=submit]");
        if (btn) { btn.disabled = true; btn.textContent = "Verifying…"; }
        msg(logMsg, "ok", "Verifying…");
        login({ email: fd.get("email"), password: fd.get("password"), csrf: state.csrf }).then(function (r) {
          if (r.ok) { location.href = "member.html"; return; }
          msg(logMsg, "error", r.data.message || "Sign-in failed.");
        }).catch(function () {
          msg(logMsg, "error", "Cannot reach the backend. Make sure the server is running.");
        }).then(function () {
          if (btn) { btn.disabled = false; btn.textContent = "Sign in"; }
        });
      });
    }

    /* Membership card */
    var memberHost = document.querySelector('[data-auth="member"]');
    if (memberHost) {
      // In static mode (file://, plain static hosting) do not even try to fetch:
      // it must fail, and it leaves a CORS error in the console. Say so instead.
      if (state.mode !== "server") {
        memberHost.innerHTML =
          '<div class="callout callout-warn"><div><b>No backend</b> A membership card is issued by the server. ' +
          'Start it with <code>node server/server.mjs</code> and open the site on the address it prints.</div></div>';
      } else {
        me().then(function (data) {
          if (!data.authenticated) {
            memberHost.innerHTML =
              '<div class="callout callout-warn"><div><b>Not signed in</b> ' +
              'A card is issued only to members on the register. Not a member yet? ' +
              '<a href="register.html" style="color:var(--accent)">Submit a petition</a>; ' +
              'if you already have a number, <a href="login.html" style="color:var(--accent)">sign in here</a>.</div></div>';
            return;
          }
          memberHost.innerHTML = renderMemberCard(data.member, {
            footNote: "Members on the register: " + data.seat + " / founding seats: " + data.foundingSeats
          });
          var leaveForm = document.querySelector('[data-auth="leave"]');
          if (leaveForm) {
            leaveForm.style.display = "";
            leaveForm.addEventListener("submit", function (e) {
              e.preventDefault();
              var m = leaveForm.querySelector("[data-form-msg]");
              var serial = String(new FormData(leaveForm).get("confirm") || "").trim();
              if (!confirm("Leave the society? This permanently deletes your membership record on the server and cannot be undone.")) return;
              leave(serial).then(function (r) {
                if (r.ok) {
                  msg(m, "ok", "You have left. Number " + r.data.serial + " is now void. Thank you for having been here.");
                  setTimeout(function () { location.href = "members.html"; }, 1500);
                } else {
                  msg(m, "error", r.data.message || "Could not leave the society.");
                }
              });
            });
          }
        }).catch(function () {
          memberHost.innerHTML =
            '<div class="callout callout-warn"><div><b>Backend unreachable</b> A membership card needs the backend. Start it with: ' +
            '<code>node server/server.mjs</code></div></div>';
        });
      }
    }

    /* Member directory */
    var dirHost = document.querySelector('[data-auth="members"]');
    if (dirHost) {
      if (state.mode !== "server") {
        dirHost.innerHTML =
          '<div class="callout callout-warn"><div><b>The directory needs the backend</b> ' +
          'This is static mode (GitHub Pages, for example): a browser cannot read the account store directly. ' +
          'Run <code>node server/server.mjs</code> locally and reopen this page to see the real register.</div></div>';
      } else {
        members().then(function (data) {
          if (!data || !data.members) throw new Error("no data");
          if (!data.members.length) {
            dirHost.innerHTML = '<div class="callout"><div>The register is still empty — you would be its first member.</div></div>';
            return;
          }
          var rows = data.members.map(function (m) {
            return '<tr><td>' + esc(m.serial) + '</td><td>' + esc(m.name) + '</td><td>' +
                   esc(m.rank) + '</td><td>' + esc(fmtDate(m.joinedAt)) + '</td></tr>';
          }).join("");
          dirHost.innerHTML =
            '<div class="table-wrap"><table class="data">' +
            '<thead><tr><th>No.</th><th>Name</th><th>Standing</th><th>Joined</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table></div>' +
            '<p class="small muted" style="margin-top:12px">' + data.count +
            ' on the register. The directory shows names and numbers only — never email addresses or passphrases.</p>';
        }).catch(function () {
          dirHost.innerHTML =
            '<div class="callout callout-warn"><div><b>The directory needs the backend</b> ' +
            'This is static mode. Run <code>node server/server.mjs</code> locally and reopen this page.</div></div>';
        });
      }
    }

    /* 退出登录按钮 */
    Array.prototype.forEach.call(document.querySelectorAll("[data-auth-logout]"), function (btn) {
      btn.addEventListener("click", function () {
        logout().then(function () { location.href = "index.html"; });
      });
    });
  }

  /* ---------- 对外 ---------- */
  window.ATTAuth = {
    probe: probe, me: me, register: register, login: login, logout: logout,
    members: members, leave: leave, wire: wire, renderMemberCard: renderMemberCard,
    esc: esc, fmtDate: fmtDate,
    state: function () { return { mode: state.mode, member: state.member, health: state.health }; }
  };

  function boot() {
    probe().then(applyMode).then(function () {
      if (state.mode === "server") return me().then(function () { applyMode(); });
    }).then(wire).catch(wire);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
