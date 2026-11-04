import { createHmac } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { toAsciiDigits } from "@shopro/contracts";

export type OrderState = "SUBMITTED" | "ACCEPTED" | "REJECTED" | "PREPARING" | "READY" | "OUT_FOR_DELIVERY" | "READY_FOR_PICKUP" | "COMPLETED" | "CANCELLED" | "EXPIRED" | "RETURNED";

export function normalizeStoreSlug(value: string) {
  const slug = value.trim().normalize("NFKC").toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(slug) || slug.includes("--")) {
    throw new BadRequestException("نشانی فروشگاه باید با حروف انگلیسی، عدد و خط تیره نوشته شود.");
  }
  return slug;
}

export function normalizeIranianMobile(value: string) {
  const digits = toAsciiDigits(value).replace(/[\s()+-]/g, "");
  const phone = digits.startsWith("+98") ? `0${digits.slice(3)}` : digits.startsWith("98") ? `0${digits.slice(2)}` : digits;
  if (!/^09\d{9}$/.test(phone)) throw new BadRequestException("شمارهٔ موبایل معتبر نیست.");
  return phone;
}

export function parseMoney(value: string, label = "مبلغ") {
  if (!/^\d{1,20}$/.test(value)) throw new BadRequestException(`${label} باید عدد صحیح ریال باشد.`);
  return BigInt(value);
}

export function quantityMilli(value: string) {
  const normalized = toAsciiDigits(value.trim());
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,3})?$/.test(normalized)) throw new BadRequestException("تعداد کالا معتبر نیست.");
  const [whole, fraction = ""] = normalized.split(".");
  const quantity = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0") || "0");
  if (quantity <= 0n || quantity > 999_999_999_999_999n) throw new BadRequestException("تعداد کالا خارج از محدودهٔ مجاز است.");
  return quantity;
}

export function quantityMilliForPrecision(value: string, precision: number) {
  if (!Number.isInteger(precision) || precision < 0 || precision > 3) throw new BadRequestException("دقت واحد کالا معتبر نیست.");
  const normalized = toAsciiDigits(value.trim());
  const fraction = normalized.match(/\.(\d+)$/)?.[1] ?? "";
  if (fraction.length > precision) throw new BadRequestException(`تعداد کالا نباید بیشتر از ${precision} رقم اعشار داشته باشد.`);
  return quantityMilli(normalized);
}

export function quantityText(quantity: bigint) {
  const whole = quantity / 1000n;
  const fraction = (quantity % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function quantityMilliOrZero(value: string) {
  const normalized = toAsciiDigits(value.trim());
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) throw new BadRequestException("مقدار رزرو موجودی معتبر نیست.");
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0") || "0");
}

export function extensionRial(quantity: bigint, unitPrice: bigint) {
  const numerator = quantity * unitPrice;
  return (numerator + 500n) / 1000n;
}

export function taxRial(base: bigint, basisPoints: number) {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) throw new BadRequestException("نرخ مالیات کالا معتبر نیست.");
  return (base * BigInt(basisPoints) + 5_000n) / 10_000n;
}

export function isValidIranianCard(value: string) {
  const card = toAsciiDigits(value).replace(/\s/g, "");
  if (!/^\d{16}$/.test(card) || /^0{16}$/.test(card)) return false;
  let sum = 0;
  for (let index = 0; index < card.length; index++) {
    let digit = Number(card[index]);
    if ((card.length - index) % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function maskedCard(cardNumber: string) {
  return `•••• •••• •••• ${cardNumber.slice(-4)}`;
}

export function trackingTokenForOrder(orderId: string, businessId: string) {
  const secret = process.env.STOREFRONT_TRACKING_SECRET ?? process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("STOREFRONT_TRACKING_SECRET یا SESSION_SECRET باید کلید تصادفی ۳۲ کاراکتری باشد.");
  return createHmac("sha256", secret).update(`storefront-order:${businessId}:${orderId}`).digest("base64url");
}

export function allowedTransition(from: OrderState, to: OrderState) {
  const transitions: Record<OrderState, OrderState[]> = {
    SUBMITTED: ["ACCEPTED", "REJECTED", "CANCELLED", "EXPIRED"],
    ACCEPTED: ["PREPARING", "CANCELLED", "EXPIRED"],
    REJECTED: [],
    PREPARING: ["READY", "CANCELLED"],
    READY: ["OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "CANCELLED"],
    OUT_FOR_DELIVERY: ["COMPLETED", "RETURNED"],
    READY_FOR_PICKUP: ["COMPLETED", "RETURNED"],
    COMPLETED: ["RETURNED"],
    CANCELLED: [],
    EXPIRED: [],
    RETURNED: [],
  };
  return transitions[from].includes(to);
}

export function assertAllowedTransition(from: OrderState, to: OrderState) {
  if (!allowedTransition(from, to)) throw new ConflictException("این تغییر وضعیت سفارش مجاز نیست.");
}

export function formatStockPolicy(policy: "EXACT" | "APPROXIMATE" | "INQUIRY", onHand: string, showExact: boolean) {
  if (policy === "INQUIRY") return { stockLabel: "استعلام موجودی", available: true, quantityOnHand: null };
  const count = Number(onHand);
  if (!Number.isFinite(count) || count <= 0) return { stockLabel: "ناموجود", available: false, quantityOnHand: null };
  if (showExact && policy === "EXACT") return { stockLabel: `${onHand} موجود`, available: true, quantityOnHand: onHand };
  return { stockLabel: "موجود", available: true, quantityOnHand: null };
}

export function paymentStatusForTotal(total: bigint, verified: bigint, hasReview: boolean, overpaid = false): "UNPAID" | "UNDER_REVIEW" | "PARTIALLY_VERIFIED" | "OVERPAID_REVIEW" | "VERIFIED" {
  if (overpaid) return "OVERPAID_REVIEW";
  if (verified >= total && total > 0n) return "VERIFIED";
  if (hasReview) return verified > 0n ? "PARTIALLY_VERIFIED" : "UNDER_REVIEW";
  if (verified > 0n) return "PARTIALLY_VERIFIED";
  return "UNPAID";
}

export function paymentAllocationPlan(total: bigint, payments: bigint[]) {
  if (total < 0n || payments.some((amount) => amount < 0n)) throw new RangeError("Payment allocation amounts cannot be negative.");
  let remaining = total;
  return payments.map((payment) => {
    const allocation = payment < remaining ? payment : remaining;
    remaining -= allocation;
    return allocation;
  });
}
