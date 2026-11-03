import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { cursorPage, pageLimit } from "../common/cursor-pagination.js";
import { AccountingService } from "./accounting.service.js";
import type { AuthenticatedUser, AppRequest } from "../common/request-context.js";
import { assertUuid } from "../common/uuid-param.pipe.js";
import type { CashCloseDto, CashTransactionDto, ClosePeriodDto, CreateFinanceAccountDto, ReopenPeriodDto, TransferDto, UpdateFinanceAccountDto } from "./finance.dto.js";

const parseMoney = (value: string) => { if (!/^\d{1,20}$/.test(value)) throw new BadRequestException("مبلغ باید عدد صحیح ریال باشد."); const amount = BigInt(value); if (amount <= 0n) throw new BadRequestException("مبلغ باید بزرگ‌تر از صفر باشد."); return amount; };

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService, private readonly accounting: AccountingService) {}

  async ledgerAccounts(user: AuthenticatedUser) {
    const { businessId } = this.scope(user);
    return this.prisma.ledgerAccount.findMany({ where: { businessId, isActive: true }, select: { id: true, code: true, name: true, type: true }, orderBy: { code: "asc" } });
  }

  async ledger(user: AuthenticatedUser, filters: { from?: string; to?: string; accountId?: string; partyId?: string; cursor?: string; limit?: string }) {
    const { businessId, branchId } = this.scope(user);
    assertUuid(filters.cursor, "نشانگر صفحهٔ دفتر کل معتبر نیست.");
    const from = filters.from ? this.validDate(filters.from, "تاریخ شروع") : undefined;
    const to = filters.to ? this.validDate(filters.to, "تاریخ پایان") : undefined;
    if (from && to && from > to) throw new BadRequestException("تاریخ شروع نباید پس از تاریخ پایان باشد.");
    for (const value of [filters.accountId, filters.partyId]) if (value && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException("فیلتر دفتر کل معتبر نیست.");
    const limit = pageLimit(filters.limit, 50, 100);
    const where: Prisma.JournalLineWhereInput = {
      businessId,
      branchId,
      ...(filters.accountId ? { ledgerAccountId: filters.accountId } : {}),
      ...(filters.partyId ? { partyId: filters.partyId } : {}),
      journalEntry: {
        businessId,
        branchId,
        status: { in: ["POSTED", "REVERSED"] },
        ...(from || to ? { txnDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
    };
    if (filters.cursor && !(await this.prisma.journalLine.findFirst({ where: { ...where, id: filters.cursor }, select: { id: true } }))) throw new BadRequestException("نشانگر صفحهٔ دفتر کل معتبر نیست؛ فهرست را دوباره بارگذاری کنید.");
    const [rows, totals] = await Promise.all([
      this.prisma.journalLine.findMany({ where, ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}), include: { ledgerAccount: { select: { code: true, name: true, type: true } }, party: { select: { name: true } }, journalEntry: { select: { entryNo: true, txnDate: true, memo: true, sourceType: true, status: true } } }, orderBy: [{ journalEntry: { txnDate: "desc" } }, { journalEntry: { entryNo: "desc" } }, { id: "desc" }], take: limit + 1 }),
      this.prisma.journalLine.aggregate({ where, _sum: { debitRial: true, creditRial: true } }),
    ]);
    const page = cursorPage(rows.map((row) => ({ id: row.id, date: row.journalEntry.txnDate.toISOString().slice(0, 10), entryNo: row.journalEntry.entryNo, memo: row.journalEntry.memo, sourceType: row.journalEntry.sourceType, status: row.journalEntry.status, accountCode: row.ledgerAccount.code, account: row.ledgerAccount.name, accountType: row.ledgerAccount.type, party: row.party?.name ?? null, description: row.description, debitRial: row.debitRial.toString(), creditRial: row.creditRial.toString() })), limit, (row) => row.id);
    return { ...page, totalDebitRial: (totals._sum.debitRial ?? 0n).toString(), totalCreditRial: (totals._sum.creditRial ?? 0n).toString() };
  }

  async accounts(user: AuthenticatedUser) {
    const { businessId, branchId } = this.scope(user);
    const accounts = await this.prisma.financeAccount.findMany({ where: { businessId, branchId, isActive: true }, include: { ledgerAccount: { select: { id: true } } }, orderBy: { createdAt: "asc" } });
    const balances = await this.prisma.journalLine.groupBy({ by: ["ledgerAccountId"], where: { businessId, branchId, ledgerAccountId: { in: accounts.map((account) => account.ledgerAccountId) }, journalEntry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debitRial: true, creditRial: true } });
    const sums = new Map(balances.map((row) => [row.ledgerAccountId, (row._sum.debitRial ?? 0n) - (row._sum.creditRial ?? 0n)]));
    return accounts.map((account) => ({ id: account.id, name: account.name, kind: account.kind, branchId, balanceRial: (sums.get(account.ledgerAccountId) ?? 0n).toString() }));
  }

  async getAccount(user: AuthenticatedUser, id: string) {
    const { businessId, branchId } = this.scope(user);
    const account = await this.prisma.financeAccount.findFirst({ where: { id, businessId, branchId }, select: { id: true, name: true, kind: true, isActive: true, ledgerAccountId: true } });
    if (!account) throw new NotFoundException("حساب مالی پیدا نشد.");
    const totals = await this.prisma.journalLine.aggregate({ where: { businessId, branchId, ledgerAccountId: account.ledgerAccountId, journalEntry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debitRial: true, creditRial: true } });
    const balance = (totals._sum.debitRial ?? 0n) - (totals._sum.creditRial ?? 0n);
    return { id: account.id, name: account.name, kind: account.kind, isActive: account.isActive, balanceRial: balance.toString() };
  }

  async updateAccount(user: AuthenticatedUser, id: string, dto: UpdateFinanceAccountDto, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException();
    const before = await this.prisma.financeAccount.findFirst({ where: { id, businessId, branchId } });
    if (!before) throw new NotFoundException("حساب مالی پیدا نشد.");
    if (dto.isActive === false) {
      const totals = await this.prisma.journalLine.aggregate({ where: { businessId, branchId, ledgerAccountId: before.ledgerAccountId, journalEntry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debitRial: true, creditRial: true } });
      if ((totals._sum.debitRial ?? 0n) !== (totals._sum.creditRial ?? 0n)) throw new ConflictException("ابتدا ماندهٔ حساب را به حساب دیگری منتقل کنید؛ حساب دارای مانده بایگانی نمی‌شود.");
    }
    const nextName = dto.name?.trim();
    const after = await this.prisma.$transaction(async (tx) => {
      const account = await tx.financeAccount.update({ where: { id }, data: { name: nextName, isActive: dto.isActive } });
      if (nextName) await tx.ledgerAccount.update({ where: { id: before.ledgerAccountId }, data: { name: nextName } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: dto.isActive === false ? "finance_account.archived" : "finance_account.updated", entityType: "finance_account", entityId: id, requestId: request.requestId ?? "unknown", beforeJson: { name: before.name, kind: before.kind, isActive: before.isActive }, afterJson: { name: account.name, kind: account.kind, isActive: account.isActive } } });
      return account;
    });
    return { id: after.id, name: after.name, kind: after.kind, isActive: after.isActive };
  }

  async createAccount(user: AuthenticatedUser, dto: CreateFinanceAccountDto, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException();
    const account = await this.prisma.$transaction(async (tx) => {
      const count = await tx.ledgerAccount.count({ where: { businessId, code: { startsWith: "11" } } });
      const code = `11${String(count + 10).padStart(3, "0")}`;
      const ledger = await tx.ledgerAccount.create({ data: { businessId, code, name: dto.name.trim(), type: "ASSET" } });
      const finance = await tx.financeAccount.create({ data: { businessId, branchId, name: dto.name.trim(), kind: dto.kind, ledgerAccountId: ledger.id } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "finance_account.created", entityType: "finance_account", entityId: finance.id, requestId: request.requestId ?? "unknown", afterJson: { name: finance.name, kind: finance.kind } } });
      return finance;
    }, { isolationLevel: "Serializable" });
    return { id: account.id, name: account.name, kind: account.kind, balanceRial: "0" };
  }

  async transactions(user: AuthenticatedUser, cursor?: string, requestedLimit?: string) {
    const { businessId, branchId } = this.scope(user);
    assertUuid(cursor, "نشانگر صفحه برای فهرست تراکنش‌ها معتبر نیست.");
    const pageMode = requestedLimit !== undefined || cursor !== undefined;
    const limit = pageMode ? pageLimit(requestedLimit, 50, 100) : 200;
    const where = { businessId, branchId };
    if (cursor && !(await this.prisma.cashTransaction.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))) throw new BadRequestException("نشانگر صفحه برای فهرست تراکنش‌ها معتبر نیست؛ فهرست را دوباره بارگذاری کنید.");
    const rows = await this.prisma.cashTransaction.findMany({ where, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { fromAccount: { select: { name: true } }, toAccount: { select: { name: true } }, party: { select: { name: true } }, journalEntry: { select: { sourceType: true, status: true } } }, orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: limit + (pageMode ? 1 : 0) });
    const mapped = rows.map((row) => ({ id: row.id, kind: row.kind, date: row.txnDate.toISOString().slice(0, 10), amountRial: row.amountRial.toString(), fromAccount: row.fromAccount?.name ?? null, toAccount: row.toAccount?.name ?? null, party: row.party?.name ?? null, method: row.method, reference: row.reference, status: row.journalEntry?.status ?? row.status, canVoid: row.status === "POSTED" && row.journalEntry?.status === "POSTED" && row.journalEntry.sourceType === "CASH_TX" && ["RECEIPT", "PAYMENT", "TRANSFER"].includes(row.kind) }));
    return pageMode ? cursorPage(mapped, limit, (row) => row.id) : mapped;
  }

  async transaction(user: AuthenticatedUser, id: string) {
    const { businessId, branchId } = this.scope(user);
    const row = await this.prisma.cashTransaction.findFirst({ where: { id, businessId, branchId }, include: { fromAccount: { select: { name: true } }, toAccount: { select: { name: true } }, party: { select: { name: true } }, journalEntry: { select: { sourceType: true, status: true } } } });
    if (!row) throw new NotFoundException("تراکنش پیدا نشد.");
    return { id: row.id, kind: row.kind, date: row.txnDate.toISOString().slice(0, 10), amountRial: row.amountRial.toString(), fromAccount: row.fromAccount?.name ?? null, toAccount: row.toAccount?.name ?? null, party: row.party?.name ?? null, method: row.method, reference: row.reference, status: row.journalEntry?.status ?? row.status, canVoid: row.status === "POSTED" && row.journalEntry?.status === "POSTED" && row.journalEntry.sourceType === "CASH_TX" && ["RECEIPT", "PAYMENT", "TRANSFER"].includes(row.kind) };
  }

  async voidTransaction(user: AuthenticatedUser, id: string, dto: import("./finance.dto.js").VoidFinanceTransactionDto, key: string | undefined, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireFinanceRole(user);
    const idempotencyKey = this.requireKey(key);
    const reason = dto.reason.trim();
    if (reason.length < 3) throw new BadRequestException("دلیل ابطال را وارد کنید.");
    const requestHash = this.accounting.idempotencyHash({ id, reason, action: "void-cash-transaction" });
    const prior = await this.accounting.existingIdempotent(user.id, businessId, idempotencyKey, requestHash);
    if (prior) return prior;
    return this.prisma.$transaction(async (tx) => {
      const cash = await tx.cashTransaction.findFirst({ where: { id, businessId, branchId, status: "POSTED" }, include: { journalEntry: { include: { lines: true } } } });
      if (!cash) throw new NotFoundException("تراکنش پیدا نشد.");
      if (!cash.journalEntry || cash.journalEntry.status !== "POSTED" || cash.journalEntry.sourceType !== "CASH_TX" || !["RECEIPT", "PAYMENT", "TRANSFER"].includes(cash.kind)) throw new ConflictException("این دریافت یا پرداخت بخشی از سند دیگری است و از این مسیر قابل ابطال نیست.");
      await this.accounting.assertOpen(tx, businessId, cash.txnDate);
      const reversal = await this.accounting.createJournal(tx, { businessId, branchId, date: cash.txnDate, sourceType: "CASH_TX_VOID", sourceId: id, reversalOfId: cash.journalEntry.id, memo: `ابطال تراکنش ${cash.reference ?? ""}: ${reason}`, actorId: user.id, lines: cash.journalEntry.lines.map((line) => ({ ledgerAccountId: line.ledgerAccountId, debitRial: line.creditRial, creditRial: line.debitRial, partyId: line.partyId, description: `برگشت ابطال: ${line.description ?? ""}` })) });
      let kind: "RECEIPT" | "PAYMENT" | "TRANSFER";
      let fromAccountId: string | null = null;
      let toAccountId: string | null = null;
      if (cash.kind === "RECEIPT") { kind = "PAYMENT"; fromAccountId = cash.toAccountId; }
      else if (cash.kind === "PAYMENT") { kind = "RECEIPT"; toAccountId = cash.fromAccountId; }
      else { kind = "TRANSFER"; fromAccountId = cash.toAccountId; toAccountId = cash.fromAccountId; }
      if ((kind === "RECEIPT" && !toAccountId) || (kind === "PAYMENT" && !fromAccountId) || (kind === "TRANSFER" && (!fromAccountId || !toAccountId))) throw new ConflictException("حساب‌های این تراکنش برای ابطال کامل نیستند.");
      const reversedCash = await tx.cashTransaction.create({ data: { businessId, branchId, kind, txnDate: cash.txnDate, amountRial: cash.amountRial, fromAccountId, toAccountId, partyId: cash.partyId, method: cash.method, reference: `VOID-${cash.reference ?? id}`, status: "POSTED", journalEntryId: reversal.id, idempotencyKey: `cash-void:${id}`, createdBy: user.id } });
      await tx.journalEntry.update({ where: { id: cash.journalEntry.id }, data: { status: "REVERSED" } });
      const result = { id: cash.id, reversalTransactionId: reversedCash.id, status: "VOIDED", reason };
      await this.accounting.remember(tx, { userId: user.id, businessId, key: idempotencyKey, requestHash, response: result });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "cash.transaction.voided", entityType: "cash_transaction", entityId: id, requestId: request.requestId ?? "unknown", beforeJson: { kind: cash.kind, amountRial: cash.amountRial.toString(), status: cash.status }, afterJson: { ...result, amountRial: cash.amountRial.toString() } } });
      return result;
    }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 30000 });
  }

  async cashCloses(user: AuthenticatedUser, cursor?: string, requestedLimit?: string) {
    const { businessId, branchId } = this.scope(user);
    assertUuid(cursor, "نشانگر صفحه برای بستن‌های صندوق معتبر نیست.");
    const pageMode = requestedLimit !== undefined || cursor !== undefined;
    const limit = pageMode ? pageLimit(requestedLimit, 50, 100) : 100;
    const where = { businessId, branchId };
    if (cursor && !(await this.prisma.cashClose.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))) throw new BadRequestException("نشانگر صفحه برای بستن‌های صندوق معتبر نیست؛ فهرست را دوباره بارگذاری کنید.");
    const rows = await this.prisma.cashClose.findMany({ where, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { financeAccount: { select: { name: true } } }, orderBy: [{ closeDate: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: limit + (pageMode ? 1 : 0) });
    const mapped = rows.map((row) => ({ id: row.id, date: row.closeDate.toISOString().slice(0, 10), account: row.financeAccount.name, systemBalanceRial: row.systemBalanceRial.toString(), countedBalanceRial: row.countedBalanceRial.toString(), differenceRial: row.differenceRial.toString(), note: row.note, journalEntryId: row.journalEntryId }));
    return pageMode ? cursorPage(mapped, limit, (row) => row.id) : mapped;
  }

  async cashCloseDetail(user: AuthenticatedUser, id: string) {
    const { businessId, branchId } = this.scope(user);
    const row = await this.prisma.cashClose.findFirst({ where: { id, businessId, branchId }, include: { financeAccount: { select: { name: true } } } });
    if (!row) throw new NotFoundException("بستن صندوق پیدا نشد.");
    return { id: row.id, date: row.closeDate.toISOString().slice(0, 10), account: row.financeAccount.name, systemBalanceRial: row.systemBalanceRial.toString(), countedBalanceRial: row.countedBalanceRial.toString(), differenceRial: row.differenceRial.toString(), note: row.note, journalEntryId: row.journalEntryId };
  }

  async cashClose(user: AuthenticatedUser, dto: CashCloseDto, key: string | undefined, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireFinanceRole(user);
    const idempotencyKey = this.requireKey(key);
    if (!/^\d{1,20}$/.test(dto.countedBalanceRial)) throw new BadRequestException("موجودی شمارش‌شده باید عدد صحیح ریال باشد.");
    const counted = BigInt(dto.countedBalanceRial);
    const date = this.date(dto.closeDate);
    const bodyHash = this.accounting.idempotencyHash({ ...dto, action: "cash-close" });
    const previous = await this.accounting.existingIdempotent(user.id, businessId, idempotencyKey, bodyHash);
    if (previous) return previous;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const account = await tx.financeAccount.findFirst({ where: { id: dto.financeAccountId, businessId, branchId, isActive: true } });
        if (!account) throw new NotFoundException("حساب مالی پیدا نشد.");
        await this.accounting.assertOpen(tx, businessId, date);
        const totals = await tx.journalLine.aggregate({
          where: { businessId, branchId, ledgerAccountId: account.ledgerAccountId, journalEntry: { status: { in: ["POSTED", "REVERSED"] }, txnDate: { lte: date } } },
          _sum: { debitRial: true, creditRial: true },
        });
        const system = (totals._sum.debitRial ?? 0n) - (totals._sum.creditRial ?? 0n);
        const difference = counted - system;
        const close = await tx.cashClose.create({ data: { businessId, branchId, financeAccountId: account.id, closeDate: date, systemBalanceRial: system, countedBalanceRial: counted, differenceRial: difference, note: dto.note?.trim() || null, idempotencyKey, createdBy: user.id } });
        let journalEntryId: string | null = null;
        if (difference !== 0n) {
          const lines = difference > 0n
            ? [{ ledgerAccountId: account.ledgerAccountId, debitRial: difference, description: `مازاد شمارش صندوق ${account.name}` }, { ledgerAccountId: await this.accounting.account(tx, businessId, "other_income"), creditRial: difference, description: "مازاد شمارش صندوق" }]
            : [{ ledgerAccountId: await this.accounting.account(tx, businessId, "general_expense"), debitRial: -difference, description: "کسری شمارش صندوق" }, { ledgerAccountId: account.ledgerAccountId, creditRial: -difference, description: `کسری صندوق ${account.name}` }];
          const journal = await this.accounting.createJournal(tx, { businessId, branchId, date, sourceType: "CASH_CLOSE", sourceId: close.id, memo: dto.note?.trim() || "بستن صندوق و ثبت اختلاف شمارش", actorId: user.id, lines });
          journalEntryId = journal.id;
          await tx.cashClose.update({ where: { id: close.id }, data: { journalEntryId } });
        }
        const result = { id: close.id, date: date.toISOString().slice(0, 10), account: account.name, systemBalanceRial: system.toString(), countedBalanceRial: counted.toString(), differenceRial: difference.toString(), journalEntryId };
        await this.accounting.remember(tx, { userId: user.id, businessId, key: idempotencyKey, requestHash: bodyHash, response: result });
        await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "cash.close.posted", entityType: "cash_close", entityId: close.id, requestId: request.requestId ?? "unknown", afterJson: result } });
        return result;
      }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 30000 });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        const prior = await this.accounting.existingIdempotent(user.id, businessId, idempotencyKey, bodyHash);
        if (prior) return prior;
      }
      throw error;
    }
  }

  async closedPeriods(user: AuthenticatedUser) {
    const { businessId } = this.scope(user);
    const rows = await this.prisma.closedPeriod.findMany({ where: { businessId }, orderBy: [{ startDate: "desc" }, { closedAt: "desc" }], take: 100 });
    return rows.map((row) => ({ id: row.id, startDate: row.startDate.toISOString().slice(0, 10), endDate: row.endDate.toISOString().slice(0, 10), closeReason: row.closeReason, closedAt: row.closedAt.toISOString(), reopenReason: row.reopenReason, reopenedAt: row.reopenedAt?.toISOString() ?? null, isClosed: row.reopenedAt === null }));
  }

  async closePeriod(user: AuthenticatedUser, dto: ClosePeriodDto, request: AppRequest) {
    const { businessId } = this.scope(user);
    if (!["OWNER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException("بستن دورهٔ مالی برای نقش شما مجاز نیست.");
    const startDate = this.date(dto.startDate);
    const endDate = this.date(dto.endDate);
    if (startDate > endDate) throw new BadRequestException("تاریخ شروع باید پیش از تاریخ پایان باشد.");
    const reason = dto.reason.trim();
    const result = await this.prisma.$transaction(async (tx) => {
      const overlap = await tx.closedPeriod.findFirst({ where: { businessId, reopenedAt: null, startDate: { lte: endDate }, endDate: { gte: startDate } }, select: { id: true } });
      if (overlap) throw new ConflictException("این بازه با یک دورهٔ بستهٔ دیگر هم‌پوشانی دارد.");
      const [salesDrafts, purchaseDrafts, expenseDrafts, stockCountDrafts] = await Promise.all([
        tx.salesInvoice.count({ where: { businessId, status: "DRAFT", txnDate: { gte: startDate, lte: endDate } } }),
        tx.purchase.count({ where: { businessId, status: "DRAFT", txnDate: { gte: startDate, lte: endDate } } }),
        tx.expense.count({ where: { businessId, status: "DRAFT", txnDate: { gte: startDate, lte: endDate } } }),
        tx.stockCount.count({ where: { businessId, status: "DRAFT", txnDate: { gte: startDate, lte: endDate } } }),
      ]);
      if (salesDrafts + purchaseDrafts + expenseDrafts + stockCountDrafts > 0) throw new ConflictException("پیش‌نویس‌های فروش، خرید، هزینه یا شمارش موجودی در این بازه را تعیین تکلیف کنید، سپس دوره را ببندید.");
      const period = await tx.closedPeriod.create({ data: { businessId, startDate, endDate, closeReason: reason, closedBy: user.id } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "accounting.period.closed", entityType: "closed_period", entityId: period.id, requestId: request.requestId ?? "unknown", afterJson: { startDate: dto.startDate, endDate: dto.endDate, reason } } });
      return { id: period.id, startDate: dto.startDate, endDate: dto.endDate, isClosed: true };
    }, { isolationLevel: "Serializable" });
    return result;
  }

  async reopenPeriod(user: AuthenticatedUser, id: string, dto: ReopenPeriodDto, request: AppRequest) {
    const { businessId } = this.scope(user);
    if (!["OWNER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException("بازگشایی دورهٔ مالی برای نقش شما مجاز نیست.");
    const reason = dto.reason.trim();
    return this.prisma.$transaction(async (tx) => {
      const period = await tx.closedPeriod.findFirst({ where: { id, businessId, reopenedAt: null } });
      if (!period) throw new NotFoundException("دورهٔ بسته پیدا نشد.");
      const now = new Date();
      const updated = await tx.closedPeriod.update({ where: { id: period.id }, data: { reopenedAt: now, reopenedBy: user.id, reopenReason: reason } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "accounting.period.reopened", entityType: "closed_period", entityId: period.id, requestId: request.requestId ?? "unknown", beforeJson: { isClosed: true }, afterJson: { isClosed: false, reason } } });
      return { id: updated.id, isClosed: false, reopenedAt: now.toISOString() };
    }, { isolationLevel: "Serializable" });
  }

  async receipt(user: AuthenticatedUser, dto: CashTransactionDto, key: string | undefined, request: AppRequest) {
    return this.postSimpleCash(user, dto, key, "RECEIPT", request);
  }

  async payment(user: AuthenticatedUser, dto: CashTransactionDto, key: string | undefined, request: AppRequest) {
    return this.postSimpleCash(user, dto, key, "PAYMENT", request);
  }

  async transfer(user: AuthenticatedUser, dto: TransferDto, key: string | undefined, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireFinanceRole(user);
    const idempotencyKey = this.requireKey(key);
    const amount = parseMoney(dto.amountRial);
    if (dto.fromFinanceAccountId === dto.toFinanceAccountId) throw new BadRequestException("حساب مبدأ و مقصد باید متفاوت باشند.");
    const date = this.date(dto.txnDate);
    const bodyHash = this.accounting.idempotencyHash({ ...dto, kind: "TRANSFER" });
    const previous = await this.accounting.existingIdempotent(user.id, businessId, idempotencyKey, bodyHash);
    if (previous) return previous;
    return this.prisma.$transaction(async (tx) => {
      const [from, to] = await Promise.all([
        tx.financeAccount.findFirst({ where: { id: dto.fromFinanceAccountId, businessId, branchId, isActive: true } }),
        tx.financeAccount.findFirst({ where: { id: dto.toFinanceAccountId, businessId, branchId, isActive: true } }),
      ]);
      if (!from || !to) throw new NotFoundException("یکی از حساب‌های مالی پیدا نشد.");
      await this.accounting.assertOpen(tx, businessId, date);
      const cash = await tx.cashTransaction.create({ data: { businessId, branchId, kind: "TRANSFER", txnDate: date, amountRial: amount, fromAccountId: from.id, toAccountId: to.id, method: "BANK", reference: dto.reference?.trim() || null, idempotencyKey, createdBy: user.id } });
      const journal = await this.accounting.createJournal(tx, { businessId, branchId, date, sourceType: "CASH_TX", sourceId: cash.id, memo: "انتقال بین حساب‌ها", actorId: user.id, lines: [{ ledgerAccountId: to.ledgerAccountId, debitRial: amount, description: `انتقال به ${to.name}` }, { ledgerAccountId: from.ledgerAccountId, creditRial: amount, description: `انتقال از ${from.name}` }] });
      await tx.cashTransaction.update({ where: { id: cash.id }, data: { journalEntryId: journal.id } });
      const result = { id: cash.id, journalEntryId: journal.id, kind: cash.kind, amountRial: amount.toString(), date: date.toISOString().slice(0, 10), status: "POSTED" };
      await this.accounting.remember(tx, { userId: user.id, businessId, key: idempotencyKey, requestHash: bodyHash, response: result });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "cash.transfer.posted", entityType: "cash_transaction", entityId: cash.id, requestId: request.requestId ?? "unknown", afterJson: { amountRial: amount.toString(), fromAccountId: from.id, toAccountId: to.id } } });
      return result;
    }, { isolationLevel: "Serializable" });
  }

  private async postSimpleCash(user: AuthenticatedUser, dto: CashTransactionDto, key: string | undefined, kind: "RECEIPT" | "PAYMENT", request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    this.requireFinanceRole(user);
    const idempotencyKey = this.requireKey(key);
    const amount = parseMoney(dto.amountRial);
    const date = this.date(dto.txnDate);
    const bodyHash = this.accounting.idempotencyHash({ ...dto, kind });
    const previous = await this.accounting.existingIdempotent(user.id, businessId, idempotencyKey, bodyHash);
    if (previous) return previous;
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.financeAccount.findFirst({ where: { id: dto.financeAccountId, businessId, branchId, isActive: true } });
      if (!account) throw new NotFoundException("حساب مالی پیدا نشد.");
      let partyId: string | null = null;
      let counterLedgerId: string;
      let description: string;
      if (dto.partyId) {
        const party = await tx.party.findFirst({ where: { id: dto.partyId, businessId, archivedAt: null } });
        if (!party || (kind === "RECEIPT" && !["CUSTOMER", "BOTH"].includes(party.type)) || (kind === "PAYMENT" && !["SUPPLIER", "BOTH"].includes(party.type))) throw new BadRequestException("طرف‌حساب با نوع این عملیات سازگار نیست.");
        partyId = party.id;
        counterLedgerId = await this.accounting.account(tx, businessId, kind === "RECEIPT" ? "accounts_receivable" : "accounts_payable");
        description = kind === "RECEIPT" ? `دریافت از ${party.name}` : `پرداخت به ${party.name}`;
      } else {
        counterLedgerId = await this.accounting.account(tx, businessId, kind === "RECEIPT" ? "other_income" : "general_expense");
        description = kind === "RECEIPT" ? "دریافت متفرقه" : "پرداخت متفرقه";
      }
      await this.accounting.assertOpen(tx, businessId, date);
      const cash = await tx.cashTransaction.create({ data: { businessId, branchId, kind, txnDate: date, amountRial: amount, ...(kind === "RECEIPT" ? { toAccountId: account.id } : { fromAccountId: account.id }), partyId, method: dto.method, reference: dto.reference?.trim() || null, idempotencyKey, createdBy: user.id } });
      const accountLine = { ledgerAccountId: account.ledgerAccountId, partyId: null, description: kind === "RECEIPT" ? `دریافت به ${account.name}` : `پرداخت از ${account.name}` };
      const counterpart = { ledgerAccountId: counterLedgerId, partyId, description };
      const lines = kind === "RECEIPT" ? [{ ...accountLine, debitRial: amount }, { ...counterpart, creditRial: amount }] : [{ ...counterpart, debitRial: amount }, { ...accountLine, creditRial: amount }];
      const journal = await this.accounting.createJournal(tx, { businessId, branchId, date, sourceType: "CASH_TX", sourceId: cash.id, memo: description, actorId: user.id, lines });
      await tx.cashTransaction.update({ where: { id: cash.id }, data: { journalEntryId: journal.id } });
      const result = { id: cash.id, journalEntryId: journal.id, kind, amountRial: amount.toString(), date: date.toISOString().slice(0, 10), status: "POSTED" };
      await this.accounting.remember(tx, { userId: user.id, businessId, key: idempotencyKey, requestHash: bodyHash, response: result });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: `cash.${kind.toLowerCase()}.posted`, entityType: "cash_transaction", entityId: cash.id, requestId: request.requestId ?? "unknown", afterJson: { amountRial: amount.toString(), accountId: account.id, partyId } } });
      return result;
    }, { isolationLevel: "Serializable" });
  }

  private scope(user: AuthenticatedUser) { if (!user.businessId || !user.branchId) throw new BadRequestException("یک کسب‌وکار و شعبه را انتخاب کنید."); return { businessId: user.businessId, branchId: user.branchId }; }

  private validDate(value: string, label: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${label} معتبر نیست.`); const date = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${label} معتبر نیست.`); return date; }
  private requireFinanceRole(user: AuthenticatedUser) { if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException("اجازهٔ ثبت عملیات مالی را ندارید."); }
  private requireKey(value?: string) { if (!value || value.length > 128) throw new BadRequestException("هدر Idempotency-Key برای عملیات مالی الزامی است."); return value; }
  private date(input?: string) { const value = input ?? new Date().toISOString().slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("تاریخ سند معتبر نیست."); const date = new Date(`${value}T00:00:00.000Z`); if (date.toISOString().slice(0, 10) !== value) throw new BadRequestException("تاریخ سند معتبر نیست."); return date; }
}
