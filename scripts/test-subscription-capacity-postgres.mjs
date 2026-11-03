import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "../apps/api/dist/app.module.js";
import { ApiExceptionFilter } from "../apps/api/dist/common/api-exception.filter.js";
import { addJalaliMonths } from "../apps/api/dist/subscriptions/jalali-period.js";
import { SubscriptionEntitlementGuard } from "../apps/api/dist/subscriptions/subscription-entitlement.guard.js";
import { PrismaService } from "../apps/api/dist/prisma/prisma.service.js";
import { performance } from "node:perf_hooks";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must target an isolated PostgreSQL test database.");
const databaseUrl = new URL(process.env.DATABASE_URL);
const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, "").split("?")[0]);
if (!["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname.replace(/^\[|\]$/g, "")) || !/test/i.test(databaseName)) {
  throw new Error("Refusing subscription capacity run outside a loopback test database.");
}

const BRANCH_COUNT = Number(process.env.SHOPRO_SUBSCRIPTION_PERF_BRANCHES ?? 10_000);
const VU_COUNT = Number(process.env.SHOPRO_SUBSCRIPTION_PERF_VUS ?? 20);
const DURATION_MS = Number(process.env.SHOPRO_SUBSCRIPTION_PERF_DURATION_MS ?? 300_000);
const allowShortRun = process.env.SHOPRO_SUBSCRIPTION_PERF_ALLOW_SHORT === "1";
if (!Number.isInteger(BRANCH_COUNT) || BRANCH_COUNT < 10_000 || BRANCH_COUNT % 2 !== 0 || !Number.isInteger(VU_COUNT) || VU_COUNT !== 20 || !Number.isInteger(DURATION_MS) || DURATION_MS < (allowShortRun ? 5_000 : 300_000)) {
  throw new Error("Capacity profile requires at least 10,000 branches, exactly 20 VUs, and at least five minutes.");
}

const prisma = new PrismaService();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const runId = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
const suffix = randomUUID().replaceAll("-", "").slice(0, 9);
const fixtures = { businessIds: [], userIds: [], branchIds: [], memberIds: [], sessionIds: [], planId: randomUUID(), adminId: randomUUID() };
const originalNodeEnv = process.env.NODE_ENV;
const originalGateway = process.env.PAYMENT_GATEWAY;
let originalRollout;
let connected = false;
let app;

const timings = { plans: [], current: [], gate: [], gateHttp: [], orders: [], baseline: [] };
const errors = [];
let totalRequests = 0;
let expectedGatePasses = 0;
let abortLoad = false;

function percentile(values, fraction) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return Number(ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)].toFixed(2));
}

function summary(values) {
  return { count: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95), p99Ms: percentile(values, 0.99) };
}

async function createBatched(model, data, batchSize = 500) {
  for (let offset = 0; offset < data.length; offset += batchSize) {
    await model.createMany({ data: data.slice(offset, offset + batchSize) });
  }
}

function userHeaders(user, branch) {
  return {
    cookie: `shopro_session=${user.rawSession}; shopro_csrf=${user.csrf}`,
    "x-csrf-token": user.csrf,
    "x-business-id": branch.businessId,
    "x-branch-id": branch.id,
  };
}

