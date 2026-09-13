# attachmenttoolarge — the Attachment Too Large Society

> A society of people whose files never fit.
> **A fictional organisation with real tooling**: a working `att` CLI, a membership
> backend, a generated theme song, and a small museum of Outlook's error messages.

The name comes from what Outlook actually says:

> *The file you're attaching is bigger than the server allows.*
> *Try putting the file in a shared location and sending a link instead.*

Live site: `https://ZYAONS.github.io/attachmenttoolarge/` (enable Pages to serve it — see below).

---

## What actually works

| Thing | Status | Where |
| --- | --- | --- |
| `att` CLI — split / join / info / limits / ndr | **works, tested** | `cli/att.mjs` |
| Windows single-file executable | **builds and self-tests** | `tools/build-exe.mjs` → `dist/att.exe` |
| Limits database | **in repo** | `data/limits.json` |
| Membership backend (register, sign in, directory, leave) | **works, tested** | `server/server.mjs` |
| Static site, 15 pages | **works** | `*.html`, `assets/` |
| Theme song, male rap vocal, 2:50 | **generated, in repo** | `assets/audio/rap.mp3` |
| NDR translator (bounce → plain English) | **works** | `att ndr` |
| Star counts, contributor totals, the society itself | **fictional** | everywhere |

## Quick start

```bash
# The tool: no install, no dependencies, Node 18+
node cli/att.mjs info  "Q3-report_v7_final-FINAL.xlsx"   # will it send? (does the Base64 maths)
node cli/att.mjs split "Q3-report_v7_final-FINAL.xlsx" --limit 20MB
node cli/att.mjs join  "Q3-report_v7_final-FINAL.xlsx.att.json"
node cli/att.mjs ndr   bounce.txt                        # or: cat bounce.txt | att ndr -

# The site, static (works offline, no backend)
node tools/serve.mjs                # → http://127.0.0.1:8080/

# The site with real registration
node server/server.mjs              # → http://127.0.0.1:8090/  (data in server/data/)
```

`att split` writes a manifest with a SHA-256 per shard **and** rebuild scripts for Windows
(`.cmd`, double-click) and POSIX (`.sh`). The recipient installs nothing.
`att join` verifies every shard and refuses to write a corrupt file.

## Windows executable

```bash
node tools/build-exe.mjs
```

It bundles the CLI, embeds `data/limits.json`, copies the Node runtime and injects the SEA
blob with postject, then **runs the resulting exe** through `--version`, `--help`, `limits`,
a real split/rejoin with hash comparison, and `ndr`. `att.exe` is ~88 MB because it carries
the runtime; it needs nothing installed on the target machine.

Tagging `v*` runs `.github/workflows/release.yml`, which builds Windows/Linux/macOS binaries,
runs all three test suites and attaches the binaries plus `SHA256SUMS.txt` to a GitHub Release.

## Membership backend

Zero dependencies, Node built-ins only. `register.html`, `login.html`, `member.html`,
`members.html` talk to it; without a backend they say so instead of pretending.

- passphrases hashed with **scrypt** (salted, per user), never stored or returned in plaintext
- sessions: server-side, `HttpOnly` + `SameSite=Lax` cookie, 30 days
- every write requires a **double-submit CSRF token**
- sliding-window **rate limiting** per IP on register and sign-in
- account store written **atomically** and `chmod 0600`; the directory, `.git`, anything named
  `accounts.json` is refused over HTTP
- the public directory exposes names, serials, ranks and dates — **never** emails
- leaving the society really deletes the record

## Theme song

`assets/audio/rap.mp3` — 2:50, 320 kbps, boom-bap, **male rap vocal generated from the lyrics**
by the open-source [ACE-Step](https://huggingface.co/spaces/ACE-Step/ACE-Step) model running
on Hugging Face's servers. No model is downloaded to your machine; the generation script,
prompt and parameters are in `tools/music-ai/` and `assets/audio/rap.generation.json`.

The page also ships a Web Audio fallback (synthesised beat + optional system-voice narration)
so it still makes sound if the mp3 is ever missing. **Nothing autoplays**; there is an explicit
`Voice off` switch, sound stops when the tab is hidden, and `?sound=off` keeps the whole site
silent permanently.

## Tests

Everything is verified by running it, not by reading it.

```bash
node tools/cli-test.mjs        # 41 checks: split/join/corruption/missing shards/double-click rebuild/ndr
node tools/server-test.mjs     # 44 checks: register/session/CSRF/rate limit/directory/leave/leak guards
node tools/browser-check.mjs 全部   # 15 pages × desktop+mobile over CDP: real clicks, real audio, no-JS fallback
node tools/browser-check.mjs http://127.0.0.1:8090/register.html   # also drives a real registration
```

`tools/browser-check.mjs` drives headless Edge over the Chrome DevTools Protocol and asserts
things like *the synthesiser produces a real waveform* (peak/RMS of an offline render), *the
generated track actually plays*, *the lyrics page matches `lyrics.js` line for line*, and
*the site is still readable with JavaScript disabled*.

## Layout

```
├── *.html                 15 pages (home, about, projects, blog, lyrics, register, …)
├── assets/css/style.css   one stylesheet: black/white/blue high-contrast, halftone, hard shadows
├── assets/js/             main.js (UI) · music.js (synth + player) · lyrics.js · auth.js
├── assets/audio/rap.mp3   the generated song
├── assets/img/emblem.svg  society medal, drawn as vector
├── cli/att.mjs            the tool
├── data/limits.json       the limits database
├── server/server.mjs      membership backend
├── tools/                 serve, build-exe, cli-test, server-test, browser-check, music-ai/
└── preview/               rendered screenshots
```

## Deploying the static site (GitHub Pages)

The site is pure static files, so Pages can serve it — but the register pages need the backend,
which Pages cannot run. To publish:

**Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.

## Licence and honesty

MIT (see `LICENSE`). This is a **demo site for a fictional society**: the star counts, the
contributor numbers and the society itself are invented, and it is not affiliated with,
sponsored by or endorsed by Microsoft. Product names, error codes and size limits appear for
technical discussion and mild mockery only; defaults change, so check the official docs and
measure your own limits.
