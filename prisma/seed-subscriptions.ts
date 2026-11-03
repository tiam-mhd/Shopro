import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client.js";
import { seedSubscriptionCatalog } from "./subscription-catalog.seed.js";

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SHOPRO_SUBSCRIPTION_SEED_CONFIRM !== "SEED_SUBSCRIPTION_CATALOG") {
    throw new Error("برای اجرای seed اشتراک در production مقدار SHOPRO_SUBSCRIPTION_SEED_CONFIRM=SEED_SUBSCRIPTION_CATALOG را فقط در اجرای کنترل‌شده تنظیم کنید.");
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL تنظیم نشده است.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const result = await seedSubscriptionCatalog(prisma, process.env.NODE_ENV === "development");
    console.log(JSON.stringify({ event: "subscription_catalog.seeded", planCode: result.planCode, prices: result.prices }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
