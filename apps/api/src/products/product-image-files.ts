import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import sharp from "sharp";

export const MAX_PRODUCT_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PRODUCT_IMAGE_STORAGE_BYTES = 20 * 1024 * 1024;
const MAX_PRODUCT_IMAGE_PIXELS = 40_000_000;

export async function prepareProductImage(file: { originalname?: string; buffer?: Uint8Array; size?: number } | undefined) {
  if (!file?.buffer?.byteLength) throw new BadRequestException("یک تصویر انتخاب کنید.");
  const input = Buffer.from(file.buffer);
  if (input.byteLength > MAX_PRODUCT_IMAGE_UPLOAD_BYTES) throw new BadRequestException("حجم هر تصویر نباید بیشتر از ۱۰ مگابایت باشد.");

  try {
    const image = sharp(input, { limitInputPixels: MAX_PRODUCT_IMAGE_PIXELS });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || !["jpeg", "png", "webp"].includes(metadata.format ?? "")) {
      throw new BadRequestException("فقط تصویر JPEG، PNG یا WebP پذیرفته می‌شود.");
    }
    if ((metadata.pages ?? 1) > 1) throw new BadRequestException("تصویر متحرک را به‌صورت یک تصویر ثابت بارگذاری کنید.");

    const bytes = await sharp(input, { limitInputPixels: MAX_PRODUCT_IMAGE_PIXELS })
      .rotate()
      .webp({ lossless: true, exact: true, effort: 6 })
      .toBuffer();
    if (bytes.byteLength > MAX_PRODUCT_IMAGE_STORAGE_BYTES) throw new BadRequestException("حجم تصویر تبدیل‌شده بیشتر از ۲۰ مگابایت است.");
    return { bytes, checksum: createHash("sha256").update(bytes).digest("hex") };
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException("فایل تصویر معتبر یا قابل پردازش نیست.");
  }
}