function guardContext(user, branch) {
  const request = {
    user: { id: user.id, businessId: branch.businessId, branchId: branch.id },
    path: "/api/v1/products",
    method: "POST",
  };
  return {
    getHandler: () => guardContext,
    getClass: () => class CapacityController {},
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

async function setup() {
  await prisma.$connect();
  connected = true;
  originalRollout = await prisma.subscriptionRolloutSetting.findUnique({ where: { id: "global" } });
  process.env.NODE_ENV = "development";
  process.env.PAYMENT_GATEWAY = "fake";

  await prisma.systemAdmin.create({ data: { id: fixtures.adminId, phone: `08${suffix}`, displayName: "Capacity test admin" } });
  const businesses = await Promise.all([0, 1].map((index) => prisma.business.create({ data: { displayName: `Subscription capacity ${runId}-${index}`, businessType: "test" } })));
  fixtures.businessIds.push(...businesses.map(({ id }) => id));
  const planCode = `LOAD_${runId}`;
  const plan = await prisma.subscriptionPlan.create({ data: { id: fixtures.planId, code: planCode, nameFa: "Subscription capacity test", features: [] } });
  const effectiveFrom = new Date(Date.now() - 60_000);
  await prisma.subscriptionPriceVersion.createMany({ data: [
    { planId: plan.id, durationMonths: 1, priceRial: 4_970_000n, currency: "IRR", effectiveFrom, createdById: fixtures.adminId },
    { planId: plan.id, durationMonths: 3, priceRial: 13_790_000n, currency: "IRR", effectiveFrom, createdById: fixtures.adminId },
    { planId: plan.id, durationMonths: 6, priceRial: 24_900_000n, currency: "IRR", effectiveFrom, createdById: fixtures.adminId },
    { planId: plan.id, durationMonths: 12, priceRial: 42_900_000n, currency: "IRR", effectiveFrom, createdById: fixtures.adminId },
  ] });

  const branchRows = [];
  const branchSubscriptionRows = [];
  const start = new Date(Date.now() - 60_000);
  const end = addJalaliMonths(start, 12);
  const periodRows = [];
  const byUserBranchRows = Array.from({ length: VU_COUNT }, () => []);
  for (let index = 0; index < BRANCH_COUNT; index++) {
    const businessIndex = Math.floor(index / (BRANCH_COUNT / 2));
    const localIndex = index % (BRANCH_COUNT / 2);
    const id = randomUUID();
    const subscriptionId = randomUUID();
    const vuIndex = businessIndex * (VU_COUNT / 2) + Math.floor(localIndex / ((BRANCH_COUNT / 2) / (VU_COUNT / 2)));
    const row = { id, businessId: businesses[businessIndex].id, name: `Load branch ${index + 1}`, code: `LOAD-${String(index + 1).padStart(6, "0")}` };
    branchRows.push(row);
    fixtures.branchIds.push(id);
    branchSubscriptionRows.push({ id: subscriptionId, businessId: row.businessId, branchId: id });
    periodRows.push({ businessId: row.businessId, branchId: id, branchSubscriptionId: subscriptionId, planId: plan.id, source: "ADMIN_GRANT", planCodeSnapshot: plan.code, planNameFaSnapshot: plan.nameFa, durationMonths: 12, startsAt: start, endsAt: end, actorAdminId: fixtures.adminId });
    byUserBranchRows[vuIndex].push(row);
  }
  await createBatched(prisma.branch, branchRows);
  await createBatched(prisma.branchSubscription, branchSubscriptionRows);
  await createBatched(prisma.subscriptionPeriod, periodRows);

  const users = [];
  const memberBranchRows = [];
  for (let index = 0; index < VU_COUNT; index++) {
    const phoneDigits = String(100_000_000 + index);
    const rawSession = randomUUID() + randomUUID();
    const csrf = randomUUID() + randomUUID();
    const user = await prisma.user.create({ data: { phone: `09${phoneDigits}`, displayName: `Capacity VU ${index + 1}` } });
    fixtures.userIds.push(user.id);
    const member = await prisma.businessMember.create({ data: { businessId: businesses[Math.floor(index / (VU_COUNT / 2))].id, userId: user.id, role: "OWNER", status: "ACTIVE" } });
    fixtures.memberIds.push(member.id);
    const assignedBranch = byUserBranchRows[index][0];
    users.push({ id: user.id, rawSession, csrf, branches: [assignedBranch] });
    memberBranchRows.push({ memberId: member.id, businessId: assignedBranch.businessId, branchId: assignedBranch.id });
    const session = await prisma.userSession.create({ data: { userId: user.id, tokenHash: hash(rawSession), csrfHash: hash(csrf), expiresAt: new Date(Date.now() + 2 * 60 * 60_000) } });
    fixtures.sessionIds.push(session.id);
  }
  await createBatched(prisma.memberBranch, memberBranchRows);
  await prisma.subscriptionRolloutSetting.upsert({ where: { id: "global" }, update: { mode: "ENFORCE", legacyGraceEndsAt: null }, create: { id: "global", mode: "ENFORCE" } });

  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }));
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  return { users, baseUrl: `http://127.0.0.1:${address.port}/api/v1`, planCode };
}

