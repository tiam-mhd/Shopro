import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowDownLeft, ArrowUpRight, BookOpen, BriefcaseBusiness, Boxes, ChartNoAxesCombined, ChevronDown, CircleHelp, FileText, House, LogOut, Menu, PackagePlus, Plus, ReceiptText, Settings, ShoppingBag, ShoppingCart, UsersRound, Wallet, Wifi, WifiOff, X } from "lucide-react";
import type { BusinessSummary, MemberRole, SessionUser } from "@shopro/contracts";
import { ApiError, get, post } from "./lib/api.js";
import { faNumber, jalaliDate, money, todayISO } from "./lib/format.js";
import { countUnclaimedPendingSales, listPendingSales, removePendingSale, removeUnclaimedPendingSales, setPendingSaleError, type PendingSale } from "./lib/offline.js";
import { OptionPicker } from "./components/OptionPicker.js";
import type { PickerOptionLoader } from "./components/OptionPicker.js";

const SalesPage = lazy(() => import("./pages/Pages.js").then((module) => ({ default: module.SalesPage })));
const InvoicesPage = lazy(() => import("./pages/Pages.js").then((module) => ({ default: module.InvoicesPage })));
const InventoryPage = lazy(() => import("./pages/Pages.js").then((module) => ({ default: module.InventoryPage })));
const PurchasesPage = lazy(() => import("./pages/Pages.js").then((module) => ({ default: module.PurchasesPage })));
const ExpensesPage = lazy(() => import("./pages/Pages.js").then((module) => ({ default: module.ExpensesPage })));
const FinancePage = lazy(() => import("./pages/Pages.js").then((module) => ({ default: module.FinancePage })));
const ReportsPage = lazy(() => import("./pages/Pages.js").then((module) => ({ default: module.ReportsPage })));
const LedgerPage = lazy(() => import("./pages/LedgerPage.js").then((module) => ({ default: module.LedgerPage })));
const PartiesPage = lazy(() => import("./pages/MasterDataPages.js").then((module) => ({ default: module.PartiesPage })));
const ProductsPage = lazy(() => import("./pages/MasterDataPages.js").then((module) => ({ default: module.ProductsPage })));
const PartyDetailsPage = lazy(() => import("./pages/DetailPages.js").then((module) => ({ default: module.PartyDetailsPage })));
const ProductDetailsPage = lazy(() => import("./pages/DetailPages.js").then((module) => ({ default: module.ProductDetailsPage })));
const InvoiceDetailsPage = lazy(() => import("./pages/DetailPages.js").then((module) => ({ default: module.InvoiceDetailsPage })));
const PurchaseDetailsPage = lazy(() => import("./pages/DetailPages.js").then((module) => ({ default: module.PurchaseDetailsPage })));
const ExpenseDetailsPage = lazy(() => import("./pages/DetailPages.js").then((module) => ({ default: module.ExpenseDetailsPage })));
const FinanceDetailsPage = lazy(() => import("./pages/DetailPages.js").then((module) => ({ default: module.FinanceDetailsPage })));
const StockCountDetailsPage = lazy(() => import("./pages/DetailPages.js").then((module) => ({ default: module.StockCountDetailsPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage.js").then((module) => ({ default: module.SettingsPage })));

type SessionResponse = { user: SessionUser & { businessId?: string; branchId?: string; role?: MemberRole } };
type Dashboard = { displayCurrency: "IRR" | "IRT"; salesRial: string; netSalesRial: string; receiptsRial: string; expensesRial: string; grossProfitRial: string | null; grossProfitAvailable: boolean; salesCount: number; expenseCount: number; accountBalances: Array<{ id: string; name: string; balanceRial: string }>; cashPositionRial: string; lowStock: Array<{ id: string; name: string; quantity: string; reorderPoint: string; unit: string }>; openInvoices: number; salesTrend: Array<{ date: string; totalRial: string }> };

export function App() { return <BrowserRouter><AppContent /></BrowserRouter>; }

function AppContent() {
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: ["session"], queryFn: () => get<SessionResponse>("/auth/session"), retry: false });
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingItems, setPendingItems] = useState<PendingSale[]>([]);
  const [unclaimedPendingCount, setUnclaimedPendingCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("shopro_theme") ?? "auto");
  const [syncError, setSyncError] = useState("");
  const location = useLocation();
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => {
    const userId = session.data?.user.id;
    if (!userId) { setPendingItems([]); setPendingCount(0); return; }
    let mounted = true;
    void Promise.all([listPendingSales(), countUnclaimedPendingSales()]).then(([items, unclaimedCount]) => {
      if (!mounted) return;
      const owned = items.filter((item) => item.userId === userId);
      setPendingItems(owned); setPendingCount(owned.length);
      setUnclaimedPendingCount(unclaimedCount);
    });
    return () => { mounted = false; };
  }, [session.data?.user.id]);
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  useEffect(() => {
    const root = document.documentElement;
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      root.dataset.theme = theme === "auto" ? (systemTheme.matches ? "dark" : "light") : theme;
      localStorage.setItem("shopro_theme", theme);
    };
    applyTheme();
    if (theme !== "auto") return;
    systemTheme.addEventListener("change", applyTheme);
    return () => systemTheme.removeEventListener("change", applyTheme);
  }, [theme]);
  if (session.isPending) return <LoadingScreen />;
  if (session.isError) {
    if (session.error instanceof ApiError && session.error.status !== 401) return <ErrorScreen message={session.error.message} onRetry={() => void session.refetch()} />;
    return <AuthScreen />;
  }
  return <BusinessGate user={session.data.user} online={online} pendingCount={pendingCount} pendingItems={pendingItems} unclaimedPendingCount={unclaimedPendingCount} setUnclaimedPendingCount={setUnclaimedPendingCount} setPendingCount={setPendingCount} setPendingItems={setPendingItems} menuOpen={menuOpen} setMenuOpen={setMenuOpen} theme={theme} setTheme={setTheme} syncError={syncError} setSyncError={setSyncError} onLogout={async () => { await post("/auth/logout"); sessionStorage.removeItem("shopro_business_id"); sessionStorage.removeItem("shopro_branch_id"); await queryClient.clear(); window.location.assign("/login"); }} />;
}

