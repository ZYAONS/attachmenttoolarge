#!/usr/bin/env node
/* ==========================================================================
   attachmenttoolarge — 本地预览服务器（零依赖）

   为什么需要它：直接双击 index.html（file://）也能看，但有三个限制：
     1. 部分浏览器对 file:// 的限制（例如某些 API 需要安全上下文）
     2. 不能给别人看（局域网内同事打不开你的 file:// 路径）
     3. 没有 404 页面、没有正确的 MIME 类型

   用法：
     node tools/serve.mjs                # 默认 http://127.0.0.1:8080
     node tools/serve.mjs --port 5500    # 换端口
     node tools/serve.mjs --lan          # 同时对外开放（局域网可访问）
     node tools/serve.mjs --dir .        # 指定根目录
   ========================================================================== */
import { createServer } from "node:http";
import { createReadStream, statSync, existsSync, readFileSync } from "node:fs";
import { extname, join, resolve, normalize, sep } from "node:path";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import process from "node:process";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf("--" + name);
  if (i === -1) return def;
  const v = args[i + 1];
  return v && !v.startsWith("--") ? v : true;
};

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)), String(flag("dir", ".")) === "true" ? "." : String(flag("dir", ".")));
const PORT = parseInt(String(flag("port", "8080")), 10);
const HOST = flag("lan", false) === true ? "0.0.0.0" : "127.0.0.1";
const QUIET = flag("quiet", false) === true;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};

const c = (code, s) => (process.stdout.isTTY ? `\u001b[${code}m${s}\u001b[0m` : s);

const server = createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch { res.writeHead(400).end("400 Bad Request"); return; }

  let filePath = normalize(join(ROOT, urlPath));
  // 防目录穿越
  if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) {
    res.writeHead(403).end("403 Forbidden");
    return;
  }
  if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, "index.html");

  const notFound = () => {
    const custom = join(ROOT, "404.html");
    if (existsSync(custom)) {
      const body = readFileSync(custom);
      res.writeHead(404, { "Content-Type": MIME[".html"], "Content-Length": body.length });
      res.end(req.method === "HEAD" ? undefined : body);
    } else {
      res.writeHead(404, { "Content-Type": MIME[".txt"] }).end("404 Not Found");
    }
    if (!QUIET) console.log(`${c(33, "404")} ${urlPath}`);
  };

  if (!existsSync(filePath)) return notFound();
  const st = statSync(filePath);
  if (!st.isFile()) return notFound();

  const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": st.size,
    "Cache-Control": "no-cache",
    // 本地预览不需要这些，但顺手加上，方便你在控制台里看清页面来源
    "X-Served-By": "attachmenttoolarge/tools/serve.mjs"
  });
  if (req.method === "HEAD") return res.end();
  const stream = createReadStream(filePath);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
  if (!QUIET) console.log(`${c(32, "200")} ${urlPath}`);
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(c(31, `端口 ${PORT} 已被占用`) + `，换一个：node tools/serve.mjs --port 8081`);
  } else {
    console.error(c(31, "服务器启动失败：") + e.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const lan = Object.values(networkInterfaces()).flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);

  console.log("");
  console.log(c(1, "attachmenttoolarge — 本地预览已启动"));
  console.log("");
  console.log(`  本机     ${c(36, `http://127.0.0.1:${PORT}/`)}`);
  if (lan.length) {
    console.log(`  局域网   ${c(36, `http://${lan[0]}:${PORT}/`)}${flag("lan", false) === true ? "" : c(2, "   （加 --lan 后同事才能访问）")}`);
  }
  console.log(`  根目录   ${ROOT}`);
  console.log("");
  console.log(c(2, "  Ctrl+C 停止。这是本地服务器，不会上传任何东西。"));
  console.log("");
});
