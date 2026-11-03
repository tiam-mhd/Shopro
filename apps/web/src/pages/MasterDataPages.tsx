import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Archive, Boxes, PackagePlus, Pencil, UsersRound } from "lucide-react";
import type { CursorPage } from "@shopro/contracts";
import { get, patch, post } from "../lib/api.js";
import { faNumber, money } from "../lib/format.js";
import { Field, InlineError, LoadMoreButton, PageHeader, SelectField, SubmitButton, messageOf, useInvalidate } from "../App.js";
import { Modal } from "../components/Modal.js";

type MoneyCurrency = "IRR" | "IRT";
type PartyType = "CUSTOMER" | "SUPPLIER" | "BOTH";
type Party = { id: string; name: string; type: PartyType; phone: string | null; email?: string | null; address?: string | null; balanceRial?: string };
type Product = { id: string; name: string; sku: string | null; barcode?: string | null; kind: "STOCK" | "SERVICE"; unit: { id: string; labelFa: string }; salePriceRial: string; defaultCostRial?: string | null; taxRateBasisPoints?: number; quantityOnHand: string; reorderPoint?: string | null; category?: { id: string; name: string } | null };

export function PartiesPage({ currency }: { currency: MoneyCurrency }) {
  const invalidate = useInvalidate();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("BOTH");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Party | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Party | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [formType, setFormType] = useState<PartyType>("CUSTOMER");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const parties = useInfiniteQuery({ queryKey: ["parties", type, query], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => get<CursorPage<Party>>(`/parties?limit=50&type=${type}&q=${encodeURIComponent(query)}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`), getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined });
  const partyRows = parties.data?.pages.flatMap((page) => page.items) ?? [];

  const openCreate = () => { setEditing(null); setName(""); setPhone(""); setEmail(""); setAddress(""); setFormType(type === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER"); setError(""); setFormOpen(true); };
  const openEdit = (party: Party) => { setEditing(party); setName(party.name); setPhone(party.phone ?? ""); setEmail(party.email ?? ""); setAddress(party.address ?? ""); setFormType(party.type); setError(""); setFormOpen(true); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const values = { name, phone: phone || null, email: email || null, address: address || null, type: formType };
      if (editing) await patch("/parties/" + editing.id, values);
      else await post("/parties", values);
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

  return <PageHeader title="طرف‌حساب‌ها" subtitle="اطلاعات و گردش مشتریان و تأمین‌کنندگان" actions={<button className="button button-primary" type="button" onClick={openCreate}><UsersRound size={17} />طرف‌حساب جدید</button>}>
    <div className="toolbar card"><div className="search-box"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جست‌وجوی نام یا شماره" aria-label="جست‌وجوی طرف‌حساب" /></div><SelectField label="نوع طرف‌حساب" value={type} onChange={setType} options={[{ value: "BOTH", label: "همه" }, { value: "CUSTOMER", label: "مشتریان" }, { value: "SUPPLIER", label: "تأمین‌کنندگان" }]} /></div>
    {parties.isError && <InlineError error={parties.error} retry={() => void parties.refetch()} />}
    {parties.isPending ? <div className="card"><span className="muted">در حال بارگیری طرف‌حساب‌ها…</span></div> : <><div className="party-grid">{partyRows.map((party) => <article className="card party-card" key={party.id}>
      <Link className="party-detail-link" to={"/app/parties/" + party.id}><span className="avatar">{party.name.slice(0, 1)}</span><span className="row-grow"><strong>{party.name}</strong><small>{party.phone || (party.type === "SUPPLIER" ? "تأمین‌کننده" : "مشتری")}</small></span></Link>
      <span className="party-balance">{party.balanceRial ? money(party.balanceRial, currency) : "گردش"}</span>
      <div className="entity-row-actions"><button type="button" className="icon-button" aria-label={"ویرایش " + party.name} title="ویرایش" onClick={() => openEdit(party)}><Pencil size={16} /></button><button type="button" className="icon-button" aria-label={"بایگانی " + party.name} title="بایگانی" onClick={() => setArchiveTarget(party)}><Archive size={16} /></button></div>
    </article>)}{!partyRows.length && <div className="card empty-state"><UsersRound size={22} /><strong>طرف‌حسابی پیدا نشد</strong><p>با افزودن مشتری یا تأمین‌کننده، اطلاعات تماس و گردش مالی را یکجا نگه دارید.</p><button type="button" className="button button-secondary" onClick={openCreate}>افزودن طرف‌حساب</button></div>}</div><LoadMoreButton hasMore={Boolean(parties.hasNextPage)} isLoading={parties.isFetchingNextPage} onClick={() => void parties.fetchNextPage()} /></>}
    <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? "ویرایش طرف‌حساب" : "طرف‌حساب جدید"} description="اطلاعات تماس در اسناد مالی این کسب‌وکار استفاده می‌شود.">
      <form onSubmit={(event) => void save(event)}><div className="form-grid"><Field label="نام" value={name} onChange={setName} required /><Field label="شمارهٔ همراه" value={phone} onChange={setPhone} inputMode="tel" dir="ltr" placeholder="اختیاری" /><Field label="ایمیل" value={email} onChange={setEmail} type="email" placeholder="اختیاری" /><Field label="نشانی" value={address} onChange={setAddress} placeholder="اختیاری" /><SelectField label="نوع" value={formType} onChange={(value) => setFormType(value as PartyType)} options={[{ value: "CUSTOMER", label: "مشتری" }, { value: "SUPPLIER", label: "تأمین‌کننده" }, { value: "BOTH", label: "مشتری و تأمین‌کننده" }]} /></div>{error && <InlineError error={error} />}<div className="modal-form-actions"><SubmitButton busy={busy}>{editing ? "ذخیرهٔ تغییرات" : "ذخیرهٔ طرف‌حساب"}</SubmitButton></div></form>
    </Modal>
    <Modal open={!!archiveTarget} onClose={() => setArchiveTarget(null)} title="بایگانی طرف‌حساب" description="طرف‌حساب از فهرست انتخاب‌ها کنار گذاشته می‌شود؛ اسناد و گردش مالی قبلی باقی می‌مانند.">
      <p>«{archiveTarget?.name}» بایگانی شود؟</p>{error && <InlineError error={error} />}<div className="modal-form-actions"><button type="button" className="button button-danger" disabled={busy} onClick={() => void archive()}>{busy ? "در حال بایگانی…" : "تأیید بایگانی"}</button></div>
    </Modal>
  </PageHeader>;
}

export function ProductsPage({ currency }: { currency: MoneyCurrency }) {
  const invalidate = useInvalidate();
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);
  const [showCategory, setShowCategory] = useState(false);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [reorder, setReorder] = useState("");
  const [taxPercent, setTaxPercent] = useState("0");
  const [unitId, setUnitId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [kind, setKind] = useState("STOCK");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const products = useInfiniteQuery({ queryKey: ["products", query], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => get<CursorPage<Product>>(`/products?limit=50&q=${encodeURIComponent(query)}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`), getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined });
  const productRows = products.data?.pages.flatMap((page) => page.items) ?? [];
  const unitBusinessId = sessionStorage.getItem("shopro_business_id");
  const units = useQuery({ queryKey: ["units", unitBusinessId], queryFn: () => get<Array<{ id: string; labelFa: string }>>("/products/units") });
  const categories = useQuery({ queryKey: ["product-categories"], queryFn: () => get<Array<{ id: string; name: string }>>("/products/categories") });
  const unitOptions = (units.data ?? []).map((unit) => ({ value: unit.id, label: unit.labelFa }));
  if (editing && !unitOptions.some((unit) => unit.value === editing.unit.id)) unitOptions.push({ value: editing.unit.id, label: `${editing.unit.labelFa} · واحد فعلی کالا` });

  useEffect(() => {
    setUnitId("");
  }, [unitBusinessId]);

  useEffect(() => {
    if (!editing && !unitId && units.data?.length === 1) setUnitId(units.data[0].id);
  }, [editing, unitId, units.data]);

  const clearForm = () => { setName(""); setSku(""); setBarcode(""); setPrice(""); setCost(""); setReorder(""); setTaxPercent("0"); setUnitId(""); setCategoryId(""); setCategoryName(""); setKind("STOCK"); setShowCategory(false); setError(""); };
  const openCreate = () => { setEditing(null); clearForm(); if (units.data?.length === 1) setUnitId(units.data[0].id); setFormOpen(true); };
  const openEdit = (product: Product) => { setEditing(product); setName(product.name); setSku(product.sku ?? ""); setBarcode(product.barcode ?? ""); setPrice(fromRial(product.salePriceRial, currency)); setCost(product.defaultCostRial ? fromRial(product.defaultCostRial, currency) : ""); setReorder(product.reorderPoint ?? ""); setTaxPercent(String((product.taxRateBasisPoints ?? 0) / 100)); setCategoryId(product.category?.id ?? ""); setUnitId(product.unit.id); setKind(product.kind); setShowCategory(false); setError(""); setFormOpen(true); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (!unitId) throw new Error("واحد کالا را انتخاب کنید.");
      const rate = Number(taxPercent);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error("نرخ مالیات باید بین صفر تا ۱۰۰ درصد باشد.");
      const salePriceRial = toRial(price, currency);
      const defaultCostRial = cost ? toRial(cost, currency) : null;
      if (editing) await patch("/products/" + editing.id, { name, sku: sku || null, barcode: barcode || null, unitId, categoryId: categoryId || null, salePriceRial, defaultCostRial, reorderPoint: reorder || null, taxRateBasisPoints: Math.round(rate * 100) });
      else await post("/products", { name, sku: sku || undefined, barcode: barcode || undefined, categoryId: categoryId || undefined, defaultCostRial: defaultCostRial || undefined, reorderPoint: reorder || undefined, taxRateBasisPoints: Math.round(rate * 100), kind, unitId: unitId || undefined, salePriceRial });
      setFormOpen(false); await invalidate();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const createCategory = async () => {
    setError("");
    try { const category = await post<{ id: string; name: string }>("/products/categories", { name: categoryName }); setCategoryId(category.id); setCategoryName(""); setShowCategory(false); await invalidate(); }
    catch (cause) { setError(messageOf(cause)); }
  };
  const archive = async () => {
    if (!archiveTarget) return;
    setBusy(true); setError("");
    try { await patch("/products/" + archiveTarget.id, { isActive: false }); setArchiveTarget(null); await invalidate(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };

  return <PageHeader title="کالا و خدمات" subtitle="تعریف، ویرایش و مرور اطلاعات کالاها و خدمات" actions={<button className="button button-primary" type="button" onClick={openCreate}><PackagePlus size={17} />کالا یا خدمت جدید</button>}>
    <div className="toolbar card"><div className="search-box"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="نام، کد کالا یا بارکد" aria-label="جست‌وجوی کالا یا خدمت" /></div><span className="result-count">{faNumber(productRows.length)} مورد نمایش</span></div>
    {products.isError && <InlineError error={products.error} retry={() => void products.refetch()} />}
    {products.isPending ? <div className="card"><span className="muted">در حال بارگیری کالاها…</span></div> : <><div className="card table-card"><div className="table-head product-table-head"><span>کالا یا خدمت</span><span>موجودی</span><span>قیمت فروش</span><span aria-hidden="true" /></div>{productRows.map((product) => <div className="table-row product-table-row" key={product.id}>
      <Link className="table-name" to={"/app/products/" + product.id}><span className="product-avatar"><Boxes size={17} /></span><span><strong>{product.name}</strong><small>{product.sku || product.barcode || product.category?.name || product.unit.labelFa}</small></span></Link><span className={Number(product.quantityOnHand) <= Number(product.reorderPoint ?? -1) ? "stock-warning" : ""}>{product.kind === "SERVICE" ? "—" : faNumber(product.quantityOnHand) + " " + product.unit.labelFa}</span><strong>{money(product.salePriceRial, currency)}</strong><span className="entity-row-actions"><button type="button" className="icon-button" title="ویرایش" aria-label={"ویرایش " + product.name} onClick={() => openEdit(product)}><Pencil size={16} /></button><button type="button" className="icon-button" title="بایگانی" aria-label={"بایگانی " + product.name} onClick={() => setArchiveTarget(product)}><Archive size={16} /></button></span>
    </div>)}{!productRows.length && <div className="empty-state"><Boxes size={22} /><strong>کالایی ثبت نشده</strong><p>کالاها و خدمات خود را اضافه کنید.</p><button type="button" className="button button-secondary" onClick={openCreate}>افزودن کالا یا خدمت</button></div>}</div><LoadMoreButton hasMore={Boolean(products.hasNextPage)} isLoading={products.isFetchingNextPage} onClick={() => void products.fetchNextPage()} /></>}
    <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? "ویرایش کالا یا خدمت" : "تعریف کالا یا خدمت"} description="اطلاعات قیمت و مشخصات کالا را ثبت کنید." size="wide">
      <form onSubmit={(event) => void save(event)}><div className="form-grid"><Field label="نام" value={name} onChange={setName} required /><Field label="کد کالا" value={sku} onChange={setSku} placeholder="اختیاری" /><Field label="بارکد" value={barcode} onChange={setBarcode} placeholder="اختیاری" dir="ltr" /><Field label={`قیمت فروش (${currency === "IRT" ? "تومان" : "ریال"})`} value={price} onChange={setPrice} inputMode="decimal" required /><Field label={`بهای خرید پیش‌فرض (${currency === "IRT" ? "تومان" : "ریال"})`} value={cost} onChange={setCost} inputMode="decimal" placeholder="اختیاری" /><Field label="حد هشدار موجودی" value={reorder} onChange={setReorder} inputMode="decimal" placeholder="اختیاری" />
        <SelectField label="دسته‌بندی" value={categoryId} onChange={setCategoryId} options={(categories.data ?? []).map((category) => ({ value: category.id, label: category.name }))} placeholder="بدون دسته" onAdd={() => setShowCategory(true)} /><SelectField label="واحد" value={unitId} onChange={setUnitId} options={unitOptions} />{!editing && <SelectField label="نوع" value={kind} onChange={setKind} options={[{ value: "STOCK", label: "کالای انبارشونده" }, { value: "SERVICE", label: "خدمت" }]} />}
        <Field label="نرخ مالیات (درصد)" value={taxPercent} onChange={setTaxPercent} inputMode="decimal" placeholder="۰" /></div>
        {editing && <div className="detail-grid"><div className="detail-field"><small>نوع</small><strong>{editing.kind === "SERVICE" ? "خدمت" : "کالای انبارشونده"}</strong></div></div>}
        {showCategory && <div className="category-quick-form"><Field label="نام دستهٔ تازه" value={categoryName} onChange={setCategoryName} required /><button className="button button-secondary" type="button" disabled={!categoryName.trim()} onClick={() => void createCategory()}>افزودن و انتخاب دسته</button></div>}
        {error && <InlineError error={error} />}{units.isError && <InlineError error={units.error} retry={() => void units.refetch()} />}{categories.isError && <InlineError error={categories.error} retry={() => void categories.refetch()} />}<div className="modal-form-actions"><SubmitButton busy={busy}>{editing ? "ذخیرهٔ تغییرات" : "ذخیرهٔ کالا"}</SubmitButton></div>
      </form>
    </Modal>
    <Modal open={!!archiveTarget} onClose={() => setArchiveTarget(null)} title="بایگانی کالا یا خدمت" description="این مورد از فهرست انتخاب‌های تازه کنار گذاشته می‌شود؛ اسناد و سوابق قبلی باقی می‌مانند.">
      <p>«{archiveTarget?.name}» بایگانی شود؟</p>{error && <InlineError error={error} />}<div className="modal-form-actions"><button type="button" className="button button-danger" disabled={busy} onClick={() => void archive()}>{busy ? "در حال بایگانی…" : "تأیید بایگانی"}</button></div>
    </Modal>
  </PageHeader>;
}

function toRial(value: string, currency: MoneyCurrency) {
  const normalized = value.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/[٬,\s]/g, "").trim();
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
