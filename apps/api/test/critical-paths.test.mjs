import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { pageLimit, cursorPage } from "../dist/common/cursor-pagination.js";
import { AccountingService } from "../dist/finance/accounting.service.js";
import { ProductsService } from "../dist/products/products.service.js";
import { ReportsService } from "../dist/reports/reports.service.js";
import { remainingInventoryValueRial, saleCogsRial } from "../dist/sales/sales.service.js";
import { FinanceService } from "../dist/finance/finance.service.js";
import { PartiesService } from "../dist/parties/parties.service.js";
import { BusinessesService } from "../dist/businesses/businesses.service.js";
import { SalesService } from "../dist/sales/sales.service.js";
import { InventoryService } from "../dist/inventory/inventory.service.js";

test("business-wide document numbering allocates unique sequential numbers across branches", async () => {
  let nextValue = 1n;
  const tx = {
    documentSequence: {
      async upsert(input) {
        assert.deepEqual(input.where, { businessId_type: { businessId: "business-a", type: "SALE" } });
        if (nextValue === 1n) nextValue = input.create.nextValue;
        else nextValue += input.update.nextValue.increment;
        return { nextValue };
      },
    },
  };
  const accounting = new AccountingService({});
  const numbers = await Promise.all(Array.from({ length: 20 }, () => accounting.nextDocumentNumber(tx, { businessId: "business-a", type: "SALE", prefix: "S" })));
  assert.equal(new Set(numbers).size, 20);
  assert.equal(numbers.includes("S-000001"), true);
  assert.equal(numbers.includes("S-000020"), true);
});

test("cashiers cannot mutate a product through the general product update route", async () => {
  const service = new ProductsService({});
  await assert.rejects(
    service.update({ id: "user-a", businessId: "business-a", role: "CASHIER" }, "product-a", { defaultCostRial: "1" }, { requestId: "test" }),
    (error) => error instanceof ForbiddenException,
  );
});

test("sale posting retries serialization conflicts within a bounded number of attempts", async () => {
  const service = new SalesService({});
  const conflict = Object.assign(new Error("serialization conflict"), { code: "P2034" });
  let attempts = 0;
  const result = await service.retrySerializationConflicts(async () => {
    attempts++;
    if (attempts < 3) throw conflict;
    return "posted";
  });
  assert.equal(result, "posted");
  assert.equal(attempts, 3);

  attempts = 0;
  await assert.rejects(service.retrySerializationConflicts(async () => {
    attempts++;
    throw conflict;
  }), (error) => error === conflict);
  assert.equal(attempts, 3, "the retry policy must not loop indefinitely");
});

test("a concurrent already-posted sale returns the saved idempotent response", async () => {
  const saved = { id: "invoice-id", status: "POSTED", invoiceNo: "S-000001" };
  let lookups = 0;
  const accounting = {
    idempotencyHash: () => "request-hash",
    existingIdempotent: async () => (++lookups === 1 ? null : saved),
  };
  const service = new SalesService({ $transaction: async () => { throw new ConflictException("already posted"); } }, accounting);
  const result = await service.post({ id: "user-id", businessId: "business-id", branchId: "branch-id", role: "OWNER" }, "invoice-id", {}, "post-key", { requestId: "test-request" });
  assert.deepEqual(result, saved);
  assert.equal(lookups, 2, "the conflict path must re-read the idempotency record");
});

test("selling the last stock units consumes the exact remaining inventory value", () => {
  const onHandMilli = 3000n;
  const quantitySoldMilli = 3000n;
  const inventoryValueRial = 100n;
  const averageCostRial = 33n;
  assert.equal(saleCogsRial(onHandMilli, quantitySoldMilli, inventoryValueRial, averageCostRial), 100n);
  assert.equal(remainingInventoryValueRial(onHandMilli, quantitySoldMilli, inventoryValueRial, 100n), 0n);
  assert.equal(saleCogsRial(3000n, 1000n, 100n, averageCostRial), 33n);
  assert.equal(remainingInventoryValueRial(3000n, 1000n, inventoryValueRial, 33n), 67n);
});

