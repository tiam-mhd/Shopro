import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Archive, Boxes, BriefcaseBusiness, Check, ChevronDown, Download, FileSpreadsheet, ImagePlus, PackagePlus, Pencil, Plus, ReceiptText, RotateCcw, ScanBarcode, Search, ShoppingCart, Star, Tags, Trash2, Truck, Upload, UsersRound } from "lucide-react";
import { toAsciiDigits, type CursorPage, type MemberRole } from "@shopro/contracts";
import { adminApi, del, downloadFile, get, patch, post, uploadFile } from "../lib/api.js";
import { faNumber, money } from "../lib/format.js";
import { EmptyState, Field, InlineError, LoadMoreButton, PageHeader, SelectField, SubmitButton, messageOf, useInvalidate } from "../App.js";
import { Modal } from "../components/Modal.js";
import { CameraControls, useCameraSession } from "../components/CameraSession.js";

type MoneyCurrency = "IRR" | "IRT";
type PartyType = "CUSTOMER" | "SUPPLIER" | "BOTH";
type Party = { id: string; name: string; type: PartyType; phone: string | null; email?: string | null; nationalId?: string | null; address?: string | null; creditLimitRial?: string | null; paymentTermsDays?: number | null; balanceRial?: string };
type ProductImage = { id: string; position: number; path: string };
type QueuedProductImage = { id: string; file: File };
type Product = { id: string; name: string; sku: string | null; barcode?: string | null; kind: "STOCK" | "SERVICE"; unit: { id: string; labelFa: string; precision?: number }; salePriceRial: string; defaultCostRial?: string | null; taxRateBasisPoints?: number; quantityOnHand: string; reorderPoint?: string | null; category?: { id: string; name: string } | null; images?: ProductImage[] };
type UnitCatalogItem = { id: string; code: string; labelFa: string; precision: number; isVisible: boolean };
type UnitCatalogData = { units: UnitCatalogItem[]; groups: Array<{ key: string; labelFa: string; units: UnitCatalogItem[] }>; visibleCount: number };
type ExpenseCategory = { id: string; name: string; isActive: boolean; expenseCount: number };

export function CustomersPage({ currency }: { currency: MoneyCurrency }) { return <PartyDirectoryPage currency={currency} kind="CUSTOMER" />; }
export function SuppliersPage({ currency }: { currency: MoneyCurrency }) { return <PartyDirectoryPage currency={currency} kind="SUPPLIER" />; }

