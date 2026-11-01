import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowDownLeft, ArrowUpRight, BriefcaseBusiness, Boxes, ChartNoAxesCombined, ChevronDown, CircleHelp, FileText, House, LogOut, Menu, PackagePlus, Plus, ReceiptText, Settings, ShoppingBag, ShoppingCart, UsersRound, Wallet, Wifi, WifiOff, X } from "lucide-react";
import type { BusinessSummary, MemberRole, SessionUser } from "@shopro/contracts";
import { ApiError, get, post } from "./lib/api.js";
import { faNumber, jalaliDate, money, todayISO } from "./lib/format.js";
import { listPendingSales, removePendingSale } from "./lib/offline.js";
import { ExpensesPage, FinancePage, InventoryPage, PartiesPage, ProductsPage, PurchasesPage, ReportsPage, SalesPage, SettingsPage, InvoicesPage } from "./pages/Pages.js";

type SessionResponse = { user: SessionUser & { businessId?: string; branchId?: string; role?: MemberRole } };
type Dashboard = { displayCurrency: "IRR" | "IRT"; salesRial: string; netSalesRial: string; receiptsRial: string; expensesRial: string; grossProfitRial: string | null; grossProfitAvailable: boolean; salesCount: number; expenseCount: number; accountBalances: Array<{ id: string; name: string; balanceRial: string }>; cashPositionRial: string; lowStock: Array<{ id: string; name: string; quantity: string; reorderPoint: string; unit: string }>; openInvoices: number; salesTrend: Array<{ date: string; totalRial: string }> };

export function App() { return <BrowserRouter><AppContent /></BrowserRouter>; }

function AppContent() {
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: ["session"], queryFn: () => get<SessionResponse>("/auth/session"), retry: false });
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("shopro_theme") ?? "auto");
  const [syncError, setSyncError] = useState("");
  const location = useLocation();
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    void listPendingSales().then((items) => setPendingCount(items.length));
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("shopro_theme", theme); }, [theme]);
  if (session.isPending) return <LoadingScreen />;
  if (session.isError) {
    if (session.error instanceof ApiError && session.error.status !== 401) return <ErrorScreen message={session.error.message} onRetry={() => void session.refetch()} />;
    return <AuthScreen />;
  }
  return <BusinessGate user={session.data.user} online={online} pendingCount={pendingCount} setPendingCount={setPendingCount} menuOpen={menuOpen} setMenuOpen={setMenuOpen} theme={theme} setTheme={setTheme} syncError={syncError} setSyncError={setSyncError} onLogout={async () => { await post("/auth/logout"); sessionStorage.removeItem("shopro_business_id"); sessionStorage.removeItem("shopro_branch_id"); await queryClient.clear(); window.location.assign("/login"); }} />;
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

