import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client.js";
import { UNIT_CATALOG } from "../apps/api/src/products/unit-catalog.js";

if (process.env.NODE_ENV !== "development") {
  throw new Error("Seed فقط در NODE_ENV=development اجرا می‌شود.");
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL تنظیم نشده است.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const ids = {
  user: "00000000-0000-4000-8000-000000000001",
  business: "00000000-0000-4000-8000-000000000002",
  branch: "00000000-0000-4000-8000-000000000003",
  unit: "00000000-0000-4000-8000-000000000004",
  financeAccount: "00000000-0000-4000-8000-000000000005",
};

async function main() {
  const phone = process.env.SHOPRO_SEED_PHONE ?? "09120000000";
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({ where: { phone }, update: {}, create: { id: ids.user, phone, displayName: "کاربر نمونه توسعه" } });
    const business = await tx.business.upsert({ where: { id: ids.business }, update: {}, create: { id: ids.business, displayName: "کسب‌وکار نمونه توسعه", businessType: "فروشگاه" } });
    const branch = await tx.branch.upsert({ where: { id: ids.branch }, update: {}, create: { id: ids.branch, businessId: business.id, name: "شعبهٔ اصلی", code: "MAIN" } });
    const member = await tx.businessMember.upsert({ where: { businessId_userId: { businessId: business.id, userId: user.id } }, update: { role: "OWNER", status: "ACTIVE" }, create: { businessId: business.id, userId: user.id, role: "OWNER" } });
    await tx.memberBranch.upsert({ where: { memberId_branchId: { memberId: member.id, branchId: branch.id } }, update: {}, create: { businessId: business.id, memberId: member.id, branchId: branch.id } });

    const accounts = [
      ["1100", "صندوق و بانک", "ASSET", "cash"], ["1200", "حساب‌های دریافتنی", "ASSET", "accounts_receivable"],
      ["1300", "موجودی کالا", "ASSET", "inventory"], ["2100", "حساب‌های پرداختنی", "LIABILITY", "accounts_payable"],
      ["2200", "مالیات فروش", "LIABILITY", "output_tax"], ["3000", "سرمایه", "EQUITY", "equity"],
      ["4000", "درآمد فروش", "REVENUE", "sales_revenue"], ["4100", "سایر درآمدها", "REVENUE", "other_income"],
      ["5000", "بهای تمام‌شده", "EXPENSE", "cost_of_goods"], ["6000", "هزینه‌های عمومی", "EXPENSE", "general_expense"],
    ] as const;
    const ledgerIds = new Map<string, string>();
    for (const [code, name, type, systemKey] of accounts) {
      const account = await tx.ledgerAccount.upsert({ where: { businessId_code: { businessId: business.id, code } }, update: {}, create: { businessId: business.id, code, name, type, systemKey } });
      ledgerIds.set(systemKey, account.id);
    }
    const defaultUnit = UNIT_CATALOG.find(({ code }) => code === "pcs")!;
    const unit = await tx.unit.upsert({ where: { businessId_code: { businessId: business.id, code: defaultUnit.code } }, update: {}, create: { id: ids.unit, businessId: business.id, code: defaultUnit.code, labelFa: defaultUnit.labelFa, precision: defaultUnit.precision, groupKey: defaultUnit.groupKey, isVisible: defaultUnit.defaultVisible } });
    await tx.unit.createMany({ data: UNIT_CATALOG.filter(({ code }) => code !== defaultUnit.code).map(({ defaultVisible, ...item }) => ({ id: randomUUID(), businessId: business.id, ...item, isVisible: defaultVisible })), skipDuplicates: true });
    await tx.financeAccount.upsert({ where: { id: ids.financeAccount }, update: {}, create: { id: ids.financeAccount, businessId: business.id, branchId: branch.id, name: "صندوق اصلی", kind: "CASH", ledgerAccountId: ledgerIds.get("cash")! } });
    await tx.expenseCategory.upsert({ where: { businessId_name: { businessId: business.id, name: "هزینه عمومی" } }, update: {}, create: { businessId: business.id, name: "هزینه عمومی", expenseLedgerAccountId: ledgerIds.get("general_expense")! } });

    const party = await tx.party.findFirst({ where: { businessId: business.id, normalizedName: "مشتری نمونه" } });
    if (!party) await tx.party.create({ data: { businessId: business.id, type: "CUSTOMER", name: "مشتری نمونه", normalizedName: "مشتری نمونه" } });

    const samples = [
      { sku: "DEV-001", name: "دفتر یادداشت", salePriceRial: 6500000n, defaultCostRial: 4000000n, quantity: 12n },
      { sku: "DEV-002", name: "خودکار آبی", salePriceRial: 1200000n, defaultCostRial: 700000n, quantity: 24n },
      { sku: "DEV-003", name: "خدمت بسته‌بندی", kind: "SERVICE" as const, salePriceRial: 500000n, defaultCostRial: null, quantity: 0n },
    ];
    const productIds: string[] = [];
    for (const sample of samples) {
      const product = await tx.product.upsert({
        where: { businessId_sku: { businessId: business.id, sku: sample.sku } }, update: {},
        create: { businessId: business.id, sku: sample.sku, name: sample.name, normalizedName: sample.name, kind: sample.kind ?? "STOCK", unitId: unit.id, salePriceRial: sample.salePriceRial, defaultCostRial: sample.defaultCostRial, trackInventory: sample.kind !== "SERVICE" },
      });
      productIds.push(product.id);
    }
    const opening = await tx.journalEntry.findFirst({ where: { businessId: business.id, sourceType: "SEED_OPENING", sourceId: business.id } });
    if (!opening) {
      const inventoryLines = [];
      for (let index = 0; index < samples.length; index++) {
        const sample = samples[index];
        if (sample.quantity === 0n) continue;
        const value = sample.quantity * (sample.defaultCostRial ?? 0n);
        await tx.inventoryBalance.create({ data: { businessId: business.id, branchId: branch.id, productId: productIds[index], quantityOnHand: sample.quantity.toString(), inventoryValueRial: value, averageCostRial: sample.defaultCostRial ?? 0n } });
        await tx.inventoryMovement.create({ data: { businessId: business.id, branchId: branch.id, productId: productIds[index], txnDate: new Date("2026-01-01T00:00:00.000Z"), sourceType: "SEED_OPENING", sourceId: business.id, quantityDelta: sample.quantity.toString(), unitCostRial: sample.defaultCostRial ?? 0n, valueDeltaRial: value, createdBy: user.id } });
        inventoryLines.push({ ledgerAccountId: ledgerIds.get("inventory")!, branchId: branch.id, debitRial: value, creditRial: 0n, description: `موجودی نمونه ${sample.name}` });
        inventoryLines.push({ ledgerAccountId: ledgerIds.get("equity")!, branchId: branch.id, debitRial: 0n, creditRial: value, description: "سرمایهٔ افتتاحیهٔ نمونه" });
      }
      if (inventoryLines.length) {
        const sequence = await tx.documentSequence.upsert({ where: { businessId_type: { businessId: business.id, type: "JOURNAL" } }, create: { businessId: business.id, type: "JOURNAL", nextValue: 2n }, update: { nextValue: { increment: 1n } }, select: { nextValue: true } });
        await tx.journalEntry.create({ data: {
          businessId: business.id, branchId: branch.id, entryNo: `D-${String(sequence.nextValue - 1n).padStart(6, "0")}`, txnDate: new Date("2026-01-01T00:00:00.000Z"),
          sourceType: "SEED_OPENING", sourceId: business.id, memo: "دادهٔ نمونهٔ محیط توسعه", postedBy: user.id,
          lines: { create: inventoryLines.map(({ branchId: lineBranchId, ...line }) => ({ ...line, branchId: lineBranchId })) },
        } });
      }
    }
  }, { isolationLevel: "Serializable" });
  console.log("نمونهٔ توسعهٔ Shopro آماده شد.");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