test("profit and loss aggregates journal lines in PostgreSQL before returning account totals", async () => {
  const groupBy = async (query) => {
    assert.deepEqual(query.by, ["ledgerAccountId"]);
    assert.equal(query.where.businessId, "business-a");
    assert.equal(query.where.branchId, "branch-a");
    assert.deepEqual(query.where.journalEntry.status.in, ["POSTED", "REVERSED"]);
    return [
      { ledgerAccountId: "revenue", _sum: { debitRial: 0n, creditRial: 150n } },
      { ledgerAccountId: "expense", _sum: { debitRial: 200n, creditRial: 0n } },
    ];
  };
  const service = new ReportsService({
    business: { findUnique: async () => ({ timezone: "Asia/Tehran" }) },
    journalLine: { groupBy, findMany: async () => assert.fail("unbounded journal line fetch is not allowed") },
    ledgerAccount: { findMany: async () => [
      { id: "revenue", name: "فروش", type: "REVENUE" },
      { id: "expense", name: "هزینه", type: "EXPENSE" },
    ] },
  });
  const result = await service.profitLoss({ businessId: "business-a", branchId: "branch-a", role: "OWNER" }, "2026-11-01", "2026-11-30");
  assert.equal(result.revenueRial, "150");
  assert.equal(result.expenseRial, "200");
  assert.equal(result.netProfitRial, "-50");
});

test("dashboard receipt totals exclude cash receipts linked to reversed journals", async () => {
  let receiptFilter;
  const prisma = {
    business: {
      findUnique: async () => ({ timezone: "Asia/Tehran" }),
      findUniqueOrThrow: async () => ({ displayCurrency: "IRT", inventoryEnabled: false }),
    },
    salesInvoice: {
      aggregate: async () => ({ _sum: { totalRial: 0n, subtotalRial: 0n, discountRial: 0n, taxRial: 0n }, _count: { id: 0 } }),
      findMany: async () => [],
      groupBy: async () => [],
      count: async () => 0,
    },
    expense: { aggregate: async () => ({ _sum: { amountRial: 0n, taxRial: 0n }, _count: { id: 0 } }) },
    cashTransaction: { aggregate: async (query) => { receiptFilter = query.where; return { _sum: { amountRial: 0n } }; } },
    financeAccount: { findMany: async () => [] },
    product: { findMany: async () => [] },
    salesInvoiceLine: { findMany: async () => [] },
    journalLine: { groupBy: async () => [] },
  };
  const service = new ReportsService(prisma);
  const result = await service.dashboard({ businessId: "business-a", branchId: "branch-a", role: "OWNER" }, "2026-11-01", "2026-11-30");
  assert.equal(receiptFilter.businessId, "business-a");
  assert.equal(receiptFilter.branchId, "branch-a");
  assert.equal(receiptFilter.journalEntry.status, "POSTED");
  assert.equal(result.receiptsRial, "0");
});

test("cash flow exposes gross receipts, gross payments and their net without hiding refunds", async () => {
  const service = new ReportsService({
    business: { findUnique: async () => ({ timezone: "Asia/Tehran" }) },
    cashTransaction: { groupBy: async (query) => {
      assert.equal(query.where.businessId, "business-a");
      assert.equal(query.where.branchId, "branch-a");
      return [
        { kind: "RECEIPT", _sum: { amountRial: 1000n } },
        { kind: "PAYMENT", _sum: { amountRial: 1000n } },
      ];
    } },
  });
  const result = await service.cashFlow({ businessId: "business-a", branchId: "branch-a", role: "OWNER" }, "2026-11-01", "2026-11-30");
  assert.equal(result.grossReceiptsRial, "1000");
  assert.equal(result.grossPaymentsRial, "1000");
  assert.equal(result.netCashFlowRial, "0");
});

