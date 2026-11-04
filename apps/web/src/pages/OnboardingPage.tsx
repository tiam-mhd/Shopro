import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, BadgeCheck, Boxes, CreditCard, UsersRound } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusinessSummary, MemberRole } from "@shopro/contracts";
import { get, patch, post } from "../lib/api.js";
import { faNumber } from "../lib/format.js";
import { businessCreationKey, clearBusinessCreationKey, displayAmountToRial } from "../lib/onboarding.js";
import { trackOnboardingEvent, type OnboardingStepName } from "../lib/onboarding-events.js";
import { BrandLogo } from "../components/BrandLogo.js";
import { Field, InlineError, PageHeader, SubmitButton, messageOf } from "../App.js";

type StepStatus = "DONE" | "NEEDS_ACTION" | "SKIPPED" | "OPTIONAL" | "UNAVAILABLE" | "WAITING";
type OnboardingStep = { id: string; title: string; status: StepStatus; optional: boolean; href: string | null };
type Unit = { id: string; labelFa: string; precision: number };
type OnboardingStatus = {
  business: { id: string; name: string; displayCurrency: "IRR" | "IRT"; timezone: string };
  branch: { id: string; name: string; code: string };
  role: MemberRole;
  roleLabel: string;
  nextAction: { title: string; href: string; description: string };
  subscription: { status: string; rolloutMode: string; period: { remainingDays: number } | null };
  financialStartMode: "START_TODAY" | "EXISTING_BUSINESS" | null;
  resultViewedAt: string | null;
  resultViewedByCurrentUser: boolean;
  firstDocument: { id: string; type: string; reference: string | null; date: string; href: string } | null;
  productCount: number;
  steps: OnboardingStep[];
  activationComplete: boolean;
  openingBalancesSupported: false;
};

