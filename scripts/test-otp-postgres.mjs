import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AuthService } from "../apps/api/dist/auth/auth.service.js";
import { PrismaService } from "../apps/api/dist/prisma/prisma.service.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL must target an isolated test database.");
const databaseUrl = new URL(connectionString);
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
if (!["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname.replace(/^\[|\]$/g, "")) || !/test/i.test(databaseName)) {
  throw new Error(`Refusing OTP integration outside loopback test database (host=${databaseUrl.hostname}, database=${databaseName}).`);
}

const prisma = new PrismaService();
const previousEnv = Object.fromEntries(["OTP_HASH_SECRET", "SESSION_SECRET", "OTP_RESEND_SECONDS", "OTP_MAX_PER_PHONE_HOUR"].map((key) => [key, process.env[key]]));
const testPhones = new Set();
const createdUserIds = new Set();
const sentCodes = [];
let auth;

function phone() {
  const value = `09${randomUUID().replace(/\D/g, "").padEnd(9, "0").slice(0, 9)}`;
  testPhones.add(value);
  return value;
}

try {
  await prisma.$connect();
  process.env.OTP_HASH_SECRET = randomUUID() + randomUUID();
  process.env.SESSION_SECRET = randomUUID() + randomUUID();
  process.env.OTP_RESEND_SECONDS = "60";
  process.env.OTP_MAX_PER_PHONE_HOUR = "5";
  auth = new AuthService(prisma, { sendOtp: async (targetPhone, code) => { sentCodes.push({ phone: targetPhone, code }); } });

  const concurrentPhone = phone();
  const samePhoneResults = await Promise.allSettled(Array.from({ length: 20 }, () => auth.requestOtp(concurrentPhone, "USER_LOGIN", "198.51.100.10")));
  const acceptedSamePhone = samePhoneResults.filter((result) => result.status === "fulfilled");
  const failureSummary = samePhoneResults.filter((result) => result.status === "rejected").map((result) => ({ name: result.reason?.name, code: result.reason?.code, status: result.reason?.getStatus?.(), message: result.reason?.message }));
  assert.equal(acceptedSamePhone.length, 1, `concurrent requests for one phone must create one OTP challenge; rejected results: ${JSON.stringify(failureSummary)}`);
  const throttledPhoneResults = samePhoneResults.filter((result) => result.status === "rejected");
  assert.equal(throttledPhoneResults.length, 19);
  assert.ok(throttledPhoneResults.every((result) => result.reason?.getStatus?.() === 429), "concurrent duplicate requests should receive 429");
  assert.equal(await prisma.otpChallenge.count({ where: { phone: concurrentPhone, purpose: "USER_LOGIN" } }), 1);
  assert.equal(sentCodes.filter((item) => item.phone === concurrentPhone).length, 1, "only the accepted request should call the SMS adapter");
  await assert.rejects(() => auth.requestOtp(concurrentPhone, "USER_LOGIN", "198.51.100.11"), (error) => error?.getStatus?.() === 429, "phone cooldown must apply across source IPs");

  const sharedIp = "198.51.100.20";
  for (let index = 0; index < 10; index++) await auth.requestOtp(phone(), "USER_LOGIN", sharedIp);
  const blockedByIp = await Promise.allSettled([auth.requestOtp(phone(), "USER_LOGIN", sharedIp)]);
  assert.equal(blockedByIp[0].status, "rejected");
  assert.equal(blockedByIp[0].reason?.getStatus?.(), 429, "one IP must be limited to ten requests per minute");

  process.env.OTP_MAX_PER_PHONE_HOUR = "2";
  const hourlyPhone = phone();
  for (let attempt = 0; attempt < 2; attempt++) {
    await auth.requestOtp(hourlyPhone, "USER_LOGIN", `198.51.100.${50 + attempt}`);
    await prisma.otpChallenge.updateMany({ where: { phone: hourlyPhone, purpose: "USER_LOGIN" }, data: { createdAt: new Date(Date.now() - 120_000) } });
  }
  await assert.rejects(() => auth.requestOtp(hourlyPhone, "USER_LOGIN", "198.51.100.52"), (error) => error?.getStatus?.() === 429, "phone hourly limit must be enforced independently from cooldown");
  assert.equal(await prisma.otpChallenge.count({ where: { phone: hourlyPhone, purpose: "USER_LOGIN" } }), 2);
  process.env.OTP_MAX_PER_PHONE_HOUR = "5";

  const loginPhone = phone();
  await auth.requestOtp(loginPhone, "USER_LOGIN", "198.51.100.40");
  const loginCode = sentCodes.findLast((item) => item.phone === loginPhone)?.code;
  assert.match(loginCode ?? "", /^\d{6}$/);
  const challenge = await prisma.otpChallenge.findFirstOrThrow({ where: { phone: loginPhone, purpose: "USER_LOGIN" } });
  assert.notEqual(challenge.codeHash, loginCode, "the database must store only the keyed hash, not the OTP");
  const verified = await auth.verifyUserOtp(loginPhone, loginCode);
  createdUserIds.add(verified.user.id);
  assert.equal(verified.user.phone, loginPhone);
  assert.equal(await prisma.userSession.count({ where: { userId: verified.user.id, revokedAt: null } }), 1);
  await assert.rejects(() => auth.verifyUserOtp(loginPhone, loginCode), (error) => error?.getStatus?.() === 400, "an OTP must be one-time use");

  const bruteForcePhone = phone();
  await auth.requestOtp(bruteForcePhone, "USER_LOGIN", "198.51.100.41");
  for (let attempt = 0; attempt < 5; attempt++) {
    await assert.rejects(() => auth.verifyUserOtp(bruteForcePhone, "12345"), (error) => error?.getStatus?.() === 400);
  }
  assert.equal((await prisma.otpChallenge.findFirstOrThrow({ where: { phone: bruteForcePhone, purpose: "USER_LOGIN" } })).attempts, 5);
  await assert.rejects(() => auth.verifyUserOtp(bruteForcePhone, "12345"), (error) => error?.getStatus?.() === 400);

  console.log("PostgreSQL OTP integration passed: concurrent cooldown, phone hourly and ten-per-IP limits, unknown admin suppression, keyed-code storage, one-time verification and five-attempt lockout.");
} finally {
  try {
    if (testPhones.size) await prisma.otpChallenge.deleteMany({ where: { phone: { in: [...testPhones] } } });
    for (const id of createdUserIds) {
      await prisma.userSession.deleteMany({ where: { userId: id } });
      await prisma.user.deleteMany({ where: { id } });
    }
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await prisma.$disconnect();
  }
}
