import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, BadgeCheck, LogOut, Pencil, RefreshCw, Save, ShieldCheck, ShoppingBag, UserRound } from "lucide-react";
import { ApiError, storefrontCustomerGet, storefrontCustomerPatch, storefrontCustomerPost } from "../lib/api.js";
import { clearStorefrontCustomerSession, readStorefrontCustomerSession, saveStorefrontCustomerSession, STOREFRONT_CUSTOMER_SESSION_KEY } from "../lib/storefront-customer-session.js";
import { OtpCodeInput, OTP_CODE_LENGTH } from "../components/OtpCodeInput.js";
import { money } from "../lib/format.js";
import { formatOtpCountdown, otpResendLabel, otpTimingFromError, useOtpCountdown } from "../lib/otp-countdown.js";
import { StorefrontPublicFrame } from "./StorefrontPublicFrame.js";
import "../storefront.css";

type Customer = { fullName: string | null; phone: string; address: string | null };
type CustomerOrder = {
  id: string;
  publicCode: string;
  storeName: string;
  storeSlug: string;
  status: string;
  paymentStatus: string;
  createdAt: string;
  deliveryMethod: "PICKUP" | "LOCAL_DELIVERY";
  totalRial: string;
  items: Array<{ title: string; quantity: string }>;
  latestPaymentAttemptStatus: string | null;
  trackingPath: string;
};
type CustomerOrdersPage = { items: CustomerOrder[]; nextCursor: string | null; hasMore: boolean };

const orderLabels: Record<string, string> = {
  SUBMITTED: "در انتظار پاسخ فروشگاه", ACCEPTED: "پذیرفته‌شده", REJECTED: "پذیرفته‌نشده", PREPARING: "در حال آماده‌سازی",
  READY: "آمادهٔ تحویل", OUT_FOR_DELIVERY: "در مسیر ارسال", READY_FOR_PICKUP: "آمادهٔ دریافت حضوری", COMPLETED: "تحویل‌شده",
  CANCELLED: "لغوشده", EXPIRED: "مهلت پرداخت پایان‌یافته", RETURNED: "مرجوع‌شده",
};
const paymentLabels: Record<string, string> = {
  NOT_DUE: "در انتظار پاسخ فروشگاه", UNPAID: "پرداخت‌نشده", UNDER_REVIEW: "رسید در حال بررسی",
  PARTIALLY_VERIFIED: "پرداخت بخشی تأیید شد", OVERPAID_REVIEW: "نیازمند بررسی مبلغ", VERIFIED: "پرداخت تأیید شد",
  REFUND_PENDING: "بازپرداخت در حال پیگیری", REFUNDED: "بازپرداخت‌شده",
};
const attemptLabels: Record<string, string> = {
  UNDER_REVIEW: "رسید در حال بررسی", VERIFIED: "رسید تأیید شد", PARTIALLY_VERIFIED: "بخشی از رسید تأیید شد",
  REJECTED: "رسید رد شد", OVERPAID_REVIEW: "رسید نیازمند بررسی است",
};

export function StorefrontCustomerAccountPage() {
  const { slug } = useParams();
  return <CustomerAccount key={slug} slug={slug ?? ""} />;
}