export function BusinessCreationWizard({ userId, online }: { userId: string; online: boolean }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState<"business" | "branch">("business");
  const [displayName, setDisplayName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [branchName, setBranchName] = useState("شعبه اصلی");
  const [currency, setCurrency] = useState<"IRT" | "IRR">("IRT");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const startedKey = `shopro_onboarding_started_${userId}`;
    if (sessionStorage.getItem(startedKey)) return;
    sessionStorage.setItem(startedKey, "1");
    trackOnboardingEvent("onboarding_started", "welcome");
  }, [userId]);

  const continueToBranch = () => {
    const nextErrors: Record<string, string> = {};
    if (displayName.trim().length < 2) nextErrors.displayName = "نام کسب‌وکار را با دست‌کم دو کاراکتر وارد کنید.";
    if (displayName.trim().length > 160) nextErrors.displayName = "نام کسب‌وکار حداکثر ۱۶۰ کاراکتر است.";
    if (businessType.trim() && businessType.trim().length < 2) nextErrors.businessType = "نوع فعالیت را خالی بگذارید یا دست‌کم دو کاراکتر وارد کنید.";
    if (businessType.trim().length > 80) nextErrors.businessType = "نوع فعالیت حداکثر ۸۰ کاراکتر است.";
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setError("");
    setStep("branch");
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (branchName.trim().length < 2) nextErrors.branchName = "نام شعبه دست‌کم دو کاراکتر باشد.";
    if (branchName.trim().length > 120) nextErrors.branchName = "نام شعبه حداکثر ۱۲۰ کاراکتر است.";
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    if (!online) { setError("برای ساخت و تأیید کسب‌وکار و شعبه، اتصال اینترنت لازم است."); return; }
    setSaving(true);
    setError("");
    try {
      const key = businessCreationKey(userId);
      const result = await post<{ id: string; branch: { id: string } }>("/businesses", {
        displayName: displayName.trim(),
        ...(businessType.trim() ? { businessType: businessType.trim() } : {}),
        initialBranchName: branchName.trim(),
        displayCurrency: currency,
      }, { "Idempotency-Key": key });
      sessionStorage.setItem("shopro_business_id", result.id);
      sessionStorage.setItem("shopro_branch_id", result.branch.id);
      try { localStorage.setItem(`shopro_last_scope_${userId}`, JSON.stringify({ businessId: result.id, branchId: result.branch.id })); } catch { /* onboarding progress still persists on the server */ }
      sessionStorage.setItem("shopro_onboarding_created_business", result.id);
      clearBusinessCreationKey(userId);
      trackOnboardingEvent("business_created", "business");
      trackOnboardingEvent("branch_created", "branch");
      await client.invalidateQueries({ queryKey: ["businesses"] });
      navigate("/app/onboarding", { replace: true });
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setSaving(false);
    }
  };

  return <main className="onboarding-page" dir="rtl"><section className="onboarding-card onboarding-wizard-card">
    <BrandLogo className="onboarding-logo" alt="لوگوی شاپرو" />
    <span className="eyebrow">شروع کار · {step === "business" ? "قدم ۱ از ۲" : "قدم ۲ از ۲"}</span>
    <h1>{step === "business" ? "کسب‌وکارتان را آماده کنید" : "شعبهٔ اول را بسازید"}</h1>
    <p className="muted">{step === "business" ? "فروش، خرید، موجودی و حسابداری کسب‌وکارتان را در شاپرو ثبت کنید. برای شروع فقط نام کسب‌وکار لازم است." : "هر سند مالی به یک شعبه تعلق دارد. نام شعبه بعداً هم قابل مشاهده و انتخاب است."}</p>
    {step === "business" ? <form onSubmit={(event) => { event.preventDefault(); continueToBranch(); }}>
      <Field id="business-name" label="نام کسب‌وکار" value={displayName} onChange={(value) => { setDisplayName(value); setFieldErrors((errors) => ({ ...errors, displayName: "" })); }} error={fieldErrors.displayName} required placeholder="مثلاً فروشگاه من" />
      <Field id="business-type" label="نوع فعالیت (اختیاری)" value={businessType} onChange={(value) => { setBusinessType(value); setFieldErrors((errors) => ({ ...errors, businessType: "" })); }} error={fieldErrors.businessType} placeholder="مثلاً پوشاک یا خدمات" />
      <label className="field"><span className="field-label">واحد نمایش مبلغ</span><select value={currency} onChange={(event) => setCurrency(event.target.value as "IRT" | "IRR")}><option value="IRT">تومان</option><option value="IRR">ریال</option></select></label>
      <button className="button button-primary full" type="submit">ادامه به ساخت شعبه <ArrowLeft size={16} /></button>
    </form> : <form onSubmit={(event) => void create(event)}>
      <Field id="branch-name" label="نام شعبهٔ اول" value={branchName} onChange={(value) => { setBranchName(value); setFieldErrors((errors) => ({ ...errors, branchName: "" })); }} error={fieldErrors.branchName} required />
      <div className="onboarding-summary-row"><span>کسب‌وکار</span><strong>{displayName.trim()}</strong></div>
      <p className="onboarding-help">اطلاعاتی مثل نشانی برای شروع لازم نیست. زبان فارسی، تقویم شمسی و منطقهٔ زمانی تهران به‌صورت پیش‌فرض تنظیم می‌شوند.</p>
      {error && <InlineError error={error} />}
      <div className="onboarding-actions"><button className="button button-secondary" type="button" disabled={saving} onClick={() => { setError(""); setStep("business"); }}>بازگشت</button><SubmitButton busy={saving}>{online ? "ساخت کسب‌وکار و شعبه" : "اتصال اینترنت لازم است"}</SubmitButton></div>
    </form>}
    {!online && <p className="notice notice-warning" role="status">آفلاین هستید. تا وقتی پاسخ سرور نرسد، ساخت انجام‌شده حساب نمی‌شود.</p>}
  </section></main>;
}

