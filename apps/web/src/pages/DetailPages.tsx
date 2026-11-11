import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Archive, ArrowLeftRight, BadgeCheck, Ban, Boxes, BriefcaseBusiness, Building2, CalendarDays, ChevronLeft, ChevronRight, CreditCard, Download, FileText, ImagePlus, Mail, MapPin, PackagePlus, Pencil, Phone, Printer, ReceiptText, RotateCw, ShoppingBag, ShoppingCart, Tags, Trash2, Upload, UsersRound, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import type { CursorPage, MemberRole } from "@shopro/contracts";
import { parseQuantityMilli, toAsciiDigits } from "@shopro/contracts";
import { del, downloadFile, get, newOperationId, patch, post, uploadFile } from "../lib/api.js";
import { faNumber, jalaliDate, money, todayISO } from "../lib/format.js";
import { partyPicker, productPicker } from "../lib/picker-options.js";
import { trackOnboardingEvent } from "../lib/onboarding-events.js";
import { downloadCsv } from "../lib/csv.js";
import { EmptyState, Field, InlineError, LoadMoreButton, LoadingBlock, PageHeader, SectionTitle, SelectField, SubmitButton, messageOf, useInvalidate } from "../App.js";
import { Modal } from "../components/Modal.js";
import { JalaliDatePicker } from "../components/JalaliDatePicker.js";
import { QuickAccountModal, QuickExpenseCategoryModal, QuickPartyModal, QuickProductModal } from "../components/EntryHelpers.js";
import { ProductStorefrontSettings } from "../components/StorefrontListingEditor.js";

type MoneyCurrency = "IRR" | "IRT";
type PartyDetail = { id: string; name: string; type: string; phone: string | null; email: string | null; nationalId?: string | null; address: string | null; creditLimitRial?: string | null; paymentTermsDays?: number | null };
type PartyStatement = { party: PartyDetail; balanceRial: string; hasMore: boolean; nextCursor: string | null; openingBalanceRial: string; entries: Array<{ id: string; date: string; entryNo: string; description: string | null; sourceType: string; debitRial: string; creditRial: string; balanceRial: string }> };
type ProductDetailImage = { id: string; position: number; path: string };
type ProductDetail = { id: string; name: string; sku: string | null; barcode: string | null; kind: "STOCK"; unit: { labelFa: string }; category: { name: string } | null; salePriceRial: string; defaultCostRial: string | null; taxRateBasisPoints: number; trackInventory: boolean; isActive: boolean; reorderPoint: string | null; quantityOnHand: string; averageCostRial: string | null; inventoryValueRial: string | null; images: ProductDetailImage[] };
type InvoiceDetail = { id: string; invoiceNo: string | null; date: string; customerId: string | null; customer: { id?: string; name: string; phone: string | null } | null; status: string; documentType: "SALE" | "RETURN"; returnOf: { invoiceNo: string | null } | null; returnReason: string | null; subtotalRial: string; discountRial: string; taxRial: string; totalRial: string; note: string | null; lines: Array<{ id: string; productId: string | null; description: string; sku: string | null; quantity: string; returnedQuantity: string; returnedDiscountRial: string; returnedTaxRial: string; restockAllowed: boolean; unitCode: string; unitPriceRial: string; discountRial: string; taxRateBasisPoints: number; taxRial: string; totalRial: string }>; payments: Array<{ amountRial: string; method: string }>; returns: Array<{ id: string; invoiceNo: string | null; date: string; reason: string | null; totalRial: string; lines: number }> };
type PurchaseDetail = { id: string; purchaseNo: string | null; date: string; dueDate: string | null; supplierId: string | null; supplier: { name: string; phone: string | null; email: string | null; address: string | null } | null; status: string; subtotalRial: string; discountRial: string; taxRial: string; totalRial: string; note: string | null; lines: Array<{ productId: string | null; description: string; sku: string | null; unit: string | null; quantity: string; unitCostRial: string; discountRial: string; taxRateBasisPoints: number; taxRial: string; totalRial: string }>; payments: Array<{ amountRial: string; method: string; account: string | null }> };
type ExpenseAttachment = { fileName: string; mimeType: string; bytes: string; uploadedAt: string };
type ExpenseDetail = { id: string; expenseNo: string | null; date: string; amountRial: string; taxRateBasisPoints: number; taxRial: string; categoryId: string; category: string; payeeId: string | null; payee: { name: string; phone: string | null; email: string | null; address: string | null } | null; status: string; note: string | null; postedAt: string | null; canManageAttachment: boolean; attachment: ExpenseAttachment | null };
type StockCount = { id: string; txnDate: string; status: string; reason: string; lines: Array<{ productId: string; product: string; unit: string; systemQuantity: string; countedQuantity: string; deltaQuantity: string }> };

export function PartyDetailsPage({ currency }: { currency: MoneyCurrency }) {
  const { id = "" } = useParams();
  const location = useLocation();
  const query = useInfiniteQuery({ queryKey: ["party-statement", id], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => get<PartyStatement>(`/parties/${id}/statement${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`), getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined, enabled: !!id });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const statement = query.data?.pages[0];
  const party = statement?.party;
  const entries = query.data?.pages.flatMap((page) => page.entries) ?? [];
  const isSupplier = party?.type === "SUPPLIER" || ((party?.type === "BOTH" || !party) && location.pathname.startsWith("/app/suppliers"));
  const directoryPath = isSupplier ? "/app/suppliers" : "/app/customers";
  const exportStatement = async () => {
    if (!party) return;
    setExporting(true); setExportError("");
    try {
      const entries: PartyStatement["entries"] = [];
      let cursor: string | undefined;
      do {
        const params = new URLSearchParams({ limit: "100" });
        if (cursor) params.set("cursor", cursor);
        const page = await get<PartyStatement>(`/parties/${id}/statement?${params.toString()}`);
        entries.push(...page.entries);
        cursor = page.nextCursor ?? undefined;
        if (entries.length >= 10_000 && cursor) throw new Error("بیش از ۱۰٬۰۰۰ گردش پیدا شد؛ خروجی کامل نیست.");
      } while (cursor);
      downloadCsv("shopro-party-statement.csv", [["طرف‌حساب", party.name], ["ماندهٔ جاری (ریال)", statement?.balanceRial ?? "0"], [], ["تاریخ", "شمارهٔ سند", "شرح", "نوع سند", "بدهکار (ریال)", "بستانکار (ریال)", "مانده (ریال)"], ...entries.map((entry) => [entry.date, entry.entryNo, entry.description ?? "", sourceLabel(entry.sourceType), entry.debitRial, entry.creditRial, entry.balanceRial])]);
    } catch (cause) { setExportError(messageOf(cause)); }
    finally { setExporting(false); }
  };
  return <PageHeader title={party?.name ?? (isSupplier ? "جزئیات تأمین‌کننده" : "جزئیات مشتری")} subtitle={isSupplier ? "پروندهٔ تأمین‌کننده و گردش خرید و پرداخت" : "پروندهٔ مشتری و گردش فروش و دریافت"} actions={<div className="detail-actions">{party && !isSupplier && <Link className="button button-primary" to={`/app/sales?customerId=${encodeURIComponent(party.id)}`}><ShoppingCart size={16} />ثبت فروش برای این مشتری</Link>}<Link className="button button-secondary" to={directoryPath}><UsersRound size={16} />بازگشت به {isSupplier ? "تأمین‌کنندگان" : "مشتریان"}</Link></div>}>
    {query.isPending ? <LoadingBlock /> : query.isError ? <InlineError error={query.error} retry={() => void query.refetch()} /> : !party || !statement ? <EmptyState icon={UsersRound} title="پرونده پیدا نشد" text="این مشتری یا تأمین‌کننده در فهرست فعلی در دسترس نیست." action={<Link className="button button-secondary" to={directoryPath}>بازگشت به {isSupplier ? "تأمین‌کنندگان" : "مشتریان"}</Link>} /> : <div className={`party-detail-page ${isSupplier ? "is-supplier" : "is-customer"}`}>
      <section className="card party-detail-hero">
        <div className="party-detail-hero-main">
          <span className="party-detail-avatar" aria-hidden="true">{isSupplier ? <Building2 size={23} /> : <UsersRound size={23} />}</span>
          <div className="party-detail-hero-copy">
            <div className="party-detail-badges"><span className="party-detail-role">پروندهٔ {isSupplier ? "تأمین‌کننده" : "مشتری"}</span>{party.type === "BOTH" && <span className="party-detail-dual-role">مشتری و تأمین‌کننده</span>}</div>
            <p>{isSupplier ? "اطلاعات تماس، شناسهٔ اقتصادی و شرایط پرداخت این تأمین‌کننده." : "اطلاعات تماس، اعتبار و گردش مالی این مشتری."}</p>
            {(party.phone || party.email) && <div className="party-detail-contact-actions">
              {party.phone && <a href={`tel:${party.phone}`}><Phone size={15} />تماس</a>}
              {party.email && <a href={`mailto:${party.email}`}><Mail size={15} />ارسال ایمیل</a>}
            </div>}
          </div>
        </div>
        <aside className="party-detail-balance">
          <span><Wallet size={16} />ماندهٔ حساب</span>
          <strong>{money(statement.balanceRial, currency)}</strong>
          <small>بر اساس گردش‌های ثبت‌شده در دفتر مالی</small>
        </aside>
      </section>

      <section className="card party-detail-information">
        <SectionTitle title="اطلاعات پرونده" />
        <div className="party-detail-facts">
          <PartyDetailFact icon={<BadgeCheck size={16} />} label="نوع ارتباط" value={partyTypeLabel(party.type)} />
          <PartyDetailFact icon={<Phone size={16} />} label="شمارهٔ همراه" value={party.phone ? <a href={`tel:${party.phone}`} dir="ltr">{party.phone}</a> : "ثبت نشده"} />
          <PartyDetailFact icon={<Mail size={16} />} label="ایمیل" value={party.email ? <a href={`mailto:${party.email}`} dir="ltr">{party.email}</a> : "ثبت نشده"} />
          <PartyDetailFact icon={<CreditCard size={16} />} label={isSupplier ? "شناسهٔ اقتصادی" : "کد ملی"} value={party.nationalId || "ثبت نشده"} />
          <PartyDetailFact icon={<MapPin size={16} />} label="نشانی" value={party.address || "ثبت نشده"} wide />
          {isSupplier
            ? <PartyDetailFact icon={<CalendarDays size={16} />} label="مهلت پرداخت پیش‌فرض" value={party.paymentTermsDays != null ? `${faNumber(party.paymentTermsDays)} روز` : "تعیین نشده"} />
            : <PartyDetailFact icon={<Wallet size={16} />} label="سقف اعتبار فروش" value={party.creditLimitRial != null ? money(party.creditLimitRial, currency) : "تعیین نشده"} />}
        </div>
      </section>

      <section className="card party-detail-statement">
        <SectionTitle title="گردش مالی" action={<span className="party-statement-actions"><span className="party-statement-count">{faNumber(entries.length)} ردیف بارگذاری‌شده</span><button type="button" className="button button-secondary" disabled={exporting} onClick={() => void exportStatement()}><Download size={15} />{exporting ? "در حال آماده‌سازی…" : "دریافت CSV"}</button></span>} />
        <p className="party-statement-caption">بدهکار، بستانکار و ماندهٔ پس از هر سند از دفتر مالی این کسب‌وکار نمایش داده می‌شود.</p>
        {exportError && <InlineError error={exportError} />}
        {entries.length ? <div className="party-statement-list" aria-label="فهرست گردش مالی">
          {entries.map((entry) => <article className="party-statement-row" key={entry.id}>
            <div className="party-statement-entry">
              <span className="party-statement-entry-icon" aria-hidden="true"><ReceiptText size={17} /></span>
              <div className="party-statement-entry-copy"><strong>{entry.description || sourceLabel(entry.sourceType)}</strong><div className="party-statement-entry-meta"><span>{sourceLabel(entry.sourceType)}</span><bdi dir="ltr">{entry.entryNo}</bdi><time dateTime={entry.date}>{jalaliDate(entry.date)}</time></div></div>
            </div>
            <div className="party-statement-amounts">
              <PartyStatementAmount label="بدهکار" value={money(entry.debitRial, currency)} />
              <PartyStatementAmount label="بستانکار" value={money(entry.creditRial, currency)} />
              <PartyStatementAmount label="مانده پس از سند" value={money(entry.balanceRial, currency)} emphasized />
            </div>
          </article>)}
        </div> : <EmptyState icon={FileText} title="گردشی ثبت نشده" text={isSupplier ? "با ثبت خرید یا پرداخت، گردش حساب تأمین‌کننده در این فهرست نمایش داده می‌شود." : "با ثبت فروش یا دریافت وجه، گردش حساب مشتری در این فهرست نمایش داده می‌شود."} />}
        {query.hasNextPage && <button className="button button-secondary party-statement-load-more" type="button" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? "در حال دریافت…" : "نمایش گردش‌های بیشتر"}<ChevronLeft size={15} /></button>}
      </section>
    </div>}
  </PageHeader>;
}

