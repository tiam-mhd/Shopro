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
const fixtures = { businesses: [], users: [], expenses: [] };
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
  const cashier = await createSessionUser("HTTP cashier fixture");
  const viewer = await createSessionUser("HTTP viewer fixture");
  const outsider = await createSessionUser("HTTP other-tenant fixture");
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
  const cashierA = await prisma.businessMember.create({ data: { businessId: businessA.id, userId: cashier.user.id, role: "CASHIER" } });
  const viewerA = await prisma.businessMember.create({ data: { businessId: businessA.id, userId: viewer.user.id, role: "VIEWER" } });
  const memberB = await prisma.businessMember.create({ data: { businessId: businessB.id, userId: outsider.user.id, role: "OWNER" } });
  await prisma.memberBranch.createMany({ data: [
    { businessId: businessA.id, memberId: ownerA.id, branchId: branchA1.id },
    { businessId: businessA.id, memberId: ownerA.id, branchId: branchA2.id },
    { businessId: businessA.id, memberId: cashierA.id, branchId: branchA1.id },
    { businessId: businessA.id, memberId: viewerA.id, branchId: branchA1.id },
    { businessId: businessB.id, memberId: memberB.id, branchId: branchB1.id },
  ] });

  const unitA = await prisma.unit.create({ data: { businessId: businessA.id, code: "pcs", labelFa: "عدد", precision: 0, groupKey: "count", isVisible: true } });
  const unitB = await prisma.unit.create({ data: { businessId: businessB.id, code: "pcs", labelFa: "عدد", precision: 0, groupKey: "count", isVisible: true } });
  const productA = await prisma.product.create({ data: { businessId: businessA.id, unitId: unitA.id, name: "Private A", normalizedName: "private a", kind: "SERVICE", salePriceRial: 100n, trackInventory: false } });
  await prisma.product.create({ data: { businessId: businessB.id, unitId: unitB.id, name: "Private B", normalizedName: "private b", kind: "SERVICE", salePriceRial: 200n, trackInventory: false } });
  const expenseLedger = await prisma.ledgerAccount.create({ data: { businessId: businessA.id, code: "HTTP-EXPENSE", name: "HTTP expense", type: "EXPENSE" } });
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

  const request = async (path, { auth, businessId, branchId, method = "GET", body, csrf = true } = {}) => {
    const headers = {};
    if (auth) headers.cookie = `shopro_session=${auth.rawSession}; shopro_csrf=${auth.csrf}`;
    if (businessId) headers["x-business-id"] = businessId;
    if (branchId) headers["x-branch-id"] = branchId;
    if (body !== undefined) headers["content-type"] = "application/json";
    if (auth && csrf && method !== "GET") headers["x-csrf-token"] = auth.csrf;
    const response = await fetch(`${baseUrl}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const payload = await response.json();
    return { status: response.status, payload };
  };

  const missingSession = await request("/products", { businessId: businessA.id, branchId: branchA1.id });
  assert.equal(missingSession.status, 401, "protected API routes must require a user session");

  const tenantLeak = await request("/products", { auth: outsider, businessId: businessA.id, branchId: branchA1.id });
  assert.equal(tenantLeak.status, 403, "a member of another business must not select the target tenant");

  const branchLeak = await request("/products", { auth: cashier, businessId: businessA.id, branchId: branchA2.id });
  assert.equal(branchLeak.status, 403, "a member must not select an unassigned branch");

  const scopedList = await request("/products", { auth: owner, businessId: businessA.id, branchId: branchA1.id });
  assert.equal(scopedList.status, 200);
  assert.deepEqual(scopedList.payload.map(({ name }) => name), ["Private A"], "list results must not leak a different tenant's products");

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

  await prisma.$executeRawUnsafe(`CREATE FUNCTION shopro_test_reject_product_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'product.created' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe("CREATE TRIGGER shopro_test_reject_product_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION shopro_test_reject_product_audit()");
  auditFailureTriggerInstalled = true;
  const auditFailure = await request("/products", {
    auth: owner, businessId: businessA.id, branchId: branchA1.id, method: "POST",
    body: { name: "Audit rollback fixture", kind: "SERVICE", salePriceRial: "600", unitId: unitA.id },
  });
  assert.equal(auditFailure.status, 500, "an audit insert failure must fail the originating product mutation");
  assert.equal(await prisma.product.count({ where: { businessId: businessA.id, name: "Audit rollback fixture" } }), 0, "the product insert must roll back when its audit insert fails");
  await prisma.$executeRawUnsafe("DROP TRIGGER shopro_test_reject_product_audit ON audit_events");
  await prisma.$executeRawUnsafe("DROP FUNCTION shopro_test_reject_product_audit()");
  auditFailureTriggerInstalled = false;
  console.log("HTTP authorization integration passed: tenant/branch and role isolation, member PII masking, owner-only access, cashier report denial, viewer write denial, CSRF rollback, UUID validation, owner write, private attachment upload/download/removal and audit, advisory attachment lock, and real audit-trigger rollback.");
} finally {
  if (app) await app.close();
  try {
    if (auditFailureTriggerInstalled) {
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS shopro_test_reject_product_audit ON audit_events");
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS shopro_test_reject_product_audit()");
    }
    for (const expenseId of fixtures.expenses) {
      const expense = await prisma.expense.findUnique({ where: { id: expenseId }, select: { attachmentId: true } });
      if (expense?.attachmentId) {
        await prisma.expense.update({ where: { id: expenseId }, data: { attachmentId: null } });
        await prisma.attachment.deleteMany({ where: { id: expense.attachmentId } });
      }
      await prisma.expense.deleteMany({ where: { id: expenseId } });
    }
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
