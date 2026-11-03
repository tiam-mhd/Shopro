import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { basename } from "node:path";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type PreparedAttachment = {
  bytes: Buffer;
  fileName: string;
  mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  extension: "pdf" | "jpg" | "png" | "webp";
  checksum: string;
};

export function prepareExpenseAttachment(file: { originalname?: string; buffer?: Uint8Array; size?: number } | undefined): PreparedAttachment {
  if (!file?.buffer?.byteLength) throw new BadRequestException("یک فایل پیوست انتخاب کنید.");
  const bytes = Buffer.from(file.buffer);
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new BadRequestException("حجم فایل پیوست نباید بیشتر از ۱۰ مگابایت باشد.");

  const format = detectFormat(bytes);
  if (!format) throw new BadRequestException("فقط فایل PDF یا تصویر PNG، JPEG و WebP پذیرفته می‌شود.");

  return {
    bytes,
    fileName: safeFileName(file.originalname),
    mimeType: format.mimeType,
    extension: format.extension,
    checksum: createChecksum(bytes),
  };
}

function detectFormat(bytes: Buffer): Pick<PreparedAttachment, "mimeType" | "extension"> | undefined {
  if (bytes.byteLength >= 5 && bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) return { mimeType: "application/pdf", extension: "pdf" };
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mimeType: "image/jpeg", extension: "jpg" };
  if (bytes.byteLength >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mimeType: "image/png", extension: "png" };
  if (bytes.byteLength >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return { mimeType: "image/webp", extension: "webp" };
  return undefined;
}

function safeFileName(value?: string) {
  const finalSegment = basename((value ?? "").replace(/\\/g, "/"));
  const cleaned = finalSegment.normalize("NFC").replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").replace(/[<>:"/|?*]/g, "_").trim().replace(/^\.+/, "");
  const limited = [...cleaned].slice(0, 200).join("").trim();
  return limited || "پیوست";
}

function createChecksum(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
