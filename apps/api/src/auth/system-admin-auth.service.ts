import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, OnModuleInit, UnauthorizedException } from "@nestjs/common";
import argon2 from "argon2";
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import type { AppRequest, AuthenticatedSystemAdmin } from "../common/request-context.js";
import { webOrigins } from "../common/production-env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { SystemAdminChangePasswordDto, SystemAdminLoginDto } from "./system-admin-auth.dto.js";

const FIXED_OWNER_USERNAME = "shopro_super_admin";
const IDLE_MINUTES = 30;
const MAX_SESSION_HOURS = 12;
const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_FAILURE_LIMIT = 5;
const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const SESSION_HASH = (value: string) => createHash("sha256").update(value).digest("hex");

type RawSession = { sessionId: string; rawSession: string; rawCsrf: string; expiresAt: Date };

@Injectable()
export class SystemAdminAuthService implements OnModuleInit {
  private readonly username = process.env.SHOPRO_ADMIN_USERNAME?.trim() || FIXED_OWNER_USERNAME;
  private dummyHashPromise?: Promise<string>;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (this.username !== FIXED_OWNER_USERNAME) throw new Error("SHOPRO_ADMIN_USERNAME باید نام کاربری ثابت مالک شاپرو باشد.");
    const existing = await this.prisma.systemAdmin.findUnique({ where: { username: this.username }, select: { id: true, passwordHash: true, passwordChangedAt: true, isActive: true } });
    if (existing) {
      if (!existing.isActive) throw new Error("حساب مالک غیرفعال است؛ پیش از راه‌اندازی آن را از مسیر عملیاتی بررسی کنید.");
      if (existing.passwordHash) return;
      if (existing.passwordChangedAt) throw new Error("حساب مالک قبلاً رمز داشته است؛ راه‌اندازی با Secret اولیه اجازهٔ بازنشانی آن را ندارد.");
      const initialPassword = process.env.SHOPRO_ADMIN_INITIAL_PASSWORD;
      if (!initialPassword) {
        if (process.env.NODE_ENV === "production") throw new Error("برای ثبت نخستین رمز روی حساب مالک موجود، SHOPRO_ADMIN_INITIAL_PASSWORD را موقتاً در Secret سرویس API تنظیم کنید.");
        return;
      }
      this.assertStrongPassword(initialPassword);
      const passwordHash = await argon2.hash(initialPassword, ARGON_OPTIONS);
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('shopro:single-owner-bootstrap', 0))`;
        const adminCount = await tx.systemAdmin.count();
        if (adminCount !== 1) throw new Error("حساب‌های مدیر قدیمی بیش از یک مورد هستند؛ bootstrap مالک متوقف شد تا هیچ حسابی انتخاب یا اضافه نشود.");
        const result = await tx.systemAdmin.updateMany({
          where: { id: existing.id, username: this.username, passwordHash: null, passwordChangedAt: null, isActive: true },
          data: { passwordHash, passwordChangedAt: new Date() },
        });
        if (result.count !== 1) {
          const current = await tx.systemAdmin.findUnique({ where: { id: existing.id }, select: { passwordHash: true } });
          if (!current?.passwordHash) throw new Error("نخستین رمز حساب مالک به‌صورت امن ثبت نشد.");
        }
      });
      return;
    }

    const existingAdminCount = await this.prisma.systemAdmin.count();
    if (existingAdminCount > 0) {
      if (process.env.NODE_ENV !== "production" && !process.env.SHOPRO_ADMIN_INITIAL_PASSWORD) return;
      throw new Error("حساب مدیر قدیمی پیدا شد اما شناسهٔ ثابت مالک به آن متصل نیست؛ برای جلوگیری از ساخت مدیر دوم، bootstrap متوقف شد.");
    }
    const initialPassword = process.env.SHOPRO_ADMIN_INITIAL_PASSWORD;
    if (!initialPassword) {
      if (process.env.NODE_ENV === "production") throw new Error("برای ساخت نخستین حساب مالک، SHOPRO_ADMIN_INITIAL_PASSWORD را موقتاً در Secret سرویس API تنظیم کنید.");
      return;
    }
    this.assertStrongPassword(initialPassword);
    const passwordHash = await argon2.hash(initialPassword, ARGON_OPTIONS);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('shopro:single-owner-bootstrap', 0))`;
      const racedAccount = await tx.systemAdmin.findUnique({ where: { username: this.username }, select: { id: true } });
      if (racedAccount) return;
      if (await tx.systemAdmin.count() !== 0) throw new Error("در حین bootstrap حساب مدیر دیگری ایجاد شد؛ حساب تازه ساخته نشد.");
      await tx.systemAdmin.create({
        data: {
          username: this.username,
          passwordHash,
          passwordChangedAt: new Date(),
          displayName: "مدیر شاپرو",
          phone: null,
          isActive: true,
        },
        select: { id: true },
      });
    });
  }

  async login(dto: SystemAdminLoginDto, request: AppRequest) {
    this.assertTrustedOrigin(request);
    const enteredUsername = dto.username.trim().toLowerCase();
    const keys = this.loginKeys(enteredUsername, request.ip);
    await this.assertLoginAllowed(keys);

    const account = await this.prisma.systemAdmin.findUnique({ where: { username: this.username } });
    const encodedHash = account?.passwordHash ?? await this.dummyHash();
    const passwordMatches = await argon2.verify(encodedHash, dto.password).catch(() => false);
    const authenticated = enteredUsername === this.username && passwordMatches && Boolean(account?.isActive && account.passwordHash);
    if (!authenticated || !account) {
      await this.recordLoginFailure(keys);
      await this.audit(null, request, "admin.login.failed", "system_admin", account?.id ?? null, { usernameMatched: enteredUsername === this.username, ipHash: this.digest(request.ip ?? "unknown"), userAgent: this.userAgent(request) });
      throw new UnauthorizedException("نام کاربری یا رمز عبور درست نیست.");
    }

    await this.clearLoginAttempts(keys);
    const session = await this.prisma.$transaction(async (tx) => {
      const created = await this.createSession(tx, account.id, request);
      await tx.systemAdminAuditEvent.create({ data: {
        adminId: account.id,
        action: "admin.login.succeeded",
        entityType: "system_admin",
        entityId: account.id,
        requestId: request.requestId ?? "unknown",
        metadata: { ipHash: this.digest(request.ip ?? "unknown"), userAgent: this.userAgent(request) },
      } });
      return created;
    });
    return { admin: { id: account.id, username: this.username, displayName: account.displayName }, ...session };
  }

  async logout(admin: AuthenticatedSystemAdmin, request: AppRequest) {
    await this.prisma.$transaction(async (tx) => {
      await tx.systemAdminSession.updateMany({ where: { id: admin.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.systemAdminAuditEvent.create({ data: {
        adminId: admin.id, action: "admin.logout", entityType: "system_admin", entityId: admin.id,
        requestId: request.requestId ?? "unknown", metadata: { sessionId: admin.sessionId },
      } });
    });
  }

  async changePassword(admin: AuthenticatedSystemAdmin, dto: SystemAdminChangePasswordDto, request: AppRequest) {
    this.assertStrongPassword(dto.newPassword);
    if (dto.newPassword !== dto.confirmPassword) throw new BadRequestException("تکرار رمز جدید با آن یکسان نیست.");
    if (dto.currentPassword === dto.newPassword) throw new BadRequestException("رمز جدید باید با رمز فعلی تفاوت داشته باشد.");
    await this.verifyCurrentPassword(admin.id, dto.currentPassword, request, "password-change");
    const passwordHash = await argon2.hash(dto.newPassword, ARGON_OPTIONS);
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.systemAdmin.update({ where: { id: admin.id }, data: { passwordHash, passwordChangedAt: now } });
      await tx.systemAdminSession.updateMany({ where: { adminId: admin.id, revokedAt: null }, data: { revokedAt: now } });
      const session = await this.createSession(tx, admin.id, request);
      await tx.systemAdminAuditEvent.create({ data: {
        adminId: admin.id, action: "admin.password.changed", entityType: "system_admin", entityId: admin.id,
        requestId: request.requestId ?? "unknown", metadata: { revokedPriorSessions: true },
      } });
      return { admin: { id: admin.id, username: this.username, displayName: admin.displayName }, ...session };
    });
  }

  async activeSessions(admin: AuthenticatedSystemAdmin, request: AppRequest) {
    const now = new Date();
    const sessions = await this.prisma.systemAdminSession.findMany({
      where: { adminId: admin.id, revokedAt: null, expiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
      orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, absoluteExpiresAt: true, userAgent: true },
    });
    await this.audit(admin.id, request, "admin.sessions.read", "system_admin_session_collection", null, { count: sessions.length });
    return sessions.map((session) => ({ ...session, current: session.id === admin.sessionId }));
  }

  async revokeAllSessions(admin: AuthenticatedSystemAdmin, currentPassword: string, request: AppRequest) {
    await this.verifyCurrentPassword(admin.id, currentPassword, request, "revoke-sessions");
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.systemAdminSession.updateMany({ where: { adminId: admin.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.systemAdminAuditEvent.create({ data: {
        adminId: admin.id, action: "admin.sessions.revoked", entityType: "system_admin", entityId: admin.id,
        requestId: request.requestId ?? "unknown", metadata: { revokedCount: revoked.count },
      } });
      return revoked.count;
    });
    return { revokedCount: result };
  }

  private async createSession(tx: Prisma.TransactionClient, adminId: string, request: AppRequest): Promise<RawSession> {
    const now = new Date();
    const rawSession = randomBytes(32).toString("base64url");
    const rawCsrf = randomBytes(32).toString("base64url");
    const absoluteExpiresAt = new Date(now.getTime() + this.sessionMaxAgeMs());
    const expiresAt = new Date(Math.min(now.getTime() + this.sessionIdleMs(), absoluteExpiresAt.getTime()));
    const row = await tx.systemAdminSession.create({ data: {
      adminId, tokenHash: SESSION_HASH(rawSession), csrfHash: SESSION_HASH(rawCsrf), expiresAt, absoluteExpiresAt,
      lastSeenAt: now, ipHash: this.digest(request.ip ?? "unknown"), userAgent: this.userAgent(request),
    }, select: { id: true } });
    return { sessionId: row.id, rawSession, rawCsrf, expiresAt };
  }

  async verifyCurrentPassword(adminId: string, password: string, request: AppRequest, purpose: string) {
    if (!/^[a-z0-9-]{1,40}$/.test(purpose)) throw new BadRequestException("نوع تأیید امنیتی معتبر نیست.");
    const keys = [
      this.digest(`admin-reauth:owner:${adminId}:${purpose}`),
      this.digest(`admin-reauth:ip:${request.ip ?? "unknown"}`),
    ].sort();
    await this.assertLoginAllowed(keys);
    const account = await this.prisma.systemAdmin.findUnique({ where: { id: adminId }, select: { passwordHash: true } });
    const encodedHash = account?.passwordHash ?? await this.dummyHash();
    const valid = await argon2.verify(encodedHash, password).catch(() => false);
    if (!valid || !account?.passwordHash) {
      await this.recordLoginFailure(keys);
      await this.audit(adminId, request, "admin.reauthentication.failed", "system_admin", adminId, { purpose });
      throw new UnauthorizedException("اطلاعات ورود فعلی معتبر نیست.");
    }
    await this.clearLoginAttempts(keys);
    await this.audit(adminId, request, "admin.reauthentication.succeeded", "system_admin", adminId, { purpose });
  }

  private loginKeys(username: string, ip: string | undefined) {
    return [this.digest(`admin-login:user:${username}`), this.digest(`admin-login:ip:${ip ?? "unknown"}`)].sort();
  }

  private async assertLoginAllowed(keys: string[]) {
    const now = new Date();
    const rows = await this.prisma.systemAdminLoginAttempt.findMany({ where: { fingerprint: { in: keys } }, select: { blockedUntil: true, windowStartedAt: true } });
    if (rows.some((row) => row.blockedUntil && row.blockedUntil > now)) throw new HttpException("ورود در حال حاضر ممکن نیست؛ کمی بعد دوباره تلاش کنید.", HttpStatus.TOO_MANY_REQUESTS);
  }

  private async recordLoginFailure(keys: string[]) {
    const now = new Date();
    const windowStart = new Date(now.getTime() - LOGIN_WINDOW_MINUTES * 60_000);
    await this.prisma.$transaction(async (tx) => {
      for (const fingerprint of keys) await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${fingerprint}, 0))`;
      for (const fingerprint of keys) {
        const previous = await tx.systemAdminLoginAttempt.findUnique({ where: { fingerprint } });
        const inWindow = previous && previous.windowStartedAt >= windowStart;
        const failures = inWindow ? previous.failures + 1 : 1;
        const backoffSeconds = failures < LOGIN_FAILURE_LIMIT ? 0 : Math.min(15 * 60, 30 * (2 ** Math.min(5, failures - LOGIN_FAILURE_LIMIT)));
        await tx.systemAdminLoginAttempt.upsert({
          where: { fingerprint },
          create: { fingerprint, failures, windowStartedAt: now, blockedUntil: backoffSeconds ? new Date(now.getTime() + backoffSeconds * 1000) : null },
          update: { failures, windowStartedAt: inWindow ? previous.windowStartedAt : now, blockedUntil: backoffSeconds ? new Date(now.getTime() + backoffSeconds * 1000) : null },
        });
      }
      if (Math.random() < 0.02) await tx.systemAdminLoginAttempt.deleteMany({ where: { updatedAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) } } });
    });
  }

  private async clearLoginAttempts(keys: string[]) {
    await this.prisma.systemAdminLoginAttempt.deleteMany({ where: { fingerprint: { in: keys } } });
  }

  private assertStrongPassword(value: string) {
    const length = [...value].length;
    if (length < 12 || length > 256) throw new BadRequestException("رمز باید بین ۱۲ تا ۲۵۶ نویسه باشد.");
  }

  private assertTrustedOrigin(request: AppRequest) {
    const origin = request.get("origin");
    const referer = request.get("referer");
    const candidate = origin || (referer ? this.originOf(referer) : undefined);
    if (!candidate) {
      if (process.env.NODE_ENV === "production") throw new ForbiddenException("مبدأ درخواست ورود معتبر نیست.");
      return;
    }
    if (!webOrigins().some((allowed) => this.originOf(allowed) === this.originOf(candidate))) throw new ForbiddenException("مبدأ درخواست ورود معتبر نیست.");
  }

  private originOf(value: string) {
    try { return new URL(value).origin; } catch { return ""; }
  }

  private sessionIdleMs() {
    return this.readDuration("ADMIN_SESSION_IDLE_MINUTES", IDLE_MINUTES, 5, 240) * 60_000;
  }

  private sessionMaxAgeMs() {
    return this.readDuration("ADMIN_SESSION_MAX_HOURS", MAX_SESSION_HOURS, 1, 168) * 60 * 60_000;
  }

  private readDuration(name: string, fallback: number, min: number, max: number) {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} باید عدد صحیح بین ${min} و ${max} باشد.`);
    return value;
  }

  private userAgent(request: AppRequest) {
    return request.get("user-agent")?.slice(0, 500) ?? null;
  }

  private digest(value: string) {
    const secret = process.env.SESSION_SECRET;
    if (secret && secret.length >= 32) return createHmac("sha256", secret).update(value).digest("hex");
    return createHash("sha256").update(value).digest("hex");
  }

  private audit(adminId: string | null, request: AppRequest, action: string, entityType: string, entityId: string | null, metadata: Prisma.InputJsonObject) {
    return this.prisma.systemAdminAuditEvent.create({ data: { adminId, action, entityType, entityId, requestId: request.requestId ?? "unknown", metadata }, select: { id: true } });
  }

  private async dummyHash() {
    this.dummyHashPromise ??= argon2.hash(randomBytes(32).toString("base64url"), ARGON_OPTIONS);
    return this.dummyHashPromise;
  }
}
