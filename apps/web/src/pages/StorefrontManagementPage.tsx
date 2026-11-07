import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { MemberRole } from "@shopro/contracts";
import { ArrowUpRight, ChartNoAxesCombined, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, CreditCard, ExternalLink, PackagePlus, Search, Settings2, ShoppingBag, Store } from "lucide-react";
import { ApiError, downloadFile, get, patch, post } from "../lib/api.js";
import { faNumber, money } from "../lib/format.js";
import { StorefrontListingFields, storefrontPriceOverride } from "../components/StorefrontListingEditor.js";
import type { StorefrontListingConfig as ListingConfig, StorefrontListingPage as ListingPage, StorefrontListingProduct as ListingProduct } from "../components/StorefrontListingEditor.js";
import "../storefront.css";

type Settings = { id?: string; slug: string; status: "DRAFT" | "PUBLISHED" | "PAUSED"; publicName: string; description: string; phone: string; address: string; showAddress: boolean; acceptsPickup: boolean; acceptsLocalDelivery: boolean; deliveryFeeRial: string; showExactStock: boolean; preparationMinutes: number | null; paymentInstructions: string; cancellationPolicy: string; publicUrl?: string };
const emptyListingPage: ListingPage = { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1, categories: [] };
type Card = { id: string; bankName: string; holderName: string; maskedCardNumber: string; label: string | null; instructions: string | null; displayOrder: number; isActive: boolean; financeAccountId: string; financeAccountName: string; accountActive: boolean };
type Account = { id: string; name: string; kind: string; balanceRial: string };
type OrderSummary = { id: string; publicCode: string; status: string; paymentStatus: string; customerName: string; createdAt: string; deliveryMethod: string; itemCount: number; totalRial: string; lastReceipt: { status: string; submittedAmountRial: string; createdAt: string; rejectionReason: string | null } | null };
type Page<T> = { items: T[]; nextCursor: string | null; hasMore: boolean };
type OrderDetail = OrderSummary & { customer: { name: string; phone: string; address: string | null; note: string | null }; acceptedAt: string | null; paymentDueAt: string | null; completedAt: string | null; subtotalRial: string; taxRial: string; deliveryFeeRial: string; verifiedAmountRial: string; items: Array<{ id: string; title: string; sku: string; quantity: string; unitCode: string; unitPriceRial: string; lineTotalRial: string }>; paymentAttempts: Array<{ id: string; status: string; submittedAmountRial: string; verifiedAmountRial: string | null; customerTransactionReference: string | null; transactionReference: string | null; rejectionReason: string | null; note: string | null; card: { bankName?: string; holderName?: string; last4?: string } | null; receipt: { mimeType: string; bytes: string; uploadedAt: string; downloadPath: string } | null }>; timeline: Array<{ status: string; message: string; at: string }>; salesInvoice: { invoiceNo: string | null; status: string } | null };
type Analytics = { days: number; orderCounts: Record<string, number>; submittedOrderRial: string; receiptsWaitingReview: number; verifiedPaymentCount: number; verifiedPaymentRial: string; postedSalesCount: number; postedSalesRial: string };
const emptySettings: Settings = { slug: "", status: "DRAFT", publicName: "", description: "", phone: "", address: "", showAddress: false, acceptsPickup: true, acceptsLocalDelivery: false, deliveryFeeRial: "0", showExactStock: false, preparationMinutes: null, paymentInstructions: "", cancellationPolicy: "" };
const orderLabels: Record<string, string> = { SUBMITTED: "درخواست جدید", ACCEPTED: "پذیرفته‌شده", REJECTED: "ردشده", PREPARING: "در حال آماده‌سازی", READY: "آماده", OUT_FOR_DELIVERY: "در مسیر ارسال", READY_FOR_PICKUP: "آمادهٔ دریافت", COMPLETED: "تحویل‌شده", CANCELLED: "لغوشده", EXPIRED: "منقضی‌شده", RETURNED: "مرجوع‌شده" };
const paymentLabels: Record<string, string> = { NOT_DUE: "در انتظار پاسخ", UNPAID: "پرداخت‌نشده", UNDER_REVIEW: "در حال بررسی", PARTIALLY_VERIFIED: "پرداخت بخشی", OVERPAID_REVIEW: "بررسی اضافه‌پرداخت", VERIFIED: "تأییدشده", REFUNDED: "بازپرداخت‌شده" };
const tabs = [{ id: "settings", label: "تنظیمات فروشگاه", icon: Settings2 }, { id: "products", label: "کالاهای فروشگاه", icon: PackagePlus }, { id: "orders", label: "سفارش‌ها", icon: ClipboardList }, { id: "cards", label: "کارت‌های مقصد", icon: CreditCard }, { id: "analytics", label: "گزارش فروشگاه", icon: ChartNoAxesCombined }];

