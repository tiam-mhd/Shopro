import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import type { AppRequest, AuthenticatedUser } from "../common/request-context.js";
import { cursorPage, pageLimit } from "../common/cursor-pagination.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { addJalaliMonths, isSubscriptionPeriodActive } from "./jalali-period.js";
import { paymentGateway } from "./payment-gateway.js";
import type { CreateSubscriptionOrderDto } from "./subscriptions.dto.js";

const DURATION_OPTIONS = new Set([1, 3, 6, 12]);
const errorCodes = (error: unknown) => {
  const codes = new Set<string>();
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  while (pending.length && seen.size < 8) {
    const current = pending.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const value = current as { code?: unknown; cause?: unknown; meta?: unknown; driverAdapterError?: unknown; originalError?: unknown };
    if (typeof value.code === "string") codes.add(value.code);
    for (const nested of [value.cause, value.driverAdapterError, value.originalError]) if (nested && typeof nested === "object") pending.push(nested);
    if (value.meta && typeof value.meta === "object") {
      const meta = value.meta as { cause?: unknown; driverAdapterError?: unknown; originalError?: unknown };
      for (const nested of [meta.cause, meta.driverAdapterError, meta.originalError]) if (nested && typeof nested === "object") pending.push(nested);
    }
  }
  return codes;
};
const isSerializationConflict = (error: unknown) => {
  const codes = errorCodes(error);
  return codes.has("P2034") || codes.has("40001") || codes.has("40P01");
};
const isUniqueConflict = (error: unknown) => {
  const codes = errorCodes(error);
  return codes.has("P2002") || codes.has("23505");
};

