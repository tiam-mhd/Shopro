import { createHash } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { PrismaService } from "../prisma/prisma.service.js";
import { ADMIN_SESSION_COOKIE } from "./admin-session-cookie.js";
import type { AppRequest } from "./request-context.js";

export function createSystemAdminPageAuthMiddleware(prisma: PrismaService): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction) => {
    const appRequest = request as AppRequest;
    const path = appRequest.path.replace(/\/+$/, "") || "/";
    if (!(path === "/system-admin" || path.startsWith("/system-admin/")) || path === "/system-admin/login" || !["GET", "HEAD"].includes(appRequest.method)) {
      next();
      return;
    }

    const raw = appRequest.cookies?.[ADMIN_SESSION_COOKIE] as string | undefined;
    if (!raw) {
      response.status(401).setHeader("Cache-Control", "private, no-store").json({ message: "برای مشاهدهٔ این صفحه وارد پنل مدیریت شوید." });
      return;
    }

    const now = new Date();
    let session;
    try {
      session = await prisma.systemAdminSession.findFirst({ where: {
        tokenHash: createHash("sha256").update(raw).digest("hex"), revokedAt: null,
        expiresAt: { gt: now }, absoluteExpiresAt: { gt: now },
        admin: { isActive: true, username: "shopro_super_admin", passwordHash: { not: null } },
      }, select: { id: true, absoluteExpiresAt: true } });
    } catch (error) {
      next(error);
      return;
    }
    if (!session) {
      response.status(401).setHeader("Cache-Control", "private, no-store").json({ message: "نشست مدیر معتبر نیست؛ از مسیر ورود دوباره وارد شوید." });
      return;
    }

    const idleMinutes = Number(process.env.ADMIN_SESSION_IDLE_MINUTES ?? 30);
    if (!Number.isInteger(idleMinutes) || idleMinutes < 5 || idleMinutes > 240) {
      response.status(500).setHeader("Cache-Control", "private, no-store").json({ message: "تنظیم نشست مدیریت معتبر نیست." });
      return;
    }
    const refreshed = await prisma.systemAdminSession.updateMany({
      where: { id: session.id, revokedAt: null, expiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
      data: { lastSeenAt: now, expiresAt: new Date(Math.min(now.getTime() + idleMinutes * 60_000, session.absoluteExpiresAt.getTime())) },
    });
    if (refreshed.count !== 1) {
      response.status(401).setHeader("Cache-Control", "private, no-store").json({ message: "نشست مدیر معتبر نیست؛ از مسیر ورود دوباره وارد شوید." });
      return;
    }
    response.setHeader("Cache-Control", "private, no-store");
    next();
  };
}