test("party balances aggregate and paginate only in the active tenant and branch", async () => {
  let statement;
  const service = new ReportsService({ $queryRaw: async (query) => {
    statement = query;
    return [{ id: "10000000-0000-4000-8000-000000000001", name: "مشتری الف", phone: null, normalizedName: "مشتری الف", balanceRial: "100" }];
  } });
  const result = await service.partyBalances({ businessId: "20000000-0000-4000-8000-000000000001", branchId: "30000000-0000-4000-8000-000000000001", role: "OWNER" }, "receivable");
  assert.deepEqual(result.items.map(({ id, balanceRial }) => ({ id, balanceRial })), [{ id: "10000000-0000-4000-8000-000000000001", balanceRial: "100" }]);
  assert.equal(result.hasMore, false);
  assert.ok(statement.values.includes("20000000-0000-4000-8000-000000000001"));
  assert.ok(statement.values.includes("30000000-0000-4000-8000-000000000001"));
  assert.ok(statement.values.includes("accounts_receivable"));
  assert.match(statement.strings.join("?"), /GROUP BY p\.id[\s\S]*HAVING CASE[\s\S]*LIMIT/);
});

test("party statement pages preserve same-day cursor order and authoritative total balance", async () => {
  const date = new Date("2026-11-02T00:00:00.000Z");
  const calls = [];
  const service = new PartiesService({
    party: { findFirst: async () => ({ id: "party-a", name: "مشتری", type: "CUSTOMER", phone: null, email: null, address: null }) },
    journalLine: {
      findFirst: async () => ({ id: "00000000-0000-4000-8000-000000000010", journalEntry: { txnDate: date } }),
      findMany: async (query) => {
        calls.push(query);
        return [
          { id: "line-2", description: "دوم", debitRial: 70n, creditRial: 0n, journalEntry: { id: "journal-2", entryNo: "D-2", txnDate: date, memo: null, sourceType: "SALE" } },
          { id: "line-3", description: "سوم", debitRial: 0n, creditRial: 20n, journalEntry: { id: "journal-3", entryNo: "D-3", txnDate: date, memo: null, sourceType: "PAYMENT" } },
        ];
      },
      aggregate: async (query) => query.where.OR
        ? { _sum: { debitRial: 500n, creditRial: 0n } }
        : { _sum: { debitRial: 900n, creditRial: 0n } },
    },
  });
  const result = await service.statement({ businessId: "business-a" }, "party-a", undefined, "00000000-0000-4000-8000-000000000010", 1);
  assert.equal(calls[0].take, 2);
  assert.equal(calls[0].skip, 1);
  assert.equal(calls[0].orderBy[0].journalEntry.txnDate, "asc");
  assert.equal(result.entries[0].balanceRial, "570");
  assert.equal(result.openingBalanceRial, "500");
  assert.equal(result.balanceRial, "900");
  assert.equal(result.hasMore, true);
  assert.equal(result.nextCursor, "line-2");
});

test("receivable balances are keyset-paginated by normalized name and UUID within the selected branch", async () => {
  const ids = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002", "10000000-0000-4000-8000-000000000003"];
  const sqlCalls = [];
  const cursorScopes = [];
  const prisma = {
    party: { findFirst: async ({ where }) => { cursorScopes.push(where); return where.id === ids[1] && where.businessId === "20000000-0000-4000-8000-000000000001" ? { id: where.id } : null; } },
    $queryRaw: async (query) => {
      sqlCalls.push(query);
      return sqlCalls.length === 1
        ? [
          { id: ids[0], name: "مشتری", phone: null, normalizedName: "same-name", balanceRial: "100" },
          { id: ids[1], name: "مشتری", phone: null, normalizedName: "same-name", balanceRial: "200" },
          { id: ids[2], name: "مشتری", phone: null, normalizedName: "same-name", balanceRial: "300" },
        ]
        : [{ id: ids[2], name: "مشتری", phone: null, normalizedName: "same-name", balanceRial: "300" }];
    },
  };
  const service = new ReportsService(prisma);
  const user = { businessId: "20000000-0000-4000-8000-000000000001", branchId: "30000000-0000-4000-8000-000000000001", role: "OWNER" };
  const first = await service.partyBalances(user, "receivable", undefined, "2");
  assert.equal(first.items.length, 2);
  assert.equal(first.hasMore, true);
  assert.equal(first.items[0].balanceRial, "100");
  assert.equal("normalizedName" in first.items[0], false);
  assert.ok(first.nextCursor);
  const second = await service.partyBalances(user, "receivable", first.nextCursor, "2");
  assert.deepEqual(second.items.map(({ id, balanceRial }) => ({ id, balanceRial })), [{ id: ids[2], balanceRial: "300" }]);
  assert.equal(second.nextCursor, null);
  assert.equal(second.hasMore, false);
  assert.deepEqual(cursorScopes[0], { id: ids[1], businessId: user.businessId, normalizedName: "same-name", archivedAt: null });
  assert.equal(sqlCalls.length, 2);
  assert.ok(sqlCalls[0].values.includes(user.businessId));
  assert.ok(sqlCalls[0].values.includes(user.branchId));
  assert.ok(sqlCalls[0].values.includes("accounts_receivable"));
  assert.match(sqlCalls[0].strings.join("?"), /ORDER BY p\.normalized_name ASC, p\.id ASC[\s\S]*LIMIT/);
});