function CatalogTransferAction({ itemId, kind, role }: { itemId: string; kind: "STOCK" | "SERVICE"; role: MemberRole }) {
  const canTransfer = role === "OWNER" || role === "MANAGER" || role === "ACCOUNTANT";
  const businessId = sessionStorage.getItem("shopro_business_id") ?? "";
  const currentBranchId = sessionStorage.getItem("shopro_branch_id") ?? "";
  const branches = useQuery({
    queryKey: ["business-current", businessId],
    queryFn: () => get<{ branches: Array<{ id: string; name: string; code: string }> }>("/businesses/current"),
    enabled: canTransfer && !!businessId,
  });
  const destinations = (branches.data?.branches ?? []).filter((branch) => branch.id !== currentBranchId);
  const [open, setOpen] = useState(false);
  const [targetBranchId, setTargetBranchId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!destinations.some((branch) => branch.id === targetBranchId)) setTargetBranchId(destinations[0]?.id ?? "");
  }, [destinations, targetBranchId]);

  if (!canTransfer || destinations.length === 0) return null;
  const collection = kind === "STOCK" ? "products" : "services";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!targetBranchId || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await post<{ id: string; branchId: string }>(`/${collection}/${encodeURIComponent(itemId)}/transfer`, { targetBranchId });
      sessionStorage.setItem("shopro_branch_id", result.branchId);
      window.location.assign(`/app/${collection}/${encodeURIComponent(result.id)}`);
    } catch (cause) {
      setError(messageOf(cause));
      setBusy(false);
    }
  };
  return <>
    <button type="button" className="button button-secondary" onClick={() => { setError(""); setOpen(true); }}><ArrowLeftRight size={16} />انتقال به شعبه</button>
    <Modal open={open} onClose={() => { if (!busy) setOpen(false); }} title="انتقال به شعبهٔ دیگر" description="یک نسخهٔ مستقل در شعبهٔ مقصد ساخته می‌شود. اطلاعات کالا یا خدمت و تصاویر کپی می‌شوند؛ موجودی، فاکتورها و سوابق مالی در شعبهٔ مبدأ باقی می‌مانند.">
      <form onSubmit={(event) => void submit(event)}>
        <SelectField label="شعبهٔ مقصد" value={targetBranchId} onChange={setTargetBranchId} options={destinations.map((branch) => ({ value: branch.id, label: `${branch.name} · ${branch.code}` }))} />
        {branches.isError && <InlineError error={branches.error} retry={() => void branches.refetch()} />}
        {error && <InlineError error={error} />}
        <div className="modal-form-actions"><SubmitButton busy={busy}>ساخت نسخه در شعبهٔ مقصد</SubmitButton></div>
      </form>
    </Modal>
  </>;
}

type ServiceDetail = { id: string; name: string; description: string | null; unit: { labelFa: string }; category: { id: string; name: string } | null; salePriceRial: string; taxRateBasisPoints: number; isActive: boolean; images: ProductDetailImage[] };
export function ServiceDetailsPage({ currency, role }: { currency: MoneyCurrency; role: MemberRole }) {
  const { id = "" } = useParams();
  const service = useQuery({ queryKey: ["service-detail", id], queryFn: () => get<ServiceDetail>("/services/" + id), enabled: !!id });
  const item = service.data;
  return <PageHeader title={item?.name ?? "جزئیات خدمت"} subtitle="شرح، قیمت‌گذاری و وضعیت خدمت" actions={<div className="detail-actions">{item?.isActive && <Link className="button button-primary" to={"/app/sales?productId=" + encodeURIComponent(item.id)}><ShoppingCart size={16} />ثبت فروش این خدمت</Link>}{item && <CatalogTransferAction itemId={item.id} kind="SERVICE" role={role} />}<Link className="button button-secondary" to="/app/services"><BriefcaseBusiness size={16} />بازگشت به خدمات</Link></div>}>
    {service.isPending ? <LoadingBlock /> : service.isError ? <InlineError error={service.error} retry={() => void service.refetch()} /> : item && <div className="service-detail-page">
      <section className="card service-detail-hero"><span className="product-avatar service-avatar"><BriefcaseBusiness size={22} /></span><div className="service-detail-copy"><div className="product-detail-badges"><span className="product-detail-kind">خدمت</span><span className={"product-detail-status " + (item.isActive ? "is-active" : "is-archived")}><i />{item.isActive ? "فعال" : "بایگانی‌شده"}</span>{item.category && <span className="product-detail-category"><Tags size={13} />{item.category.name}</span>}</div><h2>{item.name}</h2><p>{item.description || "برای این خدمت شرحی ثبت نشده است."}</p></div><ProductDetailGallery images={item.images ?? []} name={item.name} entityLabel="خدمت" /><div className="product-detail-price"><span>قیمت فروش <small>برای هر {item.unit.labelFa}</small></span><strong>{money(item.salePriceRial, currency)}</strong></div></section>
      <section className="card product-detail-specs"><SectionTitle title="مشخصات خدمت" /><div className="detail-grid product-detail-spec-grid"><DetailField label="واحد ارائه" value={item.unit.labelFa} /><DetailField label="دسته‌بندی" value={item.category?.name ?? "بدون دسته‌بندی"} /><DetailField label="وضعیت" value={item.isActive ? "فعال" : "بایگانی‌شده"} /><DetailField label="قیمت فروش" value={money(item.salePriceRial, currency)} /><DetailField label="نرخ مالیات" value={faNumber(item.taxRateBasisPoints / 100) + "٪"} /><DetailField label="شرح" value={item.description || "ثبت نشده"} /></div></section>
      {item.isActive && (role === "OWNER" || role === "MANAGER") && <ProductStorefrontSettings productId={item.id} productName={item.name} />}
    </div>}
  </PageHeader>;
}

export function ProductDetailsPage({ currency, role }: { currency: MoneyCurrency; role: MemberRole }) {
  const { id = "" } = useParams();
  const product = useQuery({ queryKey: ["product-detail", id], queryFn: () => get<ProductDetail>("/products/" + id), enabled: !!id });
  const movements = useInfiniteQuery({ queryKey: ["product-movements", id], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => get<CursorPage<{ id: string; date: string; sourceType: string; quantityDelta: string; unitCostRial: string; valueDeltaRial: string }>>(`/inventory/movements?productId=${encodeURIComponent(id)}&limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`), getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined, enabled: !!id });
  const movementRows = movements.data?.pages.flatMap((page) => page.items) ?? [];
  const item = product.data;
  return <PageHeader title="جزئیات کالا" subtitle="مشخصات، قیمت و عملکرد کالا در این شعبه" actions={<div className="detail-actions">{item?.isActive && <Link className="button button-primary" to={`/app/sales?productId=${encodeURIComponent(item.id)}`}><ShoppingCart size={16} />ثبت فروش</Link>}{item && <CatalogTransferAction itemId={item.id} kind="STOCK" role={role} />}<Link className="button button-secondary" to="/app/products"><PackagePlus size={16} />بازگشت به کالاها</Link></div>}>
    {product.isPending ? <LoadingBlock /> : product.isError ? <InlineError error={product.error} retry={() => void product.refetch()} /> : !item ? <EmptyState icon={Boxes} title="کالا پیدا نشد" text="اطلاعات این مورد در کسب‌وکار فعلی در دسترس نیست." /> : <div className="product-detail-page">
      <section className="card product-detail-hero">
        <div className="product-detail-copy">
          <div className="product-detail-badges"><span className="product-detail-kind">کالای انبارشونده</span><span className={`product-detail-status ${item.isActive ? "is-active" : "is-archived"}`}><i />{item.isActive ? "فعال" : "بایگانی‌شده"}</span>{item.category && <span className="product-detail-category">{item.category.name}</span>}</div>
          <h2>{item.name}</h2>
          <p className="product-detail-description">کالای قابل پیگیری در موجودی این شعبه</p>
          <div className="product-detail-identifiers">{item.sku && <span><small>کد کالا</small><bdi dir="ltr">{item.sku}</bdi></span>}{item.barcode && <span><small>بارکد</small><bdi dir="ltr">{item.barcode}</bdi></span>}{!item.sku && !item.barcode && <span className="product-detail-no-identifiers">کد کالا و بارکدی ثبت نشده است</span>}</div>
          <div className="product-detail-price"><span>قیمت فروش <small>برای هر {item.unit.labelFa}</small></span><strong>{money(item.salePriceRial, currency)}</strong></div>
        </div>
        <ProductDetailGallery images={item.images ?? []} name={item.name} />
      </section>

      <section className="product-detail-metrics" aria-label="خلاصهٔ موجودی این شعبه">
        <article className="card product-detail-metric"><span className="product-detail-metric-icon is-stock"><Boxes size={18} /></span><div><small>موجودی فعلی شعبه</small><strong>{faNumber(item.quantityOnHand)} <em>{item.unit.labelFa}</em></strong><span>{item.reorderPoint !== null && Number(item.quantityOnHand) <= Number(item.reorderPoint) ? "نیازمند بررسی و تأمین" : "موجودی ثبت‌شده"}</span></div></article>
        <article className="card product-detail-metric"><span className="product-detail-metric-icon"><ReceiptText size={18} /></span><div><small>میانگین بهای تمام‌شده</small><strong>{item.averageCostRial ? money(item.averageCostRial, currency) : "ثبت نشده"}</strong><span>بر پایهٔ اسناد موجودی</span></div></article>
        <article className="card product-detail-metric"><span className="product-detail-metric-icon"><PackagePlus size={18} /></span><div><small>ارزش موجودی</small><strong>{money(item.inventoryValueRial ?? "0", currency)}</strong><span>در همین شعبه</span></div></article>
      </section>

      <section className="card product-detail-specs"><SectionTitle title="مشخصات کالا" /><div className="detail-grid product-detail-spec-grid"><DetailField label="نوع" value="کالای انبارشونده" /><DetailField label="واحد" value={item.unit.labelFa} /><DetailField label="دسته‌بندی" value={item.category?.name ?? "بدون دسته‌بندی"} /><DetailField label="وضعیت" value={item.isActive ? "فعال" : "بایگانی‌شده"} /><DetailField label="کد کالا" value={item.sku || "ثبت نشده"} /><DetailField label="بارکد" value={item.barcode ? <bdi dir="ltr">{item.barcode}</bdi> : "ثبت نشده"} /><DetailField label="بهای خرید پیش‌فرض" value={item.defaultCostRial ? money(item.defaultCostRial, currency) : "ثبت نشده"} /><DetailField label="نرخ مالیات" value={faNumber(item.taxRateBasisPoints / 100) + "٪"} /><DetailField label="حد هشدار موجودی" value={item.reorderPoint ? faNumber(item.reorderPoint) + " " + item.unit.labelFa : "تنظیم نشده"} /></div></section>

      {item.isActive && (role === "OWNER" || role === "MANAGER") && <ProductStorefrontSettings productId={item.id} productName={item.name} />}

      <section className="card product-detail-history"><SectionTitle title="گردش موجودی" action={<span className="product-detail-history-count">{movements.data ? "نمایش " + faNumber(movementRows.length) + " مورد" : ""}</span>} />
        {movements.isPending ? <LoadingBlock /> : movements.isError ? <InlineError error={movements.error} retry={() => void movements.refetch()} /> : movementRows.length ? <div className="product-movement-list">{movementRows.map((row) => {
          const quantity = Number(row.quantityDelta);
          const movementClass = quantity > 0 ? "is-increase" : quantity < 0 ? "is-decrease" : "is-neutral";
          return <article className="product-movement-row" key={row.id}><span className={`product-movement-direction ${movementClass}`}>{quantity > 0 ? "+" : quantity < 0 ? "−" : "•"}</span><div className="product-movement-copy"><strong>{productMovementLabel(row.sourceType)}</strong><small>{jalaliDate(row.date)} · {faNumber(row.quantityDelta)} {item.unit.labelFa}</small></div><div className="product-movement-value"><strong>{money(row.valueDeltaRial, currency)}</strong><small>تغییر ارزش موجودی</small></div></article>;
        })}</div> : <EmptyState icon={Boxes} title="گردشی ثبت نشده" text="خرید، فروش و شمارش موجودی در این بخش دیده می‌شوند." />}
        <LoadMoreButton hasMore={Boolean(movements.hasNextPage)} isLoading={movements.isFetchingNextPage} onClick={() => void movements.fetchNextPage()} />
      </section>
    </div>}
  </PageHeader>;
}