type Scope = { businessId: string; branchId: string };

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPlans() {
    const now = new Date();
    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
      include: { prices: { where: { effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, orderBy: { effectiveFrom: "desc" } } },
    });
    return plans.map((plan) => {
      const latest = new Map<number, (typeof plan.prices)[number]>();
      for (const price of plan.prices) if (!latest.has(price.durationMonths)) latest.set(price.durationMonths, price);
      const monthPrice = latest.get(1)?.priceRial;
      return {
        code: plan.code,
        nameFa: plan.nameFa,
        badge: plan.badge,
        features: asFeatures(plan.features),
        durations: [...latest.values()].sort((a, b) => a.durationMonths - b.durationMonths).map((price) => {
          const baseline = monthPrice === undefined ? undefined : monthPrice * BigInt(price.durationMonths);
          const savingRial = baseline === undefined || baseline <= price.priceRial ? 0n : baseline - price.priceRial;
          const savingBasisPoints = baseline && baseline > 0n ? Number(savingRial * 10_000n / baseline) : 0;
          return {
            priceVersionId: price.id,
            durationMonths: price.durationMonths,
            priceRial: price.priceRial.toString(),
            monthlyEquivalentRial: (price.priceRial / BigInt(price.durationMonths)).toString(),
            savingRial: savingRial.toString(),
            savingBasisPoints,
          };
        }),
      };
    });
  }

  async current(user: AuthenticatedUser) {
    const scope = requireScope(user);
    return this.currentForScope(scope, new Date());
  }

  async orders(user: AuthenticatedUser, requestedCursor?: string, requestedLimit?: string) {
    const scope = requireScope(user);
    const limit = pageLimit(requestedLimit, 20, 50);
    if (requestedCursor) {
      const exists = await this.prisma.subscriptionOrder.findFirst({ where: { id: requestedCursor, ...scope }, select: { id: true } });
      if (!exists) throw new BadRequestException("نشانگر صفحهٔ سفارش برای این شعبه معتبر نیست؛ فهرست را تازه‌سازی کنید.");
    }
    const rows = await this.prisma.subscriptionOrder.findMany({
      where: scope,
      ...(requestedCursor ? { cursor: { id: requestedCursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: { attempts: { orderBy: { createdAt: "desc" }, take: 3 }, manualPaymentSubmissions: { orderBy: { submittedAt: "desc" }, take: 1 } },
    });
    const page = cursorPage(rows, limit, (row) => row.id);
    return { ...page, items: page.items.map((row) => this.orderDto(row)) };
  }

  async order(user: AuthenticatedUser, orderId: string) {
    const scope = requireScope(user);
    const row = await this.prisma.subscriptionOrder.findFirst({
      where: { id: orderId, ...scope },
      include: { attempts: { orderBy: { createdAt: "desc" }, take: 5 }, manualPaymentSubmissions: { orderBy: { submittedAt: "desc" }, take: 1 } },
    });
    if (!row) throw new NotFoundException("سفارش اشتراک پیدا نشد.");
    return this.orderDto(row);
  }

  async createOrder(user: AuthenticatedUser, dto: CreateSubscriptionOrderDto, idempotencyKey: string | undefined) {
    const scope = requireScope(user);
    if (user.role !== "OWNER") throw new ForbiddenException("فقط مالک کسب‌وکار می‌تواند اشتراک شعبه را بخرد یا تمدید کند.");
    if (!DURATION_OPTIONS.has(dto.durationMonths)) throw new BadRequestException("مدت اشتراک معتبر نیست.");
    if (!idempotencyKey || !/^[\w.-]{8,128}$/.test(idempotencyKey)) throw new BadRequestException("کلید یکتای سفارش معتبر نیست.");
    const now = new Date();
    const gateway = paymentGateway();
    const fake = gateway.mode === "fake";

    const order = await (async () => {
      for (let retry = 0; retry < 5; retry++) {
        try {
          return await this.prisma.$transaction(async (tx) => {
      const existing = await tx.subscriptionOrder.findUnique({ where: { businessId_branchId_idempotencyKey: { ...scope, idempotencyKey } }, include: { attempts: { orderBy: { createdAt: "desc" }, take: 3 }, manualPaymentSubmissions: { orderBy: { submittedAt: "desc" }, take: 1 } } });
      if (existing) {
        if (existing.planCodeSnapshot !== dto.planCode || existing.durationMonths !== dto.durationMonths) throw new ConflictException("این کلید سفارش قبلاً برای پلن دیگری استفاده شده است.");
        return existing;
      }
      const manualSettings = fake ? null : await tx.subscriptionManualPaymentSettings.findUnique({ where: { id: "global" } });
      const manualEnabled = Boolean(manualSettings?.enabled);
      const branch = await tx.branch.findFirst({ where: { id: scope.branchId, businessId: scope.businessId, isActive: true }, select: { id: true } });
      if (!branch) throw new NotFoundException("شعبهٔ فعال برای این سفارش پیدا نشد.");
      const plan = await tx.subscriptionPlan.findFirst({ where: { code: dto.planCode, isActive: true } });
      if (!plan) throw new NotFoundException("این اشتراک در حال حاضر برای خرید در دسترس نیست.");
      const price = await tx.subscriptionPriceVersion.findFirst({
        where: { planId: plan.id, durationMonths: dto.durationMonths, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
        orderBy: { effectiveFrom: "desc" },
      });
      if (!price) throw new ConflictException("برای این مدت، قیمت معتبری تعریف نشده است.");
      const branchSubscription = await tx.branchSubscription.upsert({ where: { businessId_branchId: scope }, update: {}, create: scope });
      let created = await tx.subscriptionOrder.create({
        data: {
          ...scope,
          branchSubscriptionId: branchSubscription.id,
          planId: plan.id,
          priceVersionId: price.id,
          createdById: user.id,
          idempotencyKey,
          planCodeSnapshot: plan.code,
          planNameFaSnapshot: plan.nameFa,
          durationMonths: dto.durationMonths,
          amountRial: price.priceRial,
          currency: price.currency,
          status: fake || manualEnabled ? "PENDING" : "FAILED",
          ...(manualEnabled && manualSettings ? { manualPaymentSettingsSnapshot: {
            cardNumber: manualSettings.cardNumber,
            cardHolder: manualSettings.cardHolder,
            bankName: manualSettings.bankName,
            instructions: manualSettings.instructions,
            telegramContactHandle: manualSettings.telegramContactHandle,
          } } : {}),
          ...(!manualEnabled || fake ? { attempts: { create: {
            provider: gateway.provider ?? "unconfigured",
            amountRial: price.priceRial,
            currency: price.currency,
            status: fake ? "INITIATED" : "UNAVAILABLE",
            safeErrorCode: fake ? null : "PAYMENT_PROVIDER_NOT_CONFIGURED",
            completedAt: fake ? null : now,
          } } } : {}),
        },
        include: { attempts: { orderBy: { createdAt: "desc" }, take: 3 }, manualPaymentSubmissions: { orderBy: { submittedAt: "desc" }, take: 1 } },
      });
      if (fake) {
        const checkout = gateway.createCheckout({ orderId: created.id, amountRial: price.priceRial, currency: price.currency });
        created = await tx.subscriptionOrder.update({ where: { id: created.id }, data: { providerReference: checkout.providerReference }, include: { attempts: { orderBy: { createdAt: "desc" }, take: 3 }, manualPaymentSubmissions: { orderBy: { submittedAt: "desc" }, take: 1 } } });
      }
      return created;
          }, { isolationLevel: "ReadCommitted" }).catch(async (error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const duplicate = await this.prisma.subscriptionOrder.findUnique({ where: { businessId_branchId_idempotencyKey: { ...scope, idempotencyKey } }, include: { attempts: { orderBy: { createdAt: "desc" }, take: 3 }, manualPaymentSubmissions: { orderBy: { submittedAt: "desc" }, take: 1 } } });
        if (duplicate && duplicate.planCodeSnapshot === dto.planCode && duplicate.durationMonths === dto.durationMonths) return duplicate;
        if (duplicate) throw new ConflictException("این کلید سفارش قبلاً برای پلن دیگری استفاده شده است.");
      }
      throw error;
    });
        } catch (error) {
          if ((isSerializationConflict(error) || isUniqueConflict(error)) && retry < 4) {
            await new Promise((resolve) => setTimeout(resolve, 10 * (retry + 1)));
            continue;
          }
          if (isSerializationConflict(error) || isUniqueConflict(error)) {
            const duplicate = await this.prisma.subscriptionOrder.findUnique({ where: { businessId_branchId_idempotencyKey: { ...scope, idempotencyKey } }, include: { attempts: { orderBy: { createdAt: "desc" }, take: 3 }, manualPaymentSubmissions: { orderBy: { submittedAt: "desc" }, take: 1 } } });
            if (duplicate && duplicate.planCodeSnapshot === dto.planCode && duplicate.durationMonths === dto.durationMonths) return duplicate;
            if (duplicate) throw new ConflictException("این کلید سفارش قبلاً برای پلن دیگری استفاده شده است.");
            throw new ConflictException("ساخت سفارش هم‌زمان شد؛ همان درخواست را با همین کلید دوباره ارسال کنید.");
          }
          throw error;
        }
      }
      throw new ConflictException("\u0633\u0627\u062e\u062a \u0633\u0641\u0627\u0631\u0634 \u0647\u0645\u200c\u0632\u0645\u0627\u0646 \u0634\u062f\u061b \u0647\u0645\u0627\u0646 \u062f\u0631\u062e\u0648\u0627\u0633\u062a \u0631\u0627 \u0628\u0627 \u0647\u0645\u06cc\u0646 \u06a9\u0644\u06cc\u062f \u062f\u0648\u0628\u0627\u0631\u0647 \u0627\u0631\u0633\u0627\u0644 \u06a9\u0646\u06cc\u062f.");
    })();
    const paymentMode = fake ? "fake" : order.manualPaymentSettingsSnapshot ? "card_transfer" : "unavailable";
    const message = paymentMode === "fake" ? "درگاه آزمایشی فعال است؛ پرداخت آزمایشی فقط در محیط توسعه انجام می‌شود."
      : paymentMode === "card_transfer" ? "مبلغ را کارت‌به‌کارت کنید و تصویر رسید را برای بررسی مدیر ارسال کنید. اشتراک پس از تأیید رسید فعال می‌شود."
      : "روش پرداخت فعالی تنظیم نشده است؛ سفارش قابل پرداخت نیست.";
    return { ...this.orderDto(order), paymentMode, message };
  }

  async confirmFakeOrder(user: AuthenticatedUser, orderId: string) {
    const scope = requireScope(user);
    if (user.role !== "OWNER") throw new ForbiddenException("فقط مالک می‌تواند خرید آزمایشی را تأیید کند.");
    if (paymentGateway().mode !== "fake") throw new ForbiddenException("پرداخت آزمایشی فقط در محیط توسعه و تست فعال است.");
    const order = await this.prisma.subscriptionOrder.findFirst({ where: { id: orderId, ...scope }, include: { attempts: { where: { provider: "fake" }, take: 1 } } });
    if (!order || !order.attempts.length) throw new NotFoundException("سفارش آزمایشی پیدا نشد.");
    await this.settleVerifiedPayment({
      orderId,
      provider: "fake",
      providerExternalId: `fake-payment-${order.id}`,
      amountRial: order.amountRial,
      currency: order.currency,
      confirmedAt: new Date(),
    });
    return this.order(user, orderId);
  }

  /** Call only after a real provider adapter has verified its server signature and settlement fields. */
  async settleVerifiedPayment(input: {
    orderId: string; provider: string; providerExternalId: string; amountRial: bigint; currency: string; confirmedAt: Date;
    manualReview?: { submissionId: string; adminId: string; requestId: string; reason: string };
  }) {
    if (!input.providerExternalId || input.providerExternalId.length > 160 || !Number.isFinite(input.confirmedAt.getTime())) throw new BadRequestException("رسید پرداخت معتبر نیست.");
    for (let retry = 0; retry < 3; retry++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const order = await tx.subscriptionOrder.findUnique({ where: { id: input.orderId }, include: { plan: true } });
          if (!order) throw new NotFoundException("سفارش پرداخت پیدا نشد.");
          if (order.status === "PAID") return tx.subscriptionPeriod.findUnique({ where: { orderId: order.id } });
          if (order.status !== "PENDING") throw new ConflictException("این سفارش دیگر در انتظار پرداخت نیست.");
          if (order.amountRial !== input.amountRial || order.currency !== input.currency) throw new ConflictException("مبلغ یا واحد سفارش با رسید پرداخت یکسان نیست.");
          const initialized = await tx.subscriptionPaymentAttempt.findFirst({ where: { orderId: order.id, provider: input.provider, status: "INITIATED" }, orderBy: { createdAt: "desc" } });
          if (!initialized) throw new ConflictException("تلاش پرداخت معتبری برای این سفارش وجود ندارد.");
          if (input.manualReview) {
            const submission = await tx.subscriptionManualPaymentSubmission.findUnique({ where: { id: input.manualReview.submissionId }, select: { id: true, orderId: true, paymentAttemptId: true, reviewStatus: true } });
            if (input.provider !== "card_to_card" || !submission || submission.orderId !== order.id || submission.paymentAttemptId !== initialized.id || submission.reviewStatus !== "PENDING_REVIEW") {
              throw new ConflictException("رسید برای این سفارش دیگر در انتظار بررسی نیست.");
            }
          }
          await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "branches" WHERE "id" = ${order.branchId}::uuid AND "business_id" = ${order.businessId}::uuid FOR UPDATE`;
          const previous = await tx.subscriptionPeriod.findFirst({ where: { branchSubscriptionId: order.branchSubscriptionId, revokedAt: null }, orderBy: [{ endsAt: "desc" }, { id: "desc" }] });
          const startsAt = previous && previous.endsAt.getTime() > input.confirmedAt.getTime() ? previous.endsAt : input.confirmedAt;
          const endsAt = addJalaliMonths(startsAt, order.durationMonths);
          const duplicateReference = await tx.subscriptionPaymentAttempt.findUnique({ where: { providerExternalId: input.providerExternalId } });
          if (duplicateReference && duplicateReference.orderId !== order.id) throw new ConflictException("شناسهٔ پرداخت قبلاً برای سفارش دیگری ثبت شده است.");
          await tx.subscriptionPaymentAttempt.update({ where: { id: initialized.id }, data: { providerExternalId: input.providerExternalId, status: "SUCCEEDED", completedAt: input.confirmedAt, safeErrorCode: null } });
          await tx.subscriptionOrder.update({ where: { id: order.id }, data: { status: "PAID", paidAt: input.confirmedAt } });
          const period = await tx.subscriptionPeriod.create({ data: {
            businessId: order.businessId,
            branchId: order.branchId,
            branchSubscriptionId: order.branchSubscriptionId,
            orderId: order.id,
            planId: order.planId,
            source: "PAID_ORDER",
            planCodeSnapshot: order.planCodeSnapshot,
            planNameFaSnapshot: order.planNameFaSnapshot,
            durationMonths: order.durationMonths,
            startsAt,
            endsAt,
          } });
          if (input.manualReview) {
            await tx.subscriptionManualPaymentSubmission.update({
              where: { id: input.manualReview.submissionId },
              data: { reviewStatus: "APPROVED", reviewedByAdminId: input.manualReview.adminId, reviewedAt: input.confirmedAt, rejectionReason: null },
            });
            await tx.systemAdminAuditEvent.create({ data: {
              adminId: input.manualReview.adminId,
              action: "subscription.manual_payment.approved",
              entityType: "subscription_manual_payment_submission",
              entityId: input.manualReview.submissionId,
              requestId: input.manualReview.requestId,
              metadata: { orderId: order.id, businessId: order.businessId, branchId: order.branchId, amountRial: order.amountRial.toString(), durationMonths: order.durationMonths, reason: input.manualReview.reason },
            } });
          }
          return period;
        }, { isolationLevel: "Serializable" });
      } catch (error) {
        if (isSerializationConflict(error) && retry < 2) continue;
        throw error;
      }
    }
    throw new ConflictException("ثبت پرداخت به‌دلیل هم‌زمانی انجام نشد؛ callback را دوباره ارسال کنید.");
  }

  async acceptProviderWebhook(provider: string) {
    if (paymentGateway().provider === provider) {
      try { await paymentGateway().verifyCallback({ headers: {}, rawBody: Buffer.alloc(0) }); }
      catch { /* no provider adapter accepts an unverified payload */ }
    }
    throw new ServiceUnavailableException({ code: "PAYMENT_PROVIDER_UNCONFIGURED", message: "درگاه پرداخت هنوز پیکربندی نشده است؛ این درخواست به‌عنوان پرداخت موفق ثبت نشد." });
  }

  private async currentForScope(scope: Scope, now: Date) {
    const [business, branch, subscription, rollout] = await Promise.all([
      this.prisma.business.findUnique({ where: { id: scope.businessId }, select: { displayName: true, timezone: true } }),
      this.prisma.branch.findFirst({ where: { id: scope.branchId, businessId: scope.businessId, isActive: true }, select: { name: true, code: true } }),
      this.prisma.branchSubscription.findUnique({
        where: { businessId_branchId: scope },
        include: { periods: { where: { revokedAt: null }, orderBy: [{ endsAt: "desc" }, { id: "desc" }], take: 10, include: { plan: true, order: true } } },
      }),
      this.prisma.subscriptionRolloutSetting.findUnique({ where: { id: "global" } }),
    ]);
    if (!branch) throw new NotFoundException("شعبهٔ جاری پیدا نشد.");
    const activePeriod = subscription?.periods.find((period) => isSubscriptionPeriodActive(period.startsAt, period.endsAt, now));
    const latestPeriod = subscription?.periods[0];
    const graceEndsAt = rollout?.legacyGraceEndsAt ?? null;
    let status = "REQUIRED";
    if (subscription?.suspendedAt) status = "SUSPENDED";
    else if (activePeriod) status = "ACTIVE";
    else if (rollout?.mode !== "ENFORCE") status = "OBSERVE";
    else if (graceEndsAt && graceEndsAt > now) status = "GRACE";
    else if (latestPeriod) status = "EXPIRED";
    const displayPeriod = activePeriod ?? latestPeriod;
    const endsAt = displayPeriod?.endsAt ?? null;
    const remainingDays = activePeriod ? Math.max(0, Math.ceil((activePeriod.endsAt.getTime() - now.getTime()) / 86_400_000)) : 0;
    return {
      business: { name: business?.displayName ?? "", timezone: business?.timezone ?? "Asia/Tehran" },
      branch: { name: branch.name, code: branch.code, branchId: scope.branchId },
      status,
      rolloutMode: rollout?.mode ?? "OBSERVE",
      graceEndsAt: graceEndsAt?.toISOString() ?? null,
      serverTime: now.toISOString(),
      plan: displayPeriod ? {
        code: displayPeriod.planCodeSnapshot ?? displayPeriod.plan?.code ?? null,
        nameFa: displayPeriod.planNameFaSnapshot ?? displayPeriod.plan?.nameFa ?? null,
        durationMonths: displayPeriod.durationMonths,
      } : null,
      period: displayPeriod ? { startsAt: displayPeriod.startsAt.toISOString(), endsAt: displayPeriod.endsAt.toISOString(), endsAtExclusive: true, remainingDays } : null,
      suspendedAt: subscription?.suspendedAt?.toISOString() ?? null,
      suspensionReason: subscription?.suspensionReason ?? null,
    };
  }

  private orderDto(order: {
    id: string; businessId: string; branchId: string; planCodeSnapshot: string; planNameFaSnapshot: string; durationMonths: number;
    amountRial: bigint; currency: string; status: string; providerReference: string | null; createdAt: Date; paidAt: Date | null;
    attempts?: Array<{ id: string; provider: string; providerExternalId: string | null; amountRial: bigint; currency: string; status: string; safeErrorCode: string | null; createdAt: Date; completedAt: Date | null }>;
    manualPaymentSettingsSnapshot?: Prisma.JsonValue | null;
    manualPaymentSubmissions?: Array<{ reviewStatus: string; trackingCode: string | null; fileName: string; rejectionReason: string | null; telegramStatus: string; submittedAt: Date }>;
  }) {
    const paymentSnapshot = order.manualPaymentSettingsSnapshot && typeof order.manualPaymentSettingsSnapshot === "object" && !Array.isArray(order.manualPaymentSettingsSnapshot)
      ? order.manualPaymentSettingsSnapshot as Prisma.JsonObject
      : null;
    const latestSubmission = order.manualPaymentSubmissions?.[0];
    return {
      id: order.id, businessId: order.businessId, branchId: order.branchId,
      plan: { code: order.planCodeSnapshot, nameFa: order.planNameFaSnapshot, durationMonths: order.durationMonths },
      amountRial: order.amountRial.toString(), currency: order.currency, status: order.status,
      receiptReference: order.providerReference, createdAt: order.createdAt.toISOString(), paidAt: order.paidAt?.toISOString() ?? null,
      paymentInstructions: paymentSnapshot ? {
        method: "CARD_TO_CARD",
        cardNumber: typeof paymentSnapshot.cardNumber === "string" ? paymentSnapshot.cardNumber : "",
        cardHolder: typeof paymentSnapshot.cardHolder === "string" ? paymentSnapshot.cardHolder : "",
        bankName: typeof paymentSnapshot.bankName === "string" ? paymentSnapshot.bankName : null,
        instructions: typeof paymentSnapshot.instructions === "string" ? paymentSnapshot.instructions : null,
        telegramContactHandle: typeof paymentSnapshot.telegramContactHandle === "string" ? paymentSnapshot.telegramContactHandle : null,
      } : null,
      manualPayment: latestSubmission ? {
        status: latestSubmission.reviewStatus,
        trackingCode: latestSubmission.trackingCode,
        receiptFileName: latestSubmission.fileName,
        rejectionReason: latestSubmission.rejectionReason,
        telegramStatus: latestSubmission.telegramStatus,
        submittedAt: latestSubmission.submittedAt.toISOString(),
      } : null,
      attempts: (order.attempts ?? []).map((attempt) => ({
        id: attempt.id, provider: attempt.provider, providerExternalId: attempt.providerExternalId,
        amountRial: attempt.amountRial.toString(), currency: attempt.currency, status: attempt.status,
        safeErrorCode: attempt.safeErrorCode, createdAt: attempt.createdAt.toISOString(), completedAt: attempt.completedAt?.toISOString() ?? null,
      })),
    };
  }
}

export function requireScope(user: AuthenticatedUser): Scope {
  if (!user.businessId || !user.branchId) throw new ForbiddenException("ابتدا کسب‌وکار و شعبهٔ جاری را انتخاب کنید.");
  return { businessId: user.businessId, branchId: user.branchId };
}

function asFeatures(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
