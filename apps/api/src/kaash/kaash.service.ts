import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import type { AppRequest, AuthenticatedSystemAdmin, AuthenticatedUser } from "../common/request-context.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { KAASH_MODULES, KAASH_SCREEN_KEYS, KAASH_STATUSES, type AdminKaashListQueryDto, type SubmitKaashDto, type UpdateKaashDto } from "./kaash.dto.js";

type KaashScreenKey = (typeof KAASH_SCREEN_KEYS)[number];
type KaashStatus = (typeof KAASH_STATUSES)[number];
type KaashModule = (typeof KAASH_MODULES)[number];

export const KAASH_MODULE_BY_SCREEN: Record<KaashScreenKey, KaashModule> = {
  "dashboard.home": "DASHBOARD",
  "onboarding.workspace": "ONBOARDING",
  "subscriptions.management": "SUBSCRIPTIONS",
  "storefront.management": "STOREFRONT",
  "sales.register": "SALES",
  "invoices.list": "INVOICES",
  "invoices.detail": "INVOICES",
  "customers.list": "CUSTOMERS",
  "customers.detail": "CUSTOMERS",
  "suppliers.list": "SUPPLIERS",
  "suppliers.detail": "SUPPLIERS",
  "parties.detail": "CUSTOMERS",
  "products.list": "PRODUCTS",
  "products.detail": "PRODUCTS",
  "products.categories": "PRODUCTS",
  "services.list": "SERVICES",
  "services.detail": "SERVICES",
  "services.categories": "SERVICES",
  "inventory.list": "INVENTORY",
  "inventory.count-detail": "INVENTORY",
  "purchases.list": "PURCHASES",
  "purchases.detail": "PURCHASES",
  "expenses.list": "EXPENSES",
  "expenses.detail": "EXPENSES",
  "expenses.categories": "EXPENSES",
  "finance.overview": "FINANCE",
  "finance.detail": "FINANCE",
  "ledger.entries": "LEDGER",
  "reports.overview": "REPORTS",
  "settings.workspace": "SETTINGS",
  "workspace.other": "OTHER",
};

const STATUS_TRANSITIONS: Record<KaashStatus, readonly KaashStatus[]> = {
  NEW: ["REVIEWING", "ARCHIVED"],
  REVIEWING: ["PLANNED", "IN_PROGRESS", "ARCHIVED"],
  PLANNED: ["REVIEWING", "IN_PROGRESS", "ARCHIVED"],
  IN_PROGRESS: ["PLANNED", "RELEASED", "ARCHIVED"],
  RELEASED: ["REVIEWING", "ARCHIVED"],
  ARCHIVED: ["REVIEWING"],
};

const MAX_DAILY_SUBMISSIONS = 15;
const DAY_MS = 86_400_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function canTransitionKaashStatus(from: KaashStatus, to: KaashStatus): boolean {
  return from === to || STATUS_TRANSITIONS[from].includes(to);
}

