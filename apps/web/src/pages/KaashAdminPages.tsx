import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Copy, Lightbulb, Printer, Search, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { AdminPagination } from "../components/AdminPagination.js";
import { BrandLogo } from "../components/BrandLogo.js";
import { JalaliDatePicker } from "../components/JalaliDatePicker.js";
import { KaashLogo } from "../components/KaashLogo.js";
import { adminApi, ApiError } from "../lib/api.js";
import { faNumber, jalaliDate } from "../lib/format.js";
import { paginateKaashStory } from "../lib/kaash.js";

type KaashStatus = "NEW" | "REVIEWING" | "PLANNED" | "IN_PROGRESS" | "RELEASED" | "ARCHIVED";
type KaashModule = "DASHBOARD" | "ONBOARDING" | "SUBSCRIPTIONS" | "STOREFRONT" | "SALES" | "INVOICES" | "CUSTOMERS" | "SUPPLIERS" | "PRODUCTS" | "SERVICES" | "INVENTORY" | "PURCHASES" | "EXPENSES" | "FINANCE" | "LEDGER" | "REPORTS" | "SETTINGS" | "OTHER";
type KaashListItem = { id: string; textPreview: string; truncated: boolean; status: KaashStatus; module: KaashModule; screenKey: string; createdAt: string; user: { displayName: string | null; phoneMasked: string }; businessName: string | null; branchName: string | null };
type KaashList = { items: KaashListItem[]; page: number; pageSize: number; total: number; pages: number };
type KaashDetail = { id: string; content: string; status: KaashStatus; module: KaashModule; screenKey: string; createdAt: string; updatedAt: string; internalNote: string | null; lastUpdatedByAdminName: string | null; user: { displayName: string | null; phoneMasked: string }; businessName: string | null; branchName: string | null; events: Array<{ id: string; kind: "SUBMITTED" | "STATUS_CHANGED" | "NOTE_CHANGED" | "ADMIN_UPDATED"; previousStatus: KaashStatus | null; newStatus: KaashStatus | null; previousNote: string | null; newNote: string | null; createdAt: string; adminName: string | null }> };
type Story = { content: string; createdAt: string };

const STATUS_LABEL: Record<KaashStatus, string> = { NEW: "جدید", REVIEWING: "در حال بررسی", PLANNED: "در صف توسعه", IN_PROGRESS: "در حال پیاده‌سازی", RELEASED: "منتشرشده", ARCHIVED: "بایگانی‌شده" };
const MODULE_LABEL: Record<KaashModule, string> = { DASHBOARD: "داشبورد", ONBOARDING: "راه‌اندازی", SUBSCRIPTIONS: "اشتراک", STOREFRONT: "ویترین", SALES: "فروش", INVOICES: "فاکتورها", CUSTOMERS: "مشتریان", SUPPLIERS: "تأمین‌کنندگان", PRODUCTS: "کالاها", SERVICES: "خدمات", INVENTORY: "موجودی", PURCHASES: "خرید", EXPENSES: "هزینه‌ها", FINANCE: "امور مالی", LEDGER: "دفتر مالی", REPORTS: "گزارش‌ها", SETTINGS: "تنظیمات", OTHER: "سایر بخش‌ها" };
const SCREEN_LABEL: Record<string, string> = { "dashboard.home": "نمای اصلی", "onboarding.workspace": "راه‌اندازی فضای کار", "subscriptions.management": "مدیریت اشتراک", "storefront.management": "مدیریت ویترین", "sales.register": "ثبت فروش", "invoices.list": "فهرست فاکتورها", "invoices.detail": "جزئیات فاکتور", "customers.list": "فهرست مشتریان", "customers.detail": "جزئیات مشتری", "suppliers.list": "فهرست تأمین‌کنندگان", "suppliers.detail": "جزئیات تأمین‌کننده", "parties.detail": "جزئیات طرف‌حساب", "products.list": "فهرست کالاها", "products.detail": "جزئیات کالا", "products.categories": "دسته‌های کالا", "services.list": "فهرست خدمات", "services.detail": "جزئیات خدمت", "services.categories": "دسته‌های خدمات", "inventory.list": "موجودی و شمارش", "inventory.count-detail": "جزئیات شمارش", "purchases.list": "فهرست خریدها", "purchases.detail": "جزئیات خرید", "expenses.list": "فهرست هزینه‌ها", "expenses.detail": "جزئیات هزینه", "expenses.categories": "دسته‌های هزینه", "finance.overview": "نمای مالی", "finance.detail": "جزئیات گردش مالی", "ledger.entries": "دفتر مالی", "reports.overview": "گزارش‌ها", "settings.workspace": "تنظیمات", "workspace.other": "بخش دیگر" };
const STATUS_OPTIONS: Record<KaashStatus, KaashStatus[]> = { NEW: ["NEW", "REVIEWING", "ARCHIVED"], REVIEWING: ["REVIEWING", "PLANNED", "IN_PROGRESS", "ARCHIVED"], PLANNED: ["PLANNED", "REVIEWING", "IN_PROGRESS", "ARCHIVED"], IN_PROGRESS: ["IN_PROGRESS", "PLANNED", "RELEASED", "ARCHIVED"], RELEASED: ["RELEASED", "REVIEWING", "ARCHIVED"], ARCHIVED: ["ARCHIVED", "REVIEWING"] };
const MODULES = Object.entries(MODULE_LABEL) as Array<[KaashModule, string]>;
const STATUS_OPTIONS_ALL = Object.entries(STATUS_LABEL) as Array<[KaashStatus, string]>;
const STORY_ROUTE = /^\/system-admin\/kaash\/([0-9a-f-]{36})\/story$/i;
const DETAIL_ROUTE = /^\/system-admin\/kaash\/([0-9a-f-]{36})$/i;

