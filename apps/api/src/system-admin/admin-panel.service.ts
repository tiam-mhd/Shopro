import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { SystemAdminAuthService } from "../auth/system-admin-auth.service.js";
import type { AppRequest, AuthenticatedSystemAdmin } from "../common/request-context.js";
import { pageLimit } from "../common/cursor-pagination.js";
import { PrismaService } from "../prisma/prisma.service.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EXPORT_ROWS = 10_000;

type ListQuery = {
  q?: string; status?: string; paymentStatus?: string; sort?: string; direction?: string;
  from?: string; to?: string; minTotal?: string; maxTotal?: string; page?: string; pageSize?: string;
  planCode?: string; minBranches?: string; maxBranches?: string;
  action?: string; entityType?: string;
};
type PageQuery = { page: number; pageSize: number };

@Injectable()
export class AdminPanelService {
  constructor(private readonly prisma: PrismaService, private readonly adminAuth: SystemAdminAuthService) {}

  async dashboard(admin: AuthenticatedSystemAdmin, request: AppRequest, query: ListQuery) {
    const range = this.dateRange(query.from, query.to);
    const duration = range.to.getTime() - range.from.getTime() + 1;
    const previous = { from: new Date(range.from.getTime() - duration), to: new Date(range.from.getTime() - 1) };
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 86_400_000);
    const activePeriodWhere = {
      revokedAt: null,
      startsAt: { lte: now },
      endsAt: { gt: now },
      branchSubscription: { suspendedAt: null, business: { isActive: true }, branch: { isActive: true } },
    } satisfies Prisma.SubscriptionPeriodWhereInput;

    const [activeBusinesses, activeBranches, activeSubscriptions, paidBranches, expiringSubscriptions, pendingReceipts, failedSubscriptionPayments, failedStorefrontPayments, currentRange, previousRange, dailyRevenue] = await Promise.all([
      this.prisma.business.count({ where: { isActive: true } }),
      this.prisma.branch.count({ where: { isActive: true, business: { isActive: true } } }),
      this.prisma.subscriptionPeriod.count({ where: activePeriodWhere }),
      this.prisma.subscriptionPeriod.groupBy({ by: ["branchId"], where: { ...activePeriodWhere, source: "PAID_ORDER" } }),
      this.prisma.subscriptionPeriod.count({ where: { ...activePeriodWhere, endsAt: { gt: now, lte: nextWeek } } }),
      this.prisma.subscriptionManualPaymentSubmission.count({ where: { reviewStatus: "PENDING_REVIEW" } }),
      this.prisma.subscriptionPaymentAttempt.count({ where: { status: "FAILED", createdAt: { gte: range.from, lte: range.to } } }),
      this.prisma.storefrontPaymentAttempt.count({ where: { status: "REJECTED", createdAt: { gte: range.from, lte: range.to } } }),
      this.rangeMetrics(range.from, range.to),
      this.rangeMetrics(previous.from, previous.to),
      this.prisma.$queryRaw<Array<{ day: string; amount: string | bigint | null }>>`
        SELECT to_char(("paid_at" AT TIME ZONE 'Asia/Tehran')::date, 'YYYY-MM-DD') AS day,
               SUM(CASE WHEN "status" = 'PAID' THEN "amount_rial" ELSE -"amount_rial" END)::text AS amount
        FROM "subscription_orders"
        WHERE "paid_at" >= ${range.from} AND "paid_at" <= ${range.to}
          AND "status" IN ('PAID', 'REFUNDED')
        GROUP BY ("paid_at" AT TIME ZONE 'Asia/Tehran')::date
        ORDER BY ("paid_at" AT TIME ZONE 'Asia/Tehran')::date
      `,
    ]);

