import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowDownLeft, ArrowUpRight, BadgeCheck, BookOpen, BriefcaseBusiness, Boxes, ChartNoAxesCombined, ChevronDown, CircleHelp, CreditCard, FileText, House, LogOut, Menu, PackagePlus, Plus, ReceiptText, Settings, ShoppingBag, ShoppingCart, Store, Truck, UsersRound, Wallet, Wifi, WifiOff, X } from "lucide-react";
import type { BusinessSummary, MemberRole, SessionUser } from "@shopro/contracts";
import { ApiError, get, patch, post } from "./lib/api.js";
import { faNumber, jalaliDate, money, todayISO } from "./lib/format.js";
import { countAwaitingServer, countUnclaimedPendingSales, getOfflineDeviceId, listPendingSales, markPendingSaleFailed, markPendingSaleForRetry, markPendingSaleScopeConflict, markPendingSaleSucceeded, markPendingSaleSyncing, removePendingSale, removeUnclaimedPendingSales, type PendingSale } from "./lib/offline.js";
import { classifyOfflineFailure, isQueueItemAutomaticallySyncable, isQueueItemManuallyRetryable } from "./lib/offline-state.js";
import { OptionPicker } from "./components/OptionPicker.js";
import type { PickerOptionLoader } from "./components/OptionPicker.js";
import { BrandLogo } from "./components/BrandLogo.js";
import { KaashLauncher } from "./components/KaashLauncher.js";
import { OtpCodeInput, OTP_CODE_LENGTH } from "./components/OtpCodeInput.js";
import { trackOnboardingEvent } from "./lib/onboarding-events.js";
import { formatOtpCountdown, otpResendLabel, otpTimingFromError, useOtpCountdown } from "./lib/otp-countdown.js";