function CustomerAccount({ slug }: { slug: string }) {
  const basePath = `/public/stores/${encodeURIComponent(slug)}/customer`;
  const [customerToken, setCustomerToken] = useState(readStorefrontCustomerSession);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [profileDraft, setProfileDraft] = useState({ fullName: "", address: "" });
  const [editingProfile, setEditingProfile] = useState(false);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(Boolean(customerToken));
  const [working, setWorking] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const codeExpiry = useOtpCountdown();
  const resendCooldown = useOtpCountdown();
  const applyTiming = (timing: { expiresAt: string; resendAt: string }) => {
    codeExpiry.startAt(timing.expiresAt);
    resendCooldown.startAt(timing.resendAt);
  };

  useEffect(() => {
    const syncSession = (event: StorageEvent) => {
      if (event.key !== STOREFRONT_CUSTOMER_SESSION_KEY) return;
      setCustomerToken(event.newValue ?? ""); setCustomer(null); setOrders([]); setEditingProfile(false);
    };
    window.addEventListener("storage", syncSession);
    return () => window.removeEventListener("storage", syncSession);
  }, []);

  useEffect(() => {
    if (!customerToken) {
      setCustomer(null); setOrders([]); setNextCursor(null); setHasMore(false); setLoading(false);
      return;
    }
    let active = true;
    setLoading(true); setError("");
    void Promise.all([
      storefrontCustomerGet<{ customer: Customer }>(basePath, customerToken),
      storefrontCustomerGet<CustomerOrdersPage>(`${basePath}/orders?limit=20`, customerToken),
    ]).then(([account, page]) => {
      if (!active) return;
      setCustomer(account.customer);
      setProfileDraft({ fullName: account.customer.fullName ?? "", address: account.customer.address ?? "" });
      setOrders(page.items); setNextCursor(page.nextCursor); setHasMore(page.hasMore);
    }).catch((cause) => {
      if (!active) return;
      if (cause instanceof ApiError && cause.status === 401) {
        clearStorefrontCustomerSession(); setCustomerToken(""); setError("نشست شما پایان یافته است. دوباره با شمارهٔ موبایل وارد شوید.");
      } else setError(messageOf(cause));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [basePath, customerToken, refreshKey]);

  const requestOtp = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setSuccess(""); setWorking(true);
    try {
      const timing = await storefrontCustomerPost<{ expiresAt: string; resendAt: string }>(`${basePath}/otp/request`, { phone });
      applyTiming(timing); setCode(""); setOtpSent(true); setSuccess("اگر شماره معتبر باشد، کد ورود برای آن ارسال می‌شود.");
    } catch (cause) {
      const timing = otpTimingFromError(cause);
      if (timing) { applyTiming(timing); setOtpSent(true); if (cause instanceof ApiError && cause.status !== 429) setCode(""); }
      setError(messageOf(cause));
    } finally { setWorking(false); }
  };

  const verifyOtp = async (event: FormEvent) => {
    event.preventDefault(); if (code.length !== OTP_CODE_LENGTH || codeExpiry.remaining === 0) return;
    setError(""); setSuccess(""); setWorking(true);
    try {
      const result = await storefrontCustomerPost<{ customerToken: string; phone: string; customer: Customer }>(`${basePath}/otp/verify`, { phone, code });
      const persisted = saveStorefrontCustomerSession(result.customerToken);
      setCustomerToken(result.customerToken); setCustomer(result.customer);
      setProfileDraft({ fullName: result.customer.fullName ?? "", address: result.customer.address ?? "" });
      setPhone(result.phone); setCode(""); setOtpSent(false); codeExpiry.reset(); resendCooldown.reset();
      setSuccess(persisted ? "وارد حساب یکپارچهٔ شاپرو شدید." : "ورود انجام شد؛ ذخیرهٔ نشست در این مرورگر ممکن نبود.");
    } catch (cause) { setError(messageOf(cause)); }
    finally { setWorking(false); }
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault(); if (!customerToken) return;
    setProfileBusy(true); setError(""); setSuccess("");
    try {
      const result = await storefrontCustomerPatch<{ customer: Customer }>(`${basePath}/profile`, profileDraft, customerToken);
      setCustomer(result.customer); setProfileDraft({ fullName: result.customer.fullName ?? "", address: result.customer.address ?? "" });
      setEditingProfile(false); setSuccess("اطلاعات حساب در همهٔ فروشگاه‌های شاپرو به‌روز شد.");
    } catch (cause) { setError(messageOf(cause)); }
    finally { setProfileBusy(false); }
  };

  const loadMore = async () => {
    if (!customerToken || !nextCursor || working) return;
    setWorking(true); setError("");
    try {
      const params = new URLSearchParams({ limit: "20", cursor: nextCursor });
      const page = await storefrontCustomerGet<CustomerOrdersPage>(`${basePath}/orders?${params}`, customerToken);
      setOrders((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setNextCursor(page.nextCursor); setHasMore(page.hasMore);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        clearStorefrontCustomerSession(); setCustomerToken(""); setCustomer(null); setOrders([]);
        setError("نشست شما پایان یافته است. دوباره با شمارهٔ موبایل وارد شوید.");
      } else setError(messageOf(cause));
    } finally { setWorking(false); }
  };

  const logout = async () => {
    if (!customerToken) return;
    setWorking(true); setError(""); setSuccess("");
    try {
      await storefrontCustomerPost(`${basePath}/logout`, undefined, customerToken);
      clearStorefrontCustomerSession(); setCustomerToken(""); setPhone(""); setOtpSent(false); setEditingProfile(false);
      setSuccess("از حساب شاپرو خارج شدید.");
    } catch (cause) { setError(messageOf(cause)); }
    finally { setWorking(false); }
  };

  return <StorefrontPublicFrame storeSlug={slug} accountPage>
    <main className="sf-customer-account">
      <header className="sf-customer-hero sf-customer-hero-global">
        <span className="sf-customer-hero-icon"><UserRound size={22} /></span>
        <div><span className="sf-eyebrow">حساب یکپارچهٔ مشتری شاپرو</span><h1>حساب من</h1><p>نشست، اطلاعات و سفارش‌های شما در فروشگاه‌های شاپرو.</p></div>
        <span className="sf-customer-global-badge"><ShieldCheck size={15} />یک ورود برای همهٔ فروشگاه‌ها</span>
      </header>
      {error && <div className="sf-alert sf-alert-error" role="alert">{error}</div>}
      {success && <div className="sf-alert sf-alert-success" role="status">{success}</div>}

      {!customerToken ? <section className="sf-customer-login-panel">
        <aside className="sf-customer-login-aside"><span className="sf-customer-login-art"><ShieldCheck size={25} /></span><small>حساب امن شاپرو</small><h2>یک‌بار وارد شوید، در همهٔ فروشگاه‌ها خرید کنید.</h2><p>با تأیید شمارهٔ موبایل، نشانی ذخیره‌شده و سفارش‌هایتان در دسترس شما می‌ماند.</p><ul><li><BadgeCheck size={15} />سوابق سفارش در یک حساب</li><li><BadgeCheck size={15} />تکمیل سریع‌تر اطلاعات خرید</li><li><BadgeCheck size={15} />نشست امن و قابل خروج</li></ul></aside>
        <section className="sf-card sf-customer-login">
          <div className="sf-customer-login-heading"><span className="sf-customer-step">۱</span><div><h2>ورود با شمارهٔ موبایل</h2><p>کد یک‌بارمصرف برای تأیید مالکیت شماره ارسال می‌شود.</p></div></div>
          <form className="sf-customer-login-form" onSubmit={(event) => void requestOtp(event)}>
            <label>شمارهٔ موبایل<input required dir="ltr" inputMode="tel" autoComplete="tel" minLength={8} maxLength={16} value={phone} onChange={(event) => { setPhone(event.target.value); setOtpSent(false); setCode(""); codeExpiry.reset(); resendCooldown.reset(); }} placeholder="۰۹۱۲۱۲۳۴۵۶۷" /></label>
            <button className="sf-button sf-primary" disabled={working || (otpSent && resendCooldown.remaining !== null && resendCooldown.remaining > 0)}>{working ? "در حال ارسال…" : otpSent ? otpResendLabel("ارسال دوبارهٔ کد", resendCooldown.remaining) : "دریافت کد ورود"}</button>
          </form>
          {otpSent && <form className="sf-customer-verify" onSubmit={(event) => void verifyOtp(event)}>
            <div className="sf-customer-login-heading"><span className="sf-customer-step">۲</span><div><h2>کد تأیید را وارد کنید</h2><p>کد ارسال‌شده به شمارهٔ {phone} را وارد کنید.</p></div></div>
            <label>کد یک‌بارمصرف<OtpCodeInput id="store-customer-otp" label="کد یک‌بارمصرف" value={code} onChange={setCode} length={OTP_CODE_LENGTH} autoFocus disabled={working || codeExpiry.remaining === 0} /></label>
            {codeExpiry.remaining !== null && <p className="sf-otp-expiry" role={codeExpiry.remaining === 0 ? "status" : undefined} aria-live={codeExpiry.remaining === 0 ? "polite" : "off"}>{codeExpiry.remaining === 0 ? "مهلت استفاده از این کد تمام شده است." : <>اعتبار کد: <bdi dir="ltr">{formatOtpCountdown(codeExpiry.remaining)}</bdi></>}</p>}
            <button className="sf-button sf-primary" disabled={working || code.length !== OTP_CODE_LENGTH || codeExpiry.remaining === 0}>{working ? "در حال بررسی…" : "تأیید و ورود"}</button>
          </form>}
          <p className="sf-customer-privacy"><BadgeCheck size={16} />کد فقط برای تأیید شماره و دسترسی به حساب و سفارش‌های شما استفاده می‌شود.</p>
        </section>
      </section> : loading ? <section className="sf-card sf-state" role="status">در حال دریافت پروفایل و سفارش‌ها…</section> : <>
        <section className="sf-card sf-customer-profile-panel">
          <div className="sf-customer-profile-header"><span className="sf-customer-avatar">{(customer?.fullName ?? "م").slice(0, 1)}</span><div className="sf-customer-profile-copy"><span className="sf-eyebrow">پروفایل مشتری</span><h2>{customer?.fullName || "نام خود را ثبت کنید"}</h2><p dir="ltr">{customer?.phone ?? phone}</p></div><div className="sf-customer-profile-actions"><Link to={`/s/${encodeURIComponent(slug)}`} className="sf-button sf-secondary"><ShoppingBag size={16} />ادامهٔ خرید</Link><button type="button" className="sf-button sf-secondary" onClick={() => setEditingProfile((current) => !current)}><Pencil size={15} />{editingProfile ? "بستن ویرایش" : "ویرایش اطلاعات"}</button><button type="button" className="sf-button sf-quiet" disabled={working} onClick={() => void logout()}><LogOut size={16} />خروج</button></div></div>
          {editingProfile ? <form className="sf-customer-profile-form" onSubmit={(event) => void saveProfile(event)}><label>نام و نام خانوادگی<input required minLength={2} maxLength={120} autoComplete="name" value={profileDraft.fullName} onChange={(event) => setProfileDraft((current) => ({ ...current, fullName: event.target.value }))} /></label><label className="sf-customer-address-field">نشانی پیش‌فرض<textarea maxLength={500} autoComplete="street-address" rows={3} value={profileDraft.address} onChange={(event) => setProfileDraft((current) => ({ ...current, address: event.target.value }))} placeholder="برای تکمیل سریع سفارش‌های ارسال محلی" /></label><div className="sf-customer-profile-form-actions"><button className="sf-button sf-primary" disabled={profileBusy}><Save size={15} />{profileBusy ? "در حال ذخیره…" : "ذخیرهٔ اطلاعات"}</button><button type="button" className="sf-button sf-quiet" onClick={() => { setProfileDraft({ fullName: customer?.fullName ?? "", address: customer?.address ?? "" }); setEditingProfile(false); }}>انصراف</button></div></form> : <div className="sf-customer-profile-facts"><div><small>نام و نام خانوادگی</small><strong>{customer?.fullName || "ثبت نشده"}</strong></div><div><small>شمارهٔ همراه</small><strong dir="ltr">{customer?.phone ?? phone}</strong></div><div className="sf-customer-profile-address"><small>نشانی پیش‌فرض</small><strong>{customer?.address || "برای ارسال محلی هنوز نشانی ثبت نشده است."}</strong></div></div>}
          <p className="sf-customer-session-note"><ShieldCheck size={15} />نشست شما در فروشگاه‌های شاپرو فعال است؛ نشانی و نام ذخیره‌شده هنگام سفارش پیشنهاد می‌شود.</p>
        </section>
        <section className="sf-customer-orders">
          <div className="sf-section-head"><div><span className="sf-eyebrow">سابقهٔ یکپارچه</span><h2>سفارش‌های من</h2></div><div className="sf-customer-order-controls"><span>{orders.length} سفارش بارگذاری‌شده</span><button type="button" className="sf-button sf-secondary sf-refresh-button" disabled={loading || working} onClick={() => setRefreshKey((current) => current + 1)}><RefreshCw size={15} />به‌روزرسانی</button></div></div>
          {orders.length === 0 ? <div className="sf-card sf-customer-empty"><span className="sf-empty-icon"><ShoppingBag size={22} /></span><strong>هنوز سفارشی ثبت نشده است.</strong><p>پس از خرید از هر فروشگاه شاپرو، وضعیت و پیگیری سفارش اینجا نمایش داده می‌شود.</p><Link to={`/s/${encodeURIComponent(slug)}`} className="sf-button sf-primary"><span>رفتن به فروشگاه</span><ArrowLeft size={16} /></Link></div> : <div className="sf-customer-order-list">
            {orders.map((order) => <article className="sf-card sf-customer-order" key={order.id}>
              <div className="sf-customer-order-head"><div className="sf-order-code"><span className="sf-order-icon"><ShoppingBag size={17} /></span><div><span className="sf-eyebrow">{order.storeName}</span><strong>{order.publicCode}</strong><small>{formatDate(order.createdAt)}</small></div></div><span className={`sf-badge ${order.paymentStatus === "VERIFIED" ? "is-good" : ""}`}>{orderLabels[order.status] ?? order.status}</span></div>
              <div className="sf-customer-order-lines">{order.items.map((item, index) => <span key={`${item.title}-${index}`}>{item.title} × {item.quantity}</span>)}</div>
              <div className="sf-customer-order-meta"><span>{order.deliveryMethod === "PICKUP" ? "تحویل حضوری" : "ارسال محلی"}</span><span>{paymentStatusLabel(order.paymentStatus, order.status)}</span>{order.latestPaymentAttemptStatus && <span>{attemptLabels[order.latestPaymentAttemptStatus] ?? order.latestPaymentAttemptStatus}</span>}</div>
              <div className="sf-customer-order-footer"><strong>{money(order.totalRial)}</strong><Link to={order.trackingPath} className="sf-button sf-secondary">جزئیات و پیگیری<ArrowLeft size={15} /></Link></div>
            </article>)}
          </div>}
          {hasMore && <button type="button" className="sf-button sf-secondary sf-customer-more" disabled={working} onClick={() => void loadMore()}>{working ? "در حال دریافت…" : "نمایش سفارش‌های قدیمی‌تر"}</button>}
        </section>
      </>}
    </main>
  </StorefrontPublicFrame>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function paymentStatusLabel(paymentStatus: string, orderStatus: string) {
  if (paymentStatus === "NOT_DUE" && orderStatus !== "SUBMITTED") return "نیازی به پرداخت نیست";
  return paymentLabels[paymentStatus] ?? paymentStatus;
}

function messageOf(error: unknown) {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : "ارتباط با سرور انجام نشد. دوباره تلاش کنید.";
}
