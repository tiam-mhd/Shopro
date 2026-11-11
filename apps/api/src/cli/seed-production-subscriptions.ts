import { PrismaService } from "../prisma/prisma.service.js";
import { seedSubscriptionCatalog } from "../subscriptions/subscription-catalog.seed.js";

const confirmation = "SEED_SUBSCRIPTION_CATALOG";

async function main() {
  if (process.env.NODE_ENV !== "production") throw new Error("این entrypoint فقط برای seed کنترل‌شدهٔ production است.");
  if (process.env.SHOPRO_SUBSCRIPTION_SEED_CONFIRM !== confirmation) {
    throw new Error(`برای تأیید seed کنترل‌شده، SHOPRO_SUBSCRIPTION_SEED_CONFIRM=${confirmation} را فقط برای اجرای فرمان تنظیم کنید.`);
  }

  const username = process.env.SHOPRO_ADMIN_USERNAME?.trim() || "shopro_super_admin";
  if (username !== "shopro_super_admin") throw new Error("SHOPRO_ADMIN_USERNAME باید نام کاربری ثابت مالک شاپرو باشد.");
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const admin = await prisma.systemAdmin.findUnique({
      where: { username },
      select: { id: true, passwordHash: true, isActive: true },
    });
    if (!admin?.isActive || !admin.passwordHash) throw new Error("حساب مالک باید پیش از اجرای seed در startup سرویس ایجاد شده باشد.");
    if (await prisma.systemAdmin.count() !== 1) throw new Error("برای seed production باید دقیقاً یک حساب مدیر مالک وجود داشته باشد.");
    const catalog = await seedSubscriptionCatalog(prisma, { adminId: admin.id });
    console.log(JSON.stringify({
      event: "production_subscription_seed.completed",
      planCode: catalog.planCode,
      prices: catalog.prices,
      demoBusinessDataCreated: false,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
