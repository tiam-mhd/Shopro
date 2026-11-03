import assert from "node:assert/strict";
import { test } from "node:test";
import { ParsgreenService } from "../dist/auth/parsgreen.service.js";

function setEnv(t, key, value) {
  const previous = process.env[key];
  t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
  process.env[key] = value;
}

test("ParsGreen sends only the phone and code through its authenticated OTP endpoint", async (t) => {
  setEnv(t, "PARSGREEN_API_KEY", "test-key-not-a-secret");
  setEnv(t, "PARSGREEN_BASE_URL", "https://sms.example.test");
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  let observed;
  globalThis.fetch = async (url, init) => {
    observed = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ R_Success: true }), { status: 200, headers: { "content-type": "application/json" } });
  };

  await new ParsgreenService().sendOtp("09123456789", "567890", "test-request");
  assert.equal(observed.url, "https://sms.example.test/Apiv2/Message/SendOtp");
  assert.equal(observed.init.headers.authorization, "BASIC APIKEY:test-key-not-a-secret");
  assert.deepEqual(observed.body, { Mobile: "09123456789", SmsCode: "567890" });
});

test("ParsGreen provider timeout is returned as an explicit gateway failure", async (t) => {
  setEnv(t, "PARSGREEN_API_KEY", "test-key-not-a-secret");
  setEnv(t, "PARSGREEN_TIMEOUT_MS", "5");
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  });

  await assert.rejects(
    () => new ParsgreenService().sendOtp("09123456789", "567890", "test-request"),
    (error) => error?.getStatus?.() === 502 && String(error.message).includes("وضعیت ارسال کد ممکن است نامشخص باشد"),
  );
});
