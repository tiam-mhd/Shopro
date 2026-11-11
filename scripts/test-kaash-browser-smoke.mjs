import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const webRoot = resolve(root, "apps/web/dist");
const tempParent = resolve(root, ".tmp");
const edgeCandidates = [
  process.env.SHOPRO_BROWSER_EXECUTABLE,
  process.platform === "win32" ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" : undefined,
  process.platform === "win32" ? "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe" : undefined,
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
].filter(Boolean);
const browser = edgeCandidates.find((candidate) => existsSync(candidate));
if (!browser) throw new Error("Set SHOPRO_BROWSER_EXECUTABLE to a local Chromium or Edge executable to run this smoke test.");
if (!existsSync(join(webRoot, "index.html"))) throw new Error("Build the web app before running the Kaash browser smoke test.");
if (!tempParent.startsWith(root + sep)) throw new Error("Refusing to store browser artifacts outside the workspace.");
mkdirSync(tempParent, { recursive: true });

const ids = {
  user: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  business: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  branch: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  submission: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  admin: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
};
const createdAt = "2026-11-11T09:00:00.000Z";
const submittedContent = "گزارش فروش روزانه را ساده‌تر کنیم 🌱\nو روندها را یکجا ببینیم.";
const detail = {
  id: ids.submission,
  content: submittedContent,
  status: "NEW",
  module: "SALES",
  screenKey: "sales.register",
  createdAt,
  updatedAt: createdAt,
  internalNote: null,
  lastUpdatedByAdminName: null,
  user: { displayName: "کاربر نمونه", phoneMasked: "0912***4567" },
  businessName: "فروشگاه نمونه",
  branchName: "شعبه اصلی",
  events: [{ id: "event-1", kind: "SUBMITTED", previousStatus: null, newStatus: "NEW", previousNote: null, newNote: null, createdAt, adminName: null }],
};
const rows = {
  items: [{ id: ids.submission, textPreview: submittedContent, truncated: false, status: "NEW", module: "SALES", screenKey: "sales.register", createdAt, user: detail.user, businessName: detail.businessName, branchName: detail.branchName }],
  page: 1, pageSize: 20, total: 1, pages: 1,
};
const submissions = [];
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".webp", "image/webp"], [".svg", "image/svg+xml"], [".woff2", "font/woff2"],
  [".woff", "font/woff"], [".json", "application/json"], [".webmanifest", "application/manifest+json"],
]);

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

