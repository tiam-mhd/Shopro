import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { BadRequestException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { SessionGuard } from "../dist/common/session.guard.js";
import { UuidParamPipe, assertUuid } from "../dist/common/uuid-param.pipe.js";
import { ProductsService } from "../dist/products/products.service.js";
import { CsrfGuard } from "../dist/common/csrf.guard.js";
import { SYSTEM_ADMIN_ONLY } from "../dist/common/system-admin-only.decorator.js";
import { SystemAdminService } from "../dist/system-admin/system-admin.service.js";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const contextFor = (request) => ({
  getHandler: () => ({}),
  getClass: () => ({}),
  switchToHttp: () => ({ getRequest: () => request }),
});

test("system-admin-only routes authenticate the isolated admin session and reject missing sessions", async () => {
  const rawSession = "private-admin-session";
  let receivedQuery;
  const prisma = { systemAdminSession: { findFirst: async (query) => { receivedQuery = query; return {
    id: "session-id", csrfHash: sha256("csrf-value"), admin: { id: "admin-id", phone: "09120000000", displayName: "مدیر", isActive: true },
  }; } } };
  const reflector = { getAllAndOverride: (key) => key === SYSTEM_ADMIN_ONLY };
  const guard = new SessionGuard(reflector, prisma);
  const request = { cookies: { shopro_admin_session: rawSession }, headers: {} };
  assert.equal(await guard.canActivate(contextFor(request)), true);
  assert.deepEqual(request.systemAdmin, { id: "admin-id", phone: "09120000000", displayName: "مدیر", sessionId: "session-id", csrfHash: sha256("csrf-value") });
  assert.equal(receivedQuery.where.tokenHash, sha256(rawSession));
  assert.equal(receivedQuery.where.admin.isActive, true);
  assert.equal(receivedQuery.where.revokedAt, null);

  const missingGuard = new SessionGuard(reflector, { systemAdminSession: { findFirst: async () => assert.fail("no cookie should not query sessions") } });
  await assert.rejects(missingGuard.canActivate(contextFor({ cookies: {}, headers: {} })), UnauthorizedException);
});

test("system-admin writes require the admin CSRF cookie, matching header and session hash", () => {
  const reflector = { getAllAndOverride: (key) => key === SYSTEM_ADMIN_ONLY };
  const guard = new CsrfGuard(reflector);
  const rawCsrf = "csrf-value";
  const request = {
    method: "POST",
    cookies: { shopro_admin_csrf: rawCsrf },
    header: (name) => name === "x-csrf-token" ? rawCsrf : undefined,
    systemAdmin: { csrfHash: sha256(rawCsrf) },
  };
  assert.equal(guard.canActivate(contextFor(request)), true);
  assert.throws(() => guard.canActivate(contextFor({ ...request, header: () => "different" })), ForbiddenException);
  assert.throws(() => guard.canActivate(contextFor({ ...request, cookies: { shopro_csrf: rawCsrf } })), ForbiddenException);
});

test("system-admin business listing is paginated, omits member PII, and records an audit event", async () => {
  const query = "فروشگاه";
  const business = { id: "11111111-1111-4111-8111-111111111111", displayName: "فروشگاه نمونه", businessType: "retail", displayCurrency: "IRT", createdAt: new Date("2026-01-01T00:00:00.000Z"), branches: [{ id: "branch-id", name: "اصلی", code: "MAIN", isActive: true }], _count: { members: 1, products: 2, parties: 3, salesInvoices: 4, purchases: 5, expenses: 6 } };
  const auditEvents = [];
  let findManyQuery;
  const prisma = {
    business: {
      findFirst: async ({ where }) => ({ id: where.id }),
      findMany: async (value) => { findManyQuery = value; return [business]; },
    },
    systemAdminAuditEvent: { create: async ({ data }) => { auditEvents.push(data); return { id: "audit-id" }; } },
  };
  const service = new SystemAdminService(prisma);
  const result = await service.businesses({ id: "admin-id" }, { requestId: "request-1" }, { q: query, cursor: business.id, limit: "1" });
  assert.deepEqual(result, { items: [business], nextCursor: null, hasMore: false });
  assert.deepEqual(findManyQuery.where, { displayName: { contains: query, mode: "insensitive" } });
  assert.equal(findManyQuery.take, 2);
  assert.deepEqual(findManyQuery.select.branches.select, { id: true, name: true, code: true, isActive: true });
  assert.equal(Object.hasOwn(result.items[0], "membersPhones"), false);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, "system_admin.businesses.list");
  assert.deepEqual(auditEvents[0].metadata, { resultCount: 1, hasMore: false, searched: true, cursorUsed: true });
  assert.equal(auditEvents[0].requestId, "request-1");
});

test("business sessions reject inactive branches and do not select one when none remain active", async () => {
  const reflector = { getAllAndOverride: () => false };
  const session = { id: "session-id", csrfHash: "hash", user: { id: "user-id", phone: "09120000000", displayName: null } };
  const makeGuard = (branches) => new SessionGuard(reflector, {
    userSession: { findFirst: async () => session },
    businessMember: { findFirst: async (query) => {
      assert.equal(query.where.status, "ACTIVE");
      assert.deepEqual(query.include.branches.where, { branch: { isActive: true } });
      return { id: "member-id", role: "OWNER", branches };
    } },
  });
  const requestFor = (branchId) => ({ cookies: { shopro_session: "user-session" }, headers: { "x-business-id": "11111111-1111-4111-8111-111111111111", ...(branchId ? { "x-branch-id": branchId } : {}) } });
  const activeRequest = requestFor(undefined);
  assert.equal(await makeGuard([{ branchId: "22222222-2222-4222-8222-222222222222", branch: { isActive: true } }]).canActivate(contextFor(activeRequest)), true);
  assert.equal(activeRequest.user.branchId, "22222222-2222-4222-8222-222222222222");

  await assert.rejects(
    makeGuard([]).canActivate(contextFor(requestFor(undefined))),
    (error) => error instanceof ForbiddenException && /شعبهٔ فعالی/.test(error.message),
  );
  await assert.rejects(
    makeGuard([{ branchId: "33333333-3333-4333-8333-333333333333", branch: { isActive: true } }]).canActivate(contextFor(requestFor("44444444-4444-4444-8444-444444444444"))),
    ForbiddenException,
  );
  const invalidBusinessGuard = new SessionGuard(reflector, {
    userSession: { findFirst: async () => session },
    businessMember: { findFirst: async () => assert.fail("malformed business IDs must be rejected before Prisma") },
  });
  await assert.rejects(invalidBusinessGuard.canActivate(contextFor({ cookies: { shopro_session: "user-session" }, headers: { "x-business-id": "bad-id" } })), /شناسهٔ کسب‌وکار/);
});

test("route UUID validation rejects malformed identifiers before Prisma sees them", () => {
  const pipe = new UuidParamPipe();
  assert.equal(pipe.transform("11111111-1111-4111-8111-111111111111"), "11111111-1111-4111-8111-111111111111");
  assert.throws(() => pipe.transform("not-a-uuid"), BadRequestException);
  assert.throws(() => assertUuid("not-a-uuid"), BadRequestException);
});

test("malformed pagination cursors return a client error before database access", async () => {
  const products = new ProductsService({});
  await assert.rejects(products.list({ id: "user", businessId: "business-id" }, undefined, undefined, "bad-cursor"), BadRequestException);
});
