import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import argon2 from "argon2";
import { AppModule } from "../apps/api/dist/app.module.js";
import { ApiExceptionFilter } from "../apps/api/dist/common/api-exception.filter.js";
import { PrismaService } from "../apps/api/dist/prisma/prisma.service.js";
import { lockAttachmentMutationDuringBackup } from "../apps/api/dist/expenses/attachment-backup-lock.js";
import { ParsgreenService } from "../apps/api/dist/auth/parsgreen.service.js";
import { taxRial } from "../apps/api/dist/storefront/storefront-core.js";
import { createSystemAdminPageAuthMiddleware } from "../apps/api/dist/common/system-admin-page-auth.middleware.js";
import { SystemAdminAuthService } from "../apps/api/dist/auth/system-admin-auth.service.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL must target an isolated test database.");
const databaseUrl = new URL(connectionString);
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
if (!["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname.replace(/^\[|\]$/g, "")) || !/test/i.test(databaseName)) {
  throw new Error(`Refusing HTTP integration test outside loopback test database (host=${databaseUrl.hostname}, database=${databaseName}).`);
}

const hash = (value) => createHash("sha256").update(value).digest("hex");
const prisma = new PrismaService();
const fixtures = { businesses: [], users: [], expenses: [], stockCounts: [], storefronts: [], storefrontCards: [], storefrontOrders: [], storefrontOtpPhones: [] };
const previousAttachmentStorageDir = process.env.ATTACHMENT_STORAGE_DIR;
const previousSessionSecret = process.env.SESSION_SECRET;
const previousOtpHashSecret = process.env.OTP_HASH_SECRET;
const previousStorefrontCardKey = process.env.STOREFRONT_CARD_ENCRYPTION_KEY;
const previousWebOrigin = process.env.WEB_ORIGIN;
const previousCookieSecure = process.env.COOKIE_SECURE;
const previousAdminInitialPassword = process.env.SHOPRO_ADMIN_INITIAL_PASSWORD;
const previousAdminUsername = process.env.SHOPRO_ADMIN_USERNAME;
let attachmentRoot;
let auditFailureTriggerInstalled = false;
let restoreSmsAdapter;
let app;

try {
  await prisma.$connect();
  await prisma.$transaction((tx) => lockAttachmentMutationDuringBackup(tx));

  const createSessionUser = async (label) => {
    const user = await prisma.user.create({ data: { phone: `09${String(Date.now()).slice(-7)}${String(fixtures.users.length).padStart(2, "0")}`, displayName: label } });
    const rawSession = randomUUID();
    const csrf = randomUUID();
    await prisma.userSession.create({ data: { userId: user.id, tokenHash: hash(rawSession), csrfHash: hash(csrf), expiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
    fixtures.users.push(user.id);
    return { user, rawSession, csrf };
  };

  const owner = await createSessionUser("HTTP owner fixture");
  const manager = await createSessionUser("HTTP manager fixture");
  const accountant = await createSessionUser("HTTP accountant fixture");
  const cashier = await createSessionUser("HTTP cashier fixture");
  const viewer = await createSessionUser("HTTP viewer fixture");
  const outsider = await createSessionUser("HTTP other-tenant fixture");
  const suspended = await createSessionUser("HTTP suspended fixture");
  const businessA = await prisma.business.create({
    data: { displayName: `HTTP scope A ${randomUUID()}`, businessType: "test", branches: { create: [{ name: "A1", code: "HTTP-A1" }, { name: "A2", code: "HTTP-A2" }] } },
    include: { branches: { select: { id: true } } },
  });
  const businessB = await prisma.business.create({
    data: { displayName: `HTTP scope B ${randomUUID()}`, businessType: "test", branches: { create: [{ name: "B1", code: "HTTP-B1" }] } },
    include: { branches: { select: { id: true } } },
  });
  fixtures.businesses.push(businessA.id, businessB.id);
  const [branchA1, branchA2] = businessA.branches;
  const [branchB1] = businessB.branches;

  const ownerA = await prisma.businessMember.create({ data: { businessId: businessA.id, userId: owner.user.id, role: "OWNER" } });
  const managerA = await prisma.businessMember.create({ data: { businessId: businessA.id, userId: manager.user.id, role: "MANAGER" } });
  const accountantA = await prisma.businessMember.create({ data: { businessId: businessA.id, userId: accountant.user.id, role: "ACCOUNTANT" } });
  const cashierA = await prisma.businessMember.create({ data: { businessId: businessA.id, userId: cashier.user.id, role: "CASHIER" } });
  const viewerA = await prisma.businessMember.create({ data: { businessId: businessA.id, userId: viewer.user.id, role: "VIEWER" } });
  const suspendedA = await prisma.businessMember.create({ data: { businessId: businessA.id, userId: suspended.user.id, role: "OWNER", status: "SUSPENDED" } });
  const memberB = await prisma.businessMember.create({ data: { businessId: businessB.id, userId: outsider.user.id, role: "OWNER" } });
  await prisma.memberBranch.createMany({ data: [
    { businessId: businessA.id, memberId: ownerA.id, branchId: branchA1.id },
    { businessId: businessA.id, memberId: ownerA.id, branchId: branchA2.id },
    { businessId: businessA.id, memberId: managerA.id, branchId: branchA1.id },
    { businessId: businessA.id, memberId: accountantA.id, branchId: branchA1.id },
    { businessId: businessA.id, memberId: cashierA.id, branchId: branchA1.id },
    { businessId: businessA.id, memberId: viewerA.id, branchId: branchA1.id },
    { businessId: businessA.id, memberId: suspendedA.id, branchId: branchA1.id },
    { businessId: businessB.id, memberId: memberB.id, branchId: branchB1.id },
  ] });

  const unitA = await prisma.unit.create({ data: { businessId: businessA.id, code: "pcs", labelFa: "عدد", precision: 0, groupKey: "count", isVisible: true } });
  const unitB = await prisma.unit.create({ data: { businessId: businessB.id, code: "pcs", labelFa: "عدد", precision: 0, groupKey: "count", isVisible: true } });
  const serviceItemA = await prisma.catalogItem.create({ data: { businessId: businessA.id, branchId: branchA1.id, unitId: unitA.id, name: "Private A", normalizedName: "private a", kind: "SERVICE", salePriceRial: 100n } });
  const productA = await prisma.service.create({ data: { id: serviceItemA.id, businessId: businessA.id, branchId: branchA1.id } });
  const stockItemA = await prisma.catalogItem.create({ data: { businessId: businessA.id, branchId: branchA1.id, unitId: unitA.id, name: "Countable A", normalizedName: "countable a", kind: "STOCK", salePriceRial: 100n } });
  const stockProductA = await prisma.product.create({ data: { id: stockItemA.id, businessId: businessA.id, branchId: branchA1.id, defaultCostRial: 100n, trackInventory: true } });
  await prisma.inventoryBalance.create({ data: { businessId: businessA.id, branchId: branchA1.id, productId: stockProductA.id, quantityOnHand: "12", inventoryValueRial: 1200n, averageCostRial: 100n } });
  const serviceItemB = await prisma.catalogItem.create({ data: { businessId: businessB.id, branchId: branchB1.id, unitId: unitB.id, name: "Private B", normalizedName: "private b", kind: "SERVICE", salePriceRial: 200n } });
  await prisma.service.create({ data: { id: serviceItemB.id, businessId: businessB.id, branchId: branchB1.id } });
  const auditParty = await prisma.party.create({ data: { businessId: businessA.id, name: "Audit target", normalizedName: "audit target" } });
  await prisma.customer.create({ data: { id: auditParty.id, businessId: businessA.id } });
  await Promise.all([
    prisma.ledgerAccount.create({ data: { businessId: businessA.id, code: "HTTP-CASH", name: "HTTP cash", type: "ASSET", systemKey: "cash" } }),
    prisma.ledgerAccount.create({ data: { businessId: businessA.id, code: "HTTP-AR", name: "HTTP receivable", type: "ASSET", systemKey: "accounts_receivable" } }),
    prisma.ledgerAccount.create({ data: { businessId: businessA.id, code: "HTTP-REV", name: "HTTP revenue", type: "REVENUE", systemKey: "sales_revenue" } }),
  ]);
  const expenseLedger = await prisma.ledgerAccount.create({ data: { businessId: businessA.id, code: "HTTP-EXPENSE", name: "HTTP expense", type: "EXPENSE", systemKey: "general_expense" } });
  const expenseCategory = await prisma.expenseCategory.create({ data: { businessId: businessA.id, name: "HTTP expense", expenseLedgerAccountId: expenseLedger.id } });
  const expenseFixture = await prisma.expense.create({ data: { businessId: businessA.id, branchId: branchA1.id, categoryId: expenseCategory.id, txnDate: new Date("2026-11-03T00:00:00.000Z"), amountRial: 1200n, createdBy: owner.user.id } });
  fixtures.expenses.push(expenseFixture.id);

  const workspaceRoot = await realpath(process.cwd());
  const tempParent = resolve(workspaceRoot, ".tmp");
  await mkdir(tempParent, { recursive: true });
  const realTempParent = await realpath(tempParent);
  const tempRelativePath = relative(workspaceRoot, realTempParent);
  if (tempRelativePath === ".." || tempRelativePath.startsWith(`..${sep}`) || resolve(realTempParent) !== tempParent) {
    throw new Error(`Refusing attachment test storage outside workspace .tmp: ${realTempParent}`);
  }
  attachmentRoot = await mkdtemp(join(realTempParent, "shopro-http-attachments-"));
  process.env.ATTACHMENT_STORAGE_DIR = attachmentRoot;
  process.env.SESSION_SECRET = "shopro-http-attachment-test-session-secret-32-characters";
  process.env.OTP_HASH_SECRET = "shopro-http-storefront-test-otp-secret-32-characters";
  process.env.STOREFRONT_CARD_ENCRYPTION_KEY = Buffer.alloc(32, 0x5a).toString("base64url");
  process.env.WEB_ORIGIN = "http://localhost:5173";
  process.env.COOKIE_SECURE = "false";
  if (await prisma.systemAdmin.count() !== 0) throw new Error("The disposable HTTP integration database must not contain system-admin fixtures.");
  process.env.SHOPRO_ADMIN_USERNAME = "shopro_super_admin";
  const bootstrapPassword = randomBytes(32).toString("base64url");
  process.env.SHOPRO_ADMIN_INITIAL_PASSWORD = bootstrapPassword;
  const bootstrapAuth = new SystemAdminAuthService(prisma);
  await bootstrapAuth.onModuleInit();
  const bootstrappedAdmin = await prisma.systemAdmin.findUnique({ where: { username: "shopro_super_admin" }, select: { id: true, passwordHash: true } });
  assert.ok(bootstrappedAdmin?.passwordHash && await argon2.verify(bootstrappedAdmin.passwordHash, bootstrapPassword), "first bootstrap must create one Argon2id owner credential");
  const originalBootstrapHash = bootstrappedAdmin.passwordHash;
  process.env.SHOPRO_ADMIN_INITIAL_PASSWORD = randomBytes(32).toString("base64url");
  await bootstrapAuth.onModuleInit();
  const afterRepeatBootstrap = await prisma.systemAdmin.findUnique({ where: { username: "shopro_super_admin" }, select: { id: true, passwordHash: true } });
  assert.equal(await prisma.systemAdmin.count(), 1, "repeated bootstrap must not create a second admin");
  assert.equal(afterRepeatBootstrap?.passwordHash, originalBootstrapHash, "repeated deployment must not reset the existing owner password");
  await prisma.systemAdmin.delete({ where: { id: bootstrappedAdmin.id } });
  const legacyOwner = await prisma.systemAdmin.create({ data: { username: "shopro_super_admin", displayName: "Legacy owner fixture", isActive: true } });
  process.env.SHOPRO_ADMIN_INITIAL_PASSWORD = bootstrapPassword;
  const legacyBootstrapAuth = new SystemAdminAuthService(prisma);
  await legacyBootstrapAuth.onModuleInit();
  const adoptedLegacyOwner = await prisma.systemAdmin.findUnique({ where: { id: legacyOwner.id }, select: { passwordHash: true, passwordChangedAt: true } });
  assert.ok(adoptedLegacyOwner?.passwordHash && adoptedLegacyOwner.passwordChangedAt && await argon2.verify(adoptedLegacyOwner.passwordHash, bootstrapPassword), "one passwordless legacy owner row must be adopted without creating another account");
  process.env.SHOPRO_ADMIN_INITIAL_PASSWORD = randomBytes(32).toString("base64url");
  await legacyBootstrapAuth.onModuleInit();
  assert.equal((await prisma.systemAdmin.findUnique({ where: { id: legacyOwner.id }, select: { passwordHash: true } }))?.passwordHash, adoptedLegacyOwner.passwordHash, "legacy adoption must not reset an initialized owner password");
  assert.equal(await prisma.systemAdmin.count(), 1, "legacy adoption must preserve the single-owner invariant");
  await prisma.systemAdmin.delete({ where: { id: legacyOwner.id } });
  delete process.env.SHOPRO_ADMIN_INITIAL_PASSWORD;
  const ownerPassword = randomBytes(32).toString("base64url");
  const replacementPassword = randomBytes(32).toString("base64url");
  const ownerAdmin = await prisma.systemAdmin.create({ data: {
    username: "shopro_super_admin", passwordHash: await argon2.hash(ownerPassword, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
    passwordChangedAt: new Date(), displayName: "HTTP owner fixture", isActive: true,
  }, select: { id: true } });

  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }));
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

  const request = async (path, { auth, businessId, branchId, method = "GET", body, csrf = true, extraHeaders = {} } = {}) => {
    const headers = { ...extraHeaders };
    if (auth) headers.cookie = `shopro_session=${auth.rawSession}; shopro_csrf=${auth.csrf}`;
    if (businessId) headers["x-business-id"] = businessId;
    if (branchId) headers["x-branch-id"] = branchId;
    if (body !== undefined) headers["content-type"] = "application/json";
    if (auth && csrf && method !== "GET") headers["x-csrf-token"] = auth.csrf;
    const response = await fetch(`${baseUrl}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const payload = response.status === 204 ? null : await response.json();
    return { status: response.status, payload };
  };

  const adminSessionCookie = "shopro_admin_session";
  const captureAdminCookies = (response) => {
    const headers = response.headers.getSetCookie();
    const sessionLine = headers.find((line) => line.startsWith(`${adminSessionCookie}=`));
    const csrfLine = headers.find((line) => line.startsWith("shopro_admin_csrf="));
    assert.ok(sessionLine && csrfLine, "admin login/password change must issue separate session and CSRF cookies");
    assert.match(sessionLine, /HttpOnly/i);
    assert.match(sessionLine, /Path=\//i);
    assert.match(sessionLine, /SameSite=Strict/i);
    assert.doesNotMatch(sessionLine, /Domain=/i);
    assert.doesNotMatch(csrfLine, /HttpOnly/i);
    return {
      session: sessionLine.slice(`${adminSessionCookie}=`.length).split(";", 1)[0],
      csrf: csrfLine.slice("shopro_admin_csrf=".length).split(";", 1)[0],
    };
  };
  const adminRequest = async (path, { cookies, method = "GET", body, includeCsrf = true } = {}) => {
    const headers = { cookie: `${adminSessionCookie}=${cookies.session}; shopro_admin_csrf=${cookies.csrf}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (includeCsrf && method !== "GET") headers["x-csrf-token"] = cookies.csrf;
    const response = await fetch(`${baseUrl}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const payload = response.status === 204 ? null : await response.json();
    return { response, status: response.status, payload };
  };
  const loginAdmin = async (password) => {
    const response = await fetch(`${baseUrl}/system-admin/auth/login`, {
      method: "POST", headers: { origin: process.env.WEB_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ username: "shopro_super_admin", password }),
    });
    return { response, payload: await response.json() };
  };

  const protectedBeforeLogin = await request("/system-admin/dashboard");
  assert.equal(protectedBeforeLogin.status, 401, "admin dashboard must reject an anonymous request");
  const ordinaryUserAdminSession = await request("/system-admin/session", { auth: owner });
  assert.equal(ordinaryUserAdminSession.status, 401, "an ordinary seller session must not authorize the admin API");
  assert.equal((await request("/system-admin/auth/otp/request", { method: "POST", body: { phone: "09120000000" } })).status, 404, "the former public admin OTP route must not exist");
  assert.equal((await request("/system-admin/auth/otp/verify", { method: "POST", body: { phone: "09120000000", code: "000000" } })).status, 404, "the former admin OTP verification route must not exist");

  const firstLogin = await loginAdmin(ownerPassword);
  assert.equal(firstLogin.response.status, 200);
  assert.equal(firstLogin.payload.admin.username, "shopro_super_admin");
  assert.equal("rawSession" in firstLogin.payload, false, "raw session material must stay out of JSON responses");
  const firstCookies = captureAdminCookies(firstLogin.response);
  const sessionRow = await prisma.systemAdminSession.findUnique({ where: { tokenHash: hash(firstCookies.session) } });
  assert.ok(sessionRow && sessionRow.adminId === ownerAdmin.id);
  assert.equal(sessionRow.csrfHash, hash(firstCookies.csrf));
  const pageApp = express();
  pageApp.use(cookieParser());
  pageApp.use(createSystemAdminPageAuthMiddleware(prisma));
  pageApp.get("/system-admin/login", (_request, response) => response.status(200).send("owner login page"));
  pageApp.get("/system-admin", (_request, response) => response.status(200).send("owner admin page"));
  const pageServer = await new Promise((resolve) => { const server = pageApp.listen(0, "127.0.0.1", () => resolve(server)); });
  try {
    const pageAddress = pageServer.address();
    const pageUrl = `http://127.0.0.1:${pageAddress.port}`;
    assert.equal((await fetch(`${pageUrl}/system-admin/login`)).status, 200, "the standalone admin login page remains directly reachable");
    const anonymousAdminPage = await fetch(`${pageUrl}/system-admin`, { redirect: "manual" });
    assert.equal(anonymousAdminPage.status, 302, "the admin application page must redirect anonymous direct navigation to owner login");
    assert.equal(anonymousAdminPage.headers.get("location"), "/system-admin/login");
    assert.equal(anonymousAdminPage.headers.get("cache-control"), "private, no-store");
    const sellerAdminPage = await fetch(`${pageUrl}/system-admin`, { headers: { cookie: `shopro_session=${owner.rawSession}` }, redirect: "manual" });
    assert.equal(sellerAdminPage.status, 302, "seller cookies must not authorize direct admin page navigation");
    assert.equal(sellerAdminPage.headers.get("location"), "/system-admin/login");
    assert.equal((await fetch(`${pageUrl}/system-admin`, { headers: { cookie: `${adminSessionCookie}=${firstCookies.session}` } })).status, 200, "a current owner session may open the admin application page");
  } finally {
    await new Promise((resolve, reject) => pageServer.close((error) => error ? reject(error) : resolve()));
  }
  const sessionRead = await adminRequest("/system-admin/session", { cookies: firstCookies });
  assert.equal(sessionRead.status, 200);
  assert.equal(sessionRead.payload.admin.username, "shopro_super_admin");

  const kaashClientSubmissionId = randomUUID();
  const kaashText = "کاش گزارش روزانهٔ فروش را بهتر کنیم. ".repeat(7);
  const kaashBody = { clientSubmissionId: kaashClientSubmissionId, content: kaashText, screenKey: "sales.register" };
  assert.equal((await request("/kaash", { auth: owner, method: "POST", body: kaashBody })).status, 403, "a signed-in account without a selected active business scope cannot submit a suggestion");
  assert.equal((await request("/kaash", { auth: owner, businessId: businessA.id, branchId: branchB1.id, method: "POST", body: kaashBody })).status, 403, "a branch from another business must be rejected");
  assert.equal((await request("/kaash", { auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST", csrf: false, body: kaashBody })).status, 403, "suggestion submission must require user CSRF validation");
  assert.equal((await request("/kaash", { auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST", body: { ...kaashBody, userId: outsider.user.id, businessId: businessB.id, branchId: branchB1.id } })).status, 400, "client-supplied owner and scope ids must be rejected");
  const invalidScreen = await request("/kaash", { auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST", body: { ...kaashBody, screenKey: "/app/invoices?private=1" } });
  assert.equal(invalidScreen.status, 400, "raw paths and query strings are not accepted as source labels");
  assert.equal((await request("/kaash", { auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST", body: { ...kaashBody, clientSubmissionId: randomUUID(), content: "  \n " } })).status, 400, "blank suggestions must be rejected");
  assert.equal((await request("/kaash", { auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST", body: { ...kaashBody, clientSubmissionId: randomUUID(), content: "🙂".repeat(1001) } })).status, 400, "suggestions over 1000 Unicode characters must be rejected");
  const [kaashCreate, kaashDoubleClick] = await Promise.all([
    request("/kaash", { auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST", body: kaashBody }),
    request("/kaash", { auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST", body: kaashBody }),
  ]);
  assert.equal(kaashCreate.status, 201);
  assert.equal(kaashDoubleClick.status, 201);
  assert.equal(kaashCreate.payload.id, kaashDoubleClick.payload.id, "concurrent retries with one idempotency key must return one committed row");
  assert.equal("content" in kaashCreate.payload, false, "the create response must not echo sensitive suggestion text");
  const kaashRow = await prisma.kaashSubmission.findUnique({ where: { id: kaashCreate.payload.id }, include: { events: true } });
  assert.equal(kaashRow.userId, owner.user.id, "the server must bind the authenticated user, ignoring submitted identity fields");
  assert.equal(kaashRow.businessId, businessA.id);
  assert.equal(kaashRow.branchId, branchA1.id);
  assert.equal(kaashRow.content, kaashText.trim());
  assert.equal(kaashRow.events.length, 1);
  const secondTabId = randomUUID();
  const kaashSecondTab = await request("/kaash", { auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST", body: { ...kaashBody, clientSubmissionId: secondTabId } });
  assert.equal(kaashSecondTab.status, 201);
  assert.equal(kaashSecondTab.payload.id, kaashCreate.payload.id, "same-user/same-scope identical submissions from separate tabs must collapse to one row");
  assert.equal(await prisma.kaashSubmission.count({ where: { userId: owner.user.id } }), 1);

  assert.equal((await request("/system-admin/kaash/counts", { auth: owner })).status, 401, "an ordinary account session cannot read the owner-only suggestion count");
  assert.equal((await adminRequest("/system-admin/kaash/counts", { cookies: firstCookies })).status, 200);
  assert.equal((await adminRequest("/system-admin/kaash/query", { cookies: firstCookies, method: "POST", body: { q: "گزارش روزانه", status: "NEW", module: "SALES", page: 1, pageSize: 10 } })).payload.total, 1, "owner search and filters must use persisted rows");
  const kaashList = await adminRequest("/system-admin/kaash/query", { cookies: firstCookies, method: "POST", body: { page: 1, pageSize: 10 } });
  assert.equal(kaashList.status, 200);
  assert.equal(kaashList.payload.items[0].truncated, true, "the list returns a bounded preview rather than the full suggestion");
  assert.match(kaashList.payload.items[0].user.phoneMasked, /\d{4}$/);
  assert.doesNotMatch(JSON.stringify(kaashList.payload.items[0]), new RegExp(owner.user.phone));
  const kaashDetail = await adminRequest(`/system-admin/kaash/${kaashCreate.payload.id}`, { cookies: firstCookies });
  assert.equal(kaashDetail.status, 200);
  assert.equal(kaashDetail.payload.content, kaashText.trim());
  assert.equal((await adminRequest(`/system-admin/kaash/${kaashCreate.payload.id}/story`, { cookies: firstCookies })).status, 200);
  const kaashStory = await adminRequest(`/system-admin/kaash/${kaashCreate.payload.id}/story`, { cookies: firstCookies });
  assert.deepEqual(Object.keys(kaashStory.payload).sort(), ["content", "createdAt"]);
  assert.equal((await adminRequest(`/system-admin/kaash/${kaashCreate.payload.id}`, { cookies: firstCookies, method: "PATCH", includeCsrf: false, body: { status: "REVIEWING" } })).status, 403, "owner status changes must require admin CSRF");
  assert.equal((await adminRequest(`/system-admin/kaash/${kaashCreate.payload.id}`, { cookies: firstCookies, method: "PATCH", body: { status: "RELEASED" } })).status, 409, "the server must reject invalid workflow jumps");
  const kaashUpdate = await adminRequest(`/system-admin/kaash/${kaashCreate.payload.id}`, { cookies: firstCookies, method: "PATCH", body: { status: "REVIEWING", internalNote: "پیگیری داخلی مالک" } });
  assert.equal(kaashUpdate.status, 200);
  assert.equal(kaashUpdate.payload.status, "REVIEWING");
  assert.equal(kaashUpdate.payload.internalNote, "پیگیری داخلی مالک");
  assert.equal(kaashUpdate.payload.events.at(-1).kind, "ADMIN_UPDATED");
  const redactedStory = await adminRequest(`/system-admin/kaash/${kaashCreate.payload.id}/story`, { cookies: firstCookies });
  assert.equal(redactedStory.payload.content, kaashText.trim());
  assert.equal("internalNote" in redactedStory.payload, false);
  assert.equal("user" in redactedStory.payload, false);
  assert.equal("businessName" in redactedStory.payload, false);
  assert.equal((await adminRequest("/system-admin/kaash/counts", { cookies: firstCookies })).payload.newCount, 0);
  assert.equal((await request(`/system-admin/kaash/${kaashCreate.payload.id}`, { auth: owner })).status, 401, "a user session cannot read suggestion details through an admin route");

  const subscriptionPreview = await adminRequest(`/system-admin/subscriptions/branches/${branchA1.id}/preview`, {
    cookies: firstCookies, method: "POST", body: { kind: "grant", durationMonths: 1 },
  });
  assert.equal(subscriptionPreview.status, 200, "owner can request a server-computed Jalali subscription preview");
  assert.ok(subscriptionPreview.payload.effect.startsAt && subscriptionPreview.payload.effect.endsAt);
  const subscriptionWithoutReauth = await adminRequest(`/system-admin/subscriptions/branches/${branchA1.id}/grant`, {
    cookies: firstCookies, method: "POST", body: { durationMonths: 1, reason: "HTTP fixture subscription grant" },
  });
  assert.equal(subscriptionWithoutReauth.status, 400, "a direct subscription grant must require the current password field");
  const subscriptionWithWrongPassword = await adminRequest(`/system-admin/subscriptions/branches/${branchA1.id}/grant`, {
    cookies: firstCookies, method: "POST", body: { durationMonths: 1, reason: "HTTP fixture subscription grant", currentPassword: "invalid-step-up-password" },
  });
  assert.equal(subscriptionWithWrongPassword.status, 401, "a direct subscription grant must verify the current password server-side");
  assert.equal(await prisma.branchSubscription.count({ where: { businessId: businessA.id, branchId: branchA1.id } }), 0, "failed reauthentication must not change a subscription");
  const businessStatusWithWrongPassword = await adminRequest(`/system-admin/businesses/${businessA.id}/status`, {
    cookies: firstCookies, method: "PATCH", body: { isActive: false, reason: "HTTP fixture status change", currentPassword: "invalid-step-up-password" },
  });
  assert.equal(businessStatusWithWrongPassword.status, 401, "business status changes must verify the current password server-side");
  assert.equal((await prisma.business.findUnique({ where: { id: businessA.id }, select: { isActive: true } })).isActive, true, "failed reauthentication must not change business status");
  const auditRead = await adminRequest("/system-admin/audit/query", { cookies: firstCookies, method: "POST", body: { page: "1", pageSize: "25" } });
  assert.equal(auditRead.status, 200);
  assert.ok(auditRead.payload.items.some((row) => row.action === "subscription.admin_action.previewed" && row.summary));
  assert.ok(auditRead.payload.items.every((row) => !("metadata" in row)), "raw audit metadata must never be returned by the listing API");
  assert.equal((await adminRequest("/system-admin/auth/logout", { cookies: firstCookies, method: "POST", includeCsrf: false })).status, 403, "admin mutations must require CSRF");
  assert.equal((await adminRequest("/system-admin/auth/logout", { cookies: firstCookies, method: "POST" })).status, 204);
  assert.equal((await adminRequest("/system-admin/session", { cookies: firstCookies })).status, 401, "logout must revoke the server-side session");

  const secondLogin = await loginAdmin(ownerPassword);
  const thirdLogin = await loginAdmin(ownerPassword);
  assert.equal(secondLogin.response.status, 200);
  assert.equal(thirdLogin.response.status, 200);
  const secondCookies = captureAdminCookies(secondLogin.response);
  const thirdCookies = captureAdminCookies(thirdLogin.response);
  const passwordChange = await adminRequest("/system-admin/auth/change-password", {
    cookies: thirdCookies, method: "PATCH",
    body: { currentPassword: ownerPassword, newPassword: replacementPassword, confirmPassword: replacementPassword },
  });
  assert.equal(passwordChange.status, 200);
  const rotatedCookies = captureAdminCookies(passwordChange.response);
  assert.equal((await adminRequest("/system-admin/session", { cookies: secondCookies })).status, 401, "password change must revoke other sessions");
  assert.equal((await adminRequest("/system-admin/session", { cookies: thirdCookies })).status, 401, "password change must rotate the current session");
  assert.equal((await adminRequest("/system-admin/session", { cookies: rotatedCookies })).status, 200, "password change must return one fresh session");
  assert.equal((await adminRequest("/system-admin/auth/revoke-sessions", { cookies: rotatedCookies, method: "POST", body: { currentPassword: replacementPassword } })).status, 204);
  assert.equal((await adminRequest("/system-admin/session", { cookies: rotatedCookies })).status, 401, "revoke-all must invalidate the current session too");
  const replacementLogin = await loginAdmin(replacementPassword);
  assert.equal(replacementLogin.response.status, 200, "the new password must authenticate after rotation");
  const replacementCookies = captureAdminCookies(replacementLogin.response);
  assert.equal((await adminRequest("/system-admin/auth/logout", { cookies: replacementCookies, method: "POST" })).status, 204);

  const unknownUsername = await fetch(`${baseUrl}/system-admin/auth/login`, { method: "POST", headers: { origin: process.env.WEB_ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ username: "unknown_owner", password: ownerPassword }) });
  const wrongOwnerPassword = await fetch(`${baseUrl}/system-admin/auth/login`, { method: "POST", headers: { origin: process.env.WEB_ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ username: "shopro_super_admin", password: ownerPassword }) });
  assert.equal(unknownUsername.status, 401);
  assert.equal(wrongOwnerPassword.status, 401);
  assert.equal((await unknownUsername.json()).message, (await wrongOwnerPassword.json()).message, "login errors must not reveal whether the owner username exists");
  for (let attempt = 0; attempt < 3; attempt++) {
    const failed = await fetch(`${baseUrl}/system-admin/auth/login`, { method: "POST", headers: { origin: process.env.WEB_ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ username: "shopro_super_admin", password: ownerPassword }) });
    assert.equal(failed.status, 401);
  }
  const throttledLogin = await fetch(`${baseUrl}/system-admin/auth/login`, { method: "POST", headers: { origin: process.env.WEB_ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ username: "shopro_super_admin", password: ownerPassword }) });
  assert.equal(throttledLogin.status, 429, "repeated failures must be rate-limited");
  console.log("Single-owner HTTP auth checks passed: idempotent bootstrap/legacy adoption, direct admin-page gate, anonymous/seller denial, removed OTP routes, CSRF, password rotation, logout/revoke-all, reauthentication previews, audit redaction and rate limits.");

  const parsgreen = app.get(ParsgreenService);
  const originalSendOtp = parsgreen.sendOtp.bind(parsgreen);
  const sentStorefrontOtpCodes = new Map();
  parsgreen.sendOtp = async (phone, code) => { sentStorefrontOtpCodes.set(phone, code); };
  restoreSmsAdapter = () => { parsgreen.sendOtp = originalSendOtp; };

  const onboardingOwner = await createSessionUser("Onboarding retry fixture");
  const creationKey = randomUUID();
  const creationBody = { displayName: "Idempotent onboarding fixture", initialBranchName: "شعبه اصلی", displayCurrency: "IRT" };
  const businessesBeforeCreate = await prisma.business.count({ where: { displayName: creationBody.displayName } });
  const firstCreation = await request("/businesses", { auth: onboardingOwner, method: "POST", body: creationBody, extraHeaders: { "idempotency-key": creationKey } });
  assert.equal(firstCreation.status, 201, `new owner should be able to create a business and first branch: ${JSON.stringify(firstCreation.payload)}`);
  fixtures.businesses.push(firstCreation.payload.id);
  const retryCreation = await request("/businesses", { auth: onboardingOwner, method: "POST", body: creationBody, extraHeaders: { "idempotency-key": creationKey } });
  assert.equal(retryCreation.status, 201, `retry should return the saved business: ${JSON.stringify(retryCreation.payload)}`);
  assert.equal(retryCreation.payload.id, firstCreation.payload.id, "retry must return the same business id");
  assert.equal(retryCreation.payload.branch.id, firstCreation.payload.branch.id, "retry must return the same branch id");
  assert.equal(await prisma.business.count({ where: { displayName: creationBody.displayName } }), businessesBeforeCreate + 1, "retry must not duplicate business creation");
  const newOwnerOnboarding = await request("/onboarding", { auth: onboardingOwner, businessId: firstCreation.payload.id, branchId: firstCreation.payload.branch.id });
  assert.equal(newOwnerOnboarding.status, 200);
  assert.equal(newOwnerOnboarding.payload.business.name, creationBody.displayName);
  assert.equal(newOwnerOnboarding.payload.branch.name, creationBody.initialBranchName);
  assert.equal(newOwnerOnboarding.payload.role, "OWNER");
  const skippedProduct = await request("/onboarding/progress", { auth: onboardingOwner, businessId: firstCreation.payload.id, branchId: firstCreation.payload.branch.id, method: "PATCH", body: { action: "skip_step", stepId: "product" } });
  assert.equal(skippedProduct.status, 200);
  const refreshedAuth = { user: onboardingOwner.user, rawSession: randomUUID(), csrf: randomUUID() };
  await prisma.userSession.create({ data: { userId: onboardingOwner.user.id, tokenHash: hash(refreshedAuth.rawSession), csrfHash: hash(refreshedAuth.csrf), expiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
  const resumedSessionState = await request("/onboarding", { auth: refreshedAuth, businessId: firstCreation.payload.id, branchId: firstCreation.payload.branch.id });
  assert.equal(resumedSessionState.status, 200);
  assert.equal(resumedSessionState.payload.steps.find(({ id }) => id === "product").status, "SKIPPED", "progress must survive a new authenticated session");
  const reopenedProduct = await request("/onboarding/progress", { auth: refreshedAuth, businessId: firstCreation.payload.id, branchId: firstCreation.payload.branch.id, method: "PATCH", body: { action: "resume_step", stepId: "product" } });
  assert.equal(reopenedProduct.status, 200);
  assert.equal(reopenedProduct.payload.steps.find(({ id }) => id === "product").status, "NEEDS_ACTION");

  const missingSession = await request("/products", { businessId: businessA.id, branchId: branchA1.id });
  assert.equal(missingSession.status, 401, "protected API routes must require a user session");

  const tenantLeak = await request("/products", { auth: outsider, businessId: businessA.id, branchId: branchA1.id });
  assert.equal(tenantLeak.status, 403, "a member of another business must not select the target tenant");

  const branchLeak = await request("/products", { auth: cashier, businessId: businessA.id, branchId: branchA2.id });
  assert.equal(branchLeak.status, 403, "a member must not select an unassigned branch");
  const suspendedMemberAccess = await request("/products", { auth: suspended, businessId: businessA.id, branchId: branchA1.id });
  assert.equal(suspendedMemberAccess.status, 403, "a suspended membership must not authorize API access");

  const scopedList = await request("/products", { auth: owner, businessId: businessA.id, branchId: branchA1.id });
  assert.equal(scopedList.status, 200);
  assert.deepEqual(scopedList.payload.map(({ name }) => name), ["Countable A"], "product listings must contain only this tenant's stock items");

  const storefrontScope = { auth: owner, businessId: businessA.id, branchId: branchA1.id };
  const missingStorefront = await request("/storefront", storefrontScope);
  assert.equal(missingStorefront.status, 200, `storefront settings GET should work against the migrated schema: ${JSON.stringify(missingStorefront.payload)}`);
  assert.equal(missingStorefront.payload.settings, null);
  const storefrontSlug = `http-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const savedStorefront = await request("/storefront", {
    ...storefrontScope, method: "PATCH",
    body: {
      publicName: "HTTP storefront fixture", slug: storefrontSlug, description: "HTTP public flow",
      phone: owner.user.phone, address: "", showAddress: false, acceptsPickup: true, acceptsLocalDelivery: false,
      deliveryFeeRial: "0", showExactStock: false, preparationMinutes: 10,
      paymentInstructions: "پرداخت پس از پذیرش سفارش", cancellationPolicy: "لغو تا پیش از پذیرش",
      status: "PUBLISHED",
    },
  });
  assert.equal(savedStorefront.status, 200, `storefront settings should save: ${JSON.stringify(savedStorefront.payload)}`);
  fixtures.storefronts.push(savedStorefront.payload.settings.id);
  const storefrontListings = await request("/storefront/listings", storefrontScope);
  assert.equal(storefrontListings.status, 200);
  assert.ok(storefrontListings.payload.items.some(({ productId }) => productId === productA.id), "management should list the branch product");
  const bankLedger = await prisma.ledgerAccount.create({ data: { businessId: businessA.id, code: "HTTP-BANK", name: "HTTP storefront bank", type: "ASSET", systemKey: "http_storefront_bank" } });
  const bankAccount = await prisma.financeAccount.create({ data: { businessId: businessA.id, branchId: branchA1.id, ledgerAccountId: bankLedger.id, name: "HTTP storefront bank", kind: "BANK" } });
  const storefrontCard = await request("/storefront/cards", {
    ...storefrontScope, method: "POST",
    body: { financeAccountId: bankAccount.id, bankName: "Fixture Bank", holderName: "HTTP Store", cardNumber: "6037997512345670", displayOrder: 0 },
  });
  assert.equal(storefrontCard.status, 201, `owner should save an encrypted bank card: ${JSON.stringify(storefrontCard.payload)}`);
  fixtures.storefrontCards.push(storefrontCard.payload.id);
  const savedListing = await request(`/storefront/listings/${productA.id}`, {
    ...storefrontScope, method: "PATCH",
    body: { publicTitle: "HTTP public product", publicDescription: "Public catalog fixture", publicPriceRial: "1250", isPublished: true, canOrder: true, stockPolicy: "APPROXIMATE", minimumQuantity: "1", displayOrder: 0 },
  });
  assert.equal(savedListing.status, 200, `storefront listing should save: ${JSON.stringify(savedListing.payload)}`);
  const publicStore = await request(`/public/stores/${storefrontSlug}`);
  assert.equal(publicStore.status, 200, `public storefront should load: ${JSON.stringify(publicStore.payload)}`);
  assert.equal(publicStore.payload.acceptingOrders, true);
  const publicCatalog = await request(`/public/stores/${storefrontSlug}/products`);
  assert.equal(publicCatalog.status, 200, `public catalog should load: ${JSON.stringify(publicCatalog.payload)}`);
  const publicProduct = publicCatalog.payload.items.find(({ id }) => id === savedListing.payload.id);
  assert.ok(publicProduct, "published listing should appear in the public catalog");

  const storefrontPhone = `09${randomUUID().replace(/\D/g, "").padEnd(9, "0").slice(0, 9)}`;
  fixtures.storefrontOtpPhones.push(storefrontPhone);
  const otpRequest = await request(`/public/stores/${storefrontSlug}/otp/request`, { method: "POST", body: { phone: storefrontPhone } });
  assert.equal(otpRequest.status, 200, `public checkout OTP request should succeed: ${JSON.stringify(otpRequest.payload)}`);
  const otpCode = sentStorefrontOtpCodes.get(storefrontPhone);
  assert.match(otpCode ?? "", /^\d{6}$/, "OTP delivery should use the configured adapter");
  const otpVerification = await request(`/public/stores/${storefrontSlug}/otp/verify`, { method: "POST", body: { phone: storefrontPhone, code: otpCode } });
  assert.equal(otpVerification.status, 200, `public checkout OTP verification should succeed: ${JSON.stringify(otpVerification.payload)}`);
  const unitPrice = BigInt(publicProduct.unitPriceRial);
  const expectedTotal = unitPrice + taxRial(unitPrice, publicProduct.taxRateBasisPoints);
  const storefrontOrder = await request(`/public/stores/${storefrontSlug}/orders`, {
    method: "POST", extraHeaders: { "idempotency-key": `http-storefront-${randomUUID()}` },
    body: {
      customerName: "HTTP checkout customer", customerPhone: storefrontPhone, checkoutToken: otpVerification.payload.checkoutToken,
      deliveryMethod: "PICKUP", expectedTotalRial: expectedTotal.toString(),
      lines: [{ listingId: publicProduct.id, quantity: "1", expectedUnitPriceRial: publicProduct.unitPriceRial, expectedTaxRateBasisPoints: publicProduct.taxRateBasisPoints }],
    },
  });
  assert.equal(storefrontOrder.status, 201, `public checkout should create an order: ${JSON.stringify(storefrontOrder.payload)}`);
  fixtures.storefrontOrders.push(storefrontOrder.payload.id);
  const customerTracking = await request(`/public/orders/${storefrontOrder.payload.trackingToken}`);
  assert.equal(customerTracking.status, 200, `customer tracking should load: ${JSON.stringify(customerTracking.payload)}`);
  assert.equal(customerTracking.payload.status, "SUBMITTED");
  const storefrontOrderQueue = await request("/storefront/orders?limit=20", storefrontScope);
  assert.equal(storefrontOrderQueue.status, 200);
  assert.ok(storefrontOrderQueue.payload.items.some(({ id }) => id === storefrontOrder.payload.id), "management should show the public order");
  const storefrontOrderDetail = await request(`/storefront/orders/${storefrontOrder.payload.id}`, storefrontScope);
  assert.equal(storefrontOrderDetail.status, 200);
  const rejectedStorefrontOrder = await request(`/storefront/orders/${storefrontOrder.payload.id}/reject`, {
    ...storefrontScope, method: "POST", body: { reason: "HTTP integration rejection" },
  });
  assert.equal(rejectedStorefrontOrder.status, 201, `owner should be able to reject a submitted order: ${JSON.stringify(rejectedStorefrontOrder.payload)}`);
  const rejectedCustomerTracking = await request(`/public/orders/${storefrontOrder.payload.trackingToken}`);
  assert.equal(rejectedCustomerTracking.status, 200);
  assert.equal(rejectedCustomerTracking.payload.status, "REJECTED", "customer tracking should reflect management updates");

  const customerLoginOtpRequest = await request(`/public/stores/${storefrontSlug}/customer/otp/request`, { method: "POST", body: { phone: storefrontPhone } });
  assert.equal(customerLoginOtpRequest.status, 200);
  const customerLoginOtpCode = sentStorefrontOtpCodes.get(storefrontPhone);
  assert.match(customerLoginOtpCode ?? "", /^\d{6}$/);
  const customerLogin = await request(`/public/stores/${storefrontSlug}/customer/otp/verify`, { method: "POST", body: { phone: storefrontPhone, code: customerLoginOtpCode } });
  assert.equal(customerLogin.status, 200, `storefront customer should be able to verify a login OTP: ${JSON.stringify(customerLogin.payload)}`);
  const firstCustomerToken = customerLogin.payload.customerToken;
  assert.match(firstCustomerToken ?? "", /^[A-Za-z0-9_-]{43}$/);
  const firstCustomerProfile = await prisma.storefrontCustomerProfile.findUnique({ where: { phone: storefrontPhone }, select: { id: true } });
  assert.ok(firstCustomerProfile);
  assert.equal(await prisma.storefrontCustomerSession.count({ where: { customerId: firstCustomerProfile.id, tokenHash: hash(firstCustomerToken), revokedAt: null } }), 1, "customer sessions should persist only the token hash and global customer identity");
  const unauthenticatedCustomerAccount = await request(`/public/stores/${storefrontSlug}/customer`);
  assert.equal(unauthenticatedCustomerAccount.status, 401, "customer profile must require OTP verification");
  const firstCustomerProfileResponse = await request(`/public/stores/${storefrontSlug}/customer`, { extraHeaders: { "x-storefront-customer-token": firstCustomerToken } });
  assert.equal(firstCustomerProfileResponse.status, 200);
  assert.deepEqual(firstCustomerProfileResponse.payload.customer, { fullName: "HTTP checkout customer", phone: storefrontPhone, address: null });
  const firstCustomerOrders = await request(`/public/stores/${storefrontSlug}/customer/orders?limit=20`, { extraHeaders: { "x-storefront-customer-token": firstCustomerToken } });
  assert.equal(firstCustomerOrders.status, 200);
  assert.deepEqual(firstCustomerOrders.payload.items.map(({ id }) => id), [storefrontOrder.payload.id]);
  assert.equal(firstCustomerOrders.payload.items[0].status, "REJECTED");
  assert.equal(firstCustomerOrders.payload.items[0].trackingPath, `/order/${storefrontOrder.payload.trackingToken}`);

  const paymentPhone = `09${randomUUID().replace(/\D/g, "").padEnd(9, "0").slice(0, 9)}`;
  fixtures.storefrontOtpPhones.push(paymentPhone);
  const paymentOtpRequest = await request(`/public/stores/${storefrontSlug}/otp/request`, { method: "POST", body: { phone: paymentPhone } });
  assert.equal(paymentOtpRequest.status, 200);
  const paymentOtpCode = sentStorefrontOtpCodes.get(paymentPhone);
  assert.match(paymentOtpCode ?? "", /^\d{6}$/);
  const paymentOtpVerification = await request(`/public/stores/${storefrontSlug}/otp/verify`, { method: "POST", body: { phone: paymentPhone, code: paymentOtpCode } });
  assert.equal(paymentOtpVerification.status, 200);
  const payableOrder = await request(`/public/stores/${storefrontSlug}/orders`, {
    method: "POST", extraHeaders: { "idempotency-key": `http-storefront-pay-${randomUUID()}` },
    body: {
      customerName: "HTTP payment customer", customerPhone: paymentPhone, checkoutToken: paymentOtpVerification.payload.checkoutToken,
      deliveryMethod: "PICKUP", expectedTotalRial: expectedTotal.toString(),
      lines: [{ listingId: publicProduct.id, quantity: "1", expectedUnitPriceRial: publicProduct.unitPriceRial, expectedTaxRateBasisPoints: publicProduct.taxRateBasisPoints }],
    },
  });
  assert.equal(payableOrder.status, 201, `second public checkout should succeed: ${JSON.stringify(payableOrder.payload)}`);
  fixtures.storefrontOrders.push(payableOrder.payload.id);
  const acceptedOrder = await request(`/storefront/orders/${payableOrder.payload.id}/accept`, { ...storefrontScope, method: "POST", body: {} });
  assert.equal(acceptedOrder.status, 201, `owner should accept an order with an active destination card: ${JSON.stringify(acceptedOrder.payload)}`);
  assert.equal(acceptedOrder.payload.paymentStatus, "UNPAID");
  const acceptedTracking = await request(`/public/orders/${payableOrder.payload.trackingToken}`);
  assert.equal(acceptedTracking.status, 200);
  assert.equal(acceptedTracking.payload.status, "ACCEPTED");
  assert.equal(acceptedTracking.payload.cards[0]?.cardNumber, "6037997512345670", "accepted customer tracking should show the decrypted active destination card");
  const receiptForm = new FormData();
  receiptForm.append("cardId", storefrontCard.payload.id);
  receiptForm.append("submittedAmountRial", expectedTotal.toString());
  receiptForm.append("customerTransactionReference", `HTTP-${randomUUID().slice(0, 8)}`);
  const storefrontReceiptBytes = Buffer.from("%PDF-1.7\nShopro storefront payment receipt\n");
  receiptForm.append("file", new Blob([storefrontReceiptBytes], { type: "application/pdf" }), "payment-receipt.pdf");
  const receiptResponse = await fetch(`${baseUrl}/public/orders/${payableOrder.payload.trackingToken}/receipts`, { method: "POST", body: receiptForm });
  const receiptPayload = await receiptResponse.json();
  assert.equal(receiptResponse.status, 201, `customer should submit a payment receipt: ${JSON.stringify(receiptPayload)}`);
  const verifiedPayment = await request(`/storefront/orders/${payableOrder.payload.id}/payments/${receiptPayload.id}/verify`, {
    ...storefrontScope, method: "POST", body: { verifiedAmountRial: expectedTotal.toString(), transactionReference: `HTTP-BANK-${randomUUID().slice(0, 8)}` },
  });
  assert.equal(verifiedPayment.status, 201, `owner should verify payment and post its accounting receipt: ${JSON.stringify(verifiedPayment.payload)}`);
  assert.equal(verifiedPayment.payload.paymentStatus, "VERIFIED");
  const paidTracking = await request(`/public/orders/${payableOrder.payload.trackingToken}`);
  assert.equal(paidTracking.status, 200);
  assert.equal(paidTracking.payload.paymentStatus, "VERIFIED");
  assert.deepEqual(paidTracking.payload.cards, [], "verified orders should no longer expose a payment card");
  assert.equal(paidTracking.payload.paymentAttempts[0]?.mimeType, "application/pdf", "customer tracking should expose receipt status without leaking storage details");
  const storedStorefrontReceipt = await prisma.storefrontReceipt.findUniqueOrThrow({ where: { paymentAttemptId: receiptPayload.id } });
  assert.deepEqual(await readFile(join(attachmentRoot, storedStorefrontReceipt.storageKey)), storefrontReceiptBytes, "receipt upload should persist the original bytes in private storage");
  await rm(join(attachmentRoot, storedStorefrontReceipt.storageKey), { force: true });
  await prisma.storefrontReceipt.delete({ where: { paymentAttemptId: receiptPayload.id } });
  const preparingOrder = await request(`/storefront/orders/${payableOrder.payload.id}/transition`, { ...storefrontScope, method: "POST", body: { status: "PREPARING" } });
  assert.equal(preparingOrder.status, 201);
  const preparedOrder = await request(`/storefront/orders/${payableOrder.payload.id}/transition`, { ...storefrontScope, method: "POST", body: { status: "READY" } });
  assert.equal(preparedOrder.status, 201);
  const readyForPickup = await request(`/storefront/orders/${payableOrder.payload.id}/transition`, { ...storefrontScope, method: "POST", body: { status: "READY_FOR_PICKUP" } });
  assert.equal(readyForPickup.status, 201);
  const readyTracking = await request(`/public/orders/${payableOrder.payload.trackingToken}`);
  assert.equal(readyTracking.status, 200);
  assert.equal(readyTracking.payload.status, "READY_FOR_PICKUP");

  const accountOtpRequest = await request(`/public/stores/${storefrontSlug}/customer/otp/request`, { method: "POST", body: { phone: paymentPhone } });
  assert.equal(accountOtpRequest.status, 200);
  const accountOtpCode = sentStorefrontOtpCodes.get(paymentPhone);
  const paymentCustomerLogin = await request(`/public/stores/${storefrontSlug}/customer/otp/verify`, { method: "POST", body: { phone: paymentPhone, code: accountOtpCode } });
  assert.equal(paymentCustomerLogin.status, 200);
  const paymentCustomerToken = paymentCustomerLogin.payload.customerToken;
  const paymentCustomerOrders = await request(`/public/stores/${storefrontSlug}/customer/orders?limit=20`, { extraHeaders: { "x-storefront-customer-token": paymentCustomerToken } });
  assert.equal(paymentCustomerOrders.status, 200);
  assert.deepEqual(paymentCustomerOrders.payload.items.map(({ id }) => id), [payableOrder.payload.id], "customer order history must be restricted to the verified mobile number in this storefront");
  assert.equal(paymentCustomerOrders.payload.items[0].paymentStatus, "VERIFIED");
  const firstCustomerOrdersAfterOtherPhoneOrder = await request(`/public/stores/${storefrontSlug}/customer/orders?limit=20`, { extraHeaders: { "x-storefront-customer-token": firstCustomerToken } });
  assert.deepEqual(firstCustomerOrdersAfterOtherPhoneOrder.payload.items.map(({ id }) => id), [storefrontOrder.payload.id], "one customer must not see another customer's order");
  const customerLogout = await request(`/public/stores/${storefrontSlug}/customer/logout`, { method: "POST", extraHeaders: { "x-storefront-customer-token": firstCustomerToken } });
  assert.equal(customerLogout.status, 204);
  const revokedCustomerAccount = await request(`/public/stores/${storefrontSlug}/customer`, { extraHeaders: { "x-storefront-customer-token": firstCustomerToken } });
  assert.equal(revokedCustomerAccount.status, 401, "logout should revoke the customer session");

  const stockCountDraft = await request("/inventory/counts", {
    auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST",
    body: { txnDate: "2026-11-04", reason: "HTTP stock count regression", lines: [{ productId: stockProductA.id, countedQuantity: "15" }] },
  });
  assert.equal(stockCountDraft.status, 201, `owners should be able to create stock-count drafts: ${JSON.stringify(stockCountDraft.payload)}`);
  fixtures.stockCounts.push(stockCountDraft.payload.id);
  assert.equal(stockCountDraft.payload.status, "DRAFT");
  assert.equal(stockCountDraft.payload.lineCount, 1);
  const persistedStockCount = await prisma.stockCount.findUniqueOrThrow({ where: { id: stockCountDraft.payload.id }, include: { lines: true } });
  assert.equal(persistedStockCount.businessId, businessA.id);
  assert.equal(persistedStockCount.branchId, branchA1.id);
  assert.equal(persistedStockCount.lines.length, 1);
  assert.equal(persistedStockCount.lines[0].systemQuantitySnapshot.toString(), "12");
  assert.equal(persistedStockCount.lines[0].countedQuantity.toString(), "15");
  assert.equal(persistedStockCount.lines[0].deltaQuantity.toString(), "3");
  const updatedStockCount = await request(`/inventory/counts/${stockCountDraft.payload.id}`, {
    auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "PATCH",
    body: { txnDate: "2026-11-04", reason: "Updated HTTP stock count", lines: [{ productId: stockProductA.id, countedQuantity: "14" }] },
  });
  assert.equal(updatedStockCount.status, 200, `owners should be able to update stock-count drafts: ${JSON.stringify(updatedStockCount.payload)}`);
  const persistedUpdatedStockCount = await prisma.stockCount.findUniqueOrThrow({ where: { id: stockCountDraft.payload.id }, include: { lines: true } });
  assert.equal(persistedUpdatedStockCount.reason, "Updated HTTP stock count");
  assert.equal(persistedUpdatedStockCount.lines.length, 1);
  assert.equal(persistedUpdatedStockCount.lines[0].systemQuantitySnapshot.toString(), "12");
  assert.equal(persistedUpdatedStockCount.lines[0].countedQuantity.toString(), "14");
  assert.equal(persistedUpdatedStockCount.lines[0].deltaQuantity.toString(), "2");
  assert.equal(await prisma.auditEvent.count({ where: { entityId: stockCountDraft.payload.id, action: { in: ["inventory.count.created", "inventory.count.draft.updated"] } } }), 2);
  const scopedOnboarding = await request("/onboarding", { auth: owner, businessId: businessA.id, branchId: branchA1.id });
  assert.equal(scopedOnboarding.status, 200);
  assert.equal(scopedOnboarding.payload.business.id, businessA.id);
  assert.equal(scopedOnboarding.payload.branch.id, branchA1.id);
  const foreignOnboarding = await request("/onboarding", { auth: outsider, businessId: businessA.id, branchId: branchA1.id });
  assert.equal(foreignOnboarding.status, 403, "onboarding must respect tenant membership");
  const wrongBranchOnboarding = await request("/onboarding", { auth: cashier, businessId: businessA.id, branchId: branchA2.id });
  assert.equal(wrongBranchOnboarding.status, 403, "onboarding must respect branch membership");
  const viewerOnboarding = await request("/onboarding", { auth: viewer, businessId: businessA.id, branchId: branchA1.id });
  assert.equal(viewerOnboarding.status, 200);
  assert.equal(viewerOnboarding.payload.role, "VIEWER");
  assert.equal(viewerOnboarding.payload.nextAction.href, "/app/invoices");
  const forbiddenViewerMode = await request("/onboarding/progress", { auth: viewer, businessId: businessA.id, branchId: branchA1.id, method: "PATCH", body: { action: "select_financial_start_mode", financialStartMode: "START_TODAY" } });
  assert.equal(forbiddenViewerMode.status, 403, "viewers must not mutate financial onboarding progress");
  const rejectedSensitiveEvent = await request("/onboarding/events", { auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST", body: { eventName: "onboarding_step_skipped", stepName: "product", deviceType: "DESKTOP", amountRial: "900", customerName: "must not be accepted" } });
  assert.equal(rejectedSensitiveEvent.status, 400, "analytics must reject payloads containing financial or customer data");

  const managerBusinessUpdate = await request("/businesses/current", {
    auth: manager, businessId: businessA.id, branchId: branchA1.id, method: "PATCH", body: { displayName: "Manager-updated fixture" },
  });
  assert.equal(managerBusinessUpdate.status, 200, "managers may update business settings");
  const accountantBusinessUpdate = await request("/businesses/current", {
    auth: accountant, businessId: businessA.id, branchId: branchA1.id, method: "PATCH", body: { displayCurrency: "IRR" },
  });
  assert.equal(accountantBusinessUpdate.status, 403, "accountants may not update business settings");
  assert.equal((await prisma.business.findUniqueOrThrow({ where: { id: businessA.id } })).displayCurrency, "IRT", "denied business setting writes must not change the database");
  const managerBranch = await request("/businesses/current/branches", {
    auth: manager, businessId: businessA.id, branchId: branchA1.id, method: "POST", body: { name: "Manager branch", code: "MGR-1" },
  });
  assert.equal(managerBranch.status, 201, "managers may create branches");
  const branchCountBeforeDeniedCreate = await prisma.branch.count({ where: { businessId: businessA.id } });
  const accountantBranch = await request("/businesses/current/branches", {
    auth: accountant, businessId: businessA.id, branchId: branchA1.id, method: "POST", body: { name: "Denied branch", code: "ACC-1" },
  });
  assert.equal(accountantBranch.status, 403, "accountants may not create branches");
  assert.equal(await prisma.branch.count({ where: { businessId: businessA.id } }), branchCountBeforeDeniedCreate, "denied branch creation must not persist a branch");
  for (const [auth, name] of [[manager, "Manager-created service"], [accountant, "Accountant-created service"]]) {
    const productWrite = await request("/services", {
      auth, businessId: businessA.id, branchId: branchA1.id, method: "POST",
      body: { name, salePriceRial: "500", unitId: unitA.id },
    });
    assert.equal(productWrite.status, 201, `${auth === manager ? "managers" : "accountants"} may create services`);
    assert.equal(productWrite.payload.name, name);
  }

  const ownerMembers = await request("/businesses/current/members", { auth: owner, businessId: businessA.id, branchId: branchA1.id });
  assert.equal(ownerMembers.status, 200);
  assert.equal(ownerMembers.payload.find(({ id }) => id === cashierA.id).user.phone, cashier.user.phone, "owners can view member phone numbers");
  const cashierMembers = await request("/businesses/current/members", { auth: cashier, businessId: businessA.id, branchId: branchA1.id });
  assert.equal(cashierMembers.status, 200);
  assert.equal(cashierMembers.payload.find(({ id }) => id === cashierA.id).user.phone, cashier.user.phone, "members can view their own phone number");
  assert.equal(cashierMembers.payload.find(({ id }) => id === ownerA.id).user.phone, `${owner.user.phone.slice(0, 3)}•••••${owner.user.phone.slice(-3)}`, "non-owners must see other members' phone numbers masked");
  const cashierMemberMutation = await request(`/businesses/current/members/${cashierA.id}`, {
    auth: cashier, businessId: businessA.id, branchId: branchA1.id, method: "PATCH", body: { role: "MANAGER" },
  });
  assert.equal(cashierMemberMutation.status, 403, "only owners may change member roles");
  const cashierMemberHistory = await request(`/businesses/current/members/${cashierA.id}/history`, { auth: cashier, businessId: businessA.id, branchId: branchA1.id });
  assert.equal(cashierMemberHistory.status, 403, "only owners may read member access history");
  const cashierBusinessAudit = await request("/businesses/current/audit", { auth: cashier, businessId: businessA.id, branchId: branchA1.id });
  assert.equal(cashierBusinessAudit.status, 403, "only owners may read business audit events");
  const cashierReport = await request("/reports/cash-flow", { auth: cashier, businessId: businessA.id, branchId: branchA1.id });
  assert.equal(cashierReport.status, 403, "cashiers must not read financial reports");
  const viewerProductWrite = await request("/services", {
    auth: viewer, businessId: businessA.id, branchId: branchA1.id, method: "POST",
    body: { name: "Viewer must not create", salePriceRial: "500", unitId: unitA.id },
  });
  assert.equal(viewerProductWrite.status, 403, "viewers must not mutate service records");
  assert.equal(await prisma.catalogItem.count({ where: { businessId: businessA.id, name: "Viewer must not create" } }), 0);

  const viewerSaleWrite = await request("/sales", {
    auth: viewer, businessId: businessA.id, branchId: branchA1.id, method: "POST",
    extraHeaders: { "idempotency-key": `viewer-sale-${randomUUID()}` },
    body: { customerId: auditParty.id, txnDate: "2026-11-04", lines: [{ productId: productA.id, quantity: "1" }] },
  });
  assert.equal(viewerSaleWrite.status, 403, "viewers must not create sales through the API");
  assert.equal(await prisma.salesInvoice.count({ where: { businessId: businessA.id, branchId: branchA1.id } }), 0, "denied viewer sales must not create invoices");

  const cashierDraft = await request("/sales", {
    auth: cashier, businessId: businessA.id, branchId: branchA1.id, method: "POST",
    extraHeaders: { "idempotency-key": `cashier-sale-${randomUUID()}` },
    body: { customerId: auditParty.id, txnDate: "2026-11-04", lines: [{ productId: productA.id, quantity: "1" }] },
  });
  assert.equal(cashierDraft.status, 201, `cashiers may create catalog-priced sale drafts; received ${JSON.stringify(cashierDraft.payload)}`);
  const cashierDraftLine = await prisma.salesInvoiceLine.findFirstOrThrow({ where: { invoiceId: cashierDraft.payload.id } });
  assert.equal(cashierDraftLine.unitPriceRial, 100n, "cashier drafts must snapshot the catalog price");
  assert.equal(cashierDraftLine.discountRial, 0n, "cashier drafts must not apply a discount");
  const invoiceCountBeforeRejectedSales = await prisma.salesInvoice.count({ where: { businessId: businessA.id, branchId: branchA1.id } });
  const cashierChangedPrice = await request("/sales", {
    auth: cashier, businessId: businessA.id, branchId: branchA1.id, method: "POST",
    extraHeaders: { "idempotency-key": `cashier-price-${randomUUID()}` },
    body: { customerId: auditParty.id, txnDate: "2026-11-04", lines: [{ productId: productA.id, quantity: "1", unitPriceRial: "99" }] },
  });
  assert.equal(cashierChangedPrice.status, 403, "cashiers must not override a product's catalog price");
  const cashierDiscount = await request("/sales", {
    auth: cashier, businessId: businessA.id, branchId: branchA1.id, method: "POST",
    extraHeaders: { "idempotency-key": `cashier-discount-${randomUUID()}` },
    body: { customerId: auditParty.id, txnDate: "2026-11-04", lines: [{ productId: productA.id, quantity: "1", discountRial: "1" }] },
  });
  assert.equal(cashierDiscount.status, 403, "cashiers must not apply a sale discount");
  const cashierSensitiveProductFields = await request(`/products/${stockProductA.id}`, {
    auth: cashier, businessId: businessA.id, branchId: branchA1.id, method: "PATCH",
    body: { salePriceRial: "999", defaultCostRial: "1", taxRateBasisPoints: 2500, sku: "HACKED", barcode: "1234", isActive: false },
  });
  assert.equal(cashierSensitiveProductFields.status, 403, "mixed cashier product payloads must be rejected as a whole");
  assert.equal(await prisma.salesInvoice.count({ where: { businessId: businessA.id, branchId: branchA1.id } }), invoiceCountBeforeRejectedSales, "rejected cashier payloads must not create invoices");
  const cashierPosted = await request(`/sales/${cashierDraft.payload.id}/post`, {
    auth: cashier, businessId: businessA.id, branchId: branchA1.id, method: "POST",
    extraHeaders: { "idempotency-key": `cashier-post-${randomUUID()}` }, body: {},
  });
  assert.equal(cashierPosted.status, 201, `cashiers may post authorized catalog-priced sales; received ${JSON.stringify(cashierPosted.payload)}`);
  assert.equal(cashierPosted.payload.status, "POSTED");
  assert.equal(await prisma.journalEntry.count({ where: { businessId: businessA.id, sourceType: "SALE", sourceId: cashierDraft.payload.id } }), 1, "cashier sale posting must create one accounting journal");
  const cashierActivationBeforeResult = await request("/onboarding", { auth: cashier, businessId: businessA.id, branchId: branchA1.id });
  assert.equal(cashierActivationBeforeResult.status, 200);
  assert.equal(cashierActivationBeforeResult.payload.firstDocument.id, cashierDraft.payload.id, "a cashier's own posted sale should be the activation document");
  assert.equal(cashierActivationBeforeResult.payload.activationComplete, false);
  const cashierResultView = await request("/onboarding/progress", { auth: cashier, businessId: businessA.id, branchId: branchA1.id, method: "PATCH", body: { action: "mark_result_viewed" } });
  assert.equal(cashierResultView.status, 200);
  assert.equal(cashierResultView.payload.activationComplete, true, "activation result must not depend on an analytics event");
  assert.equal(await prisma.onboardingEvent.count({ where: { userId: cashier.user.id, businessId: businessA.id, branchId: branchA1.id, eventName: "dashboard_viewed_after_first_document" } }), 0, "result progress must remain available while analytics is absent");

  const crossTenantId = await request(`/services/${productA.id}`, { auth: outsider, businessId: businessB.id, branchId: branchB1.id });
  assert.equal(crossTenantId.status, 404, "a valid user must not read another tenant's record by guessing its UUID");

  const forbiddenSensitiveUpdate = await request(`/products/${stockProductA.id}`, {
    auth: cashier, businessId: businessA.id, branchId: branchA1.id, method: "PATCH", body: { defaultCostRial: "999" },
  });
  assert.equal(forbiddenSensitiveUpdate.status, 403, "cashiers must not change product cost");
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: stockProductA.id } })).defaultCostRial, 100n, "denied HTTP mutation must not change the database");

  const csrfDenied = await request("/services", {
    auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST", csrf: false,
    body: { name: "Must not exist", salePriceRial: "500", unitId: unitA.id },
  });
  assert.equal(csrfDenied.status, 403, "cookie-authenticated writes must require CSRF proof");
  assert.equal(await prisma.catalogItem.count({ where: { businessId: businessA.id, name: "Must not exist" } }), 0, "CSRF rejection must not create data");

  const malformedId = await request("/products/not-a-uuid", { auth: owner, businessId: businessA.id, branchId: branchA1.id });
  assert.equal(malformedId.status, 400, "malformed resource IDs must be rejected as client input");

  const ownerWrite = await request("/services", {
    auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST",
    body: { name: "Owner-created fixture", salePriceRial: "500", unitId: unitA.id },
  });
  assert.equal(ownerWrite.status, 201, `owner write should succeed; received ${JSON.stringify(ownerWrite.payload)}`);
  assert.equal(ownerWrite.payload.name, "Owner-created fixture");

  const attachmentHeaders = (auth, businessId, branchId) => ({
    cookie: `shopro_session=${auth.rawSession}; shopro_csrf=${auth.csrf}`,
    "x-business-id": businessId,
    "x-branch-id": branchId,
    "x-csrf-token": auth.csrf,
  });
  const makeAttachmentForm = () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("%PDF-1.7\nShopro HTTP attachment fixture\n")], { type: "application/pdf" }), "../receipt.pdf");
    return form;
  };
  const foreignUpload = await fetch(`${baseUrl}/expenses/${expenseFixture.id}/attachment`, {
    method: "POST", headers: attachmentHeaders(outsider, businessB.id, branchB1.id), body: makeAttachmentForm(),
  });
  assert.equal(foreignUpload.status, 404, "an owner of another tenant must not upload to a guessed expense UUID");
  const unassignedBranchUpload = await fetch(`${baseUrl}/expenses/${expenseFixture.id}/attachment`, {
    method: "POST", headers: attachmentHeaders(owner, businessA.id, branchA2.id), body: makeAttachmentForm(),
  });
  assert.equal(unassignedBranchUpload.status, 404, "an expense attachment must stay inside its owning branch");
  const cashierUpload = await fetch(`${baseUrl}/expenses/${expenseFixture.id}/attachment`, {
    method: "POST", headers: attachmentHeaders(cashier, businessA.id, branchA1.id), body: makeAttachmentForm(),
  });
  assert.equal(cashierUpload.status, 403, "cashiers must not upload expense attachments");
  assert.deepEqual(await readdir(attachmentRoot), [], "denied attachment uploads must not write files");

  const upload = await fetch(`${baseUrl}/expenses/${expenseFixture.id}/attachment`, {
    method: "POST", headers: attachmentHeaders(owner, businessA.id, branchA1.id), body: makeAttachmentForm(),
  });
  const uploadPayload = await upload.json();
  assert.equal(upload.status, 201, `authorized attachment upload should succeed; received ${JSON.stringify(uploadPayload)}`);
  assert.equal(uploadPayload.fileName, "receipt.pdf", "upload filenames must be normalized to their safe basename");
  const storedExpense = await prisma.expense.findUniqueOrThrow({ where: { id: expenseFixture.id }, include: { attachment: true } });
  assert.ok(storedExpense.attachment, "upload must persist attachment metadata");
  const storedFile = join(attachmentRoot, storedExpense.attachment.storageKey);
  assert.deepEqual(await readFile(storedFile), Buffer.from("%PDF-1.7\nShopro HTTP attachment fixture\n"));
  const attachmentAudit = await prisma.auditEvent.findFirst({ where: { businessId: businessA.id, entityType: "expense", entityId: expenseFixture.id, action: "expense.attachment.added" }, orderBy: { occurredAt: "desc" } });
  assert.ok(attachmentAudit, "upload must produce a database audit event");
  assert.equal(JSON.stringify(attachmentAudit).includes("receipt.pdf"), false, "attachment audit metadata must not include the original filename");

  const ownerToken = await request(`/expenses/${expenseFixture.id}/attachment/download-token`, { auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST" });
  assert.equal(ownerToken.status, 201);
  const tokenInOtherBranch = await request(`/expenses/${expenseFixture.id}/attachment/download-token`, { auth: owner, businessId: businessA.id, branchId: branchA2.id, method: "POST" });
  assert.equal(tokenInOtherBranch.status, 404, "download grants must not cross branch scope");
  const tokenFromOtherTenant = await request(`/expenses/${expenseFixture.id}/attachment/download-token`, { auth: outsider, businessId: businessB.id, branchId: branchB1.id, method: "POST" });
  assert.equal(tokenFromOtherTenant.status, 404, "download grants must not cross business scope");
  const downloadPath = `${baseUrl}/expenses/${expenseFixture.id}/attachment`;
  const missingToken = await fetch(downloadPath, { headers: attachmentHeaders(owner, businessA.id, branchA1.id) });
  assert.equal(missingToken.status, 401, "file downloads require a fresh scope-bound grant");
  const otherUserToken = await fetch(downloadPath, {
    headers: { ...attachmentHeaders(cashier, businessA.id, branchA1.id), "x-attachment-download-token": ownerToken.payload.token },
  });
  assert.equal(otherUserToken.status, 401, "a download grant must not be reusable by another member");
  const downloaded = await fetch(downloadPath, {
    headers: { ...attachmentHeaders(owner, businessA.id, branchA1.id), "x-attachment-download-token": ownerToken.payload.token },
  });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get("content-type"), "application/pdf");
  assert.equal(downloaded.headers.get("cache-control"), "private, no-store");
  assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
  assert.match(downloaded.headers.get("content-disposition") ?? "", /filename\*=UTF-8''receipt\.pdf/);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), Buffer.from("%PDF-1.7\nShopro HTTP attachment fixture\n"));

  const removeAttachment = await request(`/expenses/${expenseFixture.id}/attachment`, { auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "DELETE" });
  assert.equal(removeAttachment.status, 200);
  assert.equal(removeAttachment.payload.removed, true);
  assert.equal((await prisma.expense.findUniqueOrThrow({ where: { id: expenseFixture.id } })).attachmentId, null);
  assert.equal(await prisma.attachment.count({ where: { businessId: businessA.id } }), 0);
  await assert.rejects(readFile(storedFile), { code: "ENOENT" }, "removing the attachment must delete the private file after its database transaction");
  const removedDownloadToken = await request(`/expenses/${expenseFixture.id}/attachment/download-token`, { auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST" });
  assert.equal(removedDownloadToken.status, 404);
  await prisma.branch.update({ where: { id: branchA2.id }, data: { isActive: false } });
  const inactiveBranchAccess = await request("/products", { auth: owner, businessId: businessA.id, branchId: branchA2.id });
  assert.equal(inactiveBranchAccess.status, 403, "a branch that is no longer active must not authorize API access");

  await prisma.$executeRawUnsafe(`CREATE FUNCTION shopro_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('product.created', 'product.price.updated', 'service.created', 'service.price.updated', 'party.created', 'party.updated', 'expense_category.created', 'expense.draft.created') THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe("CREATE TRIGGER shopro_test_reject_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION shopro_test_reject_audit()");
  auditFailureTriggerInstalled = true;
  const auditFailure = await request("/services", {
    auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST",
    body: { name: "Audit rollback fixture", salePriceRial: "600", unitId: unitA.id },
  });
  assert.equal(auditFailure.status, 500, "an audit insert failure must fail the originating service mutation");
  assert.equal(await prisma.catalogItem.count({ where: { businessId: businessA.id, name: "Audit rollback fixture" } }), 0, "the service insert must roll back when its audit insert fails");
  const productUpdateAuditFailure = await request(`/products/${stockProductA.id}`, {
    auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "PATCH",
    body: { salePriceRial: "999" },
  });
  assert.equal(productUpdateAuditFailure.status, 500, "a product-update audit failure must fail the price mutation");
  assert.equal((await prisma.catalogItem.findUniqueOrThrow({ where: { id: stockProductA.id } })).salePriceRial, 100n, "the product update must roll back when its audit insert fails");
  const partyCreateAuditFailure = await request("/parties", {
    auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST",
    body: { type: "CUSTOMER", name: "Audit rollback party" },
  });
  assert.equal(partyCreateAuditFailure.status, 500, "a party-create audit failure must fail the party mutation");
  assert.equal(await prisma.party.count({ where: { businessId: businessA.id, name: "Audit rollback party" } }), 0, "the party insert must roll back when its audit insert fails");
  const partyUpdateAuditFailure = await request(`/parties/${auditParty.id}`, {
    auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "PATCH",
    body: { name: "Changed without audit" },
  });
  assert.equal(partyUpdateAuditFailure.status, 500, "a party-update audit failure must fail the party mutation");
  assert.equal((await prisma.party.findUniqueOrThrow({ where: { id: auditParty.id } })).name, "Audit target", "the party update must roll back when its audit insert fails");
  const categoryAuditFailure = await request("/expenses/categories", {
    auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST",
    body: { name: "Audit rollback category" },
  });
  assert.equal(categoryAuditFailure.status, 500, "an expense-category audit failure must fail the category mutation");
  assert.equal(await prisma.expenseCategory.count({ where: { businessId: businessA.id, name: "Audit rollback category" } }), 0, "the category insert must roll back when its audit insert fails");
  const expenseAuditFailure = await request("/expenses", {
    auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST",
    body: { amountRial: "3500", categoryId: expenseCategory.id, txnDate: "2026-11-04", note: "Audit rollback expense" },
  });
  assert.equal(expenseAuditFailure.status, 500, "an expense-draft audit failure must fail the draft mutation");
  assert.equal(await prisma.expense.count({ where: { businessId: businessA.id, note: "Audit rollback expense" } }), 0, "the expense draft must roll back when its audit insert fails");
  await prisma.$executeRawUnsafe("DROP TRIGGER shopro_test_reject_audit ON audit_events");
  await prisma.$executeRawUnsafe("DROP FUNCTION shopro_test_reject_audit()");
  auditFailureTriggerInstalled = false;
  console.log("HTTP integration passed: tenant/branch authorization, storefront settings and listings, public catalog, checkout and customer-account OTP, phone-scoped order history, account logout, order tracking, staff rejection and acceptance, destination-card encryption, receipt upload and payment verification, order preparation, inventory, accounting, attachments, audit and rollback.");
} finally {
  restoreSmsAdapter?.();
  if (app) await app.close();
  try {
    if (auditFailureTriggerInstalled) {
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS shopro_test_reject_audit ON audit_events");
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS shopro_test_reject_audit()");
    }
    for (const expenseId of fixtures.expenses) {
      const expense = await prisma.expense.findUnique({ where: { id: expenseId }, select: { attachmentId: true } });
      if (expense?.attachmentId) {
        await prisma.expense.update({ where: { id: expenseId }, data: { attachmentId: null } });
        await prisma.attachment.deleteMany({ where: { id: expense.attachmentId } });
      }
      await prisma.expense.deleteMany({ where: { id: expenseId } });
    }
    for (const stockCountId of fixtures.stockCounts) await prisma.stockCount.deleteMany({ where: { id: stockCountId } });
    for (const orderId of fixtures.storefrontOrders) {
      await prisma.storefrontReservation.deleteMany({ where: { orderId } });
      const attempts = await prisma.storefrontPaymentAttempt.findMany({ where: { orderId }, select: { id: true } });
      const attemptIds = attempts.map(({ id }) => id);
      const receipts = attemptIds.length ? await prisma.storefrontReceipt.findMany({ where: { paymentAttemptId: { in: attemptIds } }, select: { storageKey: true, paymentAttemptId: true } }) : [];
      for (const receipt of receipts) {
        if (!/^[0-9a-f-]{36}\.[a-z0-9]+$/i.test(receipt.storageKey)) throw new Error("Refusing cleanup of an unexpected storefront receipt path.");
        if (attachmentRoot) await rm(join(attachmentRoot, receipt.storageKey), { force: true });
      }
      if (attemptIds.length) await prisma.storefrontReceipt.deleteMany({ where: { paymentAttemptId: { in: attemptIds } } });
      await prisma.storefrontPaymentAttempt.deleteMany({ where: { orderId } });
      await prisma.storefrontOrderEvent.deleteMany({ where: { orderId } });
      await prisma.storefrontOrderItem.deleteMany({ where: { orderId } });
      await prisma.storefrontOrder.deleteMany({ where: { id: orderId } });
    }
    for (const storefrontId of fixtures.storefronts) {
      await prisma.storefrontOtpGrant.deleteMany({ where: { storefrontId } });
      await prisma.storefrontListing.deleteMany({ where: { storefrontId } });
      await prisma.storefront.deleteMany({ where: { id: storefrontId } });
    }
    const customerProfiles = fixtures.storefrontOtpPhones.length
      ? await prisma.storefrontCustomerProfile.findMany({ where: { phone: { in: fixtures.storefrontOtpPhones } }, select: { id: true } })
      : [];
    const customerIds = customerProfiles.map(({ id }) => id);
    if (customerIds.length) {
      await prisma.storefrontCustomerSession.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.storefrontCustomerProfile.deleteMany({ where: { id: { in: customerIds } } });
    }
    for (const cardId of fixtures.storefrontCards) await prisma.storePaymentCard.deleteMany({ where: { id: cardId } });
    for (const phone of fixtures.storefrontOtpPhones) await prisma.otpChallenge.deleteMany({ where: { phone, purpose: { in: ["STOREFRONT_CHECKOUT", "STOREFRONT_CUSTOMER"] } } });
    for (const id of fixtures.businesses) await prisma.business.deleteMany({ where: { id } });
    for (const id of fixtures.users) await prisma.user.deleteMany({ where: { id } });
  } finally {
    await prisma.$disconnect();
    if (attachmentRoot) {
      const workspaceRoot = await realpath(process.cwd());
      const tempParent = await realpath(resolve(workspaceRoot, ".tmp"));
      const resolvedAttachmentRoot = resolve(attachmentRoot);
      const relativeAttachmentRoot = relative(tempParent, resolvedAttachmentRoot);
      if (dirname(resolvedAttachmentRoot) !== tempParent || !/^shopro-http-attachments-[0-9A-Za-z_-]+$/.test(resolvedAttachmentRoot.split(/[\\/]/).at(-1) ?? "") || relativeAttachmentRoot.startsWith(`..${sep}`)) {
        throw new Error(`Refusing attachment fixture cleanup outside its verified temporary directory: ${resolvedAttachmentRoot}`);
      }
      await rm(resolvedAttachmentRoot, { recursive: true, force: true });
    }
    if (previousAttachmentStorageDir === undefined) delete process.env.ATTACHMENT_STORAGE_DIR;
    else process.env.ATTACHMENT_STORAGE_DIR = previousAttachmentStorageDir;
    if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSessionSecret;
    if (previousOtpHashSecret === undefined) delete process.env.OTP_HASH_SECRET;
    else process.env.OTP_HASH_SECRET = previousOtpHashSecret;
    if (previousStorefrontCardKey === undefined) delete process.env.STOREFRONT_CARD_ENCRYPTION_KEY;
    else process.env.STOREFRONT_CARD_ENCRYPTION_KEY = previousStorefrontCardKey;
    if (previousWebOrigin === undefined) delete process.env.WEB_ORIGIN;
    else process.env.WEB_ORIGIN = previousWebOrigin;
    if (previousCookieSecure === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = previousCookieSecure;
    if (previousAdminInitialPassword === undefined) delete process.env.SHOPRO_ADMIN_INITIAL_PASSWORD;
    else process.env.SHOPRO_ADMIN_INITIAL_PASSWORD = previousAdminInitialPassword;
    if (previousAdminUsername === undefined) delete process.env.SHOPRO_ADMIN_USERNAME;
    else process.env.SHOPRO_ADMIN_USERNAME = previousAdminUsername;
  }
}
