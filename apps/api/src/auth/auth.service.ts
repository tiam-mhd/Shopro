import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { createHmac, createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { OTP_CODE_LENGTH, toAsciiDigits } from "@shopro/contracts";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ParsgreenService } from "./parsgreen.service.js";

export type OtpAudience = "USER_LOGIN" | "ADMIN_LOGIN" | "STOREFRONT_CHECKOUT" | "STOREFRONT_CUSTOMER";
export interface SafeUser { id: string; phone: string; displayName: string | null }
export interface SafeAdmin { id: string; phone: string; displayName: string }

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizePhone = (value: string) => {
  const digits = toAsciiDigits(value).replace(/[\s()+-]/g, "");
  const local = digits.startsWith("+98") ? `0${digits.slice(3)}` : digits.startsWith("98") ? `0${digits.slice(2)}` : digits;
  if (!/^09\d{9}$/.test(local)) throw new BadRequestException("شمارهٔ موبایل را با قالب ۰۹۱۲۳۴۵۶۷۸۹ وارد کنید.");
  return local;
};

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly parsgreen: ParsgreenService) {}

  async requestOtp(input: string, audience: OtpAudience, ipAddress?: string, requestId?: string): Promise<{ expiresAt: string; resendAt: string }> {
    const phone = normalizePhone(input);
    if (audience === "ADMIN_LOGIN") {
      const admin = await this.prisma.systemAdmin.findUnique({ where: { phone }, select: { isActive: true } });
      if (!admin?.isActive) {
        const inactiveAt = new Date();
        return {
          expiresAt: new Date(inactiveAt.getTime() + Number(process.env.OTP_TTL_SECONDS ?? 180) * 1000).toISOString(),
          resendAt: new Date(inactiveAt.getTime() + Number(process.env.OTP_RESEND_SECONDS ?? 60) * 1000).toISOString(),
        };
      }
    }
    const purpose = audience;
    const now = new Date();
    const ttl = Number(process.env.OTP_TTL_SECONDS ?? 180);
    const resendSeconds = Number(process.env.OTP_RESEND_SECONDS ?? 60);
    let expiresAt = new Date(now.getTime() + ttl * 1000);
    let resendAt = new Date(now.getTime() + resendSeconds * 1000);
    const ipHash = ipAddress ? this.digest(`ip:${ipAddress}`) : null;
    const code = randomInt(0, 10 ** OTP_CODE_LENGTH).toString().padStart(OTP_CODE_LENGTH, "0");
    await this.prisma.$transaction(async (tx) => {
      const lockKeys = [`otp:phone:${purpose}:${phone}`, ...(ipHash ? [`otp:ip:${purpose}:${ipHash}`] : [])].sort();
      for (const lockKey of lockKeys) await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      const expiredBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      await tx.otpChallenge.deleteMany({ where: { OR: [{ expiresAt: { lt: expiredBefore } }, { consumedAt: { lt: expiredBefore } }] } });
      const recent = await tx.otpChallenge.findFirst({
        where: { phone, purpose, createdAt: { gte: new Date(now.getTime() - resendSeconds * 1000) } },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true, expiresAt: true },
      });
      if (recent) throw new HttpException({ message: "برای دریافت کد تازه کمی صبر کنید.", expiresAt: recent.expiresAt.toISOString(), resendAt: new Date(recent.createdAt.getTime() + resendSeconds * 1000).toISOString() }, HttpStatus.TOO_MANY_REQUESTS);
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const limit = Number(process.env.OTP_MAX_PER_PHONE_HOUR ?? 5);
      const phoneCount = await tx.otpChallenge.count({ where: { phone, purpose, createdAt: { gte: hourAgo } } });
      const ipCount = ipHash ? await tx.otpChallenge.count({ where: { purpose, requestIpHash: ipHash, createdAt: { gte: new Date(now.getTime() - 60 * 1000) } } }) : 0;
      if (phoneCount >= limit || ipCount >= 10) throw new HttpException("تعداد درخواست کد بیش از حد مجاز است.", HttpStatus.TOO_MANY_REQUESTS);
      const challenge = await tx.otpChallenge.create({
        data: { phone, purpose, codeHash: this.digest(`otp:${purpose}:${phone}:${code}`), expiresAt, requestIpHash: ipHash },
      });
      expiresAt = challenge.expiresAt;
      resendAt = new Date(challenge.createdAt.getTime() + resendSeconds * 1000);
    });
    try {
      await this.parsgreen.sendOtp(phone, code, requestId);
    } catch (cause) {
      if (cause instanceof HttpException) {
        const response = cause.getResponse();
        const message = typeof response === "string" ? response : response && typeof response === "object" && "message" in response ? (response as { message: unknown }).message : cause.message;
        throw new HttpException({ message, expiresAt: expiresAt.toISOString(), resendAt: resendAt.toISOString() }, cause.getStatus());
      }
      throw cause;
    }
    return { expiresAt: expiresAt.toISOString(), resendAt: resendAt.toISOString() };
  }

  async verifyUserOtp(inputPhone: string, inputCode: string): Promise<{ user: SafeUser; sessionId: string; rawSession: string; rawCsrf: string; expiresAt: Date }> {
    const phone = normalizePhone(inputPhone);
    const result = await this.verifyChallenge(phone, inputCode, "USER_LOGIN");
    if (!result) throw new BadRequestException("کد واردشده درست نیست یا مهلت آن تمام شده است.");
    return this.prisma.$transaction(async (tx) => {
      const consumed = await tx.otpChallenge.updateMany({ where: { id: result.id, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 } }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw new ConflictException("این کد پیش‌تر استفاده شده یا منقضی شده است.");
      const user = await tx.user.upsert({ where: { phone }, update: {}, create: { phone }, select: { id: true, phone: true, displayName: true, isActive: true } });
      if (!user.isActive) throw new BadRequestException("این حساب غیرفعال است.");
      const session = await this.createUserSession(tx, user.id);
      return { user: { id: user.id, phone: user.phone, displayName: user.displayName }, ...session };
    });
  }

  async verifyAdminOtp(inputPhone: string, inputCode: string): Promise<{ admin: SafeAdmin; sessionId: string; rawSession: string; rawCsrf: string; expiresAt: Date }> {
    const phone = normalizePhone(inputPhone);
    const result = await this.verifyChallenge(phone, inputCode, "ADMIN_LOGIN");
    if (!result) throw new BadRequestException("کد واردشده درست نیست یا مهلت آن تمام شده است.");
    return this.prisma.$transaction(async (tx) => {
      const consumed = await tx.otpChallenge.updateMany({ where: { id: result.id, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 } }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw new ConflictException("این کد پیش‌تر استفاده شده یا منقضی شده است.");
      const admin = await tx.systemAdmin.findUnique({ where: { phone }, select: { id: true, phone: true, displayName: true, isActive: true } });
      if (!admin?.isActive) throw new BadRequestException("این حساب مدیر سامانه فعال نیست.");
      const session = await this.createAdminSession(tx, admin.id);
      return { admin: { id: admin.id, phone: admin.phone, displayName: admin.displayName }, ...session };
    });
  }

  async verifyStorefrontOtp(inputPhone: string, inputCode: string, slug: string) {
    const phone = normalizePhone(inputPhone);
    const result = await this.verifyChallenge(phone, inputCode, "STOREFRONT_CHECKOUT");
    if (!result) throw new BadRequestException("کد واردشده درست نیست یا مهلت آن تمام شده است.");
    const storefront = await this.prisma.storefront.findFirst({
      where: { slug: slug.trim().toLowerCase(), status: "PUBLISHED", branch: { isActive: true } },
      select: { id: true, businessId: true, branchId: true },
    });
    if (!storefront) throw new BadRequestException("این فروشگاه اکنون سفارش نمی‌پذیرد.");
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const consumed = await tx.otpChallenge.updateMany({ where: { id: result.id, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: 5 } }, data: { consumedAt: now } });
      if (consumed.count !== 1) throw new ConflictException("این کد پیش‌تر استفاده شده یا منقضی شده است.");
      const rawToken = randomBytes(32).toString("base64url");
      const customerToken = randomBytes(32).toString("base64url");
      const customerExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const customer = await tx.storefrontCustomerProfile.upsert({
        where: { phone }, update: {}, create: { phone },
        select: { id: true, fullName: true, phone: true, address: true },
      });
      await tx.storefrontCustomerSession.create({ data: {
        customerId: customer.id,
        tokenHash: hash(customerToken), expiresAt: customerExpiresAt,
      } });
      await tx.storefrontOtpGrant.create({ data: {
        businessId: storefront.businessId, branchId: storefront.branchId, storefrontId: storefront.id,
        phone, tokenHash: hash(rawToken), expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      } });
      return {
        checkoutToken: rawToken, customerToken, phone,
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
        customerExpiresAt: customerExpiresAt.toISOString(),
        customer: { fullName: customer.fullName, phone: customer.phone, address: customer.address },
      };
    });
  }

  async verifyStorefrontCustomerOtp(inputPhone: string, inputCode: string) {
    const phone = normalizePhone(inputPhone);
    const result = await this.verifyChallenge(phone, inputCode, "STOREFRONT_CUSTOMER");
    if (!result) throw new BadRequestException("کد واردشده درست نیست یا مهلت آن تمام شده است.");
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const consumed = await tx.otpChallenge.updateMany({ where: { id: result.id, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: 5 } }, data: { consumedAt: now } });
      if (consumed.count !== 1) throw new ConflictException("این کد قبلاً استفاده شده یا منقضی شده است.");
      const customerToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const customer = await tx.storefrontCustomerProfile.upsert({
        where: { phone }, update: {}, create: { phone },
        select: { id: true, fullName: true, phone: true, address: true },
      });
      await tx.storefrontCustomerSession.create({ data: {
        customerId: customer.id, tokenHash: hash(customerToken), expiresAt,
      } });
      return { customerToken, customer, phone, expiresAt: expiresAt.toISOString() };
    });
  }

  async logoutUser(sessionId: string) {
    await this.prisma.userSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async logoutAdmin(sessionId: string) {
    await this.prisma.systemAdminSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async verifyChallenge(phone: string, inputCode: string, purpose: OtpAudience): Promise<{ id: string } | null> {
    const code = toAsciiDigits(inputCode).trim();
    if (!/^\d{4,8}$/.test(code)) return null;
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { phone, purpose, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 } },
      orderBy: { createdAt: "desc" }, select: { id: true, codeHash: true },
    });
    if (!challenge) return null;
    const received = Buffer.from(this.digest(`otp:${purpose}:${phone}:${code}`));
    const expected = Buffer.from(challenge.codeHash);
    const valid = received.length === expected.length && timingSafeEqual(received, expected);
    await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    return valid ? { id: challenge.id } : null;
  }

  private async createUserSession(tx: Prisma.TransactionClient, userId: string) {
    const rawSession = randomBytes(32).toString("base64url");
    const rawCsrf = randomBytes(32).toString("base64url");
    const ttl = Math.max(1, Number(process.env.SESSION_TTL_DAYS ?? 30));
    const expiresAt = new Date(Date.now() + ttl * 86400 * 1000);
    const row = await tx.userSession.create({ data: { userId, tokenHash: hash(rawSession), csrfHash: hash(rawCsrf), expiresAt }, select: { id: true } });
    return { sessionId: row.id, rawSession, rawCsrf, expiresAt };
  }

  private async createAdminSession(tx: Prisma.TransactionClient, adminId: string) {
    const rawSession = randomBytes(32).toString("base64url");
    const rawCsrf = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const row = await tx.systemAdminSession.create({ data: { adminId, tokenHash: hash(rawSession), csrfHash: hash(rawCsrf), expiresAt }, select: { id: true } });
    return { sessionId: row.id, rawSession, rawCsrf, expiresAt };
  }

  private digest(value: string) {
    const key = process.env.OTP_HASH_SECRET ?? process.env.SESSION_SECRET;
    if (!key || key.length < 32) throw new Error("OTP_HASH_SECRET و SESSION_SECRET باید کلیدهای تصادفی ۳۲ کاراکتری باشند.");
    return createHmac("sha256", key).update(value).digest("hex");
  }
}
