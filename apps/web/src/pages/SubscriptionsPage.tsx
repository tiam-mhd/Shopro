import { useState, type FormEvent } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CalendarClock, CreditCard, History, ShieldAlert } from "lucide-react";
import type { CursorPage } from "@shopro/contracts";
import { get, post, newOperationId } from "../lib/api.js";
import { faNumber, jalaliDate, money } from "../lib/format.js";
import { InlineError, LoadingBlock, PageHeader, SubmitButton, messageOf } from "../App.js";
import { Modal } from "../components/Modal.js";

type MoneyCurrency = "IRR" | "IRT";
type Plan = { code: string; nameFa: string; badge: string | null; features: string[]; durations: Array<{ priceVersionId: string; durationMonths: number; priceRial: string; monthlyEquivalentRial: string; savingRial: string; savingBasisPoints: number }> };
type Current = { branch: { name: string; code: string; branchId: string }; status: string; rolloutMode: string; graceEndsAt: string | null; serverTime: string; plan: { code: string | null; nameFa: string | null; durationMonths: number | null } | null; period: { startsAt: string; endsAt: string; endsAtExclusive: boolean; remainingDays: number } | null; suspendedAt: string | null; suspensionReason: string | null };
type Order = { id: string; plan: { code: string; nameFa: string; durationMonths: number }; amountRial: string; currency: string; status: string; receiptReference: string | null; createdAt: string; paidAt: string | null; attempts: Array<{ provider: string; status: string; safeErrorCode: string | null }> };
type CreatedOrder = Order & { paymentMode: "fake" | "unavailable"; message: string };

const durationNames: Record<number, string> = { 1: "یک‌ماهه", 3: "سه‌ماهه", 6: "شش‌ماهه", 12: "یک‌ساله" };

