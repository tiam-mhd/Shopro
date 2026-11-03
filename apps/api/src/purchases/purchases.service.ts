import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingService, type JournalLineInput } from "../finance/accounting.service.js";
import { toAsciiDigits } from "@shopro/contracts";
import type { AuthenticatedUser, AppRequest } from "../common/request-context.js";
import { cursorPage, pageLimit } from "../common/cursor-pagination.js";
import type { CreatePurchaseDto, PostPurchaseDto } from "./purchases.dto.js";
import { assertUuid } from "../common/uuid-param.pipe.js";

const money = (value: string | undefined) => { if (!value) return 0n; if (!/^\d{1,20}$/.test(value)) throw new BadRequestException("مبلغ باید عدد صحیح ریال باشد."); return BigInt(value); };
const quantityMilli = (value: string) => { const normalized = toAsciiDigits(value).trim(); if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) throw new BadRequestException("تعداد حداکثر سه رقم اعشار دارد."); const [whole, fraction = ""] = normalized.split("."); const qty = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0")); if (qty <= 0n) throw new BadRequestException("تعداد باید بزرگ‌تر از صفر باشد."); return qty; };
const qtyText = (value: bigint) => `${value / 1000n}.${(value % 1000n).toString().padStart(3, "0")}`;
const extension = (qty: bigint, price: bigint) => (qty * price + 500n) / 1000n;
const tax = (base: bigint, rate: number) => (base * BigInt(rate) + 5000n) / 10000n;

@Injectable()
export class PurchasesService {
  constructor(private readonly prisma: PrismaService, private readonly accounting: AccountingService) {}

