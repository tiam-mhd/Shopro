import { BadGatewayException, BadRequestException, ForbiddenException, HttpException, Injectable, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import Tesseract from "tesseract.js";
import { normalizePersianSearch, toAsciiDigits } from "@shopro/contracts";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { extractSalesInvoice, type RecognizedOcrLine, type SalesOcrCurrency, type SalesOcrLine } from "./sales-ocr-local.js";

export const MAX_SALES_OCR_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_SALES_OCR_IMAGE_PIXELS = 40_000_000;
const MAX_CONCURRENT_OCR_REQUESTS = 3;
const MAX_RECOGNIZED_CHARACTERS = 12_000;
const OCR_LANGUAGES = ["fas", "eng"] as const;
const require = createRequire(import.meta.url);

type OcrImageFile = { buffer?: Uint8Array; size?: number };
type OcrProfile = { psm: Tesseract.PSM; image: Buffer };
type OcrCandidate = { lines: RecognizedOcrLine[]; confidence: number; score: number };

@Injectable()
export class SalesOcrService implements OnModuleDestroy {
  private readonly recentRequests = new Map<string, number[]>();
  private workerPromise?: Promise<Tesseract.Worker>;
  private modelDirectory?: string;
  private recognitionQueue: Promise<void> = Promise.resolve();
  private activeRequests = 0;

  constructor(private readonly prisma: PrismaService) {}

  availability(user: AuthenticatedUser) {
    this.assertCanCreateSale(user);
    return { enabled: true, engine: "local-tesseract", languages: [...OCR_LANGUAGES] };
  }

  async analyze(user: AuthenticatedUser, file: OcrImageFile | undefined, request: AppRequest) {
    const { businessId, branchId } = this.assertCanCreateSale(user);
    this.enforceRateLimit(user);
    if (!file?.buffer?.byteLength) throw new BadRequestException("تصویر فاکتور را انتخاب کنید.");
    if (file.buffer.byteLength > MAX_SALES_OCR_IMAGE_BYTES) throw new BadRequestException("حجم تصویر نباید بیشتر از ۱۲ مگابایت باشد.");

    const source = Buffer.from(file.buffer);
    let prepared: { base: Buffer; highContrast: Buffer };
    try {
      const sharpOptions = { limitInputPixels: MAX_SALES_OCR_IMAGE_PIXELS };
      const metadata = await sharp(source, sharpOptions).metadata();
      if (!metadata.width || !metadata.height || !["jpeg", "png", "webp", "gif", "tiff", "avif", "heif"].includes(metadata.format ?? "")) {
        throw new BadRequestException("فایل انتخاب‌شده تصویر قابل‌خواندن نیست. تصویر JPG، PNG یا WebP انتخاب کنید.");
      }
      if ((metadata.pages ?? 1) > 1) throw new BadRequestException("تصویر متحرک یا چندصفحه‌ای را به شکل یک عکس ثابت بارگذاری کنید.");
      const base = await sharp(source, sharpOptions)
        .rotate()
        .resize({ width: 2400, height: 3600, fit: "inside", withoutEnlargement: false })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .greyscale()
        .normalise({ lower: 2, upper: 98 })
        .sharpen({ sigma: 0.8 })
        .png()
        .toBuffer();
      const highContrast = await sharp(base, sharpOptions).linear(1.18, -12).threshold(175).png().toBuffer();
      prepared = { base, highContrast };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException("فایل تصویر معتبر یا قابل‌پردازش نیست.");
    }

    const business = await this.prisma.business.findUnique({ where: { id: businessId }, select: { displayCurrency: true } });
    if (!business) throw new BadRequestException("کسب‌وکار جاری پیدا نشد.");

    let parsed: ReturnType<typeof extractSalesInvoice>;
    try {
      parsed = await this.withLocalOcr(prepared, business.displayCurrency);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException("موتور محلی خواندن تصویر آماده نشد؛ کمی بعد دوباره تلاش کنید.");
    }

    const customerMatches = await this.findCustomerMatches(businessId, parsed.extraction.customer);
    const items = await Promise.all(parsed.extraction.items.map(async (item) => ({
      ...item,
      matches: await this.findCatalogMatches(businessId, branchId, item),
    })));

    await this.prisma.auditEvent.create({ data: {
      businessId,
      actorId: user.id,
      action: "sales.ocr.analyzed",
      entityType: "sales_ocr",
      entityId: randomUUID(),
      requestId: request.requestId ?? "unknown",
      afterJson: {
        engine: "tesseract.js",
        languages: [...OCR_LANGUAGES],
        itemCount: parsed.extraction.items.length,
        matchedItemCount: items.filter((item) => item.matches.length > 0).length,
        customerMatchCount: customerMatches.length,
        recognizedLineCount: parsed.recognizedLineCount,
        confidence: parsed.confidence,
      },
    } });
    return { ...parsed, customerMatches, items };
  }

  async onModuleDestroy() {
    if (this.workerPromise) {
      try { await (await this.workerPromise).terminate(); } catch { /* A failed or terminated worker needs no further cleanup. */ }
    }
    if (this.modelDirectory) await rm(this.modelDirectory, { recursive: true, force: true });
  }

  private async withLocalOcr(images: { base: Buffer; highContrast: Buffer }, currency: SalesOcrCurrency) {
    if (this.activeRequests >= MAX_CONCURRENT_OCR_REQUESTS) {
      throw new HttpException("در حال حاضر پردازش تصویر دیگری در صف است؛ چند لحظه بعد دوباره تلاش کنید.", 429);
    }
    this.activeRequests++;
    const previous = this.recognitionQueue;
    let release!: () => void;
    this.recognitionQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const worker = await this.getWorker();
      const profiles: OcrProfile[] = [
        { image: images.base, psm: Tesseract.PSM.SINGLE_BLOCK },
        { image: images.base, psm: Tesseract.PSM.SPARSE_TEXT },
        { image: images.highContrast, psm: Tesseract.PSM.SINGLE_BLOCK },
      ];
      const candidates: OcrCandidate[] = [];
      for (const profile of profiles) {
        await worker.setParameters({ tessedit_pageseg_mode: profile.psm, preserve_interword_spaces: "1" });
        const result = await worker.recognize(profile.image, { rotateAuto: false }, { text: true, blocks: true });
        const lines = this.collectLines(result.data.blocks);
        if (!lines.length && result.data.text.trim()) {
          lines.push(...result.data.text.split(/\r?\n/).map((text) => ({ text, confidence: result.data.confidence })));
        }
        const joined = lines.map((line) => line.text).join("\n").slice(0, MAX_RECOGNIZED_CHARACTERS);
        candidates.push({
          lines,
          confidence: Math.max(0, Math.min(100, result.data.confidence)),
          score: this.scoreCandidate(joined, result.data.confidence),
        });
      }
      const chosen = candidates.sort((a, b) => b.score - a.score)[0];
      if (!chosen) throw new BadGatewayException("متنی از تصویر خوانده نشد.");
      return extractSalesInvoice(chosen.lines, currency);
    } finally {
      this.activeRequests--;
      release();
    }
  }

  private async getWorker() {
    if (!this.workerPromise) {
      this.workerPromise = this.createWorker();
    }
    try {
      return await this.workerPromise;
    } catch (error) {
      this.workerPromise = undefined;
      if (this.modelDirectory) {
        await rm(this.modelDirectory, { recursive: true, force: true });
        this.modelDirectory = undefined;
      }
      throw error;
    }
  }

  private async createWorker() {
    const directory = await mkdtemp(join(tmpdir(), "shopro-local-ocr-"));
    try {
      for (const language of OCR_LANGUAGES) {
        const packageEntry = require.resolve(`@tesseract.js-data/${language}`) as string;
        const compressedModel = join(dirname(packageEntry), "4.0.0_best_int", `${language}.traineddata.gz`);
        await copyFile(compressedModel, join(directory, `${language}.traineddata.gz`));
      }
      this.modelDirectory = directory;
      return await Tesseract.createWorker("fas+eng", Tesseract.OEM.LSTM_ONLY, {
        langPath: directory,
        gzip: true,
        cacheMethod: "none",
        logger: () => undefined,
      });
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  private collectLines(blocks: Tesseract.Block[] | null) {
    const result: RecognizedOcrLine[] = [];
    for (const block of blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          const text = line.text?.trim() || line.words.map((word) => word.text).join(" ").trim();
          if (text) result.push({ text, confidence: Number.isFinite(line.confidence) ? line.confidence : 0 });
        }
      }
    }
    return result;
  }

  private scoreCandidate(text: string, confidence: number) {
    const normalized = normalizePersianSearch(text).toLocaleLowerCase("fa-IR");
    const signals = ["تاریخ", "فاکتور", "مشتری", "خریدار", "مبلغ", "جمع", "تعداد", "قیمت", "total", "date", "item", "qty"];
    const signalCount = signals.reduce((count, signal) => count + Number(normalized.includes(signal)), 0);
    const numberCount = (toAsciiDigits(text).match(/\d+/g) ?? []).length;
    return confidence + Math.min(text.replace(/\s/g, "").length, 1_500) / 100 + signalCount * 1.5 + Math.min(numberCount, 40) * 0.15;
  }

  private assertCanCreateSale(user: AuthenticatedUser) {
    if (!user.businessId || !user.branchId) throw new BadRequestException("یک کسب‌وکار و شعبه را انتخاب کنید.");
    if (!["OWNER", "MANAGER", "ACCOUNTANT", "CASHIER"].includes(user.role ?? "")) throw new ForbiddenException();
    return { businessId: user.businessId, branchId: user.branchId };
  }

  private enforceRateLimit(user: AuthenticatedUser) {
    const now = Date.now();
    const key = user.sessionId || user.id;
    const active = (this.recentRequests.get(key) ?? []).filter((time) => now - time < 60_000);
    if (active.length >= 3) throw new HttpException("در هر دقیقه حداکثر سه تصویر را می‌توان خواند. کمی بعد دوباره تلاش کنید.", 429);
    active.push(now);
    this.recentRequests.set(key, active);
    if (this.recentRequests.size > 5_000) {
      for (const [entry, times] of this.recentRequests) {
        if (!times.some((time) => now - time < 60_000)) this.recentRequests.delete(entry);
      }
    }
  }

  private async findCustomerMatches(businessId: string, customer: { name: string | null; phone: string | null } | null) {
    if (!customer) return [];
    const phone = this.normalizedPhone(customer.phone);
    const name = customer.name ? normalizePersianSearch(customer.name) : "";
    if (!phone && !name) return [];
    const rows = await this.prisma.party.findMany({
      where: { businessId, archivedAt: null, customer: { isNot: null }, OR: [...(phone ? [{ phone }] : []), ...(name ? [{ normalizedName: name }] : [])] },
      select: { id: true, name: true, phone: true },
      take: 6,
    });
    return rows.sort((a, b) => Number(b.phone === phone && Boolean(phone)) - Number(a.phone === phone && Boolean(phone)))
      .map((row) => ({ ...row, matchedBy: phone && row.phone === phone ? "phone" : "name" }));
  }

  private async findCatalogMatches(businessId: string, branchId: string, item: SalesOcrLine) {
    const normalizedName = item.name ? normalizePersianSearch(item.name) : "";
    const sku = item.sku?.trim();
    const barcode = item.barcode ? toAsciiDigits(item.barcode).replace(/\D/g, "") : "";
    const clauses = [
      ...(barcode ? [{ product: { is: { barcode } } }] : []),
      ...(sku ? [{ product: { is: { sku: { equals: sku, mode: "insensitive" as const } } } }] : []),
      ...(normalizedName ? [{ normalizedName }] : []),
    ];
    if (!clauses.length) return [];
    const rows = await this.prisma.catalogItem.findMany({
      where: { businessId, branchId, isActive: true, archivedAt: null, OR: clauses },
      include: { unit: { select: { id: true, code: true, labelFa: true, precision: true } }, product: { select: { sku: true, barcode: true, trackInventory: true } }, service: { select: { description: true } } },
      take: 6,
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sku: row.product?.sku ?? null,
      barcode: row.product?.barcode ?? null,
      kind: row.kind,
      unit: row.unit,
      salePriceRial: row.salePriceRial.toString(),
      taxRateBasisPoints: row.taxRateBasisPoints,
      trackInventory: row.product?.trackInventory ?? false,
      matchedBy: barcode && row.product?.barcode === barcode ? "barcode" : sku && row.product?.sku?.toLowerCase() === sku.toLowerCase() ? "sku" : "name",
    })).sort((a, b) => Number(b.matchedBy !== "name") - Number(a.matchedBy !== "name"));
  }

  private normalizedPhone(value: string | null) {
    if (!value) return null;
    let digits = toAsciiDigits(value).replace(/\D/g, "");
    if (digits.startsWith("98")) digits = `0${digits.slice(2)}`;
    return /^09\d{9}$/.test(digits) ? digits : null;
  }
}