export function SubscriptionsPage({ currency, role }: { currency: MoneyCurrency; role: string }) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<{ planCode: string; durationMonths: number; priceRial: string } | null>(null);
  const [created, setCreated] = useState<CreatedOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const plans = useQuery({ queryKey: ["subscription-plans"], queryFn: () => get<Plan[]>("/subscriptions/plans") });
  const current = useQuery({ queryKey: ["subscription-current"], queryFn: () => get<Current>("/subscriptions/current") });
  const history = useInfiniteQuery({ queryKey: ["subscription-orders"], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => get<CursorPage<Order>>(`/subscriptions/orders?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`), getNextPageParam: (page) => page.nextCursor ?? undefined });
  const options = plans.data?.flatMap((plan) => plan.durations.map((duration) => ({ plan, duration }))) ?? [];
  const selectedPlan = options.find(({ plan, duration }) => plan.code === selected?.planCode && duration.durationMonths === selected.durationMonths);

  const createOrder = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPlan) return;
    setBusy(true); setError("");
    try {
      const result = await post<CreatedOrder>("/subscriptions/orders", { planCode: selectedPlan.plan.code, durationMonths: selectedPlan.duration.durationMonths }, { "Idempotency-Key": newOperationId() });
      setCreated(result); setSelected(null);
      await Promise.all([client.invalidateQueries({ queryKey: ["subscription-orders"] }), client.invalidateQueries({ queryKey: ["subscription-current"] })]);
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };

  const confirmFake = async () => {
    if (!created || created.paymentMode !== "fake") return;
    setBusy(true); setError("");
    try {
      const settled = await post<Order>(`/subscriptions/orders/${created.id}/dev-confirm`, {});
      setCreated({ ...settled, paymentMode: "fake", message: "پرداخت آزمایشی ثبت شد؛ این وضعیت فقط در محیط توسعه معتبر است." });
      await Promise.all([client.invalidateQueries({ queryKey: ["subscription-orders"] }), client.invalidateQueries({ queryKey: ["subscription-current"] })]);
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };

  return <PageHeader title="اشتراک شعبه" subtitle="وضعیت و تمدید اشتراک شعبهٔ انتخاب‌شده" actions={<span className="subscription-scope"><CreditCard size={16} />{current.data?.branch.name ?? "شعبهٔ جاری"}</span>}>
    <div className="subscription-page">
      {current.isPending ? <section className="card"><LoadingBlock /></section> : current.isError ? <InlineError error={current.error} retry={() => void current.refetch()} /> : <SubscriptionStatus current={current.data} />}

      <section className="subscription-section card">
        <div className="subscription-heading"><div><span className="eyebrow">اشتراک شعبه</span><h2>مدت دلخواه را انتخاب کنید</h2><p>همهٔ مدت‌ها امکانات یکسان دارند. هیچ گزینه‌ای از پیش انتخاب نشده است.</p></div></div>
        {plans.isError ? <InlineError error={plans.error} retry={() => void plans.refetch()} /> : plans.isPending ? <LoadingBlock /> : !options.length ? <div className="notice notice-warning">در حال حاضر قیمت معتبری برای خرید تعریف نشده است.</div> : <div className="subscription-plan-grid">
          {options.map(({ plan, duration }) => <button type="button" key={`${plan.code}-${duration.durationMonths}`} className={`subscription-plan-card ${selected?.planCode === plan.code && selected.durationMonths === duration.durationMonths ? "selected" : ""}`} aria-pressed={selected?.planCode === plan.code && selected.durationMonths === duration.durationMonths} onClick={() => { setSelected({ planCode: plan.code, durationMonths: duration.durationMonths, priceRial: duration.priceRial }); setError(""); }}>
            <span className="subscription-plan-top"><span>{durationNames[duration.durationMonths] ?? `${faNumber(duration.durationMonths)} ماهه`}</span>{duration.savingBasisPoints > 0 && <small>{faNumber(Math.floor(duration.savingBasisPoints / 100))}٪ صرفه‌جویی</small>}</span>
            <strong className="subscription-plan-price">{money(duration.priceRial, currency)}</strong>
            <span className="subscription-plan-monthly">ماهانه {money(duration.monthlyEquivalentRial, currency)}</span>
            {duration.savingBasisPoints > 0 && <span className="subscription-plan-savings">صرفه‌جویی {money(duration.savingRial, currency)}</span>}
            <span className="subscription-plan-select">{selected?.planCode === plan.code && selected.durationMonths === duration.durationMonths ? "انتخاب شد" : "انتخاب این مدت"}</span>
          </button>)}
        </div>}
        {role !== "OWNER" && <div className="notice notice-warning subscription-owner-note">خرید و تمدید را مالک کسب‌وکار انجام می‌دهد.</div>}
        <div className="subscription-features"><strong>امکانات اشتراک</strong>{(plans.data?.[0]?.features ?? []).map((feature) => <span key={feature}><BadgeCheck size={16} />{feature}</span>)}</div>
      </section>

      <section className="subscription-section card">
        <div className="subscription-heading"><div><span className="eyebrow">تاریخچه</span><h2>سفارش‌های اشتراک</h2><p>مبالغ و رسیدهای این شعبه</p></div><History size={20} /></div>
        {history.isError ? <InlineError error={history.error} retry={() => void history.refetch()} /> : history.isPending ? <LoadingBlock /> : <>
          <div className="subscription-order-list">{history.data.pages.flatMap((page) => page.items).map((order) => <article className="subscription-order-row" key={order.id}>
            <div><strong>{order.plan.nameFa} · {durationNames[order.plan.durationMonths] ?? `${faNumber(order.plan.durationMonths)} ماه`}</strong><small>{jalaliDate(order.createdAt)}{order.paidAt ? ` · پرداخت ${jalaliDate(order.paidAt)}` : ""}</small></div>
            <strong>{money(order.amountRial, currency)}</strong>
            <span className={`subscription-order-status ${order.status.toLowerCase()}`}>{orderStatus(order.status)}</span>
            {order.receiptReference && <small className="subscription-receipt">رسید: <bdi dir="ltr">{order.receiptReference}</bdi></small>}
          </article>)}{!history.data.pages.some((page) => page.items.length) && <p className="subscription-empty">هنوز سفارشی برای این شعبه ثبت نشده است.</p>}</div>
          {history.hasNextPage && <button className="button button-secondary full" type="button" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>{history.isFetchingNextPage ? "در حال دریافت…" : "سفارش‌های قدیمی‌تر"}</button>}
        </>}
      </section>
    </div>

    <Modal open={Boolean(selectedPlan)} onClose={() => setSelected(null)} title="تأیید سفارش اشتراک" description="پیش از ادامه، شعبه و مبلغ را بررسی کنید.">
      {selectedPlan && <form className="subscription-confirm-form" onSubmit={(event) => void createOrder(event)}>
        <div><span>شعبه</span><strong>{current.data?.branch.name ?? "—"}</strong></div>
        <div><span>مدت</span><strong>{durationNames[selectedPlan.duration.durationMonths]}</strong></div>
        <div><span>مبلغ نهایی</span><strong>{money(selectedPlan.duration.priceRial, currency)}</strong></div>
        <p className="muted">مبلغ از قیمت فعال سمت سرور خوانده می‌شود و سفارش با همین قیمت ثبت خواهد شد.</p>
        {error && <InlineError error={error} />}
        <SubmitButton busy={busy}>ادامه به پرداخت</SubmitButton>
      </form>}
    </Modal>
    <Modal open={Boolean(created)} onClose={() => setCreated(null)} title="وضعیت سفارش" description="نتیجه‌ای که سرور برای این سفارش ثبت کرده است.">
      {created && <div className="subscription-result"><span className={`subscription-result-icon ${created.status === "PAID" ? "success" : "pending"}`}>{created.status === "PAID" ? <BadgeCheck /> : <CalendarClock />}</span><strong>{created.status === "PAID" ? "اشتراک فعال شد" : created.paymentMode === "unavailable" ? "درگاه پرداخت آماده نیست" : "سفارش در انتظار پرداخت"}</strong><p>{created.message}</p><div><span>مبلغ</span><b>{money(created.amountRial, currency)}</b></div><div><span>شعبه</span><b>{current.data?.branch.name ?? "—"}</b></div>{error && <InlineError error={error} />}{created.paymentMode === "fake" && created.status === "PENDING" && <button className="button button-primary full" type="button" disabled={busy} onClick={() => void confirmFake()}>{busy ? "در حال ثبت…" : "تأیید پرداخت آزمایشی"}</button>}{created.paymentMode === "unavailable" && <p className="notice notice-warning"><ShieldAlert size={16} />تا زمان اتصال درگاه واقعی، هیچ پرداختی ثبت یا تأیید نمی‌شود.</p>}</div>}
    </Modal>
  </PageHeader>;
}

