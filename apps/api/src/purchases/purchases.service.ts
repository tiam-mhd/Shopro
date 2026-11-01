import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingService, type JournalLineInput } from "../finance/accounting.service.js";
import { toAsciiDigits } from "@shopro/contracts";
import type { AuthenticatedUser, AppRequest } from "../common/request-context.js";
import type { CreatePurchaseDto, PostPurchaseDto } from "./purchases.dto.js";

const money = (value: string | undefined) => { if (!value) return 0n; if (!/^\d{1,20}$/.test(value)) throw new BadRequestException("مبلغ باید عدد صحیح ریال باشد."); return BigInt(value); };
const quantityMilli = (value: string) => { const normalized = toAsciiDigits(value).trim(); if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) throw new BadRequestException("تعداد حداکثر سه رقم اعشار دارد."); const [whole, fraction = ""] = normalized.split("."); const qty = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0")); if (qty <= 0n) throw new BadRequestException("تعداد باید بزرگ‌تر از صفر باشد."); return qty; };
const qtyText = (value: bigint) => `${value / 1000n}.${(value % 1000n).toString().padStart(3, "0")}`;
const extension = (qty: bigint, price: bigint) => (qty * price + 500n) / 1000n;
const tax = (base: bigint, rate: number) => (base * BigInt(rate) + 5000n) / 10000n;

@Injectable()
export class PurchasesService {
  constructor(private readonly prisma: PrismaService, private readonly accounting: AccountingService) {}

