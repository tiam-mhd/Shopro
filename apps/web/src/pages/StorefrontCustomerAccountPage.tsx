import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, storefrontCustomerGet, storefrontCustomerPost } from "../lib/api.js";
import { money } from "../lib/format.js";
import { StorefrontPublicFrame } from "./StorefrontPublicFrame.js";
import "../storefront.css";

type Customer = { name: string | null; phone: string };
type CustomerOrder = {
  id: string;
  publicCode: string;
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
  const storageKey = `shopro_storefront_customer_${slug}`;
  const [customerToken, setCustomerToken] = useState(() => sessionStorage.getItem(storageKey) ?? "");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(Boolean(customerToken));
  const [working, setWorking] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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
      setCustomer(account.customer); setOrders(page.items); setNextCursor(page.nextCursor); setHasMore(page.hasMore);
    }).catch((cause) => {
      if (!active) return;
      if (cause instanceof ApiError && cause.status === 401) {
        sessionStorage.removeItem(storageKey); setCustomerToken(""); setError("نشست شما پایان یافته است. دوباره با شمارهٔ موبایل وارد شوید.");
      } else setError(messageOf(cause));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [basePath, customerToken, storageKey, refreshKey]);

  const requestOtp = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setSuccess(""); setWorking(true);
    try {
      await storefrontCustomerPost(`${basePath}/otp/request`, { phone });
      setOtpSent(true); setSuccess("اگر شماره معتبر باشد، کد ورود برای آن ارسال می‌شود.");
    } catch (cause) { setError(messageOf(cause)); }
    finally { setWorking(false); }
  };

  const verifyOtp = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setSuccess(""); setWorking(true);
    try {
      const result = await storefrontCustomerPost<{ customerToken: string; phone: string }>(`${basePath}/otp/verify`, { phone, code });
      sessionStorage.setItem(storageKey, result.customerToken);
      setPhone(result.phone); setCode(""); setOtpSent(false); setCustomerToken(result.customerToken);
      setSuccess("وارد حساب مشتری شدید.");
    } catch (cause) { setError(messageOf(cause)); }
    finally { setWorking(false); }
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
        sessionStorage.removeItem(storageKey); setCustomerToken(""); setCustomer(null); setOrders([]);
        setError("نشست شما پایان یافته است. دوباره با شمارهٔ موبایل وارد شوید.");
      } else setError(messageOf(cause));
    } finally { setWorking(false); }
  };

  const logout = async () => {
    if (!customerToken) return;
    setWorking(true); setError(""); setSuccess("");
    try {
      await storefrontCustomerPost(`${basePath}/logout`, undefined, customerToken);
      sessionStorage.removeItem(storageKey); setCustomerToken(""); setPhone(""); setOtpSent(false);
      setSuccess("از حساب این فروشگاه خارج شدید.");
    } catch (cause) { setError(messageOf(cause)); }
    finally { setWorking(false); }
  };

  return <StorefrontPublicFrame storeSlug={slug} accountPage>
    <main className="sf-customer-account">
      <header className="sf-track-heading">
        <span className="sf-eyebrow">حساب مشتری همین فروشگاه</span>
        <h1>اطلاعات و سفارش‌های من</h1>
        <p>برای دیدن سفارش‌های ثبت‌شده با شمارهٔ خودتان، کد یک‌بارمصرف را وارد کنید.</p>
      </header>
      {error && <div className="sf-alert sf-alert-error" role="alert">{error}</div>}
      {success && <div className="sf-alert sf-alert-success" role="status">{success}</div>}

      {!customerToken ? <section className="sf-card sf-section sf-customer-login">
        <h2>ورود با شمارهٔ موبایل</h2>
        <form className="sf-customer-login-form" onSubmit={(event) => void requestOtp(event)}>
          <label>شمارهٔ موبایل<input required dir="ltr" inputMode="tel" autoComplete="tel" minLength={8} maxLength={16} value={phone} onChange={(event) => { setPhone(event.target.value); setOtpSent(false); setCode(""); }} placeholder="۰۹۱۲۱۲۳۴۵۶۷" /></label>
          <button className="sf-button sf-secondary" disabled={working}>{working ? "در حال ارسال…" : otpSent ? "ارسال دوبارهٔ کد" : "دریافت کد ورود"}</button>
        </form>
        {otpSent && <form className="sf-customer-verify" onSubmit={(event) => void verifyOtp(event)}>
          <label>کد پیامک‌شده<input required dir="ltr" inputMode="numeric" autoComplete="one-time-code" minLength={4} maxLength={8} value={code} onChange={(event) => setCode(event.target.value)} /></label>
          <button className="sf-button sf-primary" disabled={working || code.length < 4}>{working ? "در حال بررسی…" : "تأیید و ورود"}</button>
        </form>}
        <p className="sf-footnote">کد فقط برای تأیید شماره و دسترسی به اطلاعات سفارش‌های همین فروشگاه استفاده می‌شود.</p>
      </section> : loading ? <section className="sf-card sf-state" role="status">در حال دریافت اطلاعات حساب و سفارش‌ها…</section> : <>
        <section className="sf-card sf-section sf-customer-profile">
          <div><span className="sf-eyebrow">اطلاعات مشتری</span><h2>{customer?.name ?? "مشتری فروشگاه"}</h2><p dir="ltr">{customer?.phone ?? phone}</p></div>
          <button type="button" className="sf-button sf-secondary" disabled={working} onClick={() => void logout()}>خروج از حساب</button>
        </section>
        <section className="sf-customer-orders">
          <div className="sf-section-head"><div><span className="sf-eyebrow">فقط سفارش‌های همین فروشگاه</span><h2>سفارش‌های من</h2></div><div className="sf-customer-order-controls"><span>{orders.length} سفارش</span><button type="button" className="sf-link-button" disabled={loading || working} onClick={() => setRefreshKey((current) => current + 1)}>به‌روزرسانی</button></div></div>
          {orders.length === 0 ? <div className="sf-card sf-customer-empty"><strong>هنوز سفارشی با این شماره ثبت نشده است.</strong><p>پس از ثبت سفارش، وضعیت و پیگیری آن را همین‌جا می‌بینید.</p><Link to={`/s/${encodeURIComponent(slug)}`} className="sf-button sf-primary">رفتن به فروشگاه</Link></div> : <div className="sf-customer-order-list">
            {orders.map((order) => <article className="sf-card sf-customer-order" key={order.id}>
              <div className="sf-customer-order-head"><div><span className="sf-eyebrow">کد پیگیری</span><strong>{order.publicCode}</strong><small>{formatDate(order.createdAt)}</small></div><span className={`sf-badge ${order.paymentStatus === "VERIFIED" ? "is-good" : ""}`}>{orderLabels[order.status] ?? order.status}</span></div>
              <div className="sf-customer-order-lines">{order.items.map((item, index) => <span key={`${item.title}-${index}`}>{item.title} × {item.quantity}</span>)}</div>
              <div className="sf-customer-order-meta"><span>{order.deliveryMethod === "PICKUP" ? "تحویل حضوری" : "ارسال محلی"}</span><span>{paymentStatusLabel(order.paymentStatus, order.status)}</span>{order.latestPaymentAttemptStatus && <span>{attemptLabels[order.latestPaymentAttemptStatus] ?? order.latestPaymentAttemptStatus}</span>}<strong>{money(order.totalRial)}</strong></div>
              <Link to={order.trackingPath} className="sf-button sf-secondary">مشاهدهٔ جزئیات و پیگیری سفارش</Link>
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
