import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const webRoot = resolve(root, "apps/web/dist");
const tempParent = resolve(root, ".tmp");
const browserCandidates = [
  process.env.SHOPRO_BROWSER_EXECUTABLE,
  process.platform === "win32" ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" : undefined,
  process.platform === "win32" ? "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe" : undefined,
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
].filter(Boolean);
const browser = browserCandidates.find((candidate) => existsSync(candidate));
if (!browser) throw new Error("Set SHOPRO_BROWSER_EXECUTABLE to a local Chromium or Edge executable to run this smoke test.");
if (!existsSync(join(webRoot, "index.html"))) throw new Error("Build the web app before running the onboarding browser smoke test.");
mkdirSync(tempParent, { recursive: true });

const scenarios = new Map();
function createScenario(role) {
  const invited = role !== "OWNER";
  const state = {
    role,
    business: invited ? { id: `business-${role.toLowerCase()}`, displayName: "کسب‌وکار دعوت‌شده", businessType: "فروشگاه", timezone: "Asia/Tehran", displayCurrency: "IRT", role, branches: [{ id: `branch-${role.toLowerCase()}`, name: "شعبهٔ انبار", code: "MAIN" }] } : null,
    created: false,
    createCalls: 0,
    createKeys: [],
    product: null,
    financialStartMode: null,
    skippedSteps: new Set(),
    firstDocument: null,
    resultViewed: false,
    events: [],
    onboardingScopeRequests: [],
    missingOnboardingScopeRequests: 0,
  };
  scenarios.set(role, state);
  return state;
}

