import argon2 from "argon2";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";

const OWNER_USERNAME = "shopro_super_admin";
const RECOVERY_CONFIRMATION = "RESET_SINGLE_OWNER_PASSWORD";
const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

async function main() {
  if (process.env.NODE_ENV !== "production") throw new Error("بازیابی رمز فقط در محیط عملیاتی مجاز است.");
  if (process.env.SHOPRO_ADMIN_USERNAME && process.env.SHOPRO_ADMIN_USERNAME !== OWNER_USERNAME) throw new Error("SHOPRO_ADMIN_USERNAME باید نام کاربری ثابت مالک باشد.");
  if (process.env.SHOPRO_ADMIN_RECOVERY_CONFIRM !== RECOVERY_CONFIRMATION) throw new Error("تأیید بازیابی رمز تنظیم نشده است.");
  const newPassword = process.env.SHOPRO_ADMIN_RECOVERY_PASSWORD;
  if (!newPassword || [...newPassword].length < 12 || [...newPassword].length > 256) throw new Error("Secret موقت رمز بازیابی باید بین ۱۲ تا ۲۵۶ نویسه باشد.");

  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const admin = await prisma.systemAdmin.findUnique({ where: { username: OWNER_USERNAME }, select: { id: true, displayName: true, passwordHash: true, isActive: true } });
    if (!admin?.isActive || !admin.passwordHash) throw new Error("حساب فعال مالک برای بازیابی پیدا نشد؛ این فرمان حساب جدید ایجاد نمی‌کند.");
    if (await prisma.systemAdmin.count() !== 1) throw new Error("تعداد حساب‌های مدیر دقیقاً یک نیست؛ بازیابی برای بررسی دستی متوقف شد.");
    if (await argon2.verify(admin.passwordHash, newPassword).catch(() => false)) throw new Error("رمز بازیابی باید با رمز فعلی تفاوت داشته باشد.");
    const passwordHash = await argon2.hash(newPassword, ARGON_OPTIONS);

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('shopro:single-owner-recovery', 0))`;
      if (await tx.systemAdmin.count() !== 1) throw new Error("تعداد حساب‌های مدیر هنگام بازیابی تغییر کرد.");
      const current = await tx.systemAdmin.findUnique({ where: { id: admin.id }, select: { username: true, passwordHash: true, isActive: true } });
      if (!current?.isActive || current.username !== OWNER_USERNAME || !current.passwordHash) throw new Error("حساب مالک هنگام بازیابی تغییر کرده است.");
      const now = new Date();
      await tx.systemAdmin.update({ where: { id: admin.id }, data: { passwordHash, passwordChangedAt: now } });
      const sessions = await tx.systemAdminSession.updateMany({ where: { adminId: admin.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.systemAdminAuditEvent.create({ data: {
        adminId: admin.id,
        action: "admin.password.recovered",
        entityType: "system_admin",
        entityId: admin.id,
        requestId: `recovery-${randomUUID()}`,
        metadata: { method: "runflare_service_console", revokedSessions: sessions.count },
      } });
      return sessions.count;
    });
    console.log(JSON.stringify({ event: "system_admin.password_recovered", username: OWNER_USERNAME, revokedSessions: result }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
