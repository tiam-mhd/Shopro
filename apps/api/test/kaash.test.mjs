import test from "node:test";
import assert from "node:assert/strict";
import { HttpException } from "@nestjs/common";
import { KaashService, KAASH_MODULE_BY_SCREEN, canTransitionKaashStatus, normalizeKaashContent } from "../dist/kaash/kaash.service.js";
import { SYSTEM_ADMIN_ONLY } from "../dist/common/system-admin-only.decorator.js";
import { SystemAdminController } from "../dist/kaash/system-admin-kaash.controller.js";

function fakePrisma({ recentCount = 0 } = {}) {
  const rows = new Map();
  const events = [];
  const audits = [];
  let creates = 0;
  let tail = Promise.resolve();
  const tx = {
    $queryRaw: async () => [],
    kaashSubmission: {
      findUnique: async ({ where }) => rows.get(`${where.userId_clientSubmissionId.userId}:${where.userId_clientSubmissionId.clientSubmissionId}`) ?? null,
      findFirst: async ({ where }) => [...rows.values()].find((row) => row.userId === where.userId && row.businessId === where.businessId && row.branchId === where.branchId && row.content === where.content && row.createdAt >= where.createdAt.gte) ?? null,
      count: async () => recentCount + creates,
      create: async ({ data }) => {
        creates += 1;
        const row = { id: `row-${creates}`, createdAt: new Date(), status: "NEW", ...data };
        rows.set(`${data.userId}:${data.clientSubmissionId}`, row);
        return { id: row.id, createdAt: row.createdAt, status: row.status };
      },
    },
    kaashSubmissionEvent: { create: async ({ data }) => { events.push(data); return data; } },
    auditEvent: { create: async ({ data }) => { audits.push(data); return data; } },
  };
  const prisma = {
    businessMember: { findFirst: async () => ({ businessId: "business-from-session" }) },
    $transaction: async (work) => {
      const previous = tail;
      let release;
      tail = new Promise((resolve) => { release = resolve; });
      await previous;
      try { return await work(tx); } finally { release(); }
    },
    get creates() { return creates; },
    rows,
    events,
    audits,
  };
  return prisma;
}

const user = { id: "user-from-session", businessId: "business-from-session", branchId: "branch-from-session", memberId: "member-from-session" };
const admin = { id: "owner-from-session", username: "shopro_super_admin", displayName: "مالک", sessionId: "session", csrfHash: "hash" };
const request = { requestId: "request-id" };
const submission = { content: "  ایدهٔ تازه 🙂\r\nبرای شاپرو  ", screenKey: "sales.register", clientSubmissionId: "4e66f166-d4dd-4f69-94f9-bc7f94468df2" };

test("source labels are allowlisted and contents normalize without breaking Persian or emoji", () => {
  assert.equal(KAASH_MODULE_BY_SCREEN["sales.register"], "SALES");
  assert.equal(KAASH_MODULE_BY_SCREEN["workspace.other"], "OTHER");
  assert.equal(normalizeKaashContent(submission.content), "ایدهٔ تازه 🙂\nبرای شاپرو");
  assert.equal(normalizeKaashContent(" \r\n "), "");
});

test("status changes follow the server transition map", () => {
  assert.equal(canTransitionKaashStatus("NEW", "REVIEWING"), true);
  assert.equal(canTransitionKaashStatus("IN_PROGRESS", "RELEASED"), true);
  assert.equal(canTransitionKaashStatus("NEW", "RELEASED"), false);
  assert.equal(canTransitionKaashStatus("ARCHIVED", "IN_PROGRESS"), false);
});

test("same client id retries and concurrent submissions create one row, with identity from session only", async () => {
  const prisma = fakePrisma();
  const service = new KaashService(prisma);
  const [first, duplicate] = await Promise.all([
    service.submit(user, request, submission),
    service.submit(user, request, submission),
  ]);
  assert.equal(first.id, duplicate.id);
  assert.equal(prisma.creates, 1);
  assert.equal(prisma.events.length, 1);
  assert.equal(prisma.audits.length, 1);
  const [stored] = prisma.rows.values();
  assert.equal(stored.userId, user.id);
  assert.equal(stored.businessId, user.businessId);
  assert.equal(stored.branchId, user.branchId);
  assert.equal(stored.content, "ایدهٔ تازه 🙂\nبرای شاپرو");
  assert.equal("userId" in submission, false);
  assert.equal("businessId" in submission, false);
  assert.equal("branchId" in submission, false);
  assert.equal("content" in prisma.audits[0].afterJson, false);
});

test("two tabs with separate client ids but the same recent text resolve to one row", async () => {
  const prisma = fakePrisma();
  const service = new KaashService(prisma);
  const [first, second] = await Promise.all([
    service.submit(user, request, submission),
    service.submit(user, request, { ...submission, clientSubmissionId: "9c1f5fe2-86a7-495c-a9ec-5d82d365bbfd" }),
  ]);
  assert.equal(first.id, second.id);
  assert.equal(prisma.creates, 1);
});

test("reusing an idempotency key for different text is rejected", async () => {
  const prisma = fakePrisma();
  const service = new KaashService(prisma);
  await service.submit(user, request, submission);
  await assert.rejects(() => service.submit(user, request, { ...submission, content: "متن دیگری" }), HttpException);
  assert.equal(prisma.creates, 1);
});

test("missing active workspace scope and excessive daily rate are rejected before a new row is made", async () => {
  const noScope = new KaashService({ ...fakePrisma(), businessMember: { findFirst: async () => null } });
  await assert.rejects(() => noScope.submit({ id: user.id }, request, submission), HttpException);
  const limitedPrisma = fakePrisma({ recentCount: 15 });
  const limited = new KaashService(limitedPrisma);
  await assert.rejects(() => limited.submit(user, request, submission), (error) => error instanceof HttpException && error.getStatus() === 429);
  assert.equal(limitedPrisma.creates, 0);
});

test("administrator endpoints require the isolated super-admin guard", () => {
  assert.equal(Reflect.getMetadata(SYSTEM_ADMIN_ONLY, SystemAdminController), true);
});