function SubscriptionStatus({ current }: { current: Current }) {
  const statusLabel: Record<string, string> = { ACTIVE: "فعال", EXPIRED: "پایان‌یافته", REQUIRED: "نیازمند اشتراک", SUSPENDED: "متوقف", GRACE: "مهلت فعال‌سازی", OBSERVE: "در حال پایش" };
  const state = current.status;
  return <section className={`subscription-status-card card ${state.toLowerCase()}`} aria-live="polite">
    <div className="subscription-status-icon">{state === "ACTIVE" ? <BadgeCheck /> : state === "OBSERVE" || state === "GRACE" ? <CalendarClock /> : <ShieldAlert />}</div>
    <div className="subscription-status-copy"><span className="eyebrow">وضعیت شعبه</span><strong>{statusLabel[state] ?? state}</strong><span>{current.plan?.nameFa ?? "بدون اشتراک ثبت‌شده"}{current.plan?.durationMonths ? ` · ${durationNames[current.plan.durationMonths]}` : ""}</span></div>
    {current.period && <div className="subscription-status-period"><span>{state === "ACTIVE" ? "پایان اشتراک" : "آخرین پایان"}</span><strong>{jalaliDate(current.period.endsAt)}</strong><small>{state === "ACTIVE" ? `${faNumber(current.period.remainingDays)} روز باقی‌مانده` : "تمدید کنید تا عملیات این شعبه ادامه یابد."}</small></div>}
    {state === "SUSPENDED" && current.suspensionReason && <p className="notice notice-warning subscription-status-note">{current.suspensionReason}</p>}
    {state === "EXPIRED" && <p className="notice notice-warning subscription-status-note">خواندن و دریافت گزارش مجاز است؛ تغییر داده‌های شعبه تا تمدید اشتراک متوقف می‌شود.</p>}
    {state === "OBSERVE" && <p className="subscription-status-note muted">در مرحلهٔ پایش، خرید اشتراک هنوز برای عملیات شعبه اجباری نشده است.</p>}
    {state === "GRACE" && current.graceEndsAt && <p className="subscription-status-note muted">مهلت شعبه تا {jalaliDate(current.graceEndsAt)} ادامه دارد.</p>}
  </section>;
}

function orderStatus(status: string) {
  return ({ PENDING: "در انتظار پرداخت", PAID: "پرداخت‌شده", FAILED: "ناموفق", CANCELLED: "لغوشده", REFUNDED: "مستردشده" } as Record<string, string>)[status] ?? status;
}
