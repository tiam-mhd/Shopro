import { format as formatJalali, isValid, parse } from "date-fns-jalali";
import type { DisplayCurrency } from "@shopro/contracts";

export const faNumber = (value: number | string) => new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 3 }).format(Number(value));

export function todayISO(timeZone = "Asia/Tehran") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function money(amount: string | bigint | null | undefined, currency: DisplayCurrency = "IRT") {
  if (amount === null || amount === undefined) return "قابل محاسبه نیست";
  const rial = typeof amount === "bigint" ? amount : BigInt(amount);
  const shown = currency === "IRT" ? rial / 10n : rial;
  const rest = currency === "IRT" ? rial % 10n : 0n;
  const main = new Intl.NumberFormat("fa-IR").format(shown);
  return `${main}${rest ? `٫${faNumber(rest.toString())}` : ""} ${currency === "IRT" ? "تومان" : "ریال"}`;
}

export function jalaliDate(iso?: string | null) {
  if (!iso) return "—";
  const date = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return formatJalali(date, "yyyy/MM/dd").replace(/[0-9]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}

export function gregorianDateFromJalali(year: number, month: number, day: number): string {
  const parsed = parse(`${year}/${String(month + 1).padStart(2, "0")}/${String(day).padStart(2, "0")}`, "yyyy/MM/dd", new Date(2000, 0, 1));
  if (!isValid(parsed)) throw new Error("تاریخ جلالی معتبر نیست.");
  const utc = new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
  return utc.toISOString().slice(0, 10);
}
