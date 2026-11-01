import "dotenv/config";
import { PrismaService } from "../prisma/prisma.service.js";

function normalizePhone(value: string) {
  const normalized = value.replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/[\s()+-]/g, "");
  const phone = normalized.startsWith("+98") ? `0${normalized.slice(3)}` : normalized.startsWith("98") ? `0${normalized.slice(2)}` : normalized;
  if (!/^09\d{9}$/.test(phone)) throw new Error("شماره باید با قالب ۰۹۱۲۳۴۵۶۷۸۹ باشد.");
  return phone;
}

const args = process.argv.slice(2);
const arg = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const phoneInput = arg("--phone") ?? process.env.ADMIN_BOOTSTRAP_PHONE;
const displayName = arg("--name") ?? process.env.ADMIN_BOOTSTRAP_NAME;
if (!phoneInput || !displayName?.trim()) throw new Error("کاربرد: npm run admin:create -- --phone 09123456789 --name \"نام مدیر\"");

const prisma = new PrismaService();
try {
  const phone = normalizePhone(phoneInput);
  const admin = await prisma.systemAdmin.upsert({
    where: { phone },
    create: { phone, displayName: displayName.trim() },
    update: { displayName: displayName.trim(), isActive: true },
    select: { id: true, phone: true, displayName: true },
  });
  process.stdout.write(`مدیر سامانهٔ جداگانه آماده شد: ${admin.displayName} (${admin.phone})\n`);
} finally {
  await prisma.$disconnect();
}
