import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Building2, CircleDollarSign, CreditCard, Download, KeyRound, LayoutDashboard, LogOut, PackageCheck, RefreshCw, Search, Shield, ShieldAlert, Store, UsersRound } from "lucide-react";
import type { CursorPage } from "@shopro/contracts";
import { BrandLogo } from "../components/BrandLogo.js";
import { ApiError, adminApi, get } from "../lib/api.js";
import { faNumber, jalaliDate, money, todayISO } from "../lib/format.js";
import { InlineError, LoadingBlock } from "../App.js";
import { Modal } from "../components/Modal.js";
import { JalaliDatePicker } from "../components/JalaliDatePicker.js";
import { ManualPaymentsAdminTab, PaymentSettingsAdminTab } from "./SystemAdminManualPayments.js";

type AdminSession = { admin: { id: string; username: string; displayName: string }; csrfToken: string | null };
type BranchRow = { id: string; businessId: string; businessName: string; branchName: string; branchCode: string; branchSubscriptionId: string | null; status: string; suspendedAt: string | null; suspensionReason: string | null; currentPeriod: { startsAt: string; endsAt: string; planNameFa: string | null; durationMonths: number | null; remainingDays: number } | null };
type BranchActionKind = "grant" | "extend" | "suspend" | "unsuspend" | "revoke";
type BranchActionPreview = { observedAt: string; current: { suspended: boolean; activePeriodCount: number; latestPeriod: { startsAt: string; endsAt: string; planNameFa: string | null; durationMonths: number | null } | null }; effect: { startsAt?: string; endsAt?: string; durationMonths?: number; appendsAfterExistingEnd?: boolean; revokedAt?: string; affectedPeriodCount?: number; suspended?: boolean; changesAccess?: boolean } };
type PlanRow = { id: string; code: string; nameFa: string; displayOrder: number; isActive: boolean; badge: string | null; features: string[]; prices: Array<{ id: string; durationMonths: number; priceRial: string; currency: string; effectiveFrom: string; effectiveTo: string | null; consumedOrderCount: number; immutable: boolean }> };
type AdminOrder = { id: string; businessName: string; branchName: string; planNameFa: string; durationMonths: number; amountRial: string; currency: string; status: string; providerReference: string | null; createdAt: string; paidAt: string | null; attempts: Array<{ provider: string; providerExternalId: string | null; amountRial: string; status: string; safeErrorCode: string | null; createdAt: string }> };
type Rollout = { mode: "OBSERVE" | "ENFORCE"; legacyGraceEndsAt: string | null; providerFeeBasisPoints: number | null; taxRateBasisPoints: number | null; variableCostRial: string | null; minimumContributionRial: string | null; report: { totalActiveBranches: number; activeSubscriptions: number; branchesWithoutActiveSubscription: number; suspendedBranches: number }; note: string };
type Tab = "overview" | "businesses" | "branches" | "orders" | "storefront-orders" | "manual-payments" | "payment-settings" | "plans" | "rollout" | "economics" | "audit" | "account";

export function SystemAdminSubscriptionsApp() {
  const client = useQueryClient();
  const session = useQuery({ queryKey: ["system-admin-session"], queryFn: () => get<AdminSession>("/system-admin/session"), retry: false, staleTime: 30_000 });
  const [tab, setTab] = useState<Tab>("overview");
  const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(() => new Set(["overview"]));
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [globalTarget, setGlobalTarget] = useState<{ kind: "businesses" | "branches" | "orders" | "storefront-orders"; q: string } | null>(null);
  const login = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await adminApi("/system-admin/auth/login", { method: "POST", body: JSON.stringify({ username: "shopro_super_admin", password }) });
      setPassword("");
      await client.invalidateQueries({ queryKey: ["system-admin-session"] });
      window.location.assign("/system-admin");
    }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const logout = async () => {
    setBusy(true);
    try { await adminApi("/system-admin/auth/logout", { method: "POST" }, session.data?.csrfToken ?? undefined); await client.removeQueries({ queryKey: ["system-admin-session"] }); window.location.assign("/system-admin/login"); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };

  const selectTab = (next: Tab) => {
    setTab(next);
    setVisitedTabs((current) => current.has(next) ? current : new Set(current).add(next));
  };

  if (session.isPending) return <AdminState><LoadingBlock /></AdminState>;
  if (session.isError && !(session.error instanceof ApiError && session.error.status === 401)) return <AdminState><InlineError error={session.error} retry={() => void session.refetch()} /></AdminState>;
  if (session.isError || !session.data) return <AdminLogin password={password} setPassword={setPassword} busy={busy} error={error} onSubmit={(event) => void login(event)} />;

  const csrf = session.data.csrfToken ?? undefined;
  return <main className="system-admin-page" dir="rtl">
    <header className="system-admin-header"><div className="system-admin-brand"><BrandLogo className="system-admin-logo" alt="" /><div><span>شاپرو</span><strong>مدیریت مرکزی</strong></div></div><div className="system-admin-identity"><span><Shield size={16} /><bdi dir="ltr">{session.data.admin.username}</bdi></span><button className="button button-secondary" type="button" disabled={busy} onClick={() => void logout()}><LogOut size={16} />خروج</button></div></header>
    <div className="system-admin-main"><div className="system-admin-title"><div><span className="eyebrow">حساب تک‌مالک شاپرو</span><h1>پنل مدیریت شاپرو</h1><p>عملیات واقعی کسب‌وکارها، اشتراک، سفارش و پرداخت</p></div><button className="icon-button" type="button" aria-label="تازه‌سازی" onClick={() => { void client.invalidateQueries({ queryKey: ["system-admin"] }); }}><RefreshCw size={18} /></button></div>
      <AdminGlobalSearch csrf={csrf} onSelect={(kind, q) => { setGlobalTarget({ kind, q }); selectTab(kind); }} />
      <nav className="system-admin-tabs" aria-label="بخش‌های مدیریت">{[
        ["overview", "نمای کلی", LayoutDashboard], ["businesses", "کسب‌وکارها", UsersRound], ["branches", "شعبه و اشتراک", Building2], ["orders", "سفارش اشتراک", CreditCard], ["storefront-orders", "سفارش فروشگاه", Store], ["manual-payments", "رسیدهای اشتراک", CreditCard], ["plans", "پلن و قیمت", PackageCheck], ["payment-settings", "تنظیم پرداخت", Shield], ["rollout", "راه‌اندازی", ShieldAlert], ["economics", "اقتصاد اشتراک", CircleDollarSign], ["audit", "رخدادها", Activity], ["account", "امنیت حساب", KeyRound],
      ].map(([key, label, Icon]) => <button type="button" key={key as string} className={tab === key ? "active" : ""} onClick={() => selectTab(key as Tab)}><Icon size={16} />{label as string}</button>)}</nav>
      <div className="system-admin-content">
        {visitedTabs.has("overview") && <div hidden={tab !== "overview"}><AdminDashboard /></div>}
        {visitedTabs.has("businesses") && <div hidden={tab !== "businesses"}><BusinessesAdminTab active={tab === "businesses"} csrf={csrf} initialQ={globalTarget?.kind === "businesses" ? globalTarget.q : undefined} /></div>}
        {visitedTabs.has("branches") && <div hidden={tab !== "branches"}><BranchesAdminTab active={tab === "branches"} csrf={csrf} initialQ={globalTarget?.kind === "branches" ? globalTarget.q : undefined} /></div>}
        {visitedTabs.has("orders") && <div hidden={tab !== "orders"}><OrdersAdminTab csrf={csrf} initialQ={globalTarget?.kind === "orders" ? globalTarget.q : undefined} /></div>}
        {visitedTabs.has("storefront-orders") && <div hidden={tab !== "storefront-orders"}><StorefrontOrdersAdminTab csrf={csrf} initialQ={globalTarget?.kind === "storefront-orders" ? globalTarget.q : undefined} /></div>}
        {visitedTabs.has("manual-payments") && <div hidden={tab !== "manual-payments"}><ManualPaymentsAdminTab csrf={csrf} /></div>}
        {visitedTabs.has("payment-settings") && <div hidden={tab !== "payment-settings"}><PaymentSettingsAdminTab csrf={csrf} /></div>}
        {visitedTabs.has("plans") && <div hidden={tab !== "plans"}><PlansAdminTab csrf={csrf} /></div>}
        {visitedTabs.has("rollout") && <div hidden={tab !== "rollout"}><RolloutAdminTab csrf={csrf} /></div>}
        {visitedTabs.has("economics") && <div hidden={tab !== "economics"}><EconomicsAdminTab /></div>}
        {visitedTabs.has("audit") && <div hidden={tab !== "audit"}><AdminAuditTab csrf={csrf} /></div>}
        {visitedTabs.has("account") && <div hidden={tab !== "account"}><AdminSecurityTab active={tab === "account"} csrf={csrf} onSignedOut={() => window.location.assign("/system-admin/login")} /></div>}
      </div>
    </div>
  </main>;
}

function AdminLogin({ password, setPassword, busy, error, onSubmit }: { password: string; setPassword: (value: string) => void; busy: boolean; error: string; onSubmit: (event: FormEvent) => void }) {
  return <main className="admin-login-page" dir="rtl"><section className="admin-login-card"><BrandLogo className="admin-login-logo" alt="لوگوی شاپرو" /><span className="eyebrow">ورود مالک سامانه</span><h1>مدیریت مرکزی شاپرو</h1><p>این پنل فقط برای مالک شاپرو فعال است.</p><form onSubmit={onSubmit}><label className="field"><span className="field-label">نام کاربری</span><input autoComplete="username" dir="ltr" value="shopro_super_admin" readOnly /></label><label className="field"><span className="field-label">رمز عبور</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={256} /></label><button className="button button-primary full" disabled={busy}>{busy ? "در حال بررسی…" : "ورود امن"}</button></form>{error && <p className="notice notice-error" role="alert">{error}</p>}<small><KeyRound size={14} />نشست مدیریتی روی سرور ذخیره و کنترل می‌شود.</small></section></main>;
}

