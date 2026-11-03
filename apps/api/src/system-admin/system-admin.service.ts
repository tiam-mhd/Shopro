import { BadRequestException, Injectable } from "@nestjs/common";
import { cursorPage, pageLimit } from "../common/cursor-pagination.js";
import type { AppRequest, AuthenticatedSystemAdmin } from "../common/request-context.js";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class SystemAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(admin: AuthenticatedSystemAdmin, request: AppRequest) {
    const [businesses, activeBranches, activeUsers, activeAdmins] = await Promise.all([
      this.prisma.business.count(),
      this.prisma.branch.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.systemAdmin.count({ where: { isActive: true } }),
    ]);
    await this.record(admin, request, "system_admin.overview.read", "system_overview", null, { businesses, activeBranches, activeUsers, activeAdmins });
    return { businesses, activeBranches, activeUsers, activeAdmins };
  }

  async businesses(admin: AuthenticatedSystemAdmin, request: AppRequest, query: { q?: string; cursor?: string; limit?: string }) {
    const q = query.q?.trim();
    if (q && (q.length > 80 || /[\u0000-\u001f\u007f]/.test(q))) throw new BadRequestException("عبارت جست‌وجو معتبر نیست.");
    const limit = pageLimit(query.limit, 50, 100);
    const where = q ? { displayName: { contains: q, mode: "insensitive" as const } } : {};
    if (query.cursor) {
      if (!UUID_PATTERN.test(query.cursor)) throw new BadRequestException("نشانگر صفحه معتبر نیست.");
      const cursorExists = await this.prisma.business.findFirst({ where: { ...where, id: query.cursor }, select: { id: true } });
      if (!cursorExists) throw new BadRequestException("نشانگر صفحه برای این جست‌وجو معتبر نیست؛ فهرست را تازه‌سازی کنید.");
    }
    const rows = await this.prisma.business.findMany({
      where,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        displayName: true,
        businessType: true,
        displayCurrency: true,
        createdAt: true,
        branches: { select: { id: true, name: true, code: true, isActive: true }, orderBy: { createdAt: "asc" } },
        _count: { select: { members: true, products: true, parties: true, salesInvoices: true, purchases: true, expenses: true } },
      },
    });
    const page = cursorPage(rows, limit, (row) => row.id);
    await this.record(admin, request, "system_admin.businesses.list", "business_collection", null, { resultCount: page.items.length, hasMore: page.hasMore, searched: Boolean(q), cursorUsed: Boolean(query.cursor) });
    return page;
  }

  async audit(admin: AuthenticatedSystemAdmin, request: AppRequest, cursor?: string, requestedLimit?: string) {
    const limit = pageLimit(requestedLimit, 50, 100);
    if (cursor) {
      if (!UUID_PATTERN.test(cursor)) throw new BadRequestException("نشانگر صفحه معتبر نیست.");
      const cursorExists = await this.prisma.systemAdminAuditEvent.findFirst({ where: { id: cursor }, select: { id: true } });
      if (!cursorExists) throw new BadRequestException("نشانگر صفحهٔ سابقه معتبر نیست؛ فهرست را تازه‌سازی کنید.");
    }
    const rows = await this.prisma.systemAdminAuditEvent.findMany({
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: { id: true, action: true, entityType: true, entityId: true, metadata: true, occurredAt: true, admin: { select: { displayName: true } } },
    });
    const page = cursorPage(rows, limit, (row) => row.id);
    await this.record(admin, request, "system_admin.audit.list", "system_admin_audit_collection", null, { resultCount: page.items.length, hasMore: page.hasMore, cursorUsed: Boolean(cursor) });
    return page;
  }

  private record(admin: AuthenticatedSystemAdmin, request: AppRequest, action: string, entityType: string, entityId: string | null, metadata: Prisma.InputJsonObject) {
    return this.prisma.systemAdminAuditEvent.create({
      data: { adminId: admin.id, action, entityType, entityId, requestId: request.requestId ?? "unknown", metadata },
      select: { id: true },
    });
  }
}