const SalesPage = lazy(() => import("./pages/Pages.js").then((module) => ({ default: module.SalesPage })));
const InvoicesPage = lazy(() => import("./pages/Pages.js").then((module) => ({ default: module.InvoicesPage })));
const InventoryPage = lazy(() => import("./pages/Pages.js").then((module) => ({ default: module.InventoryPage })));
const PurchasesPage = lazy(() => import("./pages/Pages.js").then((module) => ({ default: module.PurchasesPage })));
const ExpensesPage = lazy(() => import("./pages/Pages.js").then((module) => ({ default: module.ExpensesPage })));
const ExpenseCategoriesPage = lazy(() => import("./pages/MasterDataPages.js").then((module) => ({ default: module.ExpenseCategoriesPage })));
const FinancePage = lazy(() => import("./pages/Pages.js").then((module) => ({ default: module.FinancePage })));
const ReportsPage = lazy(() => import("./pages/Pages.js").then((module) => ({ default: module.ReportsPage })));
const LedgerPage = lazy(() => import("./pages/LedgerPage.js").then((module) => ({ default: module.LedgerPage })));
const CustomersPage = lazy(() => import("./pages/MasterDataPages.js").then((module) => ({ default: module.CustomersPage })));
const SuppliersPage = lazy(() => import("./pages/MasterDataPages.js").then((module) => ({ default: module.SuppliersPage })));
const ProductsPage = lazy(() => import("./pages/MasterDataPages.js").then((module) => ({ default: module.ProductsPage })));
const ServicesPage = lazy(() => import("./pages/MasterDataPages.js").then((module) => ({ default: module.ServicesPage })));
const CatalogCategoriesPage = lazy(() => import("./pages/MasterDataPages.js").then((module) => ({ default: module.CatalogCategoriesPage })));
const PartyDetailsPage = lazy(() => import("./pages/DetailPages.js").then((module) => ({ default: module.PartyDetailsPage })));
const ProductDetailsPage = lazy(() => import("./pages/DetailPages.js").then((module) => ({ default: module.ProductDetailsPage })));
const ServiceDetailsPage = lazy(() => import("./pages/DetailPages.js").then((module) => ({ default: module.ServiceDetailsPage })));
const InvoiceDetailsPage = lazy(() => import("./pages/DetailPages.js").then((module) => ({ default: module.InvoiceDetailsPage })));
const PurchaseDetailsPage = lazy(() => import("./pages/DetailPages.js").then((module) => ({ default: module.PurchaseDetailsPage })));
const ExpenseDetailsPage = lazy(() => import("./pages/DetailPages.js").then((module) => ({ default: module.ExpenseDetailsPage })));
const FinanceDetailsPage = lazy(() => import("./pages/DetailPages.js").then((module) => ({ default: module.FinanceDetailsPage })));
const StockCountDetailsPage = lazy(() => import("./pages/DetailPages.js").then((module) => ({ default: module.StockCountDetailsPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage.js").then((module) => ({ default: module.SettingsPage })));
const SubscriptionsPage = lazy(() => import("./pages/SubscriptionsPage.js").then((module) => ({ default: module.SubscriptionsPage })));
const SystemAdminSubscriptionsApp = lazy(() => import("./pages/SystemAdminSubscriptionsPage.js").then((module) => ({ default: module.SystemAdminSubscriptionsApp })));
const BusinessCreationWizard = lazy(() => import("./pages/OnboardingPage.js").then((module) => ({ default: module.BusinessCreationWizard })));
const OnboardingWorkspacePage = lazy(() => import("./pages/OnboardingPage.js").then((module) => ({ default: module.OnboardingWorkspacePage })));
const StorefrontPublicPage = lazy(() => import("./pages/StorefrontPublicPage.js").then((module) => ({ default: module.StorefrontPublicPage })));
const StorefrontCustomerAccountPage = lazy(() => import("./pages/StorefrontCustomerAccountPage.js").then((module) => ({ default: module.StorefrontCustomerAccountPage })));
const StorefrontManagementPage = lazy(() => import("./pages/StorefrontManagementPage.js").then((module) => ({ default: module.StorefrontManagementPage })));

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

type SessionResponse = { user: SessionUser & { businessId?: string; branchId?: string; role?: MemberRole } };
type Dashboard = { displayCurrency: "IRR" | "IRT"; salesRial: string; netSalesRial: string; receiptsRial: string; expensesRial: string; grossProfitRial: string | null; grossProfitAvailable: boolean; salesCount: number; expenseCount: number; accountBalances: Array<{ id: string; name: string; balanceRial: string }>; cashPositionRial: string; lowStock: Array<{ id: string; name: string; quantity: string; reorderPoint: string; unit: string }>; openInvoices: number; salesTrend: Array<{ date: string; totalRial: string }> };

export function App() {
  useEffect(() => {
    const onInstallAvailable = (event: Event) => {
      event.preventDefault();
      deferredInstallPrompt = event as BeforeInstallPromptEvent;
      window.dispatchEvent(new Event("shopro:install-available"));
    };
    window.addEventListener("beforeinstallprompt", onInstallAvailable);
    return () => window.removeEventListener("beforeinstallprompt", onInstallAvailable);
  }, []);
  return <BrowserRouter><AppEntry /></BrowserRouter>;
}

function AppEntry() {
  return <Routes>
    <Route path="/system-admin/*" element={<Suspense fallback={<LoadingScreen />}><SystemAdminSubscriptionsApp /></Suspense>} />
    <Route path="/s/:slug/account" element={<Suspense fallback={<LoadingScreen />}><StorefrontCustomerAccountPage /></Suspense>} />
    <Route path="/s/:slug" element={<Suspense fallback={<LoadingScreen />}><StorefrontPublicPage /></Suspense>} />
    <Route path="/order/:token" element={<Suspense fallback={<LoadingScreen />}><StorefrontPublicPage /></Suspense>} />
    <Route path="*" element={<AppContent />} />
  </Routes>;
}

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
  const [syncNotice, setSyncNotice] = useState("");
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
      setPendingItems(owned); setPendingCount(countAwaitingServer(owned));
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
    return location.pathname === "/login" ? <AuthScreen /> : <WelcomePage />;
  }
  const logout = async () => {
    const owned = (await listPendingSales()).filter((item) => item.userId === session.data.user.id);
    const awaitingServer = countAwaitingServer(owned);
    setPendingItems(owned); setPendingCount(awaitingServer);
    if (awaitingServer && !window.confirm("پیش‌نویس‌های ارسال‌نشده فقط روی این دستگاه باقی می‌مانند و به حساب دیگری نمایش داده نمی‌شوند. با خروج ادامه می‌دهید؟")) return;
    if (!navigator.onLine) { setSyncError("برای خروج امن، ابتدا اتصال اینترنت را برقرار کنید تا نشست از سرور بسته شود."); setSyncNotice(""); return; }
    try { await post("/auth/logout"); }
    catch (cause) { setSyncError(`خروج امن انجام نشد: ${messageOf(cause)}`); setSyncNotice(""); return; }
    setSyncError(""); setSyncNotice("");
    sessionStorage.removeItem("shopro_business_id"); sessionStorage.removeItem("shopro_branch_id");
    await queryClient.clear(); window.location.assign("/login");
  };
  return <BusinessGate user={session.data.user} online={online} pendingCount={pendingCount} pendingItems={pendingItems} unclaimedPendingCount={unclaimedPendingCount} setUnclaimedPendingCount={setUnclaimedPendingCount} setPendingCount={setPendingCount} setPendingItems={setPendingItems} menuOpen={menuOpen} setMenuOpen={setMenuOpen} theme={theme} setTheme={setTheme} syncError={syncError} setSyncError={setSyncError} syncNotice={syncNotice} setSyncNotice={setSyncNotice} onLogout={logout} />;
}

function WelcomePage() {
  return <main className="welcome-page" dir="rtl"><div className="auth-brand"><BrandLogo className="auth-logo" alt="" /><span>شاپرو</span></div><section className="welcome-card"><span className="eyebrow">همراه کسب‌وکار شما</span><h1>فروش و حسابداری شعبه را ساده‌تر مدیریت کنید</h1><p>فروش، خرید و حسابداری شعبه‌تان را از همین‌جا مدیریت کنید. در چند قدم کوتاه، شعبه را آماده می‌کنیم و اولین عملیات را ثبت می‌کنید.</p><div className="welcome-actions"><Link className="button button-primary full" to="/login?next=%2Fapp%2Fonboarding">شروع راه‌اندازی</Link><Link className="button button-secondary full" to="/login">ورود به حساب</Link></div></section><p className="privacy-note">ورود و ثبت‌نام با کد یک‌بارمصرف انجام می‌شود.</p></main>;
}

function AuthScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [deliveryUncertain, setDeliveryUncertain] = useState(false);
  const [wait, setWait] = useState(false);
  const codeExpiry = useOtpCountdown();
  const resendCooldown = useOtpCountdown();
  const queryClient = useQueryClient();
  const applyTiming = (timing: { expiresAt: string; resendAt: string }) => {
    codeExpiry.startAt(timing.expiresAt);
    resendCooldown.startAt(timing.resendAt);
  };
  const request = async () => {
    setWait(true);
    setError("");
    setDeliveryUncertain(false);
    try {
      const timing = await post<{ expiresAt: string; resendAt: string }>("/auth/otp/request", { phone });
      applyTiming(timing);
      setCode("");
      setSent(true);
    } catch (cause) {
      const timing = otpTimingFromError(cause);
      if (timing) { applyTiming(timing); setSent(true); if (cause instanceof ApiError && cause.status !== 429) setCode(""); }
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
  const verify = async (event: FormEvent) => { event.preventDefault(); if (code.length !== OTP_CODE_LENGTH || codeExpiry.remaining === 0) return; setWait(true); setError(""); try { await post("/auth/otp/verify", { phone, code }); trackOnboardingEvent("auth_completed", "welcome"); await queryClient.invalidateQueries({ queryKey: ["session"] }); const next = searchParams.get("next"); if (next?.startsWith("/app/")) navigate(next, { replace: true }); } catch (cause) { setError(messageOf(cause)); } finally { setWait(false); } };
  return <main className="auth-page" dir="rtl"><div className="auth-brand"><BrandLogo className="auth-logo" alt="" /><span>شاپرو</span></div><section className="auth-card">
    <span className="eyebrow">همراه کسب‌وکار شما</span><h1>{sent ? "کد ورود را وارد کنید" : "ورود یا ساخت حساب"}</h1><p className="muted">{sent ? deliveryUncertain ? `وضعیت ارسال کد برای ${phone} از سمت سرویس پیامک تأیید نشد.` : `کد یک‌بارمصرف برای ${phone} ارسال شد.` : "با شماره موبایل وارد شوید یا حساب تازه بسازید."}</p>
    {!sent ? <form onSubmit={(event) => { event.preventDefault(); void request(); }}><label className="field-label" htmlFor="phone">شماره موبایل</label><input id="phone" autoComplete="tel" dir="ltr" inputMode="tel" placeholder="۰۹۱۲ ۳۴۵ ۶۷۸۹" value={phone} onChange={(event) => setPhone(event.target.value)} required minLength={10} maxLength={16} /><button className="button button-primary full" type="submit" disabled={wait}>{wait ? "در حال ارسال…" : "ارسال کد ورود"}</button></form> : <form onSubmit={(event) => void verify(event)}><label className="field-label" htmlFor="otp">کد یک‌بارمصرف</label><OtpCodeInput id="otp" label="کد یک‌بارمصرف" value={code} onChange={setCode} length={OTP_CODE_LENGTH} autoFocus disabled={wait || codeExpiry.remaining === 0} />{codeExpiry.remaining !== null && <p className="otp-expiry-countdown" role={codeExpiry.remaining === 0 ? "status" : undefined} aria-live={codeExpiry.remaining === 0 ? "polite" : "off"}>{codeExpiry.remaining === 0 ? "مهلت استفاده از این کد تمام شده است." : <>اعتبار کد: <bdi dir="ltr">{formatOtpCountdown(codeExpiry.remaining)}</bdi></>}</p>}<button className="button button-primary full" type="submit" disabled={wait || code.length !== OTP_CODE_LENGTH || codeExpiry.remaining === 0}>{wait ? "در حال بررسی…" : "تأیید و ورود"}</button><button className="button button-text full" type="button" disabled={wait} onClick={() => { setSent(false); setCode(""); setError(""); setDeliveryUncertain(false); codeExpiry.reset(); resendCooldown.reset(); }}>تغییر شماره موبایل</button><button className="button button-text full" type="button" disabled={wait || (resendCooldown.remaining !== null && resendCooldown.remaining > 0)} onClick={() => void request()}>{otpResendLabel("ارسال دوبارهٔ کد", resendCooldown.remaining)}</button></form>}
    {error && <p className={deliveryUncertain ? "notice notice-warning" : "form-error"} role={deliveryUncertain ? "status" : "alert"}>{error}</p>}<p className="privacy-note">کد ورود فقط برای تأیید شمارهٔ شما استفاده می‌شود.</p>
  </section><footer className="auth-footer">حساب‌های کسب‌وکار و مدیر سامانه مسیر ورود جداگانه دارند.</footer></main>;
}

function BusinessGate({ user, online, pendingCount, pendingItems, unclaimedPendingCount, setUnclaimedPendingCount, setPendingCount, setPendingItems, menuOpen, setMenuOpen, theme, setTheme, syncError, setSyncError, syncNotice, setSyncNotice, onLogout }: { user: SessionResponse["user"]; online: boolean; pendingCount: number; pendingItems: PendingSale[]; unclaimedPendingCount: number; setUnclaimedPendingCount: (count: number) => void; setPendingCount: (count: number) => void; setPendingItems: (items: PendingSale[]) => void; menuOpen: boolean; setMenuOpen: (open: boolean) => void; theme: string; setTheme: (value: string) => void; syncError: string; setSyncError: (value: string) => void; syncNotice: string; setSyncNotice: (value: string) => void; onLogout: () => void }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const businesses = useQuery({ queryKey: ["businesses"], queryFn: () => get<BusinessSummary[]>("/businesses") });
  const [businessId, setBusinessId] = useState(() => sessionStorage.getItem("shopro_business_id") ?? readRememberedScope(user.id)?.businessId ?? "");
  const [branchId, setBranchId] = useState(() => sessionStorage.getItem("shopro_branch_id") ?? readRememberedScope(user.id)?.branchId ?? "");
  const [synchronizedScope, setSynchronizedScope] = useState("");
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
  const scopeKey = activeBusiness && activeBranch ? `${user.id}:${activeBusiness.id}:${activeBranch.id}` : "";
  const scopeReady = Boolean(scopeKey && businessId === activeBusiness?.id && branchId === activeBranch?.id && synchronizedScope === scopeKey);
  const subscription = useQuery({ queryKey: ["subscription-current", activeBusiness?.id, activeBranch?.id], queryFn: () => get<{ status: string; period: { remainingDays: number } | null }>("/subscriptions/current"), enabled: scopeReady, staleTime: 60_000 });
  const subscriptionNotice = subscription.data?.status === "EXPIRED" ? "اشتراک پایان یافته؛ تمدید" : subscription.data?.status === "REQUIRED" ? "اشتراک لازم است" : subscription.data?.status === "SUSPENDED" ? "اشتراک متوقف شده" : subscription.data?.status === "ACTIVE" && (subscription.data.period?.remainingDays ?? 99) <= 7 ? `${faNumber(subscription.data.period?.remainingDays ?? 0)} روز تا پایان اشتراک` : "";
  useLayoutEffect(() => {
    if (!activeBusiness || !activeBranch) return;
    if (businessId !== activeBusiness.id || branchId !== activeBranch.id) {
      setBusinessId(activeBusiness.id); setBranchId(activeBranch.id);
    }
    sessionStorage.setItem("shopro_business_id", activeBusiness.id); sessionStorage.setItem("shopro_branch_id", activeBranch.id);
    rememberScope(user.id, activeBusiness.id, activeBranch.id);
    setSynchronizedScope(`${user.id}:${activeBusiness.id}:${activeBranch.id}`);
  }, [activeBusiness, activeBranch, businessId, branchId, user.id]);
  useEffect(() => { if (scopeReady && online && pendingCount > 0) void syncPendingSales(user.id, setPendingCount, setPendingItems).then((result) => { setSyncError(result.error ? result.message : ""); setSyncNotice(result.error ? "" : result.message); }).catch((cause) => { setSyncError(messageOf(cause)); setSyncNotice(""); }); }, [scopeReady, online, pendingCount, user.id, activeBusiness?.id, activeBranch?.id, setPendingCount, setPendingItems, setSyncError, setSyncNotice]);
  const sync = async (retryFailed = false, itemId?: string) => {
    setSyncError(""); setSyncNotice("");
    const result = await syncPendingSales(user.id, setPendingCount, setPendingItems, { retryFailed, itemId });
    setSyncError(result.error ? result.message : ""); setSyncNotice(result.error ? "" : result.message);
  };
  const discardPending = async (id: string) => {
    const item = pendingItems.find((candidate) => candidate.id === id);
    if (!item || !window.confirm(item.status === "succeeded" ? "سابقهٔ همگام‌سازی این فروش فقط از این دستگاه پاک شود؟ سند سرور تغییر نمی‌کند." : "این پیش‌نویس فروش از این دستگاه حذف شود؟")) return;
    await removePendingSale(id);
    const remaining = (await listPendingSales()).filter((candidate) => candidate.userId === user.id);
    setPendingItems(remaining); setPendingCount(countAwaitingServer(remaining));
  };
  const discardUnclaimed = async () => {
    if (!unclaimedPendingCount || !window.confirm("پیش‌نویس‌های قدیمی که به حسابی وصل نیستند، فقط از همین دستگاه پاک شوند؟")) return;
    const removed = await removeUnclaimedPendingSales();
    setUnclaimedPendingCount(Math.max(0, unclaimedPendingCount - removed));
  };
  if (businesses.isPending) return <LoadingScreen />;
  if (businesses.isError) return <ErrorScreen message={messageOf(businesses.error)} onRetry={() => void businesses.refetch()} />;
  if (!rows.length) return <><Suspense fallback={<LoadingScreen />}><BusinessCreationWizard userId={user.id} online={online} /></Suspense><UnclaimedQueueNotice count={unclaimedPendingCount} onClear={() => void discardUnclaimed()} /></>;
  if (!scopeReady) return <LoadingScreen />;
  if (location.pathname === "/" || location.pathname === "/login") return <Navigate to="/app/onboarding" replace />;
  return <><div className="workspace" dir="rtl">
    <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="باز کردن فهرست">{menuOpen ? <X /> : <Menu />}</button><Link className="top-brand" to="/app"><BrandLogo className="small" alt="" /><span>شاپرو</span></Link><div className="topbar-selectors"><label className="select-wrap"><span className="sr-only">کسب‌وکار جاری</span><BriefcaseBusiness size={15} /><select aria-label="کسب‌وکار جاری" value={activeBusiness?.id ?? ""} onChange={(event) => { const next = rows.find((row) => row.id === event.target.value); if (!next) return; setBusinessId(next.id); setBranchId(next.branches[0]?.id ?? ""); sessionStorage.setItem("shopro_business_id", next.id); sessionStorage.setItem("shopro_branch_id", next.branches[0]?.id ?? ""); rememberScope(user.id, next.id, next.branches[0]?.id ?? ""); }}>{rows.map((row) => <option key={row.id} value={row.id}>{row.displayName}</option>)}</select><ChevronDown size={14} /></label>{activeBusiness && <label className="select-wrap branch-select"><span className="sr-only">شعبه جاری</span><select aria-label="شعبه جاری" value={activeBranch?.id ?? ""} onChange={(event) => { setBranchId(event.target.value); sessionStorage.setItem("shopro_branch_id", event.target.value); rememberScope(user.id, activeBusiness.id, event.target.value); }}>{activeBusiness.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select><ChevronDown size={14} /></label>}</div>{subscriptionNotice && <Link to="/app/subscription" className="subscription-topbar-pill"><CreditCard size={14} />{subscriptionNotice}</Link>}<span className={`connection-pill ${online ? "is-online" : "is-offline"}`}>{online ? <Wifi size={15} /> : <WifiOff size={15} />}<span>{online ? "متصل" : "آفلاین"}</span></span><button className="icon-button top-user" title="خروج" onClick={() => void onLogout()}><LogOut size={18} /></button></header>
      <div className="workspace-body"><aside className={`side-nav ${menuOpen ? "open" : ""}`} aria-label="ناوبری"><div className="side-business"><span className="avatar">{activeBusiness?.displayName.slice(0, 1)}</span><div><strong>{activeBusiness?.displayName}</strong><span>{activeBranch?.name} · {roleLabel(activeBusiness?.role)}</span></div></div><nav>{navItems.map((item) => <NavLink to={item.to} key={item.to} className={({ isActive }) => `nav-item ${item.feature ? "nav-item-storefront" : ""} ${isActive ? "active" : ""}`}><span className="nav-item-icon"><item.icon size={19} /></span><span className="nav-item-copy"><span>{item.label}</span>{item.feature && <small>ویترین آنلاین شعبه</small>}</span>{item.feature && <ArrowUpRight className="nav-item-action" size={15} />}</NavLink>)}</nav><div className="side-bottom"><button className="nav-item nav-plain" onClick={() => void onLogout()}><LogOut size={19} /><span>خروج از حساب</span></button><small>نسخهٔ آزمایشی · {user.displayName ?? user.phone}</small></div></aside>
      {menuOpen && <button className="nav-overlay" onClick={() => setMenuOpen(false)} aria-label="بستن فهرست" />}
      <main className="page-content"><Suspense fallback={<div className="card page-content-loading" role="status">در حال بارگذاری صفحه…</div>}>{location.pathname === "/app/onboarding" ? <OnboardingWorkspacePage business={activeBusiness!} branchId={activeBranch?.id ?? ""} online={online} /> : <Routes>
        <Route path="/app" element={<DashboardPage business={activeBusiness!} branchId={activeBranch?.id ?? ""} pendingCount={pendingCount} />} />
        <Route path="/app/subscription" element={<SubscriptionsPage currency={activeBusiness!.displayCurrency} role={activeBusiness!.role} />} />
        <Route path="/app/storefront" element={<StorefrontManagementPage role={activeBusiness!.role} />} />
        <Route path="/app/sales" element={<SalesPage currency={activeBusiness!.displayCurrency} userId={user.id} role={activeBusiness!.role} setPendingCount={setPendingCount} />} />
        <Route path="/app/invoices" element={<InvoicesPage currency={activeBusiness!.displayCurrency} />} />
        <Route path="/app/invoices/:id" element={<InvoiceDetailsPage currency={activeBusiness!.displayCurrency} branchName={activeBranch?.name ?? ""} />} />
        <Route path="/app/parties" element={<Navigate to="/app/customers" replace />} />
        <Route path="/app/parties/:id" element={<PartyDetailsPage currency={activeBusiness!.displayCurrency} />} />
        <Route path="/app/customers" element={<CustomersPage currency={activeBusiness!.displayCurrency} />} />
        <Route path="/app/customers/:id" element={<PartyDetailsPage currency={activeBusiness!.displayCurrency} />} />
        <Route path="/app/suppliers" element={<SuppliersPage currency={activeBusiness!.displayCurrency} />} />
        <Route path="/app/suppliers/:id" element={<PartyDetailsPage currency={activeBusiness!.displayCurrency} />} />
        <Route path="/app/products" element={<ProductsPage currency={activeBusiness!.displayCurrency} />} />
        <Route path="/app/products/:id" element={<ProductDetailsPage currency={activeBusiness!.displayCurrency} role={activeBusiness!.role} />} />
        <Route path="/app/product-categories" element={<CatalogCategoriesPage kind="products" />} />
        <Route path="/app/services" element={<ServicesPage currency={activeBusiness!.displayCurrency} />} />
        <Route path="/app/services/:id" element={<ServiceDetailsPage currency={activeBusiness!.displayCurrency} role={activeBusiness!.role} />} />
        <Route path="/app/service-categories" element={<CatalogCategoriesPage kind="services" />} />
        <Route path="/app/inventory" element={<InventoryPage currency={activeBusiness!.displayCurrency} />} />
        <Route path="/app/inventory/counts/:id" element={<StockCountDetailsPage />} />
        <Route path="/app/purchases" element={<PurchasesPage currency={activeBusiness!.displayCurrency} />} />
        <Route path="/app/purchases/:id" element={<PurchaseDetailsPage currency={activeBusiness!.displayCurrency} branchName={activeBranch?.name ?? ""} />} />
        <Route path="/app/expenses" element={<ExpensesPage currency={activeBusiness!.displayCurrency} role={activeBusiness!.role} />} />
        <Route path="/app/expense-categories" element={<ExpenseCategoriesPage role={activeBusiness!.role} />} />
        <Route path="/app/expenses/:id" element={<ExpenseDetailsPage currency={activeBusiness!.displayCurrency} branchName={activeBranch?.name ?? ""} />} />
        <Route path="/app/finance" element={<FinancePage currency={activeBusiness!.displayCurrency} />} />
        <Route path="/app/ledger" element={<LedgerPage currency={activeBusiness!.displayCurrency} />} />
        <Route path="/app/finance/:kind/:id" element={<FinanceDetailsPage currency={activeBusiness!.displayCurrency} />} />
        <Route path="/app/reports" element={<ReportsPage currency={activeBusiness!.displayCurrency} role={activeBusiness!.role} />} />
        <Route path="/app/settings" element={<SettingsPage business={activeBusiness!} theme={theme} setTheme={setTheme} />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>}</Suspense></main></div>
    {(pendingItems.length > 0 || syncError || syncNotice) && <section className="pending-sync-panel" dir="rtl" aria-label="وضعیت همگام‌سازی فروش">
      <div className="pending-sync-heading"><strong>{pendingCount ? `${faNumber(pendingCount)} مورد هنوز به سرور نرسیده` : "وضعیت همگام‌سازی فروش"}</strong>{pendingCount > 0 && <button className="button button-secondary" type="button" disabled={!online} onClick={() => void sync(true)}>{online ? "ارسال و تلاش دوباره" : "پس از اتصال تلاش کنید"}</button>}</div>
      {syncError && <p className="notice notice-error" role="alert">{syncError}</p>}{syncNotice && <p className="notice notice-success" role="status">{syncNotice}</p>}
      {pendingItems.length > 0 && <p className="pending-sync-hint">پیش‌نویس‌ها فقط برای حساب فعلی نگه‌داری می‌شوند. محتوای هر فروش پس از تأیید سرور از دستگاه پاک می‌شود. برای موارد شعبهٔ دیگر، همان کسب‌وکار و شعبه را انتخاب کنید.</p>}
      {pendingItems.map((item) => <PendingSaleQueueItem key={item.id} item={item} online={online} businessId={activeBusiness?.id ?? ""} branchId={activeBranch?.id ?? ""} onRetry={(id) => void sync(true, id)} onRemove={(id) => void discardPending(id)} />)}
    </section>}
    {unclaimedPendingCount > 0 && <UnclaimedQueueNotice count={unclaimedPendingCount} onClear={() => void discardUnclaimed()} />}
    <BottomNav />
    {location.pathname.startsWith("/app") && <KaashLauncher online={online} />}
  </div><PwaInstallNudge businessId={activeBusiness?.id} branchId={activeBranch?.id} /></>;
}

function UnclaimedQueueNotice({ count, onClear }: { count: number; onClear: () => void }) {
  if (!count) return null;
  return <aside className="pending-sync-panel unclaimed-sync-panel" dir="rtl"><strong>{faNumber(count)} پیش‌نویس قدیمی به حسابی متصل نیست</strong><p className="pending-sync-hint">برای حفظ حریم خصوصی، جزئیات آن‌ها نمایش داده نمی‌شود و خودکار ارسال نخواهند شد.</p><button className="button button-text" type="button" onClick={onClear}>پاک‌کردن از این دستگاه</button></aside>;
}

function PendingSaleQueueItem({ item, online, businessId, branchId, onRetry, onRemove }: { item: PendingSale; online: boolean; businessId: string; branchId: string; onRetry: (id: string) => void; onRemove: (id: string) => void }) {
  const scopeMatches = item.businessId === businessId && item.branchId === branchId;
  const canRetry = scopeMatches && isQueueItemManuallyRetryable(item, scopeMatches);
  const statusLabel = item.status === "pending" ? "در صف ارسال"
    : item.status === "syncing" ? "در حال ارسال"
      : item.status === "succeeded" ? "ثبت‌شده در سرور"
        : item.status === "failed" ? "ارسال ناموفق"
          : item.conflictType === "scope" ? scopeMatches ? "آمادهٔ ارسال در این شعبه" : "نیازمند انتخاب شعبهٔ درست"
            : "نیازمند اصلاح اطلاعات";
  const description = item.status === "succeeded"
    ? `سرور ثبت فروش را تأیید کرد${item.serverInvoiceNo ? ` · فاکتور ${item.serverInvoiceNo}` : ""}.`
    : item.sale ? `${jalaliDate(item.sale.txnDate)} · ${faNumber(item.sale.lines.length)} ردیف` : "";
  return <article className={`pending-sync-item offline-queue-${item.status}`}>
    <div className="pending-sync-item-title"><strong>{description}</strong><span className="pending-sync-status">{statusLabel}</span></div>
    {item.lastError && <small className="pending-sync-item-error" role="alert">{item.lastError}</small>}
    {item.status !== "succeeded" && item.attemptCount > 0 && <small className="pending-sync-attempt">تلاش {faNumber(item.attemptCount)}{item.lastAttemptAt ? ` · آخرین تلاش ${jalaliDate(item.lastAttemptAt)}` : ""}</small>}
    {!scopeMatches && item.status !== "succeeded" && <small className="pending-sync-scope">کسب‌وکار و شعبهٔ ذخیره‌شده با انتخاب فعلی فرق دارد؛ برای جلوگیری از ثبت در محل اشتباه، ارسال متوقف است.</small>}
    <div className="pending-sync-actions">{canRetry && <button className="button button-text" type="button" disabled={!online || item.status === "syncing"} onClick={() => onRetry(item.id)}>{item.status === "pending" ? "ارسال" : item.status === "conflict" ? "ارسال در این شعبه" : online ? "تلاش دوباره" : "پس از اتصال تلاش کنید"}</button>}<button className="button button-text" type="button" onClick={() => onRemove(item.id)}>{item.status === "succeeded" ? "پاک‌کردن سابقه از دستگاه" : "حذف پیش‌نویس"}</button></div>
  </article>;
}

type DashboardOnboarding = { branch: { id: string; name: string }; steps: Array<{ title: string; status: string }>; firstDocument: { id: string } | null; resultViewedAt: string | null; resultViewedByCurrentUser: boolean; activationComplete: boolean };

export function DashboardPage({ business, branchId, pendingCount }: { business: BusinessSummary; branchId: string; pendingCount: number }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["dashboard"], queryFn: () => get<Dashboard>("/reports/dashboard") });
  const onboarding = useQuery({ queryKey: ["onboarding", business.id, branchId], queryFn: () => get<DashboardOnboarding>("/onboarding"), enabled: Boolean(branchId) });
  const viewedOperation = useRef("");
  const pendingViewedOperation = useRef("");
  const data = query.data;
  useEffect(() => {
    const status = onboarding.data;
    if (!navigator.onLine || !query.isSuccess || !status?.firstDocument) return;
    const operationKey = `${business.id}:${status.branch.id}:${status.firstDocument.id}`;
    if (viewedOperation.current === operationKey || pendingViewedOperation.current === operationKey) return;
    pendingViewedOperation.current = operationKey;
    if (!status.resultViewedByCurrentUser) trackOnboardingEvent("dashboard_viewed_after_first_document", "result");
    void patch("/onboarding/progress", { action: "mark_result_viewed" }).then(() => {
      viewedOperation.current = operationKey;
      return client.invalidateQueries({ queryKey: ["onboarding", business.id] });
    }).catch(() => { viewedOperation.current = ""; }).finally(() => { pendingViewedOperation.current = ""; });
  }, [business.id, client, onboarding.data, query.isSuccess]);
  const stats = [
    { label: "فروش خالص", value: data ? money(data.netSalesRial, data.displayCurrency) : "—", detail: `${faNumber(data?.salesCount ?? 0)} فاکتور`, icon: ShoppingCart, tone: "emerald" },
    { label: "دریافت", value: data ? money(data.receiptsRial, data.displayCurrency) : "—", detail: "وجه دریافت‌شده", icon: ArrowDownLeft, tone: "blue" },
    { label: "هزینه", value: data ? money(data.expensesRial, data.displayCurrency) : "—", detail: `${faNumber(data?.expenseCount ?? 0)} سند`, icon: ArrowUpRight, tone: "amber" },
    { label: "سود ناخالص", value: data?.grossProfitAvailable ? money(data.grossProfitRial, data.displayCurrency) : "در دسترس نیست", detail: "فروش منهای بهای تمام‌شده", icon: ChartNoAxesCombined, tone: "violet" },
  ];
  return <PageHeader title="خانه" subtitle={`نمای امروز · ${jalaliDate(todayISO())}`}><div className="dashboard-page">{onboarding.data && <OnboardingResumeCard status={onboarding.data} />} {onboarding.isError && <div className="notice notice-warning">چک‌لیست راه‌اندازی فعلاً بارگیری نشد. <Link to="/app/onboarding">باز کردن راهنمای شروع</Link></div>}{query.isError && <InlineError error={query.error} retry={() => void query.refetch()} />}{pendingCount > 0 && <div className="notice notice-warning"><Activity size={18} /><span>{faNumber(pendingCount)} عملیات فروش روی این دستگاه ذخیره شده و هنوز به سرور نرسیده است.</span></div>}{data && <><div className="metric-grid">{stats.map((stat) => <MetricCard key={stat.label} {...stat} />)}</div><section className="card cash-card"><div><div className="icon-tile emerald"><Wallet size={21} /></div><span><strong>موجودی صندوق و بانک</strong><small>ماندهٔ ثبت‌شده در این شعبه</small></span></div><strong className="cash-value">{money(data.cashPositionRial, data.displayCurrency)}</strong></section><div className="dashboard-columns"><section className="card"><SectionTitle title="اقدام سریع" action={<span className="eyebrow">برای شروع روز</span>} /><div className="quick-grid"><QuickAction to="/app/sales" icon={ShoppingCart} label="ثبت فروش" tone="emerald" /><QuickAction to="/app/expenses" icon={ReceiptText} label="ثبت هزینه" tone="amber" /><QuickAction to="/app/customers" icon={UsersRound} label="مشتریان" tone="blue" /><QuickAction to="/app/products" icon={PackagePlus} label="افزودن کالا" tone="violet" /></div></section><section className="card low-stock-card"><SectionTitle title="موجودی رو به اتمام" action={<Link to="/app/inventory">مشاهدهٔ همه</Link>} />{data.lowStock.length ? <div className="compact-list">{data.lowStock.slice(0, 4).map((product) => <div className="compact-row" key={product.id}><span className="product-avatar"><Boxes size={18} /></span><span className="row-grow"><strong>{product.name}</strong><small>حد سفارش {faNumber(product.reorderPoint)}</small></span><span className="stock-warning">{faNumber(product.quantity)} <small>{product.unit}</small></span></div>)}</div> : <EmptyState icon={Boxes} title="موجودی کم پیدا نشد" text="هشدار کمبود کالا اینجا نمایش داده می‌شود." />}</section></div><section className="card trend-card"><SectionTitle title="فروش در بازهٔ جاری" action={<Link to="/app/reports">گزارش‌ها</Link>} />{data.salesTrend.length ? <div className="trend-list">{data.salesTrend.map((item) => <div className="trend-row" key={item.date}><span>{jalaliDate(item.date)}</span><div className="trend-track"><i style={{ width: `${trendPercent(item.totalRial, data.salesTrend)}%` }} /></div><strong>{money(item.totalRial, data.displayCurrency)}</strong></div>)}</div> : <EmptyState icon={ChartNoAxesCombined} title="فروشی در این بازه ثبت نشده" text="پس از ثبت فروش، نمودار روزانه اینجا تکمیل می‌شود." />}</section></>}{query.isPending && <LoadingBlock />}<p className="page-footnote">{business.displayName} · همهٔ مبالغ بر اساس اسناد ثبت‌شدهٔ این شعبه است.</p></div></PageHeader>;
}

function OnboardingResumeCard({ status }: { status: DashboardOnboarding }) {
  const next = status.steps.find((step) => step.status === "NEEDS_ACTION");
  return <section className={`card onboarding-resume-card ${status.activationComplete ? "complete" : ""}`}>
    <span className="onboarding-resume-icon"><BadgeCheck size={20} /></span>
    <div><strong>{status.activationComplete ? "راه‌اندازی اولیه کامل شد" : next ? `ادامهٔ راه‌اندازی · ${status.branch.name}` : `راهنمای شروع · ${status.branch.name}`}</strong><p>{status.activationComplete ? "هر زمان خواستید از فهرست راهنما، انتخاب‌ها و مراحل اختیاری را ببینید." : next ? next.title + " هنوز نیازمند اقدام است." : "وضعیت فعلی شعبه و دسترسی نقش خود را ببینید."}</p></div>
    <Link className="button button-secondary" to="/app/onboarding">{status.activationComplete ? "باز کردن چک‌لیست" : "ادامه"}</Link>
  </section>;
}

function PwaInstallNudge({ businessId, branchId }: { businessId?: string; branchId?: string }) {
  const [available, setAvailable] = useState(Boolean(deferredInstallPrompt));
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const onboarding = useQuery({ queryKey: ["onboarding", businessId, branchId], queryFn: () => get<DashboardOnboarding>("/onboarding"), enabled: Boolean(businessId && branchId) });
  useEffect(() => {
    const update = () => setAvailable(Boolean(deferredInstallPrompt));
    window.addEventListener("shopro:install-available", update);
    return () => window.removeEventListener("shopro:install-available", update);
  }, []);
  useEffect(() => {
    if (!available || !onboarding.data?.activationComplete) return;
    const shownKey = `shopro_pwa_install_shown_${businessId}_${branchId}`;
    if (sessionStorage.getItem(shownKey)) return;
    sessionStorage.setItem(shownKey, "1");
    setVisible(true);
    trackOnboardingEvent("pwa_install_prompt_shown", "pwa");
  }, [available, businessId, branchId, onboarding.data?.activationComplete]);
  const install = async () => {
    const prompt = deferredInstallPrompt;
    if (!prompt) { setVisible(false); return; }
    setBusy(true); setError("");
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") trackOnboardingEvent("pwa_install_prompt_accepted", "pwa");
      deferredInstallPrompt = null;
      setAvailable(false); setVisible(false);
    } catch {
      setError("پیشنهاد نصب از مرورگر دریافت نشد. می‌توانید به کار با نسخهٔ وب ادامه دهید.");
      deferredInstallPrompt = null;
      setAvailable(false);
    } finally { setBusy(false); }
  };
  if (!visible || !available) return null;
  return <aside className="pwa-install-nudge" dir="rtl" role="status" aria-live="polite"><div><strong>{error || "می‌خواهید شاپرو را روی این دستگاه نصب کنید؟"}</strong><p>نصب اختیاری است و مانع ادامهٔ کار نمی‌شود.</p></div><button className="button button-primary" type="button" disabled={busy} onClick={() => void install()}>{busy ? "در حال باز کردن پیشنهاد نصب…" : "نصب شاپرو"}</button><button className="button button-text" type="button" disabled={busy} onClick={() => setVisible(false)}>بعداً</button></aside>;
}

export function PageHeader({ title, subtitle, children, actions }: { title: string; subtitle?: string; children: ReactNode; actions?: ReactNode }) { return <div className="page-wrap"><header className="page-heading"><div><span className="eyebrow">فضای کاری</span><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</header>{children}</div>; }
export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) { return <div className="section-title"><h2>{title}</h2>{action && <span>{action}</span>}</div>; }
export function Field({ label, value, onChange, type = "text", placeholder, required = false, dir, inputMode, disabled = false, id, error }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string; required?: boolean; dir?: "ltr" | "rtl"; inputMode?: "text" | "numeric" | "decimal" | "tel"; disabled?: boolean; id?: string; error?: string }) { return <label className="field" htmlFor={id}><span className="field-label">{label}{required && <i> *</i>}</span><input id={id} type={type} inputMode={inputMode} dir={dir} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} required={required} disabled={disabled} aria-invalid={error ? true : undefined} aria-describedby={error && id ? `${id}-error` : undefined} />{error && <span className="field-error" id={id ? `${id}-error` : undefined} role="alert">{error}</span>}</label>; }
export function SelectField({ label, value, onChange, options, placeholder, onAdd, addLabel, optionsKey, loadOptions, onBrowseAll, browseAllLabel }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; placeholder?: string; onAdd?: () => void; addLabel?: string; optionsKey?: string; loadOptions?: PickerOptionLoader; onBrowseAll?: () => void; browseAllLabel?: string }) { return <OptionPicker label={label} value={value} onChange={onChange} options={options} placeholder={placeholder} onAdd={onAdd} addLabel={addLabel} optionsKey={optionsKey} loadOptions={loadOptions} onBrowseAll={onBrowseAll} browseAllLabel={browseAllLabel} />; }
export function SubmitButton({ children, busy, type = "submit" }: { children: ReactNode; busy?: boolean; type?: "button" | "submit" }) { return <button className="button button-primary" type={type} disabled={busy}>{busy ? "در حال ثبت…" : children}</button>; }
export function EmptyState({ icon: Icon, title, text, action }: { icon: typeof Boxes; title: string; text: string; action?: React.ReactNode }) { return <div className="empty-state"><span className="empty-icon"><Icon size={24} /></span><strong>{title}</strong><p>{text}</p>{action}</div>; }
export function LoadingBlock() { return <div className="loading-block" aria-label="در حال بارگیری"><i /><i /><i /></div>; }
export function InlineError({ error, retry }: { error: unknown; retry?: () => void }) { return <div className="notice notice-error" role="alert"><CircleHelp size={18} /><span>{messageOf(error)}</span>{retry && <button onClick={retry}>تلاش دوباره</button>}</div>; }
export function MetricCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: typeof Wallet; tone: string }) { return <section className="metric-card"><span className={`icon-tile ${tone}`}><Icon size={20} /></span><span className="metric-text"><small>{label}</small><strong>{value}</strong><span>{detail}</span></span></section>; }
export function QuickAction({ to, icon: Icon, label, tone }: { to: string; icon: typeof Wallet; label: string; tone: string }) { return <Link to={to} className="quick-action"><span className={`icon-tile ${tone}`}><Icon size={19} /></span><span>{label}</span><Plus size={15} /></Link>; }
export function DataRows({ rows, emptyTitle, emptyText, icon = FileText, action, onRowClick }: { rows: Array<{ id: string; title: string; subtitle?: string; amount?: string; status?: string; tone?: string }>; emptyTitle: string; emptyText: string; icon?: typeof Boxes; action?: ReactNode; onRowClick?: (id: string) => void }) { return rows.length ? <div className="data-list">{rows.map((row) => { const content = <><span className="row-symbol"><FileText size={18} /></span><span className="row-grow"><strong>{row.title}</strong>{row.subtitle && <small>{row.subtitle}</small>}</span>{row.status && <span className={`status-badge ${row.tone ?? ""}`}>{row.status}</span>}{row.amount && <strong className="row-amount">{row.amount}</strong>}</>; return onRowClick ? <button className="data-row data-row-action" type="button" key={row.id} onClick={() => onRowClick(row.id)}>{content}</button> : <div className="data-row" key={row.id}>{content}</div>; })}</div> : <EmptyState icon={icon} title={emptyTitle} text={emptyText} action={action} />; }
export function LoadMoreButton({ hasMore, isLoading, onClick }: { hasMore: boolean; isLoading: boolean; onClick: () => void }) { return hasMore ? <div className="pagination-more"><button className="button button-secondary" type="button" disabled={isLoading} onClick={onClick}>{isLoading ? "در حال بارگذاری…" : "نمایش موارد قدیمی‌تر"}</button></div> : null; }
export function useBusinessCurrency(currency: "IRR" | "IRT") { return useMemo(() => (value: string | bigint | null | undefined) => money(value, currency), [currency]); }
export function messageOf(error: unknown) { if (error instanceof ApiError) return error.message; if (error instanceof Error) return error.message; if (typeof error === "string" && error.trim()) return error; return "مشکلی پیش آمد. دوباره تلاش کنید."; }
export function useInvalidate() { const client = useQueryClient(); return () => { void client.invalidateQueries(); }; }

