import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { toAsciiDigits } from "@shopro/contracts";
import { AccountingService, type JournalLineInput } from "../finance/accounting.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import type { CreateStockCountDto } from "./inventory.dto.js";

function milli(value: string) {
  const normalized = toAsciiDigits(value).trim();
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) throw new BadRequestException("تعداد باید نامنفی و حداکثر سه رقم اعشار داشته باشد.");
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}
const quantityText = (value: bigint) => `${value / 1000n}.${(value % 1000n).toString().padStart(3, "0")}`;
const roundedDivide = (numerator: bigint, denominator: bigint) => numerator >= 0n ? (numerator + denominator / 2n) / denominator : -((-numerator + denominator / 2n) / denominator);

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService, private readonly accounting: AccountingService) {}

  async levels(user: AuthenticatedUser) {
    const { businessId, branchId } = this.scope(user);
    const products = await this.prisma.product.findMany({ where: { businessId, isActive: true, kind: "STOCK", trackInventory: true }, include: { unit: { select: { id: true, code: true, labelFa: true, precision: true } }, balances: { where: { branchId }, take: 1 } }, orderBy: { normalizedName: "asc" }, take: 500 });
    return products.map((product) => ({ productId: product.id, name: product.name, sku: product.sku, unit: product.unit, quantity: product.balances[0]?.quantityOnHand.toString() ?? "0", reorderPoint: product.reorderPoint?.toString() ?? null, averageCostRial: product.balances[0]?.averageCostRial.toString() ?? "0", valueRial: product.balances[0]?.inventoryValueRial.toString() ?? "0" }));
  }

  async movements(user: AuthenticatedUser, productId?: string) {
    const { businessId, branchId } = this.scope(user);
    const rows = await this.prisma.inventoryMovement.findMany({ where: { businessId, branchId, ...(productId ? { productId } : {}) }, include: { product: { select: { id: true, name: true, unit: { select: { labelFa: true } } } } }, orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }], take: 200 });
    return rows.map((row) => ({ id: row.id, productId: row.product.id, product: row.product.name, unit: row.product.unit.labelFa, date: row.txnDate.toISOString().slice(0, 10), sourceType: row.sourceType, quantityDelta: row.quantityDelta.toString(), unitCostRial: row.unitCostRial.toString(), valueDeltaRial: row.valueDeltaRial.toString() }));
  }

  async counts(user: AuthenticatedUser) {
    const { businessId, branchId } = this.scope(user);
    const rows = await this.prisma.stockCount.findMany({ where: { businessId, branchId }, include: { lines: { include: { product: { select: { id: true, name: true, unit: { select: { labelFa: true } } } } } } }, orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }], take: 50 });
    return rows.map((row) => ({ id: row.id, txnDate: row.txnDate.toISOString().slice(0, 10), status: row.status, reason: row.reason, lines: row.lines.map((line) => ({ productId: line.product.id, product: line.product.name, unit: line.product.unit.labelFa, systemQuantity: line.systemQuantitySnapshot.toString(), countedQuantity: line.countedQuantity.toString(), deltaQuantity: line.deltaQuantity.toString() })) }));
  }

  async createCount(user: AuthenticatedUser, dto: CreateStockCountDto, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireRole(user, ["OWNER", "MANAGER", "ACCOUNTANT"]);
    const date = this.date(dto.txnDate);
    if (new Set(dto.lines.map((line) => line.productId)).size !== dto.lines.length) throw new BadRequestException("یک کالا را در یک شمارش فقط یک‌بار وارد کنید.");
    const products = await this.prisma.product.findMany({ where: { businessId, id: { in: dto.lines.map((line) => line.productId) }, isActive: true, kind: "STOCK", trackInventory: true }, select: { id: true, name: true } });
    if (products.length !== dto.lines.length) throw new BadRequestException("یک یا چند کالا در این کسب‌وکار قابل شمارش نیست.");
    const quantities = dto.lines.map((line) => ({ productId: line.productId, counted: milli(line.countedQuantity) }));
    const row = await this.prisma.$transaction(async (tx) => {
      const balances = await tx.inventoryBalance.findMany({ where: { businessId, branchId, productId: { in: quantities.map((line) => line.productId) } }, select: { productId: true, quantityOnHand: true } });
      const current = new Map(balances.map((balance) => [balance.productId, milli(balance.quantityOnHand.toString())]));
      const count = await tx.stockCount.create({ data: {
        businessId, branchId, txnDate: date, reason: dto.reason.trim(), createdBy: user.id,
        lines: { create: quantities.map((line) => {
          const system = current.get(line.productId) ?? 0n;
          return { businessId, productId: line.productId, countedQuantity: new Prisma.Decimal(quantityText(line.counted)), systemQuantitySnapshot: new Prisma.Decimal(quantityText(system)), deltaQuantity: new Prisma.Decimal(quantityText(line.counted - system)) };
        }) },
      }, include: { lines: true } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "inventory.count.created", entityType: "stock_count", entityId: count.id, requestId: request.requestId ?? "unknown", afterJson: { txnDate: dto.txnDate, reason: dto.reason.trim(), lineCount: count.lines.length } } });
      return count;
    });
    return { id: row.id, txnDate: row.txnDate.toISOString().slice(0, 10), status: row.status, lineCount: row.lines.length };
  }

  async updateCountDraft(user: AuthenticatedUser, id: string, dto: CreateStockCountDto, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireRole(user, ["OWNER", "MANAGER", "ACCOUNTANT"]);
    const before = await this.prisma.stockCount.findFirst({ where: { id, businessId, branchId, status: "DRAFT" }, include: { lines: true } });
    if (!before) throw new NotFoundException("پیش‌نویس شمارش موجودی پیدا نشد.");
    const date = this.date(dto.txnDate);
    if (new Set(dto.lines.map((line) => line.productId)).size !== dto.lines.length) throw new BadRequestException("یک کالا را در یک شمارش فقط یک‌بار وارد کنید.");
    const products = await this.prisma.product.findMany({ where: { businessId, id: { in: dto.lines.map((line) => line.productId) }, isActive: true, kind: "STOCK", trackInventory: true }, select: { id: true, name: true } });
    if (products.length !== dto.lines.length) throw new BadRequestException("یک یا چند کالا در این کسب‌وکار قابل شمارش نیست.");
    const quantities = dto.lines.map((line) => ({ productId: line.productId, counted: milli(line.countedQuantity) }));
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.stockCount.findFirst({ where: { id, businessId, branchId, status: "DRAFT" }, select: { id: true } });
      if (!current) throw new ConflictException("وضعیت شمارش تغییر کرده است؛ فهرست را تازه کنید.");
      const balances = await tx.inventoryBalance.findMany({ where: { businessId, branchId, productId: { in: quantities.map((line) => line.productId) } }, select: { productId: true, quantityOnHand: true } });
      const currentByProduct = new Map(balances.map((balance) => [balance.productId, milli(balance.quantityOnHand.toString())]));
      await tx.stockCountLine.deleteMany({ where: { businessId, stockCountId: id } });
      const updated = await tx.stockCount.update({ where: { id }, data: {
        txnDate: date, reason: dto.reason.trim(),
        lines: { create: quantities.map((line) => { const system = currentByProduct.get(line.productId) ?? 0n; return { businessId, productId: line.productId, countedQuantity: new Prisma.Decimal(quantityText(line.counted)), systemQuantitySnapshot: new Prisma.Decimal(quantityText(system)), deltaQuantity: new Prisma.Decimal(quantityText(line.counted - system)) }; }) },
      }, include: { lines: true } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "inventory.count.draft.updated", entityType: "stock_count", entityId: id, requestId: request.requestId ?? "unknown", beforeJson: { txnDate: before.txnDate.toISOString().slice(0, 10), reason: before.reason, lineCount: before.lines.length }, afterJson: { txnDate: dto.txnDate, reason: dto.reason.trim(), lineCount: updated.lines.length } } });
      return { id: updated.id, txnDate: updated.txnDate.toISOString().slice(0, 10), status: updated.status, lineCount: updated.lines.length };
    });
  }

  async deleteCountDraft(user: AuthenticatedUser, id: string, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireRole(user, ["OWNER", "MANAGER", "ACCOUNTANT"]);
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.stockCount.findFirst({ where: { id, businessId, branchId, status: "DRAFT" }, include: { lines: { select: { id: true } } } });
      if (!count) throw new ConflictException("فقط پیش‌نویس شمارش را می‌توان حذف کرد؛ شمارش ثبت‌شده سابقهٔ مالی دارد.");
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "inventory.count.draft.deleted", entityType: "stock_count", entityId: id, requestId: request.requestId ?? "unknown", beforeJson: { txnDate: count.txnDate.toISOString().slice(0, 10), reason: count.reason, lineCount: count.lines.length } } });
      await tx.stockCount.delete({ where: { id } });
      return { id, status: "DELETED" };
    });
  }

  async postCount(user: AuthenticatedUser, id: string, key: string | undefined, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireRole(user, ["OWNER", "MANAGER", "ACCOUNTANT"]);
    if (!key || key.length > 128) throw new BadRequestException("هدر Idempotency-Key برای نهایی‌کردن شمارش الزامی است.");
    const requestHash = this.accounting.idempotencyHash({ id, action: "post-stock-count" });
    const prior = await this.accounting.existingIdempotent(user.id, businessId, key, requestHash);
    if (prior) return prior;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const count = await tx.stockCount.findFirst({ where: { id, businessId, branchId }, include: { lines: { include: { product: { select: { id: true, name: true, defaultCostRial: true } } } } } });
        if (!count) throw new NotFoundException("شمارش موجودی پیدا نشد.");
        if (count.status !== "DRAFT") throw new ConflictException("این شمارش قبلاً نهایی شده است.");
        await this.accounting.assertOpen(tx, businessId, count.txnDate);
        const inventoryAccount = await this.accounting.account(tx, businessId, "inventory");
        const expenseAccount = await this.accounting.account(tx, businessId, "general_expense");
        const gainAccount = await this.accounting.account(tx, businessId, "other_income");
        const journalLines: JournalLineInput[] = [];
        let changed = 0;
        for (const line of count.lines) {
          const balance = await tx.inventoryBalance.findUnique({ where: { businessId_branchId_productId: { businessId, branchId, productId: line.productId } } });
          const currentMilli = balance ? milli(balance.quantityOnHand.toString()) : 0n;
          const snapshotMilli = milli(line.systemQuantitySnapshot.toString());
          if (currentMilli !== snapshotMilli) throw new ConflictException(`موجودی «${line.product.name}» پس از شروع شمارش تغییر کرده است؛ شمارش تازه ثبت کنید.`);
          const countedMilli = milli(line.countedQuantity.toString());
          const deltaMilli = countedMilli - currentMilli;
          if (deltaMilli === 0n) continue;
          if (countedMilli < 0n) throw new BadRequestException("موجودی شمارش‌شده نمی‌تواند منفی باشد.");
          const unitCost = balance?.averageCostRial ?? line.product.defaultCostRial ?? 0n;
          const valueDelta = roundedDivide(deltaMilli * unitCost, 1000n);
          const nextValue = (balance?.inventoryValueRial ?? 0n) + valueDelta;
          const nextAverage = countedMilli > 0n ? roundedDivide(nextValue * 1000n, countedMilli) : 0n;
          await tx.inventoryBalance.upsert({
            where: { businessId_branchId_productId: { businessId, branchId, productId: line.productId } },
            create: { businessId, branchId, productId: line.productId, quantityOnHand: new Prisma.Decimal(quantityText(countedMilli)), inventoryValueRial: nextValue, averageCostRial: nextAverage },
            update: { quantityOnHand: new Prisma.Decimal(quantityText(countedMilli)), inventoryValueRial: nextValue, averageCostRial: nextAverage },
          });
          await tx.inventoryMovement.create({ data: { businessId, branchId, productId: line.productId, txnDate: count.txnDate, sourceType: "STOCK_COUNT", sourceId: count.id, quantityDelta: new Prisma.Decimal(quantityText(deltaMilli)), unitCostRial: unitCost, valueDeltaRial: valueDelta, createdBy: user.id } });
          if (valueDelta > 0n) journalLines.push({ ledgerAccountId: inventoryAccount, debitRial: valueDelta, description: `افزایش موجودی ${line.product.name}` }, { ledgerAccountId: gainAccount, creditRial: valueDelta, description: "افزایش ناشی از شمارش" });
          if (valueDelta < 0n) journalLines.push({ ledgerAccountId: expenseAccount, debitRial: -valueDelta, description: `کسری موجودی ${line.product.name}` }, { ledgerAccountId: inventoryAccount, creditRial: -valueDelta, description: "کاهش موجودی شمارش‌شده" });
          changed++;
        }
        let journalId: string | null = null;
        if (journalLines.length) {
          const journal = await this.accounting.createJournal(tx, { businessId, branchId, date: count.txnDate, sourceType: "STOCK_COUNT", sourceId: count.id, memo: count.reason, actorId: user.id, lines: journalLines });
          journalId = journal.id;
        }
        const posted = await tx.stockCount.update({ where: { id: count.id }, data: { status: "POSTED" } });
        const result = { id: posted.id, status: posted.status, changedLines: changed, journalEntryId: journalId };
        await this.accounting.remember(tx, { userId: user.id, businessId, key, requestHash, response: result });
        await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "inventory.count.posted", entityType: "stock_count", entityId: count.id, requestId: request.requestId ?? "unknown", afterJson: result } });
        return result;
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (this.isUnique(error)) { const existing = await this.accounting.existingIdempotent(user.id, businessId, key, requestHash); if (existing) return existing; }
      throw error;
    }
  }

  private scope(user: AuthenticatedUser) { if (!user.businessId || !user.branchId) throw new BadRequestException("یک کسب‌وکار و شعبه را انتخاب کنید."); return { businessId: user.businessId, branchId: user.branchId }; }
  private requireRole(user: AuthenticatedUser, roles: string[]) { if (!roles.includes(user.role ?? "")) throw new ForbiddenException("برای مدیریت موجودی دسترسی ندارید."); }
  private date(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("تاریخ شمارش معتبر نیست."); const date = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException("تاریخ شمارش معتبر نیست."); return date; }
  private isUnique(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === "P2002"; }
}
