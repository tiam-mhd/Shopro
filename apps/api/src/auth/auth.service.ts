import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { createHmac, createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { toAsciiDigits } from "@shopro/contracts";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ParsgreenService } from "./parsgreen.service.js";

export type OtpAudience = "USER_LOGIN" | "ADMIN_LOGIN";
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

  async requestOtp(input: string, audience: OtpAudience, ipAddress?: string): Promise<void> {
    const phone = normalizePhone(input);
    if (audience === "ADMIN_LOGIN") {
      const admin = await this.prisma.systemAdmin.findUnique({ where: { phone }, select: { isActive: true } });
      if (!admin?.isActive) return;
    }
    const purpose = audience;
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const recent = await this.prisma.otpChallenge.findFirst({
      where: { phone, purpose, createdAt: { gte: new Date(now.getTime() - Number(process.env.OTP_RESEND_SECONDS ?? 60) * 1000) } },
      select: { id: true },
    });
    if (recent) throw new HttpException("برای دریافت کد تازه کمی صبر کنید.", HttpStatus.TOO_MANY_REQUESTS);
    const limit = Number(process.env.OTP_MAX_PER_PHONE_HOUR ?? 5);
    const phoneCount = await this.prisma.otpChallenge.count({ where: { phone, purpose, createdAt: { gte: hourAgo } } });
    const ipHash = ipAddress ? this.digest(`ip:${ipAddress}`) : null;
    const ipCount = ipHash ? await this.prisma.otpChallenge.count({ where: { purpose, requestIpHash: ipHash, createdAt: { gte: new Date(now.getTime() - 60 * 1000) } } }) : 0;
    if (phoneCount >= limit || ipCount >= 10) throw new HttpException("تعداد درخواست کد بیش از حد مجاز است.", HttpStatus.TOO_MANY_REQUESTS);

    const code = randomInt(100000, 1000000).toString();
    const ttl = Number(process.env.OTP_TTL_SECONDS ?? 180);
    const challenge = await this.prisma.otpChallenge.create({
      data: { phone, purpose, codeHash: this.digest(`otp:${purpose}:${phone}:${code}`), expiresAt: new Date(now.getTime() + ttl * 1000), requestIpHash: ipHash },
      select: { id: true },
    });
    try {
      await this.parsgreen.sendOtp(phone, code);
    } catch (error) {
      await this.prisma.otpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
      throw error;
    }
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
