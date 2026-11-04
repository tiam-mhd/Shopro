import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { SyncStatus } from "../generated/prisma/client.js";
import { cursorPage, pageLimit } from "../common/cursor-pagination.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { SalesService } from "../sales/sales.service.js";
import type { SyncSaleOperationDto } from "../sales/sales.dto.js";

const PROCESSING_LEASE_MS = 5 * 60 * 1000;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeFailure(error: unknown): { status: "FAILED" | "CONFLICT"; errorCode: string; message: string } {
  const httpStatus = error instanceof HttpException ? error.getStatus() : 500;
  if (httpStatus === 400) return { status: "CONFLICT", errorCode: "VALIDATION_FAILED", message: "اطلاعات فروش دیگر معتبر نیست؛ پیش‌نویس را بررسی کنید." };
  if (httpStatus === 403) return { status: "CONFLICT", errorCode: "ACCESS_DENIED", message: "برای ثبت این فروش دسترسی ندارید." };
  if (httpStatus === 404) return { status: "CONFLICT", errorCode: "REFERENCE_NOT_FOUND", message: "یکی از کالاها یا حساب‌های این فروش دیگر در دسترس نیست." };
  if (httpStatus === 409) return { status: "CONFLICT", errorCode: "BUSINESS_CONFLICT", message: "موجودی یا وضعیت کسب‌وکار تغییر کرده است؛ فروش را بازبینی کنید." };
  return { status: "FAILED", errorCode: "TEMPORARY_FAILURE", message: "سرور موقتاً نتوانست فروش را ثبت کند؛ بعداً دوباره تلاش کنید." };
}

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService, private readonly sales: SalesService) {}

  async submitSale(user: AuthenticatedUser, dto: SyncSaleOperationDto, request: AppRequest) {
    const { businessId, branchId } = this.scope(user);
    const payloadHash = createHash("sha256").update(canonicalJson({ operationType: dto.operationType, sale: dto.sale, payment: dto.payment ?? null })).digest("hex");
    const key = { businessId, deviceId: dto.deviceId, clientOperationId: dto.clientOperationId };
    let record = await this.prisma.syncRecord.findUnique({ where: { businessId_deviceId_clientOperationId: key } });
    if (!record) {
      try {
        record = await this.prisma.syncRecord.create({ data: {
          ...key,
          userId: user.id,
          branchId,
          operationType: dto.operationType,
          payloadHash,
          status: "PENDING",
        } });
      } catch (error) {
        if (!this.isUnique(error)) throw error;
        record = await this.prisma.syncRecord.findUnique({ where: { businessId_deviceId_clientOperationId: key } });
      }
    }
    if (!record) throw new ConflictException("وضعیت همگام‌سازی ثبت نشد؛ دوباره تلاش کنید.");
    if (record.userId !== user.id || record.branchId !== branchId) throw new ConflictException("این شناسهٔ عملیات قبلاً در حساب یا شعبهٔ دیگری استفاده شده است.");
    if (record.operationType !== dto.operationType || record.payloadHash !== payloadHash) throw new ConflictException("شناسهٔ عملیات با اطلاعات دیگری استفاده شده است.");

    if (record.status === "SUCCEEDED") return this.successResponse(record.clientOperationId, record.serverEntityId, businessId, branchId);
    if (record.status === "CONFLICT" || (record.status === "FAILED" && !dto.retryFailed)) {
      return this.response(record.status, record.clientOperationId, record.serverEntityId, record.errorCode);
    }
    if (record.status === "PROCESSING" && record.updatedAt.getTime() > Date.now() - PROCESSING_LEASE_MS) {
      return this.response("PROCESSING", record.clientOperationId, record.serverEntityId, null);
    }

    const staleBefore = new Date(Date.now() - PROCESSING_LEASE_MS);
    const claims = await this.prisma.syncRecord.updateMany({
      where: {
        id: record.id,
        businessId,
        userId: user.id,
        branchId,
        OR: [
          { status: "PENDING" },
          ...(dto.retryFailed ? [{ status: "FAILED" as const }] : []),
          { status: "PROCESSING", updatedAt: { lte: staleBefore } },
        ],
      },
      data: { status: "PROCESSING", errorCode: null, updatedAt: new Date() },
    });
    if (claims.count !== 1) {
      const current = await this.prisma.syncRecord.findUnique({ where: { id: record.id } });
      if (!current) throw new ConflictException("وضعیت همگام‌سازی پیدا نشد؛ دوباره تلاش کنید.");
      return this.response(current.status, current.clientOperationId, current.serverEntityId, current.errorCode);
    }

    try {
      const draftKey = `${dto.clientOperationId}-draft`;
      const postKey = `${dto.clientOperationId}-post`;
      const draft = objectValue(await this.sales.createDraft(user, dto.sale, draftKey, request));
      const invoiceId = typeof draft?.id === "string" ? draft.id : null;
      if (!invoiceId) throw new ConflictException("پیش‌نویس فروش از سرور تأیید نشد.");
      const result = objectValue(await this.sales.post(user, invoiceId, { payments: dto.payment ? [dto.payment] : [] }, postKey, request));
      if (result?.status !== "POSTED") throw new ConflictException("ثبت نهایی فروش از سرور تأیید نشد.");
      const postedInvoiceId = typeof result.id === "string" ? result.id : invoiceId;
      const invoiceNo = typeof result.invoiceNo === "string" ? result.invoiceNo : null;
      const updated = await this.prisma.syncRecord.update({
        where: { id: record.id },
        data: { status: "SUCCEEDED", serverEntityId: postedInvoiceId, errorCode: null, updatedAt: new Date() },
      });
      return { ...this.response(updated.status, updated.clientOperationId, updated.serverEntityId, null), serverInvoiceNo: invoiceNo };
    } catch (error) {
      const failure = safeFailure(error);
      const updated = await this.prisma.syncRecord.update({
        where: { id: record.id },
        data: { status: failure.status, serverEntityId: null, errorCode: failure.errorCode, updatedAt: new Date() },
      });
      return { ...this.response(updated.status, updated.clientOperationId, null, updated.errorCode), message: failure.message };
    }
  }

  async status(user: AuthenticatedUser, cursor?: string, requestedLimit?: string) {
    const { businessId, branchId } = this.scope(user);
    const limit = pageLimit(requestedLimit, 50, 100);
    const where = { businessId, userId: user.id, branchId };
    if (cursor && !(await this.prisma.syncRecord.findFirst({ where: { ...where, id: cursor }, select: { id: true } }))) {
      throw new BadRequestException("نشانگر صفحهٔ همگام‌سازی معتبر نیست؛ فهرست را دوباره بارگذاری کنید.");
    }
    const rows = await this.prisma.syncRecord.findMany({
      where,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: { id: true, deviceId: true, clientOperationId: true, operationType: true, status: true, serverEntityId: true, errorCode: true, createdAt: true, updatedAt: true },
    });
    const page = cursorPage(rows, limit, (row) => row.id);
    const entityIds = page.items.flatMap((row) => row.serverEntityId ? [row.serverEntityId] : []);
    const invoices = entityIds.length ? await this.prisma.salesInvoice.findMany({
      where: { id: { in: entityIds }, businessId, branchId },
      select: { id: true, invoiceNo: true },
    }) : [];
    const invoiceNos = new Map(invoices.map((invoice) => [invoice.id, invoice.invoiceNo]));
    return { ...page, items: page.items.map((row) => ({ ...row, serverInvoiceNo: row.serverEntityId ? invoiceNos.get(row.serverEntityId) ?? null : null })) };
  }

  private async successResponse(clientOperationId: string, serverEntityId: string | null, businessId: string, branchId: string) {
    const invoice = serverEntityId ? await this.prisma.salesInvoice.findFirst({ where: { id: serverEntityId, businessId, branchId }, select: { invoiceNo: true } }) : null;
    return { ...this.response("SUCCEEDED", clientOperationId, serverEntityId, null), serverInvoiceNo: invoice?.invoiceNo ?? null };
  }

  private response(status: SyncStatus, clientOperationId: string, serverEntityId: string | null, errorCode: string | null) {
    return { clientOperationId, status, serverEntityId, errorCode };
  }

  private scope(user: AuthenticatedUser) {
    if (!user.businessId || !user.branchId) throw new ForbiddenException("ابتدا کسب‌وکار و شعبهٔ فعال را انتخاب کنید.");
    return { businessId: user.businessId, branchId: user.branchId };
  }

  private isUnique(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
  }
}
