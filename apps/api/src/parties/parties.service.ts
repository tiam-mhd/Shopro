import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { normalizePersianSearch, toAsciiDigits } from "@shopro/contracts";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthenticatedUser, AppRequest } from "../common/request-context.js";
import type { CreatePartyDto, UpdatePartyDto } from "./parties.dto.js";
import { cursorPage, pageLimit } from "../common/cursor-pagination.js";
import { assertUuid } from "../common/uuid-param.pipe.js";

@Injectable()
export class PartiesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthenticatedUser, search?: string, type?: string, cursor?: string, requestedLimit?: string) {
    const businessId = this.business(user);
    assertUuid(cursor, "نشانگر صفحه برای فهرست طرف‌حساب معتبر نیست.");
    const normalized = search ? normalizePersianSearch(search) : undefined;
    const digits = search ? toAsciiDigits(search).replace(/\D/g, "") : undefined;
    const pageMode = requestedLimit !== undefined || cursor !== undefined;
    const limit = pageMode ? pageLimit(requestedLimit) : 100;
    const where = {
      businessId, archivedAt: null,
      ...(type === "CUSTOMER" ? { type: { in: ["CUSTOMER", "BOTH"] as ["CUSTOMER", "BOTH"] } } : type === "SUPPLIER" ? { type: { in: ["SUPPLIER", "BOTH"] as ["SUPPLIER", "BOTH"] } } : {}),
      ...(normalized ? { OR: [{ normalizedName: { contains: normalized } }, ...(digits ? [{ phone: { contains: digits } }] : [])] } : {}),
    };
    if (cursor && !(await this.prisma.party.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))) throw new BadRequestException("نشانگر صفحه برای فهرست طرف‌حساب معتبر نیست؛ فهرست را دوباره بارگذاری کنید.");
    const rows = await this.prisma.party.findMany({
      where, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ normalizedName: "asc" }, { id: "asc" }], take: limit + (pageMode ? 1 : 0),
      select: { id: true, type: true, name: true, phone: true, email: true, createdAt: true },
    });
    if (!rows.length) return pageMode ? { items: [], nextCursor: null, hasMore: false } : [];
    const totals = await this.prisma.journalLine.groupBy({ by: ["partyId"], where: { businessId, partyId: { in: rows.map((row) => row.id) }, journalEntry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debitRial: true, creditRial: true } });
    const balances = new Map(totals.map((row) => [row.partyId!, (row._sum.debitRial ?? 0n) - (row._sum.creditRial ?? 0n)]));
    const mapped = rows.map((row) => ({ ...row, balanceRial: (balances.get(row.id) ?? 0n).toString() }));
    return pageMode ? cursorPage(mapped, limit, (row) => row.id) : mapped;
  }

  async create(user: AuthenticatedUser, dto: CreatePartyDto, request: AppRequest) {
    const businessId = this.business(user);
    if (!["OWNER", "MANAGER", "ACCOUNTANT", "CASHIER"].includes(user.role ?? "")) throw new ForbiddenException();
    const name = dto.name.trim();
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.party.create({ data: { businessId, type: dto.type, name, normalizedName: normalizePersianSearch(name), phone: dto.phone ? this.phone(dto.phone) : null, email: dto.email?.trim() || null, address: dto.address?.trim() || null } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "party.created", entityType: "party", entityId: created.id, requestId: request.requestId ?? "unknown", afterJson: { type: created.type, name: created.name } } });
      return created;
    });
    return row;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdatePartyDto, request: AppRequest) {
    const businessId = this.business(user);
    if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException();
    const before = await this.prisma.party.findFirst({ where: { id, businessId, archivedAt: null } });
    if (!before) throw new NotFoundException("طرف‌حساب پیدا نشد.");
    const action = dto.isActive === false ? "party.archived" : dto.isActive === true ? "party.restored" : "party.updated";
    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.party.update({ where: { id }, data: { type: dto.type, name: dto.name?.trim(), normalizedName: dto.name ? normalizePersianSearch(dto.name) : undefined, phone: dto.phone === undefined ? undefined : dto.phone ? this.phone(dto.phone) : null, email: dto.email === undefined ? undefined : dto.email?.trim() || null, address: dto.address === undefined ? undefined : dto.address?.trim() || null, archivedAt: dto.isActive === false ? new Date() : dto.isActive === true ? null : undefined } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action, entityType: "party", entityId: id, requestId: request.requestId ?? "unknown", beforeJson: { name: before.name, phone: before.phone, email: before.email, address: before.address }, afterJson: { name: updated.name, phone: updated.phone, email: updated.email, address: updated.address, isActive: updated.archivedAt === null } } });
      return updated;
    });
    return after;
  }

  async statement(user: AuthenticatedUser, id: string, through?: string, cursor?: string, requestedLimit: string | number = 100) {
    const businessId = this.business(user);
    assertUuid(cursor, "نشانگر صفحه برای صورت‌حساب معتبر نیست.");
    const party = await this.prisma.party.findFirst({ where: { id, businessId, archivedAt: null }, select: { id: true, name: true, type: true, phone: true, email: true, address: true } });
    if (!party) throw new NotFoundException("طرف‌حساب پیدا نشد.");
    const throughDate = through ? this.date(through) : undefined;
    const limit = pageLimit(String(requestedLimit), 100, 200);
    const where = { businessId, partyId: id, journalEntry: { is: { status: { in: ["POSTED", "REVERSED"] }, ...(throughDate ? { txnDate: { lte: throughDate } } : {}) } } } satisfies Prisma.JournalLineWhereInput;
    const cursorLine = cursor ? await this.prisma.journalLine.findFirst({ where: { ...where, id: cursor }, select: { id: true, journalEntry: { select: { txnDate: true } } } }) : null;
    if (cursor && !cursorLine) throw new BadRequestException("نشانگر صفحه معتبر نیست؛ گردش را دوباره بارگذاری کنید.");
    const lines = await this.prisma.journalLine.findMany({ where, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { journalEntry: { select: { id: true, entryNo: true, txnDate: true, memo: true, sourceType: true } } }, orderBy: [{ journalEntry: { txnDate: "asc" } }, { id: "asc" }], take: limit + 1 });
    const hasMore = lines.length > limit;
    const page = hasMore ? lines.slice(0, limit) : lines;
    let balance = 0n;
    if (cursor && page[0]) {
      const first = page[0];
      const opening = await this.prisma.journalLine.aggregate({
        where: { ...where, OR: [
          { journalEntry: { is: { txnDate: { lt: first.journalEntry.txnDate } } } },
          { journalEntry: { is: { txnDate: first.journalEntry.txnDate } }, id: { lt: first.id } },
        ] },
        _sum: { debitRial: true, creditRial: true },
      });
      balance = (opening._sum.debitRial ?? 0n) - (opening._sum.creditRial ?? 0n);
    }
    const entries = page.map((line) => {
      balance += line.debitRial - line.creditRial;
      return { id: line.id, date: line.journalEntry.txnDate.toISOString().slice(0, 10), entryNo: line.journalEntry.entryNo, description: line.description ?? line.journalEntry.memo, sourceType: line.journalEntry.sourceType, debitRial: line.debitRial.toString(), creditRial: line.creditRial.toString(), balanceRial: balance.toString() };
    });
    const totals = await this.prisma.journalLine.aggregate({ where, _sum: { debitRial: true, creditRial: true } });
    const totalBalance = (totals._sum.debitRial ?? 0n) - (totals._sum.creditRial ?? 0n);
    return { party, entries, balanceRial: totalBalance.toString(), hasMore, nextCursor: hasMore ? page.at(-1)?.id ?? null : null, openingBalanceRial: entries.length ? (BigInt(entries[0].balanceRial) - BigInt(entries[0].debitRial) + BigInt(entries[0].creditRial)).toString() : balance.toString() };
  }

  private business(user: AuthenticatedUser) { if (!user.businessId) throw new BadRequestException("ابتدا یک کسب‌وکار انتخاب کنید."); return user.businessId; }
  private phone(input: string) { const digits = toAsciiDigits(input).replace(/[\s()+-]/g, ""); const value = digits.startsWith("98") ? `0${digits.slice(2)}` : digits; if (!/^09\d{9}$/.test(value)) throw new BadRequestException("شماره موبایل معتبر نیست."); return value; }
  private date(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("تاریخ باید به شکل ISO باشد."); const date = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException("تاریخ معتبر نیست."); return date; }
}