function AuthScreen() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [deliveryUncertain, setDeliveryUncertain] = useState(false);
  const [wait, setWait] = useState(false);
  const queryClient = useQueryClient();
  const request = async () => {
    setWait(true);
    setError("");
    setDeliveryUncertain(false);
    try {
      await post("/auth/otp/request", { phone });
      setSent(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 502) {
        setSent(true);
        setDeliveryUncertain(true);
        setError("پاسخ قطعی از سرویس پیامک نرسید. اگر کد را دریافت کرده‌اید، آن را وارد کنید.");
      } else {
        setError(messageOf(cause));
      }
    } finally {
      setWait(false);
    }
  };
  const verify = async (event: FormEvent) => { event.preventDefault(); setWait(true); setError(""); try { await post("/auth/otp/verify", { phone, code }); await queryClient.invalidateQueries({ queryKey: ["session"] }); } catch (cause) { setError(messageOf(cause)); } finally { setWait(false); } };
  return <main className="auth-page" dir="rtl"><div className="auth-brand"><img className="brand-logo auth-logo" src="/icons/Logo.webp" alt="" /><span>شاپرو</span></div><section className="auth-card">
    <span className="eyebrow">همراه کسب‌وکار شما</span><h1>{sent ? "کد ورود را وارد کنید" : "ورود یا ساخت حساب"}</h1><p className="muted">{sent ? deliveryUncertain ? `وضعیت ارسال کد برای ${phone} از سمت سرویس پیامک تأیید نشد.` : `کد یک‌بارمصرف برای ${phone} ارسال شد.` : "با شماره موبایل وارد شوید یا حساب تازه بسازید."}</p>
    {!sent ? <form onSubmit={(event) => { event.preventDefault(); void request(); }}><label className="field-label" htmlFor="phone">شماره موبایل</label><input id="phone" autoComplete="tel" dir="ltr" inputMode="tel" placeholder="۰۹۱۲ ۳۴۵ ۶۷۸۹" value={phone} onChange={(event) => setPhone(event.target.value)} required minLength={10} maxLength={16} /><button className="button button-primary full" type="submit" disabled={wait}>{wait ? "در حال ارسال…" : "ارسال کد ورود"}</button></form> : <form onSubmit={(event) => void verify(event)}><label className="field-label" htmlFor="otp">کد یک‌بارمصرف</label><input id="otp" autoFocus autoComplete="one-time-code" dir="ltr" inputMode="numeric" maxLength={8} placeholder="کد پیامک‌شده" value={code} onChange={(event) => setCode(event.target.value)} required /><button className="button button-primary full" type="submit" disabled={wait}>{wait ? "در حال بررسی…" : "تأیید و ورود"}</button><button className="button button-text full" type="button" disabled={wait} onClick={() => { setSent(false); setCode(""); setError(""); setDeliveryUncertain(false); }}>تغییر شماره موبایل</button><button className="button button-text full" type="button" disabled={wait} onClick={() => void request()}>ارسال دوبارهٔ کد</button></form>}
    {error && <p className={deliveryUncertain ? "notice notice-warning" : "form-error"} role={deliveryUncertain ? "status" : "alert"}>{error}</p>}<p className="privacy-note">کد ورود فقط برای تأیید شمارهٔ شما استفاده می‌شود.</p>
  </section><footer className="auth-footer">حساب‌های کسب‌وکار و مدیر سامانه مسیر ورود جداگانه دارند.</footer></main>;
}

