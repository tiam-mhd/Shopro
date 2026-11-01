import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingService } from "./accounting.service.js";
import type { AuthenticatedUser, AppRequest } from "../common/request-context.js";
import type { CashCloseDto, CashTransactionDto, ClosePeriodDto, CreateFinanceAccountDto, ReopenPeriodDto, TransferDto } from "./finance.dto.js";

const parseMoney = (value: string) => { if (!/^\d{1,20}$/.test(value)) throw new BadRequestException("مبلغ باید عدد صحیح ریال باشد."); const amount = BigInt(value); if (amount <= 0n) throw new BadRequestException("مبلغ باید بزرگ‌تر از صفر باشد."); return amount; };

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService, private readonly accounting: AccountingService) {}

  async accounts(user: AuthenticatedUser) {
    const { businessId, branchId } = this.scope(user);
    const accounts = await this.prisma.financeAccount.findMany({ where: { businessId, branchId, isActive: true }, include: { ledgerAccount: { select: { id: true } } }, orderBy: { createdAt: "asc" } });
    const balances = await this.prisma.journalLine.groupBy({ by: ["ledgerAccountId"], where: { businessId, branchId, ledgerAccountId: { in: accounts.map((account) => account.ledgerAccountId) }, journalEntry: { status: "POSTED" } }, _sum: { debitRial: true, creditRial: true } });
    const sums = new Map(balances.map((row) => [row.ledgerAccountId, (row._sum.debitRial ?? 0n) - (row._sum.creditRial ?? 0n)]));
    return accounts.map((account) => ({ id: account.id, name: account.name, kind: account.kind, branchId, balanceRial: (sums.get(account.ledgerAccountId) ?? 0n).toString() }));
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

  async transactions(user: AuthenticatedUser, limit = 100) {
    const { businessId, branchId } = this.scope(user);
    const rows = await this.prisma.cashTransaction.findMany({ where: { businessId, branchId, status: "POSTED" }, include: { fromAccount: { select: { name: true } }, toAccount: { select: { name: true } }, party: { select: { name: true } } }, orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }], take: Math.min(Math.max(limit, 1), 200) });
    return rows.map((row) => ({ id: row.id, kind: row.kind, date: row.txnDate.toISOString().slice(0, 10), amountRial: row.amountRial.toString(), fromAccount: row.fromAccount?.name ?? null, toAccount: row.toAccount?.name ?? null, party: row.party?.name ?? null, method: row.method, reference: row.reference }));
  }

  async cashCloses(user: AuthenticatedUser, limit = 50) {
    const { businessId, branchId } = this.scope(user);
    const rows = await this.prisma.cashClose.findMany({ where: { businessId, branchId }, include: { financeAccount: { select: { name: true } } }, orderBy: [{ closeDate: "desc" }, { createdAt: "desc" }], take: Math.min(Math.max(limit, 1), 100) });
    return rows.map((row) => ({ id: row.id, date: row.closeDate.toISOString().slice(0, 10), account: row.financeAccount.name, systemBalanceRial: row.systemBalanceRial.toString(), countedBalanceRial: row.countedBalanceRial.toString(), differenceRial: row.differenceRial.toString(), note: row.note, journalEntryId: row.journalEntryId }));
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
          where: { businessId, branchId, ledgerAccountId: account.ledgerAccountId, journalEntry: { status: "POSTED", txnDate: { lte: date } } },
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
      const [salesDrafts, purchaseDrafts, expenseDrafts] = await Promise.all([
        tx.salesInvoice.count({ where: { businessId, status: "DRAFT", txnDate: { gte: startDate, lte: endDate } } }),
        tx.purchase.count({ where: { businessId, status: "DRAFT", txnDate: { gte: startDate, lte: endDate } } }),
        tx.expense.count({ where: { businessId, status: "DRAFT", txnDate: { gte: startDate, lte: endDate } } }),
      ]);
      if (salesDrafts + purchaseDrafts + expenseDrafts > 0) throw new ConflictException("پیش‌نویس‌های باز در این بازه را ثبت یا باطل کنید، سپس دوره را ببندید.");
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
  private requireFinanceRole(user: AuthenticatedUser) { if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException("اجازهٔ ثبت عملیات مالی را ندارید."); }
  private requireKey(value?: string) { if (!value || value.length > 128) throw new BadRequestException("هدر Idempotency-Key برای عملیات مالی الزامی است."); return value; }
  private date(input?: string) { const value = input ?? new Date().toISOString().slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("تاریخ سند معتبر نیست."); const date = new Date(`${value}T00:00:00.000Z`); if (date.toISOString().slice(0, 10) !== value) throw new BadRequestException("تاریخ سند معتبر نیست."); return date; }
}