function BottomNav() { return <nav className="bottom-nav" aria-label="ناوبری اصلی">{[{ to: "/app", label: "خانه", icon: House, end: true }, { to: "/app/sales", label: "فروش", icon: ShoppingCart }, { to: "/app/invoices", label: "فاکتورها", icon: FileText }, { to: "/app/finance", label: "صندوق", icon: Wallet }, { to: "/app/ledger", label: "دفتر", icon: BookOpen }, { to: "/app/reports", label: "گزارش", icon: ChartNoAxesCombined }, { to: "/app/settings", label: "بیشتر", icon: Menu }].map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `bottom-link ${isActive ? "active" : ""}`}><item.icon size={20} /><span>{item.label}</span></NavLink>)}</nav>; }
const navItems = [{ to: "/app/storefront", label: "فروشگاه عمومی", icon: Store, feature: true }, { to: "/app", label: "خانه", icon: House }, { to: "/app/onboarding", label: "راهنمای شروع", icon: BadgeCheck }, { to: "/app/sales", label: "ثبت فروش", icon: ShoppingCart }, { to: "/app/invoices", label: "فاکتورها", icon: FileText }, { to: "/app/customers", label: "مشتریان", icon: UsersRound }, { to: "/app/suppliers", label: "تأمین‌کنندگان", icon: Truck }, { to: "/app/products", label: "کالاها", icon: PackagePlus }, { to: "/app/services", label: "خدمات", icon: BriefcaseBusiness }, { to: "/app/inventory", label: "موجودی انبار", icon: Boxes }, { to: "/app/purchases", label: "خرید", icon: ShoppingBag }, { to: "/app/expenses", label: "هزینه‌ها", icon: ReceiptText }, { to: "/app/finance", label: "صندوق و بانک", icon: Wallet }, { to: "/app/ledger", label: "دفتر مالی", icon: BookOpen }, { to: "/app/reports", label: "گزارش‌ها", icon: ChartNoAxesCombined }, { to: "/app/subscription", label: "اشتراک شعبه", icon: CreditCard }, { to: "/app/settings", label: "تنظیمات", icon: Settings }];
function roleLabel(role?: MemberRole) { return role ? ({ OWNER: "مالک", MANAGER: "مدیر", ACCOUNTANT: "حسابدار", CASHIER: "صندوقدار", VIEWER: "مشاهده‌گر" } as Record<MemberRole, string>)[role] : "عضو"; }
function rememberedScopeKey(userId: string) { return `shopro_last_scope_${userId}`; }
function readRememberedScope(userId: string) {
  try {
    const raw = localStorage.getItem(rememberedScopeKey(userId));
    if (!raw) return null;
    const value = JSON.parse(raw);
    return typeof value?.businessId === "string" && typeof value?.branchId === "string" ? { businessId: value.businessId, branchId: value.branchId } : null;
  } catch { return null; }
}
function rememberScope(userId: string, businessId: string, branchId: string) {
  if (!businessId || !branchId) return;
  try { localStorage.setItem(rememberedScopeKey(userId), JSON.stringify({ businessId, branchId })); } catch { /* server membership remains authoritative if storage is unavailable */ }
}
function trendPercent(value: string, rows: Dashboard["salesTrend"]) { const max = rows.reduce((top, item) => BigInt(item.totalRial) > top ? BigInt(item.totalRial) : top, 0n); return max === 0n ? 0 : Math.max(5, Number((BigInt(value) * 100n) / max)); }
function LoadingScreen() { return <div className="full-screen-state" dir="rtl"><BrandLogo alt="" /><div className="loading-block"><i /><i /><i /></div></div>; }
function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="full-screen-state" dir="rtl"><div className="brand-icon danger"><CircleHelp /></div><h1>اتصال برقرار نشد</h1><p>{message}</p><button className="button button-primary" onClick={onRetry}>تلاش دوباره</button></div>; }
async function syncPendingSales(userId: string, setCount: (count: number) => void, setItems: (items: PendingSale[]) => void, options: { retryFailed?: boolean; itemId?: string } = {}) {
  const scopeBusinessId = sessionStorage.getItem("shopro_business_id");
  const scopeBranchId = sessionStorage.getItem("shopro_branch_id");
  const items = (await listPendingSales()).filter((item) => item.userId === userId && (!options.itemId || item.id === options.itemId));
  let failed = 0; let wrongScope = 0; let waitingForAction = 0; let succeeded = 0;
  const refresh = async () => {
    const owned = (await listPendingSales()).filter((item) => item.userId === userId);
    setItems(owned); setCount(countAwaitingServer(owned));
  };
  for (const item of items) {
    if (item.status === "succeeded" || item.status === "syncing") continue;
    const scopeMatches = item.businessId === scopeBusinessId && item.branchId === scopeBranchId;
    if (!scopeMatches) {
      if (item.status !== "conflict" || item.conflictType !== "server") {
        await markPendingSaleScopeConflict(item.id, "برای جلوگیری از ثبت اشتباه، کسب‌وکار و شعبهٔ ثبت‌شده را انتخاب کنید.");
      }
      wrongScope++;
      continue;
    }
    if (item.status === "conflict" && item.conflictType !== "scope") { waitingForAction++; continue; }
    if (item.status === "failed" && (!options.retryFailed || !isQueueItemManuallyRetryable(item, scopeMatches))) { waitingForAction++; continue; }
    if (item.status === "conflict" && !options.retryFailed) { waitingForAction++; continue; }
    if (!isQueueItemAutomaticallySyncable(item) && item.status !== "failed" && item.status !== "conflict") continue;
    if (item.status === "failed" || item.status === "conflict") await markPendingSaleForRetry(item.id);
    await markPendingSaleSyncing(item.id);
    await refresh();
    try {
      const result = await post<{ status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CONFLICT"; serverInvoiceNo?: string | null; message?: string | null }>("/sync/operations", {
        deviceId: await getOfflineDeviceId(),
        clientOperationId: item.id,
        operationType: "SALE_CREATE_AND_POST",
        sale: item.sale,
        ...(item.payment ? { payment: item.payment } : {}),
        retryFailed: options.retryFailed === true,
      });
      if (result.status === "SUCCEEDED") {
        await markPendingSaleSucceeded(item.id, result.serverInvoiceNo ?? undefined);
        trackOnboardingEvent("first_document_posted", "first_operation");
        succeeded++;
      } else if (result.status === "CONFLICT") {
        await markPendingSaleFailed(item.id, result.message ?? "اطلاعات فروش نیازمند بازبینی است.", false);
        waitingForAction++;
      } else if (result.status === "FAILED") {
        await markPendingSaleFailed(item.id, result.message ?? "ارسال فروش موقتاً انجام نشد؛ دوباره تلاش کنید.", true);
        failed++;
      } else {
        await markPendingSaleFailed(item.id, "همگام‌سازی این فروش هنوز در حال انجام است؛ کمی بعد وضعیت را بررسی و دوباره تلاش کنید.", true);
        failed++;
      }
    } catch (cause) {
      const result = classifyOfflineFailure(cause);
      await markPendingSaleFailed(item.id, messageOf(cause), result.retryable);
      if (result.retryable) failed++;
      else waitingForAction++;
    }
  }
  await refresh();
  const message = wrongScope ? "برای ارسال موارد باقی‌مانده، کسب‌وکار و شعبهٔ ثبت‌شده در همان مورد را انتخاب کنید."
    : failed ? `${faNumber(failed)} مورد به‌دلیل خطای موقت ارسال نشد؛ وضعیت هر مورد را بررسی و دستی دوباره تلاش کنید.`
      : waitingForAction ? `${faNumber(waitingForAction)} مورد نیازمند اصلاح یا اقدام شماست؛ این موارد خودکار تکرار نمی‌شوند.`
        : succeeded ? `${faNumber(succeeded)} فروش پس از تأیید سرور ثبت شد.`
          : "";
  return { message, error: wrongScope > 0 || failed > 0 || waitingForAction > 0 };
}