function ProductDetailGallery({ images, name, entityLabel = "کالا" }: { images: ProductDetailImage[]; name: string; entityLabel?: string }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failedCount, setFailedCount] = useState(0);

  useEffect(() => {
    let active = true;
    const objectUrls: string[] = [];
    setUrls({}); setActiveIndex(0); setFailedCount(0); setLoading(images.length > 0);
    if (!images.length) return () => { active = false; };
    void Promise.all(images.map(async (image) => {
      try {
        const url = URL.createObjectURL(await downloadFile(image.path));
        if (!active) { URL.revokeObjectURL(url); return null; }
        objectUrls.push(url);
        return [image.id, url] as const;
      } catch { return null; }
    })).then((loaded) => {
      if (!active) return;
      const available = loaded.filter((entry): entry is readonly [string, string] => entry !== null);
      setUrls(Object.fromEntries(available)); setFailedCount(images.length - available.length); setLoading(false);
    });
    return () => { active = false; objectUrls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [images]);

  if (!images.length) return <div className="product-detail-gallery-empty"><span><ImagePlus size={29} /></span><strong>تصویری برای این {entityLabel} ثبت نشده</strong><small>تصویر اصلی و گالری در فرم افزودن یا ویرایش {entityLabel} تنظیم می‌شوند.</small></div>;
  const index = activeIndex % images.length;
  const activeImage = images[index];
  const step = (change: number) => setActiveIndex((current) => (current + change + images.length) % images.length);
  return <div className="product-detail-gallery">
    <div className="product-detail-gallery-stage">
      {urls[activeImage.id] ? <img src={urls[activeImage.id]} alt={`${name}، تصویر ${index + 1}`} /> : <div className="product-detail-gallery-placeholder"><ImagePlus size={28} /><span>{loading ? "در حال بارگیری تصویر…" : "این تصویر بارگیری نشد"}</span></div>}
      <span className="product-detail-gallery-count">{faNumber(index + 1)} از {faNumber(images.length)}</span>
      {images.length > 1 && <><button type="button" className="product-gallery-nav is-next" aria-label="تصویر بعدی" onClick={() => step(1)}><ChevronLeft size={18} /></button><button type="button" className="product-gallery-nav is-previous" aria-label="تصویر قبلی" onClick={() => step(-1)}><ChevronRight size={18} /></button></>}
    </div>
    {images.length > 1 && <div className="product-detail-gallery-thumbnails" aria-label="انتخاب تصویر">{images.map((image, imageIndex) => <button type="button" className={imageIndex === index ? "active" : ""} key={image.id} onClick={() => setActiveIndex(imageIndex)} aria-label={`نمایش تصویر ${imageIndex + 1}`} aria-pressed={imageIndex === index}>{urls[image.id] ? <img src={urls[image.id]} alt="" /> : <ImagePlus size={15} />}</button>)}</div>}
    {failedCount > 0 && !loading && <small className="product-detail-gallery-warning">بارگیری {faNumber(failedCount)} تصویر ناموفق بود.</small>}
  </div>;
}

export function InvoiceDetailsPage({ currency, branchName }: { currency: MoneyCurrency; branchName: string }) {
  const { id = "" } = useParams();
  const location = useLocation(); const navigate = useNavigate(); const invalidate = useInvalidate(); const autoPostHandled = useRef(false);
  const [editOpen, setEditOpen] = useState(false); const [postOpen, setPostOpen] = useState(false); const [voidOpen, setVoidOpen] = useState(false); const [returnOpen, setReturnOpen] = useState(false); const [quickPartyOpen, setQuickPartyOpen] = useState(false); const [quickProductOpen, setQuickProductOpen] = useState(false); const [quickAccountOpen, setQuickAccountOpen] = useState(false); const [quickProductIndex, setQuickProductIndex] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayISO()); const [customerId, setCustomerId] = useState(""); const [note, setNote] = useState(""); const [paymentAmount, setPaymentAmount] = useState(""); const [accountId, setAccountId] = useState(""); const [method, setMethod] = useState("CASH"); const [lineRows, setLineRows] = useState<Array<{ productId: string; quantity: string; unitPrice: string; discount: string }>>([]);
  const [returnDate, setReturnDate] = useState(() => todayISO()); const [returnReason, setReturnReason] = useState(""); const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({}); const [returnRestock, setReturnRestock] = useState<Record<string, boolean>>({}); const [refundAmount, setRefundAmount] = useState(""); const [refundAccountId, setRefundAccountId] = useState(""); const [refundMethod, setRefundMethod] = useState<"CASH" | "POS" | "BANK" | "OTHER">("CASH");
  const query = useQuery({ queryKey: ["invoice", id], queryFn: () => get<InvoiceDetail>("/sales/" + id), enabled: !!id });
  const invoice = query.data;
  const customers = useQuery({ queryKey: ["sales-customers"], queryFn: () => get<Array<{ id: string; name: string }>>("/customers"), enabled: editOpen });
  const products = useQuery({ queryKey: ["sales-products"], queryFn: () => get<Array<{ id: string; name: string; salePriceRial: string }>>("/catalog"), enabled: editOpen });
  const customerPickerOptions = partyPicker("CUSTOMER"); const anyProductPickerOptions = productPicker();
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => get<Array<{ id: string; name: string }>>("/finance/accounts"), enabled: postOpen || returnOpen });
  useEffect(() => { autoPostHandled.current = false; }, [id]);
  useEffect(() => {
    const state = location.state as { openPost?: boolean; payment?: { amountRial: string; financeAccountId: string; method: string } | null } | null;
    if (!invoice || invoice.status !== "DRAFT" || !state?.openPost || autoPostHandled.current) return;
    autoPostHandled.current = true;
    if (state.payment) { setPaymentAmount(rialToDisplay(state.payment.amountRial, currency)); setAccountId(state.payment.financeAccountId); setMethod(state.payment.method); }
    setPostOpen(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [invoice?.id, invoice?.status, location.key]);
  const openEdit = () => { if (!invoice) return; setDate(invoice.date); setCustomerId(invoice.customerId ?? ""); setNote(invoice.note ?? ""); setLineRows(invoice.lines.map((line) => ({ productId: line.productId ?? "", quantity: line.quantity, unitPrice: rialToDisplay(line.unitPriceRial, currency), discount: rialToDisplay(line.discountRial, currency) }))); setError(""); setEditOpen(true); };
  const saveDraft = async (event: FormEvent) => { event.preventDefault(); if (!lineRows.length || lineRows.some((line) => !line.productId)) { setError("برای هر ردیف یک کالا یا خدمت انتخاب کنید."); return; } setBusy(true); setError(""); try { await patch("/sales/" + id, { customerId: customerId || undefined, txnDate: date, note: note || undefined, lines: lineRows.map((line) => ({ productId: line.productId, quantity: line.quantity, unitPriceRial: displayToRial(line.unitPrice, currency), discountRial: line.discount ? displayToRial(line.discount, currency) : undefined })) }); setEditOpen(false); await invalidate(); await query.refetch(); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); } };
  const postDraft = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { const amount = paymentAmount.trim() ? displayToRial(paymentAmount, currency) : "0"; if (amount !== "0" && !accountId) throw new Error("برای دریافت وجه، حساب مالی را انتخاب کنید."); await post("/sales/" + id + "/post", { payments: amount !== "0" ? [{ amountRial: amount, financeAccountId: accountId, method }] : [] }, { "Idempotency-Key": newOperationId() }); trackOnboardingEvent("first_document_posted", "first_operation"); setPostOpen(false); await invalidate(); await query.refetch(); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); } };
  const voidInvoice = async () => { setBusy(true); setError(""); try { await post("/sales/" + id + "/void", { reason }, { "Idempotency-Key": newOperationId() }); setVoidOpen(false); await invalidate(); await query.refetch(); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); } };
  const canReturn = invoice?.status === "POSTED" && invoice.documentType === "SALE";
  const returnEstimate = useMemo<ReturnEstimate>(() => invoice ? estimateSalesReturn(invoice, returnQuantities, returnRestock) : { lines: [], total: 0n, invalid: false }, [invoice, returnQuantities, returnRestock]);
  const refundValue = refundAmount.trim() ? (() => { try { return BigInt(displayToRial(refundAmount, currency)); } catch { return -1n; } })() : invoice?.customer ? 0n : returnEstimate.total;
  const needsRefundAccount = refundValue > 0n;
  const openReturn = () => { setReturnDate(todayISO()); setReturnReason(""); setReturnQuantities({}); setReturnRestock({}); setRefundAmount(""); setRefundAccountId(""); setError(""); setReturnOpen(true); };
  const submitReturn = async (event: FormEvent) => {
    event.preventDefault();
    if (!invoice || !canReturn || returnEstimate.invalid || returnEstimate.lines.length === 0 || returnReason.trim().length < 3) return;
    setBusy(true); setError("");
    try {
      const cashRefundRial = refundAmount.trim() ? displayToRial(refundAmount, currency) : undefined;
      await post(`/sales/${id}/returns`, { txnDate: returnDate, reason: returnReason.trim(), lines: returnEstimate.lines, ...(cashRefundRial === undefined ? {} : { cashRefundRial, refundFinanceAccountId: refundAccountId || undefined, refundMethod }) }, { "Idempotency-Key": newOperationId() });
      setReturnOpen(false); setReturnReason(""); setReturnQuantities({}); setRefundAmount(""); setRefundAccountId("");
      await invalidate(); await query.refetch();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const title = invoice ? (invoice.documentType === "RETURN" ? "برگشت " : "فاکتور ") + (invoice.invoiceNo ?? "پیش‌نویس") : "جزئیات فاکتور";
  const paidTotalRial = invoice?.payments.reduce((total, payment) => total + BigInt(payment.amountRial), 0n) ?? 0n;
  return <PageHeader title={title} subtitle="پروندهٔ کامل فاکتور، اقلام و دریافت‌ها">
    {query.isPending ? <LoadingBlock /> : query.isError ? <InlineError error={query.error} retry={() => void query.refetch()} /> : invoice && <div className="invoice-detail-page">
      <div className="invoice-detail-accessbar" role="group" aria-label="عملیات فاکتور">
        <div className="invoice-detail-access-copy"><span className="icon-tile emerald"><ReceiptText size={18} /></span><span><small>{statusLabel(invoice.status)} · {invoice.documentType === "RETURN" ? "برگشت فروش" : "فروش"}</small><strong><bdi dir="ltr">{invoice.invoiceNo ?? "پیش‌نویس"}</bdi></strong></span></div>
        <div className="invoice-detail-actions">
          {invoice.status === "DRAFT" && invoice.documentType === "SALE" && <><button type="button" className="button button-secondary" onClick={openEdit}><Pencil size={15} />ویرایش پیش‌نویس</button><button type="button" className="button button-primary" onClick={() => { setPaymentAmount(""); setAccountId(""); setError(""); setPostOpen(true); }}>ثبت نهایی فروش</button><button type="button" className="button button-danger" onClick={() => { setReason(""); setError(""); setVoidOpen(true); }}>حذف پیش‌نویس</button></>}
          {invoice.status === "POSTED" && invoice.documentType === "SALE" && <>
            <button type="button" className="icon-button invoice-detail-icon-action is-danger" title="ابطال فاکتور" aria-label="ابطال فاکتور" onClick={() => { setReason(""); setError(""); setVoidOpen(true); }}><Ban size={17} /></button>
            {canReturn && <button type="button" className="icon-button invoice-detail-icon-action is-return" title="ثبت برگشت فروش" aria-label="ثبت برگشت فروش" onClick={openReturn}><RotateCw size={17} /></button>}
          </>}
          <button type="button" className="icon-button invoice-detail-icon-action" title="گزارش PDF" aria-label="گزارش PDF" onClick={() => window.print()}><Printer size={17} /></button>
          <Link className="button button-secondary" to="/app/invoices"><FileText size={15} />فهرست فاکتورها</Link>
        </div>
      </div>
      <section className="card invoice-detail-hero">
        <div className="invoice-detail-hero-heading">
          <div className="invoice-detail-identity">
            <span className="invoice-detail-avatar"><UsersRound size={20} /></span>
            <div className="invoice-detail-hero-copy">
              <div className="invoice-detail-badges"><span className={"status-badge " + invoice.status.toLowerCase()}>{statusLabel(invoice.status)}</span><span className="invoice-detail-kind">{invoice.documentType === "RETURN" ? "سند برگشت فروش" : "فاکتور فروش"}</span></div>
              <h2>{invoice.customer?.name ?? "مشتری گذری"}</h2>
              {invoice.customer?.phone ? <a className="invoice-detail-phone" href={`tel:${invoice.customer.phone}`} dir="ltr"><Phone size={13} />{invoice.customer.phone}</a> : <p>بدون اطلاعات تماس مشتری</p>}
            </div>
          </div>
          <div className="invoice-detail-total"><small>مبلغ نهایی</small><strong>{money(invoice.totalRial, currency)}</strong><span>{faNumber(invoice.lines.length)} ردیف · {jalaliDate(invoice.date)}</span></div>
        </div>
        <div className="invoice-detail-facts">
          <DetailField label="شمارهٔ فاکتور" value={<bdi dir="ltr">{invoice.invoiceNo ?? "پیش‌نویس"}</bdi>} />
          <DetailField label="تاریخ صدور" value={jalaliDate(invoice.date)} />
          <DetailField label="شعبه" value={branchName || "شعبهٔ جاری"} />
          <DetailField label="مشتری" value={invoice.customerId ? <Link className="invoice-detail-party-link" to={`/app/customers/${invoice.customer?.id ?? invoice.customerId}`}>{invoice.customer?.name ?? "مشاهدهٔ پرونده"}<ChevronLeft size={13} /></Link> : "مشتری گذری"} />
          <DetailField label="نوع سند" value={invoice.documentType === "RETURN" ? "برگشت فروش" : "فروش"} />
          {invoice.returnOf && <DetailField label="فاکتور مرجع" value={invoice.returnOf.invoiceNo ?? "فروش"} />}
        </div>
        {(invoice.note || invoice.returnReason) && <div className="invoice-detail-note"><small>{invoice.returnReason ? "دلیل برگشت" : "توضیح فاکتور"}</small><p>{invoice.returnReason || invoice.note}</p>{invoice.returnReason && invoice.note && <p>{invoice.note}</p>}</div>}
      </section>
      <div className="invoice-detail-content-grid">
        <section className="card invoice-detail-lines"><SectionTitle title="اقلام فاکتور" action={<span className="invoice-detail-count">{faNumber(invoice.lines.length)} ردیف</span>} />
          {invoice.lines.length ? <div className="invoice-detail-line-list">{invoice.lines.map((line, index) => <article className="invoice-detail-line" key={line.id}>
            <div className="invoice-detail-line-product"><span className="invoice-detail-line-index">{faNumber(index + 1)}</span><span><strong>{line.description}</strong><small>{line.sku ? `کد کالا · ${line.sku} · ` : ""}{line.unitCode || "واحد ثبت نشده"}{line.returnedQuantity !== "0" ? ` · برگشت‌شده ${faNumber(line.returnedQuantity)}` : ""}</small></span></div>
            <div className="invoice-detail-line-metrics"><span><small>تعداد</small><strong>{faNumber(line.quantity)} <i>{line.unitCode}</i></strong></span><span><small>قیمت واحد</small><strong>{money(line.unitPriceRial, currency)}</strong></span><span><small>تخفیف</small><strong>{money(line.discountRial, currency)}</strong></span><span><small>مالیات</small><strong>{money(line.taxRial, currency)} <i>({faNumber(line.taxRateBasisPoints / 100)}٪)</i></strong></span></div>
            <div className="invoice-detail-line-total"><small>جمع ردیف</small><strong>{money(line.totalRial, currency)}</strong></div>
          </article>)}</div> : <EmptyState icon={PackagePlus} title="قلمی در فاکتور ثبت نشده" text="اقلام این سند پس از ثبت در این بخش نمایش داده می‌شوند." />}
        </section>
        <aside className="card invoice-detail-summary">
          <div className="invoice-detail-financials"><SectionTitle title="خلاصهٔ مالی" /><div className="invoice-detail-totals"><div><span>جمع اقلام</span><strong>{money(invoice.subtotalRial, currency)}</strong></div><div><span>تخفیف کل</span><strong>{money(invoice.discountRial, currency)}</strong></div><div><span>مالیات</span><strong>{money(invoice.taxRial, currency)}</strong></div><div className="is-grand-total"><span>جمع نهایی</span><strong>{money(invoice.totalRial, currency)}</strong></div></div></div>
          <div className="invoice-detail-payment"><div className="invoice-detail-payment-heading"><span className="icon-tile blue"><Wallet size={17} /></span><span><small>دریافت وجه</small><strong>{invoice.payments.length ? `${faNumber(invoice.payments.length)} دریافت ثبت‌شده` : invoice.status === "DRAFT" ? "پس از تأیید فروش" : "بدون دریافت ثبت‌شده"}</strong></span></div>
            <div className="invoice-detail-payment-total"><span>مجموع دریافت</span><strong>{money(paidTotalRial, currency)}</strong></div>
            {invoice.payments.length > 0 ? <div className="invoice-detail-payment-list">{invoice.payments.map((payment, index) => <div key={index}><span>{methodLabel(payment.method)}<small>دریافت {faNumber(index + 1)}</small></span><strong>{money(payment.amountRial, currency)}</strong></div>)}</div> : <p>{invoice.status === "DRAFT" ? "در ثبت نهایی، مبلغ دریافتی را وارد کنید یا فروش را اعتباری ثبت کنید." : "این فاکتور بدون دریافت وجه ثبت شده است."}</p>}
          </div>
        </aside>
      </div>
      {invoice.returns.length > 0 && <section className="card invoice-detail-returns"><SectionTitle title="برگشت‌های ثبت‌شده" action={<span className="invoice-detail-count">{faNumber(invoice.returns.length)} سند</span>} /><div className="invoice-detail-return-list">{invoice.returns.map((row) => <Link className="invoice-detail-return" to={`/app/invoices/${row.id}`} key={row.id}><span className="icon-tile amber"><ArrowLeftRight size={16} /></span><div><strong>{row.invoiceNo ?? "برگشت فروش"}</strong><small>{jalaliDate(row.date)} · {row.reason || "بدون توضیح"} · {faNumber(row.lines)} ردیف</small></div><strong>{money(row.totalRial, currency)}</strong></Link>)}</div></section>}
    </div>}
    <Modal open={editOpen} onClose={() => setEditOpen(false)} title="ویرایش پیش‌نویس فروش" description="با ذخیره، مبلغ‌ها و مالیات بر اساس اطلاعات جاری کالاها دوباره محاسبه می‌شوند." size="wide"><form onSubmit={(event) => void saveDraft(event)}><div className="form-grid"><JalaliDatePicker value={date} onChange={setDate} label="تاریخ فاکتور" /><SelectField label="مشتری" value={customerId} onChange={setCustomerId} options={(customers.data ?? []).map((row) => ({ value: row.id, label: row.name }))} optionsKey={customerPickerOptions.key} loadOptions={customerPickerOptions.load} placeholder="بدون مشتری" onAdd={() => setQuickPartyOpen(true)} /><Field label="توضیح" value={note} onChange={setNote} /></div>{lineRows.map((line, index) => <div className="form-grid draft-line-editor" key={index}><SelectField label={`کالا یا خدمت ${faNumber(index + 1)}`} value={line.productId} onChange={(value) => setLineRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, productId: value } : row))} options={(products.data ?? []).map((row) => ({ value: row.id, label: row.name }))} optionsKey={anyProductPickerOptions.key} loadOptions={anyProductPickerOptions.load} onAdd={() => { setQuickProductIndex(index); setQuickProductOpen(true); }} /><Field label="تعداد" value={line.quantity} onChange={(value) => setLineRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: value } : row))} inputMode="decimal" required /><Field label={`قیمت واحد (${currency === "IRT" ? "تومان" : "ریال"})`} value={line.unitPrice} onChange={(value) => setLineRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, unitPrice: value } : row))} inputMode="decimal" required /><Field label={`تخفیف (${currency === "IRT" ? "تومان" : "ریال"})`} value={line.discount} onChange={(value) => setLineRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, discount: value } : row))} inputMode="decimal" placeholder="۰" />{lineRows.length > 1 && <button type="button" className="button button-danger" onClick={() => setLineRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>حذف ردیف</button>}</div>)}<button type="button" className="button button-text" onClick={() => setLineRows((rows) => [...rows, { productId: "", quantity: "1", unitPrice: "", discount: "" }])}>افزودن ردیف</button>{error && <InlineError error={error} />}{products.isError && <InlineError error={products.error} retry={() => void products.refetch()} />}<div className="modal-form-actions"><SubmitButton busy={busy}>ذخیرهٔ پیش‌نویس</SubmitButton></div></form></Modal>
    <Modal open={postOpen} onClose={() => setPostOpen(false)} title="ثبت نهایی فروش" description="اطلاعات شعبه و فاکتور را بازبینی کنید؛ با تأیید، فروش در دفتر مالی و گردش موجودی همین شعبه ثبت می‌شود."><form onSubmit={(event) => void postDraft(event)}>{invoice && <div className="onboarding-operation-review" aria-label="بازبینی سند فروش"><span><small>شعبه</small><strong>{branchName || "شعبهٔ جاری"}</strong></span><span><small>تاریخ فاکتور</small><strong>{jalaliDate(invoice.date)}</strong></span><span><small>جمع کل</small><strong>{money(invoice.totalRial, currency)}</strong></span></div>}<div className="form-grid"><Field label={`مبلغ دریافتی (${currency === "IRT" ? "تومان" : "ریال"})`} value={paymentAmount} onChange={setPaymentAmount} inputMode="decimal" placeholder="۰ برای فروش اعتباری" /><SelectField label="حساب دریافت" value={accountId} onChange={setAccountId} options={(accounts.data ?? []).map((row) => ({ value: row.id, label: row.name }))} placeholder="بدون دریافت فعلی" onAdd={() => setQuickAccountOpen(true)} /><SelectField label="روش پرداخت" value={method} onChange={setMethod} options={[{ value: "CASH", label: "نقدی" }, { value: "POS", label: "کارت‌خوان" }, { value: "BANK", label: "واریز بانکی" }, { value: "OTHER", label: "سایر" }]} /></div>{error && <InlineError error={error} />}{accounts.isError && <InlineError error={accounts.error} retry={() => void accounts.refetch()} />}<div className="modal-form-actions"><SubmitButton busy={busy}>تأیید ثبت نهایی</SubmitButton></div></form></Modal>
    <Modal open={voidOpen} onClose={() => setVoidOpen(false)} title={invoice?.status === "DRAFT" ? "حذف پیش‌نویس فاکتور" : "ابطال فاکتور"} description={invoice?.status === "DRAFT" ? "پیش‌نویس از فهرست فعال کنار گذاشته می‌شود و سابقهٔ آن نگه داشته خواهد شد." : "فاکتور اصلی حفظ می‌شود و سندهای معکوس حسابداری و موجودی ثبت می‌شوند."}><Field label="دلیل" value={reason} onChange={setReason} required />{error && <InlineError error={error} />}<div className="modal-form-actions"><button type="button" className="button button-danger" disabled={busy || reason.trim().length < 3} onClick={() => void voidInvoice()}>{busy ? "در حال ثبت…" : invoice?.status === "DRAFT" ? "تأیید حذف پیش‌نویس" : "تأیید ابطال"}</button></div></Modal>
    <Modal open={returnOpen} onClose={() => { if (!busy) setReturnOpen(false); }} title="ثبت برگشت فروش" description="تعداد برگشت‌نشدهٔ هر ردیف را وارد کنید. اقلام انتخابی برای انبار به موجودی شعبه بازمی‌گردند." size="wide">
      {invoice && <form className="invoice-void-form return-form" onSubmit={(event) => void submitReturn(event)}>
        <div className="return-line-list">{invoice.lines.map((line) => {
          const remainingMilli = parseQuantityMilli(line.quantity) - parseQuantityMilli(line.returnedQuantity);
          const remaining = quantityFromMilli(remainingMilli > 0n ? remainingMilli : 0n);
          return <div className="return-line" key={line.id}>
            <span className="row-grow"><strong>{line.description}</strong><small>باقی‌ماندهٔ قابل برگشت: {faNumber(remaining)}</small></span>
            <Field label="تعداد برگشت" value={returnQuantities[line.id] ?? ""} onChange={(value) => setReturnQuantities((rows) => ({ ...rows, [line.id]: value }))} inputMode="decimal" placeholder="۰" />
            <label className="return-restock"><input type="checkbox" disabled={!line.restockAllowed} checked={line.restockAllowed && (returnRestock[line.id] ?? true)} onChange={(event) => setReturnRestock((rows) => ({ ...rows, [line.id]: event.target.checked }))} />بازگشت به انبار</label>
          </div>;
        })}</div>
        <div className="form-grid">
          <JalaliDatePicker value={returnDate} onChange={setReturnDate} label="تاریخ برگشت" />
          <Field label="دلیل برگشت" value={returnReason} onChange={setReturnReason} required />
          <Field label={"مبلغ بازپرداخت نقدی (" + (currency === "IRT" ? "تومان" : "ریال") + ")"} value={refundAmount} onChange={setRefundAmount} inputMode={currency === "IRT" ? "decimal" : "numeric"} placeholder="اختیاری" />
          <SelectField label="حساب بازپرداخت" value={refundAccountId} onChange={setRefundAccountId} options={(accounts.data ?? []).map((account) => ({ value: account.id, label: account.name }))} placeholder="انتخاب صندوق یا بانک" />
          <SelectField label="روش بازپرداخت" value={refundMethod} onChange={(value) => setRefundMethod(value as typeof refundMethod)} options={[{ value: "CASH", label: "نقدی" }, { value: "POS", label: "کارت‌خوان" }, { value: "BANK", label: "بانکی" }, { value: "OTHER", label: "سایر" }]} />
        </div>
        <div className="notice"><span>مبلغ برآوردی برگشت: <strong>{money(returnEstimate.total, currency)}</strong></span><small>{invoice.customer ? "مبلغ بازپرداخت نقدی اختیاری است و باقیمانده به اعتبار مشتری افزوده می‌شود." : "برای مشتری گذری، مبلغ کامل برگشت به حساب پرداخت انتخابی برمی‌گردد."}</small></div>
        {error && <InlineError error={error} />}{accounts.isError && <InlineError error={accounts.error} retry={() => void accounts.refetch()} />}
        <div className="modal-form-actions"><button className="button button-primary" type="submit" disabled={busy || returnEstimate.invalid || returnEstimate.lines.length === 0 || returnReason.trim().length < 3 || (needsRefundAccount && !refundAccountId) || refundValue < 0n || refundValue > returnEstimate.total}>{busy ? "در حال ثبت…" : "ثبت برگشت و سند مالی"}</button></div>
      </form>}
    </Modal>
    <QuickPartyModal open={quickPartyOpen} type="CUSTOMER" onClose={() => setQuickPartyOpen(false)} onCreated={(party) => { setCustomerId(party.id); void invalidate(); }} /><QuickProductModal open={quickProductOpen} currency={currency} onClose={() => setQuickProductOpen(false)} onCreated={(product) => { setLineRows((rows) => rows.map((row, index) => index === quickProductIndex ? { ...row, productId: product.id } : row)); void invalidate(); }} /><QuickAccountModal open={quickAccountOpen} onClose={() => setQuickAccountOpen(false)} onCreated={(account) => { setAccountId(account.id); void invalidate(); }} />
  </PageHeader>;
}

