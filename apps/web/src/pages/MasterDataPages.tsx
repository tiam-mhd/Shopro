import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Archive, Boxes, Check, ImagePlus, PackagePlus, Pencil, Plus, ScanBarcode, Search, ShoppingCart, Star, Trash2, UsersRound } from "lucide-react";
import { toAsciiDigits, type CursorPage } from "@shopro/contracts";
import { adminApi, del, downloadFile, get, patch, post } from "../lib/api.js";
import { faNumber, money } from "../lib/format.js";
import { Field, InlineError, LoadMoreButton, PageHeader, SelectField, SubmitButton, messageOf, useInvalidate } from "../App.js";
import { Modal } from "../components/Modal.js";

type MoneyCurrency = "IRR" | "IRT";
type PartyType = "CUSTOMER" | "SUPPLIER" | "BOTH";
type Party = { id: string; name: string; type: PartyType; phone: string | null; email?: string | null; address?: string | null; balanceRial?: string };
type ProductImage = { id: string; position: number; path: string };
type QueuedProductImage = { id: string; file: File };
type Product = { id: string; name: string; sku: string | null; barcode?: string | null; kind: "STOCK" | "SERVICE"; unit: { id: string; labelFa: string; precision?: number }; salePriceRial: string; defaultCostRial?: string | null; taxRateBasisPoints?: number; quantityOnHand: string; reorderPoint?: string | null; category?: { id: string; name: string } | null; images?: ProductImage[] };
type UnitCatalogItem = { id: string; code: string; labelFa: string; precision: number; isVisible: boolean };
type UnitCatalogData = { units: UnitCatalogItem[]; groups: Array<{ key: string; labelFa: string; units: UnitCatalogItem[] }>; visibleCount: number };

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
      <div className="entity-row-actions">{(party.type === "CUSTOMER" || party.type === "BOTH") && <Link className="icon-button" to={`/app/sales?customerId=${encodeURIComponent(party.id)}`} aria-label={`ثبت فروش برای مشتری ${party.name}`} title="ثبت فروش برای این مشتری"><ShoppingCart size={16} /></Link>}<button type="button" className="icon-button" aria-label={"ویرایش " + party.name} title="ویرایش" onClick={() => openEdit(party)}><Pencil size={16} /></button><button type="button" className="icon-button" aria-label={"بایگانی " + party.name} title="بایگانی" onClick={() => setArchiveTarget(party)}><Archive size={16} /></button></div>
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
  const [kind, setKind] = useState<"STOCK" | "SERVICE">("STOCK");
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

  const clearForm = () => { setCreatedProductId(null); setName(""); setSku(""); setBarcode(""); setPrice(""); setCost(""); setInitialQuantity("0"); setCurrentQuantity(""); setQuantityBaseline(""); setReorder(""); setTaxPercent("0"); setUnitId(""); setUnitCatalogOpen(false); setBarcodeScannerOpen(false); setCategoryId(""); setCategoryName(""); setKind("STOCK"); setCategoryModalOpen(false); setPrimaryFile(null); setGalleryFiles([]); setMediaImages([]); setRemovedImageIds([]); setPrimaryImageId(""); setError(""); setCategoryError(""); };
  const openCreate = () => { setEditing(null); clearForm(); if (units.data?.length === 1) setUnitId(units.data[0].id); setFormOpen(true); };
  const openEdit = (product: Product) => { setEditing(product); setCreatedProductId(null); setName(product.name); setSku(product.sku ?? ""); setBarcode(product.barcode ?? ""); setPrice(fromRial(product.salePriceRial, currency)); setCost(product.defaultCostRial ? fromRial(product.defaultCostRial, currency) : ""); setInitialQuantity("0"); setCurrentQuantity(product.quantityOnHand); setQuantityBaseline(product.quantityOnHand); setReorder(product.reorderPoint ?? ""); setTaxPercent(String((product.taxRateBasisPoints ?? 0) / 100)); setCategoryId(product.category?.id ?? ""); setUnitId(product.unit.id); setUnitCatalogOpen(false); setBarcodeScannerOpen(false); setKind(product.kind); setCategoryModalOpen(false); setPrimaryFile(null); setGalleryFiles([]); setMediaImages(product.images ?? []); setRemovedImageIds([]); setPrimaryImageId(product.images?.find((image) => image.position === 0)?.id ?? ""); setError(""); setCategoryError(""); setFormOpen(true); };
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
        const created = await post<{ id: string }>("/products", { name, sku: sku || undefined, barcode: barcode || undefined, categoryId: categoryId || undefined, defaultCostRial: defaultCostRial || undefined, reorderPoint: reorder || undefined, taxRateBasisPoints: Math.round(rate * 100), kind, unitId: unitId || undefined, salePriceRial, ...(kind === "STOCK" ? { initialQuantity: initialQuantity || "0" } : {}) });
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
        const uploaded = await uploadProductImage(productId, file, "PRIMARY");
        setMediaImages((current) => [...current.filter((image) => image.position !== 0), { ...uploaded, position: 0 }]);
        setPrimaryFile((current) => current?.id === file.id ? null : current);
        setPrimaryImageId(uploaded.id);
      }
      for (const queued of galleryFiles) {
        const uploaded = await uploadProductImage(productId, queued, "GALLERY");
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

  return <PageHeader title="کالا و خدمات" subtitle="تعریف، ویرایش و مرور اطلاعات کالاها و خدمات" actions={<button className="button button-primary" type="button" onClick={openCreate}><PackagePlus size={17} />کالا یا خدمت جدید</button>}>
    <div className="toolbar card"><div className="search-box"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="نام، کد کالا یا بارکد" aria-label="جست‌وجوی کالا یا خدمت" /></div><span className="result-count">{faNumber(productRows.length)} مورد نمایش</span></div>
    {products.isError && <InlineError error={products.error} retry={() => void products.refetch()} />}
    {products.isPending ? <div className="card"><span className="muted">در حال بارگیری کالاها…</span></div> : <><div className="card table-card"><div className="table-head product-table-head"><span>کالا یا خدمت</span><span>موجودی</span><span>قیمت فروش</span><span aria-hidden="true" /></div>{productRows.map((product) => <div className="table-row product-table-row" key={product.id}>
      <Link className="table-name" to={"/app/products/" + product.id}><span className="product-avatar"><Boxes size={17} /></span><span><strong>{product.name}</strong><small>{product.sku || product.barcode || product.category?.name || product.unit.labelFa}</small></span></Link><span className={Number(product.quantityOnHand) <= Number(product.reorderPoint ?? -1) ? "stock-warning" : ""}>{product.kind === "SERVICE" ? "—" : faNumber(product.quantityOnHand) + " " + product.unit.labelFa}</span><strong>{money(product.salePriceRial, currency)}</strong><span className="entity-row-actions"><Link className="icon-button" to={`/app/sales?productId=${encodeURIComponent(product.id)}`} title="ثبت فروش برای این کالا" aria-label={`ثبت فروش برای ${product.name}`}><ShoppingCart size={16} /></Link><button type="button" className="icon-button" title="ویرایش" aria-label={"ویرایش " + product.name} onClick={() => openEdit(product)}><Pencil size={16} /></button><button type="button" className="icon-button" title="بایگانی" aria-label={"بایگانی " + product.name} onClick={() => setArchiveTarget(product)}><Archive size={16} /></button></span>
    </div>)}{!productRows.length && <div className="empty-state"><Boxes size={22} /><strong>کالایی ثبت نشده</strong><p>کالاها و خدمات خود را اضافه کنید.</p><button type="button" className="button button-secondary" onClick={openCreate}>افزودن کالا یا خدمت</button></div>}</div><LoadMoreButton hasMore={Boolean(products.hasNextPage)} isLoading={products.isFetchingNextPage} onClick={() => void products.fetchNextPage()} /></>}
    <Modal open={formOpen} onClose={() => { setFormOpen(false); setCategoryModalOpen(false); setUnitCatalogOpen(false); setBarcodeScannerOpen(false); }} title={editing || createdProductId ? "ویرایش کالا یا خدمت" : "تعریف کالا یا خدمت"} description="مشخصات را به‌ترتیب ثبت کنید؛ فیلدهای لازم در هر بخش مشخص شده‌اند." size="wide">
      <form className="product-editor" onSubmit={(event) => void save(event)}>
        <section className="product-form-section product-kind-section"><div className="product-form-section-heading"><span>۱</span><div><h3>نوع مورد جدید</h3><p>نوع را ابتدا انتخاب کنید تا فرم متناسب با آن نمایش داده شود.</p></div></div>{editing || createdProductId ? <div className="product-kind-readonly">{kind === "SERVICE" ? "خدمت" : "کالای انبارشونده"}</div> : <div className="product-kind-options"><label className={kind === "STOCK" ? "selected" : ""}><input type="radio" name="product-kind" value="STOCK" checked={kind === "STOCK"} onChange={() => setKind("STOCK")} /><span><Boxes size={20} /><strong>کالای انبارشونده</strong><small>قابل شمارش و پیگیری در موجودی شعبه</small></span></label><label className={kind === "SERVICE" ? "selected" : ""}><input type="radio" name="product-kind" value="SERVICE" checked={kind === "SERVICE"} onChange={() => setKind("SERVICE")} /><span><PackagePlus size={20} /><strong>خدمت</strong><small>بدون مقدار موجودی انبار</small></span></label></div>}</section>
        <section className="product-form-section"><div className="product-form-section-heading"><span>۲</span><div><h3>مشخصات</h3><p>نامی روشن انتخاب کنید تا در اسناد و فروشگاه قابل تشخیص باشد.</p></div></div><div className="product-editor-grid"><Field label="نام کالا یا خدمت" value={name} onChange={setName} required placeholder="مثلاً: دفتر ۱۰۰ برگ" /><Field label="کد کالا" value={sku} onChange={setSku} placeholder="اختیاری" /><label className="field product-barcode-field"><span className="field-label">بارکد</span><span className="product-barcode-control"><input value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="اختیاری" dir="ltr" autoComplete="off" maxLength={120} /><button className="product-barcode-scan" type="button" title="اسکن بارکد با دوربین" aria-label="اسکن بارکد با دوربین" disabled={busy} onClick={() => setBarcodeScannerOpen(true)}><ScanBarcode size={17} /></button></span></label><SelectField label="واحد" value={unitId} onChange={setUnitId} options={unitOptions} onBrowseAll={() => setUnitCatalogOpen(true)} browseAllLabel="فهرست کامل واحدها" /><SelectField label="دسته‌بندی" value={categoryId} onChange={setCategoryId} options={(categories.data ?? []).map((category) => ({ value: category.id, label: category.name }))} placeholder="بدون دسته‌بندی" onAdd={() => { setCategoryName(""); setCategoryError(""); setCategoryModalOpen(true); }} addLabel="ساخت دسته‌بندی" /></div></section>
        <section className="product-form-section"><div className="product-form-section-heading"><span>۳</span><div><h3>قیمت‌گذاری</h3><p>قیمت‌ها هنگام تایپ جدا می‌شوند و مبلغ نهایی همین‌جا دیده می‌شود.</p></div></div><div className="product-editor-grid"><MoneyInput label={`قیمت فروش (${currency === "IRT" ? "تومان" : "ریال"})`} value={price} onChange={setPrice} currency={currency} required /><MoneyInput label={`بهای خرید پیش‌فرض (${currency === "IRT" ? "تومان" : "ریال"})`} value={cost} onChange={setCost} currency={currency} hint="برای ارزش‌گذاری موجودی اولیه استفاده می‌شود." /><Field label="نرخ مالیات (درصد)" value={taxPercent} onChange={setTaxPercent} inputMode="decimal" placeholder="۰" /></div></section>
        {kind === "STOCK" && <section className="product-form-section"><div className="product-form-section-heading"><span>۴</span><div><h3>موجودی شعبه</h3><p>مقدار فعلی را وارد کنید؛ ثبت آن در گردش موجودی شعبه هم ثبت می‌شود.</p></div></div><div className="product-editor-grid"><Field label={editing || createdProductId ? "مقدار فعلی در انبار" : "مقدار فعلی اولیه در انبار"} value={editing || createdProductId ? currentQuantity : initialQuantity} onChange={editing || createdProductId ? setCurrentQuantity : setInitialQuantity} inputMode="decimal" required placeholder="۰" /><Field label="حد هشدار موجودی" value={reorder} onChange={setReorder} inputMode="decimal" placeholder="اختیاری" /><p className="product-stock-note">{editing || createdProductId ? "تغییر موجودی با سند شمارش و گردش حسابداری ثبت می‌شود." : cost ? "ارزش اولیه از مقدار × بهای خرید پیش‌فرض محاسبه می‌شود." : "اگر مقدار اولیه دارید، بهای خرید پیش‌فرض را هم برای ثبت ارزش موجودی وارد کنید."}</p></div></section>}
        <ProductMediaEditor productId={editing?.id ?? createdProductId ?? undefined} images={mediaImages} primaryImageId={primaryImageId} onPrimaryImageIdChange={setPrimaryImageId} primaryFile={primaryFile} onPrimaryFileChange={setPrimaryFile} galleryFiles={galleryFiles} onGalleryFilesChange={setGalleryFiles} removedImageIds={removedImageIds} onRemovedImageIdsChange={setRemovedImageIds} />
        {error && <InlineError error={error} />}{units.isError && <InlineError error={units.error} retry={() => void units.refetch()} />}{categories.isError && <InlineError error={categories.error} retry={() => void categories.refetch()} />}<div className="modal-form-actions"><SubmitButton busy={busy}>{busy ? "در حال ذخیره…" : editing || createdProductId ? "ذخیرهٔ تغییرات" : "ثبت کالا یا خدمت"}</SubmitButton></div>
      </form>
    </Modal>
    <UnitCatalogModal open={unitCatalogOpen} businessId={unitBusinessId ?? "none"} selectedUnitId={unitId} onClose={() => setUnitCatalogOpen(false)} onSelect={(unit) => selectCatalogUnit(unit)} />
    <BarcodeScannerModal open={barcodeScannerOpen} onClose={() => setBarcodeScannerOpen(false)} onDetected={setBarcode} />
    <Modal open={categoryModalOpen} onClose={() => setCategoryModalOpen(false)} title="دسته‌بندی تازه" description="پس از ثبت، این دسته‌بندی در فرم کالا انتخاب می‌شود.">
      <form className="product-category-form" onSubmit={(event) => void createCategory(event)}><Field label="نام دسته‌بندی" value={categoryName} onChange={setCategoryName} required placeholder="مثلاً: لوازم تحریر" />{categoryError && <p className="form-error" role="alert">{categoryError}</p>}<div className="modal-form-actions"><SubmitButton busy={categoryBusy}>ثبت و انتخاب دسته</SubmitButton></div></form>
    </Modal>
    <Modal open={!!archiveTarget} onClose={() => setArchiveTarget(null)} title="بایگانی کالا یا خدمت" description="این مورد از فهرست انتخاب‌های تازه کنار گذاشته می‌شود؛ اسناد و سوابق قبلی باقی می‌مانند.">
      <p>«{archiveTarget?.name}» بایگانی شود؟</p>{error && <InlineError error={error} />}<div className="modal-form-actions"><button type="button" className="button button-danger" disabled={busy} onClick={() => void archive()}>{busy ? "در حال بایگانی…" : "تأیید بایگانی"}</button></div>
    </Modal>
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

function ProductMediaEditor({ productId, images, primaryImageId, onPrimaryImageIdChange, primaryFile, onPrimaryFileChange, galleryFiles, onGalleryFilesChange, removedImageIds, onRemovedImageIdsChange }: {
  productId?: string;
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
    if (!productId || !images.length) { setLoadingStoredImages(false); return () => { active = false; }; }
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
  }, [productId, images, imageLoadAttempt]);

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
    if (accepted.length > slotsLeft) setImageError("گالری هر کالا حداکثر ۸ تصویر دارد؛ ابتدا از تصاویر فعلی کم کنید.");
    onGalleryFilesChange((current) => [...current, ...accepted.slice(0, slotsLeft).map((file) => ({ id: crypto.randomUUID(), file }))]);
  };
  const removeExisting = (image: ProductImage) => {
    onRemovedImageIdsChange((current) => current.includes(image.id) ? current : [...current, image.id]);
    if (primaryImageId === image.id) onPrimaryImageIdChange("");
  };

  return <section className="product-form-section product-media-section"><div className="product-form-section-heading"><span>۵</span><div><h3>تصاویر کالا یا خدمت</h3><p>تصویر اصلی در کارت فروشگاه می‌آید؛ تصاویر دیگر در گالری همان کالا نمایش داده می‌شوند.</p></div></div>
    <div className="product-media-editor">
      <div className="product-primary-image"><div className="product-image-preview">{primaryUrl ? <img src={primaryUrl} alt="پیش‌نمایش تصویر اصلی" /> : preferredPrimary && loadingStoredImages ? <div className="product-image-loading" role="status">در حال بارگیری تصویر…</div> : <div className="product-image-placeholder"><ImagePlus size={25} /><span>{preferredPrimary ? "تصویر بارگیری نشد" : "تصویر اصلی انتخاب نشده"}</span></div>}<span className="product-image-role">تصویر اصلی</span></div><label className="button button-secondary product-image-pick"><ImagePlus size={16} />{primaryFile ? "تعویض تصویر اصلی" : preferredPrimary ? "تعویض تصویر اصلی" : "انتخاب تصویر اصلی"}<input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => { choosePrimary(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>{primaryFile && <button type="button" className="button button-text" onClick={() => onPrimaryFileChange(null)}>لغو تصویر تازه</button>}</div>
      <div className="product-gallery-editor"><div className="product-gallery-heading"><div><strong>گالری تصاویر</strong><small>{galleryImages.length + galleryFiles.length} از ۸ تصویر</small></div><label className={`button button-secondary product-image-pick ${slotsLeft === 0 ? "disabled" : ""}`}><ImagePlus size={16} />افزودن به گالری<input type="file" multiple disabled={slotsLeft === 0} accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => { chooseGallery(event.currentTarget.files); event.currentTarget.value = ""; }} /></label></div>
        <div className="product-gallery-grid">{galleryImages.map((image) => <article className="product-gallery-thumb" key={image.id}>{storedUrls[image.id] ? <img src={storedUrls[image.id]} alt="تصویر گالری کالا" /> : <span className="product-image-placeholder">{loadingStoredImages ? "در حال بارگیری…" : <ImagePlus size={18} />}</span>}<div><button type="button" title="تعیین به‌عنوان تصویر اصلی" aria-label="تعیین تصویر اصلی" onClick={() => { onPrimaryFileChange(null); onPrimaryImageIdChange(image.id); }}><Star size={15} /><span>تصویر اصلی</span></button><button type="button" title="حذف تصویر" aria-label="حذف تصویر" onClick={() => removeExisting(image)}><Trash2 size={15} /><span>حذف</span></button></div></article>)}{galleryFiles.map((image) => <article className="product-gallery-thumb is-pending" key={image.id}>{localUrls[image.id] ? <img src={localUrls[image.id]} alt={image.file.name} /> : <span className="product-image-placeholder"><ImagePlus size={18} /></span>}<div><button type="button" title="استفاده به‌عنوان تصویر اصلی" aria-label="استفاده به‌عنوان تصویر اصلی" onClick={() => { onGalleryFilesChange((current) => current.filter((item) => item.id !== image.id)); onPrimaryFileChange(image); onPrimaryImageIdChange(""); }}><Star size={15} /><span>تصویر اصلی</span></button><button type="button" title="حذف تصویر انتخاب‌شده" aria-label="حذف تصویر انتخاب‌شده" onClick={() => onGalleryFilesChange((current) => current.filter((item) => item.id !== image.id))}><Trash2 size={15} /><span>حذف</span></button></div></article>)}{galleryImages.length + galleryFiles.length === 0 && <div className="product-gallery-empty"><ImagePlus size={20} /><span>پس از افزودن تصویر، پیش‌نمایش گالری اینجا دیده می‌شود.</span></div>}</div>
      </div>
    </div>
    {imageError && <div className="product-media-error" role="alert"><span>{imageError}</span><button className="button button-text" type="button" disabled={loadingStoredImages} onClick={() => setImageLoadAttempt((current) => current + 1)}>بارگیری دوباره</button></div>}
    {removedImageIds.length > 0 && <p className="product-media-hint">{removedImageIds.length} تصویر پس از ذخیره حذف می‌شود.</p>}
    {!productId && <p className="product-media-hint">تصاویر تا زمان ثبت کالا موقتاً در این صفحه نگه داشته می‌شوند.</p>}
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
  const [status, setStatus] = useState("در حال آماده‌سازی دوربین…");
  const [error, setError] = useState("");
  onCloseRef.current = onClose;
  onDetectedRef.current = onDetected;

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let detector: BrowserBarcodeDetector | undefined;
    setError("");
    setStatus("در حال آماده‌سازی دوربین…");

    const start = async () => {
      const Detector = (window as Window & { BarcodeDetector?: BrowserBarcodeDetectorConstructor }).BarcodeDetector;
      if (!Detector) { setError("اسکن بارکد در این مرورگر پشتیبانی نمی‌شود. از Chrome یا Edge به‌روز استفاده کنید یا بارکد را دستی وارد کنید."); return; }
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setError("برای استفاده از دوربین، صفحه باید در اتصال امن باز شده باشد."); return; }
      try {
        const supported = await Detector.getSupportedFormats();
        const formats = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar", "pdf417", "data_matrix", "aztec"].filter((format) => supported.includes(format));
        if (!formats.length) { setError("قالب بارکد پشتیبانی‌شده‌ای در این مرورگر پیدا نشد."); return; }
        detector = new Detector({ formats });
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } });
        if (stopped) { stream.getTracks().forEach((track) => track.stop()); return; }
        const video = videoRef.current;
        if (!video) throw new Error("پیش‌نمایش دوربین آماده نشد.");
        video.srcObject = stream;
        await video.play();
        setStatus("بارکد را داخل کادر دوربین قرار دهید.");
        const scan = async () => {
          if (stopped || !video || !detector) return;
          if (video.readyState >= 2) {
            try {
              const detected = (await detector.detect(video)).find((item) => item.rawValue.trim());
              if (detected && !stopped) { stopped = true; onDetectedRef.current(detected.rawValue.trim()); onCloseRef.current(); return; }
            } catch {
              if (stopped) return;
              stopped = true;
              stream?.getTracks().forEach((track) => track.stop());
              video.srcObject = null;
              setError("خواندن تصویر دوربین انجام نشد. دوربین را ثابت نگه دارید و دوباره تلاش کنید.");
              return;
            }
          }
          if (!stopped) timer = window.setTimeout(() => void scan(), 180);
        };
        void scan();
      } catch (cause) {
        if (stopped) return;
        const name = cause instanceof DOMException ? cause.name : "";
        setError(name === "NotAllowedError" ? "اجازهٔ دسترسی به دوربین داده نشد. مجوز دوربین را در مرورگر فعال کنید." : name === "NotFoundError" ? "دوربینی روی این دستگاه پیدا نشد." : "دوربین باز نشد. مجوز دسترسی و اتصال امن صفحه را بررسی کنید.");
      }
    };
    void start();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [open]);

  return <Modal open={open} onClose={() => onCloseRef.current()} title="اسکن بارکد با دوربین" description="دوربین را روبه‌روی بارکد نگه دارید تا کد خوانده و در فیلد ثبت شود.">
    {error ? <div className="barcode-scan-error" role="alert">{error}</div> : <><div className="barcode-camera-frame"><video ref={videoRef} autoPlay muted playsInline aria-label="پیش‌نمایش دوربین برای اسکن بارکد" /><span aria-hidden="true" /></div><p className="barcode-scan-status" role="status">{status}</p></>}
  </Modal>;
}

async function uploadProductImage(productId: string, image: QueuedProductImage, placement: "PRIMARY" | "GALLERY") {
  const body = new FormData();
  body.append("file", image.file);
  body.append("placement", placement);
  return adminApi<ProductImage>(`/products/${productId}/images`, { method: "POST", body });
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
