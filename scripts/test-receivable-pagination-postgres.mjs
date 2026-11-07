import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma } from "../apps/api/dist/generated/prisma/client.js";
import { PartiesService } from "../apps/api/dist/parties/parties.service.js";
import { buildPartyBalanceQuery, ReportsService } from "../apps/api/dist/reports/reports.service.js";
import { PrismaService } from "../apps/api/dist/prisma/prisma.service.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL must target an isolated test database.");
const databaseUrl = new URL(connectionString);
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
if (!["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname.replace(/^\[|\]$/g, "")) || !/test/i.test(databaseName)) {
  throw new Error(`Refusing integration test outside loopback test database (host=${databaseUrl.hostname}, database=${databaseName}).`);
}

const prisma = new PrismaService();
let businessId;
try {
  await prisma.$connect();
  const business = await prisma.business.create({
    data: {
      displayName: `Receivable pagination test ${Date.now()}`,
      businessType: "Automated test",
      branches: { create: [
        { name: "صفر", code: "BAL-0" },
        { name: "یک", code: "BAL-1" },
        { name: "۴۹۹", code: "BAL-499" },
        { name: "۵۰۰", code: "BAL-500" },
        { name: "۵۰۱", code: "BAL-501" },
        { name: "ده‌هزار", code: "BAL-10000" },
        { name: "کلیدهای هم‌نام", code: "BAL-TIE" },
        { name: "مبدأ جداسازی شعبه", code: "BAL-SOURCE" },
        { name: "جداسازی شعبه", code: "BAL-SCOPE" },
        { name: "گردش‌های صورت‌حساب", code: "BAL-STATEMENT" },
      ] },
    },
    include: { branches: { select: { id: true, code: true } } },
  });
  businessId = business.id;
  const branchIdByCode = new Map(business.branches.map(({ id, code }) => [code, id]));
  const accounts = [
    { code: "1100", name: "دریافتنی آزمایش", type: "ASSET", systemKey: "accounts_receivable" },
    { code: "2100", name: "پرداختنی آزمایش", type: "LIABILITY", systemKey: "accounts_payable" },
    { code: "4100", name: "درآمد آزمایش", type: "REVENUE", systemKey: null },
    { code: "5100", name: "هزینه آزمایش", type: "EXPENSE", systemKey: null },
  ];
  await prisma.ledgerAccount.createMany({ data: accounts.map((account) => ({ ...account, businessId })) });
  const ledgerAccounts = await prisma.ledgerAccount.findMany({ where: { businessId }, select: { id: true, systemKey: true } });
  const accountId = new Map(ledgerAccounts.map((account) => [account.systemKey ?? "counterpart", account.id]));

  const partySpecs = [];
  const entrySpecs = [];
  const lineSpecs = [];
  const appendEntry = ({ branchId, partyId, accountId: partyAccountId, partySide, amountRial, entryNo, status = "POSTED" }) => {
    const entryId = randomUUID();
    entrySpecs.push({
      id: entryId, businessId, branchId, entryNo, txnDate: new Date("2026-11-01T00:00:00.000Z"),
      sourceType: "TEST", sourceId: randomUUID(), memo: "synthetic pagination fixture", status, postedBy: randomUUID(),
    });
    lineSpecs.push(
      { businessId, journalEntryId: entryId, ledgerAccountId: partyAccountId, partyId, branchId, debitRial: partySide === "debit" ? amountRial : 0n, creditRial: partySide === "credit" ? amountRial : 0n },
      { businessId, journalEntryId: entryId, ledgerAccountId: accountId.get("counterpart"), partyId: null, branchId, debitRial: partySide === "credit" ? amountRial : 0n, creditRial: partySide === "debit" ? amountRial : 0n },
    );
    return entryId;
  };

  const reportSizes = [["BAL-1", 1], ["BAL-499", 499], ["BAL-500", 500], ["BAL-501", 501], ["BAL-10000", 10_000]];
  const statementSizes = [0, 1, 499, 500, 501, 10_000];
  const statementPartyIds = new Map();
  let sequence = 0;
  for (const [branchCode, count] of reportSizes) {
    for (let index = 1; index <= count; index++) {
      sequence++;
      const id = randomUUID();
      const sortKey = `balance-${String(index).padStart(5, "0")}-${branchCode.toLowerCase()}`;
      partySpecs.push({ id, role: "CUSTOMER", businessId, name: `مشتری ${sortKey}`, normalizedName: sortKey });
      appendEntry({ branchId: branchIdByCode.get(branchCode), partyId: id, accountId: accountId.get("accounts_receivable"), partySide: "debit", amountRial: BigInt((index % 97) + 1), entryNo: `R-${String(sequence).padStart(8, "0")}` });
    }
  }
  for (const count of statementSizes) {
    const id = randomUUID();
    statementPartyIds.set(count, id);
    partySpecs.push({ id, role: "CUSTOMER", businessId, name: `گردش ${count}`, normalizedName: `statement-${count}` });
    for (let index = 0; index < count; index++) {
      appendEntry({ branchId: branchIdByCode.get("BAL-STATEMENT"), partyId: id, accountId: accountId.get("accounts_receivable"), partySide: "debit", amountRial: 100n, entryNo: `T-${String(++sequence).padStart(8, "0")}` });
    }
  }

  const isolationPartyId = randomUUID();
  partySpecs.push({ id: isolationPartyId, role: "CUSTOMER", businessId, name: "طرف‌حساب جداسازی شعبه", normalizedName: "scope-party" });
  appendEntry({ branchId: branchIdByCode.get("BAL-SOURCE"), partyId: isolationPartyId, accountId: accountId.get("accounts_receivable"), partySide: "debit", amountRial: 123n, entryNo: `R-${String(++sequence).padStart(8, "0")}` });
  appendEntry({ branchId: branchIdByCode.get("BAL-SCOPE"), partyId: isolationPartyId, accountId: accountId.get("accounts_receivable"), partySide: "debit", amountRial: 987n, entryNo: `R-${String(++sequence).padStart(8, "0")}` });

  const tiedPartyIds = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002", "10000000-0000-4000-8000-000000000003"];
  for (const [index, id] of tiedPartyIds.entries()) {
    partySpecs.push({ id, role: "CUSTOMER", businessId, name: `نام مشترک ${index + 1}`, normalizedName: "نام مشترک" });
    appendEntry({ branchId: branchIdByCode.get("BAL-TIE"), partyId: id, accountId: accountId.get("accounts_receivable"), partySide: "debit", amountRial: BigInt(index + 1), entryNo: `R-${String(++sequence).padStart(8, "0")}` });
  }
  const zeroBalancePartyId = randomUUID();
  partySpecs.push({ id: zeroBalancePartyId, role: "CUSTOMER", businessId, name: "مانده صفر پس از ابطال", normalizedName: "zero-after-reversal" });
  const reversedEntryId = appendEntry({ branchId: branchIdByCode.get("BAL-1"), partyId: zeroBalancePartyId, accountId: accountId.get("accounts_receivable"), partySide: "debit", amountRial: 777n, entryNo: `R-${String(++sequence).padStart(8, "0")}`, status: "REVERSED" });
  const reversalId = randomUUID();
  entrySpecs.push({ id: reversalId, businessId, branchId: branchIdByCode.get("BAL-1"), entryNo: `R-${String(++sequence).padStart(8, "0")}`, txnDate: new Date("2026-11-02T00:00:00.000Z"), sourceType: "TEST_REVERSAL", sourceId: randomUUID(), memo: "synthetic reversal", status: "POSTED", reversalOfId: reversedEntryId, postedBy: randomUUID() });
  lineSpecs.push(
    { businessId, journalEntryId: reversalId, ledgerAccountId: accountId.get("accounts_receivable"), partyId: zeroBalancePartyId, branchId: branchIdByCode.get("BAL-1"), debitRial: 0n, creditRial: 777n },
    { businessId, journalEntryId: reversalId, ledgerAccountId: accountId.get("counterpart"), partyId: null, branchId: branchIdByCode.get("BAL-1"), debitRial: 777n, creditRial: 0n },
  );

  for (let index = 1; index <= 3; index++) {
    const id = randomUUID();
    partySpecs.push({ id, role: "SUPPLIER", businessId, name: `تأمین‌کننده ${index}`, normalizedName: `supplier-${index}` });
    appendEntry({ branchId: branchIdByCode.get("BAL-1"), partyId: id, accountId: accountId.get("accounts_payable"), partySide: "credit", amountRial: BigInt(index * 250), entryNo: `P-${String(index).padStart(6, "0")}` });
  }

  const noisePartyId = randomUUID();
  partySpecs.push({ id: noisePartyId, role: "CUSTOMER", businessId, name: "پروندهٔ ظرفیت", normalizedName: "capacity-fixture" });
  for (let index = 1; index <= 27_000; index++) {
    appendEntry({ branchId: branchIdByCode.get("BAL-STATEMENT"), partyId: noisePartyId, accountId: accountId.get("accounts_receivable"), partySide: "debit", amountRial: 1n, entryNo: `N-${String(index).padStart(8, "0")}` });
  }

  for (let offset = 0; offset < partySpecs.length; offset += 2_000) {
    const batch = partySpecs.slice(offset, offset + 2_000);
    await prisma.party.createMany({ data: batch.map(({ role: _role, ...party }) => party) });
    await prisma.customer.createMany({ data: batch.filter(({ role }) => role === "CUSTOMER").map(({ id, businessId: rowBusinessId }) => ({ id, businessId: rowBusinessId })) });
    await prisma.supplier.createMany({ data: batch.filter(({ role }) => role === "SUPPLIER").map(({ id, businessId: rowBusinessId }) => ({ id, businessId: rowBusinessId })) });
  }
  for (let offset = 0; offset < entrySpecs.length; offset += 1_500) await prisma.journalEntry.createMany({ data: entrySpecs.slice(offset, offset + 1_500) });
  for (let offset = 0; offset < lineSpecs.length; offset += 2_500) await prisma.journalLine.createMany({ data: lineSpecs.slice(offset, offset + 2_500) });
  const performanceUnit = await prisma.unit.create({ data: { businessId, code: "perf-unit", labelFa: "واحد آزمایش ظرفیت", precision: 0, groupKey: "count", isVisible: true } });
  const serviceSpecs = Array.from({ length: 10_000 }, (_, index) => {
    const suffix = String(index + 1).padStart(5, "0");
    return { id: randomUUID(), businessId, branchId: branchIdByCode.get("BAL-10000"), unitId: performanceUnit.id, name: `خدمت ظرفیت ${suffix}`, normalizedName: `perf service ${suffix}`, kind: "SERVICE", salePriceRial: 1_000n };
  });
  for (let offset = 0; offset < serviceSpecs.length; offset += 2_000) {
    const batch = serviceSpecs.slice(offset, offset + 2_000);
    await prisma.catalogItem.createMany({ data: batch });
    await prisma.service.createMany({ data: batch.map(({ id, branchId }) => ({ id, businessId, branchId })) });
  }
  const perfCatalogItem = await prisma.catalogItem.findFirstOrThrow({ where: { businessId, kind: "SERVICE", name: "خدمت ظرفیت 00001" }, select: { id: true } });
  assert.ok(lineSpecs.length >= 100_000, "capacity fixture must contain at least 100,000 journal lines");
  assert.equal(serviceSpecs.length, 10_000);
  assert.ok(partySpecs.length >= 10_000, "capacity fixture must contain at least 10,000 parties");
  console.log(`Synthetic report fixture contains ${serviceSpecs.length.toLocaleString("en-US")} services, ${partySpecs.length.toLocaleString("en-US")} parties and ${lineSpecs.length.toLocaleString("en-US")} journal lines.`);
  await prisma.$executeRawUnsafe("ANALYZE parties");
  await prisma.$executeRawUnsafe("ANALYZE journal_lines");
  await prisma.$executeRawUnsafe("ANALYZE journal_entries");
  await prisma.$executeRawUnsafe("ANALYZE ledger_accounts");

  const reports = new ReportsService(prisma);
  async function collect(branchCode, expectedCount) {
    const branchId = branchIdByCode.get(branchCode);
    const pages = [];
    let cursor;
    do {
      const page = await reports.partyBalances({ businessId, branchId, role: "OWNER" }, "receivable", cursor, "100");
      assert.ok(page.items.length <= 100);
      pages.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      assert.equal(page.hasMore, Boolean(cursor));
      if (pages.length > expectedCount + 100) throw new Error(`Unexpected over-read for ${branchCode}.`);
    } while (cursor);
    assert.equal(pages.length, expectedCount, `Unexpected row count for branch ${branchCode}.`);
    assert.equal(new Set(pages.map((row) => row.id)).size, expectedCount, `Cursor skipped or repeated a row for ${branchCode}.`);
    return pages;
  }

  const empty = await collect("BAL-0", 0);
  assert.deepEqual(empty, []);
  const one = await collect("BAL-1", 1);
  assert.equal(one.reduce((sum, row) => sum + BigInt(row.balanceRial), 0n), 2n);
  const sourceScoped = await collect("BAL-SOURCE", 1);
  assert.equal(sourceScoped[0].balanceRial, "123");
  assert.ok(one.every((row) => row.id !== zeroBalancePartyId), "fully reversed balances should net to zero and be absent");
  assert.equal(one.reduce((sum, row) => sum + BigInt(row.balanceRial), 0n), 2n);
  const branchScoped = await collect("BAL-SCOPE", 1);
  assert.equal(branchScoped[0].balanceRial, "987");
  const tiePage1 = await reports.partyBalances({ businessId, branchId: branchIdByCode.get("BAL-TIE"), role: "OWNER" }, "receivable", undefined, "2");
  const tiePage2 = await reports.partyBalances({ businessId, branchId: branchIdByCode.get("BAL-TIE"), role: "OWNER" }, "receivable", tiePage1.nextCursor, "2");
  assert.deepEqual([...tiePage1.items, ...tiePage2.items].map((row) => row.id), tiedPartyIds);
  assert.equal(tiePage1.hasMore, true);
  assert.equal(tiePage2.hasMore, false);

  const expectedCounts = new Map(reportSizes);
  for (const [branchCode, count] of expectedCounts) {
    const started = performance.now();
    const pages = await collect(branchCode, count);
    if (branchCode === "BAL-10000") console.log(`Full 10,000-row cursor walk: ${Math.ceil(count / 100)} pages in ${(performance.now() - started).toFixed(2)}ms.`);
    const expectedTotal = Array.from({ length: count }, (_, index) => BigInt(((index + 1) % 97) + 1)).reduce((sum, value) => sum + value, 0n);
    assert.equal(pages.reduce((sum, row) => sum + BigInt(row.balanceRial), 0n), expectedTotal, `Incorrect Rial total for branch ${branchCode}.`);
  }
  const payables = await reports.partyBalances({ businessId, branchId: branchIdByCode.get("BAL-1"), role: "OWNER" }, "payable", undefined, "100");
  assert.equal(payables.items.length, 3);
  assert.equal(payables.items.reduce((sum, row) => sum + BigInt(row.balanceRial), 0n), 1_500n);

  const statements = new PartiesService(prisma);
  for (const count of statementSizes) {
    const entries = [];
    let cursor;
    let pageIndex = 0;
    let page;
    do {
      page = await statements.statement({ businessId, role: "OWNER" }, statementPartyIds.get(count), "2026-11-01", cursor, "100");
      assert.ok(page.entries.length <= 100);
      assert.equal(page.balanceRial, String(count * 100), `Incorrect authoritative statement balance for ${count} movements.`);
      assert.equal(page.openingBalanceRial, String(pageIndex * 100 * 100), `Incorrect opening balance at page ${pageIndex + 1} for ${count} movements.`);
      entries.push(...page.entries);
      cursor = page.nextCursor ?? undefined;
      assert.equal(page.hasMore, Boolean(cursor));
      pageIndex++;
    } while (cursor);
    assert.equal(entries.length, count, `Incorrect statement movement count for ${count}.`);
    assert.equal(new Set(entries.map(({ id }) => id)).size, count, `Statement cursor skipped or repeated a line for ${count}.`);
    assert.equal(entries.reduce((sum, row) => sum + BigInt(row.debitRial) - BigInt(row.creditRial), 0n), BigInt(count) * 100n);
    const independentTotal = await prisma.journalLine.aggregate({
      where: { businessId, partyId: statementPartyIds.get(count), journalEntry: { is: { status: { in: ["POSTED", "REVERSED"] }, txnDate: { lte: new Date("2026-11-01T00:00:00.000Z") } } } },
      _sum: { debitRial: true, creditRial: true },
    });
    assert.equal(page.balanceRial, ((independentTotal._sum.debitRial ?? 0n) - (independentTotal._sum.creditRial ?? 0n)).toString());
  }
  for (const count of [501, 10_000]) {
    const statementPlanRows = await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT jl.id
      FROM journal_lines AS jl
      JOIN journal_entries AS je ON je.id = jl.journal_entry_id AND je.business_id = jl.business_id
      WHERE jl.business_id = ${businessId} AND jl.party_id = ${statementPartyIds.get(count)} AND je.status IN ('POSTED', 'REVERSED')
      ORDER BY je.txn_date ASC, jl.id ASC
      LIMIT 101`);
    const statementPlan = statementPlanRows[0]["QUERY PLAN"][0];
    const scanNodes = [];
    const visitPlan = (node) => { if (node["Node Type"]?.includes("Scan")) scanNodes.push({ type: node["Node Type"], index: node["Index Name"] ?? null, rows: node["Actual Rows"], timeMs: node["Actual Total Time"] }); for (const child of node.Plans ?? []) visitPlan(child); };
    visitPlan(statementPlan.Plan);
    console.log(`EXPLAIN ANALYZE party statement (${count} movements): ${JSON.stringify({ executionTimeMs: statementPlan["Execution Time"], scans: scanNodes })}`);
  }
  const queryPlanRows = await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${buildPartyBalanceQuery({ businessId, branchId: branchIdByCode.get("BAL-10000"), type: "receivable", limit: 101 })}`);
  const queryPlan = queryPlanRows[0]["QUERY PLAN"][0];
  console.log(`EXPLAIN ANALYZE first receivable page: ${JSON.stringify({ planningTimeMs: queryPlan["Planning Time"], executionTimeMs: queryPlan["Execution Time"], rows: queryPlan.Plan["Actual Rows"], sharedHitBlocks: queryPlan.Plan["Shared Hit Blocks"] })}`);
  const virtualUsers = 10;
  const iterationsPerUser = 10;
  const latencyBatches = await Promise.all(Array.from({ length: virtualUsers }, async () => {
    const latencies = [];
    for (let iteration = 0; iteration < iterationsPerUser; iteration++) {
      const started = performance.now();
      const page = await reports.partyBalances({ businessId, branchId: branchIdByCode.get("BAL-10000"), role: "OWNER" }, "receivable", undefined, "100");
      latencies.push(performance.now() - started);
      assert.equal(page.items.length, 100);
    }
    return latencies;
  }));
  const latencies = latencyBatches.flat().sort((a, b) => a - b);
  const percentile = (p) => Number(latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * p) - 1)].toFixed(2));
  console.log(`Service/database read load: ${virtualUsers} concurrent VUs × ${iterationsPerUser} requests; errors=0; p50=${percentile(0.5)}ms p95=${percentile(0.95)}ms p99=${percentile(0.99)}ms; direct service calls, not HTTP.`);
  console.log("PostgreSQL receivable/payable and party-statement pagination passed for 0, 1, 499, 500, 501 and 10,000 rows; duplicate sort keys, same-day statement cursors, independent aggregate reconciliation, reversal balance, tenant/branch isolation and exact Rial totals.");
  if (process.env.SHOPRO_RUN_HTTP_CAPACITY === "1") {
    const { runHttpCapacityProfile } = await import("./test-http-capacity-profile.mjs");
    await runHttpCapacityProfile({
      prisma,
      businessId,
      branchId: branchIdByCode.get("BAL-10000"),
      customerId: statementPartyIds.get(10_000),
      statementPartyId: statementPartyIds.get(10_000),
      productId: perfCatalogItem.id,
    });
  }
} finally {
  try {
    if (businessId && process.env.SHOPRO_TEST_CLUSTER_DISPOSABLE === "1") {
      console.log("Keeping the synthetic report fixture until the enclosing disposable PostgreSQL cluster is discarded.");
    } else if (businessId) {
      await prisma.business.delete({ where: { id: businessId } });
    }
  }
  finally { await prisma.$disconnect(); }
}
