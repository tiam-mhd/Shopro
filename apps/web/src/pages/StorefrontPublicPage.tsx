import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, newOperationId, publicGet, publicPost, publicUpload } from "../lib/api.js";
import { money } from "../lib/format.js";
import { StorefrontPublicFrame } from "./StorefrontPublicFrame.js";
import "../storefront.css";

type Store = {
  slug: string; name: string; businessName: string; branchName: string; description: string | null; phone: string | null;
  address: string | null; status: string; acceptingOrders: boolean; closedMessage: string; acceptsPickup: boolean;
  acceptsLocalDelivery: boolean; deliveryFeeRial: string; showExactStock: boolean; preparationMinutes: number | null;
  cancellationPolicy: string | null; paymentInstructions: string | null;
};
type Product = {
  id: string; title: string; description: string | null; kind: string; category: string | null; unit: string;
  unitCode: string; unitPrecision: number; unitPriceRial: string; taxRateBasisPoints: number; stockLabel: string;
  available: boolean; quantityOnHand: string | null; minimumQuantity: string; maximumQuantity: string | null;
};
type Order = {
  publicCode: string; storeName: string; storeSlug: string; storePhone: string | null; paymentInstructions: string | null;
  status: string; paymentStatus: string; createdAt: string; paymentDueAt: string | null; deliveryMethod: string;
  items: Array<{ title: string; quantity: string; unitCode: string; unitPriceRial: string; taxRial: string; lineTotalRial: string }>;
  subtotalRial: string; taxRial: string; deliveryFeeRial: string; totalRial: string; verifiedAmountRial: string;
  paymentAttempts: Array<{ status: string; submittedAmountRial: string; rejectionReason: string | null; createdAt: string; mimeType: string | null; receiptBytes: string | null; card: { bankName?: string; holderName?: string; last4?: string } | null }>;
  cards: Array<{ id: string; bankName: string; holderName: string; cardNumber: string; label: string | null; instructions: string | null }>;
  timeline: Array<{ status: string; at: string; message: string }>;
};
type OrderCreated = { trackingToken: string; trackingPath: string; publicCode: string };
type ProductPage = { items: Product[]; nextCursor: string | null; hasMore: boolean };
type CartLine = { product: Product; quantity: string };
type PriceChange = { listingId: string; title: string; expectedPriceRial: string; currentPriceRial: string; expectedTaxRateBasisPoints?: number; currentTaxRateBasisPoints?: number };

const orderLabels: Record<string, string> = {
  SUBMITTED: "درخواست ثبت شد", ACCEPTED: "سفارش پذیرفته شد", REJECTED: "سفارش پذیرفته نشد", PREPARING: "در حال آماده‌سازی",
  READY: "آمادهٔ تحویل", OUT_FOR_DELIVERY: "در مسیر ارسال", READY_FOR_PICKUP: "آمادهٔ دریافت حضوری", COMPLETED: "تحویل شد",
  CANCELLED: "لغوشده", EXPIRED: "مهلت پرداخت پایان یافت", RETURNED: "مرجوع‌شده",
};
const paymentLabels: Record<string, string> = { NOT_DUE: "در انتظار پاسخ فروشگاه", UNPAID: "پرداخت‌نشده", UNDER_REVIEW: "رسید در حال بررسی", PARTIALLY_VERIFIED: "پرداخت بخشی تأیید شد", OVERPAID_REVIEW: "نیازمند بررسی مبلغ", VERIFIED: "پرداخت تأیید شد", REFUND_PENDING: "بازپرداخت در حال پیگیری", REFUNDED: "بازپرداخت‌شده" };
const attemptLabels: Record<string, string> = { UNDER_REVIEW: "در حال بررسی", VERIFIED: "تأیید شد", PARTIALLY_VERIFIED: "بخشی تأیید شد", REJECTED: "رد شد", OVERPAID_REVIEW: "نیازمند بررسی" };