type ReturnEstimate = { lines: Array<{ invoiceLineId: string; quantity: string; restock: boolean }>; total: bigint; invalid: boolean };
function quantityFromMilli(value: bigint) {
  const whole = value / 1000n;
  const fraction = (value % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return fraction ? whole.toString() + "." + fraction : whole.toString();
}
function estimateSalesReturn(invoice: InvoiceDetail, quantities: Record<string, string>, restock: Record<string, boolean>): ReturnEstimate {
  const lines: ReturnEstimate["lines"] = [];
  let total = 0n;
  let invalid = false;
  for (const line of invoice.lines) {
    const text = quantities[line.id]?.trim();
    if (!text) continue;
    try {
      const quantity = parseQuantityMilli(text);
      const originalQuantity = parseQuantityMilli(line.quantity);
      const remaining = originalQuantity - parseQuantityMilli(line.returnedQuantity || "0");
      if (quantity > remaining || quantity <= 0n) { invalid = true; continue; }
      const base = (quantity * BigInt(line.unitPriceRial) + 500n) / 1000n;
      const completesRemaining = quantity === remaining;
      const discount = completesRemaining ? BigInt(line.discountRial) - BigInt(line.returnedDiscountRial || "0") : (BigInt(line.discountRial) * quantity + originalQuantity / 2n) / originalQuantity;
      const taxable = base - discount;
      const tax = completesRemaining ? BigInt(line.taxRial) - BigInt(line.returnedTaxRial || "0") : (taxable * BigInt(line.taxRateBasisPoints) + 5000n) / 10000n;
      const amount = taxable + tax;
      if (amount <= 0n) { invalid = true; continue; }
      total += amount;
      lines.push({ invoiceLineId: line.id, quantity: text, restock: line.restockAllowed && (restock[line.id] ?? true) });
    } catch { invalid = true; }
  }
  return { lines, total, invalid };
}

export function PurchaseDetailsPage({ currency, branchName }: { currency: MoneyCurrency; branchName: string }) {
  const { id = "" } = useParams();
  const invalidate = useInvalidate(); const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false); const [postOpen, setPostOpen] = useState(false); const [deleteOpen, setDeleteOpen] = useState(false); const [voidOpen, setVoidOpen] = useState(false); const [quickPartyOpen, setQuickPartyOpen] = useState(false); const [quickProductOpen, setQuickProductOpen] = useState(false); const [quickAccountOpen, setQuickAccountOpen] = useState(false); const [quickProductIndex, setQuickProductIndex] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayISO()); const [supplierId, setSupplierId] = useState(""); const [note, setNote] = useState(""); const [payment, setPayment] = useState(""); const [accountId, setAccountId] = useState(""); const [lineRows, setLineRows] = useState<Array<{ productId: string; quantity: string; unitCost: string; discount: string }>>([]);
  const query = useQuery({ queryKey: ["purchase-detail", id], queryFn: () => get<PurchaseDetail>("/purchases/" + id), enabled: !!id });
  const purchase = query.data;
  const suppliers = useQuery({ queryKey: ["purchase-suppliers"], queryFn: () => get<Array<{ id: string; name: string }>>("/suppliers"), enabled: editOpen });
  const products = useQuery({ queryKey: ["purchase-products"], queryFn: () => get<Array<{ id: string; name: string; kind: string; defaultCostRial?: string | null }>>("/products"), enabled: editOpen });
  const supplierPickerOptions = partyPicker("SUPPLIER"); const stockProductPickerOptions = productPicker("STOCK");
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => get<Array<{ id: string; name: string }>>("/finance/accounts"), enabled: postOpen });
  const openEdit = () => { if (!purchase) return; setDate(purchase.date); setSupplierId(purchase.supplierId ?? ""); setNote(purchase.note ?? ""); setLineRows(purchase.lines.map((line) => ({ productId: line.productId ?? "", quantity: line.quantity, unitCost: rialToDisplay(line.unitCostRial, currency), discount: rialToDisplay(line.discountRial, currency) })).length ? purchase.lines.map((line) => ({ productId: line.productId ?? "", quantity: line.quantity, unitCost: rialToDisplay(line.unitCostRial, currency), discount: rialToDisplay(line.discountRial, currency) })) : [{ productId: "", quantity: "1", unitCost: "", discount: "" }]); setError(""); setEditOpen(true); };
  const saveDraft = async (event: FormEvent) => { event.preventDefault(); if (!lineRows.length || lineRows.some((line) => !line.productId)) { setError("برای هر ردیف یک کالا انتخاب کنید."); return; } setBusy(true); setError(""); try { await patch("/purchases/" + id, { supplierId: supplierId || undefined, txnDate: date, note: note || undefined, lines: lineRows.map((line) => ({ productId: line.productId, quantity: line.quantity, unitCostRial: displayToRial(line.unitCost, currency), discountRial: line.discount ? displayToRial(line.discount, currency) : undefined })) }); setEditOpen(false); await invalidate(); await query.refetch(); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); } };
  const deleteDraft = async () => { setBusy(true); setError(""); try { await del("/purchases/" + id); await invalidate(); navigate("/app/purchases"); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); } };
  const postDraft = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { const amount = payment ? displayToRial(payment, currency) : "0"; if (amount !== "0" && !accountId) throw new Error("برای پرداخت، حساب مالی را انتخاب کنید."); await post("/purchases/" + id + "/post", { payments: amount !== "0" ? [{ amountRial: amount, financeAccountId: accountId, method: "CASH" }] : [] }, { "Idempotency-Key": newOperationId() }); trackOnboardingEvent("first_document_posted", "first_operation"); setPostOpen(false); await invalidate(); await query.refetch(); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); } };
  const voidPurchase = async () => { setBusy(true); setError(""); try { await post("/purchases/" + id + "/void", { reason }, { "Idempotency-Key": newOperationId() }); setVoidOpen(false); await invalidate(); await query.refetch(); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); } };
  const title = purchase ? "خرید " + (purchase.purchaseNo ?? "پیش‌نویس") : "جزئیات خرید";
  return <PageHeader title={title} subtitle="مرور سند، تأمین‌کننده و وضعیت خرید">
    {query.isPending ? <LoadingBlock /> : query.isError ? <InlineError error={query.error} retry={() => void query.refetch()} />   : purchase && <div className="purchase-detail-page">
      <div className="purchase-detail-accessbar" role="group" aria-label="عملیات خرید">
        <div className="purchase-detail-access-copy"><span className="icon-tile emerald"><ShoppingBag size={18} /></span><span><small>{statusLabel(purchase.status)}</small><strong>{purchase.purchaseNo ?? "پیش‌نویس خرید"}</strong></span></div>
        <div className="purchase-detail-actions">
          {purchase.status === "DRAFT" && <><button type="button" className="button button-secondary" onClick={openEdit}><Pencil size={15} />ویرایش پیش‌نویس</button><button type="button" className="button button-primary" onClick={() => { setError(""); setPostOpen(true); }}>ثبت نهایی خرید</button><button type="button" className="button button-danger" onClick={() => { setError(""); setDeleteOpen(true); }}><Trash2 size={15} />حذف پیش‌نویس</button></>}
          {purchase.status === "POSTED" && <button type="button" className="button button-danger" onClick={() => { setReason(""); setError(""); setVoidOpen(true); }}>ابطال خرید</button>}
          <Link className="button button-secondary" to="/app/inventory"><Boxes size={15} />موجودی انبار</Link><Link className="button button-secondary" to="/app/purchases"><ShoppingBag size={15} />فهرست خرید</Link>
        </div>
      </div>
      <section className="card purchase-detail-hero">
        <div className="purchase-detail-hero-heading"><div className="purchase-detail-hero-copy"><div className="purchase-detail-badges"><span className={"status-badge " + purchase.status.toLowerCase()}>{statusLabel(purchase.status)}</span><span className="purchase-detail-document-kind">سند خرید</span></div><h2>{purchase.supplier?.name ?? "خرید بدون تأمین‌کننده"}</h2><p>{purchase.supplier?.phone ?? "شمارهٔ همراه ثبت نشده"}{purchase.supplier?.email ? " · " + purchase.supplier.email : ""}</p></div><div className="purchase-detail-total"><small>جمع کل خرید</small><strong>{money(purchase.totalRial, currency)}</strong><span>{faNumber(purchase.lines.length)} ردیف کالا</span></div></div>
        <div className="purchase-detail-facts"><DetailField label="شمارهٔ خرید" value={<bdi dir="ltr">{purchase.purchaseNo ?? "پیش‌نویس"}</bdi>} /><DetailField label="تاریخ خرید" value={jalaliDate(purchase.date)} /><DetailField label="شعبه" value={branchName || "شعبهٔ جاری"} />{purchase.dueDate && <DetailField label="سررسید" value={jalaliDate(purchase.dueDate)} />}<DetailField label="تأمین‌کننده" value={purchase.supplierId ? <Link className="purchase-party-link" to={"/app/suppliers/" + purchase.supplierId}>{purchase.supplier?.name ?? "مشاهدهٔ طرف‌حساب"}<ChevronLeft size={13} /></Link> : "ثبت نشده"} /><DetailField label="نشانی" value={purchase.supplier?.address ?? "ثبت نشده"} /></div>
        {purchase.note && <div className="purchase-detail-note"><small>توضیح سند</small><p>{purchase.note}</p></div>}
      </section>
      <section className="card purchase-detail-lines"><SectionTitle title="اقلام خرید" action={<span className="purchase-detail-line-count">{faNumber(purchase.lines.length)} ردیف</span>} />
        {purchase.lines.length ? <div className="purchase-detail-line-list">{purchase.lines.map((line, index) => <article className="purchase-detail-line" key={index}>
          <div className="purchase-detail-line-product"><span className="product-avatar"><Boxes size={17} /></span><span><strong>{line.description}</strong><small>{line.sku ? "کد کالا · " + line.sku : line.unit ?? "واحد ثبت نشده"}</small></span></div>
          <div className="purchase-detail-line-metrics"><span><small>تعداد</small><strong>{faNumber(line.quantity)} <i>{line.unit ?? "واحد"}</i></strong></span><span><small>بهای واحد</small><strong>{money(line.unitCostRial, currency)}</strong></span><span><small>تخفیف</small><strong>{money(line.discountRial, currency)}</strong></span><span><small>مالیات</small><strong>{money(line.taxRial, currency)} <i>({faNumber(line.taxRateBasisPoints / 100)}٪)</i></strong></span></div><div className="purchase-detail-line-total"><small>جمع ردیف</small><strong>{money(line.totalRial, currency)}</strong></div>
        </article>)}</div> : <EmptyState icon={Boxes} title="قلمی در خرید ثبت نشده" text="اقلام سند خرید پس از ثبت یا ویرایش اینجا نمایش داده می‌شوند." />}
      </section>
      <section className="card purchase-detail-summary">
        <div className="purchase-detail-financials"><SectionTitle title="خلاصهٔ مالی" /><div className="purchase-detail-totals"><div><span>جمع اقلام</span><strong>{money(purchase.subtotalRial, currency)}</strong></div><div><span>تخفیف کل</span><strong>{money(purchase.discountRial, currency)}</strong></div><div><span>مالیات</span><strong>{money(purchase.taxRial, currency)}</strong></div><div className="is-grand-total"><span>جمع نهایی</span><strong>{money(purchase.totalRial, currency)}</strong></div></div></div>
        <aside className="purchase-detail-payment"><div className="purchase-detail-payment-heading"><span className="icon-tile blue"><Wallet size={17} /></span><span><small>تسویه و پرداخت</small><strong>{purchase.payments.length ? faNumber(purchase.payments.length) + " پرداخت ثبت‌شده" : purchase.status === "POSTED" ? "بدون پرداخت نقدی" : "پس از بازبینی نهایی کنید"}</strong></span></div>{purchase.payments.length ? <div className="purchase-detail-payment-list">{purchase.payments.map((payment, index) => <div key={index}><span>{payment.account ?? "حساب مالی"}<small>{methodLabel(payment.method)}</small></span><strong>{money(payment.amountRial, currency)}</strong></div>)}</div> : <p>{purchase.status === "DRAFT" ? "در مرحلهٔ ثبت نهایی، پرداخت را وارد کنید یا خرید را به‌صورت بدهی ثبت کنید." : "این سند به‌صورت پرداخت‌نشده یا اعتباری ثبت شده است."}</p>}</aside>
      </section>
    </div>}
    <Modal open={editOpen} onClose={() => setEditOpen(false)} title="ویرایش پیش‌نویس خرید" description="با ذخیره، اقلام و جمع پیش‌نویس دوباره محاسبه می‌شوند." size="wide"><form className="purchase-edit-form" onSubmit={(event) => void saveDraft(event)}><div className="form-grid"><JalaliDatePicker value={date} onChange={setDate} label="تاریخ خرید" /><SelectField label="تأمین‌کننده" value={supplierId} onChange={setSupplierId} options={(suppliers.data ?? []).map((row) => ({ value: row.id, label: row.name }))} optionsKey={supplierPickerOptions.key} loadOptions={supplierPickerOptions.load} placeholder="بدون تأمین‌کننده" onAdd={() => setQuickPartyOpen(true)} /><Field label="توضیح" value={note} onChange={setNote} placeholder="اختیاری" /></div>{lineRows.map((line, index) => <div className="form-grid draft-line-editor" key={index}><SelectField label={`کالا ${faNumber(index + 1)}`} value={line.productId} onChange={(value) => { const selected = (products.data ?? []).find((row) => row.id === value); const defaultCost = selected?.defaultCostRial ? rialToDisplay(selected.defaultCostRial, currency) : ""; setLineRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, productId: value, unitCost: row.productId === value ? row.unitCost : defaultCost } : row)); }} options={(products.data ?? []).filter((row) => row.kind === "STOCK").map((row) => ({ value: row.id, label: row.name }))} optionsKey={stockProductPickerOptions.key} loadOptions={stockProductPickerOptions.load} onAdd={() => { setQuickProductIndex(index); setQuickProductOpen(true); }} /><Field label="تعداد" value={line.quantity} onChange={(value) => setLineRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: value } : row))} inputMode="decimal" required /><Field label={`بهای واحد (${currency === "IRT" ? "تومان" : "ریال"})`} value={line.unitCost} onChange={(value) => setLineRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, unitCost: value } : row))} inputMode="decimal" required /><Field label="تخفیف ردیف" value={line.discount} onChange={(value) => setLineRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, discount: value } : row))} inputMode="decimal" placeholder="۰" />{lineRows.length > 1 && <button type="button" className="button button-danger" onClick={() => setLineRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>حذف ردیف</button>}</div>)}<button type="button" className="button button-text" onClick={() => setLineRows((rows) => [...rows, { productId: "", quantity: "1", unitCost: "", discount: "" }])}>افزودن ردیف کالا</button>{error && <InlineError error={error} />}{products.isError && <InlineError error={products.error} retry={() => void products.refetch()} />}<div className="modal-form-actions"><SubmitButton busy={busy}>ذخیرهٔ پیش‌نویس</SubmitButton></div></form></Modal>
    <Modal open={postOpen} onClose={() => setPostOpen(false)} title="ثبت نهایی خرید" description="اطلاعات شعبه و سند را بازبینی کنید؛ با ثبت نهایی، موجودی و دفتر مالی به‌روزرسانی می‌شود."><form onSubmit={(event) => void postDraft(event)}>{purchase && <div className="onboarding-operation-review" aria-label="بازبینی سند خرید"><span><small>شعبه</small><strong>{branchName || "شعبهٔ جاری"}</strong></span><span><small>تاریخ خرید</small><strong>{jalaliDate(purchase.date)}</strong></span><span><small>جمع کل</small><strong>{money(purchase.totalRial, currency)}</strong></span></div>}<div className="form-grid"><Field label={`مبلغ پرداخت فعلی (${currency === "IRT" ? "تومان" : "ریال"})`} value={payment} onChange={setPayment} inputMode="decimal" placeholder="۰ برای پرداخت‌نشده" /><SelectField label="حساب پرداخت" value={accountId} onChange={setAccountId} options={(accounts.data ?? []).map((row) => ({ value: row.id, label: row.name }))} placeholder="بدون پرداخت فعلی" onAdd={() => setQuickAccountOpen(true)} /></div>{error && <InlineError error={error} />}{accounts.isError && <InlineError error={accounts.error} retry={() => void accounts.refetch()} />}<div className="modal-form-actions"><SubmitButton busy={busy}>تأیید ثبت نهایی</SubmitButton></div></form></Modal>
    <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="حذف پیش‌نویس خرید" description="این پیش‌نویس هنوز اثری در موجودی یا دفتر مالی ندارد."><p>پیش‌نویس خرید حذف شود؟</p>{error && <InlineError error={error} />}<div className="modal-form-actions"><button type="button" className="button button-danger" disabled={busy} onClick={() => void deleteDraft()}>{busy ? "در حال حذف…" : "تأیید حذف"}</button></div></Modal>
    <Modal open={voidOpen} onClose={() => setVoidOpen(false)} title="ابطال خرید ثبت‌شده" description="ابطال یک سند برگشت حسابداری ایجاد می‌کند. موجودی فقط وقتی برمی‌گردد که گردش دیگری از همان کالا ثبت نشده باشد."><Field label="دلیل ابطال" value={reason} onChange={setReason} required /><p className="muted">سند اصلی حذف نمی‌شود و در سابقه باقی می‌ماند.</p>{error && <InlineError error={error} />}<div className="modal-form-actions"><button type="button" className="button button-danger" disabled={busy || reason.trim().length < 3} onClick={() => void voidPurchase()}>{busy ? "در حال ابطال…" : "تأیید ابطال"}</button></div></Modal>
    <QuickPartyModal open={quickPartyOpen} type="SUPPLIER" onClose={() => setQuickPartyOpen(false)} onCreated={(party) => { setSupplierId(party.id); void invalidate(); }} /><QuickProductModal open={quickProductOpen} currency={currency} onClose={() => setQuickProductOpen(false)} onCreated={(product) => { setLineRows((rows) => rows.map((row, index) => index === quickProductIndex ? { ...row, productId: product.id } : row)); void invalidate(); }} /><QuickAccountModal open={quickAccountOpen} onClose={() => setQuickAccountOpen(false)} onCreated={(account) => { setAccountId(account.id); void invalidate(); }} />
  </PageHeader>;
}