async function cleanup() {
  if (app) await app.close();
  if (!connected) return;
  await prisma.$transaction(async (tx) => {
    if (originalRollout) {
      await tx.subscriptionRolloutSetting.upsert({
        where: { id: "global" }, create: originalRollout,
        update: {
          mode: originalRollout.mode,
          legacyGraceEndsAt: originalRollout.legacyGraceEndsAt,
          providerFeeBasisPoints: originalRollout.providerFeeBasisPoints,
          taxRateBasisPoints: originalRollout.taxRateBasisPoints,
          variableCostRial: originalRollout.variableCostRial,
          minimumContributionRial: originalRollout.minimumContributionRial,
          updatedById: originalRollout.updatedById,
          updatedAt: originalRollout.updatedAt,
        },
      });
    } else {
      await tx.subscriptionRolloutSetting.deleteMany({ where: { id: "global" } });
    }
    if (fixtures.businessIds.length) {
      await tx.subscriptionPaymentAttempt.deleteMany({ where: { businessId: { in: fixtures.businessIds } } });
      await tx.subscriptionPeriod.deleteMany({ where: { businessId: { in: fixtures.businessIds } } });
      await tx.subscriptionOrder.deleteMany({ where: { businessId: { in: fixtures.businessIds } } });
      await tx.branchSubscription.deleteMany({ where: { businessId: { in: fixtures.businessIds } } });
      await tx.memberBranch.deleteMany({ where: { businessId: { in: fixtures.businessIds } } });
      await tx.businessMember.deleteMany({ where: { businessId: { in: fixtures.businessIds } } });
      await tx.subscriptionPriceVersion.deleteMany({ where: { planId: fixtures.planId } });
      await tx.subscriptionPlan.deleteMany({ where: { id: fixtures.planId } });
      await tx.branch.deleteMany({ where: { businessId: { in: fixtures.businessIds } } });
      await tx.business.deleteMany({ where: { id: { in: fixtures.businessIds } } });
    }
    if (fixtures.userIds.length) await tx.user.deleteMany({ where: { id: { in: fixtures.userIds } } });
    await tx.systemAdmin.deleteMany({ where: { id: fixtures.adminId } });
  });
  await prisma.$disconnect();
}

