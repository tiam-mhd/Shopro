import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import type { AppRequest, AuthenticatedSystemAdmin, AuthenticatedUser } from "../common/request-context.js";
import { cursorPage, pageLimit } from "../common/cursor-pagination.js";
import { assertUuid } from "../common/uuid-param.pipe.js";
import { lockAttachmentMutationDuringBackup } from "../expenses/attachment-backup-lock.js";
import { prepareExpenseAttachment } from "../expenses/attachment-files.js";
import { AttachmentStorageService } from "../expenses/attachment-storage.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CreateManualPaymentSubmissionDto, UpdateManualPaymentSettingsDto } from "./subscriptions.dto.js";
import { requireScope, SubscriptionsService } from "./subscriptions.service.js";
import { TelegramReceiptService, type TelegramDeliveryResult } from "./telegram-receipt.service.js";

const SETTINGS_ID = "global";
const PAYMENT_PROVIDER = "card_to_card";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class ManualPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AttachmentStorageService,
    private readonly telegram: TelegramReceiptService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async submitReceipt(user: AuthenticatedUser, orderId: string, file: { originalname?: string; buffer?: Uint8Array; size?: number } | undefined, dto: CreateManualPaymentSubmissionDto, request: AppRequest) {
    const scope = requireScope(user);
    if (user.role !== "OWNER") throw new ForbiddenException("ارسال رسید اشتراک فقط برای مالک کسب‌وکار مجاز است.");
    if (!UUID_PATTERN.test(orderId)) throw new BadRequestException("شناسهٔ سفارش معتبر نیست.");
    const prepared = prepareExpenseAttachment(file);
    const id = randomUUID();
    const storageKey = `${id}.${prepared.extension}`;
    await this.storage.save(storageKey, prepared.bytes);
    let submission;
    try {
      submission = await this.prisma.$transaction(async (tx) => {
        await lockAttachmentMutationDuringBackup(tx);
        await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "subscription_orders" WHERE "id" = ${orderId}::uuid AND "business_id" = ${scope.businessId}::uuid AND "branch_id" = ${scope.branchId}::uuid FOR UPDATE`;
        const order = await tx.subscriptionOrder.findFirst({
          where: { id: orderId, ...scope },
          include: { manualPaymentSubmissions: { orderBy: { submittedAt: "desc" }, take: 1 } },
        });
        if (!order) throw new NotFoundException("سفارش اشتراک این شعبه پیدا نشد.");
        if (!order.manualPaymentSettingsSnapshot) throw new ConflictException("این سفارش برای پرداخت کارت‌به‌کارت ساخته نشده است؛ سفارش تازه‌ای ایجاد کنید.");
        if (order.status !== "PENDING") throw new ConflictException("وضعیت سفارش اجازهٔ ارسال رسید تازه را نمی‌دهد.");
        const previous = order.manualPaymentSubmissions[0];
        if (previous?.reviewStatus === "PENDING_REVIEW") throw new ConflictException("رسید این سفارش در انتظار بررسی است.");
        if (previous?.reviewStatus === "APPROVED") throw new ConflictException("پرداخت این سفارش قبلاً تأیید شده است.");

        const attempt = await tx.subscriptionPaymentAttempt.create({ data: {
          businessId: scope.businessId,
          branchId: scope.branchId,
          orderId: order.id,
          provider: PAYMENT_PROVIDER,
          amountRial: order.amountRial,
          currency: order.currency,
          status: "INITIATED",
        } });
        const created = await tx.subscriptionManualPaymentSubmission.create({ data: {
          id,
          orderId: order.id,
          paymentAttemptId: attempt.id,
          submittedById: user.id,
          trackingCode: dto.trackingCode?.trim() || null,
          storageKey,
          fileName: prepared.fileName,
          mimeType: prepared.mimeType,
          bytes: BigInt(prepared.bytes.byteLength),
          checksum: prepared.checksum,
        } });
        await tx.auditEvent.create({ data: {
          businessId: scope.businessId,
          actorId: user.id,
          action: "subscription.manual_payment.submitted",
          entityType: "subscription_order",
          entityId: order.id,
          requestId: request.requestId ?? "unknown",
          afterJson: { submissionId: created.id, amountRial: order.amountRial.toString(), trackingCode: created.trackingCode },
        } });
        return created;
      }, { isolationLevel: "Serializable" });

    } catch (error) {
      await this.storage.remove(storageKey).catch(() => undefined);
      throw error;
    }
    const delivery = await this.deliverReceipt(submission.id);
    return {
      id: submission.id,
      status: "PENDING_REVIEW",
      telegramStatus: delivery.status,
      submittedAt: submission.submittedAt.toISOString(),
      message: "رسید ثبت شد و پس از بررسی مدیر، نتیجهٔ پرداخت در همین صفحه نمایش داده می‌شود.",
    };
  }

  async settings(admin: AuthenticatedSystemAdmin, request: AppRequest) {
    const setting = await this.ensureSettings();
    await this.audit(admin, request, "subscription.manual_payment_settings.read", "subscription_manual_payment_settings", null, { enabled: setting.enabled });
    return this.settingsDto(setting);
  }

  async updateSettings(admin: AuthenticatedSystemAdmin, request: AppRequest, dto: UpdateManualPaymentSettingsDto) {
    const cardNumber = normalizeCardNumber(dto.cardNumber);
    if (!/^\d{16}$/.test(cardNumber)) throw new BadRequestException("شماره کارت باید دقیقاً ۱۶ رقم باشد.");
    const cardHolder = dto.cardHolder.trim();
    if (cardHolder.length < 2) throw new BadRequestException("نام صاحب کارت را وارد کنید.");
    const telegramTargetChatId = dto.telegramTargetChatId.trim() || null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const previous = await tx.subscriptionManualPaymentSettings.findUnique({ where: { id: SETTINGS_ID } });
      const row = await tx.subscriptionManualPaymentSettings.upsert({
        where: { id: SETTINGS_ID },
        update: {
          enabled: dto.enabled,
          cardNumber,
          cardHolder,
          bankName: dto.bankName?.trim() || null,
          instructions: dto.instructions?.trim() || null,
          telegramContactHandle: dto.telegramContactHandle.trim(),
          telegramTargetChatId,
          updatedById: admin.id,
        },
        create: {
          id: SETTINGS_ID,
          enabled: dto.enabled,
          cardNumber,
          cardHolder,
          bankName: dto.bankName?.trim() || null,
          instructions: dto.instructions?.trim() || null,
          telegramContactHandle: dto.telegramContactHandle.trim(),
          telegramTargetChatId,
          updatedById: admin.id,
        },
      });
      await tx.systemAdminAuditEvent.create({ data: {
        adminId: admin.id,
        action: "subscription.manual_payment_settings.updated",
        entityType: "subscription_manual_payment_settings",
        requestId: request.requestId ?? "unknown",
        metadata: {
          enabled: row.enabled,
          cardNumberLast4: row.cardNumber.slice(-4),
          telegramTargetConfigured: Boolean(row.telegramTargetChatId),
          previousEnabled: previous?.enabled ?? null,
        },
      } });
      return row;
    });
    return this.settingsDto(updated);
  }

  async testTelegram(admin: AuthenticatedSystemAdmin, request: AppRequest) {
    const setting = await this.ensureSettings();
    const result = await this.telegram.sendTest(setting.telegramTargetChatId);
    await this.audit(admin, request, "subscription.telegram.test", "subscription_manual_payment_settings", null, { sent: result.sent, errorCode: result.errorCode });
    return result;
  }

  async submissions(admin: AuthenticatedSystemAdmin, request: AppRequest, requestedStatus?: string, requestedCursor?: string, requestedLimit?: string) {
    if (requestedStatus && !["PENDING_REVIEW", "APPROVED", "REJECTED"].includes(requestedStatus)) throw new BadRequestException("وضعیت رسید معتبر نیست.");
    assertUuid(requestedCursor, "نشانگر صفحهٔ رسیدها معتبر نیست.");
    const where: Prisma.SubscriptionManualPaymentSubmissionWhereInput = requestedStatus ? { reviewStatus: requestedStatus as "PENDING_REVIEW" | "APPROVED" | "REJECTED" } : {};
    const limit = pageLimit(requestedLimit, 30, 100);
    if (requestedCursor && !(await this.prisma.subscriptionManualPaymentSubmission.findFirst({ where: { ...where, id: requestedCursor }, select: { id: true } }))) {
      throw new BadRequestException("نشانگر صفحه برای این فیلتر معتبر نیست؛ فهرست را تازه‌سازی کنید.");
    }
    const rows = await this.prisma.subscriptionManualPaymentSubmission.findMany({
      where,
      ...(requestedCursor ? { cursor: { id: requestedCursor }, skip: 1 } : {}),
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        order: { include: { business: { select: { displayName: true } }, branch: { select: { name: true } } } },
        paymentAttempt: { select: { status: true } },
      },
    });
    const page = cursorPage(rows, limit, (row) => row.id);
    await this.audit(admin, request, "subscription.manual_payment_submissions.read", "subscription_manual_payment_collection", null, { count: page.items.length, status: requestedStatus ?? "ALL", cursorUsed: Boolean(requestedCursor) });
    return {
      ...page,
      items: page.items.map((row) => ({
        id: row.id,
        orderId: row.orderId,
        businessName: row.order.business.displayName,
        branchName: row.order.branch.name,
        planNameFa: row.order.planNameFaSnapshot,
        durationMonths: row.order.durationMonths,
        amountRial: row.order.amountRial.toString(),
        currency: row.order.currency,
        orderStatus: row.order.status,
        reviewStatus: row.reviewStatus,
        trackingCode: row.trackingCode,
        fileName: row.fileName,
        mimeType: row.mimeType,
        bytes: row.bytes.toString(),
        telegramStatus: row.telegramStatus,
        telegramErrorCode: row.telegramErrorCode,
        rejectionReason: row.rejectionReason,
        submittedAt: row.submittedAt.toISOString(),
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
      })),
    };
  }

  async receipt(admin: AuthenticatedSystemAdmin, request: AppRequest, submissionId: string) {
    if (!UUID_PATTERN.test(submissionId)) throw new BadRequestException("شناسهٔ رسید معتبر نیست.");
    const row = await this.prisma.subscriptionManualPaymentSubmission.findUnique({ where: { id: submissionId }, select: { storageKey: true, fileName: true, mimeType: true, bytes: true, checksum: true } });
    if (!row) throw new NotFoundException("رسید پرداخت پیدا نشد.");
    const bytes = await this.storage.read(row.storageKey);
    if (BigInt(bytes.byteLength) !== row.bytes || createHash("sha256").update(bytes).digest("hex") !== row.checksum) throw new ConflictException("فایل رسید با اطلاعات ثبت‌شده مطابقت ندارد.");
    await this.audit(admin, request, "subscription.manual_payment.receipt.read", "subscription_manual_payment_submission", submissionId, { bytes: row.bytes.toString(), mimeType: row.mimeType });
    return { ...row, bytes };
  }

  async approve(admin: AuthenticatedSystemAdmin, request: AppRequest, submissionId: string) {
    if (!UUID_PATTERN.test(submissionId)) throw new BadRequestException("شناسهٔ رسید معتبر نیست.");
    const row = await this.prisma.subscriptionManualPaymentSubmission.findUnique({ where: { id: submissionId }, include: { order: true, paymentAttempt: true } });
    if (!row) throw new NotFoundException("رسید پرداخت پیدا نشد.");
    if (row.reviewStatus !== "PENDING_REVIEW" || row.order.status !== "PENDING" || row.paymentAttempt.provider !== PAYMENT_PROVIDER) throw new ConflictException("رسید دیگر در وضعیت انتظار بررسی نیست.");
    const confirmedAt = new Date();
    const period = await this.subscriptions.settleVerifiedPayment({
      orderId: row.orderId,
      provider: PAYMENT_PROVIDER,
      providerExternalId: `manual-card-transfer:${row.id}`,
      amountRial: row.order.amountRial,
      currency: row.order.currency,
      confirmedAt,
      manualReview: { submissionId: row.id, adminId: admin.id, requestId: request.requestId ?? "unknown" },
    });
    return { submissionId: row.id, reviewStatus: "APPROVED", paidAt: confirmedAt.toISOString(), periodId: period?.id ?? null };
  }

  async reject(admin: AuthenticatedSystemAdmin, request: AppRequest, submissionId: string, reason: string) {
    if (!UUID_PATTERN.test(submissionId)) throw new BadRequestException("شناسهٔ رسید معتبر نیست.");
    const rejectionReason = reason.trim();
    if (rejectionReason.length < 3 || rejectionReason.length > 500) throw new BadRequestException("دلیل رد رسید را در ۳ تا ۵۰۰ کاراکتر وارد کنید.");
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.subscriptionManualPaymentSubmission.findUnique({ where: { id: submissionId }, include: { order: true, paymentAttempt: true } });
      if (!current) throw new NotFoundException("رسید پرداخت پیدا نشد.");
      await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "subscription_orders" WHERE "id" = ${current.orderId}::uuid AND "business_id" = ${current.order.businessId}::uuid AND "branch_id" = ${current.order.branchId}::uuid FOR UPDATE`;
      const locked = await tx.subscriptionManualPaymentSubmission.findUnique({ where: { id: submissionId }, include: { order: true, paymentAttempt: true } });
      if (!locked || locked.reviewStatus !== "PENDING_REVIEW" || locked.order.status !== "PENDING" || locked.paymentAttempt.provider !== PAYMENT_PROVIDER) throw new ConflictException("رسید دیگر در وضعیت انتظار بررسی نیست.");
      const now = new Date();
      await tx.subscriptionPaymentAttempt.update({ where: { id: locked.paymentAttemptId }, data: { status: "FAILED", safeErrorCode: "MANUAL_RECEIPT_REJECTED", completedAt: now } });
      await tx.subscriptionManualPaymentSubmission.update({ where: { id: submissionId }, data: { reviewStatus: "REJECTED", rejectionReason, reviewedByAdminId: admin.id, reviewedAt: now } });
      await tx.systemAdminAuditEvent.create({ data: {
        adminId: admin.id,
        action: "subscription.manual_payment.rejected",
        entityType: "subscription_manual_payment_submission",
        entityId: submissionId,
        requestId: request.requestId ?? "unknown",
        metadata: { orderId: locked.orderId, businessId: locked.order.businessId, branchId: locked.order.branchId, reason: rejectionReason },
      } });
      return { submissionId, reviewStatus: "REJECTED", rejectionReason, reviewedAt: now.toISOString() };
    }, { isolationLevel: "Serializable" });
  }

  async retryTelegram(admin: AuthenticatedSystemAdmin, request: AppRequest, submissionId: string) {
    if (!UUID_PATTERN.test(submissionId)) throw new BadRequestException("شناسهٔ رسید معتبر نیست.");
    const row = await this.prisma.subscriptionManualPaymentSubmission.findUnique({ where: { id: submissionId }, select: { telegramStatus: true } });
    if (!row) throw new NotFoundException("رسید پرداخت پیدا نشد.");
    if (row.telegramStatus === "SENT") throw new ConflictException("رسید قبلاً به تلگرام ارسال شده است.");
    const result = await this.deliverReceipt(submissionId);
    await this.audit(admin, request, "subscription.manual_payment.telegram_retried", "subscription_manual_payment_submission", submissionId, { status: result.status, errorCode: result.errorCode });
    return { status: result.status, errorCode: result.errorCode };
  }

  private async deliverReceipt(submissionId: string) {
    const [submission, settings] = await Promise.all([
      this.prisma.subscriptionManualPaymentSubmission.findUnique({ where: { id: submissionId }, include: { order: { include: { business: { select: { displayName: true } }, branch: { select: { name: true } } } } } }),
      this.prisma.subscriptionManualPaymentSettings.findUnique({ where: { id: SETTINGS_ID } }),
    ]);
    if (!submission) throw new NotFoundException("رسید پرداخت پیدا نشد.");
    let result: TelegramDeliveryResult = { status: "NOT_CONFIGURED", messageId: null, errorCode: null };
    if (settings?.telegramTargetChatId && this.telegram.isConfigured()) {
      try {
        const bytes = await this.storage.read(submission.storageKey);
        if (BigInt(bytes.byteLength) !== submission.bytes || createHash("sha256").update(bytes).digest("hex") !== submission.checksum) throw new Error("Receipt checksum mismatch.");
        result = await this.telegram.sendReceipt({
          targetChatId: settings.telegramTargetChatId,
          bytes,
          fileName: submission.fileName,
          mimeType: submission.mimeType,
          caption: [
            "رسید پرداخت اشتراک شاپرو",
            `کسب‌وکار: ${submission.order.business.displayName}`,
            `شعبه: ${submission.order.branch.name}`,
            `پلن: ${submission.order.planNameFaSnapshot} · ${submission.order.durationMonths} ماه`,
            `مبلغ: ${submission.order.amountRial.toString()} ریال`,
            `کد سفارش: ${submission.orderId}`,
            submission.trackingCode ? `کد پیگیری انتقال: ${submission.trackingCode}` : null,
          ].filter(Boolean).join("\n"),
        });
      } catch {
        result = { status: "FAILED", messageId: null, errorCode: "RECEIPT_FILE_UNAVAILABLE" };
      }
    }
    await this.prisma.subscriptionManualPaymentSubmission.update({ where: { id: submission.id }, data: { telegramStatus: result.status, telegramMessageId: result.messageId, telegramErrorCode: result.errorCode } });
    return result;
  }

  private async ensureSettings() {
    return this.prisma.subscriptionManualPaymentSettings.upsert({
      where: { id: SETTINGS_ID },
      update: {},
      create: { id: SETTINGS_ID },
    });
  }

  private settingsDto(setting: {
    enabled: boolean; cardNumber: string; cardHolder: string; bankName: string | null; instructions: string | null;
    telegramContactHandle: string; telegramTargetChatId: string | null; updatedAt: Date;
  }) {
    return {
      enabled: setting.enabled,
      cardNumber: setting.cardNumber,
      cardHolder: setting.cardHolder,
      bankName: setting.bankName,
      instructions: setting.instructions,
      telegramContactHandle: setting.telegramContactHandle,
      telegramTargetChatId: setting.telegramTargetChatId,
      telegramTokenConfigured: this.telegram.isConfigured(),
      telegramDeliveryReady: this.telegram.isConfigured() && Boolean(setting.telegramTargetChatId),
      updatedAt: setting.updatedAt.toISOString(),
    };
  }

  private async audit(admin: AuthenticatedSystemAdmin, request: AppRequest, action: string, entityType: string, entityId: string | null, metadata: Prisma.InputJsonObject) {
    return this.prisma.systemAdminAuditEvent.create({ data: { adminId: admin.id, action, entityType, entityId, requestId: request.requestId ?? "unknown", metadata }, select: { id: true } });
  }
}

function normalizeCardNumber(value: string) {
  return value.replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/[\s-]/g, "");
}
