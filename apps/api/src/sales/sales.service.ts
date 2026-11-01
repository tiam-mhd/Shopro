import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingService, type JournalLineInput } from "../finance/accounting.service.js";
import { normalizePersianSearch, toAsciiDigits } from "@shopro/contracts";
import type { AuthenticatedUser, AppRequest } from "../common/request-context.js";
import type { CreateSalesDto, CreateSalesReturnDto, PostSalesDto, SalesLineDto, VoidSalesDto } from "./sales.dto.js";

const money = (value: string | undefined) => {
  if (!value) return 0n;
  if (!/^\d{1,20}$/.test(value)) throw new BadRequestException("مبلغ باید عدد صحیح ریال باشد.");
  return BigInt(value);
};
const quantityMilli = (value: string) => {
  const normalized = toAsciiDigits(value).replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) throw new BadRequestException("تعداد باید مثبت و حداکثر سه رقم اعشار داشته باشد.");
  const [whole, fraction = ""] = normalized.split(".");
  const quantity = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  if (quantity <= 0n) throw new BadRequestException("تعداد باید بزرگ‌تر از صفر باشد.");
  return quantity;
};
const quantityText = (milli: bigint) => `${milli < 0n ? "-" : ""}${(milli < 0n ? -milli : milli) / 1000n}.${((milli < 0n ? -milli : milli) % 1000n).toString().padStart(3, "0")}`;
const signedQuantityMilli = (value: string) => {
  const normalized = toAsciiDigits(value).replace(/,/g, "").trim();
  if (!/^-?\d+(?:\.\d{1,3})?$/.test(normalized)) throw new BadRequestException("موجودی ثبت‌شده معتبر نیست.");
  const negative = normalized.startsWith("-");
  const [whole, fraction = ""] = (negative ? normalized.slice(1) : normalized).split(".");
  const result = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  return negative ? -result : result;
};
const roundedDivide = (numerator: bigint, denominator: bigint) => numerator >= 0n ? (numerator + denominator / 2n) / denominator : -((-numerator + denominator / 2n) / denominator);
const extensionRial = (qtyMilli: bigint, unitRial: bigint) => (qtyMilli * unitRial + 500n) / 1000n;
const taxRial = (baseRial: bigint, basisPoints: number) => (baseRial * BigInt(basisPoints) + 5000n) / 10000n;

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService, private readonly accounting: AccountingService) {}

  async list(user: AuthenticatedUser, search?: string, status?: string) {
    const { businessId, branchId } = this.scope(user);
    const q = search ? normalizePersianSearch(search) : undefined;
    const rows = await this.prisma.salesInvoice.findMany({ where: { businessId, branchId, ...(status && ["DRAFT", "POSTED", "VOIDED"].includes(status) ? { status: status as "DRAFT" | "POSTED" | "VOIDED" } : {}), ...(q ? { OR: [{ invoiceNo: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }] } : {}) }, include: { customer: { select: { name: true } } }, orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }], take: 200 });
    return rows.map((row) => ({ id: row.id, invoiceNo: row.invoiceNo, date: row.txnDate.toISOString().slice(0, 10), customer: row.customer?.name ?? null, subtotalRial: row.subtotalRial.toString(), discountRial: row.discountRial.toString(), taxRial: row.taxRial.toString(), totalRial: row.totalRial.toString(), status: row.status, documentType: row.returnOfId ? "RETURN" : "SALE", returnReason: row.returnReason }));
  }

  async get(user: AuthenticatedUser, id: string) {
    const { businessId, branchId } = this.scope(user);
    const invoice = await this.prisma.salesInvoice.findFirst({ where: { id, businessId, branchId }, include: { customer: { select: { id: true, name: true, phone: true } }, lines: { include: { product: { select: { kind: true, trackInventory: true } } } }, allocations: { include: { cashTransaction: { select: { amountRial: true, method: true } } } }, returns: { where: { status: "POSTED" }, include: { lines: true }, orderBy: { txnDate: "desc" } }, returnOf: { select: { id: true, invoiceNo: true } } } });
    if (!invoice) throw new NotFoundException("فاکتور پیدا نشد.");
    const returned = new Map<string, { quantity: bigint; discount: bigint; tax: bigint }>();
    for (const returnInvoice of invoice.returns) for (const line of returnInvoice.lines) if (line.returnOfLineId) {
      const prior = returned.get(line.returnOfLineId) ?? { quantity: 0n, discount: 0n, tax: 0n };
      returned.set(line.returnOfLineId, { quantity: prior.quantity + signedQuantityMilli(line.quantity.toString()), discount: prior.discount - line.discountRial, tax: prior.tax - line.taxRial });
    }
    return { id: invoice.id, invoiceNo: invoice.invoiceNo, date: invoice.txnDate.toISOString().slice(0, 10), customerId: invoice.customerId, customer: invoice.customer, status: invoice.status, documentType: invoice.returnOfId ? "RETURN" : "SALE", returnOf: invoice.returnOf, returnReason: invoice.returnReason, subtotalRial: invoice.subtotalRial.toString(), discountRial: invoice.discountRial.toString(), taxRial: invoice.taxRial.toString(), totalRial: invoice.totalRial.toString(), note: invoice.note, lines: invoice.lines.map((line) => { const prior = returned.get(line.id); return { id: line.id, productId: line.productId, description: line.descriptionSnapshot, sku: line.skuSnapshot, quantity: line.quantity.toString(), returnedQuantity: (prior?.quantity ?? 0n).toString(), returnedDiscountRial: (prior?.discount ?? 0n).toString(), returnedTaxRial: (prior?.tax ?? 0n).toString(), restockAllowed: line.product?.kind === "STOCK" && line.product.trackInventory, unitCode: line.unitCodeSnapshot, unitPriceRial: line.unitPriceRial.toString(), discountRial: line.discountRial.toString(), taxRateBasisPoints: line.taxRateBasisPoints, taxRial: line.taxRial.toString(), totalRial: line.lineTotalRial.toString(), cogsRial: line.cogsRial?.toString() ?? null }; }), payments: invoice.allocations.map((allocation) => ({ amountRial: allocation.amountRial.toString(), method: allocation.cashTransaction.method })), returns: invoice.returnOfId ? [] : invoice.returns.map((row) => ({ id: row.id, invoiceNo: row.invoiceNo, date: row.txnDate.toISOString().slice(0, 10), reason: row.returnReason, totalRial: row.totalRial.toString(), lines: row.lines.length })) };
  }

  async returnSale(user: AuthenticatedUser, id: string, dto: CreateSalesReturnDto, key: string | undefined, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException("ثبت برگشت فروش برای نقش شما مجاز نیست.");
    if (!key || key.length > 128) throw new BadRequestException("هدر Idempotency-Key برای برگشت فروش الزامی است.");
    if (new Set(dto.lines.map((line) => line.invoiceLineId)).size !== dto.lines.length) throw new BadRequestException("هر ردیف فاکتور را فقط یک بار در فرم برگشت انتخاب کنید.");
    const reason = dto.reason.trim();
    const requestHash = this.accounting.idempotencyHash({ invoiceId: id, ...dto, reason, action: "sale-return" });
    const previous = await this.accounting.existingIdempotent(user.id, businessId, key, requestHash);
    if (previous) return previous;
    const date = this.date(dto.txnDate);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const invoice = await tx.salesInvoice.findFirst({ where: { id, businessId, branchId }, include: { lines: true } });
        if (!invoice) throw new NotFoundException("فاکتور فروش پیدا نشد.");
        if (invoice.status !== "POSTED" || invoice.returnOfId) throw new ConflictException("برگشت فقط برای فاکتور فروش ثبت‌شده مجاز است.");
        await this.accounting.assertOpen(tx, businessId, date);
        const originalLines = new Map(invoice.lines.map((line) => [line.id, line]));
        const previousLines = await tx.salesInvoiceLine.findMany({
          where: { businessId, returnOfLineId: { in: dto.lines.map((line) => line.invoiceLineId) }, invoice: { returnOfId: invoice.id, status: "POSTED" } },
          select: { returnOfLineId: true, quantity: true, discountRial: true, taxRial: true },
        });
        const previousQuantity = new Map<string, bigint>(); const previousDiscount = new Map<string, bigint>(); const previousTax = new Map<string, bigint>();
        for (const previousLine of previousLines) {
          if (!previousLine.returnOfLineId) continue;
          const lineId = previousLine.returnOfLineId;
          previousQuantity.set(lineId, (previousQuantity.get(lineId) ?? 0n) + signedQuantityMilli(previousLine.quantity.toString()));
          previousDiscount.set(lineId, (previousDiscount.get(lineId) ?? 0n) - previousLine.discountRial);
          previousTax.set(lineId, (previousTax.get(lineId) ?? 0n) - previousLine.taxRial);
        }
        const lines = dto.lines.map((input) => {
          const original = originalLines.get(input.invoiceLineId);
          if (!original) throw new BadRequestException("یک ردیف انتخابی متعلق به این فاکتور نیست.");
          const quantity = quantityMilli(input.quantity);
          const originalQuantity = quantityMilli(original.quantity.toString());
          const alreadyReturned = previousQuantity.get(original.id) ?? 0n;
          const remaining = originalQuantity - alreadyReturned;
          if (quantity > remaining) throw new ConflictException(`تعداد برگشت «${original.descriptionSnapshot}» از مقدار باقی‌مانده بیشتر است.`);
          const completesRemaining = quantity === remaining;
          const base = extensionRial(quantity, original.unitPriceRial);
          const discount = completesRemaining ? original.discountRial - (previousDiscount.get(original.id) ?? 0n) : roundedDivide(original.discountRial * quantity, originalQuantity);
          const taxable = base - discount;
          const tax = completesRemaining ? original.taxRial - (previousTax.get(original.id) ?? 0n) : taxRial(taxable, original.taxRateBasisPoints);
          const total = taxable + tax;
          const cogs = original.cogsRial === null ? null : roundedDivide(original.cogsRial * quantity, originalQuantity);
          if (total <= 0n) throw new BadRequestException("مبلغ ردیف انتخابی برای برگشت معتبر نیست.");
          if (input.restock && (!original.productId || cogs === null)) throw new BadRequestException("بازگشت به انبار برای این ردیف فعال نیست.");
          return { input, original, quantity, base, discount, tax, total, cogs };
        });
        const total = lines.reduce((sum, line) => sum + line.total, 0n);
        const cashRefund = dto.cashRefundRial === undefined ? (invoice.customerId ? 0n : total) : money(dto.cashRefundRial);
        if (cashRefund > total) throw new BadRequestException("مبلغ بازپرداخت نقدی از مبلغ برگشت بیشتر است.");
        if (!invoice.customerId && cashRefund !== total) throw new BadRequestException("برای فاکتور بدون مشتری، مبلغ برگشت باید کامل به حساب پرداخت شود.");
        if (cashRefund > 0n && !dto.refundFinanceAccountId) throw new BadRequestException("حساب پرداخت مبلغ برگشت را انتخاب کنید.");
        const refundAccount = cashRefund > 0n ? await tx.financeAccount.findFirst({ where: { id: dto.refundFinanceAccountId, businessId, branchId, isActive: true } }) : null;
        if (cashRefund > 0n && !refundAccount) throw new BadRequestException("حساب پرداخت انتخاب‌شده معتبر نیست.");

        const sequence = await tx.documentSequence.upsert({ where: { businessId_branchId_type: { businessId, branchId, type: "RETURN" } }, create: { businessId, branchId, type: "RETURN", nextValue: 2n }, update: { nextValue: { increment: 1n } }, select: { nextValue: true } });
        const returnNo = `R-${String(sequence.nextValue - 1n).padStart(6, "0")}`;
        const subtotal = lines.reduce((sum, line) => sum + line.base, 0n);
        const discountTotal = lines.reduce((sum, line) => sum + line.discount, 0n);
        const taxTotal = lines.reduce((sum, line) => sum + line.tax, 0n);
        const returnInvoice = await tx.salesInvoice.create({ data: {
          businessId, branchId, customerId: invoice.customerId, invoiceNo: returnNo, txnDate: date, status: "POSTED",
          subtotalRial: -subtotal, discountRial: -discountTotal, taxRial: -taxTotal, totalRial: -total,
          note: reason, returnOfId: invoice.id, returnReason: reason, postedAt: new Date(), postedBy: user.id,
          lines: { create: lines.map(({ input, original, quantity, discount, tax, total: lineTotal, cogs }) => ({
            businessId, returnOfLineId: original.id, productId: original.productId, descriptionSnapshot: original.descriptionSnapshot, skuSnapshot: original.skuSnapshot,
            quantity: new Prisma.Decimal(quantityText(quantity)), unitCodeSnapshot: original.unitCodeSnapshot, unitPriceRial: original.unitPriceRial,
            discountRial: -discount, taxRateBasisPoints: original.taxRateBasisPoints, taxRial: -tax, lineTotalRial: -lineTotal,
            cogsRial: cogs === null ? null : input.restock ? -cogs : 0n,
          })) },
        } });
        const revenueAccount = await this.accounting.account(tx, businessId, "sales_revenue");
        const taxAccount = await this.accounting.account(tx, businessId, "output_tax");
        const receivableAccount = invoice.customerId ? await this.accounting.account(tx, businessId, "accounts_receivable") : null;
        const journalLines: JournalLineInput[] = [];
        for (const line of lines) {
          const revenue = line.base - line.discount;
          if (revenue > 0n) journalLines.push({ ledgerAccountId: revenueAccount, debitRial: revenue, description: `برگشت فروش ${line.original.descriptionSnapshot}` });
          if (line.tax > 0n) journalLines.push({ ledgerAccountId: taxAccount, debitRial: line.tax, description: "برگشت مالیات فروش" });
        }
        if (cashRefund > 0n && refundAccount) journalLines.push({ ledgerAccountId: refundAccount.ledgerAccountId, creditRial: cashRefund, description: `بازپرداخت برگشت ${returnNo}` });
        const creditBalance = total - cashRefund;
        if (creditBalance > 0n && receivableAccount && invoice.customerId) journalLines.push({ ledgerAccountId: receivableAccount, creditRial: creditBalance, partyId: invoice.customerId, description: `بستانکاری بابت برگشت ${returnNo}` });
        const restocked = lines.filter((line) => line.input.restock && line.cogs !== null && line.original.productId);
        const inventoryAccount = restocked.length ? await this.accounting.account(tx, businessId, "inventory") : null;
        const cogsAccount = restocked.length ? await this.accounting.account(tx, businessId, "cost_of_goods") : null;
        for (const line of restocked) {
          const cogs = line.cogs!;
          if (cogs > 0n && inventoryAccount && cogsAccount) journalLines.push({ ledgerAccountId: inventoryAccount, debitRial: cogs, description: `بازگشت به انبار ${line.original.descriptionSnapshot}` }, { ledgerAccountId: cogsAccount, creditRial: cogs, description: `برگشت بهای تمام‌شده ${line.original.descriptionSnapshot}` });
          const productId = line.original.productId!;
          const balance = await tx.inventoryBalance.findUnique({ where: { businessId_branchId_productId: { businessId, branchId, productId } } });
          const currentQuantity = balance ? signedQuantityMilli(balance.quantityOnHand.toString()) : 0n;
          const nextQuantity = currentQuantity + line.quantity;
          const nextValue = (balance?.inventoryValueRial ?? 0n) + cogs;
          const nextAverage = nextQuantity > 0n ? roundedDivide(nextValue * 1000n, nextQuantity) : 0n;
          await tx.inventoryBalance.upsert({ where: { businessId_branchId_productId: { businessId, branchId, productId } }, create: { businessId, branchId, productId, quantityOnHand: new Prisma.Decimal(quantityText(nextQuantity)), inventoryValueRial: nextValue, averageCostRial: nextAverage }, update: { quantityOnHand: new Prisma.Decimal(quantityText(nextQuantity)), inventoryValueRial: nextValue, averageCostRial: nextAverage } });
          await tx.inventoryMovement.create({ data: { businessId, branchId, productId, txnDate: date, sourceType: "SALE_RETURN", sourceId: returnInvoice.id, quantityDelta: new Prisma.Decimal(quantityText(line.quantity)), unitCostRial: roundedDivide(cogs * 1000n, line.quantity), valueDeltaRial: cogs, createdBy: user.id } });
        }
        const journal = await this.accounting.createJournal(tx, { businessId, branchId, date, sourceType: "SALE_RETURN", sourceId: returnInvoice.id, memo: `برگشت ${invoice.invoiceNo}: ${reason}`, actorId: user.id, lines: journalLines });
        if (cashRefund > 0n && refundAccount) {
          const cash = await tx.cashTransaction.create({ data: { businessId, branchId, kind: "PAYMENT", txnDate: date, amountRial: cashRefund, fromAccountId: refundAccount.id, partyId: invoice.customerId, method: dto.refundMethod ?? "CASH", reference: returnNo, journalEntryId: journal.id, idempotencyKey: `sale-return:${returnInvoice.id}`, createdBy: user.id } });
          await tx.paymentAllocation.create({ data: { businessId, cashTransactionId: cash.id, salesInvoiceId: returnInvoice.id, amountRial: cashRefund } });
        }
        const result = { id: returnInvoice.id, invoiceNo: returnNo, originalInvoiceId: invoice.id, status: "POSTED", totalRial: (-total).toString(), cashRefundRial: cashRefund.toString(), journalEntryId: journal.id };
        await this.accounting.remember(tx, { userId: user.id, businessId, key, requestHash, response: result });
        await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "sales.return.posted", entityType: "sales_invoice", entityId: returnInvoice.id, requestId: request.requestId ?? "unknown", afterJson: { ...result, reason, lines: lines.map((line) => ({ invoiceLineId: line.original.id, quantity: quantityText(line.quantity), restock: line.input.restock })) } } });
        return result;
      }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 30000 });
    } catch (error) {
      if (this.isUnique(error)) { const prior = await this.accounting.existingIdempotent(user.id, businessId, key, requestHash); if (prior) return prior; }
      throw error;
    }
  }

  async createDraft(user: AuthenticatedUser, dto: CreateSalesDto, key: string | undefined, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    if (!["OWNER", "MANAGER", "ACCOUNTANT", "CASHIER"].includes(user.role ?? "")) throw new ForbiddenException();
    if (!key || key.length > 128) throw new BadRequestException("هدر Idempotency-Key برای ساخت پیش‌نویس فروش الزامی است.");
    const requestHash = this.accounting.idempotencyHash(dto);
    const previous = await this.accounting.existingIdempotent(user.id, businessId, key, requestHash);
    if (previous) return previous;
    const date = this.date(dto.txnDate);
    if (dto.customerId && !(await this.prisma.party.findFirst({ where: { id: dto.customerId, businessId, archivedAt: null, type: { in: ["CUSTOMER", "BOTH"] } } }))) throw new BadRequestException("مشتری انتخاب‌شده معتبر نیست.");
    const products = await this.prisma.product.findMany({ where: { id: { in: [...new Set(dto.lines.map((line) => line.productId))] }, businessId, isActive: true }, include: { unit: true } });
    const productMap = new Map(products.map((product) => [product.id, product]));
    if (productMap.size !== new Set(dto.lines.map((line) => line.productId)).size) throw new BadRequestException("یک یا چند کالا/خدمت پیدا نشد.");
    const lines = dto.lines.map((line) => this.calculateDraftLine(user, line, productMap.get(line.productId)!));
    const subtotal = lines.reduce((sum, line) => sum + line.base, 0n);
    const discounts = lines.reduce((sum, line) => sum + line.discount, 0n);
    const tax = lines.reduce((sum, line) => sum + line.tax, 0n);
    const total = subtotal - discounts + tax;
    const invoiceLines: Prisma.SalesInvoiceLineUncheckedCreateWithoutInvoiceInput[] = lines.map((line) => ({
      productId: line.productId,
      descriptionSnapshot: line.product.name,
      skuSnapshot: line.product.sku,
      quantity: new Prisma.Decimal(quantityText(line.qtyMilli)),
      unitCodeSnapshot: line.product.unit.code,
      unitPriceRial: line.price,
      discountRial: line.discount,
      taxRateBasisPoints: line.product.taxRateBasisPoints,
      taxRial: line.tax,
      lineTotalRial: line.base - line.discount + line.tax,
    }));
    try {
    return await this.prisma.$transaction(async (tx) => {
      const row = await tx.salesInvoice.create({
        data: {
          businessId, branchId, customerId: dto.customerId ?? null, txnDate: date, note: dto.note?.trim() || null,
          subtotalRial: subtotal, discountRial: discounts, taxRial: tax, totalRial: total,
          lines: { create: invoiceLines },
        },
      });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "sales.draft.created", entityType: "sales_invoice", entityId: row.id, requestId: request.requestId ?? "unknown", afterJson: { customerId: dto.customerId ?? null, totalRial: total.toString(), lineCount: lines.length } } });
      const result = { id: row.id, status: row.status, subtotalRial: subtotal.toString(), discountRial: discounts.toString(), taxRial: tax.toString(), totalRial: total.toString() };
      await this.accounting.remember(tx, { userId: user.id, businessId, key, requestHash, response: result });
      return result;
    }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (this.isUnique(error)) {
        const prior = await this.accounting.existingIdempotent(user.id, businessId, key, requestHash);
        if (prior) return prior;
      }
      throw error;
    }
  }

  async updateDraft(user: AuthenticatedUser, id: string, dto: CreateSalesDto, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    if (!["OWNER", "MANAGER", "ACCOUNTANT", "CASHIER"].includes(user.role ?? "")) throw new ForbiddenException();
    const before = await this.prisma.salesInvoice.findFirst({ where: { id, businessId, branchId, status: "DRAFT", returnOfId: null }, include: { lines: true } });
    if (!before) throw new NotFoundException("پیش‌نویس فروش پیدا نشد.");
    const date = this.date(dto.txnDate);
    if (dto.customerId && !(await this.prisma.party.findFirst({ where: { id: dto.customerId, businessId, archivedAt: null, type: { in: ["CUSTOMER", "BOTH"] } } }))) throw new BadRequestException("مشتری انتخاب‌شده معتبر نیست.");
    const products = await this.prisma.product.findMany({ where: { id: { in: [...new Set(dto.lines.map((line) => line.productId))] }, businessId, isActive: true }, include: { unit: true } });
    const productMap = new Map(products.map((product) => [product.id, product]));
    if (productMap.size !== new Set(dto.lines.map((line) => line.productId)).size) throw new BadRequestException("یک یا چند کالا/خدمت پیدا نشد.");
    const lines = dto.lines.map((line) => this.calculateDraftLine(user, line, productMap.get(line.productId)!));
    const subtotal = lines.reduce((sum, line) => sum + line.base, 0n);
    const discounts = lines.reduce((sum, line) => sum + line.discount, 0n);
    const tax = lines.reduce((sum, line) => sum + line.tax, 0n);
    const total = subtotal - discounts + tax;
    const invoiceLines: Prisma.SalesInvoiceLineUncheckedCreateWithoutInvoiceInput[] = lines.map((line) => ({
      productId: line.productId,
      descriptionSnapshot: line.product.name,
      skuSnapshot: line.product.sku,
      quantity: new Prisma.Decimal(quantityText(line.qtyMilli)),
      unitCodeSnapshot: line.product.unit.code,
      unitPriceRial: line.price,
      discountRial: line.discount,
      taxRateBasisPoints: line.product.taxRateBasisPoints,
      taxRial: line.tax,
      lineTotalRial: line.base - line.discount + line.tax,
    }));
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.salesInvoice.findFirst({ where: { id, businessId, branchId, status: "DRAFT", returnOfId: null }, select: { id: true } });
      if (!current) throw new ConflictException("وضعیت فاکتور تغییر کرده است؛ فهرست را تازه کنید.");
      await tx.salesInvoiceLine.deleteMany({ where: { businessId, invoiceId: id } });
      const updated = await tx.salesInvoice.update({ where: { id }, data: {
        customerId: dto.customerId ?? null, txnDate: date, note: dto.note?.trim() || null,
        subtotalRial: subtotal, discountRial: discounts, taxRial: tax, totalRial: total, version: { increment: 1 },
        lines: { create: invoiceLines },
      } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "sales.draft.updated", entityType: "sales_invoice", entityId: id, requestId: request.requestId ?? "unknown", beforeJson: { totalRial: before.totalRial.toString(), lineCount: before.lines.length }, afterJson: { totalRial: total.toString(), lineCount: lines.length, customerId: dto.customerId ?? null } } });
      return { id: updated.id, status: updated.status, subtotalRial: subtotal.toString(), discountRial: discounts.toString(), taxRial: tax.toString(), totalRial: total.toString() };
    }, { isolationLevel: "Serializable" });
  }

  async post(user: AuthenticatedUser, id: string, dto: PostSalesDto, key?: string, request?: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    if (!["OWNER", "MANAGER", "ACCOUNTANT", "CASHIER"].includes(user.role ?? "")) throw new ForbiddenException();
    if (!key || key.length > 128) throw new BadRequestException("هدر Idempotency-Key برای ثبت فروش الزامی است.");
    const payload = { id, payments: dto.payments ?? [] };
    const requestHash = this.accounting.idempotencyHash(payload);
    const previous = await this.accounting.existingIdempotent(user.id, businessId, key, requestHash);
    if (previous) return previous;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const invoice = await tx.salesInvoice.findFirst({ where: { id, businessId, branchId }, include: { lines: { include: { product: { include: { unit: true } } } }, customer: true } });
        if (!invoice) throw new NotFoundException("پیش‌نویس فروش پیدا نشد.");
        if (invoice.status !== "DRAFT") throw new ConflictException("این فاکتور قبلاً ثبت یا باطل شده است.");
        if (invoice.totalRial < 0n) throw new BadRequestException("مبلغ فاکتور معتبر نیست.");
        await this.accounting.assertOpen(tx, businessId, invoice.txnDate);
        const payments = dto.payments ?? [];
        const paymentAmounts = payments.map((payment) => {
          if (!/^\d{1,20}$/.test(payment.amountRial)) throw new BadRequestException("مبلغ پرداخت معتبر نیست.");
          const amount = BigInt(payment.amountRial);
          if (amount <= 0n) throw new BadRequestException("مبلغ پرداخت باید بزرگ‌تر از صفر باشد.");
          return amount;
        });
        const paid = paymentAmounts.reduce((sum, amount) => sum + amount, 0n);
        if (paid > invoice.totalRial) throw new BadRequestException("مبلغ دریافتی از جمع فاکتور بیشتر است.");
        const outstanding = invoice.totalRial - paid;
        if (outstanding > 0n && !invoice.customerId) throw new BadRequestException("برای فروش اعتباری یا پرداخت‌نشده، مشتری را مشخص کنید.");

        const revenueLines: JournalLineInput[] = [];
        let cogs = 0n;
        for (const line of invoice.lines) {
          const product = line.product;
          if (!product || product.kind !== "STOCK" || !product.trackInventory || !product.businessId || !product) continue;
          const qtyMilli = quantityMilli(line.quantity.toString());
          const balance = await tx.inventoryBalance.findUnique({ where: { businessId_branchId_productId: { businessId, branchId, productId: product.id } } });
          const onHandMilli = balance ? quantityMilli(balance.quantityOnHand.toString()) : 0n;
          if (!invoice.businessId || !product.trackInventory) continue;
          const business = await tx.business.findUniqueOrThrow({ where: { id: businessId }, select: { inventoryEnabled: true, negativeStockAllowed: true } });
          if (business.inventoryEnabled && !business.negativeStockAllowed && onHandMilli < qtyMilli) throw new ConflictException(`موجودی «${product.name}» برای این فروش کافی نیست.`);
          if (business.inventoryEnabled) {
            const avgCost = balance?.averageCostRial ?? product.defaultCostRial ?? 0n;
            const lineCogs = extensionRial(qtyMilli, avgCost);
            cogs += lineCogs;
            const nextQtyMilli = onHandMilli - qtyMilli;
            const nextValue = (balance?.inventoryValueRial ?? 0n) - lineCogs;
            const nextAvg = nextQtyMilli > 0n ? (nextValue * 1000n + nextQtyMilli / 2n) / nextQtyMilli : 0n;
            await tx.inventoryBalance.upsert({
              where: { businessId_branchId_productId: { businessId, branchId, productId: product.id } },
              create: { businessId, branchId, productId: product.id, quantityOnHand: new Prisma.Decimal(quantityText(nextQtyMilli)), inventoryValueRial: nextValue, averageCostRial: nextAvg },
              update: { quantityOnHand: new Prisma.Decimal(quantityText(nextQtyMilli)), inventoryValueRial: nextValue, averageCostRial: nextAvg },
            });
            await tx.inventoryMovement.create({ data: { businessId, branchId, productId: product.id, txnDate: invoice.txnDate, sourceType: "SALE", sourceId: invoice.id, quantityDelta: new Prisma.Decimal(quantityText(-qtyMilli)), unitCostRial: avgCost, valueDeltaRial: -lineCogs, createdBy: user.id } });
            await tx.salesInvoiceLine.update({ where: { id: line.id }, data: { cogsRial: lineCogs } });
          }
        }

        const accounts = await Promise.all(payments.map(async (payment) => {
          const account = await tx.financeAccount.findFirst({ where: { id: payment.financeAccountId, businessId, branchId, isActive: true } });
          if (!account) throw new BadRequestException("حساب دریافت انتخاب‌شده معتبر نیست.");
          return account;
        }));
        const debitLines: JournalLineInput[] = [];
        if (outstanding > 0n) debitLines.push({ ledgerAccountId: await this.accounting.account(tx, businessId, "accounts_receivable"), debitRial: outstanding, partyId: invoice.customerId, description: "ماندهٔ فاکتور" });
        payments.forEach((payment, index) => debitLines.push({ ledgerAccountId: accounts[index].ledgerAccountId, debitRial: paymentAmounts[index], description: `دریافت به ${accounts[index].name}` }));
        const creditLines: JournalLineInput[] = [];
        const revenue = invoice.subtotalRial - invoice.discountRial;
        if (revenue > 0n) creditLines.push({ ledgerAccountId: await this.accounting.account(tx, businessId, "sales_revenue"), creditRial: revenue, description: "درآمد فروش" });
        if (invoice.taxRial > 0n) creditLines.push({ ledgerAccountId: await this.accounting.account(tx, businessId, "output_tax"), creditRial: invoice.taxRial, description: "مالیات فروش" });
        if (cogs > 0n) {
          debitLines.push({ ledgerAccountId: await this.accounting.account(tx, businessId, "cost_of_goods"), debitRial: cogs, description: "بهای تمام‌شدهٔ فروش" });
          creditLines.push({ ledgerAccountId: await this.accounting.account(tx, businessId, "inventory"), creditRial: cogs, description: "خروج از موجودی" });
        }
        const journal = await this.accounting.createJournal(tx, { businessId, branchId, date: invoice.txnDate, sourceType: "SALE", sourceId: invoice.id, memo: `فروش ${invoice.invoiceNo ?? "پیش‌نویس"}`, actorId: user.id, lines: [...debitLines, ...creditLines] });
        for (let index = 0; index < payments.length; index++) {
          const payment = payments[index];
          const cash = await tx.cashTransaction.create({ data: { businessId, branchId, kind: "RECEIPT", txnDate: invoice.txnDate, amountRial: paymentAmounts[index], toAccountId: accounts[index].id, partyId: invoice.customerId, method: payment.method, reference: invoice.invoiceNo, status: "POSTED", journalEntryId: journal.id, idempotencyKey: `sale:${invoice.id}:${index}`, createdBy: user.id } });
          await tx.paymentAllocation.create({ data: { businessId, cashTransactionId: cash.id, salesInvoiceId: invoice.id, amountRial: paymentAmounts[index] } });
        }
        const sequence = await tx.documentSequence.upsert({ where: { businessId_branchId_type: { businessId, branchId, type: "SALE" } }, create: { businessId, branchId, type: "SALE", nextValue: 2n }, update: { nextValue: { increment: 1n } }, select: { nextValue: true } });
        const invoiceNo = `S-${String(sequence.nextValue - 1n).padStart(6, "0")}`;
        const posted = await tx.salesInvoice.update({ where: { id: invoice.id }, data: { invoiceNo, status: "POSTED", postedAt: new Date(), postedBy: user.id, version: { increment: 1 } } });
        const result = { id: posted.id, invoiceNo, status: posted.status, totalRial: posted.totalRial.toString(), paidRial: paid.toString(), balanceRial: outstanding.toString(), journalEntryId: journal.id };
        await this.accounting.remember(tx, { userId: user.id, businessId, key, requestHash, response: result });
        await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "sales.posted", entityType: "sales_invoice", entityId: posted.id, requestId: request?.requestId ?? "unknown", afterJson: { ...result, customerId: posted.customerId } } });
        return result;
      }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 30000 });
    } catch (error) {
      if (this.isUnique(error)) throw new ConflictException("درخواست تکراری بود؛ وضعیت فاکتور را تازه‌سازی کنید.");
      throw error;
    }
  }

  async void(user: AuthenticatedUser, id: string, dto: VoidSalesDto, key: string | undefined, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException("ابطال فاکتور برای نقش شما مجاز نیست.");
    if (!key || key.length > 128) throw new BadRequestException("هدر Idempotency-Key برای ابطال فاکتور الزامی است.");
    const reason = dto.reason.trim();
    if (reason.length < 3) throw new BadRequestException("دلیل ابطال را وارد کنید.");
    const requestHash = this.accounting.idempotencyHash({ id, reason, action: "void-sale" });
    const previous = await this.accounting.existingIdempotent(user.id, businessId, key, requestHash);
    if (previous) return previous;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const invoice = await tx.salesInvoice.findFirst({ where: { id, businessId, branchId }, select: { id: true, invoiceNo: true, txnDate: true, status: true, totalRial: true, customerId: true, returnOfId: true } });
        if (!invoice) throw new NotFoundException("فاکتور پیدا نشد.");
        if (invoice.status === "VOIDED") throw new ConflictException("این فاکتور پیش‌تر باطل شده است.");

        let reversalJournalId: string | null = null;
        if (invoice.status === "POSTED") {
          await this.accounting.assertOpen(tx, businessId, invoice.txnDate);
          const sourceType = invoice.returnOfId ? "SALE_RETURN" : "SALE";
          const voidSourceType = invoice.returnOfId ? "SALE_RETURN_VOID" : "SALE_VOID";
          const original = await tx.journalEntry.findFirst({ where: { businessId, sourceType, sourceId: invoice.id, status: "POSTED" }, include: { lines: true } });
          if (!original || !original.lines.length) throw new ConflictException("سند حسابداری فاکتور برای ابطال پیدا نشد.");
          const reversal = await this.accounting.createJournal(tx, {
            businessId, branchId, date: invoice.txnDate, sourceType: voidSourceType, sourceId: invoice.id,
            reversalOfId: original.id, memo: `ابطال فاکتور ${invoice.invoiceNo ?? invoice.id}: ${reason}`, actorId: user.id,
            lines: original.lines.map((line) => ({ ledgerAccountId: line.ledgerAccountId, debitRial: line.creditRial, creditRial: line.debitRial, partyId: line.partyId, description: `برگشت ابطال: ${line.description ?? ""}` })),
          });
          reversalJournalId = reversal.id;

          const movements = await tx.inventoryMovement.findMany({ where: { businessId, branchId, sourceType, sourceId: invoice.id } });
          const stockPolicy = invoice.returnOfId ? await tx.business.findUnique({ where: { id: businessId }, select: { negativeStockAllowed: true } }) : null;
          const byProduct = new Map<string, { quantity: bigint; value: bigint; unitCost: bigint }>();
          for (const movement of movements) {
            const quantity = signedQuantityMilli(movement.quantityDelta.toString());
            const prior = byProduct.get(movement.productId) ?? { quantity: 0n, value: 0n, unitCost: movement.unitCostRial };
            byProduct.set(movement.productId, { quantity: prior.quantity - quantity, value: prior.value - movement.valueDeltaRial, unitCost: movement.unitCostRial });
          }
          for (const [productId, restore] of byProduct) {
            const balance = await tx.inventoryBalance.findUnique({ where: { businessId_branchId_productId: { businessId, branchId, productId } } });
            const currentQuantity = balance ? signedQuantityMilli(balance.quantityOnHand.toString()) : 0n;
            const nextQuantity = currentQuantity + restore.quantity;
            if (invoice.returnOfId && !stockPolicy?.negativeStockAllowed && nextQuantity < 0n) throw new ConflictException("ابطال برگشت باعث موجودی منفی می‌شود؛ موجودی شعبه را اصلاح کنید یا تنظیم مجاز بودن موجودی منفی را فعال کنید.");
            const nextValue = (balance?.inventoryValueRial ?? 0n) + restore.value;
            const nextAverage = nextQuantity > 0n ? roundedDivide(nextValue * 1000n, nextQuantity) : 0n;
            await tx.inventoryBalance.upsert({
              where: { businessId_branchId_productId: { businessId, branchId, productId } },
              create: { businessId, branchId, productId, quantityOnHand: new Prisma.Decimal(quantityText(nextQuantity)), inventoryValueRial: nextValue, averageCostRial: nextAverage },
              update: { quantityOnHand: new Prisma.Decimal(quantityText(nextQuantity)), inventoryValueRial: nextValue, averageCostRial: nextAverage },
            });
            await tx.inventoryMovement.create({ data: { businessId, branchId, productId, txnDate: invoice.txnDate, sourceType: voidSourceType, sourceId: invoice.id, quantityDelta: new Prisma.Decimal(quantityText(restore.quantity)), unitCostRial: restore.unitCost, valueDeltaRial: restore.value, createdBy: user.id } });
          }

          await tx.journalEntry.update({ where: { id: original.id }, data: { status: "REVERSED" } });
          const originalCashKind = invoice.returnOfId ? "PAYMENT" : "RECEIPT";
          const reversalCashKind = invoice.returnOfId ? "RECEIPT" : "PAYMENT";
          const cashTransactions = await tx.cashTransaction.findMany({ where: { businessId, branchId, journalEntryId: original.id, kind: originalCashKind, status: "POSTED" } });
          for (const cash of cashTransactions) {
            const accountId = invoice.returnOfId ? cash.fromAccountId : cash.toAccountId;
            if (!accountId) throw new ConflictException("Cash account is missing from a sale payment.");
            await tx.cashTransaction.create({ data: {
              businessId, branchId, kind: reversalCashKind, txnDate: invoice.txnDate, amountRial: cash.amountRial,
              ...(invoice.returnOfId ? { toAccountId: accountId } : { fromAccountId: accountId }), partyId: invoice.customerId, method: cash.method,
              reference: "VOID-" + (invoice.invoiceNo ?? invoice.id), status: "POSTED", journalEntryId: reversal.id,
              idempotencyKey: "sale-void:" + invoice.id + ":" + cash.id, createdBy: user.id,
            } });
          }
        }

        const updated = await tx.salesInvoice.updateMany({ where: { id: invoice.id, businessId, branchId, status: invoice.status }, data: { status: "VOIDED", voidReason: reason, version: { increment: 1 } } });
        if (updated.count !== 1) throw new ConflictException("وضعیت فاکتور هم‌زمان تغییر کرده است؛ فهرست را تازه کنید.");
        const result = { id: invoice.id, invoiceNo: invoice.invoiceNo, status: "VOIDED", reversalJournalId, reason };
        await this.accounting.remember(tx, { userId: user.id, businessId, key, requestHash, response: result });
        await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "sales.voided", entityType: "sales_invoice", entityId: invoice.id, requestId: request.requestId ?? "unknown", beforeJson: { status: invoice.status }, afterJson: { ...result, totalRial: invoice.totalRial.toString() } } });
        return result;
      }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 30000 });
    } catch (error) {
      if (this.isUnique(error)) {
        const prior = await this.accounting.existingIdempotent(user.id, businessId, key, requestHash);
        if (prior) return prior;
      }
      throw error;
    }
  }

  private calculateDraftLine(user: AuthenticatedUser, dto: SalesLineDto, product: { id: string; businessId: string; name: string; sku: string | null; salePriceRial: bigint; taxRateBasisPoints: number; unit: { code: string }; kind: string }) {
    const qtyMilli = quantityMilli(dto.quantity);
    const catalogPrice = product.salePriceRial;
    const price = dto.unitPriceRial === undefined ? catalogPrice : money(dto.unitPriceRial);
    if (price !== catalogPrice && !["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException("تغییر قیمت کالا برای نقش شما مجاز نیست.");
    const base = extensionRial(qtyMilli, price);
    const discount = money(dto.discountRial);
    if (discount > base) throw new BadRequestException(`تخفیف «${product.name}» از مبلغ ردیف بیشتر است.`);
    if (discount > 0n && !["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException("ثبت تخفیف برای نقش شما مجاز نیست.");
    const tax = taxRial(base - discount, product.taxRateBasisPoints);
    return { productId: product.id, product, qtyMilli, price, base, discount, tax };
  }

  private scope(user: AuthenticatedUser) { if (!user.businessId || !user.branchId) throw new BadRequestException("یک کسب‌وکار و شعبه را انتخاب کنید."); return { businessId: user.businessId, branchId: user.branchId }; }
  private date(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("تاریخ سند باید در قالب ISO میلادی باشد."); const date = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException("تاریخ سند معتبر نیست."); return date; }
  private isUnique(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === "P2002"; }
}
