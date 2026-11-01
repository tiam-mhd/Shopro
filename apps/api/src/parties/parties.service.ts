import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { normalizePersianSearch, toAsciiDigits } from "@shopro/contracts";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthenticatedUser, AppRequest } from "../common/request-context.js";
import type { CreatePartyDto, UpdatePartyDto } from "./parties.dto.js";

@Injectable()
export class PartiesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthenticatedUser, search?: string, type?: string) {
    const businessId = this.business(user);
    const normalized = search ? normalizePersianSearch(search) : undefined;
    const digits = search ? toAsciiDigits(search).replace(/\D/g, "") : undefined;
    const rows = await this.prisma.party.findMany({
      where: {
        businessId, archivedAt: null,
        ...(type === "CUSTOMER" ? { type: { in: ["CUSTOMER", "BOTH"] as const } } : type === "SUPPLIER" ? { type: { in: ["SUPPLIER", "BOTH"] as const } } : {}),
        ...(normalized ? { OR: [{ normalizedName: { contains: normalized } }, ...(digits ? [{ phone: { contains: digits } }] : [])] } : {}),
      },
      orderBy: { normalizedName: "asc" }, take: 100,
      select: { id: true, type: true, name: true, phone: true, email: true, createdAt: true },
    });
    if (!rows.length) return [];
    const totals = await this.prisma.journalLine.groupBy({ by: ["partyId"], where: { businessId, partyId: { in: rows.map((row) => row.id) }, journalEntry: { status: "POSTED" } }, _sum: { debitRial: true, creditRial: true } });
    const balances = new Map(totals.map((row) => [row.partyId!, (row._sum.debitRial ?? 0n) - (row._sum.creditRial ?? 0n)]));
    return rows.map((row) => ({ ...row, balanceRial: (balances.get(row.id) ?? 0n).toString() }));
  }

  async create(user: AuthenticatedUser, dto: CreatePartyDto, request: AppRequest) {
    const businessId = this.business(user);
    if (!["OWNER", "MANAGER", "ACCOUNTANT", "CASHIER"].includes(user.role ?? "")) throw new ForbiddenException();
    const name = dto.name.trim();
    const row = await this.prisma.party.create({ data: { businessId, type: dto.type, name, normalizedName: normalizePersianSearch(name), phone: dto.phone ? this.phone(dto.phone) : null, email: dto.email?.trim() || null, address: dto.address?.trim() || null } });
    await this.audit(user, request, "party.created", row.id, null, { type: row.type, name: row.name });
    return row;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdatePartyDto, request: AppRequest) {
    const businessId = this.business(user);
    if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException();
    const before = await this.prisma.party.findFirst({ where: { id, businessId, archivedAt: null } });
    if (!before) throw new NotFoundException("طرف‌حساب پیدا نشد.");
    const after = await this.prisma.party.update({ where: { id }, data: { type: dto.type, name: dto.name?.trim(), normalizedName: dto.name ? normalizePersianSearch(dto.name) : undefined, phone: dto.phone === undefined ? undefined : dto.phone ? this.phone(dto.phone) : null, email: dto.email === undefined ? undefined : dto.email?.trim() || null, address: dto.address === undefined ? undefined : dto.address?.trim() || null, archivedAt: dto.isActive === false ? new Date() : dto.isActive === true ? null : undefined } });
    const action = dto.isActive === false ? "party.archived" : dto.isActive === true ? "party.restored" : "party.updated";
    await this.audit(user, request, action, id, { name: before.name, phone: before.phone, email: before.email, address: before.address }, { name: after.name, phone: after.phone, email: after.email, address: after.address, isActive: after.archivedAt === null });
    return after;
  }

  async statement(user: AuthenticatedUser, id: string, through?: string) {
    const businessId = this.business(user);
    const party = await this.prisma.party.findFirst({ where: { id, businessId, archivedAt: null }, select: { id: true, name: true, type: true, phone: true, email: true, address: true } });
    if (!party) throw new NotFoundException("طرف‌حساب پیدا نشد.");
    const throughDate = through ? this.date(through) : undefined;
    const lines = await this.prisma.journalLine.findMany({ where: { businessId, partyId: id, journalEntry: { status: "POSTED", ...(throughDate ? { txnDate: { lte: throughDate } } : {}) } }, include: { journalEntry: { select: { id: true, entryNo: true, txnDate: true, memo: true, sourceType: true } } }, orderBy: [{ journalEntry: { txnDate: "asc" } }, { id: "asc" }], take: 500 });
    let balance = 0n;
    const entries = lines.map((line) => {
      balance += line.debitRial - line.creditRial;
      return { id: line.id, date: line.journalEntry.txnDate.toISOString().slice(0, 10), entryNo: line.journalEntry.entryNo, description: line.description ?? line.journalEntry.memo, sourceType: line.journalEntry.sourceType, debitRial: line.debitRial.toString(), creditRial: line.creditRial.toString(), balanceRial: balance.toString() };
    });
    return { party, entries, balanceRial: balance.toString() };
  }

  private business(user: AuthenticatedUser) { if (!user.businessId) throw new BadRequestException("ابتدا یک کسب‌وکار انتخاب کنید."); return user.businessId; }
  private phone(input: string) { const digits = toAsciiDigits(input).replace(/[\s()+-]/g, ""); const value = digits.startsWith("98") ? `0${digits.slice(2)}` : digits; if (!/^09\d{9}$/.test(value)) throw new BadRequestException("شماره موبایل معتبر نیست."); return value; }
  private date(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("تاریخ باید به شکل ISO باشد."); const date = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException("تاریخ معتبر نیست."); return date; }
  private audit(user: AuthenticatedUser, request: AppRequest, action: string, entityId: string, beforeJson: object | null, afterJson: object) { return this.prisma.auditEvent.create({ data: { businessId: user.businessId!, actorId: user.id, action, entityType: "party", entityId, requestId: request.requestId ?? "unknown", beforeJson: beforeJson ?? undefined, afterJson } }); }
}