    await this.audit(admin, request, "admin.dashboard.read", "admin_dashboard", null, { from: range.from.toISOString(), to: range.to.toISOString() });
    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString(), previousFrom: previous.from.toISOString(), previousTo: previous.to.toISOString() },
      metrics: {
        activeBusinesses: this.metric(activeBusinesses, "کسب‌وکار فعال", "تعداد کسب‌وکارهایی که اکنون فعال‌اند", "businesses.is_active=true", "کسب‌وکار", null, "وضعیت فعلی است؛ تاریخچهٔ وضعیت برای بازسازی مقدار گذشته ذخیره نمی‌شود."),
        newBusinesses: this.metric(currentRange.newBusinesses, "کسب‌وکار جدید", "تعداد کسب‌وکارهای ساخته‌شده در بازه", "businesses.created_at", "کسب‌وکار", previousRange.newBusinesses),
        activeBranches: this.metric(activeBranches, "شعب فعال", "تعداد شعب فعال در کسب‌وکارهای فعال", "branches.is_active=true and businesses.is_active=true", "شعبه", null),
        activeSubscriptions: this.metric(activeSubscriptions, "اشتراک فعال", "دورهٔ شروع‌شده و پایان‌نیافته، لغونشده و متصل به کسب‌وکار و شعبهٔ فعال", "subscription_periods + branch_subscriptions + businesses + branches", "دوره", null),
        paidBranches: this.metric(paidBranches.length, "شعبهٔ دارای اشتراک خریداری‌شده", "شعبه‌های یکتای دارای دورهٔ فعال با منبع خرید", "subscription_periods.source=PAID_ORDER", "شعبه", null),
        expiringSubscriptions: this.metric(expiringSubscriptions, "نزدیک پایان", "دوره‌های فعال که در هفت روز آینده پایان می‌یابند", "subscription_periods.ends_at", "دوره", null),
        subscriptionRevenueRial: this.metric(currentRange.subscriptionRevenueRial, "وصول خالص اشتراک", "پرداخت‌های PAID منهای سفارش‌های REFUNDED بر پایهٔ زمان پرداخت", "subscription_orders.amount_rial, status, paid_at", "ریال", previousRange.subscriptionRevenueRial, "این رقم فقط درآمد اشتراک است؛ درآمد فروش فروشگاه‌ها را شامل نمی‌شود."),
        subscriptionOrders: this.metric(currentRange.paidSubscriptionOrders, "پرداخت اشتراک", "تعداد سفارش‌های PAID و REFUNDED با زمان پرداخت در بازه", "subscription_orders.status, paid_at", "سفارش", previousRange.paidSubscriptionOrders),
        storefrontOrders: this.metric(currentRange.storefrontOrders, "سفارش فروشگاه", "تعداد سفارش‌های ثبت‌شده در فروشگاه عمومی در بازه", "storefront_orders.created_at", "سفارش", previousRange.storefrontOrders),
        pendingReceipts: this.metric(pendingReceipts, "رسید منتظر بررسی", "تعداد رسیدهای اشتراک با وضعیت PENDING_REVIEW", "subscription_manual_payment_submissions.review_status", "رسید", null),
        failedPayments: this.metric(failedSubscriptionPayments + failedStorefrontPayments, "پرداخت ناموفق", "تلاش‌های FAILED اشتراک و REJECTED فروشگاه در بازه", "subscription_payment_attempts + storefront_payment_attempts", "تلاش", null),
        mrr: { value: null, available: false, label: "درآمد ماهانهٔ تکرارشونده", unit: "ریال", formula: null, source: null, limitation: "مدل فعلی دوره‌های پیش‌پرداخت دارد و تمدید خودکار/تعهد تکرارشونده تعریف نشده است." },
        renewalRate: { value: null, available: false, label: "نرخ تمدید", unit: "درصد", formula: null, source: null, limitation: "دادهٔ cohort واجد تمدید و رویداد صریح تمدید برای محاسبهٔ قابل اتکا موجود نیست." },
        churnRate: { value: null, available: false, label: "نرخ ریزش", unit: "درصد", formula: null, source: null, limitation: "رویداد لغو اشتراک با تعریف زمانی کامل در مدل موجود نیست." },
      },
      trend: dailyRevenue.map((row) => ({ date: row.day, amountRial: String(row.amount ?? "0") })),
      trendAvailable: dailyRevenue.length > 0,
    };
  }

  async businesses(admin: AuthenticatedSystemAdmin, request: AppRequest, query: ListQuery) {
    const { page, pageSize } = this.pageQuery(query);
    const where = this.businessWhere(query);
    await this.applyBusinessBranchCountFilter(where, query);
    const sort = this.sortDirection(query.sort, query.direction, ["createdAt", "displayName"] as const, "createdAt");
    const [total, rows] = await Promise.all([
      this.prisma.business.count({ where }),
      this.prisma.business.findMany({
        where,
        orderBy: [{ [sort.key]: sort.direction }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, displayName: true, businessType: true, isActive: true, adminSuspendedAt: true, adminSuspensionReason: true, createdAt: true,
          branches: { orderBy: { createdAt: "asc" }, select: { id: true, name: true, code: true, isActive: true } },
          subscriptionOrders: { where: { paidAt: { not: null } }, orderBy: [{ paidAt: "desc" }, { id: "desc" }], take: 1, select: { paidAt: true } },
          _count: { select: { branches: true, members: true, subscriptionOrders: true } },
        },
      }),
    ]);
    await this.audit(admin, request, "admin.businesses.list", "business_collection", null, { count: rows.length, page, pageSize, searched: Boolean(query.q) });
    return {
      items: rows.map((row) => ({
        id: row.id, displayName: row.displayName, businessType: row.businessType, isActive: row.isActive,
        suspendedAt: row.adminSuspendedAt?.toISOString() ?? null, suspensionReason: row.adminSuspensionReason,
        createdAt: row.createdAt.toISOString(), branchCount: row._count.branches, memberCount: row._count.members,
        subscriptionOrderCount: row._count.subscriptionOrders, lastPaidAt: row.subscriptionOrders[0]?.paidAt?.toISOString() ?? null,
        branches: row.branches,
      })),
      page, pageSize, total, pageCount: Math.ceil(total / pageSize),
    };
  }

  async businessDetail(admin: AuthenticatedSystemAdmin, request: AppRequest, businessId: string) {
    this.assertUuid(businessId, "شناسهٔ کسب‌وکار معتبر نیست.");
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      include: {
        branches: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          include: { subscription: { include: { periods: { where: { revokedAt: null }, orderBy: [{ endsAt: "desc" }, { id: "desc" }], take: 3 } } } },
        },
        members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100, include: { user: { select: { displayName: true, phone: true } }, branches: { select: { branchId: true } } } },
        subscriptionOrders: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, select: { id: true, branchId: true, planCodeSnapshot: true, planNameFaSnapshot: true, durationMonths: true, amountRial: true, currency: true, status: true, createdAt: true, paidAt: true } },
        storefrontOrders: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, select: { id: true, publicCode: true, branchId: true, status: true, paymentStatus: true, totalRial: true, createdAt: true } },
      },
    });
    if (!business) throw new NotFoundException("کسب‌وکار پیدا نشد.");
    const [events, notes] = await Promise.all([
      this.prisma.auditEvent.findMany({ where: { businessId }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 30, select: { id: true, action: true, entityType: true, entityId: true, occurredAt: true, requestId: true } }),
      this.prisma.systemAdminNote.findMany({ where: { entityType: "business", entityId: businessId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, select: { id: true, note: true, createdAt: true, admin: { select: { displayName: true } } } }),
    ]);
    await this.audit(admin, request, "admin.business.read", "business", business.id, { branchCount: business.branches.length, memberCount: business.members.length });
    return {
      id: business.id, displayName: business.displayName, businessType: business.businessType, isActive: business.isActive,
      suspendedAt: business.adminSuspendedAt?.toISOString() ?? null, suspensionReason: business.adminSuspensionReason,
      createdAt: business.createdAt.toISOString(), updatedAt: business.updatedAt.toISOString(),
      branches: business.branches.map((branch) => ({ id: branch.id, name: branch.name, code: branch.code, isActive: branch.isActive,
        subscription: branch.subscription[0] ? {
          suspendedAt: branch.subscription[0].suspendedAt?.toISOString() ?? null,
          periods: branch.subscription[0].periods.map((period) => ({ id: period.id, planNameFa: period.planNameFaSnapshot, durationMonths: period.durationMonths, source: period.source, startsAt: period.startsAt.toISOString(), endsAt: period.endsAt.toISOString() })),
        } : null,
      })),
      members: business.members.map((member) => ({ displayName: member.user.displayName, phone: member.user.phone, role: member.role, status: member.status, branchIds: member.branches.map((item) => item.branchId) })),
      subscriptionOrders: business.subscriptionOrders.map((order) => ({ ...order, amountRial: order.amountRial.toString(), createdAt: order.createdAt.toISOString(), paidAt: order.paidAt?.toISOString() ?? null })),
      storefrontOrders: business.storefrontOrders.map((order) => ({ ...order, totalRial: order.totalRial.toString(), createdAt: order.createdAt.toISOString() })),
      timeline: events.map((event) => ({ id: event.id, action: event.action, entityType: event.entityType, entityId: event.entityId, occurredAt: event.occurredAt.toISOString(), requestId: event.requestId })),
      notes: notes.map((note) => ({ id: note.id, note: note.note, createdAt: note.createdAt.toISOString(), createdBy: note.admin.displayName })),
    };
  }

  async updateBusinessStatus(admin: AuthenticatedSystemAdmin, request: AppRequest, businessId: string, isActive: boolean, reason: string, currentPassword: string) {
    this.assertUuid(businessId, "شناسهٔ کسب‌وکار معتبر نیست.");
    const cleanReason = reason.trim();
    if (cleanReason.length < 3 || cleanReason.length > 500) throw new BadRequestException("دلیل تغییر وضعیت را در ۳ تا ۵۰۰ نویسه وارد کنید.");
    await this.adminAuth.verifyCurrentPassword(admin.id, currentPassword, request, "business-status");
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.business.findUnique({ where: { id: businessId }, select: { id: true, isActive: true, displayName: true } });
      if (!before) throw new NotFoundException("کسب‌وکار پیدا نشد.");
      if (before.isActive === isActive) throw new BadRequestException("کسب‌وکار از قبل همین وضعیت را دارد.");
      const now = new Date();
      const updated = await tx.business.update({ where: { id: businessId }, data: {
        isActive,
        adminSuspendedAt: isActive ? null : now,
        adminSuspensionReason: isActive ? null : cleanReason,
      }, select: { id: true, isActive: true, adminSuspendedAt: true, adminSuspensionReason: true } });
      await tx.systemAdminAuditEvent.create({ data: {
        adminId: admin.id, action: "admin.business.status.changed", entityType: "business", entityId: businessId,
        requestId: request.requestId ?? "unknown", metadata: {
          businessName: before.displayName, previousActive: before.isActive, newActive: isActive, reason: cleanReason,
        },
      } });
      return { id: updated.id, isActive: updated.isActive, suspendedAt: updated.adminSuspendedAt?.toISOString() ?? null, reason: updated.adminSuspensionReason };
    });
  }

  async addBusinessNote(admin: AuthenticatedSystemAdmin, request: AppRequest, businessId: string, value: string) {
    this.assertUuid(businessId, "شناسهٔ کسب‌وکار معتبر نیست.");
    const note = value.trim();
    if (note.length < 1 || note.length > 2000) throw new BadRequestException("یادداشت باید بین ۱ تا ۲۰۰۰ نویسه باشد.");
    return this.prisma.$transaction(async (tx) => {
      const business = await tx.business.findUnique({ where: { id: businessId }, select: { id: true } });
      if (!business) throw new NotFoundException("کسب‌وکار پیدا نشد.");
      const created = await tx.systemAdminNote.create({ data: { adminId: admin.id, entityType: "business", entityId: businessId, note }, select: { id: true, note: true, createdAt: true } });
      await tx.systemAdminAuditEvent.create({ data: {
        adminId: admin.id, action: "admin.business.note.created", entityType: "business", entityId: businessId,
        requestId: request.requestId ?? "unknown", metadata: { noteId: created.id, noteLength: note.length },
      } });
      return { ...created, createdAt: created.createdAt.toISOString(), createdBy: admin.displayName };
    });
  }

  async storefrontOrders(admin: AuthenticatedSystemAdmin, request: AppRequest, query: ListQuery) {
    const { page, pageSize } = this.pageQuery(query);
    const where = this.storefrontOrderWhere(query);
    const sort = this.sortDirection(query.sort, query.direction, ["createdAt", "totalRial", "status", "publicCode"] as const, "createdAt");
    const [total, rows] = await Promise.all([
      this.prisma.storefrontOrder.count({ where }),
      this.prisma.storefrontOrder.findMany({
        where, orderBy: [{ [sort.key]: sort.direction }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize,
        include: {
          business: { select: { displayName: true } }, branch: { select: { name: true } }, storefront: { select: { publicName: true, slug: true } },
          paymentAttempts: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { status: true, receipt: { select: { uploadedAt: true } } } },
        },
      }),
    ]);
    await this.audit(admin, request, "admin.storefront_orders.list", "storefront_order_collection", null, { count: rows.length, page, pageSize, searched: Boolean(query.q) });
    return {
      items: rows.map((row) => ({
        id: row.id, publicCode: row.publicCode, businessName: row.business.displayName, branchName: row.branch.name,
        storefrontName: row.storefront.publicName, storefrontSlug: row.storefront.slug, customerName: row.customerName,
        customerPhoneMasked: this.maskPhone(row.customerPhone), status: row.status, paymentStatus: row.paymentStatus,
        paymentAttemptStatus: row.paymentAttempts[0]?.status ?? null, receiptUploadedAt: row.paymentAttempts[0]?.receipt?.uploadedAt.toISOString() ?? null,
        deliveryMethod: row.deliveryMethod, totalRial: row.totalRial.toString(), createdAt: row.createdAt.toISOString(),
      })),
      page, pageSize, total, pageCount: Math.ceil(total / pageSize),
    };
  }

  async globalSearch(admin: AuthenticatedSystemAdmin, request: AppRequest, input: string | undefined) {
    const q = this.searchTerm(input, 100);
    if (!q) return { businesses: [], people: [], branches: [], subscriptions: [], storefrontOrders: [] };
    const uuid = UUID_PATTERN.test(q) ? q : undefined;
    const [businesses, people, branches, subscriptions, storefrontOrders] = await Promise.all([
      this.prisma.business.findMany({ where: { OR: [{ displayName: { contains: q, mode: "insensitive" } }, ...(uuid ? [{ id: uuid }] : []), { branches: { some: { name: { contains: q, mode: "insensitive" } } } }, { members: { some: { user: { phone: { contains: q } } } } }] }, take: 6, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, displayName: true, businessType: true, isActive: true } }),
      this.prisma.user.findMany({ where: { OR: [{ phone: { contains: q } }, { displayName: { contains: q, mode: "insensitive" } }, ...(uuid ? [{ id: uuid }] : [])] }, take: 6, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, phone: true, displayName: true, memberships: { where: { status: "ACTIVE" }, take: 3, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { business: { select: { displayName: true } } } } } }),
      this.prisma.branch.findMany({ where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, ...(uuid ? [{ id: uuid }] : []), { business: { displayName: { contains: q, mode: "insensitive" } } }] }, take: 6, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { business: { select: { displayName: true } } } }),
      this.prisma.subscriptionOrder.findMany({ where: { OR: [{ planNameFaSnapshot: { contains: q, mode: "insensitive" } }, { business: { displayName: { contains: q, mode: "insensitive" } } }, { branch: { name: { contains: q, mode: "insensitive" } } }, ...(uuid ? [{ id: uuid }] : [])] }, take: 6, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, planNameFaSnapshot: true, amountRial: true, currency: true, status: true, createdAt: true, business: { select: { displayName: true } }, branch: { select: { name: true } } } }),
      this.prisma.storefrontOrder.findMany({ where: { OR: [{ publicCode: { contains: q, mode: "insensitive" } }, { storefront: { publicName: { contains: q, mode: "insensitive" } } }, { business: { displayName: { contains: q, mode: "insensitive" } } }, { branch: { name: { contains: q, mode: "insensitive" } } }, ...(uuid ? [{ id: uuid }] : [])] }, take: 6, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, publicCode: true, status: true, paymentStatus: true, totalRial: true, createdAt: true, business: { select: { displayName: true } }, branch: { select: { name: true } } } }),
    ]);
    await this.audit(admin, request, "admin.global_search", "admin_search", null, { searched: true, resultCounts: [businesses.length, people.length, branches.length, subscriptions.length, storefrontOrders.length] });
    return {
      businesses,
      people: people.map((row) => ({ id: row.id, displayName: row.displayName, phoneMasked: this.maskPhone(row.phone), businessNames: row.memberships.map((membership) => membership.business.displayName) })),
      branches: branches.map((row) => ({ id: row.id, name: row.name, code: row.code, businessName: row.business.displayName, isActive: row.isActive })),
      subscriptions: subscriptions.map((row) => ({ id: row.id, planNameFa: row.planNameFaSnapshot, amountRial: row.amountRial.toString(), currency: row.currency, status: row.status, createdAt: row.createdAt.toISOString(), businessName: row.business.displayName, branchName: row.branch.name })),
      storefrontOrders: storefrontOrders.map((row) => ({ id: row.id, publicCode: row.publicCode, status: row.status, paymentStatus: row.paymentStatus, totalRial: row.totalRial.toString(), createdAt: row.createdAt.toISOString(), businessName: row.business.displayName, branchName: row.branch.name })),
    };
  }

  async auditEvents(admin: AuthenticatedSystemAdmin, request: AppRequest, query: ListQuery) {
    const { page, pageSize } = this.pageQuery(query);
    const where = this.auditWhere(query);
    const [total, rows] = await Promise.all([
      this.prisma.systemAdminAuditEvent.count({ where }),
      this.prisma.systemAdminAuditEvent.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], select: { id: true, action: true, entityType: true, entityId: true, requestId: true, occurredAt: true, admin: { select: { displayName: true } } } }),
    ]);
    await this.audit(admin, request, "admin.audit.list", "system_admin_audit_collection", null, { count: rows.length, page, pageSize });
    return { items: rows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString(), adminName: row.admin?.displayName ?? "نامشخص", summary: this.auditSummary(row.action) })), page, pageSize, total, pageCount: Math.ceil(total / pageSize) };
  }

  async exportCsv(admin: AuthenticatedSystemAdmin, request: AppRequest, dataset: string, query: ListQuery) {
    let headers: string[];
    let rows: Array<Array<string | number | bigint | Date | null>>;
    if (dataset === "businesses") {
      const where = this.businessWhere(query);
      await this.applyBusinessBranchCountFilter(where, query);
      const total = await this.prisma.business.count({ where });
      this.assertExportSize(total);
      const data = await this.prisma.business.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: MAX_EXPORT_ROWS, select: { id: true, displayName: true, businessType: true, isActive: true, createdAt: true, _count: { select: { branches: true, members: true } } } });
      headers = ["id", "display_name", "business_type", "active", "created_at_utc", "branch_count", "member_count"];
      rows = data.map((row) => [row.id, row.displayName, row.businessType, row.isActive ? "true" : "false", row.createdAt, row._count.branches, row._count.members]);
    } else if (dataset === "storefront-orders") {
      const where = this.storefrontOrderWhere(query);
      const total = await this.prisma.storefrontOrder.count({ where });
      this.assertExportSize(total);
      const data = await this.prisma.storefrontOrder.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: MAX_EXPORT_ROWS, select: { id: true, publicCode: true, status: true, paymentStatus: true, totalRial: true, createdAt: true, business: { select: { displayName: true } }, branch: { select: { name: true } }, storefront: { select: { publicName: true } } } });
      headers = ["id", "public_code", "business", "branch", "storefront", "status", "payment_status", "total_rial", "created_at_utc"];
      rows = data.map((row) => [row.id, row.publicCode, row.business.displayName, row.branch.name, row.storefront.publicName, row.status, row.paymentStatus, row.totalRial, row.createdAt]);
    } else if (dataset === "subscription-orders") {
      const where = this.subscriptionOrderWhere(query);
      const total = await this.prisma.subscriptionOrder.count({ where });
      this.assertExportSize(total);
      const data = await this.prisma.subscriptionOrder.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: MAX_EXPORT_ROWS, select: { id: true, planNameFaSnapshot: true, durationMonths: true, status: true, amountRial: true, currency: true, createdAt: true, paidAt: true, business: { select: { displayName: true } }, branch: { select: { name: true } } } });
      headers = ["id", "business", "branch", "plan", "duration_months", "status", "amount_rial", "currency", "created_at_utc", "paid_at_utc"];
      rows = data.map((row) => [row.id, row.business.displayName, row.branch.name, row.planNameFaSnapshot, row.durationMonths, row.status, row.amountRial, row.currency, row.createdAt, row.paidAt]);
    } else if (dataset === "audit") {
      const where = this.auditWhere(query);
      const total = await this.prisma.systemAdminAuditEvent.count({ where });
      this.assertExportSize(total);
      const data = await this.prisma.systemAdminAuditEvent.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: MAX_EXPORT_ROWS, select: { id: true, action: true, entityType: true, entityId: true, requestId: true, occurredAt: true, admin: { select: { displayName: true } } } });
      headers = ["id", "action", "summary", "entity_type", "entity_id", "admin", "request_id", "occurred_at_utc"];
      rows = data.map((row) => [row.id, row.action, this.auditSummary(row.action), row.entityType, row.entityId, row.admin?.displayName ?? "", row.requestId, row.occurredAt]);
    } else {
      throw new BadRequestException("نوع فایل خروجی پشتیبانی نمی‌شود.");
    }
    const csv = `\uFEFF${[headers, ...rows].map((line) => line.map((value) => this.csvCell(value)).join(",")).join("\r\n")}`;
    await this.audit(admin, request, "admin.export.created", dataset, null, { rowCount: rows.length, filtered: Boolean(query.q || query.status || query.from || query.to) });
    return { filename: `shopro-${dataset}-${new Date().toISOString().slice(0, 10)}.csv`, csv };
  }

  private async rangeMetrics(from: Date, to: Date) {
    const [newBusinesses, storefrontOrders, paid, refunded, paidSubscriptionOrders] = await Promise.all([
      this.prisma.business.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.prisma.storefrontOrder.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.prisma.subscriptionOrder.aggregate({ where: { status: "PAID", paidAt: { gte: from, lte: to } }, _sum: { amountRial: true } }),
      this.prisma.subscriptionOrder.aggregate({ where: { status: "REFUNDED", paidAt: { gte: from, lte: to } }, _sum: { amountRial: true } }),
      this.prisma.subscriptionOrder.count({ where: { status: { in: ["PAID", "REFUNDED"] }, paidAt: { gte: from, lte: to } } }),
    ]);
    return {
      newBusinesses,
      storefrontOrders,
      paidSubscriptionOrders,
      subscriptionRevenueRial: ((paid._sum.amountRial ?? 0n) - (refunded._sum.amountRial ?? 0n)).toString(),
    };
  }

  private businessWhere(query: ListQuery): Prisma.BusinessWhereInput {
    const where: Prisma.BusinessWhereInput = {};
    const q = this.searchTerm(query.q);
    if (q) where.OR = [
      { displayName: { contains: q, mode: "insensitive" } },
      ...(UUID_PATTERN.test(q) ? [{ id: q }] : []),
      { branches: { some: { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] } } },
      { members: { some: { user: { OR: [{ phone: { contains: q } }, { displayName: { contains: q, mode: "insensitive" } }] } } } },
    ];
    if (query.status) {
      if (!["ACTIVE", "SUSPENDED"].includes(query.status)) throw new BadRequestException("فیلتر وضعیت کسب‌وکار معتبر نیست.");
      where.isActive = query.status === "ACTIVE";
    }
    const date = this.optionalDateRange(query.from, query.to);
    if (date) where.createdAt = { gte: date.from, lte: date.to };
    if (query.planCode) {
      const planCode = query.planCode.trim().toUpperCase();
      if (!/^[A-Z0-9_-]{1,24}$/.test(planCode)) throw new BadRequestException("پلن انتخاب‌شده معتبر نیست.");
      const now = new Date();
      where.subscriptionPeriods = { some: {
        planCodeSnapshot: planCode,
        revokedAt: null,
        startsAt: { lte: now },
        endsAt: { gt: now },
        branchSubscription: { suspendedAt: null },
        branch: { isActive: true },
      } };
    }
    if (query.paymentStatus) {
      const subscriptionOrders: Prisma.SubscriptionOrderListRelationFilter = where.subscriptionOrders ?? {};
      if (query.paymentStatus === "PAID") subscriptionOrders.some = { ...(subscriptionOrders.some ?? {}), status: "PAID" };
      else if (query.paymentStatus === "NO_PAID_ORDER") subscriptionOrders.none = { status: "PAID" };
      else throw new BadRequestException("فیلتر پرداخت کسب‌وکار معتبر نیست.");
      where.subscriptionOrders = subscriptionOrders;
    }
    return where;
  }

  private async applyBusinessBranchCountFilter(where: Prisma.BusinessWhereInput, query: ListQuery) {
    if (query.minBranches === undefined && query.maxBranches === undefined) return;
    const parse = (value: string | undefined, message: string) => {
      if (value === undefined) return undefined;
      if (!/^\d{1,6}$/.test(value)) throw new BadRequestException(message);
      const parsed = Number(value);
      if (parsed > 100_000) throw new BadRequestException(message);
      return parsed;
    };
    const minimum = parse(query.minBranches, "حداقل تعداد شعب معتبر نیست.");
    const maximum = parse(query.maxBranches, "حداکثر تعداد شعب معتبر نیست.");
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) throw new BadRequestException("بازهٔ تعداد شعب معتبر نیست.");
    const countFilter: { gte?: number; lte?: number } = {};
    if (minimum !== undefined) countFilter.gte = minimum;
    if (maximum !== undefined) countFilter.lte = maximum;
    const groups = await this.prisma.branch.groupBy({
      by: ["businessId"],
      having: { businessId: { _count: countFilter } },
    });
    const ids = groups.map((group) => group.businessId);
    const branchCountWhere: Prisma.BusinessWhereInput = {
      OR: [
        { id: { in: ids } },
        ...(minimum === undefined || minimum === 0 ? [{ branches: { none: {} } }] : []),
      ],
    };
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), branchCountWhere];
  }

  private storefrontOrderWhere(query: ListQuery): Prisma.StorefrontOrderWhereInput {
    const where: Prisma.StorefrontOrderWhereInput = {};
    const q = this.searchTerm(query.q);
    if (q) where.OR = [
      { publicCode: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
      { customerPhone: { contains: q } },
      { storefront: { publicName: { contains: q, mode: "insensitive" } } },
      { storefront: { slug: { contains: q, mode: "insensitive" } } },
      { business: { displayName: { contains: q, mode: "insensitive" } } },
      { branch: { name: { contains: q, mode: "insensitive" } } },
      ...(UUID_PATTERN.test(q) ? [{ id: q }] : []),
    ];
    if (query.status) {
      const values = ["SUBMITTED", "ACCEPTED", "REJECTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED", "EXPIRED", "RETURNED"];
      if (!values.includes(query.status)) throw new BadRequestException("فیلتر وضعیت سفارش معتبر نیست.");
      where.status = query.status as Prisma.EnumStorefrontOrderStatusFilter["equals"];
    }
    if (query.paymentStatus) {
      const values = ["NOT_DUE", "UNPAID", "RECEIPT_SUBMITTED", "UNDER_REVIEW", "PARTIALLY_VERIFIED", "OVERPAID_REVIEW", "VERIFIED", "REFUND_PENDING", "REFUNDED"];
      if (!values.includes(query.paymentStatus)) throw new BadRequestException("فیلتر وضعیت پرداخت معتبر نیست.");
      where.paymentStatus = query.paymentStatus as Prisma.EnumStorefrontPaymentStatusFilter["equals"];
    }
    const date = this.optionalDateRange(query.from, query.to);
    if (date) where.createdAt = { gte: date.from, lte: date.to };
    if (query.minTotal !== undefined || query.maxTotal !== undefined) {
      where.totalRial = {};
      if (query.minTotal !== undefined) where.totalRial.gte = this.nonnegativeBigInt(query.minTotal, "حداقل مبلغ معتبر نیست.");
      if (query.maxTotal !== undefined) where.totalRial.lte = this.nonnegativeBigInt(query.maxTotal, "حداکثر مبلغ معتبر نیست.");
      if (where.totalRial.gte !== undefined && where.totalRial.lte !== undefined && where.totalRial.gte > where.totalRial.lte) throw new BadRequestException("بازهٔ مبلغ معتبر نیست.");
    }
    return where;
  }

  private subscriptionOrderWhere(query: ListQuery): Prisma.SubscriptionOrderWhereInput {
    const where: Prisma.SubscriptionOrderWhereInput = {};
    const q = this.searchTerm(query.q);
    if (q) where.OR = [
      { planNameFaSnapshot: { contains: q, mode: "insensitive" } },
      { business: { displayName: { contains: q, mode: "insensitive" } } },
      { branch: { name: { contains: q, mode: "insensitive" } } },
      { providerReference: { contains: q, mode: "insensitive" } },
      ...(UUID_PATTERN.test(q) ? [{ id: q }] : []),
    ];
    if (query.status) {
      if (!["PENDING", "PAID", "FAILED", "CANCELLED", "REFUNDED"].includes(query.status)) throw new BadRequestException("فیلتر وضعیت سفارش اشتراک معتبر نیست.");
      where.status = query.status as Prisma.EnumSubscriptionOrderStatusFilter["equals"];
    }
    const date = this.optionalDateRange(query.from, query.to);
    if (date) where.createdAt = { gte: date.from, lte: date.to };
    return where;
  }

  private auditWhere(query: ListQuery): Prisma.SystemAdminAuditEventWhereInput {
    const where: Prisma.SystemAdminAuditEventWhereInput = {};
    const q = this.searchTerm(query.q);
    if (q) where.OR = [
      { action: { contains: q, mode: "insensitive" } },
      { entityType: { contains: q, mode: "insensitive" } },
      ...(UUID_PATTERN.test(q) ? [{ entityId: q }] : []),
    ];
    if (query.action) where.action = { contains: this.searchTerm(query.action, 80), mode: "insensitive" };
    if (query.entityType) where.entityType = { contains: this.searchTerm(query.entityType, 80), mode: "insensitive" };
    const date = this.optionalDateRange(query.from, query.to);
    if (date) where.occurredAt = { gte: date.from, lte: date.to };
    return where;
  }

  private pageQuery(query: ListQuery): PageQuery {
    const page = query.page === undefined ? 1 : Number(query.page);
    if (!Number.isInteger(page) || page < 1 || page > 1_000_000) throw new BadRequestException("شمارهٔ صفحه معتبر نیست.");
    return { page, pageSize: pageLimit(query.pageSize, 25, 100) };
  }

  private sortDirection<const T extends readonly string[]>(sort: string | undefined, direction: string | undefined, allowed: T, fallback: T[number]) {
    const key = (sort && allowed.includes(sort) ? sort : fallback) as T[number];
    if (direction && !["asc", "desc"].includes(direction.toLowerCase())) throw new BadRequestException("جهت مرتب‌سازی معتبر نیست.");
    return { key, direction: (direction?.toLowerCase() === "asc" ? "asc" : "desc") as "asc" | "desc" };
  }

  private searchTerm(value: string | undefined, max = 80) {
    const q = value?.trim() ?? "";
    if (q.length > max || /[\u0000-\u001f\u007f]/.test(q)) throw new BadRequestException("عبارت جست‌وجو معتبر نیست.");
    return q;
  }

  private dateRange(fromValue?: string, toValue?: string) {
    const optional = this.optionalDateRange(fromValue, toValue);
    if (optional) return optional;
    const to = new Date();
    return { from: new Date(to.getTime() - 30 * 86_400_000), to };
  }

  private optionalDateRange(fromValue?: string, toValue?: string) {
    if (!fromValue && !toValue) return null;
    const from = fromValue ? new Date(fromValue) : new Date(0);
    const to = toValue ? new Date(toValue) : new Date();
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) throw new BadRequestException("بازهٔ زمانی معتبر نیست.");
    if (to.getTime() - from.getTime() > 366 * 86_400_000) throw new BadRequestException("بازهٔ زمانی نمی‌تواند بیش از ۳۶۶ روز باشد.");
    return { from, to };
  }

  private nonnegativeBigInt(value: string, message: string) {
    if (!/^\d{1,24}$/.test(value)) throw new BadRequestException(message);
    return BigInt(value);
  }

  private metric(value: number | string, label: string, formula: string, source: string, unit: string, previous: number | string | null, limitation?: string) {
    const change = previous === null
      ? null
      : typeof value === "string" && typeof previous === "string"
        ? (BigInt(value) - BigInt(previous)).toString()
        : Number(value) - Number(previous);
    return { value, available: true, label, formula, source, unit, previous, change, limitation: limitation ?? null };
  }

  private assertUuid(value: string, message: string) {
    if (!UUID_PATTERN.test(value)) throw new BadRequestException(message);
  }

  private maskPhone(value: string) {
    if (value.length < 7) return "••••";
    return `${value.slice(0, 4)}••••${value.slice(-2)}`;
  }

  private auditSummary(action: string) {
    const labels: Record<string, string> = {
      "admin.login.succeeded": "ورود مدیر موفق بود",
      "admin.login.failed": "تلاش ورود مدیر ناموفق بود",
      "admin.logout": "خروج مدیر انجام شد",
      "admin.password.changed": "رمز مدیر تغییر کرد",
      "admin.password.recovered": "رمز مدیر از مسیر عملیاتی بازیابی شد",
      "admin.reauthentication.succeeded": "تأیید دوبارهٔ رمز مدیر موفق بود",
      "admin.reauthentication.failed": "تأیید دوبارهٔ رمز مدیر ناموفق بود",
      "admin.sessions.revoked": "نشست‌های مدیر باطل شدند",
      "admin.business.status.changed": "وضعیت کسب‌وکار تغییر کرد؛ جزئیات حساس پنهان است",
      "admin.business.note.created": "یادداشت داخلی ثبت شد؛ متن یادداشت پنهان است",
      "admin.export.created": "خروجی محدود ایجاد شد",
      "admin.audit.list": "فهرست رخدادها مشاهده شد",
      "admin.dashboard.read": "نمای کلی مدیریت مشاهده شد",
      "admin.global_search": "جست‌وجوی سراسری انجام شد",
      "admin.businesses.list": "فهرست کسب‌وکارها جست‌وجو یا مشاهده شد",
      "admin.business.read": "جزئیات کسب‌وکار مشاهده شد",
      "admin.storefront_orders.list": "فهرست سفارش‌های فروشگاه مشاهده شد",
      "admin.sessions.read": "فهرست نشست‌های مدیر مشاهده شد",
    };
    if (labels[action]) return labels[action];
    if (action.startsWith("subscription.")) return "عملیات مدیریتی اشتراک یا پرداخت ثبت شد";
    if (action.startsWith("system_admin.")) return "رویداد مدیریتی سامانه ثبت شد";
    return "رویداد مدیریتی ثبت شد";
  }

  private assertExportSize(total: number) {
    if (total > MAX_EXPORT_ROWS) throw new BadRequestException("برای فایل خروجی، فیلتر دقیق‌تری بگذارید تا تعداد ردیف‌ها حداکثر ۱۰٬۰۰۰ باشد.");
  }

  private csvCell(value: string | number | bigint | Date | null) {
    let text = value instanceof Date ? value.toISOString() : value === null ? "" : String(value);
    if (/^[\s\u0000-\u001f]*[=+@]/.test(text) || /^\s*-/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  private audit(admin: AuthenticatedSystemAdmin, request: AppRequest, action: string, entityType: string, entityId: string | null, metadata: Prisma.InputJsonObject) {
    return this.prisma.systemAdminAuditEvent.create({ data: { adminId: admin.id, action, entityType, entityId, requestId: request.requestId ?? "unknown", metadata }, select: { id: true } });
  }
}
