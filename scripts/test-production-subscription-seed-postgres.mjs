import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaService } from "../apps/api/dist/prisma/prisma.service.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dispatcher = resolve(root, "prisma/seed-dispatcher.mjs");
const require = createRequire(import.meta.url);
const prismaCli = require.resolve("prisma/build/index.js");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL must point to an isolated PostgreSQL test database.");
const database = new URL(databaseUrl);
const databaseName = decodeURIComponent(database.pathname.replace(/^\//, "").split("?")[0]);
if (!["localhost", "127.0.0.1", "::1"].includes(database.hostname.replace(/^\[|\]$/g, "")) || !/test/i.test(databaseName)) {
  throw new Error("Refusing production-seed integration checks outside a loopback test database.");
}

const suffix = String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0");
const phone = `09${suffix}`;
const displayName = `Production seed test ${suffix}`;
const env = {
  ...process.env,
  NODE_ENV: "production",
  SHOPRO_SUBSCRIPTION_SEED_CONFIRM: "SEED_SUBSCRIPTION_CATALOG",
  ADMIN_BOOTSTRAP_PHONE: phone,
  ADMIN_BOOTSTRAP_NAME: displayName,
};
const prisma = new PrismaService();
let connected = false;
let previousPlan;
let previousRollout;
let previousPriceIds = new Set();

function run(label, executable, args, childEnv) {
  const result = spawnSync(executable, args, { cwd: root, env: childEnv, encoding: "utf8", timeout: 60_000 });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) throw new Error(`${label} exited ${result.status}:\n${output}`);
  return output;
}

function expectSeedRefusal(label, childEnv, expectedMessage) {
  const result = spawnSync(process.execPath, [dispatcher, "--subscriptions-only"], { cwd: root, env: childEnv, encoding: "utf8", timeout: 60_000 });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.notEqual(result.status, 0, `${label} must refuse to run`);
  assert.match(output, expectedMessage, `${label} should explain the missing authorization/configuration`);
}

try {
  await prisma.$connect();
  connected = true;
  previousPlan = await prisma.subscriptionPlan.findUnique({ where: { code: "STANDARD" }, select: { id: true } });
  if (previousPlan) {
    const prices = await prisma.subscriptionPriceVersion.findMany({ where: { planId: previousPlan.id }, select: { id: true } });
    previousPriceIds = new Set(prices.map(({ id }) => id));
  }
  previousRollout = await prisma.subscriptionRolloutSetting.findUnique({ where: { id: "global" } });
  const beforeBusinessCount = await prisma.business.count();
  const beforeUserCount = await prisma.user.count();

  const missingConfirmation = { ...env };
  delete missingConfirmation.SHOPRO_SUBSCRIPTION_SEED_CONFIRM;
  expectSeedRefusal("production confirmation guard", missingConfirmation, /SHOPRO_SUBSCRIPTION_SEED_CONFIRM/);
  const missingAdmin = { ...env };
  delete missingAdmin.ADMIN_BOOTSTRAP_PHONE;
  delete missingAdmin.ADMIN_BOOTSTRAP_NAME;
  expectSeedRefusal("production admin configuration guard", missingAdmin, /ADMIN_BOOTSTRAP_PHONE/);

  run("production subscription package seed", process.execPath, [dispatcher, "--subscriptions-only"], env);
  const firstPlan = await prisma.subscriptionPlan.findUnique({ where: { code: "STANDARD" }, select: { id: true } });
  assert.ok(firstPlan, "STANDARD plan should be created");
  const firstPriceCount = await prisma.subscriptionPriceVersion.count({ where: { planId: firstPlan.id } });
  const firstAdminCount = await prisma.systemAdmin.count({ where: { phone } });
  run("Prisma production seed config", process.execPath, [prismaCli, "db", "seed"], env);
  const finalPlan = await prisma.subscriptionPlan.findUnique({ where: { code: "STANDARD" }, include: { prices: true } });
  const admin = await prisma.systemAdmin.findUnique({ where: { phone } });
  assert.ok(finalPlan?.isActive, "seeded plan should be active");
  assert.ok(admin?.isActive, "bootstrap SystemAdmin should be active and able to access the whole admin panel");
  assert.equal(admin.displayName, displayName);
  assert.equal(await prisma.systemAdmin.count({ where: { phone } }), firstAdminCount);
  assert.equal(finalPlan.prices.length, firstPriceCount, "repeated production seeds must not duplicate price history");
  const now = new Date();
  const activePrices = finalPlan.prices.filter((price) => price.effectiveFrom <= now && (!price.effectiveTo || price.effectiveTo > now));
  const latestByDuration = new Map();
  for (const price of activePrices.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())) {
    if (!latestByDuration.has(price.durationMonths)) latestByDuration.set(price.durationMonths, price.priceRial.toString());
  }
  assert.deepEqual(Object.fromEntries([...latestByDuration].sort(([a], [b]) => a - b)), {
    1: "4970000", 3: "13790000", 6: "24900000", 12: "42900000",
  });
  assert.ok(await prisma.subscriptionRolloutSetting.findUnique({ where: { id: "global" } }));
  assert.equal(await prisma.business.count(), beforeBusinessCount, "production seed must not create demo businesses");
  assert.equal(await prisma.user.count(), beforeUserCount, "production seed must not create demo business users");
  console.log("Production seed PostgreSQL integration passed: guarded runtime entrypoint, independent active admin, four current prices, repeat idempotency and no demo business data.");
} finally {
  if (connected) {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { code: "STANDARD" }, select: { id: true } });
    if (plan) {
      const currentPrices = await prisma.subscriptionPriceVersion.findMany({ where: { planId: plan.id }, select: { id: true } });
      const createdPriceIds = currentPrices.map(({ id }) => id).filter((id) => !previousPriceIds.has(id));
      if (createdPriceIds.length) await prisma.subscriptionPriceVersion.deleteMany({ where: { id: { in: createdPriceIds } } });
      if (!previousPlan) await prisma.subscriptionPlan.deleteMany({ where: { id: plan.id } });
    }
    await prisma.systemAdmin.deleteMany({ where: { phone } });
    if (!previousRollout) await prisma.subscriptionRolloutSetting.deleteMany({ where: { id: "global" } });
    await prisma.$disconnect();
  }
}
