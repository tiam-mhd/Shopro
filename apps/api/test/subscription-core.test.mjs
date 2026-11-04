import assert from "node:assert/strict";
import test from "node:test";
import { addJalaliMonths, getTehranJalaliDate, getTehranWallClock, isSubscriptionPeriodActive } from "../dist/subscriptions/jalali-period.js";
import { entitlementDenial, isTenantOperationalWrite } from "../dist/subscriptions/subscription-entitlement.guard.js";
import { paymentGateway } from "../dist/subscriptions/payment-gateway.js";

function jalali(date) {
  const { year, month, day } = getTehranJalaliDate(date);
  return [year, month, day];
}

function findJalaliDate(year, month, day, gregorianYear) {
  for (let offset = 0; offset < 370; offset++) {
    const candidate = new Date(Date.UTC(gregorianYear, 0, 1 + offset, 12, 30));
    if (jalali(candidate).join("-") === [year, month, day].join("-")) return candidate;
  }
  throw new Error(`Jalali date ${year}/${month}/${day} not found`);
}

test("subscription terms add Jalali calendar months and clamp Esfand in a non-leap year", () => {
  const start = new Date("2025-03-20T12:30:00.000Z"); // 1403/12/30, 16:00 in Tehran
  assert.deepEqual(jalali(start), [1403, 12, 30]);
  const oneMonth = addJalaliMonths(start, 1);
  assert.deepEqual(jalali(oneMonth), [1404, 1, 30]);
  const twelveMonths = addJalaliMonths(start, 12);
  assert.deepEqual(jalali(twelveMonths), [1404, 12, 29]);
  assert.equal(getTehranWallClock(twelveMonths).hour, 16);
  assert.equal(getTehranWallClock(twelveMonths).minute, 0);
});

test("31-day Jalali month renewals clamp to the next 30-day month without fixed millisecond periods", () => {
  const start = findJalaliDate(1405, 6, 31, 2026);
  assert.deepEqual(jalali(start), [1405, 6, 31]);
  assert.deepEqual(jalali(addJalaliMonths(start, 1)), [1405, 7, 30]);
});

test("Jalali month addition preserves Tehran wall time including milliseconds", () => {
  const start = new Date("2026-06-10T12:34:56.789Z");
  const end = addJalaliMonths(start, 1);
  const startWall = getTehranWallClock(start);
  const endWall = getTehranWallClock(end);
  assert.deepEqual([endWall.hour, endWall.minute, endWall.second], [startWall.hour, startWall.minute, startWall.second]);
  assert.equal(end.getUTCMilliseconds(), 789);
});

test("subscription periods include their start and exclude their end instant", () => {
  const start = new Date("2026-11-03T00:00:00.000Z");
  const end = new Date("2026-12-03T00:00:00.000Z");
  assert.equal(isSubscriptionPeriodActive(start, end, start), true);
  assert.equal(isSubscriptionPeriodActive(start, end, new Date(end.getTime() - 1)), true);
  assert.equal(isSubscriptionPeriodActive(start, end, end), false);
  assert.equal(isSubscriptionPeriodActive(new Date(end.getTime() + 1), new Date(end.getTime() + 2), end), false);
});

test("period duration validation rejects fractional and unbounded durations", () => {
  assert.throws(() => addJalaliMonths(new Date(), 0), RangeError);
  assert.throws(() => addJalaliMonths(new Date(), 1.5), RangeError);
  assert.throws(() => addJalaliMonths(new Date(), 121), RangeError);
});

test("entitlement rules respect suspension, enforce, grace, and observe modes", () => {
  const now = new Date("2026-11-03T12:00:00.000Z");
  const expired = { rolloutMode: "ENFORCE", graceEndsAt: null, suspended: false, active: false, hasHistory: true, latestEnd: new Date("2026-11-03T12:00:00.000Z") };
  assert.equal(entitlementDenial({ ...expired, active: true }, now), null);
  assert.equal(entitlementDenial({ ...expired, rolloutMode: "OBSERVE" }, now), null);
  assert.equal(entitlementDenial({ ...expired, graceEndsAt: new Date("2026-11-04T00:00:00.000Z") }, now), null);
  assert.equal(entitlementDenial(expired, now).code, "SUBSCRIPTION_EXPIRED");
  assert.equal(entitlementDenial({ ...expired, hasHistory: false }, now).code, "SUBSCRIPTION_REQUIRED");
  assert.equal(entitlementDenial({ ...expired, suspended: true, rolloutMode: "OBSERVE" }, now).code, "SUBSCRIPTION_REQUIRED");
});

test("the central gate covers tenant writes but leaves login, onboarding, subscriptions, and admin boundaries separate", () => {
  for (const path of ["/api/v1/sales", "/api/v1/purchases", "/api/v1/expenses", "/api/v1/finance/accounts", "/api/v1/inventory/counts", "/api/v1/products", "/api/v1/parties"]) {
    assert.equal(isTenantOperationalWrite("POST", path), true, path);
  }
  for (const [method, path] of [
    ["GET", "/api/v1/sales"], ["POST", "/api/v1/auth/logout"], ["POST", "/api/v1/businesses"], ["PATCH", "/api/v1/onboarding/progress"], ["POST", "/api/v1/onboarding/events"],
    ["POST", "/api/v1/subscriptions/orders"], ["POST", "/api/v1/system-admin/subscriptions/rollout"],
  ]) assert.equal(isTenantOperationalWrite(method, path), false, `${method} ${path}`);
  assert.equal(isTenantOperationalWrite("PATCH", "/api/v1/businesses/current/branches/123"), true);
});

test("fake checkout cannot be enabled in production even if its environment flag is present", () => {
  const localGateway = paymentGateway({ NODE_ENV: "development", PAYMENT_GATEWAY: "fake" });
  assert.equal(localGateway.mode, "fake");
  assert.match(localGateway.createCheckout({ orderId: "test-order", amountRial: 1n, currency: "IRR" }).providerReference, /^fake-test-order-/);
  assert.equal(paymentGateway({ NODE_ENV: "production", PAYMENT_GATEWAY: "fake" }).mode, "unavailable");
  assert.equal(paymentGateway({ NODE_ENV: "production", PAYMENT_GATEWAY: "zarinpal" }).mode, "unavailable");
});