export function OnboardingWorkspacePage({ business, branchId, online }: { business: BusinessSummary; branchId: string; online: boolean }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [actionError, setActionError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const branch = business.branches.find((item) => item.id === branchId) ?? business.branches[0];
  const statusQuery = useQuery({ queryKey: ["onboarding", business.id, branch?.id], queryFn: () => get<OnboardingStatus>("/onboarding"), enabled: Boolean(branch?.id) });
  const unitsQuery = useQuery({ queryKey: ["onboarding-product-units", business.id], queryFn: () => get<Unit[]>("/products/units"), enabled: business.role !== "CASHIER" && business.role !== "VIEWER" });

  useEffect(() => {
    const status = statusQuery.data;
    if (!status || status.activationComplete) return;
    const createdBusiness = sessionStorage.getItem("shopro_onboarding_created_business");
    if (createdBusiness === status.business.id) {
      sessionStorage.removeItem("shopro_onboarding_created_business");
      return;
    }
    const key = `shopro_onboarding_resumed_${status.business.id}_${status.branch.id}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    trackOnboardingEvent("onboarding_resumed", "business");
  }, [statusQuery.data]);

  const update = async (body: { action: string; financialStartMode?: string; stepId?: string }) => {
    if (!online) { setActionError("برای ذخیرهٔ این انتخاب، اتصال اینترنت لازم است. اطلاعات فرم حذف نشده است."); return null; }
    setBusyAction(body.stepId ?? body.action);
    setActionError("");
    try {
      const result = await patch<OnboardingStatus>("/onboarding/progress", body);
      await client.invalidateQueries({ queryKey: ["onboarding", business.id] });
      await client.invalidateQueries({ queryKey: ["subscription-current"] });
      return result;
    } catch (cause) {
      setActionError(messageOf(cause));
      return null;
    } finally {
      setBusyAction("");
    }
  };

  const selectFinancialMode = async (financialStartMode: "START_TODAY" | "EXISTING_BUSINESS") => {
    const result = await update({ action: "select_financial_start_mode", financialStartMode });
    if (result) trackOnboardingEvent("financial_start_mode_selected", "financial_start");
  };

  const skipStep = async (stepId: string) => {
    const result = await update({ action: "skip_step", stepId });
    if (result) trackOnboardingEvent("onboarding_step_skipped", eventStep(stepId));
  };

  const openStep = async (step: OnboardingStep) => {
    if (step.status === "SKIPPED") {
      const result = await update({ action: "resume_step", stepId: step.id });
      if (!result) return;
      trackOnboardingEvent("onboarding_resumed", eventStep(step.id));
    }
    if (step.href) navigate(step.href);
  };

  if (!branch) return <PageHeader title="راهنمای شروع" subtitle="شعبهٔ فعالی برای این کاربر انتخاب نشده است."><div className="notice notice-error" role="alert">از مالک کسب‌وکار بخواهید دسترسی شما به یک شعبهٔ فعال را بررسی کند.</div></PageHeader>;
  if (statusQuery.isPending) return <PageHeader title="راهنمای شروع" subtitle={`${business.displayName} · ${branch.name}`}><div className="card page-content-loading" role="status">در حال دریافت وضعیت واقعی شعبه…</div></PageHeader>;
  if (statusQuery.isError) return <PageHeader title="راهنمای شروع" subtitle={`${business.displayName} · ${branch.name}`}><InlineError error={statusQuery.error} retry={() => void statusQuery.refetch()} /></PageHeader>;
  const status = statusQuery.data;
  const steps = new Map(status.steps.map((item) => [item.id, item]));
  const blockedBySubscription = status.subscription.status === "SUSPENDED" || status.subscription.rolloutMode === "ENFORCE" && ["REQUIRED", "EXPIRED"].includes(status.subscription.status);
  const subscriptionStep = steps.get("subscription")!;
  const financialStep = steps.get("financial_start_mode")!;
  const productStep = steps.get("product")!;
  const operationStep = steps.get("first_operation")!;
  const resultStep = steps.get("result_viewed")!;
  const teamStep = steps.get("team")!;
  const openingStep = steps.get("opening_balances")!;
  const finishedCount = status.steps.filter((item) => item.status === "DONE").length;
  const completion = Math.round(finishedCount / status.steps.length * 100);

  return <PageHeader title="راهنمای شروع" subtitle="قدم‌های واقعی این شعبه را از همین صفحه ادامه دهید." actions={<span className="onboarding-branch-pill"><CreditCard size={15} />{status.branch.name}</span>}>
    {!online && <div className="notice notice-warning" role="status">اتصال اینترنت برقرار نیست. وضعیت ثبت‌شده روی سرور نمایش داده می‌شود؛ ذخیرهٔ انتخاب و عملیات مالی تا اتصال دوباره انجام نمی‌شود.</div>}
    {actionError && <InlineError error={actionError} />}
    <section className="card onboarding-progress-card"><div className="onboarding-progress-heading"><div><span className="eyebrow">{status.business.name} · {status.roleLabel}</span><strong>{status.activationComplete ? "اولین نتیجه را دیدید" : "راه‌اندازی شعبه"}</strong></div><span>{faNumber(finishedCount)} از {faNumber(status.steps.length)} مرحلهٔ تکمیل‌شده</span></div><div className="onboarding-progress-track" role="progressbar" aria-label="پیشرفت راه‌اندازی" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion}><i style={{ width: `${completion}%` }} /></div><p>{status.nextAction.description}</p></section>

    <section className={`card onboarding-step-card ${subscriptionStep.status === "NEEDS_ACTION" ? "needs-action" : ""}`}>
      <StepHeading number="۱" title="اشتراک همین شعبه" status={subscriptionStep.status} />
      <p>اشتراک برای هر شعبه جداگانه است. وضعیت فعلی سرور: <strong>{subscriptionLabel(status.subscription.status)}</strong>. نام شعبهٔ انتخاب‌شده: <strong>{status.branch.name}</strong>.</p>
      {blockedBySubscription ? <><div className="notice notice-warning">پیش از ثبت فروش، خرید، هزینه یا عملیات مالی، وضعیت اشتراک باید از سمت سرور مجاز باشد. پرداخت دستی تا تأیید سرور فعال نمی‌شود.</div>{status.role === "OWNER" ? <Link className="button button-primary" to="/app/subscription">مشاهدهٔ مدت، مبلغ کل، معادل ماهانه و وضعیت پرداخت</Link> : <p className="muted">مالک کسب‌وکار باید اشتراک این شعبه را پیگیری کند.</p>}</>
        : status.subscription.status === "OBSERVE" ? <p className="muted">طبق وضعیت فعلی سرور، اشتراک در حالت پایش است و عملیات این شعبه را مسدود نمی‌کند.</p>
          : <Link className="button button-secondary" to="/app/subscription">مشاهدهٔ وضعیت و تاریخچهٔ اشتراک</Link>}
    </section>

    <section className="card onboarding-step-card">
      <StepHeading number="۲" title="روش شروع مالی" status={financialStep.status} />
      <p>این انتخاب به شاپرو می‌گوید کارتان از امروز شروع شده یا ادامهٔ یک کسب‌وکار فعال است. اطلاعات آغازین درست به دقیق‌تر شدن گزارش‌های بعدی کمک می‌کند.</p>
      {status.financialStartMode && <div className="notice notice-success" role="status">انتخاب ثبت‌شده: {status.financialStartMode === "START_TODAY" ? "از امروز شروع می‌کنم" : "کسب‌وکارم از قبل فعال بوده"}</div>}
      {status.role === "OWNER" || status.role === "ACCOUNTANT" ? <div className="onboarding-choice-grid">
        <button type="button" className={`onboarding-choice ${status.financialStartMode === "START_TODAY" ? "selected" : ""}`} disabled={!online || Boolean(busyAction)} aria-pressed={status.financialStartMode === "START_TODAY"} onClick={() => void selectFinancialMode("START_TODAY")}><strong>از امروز شروع می‌کنم</strong><span>عملیات تازه را از امروز در این شعبه ثبت کنید.</span></button>
        <button type="button" className={`onboarding-choice ${status.financialStartMode === "EXISTING_BUSINESS" ? "selected" : ""}`} disabled={!online || Boolean(busyAction)} aria-pressed={status.financialStartMode === "EXISTING_BUSINESS"} onClick={() => void selectFinancialMode("EXISTING_BUSINESS")}><strong>کسب‌وکارم از قبل فعال بوده</strong><span>برای دقیق‌تر شدن موجودی و گزارش‌های مالی، اطلاعات آغازین را بررسی کنید.</span></button>
      </div> : <p className="notice notice-warning">مالک یا حسابدار می‌تواند روش شروع مالی این شعبه را انتخاب کند.</p>}
      {status.financialStartMode === "EXISTING_BUSINESS" && <OpeningBalanceNotice step={openingStep} onSkip={() => void skipStep("opening_balances")} onResume={async () => { const result = await update({ action: "resume_step", stepId: "opening_balances" }); if (result) trackOnboardingEvent("onboarding_resumed", "opening_balances"); }} busy={Boolean(busyAction)} />}
      {financialStep.status === "SKIPPED" && <StepAction step={financialStep} busy={Boolean(busyAction)} onClick={() => void openStep(financialStep)} />}
      {financialStep.status !== "DONE" && financialStep.status !== "SKIPPED" && <button className="button button-text" type="button" disabled={!online || Boolean(busyAction)} onClick={() => void skipStep("financial_start_mode")}>فعلاً رد می‌کنم و بعداً ادامه می‌دهم</button>}
    </section>

    <section className="card onboarding-step-card">
      <StepHeading number="۳" title="کالا یا خدمت" status={productStep.status} />
      <p>نام و قیمت فروش را وارد کنید. بهای خرید با قیمت فروش فرق دارد و برای محاسبهٔ سود و ارزش موجودی استفاده می‌شود.</p>
      {status.productCount > 0 && <p className="notice notice-success" role="status">{faNumber(status.productCount)} کالا یا خدمت واقعی در این کسب‌وکار ثبت شده است.</p>}
      {status.role === "OWNER" || status.role === "MANAGER" || status.role === "ACCOUNTANT" ? status.productCount === 0 && productStep.status !== "SKIPPED" ? <QuickProductForm currency={status.business.displayCurrency} units={unitsQuery.data ?? []} online={online} unitsError={unitsQuery.isError ? messageOf(unitsQuery.error) : ""} onCreated={async () => { await client.invalidateQueries({ queryKey: ["onboarding", business.id] }); }} /> : null : <p className="muted">ساخت کالا برای نقش شما مجاز نیست؛ فروش را از کالاهای آمادهٔ شعبه انجام دهید.</p>}
      {productStep.status === "SKIPPED" ? <StepAction step={productStep} busy={Boolean(busyAction)} onClick={() => void openStep(productStep)} /> : productStep.status !== "DONE" && (status.role === "OWNER" || status.role === "MANAGER" || status.role === "ACCOUNTANT") && <button className="button button-text" type="button" disabled={!online || Boolean(busyAction)} onClick={() => void skipStep("product")}>بدون افزودن کالا ادامه می‌دهم</button>}
      {status.productCount > 0 && <Link className="button button-secondary" to="/app/inventory"><Boxes size={16} />ثبت موجودی واقعی در شمارش انبار</Link>}
    </section>

    <section className="card onboarding-step-card">
      <StepHeading number="۴" title="اولین عملیات واقعی" status={operationStep.status} />
      {status.firstDocument ? <><p className="notice notice-success" role="status">{status.firstDocument.type}{status.firstDocument.reference ? ` · ${status.firstDocument.reference}` : ""} در شعبهٔ «{status.branch.name}» ثبت شده است.</p><Link className="button button-secondary" to={status.firstDocument.href}>مشاهدهٔ سند ثبت‌شده</Link></> : <>
        <p>سند آزمایشی ساخته نمی‌شود. با ثبت فروش، خرید، هزینه یا عملیات مجاز دیگر، اطلاعات واقعی همین شعبه در گزارش‌ها ثبت خواهد شد.</p>
        <div className="onboarding-action-list">
          <Link className="button button-primary" to={blockedBySubscription ? "/app/subscription" : status.nextAction.href}>{blockedBySubscription ? "پیگیری اشتراک شعبه" : status.nextAction.title}</Link>
          {status.role === "ACCOUNTANT" && <><Link className="button button-secondary" to="/app/ledger">بررسی دفتر مالی</Link><Link className="button button-secondary" to="/app/reports">گزارش‌های شعبه</Link></>}
          {!["CASHIER", "VIEWER"].includes(status.role) && <><Link className="button button-secondary" to={blockedBySubscription ? "/app/subscription" : "/app/purchases"}>ثبت خرید</Link><Link className="button button-secondary" to={blockedBySubscription ? "/app/subscription" : "/app/expenses"}>ثبت هزینه</Link></>}
        </div>
        {operationStep.status === "SKIPPED" ? <StepAction step={operationStep} busy={Boolean(busyAction)} onClick={() => void openStep(operationStep)} /> : status.role !== "VIEWER" && <button className="button button-text" type="button" disabled={!online || Boolean(busyAction)} onClick={() => void skipStep("first_operation")}>این مرحله را بعداً انجام می‌دهم</button>}
      </>}
    </section>

    <section className="card onboarding-step-card">
      <StepHeading number="۵" title="مشاهدهٔ نتیجه" status={resultStep.status} />
      {status.firstDocument ? <><p>ثبت شد. این عملیات در گزارش‌های شعبهٔ «{status.branch.name}» ذخیره شده است. اعداد داشبورد فقط از اسناد ثبت‌شده می‌آیند؛ اگر دادهٔ کافی برای سود نباشد، شاپرو آن را در دسترس نیست نشان می‌دهد.</p><Link className="button button-primary" to="/app">مشاهدهٔ داشبورد شعبه</Link>{status.resultViewedByCurrentUser && <p className="notice notice-success" role="status">نتیجهٔ این شعبه را پس از ثبت عملیات دیده‌اید.</p>}</> : <p className="muted">بعد از ثبت اولین عملیات، داشبورد نتیجهٔ همان شعبه را نشان می‌دهد.</p>}
    </section>

    <section className="card onboarding-step-card">
      <StepHeading number="۶" title="اعضای تیم و اطلاعات تکمیلی" status={teamStep.status} />
      {status.role === "OWNER" ? <><p>{teamStep.status === "DONE" ? "اعضای فعال تیم در کسب‌وکار ثبت شده‌اند." : "دعوت عضو اختیاری است و دسترسی او بر اساس نقش و شعبه از API کنترل می‌شود."}</p><Link className="button button-secondary" to="/app/settings"><UsersRound size={16} />مدیریت اعضا</Link>{teamStep.status !== "DONE" && teamStep.status !== "SKIPPED" && <button className="button button-text" type="button" disabled={!online || Boolean(busyAction)} onClick={() => void skipStep("team")}>دعوت را برای بعد بگذار</button>}{teamStep.status === "SKIPPED" && <StepAction step={teamStep} busy={Boolean(busyAction)} onClick={() => void openStep(teamStep)} />}</> : <p className="muted">اعضا و دسترسی‌های شعبه را مالک کسب‌وکار مدیریت می‌کند. نقش فعلی شما: {status.roleLabel}.</p>}
    </section>

  </PageHeader>;
}

function QuickProductForm({ currency, units, online, unitsError, onCreated }: { currency: "IRR" | "IRT"; units: Unit[]; online: boolean; unitsError: string; onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"STOCK" | "SERVICE">("STOCK");
  const [unitId, setUnitId] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [cost, setCost] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!unitId && units[0]) setUnitId(units[0].id); }, [unitId, units]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const nextErrors: Record<string, string> = {};
    if (!name.trim()) nextErrors.name = "نام کالا یا خدمت را وارد کنید.";
    if (name.trim().length > 160) nextErrors.name = "نام کالا یا خدمت حداکثر ۱۶۰ کاراکتر است.";
    if (!unitId) nextErrors.unit = "واحد را انتخاب کنید.";
    if (!salePrice.trim()) nextErrors.salePrice = "قیمت فروش را وارد کنید.";
    let salePriceRial: string | undefined;
    let defaultCostRial: string | undefined;
    if (salePrice.trim()) {
      try {
        salePriceRial = displayAmountToRial(salePrice, currency);
        if (salePriceRial.length > 20) nextErrors.salePrice = "قیمت فروش از حد مجاز بیشتر است.";
      } catch (cause) { nextErrors.salePrice = messageOf(cause); }
    }
    if (cost.trim()) {
      try {
        defaultCostRial = displayAmountToRial(cost, currency);
        if (defaultCostRial.length > 20) nextErrors.cost = "بهای خرید از حد مجاز بیشتر است.";
      } catch (cause) { nextErrors.cost = messageOf(cause); }
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    if (!online) { setError("برای ثبت کالا باید به اینترنت وصل باشید. فرم فعلی پاک نشده است."); return; }
    setSaving(true);
    try {
      await post("/products", { name: name.trim(), kind, unitId, salePriceRial: salePriceRial!, ...(defaultCostRial ? { defaultCostRial } : {}) });
      trackOnboardingEvent("product_created", "product");
      setName(""); setSalePrice(""); setCost("");
      await onCreated();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setSaving(false); }
  };
  return <form className="onboarding-product-form" onSubmit={(event) => void submit(event)}>
    <Field id="onboarding-product-name" label="نام کالا یا خدمت" value={name} onChange={(value) => { setName(value); setFieldErrors((errors) => ({ ...errors, name: "" })); }} error={fieldErrors.name} required placeholder="مثلاً دفتر یا تعمیر" />
    <div className="form-grid"><label className="field"><span className="field-label">نوع</span><select value={kind} onChange={(event) => setKind(event.target.value as "STOCK" | "SERVICE")}><option value="STOCK">کالای انبارشونده</option><option value="SERVICE">خدمت</option></select></label><label className="field" htmlFor="onboarding-product-unit"><span className="field-label">واحد <i>*</i></span><select id="onboarding-product-unit" value={unitId} onChange={(event) => { setUnitId(event.target.value); setFieldErrors((errors) => ({ ...errors, unit: "" })); }} required aria-invalid={fieldErrors.unit ? true : undefined} aria-describedby={fieldErrors.unit ? "onboarding-product-unit-error" : undefined}><option value="">انتخاب واحد</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.labelFa}</option>)}</select>{fieldErrors.unit && <span className="field-error" id="onboarding-product-unit-error" role="alert">{fieldErrors.unit}</span>}</label></div>
    <div className="form-grid"><Field id="onboarding-sale-price" label={`قیمت فروش (${currency === "IRT" ? "تومان" : "ریال"})`} value={salePrice} onChange={(value) => { setSalePrice(value); setFieldErrors((errors) => ({ ...errors, salePrice: "" })); }} error={fieldErrors.salePrice} required inputMode="decimal" /><Field id="onboarding-default-cost" label={`بهای خرید پیش‌فرض، اختیاری (${currency === "IRT" ? "تومان" : "ریال"})`} value={cost} onChange={(value) => { setCost(value); setFieldErrors((errors) => ({ ...errors, cost: "" })); }} error={fieldErrors.cost} inputMode="decimal" /></div>
    <p className="onboarding-help">قیمت فروش درآمد را می‌سازد. بهای خرید پیش‌فرض برای ارزش‌گذاری موجودی و محاسبهٔ بهای تمام‌شده به‌کار می‌رود. تعداد اولیه را جداگانه با شمارش انبار ثبت کنید.</p>
    {unitsError && <InlineError error={unitsError} />}{error && <p className="field-error" role="alert">{error}</p>}
    <SubmitButton busy={saving}>{saving ? "در حال ثبت در سرور…" : "افزودن کالا یا خدمت"}</SubmitButton>
  </form>;
}

function OpeningBalanceNotice({ step, onSkip, onResume, busy }: { step: OnboardingStep; onSkip: () => void; onResume: () => void; busy: boolean }) {
  return <div className="onboarding-limitation">
    <strong>ورود یکپارچهٔ مانده‌های آغازین هنوز در شاپرو موجود نیست.</strong>
    <p>موجودی کالا را می‌توانید با شمارش انبار ثبت کنید؛ ورود یک‌جای صندوق، بانک، طلب‌ها و بدهی‌ها در نسخهٔ فعلی پشتیبانی نمی‌شود. برای اینکه سند نامتوازن یا گزارش گمراه‌کننده نسازیم، این مرحله تکمیل‌شده نشان داده نمی‌شود.</p>
    <Link className="button button-secondary" to="/app/inventory"><Boxes size={16} />شمارش موجودی کالا</Link>
    {step.status === "SKIPPED" ? <button className="button button-text" type="button" disabled={busy} onClick={onResume}>بازبینی این مرحله</button> : <button className="button button-text" type="button" disabled={busy} onClick={onSkip}>این مرحله را برای بعد علامت بزن</button>}
  </div>;
}

function StepHeading({ number, title, status }: { number: string; title: string; status: StepStatus }) {
  return <div className="onboarding-step-heading"><span className={`onboarding-step-number ${status === "DONE" ? "done" : ""}`}>{status === "DONE" ? <BadgeCheck size={18} /> : number}</span><div><h2>{title}</h2><span className={`onboarding-status onboarding-status-${status.toLowerCase()}`}>{stepStatusLabel(status)}</span></div></div>;
}

function StepAction({ step, busy, onClick }: { step: OnboardingStep; busy: boolean; onClick: () => void }) {
  return <button className="button button-secondary" type="button" disabled={busy} onClick={onClick}>ادامهٔ «{step.title}»</button>;
}

function eventStep(stepId: string): OnboardingStepName {
  if (stepId === "financial_start_mode") return "financial_start";
  if (stepId === "first_operation") return "first_operation";
  return stepId as OnboardingStepName;
}

function subscriptionLabel(status: string) {
  return ({ ACTIVE: "فعال", REQUIRED: "نیازمند اشتراک", EXPIRED: "پایان‌یافته", SUSPENDED: "متوقف‌شده", GRACE: "مهلت ادامه", OBSERVE: "در حال پایش" } as Record<string, string>)[status] ?? status;
}

function stepStatusLabel(status: StepStatus) {
  return ({ DONE: "انجام‌شده", NEEDS_ACTION: "نیازمند اقدام", SKIPPED: "ردشده برای بعد", OPTIONAL: "اختیاری", UNAVAILABLE: "فعلاً پشتیبانی نمی‌شود", WAITING: "پس از عملیات اول" } as const)[status];
}
