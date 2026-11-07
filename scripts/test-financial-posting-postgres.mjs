import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AccountingService } from "../apps/api/dist/finance/accounting.service.js";
import { PrismaService } from "../apps/api/dist/prisma/prisma.service.js";
import { PurchasesService } from "../apps/api/dist/purchases/purchases.service.js";
import { SalesService } from "../apps/api/dist/sales/sales.service.js";
import { ReportsService } from "../apps/api/dist/reports/reports.service.js";
import { ExpensesService } from "../apps/api/dist/expenses/expenses.service.js";
import { AttachmentStorageService } from "../apps/api/dist/expenses/attachment-storage.service.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL must target an isolated test database.");
const databaseUrl = new URL(connectionString);
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
if (!["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname.replace(/^\[|\]$/g, "")) || !/test/i.test(databaseName)) {
  throw new Error(`Refusing financial posting integration outside loopback test database (host=${databaseUrl.hostname}, database=${databaseName}).`);
}

const prisma = new PrismaService();
const accounting = new AccountingService(prisma);
let businessId;
let userId;
let auditFailureTriggerInstalled = false;
try {
  await prisma.$connect();
  const user = await prisma.user.create({ data: { phone: `09${String(Date.now()).slice(-9)}`, displayName: "Financial integration test" } });
  userId = user.id;
  const business = await prisma.business.create({
    data: {
      displayName: `Financial posting integration ${randomUUID()}`,
      businessType: "Automated test",
      branches: { create: [{ name: "Branch A", code: "FIN-A" }, { name: "Branch B", code: "FIN-B" }] },
    },
    include: { branches: { select: { id: true } } },
  });
  businessId = business.id;
  const [branchA, branchB] = business.branches;
  const member = await prisma.businessMember.create({ data: { businessId, userId, role: "OWNER" } });
  await prisma.memberBranch.createMany({ data: business.branches.map(({ id }) => ({ businessId, memberId: member.id, branchId: id })) });

  const unit = await prisma.unit.create({ data: { businessId, code: "pcs", labelFa: "عدد", precision: 0, groupKey: "count", isVisible: true } });
  const accountSpecs = [
    ["1100", "Test cash", "ASSET", "cash"],
    ["1200", "Test receivables", "ASSET", "accounts_receivable"],
    ["1300", "Test inventory", "ASSET", "inventory"],
    ["2100", "Test payables", "LIABILITY", "accounts_payable"],
    ["3000", "Test equity", "EQUITY", "equity"],
    ["4000", "Test revenue", "REVENUE", "sales_revenue"],
    ["2200", "Test output tax", "LIABILITY", "output_tax"],
    ["1400", "Test input tax", "ASSET", "input_tax"],
    ["5000", "Test COGS", "EXPENSE", "cost_of_goods"],
  ];
  const accountId = new Map();
  for (const [code, name, type, systemKey] of accountSpecs) {
    const account = await prisma.ledgerAccount.create({ data: { businessId, code, name, type, systemKey } });
    accountId.set(systemKey, account.id);
  }
  const financeAccounts = await Promise.all(business.branches.map(({ id }, index) => prisma.financeAccount.create({
    data: { businessId, branchId: id, ledgerAccountId: accountId.get("cash"), name: `Test cash ${index + 1}`, kind: "CASH" },
  })));
  const customerParty = await prisma.party.create({ data: { businessId, name: "Test customer", normalizedName: "test customer" } });
  const supplierParty = await prisma.party.create({ data: { businessId, name: "Test supplier", normalizedName: "test supplier" } });
  const [customer, supplier] = await Promise.all([
    prisma.customer.create({ data: { id: customerParty.id, businessId } }),
    prisma.supplier.create({ data: { id: supplierParty.id, businessId } }),
  ]);
  const catalogItem = await prisma.catalogItem.create({
    data: { businessId, name: "Test stock", normalizedName: "test stock", unitId: unit.id, kind: "STOCK", salePriceRial: 1_500_000n },
  });
  const product = await prisma.product.create({
    data: { id: catalogItem.id, businessId, sku: "FIN-POST-1", defaultCostRial: 1_000_000n, trackInventory: true },
  });
  const openingSourceId = randomUUID();
  const quantityMilli = (value) => {
    const [whole, fraction = ""] = value.toString().split(".");
    return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0").slice(0, 3));
  };
  await prisma.$transaction(async (tx) => {
    await tx.inventoryBalance.create({ data: { businessId, branchId: branchA.id, productId: product.id, quantityOnHand: "3.000", inventoryValueRial: 3_000_000n, averageCostRial: 1_000_000n } });
    await tx.inventoryMovement.create({ data: { businessId, branchId: branchA.id, productId: product.id, txnDate: new Date("2026-11-01T00:00:00.000Z"), sourceType: "TEST_OPENING", sourceId: openingSourceId, quantityDelta: "3.000", unitCostRial: 1_000_000n, valueDeltaRial: 3_000_000n, createdBy: userId } });
    await accounting.createJournal(tx, {
      businessId, branchId: branchA.id, date: new Date("2026-11-01T00:00:00.000Z"), sourceType: "TEST_OPENING", sourceId: openingSourceId, actorId: userId,
      lines: [
        { ledgerAccountId: accountId.get("inventory"), debitRial: 3_000_000n },
        { ledgerAccountId: accountId.get("equity"), creditRial: 3_000_000n },
      ],
    });
  });

  const userA = { id: userId, businessId, branchId: branchA.id, role: "OWNER" };
  const userB = { id: userId, businessId, branchId: branchB.id, role: "OWNER" };
  const request = { requestId: randomUUID() };
  const sales = new SalesService(prisma, accounting);
  const purchases = new PurchasesService(prisma, accounting);
  const reports = new ReportsService(prisma);
  const expenses = new ExpensesService(prisma, accounting, new AttachmentStorageService());
  const expenseCategory = await prisma.expenseCategory.create({ data: { businessId, name: "Test operating expense", expenseLedgerAccountId: accountId.get("cost_of_goods") } });

  const saleDraftForCancellation = await sales.createDraft(userA, {
    customerId: customer.id,
    txnDate: "2026-11-02",
    lines: [{ productId: product.id, quantity: "1" }],
  }, `test-sale-cancel-draft-${randomUUID()}`, request);
  const purchaseDraftForCancellation = await purchases.create(userB, {
    supplierId: supplier.id,
    txnDate: "2026-11-02",
    lines: [{ productId: product.id, quantity: "1", unitCostRial: "900000" }],
  }, request);
  const expenseDraftForCancellation = await expenses.create(userA, { amountRial: "45000", categoryId: expenseCategory.id, txnDate: "2026-11-03", note: "Integration expense draft cancellation" }, request);

  const salesAuditFailurePayload = { payments: [{ amountRial: "500000", financeAccountId: financeAccounts[0].id, method: "CASH" }] };
  const salesAuditFailureKey = `test-sales-post-audit-failure-${randomUUID()}`;
  const purchaseAuditFailurePayload = { payments: [{ amountRial: "900000", financeAccountId: financeAccounts[1].id, method: "CASH" }] };
  const purchaseAuditFailureKey = `test-purchase-post-audit-failure-${randomUUID()}`;
  const expenseAuditFailurePayload = { financeAccountId: financeAccounts[0].id };
  const expenseAuditFailureKey = `test-expense-post-audit-failure-${randomUUID()}`;
  await prisma.$executeRawUnsafe(`CREATE FUNCTION shopro_test_reject_post_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('sales.posted', 'purchase.posted', 'expense.posted') THEN RAISE EXCEPTION 'injected posting audit failure'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe("CREATE TRIGGER shopro_test_reject_post_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION shopro_test_reject_post_audit()");
  auditFailureTriggerInstalled = true;
  await assert.rejects(() => sales.post(userA, saleDraftForCancellation.id, salesAuditFailurePayload, salesAuditFailureKey, request), () => true, "a failed sale audit insert must abort posting");
  await assert.rejects(() => purchases.post(userB, purchaseDraftForCancellation.id, purchaseAuditFailurePayload, purchaseAuditFailureKey, request), () => true, "a failed purchase audit insert must abort posting");
  await assert.rejects(() => expenses.post(userA, expenseDraftForCancellation.id, expenseAuditFailurePayload, expenseAuditFailureKey, request), () => true, "a failed expense audit insert must abort posting");
  assert.equal((await prisma.salesInvoice.findFirstOrThrow({ where: { id: saleDraftForCancellation.id, businessId } })).status, "DRAFT", "failed sale posting audit must leave the invoice draft");
  assert.equal((await prisma.salesInvoice.findFirstOrThrow({ where: { id: saleDraftForCancellation.id, businessId } })).invoiceNo, null, "failed sale posting audit must roll back the invoice number");
  assert.equal((await prisma.purchase.findFirstOrThrow({ where: { id: purchaseDraftForCancellation.id, businessId } })).status, "DRAFT", "failed purchase posting audit must leave the purchase draft");
  assert.equal((await prisma.purchase.findFirstOrThrow({ where: { id: purchaseDraftForCancellation.id, businessId } })).purchaseNo, null, "failed purchase posting audit must roll back the purchase number");
  assert.equal((await prisma.expense.findFirstOrThrow({ where: { id: expenseDraftForCancellation.id, businessId } })).status, "DRAFT", "failed expense posting audit must leave the expense draft");
  assert.equal((await prisma.expense.findFirstOrThrow({ where: { id: expenseDraftForCancellation.id, businessId } })).expenseNo, null, "failed expense posting audit must roll back the expense number");
  for (const id of [saleDraftForCancellation.id, purchaseDraftForCancellation.id, expenseDraftForCancellation.id]) {
    assert.equal(await prisma.journalEntry.count({ where: { businessId, sourceId: id } }), 0, "failed financial posting audits must roll back journal entries");
  }
  assert.equal(await prisma.cashTransaction.count({ where: { businessId } }), 0, "failed financial posting audits must not leave any cash rows");
  assert.equal(await prisma.inventoryMovement.count({ where: { businessId } }), 1, "failed financial posting audits must roll back stock movements");
  assert.equal(await prisma.inventoryBalance.count({ where: { businessId, branchId: branchB.id } }), 0, "failed purchase audit must not create a branch inventory balance");
  assert.equal(await prisma.documentSequence.count({ where: { businessId, type: { in: ["SALE", "PURCHASE", "EXPENSE"] } } }), 0, "failed financial posting audits must roll back document sequences");
  assert.equal(await prisma.auditEvent.count({ where: { businessId, action: { in: ["sales.posted", "purchase.posted", "expense.posted"] } } }), 0, "failed audit inserts must leave no posted-action audit row");
  const inventoryAfterAuditFailures = await prisma.inventoryBalance.findUniqueOrThrow({ where: { businessId_branchId_productId: { businessId, branchId: branchA.id, productId: product.id } } });
  assert.equal(quantityMilli(inventoryAfterAuditFailures.quantityOnHand), 3_000n);
  assert.equal(inventoryAfterAuditFailures.inventoryValueRial, 3_000_000n);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).defaultCostRial, 1_000_000n, "failed purchase audit must roll back weighted-cost changes");
  assert.equal(await accounting.existingIdempotent(userId, businessId, salesAuditFailureKey, accounting.idempotencyHash({ id: saleDraftForCancellation.id, payments: salesAuditFailurePayload.payments })), null, "failed sale audit must roll back its idempotency record");
  assert.equal(await accounting.existingIdempotent(userId, businessId, purchaseAuditFailureKey, accounting.idempotencyHash({ id: purchaseDraftForCancellation.id, payments: purchaseAuditFailurePayload.payments })), null, "failed purchase audit must roll back its idempotency record");
  assert.equal(await accounting.existingIdempotent(userId, businessId, expenseAuditFailureKey, accounting.idempotencyHash({ id: expenseDraftForCancellation.id, financeAccountId: expenseAuditFailurePayload.financeAccountId })), null, "failed expense audit must roll back its idempotency record");
  await prisma.$executeRawUnsafe("DROP TRIGGER shopro_test_reject_post_audit ON audit_events");
  await prisma.$executeRawUnsafe("DROP FUNCTION shopro_test_reject_post_audit()");
  auditFailureTriggerInstalled = false;

  const saleDraftCancellationKey = `test-sale-cancel-${randomUUID()}`;
  const saleDraftCancellationPayload = { reason: "Integration draft cancellation" };
  const cancelledSaleDraft = await sales.void(userA, saleDraftForCancellation.id, saleDraftCancellationPayload, saleDraftCancellationKey, request);
  assert.equal(cancelledSaleDraft.status, "VOIDED");
  assert.equal(cancelledSaleDraft.reversalJournalId, null, "cancelling an unposted sale must not create a reversal journal");
  assert.deepEqual(
    await sales.void(userA, saleDraftForCancellation.id, saleDraftCancellationPayload, saleDraftCancellationKey, request),
    cancelledSaleDraft,
    "retrying a draft cancellation with the same idempotency key must return the saved result",
  );
  assert.equal(await prisma.journalEntry.count({ where: { businessId, sourceId: saleDraftForCancellation.id } }), 0, "cancelling a sale draft must not create journal entries");
  assert.equal(await prisma.cashTransaction.count({ where: { businessId, branchId: branchA.id } }), 0, "cancelling a sale draft must not create cash transactions");
  assert.equal(await prisma.inventoryMovement.count({ where: { businessId, branchId: branchA.id, sourceId: saleDraftForCancellation.id } }), 0, "cancelling a sale draft must not move stock");
  const inventoryAfterSaleDraftCancellation = await prisma.inventoryBalance.findUniqueOrThrow({ where: { businessId_branchId_productId: { businessId, branchId: branchA.id, productId: product.id } } });
  assert.equal(quantityMilli(inventoryAfterSaleDraftCancellation.quantityOnHand), 3_000n);
  assert.equal(inventoryAfterSaleDraftCancellation.inventoryValueRial, 3_000_000n);
  assert.equal(await prisma.auditEvent.count({ where: { businessId, entityId: saleDraftForCancellation.id, action: "sales.voided" } }), 1, "sale draft cancellation must be audited");

  const saleDraft = await sales.createDraft(userA, {
    customerId: customer.id,
    txnDate: "2026-11-02",
    lines: [{ productId: product.id, quantity: "1" }],
  }, `test-sale-draft-${randomUUID()}`, request);
  const salePostKey = `test-sale-post-${randomUUID()}`;
  const salePayload = { payments: [{ amountRial: "500000", financeAccountId: financeAccounts[0].id, method: "CASH" }] };
  const [sale, concurrentSaleRetry] = await Promise.all([
    sales.post(userA, saleDraft.id, salePayload, salePostKey, request),
    sales.post(userA, saleDraft.id, salePayload, salePostKey, request),
  ]);
  assert.equal(sale.status, "POSTED");
  assert.equal(sale.totalRial, "1500000");
  assert.equal(sale.paidRial, "500000");
  assert.equal(sale.balanceRial, "1000000");
  assert.deepEqual(concurrentSaleRetry, sale, "concurrent retries must return the same saved sale result");
  assert.deepEqual(await sales.post(userA, saleDraft.id, salePayload, salePostKey, request), sale, "retrying the same sale posting key must return the saved result");

  const purchaseDraft = await purchases.create(userB, {
    supplierId: supplier.id,
    txnDate: "2026-11-02",
    lines: [{ productId: product.id, quantity: "2", unitCostRial: "1200000" }],
  }, request);
  const purchasePostKey = `test-purchase-post-${randomUUID()}`;
  const purchasePayload = { payments: [{ amountRial: "1200000", financeAccountId: financeAccounts[1].id, method: "CASH" }] };
  const [purchase, concurrentPurchaseRetry] = await Promise.all([
    purchases.post(userB, purchaseDraft.id, purchasePayload, purchasePostKey, request),
    purchases.post(userB, purchaseDraft.id, purchasePayload, purchasePostKey, request),
  ]);
  assert.equal(purchase.status, "POSTED");
  assert.equal(purchase.totalRial, "2400000");
  assert.equal(purchase.paidRial, "1200000");
  assert.equal(purchase.balanceRial, "1200000");
  assert.deepEqual(concurrentPurchaseRetry, purchase, "concurrent retries must return the same saved purchase result");
  assert.deepEqual(await purchases.post(userB, purchaseDraft.id, purchasePayload, purchasePostKey, request), purchase, "retrying the same purchase posting key must return the saved result");
  await assert.rejects(() => purchases.deleteDraft(userB, purchase.id, request), (error) => error?.getStatus?.() === 409, "a posted purchase must be corrected with a reversal, not draft deletion");
  assert.equal((await prisma.purchase.findFirstOrThrow({ where: { id: purchase.id, businessId } })).status, "POSTED", "a failed draft deletion must retain the posted purchase");
  assert.equal(await prisma.journalEntry.count({ where: { businessId, sourceType: "PURCHASE", sourceId: purchase.id, status: "POSTED" } }), 1, "a failed draft deletion must preserve the posted purchase journal");
  assert.equal(await prisma.cashTransaction.count({ where: { businessId, branchId: branchB.id } }), 1, "a failed draft deletion must preserve purchase cash rows");
  const inventoryAfterRejectedPurchaseDelete = await prisma.inventoryBalance.findUniqueOrThrow({ where: { businessId_branchId_productId: { businessId, branchId: branchB.id, productId: product.id } } });
  assert.equal(quantityMilli(inventoryAfterRejectedPurchaseDelete.quantityOnHand), 2_000n);
  assert.equal(inventoryAfterRejectedPurchaseDelete.inventoryValueRial, 2_400_000n);

  for (const [sourceType, sourceId] of [["SALE", sale.id], ["PURCHASE", purchase.id]]) {
    const journals = await prisma.journalEntry.findMany({ where: { businessId, sourceType, sourceId }, include: { lines: true } });
    assert.equal(journals.length, 1, `${sourceType} should create one journal`);
    const debit = journals[0].lines.reduce((sum, line) => sum + line.debitRial, 0n);
    const credit = journals[0].lines.reduce((sum, line) => sum + line.creditRial, 0n);
    assert.ok(debit > 0n);
    assert.equal(debit, credit, `${sourceType} journal must balance`);
  }

  const salesCash = await prisma.cashTransaction.count({ where: { businessId, branchId: branchA.id, kind: "RECEIPT", journalEntryId: sale.journalEntryId } });
  const purchaseCash = await prisma.cashTransaction.count({ where: { businessId, branchId: branchB.id, kind: "PAYMENT", journalEntryId: purchase.journalEntryId } });
  assert.equal(salesCash, 1, "sale idempotent retry must not create a duplicate receipt");
  assert.equal(purchaseCash, 1, "purchase idempotent retry must not create a duplicate payment");

  const branchBFinancialBeforeDraftCancellation = {
    cashTransactions: await prisma.cashTransaction.count({ where: { businessId, branchId: branchB.id } }),
    inventory: await prisma.inventoryBalance.findUniqueOrThrow({ where: { businessId_branchId_productId: { businessId, branchId: branchB.id, productId: product.id } } }),
  };
  const deletedPurchaseDraft = await purchases.deleteDraft(userB, purchaseDraftForCancellation.id, request);
  assert.deepEqual(deletedPurchaseDraft, { id: purchaseDraftForCancellation.id, status: "DELETED" });
  assert.equal(await prisma.purchase.findFirst({ where: { id: purchaseDraftForCancellation.id, businessId } }), null, "a cancelled purchase draft must be removed");
  assert.equal(await prisma.journalEntry.count({ where: { businessId, sourceId: purchaseDraftForCancellation.id } }), 0, "deleting a purchase draft must not create journal entries");
  assert.equal(await prisma.cashTransaction.count({ where: { businessId, branchId: branchB.id } }), branchBFinancialBeforeDraftCancellation.cashTransactions, "deleting a purchase draft must not create cash transactions");
  assert.equal(await prisma.inventoryMovement.count({ where: { businessId, branchId: branchB.id, sourceId: purchaseDraftForCancellation.id } }), 0, "deleting a purchase draft must not move stock");
  const branchBInventoryAfterDraftCancellation = await prisma.inventoryBalance.findUniqueOrThrow({ where: { businessId_branchId_productId: { businessId, branchId: branchB.id, productId: product.id } } });
  assert.equal(branchBInventoryAfterDraftCancellation.quantityOnHand.toString(), branchBFinancialBeforeDraftCancellation.inventory.quantityOnHand.toString(), "deleting a purchase draft must not change stock quantity");
  assert.equal(branchBInventoryAfterDraftCancellation.inventoryValueRial, branchBFinancialBeforeDraftCancellation.inventory.inventoryValueRial, "deleting a purchase draft must not change inventory value");
  assert.equal(await prisma.auditEvent.count({ where: { businessId, entityId: purchaseDraftForCancellation.id, action: "purchase.draft.deleted" } }), 1, "purchase draft deletion must be audited");

  const purchaseVoidKey = `test-purchase-void-${randomUUID()}`;
  const purchaseVoidPayload = { reason: "Integration purchase reversal" };
  const purchaseVoidAttempts = await Promise.all([
    purchases.void(userB, purchase.id, purchaseVoidPayload, purchaseVoidKey, request),
    purchases.void(userB, purchase.id, purchaseVoidPayload, purchaseVoidKey, request),
  ]);
  const voidedPurchase = purchaseVoidAttempts[0];
  assert.equal(voidedPurchase.status, "VOIDED");
  assert.deepEqual(purchaseVoidAttempts[1], voidedPurchase, "concurrent purchase-void retries must return the saved result");
  assert.deepEqual(await purchases.void(userB, purchase.id, purchaseVoidPayload, purchaseVoidKey, request), voidedPurchase, "retrying a purchase void must return the saved result");
  const [purchaseJournal, purchaseReversalJournal] = await Promise.all([
    prisma.journalEntry.findFirst({ where: { businessId, sourceType: "PURCHASE", sourceId: purchase.id }, include: { lines: true } }),
    prisma.journalEntry.findFirst({ where: { businessId, sourceType: "PURCHASE_VOID", sourceId: purchase.id }, include: { lines: true } }),
  ]);
  assert.equal(purchaseJournal?.status, "REVERSED");
  assert.equal(purchaseReversalJournal?.id, voidedPurchase.reversalJournalId);
  assert.equal(purchaseReversalJournal?.reversalOfId, purchaseJournal?.id);
  assert.equal(purchaseReversalJournal?.status, "POSTED");
  for (const journal of [purchaseJournal, purchaseReversalJournal]) {
    assert.ok(journal?.lines.length);
    const debit = journal.lines.reduce((sum, line) => sum + line.debitRial, 0n);
    const credit = journal.lines.reduce((sum, line) => sum + line.creditRial, 0n);
    assert.equal(debit, credit, "purchase and reversal journals must both balance");
  }
  const purchaseVoidCash = await prisma.cashTransaction.findMany({ where: { businessId, branchId: branchB.id, journalEntryId: purchaseReversalJournal.id } });
  assert.equal(purchaseVoidCash.length, 1);
  assert.equal(purchaseVoidCash[0].kind, "RECEIPT");
  assert.equal(purchaseVoidCash[0].amountRial, 1_200_000n);
  const branchBInventory = await prisma.inventoryBalance.findUnique({ where: { businessId_branchId_productId: { businessId, branchId: branchB.id, productId: product.id } } });
  assert.equal(branchBInventory?.quantityOnHand.toString(), "0");
  assert.equal(branchBInventory?.inventoryValueRial, 0n);
  const purchaseVoidDashboard = await reports.dashboard(userB, "2026-11-01", "2026-11-03");
  assert.equal(purchaseVoidDashboard.receiptsRial, "1200000");
  assert.equal(purchaseVoidDashboard.cashPositionRial, "0");
  assert.deepEqual((await reports.partyBalances(userB, "payable")).items, [], "voided purchase must no longer leave a supplier balance");
  const purchaseVoidCashFlow = await reports.cashFlow(userB, "2026-11-01", "2026-11-03");
  assert.equal(purchaseVoidCashFlow.grossReceiptsRial, "1200000");
  assert.equal(purchaseVoidCashFlow.grossPaymentsRial, "1200000");
  assert.equal(purchaseVoidCashFlow.netCashFlowRial, "0");

  const balances = await prisma.inventoryBalance.findMany({ where: { businessId, productId: product.id } });
  const totalOnHandMilli = balances.reduce((sum, row) => sum + quantityMilli(row.quantityOnHand), 0n);
  const totalInventoryValue = balances.reduce((sum, row) => sum + row.inventoryValueRial, 0n);
  assert.equal(totalOnHandMilli, 2_000n);
  assert.equal(totalInventoryValue, 2_000_000n);

  const inventoryLedger = await prisma.journalLine.aggregate({ where: { businessId, ledgerAccountId: accountId.get("inventory") }, _sum: { debitRial: true, creditRial: true } });
  assert.equal((inventoryLedger._sum.debitRial ?? 0n) - (inventoryLedger._sum.creditRial ?? 0n), totalInventoryValue, "inventory control account must reconcile to branch inventory balances");

  const beforeReturn = await reports.dashboard(userA, "2026-11-01", "2026-11-03");
  assert.equal(beforeReturn.salesRial, "1500000");
  assert.equal(beforeReturn.receiptsRial, "500000");
  assert.equal(beforeReturn.cashPositionRial, "500000");
  const originalSaleLine = await prisma.salesInvoiceLine.findFirst({ where: { businessId, invoiceId: sale.id } });
  assert.ok(originalSaleLine);
  const firstReturnDto = {
    txnDate: "2026-11-03",
    reason: "Integration partial return",
    cashRefundRial: "250000",
    refundFinanceAccountId: financeAccounts[0].id,
    refundMethod: "CASH",
    lines: [{ invoiceLineId: originalSaleLine.id, quantity: "0.5", restock: true }],
  };
  const firstReturnKey = `test-sale-return-${randomUUID()}`;
  const firstReturn = await sales.returnSale(userA, sale.id, firstReturnDto, firstReturnKey, request);
  assert.equal(firstReturn.totalRial, "-750000");
  assert.deepEqual(await sales.returnSale(userA, sale.id, firstReturnDto, firstReturnKey, request), firstReturn, "return retries must return the saved result");
  const afterPartialReturn = await reports.dashboard(userA, "2026-11-01", "2026-11-03");
  assert.equal(afterPartialReturn.salesRial, "750000");
  assert.equal(afterPartialReturn.receiptsRial, "500000");
  assert.equal(afterPartialReturn.cashPositionRial, "250000");
  const partialReturnCashFlow = await reports.cashFlow(userA, "2026-11-01", "2026-11-03");
  assert.equal(partialReturnCashFlow.grossReceiptsRial, "500000");
  assert.equal(partialReturnCashFlow.grossPaymentsRial, "250000");
  assert.equal(partialReturnCashFlow.netCashFlowRial, "250000");
  assert.deepEqual((await reports.partyBalances(userA, "receivable")).items.map(({ id, balanceRial }) => ({ id, balanceRial })), [{ id: customer.id, balanceRial: "500000" }]);
  const partialReturnProfitLoss = await reports.profitLoss(userA, "2026-11-01", "2026-11-03");
  assert.equal(partialReturnProfitLoss.revenueRial, "750000");
  assert.equal(partialReturnProfitLoss.expenseRial, "500000");

  const secondReturnDto = { ...firstReturnDto, reason: "Integration final return", cashRefundRial: "300000", lines: [{ ...firstReturnDto.lines[0], quantity: "0.5" }] };
  const returnsBeforeRejectedRefund = await prisma.salesInvoice.count({ where: { businessId, returnOfId: sale.id } });
  await assert.rejects(
    () => sales.returnSale(userA, sale.id, secondReturnDto, `test-over-refund-${randomUUID()}`, request),
    (error) => error?.getStatus?.() === 400,
    "cumulative sale return refunds must not exceed cash collected on the original invoice",
  );
  assert.equal(await prisma.salesInvoice.count({ where: { businessId, returnOfId: sale.id } }), returnsBeforeRejectedRefund, "rejected over-refund must leave no return document");
  const finalReturnDto = { ...secondReturnDto, cashRefundRial: "250000" };
  const concurrentReturnKeys = [`test-return-concurrent-${randomUUID()}`, `test-return-concurrent-${randomUUID()}`];
  const concurrentReturns = await Promise.allSettled(concurrentReturnKeys.map((key) => sales.returnSale(userA, sale.id, finalReturnDto, key, request)));
  const successfulReturns = concurrentReturns.filter((result) => result.status === "fulfilled");
  const rejectedReturns = concurrentReturns.filter((result) => result.status === "rejected");
  assert.equal(successfulReturns.length, 1, "only one concurrent return may consume the remaining invoice quantity");
  assert.equal(rejectedReturns.length, 1);
  assert.equal(rejectedReturns[0].reason?.getStatus?.(), 409, "the competing return must receive a conflict");
  const finalReturn = successfulReturns[0].value;
  assert.equal(finalReturn.totalRial, "-750000");
  const fullyReturnedDashboard = await reports.dashboard(userA, "2026-11-01", "2026-11-03");
  assert.equal(fullyReturnedDashboard.salesRial, "0");
  assert.equal(fullyReturnedDashboard.receiptsRial, "500000");
  assert.equal(fullyReturnedDashboard.cashPositionRial, "0");
  const fullyReturnedCashFlow = await reports.cashFlow(userA, "2026-11-01", "2026-11-03");
  assert.equal(fullyReturnedCashFlow.grossReceiptsRial, "500000");
  assert.equal(fullyReturnedCashFlow.grossPaymentsRial, "500000");
  assert.equal(fullyReturnedCashFlow.netCashFlowRial, "0");
  const fullyReturnedProfitLoss = await reports.profitLoss(userA, "2026-11-01", "2026-11-03");
  assert.equal(fullyReturnedProfitLoss.revenueRial, "0");
  assert.equal(fullyReturnedProfitLoss.expenseRial, "0");
  assert.deepEqual((await reports.partyBalances(userA, "receivable")).items, []);

  const voidedReturn = await sales.void(userA, finalReturn.id, { reason: "Integration return reversal" }, `test-return-void-${randomUUID()}`, request);
  assert.equal(voidedReturn.status, "VOIDED");
  const afterReturnVoid = await reports.dashboard(userA, "2026-11-01", "2026-11-03");
  assert.equal(afterReturnVoid.salesRial, "750000");
  assert.equal(afterReturnVoid.cashPositionRial, "250000");
  assert.equal((await reports.profitLoss(userA, "2026-11-01", "2026-11-03")).revenueRial, "750000");
  assert.deepEqual((await reports.partyBalances(userA, "receivable")).items.map(({ id, balanceRial }) => ({ id, balanceRial })), [{ id: customer.id, balanceRial: "500000" }]);

  const secondSaleDraft = await sales.createDraft(userA, {
    customerId: customer.id,
    txnDate: "2026-11-03",
    lines: [{ productId: product.id, quantity: "1" }],
  }, `test-sale-void-draft-${randomUUID()}`, request);
  const secondSale = await sales.post(userA, secondSaleDraft.id, salePayload, `test-sale-void-post-${randomUUID()}`, request);
  const saleVoidKey = `test-sale-void-${randomUUID()}`;
  const saleVoidPayload = { reason: "Integration test void" };
  const saleVoidAttempts = await Promise.all([
    sales.void(userA, secondSale.id, saleVoidPayload, saleVoidKey, request),
    sales.void(userA, secondSale.id, saleVoidPayload, saleVoidKey, request),
  ]);
  const voided = saleVoidAttempts[0];
  assert.equal(voided.status, "VOIDED");
  assert.ok(voided.reversalJournalId);
  assert.deepEqual(saleVoidAttempts[1], voided, "concurrent sale-void retries must return the saved result");

  const [originalJournal, reversalJournal] = await Promise.all([
    prisma.journalEntry.findFirst({ where: { businessId, sourceType: "SALE", sourceId: secondSale.id }, include: { lines: true } }),
    prisma.journalEntry.findFirst({ where: { businessId, sourceType: "SALE_VOID", sourceId: secondSale.id }, include: { lines: true } }),
  ]);
  assert.equal(originalJournal?.status, "REVERSED");
  assert.equal(reversalJournal?.id, voided.reversalJournalId);
  assert.equal(reversalJournal?.status, "POSTED");
  for (const journal of [originalJournal, reversalJournal]) {
    assert.ok(journal?.lines.length);
    const debit = journal.lines.reduce((sum, line) => sum + line.debitRial, 0n);
    const credit = journal.lines.reduce((sum, line) => sum + line.creditRial, 0n);
    assert.equal(debit, credit, "sale and reversal journals must both balance");
  }
  const voidCash = await prisma.cashTransaction.findMany({ where: { businessId, branchId: branchA.id, journalEntryId: reversalJournal.id } });
  assert.equal(voidCash.length, 1);
  assert.equal(voidCash[0].kind, "PAYMENT");
  assert.equal(voidCash[0].amountRial, 500_000n);

  const afterVoid = await reports.dashboard(userA, "2026-11-01", "2026-11-03");
  assert.equal(afterVoid.salesRial, "750000", "voided invoice must be excluded from posted sales totals");
  assert.equal(afterVoid.receiptsRial, "750000", "reversed sale receipt is excluded while receipt from the voided return reversal remains a real cash receipt");
  assert.equal(afterVoid.cashPositionRial, "250000", "reversal must restore the branch cash ledger balance");
  const cashFlow = await reports.cashFlow(userA, "2026-11-01", "2026-11-03");
  assert.equal(cashFlow.grossReceiptsRial, "1250000", "cash flow retains posted receipts, including the receipt that reverses a prior return refund");
  assert.equal(cashFlow.grossPaymentsRial, "1000000", "sale and return voids must record their cash refunds/payments");
  assert.equal(cashFlow.netCashFlowRial, "250000", "net cash flow after voids must match the remaining cash");
  const receivables = await reports.partyBalances(userA, "receivable");
  assert.deepEqual(receivables.items.map(({ id, balanceRial }) => ({ id, balanceRial })), [{ id: customer.id, balanceRial: "500000" }], "voided sale must be removed from receivables while the partial return remains applied");

  const dashboardBeforeExpenseDraftCancellation = await reports.dashboard(userA, "2026-11-01", "2026-11-03");
  const cashTransactionsBeforeExpenseDraftCancellation = await prisma.cashTransaction.count({ where: { businessId, branchId: branchA.id } });
  const deletedExpenseDraft = await expenses.deleteDraft(userA, expenseDraftForCancellation.id, request);
  assert.deepEqual(deletedExpenseDraft, { id: expenseDraftForCancellation.id, status: "DELETED" });
  assert.equal(await prisma.expense.findFirst({ where: { id: expenseDraftForCancellation.id, businessId } }), null, "a cancelled expense draft must be removed");
  assert.equal(await prisma.journalEntry.count({ where: { businessId, sourceId: expenseDraftForCancellation.id } }), 0, "deleting an expense draft must not create journal entries");
  assert.equal(await prisma.cashTransaction.count({ where: { businessId, branchId: branchA.id } }), cashTransactionsBeforeExpenseDraftCancellation, "deleting an expense draft must not create a cash transaction");
  assert.deepEqual(await reports.dashboard(userA, "2026-11-01", "2026-11-03"), dashboardBeforeExpenseDraftCancellation, "deleting an expense draft must not change financial reports");
  assert.equal(await prisma.auditEvent.count({ where: { businessId, entityId: expenseDraftForCancellation.id, action: "expense.draft.deleted" } }), 1, "expense draft deletion must be audited");
  const expenseDraft = await expenses.create(userA, { amountRial: "300000", categoryId: expenseCategory.id, txnDate: "2026-11-03", note: "Integration expense reversal" }, request);
  const postedExpense = await expenses.post(userA, expenseDraft.id, { financeAccountId: financeAccounts[0].id }, `test-expense-post-${randomUUID()}`, request);
  const cashTransactionsBeforeRejectedExpenseDelete = await prisma.cashTransaction.count({ where: { businessId, branchId: branchA.id } });
  await assert.rejects(() => expenses.deleteDraft(userA, postedExpense.id, request), (error) => error?.getStatus?.() === 409, "a posted expense must be corrected with a reversal, not draft deletion");
  assert.equal((await prisma.expense.findFirstOrThrow({ where: { id: postedExpense.id, businessId } })).status, "POSTED", "a failed draft deletion must retain the posted expense");
  assert.equal(await prisma.journalEntry.count({ where: { businessId, sourceType: "EXPENSE", sourceId: postedExpense.id, status: "POSTED" } }), 1, "a failed draft deletion must preserve the posted expense journal");
  assert.equal(await prisma.cashTransaction.count({ where: { businessId, branchId: branchA.id } }), cashTransactionsBeforeRejectedExpenseDelete, "a failed draft deletion must preserve expense cash rows");
  const expenseVoidKey = `test-expense-void-${randomUUID()}`;
  const expenseVoidPayload = { reason: "Integration expense void" };
  const expenseVoidAttempts = await Promise.all([
    expenses.void(userA, postedExpense.id, expenseVoidPayload, expenseVoidKey, request),
    expenses.void(userA, postedExpense.id, expenseVoidPayload, expenseVoidKey, request),
  ]);
  const voidedExpense = expenseVoidAttempts[0];
  assert.equal(voidedExpense.status, "VOIDED");
  assert.deepEqual(expenseVoidAttempts[1], voidedExpense, "concurrent expense-void retries must return the saved result");
  const afterExpenseVoid = await reports.dashboard(userA, "2026-11-01", "2026-11-03");
  assert.equal(afterExpenseVoid.expensesRial, "0");
  assert.equal(afterExpenseVoid.cashPositionRial, "250000");
  const finalProfitLoss = await reports.profitLoss(userA, "2026-11-01", "2026-11-03");
  assert.equal(finalProfitLoss.revenueRial, "750000");
  assert.equal(finalProfitLoss.expenseRial, "500000", "voided expense must net to zero while sale COGS remains");
  const finalCashFlow = await reports.cashFlow(userA, "2026-11-01", "2026-11-03");
  assert.equal(finalCashFlow.grossReceiptsRial, "1550000");
  assert.equal(finalCashFlow.grossPaymentsRial, "1300000");
  assert.equal(finalCashFlow.netCashFlowRial, "250000");

  const afterVoidBalances = await prisma.inventoryBalance.findMany({ where: { businessId, productId: product.id } });
  const afterVoidQty = afterVoidBalances.reduce((sum, row) => sum + quantityMilli(row.quantityOnHand), 0n);
  const afterVoidValue = afterVoidBalances.reduce((sum, row) => sum + row.inventoryValueRial, 0n);
  assert.equal(afterVoidQty, 2_500n, "sale and return voids must restore stock while the purchase void removes branch B stock");
  assert.equal(afterVoidValue, 2_500_000n, "sale and return voids must restore branch A inventory and purchase void must remove branch B value");
  const allJournalTotals = await prisma.journalLine.aggregate({ where: { businessId }, _sum: { debitRial: true, creditRial: true } });
  assert.equal(allJournalTotals._sum.debitRial, allJournalTotals._sum.creditRial, "all posted, reversed, and reversal journals must reconcile");
  console.log("PostgreSQL financial posting passed: audit-trigger rollback of sale/purchase/expense posting, financially inert and audited cancellation of sale/purchase/expense drafts, protected posted purchase/expense records, sale/purchase/expense posting, partial and full returns, concurrent return/refund limits, idempotent sale/purchase/expense voids, dashboard and cash-flow behavior, receivables, and inventory/ledger reconciliation across two branches.");
} finally {
  try {
    if (auditFailureTriggerInstalled) {
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS shopro_test_reject_post_audit ON audit_events");
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS shopro_test_reject_post_audit()");
      auditFailureTriggerInstalled = false;
    }
    if (businessId) await prisma.$transaction(async (tx) => {
      await tx.paymentAllocation.deleteMany({ where: { businessId } });
      await tx.cashTransaction.deleteMany({ where: { businessId } });
      await tx.salesInvoice.deleteMany({ where: { businessId } });
      await tx.purchase.deleteMany({ where: { businessId } });
      await tx.expense.deleteMany({ where: { businessId } });
      await tx.expenseCategory.deleteMany({ where: { businessId } });
      await tx.inventoryMovement.deleteMany({ where: { businessId } });
      await tx.inventoryBalance.deleteMany({ where: { businessId } });
      await tx.journalEntry.deleteMany({ where: { businessId } });
      await tx.auditEvent.deleteMany({ where: { businessId } });
      await tx.financeAccount.deleteMany({ where: { businessId } });
      await tx.product.deleteMany({ where: { businessId } });
      await tx.catalogItem.deleteMany({ where: { businessId } });
      await tx.party.deleteMany({ where: { businessId } });
      await tx.unit.deleteMany({ where: { businessId } });
      await tx.ledgerAccount.deleteMany({ where: { businessId } });
      await tx.memberBranch.deleteMany({ where: { businessId } });
      await tx.businessMember.deleteMany({ where: { businessId } });
      await tx.branch.deleteMany({ where: { businessId } });
      await tx.business.delete({ where: { id: businessId } });
    });
    if (userId) await prisma.user.delete({ where: { id: userId } });
  } finally {
    await prisma.$disconnect();
  }
}