type GlobalSearchResults = {
  businesses: Array<{ id: string; displayName: string; businessType: string; isActive: boolean }>;
  people: Array<{ id: string; displayName: string | null; phoneMasked: string; businessNames: string[] }>;
  branches: Array<{ id: string; name: string; code: string; businessName: string; isActive: boolean }>;
  subscriptions: Array<{ id: string; planNameFa: string; amountRial: string; currency: string; status: string; createdAt: string; businessName: string; branchName: string }>;
  storefrontOrders: Array<{ id: string; publicCode: string; status: string; paymentStatus: string; totalRial: string; createdAt: string; businessName: string; branchName: string }>;
};

function AdminGlobalSearch({ csrf, onSelect }: { csrf?: string; onSelect: (kind: "businesses" | "branches" | "orders" | "storefront-orders", q: string) => void }) {
  const [q, setQ] = useState(""); const [debounced, setDebounced] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(q.trim()), 300); return () => window.clearTimeout(timer); }, [q]);
  const results = useQuery({
    queryKey: ["system-admin", "global-search", debounced],
    queryFn: () => adminApi<GlobalSearchResults>("/system-admin/search", { method: "POST", body: JSON.stringify({ q: debounced }) }, csrf),
    enabled: debounced.length >= 2,
    retry: false,
  });
  const hasRows = Boolean(results.data && (results.data.businesses.length + results.data.people.length + results.data.branches.length + results.data.subscriptions.length + results.data.storefrontOrders.length));
  return <div className="admin-global-search"><label className="admin-search"><Search size={17} /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="جست‌وجوی شخص، کسب‌وکار، شعبه، اشتراک یا سفارش" aria-label="جست‌وجوی سراسری مدیریت" autoComplete="off" /></label>
    {debounced.length >= 2 && <div className="admin-search-results" role="region" aria-label="نتایج جست‌وجو">
      {results.isPending && <small>در حال جست‌وجو…</small>}
      {results.isError && <small className="danger-text">جست‌وجو انجام نشد.</small>}
      {results.data?.businesses.map((row) => <button key={`b-${row.id}`} type="button" onClick={() => onSelect("businesses", q)}><span>کسب‌وکار</span><strong>{row.displayName}</strong><small>{row.businessType} · {row.isActive ? "فعال" : "معلق"}</small></button>)}
      {results.data?.people.map((row) => <button key={`p-${row.id}`} type="button" onClick={() => onSelect("businesses", q)}><span>شخص</span><strong>{row.displayName || "نام ثبت نشده"}</strong><small><bdi dir="ltr">{row.phoneMasked}</bdi>{row.businessNames.length ? ` · ${row.businessNames.join("، ")}` : " · بدون عضویت فعال"}</small></button>)}
      {results.data?.branches.map((row) => <button key={`br-${row.id}`} type="button" onClick={() => onSelect("branches", q)}><span>شعبه</span><strong>{row.name} · {row.businessName}</strong><small><bdi dir="ltr">{row.code}</bdi></small></button>)}
      {results.data?.subscriptions.map((row) => <button key={`s-${row.id}`} type="button" onClick={() => onSelect("orders", q)}><span>اشتراک</span><strong>{row.planNameFa} · {row.businessName}</strong><small>{row.branchName} · {orderStatus(row.status)}</small></button>)}
      {results.data?.storefrontOrders.map((row) => <button key={`o-${row.id}`} type="button" onClick={() => onSelect("storefront-orders", q)}><span>سفارش فروشگاه</span><strong><bdi dir="ltr">{row.publicCode}</bdi> · {row.businessName}</strong><small>{row.branchName} · {orderStatus(row.status)}</small></button>)}
      {!results.isPending && !results.isError && !hasRows && <small>نتیجه‌ای برای این جست‌وجو پیدا نشد.</small>}
    </div>}
  </div>;
}

type AdminMetric = { value: number | string | null; available: boolean; label: string; formula: string | null; source: string | null; unit: string; previous?: number | string | null; change?: number | string | null; limitation?: string | null };
type DashboardData = { range: { from: string; to: string; previousFrom: string; previousTo: string }; metrics: Record<string, AdminMetric>; trend: Array<{ date: string; amountRial: string }>; trendAvailable: boolean };

function AdminDashboard() {
  const today = todayISO();
  const [from, setFrom] = useState(() => { const date = new Date(`${today}T12:00:00`); date.setDate(date.getDate() - 29); return date.toISOString().slice(0, 10); });
  const [to, setTo] = useState(today);
  const query = useQuery({
    queryKey: ["system-admin", "dashboard", from, to],
    queryFn: () => get<DashboardData>(`/system-admin/dashboard?from=${encodeURIComponent(tehranUtcBoundary(from, false))}&to=${encodeURIComponent(tehranUtcBoundary(to, true))}`),
    enabled: Boolean(from && to),
  });
  return <section className="admin-panel">
    <div className="admin-panel-heading"><div><h2>نمای کلی سامانه</h2><p>شاخص‌ها از رکوردهای عملیاتی شاپرو محاسبه می‌شوند.</p></div><button className="button button-secondary" type="button" onClick={() => void query.refetch()}><RefreshCw size={15} />تازه‌سازی</button></div>
    <div className="admin-date-range"><JalaliDatePicker value={from} onChange={setFrom} label="از تاریخ" clearable /><JalaliDatePicker value={to} onChange={setTo} label="تا تاریخ" clearable /><span>تاریخ انتخابی جلالی است؛ درخواست با زمان UTC ارسال می‌شود.</span></div>
    {query.isError ? <InlineError error={query.error} retry={() => void query.refetch()} /> : query.isPending ? <LoadingBlock /> : <>
      <div className="admin-dashboard-grid">{Object.entries(query.data.metrics).map(([key, metric]) => <article className="admin-kpi-card" key={key}>
        <span>{metric.label}</span>
        <strong>{metric.available ? formatMetric(metric) : "داده در دسترس نیست"}</strong>
        {metric.change !== null && metric.change !== undefined && <small>تغییر نسبت به بازهٔ پیشین: {formatMetricChange(metric)}</small>}
        {metric.limitation && <small className="admin-kpi-limit">{metric.limitation}</small>}
        <details><summary>منبع و فرمول</summary><small>{metric.formula ?? "تعریف نشده"} · {metric.source ?? "منبع در دسترس نیست"}</small></details>
      </article>)}</div>
      <section className="admin-chart-panel"><div className="admin-panel-heading"><div><h3>وصول خالص اشتراک به تفکیک روز</h3><p>مبالغ بر پایهٔ زمان پرداخت و وضعیت فعلی سفارش، به ریال محاسبه شده‌اند.</p></div></div>{query.data.trendAvailable ? <div className="admin-revenue-chart" role="img" aria-label="نمودار وصول خالص اشتراک روزانه">{query.data.trend.map((item) => <div className="admin-revenue-column" key={item.date}><div title={money(item.amountRial, "IRT")}><span style={{ height: `${trendHeight(item.amountRial, query.data.trend)}%` }} /></div><small>{jalaliDate(item.date)}</small><b>{money(item.amountRial, "IRT")}</b></div>)}</div> : <p className="admin-empty">برای این بازه پرداخت اشتراکی ثبت نشده است.</p>}</section>
    </>}
  </section>;
}

type AdminBusinessRow = { id: string; displayName: string; businessType: string; isActive: boolean; suspendedAt: string | null; suspensionReason: string | null; createdAt: string; branchCount: number; memberCount: number; subscriptionOrderCount: number; lastPaidAt: string | null; branches: Array<{ id: string; name: string; code: string; isActive: boolean }> };
type AdminPage<T> = { items: T[]; page: number; pageSize: number; total: number; pageCount: number };