export function StorefrontPublicPage() {
  const { slug, token } = useParams();
  const navigate = useNavigate();
  const [store, setStore] = useState<Store | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [productCursor, setProductCursor] = useState<string | null>(null);
  const [productHasMore, setProductHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [priceChanges, setPriceChanges] = useState<PriceChange[]>([]);
  const [totalChange, setTotalChange] = useState<{ expected: string; current: string } | null>(null);
  const [priceConfirmed, setPriceConfirmed] = useState(false);
  const [orderAttempt, setOrderAttempt] = useState<{ fingerprint: string; key: string } | null>(null);
  const [step, setStep] = useState<"browse" | "checkout">("browse");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [checkoutToken, setCheckoutToken] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<"PICKUP" | "LOCAL_DELIVERY">("PICKUP");
  const [address, setAddress] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [selectedCardId, setSelectedCardId] = useState("");
  const [receiptAmount, setReceiptAmount] = useState("");
  const [transferReference, setTransferReference] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const refreshOrder = async () => {
    if (!token) return;
    setLoading(true); setError("");
    try { setOrder(await publicGet<Order>(`/public/orders/${encodeURIComponent(token)}`)); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (token) { void refreshOrder(); return; }
    if (!slug) return;
    let active = true;
    setLoading(true); setError("");
    void Promise.all([
      publicGet<Store>(`/public/stores/${encodeURIComponent(slug)}`),
      publicGet<ProductPage>(`/public/stores/${encodeURIComponent(slug)}/products?limit=60`),
    ]).then(([nextStore, page]) => {
      if (!active) return;
      setStore(nextStore); setProducts(page.items); setProductCursor(page.nextCursor); setProductHasMore(page.hasMore);
      setDeliveryMethod(nextStore.acceptsPickup ? "PICKUP" : "LOCAL_DELIVERY");
    }).catch((cause) => { if (active) setError(messageOf(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug, token]);

  useEffect(() => {
    if (token || search === null) return;
    let active = true;
    const query = search ? `?limit=60&q=${encodeURIComponent(search)}` : "?limit=60";
    void publicGet<ProductPage>(`/public/stores/${encodeURIComponent(slug ?? "")}/products${query}`)
      .then((page) => { if (active) { setProducts(page.items); setProductCursor(page.nextCursor); setProductHasMore(page.hasMore); } })
      .catch((cause) => { if (active) setError(messageOf(cause)); });
    return () => { active = false; };
  }, [search, slug, token]);

  const cartLines = useMemo(() => Object.values(cart).filter((line) => Number(line.quantity) > 0), [cart]);
  const subtotal = useMemo(() => cartLines.reduce((sum, line) => sum + extendedRial(line.quantity, line.product.unitPriceRial), 0n), [cartLines]);
  const tax = useMemo(() => cartLines.reduce((sum, line) => {
    const base = extendedRial(line.quantity, line.product.unitPriceRial);
    return sum + (base * BigInt(line.product.taxRateBasisPoints) + 5_000n) / 10_000n;
  }, 0n), [cartLines]);
  const deliveryFee = deliveryMethod === "LOCAL_DELIVERY" && store ? BigInt(store.deliveryFeeRial) : 0n;
  const total = subtotal + tax + deliveryFee;
  const remaining = order ? BigInt(order.totalRial) > BigInt(order.verifiedAmountRial) ? BigInt(order.totalRial) - BigInt(order.verifiedAmountRial) : 0n : 0n;
  const customerCredit = order && BigInt(order.verifiedAmountRial) > BigInt(order.totalRial) ? BigInt(order.verifiedAmountRial) - BigInt(order.totalRial) : 0n;

  const changeQuantity = (product: Product, raw: string) => {
    setPriceConfirmed(false); setPriceChanges([]); setTotalChange(null);
    const normalized = raw.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
    setCart((current) => {
      if (!normalized || Number(normalized) <= 0) { const next = { ...current }; delete next[product.id]; return next; }
      if (product.maximumQuantity && Number(normalized) > Number(product.maximumQuantity)) return current;
      return { ...current, [product.id]: { product, quantity: normalized } };
    });
  };

  const loadMoreProducts = async () => {
    if (!slug || !productCursor || loadingMore) return;
    setLoadingMore(true); setError("");
    try {
      const params = new URLSearchParams({ limit: "60", cursor: productCursor });
      if (search) params.set("q", search);
      const page = await publicGet<ProductPage>(`/public/stores/${encodeURIComponent(slug)}/products?${params}`);
      setProducts((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setProductCursor(page.nextCursor); setProductHasMore(page.hasMore);
    } catch (cause) { setError(messageOf(cause)); }
    finally { setLoadingMore(false); }
  };

  const sendOtp = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setSuccess(""); setWorking(true);
    try {
      await publicPost(`/public/stores/${encodeURIComponent(slug ?? "")}/otp/request`, { phone });
      setOtpSent(true); setSuccess("اگر شماره معتبر باشد، کد تأیید برای آن ارسال می‌شود.");
    } catch (cause) { setError(messageOf(cause)); }
    finally { setWorking(false); }
  };

  const verifyPhone = async () => {
    setError(""); setSuccess(""); setWorking(true);
    try {
      const result = await publicPost<{ checkoutToken: string; phone: string; expiresAt: string }>(`/public/stores/${encodeURIComponent(slug ?? "")}/otp/verify`, { phone, code });
      setCheckoutToken(result.checkoutToken); setPhone(result.phone); setSuccess("شمارهٔ موبایل تأیید شد.");
    } catch (cause) { setError(messageOf(cause)); }
    finally { setWorking(false); }
  };

  const placeOrder = async (event: FormEvent) => {
    event.preventDefault(); if (!store || !checkoutToken) return;
    setError(""); setSuccess(""); setWorking(true);
    const body = {
      customerName: name, customerPhone: phone, checkoutToken, deliveryMethod,
      ...(deliveryMethod === "LOCAL_DELIVERY" ? { deliveryAddress: address } : {}),
      ...(customerNote.trim() ? { customerNote: customerNote.trim() } : {}),
      expectedTotalRial: total.toString(),
      lines: cartLines.map((line) => ({ listingId: line.product.id, quantity: line.quantity, expectedUnitPriceRial: line.product.unitPriceRial, expectedTaxRateBasisPoints: line.product.taxRateBasisPoints })),
    };
    const fingerprint = JSON.stringify(body);
    const key = orderAttempt?.fingerprint === fingerprint ? orderAttempt.key : newOperationId();
    setOrderAttempt({ fingerprint, key });
    try {
      const result = await publicPost<OrderCreated>(`/public/stores/${encodeURIComponent(store.slug)}/orders`, body, { "Idempotency-Key": key });
      navigate(result.trackingPath, { replace: true });
    } catch (cause) {
      setError(messageOf(cause)); setPriceConfirmed(false);
      if (cause instanceof ApiError && (cause.code === "PRICE_CHANGED" || cause.code === "STOCK_CHANGED")) {
        try {
          const params = new URLSearchParams({ limit: "60" }); if (search) params.set("q", search);
          const [page, freshStore] = await Promise.all([
            publicGet<ProductPage>(`/public/stores/${encodeURIComponent(store.slug)}/products?${params}`),
            publicGet<Store>(`/public/stores/${encodeURIComponent(store.slug)}`),
          ]);
          setStore(freshStore);
          setProducts(page.items); setProductCursor(page.nextCursor); setProductHasMore(page.hasMore);
          const details = cause.details as { changes?: PriceChange[]; expectedTotalRial?: string; currentTotalRial?: string } | undefined;
          const changedById = new Map((details?.changes ?? []).map((change) => [change.listingId, change]));
          setCart((current) => Object.fromEntries(Object.entries(current).map(([id, line]) => {
            const fresh = page.items.find((item) => item.id === id);
            const change = changedById.get(id);
            return [id, { ...line, product: fresh ?? (change ? { ...line.product, title: change.title, unitPriceRial: change.currentPriceRial, taxRateBasisPoints: change.currentTaxRateBasisPoints ?? line.product.taxRateBasisPoints } : line.product) }];
          })));
          if (cause.code === "PRICE_CHANGED") {
            setPriceChanges(details?.changes ?? []);
            setTotalChange(details?.expectedTotalRial && details.currentTotalRial ? { expected: details.expectedTotalRial, current: details.currentTotalRial } : null);
          }
        } catch { /* The original order error remains visible; the user can retry loading the catalog. */ }
      }
    }
    finally { setWorking(false); }
  };

  const submitReceipt = async (event: FormEvent) => {
    event.preventDefault(); if (!token || !selectedCardId || !receiptFile) return;
    setError(""); setSuccess(""); setWorking(true);
    try {
      const body = new FormData();
      body.append("file", receiptFile); body.append("cardId", selectedCardId); body.append("submittedAmountRial", tomanToRial(receiptAmount));
      if (transferReference.trim()) body.append("customerTransactionReference", transferReference.trim());
      const result = await publicUpload<{ message: string }>(`/public/orders/${encodeURIComponent(token)}/receipts`, body);
      setSuccess(result.message); setReceiptFile(null); setReceiptAmount(""); setTransferReference("");
      await refreshOrder();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setWorking(false); }
  };

  const cancelOrder = async () => {
    if (!token || !window.confirm("درخواست ثبت‌شده لغو شود؟")) return;
    setWorking(true); setError(""); setSuccess("");
    try { await publicPost(`/public/orders/${encodeURIComponent(token)}/cancel`); setSuccess("درخواست شما لغو شد."); await refreshOrder(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setWorking(false); }
  };

  if (loading) return <StorefrontPublicFrame storeSlug={slug}><div className="sf-state" role="status">در حال بارگذاری…</div></StorefrontPublicFrame>;
  if (error && !store && !order) return <StorefrontPublicFrame storeSlug={slug}><div className="sf-state sf-error" role="alert"><strong>فروشگاه در دسترس نیست</strong><p>{error}</p><button className="sf-button sf-secondary" onClick={() => window.location.reload()}>تلاش دوباره</button></div></StorefrontPublicFrame>;
  if (token) return <StorefrontPublicFrame storeSlug={order?.storeSlug}><main className="sf-track">
    <header className="sf-track-heading"><Link to={order ? `/s/${order.storeSlug}` : "/"} className="sf-back">← بازگشت به فروشگاه</Link><span className="sf-eyebrow">پیگیری سفارش</span><h1>{order?.storeName ?? "وضعیت سفارش"}</h1>{order && <p>کد سفارش <b>{order.publicCode}</b></p>}</header>
    {error && <div className="sf-alert sf-alert-error" role="alert">{error}</div>}{success && <div className="sf-alert sf-alert-success" role="status">{success}</div>}
    {!order ? <div className="sf-card sf-state">سفارش یا پیوند پیگیری پیدا نشد. پیوند را از پیام ثبت سفارش باز کنید.</div> : <>
      <section className="sf-card sf-order-status"><div><span className="sf-eyebrow">وضعیت سفارش</span><h2>{orderLabels[order.status] ?? order.status}</h2></div><span className={`sf-badge ${order.paymentStatus === "VERIFIED" ? "is-good" : ""}`}>{paymentStatusLabel(order.paymentStatus, order.status)}</span><p>{order.timeline.at(-1)?.message ?? "وضعیت سفارش در این صفحه به‌روزرسانی می‌شود."}</p></section>
      {customerCredit > 0n && <div className="sf-alert sf-alert-neutral">{money(customerCredit.toString())} اضافه‌پرداخت در حساب مشتری به‌عنوان اعتبار ثبت شده است؛ بازپرداخت این مبلغ در این صفحه انجام نشده است.</div>}
       <div className="sf-track-grid"><section className="sf-card sf-section"><div className="sf-section-head"><h2>اقلام سفارش</h2><span>{new Date(order.createdAt).toLocaleString("fa-IR")}</span></div><div className="sf-lines">{order.items.map((item, index) => <div className="sf-line" key={`${item.title}-${index}`}><div><strong>{item.title}</strong><small>{item.quantity} {item.unitCode} × {money(item.unitPriceRial)}</small></div><b>{money(item.lineTotalRial)}</b></div>)}</div><Totals subtotal={order.subtotalRial} tax={order.taxRial} delivery={order.deliveryFeeRial} total={order.totalRial} /></section>
        <section className="sf-card sf-section"><div className="sf-section-head"><h2>مراحل سفارش</h2><button type="button" className="sf-link-button" disabled={working} onClick={() => void refreshOrder()}>به‌روزرسانی</button></div><ol className="sf-timeline">{order.timeline.map((event, index) => <li key={`${event.at}-${index}`}><i /><div><strong>{orderLabels[event.status] ?? event.status}</strong><p>{event.message}</p><small>{new Date(event.at).toLocaleString("fa-IR")}</small></div></li>)}</ol></section></div>
      {order.status === "ACCEPTED" && order.paymentStatus !== "VERIFIED" && <section className="sf-card sf-section sf-pay-section"><div className="sf-section-head"><h2>پرداخت با کارت به کارت</h2><span>{order.paymentDueAt ? `مهلت تا ${new Date(order.paymentDueAt).toLocaleString("fa-IR")}` : ""}</span></div>
        <div className="sf-alert sf-alert-neutral">ماندهٔ قابل پرداخت: <b>{money(remaining.toString())}</b>. پس از انتقال وجه، تصویر رسید را بفرستید. رسید فقط پس از بررسی فروشگاه تأیید می‌شود.</div>
        {order.cards.length === 0 ? <p className="sf-empty">در حال حاضر کارت مقصد فعالی ثبت نشده است. برای هماهنگی با فروشگاه تماس بگیرید{order.storePhone ? `: ${order.storePhone}` : ""}.</p> : <div className="sf-card-list">{order.cards.map((card) => <article className={`sf-bank-card ${selectedCardId === card.id ? "selected" : ""}`} key={card.id}><div><b>{card.bankName}</b>{card.label && <small>{card.label}</small>}</div><strong className="sf-card-number" dir="ltr">{formatCard(card.cardNumber)}</strong><div className="sf-card-foot"><span>{card.holderName}</span><button type="button" className="sf-link-button" onClick={() => { void navigator.clipboard?.writeText(card.cardNumber); setSuccess("شمارهٔ کارت کپی شد."); }}>کپی شماره</button></div>{card.instructions && <small>{card.instructions}</small>}<label className="sf-radio"><input type="radio" name="payCard" checked={selectedCardId === card.id} onChange={() => setSelectedCardId(card.id)} /> انتخاب این کارت</label></article>)}</div>}
        {order.cards.length > 0 && <form className="sf-receipt-form" onSubmit={(event) => void submitReceipt(event)}><h3>ارسال رسید پرداخت</h3><div className="sf-form-grid"><label>مبلغ واریزشده به تومان<input required inputMode="numeric" value={receiptAmount} onChange={(event) => setReceiptAmount(event.target.value)} placeholder="مثلاً ۲۵۰۰۰۰" /></label><label>شماره پیگیری انتقال (اختیاری)<input value={transferReference} onChange={(event) => setTransferReference(event.target.value)} maxLength={120} /></label><label className="sf-file-field">تصویر یا فایل رسید<input required type="file" accept="image/jpeg,image/png,application/pdf" onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)} /></label></div><button className="sf-button sf-primary" disabled={working || !selectedCardId || !receiptFile}>{working ? "در حال ارسال…" : "ارسال رسید برای بررسی"}</button></form>}
        {order.paymentAttempts.length > 0 && <div className="sf-attempts"><h3>رسیدهای قبلی</h3>{order.paymentAttempts.map((attempt, index) => <p key={`${attempt.createdAt}-${index}`}><b>{attemptLabels[attempt.status] ?? attempt.status}</b> · {money(attempt.submittedAmountRial)}{attempt.rejectionReason && <span className="sf-rejection"> — {attempt.rejectionReason}</span>}</p>)}</div>}
        {order.paymentInstructions && <p className="sf-footnote">{order.paymentInstructions}</p>}
      </section>}
      {order.status === "SUBMITTED" && <div className="sf-cancel-row"><span>تا پیش از پذیرش فروشگاه می‌توانید درخواست را لغو کنید.</span><button type="button" className="sf-button sf-danger" disabled={working} onClick={() => void cancelOrder()}>لغو درخواست</button></div>}
    </>}
  </main></StorefrontPublicFrame>;

  if (!store) return <StorefrontPublicFrame storeSlug={slug}><div className="sf-state">اطلاعات فروشگاه پیدا نشد.</div></StorefrontPublicFrame>;
  return <StorefrontPublicFrame storeSlug={store.slug}><main className="sf-store">
    <header className="sf-store-hero"><div className="sf-brand-mark">ش</div><div className="sf-store-title"><span className="sf-eyebrow">فروشگاه شعبه‌ای شاپرو</span><h1>{store.name}</h1><p>{[store.businessName, store.branchName].filter(Boolean).join(" · ")}</p></div><span className={`sf-open-badge ${store.acceptingOrders ? "is-open" : "is-closed"}`}>{store.acceptingOrders ? "پذیرش سفارش فعال" : "پذیرش سفارش متوقف است"}</span>{store.description && <p className="sf-store-description">{store.description}</p>}{store.address && <p className="sf-address">نشانی: {store.address}</p>}{store.phone && <a className="sf-address" href={`tel:${store.phone}`}>تماس با فروشگاه: {store.phone}</a>}{store.preparationMinutes !== null && <p className="sf-address">زمان تقریبی آماده‌سازی: {store.preparationMinutes} دقیقه</p>}{store.cancellationPolicy && <p className="sf-store-description">قانون لغو سفارش: {store.cancellationPolicy}</p>}</header>
    {error && <div className="sf-alert sf-alert-error" role="alert">{error}</div>}{success && <div className="sf-alert sf-alert-success" role="status">{success}</div>}
    {!store.acceptingOrders && <div className="sf-alert sf-alert-neutral">{store.closedMessage}</div>}
    {step === "checkout" && <p className="sf-footnote sf-privacy-note">شمارهٔ موبایل برای تأیید هویت، ثبت و پیگیری سفارش‌های همین فروشگاه استفاده می‌شود.</p>}
    {step === "browse" ? <div className="sf-shop-grid"><section className="sf-products-area"><div className="sf-catalog-head"><div><span className="sf-eyebrow">فهرست کالاها و خدمات</span><h2>از فروشگاه انتخاب کنید</h2></div><form className="sf-search" onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim()); }}><input aria-label="جست‌وجوی کالا" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="نام کالا یا خدمت" /><button className="sf-button sf-secondary">جست‌وجو</button></form></div>
      {products.length === 0 ? <div className="sf-card sf-empty"><strong>کالایی برای نمایش نیست</strong><p>فروشگاه هنوز کالایی برای سفارش منتشر نکرده است.</p></div> : <div className="sf-product-grid">{products.map((product) => <article className="sf-product-card" key={product.id}><div className="sf-product-top"><span className="sf-product-icon">{product.kind === "SERVICE" ? "خ" : "ک"}</span><span className={`sf-stock ${product.available ? "" : "is-out"}`}>{product.stockLabel}</span></div><div className="sf-product-meta">{product.category ?? (product.kind === "SERVICE" ? "خدمت" : "کالا")}</div><h3>{product.title}</h3>{product.description && <p>{product.description}</p>}<div className="sf-product-buy"><div><strong>{money(product.unitPriceRial)}</strong><small>برای هر {product.unit}</small></div><div className="sf-quantity"><button type="button" aria-label={`افزایش ${product.title}`} disabled={!product.available || !store.acceptingOrders} onClick={() => changeQuantity(product, stepQuantity(cart[product.id]?.quantity ?? "0", product.unitPrecision, 1, product.minimumQuantity))}>+</button><span>{cart[product.id]?.quantity ?? "۰"}</span><button type="button" aria-label={`کاهش ${product.title}`} disabled={!cart[product.id]} onClick={() => changeQuantity(product, stepQuantity(cart[product.id]?.quantity ?? "0", product.unitPrecision, -1, product.minimumQuantity))}>−</button></div></div></article>)}</div>}
      {productHasMore && <div className="sf-more-products"><button type="button" className="sf-button sf-secondary" disabled={loadingMore} onClick={() => void loadMoreProducts()}>{loadingMore ? "در حال دریافت کالاها…" : "نمایش کالاهای بیشتر"}</button></div>}
      </section><aside className="sf-cart-panel"><div className="sf-cart-title"><div><span className="sf-eyebrow">سبد خرید</span><h2>{cartLines.length ? `${cartLines.length} قلم` : "سبد شما خالی است"}</h2></div><span className="sf-cart-icon">▤</span></div>{cartLines.length ? <><div className="sf-cart-lines">{cartLines.map((line) => <div className="sf-cart-line" key={line.product.id}><div><strong>{line.product.title}</strong><small>{line.quantity} {line.product.unit}</small></div><b>{money(extendedRial(line.quantity, line.product.unitPriceRial).toString())}</b><button type="button" aria-label={`حذف ${line.product.title}`} onClick={() => changeQuantity(line.product, "0")}>×</button></div>)}</div><Totals subtotal={subtotal.toString()} tax={tax.toString()} delivery={deliveryFee.toString()} total={total.toString()} />{store.acceptsPickup && store.acceptsLocalDelivery && <label className="sf-delivery-choice">روش دریافت<select value={deliveryMethod} onChange={(event) => { setPriceConfirmed(false); setPriceChanges([]); setTotalChange(null); setDeliveryMethod(event.target.value as "PICKUP" | "LOCAL_DELIVERY"); }}><option value="PICKUP">تحویل حضوری</option><option value="LOCAL_DELIVERY">ارسال محلی</option></select></label>}<button type="button" className="sf-button sf-primary sf-wide" disabled={!store.acceptingOrders} onClick={() => setStep("checkout")}>ادامه و ثبت سفارش</button></> : <p className="sf-cart-hint">با انتخاب کالا، جمع سفارش و هزینهٔ ارسال اینجا نمایش داده می‌شود.</p>}</aside></div> : <section className="sf-card sf-checkout"><button type="button" className="sf-back-button" onClick={() => setStep("browse")}>← بازگشت به سبد خرید</button><div className="sf-checkout-grid"><div className="sf-checkout-details"><span className="sf-eyebrow">تکمیل سفارش</span><h2>اطلاعات تحویل</h2><form onSubmit={(event) => void sendOtp(event)} className="sf-form-grid"><label>نام و نام خانوادگی<input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><label>شمارهٔ موبایل<input required dir="ltr" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => { setPhone(event.target.value); setCheckoutToken(""); }} placeholder="۰۹۱۲۱۲۳۴۵۶۷" /></label><button className="sf-button sf-secondary sf-send-otp" disabled={working}>{working ? "در حال ارسال…" : otpSent ? "ارسال دوبارهٔ کد" : "دریافت کد تأیید"}</button></form>{otpSent && !checkoutToken && <div className="sf-otp-row"><label>کد پیامک‌شده<input dir="ltr" inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} maxLength={8} /></label><button type="button" className="sf-button sf-primary" disabled={working || code.length < 4} onClick={() => void verifyPhone()}>تأیید شماره</button></div>}{checkoutToken && <div className="sf-alert sf-alert-success">شمارهٔ موبایل تأیید شده است.</div>}
      <div className="sf-delivery-form"><label>روش دریافت<select value={deliveryMethod} onChange={(event) => { setPriceConfirmed(false); setPriceChanges([]); setTotalChange(null); setDeliveryMethod(event.target.value as "PICKUP" | "LOCAL_DELIVERY"); }}><>{store.acceptsPickup && <option value="PICKUP">تحویل حضوری</option>}{store.acceptsLocalDelivery && <option value="LOCAL_DELIVERY">ارسال محلی</option>}</></select></label>{deliveryMethod === "LOCAL_DELIVERY" && <label>نشانی دقیق تحویل<textarea required minLength={5} maxLength={500} value={address} onChange={(event) => setAddress(event.target.value)} rows={3} /></label>}<label>توضیحات سفارش (اختیاری)<textarea maxLength={500} value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} rows={2} /></label></div>
      {(priceChanges.length > 0 || totalChange) && <div className="sf-alert sf-alert-error"><strong>مبلغ نهایی سفارش تغییر کرده است.</strong>{priceChanges.map((change) => <div key={change.listingId}>{change.title}: {change.expectedPriceRial !== change.currentPriceRial ? <>{money(change.expectedPriceRial)} ← {money(change.currentPriceRial)}</> : "نرخ مالیات کالا تغییر کرده است."}</div>)}{totalChange && <div>مبلغ قبلی: {money(totalChange.expected)} · مبلغ تازه: {money(totalChange.current)}</div>}<p>سبد، روش دریافت و مبلغ تازه را بررسی و دوباره تأیید کنید.</p></div>}
      {checkoutToken && <form onSubmit={(event) => void placeOrder(event)}><label className="sf-check sf-price-confirm"><input type="checkbox" checked={priceConfirmed} onChange={(event) => setPriceConfirmed(event.target.checked)} /><span>اقلام، روش دریافت و مبلغ نهایی را بررسی و تأیید کردم.</span></label><button className="sf-button sf-primary sf-wide" disabled={working || !priceConfirmed}>{working ? "در حال ثبت سفارش…" : "ثبت درخواست سفارش"}</button><p className="sf-footnote">پس از ثبت، فروشگاه درخواست را بررسی می‌کند. پرداخت بعد از پذیرش سفارش انجام می‌شود.</p></form>}</div><aside className="sf-checkout-summary"><span className="sf-eyebrow">خلاصهٔ سبد</span><h3>{cartLines.length} قلم</h3>{cartLines.map((line) => <div className="sf-summary-line" key={line.product.id}><span>{line.product.title} × {line.quantity}</span><b>{money(extendedRial(line.quantity, line.product.unitPriceRial).toString())}</b></div>)}<Totals subtotal={subtotal.toString()} tax={tax.toString()} delivery={deliveryFee.toString()} total={total.toString()} /></aside></div></section>}
  </main></StorefrontPublicFrame>;
}