function onboardingState(state) {
  const branch = state.business?.branches[0] ?? { id: "branch-owner", name: "شعبه اصلی", code: "MAIN" };
  const role = state.role;
  const ownerCanAdd = ["OWNER", "MANAGER", "ACCOUNTANT"].includes(role);
  const canWrite = ["OWNER", "MANAGER", "ACCOUNTANT", "CASHIER"].includes(role);
  const nextAction = role === "VIEWER"
    ? { title: "مشاهدهٔ فاکتورهای شعبه", href: "/app/invoices", description: "دسترسی شما فقط مشاهده است؛ ثبت یا تغییر سند برای این نقش فعال نیست." }
    : role === "ACCOUNTANT"
      ? { title: "ثبت اولین عملیات مالی", href: "/app/sales", description: "فروش، خرید یا هزینهٔ مجاز را ثبت کنید؛ سپس دفتر مالی و گزارش‌های شعبه را بررسی کنید." }
      : { title: "ثبت اولین فروش", href: "/app/sales", description: "بعد از ثبت، نتیجهٔ واقعی را در فاکتور و داشبورد می‌بینید." };
  const status = (complete, id, allowed = true) => complete ? "DONE" : state.skippedSteps.has(id) ? "SKIPPED" : allowed ? "NEEDS_ACTION" : "UNAVAILABLE";
  const steps = [
    { id: "business_created", title: "کسب‌وکار ساخته شد", status: "DONE", optional: false, href: null },
    { id: "branch_ready", title: "شعبه آماده شد", status: "DONE", optional: false, href: null },
    { id: "subscription", title: "وضعیت اشتراک شعبه", status: "OPTIONAL", optional: true, href: "/app/subscription" },
    { id: "financial_start_mode", title: "روش شروع مالی انتخاب شد", status: state.financialStartMode ? "DONE" : status(false, "financial_start_mode", ["OWNER", "ACCOUNTANT"].includes(role)), optional: true, href: null },
    { id: "product", title: "کالا یا خدمت اضافه شد", status: status(Boolean(state.product), "product", ownerCanAdd), optional: true, href: ownerCanAdd ? "/app/products" : null },
    { id: "first_operation", title: "اولین عملیات واقعی ثبت شد", status: status(Boolean(state.firstDocument), "first_operation", canWrite), optional: true, href: nextAction.href },
    { id: "result_viewed", title: "نتیجهٔ ثبت دیده شد", status: state.resultViewed ? "DONE" : state.firstDocument ? "NEEDS_ACTION" : "WAITING", optional: true, href: "/app" },
    { id: "team", title: "اعضای تیم دعوت شدند", status: state.business?.role === "OWNER" && state.created ? "NEEDS_ACTION" : "DONE", optional: true, href: role === "OWNER" ? "/app/settings" : null },
    { id: "opening_balances", title: "اطلاعات آغازین مالی کامل شد", status: state.skippedSteps.has("opening_balances") ? "SKIPPED" : "UNAVAILABLE", optional: true, href: "/app/inventory" },
  ];
  return {
    business: { id: state.business?.id ?? "business-owner", name: state.business?.displayName ?? "فروشگاه نمونه", displayCurrency: "IRT", timezone: "Asia/Tehran" },
    branch,
    role,
    roleLabel: ({ OWNER: "مالک", MANAGER: "مدیر", ACCOUNTANT: "حسابدار", CASHIER: "صندوقدار", VIEWER: "مشاهده‌گر" })[role],
    nextAction,
    subscription: { status: "OBSERVE", rolloutMode: "OBSERVE", period: null },
    financialStartMode: state.financialStartMode,
    resultViewedAt: state.resultViewed ? "2026-11-04T10:00:00.000Z" : null,
    resultViewedByCurrentUser: state.resultViewed,
    firstDocument: state.firstDocument,
    productCount: state.product ? 1 : 0,
    steps,
    activationComplete: Boolean(state.firstDocument && state.resultViewed),
    openingBalancesSupported: false,
  };
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try { resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".webp", "image/webp"], [".svg", "image/svg+xml"], [".woff2", "font/woff2"],
  [".woff", "font/woff"], [".json", "application/json"], [".webmanifest", "application/manifest+json"],
]);
const injectedAutomation = `
<script>
(() => {
  const scenario = new URLSearchParams(location.search).get("smoke") || sessionStorage.getItem("shopro_onboarding_smoke_scenario") || "login";
  if (scenario !== "login") sessionStorage.setItem("shopro_onboarding_smoke_scenario", scenario);
  if (scenario === "CASHIER") {
    sessionStorage.removeItem("shopro_business_id");
    sessionStorage.removeItem("shopro_branch_id");
    localStorage.setItem("shopro_last_scope_cashier-user", JSON.stringify({ businessId: "business-cashier", branchId: "branch-cashier" }));
  }
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    headers.set("x-shopro-smoke-scenario", scenario);
    return nativeFetch(input, { ...init, headers });
  };
  if (scenario === "login") return;
  const sleep = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, label, timeout = 20000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = await predicate();
      if (value) return value;
      await sleep();
    }
    throw new Error("timeout: " + label);
  };
  const buttons = () => [...document.querySelectorAll("button")];
  const links = () => [...document.querySelectorAll("a")];
  const findButton = (text, root = document) => [...root.querySelectorAll("button")].find((element) => element.textContent.trim().includes(text));
  const clickButton = async (text, root = document) => { const button = await waitFor(() => findButton(text, root), "button " + text); button.click(); await sleep(140); return button; };
  const setValue = (element, value) => {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    if (!(element instanceof HTMLSelectElement)) element.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const getState = async () => (await (await fetch("/__smoke/state?scenario=" + encodeURIComponent(scenario))).json());
  const report = (name) => {
    if (name === "owner-review-ready") document.documentElement.dataset.onboardingReview = "shown";
    else document.documentElement.dataset.onboardingSmoke = name;
  };
  const productCard = () => [...document.querySelectorAll(".onboarding-step-card")].find((card) => card.querySelector("h2")?.textContent.includes("کالا یا خدمت"));
  async function ownerStart() {
    await waitFor(() => document.querySelector("#business-name"), "business wizard");
    setValue(document.querySelector("#business-name"), "فروشگاه آزمایشی مرورگر");
    await clickButton("ادامه به ساخت شعبه");
    const branch = await waitFor(() => document.querySelector("#branch-name"), "branch form");
    setValue(branch, "شعبه اصلی");

    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    window.dispatchEvent(new Event("offline"));
    await clickButton("اتصال اینترنت لازم است");
    await waitFor(() => [...document.querySelectorAll(".notice-error")].some((item) => item.textContent.includes("اتصال اینترنت")), "offline creation warning");
    if ((await getState()).createCalls !== 0) throw new Error("offline business creation reached the API");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    window.dispatchEvent(new Event("online"));
    await clickButton("ساخت کسب‌وکار و شعبه");
    await waitFor(() => [...document.querySelectorAll(".notice-error")].some((item) => item.textContent.includes("پاسخ شبکه")), "recoverable creation error");
    const failed = await getState();
    if (failed.createCalls !== 1 || failed.businessRecords !== 1) throw new Error("the simulated lost response did not retain exactly one business");
    await clickButton("ساخت کسب‌وکار و شعبه");
    await waitFor(() => location.pathname === "/app/onboarding", "onboarding after idempotent retry");
    const created = await getState();
    if (created.createCalls !== 2 || created.businessRecords !== 1 || created.createKeys[0] !== created.createKeys[1]) throw new Error("business retry did not reuse its idempotency key");

    await waitFor(() => document.querySelector(".onboarding-choice"), "financial start choice");
    await clickButton("از امروز شروع می‌کنم");
    await clickButton("بدون افزودن کالا ادامه می‌دهم", await waitFor(productCard, "product step"));
    await waitFor(() => productCard()?.querySelector(".onboarding-status-skipped"), "persisted skip status");
    sessionStorage.setItem("shopro_onboarding_smoke_phase", "resume");
    location.reload();
  }

  async function ownerResume() {
    await waitFor(() => location.pathname === "/app/onboarding" && productCard()?.querySelector(".onboarding-status-skipped"), "skip after refresh");
    await clickButton("ادامهٔ", productCard());
    await waitFor(() => location.pathname === "/app/products", "resume navigation");
    sessionStorage.setItem("shopro_onboarding_smoke_phase", "finish");
    location.assign("/app/onboarding?smoke=owner");
  }

  async function ownerFinish() {
    await waitFor(() => location.pathname === "/app/onboarding" && productCard()?.querySelector("#onboarding-product-name"), "resumed product form");

    setValue(document.querySelector("#onboarding-product-name"), "کالای آزمایشی");
    await waitFor(() => document.querySelector("#onboarding-product-unit")?.value, "default product unit");
    setValue(document.querySelector("#onboarding-sale-price"), "مبلغ نامعتبر");
    await clickButton("افزودن کالا یا خدمت");
    await waitFor(() => document.querySelector("#onboarding-sale-price-error")?.textContent.includes("مبلغ"), "inline sale price validation");
    if ((await getState()).product) throw new Error("invalid product price reached the API");
    setValue(document.querySelector("#onboarding-sale-price"), "۱۲۳۴٫۵");
    await clickButton("افزودن کالا یا خدمت");
    await waitFor(async () => (await getState()).product?.name === "کالای آزمایشی", "product creation");
    const saleLink = await waitFor(() => links().find((link) => link.textContent.includes("ثبت اولین فروش")), "role-appropriate sale action");
    saleLink.click();
    await waitFor(() => location.pathname === "/app/sales", "sales page");
    await clickButton("ثبت فروش");
    await clickButton("افزودن کالا یا خدمت از فهرست");
    const productPick = await waitFor(() => document.querySelector(".product-pick"), "product picker item");
    productPick.click();
    const saleDialog = await waitFor(() => document.querySelector(".app-modal[role='dialog'] form button[type='submit']"), "sale draft submit");
    saleDialog.click();
    await waitFor(() => location.pathname === "/app/invoices/smoke-invoice", "invoice detail");
    const review = await waitFor(() => document.querySelector(".onboarding-operation-review"), "final operation review");
    const reviewText = review.textContent;
    if (!reviewText.includes("شعبه اصلی") || !reviewText.includes("۱۴۰۵") || !reviewText.includes("۱٬۲۳۴٫۵ تومان")) throw new Error("review summary omitted branch, Jalali date, or total");
    report("owner-review-ready");
    const finalizeButton = await waitFor(() => [...document.querySelectorAll(".app-modal[role='dialog'] button[type='submit']")].find((button) => button.textContent.includes("تأیید ثبت نهایی")), "post operation confirmation");
    finalizeButton.click();
    await waitFor(async () => (await getState()).firstDocument?.id === "smoke-invoice", "server-confirmed document post");
    const brandLink = document.querySelector(".top-brand");
    if (!brandLink) throw new Error("top brand link was not rendered");
    brandLink.click();
    await waitFor(() => location.pathname === "/app" && document.querySelector(".onboarding-resume-card"), "dashboard result");
    await waitFor(async () => (await getState()).resultViewed, "result viewed progress");
    await waitFor(() => document.querySelector(".onboarding-resume-card.complete"), "completed result card");
    const prompt = new Event("beforeinstallprompt", { cancelable: true });
    prompt.prompt = async () => {};
    prompt.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(prompt);
    await waitFor(() => document.querySelector(".pwa-install-nudge"), "supported installation prompt");
    await clickButton("نصب شاپرو", document.querySelector(".pwa-install-nudge"));
    await waitFor(async () => { const current = await getState(); return current.events.includes("pwa_install_prompt_shown") && current.events.includes("pwa_install_prompt_accepted"); }, "install analytics");
    const resumeLink = await waitFor(() => links().find((link) => link.getAttribute("href") === "/app/onboarding" && link.textContent.includes("راهنمای شروع")) ?? links().find((link) => link.getAttribute("href") === "/app/onboarding"), "onboarding checklist link");
    resumeLink.click();
    await waitFor(() => location.pathname === "/app/onboarding" && document.querySelector(".onboarding-progress-card")?.textContent.includes("اولین نتیجه را دیدید"), "completed onboarding state");
    const mobileLayout = window.matchMedia("(max-width: 760px)").matches
      && getComputedStyle(document.querySelector(".bottom-nav")).display !== "none"
      && getComputedStyle(document.querySelector(".mobile-menu")).display !== "none";
    if (document.documentElement.dir !== "rtl" || !mobileLayout || document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1) {
      const overflowing = [...document.querySelectorAll("body *")].map((element) => ({
        tag: element.tagName.toLowerCase(), className: typeof element.className === "string" ? element.className : "",
        left: Math.round(element.getBoundingClientRect().left), right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width),
      })).filter((item) => item.right > window.innerWidth + 1 || item.left < -1).slice(0, 8);
      throw new Error("mobile RTL overflow: viewport=" + window.innerWidth + ", document=" + document.documentElement.scrollWidth + ", body=" + document.body.scrollWidth + ", elements=" + JSON.stringify(overflowing));
    }
    report("owner-pass");
  }

  async function invitedJourney() {
    await waitFor(() => location.pathname === "/app/onboarding" && document.querySelector(".onboarding-progress-card"), "invited user onboarding");
    const scopeState = await getState();
    if (scopeState.missingOnboardingScopeRequests !== 0) throw new Error("onboarding API was called before the saved business and branch scope was restored");
    if (!scopeState.onboardingScopeRequests.length || scopeState.onboardingScopeRequests.some((scope) => scope.businessId !== "business-cashier" || scope.branchId !== "branch-cashier")) throw new Error("invited onboarding did not send the authorized business and branch headers");
    const page = document.querySelector(".page-wrap");
    if (!page?.textContent.includes("کسب‌وکار دعوت‌شده") || !page.textContent.includes("شعبهٔ انبار") || !page.textContent.includes("صندوقدار")) throw new Error("invited user scope and role were not shown");
    if (document.querySelector(".onboarding-wizard-card")) throw new Error("invited user entered business creation");
    if (!links().some((link) => link.getAttribute("href") === "/app/sales" && link.textContent.includes("ثبت اولین فروش"))) throw new Error("cashier did not get the sales action");
    if (document.querySelector(".pwa-install-nudge")) throw new Error("unsupported browser received an install prompt");
    report("invited-pass");
  }

  const ownerPhase = sessionStorage.getItem("shopro_onboarding_smoke_phase") || "start";
  const task = scenario === "owner"
    ? ownerPhase === "start" ? ownerStart() : ownerPhase === "resume" ? ownerResume() : ownerPhase === "finish" ? ownerFinish() : Promise.resolve(report("owner-pass"))
    : invitedJourney();
  task.catch((error) => {
    document.documentElement.dataset.onboardingSmoke = "failed";
    document.documentElement.dataset.onboardingSmokeError = encodeURIComponent(String(error?.stack || error));
    const output = document.createElement("pre");
    output.id = "onboarding-smoke-error";
    output.textContent = String(error?.stack || error);
    document.body.append(output);
  });
})();
</script>`;

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const rawRole = request.headers["x-shopro-smoke-scenario"] || url.searchParams.get("scenario") || "login";
  const role = rawRole.toLowerCase() === "owner" ? "OWNER" : rawRole.toUpperCase();
  if (url.pathname === "/__smoke/state") {
    const state = scenarios.get(role);
    sendJson(response, 200, state ? { createCalls: state.createCalls, businessRecords: state.business ? 1 : 0, createKeys: state.createKeys, product: state.product, firstDocument: state.firstDocument, resultViewed: state.resultViewed, events: state.events, onboardingScopeRequests: state.onboardingScopeRequests, missingOnboardingScopeRequests: state.missingOnboardingScopeRequests } : {});
    return;
  }
  if (url.pathname.startsWith("/api/v1/")) {
    const state = scenarios.get(role);
    if (url.pathname === "/api/v1/auth/session") {
      if (role === "login") { sendJson(response, 401, { code: "HTTP_401", message: "برای ادامه وارد حساب کاربری شوید." }); return; }
      sendJson(response, 200, { user: { id: role === "OWNER" ? "owner-user" : "cashier-user", phone: "09120000000", displayName: "کاربر آزمایشی" } });
      return;
    }
    if (!state) { sendJson(response, 401, { code: "HTTP_401", message: "نشست آزمایشی در دسترس نیست." }); return; }
    const method = request.method ?? "GET";
    if (url.pathname === "/api/v1/businesses" && method === "GET") { sendJson(response, 200, state.business ? [state.business] : []); return; }
    if (url.pathname === "/api/v1/businesses" && method === "POST") {
      const body = await readBody(request);
      const key = request.headers["idempotency-key"] ?? "";
      state.createCalls++;
      state.createKeys.push(key);
      if (!state.business) {
        state.business = { id: "business-owner", displayName: body.displayName, businessType: body.businessType ?? "فروشگاه", timezone: "Asia/Tehran", displayCurrency: body.displayCurrency ?? "IRT", role: "OWNER", branches: [{ id: "branch-owner", name: body.initialBranchName, code: "MAIN" }] };
      }
      if (state.createCalls === 1) { sendJson(response, 503, { code: "SMOKE_NETWORK_ERROR", message: "پاسخ شبکه برای شبیه‌سازی پاسخ گم‌شده دریافت نشد؛ دوباره تلاش کنید." }); return; }
      sendJson(response, 201, { id: state.business.id, displayName: state.business.displayName, role: "OWNER", branch: state.business.branches[0], displayCurrency: state.business.displayCurrency });
      return;
    }
    if (url.pathname === "/api/v1/onboarding" && method === "GET") {
      const businessId = request.headers["x-business-id"];
      const branchId = request.headers["x-branch-id"];
      state.onboardingScopeRequests.push({ businessId: businessId ?? null, branchId: branchId ?? null });
      if (!businessId || !branchId) {
        state.missingOnboardingScopeRequests++;
        sendJson(response, 403, { code: "HTTP_403", message: "ابتدا یک کسب‌وکار و شعبهٔ مجاز را انتخاب کنید." });
        return;
      }
      if (businessId !== state.business?.id || branchId !== state.business?.branches[0]?.id) {
        sendJson(response, 403, { code: "HTTP_403", message: "به این کسب‌وکار یا شعبه دسترسی ندارید." });
        return;
      }
      sendJson(response, 200, onboardingState(state));
      return;
    }
    if (url.pathname === "/api/v1/onboarding/progress" && method === "PATCH") {
      const body = await readBody(request);
      if (body.action === "select_financial_start_mode") state.financialStartMode = body.financialStartMode;
      else if (body.action === "skip_step") state.skippedSteps.add(body.stepId);
      else if (body.action === "resume_step") state.skippedSteps.delete(body.stepId);
      else if (body.action === "mark_result_viewed" && state.firstDocument) state.resultViewed = true;
      sendJson(response, 200, onboardingState(state)); return;
    }
    if (url.pathname === "/api/v1/onboarding/events" && method === "POST") {
      const body = await readBody(request);
      state.events.push(body.eventName);
      sendJson(response, 201, { accepted: true }); return;
    }
    if (url.pathname === "/api/v1/subscriptions/current") { sendJson(response, 200, { status: "OBSERVE", rolloutMode: "OBSERVE", period: null }); return; }
    if (url.pathname === "/api/v1/products/units") { sendJson(response, 200, [{ id: "unit-piece", labelFa: "عدد", precision: 0 }]); return; }
    if (url.pathname === "/api/v1/products" && method === "GET") {
      const items = state.product ? [{ ...state.product, unit: { id: "unit-piece", labelFa: "عدد", precision: 0 }, taxRateBasisPoints: 0, quantityOnHand: "0", trackInventory: true }] : [];
      sendJson(response, 200, { items, hasMore: false, nextCursor: null }); return;
    }
    if (url.pathname === "/api/v1/products" && method === "POST") {
      const body = await readBody(request);
      state.product = { id: "product-owner", name: body.name, salePriceRial: body.salePriceRial, defaultCostRial: body.defaultCostRial ?? null, kind: body.kind, unitId: body.unitId };
      sendJson(response, 201, state.product); return;
    }
    if (url.pathname.startsWith("/api/v1/products?") && method === "GET") { sendJson(response, 200, { items: state.product ? [{ ...state.product, unit: { id: "unit-piece", labelFa: "عدد", precision: 0 }, taxRateBasisPoints: 0, quantityOnHand: "0", trackInventory: true }] : [], hasMore: false, nextCursor: null }); return; }
    if (url.pathname.startsWith("/api/v1/products") && method === "GET") { sendJson(response, 200, []); return; }
    if (url.pathname === "/api/v1/parties" && method === "GET") { sendJson(response, 200, []); return; }
    if (url.pathname === "/api/v1/finance/accounts") { sendJson(response, 200, [{ id: "cash-owner", name: "صندوق", kind: "CASH", balanceRial: "0" }]); return; }
    if (url.pathname === "/api/v1/sales" && method === "POST") {
      state.saleDraft = await readBody(request);
      sendJson(response, 201, { id: "smoke-invoice" }); return;
    }
    if (url.pathname === "/api/v1/sales/smoke-invoice" && method === "GET") {
      sendJson(response, 200, { id: "smoke-invoice", invoiceNo: "S-000001", date: state.saleDraft?.txnDate ?? "2026-11-04", customerId: null, customer: null, status: state.firstDocument ? "POSTED" : "DRAFT", documentType: "SALE", returnOf: null, returnReason: null, subtotalRial: "12345", discountRial: "0", taxRial: "0", totalRial: "12345", note: null, lines: [{ id: "line-a", productId: "product-owner", description: "کالای آزمایشی", sku: null, quantity: "1", returnedQuantity: "0", unitCode: "عدد", unitPriceRial: "12345", discountRial: "0", taxRateBasisPoints: 0, taxRial: "0", totalRial: "12345" }], payments: [], returns: [] }); return;
    }
    if (url.pathname === "/api/v1/sales/smoke-invoice/post" && method === "POST") {
      state.firstDocument = { id: "smoke-invoice", type: "فروش", reference: "S-000001", date: "2026-11-04", href: "/app/invoices/smoke-invoice" };
      sendJson(response, 201, { id: "smoke-invoice", invoiceNo: "S-000001", status: "POSTED" }); return;
    }
    if (url.pathname === "/api/v1/reports/dashboard") { sendJson(response, 200, { displayCurrency: "IRT", salesRial: "12345", netSalesRial: state.firstDocument ? "12345" : "0", receiptsRial: "0", expensesRial: "0", grossProfitRial: null, grossProfitAvailable: false, salesCount: state.firstDocument ? 1 : 0, expenseCount: 0, accountBalances: [], cashPositionRial: "0", lowStock: [], openInvoices: 0, salesTrend: [] }); return; }
    sendJson(response, 200, []);
    return;
  }

  let target;
  try { target = resolve(webRoot, `.${decodeURIComponent(url.pathname)}`); }
  catch { response.writeHead(400).end(); return; }
  if (!target.startsWith(webRoot + sep) && target !== join(webRoot, "index.html")) { response.writeHead(400).end(); return; }
  const file = existsSync(target) && statSync(target).isFile() ? target : join(webRoot, "index.html");
  response.writeHead(200, { "content-type": mimeTypes.get(extname(file)) ?? "application/octet-stream", "cache-control": "no-store" });
  if (file === join(webRoot, "index.html")) {
    response.end(readFileSync(file, "utf8").replace("</head>", `${injectedAutomation}</head>`));
    return;
  }
  createReadStream(file).pipe(response);
});