function BusinessesAdminTab({ active, csrf, initialQ }: { active: boolean; csrf?: string; initialQ?: string }) {
  const client = useQueryClient();
  const [q, setQ] = useState(""); const [debounced, setDebounced] = useState(""); const [status, setStatus] = useState(""); const [paymentStatus, setPaymentStatus] = useState(""); const [planCode, setPlanCode] = useState(""); const [minBranches, setMinBranches] = useState(""); const [maxBranches, setMaxBranches] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [sort, setSort] = useState("createdAt"); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState("25");
  const [selectedId, setSelectedId] = useState(""); const [exporting, setExporting] = useState(false); const [exportError, setExportError] = useState("");
  useEffect(() => { if (initialQ !== undefined) { setQ(initialQ); setPage(1); } }, [initialQ]);
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(q.trim()), 300); return () => window.clearTimeout(timer); }, [q]);
  const plans = useQuery({ queryKey: ["system-admin", "plans"], queryFn: () => get<PlanRow[]>("/system-admin/subscriptions/plans"), staleTime: 60_000 });
  useEffect(() => { setPage(1); }, [debounced, status, paymentStatus, planCode, minBranches, maxBranches, from, to, pageSize, sort]);
  const filters = { q: debounced, status: status || undefined, paymentStatus: paymentStatus || undefined, planCode: planCode || undefined, minBranches: minBranches || undefined, maxBranches: maxBranches || undefined, from: from ? tehranUtcBoundary(from, false) : undefined, to: to ? tehranUtcBoundary(to, true) : undefined, sort, direction: sort === "displayName" ? "asc" : "desc", page: String(page), pageSize };
  const rows = useQuery({ queryKey: ["system-admin", "businesses", filters], queryFn: () => adminApi<AdminPage<AdminBusinessRow>>("/system-admin/businesses/query", { method: "POST", body: JSON.stringify(filters) }, csrf) });
  const exportRows = async () => { setExporting(true); setExportError(""); try { await downloadAdminCsv("businesses", { ...filters, page: undefined, pageSize: undefined }, csrf); } catch (cause) { setExportError(errorText(cause)); } finally { setExporting(false); } };
  return <section className="admin-panel"><div className="admin-panel-heading"><div><h2>کسب‌وکارها و کاربران</h2><p>جست‌وجوی سروری با وضعیت، تاریخ ثبت و شاخه‌های ثبت‌شده.</p></div><button className="button button-secondary" type="button" disabled={exporting} onClick={() => void exportRows()}><Download size={15} />{exporting ? "در حال آماده‌سازی…" : "خروجی CSV فیلترشده"}</button></div>
    <div className="admin-filter-row admin-filter-wrap"><label className="admin-search"><Search size={16} /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="نام، شناسه، تلفن کاربر یا شعبه" /></label><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="وضعیت کسب‌وکار"><option value="">همهٔ وضعیت‌ها</option><option value="ACTIVE">فعال</option><option value="SUSPENDED">معلق</option></select><select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)} aria-label="وضعیت پرداخت"><option value="">همهٔ پرداخت‌ها</option><option value="PAID">دارای پرداخت موفق</option><option value="NO_PAID_ORDER">بدون پرداخت موفق</option></select><select value={planCode} onChange={(event) => setPlanCode(event.target.value)} aria-label="پلن اشتراک"><option value="">همهٔ پلن‌ها</option>{(plans.data ?? []).map((plan) => <option key={plan.id} value={plan.code}>{plan.nameFa}</option>)}</select><label className="field admin-count-filter"><span className="field-label">حداقل شعب</span><input type="number" min="0" max="100000" inputMode="numeric" value={minBranches} onChange={(event) => setMinBranches(event.target.value)} /></label><label className="field admin-count-filter"><span className="field-label">حداکثر شعب</span><input type="number" min="0" max="100000" inputMode="numeric" value={maxBranches} onChange={(event) => setMaxBranches(event.target.value)} /></label><JalaliDatePicker value={from} onChange={setFrom} label="ثبت از" clearable /><JalaliDatePicker value={to} onChange={setTo} label="ثبت تا" clearable /><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="مرتب‌سازی کسب‌وکار"><option value="createdAt">جدیدترین</option><option value="displayName">نام</option></select><select value={pageSize} onChange={(event) => setPageSize(event.target.value)} aria-label="اندازهٔ صفحه"><option value="25">۲۵ ردیف</option><option value="50">۵۰ ردیف</option><option value="100">۱۰۰ ردیف</option></select></div>
    {exportError && <p className="notice notice-error" role="alert">{exportError}</p>}
    {rows.isError ? <InlineError error={rows.error} retry={() => void rows.refetch()} /> : rows.isPending ? <LoadingBlock /> : <>
      <div className="admin-table-wrap"><table className="admin-data-table"><thead><tr><th>کسب‌وکار</th><th>وضعیت</th><th>شعب</th><th>اعضا</th><th>آخرین پرداخت</th><th>تاریخ ثبت</th><th></th></tr></thead><tbody>{rows.data.items.map((row) => <tr key={row.id} onClick={() => setSelectedId(row.id)}><td><strong>{row.displayName}</strong><small>{row.businessType} · <bdi dir="ltr">{row.id}</bdi></small></td><td><span className={`admin-status-tag ${row.isActive ? "active" : "suspended"}`}>{row.isActive ? "فعال" : "معلق"}</span></td><td>{faNumber(row.branchCount)}</td><td>{faNumber(row.memberCount)}</td><td>{row.lastPaidAt ? jalaliDate(row.lastPaidAt) : "—"}</td><td>{jalaliDate(row.createdAt)}</td><td><button className="button button-text" type="button" onClick={(event) => { event.stopPropagation(); setSelectedId(row.id); }}>جزئیات</button></td></tr>)}</tbody></table></div>
      {!rows.data.items.length && <p className="admin-empty">کسب‌وکاری با این فیلتر پیدا نشد.</p>}
      <AdminPagination page={page} pageCount={rows.data.pageCount} total={rows.data.total} onPage={setPage} />
    </>}
    {selectedId && <BusinessDetailAdminCard active={active} businessId={selectedId} csrf={csrf} onClose={() => setSelectedId("")} onChanged={() => { void client.invalidateQueries({ queryKey: ["system-admin", "businesses"] }); void client.invalidateQueries({ queryKey: ["system-admin", "dashboard"] }); }} />}
  </section>;
}

type AdminBusinessDetail = {
  id: string; displayName: string; businessType: string; isActive: boolean; suspendedAt: string | null; suspensionReason: string | null; createdAt: string; updatedAt: string;
  branches: Array<{ id: string; name: string; code: string; isActive: boolean; subscription: { suspendedAt: string | null; periods: Array<{ id: string; planNameFa: string | null; durationMonths: number | null; source: string; startsAt: string; endsAt: string }> } | null }>;
  members: Array<{ displayName: string | null; phone: string; role: string; status: string; branchIds: string[] }>;
  subscriptionOrders: Array<{ id: string; branchId: string; planCodeSnapshot: string; planNameFaSnapshot: string; durationMonths: number; amountRial: string; currency: string; status: string; createdAt: string; paidAt: string | null }>;
  storefrontOrders: Array<{ id: string; publicCode: string; branchId: string; status: string; paymentStatus: string; totalRial: string; createdAt: string }>;
  timeline: Array<{ id: string; action: string; entityType: string; entityId: string; occurredAt: string; requestId: string }>;
  notes: Array<{ id: string; note: string; createdAt: string; createdBy: string }>;
};