  async list(user: AuthenticatedUser) {
    const { businessId, branchId } = this.scope(user);
    const rows = await this.prisma.purchase.findMany({ where: { businessId, branchId }, include: { supplier: { select: { name: true } } }, orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }], take: 200 });
    return rows.map((row) => ({ id: row.id, purchaseNo: row.purchaseNo, date: row.txnDate.toISOString().slice(0, 10), supplier: row.supplier?.name ?? null, totalRial: row.totalRial.toString(), status: row.status }));
  }

  async create(user: AuthenticatedUser, dto: CreatePurchaseDto, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireRole(user);
    const date = this.date(dto.txnDate);
    if (dto.supplierId && !(await this.prisma.party.findFirst({ where: { id: dto.supplierId, businessId, archivedAt: null, type: { in: ["SUPPLIER", "BOTH"] } } }))) throw new BadRequestException("تأمین‌کننده انتخاب‌شده معتبر نیست.");
    const products = await this.prisma.product.findMany({ where: { id: { in: [...new Set(dto.lines.map((line) => line.productId))] }, businessId, isActive: true } });
    const byId = new Map(products.map((product) => [product.id, product]));
    if (byId.size !== new Set(dto.lines.map((line) => line.productId)).size) throw new BadRequestException("یک یا چند کالا پیدا نشد.");
    const lines = dto.lines.map((line) => {
      const product = byId.get(line.productId)!;
      const qty = quantityMilli(line.quantity);
      const cost = money(line.unitCostRial);
      const base = extension(qty, cost);
      const discount = money(line.discountRial);
      if (discount > base) throw new BadRequestException(`تخفیف «${product.name}» از مبلغ ردیف بیشتر است.`);
      const lineTax = tax(base - discount, product.taxRateBasisPoints);
      return { product, qty, cost, base, discount, tax: lineTax };
    });
    const subtotal = lines.reduce((sum, line) => sum + line.base, 0n);
    const discount = lines.reduce((sum, line) => sum + line.discount, 0n);
    const taxTotal = lines.reduce((sum, line) => sum + line.tax, 0n);
    const total = subtotal - discount + taxTotal;
    const row = await this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({ data: { businessId, branchId, supplierId: dto.supplierId ?? null, txnDate: date, note: dto.note?.trim() || null, subtotalRial: subtotal, discountRial: discount, taxRial: taxTotal, totalRial: total, lines: { create: lines.map((line) => ({ businessId, productId: line.product.id, descriptionSnapshot: line.product.name, quantity: new Prisma.Decimal(qtyText(line.qty)), unitCostRial: line.cost, discountRial: line.discount, taxRateBasisPoints: line.product.taxRateBasisPoints, taxRial: line.tax, lineTotalRial: line.base - line.discount + line.tax })) } } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "purchase.draft.created", entityType: "purchase", entityId: purchase.id, requestId: request.requestId ?? "unknown", afterJson: { supplierId: dto.supplierId ?? null, totalRial: total.toString() } } });
      return purchase;
    });
    return { id: row.id, status: row.status, totalRial: row.totalRial.toString() };
  }

  async post(user: AuthenticatedUser, id: string, dto: PostPurchaseDto, key?: string, request?: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireRole(user);
    if (!key || key.length > 128) throw new BadRequestException("هدر Idempotency-Key برای ثبت خرید الزامی است.");
    const requestHash = this.accounting.idempotencyHash({ id, payments: dto.payments ?? [] });
    const prior = await this.accounting.existingIdempotent(user.id, businessId, key, requestHash);
    if (prior) return prior;
    return this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findFirst({ where: { id, businessId, branchId }, include: { lines: { include: { product: true } } } });
      if (!purchase) throw new NotFoundException("پیش‌نویس خرید پیدا نشد.");
      if (purchase.status !== "DRAFT") throw new ConflictException("این خرید قبلاً ثبت نهایی شده است.");
      if (purchase.totalRial - purchase.taxRial > 0n && dto.payments?.length && !purchase.supplierId) throw new BadRequestException("برای خرید ترکیبی یا اعتباری، تأمین‌کننده را مشخص کنید.");
      await this.accounting.assertOpen(tx, businessId, purchase.txnDate);
      const payments = dto.payments ?? [];
      const amounts = payments.map((payment) => { const value = money(payment.amountRial); if (!value) throw new BadRequestException("مبلغ پرداخت باید بزرگ‌تر از صفر باشد."); return value; });
      const paid = amounts.reduce((sum, value) => sum + value, 0n);
      if (paid > purchase.totalRial) throw new BadRequestException("مبلغ پرداختی از جمع خرید بیشتر است.");
      const outstanding = purchase.totalRial - paid;
      if (outstanding > 0n && !purchase.supplierId) throw new BadRequestException("برای خرید پرداخت‌نشده، تأمین‌کننده را انتخاب کنید.");
      const accounts = await Promise.all(payments.map(async (payment) => {
        const account = await tx.financeAccount.findFirst({ where: { id: payment.financeAccountId, businessId, branchId, isActive: true } });
        if (!account) throw new BadRequestException("حساب پرداخت انتخاب‌شده معتبر نیست.");
        return account;
      }));
      const cashIds: string[] = [];
      for (let i = 0; i < payments.length; i++) {
        const cash = await tx.cashTransaction.create({ data: { businessId, branchId, kind: "PAYMENT", txnDate: purchase.txnDate, amountRial: amounts[i], fromAccountId: accounts[i].id, partyId: purchase.supplierId, method: payments[i].method, reference: purchase.purchaseNo, status: "POSTED", idempotencyKey: `purchase:${purchase.id}:${i}`, createdBy: user.id } });
        cashIds.push(cash.id);
      }

      const debitLines: JournalLineInput[] = [];
      const creditLines: JournalLineInput[] = [];
      const inputTax = purchase.taxRial > 0n ? await this.accounting.account(tx, businessId, "input_tax") : null;
      let inventoryValue = 0n;
      for (const line of purchase.lines) {
        const product = line.product;
        const qty = quantityMilli(line.quantity.toString());
        const lineValue = extension(qty, line.unitCostRial) - line.discountRial;
        if (product?.kind === "STOCK" && product.trackInventory) {
          const previous = await tx.inventoryBalance.findUnique({ where: { businessId_branchId_productId: { businessId, branchId, productId: product.id } } });
          const oldQty = previous ? quantityMilli(previous.quantityOnHand.toString()) : 0n;
          const newQty = oldQty + qty;
          const value = (previous?.inventoryValueRial ?? 0n) + lineValue;
          const average = newQty > 0n ? (value * 1000n + newQty / 2n) / newQty : 0n;
          await tx.inventoryBalance.upsert({ where: { businessId_branchId_productId: { businessId, branchId, productId: product.id } }, create: { businessId, branchId, productId: product.id, quantityOnHand: new Prisma.Decimal(qtyText(newQty)), inventoryValueRial: value, averageCostRial: average }, update: { quantityOnHand: new Prisma.Decimal(qtyText(newQty)), inventoryValueRial: value, averageCostRial: average } });
          await tx.inventoryMovement.create({ data: { businessId, branchId, productId: product.id, txnDate: purchase.txnDate, sourceType: "PURCHASE", sourceId: purchase.id, quantityDelta: new Prisma.Decimal(qtyText(qty)), unitCostRial: line.unitCostRial, valueDeltaRial: lineValue, createdBy: user.id } });
          await tx.product.update({ where: { id: product.id }, data: { defaultCostRial: average } });
          inventoryValue += lineValue;
        } else {
          debitLines.push({ ledgerAccountId: await this.accounting.account(tx, businessId, "general_expense"), debitRial: lineValue, description: line.descriptionSnapshot });
        }
      }
      if (inventoryValue > 0n) debitLines.push({ ledgerAccountId: await this.accounting.account(tx, businessId, "inventory"), debitRial: inventoryValue, description: "ورود کالا به انبار" });
      if (purchase.taxRial > 0n && inputTax) debitLines.push({ ledgerAccountId: inputTax, debitRial: purchase.taxRial, description: "مالیات خرید" });
      for (let i = 0; i < payments.length; i++) creditLines.push({ ledgerAccountId: accounts[i].ledgerAccountId, creditRial: amounts[i], description: `پرداخت از ${accounts[i].name}` });
      if (outstanding > 0n) creditLines.push({ ledgerAccountId: await this.accounting.account(tx, businessId, "accounts_payable"), creditRial: outstanding, partyId: purchase.supplierId, description: "ماندهٔ خرید" });

      const sequence = await tx.documentSequence.upsert({ where: { businessId_branchId_type: { businessId, branchId, type: "PURCHASE" } }, create: { businessId, branchId, type: "PURCHASE", nextValue: 2n }, update: { nextValue: { increment: 1n } }, select: { nextValue: true } });
      const purchaseNo = `P-${String(sequence.nextValue - 1n).padStart(6, "0")}`;
      const journal = await this.accounting.createJournal(tx, { businessId, branchId, date: purchase.txnDate, sourceType: "PURCHASE", sourceId: purchase.id, memo: `خرید ${purchaseNo}`, actorId: user.id, lines: [...debitLines, ...creditLines] });
      for (const cashId of cashIds) {
        await tx.cashTransaction.update({ where: { id: cashId }, data: { journalEntryId: journal.id } });
      }
      for (let i = 0; i < payments.length; i++) await tx.paymentAllocation.create({ data: { businessId, cashTransactionId: cashIds[i], purchaseId: purchase.id, amountRial: amounts[i] } });
      const posted = await tx.purchase.update({ where: { id: purchase.id }, data: { purchaseNo, status: "POSTED", postedAt: new Date(), postedBy: user.id, version: { increment: 1 } } });
      const result = { id: posted.id, purchaseNo, status: posted.status, totalRial: posted.totalRial.toString(), paidRial: paid.toString(), balanceRial: outstanding.toString(), journalEntryId: journal.id };
      await this.accounting.remember(tx, { userId: user.id, businessId, key, requestHash, response: result });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "purchase.posted", entityType: "purchase", entityId: posted.id, requestId: request?.requestId ?? "unknown", afterJson: { ...result, supplierId: posted.supplierId } } });
      return result;
    }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 30000 });
  }

  private scope(user: AuthenticatedUser) { if (!user.businessId || !user.branchId) throw new BadRequestException("یک کسب‌وکار و شعبه را انتخاب کنید."); return { businessId: user.businessId, branchId: user.branchId }; }
  private requireRole(user: AuthenticatedUser) { if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException("اجازهٔ ثبت خرید را ندارید."); }
  private date(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("تاریخ سند معتبر نیست."); const date = new Date(`${value}T00:00:00.000Z`); if (date.toISOString().slice(0, 10) !== value) throw new BadRequestException("تاریخ سند معتبر نیست."); return date; }
}
