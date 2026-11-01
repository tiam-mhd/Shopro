import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { normalizePersianSearch, toAsciiDigits } from "@shopro/contracts";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthenticatedUser, AppRequest } from "../common/request-context.js";
import { CreateBranchDto, CreateBusinessDto, UpdateBusinessDto, AddMemberDto } from "./businesses.dto.js";

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

  async create(user: AuthenticatedUser, dto: CreateBusinessDto, request: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: { displayName: dto.displayName.trim(), businessType: dto.businessType.trim(), displayCurrency: dto.displayCurrency ?? "IRT" },
      });
      const branch = await tx.branch.create({ data: { businessId: business.id, name: dto.initialBranchName.trim(), code: "MAIN" } });
      const membership = await tx.businessMember.create({ data: { businessId: business.id, userId: user.id, role: "OWNER" } });
      await tx.memberBranch.create({ data: { businessId: business.id, memberId: membership.id, branchId: branch.id } });
      const createdAccounts = new Map<string, string>();
      for (const [code, name, type, systemKey] of chart) {
        const account = await tx.ledgerAccount.create({ data: { businessId: business.id, code, name, type, systemKey } });
        if (systemKey) createdAccounts.set(systemKey, account.id);
      }
      await tx.unit.create({ data: { businessId: business.id, code: "unit", labelFa: "عدد", precision: 0 } });
      await tx.financeAccount.create({ data: { businessId: business.id, branchId: branch.id, name: "صندوق", kind: "CASH", ledgerAccountId: createdAccounts.get("cash")! } });
      await tx.expenseCategory.create({ data: { businessId: business.id, name: "هزینه عمومی", expenseLedgerAccountId: createdAccounts.get("general_expense")! } });
      await tx.auditEvent.create({ data: { businessId: business.id, actorId: user.id, action: "business.created", entityType: "business", entityId: business.id, requestId: request.requestId ?? "unknown", afterJson: { displayName: business.displayName, branchId: branch.id } } });
      return { id: business.id, displayName: business.displayName, role: membership.role, branch: { id: branch.id, name: branch.name, code: branch.code }, displayCurrency: business.displayCurrency };
    }, { isolationLevel: "Serializable" });
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
    const updated = await this.prisma.business.update({ where: { id: user.businessId! }, data: { displayName: dto.displayName?.trim(), displayCurrency: dto.displayCurrency, settingsVersion: { increment: 1 } } });
    await this.prisma.auditEvent.create({ data: { businessId: user.businessId!, actorId: user.id, action: "business.updated", entityType: "business", entityId: user.businessId!, requestId: request.requestId ?? "unknown", beforeJson: before, afterJson: { displayName: updated.displayName, displayCurrency: updated.displayCurrency } } });
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
    const branches = await this.prisma.branch.findMany({ where: { id: { in: dto.branchIds }, businessId, isActive: true }, select: { id: true } });
    if (!dto.branchIds.length || branches.length !== new Set(dto.branchIds).size) throw new BadRequestException("یک یا چند شعبه معتبر نیست.");
    const saved = await this.prisma.$transaction(async (tx) => {
      const membership = await tx.businessMember.upsert({
        where: { businessId_userId: { businessId, userId: memberUser.id } },
        create: { businessId, userId: memberUser.id, role: dto.role },
        update: { role: dto.role, status: "ACTIVE" },
      });
      await tx.memberBranch.deleteMany({ where: { businessId, memberId: membership.id } });
      await tx.memberBranch.createMany({ data: branches.map(({ id }) => ({ businessId, memberId: membership.id, branchId: id })) });
      await tx.auditEvent.create({ data: { businessId, actorId: user.id, action: "member.assigned", entityType: "business_member", entityId: membership.id, requestId: request.requestId ?? "unknown", afterJson: { phone, role: dto.role, branchIds: branches.map(({ id }) => id) } } });
      return membership;
    }, { isolationLevel: "Serializable" });
    return { id: saved.id, userId: memberUser.id, phone, role: saved.role, branchIds: branches.map(({ id }) => id) };
  }

  async members(user: AuthenticatedUser) {
    const businessId = this.requireBusiness(user);
    const rows = await this.prisma.businessMember.findMany({ where: { businessId }, include: { user: { select: { id: true, phone: true, displayName: true } }, branches: { select: { branchId: true } } }, orderBy: { createdAt: "asc" } });
    return rows.map((row) => ({ id: row.id, role: row.role, status: row.status, user: row.user, branchIds: row.branches.map(({ branchId }) => branchId) }));
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
}
