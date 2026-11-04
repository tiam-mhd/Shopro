import { CanActivate, ExecutionContext, ForbiddenException, HttpException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC } from "../common/public.decorator.js";
import { SYSTEM_ADMIN_ONLY } from "../common/system-admin-only.decorator.js";
import type { AppRequest } from "../common/request-context.js";
import { PrismaService } from "../prisma/prisma.service.js";

type EntitlementSnapshot = {
  rolloutMode: "OBSERVE" | "ENFORCE";
  graceEndsAt: Date | null;
  suspended: boolean;
  active: boolean;
  hasHistory: boolean;
  latestEnd: Date | null;
};

export function isTenantOperationalWrite(method: string, path: string) {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return false;
  const normalized = path.replace(/\/+$/, "").toLowerCase();
  if (method.toUpperCase() === "POST" && normalized === "/api/v1/businesses") return false;
  return ![
    "/api/v1/auth",
    "/api/v1/onboarding",
    "/api/v1/subscriptions",
    "/api/v1/system-admin",
  ].some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

export function entitlementDenial(snapshot: EntitlementSnapshot, now: Date) {
  if (snapshot.suspended) return { code: "SUBSCRIPTION_REQUIRED", message: "اشتراک این شعبه متوقف شده است؛ برای پیگیری با مالک کسب‌وکار تماس بگیرید." };
  if (snapshot.active || snapshot.rolloutMode !== "ENFORCE" || (snapshot.graceEndsAt && snapshot.graceEndsAt > now)) return null;
  if (snapshot.hasHistory && snapshot.latestEnd && snapshot.latestEnd <= now) return { code: "SUBSCRIPTION_EXPIRED", message: "اشتراک این شعبه پایان یافته است. اطلاعات همچنان در دسترس است؛ برای ادامهٔ عملیات اشتراک را تمدید کنید." };
  return { code: "SUBSCRIPTION_REQUIRED", message: "برای انجام عملیات این شعبه، ابتدا اشتراک فعال تهیه کنید." };
}

@Injectable()
export class SubscriptionEntitlementGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    if (this.reflector.getAllAndOverride<boolean>(SYSTEM_ADMIN_ONLY, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<AppRequest>();
    const user = request.user;
    if (!user?.businessId || !user.branchId || !isTenantOperationalWrite(request.method, request.path)) return true;

    const now = new Date();
    const rows = await this.prisma.$queryRaw<Array<{
      rollout_mode: string | null;
      grace_ends_at: Date | null;
      suspended_at: Date | null;
      active_period: boolean;
      has_history: boolean;
      latest_end: Date | null;
    }>>`
      SELECT
        rollout."mode"::text AS rollout_mode,
        rollout."legacy_grace_ends_at" AS grace_ends_at,
        s."suspended_at",
        entitlement."active_period",
        entitlement."has_history",
        entitlement."latest_end"
      FROM "branches" b
      LEFT JOIN "branch_subscriptions" s ON s."business_id" = b."business_id" AND s."branch_id" = b."id"
      LEFT JOIN "subscription_rollout_settings" rollout ON rollout."id" = 'global'
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(BOOL_OR(p."starts_at" <= ${now} AND p."ends_at" > ${now}), false) AS active_period,
          COUNT(*) > 0 AS has_history,
          MAX(p."ends_at") AS latest_end
        FROM "subscription_periods" p
        WHERE p."business_id" = b."business_id" AND p."branch_id" = b."id" AND p."revoked_at" IS NULL
      ) entitlement ON true
      WHERE b."id" = ${user.branchId}::uuid AND b."business_id" = ${user.businessId}::uuid AND b."is_active" = true
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new ForbiddenException("شعبهٔ جاری برای انجام عملیات معتبر نیست.");
    const denial = entitlementDenial({
      rolloutMode: row.rollout_mode === "ENFORCE" ? "ENFORCE" : "OBSERVE",
      graceEndsAt: row.grace_ends_at,
      suspended: Boolean(row.suspended_at),
      active: row.active_period,
      hasHistory: row.has_history,
      latestEnd: row.latest_end,
    }, now);
    if (denial) throw new HttpException(denial, 402);
    return true;
  }
}
