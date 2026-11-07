import { useEffect, useState, type ChangeEvent } from "react";
import { AlertTriangle, Camera, Check, FileImage, LoaderCircle, ScanLine, Sparkles, Upload } from "lucide-react";
import { normalizePersianSearch, toAsciiDigits } from "@shopro/contracts";
import { get, post, uploadFile } from "../lib/api.js";
import { faNumber, money } from "../lib/format.js";
import { Field, InlineError, SelectField, messageOf } from "../App.js";
import { Modal } from "./Modal.js";

export type SalesOcrCustomer = { name: string | null; phone: string | null; email: string | null; nationalId: string | null; address: string | null };
export type SalesOcrLine = { name: string | null; sku: string | null; barcode: string | null; kind: "STOCK" | "SERVICE" | null; quantity: string | null; unit: string | null; unitPriceRial: string | null; discountRial: string | null; taxRateBasisPoints: number | null; lineTotalRial: string | null; confidence: number };
export type SalesOcrCatalogMatch = { id: string; name: string; sku: string | null; barcode: string | null; kind: "STOCK" | "SERVICE"; unit: { id: string; code: string; labelFa: string; precision: number }; salePriceRial: string; taxRateBasisPoints: number; trackInventory: boolean; matchedBy: "barcode" | "sku" | "name" };
export type SalesOcrPartyMatch = { id: string; name: string; phone: string | null; matchedBy: "phone" | "name" };
export type SalesOcrAnalysis = {
  extraction: { customer: SalesOcrCustomer | null; invoiceDate: string | null; invoiceNumber: string | null; note: string | null; paidAmountRial: string | null; paymentMethod: "CASH" | "POS" | "BANK" | "OTHER" | null; paymentAccountName: string | null; totals: { subtotalRial: string | null; discountRial: string | null; taxRial: string | null; totalRial: string | null }; items: SalesOcrLine[]; warnings: string[] };
  customerMatches: SalesOcrPartyMatch[];
  items: Array<SalesOcrLine & { matches: SalesOcrCatalogMatch[] }>;
};
export type AppliedSalesOcr = { analysis: SalesOcrAnalysis; customer: SalesOcrPartyMatch | null; items: Array<{ extraction: SalesOcrLine; product: SalesOcrCatalogMatch | null }> };
type Currency = "IRR" | "IRT";
type Unit = { id: string; labelFa: string; precision: number };
export type CreatedOcrCatalogItem = SalesOcrCatalogMatch & { quantityOnHand?: string };