async function runBrowser(url, scenario, viewport) {
  const profile = resolve(tempParent, `shopro-onboarding-smoke-${randomUUID()}`);
  if (!profile.startsWith(tempParent + sep)) throw new Error("Refusing to create a browser profile outside workspace .tmp.");
  const args = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--virtual-time-budget=60000", `--window-size=${viewport}`, `--user-data-dir=${profile}`, "--dump-dom", url];
  const child = spawn(browser, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  child.stdout.setEncoding("utf8").on("data", (chunk) => stdout.push(chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => stderr.push(chunk));
  try {
    const exitCode = await new Promise((resolveExit, rejectExit) => {
      const timeout = setTimeout(() => { child.kill(); rejectExit(new Error("Headless browser did not finish onboarding smoke within 60 seconds.")); }, 60_000);
      child.once("error", (error) => { clearTimeout(timeout); rejectExit(error); });
      child.once("exit", (code) => { clearTimeout(timeout); resolveExit(code); });
    });
    const dom = stdout.join("");
    assert.equal(exitCode, 0, `Headless browser exited ${exitCode}: ${stderr.join("").slice(-1200)}`);
    const completed = dom.includes(`data-onboarding-smoke="${scenario}-pass"`);
    if (!completed) {
      const marker = dom.match(/data-onboarding-smoke="([^"]+)"/)?.[1] ?? "missing";
      const scriptError = decodeURIComponent(dom.match(/data-onboarding-smoke-error="([^"]+)"/)?.[1] ?? "none");
      throw new Error(`Browser workflow ${scenario} did not finish (marker=${marker}; script=${scriptError}; browser=${stderr.join("").slice(-500)}).`);
    }
    if (scenario === "owner") assert.match(dom, /data-onboarding-review="shown"/, "the sale confirmation review should have been shown before posting");
    console.log(`Onboarding browser smoke passed: ${scenario} flow in Edge/Chromium at ${viewport} (${browser}).`);
  } finally {
    if (child.exitCode === null) child.kill();
    if (existsSync(profile) && profile.startsWith(tempParent + sep)) {
      for (let attempt = 0; ; attempt++) {
        try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); break; }
        catch (error) {
          if (attempt >= 24 || !["EBUSY", "ENOTEMPTY", "EPERM", "EACCES"].includes(error?.code)) throw error;
          await new Promise((resolveRetry) => setTimeout(resolveRetry, 500));
        }
      }
    }
  }
}

try {
  await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  createScenario("OWNER");
  await runBrowser(`${origin}/login?smoke=owner`, "owner", "390,844");
  createScenario("CASHIER");
  await runBrowser(`${origin}/login?smoke=CASHIER`, "invited", "1280,900");
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}
