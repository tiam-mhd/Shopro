import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { MemberRole } from "@shopro/contracts";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthenticatedUser } from "../common/request-context.js";
import { SubscriptionsService } from "../subscriptions/subscriptions.service.js";
import type { OnboardingStepId, TrackOnboardingEventDto, UpdateOnboardingProgressDto } from "./onboarding.dto.js";

const canManageProducts = (role: MemberRole) => ["OWNER", "MANAGER", "ACCOUNTANT"].includes(role);
const canPostOperations = (role: MemberRole) => ["OWNER", "MANAGER", "ACCOUNTANT", "CASHIER"].includes(role);
const allowedSkips = new Set<OnboardingStepId>(["financial_start_mode", "product", "first_operation", "team", "opening_balances"]);

type DocumentCandidate = { id: string; createdAt: Date; txnDate: Date; reference: string | null; type: string; href: string };

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService, private readonly subscriptions: SubscriptionsService) {}

  async get(user: AuthenticatedUser) {
    const { businessId, branchId } = this.scope(user);
    const membership = await this.prisma.businessMember.findFirst({
      where: { businessId, userId: user.id, status: "ACTIVE", branches: { some: { branchId } } },
      select: { role: true },
    });
    if (!membership) throw new ForbiddenException("به این کسب‌وکار و شعبه دسترسی ندارید.");
    const role = membership.role;
    const [business, branch, progress, resultView, productCount, memberCount, sale, purchase, expense, cashTransaction, stockCount, subscription] = await Promise.all([
      this.prisma.business.findUnique({ where: { id: businessId }, select: { id: true, displayName: true, displayCurrency: true, timezone: true } }),
      this.prisma.branch.findFirst({ where: { id: branchId, businessId, isActive: true }, select: { id: true, name: true, code: true } }),
      this.prisma.onboardingProgress.findUnique({ where: { businessId_branchId: { businessId, branchId } } }),
      this.prisma.onboardingResultView.findUnique({ where: { businessId_branchId_userId: { businessId, branchId, userId: user.id } }, select: { viewedAt: true } }),
      this.prisma.product.count({ where: { businessId, isActive: true } }),
      this.prisma.businessMember.count({ where: { businessId, status: "ACTIVE" } }),
      this.prisma.salesInvoice.findFirst({ where: { businessId, branchId, status: "POSTED", postedBy: user.id, returnOfId: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, invoiceNo: true, createdAt: true, txnDate: true } }),
      ["OWNER", "MANAGER", "ACCOUNTANT"].includes(role)
        ? this.prisma.purchase.findFirst({ where: { businessId, branchId, status: "POSTED", postedBy: user.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, purchaseNo: true, createdAt: true, txnDate: true } })
        : Promise.resolve(null),
      ["OWNER", "MANAGER", "ACCOUNTANT"].includes(role)
        ? this.prisma.expense.findFirst({ where: { businessId, branchId, status: "POSTED", createdBy: user.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, expenseNo: true, createdAt: true, txnDate: true } })
        : Promise.resolve(null),
      ["OWNER", "MANAGER", "ACCOUNTANT"].includes(role)
        ? this.prisma.cashTransaction.findFirst({ where: { businessId, branchId, createdBy: user.id, status: "POSTED", kind: { in: ["RECEIPT", "PAYMENT", "TRANSFER"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, reference: true, createdAt: true, txnDate: true, kind: true } })
        : Promise.resolve(null),
      ["OWNER", "MANAGER", "ACCOUNTANT"].includes(role)
        ? this.prisma.stockCount.findFirst({ where: { businessId, branchId, createdBy: user.id, status: "POSTED" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, createdAt: true, txnDate: true } })
        : Promise.resolve(null),
      this.subscriptions.current(user),
    ]);
    if (!business) throw new NotFoundException("کسب‌وکار پیدا نشد.");
    if (!branch) throw new NotFoundException("شعبهٔ جاری پیدا نشد.");

    const candidates: DocumentCandidate[] = [];
    if (sale) candidates.push({ ...sale, reference: sale.invoiceNo, type: "فروش", href: `/app/invoices/${sale.id}` });
    if (purchase) candidates.push({ ...purchase, reference: purchase.purchaseNo, type: "خرید", href: `/app/purchases/${purchase.id}` });
    if (expense) candidates.push({ ...expense, reference: expense.expenseNo, type: "هزینه", href: `/app/expenses/${expense.id}` });
    if (cashTransaction) candidates.push({ ...cashTransaction, reference: cashTransaction.reference, type: cashTransaction.kind === "RECEIPT" ? "دریافت" : cashTransaction.kind === "PAYMENT" ? "پرداخت" : "انتقال", href: "/app/finance" });
    if (stockCount) candidates.push({ ...stockCount, reference: null, type: "شمارش موجودی", href: `/app/inventory/counts/${stockCount.id}` });
    candidates.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    const firstDocument = candidates[0] ? {
      id: candidates[0].id,
      type: candidates[0].type,
      reference: candidates[0].reference,
      date: candidates[0].txnDate.toISOString().slice(0, 10),
      href: candidates[0].href,
    } : null;
    const skipped = new Set(progress?.skippedSteps ?? []);
    const status = (complete: boolean, step: OnboardingStepId, available = true): string => complete ? "DONE" : skipped.has(step) ? "SKIPPED" : available ? "NEEDS_ACTION" : "UNAVAILABLE";
    const subscriptionEnforced = subscription.rolloutMode === "ENFORCE";
    const subscriptionNeedsAction = subscription.status === "SUSPENDED" || subscriptionEnforced && ["REQUIRED", "EXPIRED"].includes(subscription.status);
    const firstOperationDone = firstDocument !== null;
    const canChooseFinancialStart = ["OWNER", "ACCOUNTANT"].includes(role);
    const nextAction = roleAction(role);
    const steps = [
      { id: "business_created", title: "کسب‌وکار ساخته شد", status: "DONE", optional: false, href: null },
      { id: "branch_ready", title: "شعبه آماده شد", status: "DONE", optional: false, href: null },
      { id: "subscription", title: "وضعیت اشتراک شعبه", status: subscription.status === "ACTIVE" || subscription.status === "GRACE" ? "DONE" : subscriptionNeedsAction ? "NEEDS_ACTION" : "OPTIONAL", optional: !subscriptionNeedsAction, href: "/app/subscription" },
      { id: "financial_start_mode", title: "روش شروع مالی انتخاب شد", status: progress?.financialStartMode ? "DONE" : status(false, "financial_start_mode", canChooseFinancialStart), optional: true, href: null },
      { id: "product", title: "کالا یا خدمت اضافه شد", status: productCount > 0 ? "DONE" : status(false, "product", canManageProducts(role)), optional: true, href: canManageProducts(role) ? "/app/products" : null },
      { id: "first_operation", title: "اولین عملیات واقعی ثبت شد", status: firstOperationDone ? "DONE" : status(false, "first_operation", canPostOperations(role)), optional: true, href: nextAction.href },
      { id: "result_viewed", title: "نتیجهٔ ثبت دیده شد", status: resultView ? "DONE" : firstOperationDone ? "NEEDS_ACTION" : "WAITING", optional: true, href: "/app" },
      { id: "team", title: "اعضای تیم دعوت شدند", status: memberCount > 1 ? "DONE" : status(false, "team", role === "OWNER"), optional: true, href: role === "OWNER" ? "/app/settings" : null },
      { id: "opening_balances", title: "اطلاعات آغازین مالی کامل شد", status: skipped.has("opening_balances") ? "SKIPPED" : "UNAVAILABLE", optional: true, href: "/app/inventory" },
    ];
    return {
      business: { id: business.id, name: business.displayName, displayCurrency: business.displayCurrency, timezone: business.timezone },
      branch,
      role,
      roleLabel: roleLabel(role),
      nextAction,
      subscription,
      financialStartMode: progress?.financialStartMode ?? null,
      resultViewedAt: resultView?.viewedAt.toISOString() ?? null,
      firstDocument,
      productCount,
      steps,
      activationComplete: Boolean(firstDocument && resultView),
      resultViewedByCurrentUser: Boolean(resultView),
      openingBalancesSupported: false,
    };
  }

  async updateProgress(user: AuthenticatedUser, dto: UpdateOnboardingProgressDto) {
    const { businessId, branchId } = this.scope(user);
    const current = await this.get(user);
    const existing = await this.prisma.onboardingProgress.findUnique({ where: { businessId_branchId: { businessId, branchId } } });
    const skipped = new Set(existing?.skippedSteps ?? []);
    const update: { financialStartMode?: string; skippedSteps?: string[] } = {};

    if (dto.action === "select_financial_start_mode") {
      if (!dto.financialStartMode) throw new BadRequestException("روش شروع مالی را انتخاب کنید.");
      if (!user.role || !["OWNER", "ACCOUNTANT"].includes(user.role)) throw new ForbiddenException("انتخاب روش شروع مالی برای نقش شما مجاز نیست.");
      update.financialStartMode = dto.financialStartMode;
      skipped.delete("financial_start_mode");
    } else if (dto.action === "skip_step") {
      const stepId = this.requireStep(dto.stepId);
      if (!allowedSkips.has(stepId)) throw new BadRequestException("این مرحله را نمی‌توان رد کرد.");
      const completed = current.steps.find((step) => step.id === stepId)?.status === "DONE";
      if (!completed) skipped.add(stepId);
    } else if (dto.action === "resume_step") {
      const stepId = this.requireStep(dto.stepId);
      if (!allowedSkips.has(stepId)) throw new BadRequestException("ادامهٔ این مرحله معتبر نیست.");
      skipped.delete(stepId);
    } else {
      if (!current.firstDocument) throw new BadRequestException("هنوز عملیات ثبت‌شده‌ای برای نمایش نتیجه وجود ندارد.");
    }

    update.skippedSteps = [...skipped];
    await this.prisma.$transaction(async (tx) => {
      await tx.onboardingProgress.upsert({
        where: { businessId_branchId: { businessId, branchId } },
        create: { businessId, branchId, financialStartMode: update.financialStartMode ?? existing?.financialStartMode ?? null, skippedSteps: update.skippedSteps },
        update,
      });
      if (dto.action === "mark_result_viewed") {
        await tx.onboardingResultView.upsert({
          where: { businessId_branchId_userId: { businessId, branchId, userId: user.id } },
          create: { userId: user.id, businessId, branchId },
          update: {},
        });
      }
    });
    return this.get(user);
  }

  async trackEvent(user: AuthenticatedUser, dto: TrackOnboardingEventDto) {
    if (["first_document_posted", "dashboard_viewed_after_first_document"].includes(dto.eventName)) {
      if (!(await this.hasUserFirstDocument(user))) throw new BadRequestException("برای ثبت این رویداد، ابتدا یک عملیات واقعی را در شعبه ثبت کنید.");
      const existing = await this.prisma.onboardingEvent.findFirst({ where: { userId: user.id, businessId: user.businessId ?? null, branchId: user.branchId ?? null, eventName: dto.eventName }, select: { id: true } });
      if (existing) return { accepted: true };
    }
    await this.prisma.onboardingEvent.create({
      data: {
        userId: user.id,
        businessId: user.businessId ?? null,
        branchId: user.branchId ?? null,
        eventName: dto.eventName,
        stepName: dto.stepName ?? null,
        role: user.role ?? null,
        deviceType: dto.deviceType,
      },
    });
    return { accepted: true };
  }

  private scope(user: AuthenticatedUser) {
    if (!user.businessId || !user.branchId) throw new ForbiddenException("ابتدا یک کسب‌وکار و شعبهٔ مجاز را انتخاب کنید.");
    return { businessId: user.businessId, branchId: user.branchId };
  }

  private async hasUserFirstDocument(user: AuthenticatedUser) {
    const { businessId, branchId } = this.scope(user);
    const checks: Array<Promise<unknown>> = [
      this.prisma.salesInvoice.findFirst({ where: { businessId, branchId, postedBy: user.id, status: "POSTED", returnOfId: null }, select: { id: true } }),
    ];
    if (["OWNER", "MANAGER", "ACCOUNTANT"].includes(user.role ?? "")) {
      checks.push(
        this.prisma.purchase.findFirst({ where: { businessId, branchId, postedBy: user.id, status: "POSTED" }, select: { id: true } }),
        this.prisma.expense.findFirst({ where: { businessId, branchId, createdBy: user.id, status: "POSTED" }, select: { id: true } }),
        this.prisma.cashTransaction.findFirst({ where: { businessId, branchId, createdBy: user.id, status: "POSTED", kind: { in: ["RECEIPT", "PAYMENT", "TRANSFER"] } }, select: { id: true } }),
        this.prisma.stockCount.findFirst({ where: { businessId, branchId, createdBy: user.id, status: "POSTED" }, select: { id: true } }),
      );
    }
    const rows = await Promise.all(checks);
    return rows.some(Boolean);
  }

  private requireStep(value: OnboardingStepId | undefined): OnboardingStepId {
    if (!value) throw new BadRequestException("مرحلهٔ راه‌اندازی مشخص نیست.");
    return value;
  }
}

function roleAction(role: MemberRole) {
  if (role === "CASHIER") return { title: "ثبت اولین فروش", href: "/app/sales", description: "فروش‌های ثبت‌شدهٔ این شعبه در فاکتورها و گزارش‌ها دیده می‌شوند." };
  if (role === "ACCOUNTANT") return { title: "ثبت اولین عملیات مالی", href: "/app/sales", description: "فروش، خرید یا هزینهٔ مجاز را ثبت کنید؛ سپس دفتر مالی و گزارش‌های شعبه را بررسی کنید." };
  if (role === "VIEWER") return { title: "مشاهدهٔ فاکتورهای شعبه", href: "/app/invoices", description: "دسترسی شما فقط مشاهده است؛ ثبت یا تغییر سند برای این نقش فعال نیست." };
  return { title: "ثبت اولین فروش", href: "/app/sales", description: "بعد از ثبت، نتیجهٔ واقعی را در فاکتور و داشبورد می‌بینید." };
}

function roleLabel(role: MemberRole) {
  return ({ OWNER: "مالک", MANAGER: "مدیر", ACCOUNTANT: "حسابدار", CASHIER: "صندوقدار", VIEWER: "مشاهده‌گر" } as const)[role];
}