export function ExpenseCategoriesPage({ role }: { role: MemberRole }) {
  const invalidate = useInvalidate();
  const canManage = ["OWNER", "MANAGER", "ACCOUNTANT"].includes(role);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ACTIVE" | "ARCHIVED">("ACTIVE");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseCategory | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ExpenseCategory | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const categories = useQuery({ queryKey: ["expense-categories", "management", sessionStorage.getItem("shopro_business_id"), canManage], queryFn: () => get<ExpenseCategory[]>(`/expenses/categories${canManage ? "?includeArchived=true" : ""}`) });
  const rows = categories.data ?? [];
  const activeCount = rows.filter((category) => category.isActive).length;
  const archivedCount = rows.length - activeCount;
  const visibleRows = rows.filter((category) => category.isActive === (filter === "ACTIVE") && category.name.toLocaleLowerCase("fa-IR").includes(search.trim().toLocaleLowerCase("fa-IR")));

  const openCreate = () => { setEditing(null); setName(""); setError(""); setFormOpen(true); };
  const openEdit = (category: ExpenseCategory) => { setEditing(category); setName(category.name); setError(""); setFormOpen(true); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (editing) await patch(`/expenses/categories/${editing.id}`, { name });
      else await post("/expenses/categories", { name });
      setFormOpen(false); await invalidate();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const setActive = async (category: ExpenseCategory, isActive: boolean) => {
    setBusy(true); setError("");
    try { await patch(`/expenses/categories/${category.id}`, { isActive }); setArchiveTarget(null); await invalidate(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };

  return <PageHeader title="دسته‌بندی هزینه‌ها" subtitle="دسته‌ها را مدیریت کنید؛ اسناد قبلی با بایگانی دسته حفظ می‌شوند." actions={<div className="detail-actions"><Link className="button button-secondary" to="/app/expenses"><ReceiptText size={16} />بازگشت به هزینه‌ها</Link>{canManage && <button className="button button-primary" type="button" onClick={openCreate}><Plus size={17} />دستهٔ تازه</button>}</div>}>
    <section className="card expense-category-overview"><span className="expense-category-overview-icon"><Tags size={22} /></span><div><small>دفتر دسته‌های هزینه</small><h2>هزینه‌ها را منظم و قابل پیگیری نگه دارید</h2><p>دسته‌بندی‌ها در ثبت هزینه و گزارش‌های مالی استفاده می‌شوند. بایگانی، سابقهٔ اسناد را تغییر نمی‌دهد.</p></div><div className="expense-category-counts"><span><strong>{faNumber(activeCount)}</strong><small>فعال</small></span><span><strong>{faNumber(archivedCount)}</strong><small>بایگانی‌شده</small></span></div></section>
    {!canManage && <div className="notice notice-warning">دسته‌ها را می‌توانید ببینید؛ برای افزودن، ویرایش یا بایگانی، دسترسی مدیر یا حسابدار لازم است.</div>}
    <section className="card expense-category-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جست‌وجوی نام دسته" aria-label="جست‌وجوی نام دسته" /></div><div className="expense-category-filter" role="group" aria-label="وضعیت دسته‌ها"><button type="button" aria-pressed={filter === "ACTIVE"} className={filter === "ACTIVE" ? "active" : ""} onClick={() => setFilter("ACTIVE")}>فعال <span>{faNumber(activeCount)}</span></button>{canManage && <button type="button" aria-pressed={filter === "ARCHIVED"} className={filter === "ARCHIVED" ? "active" : ""} onClick={() => setFilter("ARCHIVED")}>بایگانی‌شده <span>{faNumber(archivedCount)}</span></button>}</div></section>
    {categories.isError && <InlineError error={categories.error} retry={() => void categories.refetch()} />}
    {error && !formOpen && !archiveTarget && <InlineError error={error} />}
    {categories.isError ? null : categories.isPending ? <div className="card expense-category-loading" role="status">در حال بارگذاری دسته‌ها…</div> : visibleRows.length ? <section className="expense-category-list" aria-label="فهرست دسته‌های هزینه">{visibleRows.map((category) => <article className={`card expense-category-row ${category.isActive ? "is-active" : "is-archived"}`} key={category.id}><span className="expense-category-row-icon"><ReceiptText size={18} /></span><div className="expense-category-row-copy"><strong>{category.name}</strong><small>{faNumber(category.expenseCount)} سند هزینه · {category.isActive ? "در انتخاب هزینه‌ها نمایش داده می‌شود" : "در فهرست انتخاب هزینه‌ها نیست"}</small></div><span className={`expense-category-status ${category.isActive ? "is-active" : "is-archived"}`}>{category.isActive ? "فعال" : "بایگانی‌شده"}</span>{canManage && <div className="expense-category-actions">{category.isActive && <button type="button" className="icon-button" title="ویرایش دسته" aria-label={`ویرایش ${category.name}`} onClick={() => openEdit(category)}><Pencil size={16} /></button>}{category.isActive ? <button type="button" className="icon-button is-danger" title="بایگانی دسته" aria-label={`بایگانی ${category.name}`} onClick={() => { setError(""); setArchiveTarget(category); }}><Archive size={16} /></button> : <button type="button" className="icon-button" title="فعال‌سازی دسته" aria-label={`فعال‌سازی ${category.name}`} disabled={busy} onClick={() => void setActive(category, true)}><RotateCcw size={16} /></button>}</div>}</article>)}</section> : <EmptyState icon={Tags} title={search ? "دسته‌ای با این نام پیدا نشد" : filter === "ACTIVE" ? "دستهٔ فعالی ثبت نشده است" : "دستهٔ بایگانی‌شده‌ای نیست"} text={search ? "عبارت جست‌وجو را کوتاه‌تر کنید." : filter === "ACTIVE" ? "یک دستهٔ تازه بسازید تا هزینه‌ها در گزارش‌ها مرتب‌تر دیده شوند." : "دسته‌های بایگانی‌شده برای حفظ سوابق مالی نگه‌داری می‌شوند."} action={canManage && filter === "ACTIVE" && !search ? <button type="button" className="button button-secondary" onClick={openCreate}><Plus size={16} />ساخت دسته</button> : undefined} />}
    <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? "ویرایش دستهٔ هزینه" : "دستهٔ هزینهٔ تازه"} description="نام دسته در فرم ثبت هزینه و گزارش‌های مالی نمایش داده می‌شود."><form onSubmit={(event) => void save(event)}><Field label="نام دسته" value={name} onChange={setName} required /><InlineError error={error} /><div className="modal-form-actions"><SubmitButton busy={busy}>{editing ? "ذخیرهٔ تغییرات" : "ذخیرهٔ دسته"}</SubmitButton></div></form></Modal>
    <Modal open={!!archiveTarget} onClose={() => setArchiveTarget(null)} title="بایگانی دستهٔ هزینه" description="دسته از انتخاب‌های هزینه‌های جدید کنار می‌رود؛ اسناد ثبت‌شده و گزارش‌های قبلی حفظ می‌شوند."><p>دستهٔ «{archiveTarget?.name}» بایگانی شود؟</p><InlineError error={error} /><div className="modal-form-actions"><button type="button" className="button button-danger" disabled={busy} onClick={() => archiveTarget && void setActive(archiveTarget, false)}>{busy ? "در حال بایگانی…" : "تأیید بایگانی"}</button></div></Modal>
  </PageHeader>;
}

function PartyDirectoryPage({ currency, kind }: { currency: MoneyCurrency; kind: Exclude<PartyType, "BOTH"> }) {
  const invalidate = useInvalidate();
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Party | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Party | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [address, setAddress] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [paymentTermsDays, setPaymentTermsDays] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isCustomer = kind === "CUSTOMER";
  const noun = isCustomer ? "مشتری" : "تأمین‌کننده";
  const title = isCustomer ? "مشتریان" : "تأمین‌کنندگان";
  const endpoint = isCustomer ? "/customers" : "/suppliers";
  const baseRoute = isCustomer ? "/app/customers" : "/app/suppliers";
  const PartyIcon = isCustomer ? UsersRound : Truck;
  const parties = useInfiniteQuery({ queryKey: ["parties", kind, query], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => get<CursorPage<Party>>(`${endpoint}?limit=50&q=${encodeURIComponent(query)}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`), getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined });
  const partyRows = parties.data?.pages.flatMap((page) => page.items) ?? [];

  const openCreate = () => { setEditing(null); setName(""); setPhone(""); setEmail(""); setNationalId(""); setAddress(""); setCreditLimit(""); setPaymentTermsDays(""); setError(""); setFormOpen(true); };
  const openEdit = (party: Party) => { setEditing(party); setName(party.name); setPhone(party.phone ?? ""); setEmail(party.email ?? ""); setNationalId(party.nationalId ?? ""); setAddress(party.address ?? ""); setCreditLimit(party.creditLimitRial ? rialToPartyAmount(party.creditLimitRial, currency) : ""); setPaymentTermsDays(party.paymentTermsDays?.toString() ?? ""); setError(""); setFormOpen(true); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const common = { name, phone: phone || null, email: email || null, nationalId: nationalId || null, address: address || null };
      const specific = isCustomer ? { creditLimitRial: creditLimit.trim() ? partyAmountToRial(creditLimit, currency) : null } : { paymentTermsDays: paymentTermsDays.trim() ? Number(toAsciiDigits(paymentTermsDays)) : null };
      if (editing) await patch(endpoint + "/" + editing.id, { ...common, ...specific });
      else await post(endpoint, { ...common, ...specific });
      setFormOpen(false); await invalidate();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const archive = async () => {
    if (!archiveTarget) return;
    setBusy(true); setError("");
    try { await patch("/parties/" + archiveTarget.id, { isActive: false }); setArchiveTarget(null); await invalidate(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };

  return <PageHeader title={title} subtitle={isCustomer ? "مدیریت پرونده، سقف اعتبار و گردش مشتریان" : "مدیریت اطلاعات خرید، مهلت پرداخت و گردش تأمین‌کنندگان"} actions={<button className="button button-primary" type="button" onClick={openCreate}><Plus size={17} />{noun} جدید</button>}>
    <section className={`counterparty-overview card ${isCustomer ? "is-customer" : "is-supplier"}`}><span className="counterparty-overview-icon"><PartyIcon size={23} /></span><div className="counterparty-overview-copy"><small>دفتر {noun}</small><h2>{isCustomer ? "ارتباط و اعتبار مشتریان" : "مدیریت تأمین و پرداخت‌ها"}</h2><p>{isCustomer ? "اطلاعات تماس، ماندهٔ مالی و سقف اعتبار فروش هر مشتری را یکجا ببینید." : "پروندهٔ تأمین‌کننده، مهلت پرداخت و گردش خرید و هزینه را در دسترس داشته باشید."}</p></div><div className="counterparty-overview-count"><strong>{faNumber(partyRows.length)}</strong><span>مورد بارگذاری‌شده</span></div></section>
    <div className="toolbar card counterparty-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`جست‌وجوی نام، شماره همراه یا ${isCustomer ? "کد ملی مشتری" : "شناسه اقتصادی تأمین‌کننده"}`} aria-label={`جست‌وجوی ${noun}`} /></div><span className="counterparty-toolbar-note">{isCustomer ? "فهرست مشتریان این کسب‌وکار" : "فهرست تأمین‌کنندگان این کسب‌وکار"}</span></div>
    {parties.isError && <InlineError error={parties.error} retry={() => void parties.refetch()} />}
    {parties.isPending ? <div className="card"><span className="muted">در حال بارگیری {title.toLocaleLowerCase("fa-IR")}…</span></div> : <><div className="counterparty-list">{partyRows.map((party) => <article className={`card counterparty-row ${isCustomer ? "is-customer" : "is-supplier"}`} key={party.id}>
      <Link className="counterparty-identity" to={baseRoute + "/" + party.id}><span className="counterparty-avatar"><PartyIcon size={18} /></span><span className="counterparty-name"><strong>{party.name}</strong><small>{party.phone || "شماره همراه ثبت نشده"}{party.email ? ` · ${party.email}` : ""}</small></span></Link>
      <div className="counterparty-facts"><span><small>ماندهٔ دفتر</small><strong>{money(party.balanceRial ?? "0", currency)}</strong></span>{isCustomer ? <span><small>سقف اعتبار فروش</small><strong>{party.creditLimitRial ? money(party.creditLimitRial, currency) : "تعیین نشده"}</strong></span> : <span><small>مهلت پرداخت</small><strong>{party.paymentTermsDays == null ? "تعیین نشده" : `${faNumber(party.paymentTermsDays)} روز`}</strong></span>}</div>
      <div className="counterparty-actions">{isCustomer && <Link className="icon-button" to={`/app/sales?customerId=${encodeURIComponent(party.id)}`} aria-label={`ثبت فروش برای ${party.name}`} title="ثبت فروش برای این مشتری"><ShoppingCart size={16} /></Link>}<button type="button" className="icon-button" aria-label={`ویرایش ${noun} ${party.name}`} title="ویرایش" onClick={() => openEdit(party)}><Pencil size={16} /></button><button type="button" className="icon-button" aria-label={`بایگانی ${noun} ${party.name}`} title="بایگانی" onClick={() => setArchiveTarget(party)}><Archive size={16} /></button></div>
    </article>)}{!partyRows.length && <div className="card counterparty-empty"><span className="counterparty-empty-icon"><PartyIcon size={23} /></span><strong>{query ? `${noun}ی مطابق جست‌وجو پیدا نشد` : `هنوز ${noun}ی ثبت نشده است`}</strong><p>{query ? "عبارت جست‌وجو را کوتاه‌تر کنید یا شماره همراه را بررسی کنید." : isCustomer ? "با ثبت اولین مشتری، اطلاعات تماس و گردش فروش او در همین صفحه در دسترس خواهد بود." : "با ثبت اولین تأمین‌کننده، اطلاعات تماس و مهلت پرداخت پیشنهادی او را یکجا مدیریت کنید."}</p>{!query && <button type="button" className="button button-secondary" onClick={openCreate}>{noun} جدید</button>}</div>}</div><LoadMoreButton hasMore={Boolean(parties.hasNextPage)} isLoading={parties.isFetchingNextPage} onClick={() => void parties.fetchNextPage()} /></>}
    <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? `ویرایش ${noun}` : `${noun} جدید`} description={isCustomer ? "اطلاعات پایه و سقف اعتبار فروش این مشتری را ثبت کنید." : "اطلاعات پایه و مهلت پرداخت توافق‌شده با این تأمین‌کننده را ثبت کنید."}>
      <form onSubmit={(event) => void save(event)}><div className="form-grid"><Field label={`نام ${noun}`} value={name} onChange={setName} required /><Field label="شمارهٔ همراه" value={phone} onChange={setPhone} inputMode="tel" dir="ltr" placeholder="اختیاری" /><Field label="ایمیل" value={email} onChange={setEmail} type="email" placeholder="اختیاری" /><Field label={isCustomer ? "کد ملی مشتری" : "شناسه اقتصادی تأمین‌کننده"} value={nationalId} onChange={setNationalId} dir="ltr" placeholder="اختیاری" />{isCustomer ? <Field label={`سقف اعتبار (${currency === "IRT" ? "تومان" : "ریال"})`} value={creditLimit} onChange={setCreditLimit} inputMode="numeric" placeholder="بدون محدودیت ثبت‌شده" /> : <Field label="مهلت پرداخت پیش‌فرض (روز)" value={paymentTermsDays} onChange={setPaymentTermsDays} inputMode="numeric" placeholder="مثلاً ۳۰" />}<Field label="نشانی" value={address} onChange={setAddress} placeholder="اختیاری" /></div>{error && <InlineError error={error} />}<div className="modal-form-actions"><SubmitButton busy={busy}>{editing ? "ذخیرهٔ تغییرات" : `ثبت ${noun}`}</SubmitButton></div></form>
    </Modal>
    <Modal open={!!archiveTarget} onClose={() => setArchiveTarget(null)} title={`بایگانی ${noun}`} description={`${noun} از فهرست انتخاب‌ها کنار گذاشته می‌شود؛ اسناد و گردش مالی قبلی باقی می‌مانند.`}>
      <p>«{archiveTarget?.name}» بایگانی شود؟</p>{error && <InlineError error={error} />}<div className="modal-form-actions"><button type="button" className="button button-danger" disabled={busy} onClick={() => void archive()}>{busy ? "در حال بایگانی…" : `تأیید بایگانی ${noun}`}</button></div>
    </Modal>
  </PageHeader>;
}

function partyAmountToRial(value: string, currency: MoneyCurrency) {
  const normalized = toAsciiDigits(value).replace(/[٬,\s]/g, "").trim();
  if (currency === "IRT") {
    const match = /^(\d+)(?:[.٫](\d))?$/.exec(normalized);
    if (!match) throw new Error("مبلغ تومان حداکثر یک رقم اعشار می‌پذیرد.");
    return (BigInt(match[1]) * 10n + BigInt(match[2] ?? "0")).toString();
  }
  if (!/^\d+$/.test(normalized)) throw new Error("مبلغ ریالی باید عدد صحیح باشد.");
  return BigInt(normalized).toString();
}

function rialToPartyAmount(value: string, currency: MoneyCurrency) {
  if (currency === "IRR") return value;
  const amount = BigInt(value);
  const whole = amount / 10n;
  const fraction = amount % 10n;
  return fraction === 0n ? whole.toString() : `${whole}.${fraction}`;
}

export function ProductsPage({ currency }: { currency: MoneyCurrency }) {
  const invalidate = useInvalidate();
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);
  const [createdProductId, setCreatedProductId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [initialQuantity, setInitialQuantity] = useState("0");
  const [currentQuantity, setCurrentQuantity] = useState("");
  const [quantityBaseline, setQuantityBaseline] = useState("");
  const [reorder, setReorder] = useState("");
  const [taxPercent, setTaxPercent] = useState("0");
  const [unitId, setUnitId] = useState("");
  const [unitCatalogOpen, setUnitCatalogOpen] = useState(false);
  const [barcodeScannerOpen, setBarcodeScannerOpen] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const kind = "STOCK" as const;
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryError, setCategoryError] = useState("");
  const [primaryFile, setPrimaryFile] = useState<QueuedProductImage | null>(null);
  const [galleryFiles, setGalleryFiles] = useState<QueuedProductImage[]>([]);
  const [mediaImages, setMediaImages] = useState<ProductImage[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<string[]>([]);
  const [primaryImageId, setPrimaryImageId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const products = useInfiniteQuery({ queryKey: ["products", query], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => get<CursorPage<Product>>(`/products?limit=50&q=${encodeURIComponent(query)}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`), getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined });
  const productRows = products.data?.pages.flatMap((page) => page.items) ?? [];
  const unitBusinessId = sessionStorage.getItem("shopro_business_id");
  const units = useQuery({ queryKey: ["units", unitBusinessId], queryFn: () => get<Array<{ id: string; labelFa: string; precision: number }>>("/products/units") });
  const categories = useQuery({ queryKey: ["product-categories"], queryFn: () => get<Array<{ id: string; name: string }>>("/products/categories") });
  const unitOptions = (units.data ?? []).map((unit) => ({ value: unit.id, label: unit.labelFa }));
  if (editing && !unitOptions.some((unit) => unit.value === editing.unit.id)) unitOptions.push({ value: editing.unit.id, label: `${editing.unit.labelFa} · واحد فعلی کالا` });

  useEffect(() => {
    setUnitId("");
  }, [unitBusinessId]);

  useEffect(() => {
    if (!editing && !unitId && units.data?.length === 1) setUnitId(units.data[0].id);
  }, [editing, unitId, units.data]);

  const clearForm = () => { setCreatedProductId(null); setName(""); setSku(""); setBarcode(""); setPrice(""); setCost(""); setInitialQuantity("0"); setCurrentQuantity(""); setQuantityBaseline(""); setReorder(""); setTaxPercent("0"); setUnitId(""); setUnitCatalogOpen(false); setBarcodeScannerOpen(false); setCategoryId(""); setCategoryName(""); setCategoryModalOpen(false); setPrimaryFile(null); setGalleryFiles([]); setMediaImages([]); setRemovedImageIds([]); setPrimaryImageId(""); setError(""); setCategoryError(""); };
  const openCreate = () => { setEditing(null); clearForm(); if (units.data?.length === 1) setUnitId(units.data[0].id); setFormOpen(true); };
  const openEdit = (product: Product) => { setEditing(product); setCreatedProductId(null); setName(product.name); setSku(product.sku ?? ""); setBarcode(product.barcode ?? ""); setPrice(fromRial(product.salePriceRial, currency)); setCost(product.defaultCostRial ? fromRial(product.defaultCostRial, currency) : ""); setInitialQuantity("0"); setCurrentQuantity(product.quantityOnHand); setQuantityBaseline(product.quantityOnHand); setReorder(product.reorderPoint ?? ""); setTaxPercent(String((product.taxRateBasisPoints ?? 0) / 100)); setCategoryId(product.category?.id ?? ""); setUnitId(product.unit.id); setUnitCatalogOpen(false); setBarcodeScannerOpen(false); setCategoryModalOpen(false); setPrimaryFile(null); setGalleryFiles([]); setMediaImages(product.images ?? []); setRemovedImageIds([]); setPrimaryImageId(product.images?.find((image) => image.position === 0)?.id ?? ""); setError(""); setCategoryError(""); setFormOpen(true); };
  const selectCatalogUnit = async (unit: UnitCatalogItem) => {
    if (!unit.isVisible) {
      const current = await get<UnitCatalogData>("/products/units/settings");
      const visibleUnitIds = [...new Set([...current.units.filter((item) => item.isVisible).map((item) => item.id), unit.id])];
      await patch("/products/units/settings", { visibleUnitIds });
      await units.refetch();
    }
    setUnitId(unit.id);
    setUnitCatalogOpen(false);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (!unitId) throw new Error("واحد کالا را انتخاب کنید.");
      const rate = Number(toAsciiDigits(taxPercent).replace(/[٫٬,\s]/g, (separator) => separator === "٫" ? "." : ""));
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error("نرخ مالیات باید بین صفر تا ۱۰۰ درصد باشد.");
      const salePriceRial = toRial(price, currency);
      const defaultCostRial = cost ? toRial(cost, currency) : null;
      let productId = editing?.id ?? createdProductId;
      if (productId) {
        const values: Record<string, unknown> = { name, sku: sku || null, barcode: barcode || null, unitId, categoryId: categoryId || null, salePriceRial, defaultCostRial, reorderPoint: reorder || null, taxRateBasisPoints: Math.round(rate * 100) };
        if (kind === "STOCK" && currentQuantity.trim() !== quantityBaseline) values.currentQuantity = currentQuantity;
        await patch("/products/" + productId, values);
        setQuantityBaseline(currentQuantity);
      } else {
        const created = await post<{ id: string }>("/products", { name, sku: sku || undefined, barcode: barcode || undefined, categoryId: categoryId || undefined, defaultCostRial: defaultCostRial || undefined, reorderPoint: reorder || undefined, taxRateBasisPoints: Math.round(rate * 100), unitId: unitId || undefined, salePriceRial, initialQuantity: initialQuantity || "0" });
        productId = created.id;
        setCreatedProductId(created.id);
        setCurrentQuantity(initialQuantity || "0");
        setQuantityBaseline(initialQuantity || "0");
      }
      if (!productId) throw new Error("شناسهٔ کالا دریافت نشد؛ فرم را دوباره ذخیره کنید.");
      for (const imageId of removedImageIds) {
        await del(`/products/${productId}/images/${imageId}`);
        setMediaImages((current) => current.filter((image) => image.id !== imageId).map((image, index) => ({ ...image, position: index })));
        setRemovedImageIds((current) => current.filter((id) => id !== imageId));
      }
      if (primaryImageId && !primaryFile && primaryImageId !== mediaImages.find((image) => image.position === 0)?.id) {
        await patch(`/products/${productId}/images/${primaryImageId}/primary`, {});
        setMediaImages((current) => [current.find((image) => image.id === primaryImageId)!, ...current.filter((image) => image.id !== primaryImageId)].map((image, index) => ({ ...image, position: index })));
      }
      if (primaryFile) {
        const file = primaryFile;
        const uploaded = await uploadCatalogImage("/products", productId, file, "PRIMARY");
        setMediaImages((current) => [...current.filter((image) => image.position !== 0), { ...uploaded, position: 0 }]);
        setPrimaryFile((current) => current?.id === file.id ? null : current);
        setPrimaryImageId(uploaded.id);
      }
      for (const queued of galleryFiles) {
        const uploaded = await uploadCatalogImage("/products", productId, queued, "GALLERY");
        setMediaImages((current) => [...current.filter((image) => image.id !== uploaded.id), uploaded].sort((a, b) => a.position - b.position));
        setGalleryFiles((current) => current.filter((image) => image.id !== queued.id));
      }
      setFormOpen(false); await invalidate();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const createCategory = async (event: FormEvent) => {
    event.preventDefault(); setCategoryBusy(true); setCategoryError("");
    try { const category = await post<{ id: string; name: string }>("/products/categories", { name: categoryName }); setCategoryId(category.id); setCategoryName(""); setCategoryModalOpen(false); await invalidate(); }
    catch (cause) { setCategoryError(messageOf(cause)); }
    finally { setCategoryBusy(false); }
  };
  const archive = async () => {
    if (!archiveTarget) return;
    setBusy(true); setError("");
    try { await patch("/products/" + archiveTarget.id, { isActive: false }); setArchiveTarget(null); await invalidate(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };

  return <PageHeader title="کالاها" subtitle="مدیریت کالاهای انبارشونده، قیمت و موجودی شعبه">
    <div className="catalog-page-actions" aria-label="عملیات کالاها">
      <Link className="button button-secondary" to="/app/product-categories" title="دسته‌بندی کالاها" aria-label="دسته‌بندی کالاها"><Tags size={16} /><span className="catalog-action-label">دسته‌بندی کالاها</span></Link>
      <CatalogExcelActions kind="products" onImported={() => invalidate()} />
      <button className="button button-primary" type="button" onClick={openCreate} title="کالای جدید" aria-label="کالای جدید"><PackagePlus size={17} /><span className="catalog-action-label">کالای جدید</span></button>
    </div>
    <div className="toolbar card"><div className="search-box"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="نام، کد کالا یا بارکد" aria-label="جست‌وجوی کالاها" /></div><span className="result-count">{faNumber(productRows.length)} کالا</span></div>
    {products.isError && <InlineError error={products.error} retry={() => void products.refetch()} />}
    {products.isPending ? <div className="card"><span className="muted">در حال بارگیری کالاها…</span></div> : <><div className="card table-card"><div className="table-head product-table-head"><span>کالا</span><span>موجودی</span><span>قیمت فروش</span><span aria-hidden="true" /></div>{productRows.map((product) => <div className="table-row product-table-row" key={product.id}>
      <Link className="table-name" to={"/app/products/" + product.id}><span className="product-avatar"><Boxes size={17} /></span><span><strong>{product.name}</strong><small>{product.sku || product.barcode || product.category?.name || product.unit.labelFa}</small></span></Link><span className={Number(product.quantityOnHand) <= Number(product.reorderPoint ?? -1) ? "stock-warning" : ""}>{product.kind === "SERVICE" ? "—" : faNumber(product.quantityOnHand) + " " + product.unit.labelFa}</span><strong>{money(product.salePriceRial, currency)}</strong><span className="entity-row-actions"><Link className="icon-button" to={`/app/sales?productId=${encodeURIComponent(product.id)}`} title="ثبت فروش برای این کالا" aria-label={`ثبت فروش برای ${product.name}`}><ShoppingCart size={16} /></Link><button type="button" className="icon-button" title="ویرایش" aria-label={"ویرایش " + product.name} onClick={() => openEdit(product)}><Pencil size={16} /></button><button type="button" className="icon-button" title="بایگانی" aria-label={"بایگانی " + product.name} onClick={() => setArchiveTarget(product)}><Archive size={16} /></button></span>
    </div>)}{!productRows.length && <div className="empty-state"><Boxes size={22} /><strong>کالایی ثبت نشده</strong><p>کالاها و خدمات خود را اضافه کنید.</p><button type="button" className="button button-secondary" onClick={openCreate}>افزودن کالا</button></div>}</div><LoadMoreButton hasMore={Boolean(products.hasNextPage)} isLoading={products.isFetchingNextPage} onClick={() => void products.fetchNextPage()} /></>}
    <Modal open={formOpen} onClose={() => { setFormOpen(false); setCategoryModalOpen(false); setUnitCatalogOpen(false); setBarcodeScannerOpen(false); }} title={editing || createdProductId ? "ویرایش کالا" : "تعریف کالا"} description="مشخصات را به‌ترتیب ثبت کنید؛ فیلدهای لازم در هر بخش مشخص شده‌اند." size="wide">
      <form className="product-editor" onSubmit={(event) => void save(event)}>
        <section className="product-form-section"><div className="product-form-section-heading"><span>۱</span><div><h3>مشخصات کالا</h3><p>نام، شناسه و دسته‌بندی در فاکتور و موجودی شعبه نمایش داده می‌شود.</p></div></div><div className="product-editor-grid"><Field label="نام کالا" value={name} onChange={setName} required placeholder="مثلاً: دفتر ۱۰۰ برگ" /><Field label="کد کالا" value={sku} onChange={setSku} placeholder="اختیاری" /><label className="field product-barcode-field"><span className="field-label">بارکد</span><span className="product-barcode-control"><input value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="اختیاری" dir="ltr" autoComplete="off" maxLength={120} /><button className="product-barcode-scan" type="button" title="اسکن بارکد با دوربین" aria-label="اسکن بارکد با دوربین" disabled={busy} onClick={() => setBarcodeScannerOpen(true)}><ScanBarcode size={17} /></button></span></label><SelectField label="واحد" value={unitId} onChange={setUnitId} options={unitOptions} onBrowseAll={() => setUnitCatalogOpen(true)} browseAllLabel="فهرست کامل واحدها" /><SelectField label="دسته‌بندی کالا" value={categoryId} onChange={setCategoryId} options={(categories.data ?? []).map((category) => ({ value: category.id, label: category.name }))} placeholder="بدون دسته‌بندی" onAdd={() => { setCategoryName(""); setCategoryError(""); setCategoryModalOpen(true); }} addLabel="ساخت دسته‌بندی" /></div></section>
        <section className="product-form-section"><div className="product-form-section-heading"><span>۲</span><div><h3>مشخصات</h3><p>نامی روشن انتخاب کنید تا در اسناد و فروشگاه قابل تشخیص باشد.</p></div></div><div className="product-editor-grid"><Field label="نام کالا" value={name} onChange={setName} required placeholder="مثلاً: دفتر ۱۰۰ برگ" /><Field label="کد کالا" value={sku} onChange={setSku} placeholder="اختیاری" /><label className="field product-barcode-field"><span className="field-label">بارکد</span><span className="product-barcode-control"><input value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="اختیاری" dir="ltr" autoComplete="off" maxLength={120} /><button className="product-barcode-scan" type="button" title="اسکن بارکد با دوربین" aria-label="اسکن بارکد با دوربین" disabled={busy} onClick={() => setBarcodeScannerOpen(true)}><ScanBarcode size={17} /></button></span></label><SelectField label="واحد" value={unitId} onChange={setUnitId} options={unitOptions} onBrowseAll={() => setUnitCatalogOpen(true)} browseAllLabel="فهرست کامل واحدها" /><SelectField label="دسته‌بندی" value={categoryId} onChange={setCategoryId} options={(categories.data ?? []).map((category) => ({ value: category.id, label: category.name }))} placeholder="بدون دسته‌بندی" onAdd={() => { setCategoryName(""); setCategoryError(""); setCategoryModalOpen(true); }} addLabel="ساخت دسته‌بندی" /></div></section>
        <section className="product-form-section"><div className="product-form-section-heading"><span>۳</span><div><h3>قیمت‌گذاری</h3><p>قیمت‌ها هنگام تایپ جدا می‌شوند و مبلغ نهایی همین‌جا دیده می‌شود.</p></div></div><div className="product-editor-grid"><MoneyInput label={`قیمت فروش (${currency === "IRT" ? "تومان" : "ریال"})`} value={price} onChange={setPrice} currency={currency} required /><MoneyInput label={`بهای خرید پیش‌فرض (${currency === "IRT" ? "تومان" : "ریال"})`} value={cost} onChange={setCost} currency={currency} hint="برای ارزش‌گذاری موجودی اولیه استفاده می‌شود." /><Field label="نرخ مالیات (درصد)" value={taxPercent} onChange={setTaxPercent} inputMode="decimal" placeholder="۰" /></div></section>
        {kind === "STOCK" && <section className="product-form-section"><div className="product-form-section-heading"><span>۴</span><div><h3>موجودی شعبه</h3><p>مقدار فعلی را وارد کنید؛ ثبت آن در گردش موجودی شعبه هم ثبت می‌شود.</p></div></div><div className="product-editor-grid"><Field label={editing || createdProductId ? "مقدار فعلی در انبار" : "مقدار فعلی اولیه در انبار"} value={editing || createdProductId ? currentQuantity : initialQuantity} onChange={editing || createdProductId ? setCurrentQuantity : setInitialQuantity} inputMode="decimal" required placeholder="۰" /><Field label="حد هشدار موجودی" value={reorder} onChange={setReorder} inputMode="decimal" placeholder="اختیاری" /><p className="product-stock-note">{editing || createdProductId ? "تغییر موجودی با سند شمارش و گردش حسابداری ثبت می‌شود." : cost ? "ارزش اولیه از مقدار × بهای خرید پیش‌فرض محاسبه می‌شود." : "اگر مقدار اولیه دارید، بهای خرید پیش‌فرض را هم برای ثبت ارزش موجودی وارد کنید."}</p></div></section>}
        <ProductMediaEditor entityId={editing?.id ?? createdProductId ?? undefined} entityLabel="کالا" images={mediaImages} primaryImageId={primaryImageId} onPrimaryImageIdChange={setPrimaryImageId} primaryFile={primaryFile} onPrimaryFileChange={setPrimaryFile} galleryFiles={galleryFiles} onGalleryFilesChange={setGalleryFiles} removedImageIds={removedImageIds} onRemovedImageIdsChange={setRemovedImageIds} />
        {error && <InlineError error={error} />}{units.isError && <InlineError error={units.error} retry={() => void units.refetch()} />}{categories.isError && <InlineError error={categories.error} retry={() => void categories.refetch()} />}<div className="modal-form-actions"><SubmitButton busy={busy}>{busy ? "در حال ذخیره…" : editing || createdProductId ? "ذخیرهٔ تغییرات" : "ثبت کالا"}</SubmitButton></div>
      </form>
    </Modal>
    <UnitCatalogModal open={unitCatalogOpen} businessId={unitBusinessId ?? "none"} selectedUnitId={unitId} onClose={() => setUnitCatalogOpen(false)} onSelect={(unit) => selectCatalogUnit(unit)} />
    <BarcodeScannerModal open={barcodeScannerOpen} onClose={() => setBarcodeScannerOpen(false)} onDetected={setBarcode} />
    <Modal open={categoryModalOpen} onClose={() => setCategoryModalOpen(false)} title="دسته‌بندی تازه" description="پس از ثبت، این دسته‌بندی در فرم کالا انتخاب می‌شود.">
      <form className="product-category-form" onSubmit={(event) => void createCategory(event)}><Field label="نام دسته‌بندی" value={categoryName} onChange={setCategoryName} required placeholder="مثلاً: لوازم تحریر" />{categoryError && <p className="form-error" role="alert">{categoryError}</p>}<div className="modal-form-actions"><SubmitButton busy={categoryBusy}>ثبت و انتخاب دسته</SubmitButton></div></form>
    </Modal>
    <Modal open={!!archiveTarget} onClose={() => setArchiveTarget(null)} title="بایگانی کالا" description="این مورد از فهرست انتخاب‌های تازه کنار گذاشته می‌شود؛ اسناد و سوابق قبلی باقی می‌مانند.">
      <p>«{archiveTarget?.name}» بایگانی شود؟</p>{error && <InlineError error={error} />}<div className="modal-form-actions"><button type="button" className="button button-danger" disabled={busy} onClick={() => void archive()}>{busy ? "در حال بایگانی…" : "تأیید بایگانی"}</button></div>
    </Modal>
  </PageHeader>;
}

type ManagedService = { id: string; name: string; description: string | null; unit: { id: string; labelFa: string }; category: { id: string; name: string } | null; salePriceRial: string; taxRateBasisPoints: number; images: ProductImage[] };

export function ServicesPage({ currency }: { currency: MoneyCurrency }) {
  const invalidate = useInvalidate();
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedService | null>(null);
  const [createdServiceId, setCreatedServiceId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ManagedService | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [taxPercent, setTaxPercent] = useState("0");
  const [unitId, setUnitId] = useState("");
  const [unitCatalogOpen, setUnitCatalogOpen] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [busy, setBusy] = useState(false);
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [primaryFile, setPrimaryFile] = useState<QueuedProductImage | null>(null);
  const [galleryFiles, setGalleryFiles] = useState<QueuedProductImage[]>([]);
  const [mediaImages, setMediaImages] = useState<ProductImage[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<string[]>([]);
  const [primaryImageId, setPrimaryImageId] = useState("");
  const services = useInfiniteQuery({ queryKey: ["services", query], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => get<CursorPage<ManagedService>>("/services?limit=50&q=" + encodeURIComponent(query) + (pageParam ? "&cursor=" + encodeURIComponent(pageParam) : "")), getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined });
  const rows = services.data?.pages.flatMap((page) => page.items) ?? [];
  const unitBusinessId = sessionStorage.getItem("shopro_business_id");
  const units = useQuery({ queryKey: ["units", unitBusinessId], queryFn: () => get<Array<{ id: string; labelFa: string; precision: number }>>("/products/units") });
  const categories = useQuery({ queryKey: ["service-categories"], queryFn: () => get<Array<{ id: string; name: string }>>("/services/categories") });
  const unitOptions = (units.data ?? []).map((unit) => ({ value: unit.id, label: unit.labelFa }));
  if (editing && !unitOptions.some((unit) => unit.value === editing.unit.id)) unitOptions.push({ value: editing.unit.id, label: editing.unit.labelFa + " · واحد فعلی خدمت" });
  useEffect(() => { setUnitId(""); }, [unitBusinessId]);
  useEffect(() => { if (!editing && !unitId && units.data?.length === 1) setUnitId(units.data[0].id); }, [editing, unitId, units.data]);
  const clearForm = () => { setCreatedServiceId(null); setName(""); setDescription(""); setPrice(""); setTaxPercent("0"); setUnitId(units.data?.length === 1 ? units.data[0].id : ""); setUnitCatalogOpen(false); setCategoryId(""); setCategoryModalOpen(false); setPrimaryFile(null); setGalleryFiles([]); setMediaImages([]); setRemovedImageIds([]); setPrimaryImageId(""); setError(""); setCategoryError(""); };
  const openCreate = () => { setEditing(null); clearForm(); setFormOpen(true); };
  const openEdit = (service: ManagedService) => { setEditing(service); setCreatedServiceId(null); setName(service.name); setDescription(service.description ?? ""); setPrice(fromRial(service.salePriceRial, currency)); setTaxPercent(String(service.taxRateBasisPoints / 100)); setUnitId(service.unit.id); setUnitCatalogOpen(false); setCategoryId(service.category?.id ?? ""); setCategoryModalOpen(false); setPrimaryFile(null); setGalleryFiles([]); setMediaImages(service.images ?? []); setRemovedImageIds([]); setPrimaryImageId(service.images?.find((image) => image.position === 0)?.id ?? ""); setError(""); setCategoryError(""); setFormOpen(true); };
  const selectCatalogUnit = async (unit: UnitCatalogItem) => {
    if (!unit.isVisible) {
      const current = await get<UnitCatalogData>("/products/units/settings");
      const visibleUnitIds = [...new Set([...current.units.filter((item) => item.isVisible).map((item) => item.id), unit.id])];
      await patch("/products/units/settings", { visibleUnitIds });
      await units.refetch();
    }
    setUnitId(unit.id);
    setUnitCatalogOpen(false);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (!unitId) throw new Error("واحد خدمت را انتخاب کنید.");
      const rate = Number(toAsciiDigits(taxPercent).replace(/[٫٬,\s]/g, (separator) => separator === "٫" ? "." : ""));
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error("نرخ مالیات باید بین صفر تا ۱۰۰ درصد باشد.");
      const values = { name: name.trim(), description: description.trim() || null, categoryId: categoryId || null, unitId, salePriceRial: toRial(price, currency), taxRateBasisPoints: Math.round(rate * 100) };
      let serviceId = editing?.id ?? createdServiceId;
      if (serviceId) await patch("/services/" + serviceId, values);
      else {
        const created = await post<{ id: string }>("/services", values);
        serviceId = created.id;
        setCreatedServiceId(created.id);
      }
      if (!serviceId) throw new Error("شناسهٔ خدمت دریافت نشد؛ فرم را دوباره ذخیره کنید.");
      for (const imageId of removedImageIds) {
        await del("/services/" + serviceId + "/images/" + imageId);
        setMediaImages((current) => current.filter((image) => image.id !== imageId).map((image, index) => ({ ...image, position: index })));
        setRemovedImageIds((current) => current.filter((id) => id !== imageId));
      }
      if (primaryImageId && !primaryFile && primaryImageId !== mediaImages.find((image) => image.position === 0)?.id) {
        await patch("/services/" + serviceId + "/images/" + primaryImageId + "/primary", {});
        setMediaImages((current) => [current.find((image) => image.id === primaryImageId)!, ...current.filter((image) => image.id !== primaryImageId)].map((image, index) => ({ ...image, position: index })));
      }
      if (primaryFile) {
        const file = primaryFile;
        const uploaded = await uploadCatalogImage("/services", serviceId, file, "PRIMARY");
        setMediaImages((current) => [...current.filter((image) => image.position !== 0), { ...uploaded, position: 0 }]);
        setPrimaryFile((current) => current?.id === file.id ? null : current);
        setPrimaryImageId(uploaded.id);
      }
      for (const queued of galleryFiles) {
        const uploaded = await uploadCatalogImage("/services", serviceId, queued, "GALLERY");
        setMediaImages((current) => [...current.filter((image) => image.id !== uploaded.id), uploaded].sort((a, b) => a.position - b.position));
        setGalleryFiles((current) => current.filter((image) => image.id !== queued.id));
      }
      setFormOpen(false); setCreatedServiceId(null); await invalidate();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const createCategory = async (event: FormEvent) => {
    event.preventDefault(); setCategoryBusy(true); setCategoryError("");
    try { const category = await post<{ id: string; name: string }>("/services/categories", { name: categoryName }); setCategoryId(category.id); setCategoryName(""); setCategoryModalOpen(false); await invalidate(); }
    catch (cause) { setCategoryError(messageOf(cause)); }
    finally { setCategoryBusy(false); }
  };
  const archive = async () => {
    if (!archiveTarget) return;
    setBusy(true); setError("");
    try { await patch("/services/" + archiveTarget.id, { isActive: false }); setArchiveTarget(null); await invalidate(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };

  return <PageHeader title="خدمات" subtitle="مدیریت خدمات، شرح، واحد و قیمت فروش">
    <div className="catalog-page-actions" aria-label="عملیات خدمات">
      <Link className="button button-secondary" to="/app/service-categories" title="دسته‌بندی خدمات" aria-label="دسته‌بندی خدمات"><Tags size={16} /><span className="catalog-action-label">دسته‌بندی خدمات</span></Link>
      <CatalogExcelActions kind="services" onImported={() => invalidate()} />
      <button className="button button-primary" type="button" onClick={openCreate} title="خدمت جدید" aria-label="خدمت جدید"><BriefcaseBusiness size={17} /><span className="catalog-action-label">خدمت جدید</span></button>
    </div>
    <div className="toolbar card"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جست‌وجوی نام یا شرح خدمت" aria-label="جست‌وجوی خدمات" /></div><span className="result-count">{faNumber(rows.length)} خدمت</span></div>
    {services.isError && <InlineError error={services.error} retry={() => void services.refetch()} />}
    {services.isPending ? <div className="card"><span className="muted">در حال بارگیری خدمات…</span></div> : <><div className="card table-card service-table-card"><div className="table-head service-table-head"><span>خدمت</span><span>دسته‌بندی</span><span>واحد</span><span>قیمت</span><span aria-hidden="true" /></div>{rows.map((service) => <div className="table-row service-table-row" key={service.id}>
      <Link className="table-name" to={"/app/services/" + service.id}><span className="product-avatar service-avatar"><BriefcaseBusiness size={17} /></span><span><strong>{service.name}</strong><small>{service.description || "شرحی ثبت نشده"}</small></span></Link><span className="service-category-cell">{service.category?.name ?? "بدون دسته‌بندی"}</span><span>{service.unit.labelFa}</span><strong>{money(service.salePriceRial, currency)}</strong><span className="entity-row-actions"><Link className="icon-button" to={"/app/sales?productId=" + encodeURIComponent(service.id)} title="ثبت فروش این خدمت" aria-label={"ثبت فروش خدمت " + service.name}><ShoppingCart size={16} /></Link><button type="button" className="icon-button" title="ویرایش" aria-label={"ویرایش " + service.name} onClick={() => openEdit(service)}><Pencil size={16} /></button><button type="button" className="icon-button" title="بایگانی" aria-label={"بایگانی " + service.name} onClick={() => setArchiveTarget(service)}><Archive size={16} /></button></span>
    </div>)}{!rows.length && <div className="empty-state"><span className="empty-icon"><BriefcaseBusiness size={22} /></span><strong>خدمتی ثبت نشده</strong><p>خدمات قابل فروش را جدا از کالاهای انبارشونده تعریف کنید.</p><button type="button" className="button button-secondary" onClick={openCreate}>افزودن خدمت</button></div>}</div><LoadMoreButton hasMore={Boolean(services.hasNextPage)} isLoading={services.isFetchingNextPage} onClick={() => void services.fetchNextPage()} /></>}
    <Modal open={formOpen} onClose={() => { setFormOpen(false); setCategoryModalOpen(false); setUnitCatalogOpen(false); setCreatedServiceId(null); }} title={editing || createdServiceId ? "ویرایش خدمت" : "تعریف خدمت جدید"} description="اطلاعات اختصاصی خدمت را ثبت کنید؛ خدمات در موجودی انبار شمارش نمی‌شوند." size="wide">
      <form className="service-editor" onSubmit={(event) => void save(event)}>
        <div className="service-editor-intro"><span className="product-avatar service-avatar"><BriefcaseBusiness size={20} /></span><span><strong>{editing ? "به‌روزرسانی اطلاعات خدمت" : "تعریف خدمت قابل فروش"}</strong><small>فقط اطلاعات مرتبط با ارائه و فروش خدمت نمایش داده می‌شود.</small></span></div>
        <div className="product-editor-grid"><Field label="نام خدمت" value={name} onChange={setName} required placeholder="مثلاً: نصب و راه‌اندازی" /><SelectField label="واحد ارائه" value={unitId} onChange={setUnitId} options={unitOptions} placeholder="انتخاب واحد" onBrowseAll={() => setUnitCatalogOpen(true)} browseAllLabel="فهرست کامل واحدها" /><SelectField label="دسته‌بندی خدمت" value={categoryId} onChange={setCategoryId} options={(categories.data ?? []).map((category) => ({ value: category.id, label: category.name }))} placeholder="بدون دسته‌بندی" onAdd={() => { setCategoryName(""); setCategoryError(""); setCategoryModalOpen(true); }} addLabel="ساخت دسته‌بندی" /><MoneyInput label={"قیمت فروش (" + (currency === "IRT" ? "تومان" : "ریال") + ")"} value={price} onChange={setPrice} currency={currency} required /><Field label="نرخ مالیات (درصد)" value={taxPercent} onChange={setTaxPercent} inputMode="decimal" placeholder="۰" /></div>
        <label className="field service-description-field"><span className="field-label">شرح خدمت <small>اختیاری</small></span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={4} placeholder="توضیح کوتاه برای استفاده در مدیریت و نمایش خدمت" /></label>
        <ProductMediaEditor entityId={editing?.id ?? createdServiceId ?? undefined} entityLabel="خدمت" images={mediaImages} primaryImageId={primaryImageId} onPrimaryImageIdChange={setPrimaryImageId} primaryFile={primaryFile} onPrimaryFileChange={setPrimaryFile} galleryFiles={galleryFiles} onGalleryFilesChange={setGalleryFiles} removedImageIds={removedImageIds} onRemovedImageIdsChange={setRemovedImageIds} />
        {error && <InlineError error={error} />}{units.isError && <InlineError error={units.error} retry={() => void units.refetch()} />}{categories.isError && <InlineError error={categories.error} retry={() => void categories.refetch()} />}
        <div className="modal-form-actions"><SubmitButton busy={busy}>{busy ? "در حال ذخیره…" : editing ? "ذخیرهٔ تغییرات" : "ثبت خدمت"}</SubmitButton></div>
      </form>
    </Modal>
    <Modal open={categoryModalOpen} onClose={() => setCategoryModalOpen(false)} title="دسته‌بندی خدمت تازه" description="پس از ثبت، این دسته در همین فرم انتخاب می‌شود."><form onSubmit={(event) => void createCategory(event)}><Field label="نام دسته‌بندی" value={categoryName} onChange={setCategoryName} required placeholder="مثلاً: خدمات نصب" />{categoryError && <InlineError error={categoryError} />}<div className="modal-form-actions"><SubmitButton busy={categoryBusy}>ثبت و انتخاب دسته</SubmitButton></div></form></Modal>
    <UnitCatalogModal open={unitCatalogOpen} businessId={unitBusinessId ?? "none"} selectedUnitId={unitId} onClose={() => setUnitCatalogOpen(false)} onSelect={(unit) => selectCatalogUnit(unit)} />
    <Modal open={!!archiveTarget} onClose={() => setArchiveTarget(null)} title="بایگانی خدمت" description="خدمت از انتخاب‌های جدید کنار گذاشته می‌شود؛ اطلاعات اسناد قبلی باقی می‌ماند."><p>«{archiveTarget?.name}» بایگانی شود؟</p>{error && <InlineError error={error} />}<div className="modal-form-actions"><button type="button" className="button button-danger" disabled={busy} onClick={() => void archive()}>{busy ? "در حال بایگانی…" : "تأیید بایگانی"}</button></div></Modal>
  </PageHeader>;
}

type SpreadsheetPreview = { total: number; ready: number; invalid: number; creates: number; updates: number; rows: Array<{ rowNumber: number; name: string; action: "create" | "update"; valid: boolean; errors: string[] }> };
type SpreadsheetImportResult = { total: number; imported: number; failed: number; results: Array<{ rowNumber: number; name: string; action: "create" | "update"; success: boolean; message: string }> };

function CatalogExcelActions({ kind, onImported }: { kind: "products" | "services"; onImported: () => void | Promise<unknown> }) {
  const noun = kind === "products" ? "کالا" : "خدمت";
  const endpoint = `/${kind}/excel`;
  const [menuOpen, setMenuOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SpreadsheetPreview | null>(null);
  const [result, setResult] = useState<SpreadsheetImportResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"template" | "export" | "preview" | "import" | "" >("");
  const fileInput = useRef<HTMLInputElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const chooseFile = () => { if (fileInput.current) { fileInput.current.value = ""; fileInput.current.click(); } };

  const download = async (path: string, filename: string, action: "template" | "export") => {
    setBusy(action); setError("");
    try {
      const blob = await downloadFile(path);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(messageOf(cause)); setPreviewOpen(true); }
    finally { setBusy(""); }
  };

  const selectFile = async (selected: File | null) => {
    setFile(selected); setPreview(null); setResult(null); setError("");
    if (!selected) return;
    setPreviewOpen(true); setBusy("preview");
    try { setPreview(await uploadFile<SpreadsheetPreview>(`${endpoint}/preview`, selected)); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(""); }
  };

  const importRows = async () => {
    if (!file || !preview?.ready) return;
    setBusy("import"); setError("");
    try {
      const imported = await uploadFile<SpreadsheetImportResult>(`${endpoint}/import`, file);
      setResult(imported);
      await onImported();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(""); }
  };

  const close = () => { if (busy === "import") return; setPreviewOpen(false); setFile(null); setPreview(null); setResult(null); setError(""); if (fileInput.current) fileInput.current.value = ""; };
  return <>
    <div className="catalog-excel-actions" ref={actionsRef}>
      <button ref={triggerRef} className="button button-secondary catalog-excel-trigger" type="button" disabled={!!busy} aria-label="عملیات اکسل" aria-expanded={menuOpen} aria-controls={`catalog-excel-menu-${kind}`} title="عملیات اکسل" onClick={() => setMenuOpen((open) => !open)}>
        <FileSpreadsheet size={16} /><span className="catalog-action-label">{busy ? "در حال آماده‌سازی…" : "عملیات اکسل"}</span><ChevronDown className="catalog-excel-chevron" size={14} aria-hidden="true" />
      </button>
      {menuOpen && <div className="catalog-excel-menu-list" id={`catalog-excel-menu-${kind}`}>
        <button type="button" disabled={!!busy} onClick={() => { setMenuOpen(false); void download(`${endpoint}/template`, `${kind}-template.xlsx`, "template"); }}><FileSpreadsheet size={16} />قالب اکسل</button>
        <button type="button" disabled={!!busy} onClick={() => { setMenuOpen(false); setPreviewOpen(true); chooseFile(); }}><Upload size={16} />ورود از اکسل</button>
        <button type="button" disabled={!!busy} onClick={() => { setMenuOpen(false); void download(`${endpoint}/export`, `${kind}.xlsx`, "export"); }}><Download size={16} />خروجی اکسل</button>
      </div>}
    </div>
    <input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(event) => void selectFile(event.currentTarget.files?.[0] ?? null)} />
    <Modal open={previewOpen} onClose={close} title={`ورود گروهی ${noun}`} description="فایل ابتدا بررسی می‌شود. ردیف‌های معتبر پس از تأیید ثبت می‌شوند و ردیف‌های خطادار در گزارش باقی می‌مانند." size="wide">
      {file && <div className="catalog-excel-file"><FileSpreadsheet size={18} /><span><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(0)} کیلوبایت</small></span><button className="button button-secondary" type="button" disabled={!!busy} onClick={chooseFile}>انتخاب فایل دیگر</button></div>}
      {!file && <div className="catalog-excel-empty"><FileSpreadsheet size={24} /><strong>فایل اکسل را انتخاب کنید</strong><p>فقط فایل xlsx تا ۵ مگابایت پذیرفته می‌شود؛ حداکثر ۵۰۰ ردیف در هر بار.</p><button type="button" className="button button-primary" onClick={chooseFile}><Upload size={16} />انتخاب فایل</button></div>}
      {busy === "preview" && <div className="catalog-excel-loading" role="status">در حال بررسی ستون‌ها، واحدها و داده‌های شعبه…</div>}
      {error && <InlineError error={error} />}
      {preview && !result && <>
        <div className="catalog-excel-summary"><span><strong>{faNumber(preview.ready)}</strong><small>ردیف آماده</small></span><span><strong>{faNumber(preview.creates)}</strong><small>مورد تازه</small></span><span><strong>{faNumber(preview.updates)}</strong><small>به‌روزرسانی</small></span><span className={preview.invalid ? "has-errors" : ""}><strong>{faNumber(preview.invalid)}</strong><small>ردیف خطادار</small></span></div>
        <div className="catalog-excel-preview-list" role="table" aria-label="پیش‌نمایش ورود اکسل">
          {preview.rows.map((row) => <div className={`catalog-excel-preview-row ${row.valid ? "is-valid" : "is-invalid"}`} role="row" key={row.rowNumber}><span className="catalog-excel-row-status">{row.valid ? <Check size={15} /> : <span aria-label="دارای خطا">!</span>}</span><span className="catalog-excel-row-main"><strong>{faNumber(row.rowNumber)} · {row.name}</strong><small>{row.action === "create" ? "ثبت مورد تازه" : "به‌روزرسانی رکورد"}{row.errors.length ? ` · ${row.errors.join("؛ ")}` : ""}</small></span></div>)}
        </div>
        <p className="catalog-excel-note">ردیف‌های خطادار وارد نمی‌شوند. تصاویر در این فایل منتقل نمی‌شوند و از گالری کالا یا خدمت مدیریت می‌شوند.</p>
        <div className="modal-form-actions"><button type="button" className="button button-primary" disabled={!!busy || preview.ready === 0} onClick={() => void importRows()}>{busy === "import" ? "در حال ثبت…" : `ثبت ${faNumber(preview.ready)} ردیف معتبر`}</button></div>
      </>}
      {result && <section className="catalog-excel-result" role="status"><strong>پردازش فایل تمام شد</strong><div><span>{faNumber(result.imported)} ردیف ثبت شد</span><span>{faNumber(result.failed)} ردیف نیاز به اصلاح دارد</span></div>{result.failed > 0 && <div className="catalog-excel-preview-list">{result.results.filter((row) => !row.success).map((row) => <div className="catalog-excel-preview-row is-invalid" key={row.rowNumber}><span className="catalog-excel-row-status">!</span><span className="catalog-excel-row-main"><strong>{faNumber(row.rowNumber)} · {row.name}</strong><small>{row.message}</small></span></div>)}</div>}</section>}
    </Modal>
  </>;
}

type CatalogCategory = { id: string; name: string; parentId: string | null; parentName: string | null; isActive: boolean; productCount?: number; serviceCount?: number };
export function CatalogCategoriesPage({ kind }: { kind: "products" | "services" }) {
  const invalidate = useInvalidate();
  const serviceMode = kind === "services";
  const endpoint = serviceMode ? "/services/categories" : "/products/categories";
  const [editing, setEditing] = useState<CatalogCategory | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const categories = useQuery({ queryKey: [serviceMode ? "service-categories-all" : "product-categories-all"], queryFn: () => get<CatalogCategory[]>(endpoint + "?includeArchived=true") });
  const rows = categories.data ?? [];
  const openCreate = () => { setEditing(null); setName(""); setError(""); setFormOpen(true); };
  const openEdit = (category: CatalogCategory) => { setEditing(category); setName(category.name); setError(""); setFormOpen(true); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (editing) await patch(endpoint + "/" + editing.id, { name: name.trim() });
      else await post(endpoint, { name: name.trim() });
      setFormOpen(false); await invalidate();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const toggleActive = async (category: CatalogCategory) => {
    setBusy(true); setError("");
    try { await patch(endpoint + "/" + category.id, { isActive: !category.isActive }); await invalidate(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const title = serviceMode ? "دسته‌بندی خدمات" : "دسته‌بندی کالاها";
  const countLabel = (category: CatalogCategory) => serviceMode ? category.serviceCount ?? 0 : category.productCount ?? 0;
  return <PageHeader title={title} subtitle={"ساختار دسته‌بندی مستقل برای " + (serviceMode ? "خدمات کسب‌وکار" : "کالاهای انبارشونده")} actions={<div className="catalog-page-actions"><Link className="button button-secondary" to={serviceMode ? "/app/services" : "/app/products"}>{serviceMode ? <BriefcaseBusiness size={16} /> : <Boxes size={16} />}بازگشت به {serviceMode ? "خدمات" : "کالاها"}</Link><button type="button" className="button button-primary" onClick={openCreate}><Plus size={17} />دستهٔ جدید</button></div>}>
    {categories.isError && <InlineError error={categories.error} retry={() => void categories.refetch()} />}
    {categories.isPending ? <div className="card"><span className="muted">در حال بارگیری دسته‌بندی‌ها…</span></div> : <section className="card catalog-category-panel"><div className="catalog-category-summary"><span className="icon-tile emerald"><Tags size={19} /></span><span><strong>{faNumber(rows.length)} دسته‌بندی</strong><small>دسته‌های فعال و بایگانی‌شده</small></span></div>{rows.length ? <div className="catalog-category-list">{rows.map((category) => <article className={"catalog-category-row" + (!category.isActive ? " is-archived" : "")} key={category.id}><span className="catalog-category-symbol"><Tags size={17} /></span><span className="catalog-category-main"><strong>{category.name}</strong><small>{category.parentName ? "زیرمجموعهٔ " + category.parentName : "دستهٔ اصلی"} · {faNumber(countLabel(category))} مورد</small></span><span className={"status-badge " + (category.isActive ? "active" : "archived")}>{category.isActive ? "فعال" : "بایگانی‌شده"}</span><span className="entity-row-actions"><button type="button" className="icon-button" title="ویرایش دسته" aria-label={"ویرایش " + category.name} onClick={() => openEdit(category)}><Pencil size={16} /></button><button type="button" className="button button-text category-state-button" disabled={busy} onClick={() => void toggleActive(category)}>{category.isActive ? "بایگانی" : "فعال‌سازی"}</button></span></article>)}</div> : <div className="empty-state"><span className="empty-icon"><Tags size={22} /></span><strong>دسته‌بندی‌ای ثبت نشده</strong><p>برای نظم بهتر، دسته‌های مرتبط با {serviceMode ? "خدمات" : "کالاها"} را بسازید.</p><button className="button button-secondary" type="button" onClick={openCreate}>ساخت اولین دسته</button></div>}{error && <InlineError error={error} />}</section>}
    <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? "ویرایش دسته‌بندی" : "دسته‌بندی تازه"} description="نام دسته‌بندی را مشخص کنید؛ ساختار دسته‌های قبلی حفظ می‌شود."><form onSubmit={(event) => void save(event)}><Field label="نام دسته‌بندی" value={name} onChange={setName} required />{error && <InlineError error={error} />}<div className="modal-form-actions"><SubmitButton busy={busy}>{editing ? "ذخیرهٔ تغییرات" : "ثبت دسته"}</SubmitButton></div></form></Modal>
  </PageHeader>;
}

function MoneyInput({ label, value, onChange, currency, hint, required = false }: { label: string; value: string; onChange: (value: string) => void; currency: MoneyCurrency; hint?: string; required?: boolean }) {
  const preview = value.trim() ? (() => { try { return money(toRial(value, currency), currency); } catch { return "مبلغ را کامل کنید"; } })() : "—";
  return <label className="field product-money-field">
    <span className="field-label">{label}{required && <i> *</i>}</span>
    <input type="text" inputMode={currency === "IRT" ? "decimal" : "numeric"} dir="ltr" value={formatMoneyDraft(value, currency)} onChange={(event) => onChange(normalizeMoneyDraft(event.target.value, currency))} placeholder="۰" required={required} />
    <span className="product-money-preview"><small>{hint ?? "پیش‌نمایش مبلغ"}</small><strong>{preview}</strong></span>
  </label>;
}

function ProductMediaEditor({ entityId, entityLabel, images, primaryImageId, onPrimaryImageIdChange, primaryFile, onPrimaryFileChange, galleryFiles, onGalleryFilesChange, removedImageIds, onRemovedImageIdsChange }: {
  entityId?: string;
  entityLabel: string;
  images: ProductImage[];
  primaryImageId: string;
  onPrimaryImageIdChange: (id: string) => void;
  primaryFile: QueuedProductImage | null;
  onPrimaryFileChange: (image: QueuedProductImage | null) => void;
  galleryFiles: QueuedProductImage[];
  onGalleryFilesChange: (images: QueuedProductImage[] | ((current: QueuedProductImage[]) => QueuedProductImage[])) => void;
  removedImageIds: string[];
  onRemovedImageIdsChange: (ids: string[] | ((current: string[]) => string[])) => void;
}) {
  const [storedUrls, setStoredUrls] = useState<Record<string, string>>({});
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({});
  const [imageError, setImageError] = useState("");
  const [loadingStoredImages, setLoadingStoredImages] = useState(false);
  const [imageLoadAttempt, setImageLoadAttempt] = useState(0);
  const visibleImages = images.filter((image) => !removedImageIds.includes(image.id));
  const preferredPrimary = visibleImages.find((image) => image.id === primaryImageId) ?? visibleImages.find((image) => image.position === 0);
  const galleryImages = visibleImages.filter((image) => image.id !== preferredPrimary?.id && !(primaryFile && image.position === 0));
  const primaryUrl = primaryFile ? localUrls[primaryFile.id] : preferredPrimary ? storedUrls[preferredPrimary.id] : undefined;
  const slotsLeft = Math.max(0, 8 - galleryImages.length - galleryFiles.length);

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    setStoredUrls({});
    setImageError("");
    if (!entityId || !images.length) { setLoadingStoredImages(false); return () => { active = false; }; }
    setLoadingStoredImages(true);
    void Promise.all(images.map(async (image) => {
      try {
        const blob = await downloadFile(image.path);
        const url = URL.createObjectURL(blob);
        if (!active) { URL.revokeObjectURL(url); return null; }
        urls.push(url);
        return [image.id, url] as const;
      } catch {
        return null;
      }
    })).then((entries) => {
      if (!active) return;
      const loaded = entries.filter((entry): entry is readonly [string, string] => entry !== null);
      setStoredUrls(Object.fromEntries(loaded));
      setLoadingStoredImages(false);
      if (loaded.length !== images.length) setImageError("بارگیری بعضی تصاویر کامل نشد. اتصال را بررسی و دوباره تلاش کنید.");
    });
    return () => { active = false; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [entityId, images, imageLoadAttempt]);

  useEffect(() => {
    const entries: Array<[string, string]> = [];
    if (primaryFile) entries.push([primaryFile.id, URL.createObjectURL(primaryFile.file)]);
    galleryFiles.forEach((image) => entries.push([image.id, URL.createObjectURL(image.file)]));
    setLocalUrls(Object.fromEntries(entries));
    return () => entries.forEach(([, url]) => URL.revokeObjectURL(url));
  }, [primaryFile, galleryFiles]);

  const acceptFile = (file: File) => {
    const allowedType = ["image/jpeg", "image/png", "image/webp"].includes(file.type) || /\.(?:jpe?g|png|webp)$/i.test(file.name);
    if (!allowedType) { setImageError("فقط تصویر JPEG، PNG یا WebP انتخاب کنید."); return false; }
    if (file.size > 10 * 1024 * 1024) { setImageError("حجم هر تصویر نباید بیشتر از ۱۰ مگابایت باشد."); return false; }
    return true;
  };
  const choosePrimary = (file?: File) => {
    setImageError("");
    if (!file) return;
    if (!acceptFile(file)) return;
    onPrimaryImageIdChange("");
    onPrimaryFileChange({ id: crypto.randomUUID(), file });
  };
  const chooseGallery = (files: FileList | null) => {
    setImageError("");
    if (!files?.length) return;
    const accepted = Array.from(files).filter(acceptFile);
    if (accepted.length > slotsLeft) setImageError("گالری هر " + entityLabel + " حداکثر ۸ تصویر دارد؛ ابتدا از تصاویر فعلی کم کنید.");
    onGalleryFilesChange((current) => [...current, ...accepted.slice(0, slotsLeft).map((file) => ({ id: crypto.randomUUID(), file }))]);
  };
  const removeExisting = (image: ProductImage) => {
    onRemovedImageIdsChange((current) => current.includes(image.id) ? current : [...current, image.id]);
    if (primaryImageId === image.id) onPrimaryImageIdChange("");
  };

  return <section className="product-form-section product-media-section"><div className="product-form-section-heading"><span>۵</span><div><h3>تصاویر {entityLabel}</h3><p>تصویر اصلی در کارت فروشگاه می‌آید؛ تصاویر دیگر در گالری همان {entityLabel} نمایش داده می‌شوند.</p></div></div>
    <div className="product-media-editor">
      <div className="product-primary-image"><div className="product-image-preview">{primaryUrl ? <img src={primaryUrl} alt="پیش‌نمایش تصویر اصلی" /> : preferredPrimary && loadingStoredImages ? <div className="product-image-loading" role="status">در حال بارگیری تصویر…</div> : <div className="product-image-placeholder"><ImagePlus size={25} /><span>{preferredPrimary ? "تصویر بارگیری نشد" : "تصویر اصلی انتخاب نشده"}</span></div>}<span className="product-image-role">تصویر اصلی</span></div><label className="button button-secondary product-image-pick"><ImagePlus size={16} />{primaryFile ? "تعویض تصویر اصلی" : preferredPrimary ? "تعویض تصویر اصلی" : "انتخاب تصویر اصلی"}<input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => { choosePrimary(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>{primaryFile && <button type="button" className="button button-text" onClick={() => onPrimaryFileChange(null)}>لغو تصویر تازه</button>}</div>
      <div className="product-gallery-editor"><div className="product-gallery-heading"><div><strong>گالری تصاویر</strong><small>{galleryImages.length + galleryFiles.length} از ۸ تصویر</small></div><label className={`button button-secondary product-image-pick ${slotsLeft === 0 ? "disabled" : ""}`}><ImagePlus size={16} />افزودن به گالری<input type="file" multiple disabled={slotsLeft === 0} accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => { chooseGallery(event.currentTarget.files); event.currentTarget.value = ""; }} /></label></div>
        <div className="product-gallery-grid">{galleryImages.map((image) => <article className="product-gallery-thumb" key={image.id}>{storedUrls[image.id] ? <img src={storedUrls[image.id]} alt={"تصویر گالری " + entityLabel} /> : <span className="product-image-placeholder">{loadingStoredImages ? "در حال بارگیری…" : <ImagePlus size={18} />}</span>}<div><button type="button" title="تعیین به‌عنوان تصویر اصلی" aria-label="تعیین تصویر اصلی" onClick={() => { onPrimaryFileChange(null); onPrimaryImageIdChange(image.id); }}><Star size={15} /><span>تصویر اصلی</span></button><button type="button" title="حذف تصویر" aria-label="حذف تصویر" onClick={() => removeExisting(image)}><Trash2 size={15} /><span>حذف</span></button></div></article>)}{galleryFiles.map((image) => <article className="product-gallery-thumb is-pending" key={image.id}>{localUrls[image.id] ? <img src={localUrls[image.id]} alt={image.file.name} /> : <span className="product-image-placeholder"><ImagePlus size={18} /></span>}<div><button type="button" title="استفاده به‌عنوان تصویر اصلی" aria-label="استفاده به‌عنوان تصویر اصلی" onClick={() => { onGalleryFilesChange((current) => current.filter((item) => item.id !== image.id)); onPrimaryFileChange(image); onPrimaryImageIdChange(""); }}><Star size={15} /><span>تصویر اصلی</span></button><button type="button" title="حذف تصویر انتخاب‌شده" aria-label="حذف تصویر انتخاب‌شده" onClick={() => onGalleryFilesChange((current) => current.filter((item) => item.id !== image.id))}><Trash2 size={15} /><span>حذف</span></button></div></article>)}{galleryImages.length + galleryFiles.length === 0 && <div className="product-gallery-empty"><ImagePlus size={20} /><span>پس از افزودن تصویر، پیش‌نمایش گالری اینجا دیده می‌شود.</span></div>}</div>
      </div>
    </div>
    {imageError && <div className="product-media-error" role="alert"><span>{imageError}</span><button className="button button-text" type="button" disabled={loadingStoredImages} onClick={() => setImageLoadAttempt((current) => current + 1)}>بارگیری دوباره</button></div>}
    {removedImageIds.length > 0 && <p className="product-media-hint">{removedImageIds.length} تصویر پس از ذخیره حذف می‌شود.</p>}
    {!entityId && <p className="product-media-hint">تصاویر تا زمان ثبت {entityLabel} موقتاً در این صفحه نگه داشته می‌شوند.</p>}
    <p className="product-media-hint">تصاویر بدون تغییر اندازه و با فشرده‌سازی WebP بدون افت کیفیت ذخیره می‌شوند؛ حداکثر حجم هر فایل ۱۰ مگابایت است.</p>
  </section>;
}

function UnitCatalogModal({ open, businessId, selectedUnitId, onClose, onSelect }: {
  open: boolean;
  businessId: string;
  selectedUnitId: string;
  onClose: () => void;
  onSelect: (unit: UnitCatalogItem) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [busyUnitId, setBusyUnitId] = useState("");
  const [error, setError] = useState("");
  const catalog = useQuery({ queryKey: ["product-unit-catalog", businessId], queryFn: () => get<UnitCatalogData>("/products/units/settings"), enabled: open, staleTime: 0 });
  useEffect(() => { if (!open) { setSearch(""); setError(""); setBusyUnitId(""); } }, [open]);

  const query = search.trim().toLocaleLowerCase("fa-IR");
  const groups = (catalog.data?.groups ?? []).map((group) => ({
    ...group,
    units: group.units.filter((unit) => !query || `${unit.labelFa} ${unit.code}`.toLocaleLowerCase("fa-IR").includes(query)),
  })).filter((group) => group.units.length > 0);
  const choose = async (unit: UnitCatalogItem) => {
    setBusyUnitId(unit.id); setError("");
    try { await onSelect(unit); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusyUnitId(""); }
  };

  return <Modal open={open} onClose={onClose} title="فهرست کامل واحدها" description="از میان همهٔ واحدهای کسب‌وکار انتخاب کنید. واحد پنهان با انتخاب، به فهرست واحدهای فرم هم اضافه می‌شود." size="wide">
    <label className="product-unit-catalog-search"><Search size={17} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جست‌وجوی نام یا کد واحد" aria-label="جست‌وجوی واحدها" /></label>
    {catalog.isError && <InlineError error={catalog.error} retry={() => void catalog.refetch()} />}
    {catalog.isPending ? <div className="product-unit-catalog-state">در حال بارگیری واحدها…</div> : <div className="product-unit-groups">
      {groups.map((group) => <section className="product-unit-group" key={group.key}><header><strong>{group.labelFa}</strong><span>{faNumber(group.units.length)} واحد</span></header><div className="product-unit-options" role="listbox" aria-label={group.labelFa}>{group.units.map((unit) => <button type="button" role="option" aria-selected={unit.id === selectedUnitId} className={`product-unit-option ${unit.id === selectedUnitId ? "selected" : ""} ${unit.isVisible ? "is-visible" : "is-hidden"}`} key={unit.id} disabled={Boolean(busyUnitId)} onClick={() => void choose(unit)}><span><strong>{unit.labelFa}</strong><small>{unit.code} · {unit.precision === 0 ? "بدون اعشار" : `تا ${faNumber(unit.precision)} رقم اعشار`}</small></span><span className="product-unit-option-action">{busyUnitId === unit.id ? "در حال افزودن…" : unit.isVisible ? unit.id === selectedUnitId ? "انتخاب‌شده" : "انتخاب" : "افزودن و انتخاب"}{busyUnitId === unit.id ? null : unit.isVisible ? <Check size={16} /> : <Plus size={16} />}</span></button>)}</div></section>)}
      {!groups.length && <div className="product-unit-catalog-state">واحدی با این عبارت پیدا نشد.</div>}
    </div>}
    {error && <div className="form-error" role="alert">{error}</div>}
  </Modal>;
}

type BrowserBarcodeDetector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };
type BrowserBarcodeDetectorConstructor = { new(options?: { formats?: string[] }): BrowserBarcodeDetector; getSupportedFormats: () => Promise<string[]> };

function BarcodeScannerModal({ open, onClose, onDetected }: { open: boolean; onClose: () => void; onDetected: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCloseRef = useRef(onClose);
  const onDetectedRef = useRef(onDetected);
  const [scanStatus, setScanStatus] = useState("در حال آماده‌سازی اسکنر…");
  const [scanError, setScanError] = useState("");
  const [scanAttempt, setScanAttempt] = useState(0);
  onCloseRef.current = onClose;
  onDetectedRef.current = onDetected;
  const Detector = (window as Window & { BarcodeDetector?: BrowserBarcodeDetectorConstructor }).BarcodeDetector;
  const camera = useCameraSession(videoRef, open && Boolean(Detector));

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: number | undefined;
    setScanError("");
    if (!Detector) { setScanError("اسکن بارکد در این مرورگر پشتیبانی نمی‌شود. از Chrome یا Edge به‌روز استفاده کنید یا بارکد را دستی وارد کنید."); return; }
    if (!camera.ready || !camera.stream) return;
    const video = videoRef.current;
    if (!video) return;
    const startScan = async () => {
      try {
        const supported = await Detector.getSupportedFormats();
        const formats = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar", "pdf417", "data_matrix", "aztec"].filter((format) => supported.includes(format));
        if (!formats.length) { setScanError("قالب بارکد پشتیبانی‌شده‌ای در این مرورگر پیدا نشد."); return; }
        const detector = new Detector({ formats });
        setScanStatus("بارکد را داخل کادر قرار دهید؛ در صورت تاری فوکوس را تنظیم کنید.");
        const read = async () => {
          if (cancelled) return;
          if (video.readyState >= 2) {
            try {
              const detected = (await detector.detect(video)).find((item) => item.rawValue.trim());
              if (detected && !cancelled) { cancelled = true; onDetectedRef.current(detected.rawValue.trim()); onCloseRef.current(); return; }
            } catch {
              if (!cancelled) setScanError("خواندن این تصویر انجام نشد. فوکوس یا نور را تنظیم کنید و دوباره اسکن کنید.");
              return;
            }
          }
          if (!cancelled) timer = window.setTimeout(() => void read(), 180);
        };
        void read();
      } catch { if (!cancelled) setScanError("قالب‌های بارکد از دوربین دریافت نشدند. دوباره اسکن کنید."); }
    };
    void startScan();
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [open, Detector, camera.ready, camera.stream, scanAttempt]);

  return <Modal open={open} onClose={() => onCloseRef.current()} title="اسکن بارکد با دوربین" description="دوربین را روبه‌روی بارکد نگه دارید تا کد خوانده و در فیلد ثبت شود.">
    <div className="barcode-scanner-content">{camera.error && <div className="barcode-scan-error" role="alert">{camera.error}</div>}{scanError && <div className="barcode-scan-error" role="alert">{scanError}</div>}{!camera.error && Detector && <><div className="barcode-camera-frame"><video ref={videoRef} autoPlay muted playsInline aria-label="پیش‌نمایش دوربین برای اسکن بارکد" /><span aria-hidden="true" /></div>{camera.ready && <CameraControls camera={camera} />}<p className="barcode-scan-status" role="status">{scanError ? "بارکد را دستی وارد کنید یا دوباره تلاش کنید." : camera.status || scanStatus}</p></>}{scanError && !camera.error && Detector && <button className="button button-secondary barcode-scan-retry" type="button" onClick={() => { setScanError(""); setScanAttempt((attempt) => attempt + 1); }}>تلاش دوباره برای اسکن</button>}</div>
  </Modal>;
}

async function uploadCatalogImage(endpoint: "/products" | "/services", itemId: string, image: QueuedProductImage, placement: "PRIMARY" | "GALLERY") {
  const body = new FormData();
  body.append("file", image.file);
  body.append("placement", placement);
  return adminApi<ProductImage>(endpoint + "/" + itemId + "/images", { method: "POST", body });
}

function normalizeMoneyDraft(value: string, currency: MoneyCurrency) {
  const ascii = value.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/[٬,\s]/g, "").replace(/٫/g, ".");
  if (currency === "IRR") return ascii.replace(/\D/g, "");
  const [whole = "", ...fractions] = ascii.split(".");
  const digits = whole.replace(/\D/g, "");
  return ascii.includes(".") ? `${digits}.${fractions.join("").replace(/\D/g, "").slice(0, 1)}` : digits;
}

function formatMoneyDraft(value: string, currency: MoneyCurrency) {
  if (!value) return "";
  const [whole = "", fraction] = value.split(".");
  const formattedWhole = whole ? new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(BigInt(whole)) : "";
  if (currency === "IRT" && fraction !== undefined) return `${formattedWhole}٫${fraction}`;
  return formattedWhole;
}

function toRial(value: string, currency: MoneyCurrency) {
  const normalized = value.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/[٬,\s]/g, "").trim();
  if (currency === "IRT") {
    const match = /^(\d+)(?:[.٫](\d))?$/.exec(normalized);
    if (!match) throw new Error("مبلغ تومان حداکثر یک رقم اعشار می‌پذیرد.");
    return (BigInt(match[1]) * 10n + BigInt(match[2] ?? "0")).toString();
  }
  if (!/^\d+$/.test(normalized)) throw new Error("مبلغ ریالی باید عدد صحیح باشد.");
  return BigInt(normalized).toString();
}

function fromRial(value: string, currency: MoneyCurrency) {
  if (currency === "IRR") return value;
  const amount = BigInt(value);
  const whole = amount / 10n;
  const fraction = amount % 10n;
  return fraction === 0n ? whole.toString() : whole.toString() + "." + fraction.toString();
}
