import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash, timingSafeEqual } from "node:crypto";
import { IS_PUBLIC } from "./public.decorator.js";
import { SYSTEM_ADMIN_ONLY } from "./system-admin-only.decorator.js";
import type { AppRequest } from "./request-context.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<AppRequest>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SYSTEM_ADMIN_ONLY, [context.getHandler(), context.getClass()])) {
      const cookie = request.cookies?.shopro_admin_csrf as string | undefined;
      const header = request.header("x-csrf-token");
      if (!cookie || !header || cookie !== header || !request.systemAdmin) throw new ForbiddenException("درخواست مدیر سامانه معتبر نیست؛ صفحه را تازه‌سازی کنید.");
      const received = Buffer.from(hash(cookie));
      const expected = Buffer.from(request.systemAdmin.csrfHash);
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new ForbiddenException("درخواست مدیر سامانه معتبر نیست؛ صفحه را تازه‌سازی کنید.");
      return true;
    }
    const cookie = request.cookies?.shopro_csrf as string | undefined;
    const header = request.header("x-csrf-token");
    if (!cookie || !header || cookie !== header || !request.user) throw new ForbiddenException("درخواست معتبر نیست؛ صفحه را تازه‌سازی کنید.");
    const received = Buffer.from(hash(cookie));
    const expected = Buffer.from(request.user.csrfHash);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new ForbiddenException("درخواست معتبر نیست؛ صفحه را تازه‌سازی کنید.");
    return true;
  }
}