test("receivable cursor cannot cross business scope or accept malformed values", async () => {
  let queried = false;
  const prisma = { party: { findFirst: async () => null }, $queryRaw: async () => { queried = true; return []; } };
  const service = new ReportsService(prisma);
  const user = { businessId: "20000000-0000-4000-8000-000000000001", branchId: "30000000-0000-4000-8000-000000000001", role: "OWNER" };
  await assert.rejects(service.partyBalances(user, "payable", "not-a-cursor"), /نشانگر صفحه/);
  const crafted = Buffer.from(JSON.stringify({ normalizedName: "نام", id: "10000000-0000-4000-8000-000000000099" }), "utf8").toString("base64url");
  await assert.rejects(service.partyBalances(user, "payable", crafted), /نشانگر صفحه/);
  assert.equal(queried, false);
});

test("closing an accounting period rejects draft inventory counts", async () => {
  const tx = {
    closedPeriod: {
      findFirst: async () => null,
      create: async () => assert.fail("period must not close while a count draft exists"),
    },
    salesInvoice: { count: async () => 0 },
    purchase: { count: async () => 0 },
    expense: { count: async () => 0 },
    stockCount: { count: async () => 1 },
  };
  const service = new FinanceService({ $transaction: (operation) => operation(tx) }, {});
  await assert.rejects(
    service.closePeriod({ id: "owner-a", businessId: "business-a", branchId: "branch-a", role: "OWNER" }, { startDate: "2026-11-01", endDate: "2026-11-30", reason: "بستن ماه" }, { requestId: "test" }),
    /پیش‌نویس‌های فروش، خرید، هزینه یا شمارش موجودی/,
  );
});

test("finance transaction pagination is tenant and branch scoped with a stable cursor", async () => {
  let pageQuery;
  const prisma = {
    cashTransaction: {
      findFirst: async ({ where }) => {
        assert.deepEqual(where, { businessId: "business-a", branchId: "branch-a", id: "00000000-0000-4000-8000-000000000011" });
        return { id: "00000000-0000-4000-8000-000000000011" };
      },
      findMany: async (query) => {
        pageQuery = query;
        return ["one", "two", "three"].map((id) => ({
          id,
          kind: "RECEIPT",
          txnDate: new Date("2026-11-02T00:00:00.000Z"),
          amountRial: 100n,
          fromAccount: null,
          toAccount: { name: "صندوق" },
          party: null,
          method: "CASH",
          reference: null,
          status: "POSTED",
          journalEntry: { status: "POSTED", sourceType: "CASH_TX" },
        }));
      },
    },
  };
  const service = new FinanceService(prisma, {});
  const result = await service.transactions({ businessId: "business-a", branchId: "branch-a", role: "OWNER" }, "00000000-0000-4000-8000-000000000011", "2");
  assert.deepEqual(pageQuery.where, { businessId: "business-a", branchId: "branch-a" });
  assert.deepEqual(pageQuery.cursor, { id: "00000000-0000-4000-8000-000000000011" });
  assert.equal(pageQuery.skip, 1);
  assert.deepEqual(pageQuery.orderBy, [{ txnDate: "desc" }, { createdAt: "desc" }, { id: "desc" }]);
  assert.equal(pageQuery.take, 3);
  assert.deepEqual(result.items.map((row) => row.id), ["one", "two"]);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextCursor, "two");
});

