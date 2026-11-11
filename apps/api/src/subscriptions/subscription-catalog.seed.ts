import type { PrismaClient } from "../generated/prisma/client.js";

const EFFECTIVE_FROM = new Date("2026-11-01T00:00:00.000Z");
const PRICES = [
  { durationMonths: 1, priceRial: 4_970_000n },
  { durationMonths: 3, priceRial: 13_790_000n },
  { durationMonths: 6, priceRial: 24_900_000n },
  { durationMonths: 12, priceRial: 42_900_000n },
] as const;

type SeedOptions = { allowDevelopmentAdmin?: boolean; adminId?: string };

export async function seedSubscriptionCatalog(prisma: PrismaClient, options: SeedOptions = {}) {
  let admin = options.adminId
    ? await prisma.systemAdmin.findFirst({ where: { id: options.adminId, isActive: true }, select: { id: true } })
    : await prisma.systemAdmin.findFirst({ where: { isActive: true, username: "shopro_super_admin", passwordHash: { not: null } }, select: { id: true } });
  if (!admin && options.allowDevelopmentAdmin) {
    admin = await prisma.systemAdmin.findFirst({ where: { username: null, phone: null, displayName: "مدیر نمونهٔ توسعه" }, select: { id: true } });
    admin ??= await prisma.systemAdmin.create({ data: { phone: null, displayName: "مدیر نمونهٔ توسعه", isActive: true }, select: { id: true } });
  }
  if (!admin) throw new Error("برای seed کاتالوگ production، ابتدا حساب تک‌مالک را با Secret اولیه راه‌اندازی کنید.");

  await prisma.$transaction(async (tx) => {
    const plan = await tx.subscriptionPlan.upsert({
      where: { code: "STANDARD" },
      update: {},
      create: {
        code: "STANDARD",
        nameFa: "اشتراک شاپرو",
        displayOrder: 10,
        isActive: true,
        features: ["مدیریت فروش و خرید", "موجودی و گزارش‌های شعبه", "استفادهٔ هم‌زمان اعضای مجاز"],
      },
      select: { id: true },
    });
    await tx.subscriptionPriceVersion.createMany({
      data: PRICES.map(({ durationMonths, priceRial }) => ({
        planId: plan.id,
        durationMonths,
        priceRial,
        currency: "IRR",
        effectiveFrom: EFFECTIVE_FROM,
        createdById: admin.id,
      })),
      skipDuplicates: true,
    });
    await tx.subscriptionRolloutSetting.upsert({
      where: { id: "global" }, update: {}, create: { id: "global", mode: "OBSERVE" },
    });
  }, { isolationLevel: "Serializable" });
  return { planCode: "STANDARD", prices: PRICES.map((price) => ({ durationMonths: price.durationMonths, priceRial: price.priceRial.toString() })) };
}