export function ExpenseDetailsPage({ currency, branchName }: { currency: MoneyCurrency; branchName: string }) {
  const { id = "" } = useParams();
  const invalidate = useInvalidate(); const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false); const [postOpen, setPostOpen] = useState(false); const [deleteOpen, setDeleteOpen] = useState(false); const [voidOpen, setVoidOpen] = useState(false); const [quickPartyOpen, setQuickPartyOpen] = useState(false); const [quickCategoryOpen, setQuickCategoryOpen] = useState(false); const [quickAccountOpen, setQuickAccountOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayISO()); const [amount, setAmount] = useState(""); const [categoryId, setCategoryId] = useState(""); const [payeeId, setPayeeId] = useState(""); const [taxPercent, setTaxPercent] = useState("0"); const [note, setNote] = useState(""); const [accountId, setAccountId] = useState("");
  const query = useQuery({ queryKey: ["expense-detail", id], queryFn: () => get<ExpenseDetail>("/expenses/" + id), enabled: !!id });
  const expense = query.data;
  const categories = useQuery({ queryKey: ["expense-categories"], queryFn: () => get<Array<{ id: string; name: string }>>("/expenses/categories"), enabled: editOpen });
  const parties = useQuery({ queryKey: ["expense-payees"], queryFn: () => get<Array<{ id: string; name: string }>>("/suppliers"), enabled: editOpen });
  const payeePickerOptions = partyPicker("SUPPLIER");
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => get<Array<{ id: string; name: string }>>("/finance/accounts"), enabled: postOpen });
  const openEdit = () => { if (!expense) return; setDate(expense.date); setAmount(rialToDisplay(expense.amountRial, currency)); setCategoryId(expense.categoryId); setPayeeId(expense.payeeId ?? ""); setTaxPercent(String(expense.taxRateBasisPoints / 100)); setNote(expense.note ?? ""); setError(""); setEditOpen(true); };
  const saveDraft = async (event: FormEvent) => { event.preventDefault(); const rate = Number(taxPercent); if (!Number.isFinite(rate) || rate < 0 || rate > 100) { setError("نرخ مالیات باید بین صفر تا ۱۰۰ درصد باشد."); return; } setBusy(true); setError(""); try { await patch("/expenses/" + id, { amountRial: displayToRial(amount, currency), categoryId, payeeId: payeeId || undefined, txnDate: date, note: note || undefined, taxRateBasisPoints: Math.round(rate * 100) }); setEditOpen(false); await invalidate(); await query.refetch(); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); } };
  const deleteDraft = async () => { setBusy(true); setError(""); try { await del("/expenses/" + id); await invalidate(); navigate("/app/expenses"); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); } };
  const postDraft = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { await post("/expenses/" + id + "/post", { financeAccountId: accountId || undefined }, { "Idempotency-Key": newOperationId() }); trackOnboardingEvent("first_document_posted", "first_operation"); setPostOpen(false); await invalidate(); await query.refetch(); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); } };
  const voidExpense = async () => { setBusy(true); setError(""); try { await post("/expenses/" + id + "/void", { reason }, { "Idempotency-Key": newOperationId() }); setVoidOpen(false); await invalidate(); await query.refetch(); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); } };
  return <PageHeader title={expense ? "هزینه " + (expense.expenseNo ?? "") : "جزئیات هزینه"} subtitle="اطلاعات کامل سند هزینه" actions={<div className="detail-actions">{expense?.status === "DRAFT" && <><button type="button" className="button button-secondary" onClick={openEdit}><Pencil size={16} />ویرایش پیش‌نویس</button><button type="button" className="button button-primary" onClick={() => { setError(""); setPostOpen(true); }}>ثبت نهایی هزینه</button><button type="button" className="button button-danger" onClick={() => { setError(""); setDeleteOpen(true); }}>حذف پیش‌نویس</button></>}{expense?.status === "POSTED" && <button type="button" className="button button-danger" onClick={() => { setReason(""); setError(""); setVoidOpen(true); }}>ابطال هزینه</button>}<Link className="button button-secondary" to="/app/expenses"><ReceiptText size={16} />بازگشت به هزینه‌ها</Link></div>}>
    {query.isPending ? <LoadingBlock /> : query.isError ? <InlineError error={query.error} retry={() => void query.refetch()} /> : expense && <section className="card detail-page"><SectionTitle title="اطلاعات هزینه" /><div className="detail-grid"><DetailField label="شمارهٔ سند" value={expense.expenseNo ?? "پیش‌نویس"} /><DetailField label="تاریخ" value={jalaliDate(expense.date)} /><DetailField label="دسته‌بندی" value={expense.category} /><DetailField label="پرداخت‌کننده" value={expense.payee?.name ?? "ثبت نشده"} /><DetailField label="شمارهٔ همراه" value={expense.payee?.phone ?? "ثبت نشده"} /><DetailField label="وضعیت" value={statusLabel(expense.status)} /><DetailField label="مبلغ" value={money(expense.amountRial, currency)} /><DetailField label="نرخ مالیات" value={faNumber(expense.taxRateBasisPoints / 100) + "٪"} /><DetailField label="مالیات" value={money(expense.taxRial, currency)} /></div>{expense.note && <p className="muted">توضیح: {expense.note}</p>}</section>}
    {expense && <ExpenseAttachmentCard expense={expense} onChanged={() => query.refetch()} />}
    <Modal open={editOpen} onClose={() => setEditOpen(false)} title="ویرایش پیش‌نویس هزینه"><form onSubmit={(event) => void saveDraft(event)}><div className="form-grid"><JalaliDatePicker value={date} onChange={setDate} label="تاریخ هزینه" /><Field label={`مبلغ (${currency === "IRT" ? "تومان" : "ریال"})`} value={amount} onChange={setAmount} inputMode="decimal" required /><SelectField label="دسته‌بندی" value={categoryId} onChange={setCategoryId} options={(categories.data ?? []).map((row) => ({ value: row.id, label: row.name }))} onAdd={() => setQuickCategoryOpen(true)} /><SelectField label="پرداخت‌کننده" value={payeeId} onChange={setPayeeId} options={(parties.data ?? []).map((row) => ({ value: row.id, label: row.name }))} optionsKey={payeePickerOptions.key} loadOptions={payeePickerOptions.load} placeholder="بدون پرداخت‌کننده" onAdd={() => setQuickPartyOpen(true)} /><Field label="نرخ مالیات (درصد)" value={taxPercent} onChange={setTaxPercent} inputMode="decimal" /><Field label="توضیح" value={note} onChange={setNote} /></div>{error && <InlineError error={error} />}{categories.isError && <InlineError error={categories.error} retry={() => void categories.refetch()} />}<div className="modal-form-actions"><SubmitButton busy={busy}>ذخیرهٔ پیش‌نویس</SubmitButton></div></form></Modal>
    <Modal open={postOpen} onClose={() => setPostOpen(false)} title="ثبت نهایی هزینه" description="اطلاعات شعبه و هزینه را بازبینی کنید؛ با ثبت نهایی، سند وارد دفتر مالی می‌شود."><form onSubmit={(event) => void postDraft(event)}>{expense && <div className="onboarding-operation-review" aria-label="بازبینی سند هزینه"><span><small>شعبه</small><strong>{branchName || "شعبهٔ جاری"}</strong></span><span><small>تاریخ هزینه</small><strong>{jalaliDate(expense.date)}</strong></span><span><small>مبلغ</small><strong>{money(expense.amountRial, currency)}</strong></span></div>}<SelectField label="پرداخت از حساب" value={accountId} onChange={setAccountId} options={(accounts.data ?? []).map((row) => ({ value: row.id, label: row.name }))} placeholder="ثبت به‌عنوان بدهی" onAdd={() => setQuickAccountOpen(true)} />{error && <InlineError error={error} />}{accounts.isError && <InlineError error={accounts.error} retry={() => void accounts.refetch()} />}<div className="modal-form-actions"><SubmitButton busy={busy}>تأیید ثبت نهایی</SubmitButton></div></form></Modal>
    <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="حذف پیش‌نویس هزینه" description="این پیش‌نویس هنوز در دفتر مالی ثبت نشده است."><p>پیش‌نویس هزینه حذف شود؟</p>{error && <InlineError error={error} />}<div className="modal-form-actions"><button type="button" className="button button-danger" disabled={busy} onClick={() => void deleteDraft()}>{busy ? "در حال حذف…" : "تأیید حذف"}</button></div></Modal>
    <Modal open={voidOpen} onClose={() => setVoidOpen(false)} title="ابطال هزینهٔ ثبت‌شده" description="سند اصلی حفظ می‌شود و یک سند برگشت حسابداری برای آن ثبت خواهد شد."><Field label="دلیل ابطال" value={reason} onChange={setReason} required />{error && <InlineError error={error} />}<div className="modal-form-actions"><button type="button" className="button button-danger" disabled={busy || reason.trim().length < 3} onClick={() => void voidExpense()}>{busy ? "در حال ابطال…" : "تأیید ابطال"}</button></div></Modal>
    <QuickPartyModal open={quickPartyOpen} type="SUPPLIER" onClose={() => setQuickPartyOpen(false)} onCreated={(party) => { setPayeeId(party.id); void invalidate(); }} /><QuickExpenseCategoryModal open={quickCategoryOpen} onClose={() => setQuickCategoryOpen(false)} onCreated={(category) => { setCategoryId(category.id); void invalidate(); }} /><QuickAccountModal open={quickAccountOpen} onClose={() => setQuickAccountOpen(false)} onCreated={(account) => { setAccountId(account.id); void invalidate(); }} />
  </PageHeader>;
}

