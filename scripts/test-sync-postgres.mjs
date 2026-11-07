import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AccountingService } from "../apps/api/dist/finance/accounting.service.js";
import { PrismaService } from "../apps/api/dist/prisma/prisma.service.js";
import { SalesService } from "../apps/api/dist/sales/sales.service.js";
import { SyncService } from "../apps/api/dist/sync/sync.service.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL must target an isolated test database.");
const databaseUrl = new URL(connectionString);
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
if (!["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname.replace(/^\[|\]$/g, "")) || !/test/i.test(databaseName)) {
  throw new Error(`Refusing sync integration outside loopback test database (host=${databaseUrl.hostname}, database=${databaseName}).`);
}

const prisma = new PrismaService();
let businessId;
let userIds = [];
try {
  await prisma.$connect();
  const [user, otherUser] = await Promise.all([
    prisma.user.create({ data: { phone: `09${Date.now().toString().slice(-9)}1`, displayName: "Sync integration" } }),
    prisma.user.create({ data: { phone: `09${Date.now().toString().slice(-9)}2`, displayName: "Sync isolation" } }),
  ]);
  userIds = [user.id, otherUser.id];
  const business = await prisma.business.create({
    data: {
      displayName: `Sync integration ${randomUUID()}`,
      businessType: "Automated test",
      branches: { create: [{ name: "Sync branch A", code: "SYNC-A" }, { name: "Sync branch B", code: "SYNC-B" }] },
    },
    include: { branches: { select: { id: true } } },
  });
  businessId = business.id;
  const [branchA, branchB] = business.branches;
  const [unit, customerParty] = await Promise.all([
    prisma.unit.create({ data: { businessId, code: "pcs", labelFa: "عدد", precision: 0, groupKey: "count", isVisible: true } }),
    prisma.party.create({ data: { businessId, name: "Sync customer", normalizedName: "sync customer" } }),
  ]);
  const customer = await prisma.customer.create({ data: { id: customerParty.id, businessId } });
  const catalogItem = await prisma.catalogItem.create({ data: { businessId, name: "Sync service", normalizedName: "sync service", unitId: unit.id, kind: "SERVICE", salePriceRial: 25_000n } });
  const service = await prisma.service.create({ data: { id: catalogItem.id, businessId } });
  await Promise.all([
    prisma.ledgerAccount.create({ data: { businessId, code: "SYNC-AR", name: "Sync receivable", type: "ASSET", systemKey: "accounts_receivable" } }),
    prisma.ledgerAccount.create({ data: { businessId, code: "SYNC-REV", name: "Sync revenue", type: "REVENUE", systemKey: "sales_revenue" } }),
  ]);

  const accounting = new AccountingService(prisma);
  const sales = new SalesService(prisma, accounting);
  const sync = new SyncService(prisma, sales);
  const userA = { id: user.id, businessId, branchId: branchA.id, role: "OWNER" };
  const request = { requestId: randomUUID() };
  const dto = {
    deviceId: randomUUID(),
    clientOperationId: randomUUID(),
    operationType: "SALE_CREATE_AND_POST",
    sale: { customerId: customer.id, txnDate: "2026-11-04", lines: [{ productId: service.id, quantity: "1" }] },
  };

  const concurrentResults = await Promise.all([
    sync.submitSale(userA, dto, request),
    sync.submitSale(userA, dto, request),
  ]);
  assert.ok(concurrentResults.every((result) => ["PROCESSING", "SUCCEEDED"].includes(result.status)));
  const replay = await sync.submitSale(userA, dto, request);
  assert.equal(replay.status, "SUCCEEDED");
  assert.ok(replay.serverEntityId);
  assert.ok(replay.serverInvoiceNo);

  const [operationCount, invoices, journals, record] = await Promise.all([
    prisma.syncRecord.count({ where: { businessId, clientOperationId: dto.clientOperationId } }),
    prisma.salesInvoice.count({ where: { businessId, branchId: branchA.id } }),
    prisma.journalEntry.count({ where: { businessId, branchId: branchA.id, sourceType: "SALE", sourceId: replay.serverEntityId } }),
    prisma.syncRecord.findUnique({ where: { businessId_deviceId_clientOperationId: { businessId, deviceId: dto.deviceId, clientOperationId: dto.clientOperationId } } }),
  ]);
  assert.equal(operationCount, 1, "one server record must represent the client operation");
  assert.equal(invoices, 1, "concurrent operation delivery must post only one invoice");
  assert.equal(journals, 1, "concurrent operation delivery must create only one journal");
  assert.equal(record?.status, "SUCCEEDED");
  assert.equal(record?.userId, user.id);
  assert.equal(record?.branchId, branchA.id);

  await assert.rejects(sync.submitSale({ ...userA, branchId: branchB.id }, dto, request), (error) => error.getStatus?.() === 409);
  await assert.rejects(sync.submitSale({ ...userA, id: otherUser.id }, dto, request), (error) => error.getStatus?.() === 409);
  await assert.rejects(sync.submitSale(userA, { ...dto, sale: { ...dto.sale, note: "changed payload" } }, request), (error) => error.getStatus?.() === 409);

  const ownerStatus = await sync.status(userA);
  const otherBranchStatus = await sync.status({ ...userA, branchId: branchB.id });
  const otherUserStatus = await sync.status({ ...userA, id: otherUser.id });
  assert.equal(ownerStatus.items.length, 1);
  assert.equal(ownerStatus.items[0].serverInvoiceNo, replay.serverInvoiceNo);
  assert.equal(otherBranchStatus.items.length, 0, "sync status must not expose another branch's rows");
  assert.equal(otherUserStatus.items.length, 0, "sync status must not expose another user's rows");
  console.log("PostgreSQL sync integration passed: migration-backed operation claims, concurrent duplicate delivery, invoice/journal idempotency, immutable payload binding and user/branch status isolation.");
} finally {
  try { if (businessId) await prisma.business.delete({ where: { id: businessId } }); }
  finally {
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
}
