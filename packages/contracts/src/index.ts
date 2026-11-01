export type DisplayCurrency = "IRR" | "IRT";
export type MemberRole = "OWNER" | "MANAGER" | "ACCOUNTANT" | "CASHIER" | "VIEWER";

export interface SessionUser {
  id: string;
  phone: string;
  displayName: string | null;
}

export interface BusinessSummary {
  id: string;
  displayName: string;
  timezone: string;
  displayCurrency: DisplayCurrency;
  branches: Array<{ id: string; name: string; code: string }>;
  role: MemberRole;
}

export function toAsciiDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

export function normalizePersianSearch(input: string): string {
  return toAsciiDigits(input)
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u0640\u200c\u200f\u200e]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fa-IR");
}

export function parseRialInteger(input: string): bigint {
  const value = toAsciiDigits(input).replace(/[٬,\s]/g, "");
  if (!/^\d+$/.test(value)) throw new Error("مبلغ را به‌صورت عدد صحیح وارد کنید.");
  return BigInt(value);
}

export function parseQuantityMilli(input: string): bigint {
  const value = toAsciiDigits(input).replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d{1,3})?$/.test(value)) throw new Error("تعداد حداکثر سه رقم اعشار دارد.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}

export function formatMoney(amountRial: string | bigint, currency: DisplayCurrency): string {
  const rial = typeof amountRial === "bigint" ? amountRial : BigInt(amountRial);
  const displayed = currency === "IRT" ? rial / 10n : rial;
  const remainder = currency === "IRT" ? rial % 10n : 0n;
  const formatted = new Intl.NumberFormat("fa-IR").format(displayed);
  return `${formatted}${remainder ? `٫${remainder.toString()}` : ""} ${currency === "IRT" ? "تومان" : "ریال"}`;
}

export function formatQuantity(value: string | number): string {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 3 }).format(Number(value));
}