async function runLoad({ users, baseUrl, planCode }) {
  const entitlementGuard = new SubscriptionEntitlementGuard({ getAllAndOverride: () => false }, prisma);
  const request = async (path, user, branch, options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...userHeaders(user, branch),
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };

  const expiredPeriod = await prisma.subscriptionPeriod.findFirst({ where: { branchId: users[0].branches[0].id }, select: { id: true, endsAt: true } });
  assert.ok(expiredPeriod);
  await prisma.subscriptionPeriod.update({ where: { id: expiredPeriod.id }, data: { endsAt: new Date(Date.now() - 1_000) } });
  const expiredWrite = await request("/products", users[0], users[0].branches[0], { method: "POST", body: {} });
  assert.equal(expiredWrite.status, 402);
  assert.equal(expiredWrite.body.code, "SUBSCRIPTION_EXPIRED");
  await prisma.subscriptionPeriod.update({ where: { id: expiredPeriod.id }, data: { endsAt: expiredPeriod.endsAt } });

  const foreignBusinessBranch = users[VU_COUNT / 2].branches[0];
  const tenantIsolation = await request("/subscriptions/current", users[0], foreignBusinessBranch);
  assert.equal(tenantIsolation.status, 403, "a user session must not select a branch from another business");

  const deadline = performance.now() + DURATION_MS;
  const progressTimer = setInterval(() => {
    const elapsedSeconds = Math.round((DURATION_MS - Math.max(0, deadline - performance.now())) / 1000);
    console.log(`capacity progress: ${elapsedSeconds}s/${Math.ceil(DURATION_MS / 1000)}s, requests=${totalRequests}, errors=${errors.length}`);
  }, 30_000);

  try {
    await Promise.all(users.map(async (user, virtualUser) => {
      let iteration = 0;
      while (performance.now() < deadline && !abortLoad) {
        const branch = user.branches[(iteration * 131 + virtualUser * 17) % user.branches.length];
        const action = iteration % 4;
        const started = performance.now();
        try {
          let result;
          let metric;
          let expectedStatus;
          if (action === 0) {
            metric = "plans";
            result = await request("/subscriptions/plans", user, branch);
            expectedStatus = 200;
          } else if (action === 1) {
            metric = "current";
            result = await request("/subscriptions/current", user, branch);
            expectedStatus = 200;
          } else if (action === 2) {
            metric = "gate";
            const baselineStarted = performance.now();
            await prisma.$queryRaw`SELECT 1`;
            timings.baseline.push(performance.now() - baselineStarted);
            const directGateStarted = performance.now();
            await entitlementGuard.canActivate(guardContext(user, branch));
            timings.gate.push(performance.now() - directGateStarted);
            const gateHttpStarted = performance.now();
            result = await request("/products", user, branch, { method: "POST", body: {} });
            timings.gateHttp.push(performance.now() - gateHttpStarted);
            expectedStatus = 400;
            if (result.status === 400) expectedGatePasses++;
          } else {
            metric = "orders";
            result = await request("/subscriptions/orders", user, branch, {
              method: "POST",
              idempotencyKey: `capacity-${runId}-${virtualUser}-${iteration}`,
              body: { planCode, durationMonths: 1 },
            });
            expectedStatus = 201;
          }
          if (metric !== "gate") timings[metric].push(performance.now() - started);
          if (result.status !== expectedStatus) {
            errors.push({ virtualUser, metric, status: result.status, code: result.body?.code });
            abortLoad = true;
          }
        } catch (error) {
          errors.push({ virtualUser, action, error: error?.name ?? "Error" });
          abortLoad = true;
        }
        totalRequests++;
        iteration++;
      }
    }));
  } finally {
    clearInterval(progressTimer);
  }

  const generatedOrders = timings.orders.length;
  const [orderCount, attemptCount] = await Promise.all([
    prisma.subscriptionOrder.count({ where: { idempotencyKey: { startsWith: `capacity-${runId}-` } } }),
    prisma.subscriptionPaymentAttempt.count({ where: { order: { idempotencyKey: { startsWith: `capacity-${runId}-` } } } }),
  ]);
  assert.equal(errors.length, 0, `capacity run must have zero request errors: ${JSON.stringify(errors.slice(0, 10))}`);
  assert.ok(expectedGatePasses > 0, "write gate should pass for entitled branches before DTO validation");
  assert.equal(orderCount, generatedOrders, "each successful idempotent order key must create one order");
  assert.equal(attemptCount, generatedOrders, "each test order must have exactly one payment attempt");
  assert.ok(totalRequests >= VU_COUNT, "all 20 virtual users must complete at least one request");

  const gateP95 = percentile(timings.gate, 0.95);
  const baselineP95 = percentile(timings.baseline, 0.95);
  console.log(JSON.stringify({
    event: "subscription_capacity.complete",
    durationMs: DURATION_MS,
    virtualUsers: VU_COUNT,
    activeBranchSubscriptions: BRANCH_COUNT,
    totalRequests,
    errors: errors.length,
    endpointLatency: { plans: summary(timings.plans), current: summary(timings.current), writeGateDatabaseCheck: summary(timings.gate), writeGateHttp: summary(timings.gateHttp), createOrder: summary(timings.orders) },
    rawDatabaseBaseline: summary(timings.baseline),
    writeGateP95AboveSelectOneMs: gateP95 === null || baselineP95 === null ? null : Number((gateP95 - baselineP95).toFixed(2)),
    expectedWriteGatePasses: expectedGatePasses,
    orderRows: orderCount,
    paymentAttemptRows: attemptCount,
  }));
  assert.equal(orderCount, generatedOrders);
}

try {
  const context = await setup();
  await runLoad(context);
} finally {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalGateway === undefined) delete process.env.PAYMENT_GATEWAY;
  else process.env.PAYMENT_GATEWAY = originalGateway;
  await cleanup();
}
