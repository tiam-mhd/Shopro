import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException, HttpException } from "@nestjs/common";
import { PrismaService } from "../apps/api/dist/prisma/prisma.service.js";
import { SubscriptionsService } from "../apps/api/dist/subscriptions/subscriptions.service.js";
import { SubscriptionAdminService } from "../apps/api/dist/subscriptions/subscription-admin.service.js";
import { SubscriptionEntitlementGuard } from "../apps/api/dist/subscriptions/subscription-entitlement.guard.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must point to an isolated PostgreSQL test database.");
const databaseUrl = new URL(process.env.DATABASE_URL);
const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, "").split("?")[0]);
if (!["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname.replace(/^\[|\]$/g, "")) || !/test/i.test(databaseName)) {
  throw new Error("Refusing subscription integration checks outside a loopback test database.");
}

const prisma = new PrismaService();
const previousNodeEnv = process.env.NODE_ENV;
const previousGateway = process.env.PAYMENT_GATEWAY;
const ids = {
  user: randomUUID(), admin: randomUUID(), business: randomUUID(), plan: randomUUID(),
  branches: [randomUUID(), randomUUID(), randomUUID()],
};
const suffix = randomUUID().replaceAll("-", "").slice(0, 9);
let previousRollout;
let connected = false;

function ownerFor(branchId) {
  return { id: ids.user, phone: `09${suffix}`, displayName: "subscription integration", sessionId: randomUUID(), csrfHash: "", businessId: ids.business, branchId, memberId: randomUUID(), role: "OWNER", branchIds: ids.branches };
}

function requestContext() {
  return { requestId: `subscription-test-${suffix}` };
}

function guardContext(user, path = "/api/v1/sales", method = "POST") {
  const request = { user, path, method };
  return {
    getHandler: () => () => undefined,
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => request }),
    request,
  };
}

const reflector = { getAllAndOverride: () => false };

async function denied(guard, user, code) {
  await assert.rejects(guard.canActivate(guardContext(user)), (error) => {
    assert.ok(error instanceof HttpException);
    assert.equal(error.getStatus(), 402);
    assert.equal(error.getResponse().code, code);
    return true;
  });
}