test("ledger browser pages journal lines within one business and branch and returns filtered totals", async () => {
  let pageQuery;
  let cursorScope;
  let aggregateScope;
  const date = new Date("2026-11-02T00:00:00.000Z");
  const line = (id, entryNo, debitRial, creditRial) => ({ id, journalEntry: { entryNo, txnDate: date, memo: "فروش نقدی", sourceType: "SALE", status: "POSTED" }, ledgerAccount: { code: "4100", name: "فروش", type: "REVENUE" }, party: { name: "مشتری" }, description: "درآمد فروش", debitRial: BigInt(debitRial), creditRial: BigInt(creditRial) });
  const service = new FinanceService({
    journalLine: {
      findFirst: async ({ where }) => { cursorScope = where; return { id: "00000000-0000-4000-8000-000000000012" }; },
      findMany: async (query) => { pageQuery = query; return [line("line-b", "J-2", 0, 100), line("line-a", "J-1", 0, 50)]; },
      aggregate: async ({ where }) => { aggregateScope = where; return { _sum: { debitRial: 250n, creditRial: 350n } }; },
    },
  }, {});
  const result = await service.ledger({ businessId: "business-a", branchId: "branch-a", role: "VIEWER" }, { from: "2026-11-01", to: "2026-11-30", accountId: "00000000-0000-4000-8000-000000000001", partyId: "00000000-0000-4000-8000-000000000002", cursor: "00000000-0000-4000-8000-000000000012", limit: "1" });
  assert.deepEqual(cursorScope, { businessId: "business-a", branchId: "branch-a", ledgerAccountId: "00000000-0000-4000-8000-000000000001", partyId: "00000000-0000-4000-8000-000000000002", journalEntry: { businessId: "business-a", branchId: "branch-a", status: { in: ["POSTED", "REVERSED"] }, txnDate: { gte: new Date("2026-11-01T00:00:00.000Z"), lte: new Date("2026-11-30T00:00:00.000Z") } }, id: "00000000-0000-4000-8000-000000000012" });
  assert.equal(pageQuery.cursor.id, "00000000-0000-4000-8000-000000000012");
  assert.equal(pageQuery.skip, 1);
  assert.equal(pageQuery.take, 2);
  assert.equal(pageQuery.where.businessId, "business-a");
  assert.equal(pageQuery.where.branchId, "branch-a");
  assert.equal(aggregateScope.businessId, "business-a");
  assert.equal(aggregateScope.branchId, "branch-a");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].creditRial, "100");
  assert.equal(result.nextCursor, "line-b");
  assert.equal(result.totalDebitRial, "250");
  assert.equal(result.totalCreditRial, "350");
});

test("ledger browser rejects reversed date ranges and cursors outside the current scope", async () => {
  const service = new FinanceService({ journalLine: { findFirst: async () => null, findMany: async () => assert.fail("invalid cursor must not fetch rows"), aggregate: async () => assert.fail("invalid cursor must not aggregate") } }, {});
  await assert.rejects(service.ledger({ businessId: "business-a", branchId: "branch-a" }, { from: "2026-11-02", to: "2026-11-01" }), BadRequestException);
  await assert.rejects(service.ledger({ businessId: "business-b", branchId: "branch-b" }, { cursor: "00000000-0000-4000-8000-000000000013", limit: "50" }), BadRequestException);
});

test("member phone numbers are masked for non-owner business members", async () => {
  const service = new BusinessesService({ businessMember: { findMany: async () => [
    { id: "member-a", role: "CASHIER", status: "ACTIVE", user: { id: "user-a", phone: "09123456789", displayName: "عضو" }, branches: [] },
    { id: "member-b", role: "OWNER", status: "ACTIVE", user: { id: "user-b", phone: "09361234567", displayName: "مالک" }, branches: [] },
  ] } });
  const rows = await service.members({ id: "user-cashier", businessId: "business-a", role: "CASHIER" });
  assert.equal(rows[0].user.phone, "091•••••789");
  assert.equal(rows[1].user.phone, "093•••••567");
});