export function StorefrontManagementPage({ role }: { role: MemberRole }) {
  const isOwner = role === "OWNER";
  const canManage = role === "OWNER" || role === "MANAGER";
  const canAnalyze = role === "OWNER" || role === "MANAGER" || role === "ACCOUNTANT";
  const visibleTabs = tabs.filter((tab) => tab.id !== "cards" || isOwner).filter((tab) => tab.id !== "analytics" || canAnalyze);
  const [tab, setTab] = useState("settings");
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [settingsExists, setSettingsExists] = useState(false);
  const [products, setProducts] = useState<ListingPage>(emptyListingPage);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [debouncedProductSearch, setDebouncedProductSearch] = useState("");
  const [productCategoryId, setProductCategoryId] = useState("");
  const [productPage, setProductPage] = useState(1);
  const [productPageSize, setProductPageSize] = useState(20);
  const [productRefresh, setProductRefresh] = useState(0);
  const [cards, setCards] = useState<Card[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [orders, setOrders] = useState<Page<OrderSummary>>({ items: [], nextCursor: null, hasMore: false });
  const [orderStatus, setOrderStatus] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [days, setDays] = useState("7");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [listingEdits, setListingEdits] = useState<Record<string, ListingConfig>>({});
  const [cardDraft, setCardDraft] = useState({ financeAccountId: "", bankName: "", holderName: "", cardNumber: "", label: "", instructions: "" });

  const loadCards = async () => {
    const [nextCards, nextAccounts] = await Promise.all([get<Card[]>("/storefront/cards"), get<Account[]>("/finance/accounts")]);
    setCards(nextCards); setAccounts(nextAccounts.filter((account) => account.kind === "BANK"));
    if (!cardDraft.financeAccountId) setCardDraft((current) => ({ ...current, financeAccountId: nextAccounts.find((account) => account.kind === "BANK")?.id ?? "" }));
  };
  const loadOrders = async (cursor?: string, append = false, status = orderStatus) => {
    const params = new URLSearchParams({ limit: "20" }); if (status) params.set("status", status); if (cursor) params.set("cursor", cursor);
    const result = await get<Page<OrderSummary>>(`/storefront/orders?${params}`);
    setOrders((current) => append ? { ...result, items: [...current.items, ...result.items] } : result);
  };
  const loadAnalytics = async (range = days) => setAnalytics(await get<Analytics>(`/storefront/analytics?days=${range}`));

  useEffect(() => {
    let active = true; setLoading(true); setError("");
    void get<{ settings: Settings | null }>("/storefront").then((result) => {
      if (!active) return; setSettingsExists(Boolean(result.settings)); setSettings(result.settings ?? emptySettings);
    }).catch((cause) => { if (active) setError(messageOf(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => { setDebouncedProductSearch(productSearch.trim()); setProductPage(1); }, 220);
    return () => window.clearTimeout(timeout);
  }, [productSearch]);

  useEffect(() => {
    if (tab !== "products" || !settingsExists) return;
    let active = true; setProductsLoading(true); setError("");
    const params = new URLSearchParams({ page: String(productPage), limit: String(productPageSize) });
    if (productCategoryId) params.set("categoryId", productCategoryId);
    if (debouncedProductSearch) params.set("q", debouncedProductSearch);
    void get<ListingPage>(`/storefront/listings?${params.toString()}`).then((result) => {
      if (!active) return;
      setProducts(result);
      setListingEdits((current) => ({ ...Object.fromEntries(result.items.map((item) => [item.productId, { ...item.listing }])), ...current }));
    }).catch((cause) => { if (active) setError(messageOf(cause)); }).finally(() => { if (active) setProductsLoading(false); });
    return () => { active = false; };
  }, [tab, settingsExists, productPage, productPageSize, productCategoryId, debouncedProductSearch, productRefresh]);

  useEffect(() => {
    if (tab === "settings" || tab === "products" || !settingsExists) return;
    let active = true; setLoading(true); setError(""); setNotice("");
    const loader = tab === "orders" ? () => loadOrders(undefined, false) : tab === "cards" ? loadCards : () => loadAnalytics();
    void loader().catch((cause) => { if (active) setError(messageOf(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tab, settingsExists]);

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const result = await patch<{ settings: Settings }>("/storefront", {
        publicName: settings.publicName,
        slug: settings.slug,
        description: settings.description,
        phone: settings.phone || undefined,
        address: settings.address,
        showAddress: settings.showAddress,
        acceptsPickup: settings.acceptsPickup,
        acceptsLocalDelivery: settings.acceptsLocalDelivery,
        deliveryFeeRial: settings.deliveryFeeRial,
        showExactStock: settings.showExactStock,
        preparationMinutes: settings.preparationMinutes ?? undefined,
        paymentInstructions: settings.paymentInstructions,
        cancellationPolicy: settings.cancellationPolicy,
        status: settings.status,
      });
      setSettings(result.settings); setSettingsExists(true); setNotice("تنظیمات فروشگاه ذخیره شد.");
    }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };

  const saveListing = async (item: ListingProduct) => {
    const value = listingEdits[item.productId]; if (!value) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await patch(`/storefront/listings/${item.productId}`, {
        publicTitle: value.publicTitle,
        publicDescription: value.publicDescription,
        publicPriceRial: storefrontPriceOverride(item, value),
        isPublished: value.isPublished,
        canOrder: value.canOrder,
        stockPolicy: value.stockPolicy,
        minimumQuantity: value.minimumQuantity,
        maximumQuantity: value.maximumQuantity || undefined,
        displayOrder: value.displayOrder,
      });
      setNotice(`تنظیم «${item.name}» ذخیره شد.`); setProductRefresh((current) => current + 1);
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };

  const createCard = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { await post("/storefront/cards", { ...cardDraft, displayOrder: cards.length }); setCardDraft({ financeAccountId: accounts[0]?.id ?? "", bankName: "", holderName: "", cardNumber: "", label: "", instructions: "" }); setNotice("کارت مقصد ثبت شد."); await loadCards(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };

  const openOrder = async (id: string) => {
    setError(""); setSelectedOrder(null); setBusy(true);
    try { setSelectedOrder(await get<OrderDetail>(`/storefront/orders/${id}`)); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const refreshSelected = async () => { if (selectedOrder) await openOrder(selectedOrder.id); await loadOrders(undefined, false); };
  const orderAction = async (path: string, body?: unknown) => {
    if (!selectedOrder) return;
    setBusy(true); setError(""); setNotice("");
    try { await post(`/storefront/orders/${selectedOrder.id}/${path}`, body); setNotice("تغییر سفارش ثبت شد."); await refreshSelected(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const transition = async (status: string, reason?: string) => {
    if (!selectedOrder) return;
    setBusy(true); setError(""); setNotice("");
    try { await post(`/storefront/orders/${selectedOrder.id}/transition`, { status, ...(reason ? { reason } : {}) }); setNotice("وضعیت سفارش به‌روزرسانی شد."); await refreshSelected(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const verifyAttempt = async (attemptId: string, amount: string, reference: string) => {
    if (!selectedOrder) return;
    setBusy(true); setError(""); setNotice("");
    try { await post(`/storefront/orders/${selectedOrder.id}/payments/${attemptId}/verify`, { verifiedAmountRial: amount, transactionReference: reference }); setNotice("واریز در حساب مالی شعبه ثبت و به سفارش تخصیص یافت."); await refreshSelected(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const rejectAttempt = async (attemptId: string) => {
    const reason = window.prompt("دلیل رد رسید را بنویسید:"); if (!reason?.trim() || !selectedOrder) return;
    setBusy(true); setError(""); setNotice("");
    try { await post(`/storefront/orders/${selectedOrder.id}/payments/${attemptId}/reject`, { reason }); setNotice("رسید رد شد و دلیل برای مشتری ثبت شد."); await refreshSelected(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const resolveOverpayment = async (attemptId: string) => {
    if (!selectedOrder || !window.confirm("تراکنش بانکی را تطبیق داده‌اید؟ مبلغ کامل به دریافت بانکی ثبت می‌شود و مبلغ مازاد به‌عنوان اعتبار طرف‌حساب می‌ماند؛ بازپرداخت ثبت نمی‌شود.")) return;
    setBusy(true); setError(""); setNotice("");
    try { const result = await post<{ customerCreditRial: string }>(`/storefront/orders/${selectedOrder.id}/payments/${attemptId}/resolve-overpayment`, {}); setNotice(`دریافت ثبت شد؛ ${money(result.customerCreditRial)} به‌عنوان اعتبار مشتری باقی ماند و بازپرداختی ثبت نشد.`); await refreshSelected(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const downloadReceipt = async (path: string) => {
    try { const blob = await downloadFile(path); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    catch (cause) { setError(messageOf(cause)); }
  };
  const toggleCard = async (card: Card) => {
    setBusy(true); setError("");
    try { await patch(`/storefront/cards/${card.id}`, { isActive: !card.isActive, displayOrder: card.displayOrder }); await loadCards(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const moveCard = async (card: Card, direction: -1 | 1) => {
    const ordered = [...cards].sort((left, right) => left.displayOrder - right.displayOrder);
    const index = ordered.findIndex((item) => item.id === card.id); const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    setBusy(true); setError("");
    try { await Promise.all(ordered.map((item, position) => patch(`/storefront/cards/${item.id}`, { isActive: item.isActive, displayOrder: position }))); await loadCards(); setNotice("ترتیب کارت‌های مقصد ذخیره شد."); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };

  if (loading && tab === "settings" && !settingsExists && !error) return <div className="sf-admin page-wrap"><div className="sf-card sf-state">در حال بارگذاری فروشگاه…</div></div>;
  return <main className="sf-admin page-wrap" dir="rtl">
    <header className="sf-admin-heading"><div className="sf-admin-title-group"><span className="sf-admin-hero-icon"><Store size={24} /></span><div><span className="sf-eyebrow">مدیریت فروش آنلاین شعبه</span><h1>فروشگاه عمومی</h1><p>ویترین، کالاهای قابل سفارش، پرداخت و تحویل همین شعبه را یک‌جا مدیریت کنید.</p></div></div><div className="sf-admin-heading-actions"><span className={`sf-open-badge ${settings.status === "PUBLISHED" ? "is-open" : settings.status === "PAUSED" ? "is-paused" : "is-closed"}`}><i />{settings.status === "PUBLISHED" ? "منتشرشده" : settings.status === "PAUSED" ? "متوقف" : "پیش‌نویس"}</span>{settings.publicUrl && <a className="sf-button sf-secondary" href={settings.publicUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />مشاهدهٔ فروشگاه</a>}</div></header>
    {settingsExists && <section className="sf-admin-overview"><div className="sf-admin-overview-copy"><span className="sf-eyebrow">ویترین آنلاین شعبه</span><h2>{settings.publicName || "فروشگاه شما"}</h2><p>{settings.status === "PUBLISHED" ? "فروشگاه منتشر شده است؛ تنظیمات و سفارش‌های عمومی را از این صفحه دنبال کنید." : settings.status === "PAUSED" ? "ثبت سفارش تازه متوقف است. می‌توانید تنظیمات فروشگاه را بازبینی کنید." : "اطلاعات فروشگاه را کامل کنید تا برای انتشار آماده شود."}</p><div className="sf-admin-overview-meta"><span><Store size={15} />{settings.slug ? `/s/${settings.slug}` : "پیوند فروشگاه هنوز تنظیم نشده"}</span><span><ShoppingBag size={15} />{[settings.acceptsPickup && "تحویل حضوری", settings.acceptsLocalDelivery && "ارسال محلی"].filter(Boolean).join(" · ") || "روش تحویل تنظیم نشده"}</span></div></div><div className="sf-admin-overview-action">{settings.publicUrl ? <a className="sf-button sf-primary" href={settings.publicUrl} target="_blank" rel="noreferrer">ورود به ویترین<ArrowUpRight size={17} /></a> : <span className="sf-admin-setup-note">با ذخیرهٔ نام و نشانی فروشگاه، پیوند عمومی ساخته می‌شود.</span>}</div></section>}
    {error && <div className="sf-alert sf-alert-error" role="alert">{error} <button type="button" className="sf-link-button" onClick={() => { setError(""); if (tab === "orders") void loadOrders(); }}>بستن</button></div>}{notice && <div className="sf-alert sf-alert-success" role="status">{notice}</div>}
    {settingsExists && <nav className="sf-admin-tabs" aria-label="بخش‌های فروشگاه">{visibleTabs.map((item) => <button type="button" className={tab === item.id ? "active" : ""} key={item.id} onClick={() => { setTab(item.id); setSelectedOrder(null); }}><item.icon size={16} /><span>{item.label}</span></button>)}</nav>}
    {!settingsExists || tab === "settings" ? <SettingsPanel settings={settings} setSettings={setSettings} exists={settingsExists} canManage={canManage} busy={busy} onSubmit={(event) => void saveSettings(event)} /> : tab === "products" ? <ProductsPanel products={products} edits={listingEdits} setEdits={setListingEdits} canManage={canManage} busy={busy} loading={productsLoading} search={productSearch} setSearch={setProductSearch} categoryId={productCategoryId} onCategoryChange={(value) => { setProductCategoryId(value); setProductPage(1); }} page={productPage} pageSize={productPageSize} onPageChange={setProductPage} onPageSizeChange={(value) => { setProductPageSize(value); setProductPage(1); }} onSave={(item) => void saveListing(item)} /> : loading ? <div className="sf-card sf-state">در حال بارگذاری…</div> : <>
      {tab === "cards" && isOwner && <CardsPanel cards={cards} accounts={accounts} draft={cardDraft} setDraft={setCardDraft} busy={busy} onSubmit={(event) => void createCard(event)} onToggle={(card) => void toggleCard(card)} onMove={(card, direction) => void moveCard(card, direction)} />}
      {tab === "orders" && <OrdersPanel orders={orders} status={orderStatus} setStatus={(value) => { setOrderStatus(value); void loadOrders(undefined, false, value); }} onMore={() => { if (orders.nextCursor) void loadOrders(orders.nextCursor, true); }} onOpen={(id) => void openOrder(id)} selected={selectedOrder} loading={busy} canReview={isOwner} canManage={role === "OWNER" || role === "MANAGER"} onAccept={() => void orderAction("accept")} onReject={() => { const reason = window.prompt("دلیل رد سفارش را بنویسید:"); if (reason?.trim()) void orderAction("reject", { reason }); }} onTransition={(status) => void transition(status)} onCancel={() => { const reason = window.prompt("دلیل لغو سفارش را بنویسید:"); if (reason?.trim()) void transition("CANCELLED", reason); }} onVerify={(attemptId, amount, reference) => void verifyAttempt(attemptId, amount, reference)} onRejectAttempt={(attemptId) => void rejectAttempt(attemptId)} onResolveOverpayment={(attemptId) => void resolveOverpayment(attemptId)} onReceipt={(path) => void downloadReceipt(path)} onClose={() => setSelectedOrder(null)} />}
      {tab === "analytics" && analytics && <AnalyticsPanel analytics={analytics} days={days} setDays={(value) => { setDays(value); void loadAnalytics(value); }} />}
    </>}
  </main>;
}

function SettingsPanel({ settings, setSettings, exists, canManage, busy, onSubmit }: { settings: Settings; setSettings: (value: Settings) => void; exists: boolean; canManage: boolean; busy: boolean; onSubmit: (event: FormEvent) => void }) {
  const field = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings({ ...settings, [key]: value });
  return <form className="sf-card sf-admin-form" onSubmit={onSubmit}><div className="sf-section-head"><div><span className="sf-eyebrow">اطلاعات عمومی</span><h2>{exists ? "تنظیمات فروشگاه" : "ساخت فروشگاه این شعبه"}</h2></div>{settings.publicUrl && <a className="sf-button sf-secondary" href={settings.publicUrl} target="_blank" rel="noreferrer">مشاهدهٔ فروشگاه</a>}</div><div className="sf-form-grid"><label>نام نمایشی فروشگاه<input required maxLength={120} value={settings.publicName} disabled={!canManage} onChange={(event) => field("publicName", event.target.value)} /></label><label>نشانی انگلیسی فروشگاه<input required dir="ltr" minLength={3} maxLength={80} pattern="[a-zA-Z0-9-]+" value={settings.slug} disabled={!canManage} onChange={(event) => field("slug", event.target.value.toLowerCase())} placeholder="example-store" /><small>پیوند عمومی: /s/{settings.slug || "your-store"}</small></label><label className="sf-span-all">توضیحات<input maxLength={1000} value={settings.description} disabled={!canManage} onChange={(event) => field("description", event.target.value)} /></label><label>شمارهٔ تماس فروشگاه<input dir="ltr" inputMode="tel" value={settings.phone} disabled={!canManage} onChange={(event) => field("phone", event.target.value)} /></label><label>مدت آماده‌سازی به دقیقه<input type="number" min="0" max="10080" value={settings.preparationMinutes ?? ""} disabled={!canManage} onChange={(event) => field("preparationMinutes", event.target.value ? Number(event.target.value) : null)} /></label><label className="sf-span-all">نشانی شعبه<input maxLength={500} value={settings.address} disabled={!canManage} onChange={(event) => field("address", event.target.value)} /></label><label>هزینهٔ ارسال محلی به ریال<input dir="ltr" inputMode="numeric" value={settings.deliveryFeeRial} disabled={!canManage} onChange={(event) => field("deliveryFeeRial", event.target.value.replace(/\D/g, ""))} /></label><label>وضعیت انتشار<select value={settings.status} disabled={!canManage} onChange={(event) => field("status", event.target.value as Settings["status"])}><option value="DRAFT">پیش‌نویس</option><option value="PUBLISHED">انتشار و پذیرش سفارش</option><option value="PAUSED">توقف سفارش جدید</option></select></label><label className="sf-span-all">راهنمای پرداخت کارت‌به‌کارت<textarea maxLength={1000} value={settings.paymentInstructions} disabled={!canManage} onChange={(event) => field("paymentInstructions", event.target.value)} rows={2} /></label><label className="sf-span-all">قانون لغو سفارش<textarea maxLength={1000} value={settings.cancellationPolicy} disabled={!canManage} onChange={(event) => field("cancellationPolicy", event.target.value)} rows={2} /></label></div><div className="sf-check-grid"><Check label="تحویل حضوری فعال است" checked={settings.acceptsPickup} disabled={!canManage} onChange={(value) => field("acceptsPickup", value)} /><Check label="ارسال محلی فعال است" checked={settings.acceptsLocalDelivery} disabled={!canManage} onChange={(value) => field("acceptsLocalDelivery", value)} /><Check label="نمایش نشانی شعبه در فروشگاه" checked={settings.showAddress} disabled={!canManage} onChange={(value) => field("showAddress", value)} /><Check label="نمایش تعداد دقیق موجودی" checked={settings.showExactStock} disabled={!canManage} onChange={(value) => field("showExactStock", value)} /></div>{canManage && <button className="sf-button sf-primary" disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیرهٔ تنظیمات"}</button>}<p className="sf-footnote">سفارش جدید فقط زمانی پذیرفته می‌شود که فروشگاه منتشر باشد و اشتراک شعبه اجازه دهد.</p></form>;
}

function ProductsPanel({ products, edits, setEdits, canManage, busy, loading, search, setSearch, categoryId, onCategoryChange, page, pageSize, onPageChange, onPageSizeChange, onSave }: {
  products: ListingPage;
  edits: Record<string, ListingConfig>;
  setEdits: (value: Record<string, ListingConfig> | ((current: Record<string, ListingConfig>) => Record<string, ListingConfig>)) => void;
  canManage: boolean;
  busy: boolean;
  loading: boolean;
  search: string;
  setSearch: (value: string) => void;
  categoryId: string;
  onCategoryChange: (value: string) => void;
  page: number;
  pageSize: number;
  onPageChange: (value: number) => void;
  onPageSizeChange: (value: number) => void;
  onSave: (item: ListingProduct) => void;
}) {
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const update = (id: string, key: keyof ListingConfig, value: ListingConfig[keyof ListingConfig]) => setEdits((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));
  const allCount = products.categories.reduce((sum, category) => sum + category.count, 0);
  const firstPage = Math.max(1, Math.min(page - 2, products.totalPages - 4));
  const pageNumbers = Array.from({ length: Math.min(5, products.totalPages) }, (_, index) => firstPage + index);
  const start = products.total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, products.total);
  const stockPolicyLabels: Record<ListingConfig["stockPolicy"], string> = { EXACT: "تعداد دقیق", APPROXIMATE: "موجود / ناموجود", INQUIRY: "استعلام" };

  return <section className="sf-admin-products" aria-busy={loading}>
    <div className="sf-section-head">
      <div><span className="sf-eyebrow">فهرست کالاهای شعبه</span><h2>مدیریت نمایش کالا در فروشگاه</h2></div>
      <span>{faNumber(products.total)} مورد{loading ? " · در حال به‌روزرسانی" : ""}</span>
    </div>
    <div className="sf-products-toolbar">
      <label className="sf-products-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جست‌وجوی نام، کد یا بارکد" aria-label="جست‌وجوی کالاهای فروشگاه" /></label>
      <label className="sf-page-size"><span>نمایش</span><select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}><option value={10}>۱۰</option><option value={20}>۲۰</option><option value={50}>۵۰</option></select><span>مورد</span></label>
    </div>
    <div className="sf-admin-category-chips" role="group" aria-label="فیلتر دسته‌بندی کالاها">
      <button type="button" className={!categoryId ? "active" : ""} aria-pressed={!categoryId} onClick={() => onCategoryChange("")}>همه <small>{faNumber(allCount)}</small></button>
      {products.categories.map((category) => <button type="button" key={category.id ?? "uncategorized"} className={categoryId === (category.id ?? "uncategorized") ? "active" : ""} aria-pressed={categoryId === (category.id ?? "uncategorized")} onClick={() => onCategoryChange(category.id ?? "uncategorized")}>{category.name} <small>{faNumber(category.count)}</small></button>)}
    </div>
    {!products.total && !loading ? <div className="sf-card sf-empty">{search || categoryId ? <><strong>کالایی با این فیلتر پیدا نشد.</strong><button type="button" className="sf-link-button" onClick={() => { setSearch(""); onCategoryChange(""); }}>پاک‌کردن فیلترها</button></> : "ابتدا کالا یا خدمت را در بخش اطلاعات پایه ثبت کنید."}</div> : <div className="sf-listing-list">
      {loading && <p className="sf-products-fetching" role="status">در حال دریافت فهرست…</p>}
      {products.items.map((item) => {
        const edit = edits[item.productId] ?? item.listing;
        const expanded = expandedProductId === item.productId;
        const publicPrice = edit.publicPriceRial || item.salePriceRial;
        return <article className={"sf-card sf-listing-row " + (expanded ? "is-expanded" : "")} key={item.productId}>
          <button type="button" className="sf-listing-summary" aria-expanded={expanded} aria-controls={"listing-fields-" + item.productId} onClick={() => setExpandedProductId(expanded ? null : item.productId)}>
            <span className="sf-listing-identity" title={item.name + " · " + (item.category ?? "بدون دسته‌بندی") + " · " + item.unit}><strong>{item.name}</strong><small>{item.category ?? "بدون دسته‌بندی"} · {item.kind === "SERVICE" ? "خدمت" : "کالا"} · {item.unit}{item.trackInventory ? " · موجودی " + faNumber(item.quantityOnHand) : ""}</small></span>
            <span className="sf-listing-public-title" title={"عنوان فروشگاه: " + (edit.publicTitle.trim() || item.name) + (edit.publicDescription ? " · " + edit.publicDescription : "")} aria-label={"اطلاعات نمایش در فروشگاه: " + (edit.publicTitle.trim() || item.name)}><strong>{edit.publicTitle.trim() || item.name}</strong>{edit.publicDescription && <small> · {edit.publicDescription}</small>}</span>
            <span className="sf-listing-public-price" title="قیمت فروشگاه"><strong>{money(publicPrice, "IRR")}</strong></span>
            <span className="sf-listing-status"><span className={"sf-badge " + (edit.isPublished ? "is-good" : "")}>{edit.isPublished ? "منتشرشده" : item.isConfigured ? "پنهان" : "تنظیم‌نشده"}</span><span className={"sf-badge " + (edit.canOrder ? "is-good" : "")}>{edit.canOrder ? "سفارش‌پذیر" : "سفارش بسته"}</span><small>موجودی: {stockPolicyLabels[edit.stockPolicy]}</small></span>
            <ChevronDown size={17} className={expanded ? "is-open" : ""} aria-hidden="true" />
          </button>
          {expanded && <div className="sf-listing-editor" id={"listing-fields-" + item.productId}>
            <StorefrontListingFields item={item} value={edit} canManage={canManage} busy={busy} onChange={(key, value) => update(item.productId, key, value)} onSave={() => onSave(item)} />
          </div>}
        </article>;
      })}
    </div>}
    {products.total > 0 && <nav className="sf-pagination" aria-label="صفحه‌بندی فهرست کالاها">
      <span className="sf-pagination-range">{faNumber(start)} تا {faNumber(end)} از {faNumber(products.total)} کالا</span>
      <div className="sf-pagination-controls">
        <button type="button" className="sf-page-button" aria-label="صفحهٔ قبل" title="صفحهٔ قبل" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}><ChevronRight size={16} />قبلی</button>
        {pageNumbers.map((number) => <button type="button" key={number} className={"sf-page-number " + (number === page ? "active" : "")} aria-current={number === page ? "page" : undefined} onClick={() => onPageChange(number)} disabled={loading}>{faNumber(number)}</button>)}
        <button type="button" className="sf-page-button" aria-label="صفحهٔ بعد" title="صفحهٔ بعد" disabled={page >= products.totalPages || loading} onClick={() => onPageChange(page + 1)}>بعدی<ChevronLeft size={16} /></button>
      </div>
      <span className="sf-pagination-total">صفحهٔ {faNumber(page)} از {faNumber(products.totalPages)}</span>
    </nav>}
  </section>;
}function CardsPanel({ cards, accounts, draft, setDraft, busy, onSubmit, onToggle, onMove }: { cards: Card[]; accounts: Account[]; draft: { financeAccountId: string; bankName: string; holderName: string; cardNumber: string; label: string; instructions: string }; setDraft: (value: { financeAccountId: string; bankName: string; holderName: string; cardNumber: string; label: string; instructions: string }) => void; busy: boolean; onSubmit: (event: FormEvent) => void; onToggle: (card: Card) => void; onMove: (card: Card, direction: -1 | 1) => void }) {
  return <section className="sf-card sf-admin-form"><div className="sf-section-head"><div><span className="sf-eyebrow">تنظیمات مالک</span><h2>کارت‌های مقصد پرداخت</h2></div></div><div className="sf-alert sf-alert-neutral">شمارهٔ کارت فقط برای نمایش به مشتری ذخیره می‌شود. هیچ اطلاعات کارت مشتری دریافت نمی‌شود. دریافت‌های تأییدشده به حساب بانکی انتخاب‌شده ثبت می‌شوند.</div>{cards.length ? <div className="sf-admin-card-list">{[...cards].sort((left, right) => left.displayOrder - right.displayOrder).map((card, index, ordered) => <article className="sf-bank-card" key={card.id}><div><b>{card.bankName}</b><span className={`sf-badge ${card.isActive && card.accountActive ? "is-good" : ""}`}>{card.isActive && card.accountActive ? "فعال" : "غیرفعال"}</span></div><strong className="sf-card-number" dir="ltr">{card.maskedCardNumber}</strong><div className="sf-card-foot"><span>{card.holderName} · حساب: {card.financeAccountName}</span><div className="sf-card-tools"><button type="button" aria-label="انتقال کارت به بالا" disabled={busy || index === 0} onClick={() => onMove(card, -1)}>↑</button><button type="button" aria-label="انتقال کارت به پایین" disabled={busy || index === ordered.length - 1} onClick={() => onMove(card, 1)}>↓</button><button type="button" className="sf-link-button" disabled={busy} onClick={() => onToggle(card)}>{card.isActive ? "غیرفعال‌کردن" : "فعال‌کردن"}</button></div></div>{card.label && <small>{card.label}</small>}</article>)}</div> : <p className="sf-empty">کارت مقصدی ثبت نشده است.</p>}<form className="sf-form-grid sf-card-create" onSubmit={onSubmit}><h3 className="sf-span-all">افزودن کارت مقصد</h3><label>حساب بانکی فعال<select required value={draft.financeAccountId} onChange={(event) => setDraft({ ...draft, financeAccountId: event.target.value })}><option value="">انتخاب حساب</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>{accounts.length === 0 && <small>ابتدا یک حساب از نوع «بانک» در بخش مالی بسازید.</small>}</label><label>نام بانک<input required maxLength={80} value={draft.bankName} onChange={(event) => setDraft({ ...draft, bankName: event.target.value })} /></label><label>نام صاحب کارت<input required maxLength={120} value={draft.holderName} onChange={(event) => setDraft({ ...draft, holderName: event.target.value })} /></label><label>شمارهٔ کارت ۱۶ رقمی<input required dir="ltr" inputMode="numeric" autoComplete="off" maxLength={23} value={draft.cardNumber} onChange={(event) => setDraft({ ...draft, cardNumber: event.target.value.replace(/[^0-9۰-۹٠-٩]/g, "").slice(0, 16) })} /></label><label>عنوان اختیاری<input maxLength={80} value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label><label className="sf-span-all">راهنمای پرداخت برای این کارت<input maxLength={500} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} /></label><button className="sf-button sf-primary sf-span-all" disabled={busy || !draft.financeAccountId}>ثبت کارت مقصد</button></form></section>;
}

function OrdersPanel({ orders, status, setStatus, onMore, onOpen, selected, loading, canReview, canManage, onAccept, onReject, onTransition, onCancel, onVerify, onRejectAttempt, onResolveOverpayment, onReceipt, onClose }: { orders: Page<OrderSummary>; status: string; setStatus: (value: string) => void; onMore: () => void; onOpen: (id: string) => void; selected: OrderDetail | null; loading: boolean; canReview: boolean; canManage: boolean; onAccept: () => void; onReject: () => void; onTransition: (status: string) => void; onCancel: () => void; onVerify: (attemptId: string, amount: string, reference: string) => void; onRejectAttempt: (attemptId: string) => void; onResolveOverpayment: (attemptId: string) => void; onReceipt: (path: string) => void; onClose: () => void }) {
  return <section className="sf-orders"><div className="sf-section-head"><div><span className="sf-eyebrow">سفارش‌های همین شعبه</span><h2>پیگیری و تحویل</h2></div><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">همهٔ وضعیت‌ها</option>{Object.entries(orderLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>{selected ? <OrderDetails order={selected} loading={loading} canReview={canReview} canManage={canManage} onAccept={onAccept} onReject={onReject} onTransition={onTransition} onCancel={onCancel} onVerify={onVerify} onRejectAttempt={onRejectAttempt} onResolveOverpayment={onResolveOverpayment} onReceipt={onReceipt} onClose={onClose} /> : orders.items.length ? <><div className="sf-order-list">{orders.items.map((order) => <button type="button" className="sf-card sf-order-row" key={order.id} onClick={() => onOpen(order.id)}><span><b>{order.publicCode}</b><small>{order.customerName} · {new Date(order.createdAt).toLocaleDateString("fa-IR")}</small></span><span><b>{orderLabels[order.status] ?? order.status}</b><small>{paymentLabels[order.paymentStatus] ?? order.paymentStatus}</small></span><strong>{money(order.totalRial)}</strong><span className="sf-order-arrow">←</span></button>)}</div>{orders.hasMore && <button className="sf-button sf-secondary" type="button" onClick={onMore}>نمایش سفارش‌های بیشتر</button>}</> : <div className="sf-card sf-empty">سفارشی با این وضعیت ثبت نشده است.</div>}</section>;
}

function OrderDetails({ order, loading, canReview, canManage, onAccept, onReject, onTransition, onCancel, onVerify, onRejectAttempt, onResolveOverpayment, onReceipt, onClose }: { order: OrderDetail; loading: boolean; canReview: boolean; canManage: boolean; onAccept: () => void; onReject: () => void; onTransition: (status: string) => void; onCancel: () => void; onVerify: (attemptId: string, amount: string, reference: string) => void; onRejectAttempt: (attemptId: string) => void; onResolveOverpayment: (attemptId: string) => void; onReceipt: (path: string) => void; onClose: () => void }) {
  const [amounts, setAmounts] = useState<Record<string, string>>({}); const [references, setReferences] = useState<Record<string, string>>({});
  const next = order.status === "ACCEPTED" ? "PREPARING" : order.status === "PREPARING" ? "READY" : order.status === "READY" ? order.deliveryMethod === "PICKUP" ? "READY_FOR_PICKUP" : "OUT_FOR_DELIVERY" : ["READY_FOR_PICKUP", "OUT_FOR_DELIVERY"].includes(order.status) ? "COMPLETED" : null;
  return <article className="sf-card sf-order-detail"><div className="sf-section-head"><div><span className="sf-eyebrow">جزئیات سفارش</span><h2>{order.publicCode}</h2></div><button className="sf-link-button" type="button" onClick={onClose}>بازگشت به فهرست</button></div><div className="sf-detail-grid"><Detail label="مشتری" value={order.customer.name} /><Detail label="موبایل" value={order.customer.phone} /><Detail label="وضعیت" value={orderLabels[order.status] ?? order.status} /><Detail label="وضعیت پرداخت" value={paymentLabels[order.paymentStatus] ?? order.paymentStatus} /><Detail label="مبلغ سفارش" value={money(order.totalRial)} /><Detail label="مبلغ تأییدشده" value={money(order.verifiedAmountRial)} /><Detail label="روش تحویل" value={order.deliveryMethod === "PICKUP" ? "حضوری" : "ارسال محلی"} />{order.paymentDueAt && <Detail label="مهلت پرداخت" value={new Date(order.paymentDueAt).toLocaleString("fa-IR")} />}</div>{order.customer.address && <p>نشانی: {order.customer.address}</p>}{order.customer.note && <p>یادداشت مشتری: {order.customer.note}</p>}
    <div className="sf-lines">{order.items.map((item) => <div className="sf-line" key={item.id}><div><strong>{item.title}</strong><small>{item.quantity} {item.unitCode} · {item.sku}</small></div><b>{money(item.lineTotalRial)}</b></div>)}</div>
    {order.paymentAttempts.length > 0 && <section className="sf-attempts"><h3>رسیدهای پرداخت</h3>{order.paymentAttempts.map((attempt) => <article className="sf-payment-review" key={attempt.id}><div className="sf-payment-head"><span><b>{attempt.status === "UNDER_REVIEW" ? "در انتظار بررسی" : attempt.status === "OVERPAID_REVIEW" ? "اضافه‌پرداخت در بررسی دستی" : attempt.status}</b><small>{attempt.receipt?.uploadedAt ? new Date(attempt.receipt.uploadedAt).toLocaleString("fa-IR") : ""}</small></span><strong>{money(attempt.submittedAmountRial)}</strong></div>{attempt.card && <p>{attempt.card.bankName} · کارت پایان‌یافته به {attempt.card.last4}</p>}{attempt.customerTransactionReference && <p>شناسهٔ انتقال مشتری: {attempt.customerTransactionReference}</p>}{attempt.note && <p>{attempt.note}</p>}{attempt.receipt && <button className="sf-button sf-secondary" type="button" onClick={() => onReceipt(attempt.receipt!.downloadPath)}>نمایش رسید ({attempt.receipt.mimeType})</button>}{attempt.rejectionReason && <p className="sf-rejection">دلیل رد: {attempt.rejectionReason}</p>}{canReview && attempt.status === "UNDER_REVIEW" && <div className="sf-review-form"><label>مبلغ واقعاً واریزشده به ریال<input dir="ltr" inputMode="numeric" value={amounts[attempt.id] ?? attempt.submittedAmountRial} onChange={(event) => setAmounts({ ...amounts, [attempt.id]: event.target.value.replace(/\D/g, "") })} /></label><label>شناسهٔ سند بانکی<input dir="ltr" required minLength={3} maxLength={120} value={references[attempt.id] ?? ""} onChange={(event) => setReferences({ ...references, [attempt.id]: event.target.value })} /></label><button className="sf-button sf-primary" type="button" disabled={loading || !(references[attempt.id] ?? "").trim()} onClick={() => onVerify(attempt.id, amounts[attempt.id] ?? attempt.submittedAmountRial, references[attempt.id] ?? "")}>تأیید و ثبت در حسابداری</button><button className="sf-button sf-danger" type="button" disabled={loading} onClick={() => onRejectAttempt(attempt.id)}>رد رسید</button></div>}{canReview && attempt.status === "OVERPAID_REVIEW" && <div className="sf-alert sf-alert-neutral"><p>پس از تطبیق با گردش بانکی، ثبت کامل دریافت، سفارش را باز می‌کند و مازاد را به‌عنوان اعتبار مشتری نگه می‌دارد. این کار بازپرداخت انجام نمی‌دهد.</p><button className="sf-button sf-primary" type="button" disabled={loading} onClick={() => onResolveOverpayment(attempt.id)}>ثبت دریافت و نگه‌داشتن مازاد به‌عنوان اعتبار</button></div>}</article>)}</section>}
    <div className="sf-order-actions">{canManage && order.status === "SUBMITTED" && <><button className="sf-button sf-primary" type="button" disabled={loading} onClick={onAccept}>پذیرش سفارش و رزرو موجودی</button><button className="sf-button sf-danger" type="button" disabled={loading} onClick={onReject}>رد سفارش</button></>}{canManage && next && order.paymentStatus === "VERIFIED" && <button className="sf-button sf-primary" type="button" disabled={loading} onClick={() => onTransition(next)}>{next === "PREPARING" ? "شروع آماده‌سازی" : next === "READY" ? "اعلام آماده‌شدن" : next === "READY_FOR_PICKUP" ? "آمادهٔ دریافت حضوری" : next === "OUT_FOR_DELIVERY" ? "ثبت خروج برای ارسال" : "ثبت تحویل و فروش"}</button>}{canManage && ["ACCEPTED", "PREPARING", "READY"].includes(order.status) && !["VERIFIED", "OVERPAID_REVIEW"].includes(order.paymentStatus) && !order.paymentAttempts.some((attempt) => attempt.status === "UNDER_REVIEW") && <button className="sf-button sf-danger" type="button" disabled={loading} onClick={onCancel}>لغو سفارش با ثبت دلیل</button>}{order.salesInvoice && <span className="sf-badge is-good">فاکتور فروش {order.salesInvoice.invoiceNo ?? "ثبت‌شده"}</span>}</div>
  </article>;
}

function AnalyticsPanel({ analytics, days, setDays }: { analytics: Analytics; days: string; setDays: (value: string) => void }) {
  return <section className="sf-analytics"><div className="sf-section-head"><div><span className="sf-eyebrow">عملکرد همین شعبه</span><h2>گزارش فروشگاه</h2></div><select value={days} onChange={(event) => setDays(event.target.value)}><option value="7">۷ روز</option><option value="30">۳۰ روز</option><option value="90">۹۰ روز</option></select></div><div className="sf-metric-grid"><Metric label="سفارش‌های ثبت‌شده" value={String(Object.values(analytics.orderCounts).reduce((sum, count) => sum + count, 0))} detail={`مبلغ درخواست‌ها ${money(analytics.submittedOrderRial)}`} /><Metric label="رسیدهای در انتظار بررسی" value={String(analytics.receiptsWaitingReview)} detail="در صف تأیید مالک" /><Metric label="پرداخت‌های تأییدشده" value={money(analytics.verifiedPaymentRial)} detail={`${analytics.verifiedPaymentCount} واریز ثبت‌شده`} /><Metric label="فروش ثبت‌شده در حسابداری" value={money(analytics.postedSalesRial)} detail={`${analytics.postedSalesCount} فاکتور قطعی`} /></div><div className="sf-card sf-status-counts"><h3>وضعیت سفارش‌ها</h3>{Object.entries(analytics.orderCounts).length ? Object.entries(analytics.orderCounts).map(([status, count]) => <div key={status}><span>{orderLabels[status] ?? status}</span><b>{count}</b></div>) : <p>در این بازه سفارشی ثبت نشده است.</p>}</div><p className="sf-footnote">دریافت تأییدشده و فروش حسابداری جداگانه گزارش می‌شوند. مبلغ رسیدهای در انتظار بررسی فروش محسوب نمی‌شود.</p></section>;
}

function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) { return <label className="sf-check"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="sf-detail"><small>{label}</small><b>{value}</b></div>; }
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <article className="sf-card sf-metric"><small>{label}</small><strong>{value}</strong><span>{detail}</span></article>; }
function messageOf(error: unknown) { return error instanceof ApiError ? error.message : error instanceof Error ? error.message : "ارتباط با سرور انجام نشد. دوباره تلاش کنید."; }