async function main() {
  await prisma.$connect();
  connected = true;
  process.env.NODE_ENV = "development";
  process.env.PAYMENT_GATEWAY = "fake";
  previousRollout = await prisma.subscriptionRolloutSetting.findUnique({ where: { id: "global" } });
  await prisma.user.create({ data: { id: ids.user, phone: `09${suffix}`, displayName: "subscription integration" } });
  await prisma.systemAdmin.create({ data: { id: ids.admin, phone: `08${suffix}`, displayName: "Subscription Integration Admin" } });
  await prisma.business.create({ data: { id: ids.business, displayName: "Subscription Integration", businessType: "test" } });
  for (const [index, branchId] of ids.branches.entries()) {
    await prisma.branch.create({ data: { id: branchId, businessId: ids.business, name: `Branch ${index + 1}`, code: `SUB${index + 1}-${suffix.slice(-5)}` } });
  }
  await prisma.subscriptionPlan.create({ data: { id: ids.plan, code: `TEST_${suffix.slice(0, 8).toUpperCase()}`, nameFa: "پلن آزمایش", features: ["ویژگی آزمایش"] } });
  await prisma.subscriptionPriceVersion.create({ data: { planId: ids.plan, durationMonths: 1, priceRial: 4_970_000n, currency: "IRR", effectiveFrom: new Date(Date.now() - 60_000), createdById: ids.admin } });
  await prisma.subscriptionPriceVersion.create({ data: { planId: ids.plan, durationMonths: 3, priceRial: 13_790_000n, currency: "IRR", effectiveFrom: new Date(Date.now() - 60_000), createdById: ids.admin } });
  await prisma.subscriptionRolloutSetting.upsert({ where: { id: "global" }, update: { mode: "ENFORCE", legacyGraceEndsAt: null }, create: { id: "global", mode: "ENFORCE" } });

  const user1 = ownerFor(ids.branches[0]);
  const user2 = ownerFor(ids.branches[1]);
  const user3 = ownerFor(ids.branches[2]);
  const subscriptions = new SubscriptionsService(prisma);
  const adminSubscriptions = new SubscriptionAdminService(prisma);
  const guard = new SubscriptionEntitlementGuard(reflector, prisma);

  const tehranParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const selectedToday = new Date(`${tehranParts.year}-${tehranParts.month}-${tehranParts.day}T00:00:00+03:30`);
  await prisma.subscriptionPriceVersion.create({ data: {
    planId: ids.plan, durationMonths: 6, priceRial: 24_900_000n, currency: "IRR",
    effectiveFrom: new Date(Date.now() + 60_000), createdById: ids.admin,
  } });
  const activatedPrice = await adminSubscriptions.addPrice({ id: ids.admin }, requestContext(), ids.plan, {
    durationMonths: 6, priceRial: "24900000", effectiveFrom: selectedToday.toISOString(),
  });
  assert.ok(new Date(activatedPrice.effectiveFrom) <= new Date(), "a price set to today's Jalali date activates immediately");
  const visiblePlan = (await subscriptions.listPlans()).find(({ code }) => code === `TEST_${suffix.slice(0, 8).toUpperCase()}`);
  assert.equal(visiblePlan?.durations.find(({ durationMonths }) => durationMonths === 6)?.priceRial, "24900000", "the public app plans endpoint exposes today's price even when a later version is already scheduled");
  const visiblePriceOrder = await subscriptions.createOrder(user1, { planCode: `TEST_${suffix.slice(0, 8).toUpperCase()}`, durationMonths: 6 }, `same-day-${randomUUID()}`);
  assert.equal(visiblePriceOrder.amountRial, "24900000", "checkout uses the same immediately active price shown to the app");

  await denied(guard, user1, "SUBSCRIPTION_REQUIRED");
  assert.equal(await guard.canActivate(guardContext(user1, "/api/v1/subscriptions/orders", "POST")), true);
  assert.equal(await guard.canActivate(guardContext(user1, "/api/v1/reports/dashboard", "GET")), true);

  const idempotencyKey = `sub-${randomUUID()}`;
  const [first, concurrentReplay] = await Promise.all([
    subscriptions.createOrder(user1, { planCode: `TEST_${suffix.slice(0, 8).toUpperCase()}`, durationMonths: 1 }, idempotencyKey),
    subscriptions.createOrder(user1, { planCode: `TEST_${suffix.slice(0, 8).toUpperCase()}`, durationMonths: 1 }, idempotencyKey),
  ]);
  assert.equal(first.id, concurrentReplay.id);
  const replay = await subscriptions.createOrder(user1, { planCode: `TEST_${suffix.slice(0, 8).toUpperCase()}`, durationMonths: 1 }, idempotencyKey);
  assert.equal(first.id, replay.id);
  assert.equal(first.amountRial, "4970000");
  assert.equal(first.paymentMode, "fake");
  await assert.rejects(
    subscriptions.createOrder(user1, { planCode: `TEST_${suffix.slice(0, 8).toUpperCase()}`, durationMonths: 3 }, idempotencyKey),
    (error) => error instanceof ConflictException,
  );
  await assert.rejects(
    subscriptions.settleVerifiedPayment({ orderId: first.id, provider: "fake", providerExternalId: "bad-amount", amountRial: 1n, currency: "IRR", confirmedAt: new Date() }),
    (error) => error instanceof ConflictException,
  );

  await Promise.all([subscriptions.confirmFakeOrder(user1, first.id), subscriptions.confirmFakeOrder(user1, first.id)]);
  assert.equal(await prisma.subscriptionPeriod.count({ where: { businessId: ids.business, branchId: ids.branches[0], orderId: first.id } }), 1);
  assert.equal((await subscriptions.order(user1, first.id)).status, "PAID");
  assert.equal((await subscriptions.current(user1)).status, "ACTIVE");
  assert.equal(await guard.canActivate(guardContext(user1)), true);
  await denied(guard, user2, "SUBSCRIPTION_REQUIRED");

  const granted = await adminSubscriptions.grant({ id: ids.admin }, requestContext(), ids.branches[1], { durationMonths: 1, planCode: `TEST_${suffix.slice(0, 8).toUpperCase()}`, reason: "آزمون اعطای اشتراک" });
  const extended = await adminSubscriptions.grant({ id: ids.admin }, requestContext(), ids.branches[1], { durationMonths: 3, planCode: `TEST_${suffix.slice(0, 8).toUpperCase()}`, reason: "آزمون تمدید اشتراک" }, true);
  assert.ok(new Date(extended.startsAt).getTime() >= new Date(granted.endsAt).getTime());
  assert.equal((await subscriptions.current(user2)).status, "ACTIVE");
  assert.equal(await guard.canActivate(guardContext(user2)), true);
  const adminAuditCount = await prisma.systemAdminAuditEvent.count({ where: { adminId: ids.admin, action: { in: ["subscription.period.granted", "subscription.period.extended"] } } });
  assert.equal(adminAuditCount, 2);

  await assert.rejects(subscriptions.order(user2, first.id), (error) => error instanceof HttpException && error.getStatus() === 404);
  await assert.rejects(subscriptions.createOrder({ ...user1, role: "MANAGER" }, { planCode: `TEST_${suffix.slice(0, 8).toUpperCase()}`, durationMonths: 1 }, `manager-${randomUUID()}`), (error) => error instanceof ForbiddenException);

  await adminSubscriptions.setSuspension({ id: ids.admin }, requestContext(), ids.branches[1], { reason: "آزمون توقف" }, true);
  await denied(guard, user2, "SUBSCRIPTION_REQUIRED");
  await adminSubscriptions.setSuspension({ id: ids.admin }, requestContext(), ids.branches[1], { reason: "آزمون رفع توقف" }, false);
  assert.equal(await guard.canActivate(guardContext(user2)), true);

  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const unavailable = await subscriptions.createOrder(user3, { planCode: `TEST_${suffix.slice(0, 8).toUpperCase()}`, durationMonths: 1 }, `prod-${randomUUID()}`);
  assert.equal(unavailable.paymentMode, "unavailable");
  assert.equal(unavailable.status, "FAILED");
  assert.equal(unavailable.attempts[0].status, "UNAVAILABLE");
  await assert.rejects(subscriptions.confirmFakeOrder(user3, unavailable.id), (error) => error instanceof ForbiddenException);
  if (oldEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = oldEnv;
  await denied(guard, user3, "SUBSCRIPTION_REQUIRED");

  const auditActions = await prisma.systemAdminAuditEvent.findMany({ where: { adminId: ids.admin }, select: { action: true } });
  assert.ok(auditActions.some(({ action }) => action === "subscription.branch.suspended"));
  console.log("Subscription PostgreSQL integration passed: idempotency, verified amounts, concurrent replay, independent branches, grant/extend audit, suspension gate, tenant isolation, and production gateway block.");
}

try {
  await main();
} finally {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  if (previousGateway === undefined) delete process.env.PAYMENT_GATEWAY;
  else process.env.PAYMENT_GATEWAY = previousGateway;
  try {
    if (connected) await prisma.$transaction(async (tx) => {
      if (previousRollout) {
        await tx.subscriptionRolloutSetting.upsert({
          where: { id: "global" },
          create: previousRollout,
          update: {
            mode: previousRollout.mode,
            legacyGraceEndsAt: previousRollout.legacyGraceEndsAt,
            providerFeeBasisPoints: previousRollout.providerFeeBasisPoints,
            taxRateBasisPoints: previousRollout.taxRateBasisPoints,
            variableCostRial: previousRollout.variableCostRial,
            minimumContributionRial: previousRollout.minimumContributionRial,
            updatedById: previousRollout.updatedById,
            updatedAt: previousRollout.updatedAt,
          },
        });
      } else {
        await tx.subscriptionRolloutSetting.deleteMany({ where: { id: "global" } });
      }
      await tx.systemAdminAuditEvent.deleteMany({ where: { adminId: ids.admin } });
      await tx.subscriptionPaymentAttempt.deleteMany({ where: { businessId: ids.business } });
      await tx.subscriptionPeriod.deleteMany({ where: { businessId: ids.business } });
      await tx.subscriptionOrder.deleteMany({ where: { businessId: ids.business } });
      await tx.branchSubscription.deleteMany({ where: { businessId: ids.business } });
      await tx.subscriptionPriceVersion.deleteMany({ where: { planId: ids.plan } });
      await tx.subscriptionPlan.deleteMany({ where: { id: ids.plan } });
      await tx.branch.deleteMany({ where: { businessId: ids.business } });
      await tx.business.deleteMany({ where: { id: ids.business } });
      await tx.user.deleteMany({ where: { id: ids.user } });
      await tx.systemAdmin.deleteMany({ where: { id: ids.admin } });
    });
  } finally {
    if (connected) await prisma.$disconnect();
  }
}