test("business owners update member role, branches and status with an atomic audit event", async () => {
  const before = { role: "CASHIER", status: "ACTIVE", branchIds: ["branch-old"] };
  let membershipUpdate;
  let deletedBranches;
  let createdBranches;
  let audit;
  const tx = {
    businessMember: {
      findFirst: async (query) => {
        assert.deepEqual(query.where, { id: "member-a", businessId: "business-a" });
        return { id: "member-a", userId: "user-a", role: before.role, status: before.status, user: { id: "user-a", phone: "09123456789" }, branches: [{ branchId: "branch-old" }] };
      },
      update: async ({ where, data }) => { membershipUpdate = { where, data }; return { id: "member-a", role: data.role, status: data.status }; },
    },
    branch: { findMany: async (query) => {
      assert.deepEqual(query.where, { id: { in: ["branch-new"] }, businessId: "business-a", isActive: true });
      return [{ id: "branch-new" }];
    } },
    memberBranch: {
      deleteMany: async (query) => { deletedBranches = query.where; return { count: 1 }; },
      createMany: async (query) => { createdBranches = query.data; return { count: query.data.length }; },
    },
    auditEvent: { create: async ({ data }) => { audit = data; return data; } },
  };
  const service = new BusinessesService({ $transaction: async (operation, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    return operation(tx);
  } });

  const result = await service.updateMember(
    { id: "owner-a", businessId: "business-a", role: "OWNER" },
    "member-a",
    { role: "MANAGER", status: "SUSPENDED", branchIds: ["branch-new"] },
    { requestId: "request-a" },
  );

  assert.deepEqual(result, { id: "member-a", userId: "user-a", phone: "09123456789", role: "MANAGER", status: "SUSPENDED", branchIds: ["branch-new"] });
  assert.deepEqual(membershipUpdate, { where: { id: "member-a" }, data: { role: "MANAGER", status: "SUSPENDED" } });
  assert.deepEqual(deletedBranches, { businessId: "business-a", memberId: "member-a" });
  assert.deepEqual(createdBranches, [{ businessId: "business-a", memberId: "member-a", branchId: "branch-new" }]);
  assert.equal(audit.action, "member.suspended");
  assert.equal(audit.requestId, "request-a");
  assert.deepEqual(audit.beforeJson, before);
  assert.deepEqual(audit.afterJson, { role: "MANAGER", status: "SUSPENDED", branchIds: ["branch-new"] });
});

test("only a business owner can change member access or read member history", async () => {
  let transactionStarted = false;
  const service = new BusinessesService({ $transaction: async () => { transactionStarted = true; } });
  const user = { id: "manager-a", businessId: "business-a", role: "MANAGER" };
  await assert.rejects(service.updateMember(user, "member-a", { status: "SUSPENDED" }, {}), (error) => error instanceof ForbiddenException);
  await assert.rejects(service.memberHistory(user, "member-a"), (error) => error instanceof ForbiddenException);
  assert.equal(transactionStarted, false);
});

test("active members cannot be left without an assigned business branch", async () => {
  const service = new BusinessesService({ $transaction: async (operation) => operation({
    businessMember: { findFirst: async () => ({ id: "member-a", userId: "user-a", role: "CASHIER", status: "SUSPENDED", user: { id: "user-a", phone: "09123456789" }, branches: [] }) },
  }) });
  await assert.rejects(
    service.updateMember({ id: "owner-a", businessId: "business-a", role: "OWNER" }, "member-a", { status: "ACTIVE" }, {}),
    (error) => error instanceof BadRequestException,
  );
});

test("member history is scoped to the active business and returns only the latest 100 access events", async () => {
  let query;
  const occurredAt = new Date("2026-11-03T08:00:00.000Z");
  const service = new BusinessesService({
    businessMember: { findFirst: async (input) => { assert.deepEqual(input.where, { id: "member-a", businessId: "business-a" }); return { id: "member-a" }; } },
    auditEvent: { findMany: async (input) => {
      query = input;
      return [{ action: "member.assigned", occurredAt, beforeJson: null, afterJson: { role: "CASHIER", status: "ACTIVE", branchIds: ["branch-a"] }, actor: { displayName: "مالک" } }];
    } },
  });
  const rows = await service.memberHistory({ id: "owner-a", businessId: "business-a", role: "OWNER" }, "member-a");
  assert.deepEqual(query.where, { businessId: "business-a", entityType: "business_member", entityId: "member-a", action: { startsWith: "member." } });
  assert.equal(query.take, 100);
  assert.deepEqual(rows, [{ action: "member.assigned", occurredAt: occurredAt.toISOString(), actorName: "مالک", before: null, after: { role: "CASHIER", status: "ACTIVE", branchIds: ["branch-a"] } }]);
});

