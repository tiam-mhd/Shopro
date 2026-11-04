import { isAbsolute } from "node:path";

const PLACEHOLDER_PATTERN = /(?:replace[-_ ]with|change[-_ ]me|placeholder|your[-_ ]|example[-_ ](?:secret|key)|test[-_ ]secret)/i;

function fail(message: string): never {
  throw new Error(`تنظیم محیط production معتبر نیست: ${message}`);
}

export function webOrigins(env: NodeJS.ProcessEnv = process.env) {
  return (env.WEB_ORIGIN ?? "http://localhost:5173").split(",").map((origin) => origin.trim()).filter(Boolean);
}

export function validateProductionEnv(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== "production") return;

  if (env.COOKIE_SECURE !== "true") fail("COOKIE_SECURE باید true باشد.");
  if (!env.DATABASE_URL) fail("DATABASE_URL تنظیم نشده است.");
  let database: URL;
  try { database = new URL(env.DATABASE_URL); } catch { return fail("DATABASE_URL قالب معتبر ندارد."); }
  if (!["postgres:", "postgresql:"].includes(database.protocol) || !database.hostname || !database.pathname.slice(1)) fail("DATABASE_URL باید به PostgreSQL اشاره کند.");
  if (["localhost", "127.0.0.1", "::1"].includes(database.hostname.toLowerCase())) fail("DATABASE_URL در production نباید به localhost اشاره کند.");

  for (const name of ["SESSION_SECRET", "OTP_HASH_SECRET"] as const) {
    const value = env[name];
    if (!value || value.length < 32 || PLACEHOLDER_PATTERN.test(value)) fail(`${name} باید secret تصادفی و حداقل ۳۲ کاراکتری باشد.`);
  }
  const cardKey = env.STOREFRONT_CARD_ENCRYPTION_KEY?.trim();
  const cardKeyBytes = cardKey ? (/^[a-fA-F0-9]{64}$/.test(cardKey) ? Buffer.from(cardKey, "hex").byteLength : Buffer.from(cardKey, "base64url").byteLength) : 0;
  if (cardKeyBytes !== 32 || PLACEHOLDER_PATTERN.test(cardKey ?? "")) fail("STOREFRONT_CARD_ENCRYPTION_KEY باید یک کلید تصادفی ۳۲ بایتی باشد.");
  if (cardKey === env.SESSION_SECRET || cardKey === env.OTP_HASH_SECRET) fail("کلید رمزگذاری کارت باید از کلیدهای نشست و OTP جدا باشد.");
  if (env.SESSION_SECRET === env.OTP_HASH_SECRET) fail("SESSION_SECRET و OTP_HASH_SECRET باید متفاوت باشند.");

  const origins = webOrigins(env);
  if (origins.length === 0) fail("WEB_ORIGIN تنظیم نشده است.");
  for (const value of origins) {
    let origin: URL;
    try { origin = new URL(value); } catch { return fail("یکی از مقدارهای WEB_ORIGIN قالب معتبر ندارد."); }
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || !["", "/"].includes(origin.pathname) || ["localhost", "127.0.0.1", "::1"].includes(origin.hostname.toLowerCase())) {
      fail("هر مقدار WEB_ORIGIN باید origin دقیق HTTPS باشد.");
    }
  }

  if (env.TRUST_PROXY_HOPS === undefined || !/^\d+$/.test(env.TRUST_PROXY_HOPS) || Number(env.TRUST_PROXY_HOPS) > 10) fail("TRUST_PROXY_HOPS باید صریحاً عددی بین صفر تا ده باشد.");
  if (!env.PARSGREEN_API_KEY || PLACEHOLDER_PATTERN.test(env.PARSGREEN_API_KEY)) fail("PARSGREEN_API_KEY تنظیم نشده است.");
  let smsBase: URL;
  try { smsBase = new URL(env.PARSGREEN_BASE_URL ?? "https://sms.parsgreen.ir"); } catch { return fail("PARSGREEN_BASE_URL قالب معتبر ندارد."); }
  if (smsBase.protocol !== "https:" || smsBase.username || smsBase.password) fail("PARSGREEN_BASE_URL باید HTTPS و بدون credential باشد.");
  if (env.ATTACHMENT_STORAGE_DIR && !isAbsolute(env.ATTACHMENT_STORAGE_DIR)) fail("ATTACHMENT_STORAGE_DIR باید مسیر مطلق volume خصوصی باشد.");
}