const automation = `
<script>
(() => {
  const requestedViewportWidth = Number(new URLSearchParams(location.search).get("kaashSmokeViewport"));
  if (requestedViewportWidth >= 320 && requestedViewportWidth <= 2400) {
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    if (viewportMeta) viewportMeta.content = "width=" + requestedViewportWidth + ", initial-scale=1.0, viewport-fit=cover";
  }
  document.documentElement.dataset.kaashSmoke = "running";
  document.documentElement.dataset.kaashViewport = window.innerWidth + "x" + window.innerHeight;
  const wait = (predicate, label, timeout = 7000) => new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try { const value = predicate(); if (value) return resolve(value); } catch (error) { return reject(error); }
      if (Date.now() - start >= timeout) return reject(new Error("timeout: " + label));
      setTimeout(tick, 50);
    };
    tick();
  });
  const report = (name) => {
    document.documentElement.dataset.kaashSmoke = name;
    document.documentElement.dataset.kaashViewport = window.innerWidth + "x" + window.innerHeight;
  };
  const run = async () => {
    const path = location.pathname;
    if (path === "/app" || path.startsWith("/app/")) {
      const parent = document.createElement("section");
      parent.id = "smoke-parent-dialog";
      parent.setAttribute("role", "dialog");
      parent.setAttribute("aria-modal", "true");
      parent.setAttribute("aria-label", "پنجرهٔ آزمایشی والد");
      parent.style.cssText = "position:fixed;inset:10px;z-index:9999;width:1px;height:1px;overflow:visible;";
      parent.innerHTML = '<input id="smoke-parent-state" value="draft-before-kaash">';
      document.body.append(parent);
      const launcher = await wait(() => document.querySelector(".kaash-launcher"), "global launcher");
      await wait(() => launcher.closest("#smoke-parent-dialog"), "launcher in current modal layer");
      launcher.focus();
      launcher.click();
      const dialog = await wait(() => document.querySelector(".kaash-modal[role=dialog][aria-modal=true]"), "Kaash dialog");
      const dialogRect = dialog.getBoundingClientRect();
      if (dialogRect.left < -1 || dialogRect.right > window.innerWidth + 1) throw new Error("Kaash modal is clipped at " + window.innerWidth + "px viewport width (" + dialogRect.left + ".." + dialogRect.right + ").");
      const textarea = await wait(() => dialog.querySelector("textarea"), "suggestion text area");
      if (textarea.placeholder !== "بهمون بگو چه چیزی شاپرو رو بهترش میکنه\\nکاش ...") throw new Error("the exact two-line placeholder changed");
      if (textarea.value !== "") throw new Error("the placeholder was inserted as the initial value");
      await wait(() => document.activeElement === textarea, "focus moves into the Kaash dialog");
      if (!parent.isConnected || document.querySelector("#smoke-parent-state").value !== "draft-before-kaash") throw new Error("opening Kaash changed the underlying dialog state");
      dialog.querySelector("button[aria-label='بستن پنجرهٔ کاش']").click();
      await wait(() => !document.querySelector(".kaash-modal"), "close Kaash dialog");
      const restoredLauncher = document.querySelector(".kaash-launcher");
      if (document.activeElement !== restoredLauncher) throw new Error("focus did not return to the launcher (active=" + document.activeElement?.tagName + "; launcher=" + restoredLauncher?.isConnected + ")");
      if (!parent.isConnected || document.querySelector("#smoke-parent-state").value !== "draft-before-kaash") throw new Error("closing Kaash did not preserve the underlying dialog state");
      parent.remove();

      restoredLauncher.click();
      const activeDialog = await wait(() => document.querySelector(".kaash-modal"), "reopened Kaash dialog");
      const input = activeDialog.querySelector("textarea");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, "ایدهٔ کاربر 🌱\\nخط دوم");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const submit = [...activeDialog.querySelectorAll("button[type=submit]")][0];
      await wait(() => !submit.disabled, "valid suggestion enabled");
      submit.click();
      await wait(() => activeDialog.textContent.includes("سپاس، کاش شما با موفقیت ثبت شد."), "server-confirmed success");
      if (input.value !== "") throw new Error("successful submission did not clear the suggestion");
      report("user-passed");
      return;
    }
    if (path.includes("/story")) {
      await wait(() => document.querySelector(".kaash-story-sheet"), "story preview");
      await wait(() => document.querySelector(".kaash-story-quote p")?.textContent.includes("گزارش فروش روزانه"), "story quote");
      const ready = [...document.querySelectorAll("button")].find((button) => button.textContent.includes("آمادهٔ تصویر"));
      if (!ready) throw new Error("story image mode control is missing");
      ready.click();
      await wait(() => document.querySelector(".kaash-story-route.is-screenshot-mode"), "clean story screenshot mode");
      const quote = document.querySelector(".kaash-story-quote p");
      if (quote.textContent !== "گزارش فروش روزانه را ساده‌تر کنیم 🌱\\nو روندها را یکجا ببینیم.") throw new Error("story text was changed");
      if (document.body.innerText.includes("کاربر نمونه") || document.body.innerText.includes("فروشگاه نمونه") || document.body.innerText.includes("یادداشت داخلی")) throw new Error("personal or internal details appeared in story mode");
      const sheet = document.querySelector(".kaash-story-sheet").getBoundingClientRect();
      if (Math.abs(sheet.width / sheet.height - 9 / 16) > 0.015) throw new Error("story preview lost its 9:16 ratio");
      if (sheet.left < -1 || sheet.right > window.innerWidth + 1) throw new Error("story preview is clipped at " + window.innerWidth + "px viewport width (" + sheet.left + ".." + sheet.right + ").");
      if (quote.scrollHeight > quote.clientHeight + 1) throw new Error("story quote is clipped vertically");
      report("story-passed");
      return;
    }
    if (path.startsWith("/system-admin/kaash/")) {
      await wait(() => document.querySelector(".kaash-quote-card"), "admin detail quote card");
      document.documentElement.dataset.kaashWidths = JSON.stringify([innerWidth, document.documentElement.clientWidth, document.documentElement.scrollWidth, document.body.scrollWidth]);
      if (document.documentElement.scrollWidth > window.innerWidth + 1) throw new Error("admin detail has horizontal viewport overflow");
      const quoteRect = document.querySelector(".kaash-quote-card").getBoundingClientRect();
      if (quoteRect.left < -1 || quoteRect.right > window.innerWidth + 1) throw new Error("admin detail is clipped at " + window.innerWidth + "px viewport width (" + quoteRect.left + ".." + quoteRect.right + "): root=" + document.documentElement.scrollWidth + "; body=" + document.body.scrollWidth + "; main=" + JSON.stringify([...document.querySelectorAll('.kaash-admin-page, .kaash-admin-page *')].map((e) => [e.tagName, e.className, Math.round(e.getBoundingClientRect().left), Math.round(e.getBoundingClientRect().right), e.clientWidth, e.scrollWidth]).filter((x) => x[4] && (x[2] < -1 || x[3] > innerWidth + 1 || x[5] > x[4] + 2)).slice(0, 10)));
      if (document.querySelector(".kaash-quote-content")?.textContent !== "گزارش فروش روزانه را ساده‌تر کنیم 🌱\\nو روندها را یکجا ببینیم.") throw new Error("admin detail did not render the saved suggestion");
      if (!document.querySelector(".kaash-workflow-form") || !document.querySelector(".kaash-history-card")) throw new Error("admin detail workflow or history is missing");
      report("admin-detail-passed");
      return;
    }
    if (path.startsWith("/system-admin/kaash")) {
      await wait(() => document.querySelector(".kaash-table"), "admin suggestion list");
      const listRect = document.querySelector(".kaash-table").getBoundingClientRect();
      document.documentElement.dataset.kaashWidths = JSON.stringify([innerWidth, document.documentElement.clientWidth, document.documentElement.scrollWidth, document.body.scrollWidth]);
      if (document.documentElement.scrollWidth > window.innerWidth + 1) throw new Error("admin list has horizontal viewport overflow");
      if (listRect.left < -1 || listRect.right > window.innerWidth + 1) throw new Error("admin list is clipped at " + window.innerWidth + "px viewport width (" + listRect.left + ".." + listRect.right + "): root=" + document.documentElement.scrollWidth + "; body=" + document.body.scrollWidth + "; main=" + JSON.stringify([...document.querySelectorAll('.kaash-admin-page, .kaash-admin-page *')].map((e) => [e.tagName, e.className, Math.round(e.getBoundingClientRect().left), Math.round(e.getBoundingClientRect().right), e.clientWidth, e.scrollWidth]).filter((x) => x[4] && (x[2] < -1 || x[3] > innerWidth + 1 || x[5] > x[4] + 2)).slice(0, 10)));
      if (!document.querySelector(".kaash-table").textContent.includes("گزارش فروش روزانه")) throw new Error("admin list did not render server results");
      report("admin-list-passed");
    }
  };
  run().catch((error) => { document.documentElement.dataset.kaashSmoke = "failed"; document.documentElement.dataset.kaashSmokeError = error.message; });
})();
</script>`;

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname === "/__smoke/state") return sendJson(response, 200, { submissions });
  if (pathname.startsWith("/api/v1/")) {
    if (pathname === "/api/v1/auth/session") return sendJson(response, 200, { user: { id: ids.user, phone: "09120004567", displayName: "کاربر نمونه", businessId: ids.business, branchId: ids.branch, memberId: "member-smoke", role: "OWNER" } });
    if (pathname === "/api/v1/businesses") return sendJson(response, 200, [{ id: ids.business, displayName: "فروشگاه نمونه", businessType: "retail", timezone: "Asia/Tehran", displayCurrency: "IRT", role: "OWNER", branches: [{ id: ids.branch, name: "شعبه اصلی", code: "MAIN" }] }]);
    if (pathname === "/api/v1/subscriptions/current") return sendJson(response, 200, { status: "ACTIVE", period: null });
    if (pathname === "/api/v1/kaash" && request.method === "POST") {
      submissions.push({ body: await readJson(request), idempotencyKey: request.headers["idempotency-key"], businessId: request.headers["x-business-id"], branchId: request.headers["x-branch-id"] });
      return sendJson(response, 201, { id: ids.submission, createdAt, status: "NEW" });
    }
    if (pathname === "/api/v1/system-admin/session") return sendJson(response, 200, { admin: { id: ids.admin, username: "shopro_super_admin", displayName: "مالک شاپرو" }, csrfToken: "smoke-csrf-token" });
    if (pathname === "/api/v1/system-admin/kaash/counts") return sendJson(response, 200, { total: 1, newCount: 1 });
    if (pathname === "/api/v1/system-admin/kaash/query") return sendJson(response, 200, rows);
    if (pathname === `/api/v1/system-admin/kaash/${ids.submission}/story`) return sendJson(response, 200, { content: detail.content, createdAt });
    if (pathname === `/api/v1/system-admin/kaash/${ids.submission}`) return sendJson(response, 200, detail);
    return sendJson(response, 404, { message: "Not found" });
  }

  let target;
  try { target = resolve(webRoot, `.${decodeURIComponent(pathname)}`); }
  catch { response.writeHead(400).end(); return; }
  if (!target.startsWith(webRoot + sep) && target !== join(webRoot, "index.html")) { response.writeHead(400).end(); return; }
  const file = existsSync(target) && statSync(target).isFile() ? target : join(webRoot, "index.html");
  response.writeHead(200, { "content-type": mimeTypes.get(extname(file)) ?? "application/octet-stream", "cache-control": "no-store" });
  if (file === join(webRoot, "index.html")) {
    response.end(readFileSync(file, "utf8").replace("</body>", `${automation}</body>`));
    return;
  }
  createReadStream(file).pipe(response);
});