test("business audit pages are owner-only, tenant-scoped and expose no before/after payloads", async () => {
  let pageQuery;
  const prisma = {
    auditEvent: {
      findFirst: async ({ where }) => {
        assert.equal(where.businessId, "business-a");
        assert.equal(where.action.contains, "member");
        assert.equal(where.id, "00000000-0000-4000-8000-000000000001");
        return { id: "00000000-0000-4000-8000-000000000001" };
      },
      findMany: async (query) => {
        pageQuery = query;
        return ["event-1", "event-2", "event-3"].map((id) => ({ id, action: "member.suspended", entityType: "business_member", entityId: "member-id", occurredAt: new Date("2026-11-03T00:00:00.000Z"), actor: { id: "actor-id", displayName: "مالک" } }));
      },
    },
  };
  const service = new BusinessesService(prisma);
  const result = await service.auditEvents({ id: "owner-id", businessId: "business-a", role: "OWNER" }, { action: "member", cursor: "00000000-0000-4000-8000-000000000001", limit: "2" });
  assert.equal(pageQuery.where.businessId, "business-a");
  assert.deepEqual(pageQuery.cursor, { id: "00000000-0000-4000-8000-000000000001" });
  assert.equal(pageQuery.skip, 1);
  assert.deepEqual(pageQuery.orderBy, [{ occurredAt: "desc" }, { id: "desc" }]);
  assert.equal("beforeJson" in pageQuery.select, false);
  assert.deepEqual(result.items.map((row) => row.id), ["event-1", "event-2"]);
  assert.equal(result.nextCursor, "event-2");
  assert.equal("before" in result.items[0], false);
  await assert.rejects(service.auditEvents({ id: "manager-id", businessId: "business-a", role: "MANAGER" }, {}), ForbiddenException);
});

test("cursor pagination clamps page size and returns a stable continuation cursor", () => {
  assert.equal(pageLimit(undefined), 50);
  assert.equal(pageLimit("500"), 100);
  assert.throws(() => pageLimit("0"), (error) => error instanceof BadRequestException);
  const page = cursorPage([{ id: "one" }, { id: "two" }, { id: "three" }], 2, (row) => row.id);
  assert.deepEqual(page, { items: [{ id: "one" }, { id: "two" }], nextCursor: "two", hasMore: true });
});

test("product list pages stay tenant-scoped and do not skip records with identical sort keys", async () => {
  let listQuery;
  const product = (id) => ({ id, sku: null, barcode: null, category: null, defaultCostRial: null, reorderPoint: null, trackInventory: true, balances: [], images: [], catalogItem: { name: "کالای هم‌نام", normalizedName: "کالای هم‌نام", kind: "STOCK", unit: { id: "unit-a", code: "pcs", labelFa: "عدد", precision: 0 }, salePriceRial: 100n, taxRateBasisPoints: 0 } });
  const service = new ProductsService({
    product: {
      findFirst: async (query) => { assert.deepEqual(query.where, { businessId: "business-a", catalogItem: { isActive: true }, id: "00000000-0000-4000-8000-000000000014" }); return { id: "00000000-0000-4000-8000-000000000014" }; },
      findMany: async (query) => { listQuery = query; return [product("item-1"), product("item-2"), product("item-3")]; },
    },
  });
  const page = await service.list({ businessId: "business-a", branchId: "branch-a" }, undefined, undefined, "00000000-0000-4000-8000-000000000014", "2");
  assert.equal(listQuery.where.businessId, "business-a");
  assert.deepEqual(listQuery.cursor, { id: "00000000-0000-4000-8000-000000000014" });
  assert.equal(listQuery.skip, 1);
  assert.deepEqual(listQuery.orderBy, [{ catalogItem: { normalizedName: "asc" } }, { id: "asc" }]);
  assert.equal(listQuery.take, 3);
  assert.deepEqual({ itemIds: page.items.map(({ id }) => id), nextCursor: page.nextCursor, hasMore: page.hasMore }, { itemIds: ["item-1", "item-2"], nextCursor: "item-2", hasMore: true });
});

