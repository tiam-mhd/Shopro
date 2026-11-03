import assert from "node:assert/strict";
import { AccountingService } from "../apps/api/dist/finance/accounting.service.js";
import { PrismaService } from "../apps/api/dist/prisma/prisma.service.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL must target an isolated test database.");
const databaseUrl = new URL(connectionString);
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
if (!/^(localhost|127\.0\.0\.1|::1)$/.test(databaseUrl.hostname) || !/test/i.test(databaseName)) {
  throw new Error(`Refusing integration test outside loopback test database (host=${databaseUrl.hostname}, database=${databaseName}).`);
}

const prisma = new PrismaService();
const accounting = new AccountingService({});
let businessId;
try {
  await prisma.$connect();
  const business = await prisma.business.create({
    data: {
      displayName: `Document sequence test ${Date.now()}`,
      businessType: "Automated test",
      branches: { create: [{ name: "شعبهٔ الف", code: "TEST-A" }, { name: "شعبهٔ ب", code: "TEST-B" }] },
    },
    include: { branches: { select: { id: true } } },
  });
  businessId = business.id;
  assert.equal(business.branches.length, 2);

  const specs = [
    { type: "JOURNAL", prefix: "D" },
    { type: "SALE", prefix: "S" },
    { type: "RETURN", prefix: "R" },
    { type: "PURCHASE", prefix: "P" },
    { type: "EXPENSE", prefix: "E" },
  ];
  for (const { type, prefix } of specs) {
    const allocations = await Promise.all(Array.from({ length: 40 }, (_, index) => prisma.$transaction(async (tx) => ({
      branchId: business.branches[index % 2].id,
      number: await accounting.nextDocumentNumber(tx, { businessId, type, prefix }),
    }))));
    const numbers = allocations.map((allocation) => allocation.number);
    assert.equal(new Set(numbers).size, 40, `${type} numbers must be unique across branches`);
    assert.deepEqual(numbers.slice().sort(), Array.from({ length: 40 }, (_, index) => `${prefix}-${String(index + 1).padStart(6, "0")}`));
    assert.equal(new Set(allocations.map((allocation) => allocation.branchId)).size, 2, `${type} allocations must cover both branches`);
  }
  console.log("PostgreSQL document sequence concurrency passed: 200 concurrent allocations across both branches, covering JOURNAL, SALE, RETURN, PURCHASE and EXPENSE business-wide sequences.");
} finally {
  try { if (businessId) await prisma.business.delete({ where: { id: businessId } }); }
  finally { await prisma.$disconnect(); }
}
