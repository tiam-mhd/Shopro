import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";

export type JournalLineInput = { ledgerAccountId: string; debitRial?: bigint; creditRial?: bigint; partyId?: string | null; description?: string };

@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService) {}

  async assertOpen(tx: Prisma.TransactionClient, businessId: string, date: Date) {
    const closed = await tx.closedPeriod.findFirst({ where: { businessId, reopenedAt: null, startDate: { lte: date }, endDate: { gte: date } }, select: { id: true } });
    if (closed) throw new ConflictException("این تاریخ در دورهٔ مالی بسته قرار دارد.");
  }

  async nextDocumentNumber(tx: Prisma.TransactionClient, input: { businessId: string; type: string; prefix: string }) {
    const sequence = await tx.documentSequence.upsert({
      where: { businessId_type: { businessId: input.businessId, type: input.type } },
      create: { businessId: input.businessId, type: input.type, nextValue: 2n },
      update: { nextValue: { increment: 1n } },
      select: { nextValue: true },
    });
    return `${input.prefix}-${String(sequence.nextValue - 1n).padStart(6, "0")}`;
  }

  async createJournal(tx: Prisma.TransactionClient, input: { businessId: string; branchId: string; date: Date; sourceType: string; sourceId: string; memo?: string; actorId: string; reversalOfId?: string; lines: JournalLineInput[] }) {
    const debit = input.lines.reduce((sum, line) => sum + (line.debitRial ?? 0n), 0n);
    const credit = input.lines.reduce((sum, line) => sum + (line.creditRial ?? 0n), 0n);
    if (input.lines.length < 2 || debit <= 0n || debit !== credit || input.lines.some((line) => (line.debitRial ?? 0n) < 0n || (line.creditRial ?? 0n) < 0n || ((line.debitRial ?? 0n) > 0n && (line.creditRial ?? 0n) > 0n))) {
      throw new BadRequestException("ثبت حسابداری متوازن نیست و ذخیره نشد.");
    }
    const entryNo = await this.nextDocumentNumber(tx, { businessId: input.businessId, type: "JOURNAL", prefix: "D" });
    const journalLines: Prisma.JournalLineUncheckedCreateWithoutJournalEntryInput[] = input.lines.map((line) => ({
      ledgerAccountId: line.ledgerAccountId,
      partyId: line.partyId ?? null,
      branchId: input.branchId,
      debitRial: line.debitRial ?? 0n,
      creditRial: line.creditRial ?? 0n,
      description: line.description,
    }));
    return tx.journalEntry.create({ data: {
      businessId: input.businessId, branchId: input.branchId, entryNo, txnDate: input.date, sourceType: input.sourceType, sourceId: input.sourceId,
      memo: input.memo, postedBy: input.actorId, reversalOfId: input.reversalOfId,
      lines: { create: journalLines },
    } });
  }

  idempotencyHash(payload: unknown) { return createHash("sha256").update(JSON.stringify(payload)).digest("hex"); }

  async existingIdempotent(userId: string, businessId: string, key: string, requestHash: string) {
    const record = await this.prisma.idempotencyRecord.findUnique({ where: { businessId_userId_key: { businessId, userId, key } } });
    if (!record) return null;
    if (record.expiresAt <= new Date()) { await this.prisma.idempotencyRecord.delete({ where: { id: record.id } }); return null; }
    if (record.requestHash !== requestHash) throw new ConflictException("کلید این درخواست پیش‌تر برای اطلاعات دیگری استفاده شده است.");
    return record.responseJson;
  }

  async existingIdempotentAfterConflict(userId: string, businessId: string, key: string, requestHash: string, attempts = 6) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const response = await this.existingIdempotent(userId, businessId, key, requestHash);
      if (response !== null) return response;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
    return null;
  }

  async remember(tx: Prisma.TransactionClient, input: { userId: string; businessId: string; key: string; requestHash: string; response: unknown }) {
    await tx.idempotencyRecord.create({ data: { userId: input.userId, businessId: input.businessId, key: input.key, requestHash: input.requestHash, responseJson: JSON.parse(JSON.stringify(input.response)), expiresAt: new Date(Date.now() + 90 * 86400 * 1000) } });
  }

  async account(tx: Prisma.TransactionClient, businessId: string, systemKey: string) {
    const row = await tx.ledgerAccount.findUnique({ where: { businessId_systemKey: { businessId, systemKey } } });
    if (!row) throw new Error(`Missing system ledger account: ${systemKey}`);
    return row.id;
  }

  async postStorefrontReceipt(tx: Prisma.TransactionClient, input: { businessId: string; branchId: string; actorId: string; paymentAttemptId: string; orderCode: string; amountRial: bigint; financeAccountId: string; partyId: string; reference: string; date: Date }) {
    if (input.amountRial <= 0n) throw new BadRequestException("مبلغ دریافت بانکی باید از صفر بیشتر باشد.");
    const account = await tx.financeAccount.findFirst({ where: { id: input.financeAccountId, businessId: input.businessId, branchId: input.branchId, isActive: true, kind: "BANK" }, include: { ledgerAccount: { select: { id: true } } } });
    if (!account) throw new NotFoundException("حساب بانکی مرتبط با کارت مقصد دیگر فعال نیست.");
    await this.assertOpen(tx, input.businessId, input.date);
    const cash = await tx.cashTransaction.create({ data: {
      businessId: input.businessId, branchId: input.branchId, kind: "RECEIPT", txnDate: input.date,
      amountRial: input.amountRial, toAccountId: account.id, partyId: input.partyId, method: "BANK",
      reference: input.reference, status: "POSTED", idempotencyKey: `storefront-payment:${input.paymentAttemptId}`,
      createdBy: input.actorId,
    } });
    const receivableAccountId = await this.account(tx, input.businessId, "accounts_receivable");
    const journal = await this.createJournal(tx, {
      businessId: input.businessId, branchId: input.branchId, date: input.date, sourceType: "STOREFRONT_PAYMENT",
      sourceId: input.paymentAttemptId, memo: `پیش‌دریافت سفارش ${input.orderCode}`, actorId: input.actorId,
      lines: [
        { ledgerAccountId: account.ledgerAccount.id, debitRial: input.amountRial, description: `واریز بانکی سفارش ${input.orderCode}` },
        { ledgerAccountId: receivableAccountId, creditRial: input.amountRial, partyId: input.partyId, description: `پیش‌دریافت مشتری سفارش ${input.orderCode}` },
      ],
    });
    await tx.cashTransaction.update({ where: { id: cash.id }, data: { journalEntryId: journal.id } });
    return { cashTransactionId: cash.id, journalEntryId: journal.id };
  }
}