function BusinessDetailAdminCard({ active, businessId, csrf, onClose, onChanged }: { active: boolean; businessId: string; csrf?: string; onClose: () => void; onChanged: () => void }) {
  const client = useQueryClient(); const [note, setNote] = useState(""); const [reason, setReason] = useState(""); const [currentPassword, setCurrentPassword] = useState(""); const [statusModal, setStatusModal] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  useEffect(() => { if (!active) { setCurrentPassword(""); setReason(""); setStatusModal(false); } }, [active]);
  const detail = useQuery({ queryKey: ["system-admin", "business-detail", businessId], queryFn: () => get<AdminBusinessDetail>(`/system-admin/businesses/${businessId}`) });
  const changeStatus = async (event: FormEvent) => { event.preventDefault(); if (!detail.data) return; setBusy(true); setError(""); try { await adminApi(`/system-admin/businesses/${businessId}/status`, { method: "PATCH", body: JSON.stringify({ isActive: !detail.data.isActive, reason, currentPassword }) }, csrf); setStatusModal(false); setReason(""); setCurrentPassword(""); setNotice("وضعیت کسب‌وکار ثبت شد."); await client.invalidateQueries({ queryKey: ["system-admin", "business-detail", businessId] }); onChanged(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  const addNote = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { await adminApi(`/system-admin/businesses/${businessId}/notes`, { method: "POST", body: JSON.stringify({ note }) }, csrf); setNote(""); setNotice("یادداشت داخلی ثبت شد."); await client.invalidateQueries({ queryKey: ["system-admin", "business-detail", businessId] }); onChanged(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  return <div className="admin-detail-overlay"><section className="admin-detail-card" dir="rtl"><div className="admin-panel-heading"><div><span className="eyebrow">جزئیات کسب‌وکار</span>{detail.data && <h3>{detail.data.displayName}</h3>}</div><button className="icon-button" type="button" onClick={onClose} aria-label="بستن جزئیات">×</button></div>
    {detail.isError ? <InlineError error={detail.error} retry={() => void detail.refetch()} /> : detail.isPending ? <LoadingBlock /> : <>
      <div className="admin-detail-meta"><span>{detail.data.businessType}</span><span>{detail.data.isActive ? "فعال" : "معلق"}</span><span>ثبت: {jalaliDate(detail.data.createdAt)}</span>{detail.data.suspendedAt && <span>تعلیق: {jalaliDate(detail.data.suspendedAt)} · {detail.data.suspensionReason}</span>}</div>
      <div className="admin-detail-actions"><button className={detail.data.isActive ? "button button-danger" : "button button-primary"} type="button" onClick={() => { setReason(""); setError(""); setStatusModal(true); }}>{detail.data.isActive ? "تعلیق کسب‌وکار" : "فعال‌سازی کسب‌وکار"}</button></div>
      <div className="admin-detail-grid"><section><h4>شعب و دوره‌های اشتراک</h4>{detail.data.branches.map((branch) => <article className="admin-mini-row" key={branch.id}><strong>{branch.name} · <bdi dir="ltr">{branch.code}</bdi></strong><span>{branch.isActive ? "شعبه فعال" : "شعبه غیرفعال"}</span>{branch.subscription?.periods.map((period) => <small key={period.id}>{period.planNameFa ?? "اشتراک"} · {period.durationMonths ? durationLabel(period.durationMonths) : "مدت نامشخص"} · {jalaliDate(period.startsAt)} تا {jalaliDate(period.endsAt)} · {period.source}</small>)}</article>)}{!detail.data.branches.length && <p className="admin-empty">شعبه‌ای ثبت نشده است.</p>}</section>
        <section><h4>اعضای کسب‌وکار</h4>{detail.data.members.map((member, index) => <article className="admin-mini-row" key={`${member.phone}-${index}`}><strong>{member.displayName || "کاربر بدون نام"}</strong><bdi dir="ltr">{member.phone}</bdi><small>{member.role} · {member.status}</small></article>)}{!detail.data.members.length && <p className="admin-empty">عضوی ثبت نشده است.</p>}</section>
        <section><h4>سفارش اشتراک اخیر</h4>{detail.data.subscriptionOrders.map((order) => <article className="admin-mini-row" key={order.id}><strong>{order.planNameFaSnapshot} · {money(order.amountRial, "IRT")}</strong><span>{orderStatus(order.status)} · {jalaliDate(order.createdAt)}</span><small>مدت {durationLabel(order.durationMonths)} · <bdi dir="ltr">{order.id}</bdi></small></article>)}{!detail.data.subscriptionOrders.length && <p className="admin-empty">سفارشی ثبت نشده است.</p>}</section>
        <section><h4>سفارش فروشگاه اخیر</h4>{detail.data.storefrontOrders.map((order) => <article className="admin-mini-row" key={order.id}><strong><bdi dir="ltr">{order.publicCode}</bdi> · {money(order.totalRial, "IRT")}</strong><span>{orderStatus(order.status)} · پرداخت {orderStatus(order.paymentStatus)}</span><small>{jalaliDate(order.createdAt)}</small></article>)}{!detail.data.storefrontOrders.length && <p className="admin-empty">سفارش فروشگاهی ثبت نشده است.</p>}</section>
      </div>
      <div className="admin-detail-grid"><section><h4>یادداشت داخلی مالک</h4><form className="admin-note-form" onSubmit={(event) => void addNote(event)}><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} required placeholder="این یادداشت فقط در پنل مدیریت دیده می‌شود." /><button className="button button-secondary" disabled={busy}>ثبت یادداشت</button></form>{detail.data.notes.map((entry) => <article className="admin-mini-row" key={entry.id}><p>{entry.note}</p><small>{entry.createdBy} · {jalaliDate(entry.createdAt)}</small></article>)}</section>
        <section><h4>رویدادهای ثبت‌شده</h4>{detail.data.timeline.map((event) => <article className="admin-mini-row" key={event.id}><strong>{event.action}</strong><small>{event.entityType} · {jalaliDate(event.occurredAt)}</small><small>شناسهٔ درخواست: <bdi dir="ltr">{event.requestId}</bdi></small></article>)}{!detail.data.timeline.length && <p className="admin-empty">رویدادی در منبع قابل‌ردیابی ثبت نشده است.</p>}</section>
      </div>
      {notice && <p className="notice notice-success">{notice}</p>}{error && <p className="notice notice-error" role="alert">{error}</p>}
      <Modal open={statusModal} onClose={() => { setStatusModal(false); setError(""); }} title={detail.data.isActive ? "تعلیق کسب‌وکار" : "فعال‌سازی کسب‌وکار"} description="دلیل در سابقهٔ تغییر وضعیت ثبت می‌شود."><form className="admin-modal-form" onSubmit={(event) => void changeStatus(event)}><label className="field"><span className="field-label">دلیل تغییر</span><textarea minLength={3} maxLength={500} rows={3} required value={reason} onChange={(event) => setReason(event.target.value)} /></label><label className="field"><span className="field-label">رمز فعلی برای تأیید دوباره</span><input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>{error && <p className="notice notice-error">{error}</p>}<button className="button button-primary full" disabled={busy}>{busy ? "در حال ثبت…" : "تأیید و ثبت تغییر"}</button></form></Modal>
    </>}
  </section></div>;
}

type StorefrontOrderRow = { id: string; publicCode: string; businessName: string; branchName: string; storefrontName: string; customerName: string; customerPhoneMasked: string; status: string; paymentStatus: string; paymentAttemptStatus: string | null; receiptUploadedAt: string | null; deliveryMethod: string; totalRial: string; createdAt: string };

function StorefrontOrdersAdminTab({ csrf, initialQ }: { csrf?: string; initialQ?: string }) {
  const [q, setQ] = useState(""); const [debounced, setDebounced] = useState(""); const [status, setStatus] = useState(""); const [paymentStatus, setPaymentStatus] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [minTotal, setMinTotal] = useState(""); const [maxTotal, setMaxTotal] = useState(""); const [sort, setSort] = useState("createdAt"); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState("25"); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { if (initialQ !== undefined) { setQ(initialQ); setPage(1); } }, [initialQ]);
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(q.trim()), 300); return () => window.clearTimeout(timer); }, [q]);
  useEffect(() => { setPage(1); }, [debounced, status, paymentStatus, from, to, minTotal, maxTotal, sort, pageSize]);
  const filters = { q: debounced, status: status || undefined, paymentStatus: paymentStatus || undefined, minTotal: minTotal || undefined, maxTotal: maxTotal || undefined, from: from ? tehranUtcBoundary(from, false) : undefined, to: to ? tehranUtcBoundary(to, true) : undefined, page: String(page), pageSize, sort, direction: sort === "createdAt" || sort === "publicCode" ? "desc" : "asc" };
  const rows = useQuery({ queryKey: ["system-admin", "storefront-orders", filters], queryFn: () => adminApi<AdminPage<StorefrontOrderRow>>("/system-admin/storefront-orders/query", { method: "POST", body: JSON.stringify(filters) }, csrf) });
  const exportRows = async () => { setBusy(true); setError(""); try { await downloadAdminCsv("storefront-orders", { ...filters, page: undefined, pageSize: undefined }, csrf); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  return <section className="admin-panel"><div className="admin-panel-heading"><div><h2>سفارش‌های فروشگاه عمومی</h2><p>نمایش فقط‌خواندنی برای پشتیبانی؛ تغییر وضعیت سفارش در workflow فروشنده انجام می‌شود.</p></div><button className="button button-secondary" type="button" disabled={busy} onClick={() => void exportRows()}><Download size={15} />خروجی CSV فیلترشده</button></div>
    <div className="admin-filter-row admin-filter-wrap"><label className="admin-search"><Search size={16} /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="کد سفارش، فروشگاه، کسب‌وکار یا تلفن مشتری" /></label><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="وضعیت سفارش">{["", "SUBMITTED", "ACCEPTED", "REJECTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED", "EXPIRED", "RETURNED"].map((item) => <option key={item} value={item}>{item ? orderStatus(item) : "همهٔ وضعیت سفارش"}</option>)}</select><select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)} aria-label="وضعیت پرداخت">{["", "NOT_DUE", "UNPAID", "RECEIPT_SUBMITTED", "UNDER_REVIEW", "PARTIALLY_VERIFIED", "OVERPAID_REVIEW", "VERIFIED", "REFUND_PENDING", "REFUNDED"].map((item) => <option key={item} value={item}>{item ? orderStatus(item) : "همهٔ وضعیت پرداخت"}</option>)}</select><label className="field admin-count-filter"><span className="field-label">حداقل مبلغ ریال</span><input type="number" min="0" inputMode="numeric" value={minTotal} onChange={(event) => setMinTotal(event.target.value)} /></label><label className="field admin-count-filter"><span className="field-label">حداکثر مبلغ ریال</span><input type="number" min="0" inputMode="numeric" value={maxTotal} onChange={(event) => setMaxTotal(event.target.value)} /></label><JalaliDatePicker value={from} onChange={setFrom} label="از تاریخ" clearable /><JalaliDatePicker value={to} onChange={setTo} label="تا تاریخ" clearable /><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="مرتب‌سازی سفارش"><option value="createdAt">تاریخ</option><option value="totalRial">مبلغ</option><option value="status">وضعیت</option><option value="publicCode">شناسه</option></select><select value={pageSize} onChange={(event) => setPageSize(event.target.value)} aria-label="اندازهٔ صفحه"><option value="25">۲۵ ردیف</option><option value="50">۵۰ ردیف</option><option value="100">۱۰۰ ردیف</option></select></div>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {rows.isError ? <InlineError error={rows.error} retry={() => void rows.refetch()} /> : rows.isPending ? <LoadingBlock /> : <><div className="admin-table-wrap"><table className="admin-data-table"><thead><tr><th>شناسه / مشتری</th><th>کسب‌وکار و فروشگاه</th><th>وضعیت سفارش</th><th>وضعیت پرداخت</th><th>مبلغ</th><th>تاریخ</th></tr></thead><tbody>{rows.data.items.map((row) => <tr key={row.id}><td><strong><bdi dir="ltr">{row.publicCode}</bdi></strong><small>{row.customerName} · <bdi dir="ltr">{row.customerPhoneMasked}</bdi></small></td><td><strong>{row.businessName} · {row.branchName}</strong><small>{row.storefrontName}</small></td><td><span className={`admin-status-tag ${row.status.toLowerCase()}`}>{orderStatus(row.status)}</span></td><td><span className={`admin-status-tag ${row.paymentStatus.toLowerCase()}`}>{orderStatus(row.paymentStatus)}</span>{row.receiptUploadedAt && <small>رسید: {jalaliDate(row.receiptUploadedAt)}</small>}</td><td>{money(row.totalRial, "IRT")}</td><td>{jalaliDate(row.createdAt)}</td></tr>)}</tbody></table></div>{!rows.data.items.length && <p className="admin-empty">سفارشی با این فیلتر پیدا نشد.</p>}<AdminPagination page={page} pageCount={rows.data.pageCount} total={rows.data.total} onPage={setPage} /></>}
  </section>;
}

