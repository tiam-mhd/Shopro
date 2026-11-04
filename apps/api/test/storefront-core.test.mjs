import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedTransition,
  assertAllowedTransition,
  extensionRial,
  formatStockPolicy,
  isValidIranianCard,
  maskedCard,
  normalizeIranianMobile,
  normalizeStoreSlug,
  paymentAllocationPlan,
  parseMoney,
  paymentStatusForTotal,
  quantityMilli,
  quantityMilliForPrecision,
  quantityMilliOrZero,
  quantityText,
  taxRial,
  trackingTokenForOrder,
} from "../dist/storefront/storefront-core.js";
import { decryptStoreCardNumber, encryptStoreCardNumber } from "../dist/storefront/storefront-crypto.js";

test("public store slugs normalize casing and reject invalid separators", () => {
  assert.equal(normalizeStoreSlug("  My-Branch  "), "my-branch");
  assert.throws(() => normalizeStoreSlug("two--words"), /نشانی فروشگاه/);
  assert.throws(() => normalizeStoreSlug("شعبه"), /نشانی فروشگاه/);
});

test("Iranian mobile digits normalize from Persian and international formats", () => {
  assert.equal(normalizeIranianMobile("۰۹۱۲۱۲۳۴۵۶۷"), "09121234567");
  assert.equal(normalizeIranianMobile("+98 912 123 4567"), "09121234567");
  assert.throws(() => normalizeIranianMobile("02112345678"), /شمارهٔ موبایل/);
});

test("money and quantity arithmetic use integer Rial and thousandth quantities", () => {
  assert.equal(parseMoney("1250000"), 1_250_000n);
  assert.throws(() => parseMoney("12.5"), /عدد صحیح ریال/);
  assert.equal(quantityMilli("۲.۱۲۵"), 2_125n);
  assert.equal(quantityMilliForPrecision("۲.۱۲", 2), 2_120n);
  assert.throws(() => quantityMilliForPrecision("۲.۱۲", 0), /رقم اعشار/);
  assert.equal(quantityText(2_125n), "2.125");
  assert.equal(quantityMilliOrZero("0.125"), 125n);
  assert.throws(() => quantityMilli("0"), /تعداد کالا/);
  assert.equal(extensionRial(1_250n, 1_000_000n), 1_250_000n);
  assert.equal(extensionRial(333n, 100n), 33n);
  assert.equal(taxRial(1_000n, 875), 88n);
});

test("card validation rejects malformed numbers and masks stored card values", () => {
  assert.equal(isValidIranianCard("6037 9975 1234 5670"), true);
  assert.equal(isValidIranianCard("۶۰۳۷ ۹۹۷۵ ۱۲۳۴ ۵۶۷۰"), true);
  assert.equal(isValidIranianCard("6037 9975 1234 5671"), false);
  assert.equal(isValidIranianCard("0000000000000000"), false);
  assert.equal(maskedCard("6037997512345678"), "•••• •••• •••• 5678");
});

test("tracking links are secret derived and order states reject illegal jumps", () => {
  process.env.STOREFRONT_TRACKING_SECRET = "storefront-test-secret-with-at-least-32-chars";
  const first = trackingTokenForOrder("order-1", "business-1");
  assert.equal(first, trackingTokenForOrder("order-1", "business-1"));
  assert.notEqual(first, trackingTokenForOrder("order-2", "business-1"));
  assert.equal(first.length, 43);
  assert.equal(allowedTransition("ACCEPTED", "PREPARING"), true);
  assert.equal(allowedTransition("SUBMITTED", "COMPLETED"), false);
  assert.throws(() => assertAllowedTransition("SUBMITTED", "COMPLETED"), /تغییر وضعیت سفارش مجاز نیست/);
});

test("payment summary distinguishes pending, partial, complete, and overpaid review", () => {
  assert.equal(paymentStatusForTotal(1_000n, 0n, false), "UNPAID");
  assert.equal(paymentStatusForTotal(1_000n, 0n, true), "UNDER_REVIEW");
  assert.equal(paymentStatusForTotal(1_000n, 500n, true), "PARTIALLY_VERIFIED");
  assert.equal(paymentStatusForTotal(1_000n, 1_000n, false), "VERIFIED");
  assert.equal(paymentStatusForTotal(1_000n, 1_001n, false, true), "OVERPAID_REVIEW");
});

test("posted order payment allocations cap at invoice total and leave customer overpayment as credit", () => {
  assert.deepEqual(paymentAllocationPlan(1_000n, [600n, 500n]), [600n, 400n]);
  assert.deepEqual(paymentAllocationPlan(1_000n, [250n, 250n]), [250n, 250n]);
  assert.deepEqual(paymentAllocationPlan(0n, [50n]), [0n]);
  assert.throws(() => paymentAllocationPlan(100n, [-1n]), /cannot be negative/);
});

test("public stock response obeys exact, approximate, and inquiry policies", () => {
  assert.deepEqual(formatStockPolicy("EXACT", "7", true), { stockLabel: "7 موجود", available: true, quantityOnHand: "7" });
  assert.deepEqual(formatStockPolicy("APPROXIMATE", "7", true), { stockLabel: "موجود", available: true, quantityOnHand: null });
  assert.deepEqual(formatStockPolicy("EXACT", "0", false), { stockLabel: "ناموجود", available: false, quantityOnHand: null });
  assert.deepEqual(formatStockPolicy("INQUIRY", "0", false), { stockLabel: "استعلام موجودی", available: true, quantityOnHand: null });
});

test("destination card numbers are encrypted with authenticated encryption at rest", () => {
  process.env.STOREFRONT_CARD_ENCRYPTION_KEY = Buffer.from("independent-random-card-key-32bytes", "utf8").subarray(0, 32).toString("base64url");
  const first = encryptStoreCardNumber("6037997512345670");
  const second = encryptStoreCardNumber("6037997512345670");
  assert.notEqual(first, second);
  assert.equal(first.includes("6037997512345670"), false);
  assert.equal(decryptStoreCardNumber(first), "6037997512345670");
  const tampered = first.split(".");
  tampered[2] = `${tampered[2][0] === "A" ? "B" : "A"}${tampered[2].slice(1)}`;
  assert.throws(() => decryptStoreCardNumber(tampered.join(".")));
});
