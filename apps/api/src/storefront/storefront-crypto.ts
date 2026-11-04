import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ServiceUnavailableException } from "@nestjs/common";

function cardEncryptionKey() {
  const value = process.env.STOREFRONT_CARD_ENCRYPTION_KEY?.trim();
  if (!value) throw new ServiceUnavailableException("کلید رمزگذاری کارت‌های فروشگاه پیکربندی نشده است.");
  const key = /^[a-fA-F0-9]{64}$/.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64url");
  if (key.byteLength !== 32) throw new ServiceUnavailableException("STOREFRONT_CARD_ENCRYPTION_KEY باید کلید تصادفی ۳۲ بایتی باشد.");
  return key;
}

export function encryptStoreCardNumber(cardNumber: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cardEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(cardNumber, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptStoreCardNumber(value: string) {
  const [version, ivText, tagText, ciphertextText, extra] = value.split(".");
  if (version !== "v1" || !ivText || !tagText || !ciphertextText || extra !== undefined) throw new Error("فرمت دادهٔ رمزگذاری‌شدهٔ کارت پشتیبانی نمی‌شود.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", cardEncryptionKey(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new ServiceUnavailableException("کارت فروشگاه با کلید فعلی رمزگشایی نمی‌شود.");
  }
}

export function maskedCardLast4(last4: string) { return `•••• •••• •••• ${last4}`; }