function BusinessGate({ user, online, pendingCount, pendingItems, unclaimedPendingCount, setUnclaimedPendingCount, setPendingCount, setPendingItems, menuOpen, setMenuOpen, theme, setTheme, syncError, setSyncError, onLogout }: { user: SessionResponse["user"]; online: boolean; pendingCount: number; pendingItems: PendingSale[]; unclaimedPendingCount: number; setUnclaimedPendingCount: (count: number) => void; setPendingCount: (count: number) => void; setPendingItems: (items: PendingSale[]) => void; menuOpen: boolean; setMenuOpen: (open: boolean) => void; theme: string; setTheme: (value: string) => void; syncError: string; setSyncError: (value: string) => void; onLogout: () => void }) {
  const queryClient = useQueryClient();
  const businesses = useQuery({ queryKey: ["businesses"], queryFn: () => get<BusinessSummary[]>("/businesses") });
  const [businessId, setBusinessId] = useState(sessionStorage.getItem("shopro_business_id") ?? "");
  const [branchId, setBranchId] = useState(sessionStorage.getItem("shopro_branch_id") ?? "");
  const previousScope = useRef("");
  useLayoutEffect(() => {
    const scope = `${businessId}:${branchId}`;
    if (businessId && branchId && previousScope.current && previousScope.current !== scope) {
      void queryClient.resetQueries({ predicate: (query) => !["session", "businesses"].includes(String(query.queryKey[0])) });
    }
    previousScope.current = scope;
  }, [businessId, branchId, queryClient]);
  const rows = businesses.data ?? [];
  const activeBusiness = rows.find((row) => row.id === businessId) ?? rows[0];
  const activeBranch = activeBusiness?.branches.find((branch) => branch.id === branchId) ?? activeBusiness?.branches[0];
  useEffect(() => {
    if (!activeBusiness || !activeBranch) return;
    if (businessId !== activeBusiness.id || branchId !== activeBranch.id) {
      setBusinessId(activeBusiness.id); setBranchId(activeBranch.id);
      sessionStorage.setItem("shopro_business_id", activeBusiness.id); sessionStorage.setItem("shopro_branch_id", activeBranch.id);
    }
  }, [activeBusiness, activeBranch, businessId, branchId]);
  useEffect(() => { if (online && pendingCount > 0) void syncPendingSales(user.id, setPendingCount, setPendingItems).then((result) => setSyncError(result.message)).catch((cause) => setSyncError(messageOf(cause))); }, [online, pendingCount, user.id, activeBusiness?.id, activeBranch?.id, setPendingCount, setPendingItems, setSyncError]);
  const sync = async (retryFailed = false, itemId?: string) => {
    setSyncError("");
    const result = await syncPendingSales(user.id, setPendingCount, setPendingItems, { retryFailed, itemId });
    setSyncError(result.message);
  };
  const discardPending = async (id: string) => {
    const item = pendingItems.find((candidate) => candidate.id === id);
    if (!item || !window.confirm("این پیش‌نویس فروش از این دستگاه حذف شود؟")) return;
    await removePendingSale(id);
    const remaining = (await listPendingSales()).filter((candidate) => candidate.userId === user.id);
    setPendingItems(remaining); setPendingCount(remaining.length);
  };
  const discardUnclaimed = async () => {
    if (!unclaimedPendingCount || !window.confirm("پیش‌نویس‌های قدیمی که به حسابی وصل نیستند، فقط از همین دستگاه پاک شوند؟")) return;
    const removed = await removeUnclaimedPendingSales();
    setUnclaimedPendingCount(Math.max(0, unclaimedPendingCount - removed));
  };
  if (businesses.isPending) return <LoadingScreen />;
  if (businesses.isError) return <ErrorScreen message={messageOf(businesses.error)} onRetry={() => void businesses.refetch()} />;
  if (!rows.length) return <><OnboardingPage /><UnclaimedQueueNotice count={unclaimedPendingCount} onClear={() => void discardUnclaimed()} /></>;
  return <div className="workspace" dir="rtl">
    <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="باز کردن فهرست">{menuOpen ? <X /> : <Menu />}</button><Link className="top-brand" to="/app"><img className="brand-logo small" src="/icons/Logo.webp" alt="" /><span>شاپرو</span></Link><div className="topbar-selectors"><label className="select-wrap"><span className="sr-only">کسب‌وکار جاری</span><BriefcaseBusiness size={15} /><select aria-label="کسب‌وکار جاری" value={activeBusiness?.id ?? ""} onChange={(event) => { const next = rows.find((row) => row.id === event.target.value); if (!next) return; setBusinessId(next.id); setBranchId(next.branches[0]?.id ?? ""); sessionStorage.setItem("shopro_business_id", next.id); sessionStorage.setItem("shopro_branch_id", next.branches[0]?.id ?? ""); }}>{rows.map((row) => <option key={row.id} value={row.id}>{row.displayName}</option>)}</select><ChevronDown size={14} /></label>{activeBusiness && <label className="select-wrap branch-select"><span className="sr-only">شعبه جاری</span><select aria-label="شعبه جاری" value={activeBranch?.id ?? ""} onChange={(event) => { setBranchId(event.target.value); sessionStorage.setItem("shopro_branch_id", event.target.value); }}>{activeBusiness.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select><ChevronDown size={14} /></label>}</div><span className={`connection-pill ${online ? "is-online" : "is-offline"}`}>{online ? <Wifi size={15} /> : <WifiOff size={15} />}<span>{online ? "متصل" : "آفلاین"}</span></span><button className="icon-button top-user" title="خروج" onClick={() => void onLogout()}><LogOut size={18} /></button></header>
    <div className="workspace-body"><aside className={`side-nav ${menuOpen ? "open" : ""}`} aria-label="ناوبری"><div className="side-business"><span className="avatar">{activeBusiness?.displayName.slice(0, 1)}</span><div><strong>{activeBusiness?.displayName}</strong><span>{activeBranch?.name} · {roleLabel(activeBusiness?.role)}</span></div></div><nav>{navItems.map((item) => <NavLink to={item.to} key={item.to} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}><item.icon size={19} /><span>{item.label}</span></NavLink>)}</nav><div className="side-bottom"><button className="nav-item nav-plain" onClick={() => void onLogout()}><LogOut size={19} /><span>خروج از حساب</span></button><small>نسخهٔ آزمایشی · {user.displayName ?? user.phone}</small></div></aside>
      {menuOpen && <button className="nav-overlay" onClick={() => setMenuOpen(false)} aria-label="بستن فهرست" />}
      <main className="page-content"><Suspense fallback={<div className="card page-content-loading" role="status">در حال بارگذاری صفحه…</div>}><Routes><Route path="/app" element={<DashboardPage business={activeBusiness!} pendingCount={pendingCount} />} /><Route path="/app/sales" element={<SalesPage currency={activeBusiness!.displayCurrency} userId={user.id} setPendingCount={setPendingCount} />} /><Route path="/app/invoices" element={<InvoicesPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/invoices/:id" element={<InvoiceDetailsPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/parties" element={<PartiesPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/parties/:id" element={<PartyDetailsPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/products" element={<ProductsPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/products/:id" element={<ProductDetailsPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/inventory" element={<InventoryPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/inventory/counts/:id" element={<StockCountDetailsPage />} /><Route path="/app/purchases" element={<PurchasesPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/purchases/:id" element={<PurchaseDetailsPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/expenses" element={<ExpensesPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/expenses/:id" element={<ExpenseDetailsPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/finance" element={<FinancePage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/ledger" element={<LedgerPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/finance/:kind/:id" element={<FinanceDetailsPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/reports" element={<ReportsPage currency={activeBusiness!.displayCurrency} role={activeBusiness!.role} />} /><Route path="/app/settings" element={<SettingsPage business={activeBusiness!} theme={theme} setTheme={setTheme} />} /><Route path="*" element={<Navigate to="/app" replace />} /></Routes></Suspense></main></div>
    {pendingCount > 0 && <section className="pending-sync-panel" dir="rtl"><div className="pending-sync-heading"><strong>{faNumber(pendingCount)} پیش‌نویس فروش ذخیره شده</strong><button className="button button-secondary" type="button" disabled={!online} onClick={() => void sync(true)}>{online ? "تلاش دوباره" : "پس از اتصال تلاش کنید"}</button></div>{syncError && <p className="pending-error" role="status">{syncError}</p>}<p className="pending-sync-hint">این پیش‌نویس‌ها فقط برای حساب فعلی نگه‌داری می‌شوند. برای ارسال، کسب‌وکار و شعبهٔ ثبت‌شده را انتخاب کنید.</p>{pendingItems.map((item) => <article className="pending-sync-item" key={item.id}><span>{jalaliDate(item.sale.txnDate)} · {faNumber(item.sale.lines.length)} ردیف</span>{item.lastError && <small role="alert">{item.lastError}</small>}<div><button className="button button-text" type="button" disabled={!online} onClick={() => void sync(true, item.id)}>ارسال دوباره</button><button className="button button-text" type="button" onClick={() => void discardPending(item.id)}>حذف پیش‌نویس</button></div></article>)}</section>}
    {unclaimedPendingCount > 0 && <UnclaimedQueueNotice count={unclaimedPendingCount} onClear={() => void discardUnclaimed()} />}
    <BottomNav />
  </div>;
}

function UnclaimedQueueNotice({ count, onClear }: { count: number; onClear: () => void }) {
  if (!count) return null;
  return <aside className="pending-sync-panel unclaimed-sync-panel" dir="rtl"><strong>{faNumber(count)} پیش‌نویس قدیمی به حسابی متصل نیست</strong><p className="pending-sync-hint">برای حفظ حریم خصوصی، جزئیات آن‌ها نمایش داده نمی‌شود و خودکار ارسال نخواهند شد.</p><button className="button button-text" type="button" onClick={onClear}>پاک‌کردن از این دستگاه</button></aside>;
}

function OnboardingPage() {
  const queryClient = useQueryClient(); const [displayName, setDisplayName] = useState(""); const [businessType, setBusinessType] = useState("فروشگاه"); const [branchName, setBranchName] = useState("شعبهٔ اصلی"); const [currency, setCurrency] = useState<"IRT" | "IRR">("IRT"); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const create = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { const result = await post<{ id: string; branch: { id: string } }>("/businesses", { displayName, businessType, initialBranchName: branchName, displayCurrency: currency }); sessionStorage.setItem("shopro_business_id", result.id); sessionStorage.setItem("shopro_branch_id", result.branch.id); await queryClient.invalidateQueries({ queryKey: ["businesses"] }); } catch (cause) { setError(messageOf(cause)); } finally { setSaving(false); } };
  return <main className="onboarding-page" dir="rtl"><section className="onboarding-card"><img className="brand-logo onboarding-logo" src="/icons/Logo.webp" alt="لوگوی شاپرو" /><span className="eyebrow">شروع کار</span><h1>کسب‌وکار خود را بسازید</h1><p className="muted">اطلاعات اولیه را وارد کنید. می‌توانید چند کسب‌وکار و شعبه داشته باشید.</p><form onSubmit={(event) => void create(event)}><Field label="نام کسب‌وکار" value={displayName} onChange={setDisplayName} required placeholder="مثلاً فروشگاه من" /><Field label="نوع کسب‌وکار" value={businessType} onChange={setBusinessType} required placeholder="فروشگاه، خدماتی…" /><Field label="نام شعبهٔ اول" value={branchName} onChange={setBranchName} required /><label className="field-label" htmlFor="currency">واحد نمایش پول</label><select id="currency" value={currency} onChange={(event) => setCurrency(event.target.value as "IRR" | "IRT")}><option value="IRT">تومان</option><option value="IRR">ریال</option></select><button className="button button-primary full" disabled={saving}>{saving ? "در حال ساخت…" : "ساخت کسب‌وکار"}</button></form>{error && <p role="alert" className="form-error">{error}</p>}</section></main>;
}

export function DashboardPage({ business, pendingCount }: { business: BusinessSummary; pendingCount: number }) {
  const query = useQuery({ queryKey: ["dashboard"], queryFn: () => get<Dashboard>("/reports/dashboard") });
  const data = query.data;
  const stats = [
    { label: "فروش خالص", value: data ? money(data.netSalesRial, data.displayCurrency) : "—", detail: `${faNumber(data?.salesCount ?? 0)} فاکتور`, icon: ShoppingCart, tone: "emerald" },
    { label: "دریافت", value: data ? money(data.receiptsRial, data.displayCurrency) : "—", detail: "وجه دریافت‌شده", icon: ArrowDownLeft, tone: "blue" },
    { label: "هزینه", value: data ? money(data.expensesRial, data.displayCurrency) : "—", detail: `${faNumber(data?.expenseCount ?? 0)} سند`, icon: ArrowUpRight, tone: "amber" },
    { label: "سود ناخالص", value: data?.grossProfitAvailable ? money(data.grossProfitRial, data.displayCurrency) : "در دسترس نیست", detail: "فروش منهای بهای تمام‌شده", icon: ChartNoAxesCombined, tone: "violet" },
  ];
  return <PageHeader title="خانه" subtitle={`نمای امروز · ${jalaliDate(todayISO())}`}><div className="dashboard-page">{query.isError && <InlineError error={query.error} retry={() => void query.refetch()} />}{pendingCount > 0 && <div className="notice notice-warning"><Activity size={18} /><span>{faNumber(pendingCount)} عملیات فروش روی این دستگاه ذخیره شده و هنوز به سرور نرسیده است.</span></div>}{data && <><div className="metric-grid">{stats.map((stat) => <MetricCard key={stat.label} {...stat} />)}</div><section className="card cash-card"><div><div className="icon-tile emerald"><Wallet size={21} /></div><span><strong>موجودی صندوق و بانک</strong><small>ماندهٔ ثبت‌شده در این شعبه</small></span></div><strong className="cash-value">{money(data.cashPositionRial, data.displayCurrency)}</strong></section><div className="dashboard-columns"><section className="card"><SectionTitle title="اقدام سریع" action={<span className="eyebrow">برای شروع روز</span>} /><div className="quick-grid"><QuickAction to="/app/sales" icon={ShoppingCart} label="ثبت فروش" tone="emerald" /><QuickAction to="/app/expenses" icon={ReceiptText} label="ثبت هزینه" tone="amber" /><QuickAction to="/app/parties" icon={UsersRound} label="طرف‌حساب" tone="blue" /><QuickAction to="/app/products" icon={PackagePlus} label="افزودن کالا" tone="violet" /></div></section><section className="card low-stock-card"><SectionTitle title="موجودی رو به اتمام" action={<Link to="/app/inventory">مشاهدهٔ همه</Link>} />{data.lowStock.length ? <div className="compact-list">{data.lowStock.slice(0, 4).map((product) => <div className="compact-row" key={product.id}><span className="product-avatar"><Boxes size={18} /></span><span className="row-grow"><strong>{product.name}</strong><small>حد سفارش {faNumber(product.reorderPoint)}</small></span><span className="stock-warning">{faNumber(product.quantity)} <small>{product.unit}</small></span></div>)}</div> : <EmptyState icon={Boxes} title="موجودی کم پیدا نشد" text="هشدار کمبود کالا اینجا نمایش داده می‌شود." />}</section></div><section className="card trend-card"><SectionTitle title="فروش در بازهٔ جاری" action={<Link to="/app/reports">گزارش‌ها</Link>} />{data.salesTrend.length ? <div className="trend-list">{data.salesTrend.map((item) => <div className="trend-row" key={item.date}><span>{jalaliDate(item.date)}</span><div className="trend-track"><i style={{ width: `${trendPercent(item.totalRial, data.salesTrend)}%` }} /></div><strong>{money(item.totalRial, data.displayCurrency)}</strong></div>)}</div> : <EmptyState icon={ChartNoAxesCombined} title="فروشی در این بازه ثبت نشده" text="پس از ثبت فروش، نمودار روزانه اینجا تکمیل می‌شود." />}</section></>}{query.isPending && <LoadingBlock />}<p className="page-footnote">{business.displayName} · همهٔ مبالغ بر اساس اسناد ثبت‌شدهٔ این شعبه است.</p></div></PageHeader>;
}

export function PageHeader({ title, subtitle, children, actions }: { title: string; subtitle?: string; children: ReactNode; actions?: ReactNode }) { return <div className="page-wrap"><header className="page-heading"><div><span className="eyebrow">فضای کاری</span><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</header>{children}</div>; }
export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) { return <div className="section-title"><h2>{title}</h2>{action && <span>{action}</span>}</div>; }
export function Field({ label, value, onChange, type = "text", placeholder, required = false, dir, inputMode, disabled = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string; required?: boolean; dir?: "ltr" | "rtl"; inputMode?: "text" | "numeric" | "decimal" | "tel"; disabled?: boolean }) { return <label className="field"><span className="field-label">{label}{required && <i> *</i>}</span><input type={type} inputMode={inputMode} dir={dir} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} required={required} disabled={disabled} /></label>; }
export function SelectField({ label, value, onChange, options, placeholder, onAdd, addLabel, optionsKey, loadOptions }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; placeholder?: string; onAdd?: () => void; addLabel?: string; optionsKey?: string; loadOptions?: PickerOptionLoader }) { return <OptionPicker label={label} value={value} onChange={onChange} options={options} placeholder={placeholder} onAdd={onAdd} addLabel={addLabel} optionsKey={optionsKey} loadOptions={loadOptions} />; }
export function SubmitButton({ children, busy, type = "submit" }: { children: ReactNode; busy?: boolean; type?: "button" | "submit" }) { return <button className="button button-primary" type={type} disabled={busy}>{busy ? "در حال ثبت…" : children}</button>; }
export function EmptyState({ icon: Icon, title, text, action }: { icon: typeof Boxes; title: string; text: string; action?: React.ReactNode }) { return <div className="empty-state"><span className="empty-icon"><Icon size={24} /></span><strong>{title}</strong><p>{text}</p>{action}</div>; }
export function LoadingBlock() { return <div className="loading-block" aria-label="در حال بارگیری"><i /><i /><i /></div>; }
export function InlineError({ error, retry }: { error: unknown; retry?: () => void }) { return <div className="notice notice-error" role="alert"><CircleHelp size={18} /><span>{messageOf(error)}</span>{retry && <button onClick={retry}>تلاش دوباره</button>}</div>; }
export function MetricCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: typeof Wallet; tone: string }) { return <section className="metric-card"><span className={`icon-tile ${tone}`}><Icon size={20} /></span><span className="metric-text"><small>{label}</small><strong>{value}</strong><span>{detail}</span></span></section>; }
export function QuickAction({ to, icon: Icon, label, tone }: { to: string; icon: typeof Wallet; label: string; tone: string }) { return <Link to={to} className="quick-action"><span className={`icon-tile ${tone}`}><Icon size={19} /></span><span>{label}</span><Plus size={15} /></Link>; }
export function DataRows({ rows, emptyTitle, emptyText, icon = FileText, action, onRowClick }: { rows: Array<{ id: string; title: string; subtitle?: string; amount?: string; status?: string; tone?: string }>; emptyTitle: string; emptyText: string; icon?: typeof Boxes; action?: ReactNode; onRowClick?: (id: string) => void }) { return rows.length ? <div className="data-list">{rows.map((row) => { const content = <><span className="row-symbol"><FileText size={18} /></span><span className="row-grow"><strong>{row.title}</strong>{row.subtitle && <small>{row.subtitle}</small>}</span>{row.status && <span className={`status-badge ${row.tone ?? ""}`}>{row.status}</span>}{row.amount && <strong className="row-amount">{row.amount}</strong>}</>; return onRowClick ? <button className="data-row data-row-action" type="button" key={row.id} onClick={() => onRowClick(row.id)}>{content}</button> : <div className="data-row" key={row.id}>{content}</div>; })}</div> : <EmptyState icon={icon} title={emptyTitle} text={emptyText} action={action} />; }
export function LoadMoreButton({ hasMore, isLoading, onClick }: { hasMore: boolean; isLoading: boolean; onClick: () => void }) { return hasMore ? <div className="pagination-more"><button className="button button-secondary" type="button" disabled={isLoading} onClick={onClick}>{isLoading ? "در حال بارگذاری…" : "نمایش موارد قدیمی‌تر"}</button></div> : null; }
export function useBusinessCurrency(currency: "IRR" | "IRT") { return useMemo(() => (value: string | bigint | null | undefined) => money(value, currency), [currency]); }
export function messageOf(error: unknown) { if (error instanceof ApiError) return error.message; if (error instanceof Error) return error.message; return "مشکلی پیش آمد. دوباره تلاش کنید."; }
export function useInvalidate() { const client = useQueryClient(); return () => { void client.invalidateQueries(); }; }

function BottomNav() { return <nav className="bottom-nav" aria-label="ناوبری اصلی">{[{ to: "/app", label: "خانه", icon: House, end: true }, { to: "/app/sales", label: "فروش", icon: ShoppingCart }, { to: "/app/invoices", label: "فاکتورها", icon: FileText }, { to: "/app/reports", label: "گزارش", icon: ChartNoAxesCombined }, { to: "/app/settings", label: "بیشتر", icon: Menu }].map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `bottom-link ${isActive ? "active" : ""}`}><item.icon size={20} /><span>{item.label}</span></NavLink>)}</nav>; }
const navItems = [{ to: "/app", label: "خانه", icon: House }, { to: "/app/sales", label: "ثبت فروش", icon: ShoppingCart }, { to: "/app/invoices", label: "فاکتورها", icon: FileText }, { to: "/app/parties", label: "مشتریان و تأمین‌کنندگان", icon: UsersRound }, { to: "/app/products", label: "کالا و خدمات", icon: PackagePlus }, { to: "/app/inventory", label: "موجودی انبار", icon: Boxes }, { to: "/app/purchases", label: "خرید", icon: ShoppingBag }, { to: "/app/expenses", label: "هزینه‌ها", icon: ReceiptText }, { to: "/app/finance", label: "صندوق و بانک", icon: Wallet }, { to: "/app/ledger", label: "دفتر مالی", icon: BookOpen }, { to: "/app/reports", label: "گزارش‌ها", icon: ChartNoAxesCombined }, { to: "/app/settings", label: "تنظیمات", icon: Settings }];
function roleLabel(role?: MemberRole) { return role ? ({ OWNER: "مالک", MANAGER: "مدیر", ACCOUNTANT: "حسابدار", CASHIER: "صندوقدار", VIEWER: "مشاهده‌گر" } as Record<MemberRole, string>)[role] : "عضو"; }
function trendPercent(value: string, rows: Dashboard["salesTrend"]) { const max = rows.reduce((top, item) => BigInt(item.totalRial) > top ? BigInt(item.totalRial) : top, 0n); return max === 0n ? 0 : Math.max(5, Number((BigInt(value) * 100n) / max)); }
function LoadingScreen() { return <div className="full-screen-state" dir="rtl"><img className="brand-logo" src="/icons/Logo.webp" alt="" /><div className="loading-block"><i /><i /><i /></div></div>; }
function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="full-screen-state" dir="rtl"><div className="brand-icon danger"><CircleHelp /></div><h1>اتصال برقرار نشد</h1><p>{message}</p><button className="button button-primary" onClick={onRetry}>تلاش دوباره</button></div>; }
async function syncPendingSales(userId: string, setCount: (count: number) => void, setItems: (items: PendingSale[]) => void, options: { retryFailed?: boolean; itemId?: string } = {}) {
  const scopeBusinessId = sessionStorage.getItem("shopro_business_id");
  const scopeBranchId = sessionStorage.getItem("shopro_branch_id");
  const items = (await listPendingSales()).filter((item) => item.userId === userId && (!options.itemId || item.id === options.itemId));
  let failed = 0; let wrongScope = 0; let waitingForRetry = 0;
  for (const item of items) {
    if (item.businessId !== scopeBusinessId || item.branchId !== scopeBranchId) { wrongScope++; continue; }
    if (item.lastError && !options.retryFailed) { waitingForRetry++; continue; }
    if (item.lastError) await setPendingSaleError(item.id, null);
    try {
      const draft = await post<{ id: string }>("/sales", item.sale, { "Idempotency-Key": item.draftKey });
      await post(`/sales/${draft.id}/post`, { payments: item.payment ? [item.payment] : [] }, { "Idempotency-Key": item.postKey });
      await removePendingSale(item.id);
    } catch (cause) {
      failed++;
      await setPendingSaleError(item.id, messageOf(cause));
    }
  }
  const owned = (await listPendingSales()).filter((item) => item.userId === userId);
  setItems(owned); setCount(owned.length);
  const message = failed ? `${faNumber(failed)} پیش‌نویس ارسال نشد؛ خطای هر مورد را بررسی و سپس دوباره تلاش کنید.`
    : wrongScope ? "برای ارسال پیش‌نویس‌های باقی‌مانده، کسب‌وکار و شعبهٔ ثبت‌شده در هر مورد را انتخاب کنید."
    : waitingForRetry ? "برای موارد ناموفق، دکمهٔ «تلاش دوباره» را بزنید."
    : "";
  return { message };
}