export function normalizeKaashContent(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

@Injectable()
export class KaashService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(user: AuthenticatedUser, request: AppRequest, dto: SubmitKaashDto) {
    const content = normalizeKaashContent(dto.content);
    const characterCount = Array.from(content).length;
    if (!content || characterCount > 1000) throw new BadRequestException("متن کاش باید بین ۱ تا ۱۰۰۰ نویسه باشد.");
    if (!UUID_PATTERN.test(dto.clientSubmissionId)) throw new BadRequestException("شناسهٔ ارسال معتبر نیست.");
    const sourceModule = KAASH_MODULE_BY_SCREEN[dto.screenKey];
    if (!sourceModule) throw new BadRequestException("صفحهٔ مبدأ معتبر نیست.");
    if (!user.businessId || !user.branchId || !user.memberId) throw new ForbiddenException("برای ثبت کاش، یک شعبهٔ فعال را انتخاب کنید.");

    const membership = await this.prisma.businessMember.findFirst({
      where: {
        id: user.memberId,
        userId: user.id,
        businessId: user.businessId,
        status: "ACTIVE",
        business: { isActive: true },
        branches: { some: { branchId: user.branchId, branch: { isActive: true, businessId: user.businessId } } },
      },
      select: { businessId: true },
    });
    if (!membership) throw new ForbiddenException("عضویت یا شعبهٔ فعال شما در دسترس نیست.");

    const moduleName = sourceModule;
    return this.prisma.$transaction(async (tx) => {
      // Return a supported scalar value instead of PostgreSQL's `void` lock result;
      // Prisma's PostgreSQL driver adapter cannot deserialize `void` columns.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`kaash-user:${user.id}`}, 0)) IS NULL AS locked`;
      const existing = await tx.kaashSubmission.findUnique({
        where: { userId_clientSubmissionId: { userId: user.id, clientSubmissionId: dto.clientSubmissionId } },
        select: { id: true, content: true, screenKey: true, createdAt: true, status: true },
      });
      if (existing) {
        if (existing.content !== content || existing.screenKey !== dto.screenKey) throw new ConflictException("این شناسهٔ ارسال پیش‌تر برای متن دیگری استفاده شده است.");
        return { id: existing.id, createdAt: existing.createdAt, status: existing.status };
      }

      // A short same-user/same-scope content window also collapses identical clicks from separate tabs,
      // where each tab may have generated its own client id before either request completed.
      const recentDuplicate = await tx.kaashSubmission.findFirst({
        where: { userId: user.id, businessId: membership.businessId, branchId: user.branchId, content, createdAt: { gte: new Date(Date.now() - 30_000) } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, createdAt: true, status: true },
      });
      if (recentDuplicate) return { id: recentDuplicate.id, createdAt: recentDuplicate.createdAt, status: recentDuplicate.status };

      const since = new Date(Date.now() - DAY_MS);
      const recentCount = await tx.kaashSubmission.count({ where: { userId: user.id, createdAt: { gte: since } } });
      if (recentCount >= MAX_DAILY_SUBMISSIONS) throw new HttpException({ message: "برای امروز تعداد کاش‌های ثبت‌شده به حد مجاز رسیده است." }, HttpStatus.TOO_MANY_REQUESTS);

      const submission = await tx.kaashSubmission.create({
        data: {
          userId: user.id,
          businessId: membership.businessId,
          branchId: user.branchId,
          clientSubmissionId: dto.clientSubmissionId,
          content,
          sourceModule: moduleName,
          screenKey: dto.screenKey,
        },
        select: { id: true, createdAt: true, status: true },
      });
      await tx.kaashSubmissionEvent.create({ data: { submissionId: submission.id, kind: "SUBMITTED", newStatus: "NEW" } });
      await tx.auditEvent.create({
        data: {
          businessId: membership.businessId,
          actorId: user.id,
          action: "kaash.submitted",
          entityType: "kaash_submission",
          entityId: submission.id,
          requestId: request.requestId ?? "unknown",
          afterJson: { sourceModule: moduleName, screenKey: dto.screenKey, branchId: user.branchId },
        },
      });
      return { id: submission.id, createdAt: submission.createdAt, status: submission.status };
    });
  }

  async adminCounts() {
    const [total, newCount] = await Promise.all([
      this.prisma.kaashSubmission.count(),
      this.prisma.kaashSubmission.count({ where: { status: "NEW" } }),
    ]);
    return { total, newCount };
  }

  async adminList(_admin: AuthenticatedSystemAdmin, query: AdminKaashListQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.KaashSubmissionWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.module) where.sourceModule = query.module;
    const dateRange = this.adminDateRange(query.from, query.to);
    if (dateRange) where.createdAt = dateRange;
    const q = query.q?.trim();
    if (q) {
      where.OR = [
        { content: { contains: q, mode: "insensitive" } },
        ...(UUID_PATTERN.test(q) ? [{ id: q }] : []),
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.kaashSubmission.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, content: true, status: true, sourceModule: true, screenKey: true, createdAt: true,
          user: { select: { displayName: true, phone: true } },
          business: { select: { displayName: true } },
          branch: { select: { name: true } },
        },
      }),
      this.prisma.kaashSubmission.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        textPreview: previewText(item.content, 220),
        truncated: Array.from(item.content).length > 220,
        status: item.status,
        module: item.sourceModule,
        screenKey: item.screenKey,
        createdAt: item.createdAt,
        user: { displayName: item.user.displayName, phoneMasked: maskPhone(item.user.phone) },
        businessName: item.business?.displayName ?? null,
        branchName: item.branch?.name ?? null,
      })),
      page,
      pageSize,
      total,
      pages: Math.ceil(total / pageSize),
    };
  }

  async adminDetail(id: string) {
    const row = await this.prisma.kaashSubmission.findUnique({
      where: { id },
      include: {
        user: { select: { displayName: true, phone: true } },
        business: { select: { displayName: true } },
        branch: { select: { name: true } },
        lastUpdatedByAdmin: { select: { displayName: true } },
        events: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          include: { admin: { select: { displayName: true } } },
        },
      },
    });
    if (!row) throw new NotFoundException("کاش پیدا نشد.");
    return {
      id: row.id,
      content: row.content,
      status: row.status,
      module: row.sourceModule,
      screenKey: row.screenKey,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      internalNote: row.internalNote,
      lastUpdatedByAdminName: row.lastUpdatedByAdmin?.displayName ?? null,
      user: { displayName: row.user.displayName, phoneMasked: maskPhone(row.user.phone) },
      businessName: row.business?.displayName ?? null,
      branchName: row.branch?.name ?? null,
      events: row.events.map((event) => ({
        id: event.id,
        kind: event.kind,
        previousStatus: event.previousStatus,
        newStatus: event.newStatus,
        previousNote: event.previousNote,
        newNote: event.newNote,
        createdAt: event.createdAt,
        adminName: event.admin?.displayName ?? null,
      })),
    };
  }

  async adminStory(id: string) {
    const row = await this.prisma.kaashSubmission.findUnique({ where: { id }, select: { content: true, createdAt: true } });
    if (!row) throw new NotFoundException("کاش پیدا نشد.");
    return { content: row.content, createdAt: row.createdAt };
  }

  async adminUpdate(admin: AuthenticatedSystemAdmin, request: AppRequest, id: string, dto: UpdateKaashDto) {
    const statusProvided = dto.status !== undefined;
    const noteProvided = dto.internalNote !== undefined;
    if (!statusProvided && !noteProvided) throw new BadRequestException("وضعیت یا یادداشت داخلی را مشخص کنید.");
    const nextNote = noteProvided ? normalizeKaashContent(dto.internalNote ?? "") || null : undefined;
    if (nextNote && Array.from(nextNote).length > 2000) throw new BadRequestException("یادداشت داخلی نباید بیش از ۲۰۰۰ نویسه باشد.");

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.kaashSubmission.findUnique({ where: { id } });
      if (!before) throw new NotFoundException("کاش پیدا نشد.");
      const nextStatus = dto.status ?? before.status;
      if (!canTransitionKaashStatus(before.status, nextStatus)) throw new ConflictException("این تغییر وضعیت در چرخهٔ فعلی کاش مجاز نیست.");
      const statusChanged = nextStatus !== before.status;
      const noteChanged = noteProvided && nextNote !== before.internalNote;
      if (!statusChanged && !noteChanged) throw new BadRequestException("تغییری برای ثبت وجود ندارد.");

      await tx.kaashSubmission.update({
        where: { id },
        data: {
          status: nextStatus,
          ...(noteProvided ? { internalNote: nextNote } : {}),
          lastUpdatedByAdminId: admin.id,
        },
      });
      await tx.kaashSubmissionEvent.create({
        data: {
          submissionId: id,
          adminId: admin.id,
          kind: statusChanged && noteChanged ? "ADMIN_UPDATED" : statusChanged ? "STATUS_CHANGED" : "NOTE_CHANGED",
          ...(statusChanged ? { previousStatus: before.status, newStatus: nextStatus } : {}),
          ...(noteChanged ? { previousNote: before.internalNote, newNote: nextNote } : {}),
        },
      });
      await tx.systemAdminAuditEvent.create({
        data: {
          adminId: admin.id,
          action: "system_admin.kaash.updated",
          entityType: "kaash_submission",
          entityId: id,
          requestId: request.requestId ?? "unknown",
          metadata: {
            statusBefore: before.status,
            statusAfter: nextStatus,
            noteChanged,
          },
        },
      });
    });
    return this.adminDetail(id);
  }

  private adminDateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
    if (!from && !to) return undefined;
    const fromStart = from ? jalaliDayStart(from) : undefined;
    const toStart = to ? jalaliDayStart(to) : undefined;
    if (fromStart && toStart && fromStart > toStart) throw new BadRequestException("ابتدای بازه نباید پس از انتهای آن باشد.");
    const result: Prisma.DateTimeFilter = {};
    if (fromStart) result.gte = fromStart;
    if (toStart) result.lt = new Date(toStart.getTime() + DAY_MS);
    return result;
  }
}

function jalaliDayStart(value: string): Date {
  const utcCheck = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(utcCheck.getTime()) || utcCheck.toISOString().slice(0, 10) !== value) throw new BadRequestException("تاریخ فیلتر معتبر نیست.");
  return new Date(`${value}T00:00:00.000+03:30`);
}

function previewText(value: string, max: number): string {
  const text = Array.from(value);
  return text.length > max ? `${text.slice(0, max).join("")}…` : value;
}

function maskPhone(value: string): string {
  return `${"•".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}