test("invoice list pagination scopes cursor checks and rows to the active business and branch", async () => {
  let listQuery;
  const invoice = (id) => ({ id, invoiceNo: id, txnDate: new Date("2026-11-03T00:00:00.000Z"), customer: null, subtotalRial: 10n, discountRial: 0n, taxRial: 0n, totalRial: 10n, status: "POSTED", returnOfId: null, returnReason: null });
  const service = new SalesService({
    salesInvoice: {
      findFirst: async ({ where }) => { assert.equal(where.businessId, "business-a"); assert.equal(where.branchId, "branch-a"); assert.equal(where.id, "00000000-0000-4000-8000-000000000015"); return { id: "00000000-0000-4000-8000-000000000015" }; },
      findMany: async (query) => { listQuery = query; return [invoice("invoice-1"), invoice("invoice-2"), invoice("invoice-3")]; },
    },
  }, {});
  const page = await service.list({ businessId: "business-a", branchId: "branch-a" }, "", "POSTED", "00000000-0000-4000-8000-000000000015", "2");
  assert.equal(listQuery.where.businessId, "business-a");
  assert.equal(listQuery.where.branchId, "branch-a");
  assert.deepEqual(listQuery.cursor, { id: "00000000-0000-4000-8000-000000000015" });
  assert.deepEqual(listQuery.orderBy, [{ txnDate: "desc" }, { createdAt: "desc" }, { id: "desc" }]);
  assert.deepEqual(page.items.map(({ id }) => id), ["invoice-1", "invoice-2"]);
  assert.equal(page.nextCursor, "invoice-2");
});

test("inventory cursor cannot be reused across a different business or branch", async () => {
  let rowsQuery;
  const service = new InventoryService({
    product: {
      findFirst: async ({ where }) => { assert.deepEqual(where, { businessId: "business-a", branchId: "branch-a", catalogItem: { is: { isActive: true } }, trackInventory: true, id: "00000000-0000-4000-8000-000000000016" }); return { id: "00000000-0000-4000-8000-000000000016" }; },
      findMany: async (query) => { rowsQuery = query; return []; },
    },
  }, {});
  await service.levels({ businessId: "business-a", branchId: "branch-a" }, "00000000-0000-4000-8000-000000000016", "25");
  assert.equal(rowsQuery.where.businessId, "business-a");
  assert.equal(rowsQuery.include.balances.where.branchId, "branch-a");
  assert.deepEqual(rowsQuery.cursor, { id: "00000000-0000-4000-8000-000000000016" });
  assert.equal(rowsQuery.take, 26);
});

test("product creation propagates audit failure from the same transaction", async () => {
  let transactionStarted = false;
  let productCreatedInTransaction = false;
  const service = new ProductsService({
    unit: { findFirst: async () => ({ id: "unit-a" }) },
    $transaction: async (operation) => {
      transactionStarted = true;
      return operation({
        catalogItem: { create: async () => ({ id: "product-a", businessId: "business-a", name: "کالا", kind: "STOCK", salePriceRial: 100n, taxRateBasisPoints: 0 }) },
        product: { create: async () => { productCreatedInTransaction = true; return { id: "product-a", sku: null, barcode: null, defaultCostRial: null, trackInventory: true }; } },
        auditEvent: { create: async () => { throw new Error("synthetic audit insert failure"); } },
      });
    },
  });
  await assert.rejects(
    service.create({ id: "owner-a", businessId: "business-a", branchId: "branch-a", role: "OWNER" }, { name: "کالا", unitId: "unit-a", kind: "STOCK", salePriceRial: "100" }, { requestId: "test" }),
    /synthetic audit insert failure/,
  );
  assert.equal(transactionStarted, true);
  assert.equal(productCreatedInTransaction, true);
});
