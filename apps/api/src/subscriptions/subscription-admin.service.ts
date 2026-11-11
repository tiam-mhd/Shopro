import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { SystemAdminAuthService } from "../auth/system-admin-auth.service.js";
import { cursorPage, pageLimit } from "../common/cursor-pagination.js";
import type { AppRequest, AuthenticatedSystemAdmin } from "../common/request-context.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { addJalaliMonths, isSubscriptionPeriodActive } from "./jalali-period.js";
import type { CreateSubscriptionPlanDto, CreateSubscriptionPriceDto, SubscriptionActionPreviewDto, SubscriptionGrantDto, SubscriptionReasonDto, SubscriptionRolloutDto, SubscriptionSensitiveReasonDto, UpdateSubscriptionPlanDto } from "./subscriptions.dto.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DURATIONS = new Set([1, 3, 6, 12]);

function tehranDateKey(date: Date) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

@Injectable()
export class SubscriptionAdminService {
  constructor(private readonly prisma: PrismaService, private readonly adminAuth: SystemAdminAuthService) {}

  async plans(admin: AuthenticatedSystemAdmin, request: AppRequest) {
    const rows = await this.prisma.subscriptionPlan.findMany({
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
      include: { prices: { orderBy: [{ durationMonths: "asc" }, { effectiveFrom: "desc" }], include: { _count: { select: { orders: true } } } } },
    });
    await this.audit(admin, request, "subscription.plans.read", "subscription_plan_collection", null, { count: rows.length });
    return rows.map((plan) => ({
      id: plan.id, code: plan.code, nameFa: plan.nameFa, displayOrder: plan.displayOrder, isActive: plan.isActive,
      badge: plan.badge, features: toStringArray(plan.features),
      prices: plan.prices.map((price) => ({
        id: price.id, durationMonths: price.durationMonths, priceRial: price.priceRial.toString(), currency: price.currency,
        effectiveFrom: price.effectiveFrom.toISOString(),
        effectiveTo: price.effectiveTo?.toISOString() ?? plan.prices.filter((next) => next.durationMonths === price.durationMonths && next.effectiveFrom > price.effectiveFrom).sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime())[0]?.effectiveFrom.toISOString() ?? null,
        consumedOrderCount: price._count.orders,
        immutable: price._count.orders > 0,
      })),
    }));
  }

  async createPlan(admin: AuthenticatedSystemAdmin, request: AppRequest, dto: CreateSubscriptionPlanDto) {
    const plan = await this.prisma.$transaction(async (tx) => {
      const created = await tx.subscriptionPlan.create({ data: {
        code: dto.code,
        nameFa: dto.nameFa.trim(),
        displayOrder: dto.displayOrder,
        isActive: dto.isActive ?? true,
        badge: dto.badge?.trim() || null,
        features: dto.features ?? [],
      } });
      await this.record(tx, admin, request, "subscription.plan.created", "subscription_plan", created.id, { code: created.code, reason: "ایجاد پلن" });
      return created;
    });
    return this.planDto(plan);
  }

  async updatePlan(admin: AuthenticatedSystemAdmin, request: AppRequest, planId: string, dto: UpdateSubscriptionPlanDto) {
    if (!Object.keys(dto).length) throw new BadRequestException("حداقل یک تغییر برای ذخیره وارد کنید.");
    const plan = await this.prisma.$transaction(async (tx) => {
      const previous = await tx.subscriptionPlan.findUnique({ where: { id: planId } });
      if (!previous) throw new NotFoundException("پلن اشتراک پیدا نشد.");
      const updated = await tx.subscriptionPlan.update({ where: { id: planId }, data: {
        ...(dto.nameFa !== undefined ? { nameFa: dto.nameFa.trim() } : {}),
        ...(dto.displayOrder !== undefined ? { displayOrder: dto.displayOrder } : {}),
        ...(dto.badge !== undefined ? { badge: dto.badge?.trim() || null } : {}),
        ...(dto.features !== undefined ? { features: dto.features } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      } });
      await this.record(tx, admin, request, "subscription.plan.updated", "subscription_plan", planId, {
        code: updated.code, changedFields: Object.keys(dto).sort(), beforeActive: previous.isActive, afterActive: updated.isActive,
      });
      return updated;
    });
    return this.planDto(plan);
  }

  async addPrice(admin: AuthenticatedSystemAdmin, request: AppRequest, planId: string, dto: CreateSubscriptionPriceDto) {
    const amount = BigInt(dto.priceRial);
    if (!DURATIONS.has(dto.durationMonths) || amount < 0n) throw new BadRequestException("مدت یا مبلغ قیمت معتبر نیست.");
    const requestedFrom = new Date(dto.effectiveFrom);
    if (Number.isNaN(requestedFrom.getTime())) throw new BadRequestException("تاریخ مؤثر نسخهٔ قیمت معتبر نیست.");
    const now = new Date();
    const requestedDate = tehranDateKey(requestedFrom);
    const today = tehranDateKey(now);
    if (requestedDate < today) throw new BadRequestException("تاریخ شروع قیمت نمی‌تواند در گذشته باشد.");
    // A Jalali date selected for today means activate now; future dates start at Tehran midnight.
    const effectiveFrom = requestedDate === today ? now : requestedFrom;
    const immediate = requestedDate === today;
    const price = await this.prisma.$transaction(async (tx) => {
      const plan = await tx.subscriptionPlan.findUnique({ where: { id: planId }, select: { id: true, code: true } });
      if (!plan) throw new NotFoundException("پلن اشتراک پیدا نشد.");
      const latest = await tx.subscriptionPriceVersion.findFirst({ where: { planId, durationMonths: dto.durationMonths }, orderBy: { effectiveFrom: "desc" } });
      if (immediate) {
        const explicitOverlap = await tx.subscriptionPriceVersion.findFirst({
          where: { planId, durationMonths: dto.durationMonths, effectiveFrom: { lte: now }, effectiveTo: { gt: now } },
          select: { id: true },
        });
        if (explicitOverlap) throw new ConflictException("نسخهٔ قبلی بازهٔ پایان صریح دارد؛ برای جلوگیری از هم‌پوشانی، تاریخ آینده انتخاب کنید.");
      } else if (latest && effectiveFrom <= latest.effectiveFrom) {
        throw new ConflictException("نسخهٔ قیمت جدید باید بعد از آخرین نسخه شروع شود؛ نسخهٔ قبلی و سفارش‌های آن تغییر نمی‌کنند.");
      }
      const created = await tx.subscriptionPriceVersion.create({ data: {
        planId, durationMonths: dto.durationMonths, priceRial: amount, currency: "IRR", effectiveFrom, createdById: admin.id,
      } });
      await this.record(tx, admin, request, "subscription.price.created", "subscription_price_version", created.id, {
        planCode: plan.code, durationMonths: dto.durationMonths, priceRial: amount.toString(), effectiveFrom: effectiveFrom.toISOString(),
      });
      return created;
    });
    const assumptions = await this.prisma.subscriptionRolloutSetting.findUnique({ where: { id: "global" } });
    const unknownInputs = [
      assumptions?.providerFeeBasisPoints == null ? "provider_fee" : null,
      assumptions?.taxRateBasisPoints == null ? "tax_obligation" : null,
      assumptions?.variableCostRial == null ? "variable_cost" : null,
    ].filter((value): value is string => value !== null);
    const estimatedNet = assumptions?.providerFeeBasisPoints != null && assumptions.taxRateBasisPoints != null && assumptions.variableCostRial != null
      ? amount - amount * BigInt(assumptions.providerFeeBasisPoints) / 10_000n - amount * BigInt(assumptions.taxRateBasisPoints) / 10_000n - assumptions.variableCostRial
      : null;
    const belowContributionFloor = estimatedNet !== null && assumptions?.minimumContributionRial != null && estimatedNet < assumptions.minimumContributionRial;
    return {
      id: price.id, durationMonths: price.durationMonths, priceRial: price.priceRial.toString(), currency: price.currency, effectiveFrom: price.effectiveFrom.toISOString(),
      belowContributionFloor, estimatedContributionRial: estimatedNet?.toString() ?? null,
      warning: belowContributionFloor ? "سهم خالص تخمینی از حداقل ثبت‌شده کمتر است." : unknownInputs.length ? `هزینه/تعهد هنوز نامشخص است: ${unknownInputs.join(", ")}. سودآوری قابل برآورد نیست.` : null,
    };
  }

  async branches(admin: AuthenticatedSystemAdmin, request: AppRequest, query: { q?: string; status?: string; cursor?: string; limit?: string }) {
    const q = query.q?.trim();
    if (q && (q.length > 80 || /[\u0000-\u001f\u007f]/.test(q))) throw new BadRequestException("عبارت جست‌وجو معتبر نیست.");
    const now = new Date();
    const where: Prisma.BranchWhereInput = { isActive: true };
    const predicates: Prisma.BranchWhereInput[] = [];
    if (q) predicates.push({ OR: [
      { name: { contains: q, mode: "insensitive" } },
      { code: { contains: q, mode: "insensitive" } },
      { business: { displayName: { contains: q, mode: "insensitive" } } },
    ] });
    if (query.status === "ACTIVE") where.subscription = { some: { suspendedAt: null, periods: { some: { revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } } } } };
    if (query.status === "SUSPENDED") where.subscription = { some: { suspendedAt: { not: null } } };
    if (query.status === "REQUIRED") predicates.push({ OR: [{ subscription: { none: {} } }, { subscription: { some: { suspendedAt: null, periods: { none: { revokedAt: null } } } } }] });
    if (query.status && !["ACTIVE", "SUSPENDED", "REQUIRED", "EXPIRED"].includes(query.status)) throw new BadRequestException("وضعیت فیلتر معتبر نیست.");
    if (query.status === "EXPIRED") where.subscription = { some: { suspendedAt: null, periods: { some: { revokedAt: null, endsAt: { lte: now } }, none: { revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } } } } };
    if (predicates.length) where.AND = predicates;
    const limit = pageLimit(query.limit, 30, 100);
    if (query.cursor) {
      if (!UUID_PATTERN.test(query.cursor)) throw new BadRequestException("نشانگر صفحه معتبر نیست.");
      const cursorExists = await this.prisma.branch.findFirst({ where: { ...where, id: query.cursor }, select: { id: true } });
      if (!cursorExists) throw new BadRequestException("نشانگر صفحه برای این فیلتر معتبر نیست؛ فهرست را تازه‌سازی کنید.");
    }
    const rows = await this.prisma.branch.findMany({
      where,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: { business: { select: { id: true, displayName: true } }, subscription: { take: 1, include: { periods: { where: { revokedAt: null }, orderBy: [{ endsAt: "desc" }, { id: "desc" }], take: 10, include: { order: true } } } } },
    });
    const page = cursorPage(rows, limit, (row) => row.id);
    await this.audit(admin, request, "subscription.branches.list", "branch_subscription_collection", null, { resultCount: page.items.length, searched: Boolean(q), status: query.status ?? "ALL", cursorUsed: Boolean(query.cursor) });
    const rollout = await this.prisma.subscriptionRolloutSetting.findUnique({ where: { id: "global" } });
    return {
      ...page,
      items: page.items.map((branch) => this.branchDto(branch, now, rollout?.mode ?? "OBSERVE", rollout?.legacyGraceEndsAt ?? null)),
    };
  }

  async orders(admin: AuthenticatedSystemAdmin, request: AppRequest, query: { q?: string; status?: string; cursor?: string; limit?: string }) {
    const q = query.q?.trim();
    if (q && (q.length > 80 || /[\u0000-\u001f\u007f]/.test(q))) throw new BadRequestException("عبارت جست‌وجو معتبر نیست.");
    const where: Prisma.SubscriptionOrderWhereInput = {};
    if (q) where.OR = [
      { planNameFaSnapshot: { contains: q, mode: "insensitive" } },
      { branch: { name: { contains: q, mode: "insensitive" } } },
      { business: { displayName: { contains: q, mode: "insensitive" } } },
      { providerReference: { contains: q, mode: "insensitive" } },
    ];
    if (query.status) {
      if (!["PENDING", "PAID", "FAILED", "CANCELLED", "REFUNDED"].includes(query.status)) throw new BadRequestException("وضعیت سفارش معتبر نیست.");
      where.status = query.status as Prisma.EnumSubscriptionOrderStatusFilter["equals"];
    }
    const limit = pageLimit(query.limit, 30, 100);
    if (query.cursor) {
      if (!UUID_PATTERN.test(query.cursor)) throw new BadRequestException("نشانگر صفحه معتبر نیست.");
      const cursorExists = await this.prisma.subscriptionOrder.findFirst({ where: { ...where, id: query.cursor }, select: { id: true } });
      if (!cursorExists) throw new BadRequestException("نشانگر صفحه سفارش معتبر نیست.");
    }
    const rows = await this.prisma.subscriptionOrder.findMany({
      where, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1,
      include: { business: { select: { displayName: true } }, branch: { select: { name: true } }, attempts: { orderBy: { createdAt: "desc" }, take: 5 } },
    });
    const page = cursorPage(rows, limit, (row) => row.id);
    await this.audit(admin, request, "subscription.orders.list", "subscription_order_collection", null, { resultCount: page.items.length, searched: Boolean(q), status: query.status ?? "ALL", cursorUsed: Boolean(query.cursor) });
    return { ...page, items: page.items.map((row) => ({
      id: row.id, businessName: row.business.displayName, branchName: row.branch.name,
      planCode: row.planCodeSnapshot, planNameFa: row.planNameFaSnapshot, durationMonths: row.durationMonths,
      amountRial: row.amountRial.toString(), currency: row.currency, status: row.status,
      providerReference: row.providerReference, createdAt: row.createdAt.toISOString(), paidAt: row.paidAt?.toISOString() ?? null,
      attempts: row.attempts.map((attempt) => ({ provider: attempt.provider, providerExternalId: attempt.providerExternalId, amountRial: attempt.amountRial.toString(), status: attempt.status, safeErrorCode: attempt.safeErrorCode, createdAt: attempt.createdAt.toISOString(), completedAt: attempt.completedAt?.toISOString() ?? null })),
    })) };
  }

  async previewBranchAction(admin: AuthenticatedSystemAdmin, request: AppRequest, branchId: string, dto: SubscriptionActionPreviewDto) {
    if (!UUID_PATTERN.test(branchId)) throw new BadRequestException("شناسهٔ شعبه معتبر نیست.");
    if ((dto.kind === "grant" || dto.kind === "extend") && !DURATIONS.has(dto.durationMonths ?? 0)) throw new BadRequestException("مدت اشتراک معتبر نیست.");
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, isActive: true },
      select: { id: true, businessId: true, name: true, business: { select: { displayName: true } }, subscription: { select: {
        id: true,
        suspendedAt: true,
        periods: { where: { revokedAt: null }, orderBy: [{ endsAt: "desc" }, { id: "desc" }], select: { id: true, startsAt: true, endsAt: true, planNameFaSnapshot: true, durationMonths: true } },
      } } },
    });
    if (!branch) throw new NotFoundException("شعبهٔ فعال پیدا نشد.");
    const now = new Date();
    const subscription = branch.subscription[0] ?? null;
    const periods = subscription?.periods ?? [];
    const activePeriods = periods.filter((period) => isSubscriptionPeriodActive(period.startsAt, period.endsAt, now));
    const latest = periods[0] ?? null;
    let effect: Record<string, unknown>;
    if (dto.kind === "grant" || dto.kind === "extend") {
      const startsAt = latest && latest.endsAt > now ? latest.endsAt : now;
      const endsAt = addJalaliMonths(startsAt, dto.durationMonths!);
      effect = { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), durationMonths: dto.durationMonths, appendsAfterExistingEnd: Boolean(latest && latest.endsAt > now) };
    } else if (dto.kind === "suspend") {
      effect = { suspended: true, changesAccess: !subscription?.suspendedAt };
    } else if (dto.kind === "unsuspend") {
      effect = { suspended: false, changesAccess: Boolean(subscription?.suspendedAt) };
    } else {
      const revocablePeriods = periods.filter((period) => period.endsAt > now);
      if (!revocablePeriods.length) throw new ConflictException("برای این شعبه دورهٔ فعالی جهت لغو وجود ندارد.");
      effect = { revokedAt: now.toISOString(), affectedPeriodCount: revocablePeriods.length };
    }
    await this.audit(admin, request, "subscription.admin_action.previewed", "branch_subscription", subscription?.id ?? null, { branchId, kind: dto.kind });
    return {
      observedAt: now.toISOString(),
      branch: { id: branch.id, businessName: branch.business.displayName, branchName: branch.name },
      current: {
        suspended: Boolean(subscription?.suspendedAt),
        activePeriodCount: activePeriods.length,
        latestPeriod: latest ? { id: latest.id, startsAt: latest.startsAt.toISOString(), endsAt: latest.endsAt.toISOString(), planNameFa: latest.planNameFaSnapshot, durationMonths: latest.durationMonths } : null,
      },
      effect,
    };
  }

  async grant(admin: AuthenticatedSystemAdmin, request: AppRequest, branchId: string, dto: SubscriptionGrantDto, extension = false) {
    if (!UUID_PATTERN.test(branchId)) throw new BadRequestException("شناسهٔ شعبه معتبر نیست.");
    if (!DURATIONS.has(dto.durationMonths) || dto.reason.trim().length < 3) throw new BadRequestException("مدت اشتراک یا دلیل ثبت معتبر نیست.");
    await this.adminAuth.verifyCurrentPassword(admin.id, dto.currentPassword, request, extension ? "subscription-extend" : "subscription-grant");
    const period = await this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id: branchId, isActive: true }, select: { id: true, businessId: true, name: true } });
      if (!branch) throw new NotFoundException("شعبهٔ فعال پیدا نشد.");
      const scope = { businessId: branch.businessId, branchId: branch.id };
      const subscription = await tx.branchSubscription.upsert({ where: { businessId_branchId: scope }, update: {}, create: scope });
      await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "branches" WHERE "id" = ${branch.id}::uuid AND "business_id" = ${branch.businessId}::uuid FOR UPDATE`;
      const now = new Date();
      const previous = await tx.subscriptionPeriod.findFirst({ where: { branchSubscriptionId: subscription.id, revokedAt: null }, orderBy: [{ endsAt: "desc" }, { id: "desc" }] });
      const startsAt = previous && previous.endsAt > now ? previous.endsAt : now;
      const endsAt = addJalaliMonths(startsAt, dto.durationMonths);
      const plan = await tx.subscriptionPlan.findFirst({ where: { code: dto.planCode ?? "STANDARD" } });
      const created = await tx.subscriptionPeriod.create({ data: {
        ...scope,
        branchSubscriptionId: subscription.id,
        planId: plan?.id ?? null,
        source: extension ? "ADMIN_EXTENSION" : "ADMIN_GRANT",
        planCodeSnapshot: plan?.code ?? dto.planCode ?? null,
        planNameFaSnapshot: plan?.nameFa ?? null,
        durationMonths: dto.durationMonths,
        startsAt,
        endsAt,
        actorAdminId: admin.id,
      } });
      await this.record(tx, admin, request, extension ? "subscription.period.extended" : "subscription.period.granted", "subscription_period", created.id, {
        businessId: branch.businessId, branchId: branch.id, branchName: branch.name,
        durationMonths: dto.durationMonths, reason: dto.reason.trim(), startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
      });
      return created;
    }, { isolationLevel: "Serializable" });
    return { id: period.id, branchId: period.branchId, source: period.source, startsAt: period.startsAt.toISOString(), endsAt: period.endsAt.toISOString(), durationMonths: period.durationMonths };
  }

  async setSuspension(admin: AuthenticatedSystemAdmin, request: AppRequest, branchId: string, dto: SubscriptionSensitiveReasonDto, suspended: boolean) {
    if (!UUID_PATTERN.test(branchId) || dto.reason.trim().length < 3) throw new BadRequestException("شناسهٔ شعبه یا دلیل ثبت معتبر نیست.");
    await this.adminAuth.verifyCurrentPassword(admin.id, dto.currentPassword, request, suspended ? "subscription-suspend" : "subscription-unsuspend");
    const row = await this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id: branchId, isActive: true }, select: { id: true, businessId: true, name: true } });
      if (!branch) throw new NotFoundException("شعبهٔ فعال پیدا نشد.");
      const scope = { businessId: branch.businessId, branchId: branch.id };
      const subscription = await tx.branchSubscription.upsert({ where: { businessId_branchId: scope }, update: {}, create: scope });
      const updated = await tx.branchSubscription.update({ where: { id: subscription.id }, data: {
        suspendedAt: suspended ? new Date() : null,
        suspensionReason: suspended ? dto.reason.trim() : null,
      } });
      await this.record(tx, admin, request, suspended ? "subscription.branch.suspended" : "subscription.branch.unsuspended", "branch_subscription", subscription.id, {
        businessId: branch.businessId, branchId: branch.id, branchName: branch.name, reason: dto.reason.trim(),
      });
      return updated;
    });
    return { branchId: row.branchId, suspendedAt: row.suspendedAt?.toISOString() ?? null, suspensionReason: row.suspensionReason };
  }

  async revoke(admin: AuthenticatedSystemAdmin, request: AppRequest, branchId: string, dto: SubscriptionSensitiveReasonDto) {
    if (!UUID_PATTERN.test(branchId) || dto.reason.trim().length < 3) throw new BadRequestException("شناسهٔ شعبه یا دلیل ثبت معتبر نیست.");
    await this.adminAuth.verifyCurrentPassword(admin.id, dto.currentPassword, request, "subscription-revoke");
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const subscription = await tx.branchSubscription.findFirst({ where: { branchId }, include: { branch: { select: { businessId: true, name: true } } } });
      if (!subscription) throw new NotFoundException("اشتراک این شعبه سابقه‌ای ندارد.");
      await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "branches" WHERE "id" = ${branchId}::uuid AND "business_id" = ${subscription.businessId}::uuid FOR UPDATE`;
      const updated = await tx.subscriptionPeriod.updateMany({
        where: { branchSubscriptionId: subscription.id, revokedAt: null, endsAt: { gt: now } },
        data: { revokedAt: now, revocationReason: dto.reason.trim(), actorAdminId: admin.id },
      });
      if (!updated.count) throw new ConflictException("برای این شعبه دورهٔ فعالی جهت لغو وجود ندارد.");
      await this.record(tx, admin, request, "subscription.period.revoked", "branch_subscription", subscription.id, {
        businessId: subscription.businessId, branchId, branchName: subscription.branch.name, revokedCount: updated.count, reason: dto.reason.trim(),
      });
      return { branchId, revokedCount: updated.count, revokedAt: now.toISOString() };
    }, { isolationLevel: "Serializable" });
    return result;
  }

  async refund(admin: AuthenticatedSystemAdmin, request: AppRequest, orderId: string, dto: SubscriptionReasonDto) {
    if (dto.reason.trim().length < 3) throw new BadRequestException("دلیل بازپرداخت را وارد کنید.");
    const order = await this.prisma.subscriptionOrder.findUnique({ where: { id: orderId }, select: { id: true, status: true, amountRial: true, currency: true, providerReference: true, businessId: true, branchId: true } });
    if (!order) throw new NotFoundException("سفارش اشتراک پیدا نشد.");
    if (order.status !== "PAID") throw new ConflictException("فقط سفارش پرداخت‌شده قابل بررسی برای بازپرداخت است.");
    await this.audit(admin, request, "subscription.refund.blocked", "subscription_order", order.id, {
      businessId: order.businessId, branchId: order.branchId, amountRial: order.amountRial.toString(), currency: order.currency,
      providerConfigured: false, reason: dto.reason.trim(),
    });
    throw new ServiceUnavailableException({ code: "PAYMENT_PROVIDER_UNCONFIGURED", message: "بازپرداخت تا زمان انتخاب و اتصال درگاه واقعی انجام‌پذیر نیست؛ سفارش به‌عنوان مسترد ثبت نشد." });
  }

  async rollout(admin: AuthenticatedSystemAdmin, request: AppRequest) {
    const setting = await this.prisma.subscriptionRolloutSetting.findUnique({ where: { id: "global" } });
    const [totalBranches, suspended, entitled] = await Promise.all([
      this.prisma.branch.count({ where: { isActive: true } }),
      this.prisma.branchSubscription.count({ where: { suspendedAt: { not: null }, branch: { isActive: true } } }),
      this.prisma.subscriptionPeriod.groupBy({ by: ["branchId"], where: { revokedAt: null, startsAt: { lte: new Date() }, endsAt: { gt: new Date() }, branch: { isActive: true } } }),
    ]);
    const entitledCount = entitled.length;
    const withoutActive = Math.max(0, totalBranches - entitledCount);
    await this.audit(admin, request, "subscription.rollout.read", "subscription_rollout", null, { mode: setting?.mode ?? "OBSERVE", totalBranches, entitledCount, withoutActive });
    return {
      mode: setting?.mode ?? "OBSERVE",
      legacyGraceEndsAt: setting?.legacyGraceEndsAt?.toISOString() ?? null,
      providerFeeBasisPoints: setting?.providerFeeBasisPoints ?? null,
      taxRateBasisPoints: setting?.taxRateBasisPoints ?? null,
      variableCostRial: setting?.variableCostRial?.toString() ?? null,
      minimumContributionRial: setting?.minimumContributionRial?.toString() ?? null,
      report: { totalActiveBranches: totalBranches, activeSubscriptions: entitledCount, branchesWithoutActiveSubscription: withoutActive, suspendedBranches: suspended },
      note: "گزارش بدون اشتراک برای rollout؛ در وضعیت OBSERVE عملیات تغییردهنده مسدود نمی‌شود.",
    };
  }

  async updateRollout(admin: AuthenticatedSystemAdmin, request: AppRequest, dto: SubscriptionRolloutDto) {
    const current = await this.prisma.subscriptionRolloutSetting.findUnique({ where: { id: "global" } });
    const grace = dto.legacyGraceEndsAt === undefined ? current?.legacyGraceEndsAt ?? null : dto.legacyGraceEndsAt ? new Date(dto.legacyGraceEndsAt) : null;
    if (dto.mode === "ENFORCE" && !grace) {
      const [branches, activePeriods] = await Promise.all([
        this.prisma.branch.count({ where: { isActive: true } }),
        this.prisma.subscriptionPeriod.groupBy({ by: ["branchId"], where: { revokedAt: null, startsAt: { lte: new Date() }, endsAt: { gt: new Date() }, branch: { isActive: true } } }),
      ]);
      if (branches > activePeriods.length) throw new ConflictException("پیش از enforce، تاریخ پایان grace برای شعبه‌های فعلی را مشخص کنید.");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.subscriptionRolloutSetting.upsert({
        where: { id: "global" },
        update: {
          mode: dto.mode,
          legacyGraceEndsAt: grace,
          ...(dto.providerFeeBasisPoints !== undefined ? { providerFeeBasisPoints: dto.providerFeeBasisPoints } : {}),
          ...(dto.taxRateBasisPoints !== undefined ? { taxRateBasisPoints: dto.taxRateBasisPoints } : {}),
          ...(dto.variableCostRial !== undefined ? { variableCostRial: dto.variableCostRial === null ? null : BigInt(dto.variableCostRial) } : {}),
          ...(dto.minimumContributionRial !== undefined ? { minimumContributionRial: dto.minimumContributionRial === null ? null : BigInt(dto.minimumContributionRial) } : {}),
          updatedById: admin.id,
        },
        create: {
          id: "global", mode: dto.mode, legacyGraceEndsAt: grace, updatedById: admin.id,
          providerFeeBasisPoints: dto.providerFeeBasisPoints ?? null, taxRateBasisPoints: dto.taxRateBasisPoints ?? null,
          variableCostRial: dto.variableCostRial ? BigInt(dto.variableCostRial) : null,
          minimumContributionRial: dto.minimumContributionRial ? BigInt(dto.minimumContributionRial) : null,
        },
      });
      await this.record(tx, admin, request, "subscription.rollout.updated", "subscription_rollout", null, {
        modeBefore: current?.mode ?? "OBSERVE", modeAfter: row.mode,
        graceEndsAt: row.legacyGraceEndsAt?.toISOString() ?? null,
      });
      return row;
    });
    return {
      mode: updated.mode, legacyGraceEndsAt: updated.legacyGraceEndsAt?.toISOString() ?? null,
      providerFeeBasisPoints: updated.providerFeeBasisPoints, taxRateBasisPoints: updated.taxRateBasisPoints,
      variableCostRial: updated.variableCostRial?.toString() ?? null, minimumContributionRial: updated.minimumContributionRial?.toString() ?? null,
    };
  }

  async economics(admin: AuthenticatedSystemAdmin, request: AppRequest) {
    const [paidOrders, refundedOrders, assumptions] = await Promise.all([
      this.prisma.subscriptionOrder.aggregate({ where: { status: "PAID" }, _sum: { amountRial: true }, _count: { _all: true } }),
      this.prisma.subscriptionOrder.aggregate({ where: { status: "REFUNDED" }, _sum: { amountRial: true }, _count: { _all: true } }),
      this.prisma.subscriptionRolloutSetting.findUnique({ where: { id: "global" } }),
    ]);
    const grossRial = paidOrders._sum.amountRial ?? 0n;
    const refundsRial = refundedOrders._sum.amountRial ?? 0n;
    const feeRial = assumptions?.providerFeeBasisPoints === null || assumptions?.providerFeeBasisPoints === undefined ? null : grossRial * BigInt(assumptions.providerFeeBasisPoints) / 10_000n;
    const taxRial = assumptions?.taxRateBasisPoints === null || assumptions?.taxRateBasisPoints === undefined ? null : grossRial * BigInt(assumptions.taxRateBasisPoints) / 10_000n;
    const variableCosts = assumptions?.variableCostRial === null || assumptions?.variableCostRial === undefined ? null : assumptions.variableCostRial * BigInt(paidOrders._count._all);
    const net = feeRial === null || taxRial === null || variableCosts === null ? null : grossRial - refundsRial - feeRial - taxRial - variableCosts;
    await this.audit(admin, request, "subscription.economics.read", "subscription_economics", null, { orderCount: paidOrders._count._all + refundedOrders._count._all, knownCosts: Number(feeRial !== null) + Number(taxRial !== null) + Number(variableCosts !== null) });
    return {
      grossPriceRial: grossRial.toString(), refundsRial: refundsRial.toString(), providerFeeRial: feeRial?.toString() ?? null, taxObligationRial: taxRial?.toString() ?? null,
      variableCostsRial: variableCosts?.toString() ?? null, netContributionRial: net?.toString() ?? null,
      minimumContributionRial: assumptions?.minimumContributionRial?.toString() ?? null,
      orderCount: paidOrders._count._all + refundedOrders._count._all,
      unknown: [feeRial === null ? "provider_fee" : null, taxRial === null ? "tax_obligation" : null, variableCosts === null ? "variable_cost" : null].filter(Boolean),
      warning: "این گزارش برآورد بر پایهٔ ورودی‌های مدیر سامانه است و سودآوری را تضمین نمی‌کند.",
    };
  }

  private branchDto(branch: {
    id: string; businessId: string; name: string; code: string;
    business: { id: string; displayName: string };
    subscription: Array<{
      id: string; suspendedAt: Date | null; suspensionReason: string | null;
      periods: Array<{
        id: string; startsAt: Date; endsAt: Date; source: string; planCodeSnapshot: string | null;
        planNameFaSnapshot: string | null; durationMonths: number | null;
        order: { planCodeSnapshot: string; planNameFaSnapshot: string; durationMonths: number } | null;
      }>;
    }>;
  }, now: Date, rolloutMode: string, graceEndsAt: Date | null) {
    const subscription = branch.subscription[0];
    const activePeriod = subscription?.periods.find((period) => isSubscriptionPeriodActive(period.startsAt, period.endsAt, now));
    const latest = subscription?.periods[0];
    let status = "REQUIRED";
    if (subscription?.suspendedAt) status = "SUSPENDED";
    else if (activePeriod) status = "ACTIVE";
    else if (rolloutMode !== "ENFORCE") status = "OBSERVE";
    else if (graceEndsAt && graceEndsAt > now) status = "GRACE";
    else if (latest) status = "EXPIRED";
    const display = activePeriod ?? latest;
    return {
      id: branch.id, businessId: branch.businessId, businessName: branch.business.displayName,
      branchName: branch.name, branchCode: branch.code, branchSubscriptionId: subscription?.id ?? null,
      status, rolloutMode, graceEndsAt: graceEndsAt?.toISOString() ?? null,
      suspendedAt: subscription?.suspendedAt?.toISOString() ?? null,
      suspensionReason: subscription?.suspensionReason ?? null,
      currentPeriod: display ? {
        id: display.id,
        startsAt: display.startsAt.toISOString(),
        endsAt: display.endsAt.toISOString(),
        endsAtExclusive: true,
        source: display.source,
        planCode: display.planCodeSnapshot ?? display.order?.planCodeSnapshot ?? null,
        planNameFa: display.planNameFaSnapshot ?? display.order?.planNameFaSnapshot ?? null,
        durationMonths: display.durationMonths ?? display.order?.durationMonths ?? null,
        remainingDays: activePeriod ? Math.max(0, Math.ceil((activePeriod.endsAt.getTime() - now.getTime()) / 86_400_000)) : 0,
      } : null,
    };
  }

  private planDto(plan: { id: string; code: string; nameFa: string; displayOrder: number; isActive: boolean; badge: string | null; features: Prisma.JsonValue }) {
    return { id: plan.id, code: plan.code, nameFa: plan.nameFa, displayOrder: plan.displayOrder, isActive: plan.isActive, badge: plan.badge, features: toStringArray(plan.features) };
  }

  private async audit(admin: AuthenticatedSystemAdmin, request: AppRequest, action: string, entityType: string, entityId: string | null, metadata: Prisma.InputJsonObject) {
    return this.prisma.systemAdminAuditEvent.create({
      data: { adminId: admin.id, action, entityType, entityId, requestId: request.requestId ?? "unknown", metadata },
      select: { id: true },
    });
  }

  private record(tx: Prisma.TransactionClient, admin: AuthenticatedSystemAdmin, request: AppRequest, action: string, entityType: string, entityId: string | null, metadata: Prisma.InputJsonObject) {
    return tx.systemAdminAuditEvent.create({
      data: { adminId: admin.id, action, entityType, entityId, requestId: request.requestId ?? "unknown", metadata },
      select: { id: true },
    });
  }
}

function toStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