type AuditRow = { id: string; action: string; summary: string; entityType: string; entityId: string | null; requestId: string; occurredAt: string; adminName: string };

function AdminAuditTab({ csrf }: { csrf?: string }) {
  const [q, setQ] = useState(""); const [debounced, setDebounced] = useState(""); const [action, setAction] = useState(""); const [entityType, setEntityType] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState("25"); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(q.trim()), 300); return () => window.clearTimeout(timer); }, [q]);
  useEffect(() => { setPage(1); }, [debounced, action, entityType, from, to, pageSize]);
  const filters = { q: debounced, action: action || undefined, entityType: entityType || undefined, from: from ? tehranUtcBoundary(from, false) : undefined, to: to ? tehranUtcBoundary(to, true) : undefined, page: String(page), pageSize };
  const rows = useQuery({ queryKey: ["system-admin", "audit-events", filters], queryFn: () => adminApi<AdminPage<AuditRow>>("/system-admin/audit/query", { method: "POST", body: JSON.stringify(filters) }, csrf) });
  const exportRows = async () => { setBusy(true); setError(""); try { await downloadAdminCsv("audit", { ...filters, page: undefined, pageSize: undefined }, csrf); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  return <section className="admin-panel"><div className="admin-panel-heading"><div><h2>رخدادهای مدیریتی</h2><p>گزارش سروری append-only؛ محتوای حساس و metadata خام نمایش داده نمی‌شود.</p></div><button className="button button-secondary" type="button" disabled={busy} onClick={() => void exportRows()}><Download size={15} />خروجی کنترل‌شده</button></div>
    <div className="admin-filter-row admin-filter-wrap"><label className="admin-search"><Search size={16} /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="نام رخداد یا نوع موجودیت" /></label><input value={action} onChange={(event) => setAction(event.target.value)} placeholder="فیلتر رخداد" /><input value={entityType} onChange={(event) => setEntityType(event.target.value)} placeholder="فیلتر موجودیت" /><JalaliDatePicker value={from} onChange={setFrom} label="از تاریخ" clearable /><JalaliDatePicker value={to} onChange={setTo} label="تا تاریخ" clearable /><select value={pageSize} onChange={(event) => setPageSize(event.target.value)} aria-label="اندازهٔ صفحه"><option value="25">۲۵ ردیف</option><option value="50">۵۰ ردیف</option><option value="100">۱۰۰ ردیف</option></select></div>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {rows.isError ? <InlineError error={rows.error} retry={() => void rows.refetch()} /> : rows.isPending ? <LoadingBlock /> : <><div className="admin-table-wrap"><table className="admin-data-table"><thead><tr><th>زمان</th><th>رخداد</th><th>خلاصهٔ امن</th><th>موجودیت</th><th>شناسه</th><th>مدیر</th><th>شناسهٔ درخواست</th></tr></thead><tbody>{rows.data.items.map((row) => <tr key={row.id}><td>{jalaliDate(row.occurredAt)}</td><td><strong>{row.action}</strong></td><td>{row.summary}</td><td>{row.entityType}</td><td><bdi dir="ltr">{row.entityId ?? "—"}</bdi></td><td>{row.adminName}</td><td><bdi dir="ltr">{row.requestId}</bdi></td></tr>)}</tbody></table></div>{!rows.data.items.length && <p className="admin-empty">رخدادی با این فیلتر پیدا نشد.</p>}<AdminPagination page={page} pageCount={rows.data.pageCount} total={rows.data.total} onPage={setPage} /></>}
  </section>;
}

type AdminSessionRow = { id: string; createdAt: string; lastSeenAt: string; expiresAt: string; absoluteExpiresAt: string; userAgent: string | null; current: boolean };

function AdminSecurityTab({ active, csrf, onSignedOut }: { active: boolean; csrf?: string; onSignedOut: () => void }) {
  const client = useQueryClient(); const sessions = useQuery({ queryKey: ["system-admin", "active-sessions"], queryFn: () => get<AdminSessionRow[]>("/system-admin/auth/sessions") });
  const [currentPassword, setCurrentPassword] = useState(""); const [newPassword, setNewPassword] = useState(""); const [confirmPassword, setConfirmPassword] = useState("");
  const [revokePassword, setRevokePassword] = useState(""); const [confirmRevoke, setConfirmRevoke] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  useEffect(() => { if (!active) { setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setRevokePassword(""); setConfirmRevoke(false); setError(""); } }, [active]);
  const changePassword = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { await adminApi("/system-admin/auth/change-password", { method: "PATCH", body: JSON.stringify({ currentPassword, newPassword, confirmPassword }) }, csrf); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setNotice("رمز تغییر کرد؛ نشست‌های قبلی باطل شدند."); await Promise.all([client.invalidateQueries({ queryKey: ["system-admin-session"] }), client.invalidateQueries({ queryKey: ["system-admin", "active-sessions"] })]); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const revokeAll = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await adminApi("/system-admin/auth/revoke-sessions", { method: "POST", body: JSON.stringify({ currentPassword: revokePassword }) }, csrf); setRevokePassword(""); setConfirmRevoke(false); onSignedOut(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  return <section className="admin-panel"><div className="admin-panel-heading"><div><h2>امنیت حساب مالک</h2><p>نشست‌ها روی سرور نگهداری می‌شوند؛ عمر پیش‌فرض ۳۰ دقیقه بی‌فعالیتی و ۱۲ ساعت حداکثر است.</p></div></div>
    {notice && <p className="notice notice-success">{notice}</p>}{error && <p className="notice notice-error" role="alert">{error}</p>}
    <div className="admin-security-grid"><form className="admin-security-card" onSubmit={(event) => void changePassword(event)}><h3>تغییر رمز عبور</h3><label className="field"><span className="field-label">رمز فعلی</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label className="field"><span className="field-label">رمز جدید (حداقل ۱۲ نویسه)</span><input type="password" autoComplete="new-password" minLength={12} maxLength={256} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><label className="field"><span className="field-label">تکرار رمز جدید</span><input type="password" autoComplete="new-password" minLength={12} maxLength={256} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label><button className="button button-primary" disabled={busy}>تغییر رمز و چرخش نشست</button></form>
      <section className="admin-security-card"><div className="admin-panel-heading"><div><h3>نشست‌های فعال</h3><p>زمان فعالیت و مرورگر ثبت شده؛ token نمایش داده نمی‌شود.</p></div><button className="button button-secondary" type="button" onClick={() => void sessions.refetch()}>تازه‌سازی</button></div>{sessions.isError ? <InlineError error={sessions.error} retry={() => void sessions.refetch()} /> : sessions.isPending ? <LoadingBlock /> : <div className="admin-session-list">{sessions.data.map((row) => <article className="admin-mini-row" key={row.id}><strong>{row.current ? "این نشست" : "نشست دیگر"}</strong><span>آخرین فعالیت: {jalaliDate(row.lastSeenAt)}</span><small>ساخته‌شده: {jalaliDate(row.createdAt)} · پایان حداکثری: {jalaliDate(row.absoluteExpiresAt)}</small><small>{row.userAgent || "مرورگر ثبت نشده"}</small><bdi dir="ltr">{row.id}</bdi></article>)}{!sessions.data.length && <p className="admin-empty">نشست فعالی وجود ندارد.</p>}</div>}<button className="button button-danger" type="button" disabled={busy || sessions.data?.length === 0} onClick={() => { setRevokePassword(""); setConfirmRevoke(true); }}>خروج از همهٔ نشست‌ها</button></section></div>
    <Modal open={confirmRevoke} onClose={() => { setConfirmRevoke(false); setError(""); }} title="خروج از همهٔ نشست‌ها" description="همهٔ نشست‌ها، از جمله نشست فعلی، باطل می‌شوند."><form className="admin-modal-form" onSubmit={(event) => void revokeAll(event)}><label className="field"><span className="field-label">برای تأیید رمز فعلی را وارد کنید</span><input type="password" autoComplete="current-password" value={revokePassword} onChange={(event) => setRevokePassword(event.target.value)} required /></label>{error && <p className="notice notice-error">{error}</p>}<button className="button button-danger full" disabled={busy}>{busy ? "در حال خروج…" : "تأیید و خروج"}</button></form></Modal>
  </section>;
}

function AdminPagination({ page, pageCount, total, onPage }: { page: number; pageCount: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, pageCount);
  return <div className="admin-pagination"><span>{faNumber(total)} نتیجه · صفحهٔ {faNumber(Math.min(page, pages))} از {faNumber(pages)}</span><div><button className="button button-secondary" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>قبلی</button><button className="button button-secondary" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>بعدی</button></div></div>;
}

async function downloadAdminCsv(dataset: string, filters: Record<string, unknown>, csrf?: string) {
  const response = await fetch(`/api/v1/system-admin/exports/${encodeURIComponent(dataset)}`, {
    method: "POST", credentials: "include", cache: "no-store",
    headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
    body: JSON.stringify(filters),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new ApiError(response.status, body?.message ?? "ساخت فایل خروجی انجام نشد.");
  }
  const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = `shopro-${dataset}-${todayISO()}.csv`; link.click(); URL.revokeObjectURL(url);
}

function formatMetric(metric: AdminMetric) {
  if (metric.value === null) return "داده در دسترس نیست";
  if (metric.unit === "ریال") return money(String(metric.value), "IRT");
  return `${faNumber(Number(metric.value))} ${metric.unit}`;
}

function formatMetricChange(metric: AdminMetric) {
  if (metric.change === null || metric.change === undefined) return "—";
  if (metric.unit === "ریال") return money(String(metric.change), "IRT");
  return `${Number(metric.change) > 0 ? "+" : ""}${faNumber(Number(metric.change))} ${metric.unit}`;
}

function trendHeight(value: string, rows: Array<{ amountRial: string }>) {
  const max = Math.max(1, ...rows.map((item) => Math.abs(Number(item.amountRial))));
  return Math.max(3, Math.round(Math.abs(Number(value)) / max * 100));
}

function tehranUtcBoundary(date: string, endOfDay: boolean) {
  if (!date) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return new Date(date).toISOString();
  const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  let guess = new Date(desired);
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let index = 0; index < 3; index++) {
    const parts = Object.fromEntries(formatter.formatToParts(guess).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    guess = new Date(guess.getTime() + desired - represented);
  }
  return guess.toISOString();
}

function BranchesAdminTab({ active, csrf, initialQ }: { active: boolean; csrf?: string; initialQ?: string }) {
  const client = useQueryClient();
  const [q, setQ] = useState(""); const [status, setStatus] = useState(""); const [action, setAction] = useState<{ branch: BranchRow; kind: BranchActionKind } | null>(null);
  const [reason, setReason] = useState(""); const [duration, setDuration] = useState("1"); const [currentPassword, setCurrentPassword] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { if (!active) { setAction(null); setCurrentPassword(""); setReason(""); setError(""); } }, [active]);
  useEffect(() => { if (initialQ !== undefined) setQ(initialQ); }, [initialQ]);
  const rows = useQuery({ queryKey: ["system-admin", "subscription-branches", q, status], queryFn: () => get<CursorPage<BranchRow>>(`/system-admin/subscriptions/branches?limit=50&q=${encodeURIComponent(q)}${status ? `&status=${status}` : ""}`) });
  const preview = useQuery({
    queryKey: ["system-admin", "subscription-action-preview", action?.branch.id, action?.kind, duration],
    queryFn: () => adminApi<BranchActionPreview>(`/system-admin/subscriptions/branches/${action!.branch.id}/preview`, { method: "POST", body: JSON.stringify({ kind: action!.kind, ...((action!.kind === "grant" || action!.kind === "extend") ? { durationMonths: Number(duration) } : {}) }) }, csrf),
    enabled: Boolean(action), retry: false,
  });
  const startAction = (branch: BranchRow, kind: BranchActionKind) => { setReason(""); setCurrentPassword(""); setError(""); setAction({ branch, kind }); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!action || !preview.data) return; setBusy(true); setError("");
    const body = action.kind === "grant" || action.kind === "extend" ? { durationMonths: Number(duration), reason, currentPassword } : { reason, currentPassword };
    try { await mutate(`/system-admin/subscriptions/branches/${action.branch.id}/${action.kind}`, "POST", body, csrf); setAction(null); setReason(""); setCurrentPassword(""); await client.invalidateQueries({ queryKey: ["system-admin", "subscription-branches"] }); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  return <section className="admin-panel"><div className="admin-panel-heading"><div><h2>اشتراک شعبه‌ها</h2><p>جست‌وجو و مدیریت دسترسی هر شعبه</p></div></div><div className="admin-filter-row"><label className="admin-search"><Search size={16} /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="کسب‌وکار، شعبه یا کد" /></label><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="فیلتر وضعیت"><option value="">همهٔ وضعیت‌ها</option><option value="ACTIVE">فعال</option><option value="EXPIRED">پایان‌یافته</option><option value="REQUIRED">بدون اشتراک</option><option value="SUSPENDED">متوقف</option></select></div>
    {rows.isError ? <InlineError error={rows.error} retry={() => void rows.refetch()} /> : rows.isPending ? <LoadingBlock /> : <div className="admin-branch-list">{rows.data.items.map((row) => <article className="admin-branch-row" key={row.id}><div className="admin-branch-main"><span className={`admin-state-dot ${row.status.toLowerCase()}`} /><div><strong>{row.branchName}</strong><span>{row.businessName} · <bdi dir="ltr">{row.branchCode}</bdi></span><small>{row.currentPeriod ? `${row.currentPeriod.planNameFa ?? "اشتراک"} · تا ${jalaliDate(row.currentPeriod.endsAt)} · ${faNumber(row.currentPeriod.remainingDays)} روز` : row.status === "SUSPENDED" ? row.suspensionReason : "دورهٔ اشتراک ثبت نشده"}</small></div></div><span className={`admin-status-tag ${row.status.toLowerCase()}`}>{branchStatus(row.status)}</span><div className="admin-row-actions">{row.status === "SUSPENDED" ? <button className="button button-secondary" type="button" onClick={() => startAction(row, "unsuspend")}>رفع توقف</button> : <><button className="button button-secondary" type="button" onClick={() => startAction(row, row.currentPeriod ? "extend" : "grant")}>{row.currentPeriod ? "تمدید" : "اعطای اشتراک"}</button><button className="button button-text" type="button" onClick={() => startAction(row, "suspend")}>توقف</button>{row.currentPeriod && <button className="button button-text danger-text" type="button" onClick={() => startAction(row, "revoke")}>لغو دوره</button>}</>}</div></article>)}{!rows.data.items.length && <p className="admin-empty">شعبه‌ای با این فیلتر پیدا نشد.</p>}</div>}
    <Modal open={Boolean(action)} onClose={() => { setAction(null); setCurrentPassword(""); setError(""); }} title={action ? actionTitle(action.kind) : "مدیریت اشتراک"} description={action ? `${action.branch.businessName} · ${action.branch.branchName}` : undefined}><form className="admin-modal-form" onSubmit={(event) => void submit(event)}>{(action?.kind === "grant" || action?.kind === "extend") && <label className="field"><span className="field-label">مدت</span><select value={duration} onChange={(event) => setDuration(event.target.value)}><option value="1">یک ماه</option><option value="3">سه ماه</option><option value="6">شش ماه</option><option value="12">دوازده ماه</option></select></label>}
      {preview.isError ? <InlineError error={preview.error} retry={() => void preview.refetch()} /> : preview.isPending ? <LoadingBlock /> : preview.data && <div className="notice notice-info"><strong>پیش‌نمایش اثر</strong><p>وضعیت فعلی: {preview.data.current.suspended ? "متوقف" : "فعال"}؛ {faNumber(preview.data.current.activePeriodCount)} دورهٔ فعال</p>{preview.data.effect.startsAt && preview.data.effect.endsAt && <><p>شروع دوره: {jalaliDate(preview.data.effect.startsAt)}</p><p>پایان دوره: {jalaliDate(preview.data.effect.endsAt)}</p></>}{preview.data.effect.appendsAfterExistingEnd && <p>این دوره پس از پایان دورهٔ زمان‌بندی‌شده افزوده می‌شود.</p>}{preview.data.effect.suspended !== undefined && <p>پس از تأیید، دسترسی {preview.data.effect.suspended ? "متوقف" : "فعال"} می‌شود.</p>}{preview.data.effect.affectedPeriodCount !== undefined && <p>{faNumber(preview.data.effect.affectedPeriodCount)} دورهٔ جاری یا زمان‌بندی‌شده لغو می‌شوند.</p>}<small>این پیش‌نمایش در {jalaliDate(preview.data.observedAt)} محاسبه شده است.</small></div>}
      <label className="field"><span className="field-label">دلیل ثبت</span><textarea minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} required rows={3} /></label><label className="field"><span className="field-label">رمز فعلی برای تأیید دوباره</span><input type="password" autoComplete="current-password" maxLength={1024} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>{error && <p className="notice notice-error">{error}</p>}<button className="button button-primary full" disabled={busy || preview.isPending || !preview.data}>{busy ? "در حال ثبت…" : "تأیید پیش‌نمایش و ثبت تغییر"}</button></form></Modal>
  </section>;
}

function OrdersAdminTab({ csrf, initialQ }: { csrf?: string; initialQ?: string }) {
  const client = useQueryClient(); const [q, setQ] = useState(""); const [status, setStatus] = useState(""); const [refund, setRefund] = useState<AdminOrder | null>(null); const [reason, setReason] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { if (initialQ !== undefined) setQ(initialQ); }, [initialQ]);
  const rows = useQuery({ queryKey: ["system-admin", "subscription-orders", q, status], queryFn: () => get<CursorPage<AdminOrder>>(`/system-admin/subscriptions/orders?limit=50&q=${encodeURIComponent(q)}${status ? `&status=${status}` : ""}`) });
  const refundOrder = async (event: FormEvent) => { event.preventDefault(); if (!refund) return; setBusy(true); setError(""); try { await mutate(`/system-admin/subscriptions/orders/${refund.id}/refund`, "POST", { reason }, csrf); setRefund(null); await client.invalidateQueries({ queryKey: ["system-admin", "subscription-orders"] }); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  return <section className="admin-panel"><div className="admin-panel-heading"><div><h2>سفارش‌ها و تلاش‌های پرداخت</h2><p>رسیدها، وضعیت‌ها و خطاهای امن درگاه</p></div></div><div className="admin-filter-row"><label className="admin-search"><Search size={16} /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="کسب‌وکار، شعبه، رسید" /></label><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="فیلتر سفارش"><option value="">همهٔ وضعیت‌ها</option>{["PENDING", "PAID", "FAILED", "CANCELLED", "REFUNDED"].map((value) => <option key={value} value={value}>{orderStatus(value)}</option>)}</select></div>{rows.isError ? <InlineError error={rows.error} retry={() => void rows.refetch()} /> : rows.isPending ? <LoadingBlock /> : <div className="admin-order-list">{rows.data.items.map((row) => <article className="admin-order-row" key={row.id}><div className="admin-order-heading"><div><strong>{row.planNameFa} · {durationLabel(row.durationMonths)}</strong><span>{row.businessName} · {row.branchName}</span></div><b>{money(row.amountRial, "IRT")}</b></div><div className="admin-order-meta"><span>{orderStatus(row.status)}</span><span>{jalaliDate(row.createdAt)}</span>{row.providerReference && <bdi dir="ltr">{row.providerReference}</bdi>}</div>{row.attempts.map((attempt, index) => <small key={`${attempt.provider}-${index}`}>درگاه {attempt.provider} · {attempt.status}{attempt.safeErrorCode ? ` · ${attempt.safeErrorCode}` : ""}</small>)}{row.status === "PAID" && <button className="button button-text" type="button" onClick={() => { setRefund(row); setReason(""); setError(""); }}>درخواست بازپرداخت</button>}</article>)}{!rows.data.items.length && <p className="admin-empty">سفارشی با این فیلتر پیدا نشد.</p>}</div>}
    <Modal open={Boolean(refund)} onClose={() => setRefund(null)} title="بازپرداخت سفارش" description="تا اتصال درگاه واقعی، درخواست ثبت نمی‌شود."><form className="admin-modal-form" onSubmit={(event) => void refundOrder(event)}><p>مبلغ سفارش: <strong>{refund ? money(refund.amountRial, "IRT") : "—"}</strong></p><label className="field"><span className="field-label">دلیل درخواست</span><textarea minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} required rows={3} /></label>{error && <p className="notice notice-error">{error}</p>}<button className="button button-primary full" disabled={busy}>{busy ? "در حال بررسی…" : "بررسی امکان بازپرداخت"}</button></form></Modal>
  </section>;
}

function PlansAdminTab({ csrf }: { csrf?: string }) {
  const client = useQueryClient(); const [createOpen, setCreateOpen] = useState(false); const [pricePlan, setPricePlan] = useState<PlanRow | null>(null); const [editingPlan, setEditingPlan] = useState<PlanRow | null>(null); const [editName, setEditName] = useState(""); const [editOrder, setEditOrder] = useState(""); const [editBadge, setEditBadge] = useState(""); const [editFeatures, setEditFeatures] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [code, setCode] = useState(""); const [nameFa, setNameFa] = useState(""); const [displayOrder, setDisplayOrder] = useState("20"); const [badge, setBadge] = useState("");
  const [duration, setDuration] = useState("1"); const [priceRial, setPriceRial] = useState(""); const [effectiveDate, setEffectiveDate] = useState(() => todayISO()); const [priceWarning, setPriceWarning] = useState("");
  const rows = useQuery({ queryKey: ["system-admin", "subscription-plans"], queryFn: () => get<PlanRow[]>("/system-admin/subscriptions/plans") });
  const create = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { await mutate("/system-admin/subscriptions/plans", "POST", { code, nameFa, displayOrder: Number(displayOrder), badge: badge || undefined, features: [] }, csrf); setCreateOpen(false); setCode(""); setNameFa(""); await client.invalidateQueries({ queryKey: ["system-admin", "subscription-plans"] }); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  const update = async (event: FormEvent) => { event.preventDefault(); if (!editingPlan) return; setBusy(true); setError(""); try { await mutate(`/system-admin/subscriptions/plans/${editingPlan.id}`, "PATCH", { nameFa: editName.trim(), displayOrder: Number(editOrder), badge: editBadge || null, features: editFeatures.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) }, csrf); setEditingPlan(null); await client.invalidateQueries({ queryKey: ["system-admin", "subscription-plans"] }); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  const addPrice = async (event: FormEvent) => { event.preventDefault(); if (!pricePlan) return; setBusy(true); setError(""); try { const effectiveFrom = new Date(`${effectiveDate}T00:00:00+03:30`).toISOString(); const result = await mutate<{ warning: string | null }>(`/system-admin/subscriptions/plans/${pricePlan.id}/prices`, "POST", { durationMonths: Number(duration), priceRial, effectiveFrom }, csrf); setPricePlan(null); setPriceRial(""); setPriceWarning(result.warning ?? "نسخهٔ قیمت در تاریخ مؤثر ثبت شد."); await client.invalidateQueries({ queryKey: ["system-admin", "subscription-plans"] }); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  const toggle = async (plan: PlanRow) => { setBusy(true); setError(""); try { await mutate(`/system-admin/subscriptions/plans/${plan.id}`, "PATCH", { isActive: !plan.isActive }, csrf); await client.invalidateQueries({ queryKey: ["system-admin", "subscription-plans"] }); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  return <section className="admin-panel"><div className="admin-panel-heading"><div><h2>پلن‌ها و نسخه‌های قیمت</h2><p>قیمت‌های مصرف‌شده و سفارش‌ها ویرایش نمی‌شوند؛ تغییرات به نسخهٔ تازه می‌روند.</p></div><button className="button button-primary" type="button" onClick={() => { setCreateOpen(true); setError(""); }}>پلن تازه</button></div>{priceWarning && <p className="notice notice-warning">{priceWarning}</p>}{rows.isError ? <InlineError error={rows.error} retry={() => void rows.refetch()} /> : rows.isPending ? <LoadingBlock /> : <div className="admin-plan-list">{rows.data.map((plan) => <article className="admin-plan-row" key={plan.id}><div className="admin-plan-heading"><div><strong>{plan.nameFa}</strong><span><bdi dir="ltr">{plan.code}</bdi> · ترتیب {faNumber(plan.displayOrder)}</span></div><span className={`admin-status-tag ${plan.isActive ? "active" : "inactive"}`}>{plan.isActive ? "فعال" : "غیرفعال"}</span></div><div className="admin-plan-prices">{plan.prices.map((price) => <div key={price.id}><span>{durationLabel(price.durationMonths)}</span><strong>{money(price.priceRial, "IRT")}</strong><small>{jalaliDate(price.effectiveFrom)}{price.effectiveTo ? ` تا ${jalaliDate(price.effectiveTo)}` : ""} · {price.consumedOrderCount ? `${faNumber(price.consumedOrderCount)} سفارش` : "بدون سفارش"}</small>{new Date(price.effectiveFrom).getTime() > Date.now() && <button className="button button-text" type="button" onClick={() => { setPricePlan(plan); setDuration(String(price.durationMonths)); setPriceRial(price.priceRial); setEffectiveDate(todayISO()); setError(""); setPriceWarning(""); }}>ثبت همین مبلغ از امروز</button>}</div>)}</div><div className="admin-row-actions"><button className="button button-secondary" type="button" onClick={() => { setEditingPlan(plan); setEditName(plan.nameFa); setEditOrder(String(plan.displayOrder)); setEditBadge(plan.badge ?? ""); setEditFeatures(plan.features.join("\n")); setError(""); }}>ویرایش پلن</button><button className="button button-secondary" type="button" onClick={() => { setPricePlan(plan); setError(""); setPriceWarning(""); }}>نسخهٔ قیمت تازه</button><button className="button button-text" disabled={busy} type="button" onClick={() => void toggle(plan)}>{plan.isActive ? "غیرفعال‌کردن" : "فعال‌کردن"}</button></div></article>)}</div>}{error && <p className="notice notice-error">{error}</p>}
    <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="ساخت پلن" description="ساخت پلن ویژگی‌ها و تاریخچهٔ قیمت قبلی را تغییر نمی‌دهد."><form className="admin-modal-form" onSubmit={(event) => void create(event)}><label className="field"><span className="field-label">کد لاتین</span><input dir="ltr" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} required pattern="[A-Z][A-Z0-9_]{2,23}" /></label><label className="field"><span className="field-label">نام فارسی</span><input value={nameFa} onChange={(event) => setNameFa(event.target.value)} required maxLength={80} /></label><label className="field"><span className="field-label">ترتیب نمایش</span><input type="number" min="0" value={displayOrder} onChange={(event) => setDisplayOrder(event.target.value)} required /></label><label className="field"><span className="field-label">برچسب (اختیاری)</span><input value={badge} onChange={(event) => setBadge(event.target.value)} maxLength={80} /></label>{error && <p className="notice notice-error">{error}</p>}<button className="button button-primary full" disabled={busy}>{busy ? "در حال ثبت…" : "ساخت پلن"}</button></form></Modal>
    <Modal open={Boolean(editingPlan)} onClose={() => setEditingPlan(null)} title="ویرایش پلن" description={editingPlan?.code}><form className="admin-modal-form" onSubmit={(event) => void update(event)}><label className="field"><span className="field-label">نام فارسی</span><input value={editName} onChange={(event) => setEditName(event.target.value)} required maxLength={80} /></label><label className="field"><span className="field-label">ترتیب نمایش</span><input type="number" min="0" value={editOrder} onChange={(event) => setEditOrder(event.target.value)} required /></label><label className="field"><span className="field-label">برچسب</span><input value={editBadge} onChange={(event) => setEditBadge(event.target.value)} maxLength={80} /></label><label className="field"><span className="field-label">امکانات (هر مورد در یک خط)</span><textarea rows={4} maxLength={2500} value={editFeatures} onChange={(event) => setEditFeatures(event.target.value)} /></label>{error && <p className="notice notice-error">{error}</p>}<button className="button button-primary full" disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیرهٔ تغییرات"}</button></form></Modal>
    <Modal open={Boolean(pricePlan)} onClose={() => setPricePlan(null)} title="افزودن نسخهٔ قیمت" description={pricePlan ? `${pricePlan.nameFa} · قیمت‌های پیشین حفظ می‌شوند. انتخاب امروز قیمت را فوراً فعال می‌کند؛ تاریخ آینده از ابتدای روز تهران شروع می‌شود.` : undefined}><form className="admin-modal-form" onSubmit={(event) => void addPrice(event)}><label className="field"><span className="field-label">مدت اشتراک</span><select value={duration} onChange={(event) => setDuration(event.target.value)}><option value="1">یک ماه</option><option value="3">سه ماه</option><option value="6">شش ماه</option><option value="12">دوازده ماه</option></select></label><label className="field"><span className="field-label">مبلغ کل به ریال</span><input value={priceRial} onChange={(event) => setPriceRial(event.target.value)} inputMode="numeric" pattern="[0-9]+" required /></label><JalaliDatePicker value={effectiveDate} onChange={setEffectiveDate} label="تاریخ شروع قیمت" />{error && <p className="notice notice-error">{error}</p>}<button className="button button-primary full" disabled={busy}>{busy ? "در حال ثبت…" : "ثبت نسخهٔ قیمت"}</button></form></Modal>
  </section>;
}

function RolloutAdminTab({ csrf }: { csrf?: string }) {
  const client = useQueryClient(); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const query = useQuery({ queryKey: ["system-admin", "subscription-rollout"], queryFn: () => get<Rollout>("/system-admin/subscriptions/rollout") });
  const [mode, setMode] = useState<"OBSERVE" | "ENFORCE">("OBSERVE"); const [grace, setGrace] = useState(""); const [fee, setFee] = useState(""); const [tax, setTax] = useState(""); const [cost, setCost] = useState(""); const [floor, setFloor] = useState("");
  useEffect(() => { if (!query.data) return; setMode(query.data.mode); setGrace(query.data.legacyGraceEndsAt?.slice(0, 10) ?? ""); setFee(query.data.providerFeeBasisPoints?.toString() ?? ""); setTax(query.data.taxRateBasisPoints?.toString() ?? ""); setCost(query.data.variableCostRial ?? ""); setFloor(query.data.minimumContributionRial ?? ""); }, [query.data]);
  const save = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); setNotice(""); if (mode === "ENFORCE" && !grace && query.data?.report.branchesWithoutActiveSubscription) { setError("برای enforce، تاریخ پایان grace را تعیین کنید."); setBusy(false); return; } try { const legacyGraceEndsAt = grace ? new Date(`${grace}T23:59:59+03:30`).toISOString() : null; await mutate("/system-admin/subscriptions/rollout", "PATCH", { mode, legacyGraceEndsAt, providerFeeBasisPoints: fee ? Number(fee) : null, taxRateBasisPoints: tax ? Number(tax) : null, variableCostRial: cost || null, minimumContributionRial: floor || null }, csrf); setNotice("تنظیم rollout و مفروضات اقتصادی ثبت شد."); await client.invalidateQueries({ queryKey: ["system-admin", "subscription-rollout"] }); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  if (query.isError) return <section className="admin-panel"><InlineError error={query.error} retry={() => void query.refetch()} /></section>;
  if (query.isPending) return <section className="admin-panel"><LoadingBlock /></section>;
  const report = query.data.report;
  return <section className="admin-panel"><div className="admin-panel-heading"><div><h2>Rollout و grace</h2><p>پیش از enforce، شعبه‌های بدون اشتراک را ببینید و تاریخ مهلت را مشخص کنید.</p></div></div><div className="admin-metric-grid">{[["شعبه‌های فعال", report.totalActiveBranches], ["اشتراک‌های فعال", report.activeSubscriptions], ["بدون اشتراک فعال", report.branchesWithoutActiveSubscription], ["متوقف", report.suspendedBranches]].map(([label, value]) => <div key={label as string}><span>{label as string}</span><strong>{faNumber(value as number)}</strong></div>)}</div><div className="notice notice-warning admin-rollout-warning">{query.data.note} نرخ مالیات، کارمزد درگاه و هزینهٔ متغیر تا زمانی که منبع تأییدشده وارد نشود «نامشخص» است؛ مقدار حدسی ثبت نکنید.</div><form className="admin-rollout-form" onSubmit={(event) => void save(event)}><label className="field"><span className="field-label">حالت rollout</span><select value={mode} onChange={(event) => setMode(event.target.value as "OBSERVE" | "ENFORCE")}><option value="OBSERVE">پایش؛ بدون مسدودسازی</option><option value="ENFORCE">اجباری؛ اعمال دسترسی شعبه</option></select></label><JalaliDatePicker value={grace} onChange={setGrace} label="پایان مهلت شعبه‌های فعلی" clearable /><label className="field"><span className="field-label">کارمزد درگاه (basis points)</span><input type="number" min="0" max="10000" value={fee} onChange={(event) => setFee(event.target.value)} placeholder="نامشخص" /></label><label className="field"><span className="field-label">نرخ مالیات مصوب (basis points)</span><input type="number" min="0" max="10000" value={tax} onChange={(event) => setTax(event.target.value)} placeholder="نامشخص" /></label><label className="field"><span className="field-label">هزینهٔ متغیر هر سفارش (ریال)</span><input inputMode="numeric" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="نامشخص" /></label><label className="field"><span className="field-label">حداقل سهم خالص (ریال)</span><input inputMode="numeric" value={floor} onChange={(event) => setFloor(event.target.value)} placeholder="نامشخص" /></label>{error && <p className="notice notice-error">{error}</p>}{notice && <p className="notice notice-success">{notice}</p>}<button className="button button-primary" disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیرهٔ تنظیمات"}</button></form></section>;
}

function EconomicsAdminTab() {
  const query = useQuery({ queryKey: ["system-admin", "subscription-economics"], queryFn: () => get<{ grossPriceRial: string; refundsRial: string; providerFeeRial: string | null; taxObligationRial: string | null; variableCostsRial: string | null; netContributionRial: string | null; minimumContributionRial: string | null; orderCount: number; unknown: string[]; warning: string }>("/system-admin/subscriptions/economics") });
  if (query.isError) return <section className="admin-panel"><InlineError error={query.error} retry={() => void query.refetch()} /></section>;
  if (query.isPending) return <section className="admin-panel"><LoadingBlock /></section>;
  const data = query.data; const rows = [["دریافتی ناخالص", data.grossPriceRial], ["بازپرداخت‌ها", data.refundsRial], ["کارمزد درگاه", data.providerFeeRial], ["تعهد مالیاتی", data.taxObligationRial], ["هزینهٔ متغیر", data.variableCostsRial], ["سهم خالص تخمینی", data.netContributionRial]] as const;
  return <section className="admin-panel"><div className="admin-panel-heading"><div><h2>اقتصاد اشتراک</h2><p>{faNumber(data.orderCount)} سفارش پرداخت‌شده یا مستردشده</p></div></div><div className="admin-economics-list">{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value === null ? "نامشخص" : money(value, "IRT")}</strong></div>)}</div>{data.minimumContributionRial && <p>حداقل سهم خالص تنظیم‌شده: {money(data.minimumContributionRial, "IRT")}</p>}<div className="notice notice-warning">{data.warning}{data.unknown.length ? ` موارد نامشخص: ${data.unknown.join("، ")}.` : ""}</div></section>;
}

function AdminState({ children }: { children: React.ReactNode }) { return <main className="admin-login-page" dir="rtl"><section className="admin-login-card"><BrandLogo className="admin-login-logo" alt="لوگوی شاپرو" />{children}</section></main>; }
function actionTitle(kind: string) { return ({ grant: "اعطای اشتراک", extend: "تمدید اشتراک", suspend: "توقف دسترسی", unsuspend: "رفع توقف دسترسی", revoke: "لغو دورهٔ فعال" } as Record<string, string>)[kind] ?? "مدیریت اشتراک"; }
function branchStatus(status: string) { return ({ ACTIVE: "فعال", EXPIRED: "پایان‌یافته", REQUIRED: "بدون اشتراک", SUSPENDED: "متوقف", GRACE: "مهلت فعال", OBSERVE: "پایش" } as Record<string, string>)[status] ?? status; }
function orderStatus(status: string) { return ({ PENDING: "در انتظار", PAID: "پرداخت‌شده", FAILED: "ناموفق", CANCELLED: "لغوشده", REFUNDED: "مستردشده" } as Record<string, string>)[status] ?? status; }
function durationLabel(months: number) { return ({ 1: "یک‌ماهه", 3: "سه‌ماهه", 6: "شش‌ماهه", 12: "یک‌ساله" } as Record<number, string>)[months] ?? `${faNumber(months)} ماه`; }
function errorText(error: unknown) { return error instanceof Error ? error.message : "درخواست انجام نشد؛ دوباره تلاش کنید."; }
async function mutate<T = unknown>(path: string, method: "POST" | "PATCH" | "DELETE", body: unknown, csrf?: string): Promise<T> { return adminApi<T>(path, { method, body: method === "DELETE" ? undefined : JSON.stringify(body) }, csrf); }
