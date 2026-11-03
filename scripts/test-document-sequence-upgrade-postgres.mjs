import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { AccountingService } from "../apps/api/dist/finance/accounting.service.js";
import { PrismaService } from "../apps/api/dist/prisma/prisma.service.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL must target an isolated test database.");
const baseUrl = new URL(connectionString);
const baseDatabase = decodeURIComponent(baseUrl.pathname.slice(1));
const host = baseUrl.hostname.replace(/^\[|\]$/g, "");
if (!["localhost", "127.0.0.1", "::1"].includes(host) || !/test/i.test(baseDatabase)) {
  throw new Error(`Refusing migration upgrade test outside loopback test database (host=${host}, database=${baseDatabase}).`);
}

const upgradeDatabase = `shopro_upgrade_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const upgradeUrl = new URL(connectionString);
upgradeUrl.pathname = `/${upgradeDatabase}`;
const pgEnvironment = (database) => {
  const env = {
    ...process.env,
    PGHOST: host,
    PGPORT: baseUrl.port || "5432",
    PGUSER: decodeURIComponent(baseUrl.username),
    PGDATABASE: database,
    PGSSLMODE: "disable",
    PGAPPNAME: "shopro-migration-upgrade-test",
  };
  const password = decodeURIComponent(baseUrl.password);
  if (password) env.PGPASSWORD = password;
  else delete env.PGPASSWORD;
  return env;
};
const run = (command, args, database) => {
  const result = spawnSync(command, args, { cwd: process.cwd(), env: pgEnvironment(database), encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr?.trim() || "no diagnostic output"}`);
};
const psqlFile = (file, database) => run("psql", ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--file", resolve(file)], database);

let created = false;
let prisma;
let originalDatabaseUrl = connectionString;
try {
  run("createdb", ["--no-password", upgradeDatabase], "postgres");
  created = true;
  psqlFile("prisma/migrations/20261101000000_init/migration.sql", upgradeDatabase);
  psqlFile("prisma/migrations/20261101020000_unit_catalog_visibility/migration.sql", upgradeDatabase);

  process.env.DATABASE_URL = upgradeUrl.toString();
  prisma = new PrismaService();
  await prisma.$connect();
  const user = await prisma.user.create({ data: { phone: `09${String(Date.now()).slice(-9)}`, displayName: "Legacy migration fixture" } });
  const business = await prisma.business.create({
    data: {
      displayName: `Legacy sequence migration ${randomUUID()}`,
      businessType: "Migration test",
      branches: { create: [{ name: "Legacy branch A", code: "LEG-A" }, { name: "Legacy branch B", code: "LEG-B" }] },
    },
    include: { branches: { select: { id: true } } },
  });
  const [branchA, branchB] = business.branches;

  for (const [type, aValue, bValue] of [
    ["JOURNAL", 12n, 18n],
    ["SALE", 10n, 14n],
    ["RETURN", 4n, 12n],
    ["PURCHASE", 2n, 3n],
    ["EXPENSE", 3n, 5n],
  ]) {
    await prisma.$executeRaw`INSERT INTO "document_sequences" ("id", "business_id", "branch_id", "type", "next_value")
      VALUES (${randomUUID()}::uuid, ${business.id}::uuid, ${branchA.id}::uuid, ${type}, ${aValue}),
             (${randomUUID()}::uuid, ${business.id}::uuid, ${branchB.id}::uuid, ${type}, ${bValue})`;
  }

  const date = new Date("2026-11-01T00:00:00.000Z");
  await prisma.journalEntry.createMany({ data: [
    { businessId: business.id, branchId: branchA.id, entryNo: "D-000010", txnDate: date, sourceType: "LEGACY", sourceId: randomUUID(), postedBy: user.id },
    { businessId: business.id, branchId: branchB.id, entryNo: "D-000017", txnDate: date, sourceType: "LEGACY", sourceId: randomUUID(), postedBy: user.id },
  ] });
  await prisma.salesInvoice.createMany({ data: [
    { businessId: business.id, branchId: branchA.id, invoiceNo: "S-000012", txnDate: date, status: "POSTED", postedBy: user.id },
    { businessId: business.id, branchId: branchB.id, invoiceNo: "S-000015", txnDate: date, status: "POSTED", postedBy: user.id },
  ] });
  await prisma.purchase.createMany({ data: [
    { businessId: business.id, branchId: branchA.id, purchaseNo: "P-000021", txnDate: date, status: "POSTED", postedBy: user.id },
  ] });
  const expenseAccount = await prisma.ledgerAccount.create({ data: { businessId: business.id, code: "LEG-EXP", name: "Legacy expense", type: "EXPENSE" } });
  const expenseCategory = await prisma.expenseCategory.create({ data: { businessId: business.id, name: "Legacy category", expenseLedgerAccountId: expenseAccount.id } });
  const expenseIds = { existing: randomUUID(), firstMissing: randomUUID(), secondMissing: randomUUID(), draft: randomUUID() };
  await prisma.expense.createMany({ data: [
    { id: expenseIds.existing, businessId: business.id, branchId: branchA.id, categoryId: expenseCategory.id, expenseNo: "E-000009", txnDate: date, amountRial: 1n, status: "POSTED", createdBy: user.id, createdAt: new Date("2026-01-01T00:00:00.000Z") },
    { id: expenseIds.firstMissing, businessId: business.id, branchId: branchB.id, categoryId: expenseCategory.id, txnDate: date, amountRial: 1n, status: "POSTED", createdBy: user.id, createdAt: new Date("2026-01-02T00:00:00.000Z") },
    { id: expenseIds.secondMissing, businessId: business.id, branchId: branchA.id, categoryId: expenseCategory.id, txnDate: date, amountRial: 1n, status: "POSTED", createdBy: user.id, createdAt: new Date("2026-01-03T00:00:00.000Z") },
    { id: expenseIds.draft, businessId: business.id, branchId: branchB.id, categoryId: expenseCategory.id, txnDate: date, amountRial: 1n, status: "DRAFT", createdBy: user.id, createdAt: new Date("2026-01-04T00:00:00.000Z") },
  ] });
  await prisma.$disconnect();
  prisma = undefined;

  psqlFile("prisma/migrations/20261103010000_business_wide_document_sequences/migration.sql", upgradeDatabase);
  const migratedPrisma = new PrismaService();
  await migratedPrisma.$connect();
  try {
    const preserved = await migratedPrisma.documentSequence.findMany({ where: { businessId: business.id }, orderBy: { type: "asc" } });
    assert.deepEqual(preserved.map((row) => [row.type, row.nextValue.toString()]), [
      ["EXPENSE", "12"], ["JOURNAL", "18"], ["PURCHASE", "22"], ["RETURN", "12"], ["SALE", "16"],
    ]);
    const numbers = await migratedPrisma.expense.findMany({ where: { businessId: business.id }, select: { id: true, expenseNo: true, status: true } });
    const numberById = new Map(numbers.map((row) => [row.id, [row.expenseNo, row.status]]));
    assert.deepEqual(numberById.get(expenseIds.existing), ["E-000009", "POSTED"], "historical assigned expense number must not change");
    assert.deepEqual(numberById.get(expenseIds.firstMissing), ["E-000010", "POSTED"]);
    assert.deepEqual(numberById.get(expenseIds.secondMissing), ["E-000011", "POSTED"]);
    assert.deepEqual(numberById.get(expenseIds.draft), [null, "DRAFT"], "draft expenses remain unnumbered");
    assert.deepEqual((await migratedPrisma.salesInvoice.findMany({ where: { businessId: business.id }, orderBy: { invoiceNo: "asc" }, select: { invoiceNo: true } })).map((row) => row.invoiceNo), ["S-000012", "S-000015"]);
    assert.deepEqual((await migratedPrisma.purchase.findMany({ where: { businessId: business.id }, select: { purchaseNo: true } })).map((row) => row.purchaseNo), ["P-000021"]);

    const accounting = new AccountingService(migratedPrisma);
    const allocated = await migratedPrisma.$transaction(async (tx) => Promise.all([
      accounting.nextDocumentNumber(tx, { businessId: business.id, type: "JOURNAL", prefix: "D" }),
      accounting.nextDocumentNumber(tx, { businessId: business.id, type: "SALE", prefix: "S" }),
      accounting.nextDocumentNumber(tx, { businessId: business.id, type: "RETURN", prefix: "R" }),
      accounting.nextDocumentNumber(tx, { businessId: business.id, type: "PURCHASE", prefix: "P" }),
      accounting.nextDocumentNumber(tx, { businessId: business.id, type: "EXPENSE", prefix: "E" }),
    ]));
    assert.deepEqual(allocated, ["D-000018", "S-000016", "R-000012", "P-000022", "E-000012"]);
  } finally {
    await migratedPrisma.$disconnect();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
  console.log("PostgreSQL legacy migration passed: historical numbers were preserved, posted expenses without numbers were assigned deterministically, drafts stayed unnumbered, and all five business-wide counters resumed without collisions.");
} finally {
  if (prisma) await prisma.$disconnect().catch(() => undefined);
  process.env.DATABASE_URL = originalDatabaseUrl;
  if (created) run("dropdb", ["--if-exists", "--force", upgradeDatabase], "postgres");
}