const artifacts = [];
const profiles = [];
const children = [];

async function launch(route, viewport, expected, screenshot = true) {
  const profile = resolve(tempParent, `kaash-edge-profile-${randomUUID()}`);
  const imagePath = resolve(tempParent, `kaash-${expected}-${viewport.width}x${viewport.height}-${randomUUID()}.png`);
  if (!profile.startsWith(tempParent + sep) || !imagePath.startsWith(tempParent + sep)) throw new Error("Refusing to create browser artifacts outside .tmp.");
  profiles.push(profile);
  if (screenshot) artifacts.push(imagePath);
  const url = `http://127.0.0.1:${server.address().port}${route}?kaashSmokeViewport=${viewport.width}`;
  const args = ["--headless=new", "--disable-gpu", "--force-device-scale-factor=1", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", "--remote-allow-origins=*", `--user-data-dir=${profile}`, "about:blank"];
  const child = spawn(browser, args, { windowsHide: true, stdio: "ignore" });
  children.push(child);
  const portFile = join(profile, "DevToolsActivePort");
  for (let attempt = 0; !existsSync(portFile); attempt++) {
    if (child.exitCode !== null) throw new Error(`Headless Edge exited before DevTools was ready at ${route}.`);
    if (attempt >= 150) throw new Error(`Headless Edge DevTools did not start at ${route}.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  let portText = "";
  for (let attempt = 0; !portText; attempt++) {
    try { portText = readFileSync(portFile, "utf8"); }
    catch (error) {
      if (error?.code !== "EBUSY" || attempt >= 50) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const port = Number(portText.split(/\r?\n/, 1)[0]);
  const targetsResponse = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await targetsResponse.json();
  const target = targets.find((item) => item.type === "page");
  assert.ok(target?.webSocketDebuggerUrl, `Edge page target should expose DevTools at ${route}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    await cdp("Page.enable");
    await cdp("Runtime.enable");
    await cdp("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width <= 640 });
    if (viewport.width <= 640) await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await cdp("Page.navigate", { url });
    let dom = "";
    let smokeState = "";
    let smokeError = "";
    for (let attempt = 0; attempt < 200; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const evaluated = await cdp("Runtime.evaluate", { expression: "({ html: document.documentElement.outerHTML, state: document.documentElement.dataset.kaashSmoke, error: document.documentElement.dataset.kaashSmokeError })", returnByValue: true });
      const value = evaluated.result?.value;
      if (!value) continue;
      dom = value.html ?? "";
      smokeState = value.state ?? "";
      smokeError = value.error ?? "";
      if (smokeState === expected || smokeState === "failed") break;
    }
    assert.equal(smokeState, expected, `${route} browser path should finish its assertions at ${viewport.width}x${viewport.height}: ${smokeError || "no browser error detail"}`);
    const cssViewportWidth = Number(dom.match(/data-kaash-viewport="(\d+)x/)?.[1]);
    assert.equal(cssViewportWidth, viewport.width, `${route} browser CSS viewport should match the requested ${viewport.width}px width`);
    if (screenshot) {
      const captured = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      writeFileSync(imagePath, Buffer.from(captured.data, "base64"));
      assert.ok(existsSync(imagePath) && statSync(imagePath).size > 10_000, `browser screenshot should be written for ${route}`);
      const png = readFileSync(imagePath);
      assert.equal(png.readUInt32BE(16), viewport.width, `screenshot width should match the CSS viewport for ${route}`);
      assert.equal(png.readUInt32BE(20), viewport.height, `screenshot height should match the CSS viewport for ${route}`);
    }
    return { dom, imagePath: screenshot ? imagePath : null };
  } finally {
    socket.close();
    if (child.exitCode === null) child.kill();
    if (child.exitCode === null) await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1500);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

try {
  await new Promise((resolveListen, rejectListen) => { server.once("error", rejectListen); server.listen(0, "127.0.0.1", resolveListen); });
  const userDesktop = await launch("/app", { width: 1440, height: 1000 }, "user-passed");
  const userMobile = await launch("/app", { width: 390, windowWidth: 310, height: 844 }, "user-passed");
  assert.equal(submissions.length, 2, "each responsive user-browser run should complete one server-confirmed suggestion");
  for (const item of submissions) {
    assert.equal(item.body.content, "ایدهٔ کاربر 🌱\nخط دوم");
    assert.equal(item.body.screenKey, "dashboard.home");
    assert.equal(item.body.clientSubmissionId, item.idempotencyKey);
    assert.equal(item.businessId, ids.business);
    assert.equal(item.branchId, ids.branch);
  }

  if (process.argv.includes("--user-only")) {
    console.log(`Kaash user browser smoke passed on desktop/mobile. Screenshots: ${[userDesktop.imagePath, userMobile.imagePath].join(", ")} (${browser}).`);
  } else {
  const adminDesktop = await launch(`/system-admin/kaash/${ids.submission}`, { width: 1440, height: 1100 }, "admin-detail-passed");
  const adminMobile = await launch(`/system-admin/kaash/${ids.submission}`, { width: 390, windowWidth: 310, height: 844 }, "admin-detail-passed");
  const listDesktop = await launch("/system-admin/kaash", { width: 1440, height: 1000 }, "admin-list-passed");
  const listMobile = await launch("/system-admin/kaash", { width: 390, windowWidth: 310, height: 844 }, "admin-list-passed");
  const story = await launch(`/system-admin/kaash/${ids.submission}/story`, { width: 1080, height: 1920 }, "story-passed");
  const storyMobile = await launch(`/system-admin/kaash/${ids.submission}/story`, { width: 390, windowWidth: 310, height: 844 }, "story-passed");
  console.log(`Kaash browser smoke passed: user modal submit and nested-dialog state, admin list/detail, and anonymous story preview on desktop/mobile. Mobile widths list=${listMobile.dom.match(/data-kaash-widths="([^"]*)"/)?.[1] ?? "?"}, detail=${adminMobile.dom.match(/data-kaash-widths="([^"]*)"/)?.[1] ?? "?"}. Screenshots: ${[userDesktop.imagePath, userMobile.imagePath, adminDesktop.imagePath, adminMobile.imagePath, listDesktop.imagePath, listMobile.imagePath, story.imagePath, storyMobile.imagePath].join(", ")} (${browser}).`);
  }
} finally {
  for (const child of children) if (child.exitCode === null) child.kill();
  await new Promise((resolveClose) => server.close(resolveClose));
  for (const profile of profiles) {
    if (!existsSync(profile) || !profile.startsWith(tempParent + sep)) continue;
    for (let attempt = 0; ; attempt++) {
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); break; }
      catch (error) {
        if (attempt >= 24 || !["EBUSY", "ENOTEMPTY", "EPERM", "EACCES"].includes(error?.code)) throw error;
        await new Promise((resolveRetry) => setTimeout(resolveRetry, 500));
      }
    }
  }
  // Screenshots are retained until inspected by the caller and then removed from this temporary path.
}