function Totals({ subtotal, tax, delivery, total }: { subtotal: string; tax: string; delivery: string; total: string }) {
  return <div className="sf-totals"><div><span>جمع کالاها</span><b>{money(subtotal)}</b></div><div><span>مالیات</span><b>{money(tax)}</b></div><div><span>هزینهٔ ارسال</span><b>{money(delivery)}</b></div><div className="sf-total"><strong>مبلغ نهایی</strong><strong>{money(total)}</strong></div></div>;
}

function extendedRial(quantity: string, priceRial: string) {
  const milli = BigInt(Math.round(Number(quantity) * 1000));
  return (milli * BigInt(priceRial) + 500n) / 1000n;
}
function stepQuantity(current: string, precision: number, direction: number, minimum: string) {
  const scale = 10 ** Math.min(3, Math.max(0, precision));
  const currentUnits = Math.round(Number(current) * scale);
  const minimumUnits = Math.max(1, Math.round(Number(minimum) * scale));
  const step = direction > 0 && currentUnits === 0 ? minimumUnits : 1;
  const candidate = currentUnits + direction * step;
  const next = direction < 0 && candidate < minimumUnits ? 0 : Math.max(0, candidate);
  return (next / scale).toFixed(Math.min(3, Math.max(0, precision))).replace(/\.?0+$/, "") || "0";
}
function tomanToRial(value: string) {
  const normalized = value.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/[,.٬\s]/g, "");
  if (!/^\d{1,17}$/.test(normalized)) throw new Error("مبلغ را به تومان و با عدد صحیح وارد کنید.");
  return (BigInt(normalized) * 10n).toString();
}
function formatCard(value: string) { return value.replace(/\D/g, "").replace(/(.{4})/g, "$1 ").trim(); }
function messageOf(error: unknown) { return error instanceof ApiError ? error.message : error instanceof Error ? error.message : "ارتباط با سرور انجام نشد. دوباره تلاش کنید."; }
function paymentStatusLabel(paymentStatus: string, orderStatus: string) {
  if (paymentStatus === "NOT_DUE" && orderStatus !== "SUBMITTED") return "نیازی به پرداخت نیست";
  return paymentLabels[paymentStatus] ?? paymentStatus;
}