export function SalesOcrImportModal({ open, currency, onClose, onApply }: { open: boolean; currency: Currency; onClose: () => void; onApply: (value: AppliedSalesOcr) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [analysis, setAnalysis] = useState<SalesOcrAnalysis | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => { if (!open) { setFile(null); setAnalysis(null); setError(""); setBusy(false); } }, [open]);

  const chooseFile = (next: File | undefined) => {
    if (!next) return;
    setError(""); setAnalysis(null); setCustomerId(""); setItemIds([]);
    if (!next.type.startsWith("image/")) { setFile(null); setError("یک فایل تصویری انتخاب کنید."); return; }
    if (next.size > 12 * 1024 * 1024) { setFile(null); setError("حجم تصویر باید کمتر از ۱۲ مگابایت باشد."); return; }
    setFile(next);
  };
  const analyze = async () => {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const result = await uploadFile<SalesOcrAnalysis>("/sales/ocr", file);
      setAnalysis(result);
      const exactCustomer = result.customerMatches.filter((match) => match.matchedBy === "phone");
      setCustomerId(exactCustomer.length === 1 ? exactCustomer[0].id : "");
      setItemIds(result.items.map((item) => {
        const identifierMatches = item.matches.filter((match) => match.matchedBy !== "name");
        return identifierMatches.length === 1 ? identifierMatches[0].id : "";
      }));
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const apply = () => {
    if (!analysis) return;
    onApply({
      analysis,
      customer: analysis.customerMatches.find((match) => match.id === customerId) ?? null,
      items: analysis.items.map((item, index) => ({ extraction: item, product: item.matches.find((match) => match.id === itemIds[index]) ?? null })),
    });
    onClose();
  };
  const onInput = (event: ChangeEvent<HTMLInputElement>) => chooseFile(event.currentTarget.files?.[0]);

  return <Modal open={open} onClose={onClose} title="خواندن فاکتور از تصویر" description="تصویر برگه یا اسکرین‌شات بررسی می‌شود؛ پیش از ثبت، همهٔ موارد را در فرم بازبینی می‌کنید." size="wide">
    <div className="sales-ocr-flow">
      <div className="sales-ocr-privacy"><Sparkles size={17} /><span>پس از فشردن «خواندن تصویر»، عکس برای تحلیل به سرویس هوش مصنوعی OpenAI فرستاده می‌شود؛ شاپرو تصویر را ذخیره نمی‌کند.</span></div>
      {!analysis && <>
        <div className={`sales-ocr-dropzone ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}>
          {preview ? <img className="sales-ocr-preview" src={preview} alt="پیش‌نمایش فاکتور انتخاب‌شده" /> : <span className="sales-ocr-placeholder"><FileImage size={26} /><strong>تصویر فاکتور را اینجا رها کنید</strong><small>یا از دستگاه انتخاب کنید؛ تصویر کاغذ و صفحه‌نمایش پذیرفته می‌شود.</small></span>}
          <div className="sales-ocr-file-actions">
            <label className="button button-secondary"><Upload size={16} />انتخاب تصویر<input type="file" accept="image/*" onChange={onInput} hidden /></label>
            <label className="button button-secondary"><Camera size={16} />گرفتن عکس<input type="file" accept="image/*" capture="environment" onChange={onInput} hidden /></label>
          </div>
          {file && <span className="sales-ocr-filename" dir="auto">{file.name} · {faNumber(Math.ceil(file.size / 1024))} کیلوبایت</span>}
        </div>
        {error && <InlineError error={error} />}
        <div className="sales-ocr-actions"><button type="button" className="button button-primary" disabled={!file || busy} onClick={() => void analyze()}>{busy ? <><LoaderCircle className="spin" size={17} />در حال خواندن تصویر…</> : <><ScanLine size={17} />خواندن تصویر</>}</button></div>
      </>}
      {analysis && <>
        <div className="sales-ocr-result-heading"><span className="sales-ocr-success-icon"><Check size={18} /></span><span><strong>استخراج آمادهٔ بازبینی است</strong><small>اطلاعات با اطمینان کامل فرض نشده‌اند؛ موارد انتخاب‌شده وارد فرم می‌شوند.</small></span><button className="button button-text" type="button" onClick={() => setAnalysis(null)}>انتخاب تصویر دیگر</button></div>
        <section className="sales-ocr-review-section">
          <div className="sales-ocr-section-title"><strong>مشتری</strong>{analysis.extraction.customer?.name && <span>{analysis.extraction.customer.name}</span>}</div>
          {analysis.extraction.customer ? <div className="sales-ocr-customer-review">
            <p>{[analysis.extraction.customer.phone, analysis.extraction.customer.email, analysis.extraction.customer.address].filter(Boolean).join(" · ") || "مشخصات تکمیلی خوانده نشد"}</p>
            <label className="field-label">تطبیق با مشتری موجود
              <select className="field-input" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                <option value="">مشتری تازه / بدون انتخاب</option>
                {analysis.customerMatches.map((match) => <option key={match.id} value={match.id}>{match.name}{match.phone ? ` · ${match.phone}` : ""}{match.matchedBy === "phone" ? " · شمارهٔ یکسان" : " · نام یکسان"}</option>)}
              </select>
            </label>
            {!customerId && <small className="sales-ocr-hint">پس از اعمال، می‌توانید این مشخصات را به‌عنوان مشتری تازه تأیید و ثبت کنید.</small>}
          </div> : <p className="muted">اطلاعات مشتری خوانده نشد.</p>}
        </section>
        <section className="sales-ocr-review-section">
          <div className="sales-ocr-section-title"><strong>اقلام فاکتور</strong><span>{faNumber(analysis.items.length)} ردیف</span></div>
          {analysis.items.length ? <div className="sales-ocr-item-list">{analysis.items.map((item, index) => <article className="sales-ocr-item" key={`${item.name ?? "item"}-${index}`}>
            <div className="sales-ocr-item-main"><strong>{item.name || `ردیف نامشخص ${faNumber(index + 1)}`}</strong><small>{item.quantity ? `تعداد ${item.quantity}${item.unit ? ` ${item.unit}` : ""}` : "تعداد خوانده نشد"}{item.unitPriceRial ? ` · واحد ${money(item.unitPriceRial, currency)}` : " · قیمت واحد خوانده نشد"}{item.lineTotalRial ? ` · جمع ${money(item.lineTotalRial, currency)}` : ""}</small></div>
            <span className={`sales-ocr-confidence ${item.confidence >= 0.8 ? "high" : ""}`}>اطمینان {faNumber(Math.round(item.confidence * 100))}٪</span>
            <label className="field-label">انتخاب کالا یا خدمت
              <select className="field-input" value={itemIds[index] ?? ""} onChange={(event) => setItemIds((current) => current.map((id, position) => position === index ? event.target.value : id))}>
                <option value="">بعداً انتخاب یا ایجاد می‌کنم</option>
                {item.matches.map((match) => <option key={match.id} value={match.id}>{match.name} · {match.kind === "SERVICE" ? "خدمت" : "کالا"} · {match.unit.labelFa}{match.matchedBy === "name" ? " · نام یکسان" : match.matchedBy === "barcode" ? " · بارکد یکسان" : " · کد یکسان"}</option>)}
              </select>
            </label>
          </article>)}</div> : <p className="muted">ردیف کالایی پیدا نشد؛ اطلاعات دیگر را می‌توانید به فرم منتقل کنید.</p>}
        </section>
        <section className="sales-ocr-totals"><strong>مبالغ و پرداخت خوانده‌شده</strong><span>جمع اقلام: {formatMaybe(analysis.extraction.totals.subtotalRial, currency)}</span><span>تخفیف: {formatMaybe(analysis.extraction.totals.discountRial, currency)}</span><span>مالیات: {formatMaybe(analysis.extraction.totals.taxRial, currency)}</span><span>جمع نهایی: {formatMaybe(analysis.extraction.totals.totalRial, currency)}</span><span>دریافتی: {formatMaybe(analysis.extraction.paidAmountRial, currency)}</span>{analysis.extraction.paymentMethod && <span>روش: {paymentMethodLabel(analysis.extraction.paymentMethod)}</span>}{analysis.extraction.paymentAccountName && <span>حساب: {analysis.extraction.paymentAccountName}</span>}{analysis.extraction.invoiceDate && <span>تاریخ: {analysis.extraction.invoiceDate}</span>}</section>
        {analysis.extraction.warnings.length > 0 && <div className="sales-ocr-warnings"><AlertTriangle size={17} /><ul>{analysis.extraction.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
        {error && <InlineError error={error} />}
        <div className="sales-ocr-actions"><button type="button" className="button button-primary" onClick={apply}>اعمال اطلاعات انتخاب‌شده در فرم</button></div>
      </>}
    </div>
  </Modal>;
}

export function SalesOcrCustomerModal({ open, customer, onClose, onConfirm }: { open: boolean; customer: SalesOcrCustomer | null; onClose: () => void; onConfirm: (customer: SalesOcrCustomer) => void }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [email, setEmail] = useState(""); const [nationalId, setNationalId] = useState(""); const [address, setAddress] = useState(""); const [error, setError] = useState("");
  useEffect(() => { if (open && customer) { setName(customer.name ?? ""); setPhone(customer.phone ?? ""); setEmail(customer.email ?? ""); setNationalId(customer.nationalId ?? ""); setAddress(customer.address ?? ""); setError(""); } }, [open, customer]);
  const confirm = () => {
    if (name.trim().length < 2) { setError("نام مشتری را وارد کنید."); return; }
    setError(""); onConfirm({ name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, nationalId: nationalId.trim() || null, address: address.trim() || null }); onClose();
  };
  return <Modal open={open} onClose={onClose} title="بازبینی مشخصات مشتری" description="مشخصات در پیش‌نویس فروش ذخیره می‌شود؛ اگر شماره تکراری باشد مشتری موجود به‌کار می‌رود.">
    <div className="sales-ocr-customer-form"><div className="form-grid"><Field label="نام مشتری" value={name} onChange={setName} required /><Field label="شمارهٔ همراه" value={phone} onChange={setPhone} inputMode="tel" dir="ltr" /><Field label="ایمیل" value={email} onChange={setEmail} type="email" dir="ltr" /><Field label="شناسهٔ ملی" value={nationalId} onChange={setNationalId} inputMode="numeric" /></div><Field label="نشانی" value={address} onChange={setAddress} /><small className="sales-ocr-hint">تا زمان ساخت پیش‌نویس هیچ مشتری تازه‌ای ثبت نمی‌شود.</small>{error && <InlineError error={error} />}<div className="sales-ocr-actions"><button type="button" className="button button-primary" onClick={confirm}>تأیید مشخصات برای فروش</button></div></div>
  </Modal>;
}

export function SalesOcrCatalogItemModal({ open, line, currency, onClose, onCreated }: { open: boolean; line: SalesOcrLine | null; currency: Currency; onClose: () => void; onCreated: (item: CreatedOcrCatalogItem) => void }) {
  const businessId = sessionStorage.getItem("shopro_business_id");
  const [unitId, setUnitId] = useState(""); const [name, setName] = useState(""); const [price, setPrice] = useState(""); const [sku, setSku] = useState(""); const [barcode, setBarcode] = useState(""); const [kind, setKind] = useState<"STOCK" | "SERVICE">("STOCK"); const [tax, setTax] = useState(""); const [initialQuantity, setInitialQuantity] = useState(""); const [defaultCost, setDefaultCost] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [unitRows, setUnitRows] = useState<Unit[]>([]);
  useEffect(() => { if (!open) return; setName(line?.name ?? ""); setPrice(line?.unitPriceRial ? rialToDisplay(line.unitPriceRial, currency) : ""); setSku(line?.sku ?? ""); setBarcode(line?.barcode ?? ""); setTax(line?.taxRateBasisPoints === null || line?.taxRateBasisPoints === undefined ? "" : String(line.taxRateBasisPoints)); setKind(line?.kind ?? "STOCK"); setUnitId(""); setInitialQuantity(""); setDefaultCost(""); setError(""); setUnitRows([]); void get<Unit[]>("/products/units").then((rows) => { setUnitRows(rows); if (line?.unit) { const normalized = normalizePersianSearch(line.unit); const matches = rows.filter((row) => normalizePersianSearch(row.labelFa) === normalized); if (matches.length === 1) setUnitId(matches[0].id); } }).catch((cause) => setError(messageOf(cause))); }, [open, line, currency, businessId]);
  const save = async () => {
    if (!line) return;
    if (!name.trim()) { setError("نام کالا یا خدمت را وارد کنید."); return; }
    if (!unitId) { setError("واحد را انتخاب کنید؛ واحد خوانده‌شده به‌تنهایی برای ثبت کافی نیست."); return; }
    setBusy(true); setError("");
    try {
      const salePriceRial = toRial(price, currency);
      const normalizedInitialQuantity = toAsciiDigits(initialQuantity).replace(/[٬,\s]/g, "").replace(/٫/g, ".");
      if (kind === "STOCK" && normalizedInitialQuantity && !/^\d+(?:\.\d{1,3})?$/.test(normalizedInitialQuantity)) throw new Error("موجودی اولیه را با حداکثر سه رقم اعشار وارد کنید.");
      const body = { name: name.trim(), unitId, salePriceRial, ...(tax.trim() ? { taxRateBasisPoints: parseTax(tax) } : {}), ...(kind === "STOCK" ? { ...(sku.trim() ? { sku: sku.trim() } : {}), ...(barcode.trim() ? { barcode: barcode.trim() } : {}), ...(normalizedInitialQuantity ? { initialQuantity: normalizedInitialQuantity } : {}), ...(defaultCost.trim() ? { defaultCostRial: toRial(defaultCost, currency) } : {}) } : {}) };
      const created = await post<{ id: string; name: string; salePriceRial: string }>(kind === "STOCK" ? "/products" : "/services", kind === "STOCK" ? { ...body, kind: "STOCK" } : body);
      const unit = unitRows.find((row) => row.id === unitId)!;
      onCreated({ id: created.id, name: created.name, kind, sku: kind === "STOCK" ? sku || null : null, barcode: kind === "STOCK" ? barcode || null : null, unit: { id: unit.id, code: "", labelFa: unit.labelFa, precision: unit.precision }, salePriceRial: created.salePriceRial, taxRateBasisPoints: tax.trim() ? parseTax(tax) : 0, trackInventory: kind === "STOCK", matchedBy: "name", quantityOnHand: "0" });
      onClose();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title="ثبت کالای تازه با تأیید" description="این مورد هنوز در فهرست نیست. مشخصات را بازبینی کنید؛ موجودی واقعی را فقط در صورت اطمینان وارد کنید.">
    <div className="sales-ocr-customer-form"><div className="sales-ocr-confirm-note"><AlertTriangle size={17} />تنها پس از زدن دکمهٔ ثبت، کالا یا خدمت جدید به فهرست شعبه اضافه می‌شود. تعداد روی فاکتور به‌عنوان موجودی انبار در نظر گرفته نمی‌شود.</div><div className="form-grid"><Field label="نام کالا یا خدمت" value={name} onChange={setName} required /><SelectField label="نوع" value={kind} onChange={(value) => setKind(value as "STOCK" | "SERVICE")} options={[{ value: "STOCK", label: "کالا" }, { value: "SERVICE", label: "خدمت" }]} /><Field label={`قیمت فروش (${currency === "IRT" ? "تومان" : "ریال"})`} value={price} onChange={setPrice} inputMode="decimal" required placeholder="اگر خوانده نشده، قیمت را وارد کنید" /><SelectField label="واحد" value={unitId} onChange={setUnitId} options={unitRows.map((unit) => ({ value: unit.id, label: unit.labelFa }))} /><Field label="کد کالا (اختیاری)" value={sku} onChange={setSku} /><Field label="بارکد (اختیاری)" value={barcode} onChange={setBarcode} inputMode="numeric" /></div>{kind === "STOCK" && <div className="form-grid"><Field label="موجودی واقعی اولیه (اختیاری)" value={initialQuantity} onChange={setInitialQuantity} inputMode="decimal" placeholder="تعداد روی فاکتور را وارد نکنید" /><Field label={`بهای تمام‌شدهٔ واحد (${currency === "IRT" ? "تومان" : "ریال"})`} value={defaultCost} onChange={setDefaultCost} inputMode="decimal" placeholder="اختیاری" /></div>}<Field label="نرخ مالیات (واحد: صدم درصد)" value={tax} onChange={setTax} inputMode="numeric" placeholder="اگر مشخص نیست خالی بماند" />{error && <InlineError error={error} />}<div className="sales-ocr-actions"><button type="button" className="button button-primary" disabled={busy} onClick={() => void save()}>{busy ? "در حال ثبت…" : "تأیید و افزودن به فهرست"}</button></div></div>
  </Modal>;
}

function formatMaybe(value: string | null, currency: Currency) { return value === null ? "—" : money(value, currency); }
function paymentMethodLabel(value: "CASH" | "POS" | "BANK" | "OTHER") { return ({ CASH: "نقدی", POS: "کارت‌خوان", BANK: "واریز بانکی", OTHER: "سایر" })[value]; }
function rialToDisplay(value: string, currency: Currency) { const amount = BigInt(value); return currency === "IRT" ? `${amount / 10n}${amount % 10n ? `.${amount % 10n}` : ""}` : amount.toString(); }
function toRial(value: string, currency: Currency) {
  const normalized = toAsciiDigits(value).replace(/[٬,\s]/g, "").trim();
  if (currency === "IRT") { const match = /^(\d+)(?:[.٫](\d))?$/.exec(normalized); if (!match) throw new Error("قیمت را به تومان و حداکثر با یک رقم اعشار وارد کنید."); return (BigInt(match[1]) * 10n + BigInt(match[2] ?? "0")).toString(); }
  if (!/^\d+$/.test(normalized)) throw new Error("قیمت ریالی باید عدد صحیح باشد.");
  return BigInt(normalized).toString();
}
function parseTax(value: string) { const normalized = toAsciiDigits(value).trim(); const rate = Number(normalized); if (!/^\d+$/.test(normalized) || !Number.isInteger(rate) || rate < 0 || rate > 10000) throw new Error("نرخ مالیات باید عددی بین صفر و ۱۰۰۰۰ باشد."); return rate; }
