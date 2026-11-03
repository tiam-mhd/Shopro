import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const webRoot = resolve(root, "apps/web/dist");
const tempParent = resolve(root, ".tmp");
const profile = resolve(tempParent, `shopro-edge-smoke-${randomUUID()}`);
const edgeCandidates = [
  process.env.SHOPRO_BROWSER_EXECUTABLE,
  process.platform === "win32" ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" : undefined,
  process.platform === "win32" ? "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe" : undefined,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
].filter(Boolean);
const browser = edgeCandidates.find((candidate) => existsSync(candidate));
if (!browser) throw new Error("Set SHOPRO_BROWSER_EXECUTABLE to a local Chromium or Edge executable to run this smoke test.");
if (!existsSync(join(webRoot, "index.html"))) throw new Error("Build the web app before running this browser smoke test.");
if (!profile.startsWith(tempParent + sep)) throw new Error("Refusing to create the browser profile outside workspace .tmp.");
mkdirSync(tempParent, { recursive: true });

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".webp", "image/webp"], [".svg", "image/svg+xml"], [".woff2", "font/woff2"],
  [".woff", "font/woff"], [".json", "application/json"], [".webmanifest", "application/manifest+json"],
]);
const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname === "/api/v1/auth/session") {
    response.writeHead(401, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify({ code: "HTTP_401", message: "برای ادامه وارد حساب کاربری شوید." }));
    return;
  }
  if (pathname.startsWith("/api/")) {
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ code: "HTTP_404", message: "یافت نشد" }));
    return;
  }

  let target;
  try { target = resolve(webRoot, `.${decodeURIComponent(pathname)}`); }
  catch { response.writeHead(400).end(); return; }
  if (!target.startsWith(webRoot + sep) && target !== join(webRoot, "index.html")) { response.writeHead(400).end(); return; }
  const file = existsSync(target) && statSync(target).isFile() ? target : join(webRoot, "index.html");
  response.writeHead(200, { "content-type": mimeTypes.get(extname(file)) ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(response);
});

let child;
try {
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/login`;
  const args = [
    "--headless=new", "--disable-gpu",
    "--no-first-run", "--no-default-browser-check", "--virtual-time-budget=5000", `--user-data-dir=${profile}`, "--dump-dom", url,
  ];
  child = spawn(browser, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  child.stdout.setEncoding("utf8").on("data", (chunk) => stdout.push(chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => stderr.push(chunk));
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => { child.kill(); rejectExit(new Error("Headless browser did not finish the login smoke test within 30 seconds.")); }, 30_000);
    child.once("error", (error) => { clearTimeout(timeout); rejectExit(error); });
    child.once("exit", (code) => { clearTimeout(timeout); resolveExit(code); });
  });
  const dom = stdout.join("");
  assert.equal(exitCode, 0, `Headless browser exited ${exitCode}: ${stderr.join("").slice(-1200)}`);
  assert.match(dom, /ورود یا ساخت حساب/, "the rendered login route should show its heading");
  assert.match(dom, /شماره موبایل/, "the rendered login route should show the phone field label");
  assert.match(dom, /id="phone"/, "the rendered login route should include the phone input");
  assert.match(dom, /dir="rtl"/, "the rendered login screen should declare RTL direction");
  console.log(`Chromium browser smoke passed: production bundle rendered the Persian RTL login page (${browser}).`);
} finally {
  if (child && child.exitCode === null) child.kill();
  await new Promise((resolveClose) => server.close(resolveClose));
  if (existsSync(profile) && profile.startsWith(tempParent + sep)) {
    for (let attempt = 0; ; attempt++) {
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        break;
      } catch (error) {
        if (attempt >= 24 || !["EBUSY", "ENOTEMPTY", "EPERM", "EACCES"].includes(error?.code)) throw error;
        await new Promise((resolveRetry) => setTimeout(resolveRetry, 500));
      }
    }
  }
}
