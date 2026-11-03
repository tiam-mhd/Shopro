import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { validateProductionEnv, webOrigins } from "../dist/common/production-env.js";

const validProductionEnv = () => ({
  NODE_ENV: "production",
  COOKIE_SECURE: "true",
  DATABASE_URL: "postgresql://shopro:private@postgres.internal:5432/shopro",
  SESSION_SECRET: "random-session-secret-value-000000000000000000000000",
  OTP_HASH_SECRET: "random-otp-hash-key-value-0000000000000000000000000",
  WEB_ORIGIN: "https://shopro.example.com, https://admin.shopro.example.com",
  TRUST_PROXY_HOPS: "1",
  PARSGREEN_API_KEY: "configured-provider-key-value",
  PARSGREEN_BASE_URL: "https://sms.parsgreen.ir",
  ATTACHMENT_STORAGE_DIR: resolve("private-attachments"),
});

test("production startup accepts a complete secure configuration without exposing secret values", () => {
  assert.equal(validateProductionEnv(validProductionEnv()), undefined);
  assert.deepEqual(webOrigins(validProductionEnv()), ["https://shopro.example.com", "https://admin.shopro.example.com"]);
});

test("production startup rejects insecure cookies, local origins, placeholder secrets, missing proxy settings and relative attachment paths", () => {
  const cases = [
    [{ COOKIE_SECURE: "false" }, /COOKIE_SECURE/],
    [{ WEB_ORIGIN: "http://shopro.example.com" }, /WEB_ORIGIN/],
    [{ SESSION_SECRET: "replace-with-a-32-character-secret-value" }, /SESSION_SECRET/],
    [{ OTP_HASH_SECRET: "random-session-secret-value-000000000000000000000000" }, /باید متفاوت باشند/],
    [{ TRUST_PROXY_HOPS: undefined }, /TRUST_PROXY_HOPS/],
    [{ ATTACHMENT_STORAGE_DIR: "attachments" }, /ATTACHMENT_STORAGE_DIR/],
    [{ PARSGREEN_API_KEY: "" }, /PARSGREEN_API_KEY/],
    [{ DATABASE_URL: "postgresql://user:pass@localhost:5432/shopro" }, /localhost/],
  ];
  for (const [override, expected] of cases) assert.throws(() => validateProductionEnv({ ...validProductionEnv(), ...override }), expected);
  assert.equal(validateProductionEnv({ ...validProductionEnv(), ATTACHMENT_STORAGE_DIR: "" }), undefined);
});

test("development configuration keeps local defaults available", () => {
  assert.equal(validateProductionEnv({ NODE_ENV: "development" }), undefined);
  assert.deepEqual(webOrigins({ NODE_ENV: "development" }), ["http://localhost:5173"]);
});
