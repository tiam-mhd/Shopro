import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { normalizePersianSearch, toAsciiDigits } from "@shopro/contracts";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthenticatedUser, AppRequest } from "../common/request-context.js";
import type { CreateCustomerDto, CreatePartyDto, PartyFieldsDto, UpdateCustomerDto, UpdatePartyDto, UpdateSupplierDto } from "./parties.dto.js";
import { cursorPage, pageLimit } from "../common/cursor-pagination.js";
import { assertUuid } from "../common/uuid-param.pipe.js";

type PartyRole = "CUSTOMER" | "SUPPLIER";
type PartyFields = PartyFieldsDto & { creditLimitRial?: string | null; paymentTermsDays?: number | null };

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
    const roles = type === "CUSTOMER" ? ["CUSTOMER"] : type === "SUPPLIER" ? ["SUPPLIER"] : type === "BOTH" ? ["CUSTOMER", "SUPPLIER"] : [];
    const where: Prisma.PartyWhereInput = {
      businessId,
      archivedAt: null,
      ...(roles.includes("CUSTOMER") ? { customer: { isNot: null } } : {}),
      ...(roles.includes("SUPPLIER") ? { supplier: { isNot: null } } : {}),
      ...(normalized ? { OR: [{ normalizedName: { contains: normalized } }, ...(digits ? [{ phone: { contains: digits } }] : [])] } : {}),
    };
    if (cursor && !(await this.prisma.party.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))) throw new BadRequestException("نشانگر صفحه برای فهرست طرف‌حساب معتبر نیست؛ فهرست را دوباره بارگذاری کنید.");
    const rows = await this.prisma.party.findMany({
      where, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ normalizedName: "asc" }, { id: "asc" }], take: limit + (pageMode ? 1 : 0),
      select: {
        id: true, name: true, phone: true, email: true, nationalId: true, address: true, createdAt: true,
        customer: { select: { creditLimitRial: true } },
        supplier: { select: { paymentTermsDays: true } },
      },
    });
    if (!rows.length) return pageMode ? { items: [], nextCursor: null, hasMore: false } : [];
    const totals = await this.prisma.journalLine.groupBy({ by: ["partyId"], where: { businessId, partyId: { in: rows.map((row) => row.id) }, journalEntry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debitRial: true, creditRial: true } });
    const balances = new Map(totals.map((row) => [row.partyId!, (row._sum.debitRial ?? 0n) - (row._sum.creditRial ?? 0n)]));
    const mapped = rows.map((row) => ({
      id: row.id, name: row.name, phone: row.phone, email: row.email, nationalId: row.nationalId, address: row.address,
      type: this.roleType(Boolean(row.customer), Boolean(row.supplier)),
      creditLimitRial: row.customer?.creditLimitRial?.toString() ?? null,
      paymentTermsDays: row.supplier?.paymentTermsDays ?? null,
      createdAt: row.createdAt,
      balanceRial: (balances.get(row.id) ?? 0n).toString(),
    }));
    return pageMode ? cursorPage(mapped, limit, (row) => row.id) : mapped;
  }

  async create(user: AuthenticatedUser, dto: CreatePartyDto, request: AppRequest) {
    const roles: PartyRole[] = dto.type === "BOTH" ? ["CUSTOMER", "SUPPLIER"] : [dto.type];
    return this.createWithRoles(user, dto, roles, request);
  }

  createCustomer(user: AuthenticatedUser, dto: CreateCustomerDto, request: AppRequest) {
    return this.createWithRoles(user, dto, ["CUSTOMER"], request);
  }

  createSupplier(user: AuthenticatedUser, dto: PartyFields & { paymentTermsDays?: number | null }, request: AppRequest) {
    return this.createWithRoles(user, dto, ["SUPPLIER"], request);
  }

  private async createWithRoles(user: AuthenticatedUser, dto: PartyFields, roles: PartyRole[], request: AppRequest) {
    const businessId = this.business(user);
    this.requireCreateRole(user);
    const name = dto.name.trim();
    const creditLimitRial = roles.includes("CUSTOMER") ? this.money(dto.creditLimitRial) : null;
    const paymentTermsDays = roles.includes("SUPPLIER") ? this.paymentTerms(dto.paymentTermsDays) : null;
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.party.create({ data: {
        businessId, name, normalizedName: normalizePersianSearch(name),
        phone: dto.phone ? this.phone(dto.phone) : null,
        email: dto.email?.trim() || null,
        nationalId: dto.nationalId?.trim() || null,
        address: dto.address?.trim() || null,
      } });
      if (roles.includes("CUSTOMER")) await tx.customer.create({ data: { id: created.id, businessId, creditLimitRial } });
      if (roles.includes("SUPPLIER")) await tx.supplier.create({ data: { id: created.id, businessId, paymentTermsDays } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "party.created", entityType: "party", entityId: created.id, requestId: request.requestId ?? "unknown", afterJson: { roles, name: created.name } } });
      return created;
    });
    return { ...row, type: this.roleType(roles.includes("CUSTOMER"), roles.includes("SUPPLIER")), creditLimitRial: creditLimitRial?.toString() ?? null, paymentTermsDays };
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdatePartyDto, request: AppRequest) {
    const businessId = this.business(user);
    if (!["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) throw new ForbiddenException();
    const before = await this.prisma.party.findFirst({ where: { id, businessId, archivedAt: null }, include: { customer: true, supplier: true } });
    if (!before) throw new NotFoundException("طرف‌حساب پیدا نشد.");
    const oldCustomer = Boolean(before.customer);
    const oldSupplier = Boolean(before.supplier);
    const newCustomer = dto.type ? dto.type === "CUSTOMER" || dto.type === "BOTH" : oldCustomer;
    const newSupplier = dto.type ? dto.type === "SUPPLIER" || dto.type === "BOTH" : oldSupplier;
    const action = dto.isActive === false ? "party.archived" : dto.isActive === true ? "party.restored" : "party.updated";
    const creditLimitRial = dto.creditLimitRial === undefined ? undefined : this.money(dto.creditLimitRial);
    const paymentTermsDays = dto.paymentTermsDays === undefined ? undefined : this.paymentTerms(dto.paymentTermsDays);
    const after = await this.prisma.$transaction(async (tx) => {
      if (oldCustomer && !newCustomer) {
        const [sales, orders] = await Promise.all([
          tx.salesInvoice.count({ where: { customerId: id, businessId } }),
          tx.storefrontOrder.count({ where: { customerPartyId: id, businessId } }),
        ]);
        if (sales || orders) throw new ConflictException("این مشتری در سوابق فروش یا سفارش فروشگاه استفاده شده و نقش او قابل حذف نیست.");
        await tx.customer.delete({ where: { id } });
      }
      if (oldSupplier && !newSupplier) {
        const [purchases, expenses] = await Promise.all([
          tx.purchase.count({ where: { supplierId: id, businessId } }),
          tx.expense.count({ where: { payeeId: id, businessId } }),
        ]);
        if (purchases || expenses) throw new ConflictException("این تأمین‌کننده در سوابق خرید یا هزینه استفاده شده و نقش او قابل حذف نیست.");
        await tx.supplier.delete({ where: { id } });
      }
      if (!oldCustomer && newCustomer) await tx.customer.create({ data: { id, businessId, creditLimitRial: creditLimitRial ?? null } });
      if (!oldSupplier && newSupplier) await tx.supplier.create({ data: { id, businessId, paymentTermsDays: paymentTermsDays ?? null } });
      if (oldCustomer && newCustomer && creditLimitRial !== undefined) await tx.customer.update({ where: { id }, data: { creditLimitRial } });
      if (oldSupplier && newSupplier && paymentTermsDays !== undefined) await tx.supplier.update({ where: { id }, data: { paymentTermsDays } });
      const updated = await tx.party.update({ where: { id }, data: {
        name: dto.name?.trim(), normalizedName: dto.name ? normalizePersianSearch(dto.name) : undefined,
        phone: dto.phone === undefined ? undefined : dto.phone ? this.phone(dto.phone) : null,
        email: dto.email === undefined ? undefined : dto.email?.trim() || null,
        nationalId: dto.nationalId === undefined ? undefined : dto.nationalId?.trim() || null,
        address: dto.address === undefined ? undefined : dto.address?.trim() || null,
        archivedAt: dto.isActive === false ? new Date() : dto.isActive === true ? null : undefined,
      } });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action, entityType: "party", entityId: id, requestId: request.requestId ?? "unknown", beforeJson: { name: before.name, phone: before.phone, email: before.email, address: before.address }, afterJson: { name: updated.name, phone: updated.phone, email: updated.email, address: updated.address, roles: { customer: newCustomer, supplier: newSupplier }, isActive: updated.archivedAt === null } } });
      return updated;
    });
    return { ...after, type: this.roleType(newCustomer, newSupplier) };
  }

  updateCustomer(user: AuthenticatedUser, id: string, dto: UpdateCustomerDto, request: AppRequest) {
    return this.updateRole(user, id, "CUSTOMER", dto, request);
  }

  updateSupplier(user: AuthenticatedUser, id: string, dto: UpdateSupplierDto, request: AppRequest) {
    return this.updateRole(user, id, "SUPPLIER", dto, request);
  }

  private async updateRole(user: AuthenticatedUser, id: string, role: PartyRole, dto: UpdatePartyDto, request: AppRequest) {
    const businessId = this.business(user);
    const party = await this.prisma.party.findFirst({ where: { id, businessId, archivedAt: null }, select: { id: true, customer: { select: { id: true } }, supplier: { select: { id: true } } } });
    if (!party || (role === "CUSTOMER" ? !party.customer : !party.supplier)) throw new NotFoundException(role === "CUSTOMER" ? "مشتری پیدا نشد." : "تأمین‌کننده پیدا نشد.");
    return this.update(user, id, { ...dto, type: undefined }, request);
  }

  async statement(user: AuthenticatedUser, id: string, through?: string, cursor?: string, requestedLimit: string | number = 100) {
    const businessId = this.business(user);
    assertUuid(cursor, "نشانگر صفحه برای صورت‌حساب معتبر نیست.");
    const party = await this.prisma.party.findFirst({ where: { id, businessId, archivedAt: null }, select: {
      id: true, name: true, phone: true, email: true, nationalId: true, address: true,
      customer: { select: { creditLimitRial: true } }, supplier: { select: { paymentTermsDays: true } },
    } });
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
    return {
      party: {
        id: party.id, name: party.name, phone: party.phone, email: party.email, nationalId: party.nationalId, address: party.address,
        type: this.roleType(Boolean(party.customer), Boolean(party.supplier)),
        creditLimitRial: party.customer?.creditLimitRial?.toString() ?? null,
        paymentTermsDays: party.supplier?.paymentTermsDays ?? null,
      },
      entries, balanceRial: totalBalance.toString(), hasMore, nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
      openingBalanceRial: entries.length ? (BigInt(entries[0].balanceRial) - BigInt(entries[0].debitRial) + BigInt(entries[0].creditRial)).toString() : balance.toString(),
    };
  }

  private roleType(customer: boolean, supplier: boolean) { return customer && supplier ? "BOTH" : customer ? "CUSTOMER" : "SUPPLIER"; }
  private requireCreateRole(user: AuthenticatedUser) { if (!["OWNER", "MANAGER", "ACCOUNTANT", "CASHIER"].includes(user.role ?? "")) throw new ForbiddenException(); }
  private business(user: AuthenticatedUser) { if (!user.businessId) throw new BadRequestException("ابتدا یک کسب‌وکار انتخاب کنید."); return user.businessId; }
  private phone(input: string) { const digits = toAsciiDigits(input).replace(/[\s()+-]/g, ""); const value = digits.startsWith("98") ? `0${digits.slice(2)}` : digits; if (!/^09\d{9}$/.test(value)) throw new BadRequestException("شماره موبایل معتبر نیست."); return value; }
  private money(value: string | null | undefined) { if (value == null || value.trim() === "") return null; const normalized = toAsciiDigits(value).replace(/[٬,\s]/g, ""); if (!/^\d{1,20}$/.test(normalized)) throw new BadRequestException("سقف اعتبار باید عدد صحیح ریال باشد."); return BigInt(normalized); }
  private paymentTerms(value: number | null | undefined) { if (value == null) return null; if (!Number.isInteger(value) || value < 0 || value > 3650) throw new BadRequestException("مهلت پرداخت باید بین صفر تا ۳۶۵۰ روز باشد."); return value; }
  private date(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("تاریخ باید به شکل ISO باشد."); const date = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException("تاریخ معتبر نیست."); return date; }
}