function BusinessGate({ user, online, pendingCount, setPendingCount, menuOpen, setMenuOpen, theme, setTheme, syncError, setSyncError, onLogout }: { user: SessionResponse["user"]; online: boolean; pendingCount: number; setPendingCount: (count: number) => void; menuOpen: boolean; setMenuOpen: (open: boolean) => void; theme: string; setTheme: (value: string) => void; syncError: string; setSyncError: (value: string) => void; onLogout: () => void }) {
  const businesses = useQuery({ queryKey: ["businesses"], queryFn: () => get<BusinessSummary[]>("/businesses") });
  const [businessId, setBusinessId] = useState(sessionStorage.getItem("shopro_business_id") ?? "");
  const [branchId, setBranchId] = useState(sessionStorage.getItem("shopro_branch_id") ?? "");
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
  useEffect(() => { if (online && pendingCount > 0) void syncPendingSales(setPendingCount).catch((cause) => setSyncError(messageOf(cause))); }, [online, pendingCount, setPendingCount, setSyncError]);
  if (businesses.isPending) return <LoadingScreen />;
  if (businesses.isError) return <ErrorScreen message={messageOf(businesses.error)} onRetry={() => void businesses.refetch()} />;
  if (!rows.length) return <OnboardingPage />;
  return <div className="workspace" dir="rtl">
    <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="باز کردن فهرست">{menuOpen ? <X /> : <Menu />}</button><Link className="top-brand" to="/app"><img className="brand-logo small" src="/icons/Logo.webp" alt="" /><span>شاپرو</span></Link><div className="topbar-selectors"><label className="select-wrap"><span className="sr-only">کسب‌وکار جاری</span><BriefcaseBusiness size={15} /><select aria-label="کسب‌وکار جاری" value={activeBusiness?.id ?? ""} onChange={(event) => { const next = rows.find((row) => row.id === event.target.value); if (!next) return; setBusinessId(next.id); setBranchId(next.branches[0]?.id ?? ""); sessionStorage.setItem("shopro_business_id", next.id); sessionStorage.setItem("shopro_branch_id", next.branches[0]?.id ?? ""); }}>{rows.map((row) => <option key={row.id} value={row.id}>{row.displayName}</option>)}</select><ChevronDown size={14} /></label>{activeBusiness && <label className="select-wrap branch-select"><span className="sr-only">شعبه جاری</span><select aria-label="شعبه جاری" value={activeBranch?.id ?? ""} onChange={(event) => { setBranchId(event.target.value); sessionStorage.setItem("shopro_branch_id", event.target.value); }}>{activeBusiness.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select><ChevronDown size={14} /></label>}</div><span className={`connection-pill ${online ? "is-online" : "is-offline"}`}>{online ? <Wifi size={15} /> : <WifiOff size={15} />}<span>{online ? "متصل" : "آفلاین"}</span></span><button className="icon-button top-user" title="خروج" onClick={() => void onLogout()}><LogOut size={18} /></button></header>
    <div className="workspace-body"><aside className={`side-nav ${menuOpen ? "open" : ""}`} aria-label="ناوبری"><div className="side-business"><span className="avatar">{activeBusiness?.displayName.slice(0, 1)}</span><div><strong>{activeBusiness?.displayName}</strong><span>{activeBranch?.name} · {roleLabel(activeBusiness?.role)}</span></div></div><nav>{navItems.map((item) => <NavLink to={item.to} key={item.to} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}><item.icon size={19} /><span>{item.label}</span></NavLink>)}</nav><div className="side-bottom"><button className="nav-item nav-plain" onClick={() => void onLogout()}><LogOut size={19} /><span>خروج از حساب</span></button><small>نسخهٔ آزمایشی · {user.displayName ?? user.phone}</small></div></aside>
      {menuOpen && <button className="nav-overlay" onClick={() => setMenuOpen(false)} aria-label="بستن فهرست" />}
      <main className="page-content"><Routes><Route path="/app" element={<DashboardPage business={activeBusiness!} pendingCount={pendingCount} />} /><Route path="/app/sales" element={<SalesPage currency={activeBusiness!.displayCurrency} setPendingCount={setPendingCount} />} /><Route path="/app/invoices" element={<InvoicesPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/parties" element={<PartiesPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/products" element={<ProductsPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/inventory" element={<InventoryPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/purchases" element={<PurchasesPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/expenses" element={<ExpensesPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/finance" element={<FinancePage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/reports" element={<ReportsPage currency={activeBusiness!.displayCurrency} />} /><Route path="/app/settings" element={<SettingsPage business={activeBusiness!} theme={theme} setTheme={setTheme} />} /><Route path="*" element={<Navigate to="/app" replace />} /></Routes></main></div>
    <BottomNav />{syncError && pendingCount > 0 && <div className="pending-error" role="alert">{syncError}</div>}{pendingCount > 0 && <button className="pending-banner" onClick={() => { setSyncError(""); void syncPendingSales(setPendingCount).catch((cause) => setSyncError(messageOf(cause))); }}><Activity size={16} /><span>{faNumber(pendingCount)} پیش‌نویس آفلاین منتظر ارسال است</span><span>ارسال</span></button>}
  </div>;
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
export function SelectField({ label, value, onChange, options, placeholder }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; placeholder?: string }) { return <label className="field"><span className="field-label">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">{placeholder ?? "انتخاب کنید"}</option>{options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>; }
export function SubmitButton({ children, busy, type = "submit" }: { children: ReactNode; busy?: boolean; type?: "button" | "submit" }) { return <button className="button button-primary" type={type} disabled={busy}>{busy ? "در حال ثبت…" : children}</button>; }
export function EmptyState({ icon: Icon, title, text, action }: { icon: typeof Boxes; title: string; text: string; action?: React.ReactNode }) { return <div className="empty-state"><span className="empty-icon"><Icon size={24} /></span><strong>{title}</strong><p>{text}</p>{action}</div>; }
export function LoadingBlock() { return <div className="loading-block" aria-label="در حال بارگیری"><i /><i /><i /></div>; }
export function InlineError({ error, retry }: { error: unknown; retry?: () => void }) { return <div className="notice notice-error" role="alert"><CircleHelp size={18} /><span>{messageOf(error)}</span>{retry && <button onClick={retry}>تلاش دوباره</button>}</div>; }
export function MetricCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: typeof Wallet; tone: string }) { return <section className="metric-card"><span className={`icon-tile ${tone}`}><Icon size={20} /></span><span className="metric-text"><small>{label}</small><strong>{value}</strong><span>{detail}</span></span></section>; }
export function QuickAction({ to, icon: Icon, label, tone }: { to: string; icon: typeof Wallet; label: string; tone: string }) { return <Link to={to} className="quick-action"><span className={`icon-tile ${tone}`}><Icon size={19} /></span><span>{label}</span><Plus size={15} /></Link>; }
export function DataRows({ rows, emptyTitle, emptyText, icon = FileText, action, onRowClick }: { rows: Array<{ id: string; title: string; subtitle?: string; amount?: string; status?: string; tone?: string }>; emptyTitle: string; emptyText: string; icon?: typeof Boxes; action?: ReactNode; onRowClick?: (id: string) => void }) { return rows.length ? <div className="data-list">{rows.map((row) => { const content = <><span className="row-symbol"><FileText size={18} /></span><span className="row-grow"><strong>{row.title}</strong>{row.subtitle && <small>{row.subtitle}</small>}</span>{row.status && <span className={`status-badge ${row.tone ?? ""}`}>{row.status}</span>}{row.amount && <strong className="row-amount">{row.amount}</strong>}</>; return onRowClick ? <button className="data-row data-row-action" type="button" key={row.id} onClick={() => onRowClick(row.id)}>{content}</button> : <div className="data-row" key={row.id}>{content}</div>; })}</div> : <EmptyState icon={icon} title={emptyTitle} text={emptyText} action={action} />; }
export function useBusinessCurrency(currency: "IRR" | "IRT") { return useMemo(() => (value: string | bigint | null | undefined) => money(value, currency), [currency]); }
export function messageOf(error: unknown) { if (error instanceof ApiError) return error.message; if (error instanceof Error) return error.message; return "مشکلی پیش آمد. دوباره تلاش کنید."; }
export function useInvalidate() { const client = useQueryClient(); return () => { void client.invalidateQueries(); }; }

function BottomNav() { return <nav className="bottom-nav" aria-label="ناوبری اصلی">{[{ to: "/app", label: "خانه", icon: House, end: true }, { to: "/app/sales", label: "فروش", icon: ShoppingCart }, { to: "/app/invoices", label: "فاکتورها", icon: FileText }, { to: "/app/reports", label: "گزارش", icon: ChartNoAxesCombined }, { to: "/app/settings", label: "بیشتر", icon: Menu }].map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `bottom-link ${isActive ? "active" : ""}`}><item.icon size={20} /><span>{item.label}</span></NavLink>)}</nav>; }
const navItems = [{ to: "/app", label: "خانه", icon: House }, { to: "/app/sales", label: "ثبت فروش", icon: ShoppingCart }, { to: "/app/invoices", label: "فاکتورها", icon: FileText }, { to: "/app/parties", label: "مشتریان و تأمین‌کنندگان", icon: UsersRound }, { to: "/app/products", label: "کالا و خدمات", icon: PackagePlus }, { to: "/app/inventory", label: "موجودی انبار", icon: Boxes }, { to: "/app/purchases", label: "خرید", icon: ShoppingBag }, { to: "/app/expenses", label: "هزینه‌ها", icon: ReceiptText }, { to: "/app/finance", label: "صندوق و بانک", icon: Wallet }, { to: "/app/reports", label: "گزارش‌ها", icon: ChartNoAxesCombined }, { to: "/app/settings", label: "تنظیمات", icon: Settings }];
function roleLabel(role?: MemberRole) { return role ? ({ OWNER: "مالک", MANAGER: "مدیر", ACCOUNTANT: "حسابدار", CASHIER: "صندوقدار", VIEWER: "مشاهده‌گر" } as Record<MemberRole, string>)[role] : "عضو"; }
function trendPercent(value: string, rows: Dashboard["salesTrend"]) { const max = rows.reduce((top, item) => BigInt(item.totalRial) > top ? BigInt(item.totalRial) : top, 0n); return max === 0n ? 0 : Math.max(5, Number((BigInt(value) * 100n) / max)); }
function LoadingScreen() { return <div className="full-screen-state" dir="rtl"><img className="brand-logo" src="/icons/Logo.webp" alt="" /><div className="loading-block"><i /><i /><i /></div></div>; }
function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="full-screen-state" dir="rtl"><div className="brand-icon danger"><CircleHelp /></div><h1>اتصال برقرار نشد</h1><p>{message}</p><button className="button button-primary" onClick={onRetry}>تلاش دوباره</button></div>; }
async function syncPendingSales(setCount: (count: number) => void) { const items = await listPendingSales(); for (const item of items) { if (sessionStorage.getItem("shopro_business_id") !== item.businessId || sessionStorage.getItem("shopro_branch_id") !== item.branchId) continue; const draft = await post<{ id: string }>("/sales", item.sale, { "Idempotency-Key": item.draftKey }); await post(`/sales/${draft.id}/post`, { payments: item.payment ? [item.payment] : [] }, { "Idempotency-Key": item.postKey }); await removePendingSale(item.id); } setCount((await listPendingSales()).length); }