  async list(user: AuthenticatedUser, cursor?: string, requestedLimit?: string) {
    const { businessId, branchId } = this.scope(user);
    assertUuid(cursor, "نشانگر صفحه برای فهرست خریدها معتبر نیست.");
    const pageMode = requestedLimit !== undefined || cursor !== undefined;
    const limit = pageMode ? pageLimit(requestedLimit) : 200;
    const where = { businessId, branchId };
    if (cursor && !(await this.prisma.purchase.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))) throw new BadRequestException("نشانگر صفحه برای فهرست خریدها معتبر نیست؛ فهرست را دوباره بارگذاری کنید.");
    const rows = await this.prisma.purchase.findMany({ where, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { supplier: { select: { name: true } } }, orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: limit + (pageMode ? 1 : 0) });
    const mapped = rows.map((row) => ({ id: row.id, purchaseNo: row.purchaseNo, date: row.txnDate.toISOString().slice(0, 10), supplier: row.supplier?.name ?? null, totalRial: row.totalRial.toString(), status: row.status }));
    return pageMode ? cursorPage(mapped, limit, (row) => row.id) : mapped;
  }

  async get(user: AuthenticatedUser, id: string) {
    const { businessId, branchId } = this.scope(user);
    const row = await this.prisma.purchase.findFirst({ where: { id, businessId, branchId }, include: { supplier: { select: { name: true, phone: true, email: true, address: true } }, lines: { include: { product: { select: { name: true, sku: true, unit: { select: { labelFa: true } } } } } }, allocations: { include: { cashTransaction: { select: { amountRial: true, method: true, fromAccount: { select: { name: true } } } } } } } });
    if (!row) throw new NotFoundException("خرید پیدا نشد.");
    return { id: row.id, purchaseNo: row.purchaseNo, date: row.txnDate.toISOString().slice(0, 10), dueDate: row.dueDate?.toISOString().slice(0, 10) ?? null, supplierId: row.supplierId, supplier: row.supplier, status: row.status, subtotalRial: row.subtotalRial.toString(), discountRial: row.discountRial.toString(), taxRial: row.taxRial.toString(), totalRial: row.totalRial.toString(), note: row.note, lines: row.lines.map((line) => ({ productId: line.productId, description: line.descriptionSnapshot, sku: line.product?.sku ?? null, unit: line.product?.unit.labelFa ?? null, quantity: line.quantity.toString(), unitCostRial: line.unitCostRial.toString(), discountRial: line.discountRial.toString(), taxRateBasisPoints: line.taxRateBasisPoints, taxRial: line.taxRial.toString(), totalRial: line.lineTotalRial.toString() })), payments: row.allocations.map((allocation) => ({ amountRial: allocation.amountRial.toString(), method: allocation.cashTransaction.method, account: allocation.cashTransaction.fromAccount?.name ?? null })) };
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
    const purchaseLines: Prisma.PurchaseLineUncheckedCreateWithoutPurchaseInput[] = lines.map((line) => ({
      productId: line.product.id,
      descriptionSnapshot: line.product.name,
      quantity: new Prisma.Decimal(qtyText(line.qty)),
      unitCostRial: line.cost,
      discountRial: line.discount,
      taxRateBasisPoints: line.product.taxRateBasisPoints,
      taxRial: line.tax,
      lineTotalRial: line.base - line.discount + line.tax,
    }));
    const row = await this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({ data: { businessId, branchId, supplierId: dto.supplierId ?? null, txnDate: date, note: dto.note?.trim() || null, subtotalRial: subtotal, discountRial: discount, taxRial: taxTotal, totalRial: total, lines: { create: purchaseLines } } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "purchase.draft.created", entityType: "purchase", entityId: purchase.id, requestId: request.requestId ?? "unknown", afterJson: { supplierId: dto.supplierId ?? null, totalRial: total.toString() } } });
      return purchase;
    });
    return { id: row.id, status: row.status, totalRial: row.totalRial.toString() };
  }

  async updateDraft(user: AuthenticatedUser, id: string, dto: CreatePurchaseDto, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireRole(user);
    const before = await this.prisma.purchase.findFirst({ where: { id, businessId, branchId, status: "DRAFT" }, include: { lines: true } });
    if (!before) throw new NotFoundException("پیش‌نویس خرید پیدا نشد.");
    const date = this.date(dto.txnDate);
    if (dto.supplierId && !(await this.prisma.party.findFirst({ where: { id: dto.supplierId, businessId, archivedAt: null, type: { in: ["SUPPLIER", "BOTH"] } } }))) throw new BadRequestException("تأمین‌کننده انتخاب‌شده معتبر نیست.");
    const products = await this.prisma.product.findMany({ where: { id: { in: [...new Set(dto.lines.map((line) => line.productId))] }, businessId, isActive: true }, include: { unit: true } });
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
    const purchaseLines: Prisma.PurchaseLineUncheckedCreateWithoutPurchaseInput[] = lines.map((line) => ({
      productId: line.product.id,
      descriptionSnapshot: line.product.name,
      quantity: new Prisma.Decimal(qtyText(line.qty)),
      unitCostRial: line.cost,
      discountRial: line.discount,
      taxRateBasisPoints: line.product.taxRateBasisPoints,
      taxRial: line.tax,
      lineTotalRial: line.base - line.discount + line.tax,
    }));
    const saved = await this.prisma.$transaction(async (tx) => {
      const current = await tx.purchase.findFirst({ where: { id, businessId, branchId, status: "DRAFT" }, select: { id: true, totalRial: true } });
      if (!current) throw new ConflictException("وضعیت خرید تغییر کرده است؛ فهرست را تازه کنید.");
      await tx.purchaseLine.deleteMany({ where: { businessId, purchaseId: id } });
      const updated = await tx.purchase.update({ where: { id }, data: {
        supplierId: dto.supplierId ?? null, txnDate: date, note: dto.note?.trim() || null,
        subtotalRial: subtotal, discountRial: discount, taxRial: taxTotal, totalRial: total,
        version: { increment: 1 },
        lines: { create: purchaseLines },
      } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "purchase.draft.updated", entityType: "purchase", entityId: id, requestId: request.requestId ?? "unknown", beforeJson: { totalRial: current.totalRial.toString() }, afterJson: { totalRial: total.toString(), supplierId: dto.supplierId ?? null } } });
      return updated;
    });
    return { id: saved.id, status: saved.status, totalRial: saved.totalRial.toString() };
  }

  async deleteDraft(user: AuthenticatedUser, id: string, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireRole(user);
    return this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findFirst({ where: { id, businessId, branchId, status: "DRAFT" }, select: { id: true, purchaseNo: true, totalRial: true } });
      if (!purchase) throw new ConflictException("فقط پیش‌نویس خرید را می‌توان حذف کرد؛ سند نهایی باید با ابطال اصلاح شود.");
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "purchase.draft.deleted", entityType: "purchase", entityId: id, requestId: request.requestId ?? "unknown", beforeJson: { totalRial: purchase.totalRial.toString(), purchaseNo: purchase.purchaseNo } } });
      await tx.purchase.delete({ where: { id } });
      return { id, status: "DELETED" };
    });
  }

  async post(user: AuthenticatedUser, id: string, dto: PostPurchaseDto, key?: string, request?: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireRole(user);
    if (!key || key.length > 128) throw new BadRequestException("هدر Idempotency-Key برای ثبت خرید الزامی است.");
    const requestHash = this.accounting.idempotencyHash({ id, payments: dto.payments ?? [] });
    const prior = await this.accounting.existingIdempotent(user.id, businessId, key, requestHash);
    if (prior) return prior;
    try {
      return await this.prisma.$transaction(async (tx) => {
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

      const purchaseNo = await this.accounting.nextDocumentNumber(tx, { businessId, type: "PURCHASE", prefix: "P" });
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
    } catch (error) {
      if (this.isPostConflict(error)) {
        const prior = await this.accounting.existingIdempotent(user.id, businessId, key, requestHash);
        if (prior) return prior;
        throw new ConflictException("درخواست هم‌زمان ثبت شد؛ وضعیت خرید را تازه‌سازی کنید.");
      }
      throw error;
    }
  }

  async void(user: AuthenticatedUser, id: string, dto: import("./purchases.dto.js").VoidPurchaseDto, key: string | undefined, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireRole(user);
    if (!key || key.length > 128) throw new BadRequestException("کلید تکرارناپذیری برای ابطال خرید لازم است.");
    const reason = dto.reason.trim();
    if (reason.length < 3) throw new BadRequestException("دلیل ابطال را وارد کنید.");
    const requestHash = this.accounting.idempotencyHash({ id, reason, action: "void-purchase" });
    const prior = await this.accounting.existingIdempotent(user.id, businessId, key, requestHash);
    if (prior) return prior;
    try {
      return await this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findFirst({ where: { id, businessId, branchId }, select: { id: true, purchaseNo: true, txnDate: true, status: true, totalRial: true, supplierId: true } });
      if (!purchase) throw new NotFoundException("خرید پیدا نشد.");
      if (purchase.status !== "POSTED") throw new ConflictException("فقط خرید ثبت‌شده قابل ابطال است.");
      await this.accounting.assertOpen(tx, businessId, purchase.txnDate);
      const original = await tx.journalEntry.findFirst({ where: { businessId, branchId, sourceType: "PURCHASE", sourceId: id, status: "POSTED" }, include: { lines: true } });
      if (!original || !original.lines.length) throw new ConflictException("سند حسابداری خرید برای ابطال پیدا نشد.");
      const reversal = await this.accounting.createJournal(tx, { businessId, branchId, date: purchase.txnDate, sourceType: "PURCHASE_VOID", sourceId: id, reversalOfId: original.id, memo: `ابطال خرید ${purchase.purchaseNo ?? ""}: ${reason}`, actorId: user.id, lines: original.lines.map((line) => ({ ledgerAccountId: line.ledgerAccountId, debitRial: line.creditRial, creditRial: line.debitRial, partyId: line.partyId, description: `برگشت ابطال: ${line.description ?? ""}` })) });

      const movements = await tx.inventoryMovement.findMany({ where: { businessId, branchId, sourceType: "PURCHASE", sourceId: id } });
      const grouped = new Map<string, { quantity: bigint; value: bigint; unitCost: bigint; firstAt: Date }>();
      for (const movement of movements) {
        const qty = quantityMilli(movement.quantityDelta.toString());
        const current = grouped.get(movement.productId) ?? { quantity: 0n, value: 0n, unitCost: movement.unitCostRial, firstAt: movement.createdAt };
        grouped.set(movement.productId, { quantity: current.quantity + qty, value: current.value + movement.valueDeltaRial, unitCost: movement.unitCostRial, firstAt: movement.createdAt < current.firstAt ? movement.createdAt : current.firstAt });
      }
      for (const [productId, reversalStock] of grouped) {
        const laterMovement = await tx.inventoryMovement.findFirst({ where: { businessId, branchId, productId, sourceId: { not: id }, createdAt: { gt: reversalStock.firstAt } }, select: { id: true } });
        if (laterMovement) throw new ConflictException("پس از این خرید گردش موجودی ثبت شده است؛ ابتدا اسناد بعدی را اصلاح کنید.");
        const balance = await tx.inventoryBalance.findUnique({ where: { businessId_branchId_productId: { businessId, branchId, productId } } });
        const currentQuantity = balance ? quantityMilli(balance.quantityOnHand.toString()) : 0n;
        const nextQuantity = currentQuantity - reversalStock.quantity;
        const currentValue = balance?.inventoryValueRial ?? 0n;
        const nextValue = nextQuantity === 0n ? 0n : currentValue - reversalStock.value;
        if (nextQuantity < 0n || nextValue < 0n) throw new ConflictException("موجودی فعلی برای ابطال این خرید کافی نیست.");
        const nextAverage = nextQuantity > 0n ? (nextValue * 1000n + nextQuantity / 2n) / nextQuantity : 0n;
        await tx.inventoryBalance.update({ where: { businessId_branchId_productId: { businessId, branchId, productId } }, data: { quantityOnHand: new Prisma.Decimal(qtyText(nextQuantity)), inventoryValueRial: nextValue, averageCostRial: nextAverage } });
        await tx.inventoryMovement.create({ data: { businessId, branchId, productId, txnDate: purchase.txnDate, sourceType: "PURCHASE_VOID", sourceId: id, quantityDelta: new Prisma.Decimal(`-${qtyText(reversalStock.quantity)}`), unitCostRial: reversalStock.unitCost, valueDeltaRial: -reversalStock.value, createdBy: user.id } });
      }
      const cashRows = await tx.cashTransaction.findMany({ where: { businessId, branchId, journalEntryId: original.id, kind: "PAYMENT", status: "POSTED" } });
      for (const cash of cashRows) {
        if (!cash.fromAccountId) throw new ConflictException("حساب پرداخت خرید برای ابطال پیدا نشد.");
        await tx.cashTransaction.create({ data: { businessId, branchId, kind: "RECEIPT", txnDate: purchase.txnDate, amountRial: cash.amountRial, toAccountId: cash.fromAccountId, partyId: cash.partyId, method: cash.method, reference: `VOID-${purchase.purchaseNo ?? id}`, status: "POSTED", journalEntryId: reversal.id, idempotencyKey: `purchase-void:${id}:${cash.id}`, createdBy: user.id } });
      }
      await tx.journalEntry.update({ where: { id: original.id }, data: { status: "REVERSED" } });
      const updated = await tx.purchase.update({ where: { id }, data: { status: "VOIDED", version: { increment: 1 } } });
      const result = { id, purchaseNo: updated.purchaseNo, status: updated.status, reason, reversalJournalId: reversal.id };
      await this.accounting.remember(tx, { userId: user.id, businessId, key, requestHash, response: result });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "purchase.voided", entityType: "purchase", entityId: id, requestId: request.requestId ?? "unknown", beforeJson: { status: purchase.status }, afterJson: { ...result, totalRial: purchase.totalRial.toString(), supplierId: purchase.supplierId } } });
      return result;
      }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 30000 });
    } catch (error) {
      if (this.isPostConflict(error)) {
        const saved = await this.accounting.existingIdempotentAfterConflict(user.id, businessId, key, requestHash);
        if (saved) return saved;
        throw new ConflictException("درخواست ابطال هم‌زمان پردازش شد؛ وضعیت خرید را تازه‌سازی کنید.");
      }
      throw error;
    }
  }

  private scope(user: AuthenticatedUser) { if (!user.businessId || !user.branchId) throw new BadRequestException("یک کسب‌وکار و شعبه را انتخاب کنید."); return { businessId: user.businessId, branchId: user.branchId }; }
  private requireRole(user: AuthenticatedUser) { if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException("اجازهٔ ثبت خرید را ندارید."); }
  private date(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("تاریخ سند معتبر نیست."); const date = new Date(`${value}T00:00:00.000Z`); if (date.toISOString().slice(0, 10) !== value) throw new BadRequestException("تاریخ سند معتبر نیست."); return date; }
  private isPostConflict(error: unknown) { return typeof error === "object" && error !== null && "code" in error && (error.code === "P2002" || error.code === "P2034"); }
}
