import { CanActivate, ExecutionContext, ForbiddenException, Injectable, InternalServerErrorException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { IS_PUBLIC } from "./public.decorator.js";
import { SYSTEM_ADMIN_ONLY } from "./system-admin-only.decorator.js";
import { assertUuid } from "./uuid-param.pipe.js";
import type { AppRequest } from "./request-context.js";
import { ADMIN_SESSION_COOKIE } from "./admin-session-cookie.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<AppRequest>();
    if (this.reflector.getAllAndOverride<boolean>(SYSTEM_ADMIN_ONLY, [context.getHandler(), context.getClass()])) {
      const raw = request.cookies?.[ADMIN_SESSION_COOKIE] as string | undefined;
      if (!raw) throw new UnauthorizedException("برای ادامه با حساب مدیر سامانه وارد شوید.");
      const now = new Date();
      const session = await this.prisma.systemAdminSession.findFirst({
        where: {
          tokenHash: hash(raw), revokedAt: null, expiresAt: { gt: now }, absoluteExpiresAt: { gt: now },
          admin: { isActive: true, username: "shopro_super_admin", passwordHash: { not: null } },
        },
        include: { admin: true },
      });
      if (!session) throw new UnauthorizedException("نشست مدیر سامانه پایان یافته است؛ دوباره وارد شوید.");
      const idleMinutes = Number(process.env.ADMIN_SESSION_IDLE_MINUTES ?? 30);
      if (!Number.isInteger(idleMinutes) || idleMinutes < 5 || idleMinutes > 240) throw new InternalServerErrorException("تنظیم مهلت بی‌فعالیتی مدیر معتبر نیست.");
      const expiresAt = new Date(Math.min(now.getTime() + idleMinutes * 60_000, session.absoluteExpiresAt.getTime()));
      const refreshed = await this.prisma.systemAdminSession.updateMany({
        where: { id: session.id, revokedAt: null, expiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
        data: { lastSeenAt: now, expiresAt },
      });
      if (refreshed.count !== 1) throw new UnauthorizedException("نشست مدیر سامانه پایان یافته است؛ دوباره وارد شوید.");
      request.systemAdmin = {
        id: session.admin.id,
        username: session.admin.username!,
        displayName: session.admin.displayName,
        sessionId: session.id,
        csrfHash: session.csrfHash,
      };
      return true;
    }
    const raw = request.cookies?.shopro_session as string | undefined;
    if (!raw) throw new UnauthorizedException("برای ادامه وارد حساب کاربری شوید.");
    const session = await this.prisma.userSession.findFirst({
      where: { tokenHash: hash(raw), revokedAt: null, expiresAt: { gt: new Date() }, user: { isActive: true } },
      include: { user: true },
    });
    if (!session) throw new UnauthorizedException("نشست شما پایان یافته است؛ دوباره وارد شوید.");
    const user = {
      id: session.user.id,
      phone: session.user.phone,
      displayName: session.user.displayName,
      sessionId: session.id,
      csrfHash: session.csrfHash,
    };
    const businessId = this.header(request, "x-business-id");
    const branchId = this.header(request, "x-branch-id");
    assertUuid(businessId, "شناسهٔ کسب‌وکار معتبر نیست.");
    assertUuid(branchId, "شناسهٔ شعبه معتبر نیست.");
    if (businessId) {
      const member = await this.prisma.businessMember.findFirst({
        where: { businessId, userId: user.id, status: "ACTIVE", business: { isActive: true } },
        include: { branches: { where: { branch: { isActive: true } }, select: { branchId: true, branch: { select: { isActive: true } } } } },
      });
      if (!member) throw new ForbiddenException("به این کسب‌وکار دسترسی ندارید.");
      const branchIds = member.branches.map((item) => item.branchId);
      if (branchIds.length === 0) throw new ForbiddenException("هیچ شعبهٔ فعالی برای این عضویت در دسترس نیست.");
      if (branchId && !branchIds.includes(branchId)) throw new ForbiddenException("به این شعبه دسترسی ندارید.");
      Object.assign(user, { businessId, branchId: branchId ?? branchIds[0], memberId: member.id, role: member.role, branchIds });
    } else if (branchId) {
      throw new ForbiddenException("ابتدا کسب‌وکار جاری را انتخاب کنید.");
    }
    request.user = user;
    return true;
  }

  private header(request: AppRequest, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }
}
