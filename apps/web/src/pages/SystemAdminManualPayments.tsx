import { useEffect, useState, type FormEvent } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CursorPage } from "@shopro/contracts";
import { adminApi, downloadFile, get } from "../lib/api.js";
import { faNumber, jalaliDate, money } from "../lib/format.js";
import { InlineError, LoadingBlock } from "../App.js";
import { Modal } from "../components/Modal.js";

type PaymentRow = {
  id: string; orderId: string; businessName: string; branchName: string; planNameFa: string; durationMonths: number;
  amountRial: string; currency: string; orderStatus: string; reviewStatus: string; trackingCode: string | null;
  fileName: string; mimeType: string; bytes: string; telegramStatus: string; telegramErrorCode: string | null;
  rejectionReason: string | null; submittedAt: string; reviewedAt: string | null;
};

type PaymentSettings = {
  enabled: boolean; cardNumber: string; cardHolder: string; bankName: string | null; instructions: string | null;
  telegramContactHandle: string; telegramTargetChatId: string | null; telegramTokenConfigured: boolean;
  telegramDeliveryReady: boolean; updatedAt: string;
};

type ReviewAction = { row: PaymentRow; kind: "approve" | "reject" } | null;

export function ManualPaymentsAdminTab({ csrf }: { csrf?: string }) {
  const client = useQueryClient();
  const [status, setStatus] = useState("PENDING_REVIEW");
  const [action, setAction] = useState<ReviewAction>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rows = useInfiniteQuery({
    queryKey: ["system-admin", "manual-payments", status],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => get<CursorPage<PaymentRow>>(`/system-admin/subscriptions/manual-payments?status=${status}&limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["system-admin", "manual-payments"] }),
      client.invalidateQueries({ queryKey: ["system-admin", "subscription-orders"] }),
    ]);
  };
  const submitReview = async (event: FormEvent) => {
    event.preventDefault();
    if (!action) return;
    setBusy(true); setError("");
    try {
      await adminApi(`/system-admin/subscriptions/manual-payments/${action.row.id}/${action.kind}`, {
        method: "POST",
        ...(action.kind === "reject" ? { body: JSON.stringify({ reason }) } : {}),
      }, csrf);
      setAction(null); setReason(""); await refresh();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const downloadReceipt = async (row: PaymentRow) => {
    setBusy(true); setError("");
    try {
      const blob = await downloadFile(`/system-admin/subscriptions/manual-payments/${row.id}/receipt`);
      const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = row.fileName; link.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const retryTelegram = async (row: PaymentRow) => {
    setBusy(true); setError("");
    try { await adminApi(`/system-admin/subscriptions/manual-payments/${row.id}/telegram/retry`, { method: "POST" }, csrf); await refresh(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const allRows = rows.data?.pages.flatMap((page) => page.items) ?? [];

  return <section className="admin-panel">
    <div className="admin-panel-heading"><div><h2>بررسی رسیدهای کارت‌به‌کارت</h2><p>رسید تنها پس از تأیید مدیر به پرداخت و اشتراک فعال تبدیل می‌شود.</p></div></div>
    <div className="admin-filter-row"><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="فیلتر رسیدها"><option value="PENDING_REVIEW">در انتظار بررسی</option><option value="APPROVED">تأییدشده</option><option value="REJECTED">ردشده</option></select></div>
    {rows.isError ? <InlineError error={rows.error} retry={() => void rows.refetch()} /> : rows.isPending ? <LoadingBlock /> : <div className="admin-manual-payment-list">
      {allRows.map((row) => <article className="admin-manual-payment-row" key={row.id}>
        <div className="admin-manual-payment-main"><strong>{row.businessName} · {row.branchName}</strong><span>{row.planNameFa} · {durationLabel(row.durationMonths)} · {money(row.amountRial, "IRT")}</span><small>{jalaliDate(row.submittedAt)}{row.trackingCode ? ` · کد پیگیری ${row.trackingCode}` : " · کد پیگیری وارد نشده"}</small>{row.rejectionReason && <small className="danger-text">دلیل رد: {row.rejectionReason}</small>}</div>
        <span className={`admin-status-tag ${row.reviewStatus.toLowerCase()}`}>{reviewStatus(row.reviewStatus)}</span>
        <span className={`admin-status-tag ${row.telegramStatus.toLowerCase()}`}>تلگرام: {telegramStatus(row.telegramStatus)}</span>
        {row.telegramErrorCode && <small className="admin-safe-error">{row.telegramErrorCode}</small>}
        <div className="admin-row-actions">
          <button className="button button-secondary" type="button" disabled={busy} onClick={() => void downloadReceipt(row)}>دریافت رسید</button>
          {row.telegramStatus !== "SENT" && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void retryTelegram(row)}>ارسال دوباره به تلگرام</button>}
          {row.reviewStatus === "PENDING_REVIEW" && <><button className="button button-primary" type="button" disabled={busy} onClick={() => { setAction({ row, kind: "approve" }); setError(""); }}>تأیید پرداخت</button><button className="button button-text danger-text" type="button" disabled={busy} onClick={() => { setAction({ row, kind: "reject" }); setReason(""); setError(""); }}>رد رسید</button></>}
        </div>
      </article>)}
      {!allRows.length && <p className="admin-empty">رسیدی با این وضعیت ثبت نشده است.</p>}
      {rows.hasNextPage && <button className="button button-secondary full" type="button" disabled={rows.isFetchingNextPage} onClick={() => void rows.fetchNextPage()}>{rows.isFetchingNextPage ? "در حال دریافت…" : "رسیدهای بیشتر"}</button>}
    </div>}
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    <Modal open={Boolean(action)} onClose={() => { setAction(null); setError(""); }} title={action?.kind === "approve" ? "تأیید پرداخت" : "رد رسید"} description={action ? `${action.row.businessName} · ${action.row.branchName} · ${money(action.row.amountRial, "IRT")}` : undefined}>
      {action && <form className="admin-modal-form" onSubmit={(event) => void submitReview(event)}>
        <p>{action.kind === "approve" ? "با تأیید، پرداخت ثبت و اشتراک همین سفارش فعال می‌شود." : "با رد رسید، سفارش برای ارسال رسید اصلاح‌شده باز می‌ماند."}</p>
        {action.kind === "reject" && <label className="field"><span className="field-label">دلیل رد رسید</span><textarea minLength={3} maxLength={500} required rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>}
        {error && <p className="notice notice-error">{error}</p>}
        <button className={`button ${action.kind === "approve" ? "button-primary" : "button-danger"} full`} disabled={busy}>{busy ? "در حال ثبت…" : action.kind === "approve" ? "تأیید و فعال‌سازی اشتراک" : "رد رسید"}</button>
      </form>}
    </Modal>
  </section>;
}

export function PaymentSettingsAdminTab({ csrf }: { csrf?: string }) {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ["system-admin", "manual-payment-settings"], queryFn: () => get<PaymentSettings>("/system-admin/subscriptions/payment-settings") });
  const [enabled, setEnabled] = useState(true); const [cardNumber, setCardNumber] = useState(""); const [cardHolder, setCardHolder] = useState("");
  const [bankName, setBankName] = useState(""); const [instructions, setInstructions] = useState(""); const [telegramContactHandle, setTelegramContactHandle] = useState("@tiaammhd");
  const [telegramTargetChatId, setTelegramTargetChatId] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  useEffect(() => { if (!settings.data) return; setEnabled(settings.data.enabled); setCardNumber(settings.data.cardNumber); setCardHolder(settings.data.cardHolder); setBankName(settings.data.bankName ?? ""); setInstructions(settings.data.instructions ?? ""); setTelegramContactHandle(settings.data.telegramContactHandle); setTelegramTargetChatId(settings.data.telegramTargetChatId ?? ""); }, [settings.data]);
  const unsaved = Boolean(settings.data && (enabled !== settings.data.enabled || cardNumber !== settings.data.cardNumber || cardHolder !== settings.data.cardHolder || bankName !== (settings.data.bankName ?? "") || instructions !== (settings.data.instructions ?? "") || telegramContactHandle !== settings.data.telegramContactHandle || telegramTargetChatId !== (settings.data.telegramTargetChatId ?? "")));
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await adminApi("/system-admin/subscriptions/payment-settings", { method: "PATCH", body: JSON.stringify({ enabled, cardNumber, cardHolder, bankName: bankName || null, instructions: instructions || null, telegramContactHandle, telegramTargetChatId }) }, csrf);
      setNotice("تنظیمات کارت‌به‌کارت ذخیره شد."); await client.invalidateQueries({ queryKey: ["system-admin", "manual-payment-settings"] });
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const testTelegram = async () => {
    setBusy(true); setError(""); setNotice("");
    try { const result = await adminApi<{ sent: boolean; errorCode: string | null }>("/system-admin/subscriptions/payment-settings/telegram/test", { method: "POST" }, csrf); setNotice(result.sent ? "پیام آزمایشی تلگرام ارسال شد." : `ارسال انجام نشد: ${result.errorCode ?? "تنظیمات ناقص است"}`); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  if (settings.isError) return <section className="admin-panel"><InlineError error={settings.error} retry={() => void settings.refetch()} /></section>;
  if (settings.isPending) return <section className="admin-panel"><LoadingBlock /></section>;
  return <section className="admin-panel">
    <div className="admin-panel-heading"><div><h2>تنظیم دریافت اشتراک</h2><p>اطلاعات این بخش هنگام ساخت سفارش برای همان سفارش ذخیره می‌شود.</p></div><span className={`admin-status-tag ${settings.data.enabled ? "active" : "inactive"}`}>{settings.data.enabled ? "فعال" : "غیرفعال"}</span></div>
    <form className="admin-payment-settings-form" onSubmit={(event) => void save(event)}>
      <label className="admin-setting-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span><strong>فعال‌بودن پرداخت کارت‌به‌کارت</strong><small>با غیرفعال‌کردن، سفارش جدید قابل پرداخت نخواهد بود.</small></span></label>
      <div className="admin-payment-settings-grid">
        <label className="field"><span className="field-label">شماره کارت</span><input inputMode="numeric" autoComplete="off" dir="ltr" value={cardNumber} onChange={(event) => setCardNumber(event.target.value)} required pattern="[0-9۰-۹٠-٩ -]{16,32}" maxLength={32} /></label>
        <label className="field"><span className="field-label">نام صاحب کارت</span><input value={cardHolder} onChange={(event) => setCardHolder(event.target.value)} required maxLength={120} /></label>
        <label className="field"><span className="field-label">نام بانک (اختیاری)</span><input value={bankName} onChange={(event) => setBankName(event.target.value)} maxLength={80} /></label>
        <label className="field"><span className="field-label">آیدی پشتیبانی تلگرام</span><input dir="ltr" value={telegramContactHandle} onChange={(event) => setTelegramContactHandle(event.target.value)} required pattern="@[A-Za-z0-9_]{5,32}" /></label>
        <label className="field"><span className="field-label">شناسه مقصد ربات تلگرام</span><input dir="ltr" value={telegramTargetChatId} onChange={(event) => setTelegramTargetChatId(event.target.value)} placeholder="مثلاً 123456789 یا @channelname" pattern="(-?[0-9]{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})?" /><small>برای پیام خصوصی، مقصد باید chat ID عددی باشد؛ حساب شخصی با @username قابل ارسال مستقیم نیست.</small></label>
      </div>
      <label className="field"><span className="field-label">راهنمای پرداخت برای کاربر</span><textarea rows={3} maxLength={1000} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="مثلاً پس از کارت‌به‌کارت، تصویر رسید را در همین صفحه بارگذاری کنید." /></label>
      <div className="notice notice-warning">توکن ربات در پنل نمایش داده نمی‌شود و باید به‌صورت Secret در Runflare با نام <code>TELEGRAM_BOT_TOKEN</code> تنظیم شود. برای مقصد شخصی، صاحب حساب باید ابتدا ربات را Start کند و chat ID عددی‌اش در اینجا وارد شود.</div>
      <div className="admin-telegram-state"><span>توکن ربات: {settings.data.telegramTokenConfigured ? "تنظیم شده" : "تنظیم نشده"}</span><span>ارسال رسید: {settings.data.telegramDeliveryReady ? "آماده" : "نیازمند تکمیل تنظیمات"}</span></div>
      {error && <p className="notice notice-error" role="alert">{error}</p>}{notice && <p className="notice notice-success">{notice}</p>}
      <div className="admin-row-actions"><button className="button button-primary" disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیرهٔ تنظیمات"}</button><button className="button button-secondary" type="button" disabled={busy || unsaved || !settings.data.telegramDeliveryReady} onClick={() => void testTelegram()}>{busy ? "در حال ارسال…" : "ارسال پیام آزمایشی تلگرام"}</button></div>
    </form>
  </section>;
}

function reviewStatus(status: string) { return ({ PENDING_REVIEW: "در انتظار بررسی", APPROVED: "تأییدشده", REJECTED: "ردشده" } as Record<string, string>)[status] ?? status; }
function telegramStatus(status: string) { return ({ SENT: "ارسال‌شده", FAILED: "ناموفق", NOT_CONFIGURED: "تنظیم نشده", PENDING: "در صف" } as Record<string, string>)[status] ?? status; }
function durationLabel(months: number) { return ({ 1: "یک‌ماهه", 3: "سه‌ماهه", 6: "شش‌ماهه", 12: "یک‌ساله" } as Record<number, string>)[months] ?? `${faNumber(months)} ماه`; }
function errorText(error: unknown) { return error instanceof Error ? error.message : "درخواست انجام نشد؛ دوباره تلاش کنید."; }