export function kaashStoryIdFromPath(pathname: string): string | null {
  return pathname.match(STORY_ROUTE)?.[1] ?? null;
}

export function KaashAdminWorkspace({ csrf, active }: { csrf?: string; active: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const detailId = location.pathname.match(DETAIL_ROUTE)?.[1] ?? null;
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("");
  const [module, setModule] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { const timer = window.setTimeout(() => { setDebouncedQ(q.trim()); setPage(1); }, 300); return () => window.clearTimeout(timer); }, [q]);

  const list = useQuery({
    queryKey: ["system-admin", "kaash", "list", { q: debouncedQ, status, module, from, to, page }],
    queryFn: () => adminApi<KaashList>("/system-admin/kaash/query", { method: "POST", body: JSON.stringify({ q: debouncedQ || undefined, status: status || undefined, module: module || undefined, from: from || undefined, to: to || undefined, page, pageSize: 20 }) }, csrf),
    enabled: active && !detailId,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const detail = useQuery({
    queryKey: ["system-admin", "kaash", "detail", detailId],
    queryFn: () => adminApi<KaashDetail>(`/system-admin/kaash/${detailId}`, {}, csrf),
    enabled: active && Boolean(detailId),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  if (detailId) return <KaashDetailPage
    id={detailId}
    data={detail.data}
    isPending={detail.isPending}
    error={detail.error}
    onRetry={() => void detail.refetch()}
    onBack={() => navigate("/system-admin/kaash")}
    onStory={() => navigate(`/system-admin/kaash/${detailId}/story`)}
    onSave={async (body) => {
      await adminApi(`/system-admin/kaash/${detailId}`, { method: "PATCH", body: JSON.stringify(body) }, csrf);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["system-admin", "kaash"] }),
        client.invalidateQueries({ queryKey: ["system-admin", "kaash-counts"] }),
      ]);
      await detail.refetch();
    }}
  />;

  return <section className="kaash-admin-page" aria-label="مدیریت کاش‌ها">
    <header className="kaash-admin-heading"><div><h2>کاش‌های کاربران</h2><p>پیشنهادهای ثبت‌شده پس از تأیید سرور؛ فیلترها در همین صفحه نگه‌داری می‌شوند.</p></div><KaashLogo alt="آیکون کاش" /></header>
    <div className="kaash-filter-panel">
      <label className="kaash-filter-search" aria-label="جست‌وجوی متن یا شناسهٔ کاش"><Search size={16} /><input value={q} onChange={(event) => { setQ(event.target.value); setPage(1); }} placeholder="جست‌وجو در متن یا شناسه" autoComplete="off" /></label>
      <label className="field"><span className="field-label">وضعیت</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">همهٔ وضعیت‌ها</option>{STATUS_OPTIONS_ALL.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field"><span className="field-label">بخش</span><select value={module} onChange={(event) => { setModule(event.target.value); setPage(1); }}><option value="">همهٔ بخش‌ها</option>{MODULES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <JalaliDatePicker label="از تاریخ" value={from} onChange={(value) => { setFrom(value); setPage(1); }} clearable />
      <JalaliDatePicker label="تا تاریخ" value={to} onChange={(value) => { setTo(value); setPage(1); }} clearable />
    </div>
    {list.isPending && <div className="kaash-empty-state" role="status"><span>در حال دریافت کاش‌ها…</span></div>}
    {list.isError && <div className="kaash-admin-error" role="alert">{errorText(list.error)} <button className="button button-secondary" type="button" onClick={() => void list.refetch()}>تلاش دوباره</button></div>}
    {list.data && <>
      <div className="kaash-results-meta"><span>{faNumber(list.data.total)} کاش</span><span>مرتب‌شده بر اساس جدیدترین</span></div>
      {!list.data.items.length ? <div className="kaash-empty-state"><KaashLogo alt="" /><strong>{debouncedQ || status || module || from || to ? "نتیجه‌ای با این فیلترها پیدا نشد" : "هنوز کاشی ثبت نشده است"}</strong><p>{debouncedQ || status || module || from || to ? "عبارت یا فیلترها را تغییر دهید و دوباره بررسی کنید." : "پس از ثبت کاربران، پیشنهادها در همین فهرست دیده می‌شوند."}</p></div> : <div className="kaash-table-wrap"><table className="kaash-table"><thead><tr><th>پیشنهاد</th><th>وضعیت</th><th>بخش مبدأ</th><th>کاربر و کسب‌وکار</th><th>تاریخ ثبت</th></tr></thead><tbody>{list.data.items.map((item) => <tr key={item.id}>
        <td><button className="kaash-list-open" type="button" onClick={() => navigate(`/system-admin/kaash/${item.id}`)}><span className="kaash-list-text">{item.textPreview}</span></button></td>
        <td><StatusChip status={item.status} /></td>
        <td className="kaash-mobile-meta"><span className="kaash-source-label"><b>{MODULE_LABEL[item.module]}</b><small>{SCREEN_LABEL[item.screenKey] ?? "بخش دیگر"}</small></span></td>
        <td className="kaash-mobile-meta"><span className="kaash-list-person"><b>{item.user.displayName || "کاربر بدون نام"} · {item.user.phoneMasked}</b><small>{[item.businessName, item.branchName].filter(Boolean).join(" · ") || "بدون اطلاعات کسب‌وکار"}</small></span></td>
        <td className="kaash-mobile-meta">{jalaliDate(item.createdAt)}</td>
      </tr>)}</tbody></table></div>}
      <AdminPagination page={page} pageCount={list.data.pages} total={list.data.total} onPage={setPage} />
    </>}
  </section>;
}

function KaashDetailPage({ id, data, isPending, error, onRetry, onBack, onStory, onSave }: {
  id: string; data?: KaashDetail; isPending: boolean; error: unknown; onRetry: () => void; onBack: () => void; onStory: () => void; onSave: (body: { status?: KaashStatus; internalNote?: string }) => Promise<void>;
}) {
  const [status, setStatus] = useState<KaashStatus>("NEW");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!data) return;
    setStatus(data.status);
    setNote(data.internalNote ?? "");
    setErrorMessage("");
    setNotice("");
  }, [data?.id, data?.updatedAt]);

  if (isPending) return <div className="kaash-empty-state" role="status">در حال بارگذاری جزئیات کاش…</div>;
  if (error || !data) return <div className="kaash-admin-error" role="alert">{errorText(error)} <button className="button button-secondary" type="button" onClick={onRetry}>تلاش دوباره</button> <button className="button button-text" type="button" onClick={onBack}>بازگشت به فهرست</button></div>;

  const save = async () => {
    setBusy(true);
    setErrorMessage("");
    setNotice("");
    try {
      await onSave({ status, internalNote: note });
      setNotice("تغییرات ذخیره شد.");
    } catch (cause) {
      setErrorMessage(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const copyId = async () => {
    try { await navigator.clipboard.writeText(id); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setCopied(false); }
  };
  const statusDirty = status !== data.status;
  const noteDirty = note.trim() !== (data.internalNote ?? "");
  const statusOptions = STATUS_OPTIONS[data.status];

  return <section className="kaash-admin-page kaash-detail-page" aria-label="جزئیات کاش">
    <nav className="kaash-detail-nav" aria-label="مسیر صفحه"><button type="button" onClick={onBack}><ArrowRight size={15} />فهرست کاش‌ها</button><span>جزئیات پیشنهاد</span></nav>
    <div className="kaash-detail-layout">
      <div className="kaash-detail-main">
        <article className="kaash-quote-card">
          <div className="kaash-quote-top"><KaashLogo alt="آیکون کاش" /><StatusChip status={data.status} /></div>
          <blockquote className="kaash-quote-content">{data.content}</blockquote>
          <footer className="kaash-quote-footer"><span>{jalaliDate(data.createdAt)} · {MODULE_LABEL[data.module]} / {SCREEN_LABEL[data.screenKey] ?? "بخش دیگر"}</span><BrandLogo alt="لوگوی شاپرو" /></footer>
        </article>
        <div className="kaash-detail-actions"><button className="button button-primary" type="button" onClick={onStory}><Lightbulb size={16} />نمای استوری ۹:۱۶</button><button className="kaash-copy-id" type="button" onClick={() => void copyId()} aria-label="کپی شناسهٔ کاش"><Copy size={14} /><bdi dir="ltr">{id}</bdi>{copied && <Check size={14} />}</button></div>
        {notice && <p className="notice notice-success" role="status">{notice}</p>}{errorMessage && <p className="kaash-admin-error" role="alert">{errorMessage}</p>}
        <section className="kaash-history-card"><h3>تاریخچهٔ پیگیری</h3>{data.events.length ? <ol className="kaash-history-list">{data.events.map((event) => <li className="kaash-history-item" key={event.id}>
          <small>{jalaliDate(event.createdAt)}{event.adminName ? ` · ${event.adminName}` : ""}</small>
          <strong>{eventLabel(event)}</strong>
          {(event.previousStatus || event.newStatus) && <span className="kaash-history-statuses">{event.previousStatus && <StatusChip status={event.previousStatus} />}{event.previousStatus && event.newStatus && <ChevronLeft size={13} />}{event.newStatus && <StatusChip status={event.newStatus} />}</span>}
          {event.previousNote !== null && <p><b>یادداشت پیشین: </b>{event.previousNote || "یادداشتی ثبت نشده بود."}</p>}
          {event.newNote !== null && <p><b>یادداشت جدید: </b>{event.newNote || "یادداشت پاک شد."}</p>}
        </li>)}</ol> : <p className="muted">هنوز تغییری در وضعیت ثبت نشده است.</p>}</section>
      </div>
      <aside className="kaash-detail-side">
        <section className="kaash-info-card"><h3>مشخصات ثبت</h3><div className="kaash-info-grid"><InfoItem label="تاریخ ثبت" value={jalaliDate(data.createdAt)} /><InfoItem label="بخش مبدأ" value={MODULE_LABEL[data.module]} /><InfoItem label="صفحه" value={SCREEN_LABEL[data.screenKey] ?? "بخش دیگر"} /><InfoItem label="آخرین تغییر" value={jalaliDate(data.updatedAt)} /></div><div className="kaash-admin-personal"><h4>اطلاعات لازم برای پیگیری مالک</h4><div className="kaash-info-grid"><InfoItem label="کاربر" value={data.user.displayName || "کاربر بدون نام"} /><InfoItem label="شمارهٔ پوشیده" value={data.user.phoneMasked} /><InfoItem label="کسب‌وکار" value={data.businessName ?? "ثبت نشده"} /><InfoItem label="شعبه" value={data.branchName ?? "ثبت نشده"} /></div></div></section>
        <section className="kaash-workflow-card"><h3>مدیریت پیگیری</h3><div className="kaash-workflow-form"><label><span>وضعیت</span><select value={status} onChange={(event) => { setStatus(event.target.value as KaashStatus); setNotice(""); }}>{statusOptions.map((option) => <option value={option} key={option}>{STATUS_LABEL[option]}</option>)}</select></label><label><span>یادداشت داخلی مالک</span><textarea value={note} onChange={(event) => { setNote(event.target.value); setNotice(""); }} maxLength={4000} placeholder="این یادداشت فقط در پنل مالک دیده می‌شود." /></label><button type="button" className="button button-primary full" disabled={busy || (!statusDirty && !noteDirty)} onClick={() => void save()}>{busy ? "در حال ذخیره…" : "ذخیرهٔ پیگیری"}</button></div><p className="kaash-workflow-help">یادداشت داخلی فقط برای مالک است و در نمای استوری یا پاسخ کاربر نمایش داده نمی‌شود.</p></section>
      </aside>
    </div>
  </section>;
}

export function KaashStoryPage({ id }: { id: string }) {
  const navigate = useNavigate();
  const story = useQuery({ queryKey: ["system-admin", "kaash", "story", id], queryFn: () => adminApi<Story>(`/system-admin/kaash/${id}/story`), retry: false, staleTime: 0, gcTime: 0 });
  const [page, setPage] = useState(0);
  const [screenshotMode, setScreenshotMode] = useState(false);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (!screenshotMode) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setScreenshotMode(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screenshotMode]);
  const stageWidth = Math.min(viewport.width, viewport.height * 9 / 16);
  const fontSize = Math.max(18, Math.min(30, viewport.width * 0.0245));
  const estimatedTextLines = Math.max(8, Math.floor((stageWidth * 16 / 9 * 0.48) / (fontSize * 1.7)));
  const storyPages = useMemo(() => paginateKaashStory(story.data?.content ?? "", stageWidth * 0.76, fontSize, estimatedTextLines), [story.data?.content, stageWidth, fontSize, estimatedTextLines]);
  useEffect(() => setPage(0), [story.data?.content]);

  if (story.isPending) return <StoryState>در حال آماده‌سازی نمای استوری…</StoryState>;
  if (story.isError || !story.data) return <StoryState error>{errorText(story.error)}<button type="button" onClick={() => navigate(`/system-admin/kaash/${id}`)}>بازگشت به جزئیات</button></StoryState>;

  return <main className={`kaash-story-route ${screenshotMode ? "is-screenshot-mode" : ""}`} dir="rtl">
    <header className="kaash-story-toolbar"><button type="button" onClick={() => navigate(`/system-admin/kaash/${id}`)}><ArrowRight size={16} />بازگشت به جزئیات</button><span>پیش‌نمایش ناشناس استوری · ۹:۱۶</span></header>
    <div className="kaash-story-workarea">
      <article className="kaash-story-sheet" aria-label={`پیش‌نمایش استوری، بخش ${faNumber(page + 1)} از ${faNumber(storyPages.length)}`}>
        <header className="kaash-story-top"><KaashLogo alt="آیکون کاش" /><div className="kaash-story-brand"><BrandLogo alt="لوگوی شاپرو" /><small>پیشنهاد شما برای بهترشدن شاپرو</small></div></header>
        <blockquote className="kaash-story-quote"><p>{storyPages[page]}</p></blockquote>
        <footer className="kaash-story-bottom"><BrandLogo alt="لوگوی شاپرو" /><div className="kaash-story-date"><strong>{jalaliDate(story.data.createdAt)}</strong><span>کاش · شاپرو</span></div></footer>
        {storyPages.length > 1 && <span className="kaash-story-counter">{faNumber(page + 1)} / {faNumber(storyPages.length)}</span>}
      </article>
    </div>
    <nav className="kaash-story-controls" aria-label="کنترل نمای استوری">
      <button type="button" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}><ChevronRight size={16} />قبلی</button>
      <span>بخش {faNumber(page + 1)} از {faNumber(storyPages.length)}</span>
      <button type="button" disabled={page >= storyPages.length - 1} onClick={() => setPage((current) => Math.min(storyPages.length - 1, current + 1))}>بعدی<ChevronLeft size={16} /></button>
      <button type="button" onClick={() => window.print()}><Printer size={15} />چاپ / ذخیره</button>
      <button type="button" onClick={() => setScreenshotMode((value) => !value)}>{screenshotMode ? <X size={15} /> : <Lightbulb size={15} />}{screenshotMode ? "نمایش ابزارها" : "آمادهٔ تصویر"}</button>
    </nav>
  </main>;
}

function StoryState({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <main className="kaash-story-route" dir="rtl"><section className={`kaash-empty-state ${error ? "kaash-admin-error" : ""}`} role={error ? "alert" : "status"}><KaashLogo alt="" /><div>{children}</div></section></main>;
}

function StatusChip({ status }: { status: KaashStatus }) {
  return <span className={`kaash-status-chip status-${status.toLowerCase().replaceAll("_", "-")}`}>{STATUS_LABEL[status]}</span>;
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return <div className="kaash-info-item"><small>{label}</small><strong>{value}</strong></div>;
}

function eventLabel(event: KaashDetail["events"][number]) {
  if (event.kind === "SUBMITTED") return "پیشنهاد ثبت شد";
  if (event.kind === "STATUS_CHANGED") return "وضعیت تغییر کرد";
  if (event.kind === "NOTE_CHANGED") return "یادداشت داخلی تغییر کرد";
  return "وضعیت و یادداشت داخلی تغییر کردند";
}

function errorText(value: unknown) {
  if (value instanceof ApiError) return value.message;
  return value instanceof Error ? value.message : "دریافت اطلاعات انجام نشد. دوباره تلاش کنید.";
}
