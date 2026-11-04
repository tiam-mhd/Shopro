import assert from "node:assert/strict";
import test from "node:test";
import { businessCreationKey, clearBusinessCreationKey, deviceTypeFromUserAgent, displayAmountToRial } from "../src/lib/onboarding.js";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("display money parser handles Persian and Arabic digits without float conversion", () => {
  assert.equal(displayAmountToRial("۱۲۳٫۵", "IRT"), "1235");
  assert.equal(displayAmountToRial("١٬٢٣٤", "IRR"), "1234");
  assert.equal(displayAmountToRial("۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳", "IRR"), "9007199254740993");
  assert.throws(() => displayAmountToRial("۱۲۳٫۴۵", "IRT"), /حداکثر یک رقم اعشار/);
  assert.throws(() => displayAmountToRial("12.5", "IRR"), /عدد صحیح/);
  assert.throws(() => displayAmountToRial("-1", "IRT"), /حداکثر یک رقم اعشار/);
});

test("business creation retry key persists until the server confirms success", () => {
  const local = storage();
  const first = businessCreationKey("user-a", local, () => "b0b4a139-4825-4495-b0a4-bd2c1f42b2a2");
  const retry = businessCreationKey("user-a", local, () => "a-new-request-key-should-not-be-used");
  assert.equal(retry, first);
  clearBusinessCreationKey("user-a", local);
  assert.equal(local.getItem("shopro_business_create_key_user-a"), null);
});

test("onboarding analytics classify device generically without retaining the raw user agent", () => {
  assert.equal(deviceTypeFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile"), "MOBILE");
  assert.equal(deviceTypeFromUserAgent("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), "TABLET");
  assert.equal(deviceTypeFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "DESKTOP");
  assert.equal(deviceTypeFromUserAgent(""), "UNKNOWN");
});
