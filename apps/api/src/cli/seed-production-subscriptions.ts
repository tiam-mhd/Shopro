import { PrismaService } from "../prisma/prisma.service.js";
import { seedSubscriptionCatalog } from "../subscriptions/subscription-catalog.seed.js";

const confirmation = "SEED_SUBSCRIPTION_CATALOG";

function normalizePhone(value: string) {
  const normalized = value.replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/[\s()+-]/g, "");
  const phone = normalized.startsWith("+98") ? `0${normalized.slice(3)}` : normalized.startsWith("98") ? `0${normalized.slice(2)}` : normalized;
  if (!/^09\d{9}$/.test(phone)) throw new Error("شماره باید با قالب ۰۹۱۲۳۴۵۶۷۸۹ باشد.");
  return phone;
}

async function main() {
  if (process.env.NODE_ENV !== "production") throw new Error("این entrypoint فقط برای seed کنترل‌شدهٔ production است.");
  if (process.env.SHOPRO_SUBSCRIPTION_SEED_CONFIRM !== confirmation) {
    throw new Error(`برای تأیید seed کنترل‌شده، SHOPRO_SUBSCRIPTION_SEED_CONFIRM=${confirmation} را فقط برای اجرای فرمان تنظیم کنید.`);
  }

  const phoneInput = process.env.ADMIN_BOOTSTRAP_PHONE;
  const displayName = process.env.ADMIN_BOOTSTRAP_NAME?.trim();
  if (!phoneInput || !displayName) throw new Error("برای ساخت مدیر مستقل، ADMIN_BOOTSTRAP_PHONE و ADMIN_BOOTSTRAP_NAME لازم‌اند.");
  if (displayName.length > 120) throw new Error("نام مدیر سامانه نباید بیشتر از ۱۲۰ کاراکتر باشد.");
  const phone = normalizePhone(phoneInput);
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const admin = await prisma.systemAdmin.upsert({
      where: { phone },
      create: { phone, displayName, isActive: true },
      update: { displayName, isActive: true },
      select: { id: true, phone: true, displayName: true },
    });
    const catalog = await seedSubscriptionCatalog(prisma, { adminId: admin.id });
    console.log(JSON.stringify({
      event: "production_subscription_seed.completed",
      admin: { phone: admin.phone, displayName: admin.displayName, active: true },
      planCode: catalog.planCode,
      prices: catalog.prices,
      demoBusinessDataCreated: false,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