function ExpenseAttachmentCard({ expense, onChanged }: { expense: ExpenseDetail; onChanged: () => Promise<unknown> }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removeOpen, setRemoveOpen] = useState(false);
  const editable = expense.status === "DRAFT" && expense.canManageAttachment;
  const upload = async () => {
    if (!file) return;
    setBusy(true); setError("");
    try { await uploadFile<ExpenseAttachment>(`/expenses/${expense.id}/attachment`, file); setFile(null); await onChanged(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const download = async () => {
    if (!expense.attachment) return;
    setBusy(true); setError("");
    try {
      const grant = await post<{ token: string }>(`/expenses/${expense.id}/attachment/download-token`);
      const blob = await downloadFile(`/expenses/${expense.id}/attachment`, { "X-Attachment-Download-Token": grant.token });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = expense.attachment.fileName; document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError("");
    try { await del(`/expenses/${expense.id}/attachment`); setRemoveOpen(false); await onChanged(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  return <section className="card expense-attachment-card">
    <SectionTitle title="رسید و پیوست هزینه" />
    {expense.attachment ? <div className="attachment-file-row"><div className="attachment-file-info"><FileText size={19} /><div><strong>{expense.attachment.fileName}</strong><small>{attachmentTypeLabel(expense.attachment.mimeType)} · {formatFileSize(expense.attachment.bytes)}</small></div></div><div className="attachment-file-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => void download()}><Download size={15} />دریافت فایل</button>{editable && <button type="button" className="button button-danger" disabled={busy} onClick={() => setRemoveOpen(true)}><Trash2 size={15} />برداشتن</button>}</div></div> : <p className="muted">برای این هزینه فایلی ثبت نشده است.</p>}
    {editable && !expense.attachment && <div className="attachment-upload-row"><label className="attachment-file-picker"><span>انتخاب رسید یا تصویر</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { setFile(event.currentTarget.files?.[0] ?? null); setError(""); }} /></label><button type="button" className="button button-primary" disabled={!file || busy} onClick={() => void upload()}><Upload size={15} />{busy ? "در حال بارگذاری…" : "افزودن پیوست"}</button><small>PDF، JPEG، PNG یا WebP · حداکثر ۱۰ مگابایت</small></div>}
    {expense.status !== "DRAFT" && <p className="muted">پس از ثبت نهایی، پیوست فقط برای دریافت در دسترس است.</p>}
    {error && <InlineError error={error} />}
    <Modal open={removeOpen} onClose={() => { if (!busy) setRemoveOpen(false); }} title="برداشتن پیوست" description="فایل فقط از پیش‌نویس هزینه برداشته می‌شود."><p>پیوست «{expense.attachment?.fileName}» برداشته شود؟</p>{error && <InlineError error={error} />}<div className="modal-form-actions"><button type="button" className="button button-danger" disabled={busy} onClick={() => void remove()}>{busy ? "در حال برداشتن…" : "تأیید برداشتن"}</button></div></Modal>
  </section>;
}

export function StockCountDetailsPage() {
  const { id = "" } = useParams();
  const query = useQuery({ queryKey: ["stock-count", id], queryFn: () => get<StockCount>("/inventory/counts/" + id), enabled: !!id });
  const count = query.data;
  return <PageHeader title="جزئیات شمارش موجودی" subtitle="اقلام و اختلاف ثبت‌شده در این شمارش" actions={<Link className="button button-secondary" to="/app/inventory"><Boxes size={16} />بازگشت به انبار</Link>}>
    {query.isPending ? <LoadingBlock /> : query.isError ? <InlineError error={query.error} retry={() => void query.refetch()} /> : !count ? <EmptyState icon={RotateCw} title="شمارش پیدا نشد" text="ممکن است شمارش متعلق به شعبهٔ دیگری باشد." /> : <section className="card detail-page"><SectionTitle title={count.reason} /><div className="detail-grid"><DetailField label="تاریخ" value={jalaliDate(count.txnDate)} /><DetailField label="وضعیت" value={statusLabel(count.status)} /><DetailField label="تعداد اقلام" value={faNumber(count.lines.length)} /></div>{count.lines.map((line) => <article className="detail-line" key={line.productId}><div><strong>{line.product}</strong><small>موجودی سیستم: {faNumber(line.systemQuantity)} {line.unit}</small></div><span>شمارش: {faNumber(line.countedQuantity)} {line.unit}</span><strong>اختلاف: {faNumber(line.deltaQuantity)}</strong></article>)}</section>}
  </PageHeader>;
}

export function FinanceDetailsPage({ currency }: { currency: MoneyCurrency }) {
  const { kind = "", id = "" } = useParams();
  const invalidate = useInvalidate();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accounts = useQuery({ queryKey: ["finance-account-detail", id], queryFn: () => get<{ id: string; name: string; kind: string; balanceRial: string; isActive: boolean }>("/finance/accounts/" + id), enabled: kind === "account" && !!id });
  const transactions = useQuery({ queryKey: ["transaction", sessionStorage.getItem("shopro_business_id"), sessionStorage.getItem("shopro_branch_id"), id], queryFn: () => get<{ id: string; kind: string; date: string; amountRial: string; fromAccount: string | null; toAccount: string | null; party: string | null; method: string; reference: string | null; status: string; canVoid: boolean }>("/finance/transactions/" + id), enabled: kind === "transaction" && !!id });
  const closes = useQuery({ queryKey: ["cash-close", sessionStorage.getItem("shopro_business_id"), sessionStorage.getItem("shopro_branch_id"), id], queryFn: () => get<{ id: string; date: string; account: string; systemBalanceRial: string; countedBalanceRial: string; differenceRial: string; note: string | null }>("/finance/cash-closes/" + id), enabled: kind === "close" && !!id });
  const account = accounts.data;
  useEffect(() => { if (account) setAccountName(account.name); }, [account?.name]);
  const transaction = transactions.data;
  const close = closes.data;
  const query = kind === "account" ? accounts : kind === "transaction" ? transactions : closes;
  const title = kind === "account" ? (account?.name ?? "جزئیات حساب") : kind === "transaction" ? "جزئیات تراکنش" : "جزئیات بستن صندوق";
  const saveAccount = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await patch("/finance/accounts/" + id, { name: accountName }); setEditOpen(false); await invalidate(); void accounts.refetch(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const archiveAccount = async () => {
    setBusy(true); setError("");
    try { await patch("/finance/accounts/" + id, { isActive: false }); setArchiveOpen(false); await invalidate(); navigate("/app/finance"); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const voidTransaction = async () => {
    setBusy(true); setError("");
    try { await post("/finance/transactions/" + id + "/void", { reason: voidReason }, { "Idempotency-Key": newOperationId() }); setVoidOpen(false); await invalidate(); void transactions.refetch(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  return <PageHeader title={title} subtitle="اطلاعات ثبت‌شده در این شعبه" actions={<div className="detail-actions">{kind === "account" && account?.isActive && <><button type="button" className="button button-secondary" onClick={() => { setAccountName(account.name); setError(""); setEditOpen(true); }}><Pencil size={16} />ویرایش حساب</button><button type="button" className="button button-danger" onClick={() => { setError(""); setArchiveOpen(true); }}><Archive size={16} />بایگانی حساب</button></>}{kind === "transaction" && transaction?.canVoid && <button type="button" className="button button-danger" onClick={() => { setVoidReason(""); setError(""); setVoidOpen(true); }}>ابطال تراکنش</button>}<Link className="button button-secondary" to="/app/finance"><Wallet size={16} />بازگشت به صندوق و بانک</Link></div>}>
    {query.isPending ? <LoadingBlock /> : query.isError ? <InlineError error={query.error} retry={() => void query.refetch()} /> : account ? <section className="card detail-page"><SectionTitle title="حساب مالی" /><div className="detail-grid"><DetailField label="نام حساب" value={account.name} /><DetailField label="نوع حساب" value={accountKindLabel(account.kind)} /><DetailField label="ماندهٔ جاری" value={money(account.balanceRial, currency)} /><DetailField label="وضعیت" value={account.isActive ? "فعال" : "بایگانی‌شده"} /></div></section> : transaction ? <section className="card detail-page"><SectionTitle title={cashKindLabel(transaction.kind)} /><div className="detail-grid"><DetailField label="تاریخ" value={jalaliDate(transaction.date)} /><DetailField label="مبلغ" value={money(transaction.amountRial, currency)} /><DetailField label="حساب مبدأ" value={transaction.fromAccount ?? "ثبت نشده"} /><DetailField label="حساب مقصد" value={transaction.toAccount ?? "ثبت نشده"} /><DetailField label="طرف‌حساب" value={transaction.party ?? "ثبت نشده"} /><DetailField label="روش" value={methodLabel(transaction.method)} /><DetailField label="مرجع" value={transaction.reference ?? "ثبت نشده"} /><DetailField label="وضعیت" value={transaction.status === "REVERSED" ? "ابطال‌شده" : "ثبت‌شده"} /></div></section> : close ? <section className="card detail-page"><SectionTitle title="بستن صندوق" /><div className="detail-grid"><DetailField label="تاریخ" value={jalaliDate(close.date)} /><DetailField label="حساب" value={close.account} /><DetailField label="ماندهٔ دفتری" value={money(close.systemBalanceRial, currency)} /><DetailField label="موجودی شمارش‌شده" value={money(close.countedBalanceRial, currency)} /><DetailField label="اختلاف" value={money(close.differenceRial, currency)} /></div>{close.note && <p className="muted">توضیح: {close.note}</p>}</section> : <EmptyState icon={Wallet} title="مورد پیدا نشد" text="این مورد در فهرست اطلاعات شعبهٔ جاری در دسترس نیست." />}
    <Modal open={editOpen} onClose={() => setEditOpen(false)} title="ویرایش حساب مالی"><form onSubmit={(event) => void saveAccount(event)}><Field label="نام حساب" value={accountName} onChange={setAccountName} required />{error && <InlineError error={error} />}<div className="modal-form-actions"><SubmitButton busy={busy}>ذخیرهٔ تغییرات</SubmitButton></div></form></Modal>
    <Modal open={archiveOpen} onClose={() => setArchiveOpen(false)} title="بایگانی حساب" description="حساب دارای مانده بایگانی نمی‌شود؛ سوابق قبلی حفظ می‌شوند."><p>حساب «{account?.name}» بایگانی شود؟</p>{error && <InlineError error={error} />}<div className="modal-form-actions"><button type="button" className="button button-danger" disabled={busy} onClick={() => void archiveAccount()}>{busy ? "در حال بایگانی…" : "تأیید بایگانی"}</button></div></Modal>
    <Modal open={voidOpen} onClose={() => setVoidOpen(false)} title="ابطال تراکنش" description="تراکنش اصلی حذف نمی‌شود؛ دریافت یا پرداخت معکوس در سابقه ثبت خواهد شد."><Field label="دلیل ابطال" value={voidReason} onChange={setVoidReason} required />{error && <InlineError error={error} />}<div className="modal-form-actions"><button type="button" className="button button-danger" disabled={busy || voidReason.trim().length < 3} onClick={() => void voidTransaction()}>{busy ? "در حال ابطال…" : "تأیید ابطال"}</button></div></Modal>
  </PageHeader>;
}

function PartyDetailFact({ icon, label, value, wide = false }: { icon: ReactNode; label: string; value: ReactNode; wide?: boolean }) {
  return <div className={`party-detail-fact${wide ? " is-wide" : ""}`}>
    <span className="party-detail-fact-icon" aria-hidden="true">{icon}</span>
    <div className="party-detail-fact-copy"><small>{label}</small><div className="party-detail-fact-value">{value}</div></div>
  </div>;
}

function PartyStatementAmount({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return <div className={`party-statement-amount${emphasized ? " is-emphasized" : ""}`}><small>{label}</small><strong>{value}</strong></div>;
}

function DetailField({ label, value }: { label: string; value: ReactNode }) { return <div className="detail-field"><small>{label}</small><strong>{value}</strong></div>; }
function displayToRial(value: string, currency: MoneyCurrency) {
  const normalized = toAsciiDigits(value).replace(/[٬,\s]/g, "").replace(/٫/g, ".");
  if (currency === "IRT") { const match = /^(\d+)(?:\.(\d))?$/.exec(normalized); if (!match) throw new Error("مبلغ تومان را با حداکثر یک رقم اعشار وارد کنید."); return (BigInt(match[1]) * 10n + BigInt(match[2] ?? "0")).toString(); }
  if (!/^\d+$/.test(normalized)) throw new Error("مبلغ ریالی باید عدد صحیح باشد.");
  return BigInt(normalized).toString();
}
function rialToDisplay(value: string, currency: MoneyCurrency) { const amount = BigInt(value || "0"); return currency === "IRT" ? `${amount / 10n}.${amount % 10n}` : amount.toString(); }
function partyTypeLabel(value: string) { return ({ CUSTOMER: "مشتری", SUPPLIER: "تأمین‌کننده", BOTH: "مشتری و تأمین‌کننده" } as Record<string, string>)[value] ?? value; }
function statusLabel(value: string) { return ({ POSTED: "ثبت‌شده", DRAFT: "پیش‌نویس", VOIDED: "باطل‌شده" } as Record<string, string>)[value] ?? value; }
function sourceLabel(value: string) { return ({ SALE: "فروش", PURCHASE: "خرید", EXPENSE: "هزینه", STOCK_COUNT: "شمارش موجودی", PRODUCT_OPENING: "موجودی اولیه", RECEIPT: "دریافت وجه", PAYMENT: "پرداخت", TRANSFER: "انتقال" } as Record<string, string>)[value] ?? value; }
function productMovementLabel(value: string) { return sourceLabel(value); }
function cashKindLabel(value: string) { return ({ RECEIPT: "دریافت وجه", PAYMENT: "پرداخت", TRANSFER: "انتقال" } as Record<string, string>)[value] ?? value; }
function methodLabel(value: string) { return ({ CASH: "نقدی", POS: "کارت‌خوان", BANK: "بانکی", OTHER: "سایر" } as Record<string, string>)[value] ?? value; }
function accountKindLabel(value: string) { return ({ CASH: "صندوق", BANK: "بانک", POS: "کارت‌خوان", OTHER: "سایر" } as Record<string, string>)[value] ?? value; }
function attachmentTypeLabel(value: string) { return ({ "application/pdf": "PDF", "image/jpeg": "تصویر JPEG", "image/png": "تصویر PNG", "image/webp": "تصویر WebP" } as Record<string, string>)[value] ?? "فایل"; }
function formatFileSize(value: string) { const bytes = Number(value); if (!Number.isFinite(bytes) || bytes < 0) return ""; if (bytes >= 1024 * 1024) return `${faNumber((bytes / (1024 * 1024)).toFixed(1))} مگابایت`; if (bytes >= 1024) return `${faNumber((bytes / 1024).toFixed(1))} کیلوبایت`; return `${faNumber(bytes)} بایت`; }
