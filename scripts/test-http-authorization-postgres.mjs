import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "../apps/api/dist/app.module.js";
import { ApiExceptionFilter } from "../apps/api/dist/common/api-exception.filter.js";
import { PrismaService } from "../apps/api/dist/prisma/prisma.service.js";
import { lockAttachmentMutationDuringBackup } from "../apps/api/dist/expenses/attachment-backup-lock.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL must target an isolated test database.");
const databaseUrl = new URL(connectionString);
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
if (!["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname.replace(/^\[|\]$/g, "")) || !/test/i.test(databaseName)) {
  throw new Error(`Refusing HTTP integration test outside loopback test database (host=${databaseUrl.hostname}, database=${databaseName}).`);
}

const hash = (value) => createHash("sha256").update(value).digest("hex");
const prisma = new PrismaService();
const fixtures = { businesses: [], users: [], expenses: [], stockCounts: [] };
const previousAttachmentStorageDir = process.env.ATTACHMENT_STORAGE_DIR;
const previousSessionSecret = process.env.SESSION_SECRET;
let attachmentRoot;
let auditFailureTriggerInstalled = false;
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
  const productA = await prisma.product.create({ data: { businessId: businessA.id, unitId: unitA.id, name: "Private A", normalizedName: "private a", kind: "SERVICE", salePriceRial: 100n, trackInventory: false } });
  const stockProductA = await prisma.product.create({ data: { businessId: businessA.id, unitId: unitA.id, name: "Countable A", normalizedName: "countable a", kind: "STOCK", salePriceRial: 100n, defaultCostRial: 100n, trackInventory: true } });
  await prisma.inventoryBalance.create({ data: { businessId: businessA.id, branchId: branchA1.id, productId: stockProductA.id, quantityOnHand: "12", inventoryValueRial: 1200n, averageCostRial: 100n } });
  await prisma.product.create({ data: { businessId: businessB.id, unitId: unitB.id, name: "Private B", normalizedName: "private b", kind: "SERVICE", salePriceRial: 200n, trackInventory: false } });
  const auditParty = await prisma.party.create({ data: { businessId: businessA.id, type: "CUSTOMER", name: "Audit target", normalizedName: "audit target" } });
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
    const payload = await response.json();
    return { status: response.status, payload };
  };

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
  assert.deepEqual(scopedList.payload.map(({ name }) => name), ["Countable A", "Private A"], "list results must not leak a different tenant's products");
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
  for (const [auth, name] of [[manager, "Manager-created product"], [accountant, "Accountant-created product"]]) {
    const productWrite = await request("/products", {
      auth, businessId: businessA.id, branchId: branchA1.id, method: "POST",
      body: { name, kind: "SERVICE", salePriceRial: "500", unitId: unitA.id },
    });
    assert.equal(productWrite.status, 201, `${auth === manager ? "managers" : "accountants"} may create products`);
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
  const viewerProductWrite = await request("/products", {
    auth: viewer, businessId: businessA.id, branchId: branchA1.id, method: "POST",
    body: { name: "Viewer must not create", kind: "SERVICE", salePriceRial: "500", unitId: unitA.id },
  });
  assert.equal(viewerProductWrite.status, 403, "viewers must not mutate product records");
  assert.equal(await prisma.product.count({ where: { businessId: businessA.id, name: "Viewer must not create" } }), 0);

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
  const cashierSensitiveProductFields = await request(`/products/${productA.id}`, {
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

  const crossTenantId = await request(`/products/${productA.id}`, { auth: outsider, businessId: businessB.id, branchId: branchB1.id });
  assert.equal(crossTenantId.status, 404, "a valid user must not read another tenant's record by guessing its UUID");

  const forbiddenSensitiveUpdate = await request(`/products/${productA.id}`, {
    auth: cashier, businessId: businessA.id, branchId: branchA1.id, method: "PATCH", body: { defaultCostRial: "999" },
  });
  assert.equal(forbiddenSensitiveUpdate.status, 403, "cashiers must not change product cost");
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: productA.id } })).defaultCostRial, null, "denied HTTP mutation must not change the database");

  const csrfDenied = await request("/products", {
    auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST", csrf: false,
    body: { name: "Must not exist", kind: "SERVICE", salePriceRial: "500", unitId: unitA.id },
  });
  assert.equal(csrfDenied.status, 403, "cookie-authenticated writes must require CSRF proof");
  assert.equal(await prisma.product.count({ where: { businessId: businessA.id, name: "Must not exist" } }), 0, "CSRF rejection must not create data");

  const malformedId = await request("/products/not-a-uuid", { auth: owner, businessId: businessA.id, branchId: branchA1.id });
  assert.equal(malformedId.status, 400, "malformed resource IDs must be rejected as client input");

  const ownerWrite = await request("/products", {
    auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST",
    body: { name: "Owner-created fixture", kind: "SERVICE", salePriceRial: "500", unitId: unitA.id },
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

  await prisma.$executeRawUnsafe(`CREATE FUNCTION shopro_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('product.created', 'product.price.updated', 'party.created', 'party.updated', 'expense_category.created', 'expense.draft.created') THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe("CREATE TRIGGER shopro_test_reject_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION shopro_test_reject_audit()");
  auditFailureTriggerInstalled = true;
  const auditFailure = await request("/products", {
    auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST",
    body: { name: "Audit rollback fixture", kind: "SERVICE", salePriceRial: "600", unitId: unitA.id },
  });
  assert.equal(auditFailure.status, 500, "an audit insert failure must fail the originating product mutation");
  assert.equal(await prisma.product.count({ where: { businessId: businessA.id, name: "Audit rollback fixture" } }), 0, "the product insert must roll back when its audit insert fails");
  const productUpdateAuditFailure = await request(`/products/${productA.id}`, {
    auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "PATCH",
    body: { salePriceRial: "999" },
  });
  assert.equal(productUpdateAuditFailure.status, 500, "a product-update audit failure must fail the price mutation");
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: productA.id } })).salePriceRial, 100n, "the product update must roll back when its audit insert fails");
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
  console.log("HTTP authorization integration passed: tenant/branch isolation, suspended-membership and inactive-branch denial, manager business/branch/product allow paths, accountant product allow and business/branch denial, member PII masking, owner-only access, inventory stock-count draft create/update and audit, catalog-priced cashier sale posting, cashier price/discount and mixed product-field denial, viewer product/sale write denial, cashier report denial, CSRF rollback, UUID validation, owner write, private attachment upload/download/removal and audit, advisory attachment lock, and database-trigger rollback for product create/update, party create/update, expense category, and expense draft audits.");
} finally {
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
  }
}
