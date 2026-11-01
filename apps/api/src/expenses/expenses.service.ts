import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountingService } from "../finance/accounting.service.js";
import type { AuthenticatedUser, AppRequest } from "../common/request-context.js";
import type { CreateExpenseDto, PostExpenseDto } from "./expenses.dto.js";

const money = (value: string) => { if (!/^\d{1,20}$/.test(value)) throw new BadRequestException("مبلغ باید عدد صحیح ریال باشد."); const result = BigInt(value); if (result <= 0n) throw new BadRequestException("مبلغ باید بزرگ‌تر از صفر باشد."); return result; };

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService, private readonly accounting: AccountingService) {}

  async list(user: AuthenticatedUser) {
    const { businessId, branchId } = this.scope(user);
    const rows = await this.prisma.expense.findMany({ where: { businessId, branchId }, include: { category: { select: { name: true } }, payee: { select: { name: true } } }, orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }], take: 200 });
    return rows.map((row) => ({ id: row.id, expenseNo: row.expenseNo, date: row.txnDate.toISOString().slice(0, 10), amountRial: row.amountRial.toString(), taxRial: row.taxRial.toString(), category: row.category.name, payee: row.payee?.name ?? null, status: row.status, note: row.note }));
  }

  async categories(user: AuthenticatedUser) {
    const { businessId } = this.scope(user);
    return this.prisma.expenseCategory.findMany({ where: { businessId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  }

  async create(user: AuthenticatedUser, dto: CreateExpenseDto, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException();
    const amount = money(dto.amountRial);
    const date = this.date(dto.txnDate);
    const category = await this.prisma.expenseCategory.findFirst({ where: { id: dto.categoryId, businessId, isActive: true } });
    if (!category) throw new BadRequestException("دستهٔ هزینه متعلق به این کسب‌وکار نیست.");
    const payee = dto.payeeId ? await this.prisma.party.findFirst({ where: { id: dto.payeeId, businessId, archivedAt: null, type: { in: ["SUPPLIER", "BOTH"] } } }) : null;
    if (dto.payeeId && !payee) throw new BadRequestException("تأمین‌کننده انتخاب‌شده معتبر نیست.");
    const taxRate = dto.taxRateBasisPoints ?? 0;
    const tax = (amount * BigInt(taxRate) + 5000n) / 10000n;
    const expense = await this.prisma.expense.create({ data: { businessId, branchId, categoryId: category.id, payeeId: payee?.id, txnDate: date, amountRial: amount, taxRateBasisPoints: taxRate, taxRial: tax, note: dto.note?.trim() || null, createdBy: user.id } });
    await this.prisma.auditEvent.create({ data: { businessId, actorId: user.id, action: "expense.draft.created", entityType: "expense", entityId: expense.id, requestId: request.requestId ?? "unknown", afterJson: { amountRial: amount.toString(), categoryId: category.id, txnDate: date.toISOString().slice(0, 10) } } });
    return { id: expense.id, amountRial: amount.toString(), taxRial: tax.toString(), status: expense.status };
  }

  async post(user: AuthenticatedUser, id: string, dto: PostExpenseDto, key?: string, request?: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException();
    if (!key || key.length > 128) throw new BadRequestException("هدر Idempotency-Key برای ثبت هزینه الزامی است.");
    const bodyHash = this.accounting.idempotencyHash({ id, financeAccountId: dto.financeAccountId ?? null });
    const previous = await this.accounting.existingIdempotent(user.id, businessId, key, bodyHash);
    if (previous) return previous;
    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findFirst({ where: { id, businessId, branchId }, include: { category: true, payee: true } });
      if (!expense) throw new NotFoundException("هزینه پیدا نشد.");
      if (expense.status !== "DRAFT") throw new ConflictException("این هزینه قبلاً ثبت نهایی شده است.");
      await this.accounting.assertOpen(tx, businessId, expense.txnDate);
      const cash = dto.financeAccountId ? await tx.financeAccount.findFirst({ where: { id: dto.financeAccountId, businessId, branchId, isActive: true } }) : null;
      if (dto.financeAccountId && !cash) throw new BadRequestException("حساب پرداخت معتبر نیست.");
      const payable = await this.accounting.account(tx, businessId, "accounts_payable");
      const inputTax = await this.accounting.account(tx, businessId, "input_tax");
      const journalSourceId = expense.id;
      const lines = [
        { ledgerAccountId: expense.category.expenseLedgerAccountId, debitRial: expense.amountRial, description: expense.category.name },
        ...(expense.taxRial > 0n ? [{ ledgerAccountId: inputTax, debitRial: expense.taxRial, description: "مالیات خرید" }] : []),
        { ledgerAccountId: cash?.ledgerAccountId ?? payable, creditRial: expense.amountRial + expense.taxRial, partyId: cash ? null : expense.payeeId, description: cash ? `پرداخت از ${cash.name}` : "بدهی هزینه" },
      ];
      const journal = await this.accounting.createJournal(tx, { businessId, branchId, date: expense.txnDate, sourceType: "EXPENSE", sourceId: journalSourceId, memo: expense.note ?? "ثبت هزینه", actorId: user.id, lines });
      if (cash) {
        const cashTxn = await tx.cashTransaction.create({ data: { businessId, branchId, kind: "PAYMENT", txnDate: expense.txnDate, amountRial: expense.amountRial + expense.taxRial, fromAccountId: cash.id, partyId: expense.payeeId, method: cash.kind === "CASH" ? "CASH" : cash.kind === "POS" ? "POS" : "BANK", reference: expense.expenseNo ?? expense.id, idempotencyKey: `expense:${expense.id}`, createdBy: user.id, journalEntryId: journal.id } });
        void cashTxn;
      }
      const posted = await tx.expense.update({ where: { id }, data: { status: "POSTED", postedAt: new Date() } });
      const result = { id: posted.id, status: posted.status, journalEntryId: journal.id, amountRial: (posted.amountRial + posted.taxRial).toString() };
      await this.accounting.remember(tx, { userId: user.id, businessId, key, requestHash: bodyHash, response: result });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "expense.posted", entityType: "expense", entityId: posted.id, requestId: request?.requestId ?? "unknown", afterJson: result } });
      return result;
    }, { isolationLevel: "Serializable" });
  }

  private scope(user: AuthenticatedUser) { if (!user.businessId || !user.branchId) throw new BadRequestException("یک کسب‌وکار و شعبه را انتخاب کنید."); return { businessId: user.businessId, branchId: user.branchId }; }
  private date(value?: string) { const dateText = value ?? new Date().toISOString().slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) throw new BadRequestException("تاریخ سند معتبر نیست."); const date = new Date(`${dateText}T00:00:00.000Z`); if (date.toISOString().slice(0, 10) !== dateText) throw new BadRequestException("تاریخ سند معتبر نیست."); return date; }
}
