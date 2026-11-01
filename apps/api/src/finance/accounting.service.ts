import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
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

  async createJournal(tx: Prisma.TransactionClient, input: { businessId: string; branchId: string; date: Date; sourceType: string; sourceId: string; memo?: string; actorId: string; reversalOfId?: string; lines: JournalLineInput[] }) {
    const debit = input.lines.reduce((sum, line) => sum + (line.debitRial ?? 0n), 0n);
    const credit = input.lines.reduce((sum, line) => sum + (line.creditRial ?? 0n), 0n);
    if (input.lines.length < 2 || debit <= 0n || debit !== credit || input.lines.some((line) => (line.debitRial ?? 0n) < 0n || (line.creditRial ?? 0n) < 0n || ((line.debitRial ?? 0n) > 0n && (line.creditRial ?? 0n) > 0n))) {
      throw new BadRequestException("ثبت حسابداری متوازن نیست و ذخیره نشد.");
    }
    const sequence = await tx.documentSequence.upsert({
      where: { businessId_branchId_type: { businessId: input.businessId, branchId: input.branchId, type: "JOURNAL" } },
      create: { businessId: input.businessId, branchId: input.branchId, type: "JOURNAL", nextValue: 2n },
      update: { nextValue: { increment: 1n } }, select: { nextValue: true },
    });
    const entryNo = `D-${String(sequence.nextValue - 1n).padStart(6, "0")}`;
    return tx.journalEntry.create({ data: {
      businessId: input.businessId, branchId: input.branchId, entryNo, txnDate: input.date, sourceType: input.sourceType, sourceId: input.sourceId,
      memo: input.memo, postedBy: input.actorId, reversalOfId: input.reversalOfId,
      lines: { create: input.lines.map((line) => ({ businessId: input.businessId, branchId: input.branchId, ledgerAccountId: line.ledgerAccountId, debitRial: line.debitRial ?? 0n, creditRial: line.creditRial ?? 0n, partyId: line.partyId ?? null, description: line.description })) },
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

  async remember(tx: Prisma.TransactionClient, input: { userId: string; businessId: string; key: string; requestHash: string; response: unknown }) {
    await tx.idempotencyRecord.create({ data: { userId: input.userId, businessId: input.businessId, key: input.key, requestHash: input.requestHash, responseJson: JSON.parse(JSON.stringify(input.response)), expiresAt: new Date(Date.now() + 90 * 86400 * 1000) } });
  }

  async account(tx: Prisma.TransactionClient, businessId: string, systemKey: string) {
    const row = await tx.ledgerAccount.findUnique({ where: { businessId_systemKey: { businessId, systemKey } } });
    if (!row) throw new Error(`Missing system ledger account: ${systemKey}`);
    return row.id;
  }
}
