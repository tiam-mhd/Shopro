import { createHmac, timingSafeEqual } from "node:crypto";

export type AttachmentDownloadGrant = {
  version: 1;
  expenseId: string;
  attachmentId: string;
  businessId: string;
  branchId: string;
  userId: string;
  expiresAt: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TTL_MS = 60_000;

export function createAttachmentDownloadGrant(input: Omit<AttachmentDownloadGrant, "version" | "expiresAt">, secret: string, now = Date.now()) {
  if (secret.length < 32) throw new Error("Attachment grant signing key is unavailable.");
  const grant: AttachmentDownloadGrant = { version: 1, ...input, expiresAt: now + TTL_MS };
  const payload = Buffer.from(JSON.stringify(grant)).toString("base64url");
  return { token: `${payload}.${signature(payload, secret)}`, expiresAt: new Date(grant.expiresAt).toISOString() };
}

export function verifyAttachmentDownloadGrant(token: string | undefined, secret: string, expected: Omit<AttachmentDownloadGrant, "version" | "expiresAt">, now = Date.now()) {
  if (!token || token.length > 1024 || secret.length < 32) return false;
  const [payload, suppliedSignature, ...extra] = token.split(".");
  if (!payload || !suppliedSignature || extra.length) return false;
  const expectedSignature = Buffer.from(signature(payload, secret));
  const actualSignature = Buffer.from(suppliedSignature);
  if (expectedSignature.byteLength !== actualSignature.byteLength || !timingSafeEqual(expectedSignature, actualSignature)) return false;
  try {
    const grant = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<AttachmentDownloadGrant>;
    return grant.version === 1
      && typeof grant.expiresAt === "number"
      && grant.expiresAt > now
      && grant.expiresAt <= now + TTL_MS
      && UUID.test(grant.expenseId ?? "")
      && UUID.test(grant.attachmentId ?? "")
      && UUID.test(grant.businessId ?? "")
      && UUID.test(grant.branchId ?? "")
      && UUID.test(grant.userId ?? "")
      && grant.expenseId === expected.expenseId
      && grant.attachmentId === expected.attachmentId
      && grant.businessId === expected.businessId
      && grant.branchId === expected.branchId
      && grant.userId === expected.userId;
  } catch {
    return false;
  }
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
