import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { normalizePersianSearch, toAsciiDigits } from "@shopro/contracts";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthenticatedUser, AppRequest } from "../common/request-context.js";
import { cursorPage, pageLimit } from "../common/cursor-pagination.js";
import { CreateBranchDto, CreateBusinessDto, UpdateBusinessDto, AddMemberDto, UpdateMemberDto } from "./businesses.dto.js";
import { UNIT_CATALOG } from "../products/unit-catalog.js";

const chart = [
  ["1000", "دارایی‌ها", "ASSET", null],
  ["1100", "صندوق و بانک", "ASSET", "cash"],
  ["1200", "حساب‌های دریافتنی", "ASSET", "accounts_receivable"],
  ["1300", "موجودی کالا", "ASSET", "inventory"],
  ["1400", "مالیات خرید", "ASSET", "input_tax"],
  ["2000", "بدهی‌ها", "LIABILITY", null],
  ["2100", "حساب‌های پرداختنی", "LIABILITY", "accounts_payable"],
  ["2200", "مالیات فروش", "LIABILITY", "output_tax"],
  ["3000", "سرمایه", "EQUITY", "equity"],
  ["4000", "درآمد فروش", "REVENUE", "sales_revenue"],
  ["4100", "سایر درآمدها", "REVENUE", "other_income"],
  ["5000", "بهای تمام‌شده", "EXPENSE", "cost_of_goods"],
  ["6000", "هزینه‌های عمومی", "EXPENSE", "general_expense"],
] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class BusinessesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthenticatedUser) {
    const memberships = await this.prisma.businessMember.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      include: { business: { include: { branches: { where: { isActive: true }, orderBy: { createdAt: "asc" } } } }, branches: true },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map(({ business, role, branches }) => ({
      id: business.id,
      displayName: business.displayName,
      businessType: business.businessType,
      timezone: business.timezone,
      displayCurrency: business.displayCurrency,
      role,
      branches: business.branches.filter((branch) => branches.some((access) => access.branchId === branch.id)).map((branch) => ({ id: branch.id, name: branch.name, code: branch.code })),
    }));
  }

  async create(user: AuthenticatedUser, dto: CreateBusinessDto, request: AppRequest, rawKey?: string) {
    const input = {
      displayName: dto.displayName.trim(),
      businessType: dto.businessType?.trim() || "فروشگاه",
      initialBranchName: dto.initialBranchName.trim(),
      displayCurrency: dto.displayCurrency ?? "IRT",
    };
    const key = rawKey?.trim();
    if (key && !/^[A-Za-z0-9][A-Za-z0-9:._-]{7,127}$/.test(key)) throw new BadRequestException("کلید یکتای ساخت کسب‌وکار معتبر نیست.");
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    if (key) {
      const previous = await this.prisma.businessCreationRequest.findUnique({ where: { userId_key: { userId: user.id, key } } });
      if (previous) return this.createdBusinessForRequest(user.id, previous, requestHash);
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const business = await tx.business.create({
          data: { displayName: input.displayName, businessType: input.businessType, displayCurrency: input.displayCurrency },
        });
        const branch = await tx.branch.create({ data: { businessId: business.id, name: input.initialBranchName, code: "MAIN" } });
        const membership = await tx.businessMember.create({ data: { businessId: business.id, userId: user.id, role: "OWNER" } });
        await tx.memberBranch.create({ data: { businessId: business.id, memberId: membership.id, branchId: branch.id } });
        const createdAccounts = new Map<string, string>();
        for (const [code, name, type, systemKey] of chart) {
          const account = await tx.ledgerAccount.create({ data: { businessId: business.id, code, name, type, systemKey } });
          if (systemKey) createdAccounts.set(systemKey, account.id);
        }
        await tx.unit.createMany({ data: UNIT_CATALOG.map(({ defaultVisible, ...unit }) => ({ id: randomUUID(), businessId: business.id, ...unit, isVisible: defaultVisible })) });
        await tx.financeAccount.create({ data: { businessId: business.id, branchId: branch.id, name: "صندوق", kind: "CASH", ledgerAccountId: createdAccounts.get("cash")! } });
        await tx.expenseCategory.create({ data: { businessId: business.id, name: "هزینه عمومی", expenseLedgerAccountId: createdAccounts.get("general_expense")! } });
        if (key) await tx.businessCreationRequest.create({ data: { userId: user.id, businessId: business.id, branchId: branch.id, key, requestHash } });
        await tx.auditEvent.create({ data: { businessId: business.id, actorId: user.id, action: "business.created", entityType: "business", entityId: business.id, requestId: request.requestId ?? "unknown", afterJson: { displayName: business.displayName, branchId: branch.id } } });
        return { id: business.id, displayName: business.displayName, role: membership.role, branch: { id: branch.id, name: branch.name, code: branch.code }, displayCurrency: business.displayCurrency };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (key && this.isIdempotencyRace(error)) {
        const previous = await this.prisma.businessCreationRequest.findUnique({ where: { userId_key: { userId: user.id, key } } });
        if (previous) return this.createdBusinessForRequest(user.id, previous, requestHash);
      }
      throw error;
    }
  }

  async current(user: AuthenticatedUser) {
    const businessId = this.requireBusiness(user);
    const business = await this.prisma.business.findUnique({ where: { id: businessId }, include: { branches: { where: { isActive: true }, orderBy: { createdAt: "asc" } } } });
    if (!business) throw new NotFoundException("کسب‌وکار پیدا نشد.");
    return { ...business, branches: business.branches.filter((branch) => user.branchIds?.includes(branch.id)) };
  }

  async update(user: AuthenticatedUser, dto: UpdateBusinessDto, request: AppRequest) {
    this.requireBusiness(user);
    if (!(["OWNER", "MANAGER"].includes(user.role ?? ""))) throw new ForbiddenException("اجازهٔ تغییر تنظیمات کسب‌وکار را ندارید.");
    const before = await this.prisma.business.findUnique({ where: { id: user.businessId! }, select: { displayName: true, displayCurrency: true } });
    if (!before) throw new NotFoundException("کسب‌وکار پیدا نشد.");
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.business.update({ where: { id: user.businessId! }, data: { displayName: dto.displayName?.trim(), displayCurrency: dto.displayCurrency, settingsVersion: { increment: 1 } } });
      await tx.auditEvent.create({ data: { businessId: user.businessId!, actorId: user.id, action: "business.updated", entityType: "business", entityId: user.businessId!, requestId: request.requestId ?? "unknown", beforeJson: before, afterJson: { displayName: row.displayName, displayCurrency: row.displayCurrency } } });
      return row;
    });
    return { id: updated.id, displayName: updated.displayName, displayCurrency: updated.displayCurrency };
  }

  async createBranch(user: AuthenticatedUser, dto: CreateBranchDto, request: AppRequest) {
    const businessId = this.requireBusiness(user);
    if (!(["OWNER", "MANAGER"].includes(user.role ?? ""))) throw new ForbiddenException("اجازهٔ ساخت شعبه را ندارید.");
    const member = await this.prisma.businessMember.findUnique({ where: { id: user.memberId! } });
    if (!member) throw new ForbiddenException();
    try {
      const branch = await this.prisma.$transaction(async (tx) => {
        const row = await tx.branch.create({ data: { businessId, name: dto.name.trim(), code: dto.code.trim().toUpperCase() } });
        await tx.memberBranch.create({ data: { businessId, memberId: member.id, branchId: row.id } });
        const cash = await tx.ledgerAccount.findUniqueOrThrow({ where: { businessId_systemKey: { businessId, systemKey: "cash" } } });
        await tx.financeAccount.create({ data: { businessId, branchId: row.id, name: "صندوق", kind: "CASH", ledgerAccountId: cash.id } });
        await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "branch.created", entityType: "branch", entityId: row.id, requestId: request.requestId ?? "unknown", afterJson: { name: row.name, code: row.code } } });
        return row;
      }, { isolationLevel: "Serializable" });
      return { id: branch.id, name: branch.name, code: branch.code };
    } catch (error) {
      if (this.isUnique(error)) throw new ConflictException("کد این شعبه قبلاً استفاده شده است.");
      throw error;
    }
  }

  async addMember(user: AuthenticatedUser, dto: AddMemberDto, request: AppRequest) {
    const businessId = this.requireBusiness(user);
    if (user.role !== "OWNER") throw new ForbiddenException("فقط مالک کسب‌وکار می‌تواند کاربران را مدیریت کند.");
    const phone = this.normalizePhone(dto.phone);
    const memberUser = await this.prisma.user.findUnique({ where: { phone } });
    if (!memberUser) throw new BadRequestException("این شماره هنوز در سامانه ثبت نشده است. ابتدا کاربر باید با کد یک‌بارمصرف وارد شود.");
    let saved: { membership: { id: string; role: string; status: string }; branchIds: string[] };
    try {
      saved = await this.prisma.$transaction(async (tx) => {
        const branches = await tx.branch.findMany({ where: { id: { in: dto.branchIds }, businessId, isActive: true }, select: { id: true } });
        if (!dto.branchIds.length || branches.length !== new Set(dto.branchIds).size) throw new BadRequestException("یک یا چند شعبه معتبر نیست.");
        const existing = await tx.businessMember.findUnique({ where: { businessId_userId: { businessId, userId: memberUser.id } }, select: { id: true } });
        if (existing) throw new ConflictException("این کاربر قبلاً عضو کسب‌وکار است؛ دسترسی او را از فهرست اعضا ویرایش کنید.");
        const membership = await tx.businessMember.create({ data: { businessId, userId: memberUser.id, role: dto.role } });
        await tx.memberBranch.createMany({ data: branches.map(({ id }) => ({ businessId, memberId: membership.id, branchId: id })) });
        await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "member.assigned", entityType: "business_member", entityId: membership.id, requestId: request.requestId ?? "unknown", afterJson: { phone, role: dto.role, branchIds: branches.map(({ id }) => id) } } });
        return { membership, branchIds: branches.map(({ id }) => id) };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (this.isUnique(error)) throw new ConflictException("این کاربر هم‌زمان به کسب‌وکار اضافه شده است؛ فهرست اعضا را تازه‌سازی کنید.");
      throw error;
    }
    return { id: saved.membership.id, userId: memberUser.id, phone, role: saved.membership.role, status: saved.membership.status, branchIds: saved.branchIds };
  }

  async updateMember(user: AuthenticatedUser, id: string, dto: UpdateMemberDto, request: AppRequest) {
    const businessId = this.requireBusiness(user);
    if (user.role !== "OWNER") throw new ForbiddenException("فقط مالک کسب‌وکار می‌تواند کاربران را مدیریت کند.");
    if (dto.role === undefined && dto.status === undefined && dto.branchIds === undefined) throw new BadRequestException("حداقل یک مورد برای تغییر انتخاب کنید.");
    const result = await this.prisma.$transaction(async (tx) => {
      const member = await tx.businessMember.findFirst({
        where: { id, businessId },
        include: { user: { select: { id: true, phone: true } }, branches: { select: { branchId: true } } },
      });
      if (!member) throw new NotFoundException("عضو کسب‌وکار پیدا نشد.");
      if (member.userId === user.id) throw new BadRequestException("برای جلوگیری از قطع دسترسی مالک، دسترسی حساب خودتان را از این صفحه تغییر ندهید.");
      if (member.role === "OWNER") throw new ConflictException("تغییر یا تعلیق مالک نیازمند فرایند انتقال مالکیت است.");

      let branchIds = member.branches.map(({ branchId }) => branchId);
      if (dto.branchIds !== undefined) {
        const branches = await tx.branch.findMany({ where: { id: { in: dto.branchIds }, businessId, isActive: true }, select: { id: true } });
        if (!dto.branchIds.length || branches.length !== new Set(dto.branchIds).size) throw new BadRequestException("حداقل یک شعبهٔ فعال و متعلق به همین کسب‌وکار انتخاب کنید.");
        branchIds = branches.map(({ id: branchId }) => branchId);
      }

      const nextRole = dto.role ?? member.role;
      const nextStatus = dto.status ?? member.status;
      if (nextStatus === "ACTIVE" && branchIds.length === 0) throw new BadRequestException("برای فعال‌بودن عضو، دست‌کم یک شعبه باید به او اختصاص داده شود.");
      const updated = await tx.businessMember.update({ where: { id: member.id }, data: { role: nextRole, status: nextStatus } });
      if (dto.branchIds !== undefined) {
        await tx.memberBranch.deleteMany({ where: { businessId, memberId: member.id } });
        await tx.memberBranch.createMany({ data: branchIds.map((branchId) => ({ businessId, memberId: member.id, branchId })) });
      }
      const action = nextStatus !== member.status ? (nextStatus === "SUSPENDED" ? "member.suspended" : "member.reactivated") : "member.access.updated";
      await tx.auditEvent.create({ data: {
        businessId, actorId: user.id, action, entityType: "business_member", entityId: member.id, requestId: request.requestId ?? "unknown",
        beforeJson: { role: member.role, status: member.status, branchIds: member.branches.map(({ branchId }) => branchId) },
        afterJson: { role: updated.role, status: updated.status, branchIds },
      } });
      return { id: updated.id, userId: member.user.id, phone: member.user.phone, role: updated.role, status: updated.status, branchIds };
    }, { isolationLevel: "Serializable" });
    return result;
  }

  async memberHistory(user: AuthenticatedUser, id: string) {
    const businessId = this.requireBusiness(user);
    if (user.role !== "OWNER") throw new ForbiddenException("تاریخچهٔ دسترسی اعضا فقط برای مالک کسب‌وکار قابل مشاهده است.");
    const member = await this.prisma.businessMember.findFirst({ where: { id, businessId }, select: { id: true } });
    if (!member) throw new NotFoundException("عضو کسب‌وکار پیدا نشد.");
    const rows = await this.prisma.auditEvent.findMany({
      where: { businessId, entityType: "business_member", entityId: id, action: { startsWith: "member." } },
      select: { action: true, occurredAt: true, beforeJson: true, afterJson: true, actor: { select: { displayName: true } } },
      orderBy: { occurredAt: "desc" }, take: 100,
    });
    return rows.map((row) => ({ action: row.action, occurredAt: row.occurredAt.toISOString(), actorName: row.actor?.displayName ?? null, before: row.beforeJson, after: row.afterJson }));
  }

  async auditEvents(user: AuthenticatedUser, filters: { actorId?: string; action?: string; entityType?: string; from?: string; to?: string; cursor?: string; limit?: string }) {
    const businessId = this.requireBusiness(user);
    if (user.role !== "OWNER") throw new ForbiddenException("گزارش رویدادهای کسب‌وکار فقط برای مالک قابل مشاهده است.");
    const action = filters.action?.trim();
    const entityType = filters.entityType?.trim();
    if (filters.actorId && !UUID_PATTERN.test(filters.actorId)) throw new BadRequestException("شناسهٔ کاربر برای فیلتر معتبر نیست.");
    if (filters.cursor && !UUID_PATTERN.test(filters.cursor)) throw new BadRequestException("نشانگر صفحه برای تاریخچهٔ رویدادها معتبر نیست.");
    if (action && action.length > 80) throw new BadRequestException("فیلتر عملیات بیش از حد طولانی است.");
    if (entityType && entityType.length > 80) throw new BadRequestException("فیلتر نوع مورد بیش از حد طولانی است.");
    const from = this.auditDate(filters.from);
    const toExclusive = this.auditDate(filters.to, true);
    if (from && toExclusive && from >= toExclusive) throw new BadRequestException("بازهٔ تاریخ رویداد معتبر نیست.");
    const where = {
      businessId,
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(action ? { action: { contains: action, mode: "insensitive" as const } } : {}),
      ...(entityType ? { entityType: { contains: entityType, mode: "insensitive" as const } } : {}),
      ...(from || toExclusive ? { occurredAt: { ...(from ? { gte: from } : {}), ...(toExclusive ? { lt: toExclusive } : {}) } } : {}),
    };
    const limit = pageLimit(filters.limit, 50, 100);
    if (filters.cursor && !(await this.prisma.auditEvent.findFirst({ where: { ...where, id: filters.cursor }, select: { id: true } }))) throw new BadRequestException("نشانگر صفحه برای تاریخچهٔ رویدادها معتبر نیست؛ فهرست را دوباره بارگذاری کنید.");
    const rows = await this.prisma.auditEvent.findMany({
      where,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      select: { id: true, action: true, entityType: true, entityId: true, occurredAt: true, actor: { select: { id: true, displayName: true } } },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const mapped = rows.map((row) => ({ id: row.id, action: row.action, entityType: row.entityType, entityId: row.entityId, occurredAt: row.occurredAt.toISOString(), actorId: row.actor?.id ?? null, actorName: row.actor?.displayName ?? null }));
    return cursorPage(mapped, limit, (row) => row.id);
  }

  async members(user: AuthenticatedUser) {
    const businessId = this.requireBusiness(user);
    const rows = await this.prisma.businessMember.findMany({ where: { businessId }, include: { user: { select: { id: true, phone: true, displayName: true } }, branches: { select: { branchId: true } } }, orderBy: { createdAt: "asc" } });
    return rows.map((row) => ({ id: row.id, role: row.role, status: row.status, user: { id: row.user.id, displayName: row.user.displayName, phone: user.role === "OWNER" || row.user.id === user.id ? row.user.phone : this.maskPhone(row.user.phone) }, branchIds: row.branches.map(({ branchId }) => branchId) }));
  }

  private maskPhone(phone: string) { return `${phone.slice(0, 3)}•••••${phone.slice(-3)}`; }

  private auditDate(value: string | undefined, exclusiveEnd = false) {
    if (value === undefined) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException("تاریخ باید به قالب سال-ماه-روز باشد.");
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException("تاریخ رویداد معتبر نیست.");
    if (exclusiveEnd) date.setUTCDate(date.getUTCDate() + 1);
    return date;
  }

  private requireBusiness(user: AuthenticatedUser) {
    if (!user.businessId) throw new BadRequestException("ابتدا یک کسب‌وکار انتخاب کنید.");
    return user.businessId;
  }
  private normalizePhone(input: string) {
    const digits = toAsciiDigits(input).replace(/[\s()+-]/g, "");
    const phone = digits.startsWith("98") ? `0${digits.slice(2)}` : digits;
    if (!/^09\d{9}$/.test(phone)) throw new BadRequestException("شماره موبایل معتبر نیست.");
    return phone;
  }
  private isUnique(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === "P2002"; }
  private isIdempotencyRace(error: unknown) { return typeof error === "object" && error !== null && "code" in error && ["P2002", "P2034"].includes(String(error.code)); }

  private async createdBusinessForRequest(userId: string, previous: { requestHash: string; businessId: string; branchId: string }, requestHash: string) {
    if (previous.requestHash !== requestHash) throw new ConflictException("این کلید برای درخواست دیگری استفاده شده است.");
    const [business, branch, membership] = await Promise.all([
      this.prisma.business.findFirst({ where: { id: previous.businessId }, select: { id: true, displayName: true, displayCurrency: true } }),
      this.prisma.branch.findFirst({ where: { id: previous.branchId, businessId: previous.businessId, isActive: true }, select: { id: true, name: true, code: true } }),
      this.prisma.businessMember.findFirst({ where: { businessId: previous.businessId, userId, role: "OWNER", status: "ACTIVE", branches: { some: { branchId: previous.branchId } } }, select: { role: true } }),
    ]);
    if (!business || !branch || !membership) throw new ForbiddenException("به کسب‌وکار این درخواست دسترسی فعال ندارید.");
    return { id: business.id, displayName: business.displayName, role: membership.role, branch, displayCurrency: business.displayCurrency };
  }
}
