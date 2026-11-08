import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { CirclePlus, FileText, PackagePlus, Search, X } from "lucide-react";
import { parseQuantityMilli, toAsciiDigits } from "@shopro/contracts";
import type { CursorPage, MemberRole } from "@shopro/contracts";
import { get, newOperationId, post } from "../lib/api.js";
import { faNumber, money, todayISO } from "../lib/format.js";
import { countAwaitingServer, listPendingSales, savePendingSale } from "../lib/offline.js";
import { partyPicker } from "../lib/picker-options.js";
import { JalaliDatePicker } from "../components/JalaliDatePicker.js";
import { Modal } from "../components/Modal.js";
import { QuickAccountModal, QuickPartyModal, QuickProductModal } from "../components/EntryHelpers.js";
import { Field, InlineError, LoadMoreButton, LoadingBlock, PageHeader, SectionTitle, SelectField, SubmitButton, messageOf, useInvalidate } from "../App.js";

type Currency = "IRR" | "IRT";
type CatalogItem = { id: string; name: string; sku: string | null; barcode?: string | null; kind: "STOCK" | "SERVICE"; unit: { id: string; code: string; labelFa: string; precision: number }; salePriceRial: string; defaultCostRial?: string | null; taxRateBasisPoints?: number; quantityOnHand?: string; trackInventory: boolean; isActive?: boolean };
type CartLine = { rowId: string; productId: string; quantity: string; unitPrice?: string; discount?: string };
type Party = { id: string; name: string; type: "CUSTOMER" | "SUPPLIER" | "BOTH"; phone: string | null; email?: string | null; nationalId?: string | null; address?: string | null };
type CashAccount = { id: string; name: string; kind: string; balanceRial: string };
export function SalesPage({ currency, setPendingCount, userId, role }: { currency: Currency; setPendingCount: (count: number) => void; userId: string; role: MemberRole }) {
  const invalidate = useInvalidate(); const navigate = useNavigate(); const [searchParams, setSearchParams] = useSearchParams();
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [quickPartyOpen, setQuickPartyOpen] = useState(false); const [quickProductOpen, setQuickProductOpen] = useState(false); const [quickAccountOpen, setQuickAccountOpen] = useState(false);
  const [date, setDate] = useState(() => todayISO()); const [customerId, setCustomerId] = useState(""); const [prefilledParty, setPrefilledParty] = useState<Party | null>(null);
  const [note, setNote] = useState(""); const [cart, setCart] = useState<CartLine[]>([]); const [selectedProducts, setSelectedProducts] = useState<Record<string, CatalogItem>>({});
  const [paid, setPaid] = useState(""); const [accountId, setAccountId] = useState(""); const [method, setMethod] = useState<"CASH" | "POS" | "BANK" | "OTHER">("CASH");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [success, setSuccess] = useState(""); const [prefillError, setPrefillError] = useState(""); const [search, setSearch] = useState(""); const [debouncedSearch, setDebouncedSearch] = useState("");
  const canOverridePrice = ["OWNER", "MANAGER", "ACCOUNTANT"].includes(role);
  const prefillCustomerId = searchParams.get("customerId") ?? ""; const prefillProductId = searchParams.get("productId") ?? ""; const appliedCustomerPrefill = useRef<string | null>(null); const appliedProductPrefill = useRef<string | null>(null);
  useEffect(() => { const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 220); return () => window.clearTimeout(timeout); }, [search]);
  const products = useInfiniteQuery({ queryKey: ["sales-product-picker", sessionStorage.getItem("shopro_business_id"), sessionStorage.getItem("shopro_branch_id"), debouncedSearch], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => get<CursorPage<CatalogItem>>(`/catalog?limit=40&q=${encodeURIComponent(debouncedSearch)}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`), getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined, enabled: productPickerOpen });
  const parties = useQuery({ queryKey: ["parties", "CUSTOMER"], queryFn: () => get<Party[]>("/customers") }); const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => get<CashAccount[]>("/finance/accounts") });
  const partyPrefill = useQuery({ queryKey: ["sales-party-prefill", sessionStorage.getItem("shopro_business_id"), prefillCustomerId], queryFn: () => get<{ party: Party }>(`/parties/${encodeURIComponent(prefillCustomerId)}/statement`), enabled: Boolean(prefillCustomerId) });
  const productPrefill = useQuery({ queryKey: ["sales-product-prefill", sessionStorage.getItem("shopro_business_id"), sessionStorage.getItem("shopro_branch_id"), prefillProductId], queryFn: () => get<CatalogItem>(`/catalog/${encodeURIComponent(prefillProductId)}`), enabled: Boolean(prefillProductId) });
  const customerPicker = partyPicker("CUSTOMER"); const searchedProducts = products.data?.pages.flatMap((page) => page.items) ?? [];
  const productList = useMemo(() => [...new Map([...Object.values(selectedProducts), ...searchedProducts].map((product) => [product.id, product])).values()], [selectedProducts, searchedProducts]);
  const customerOptions = useMemo(() => { const options = new Map((parties.data ?? []).map((party) => [party.id, party.name])); if (prefilledParty) options.set(prefilledParty.id, prefilledParty.name); return [...options].map(([value, label]) => ({ value, label })); }, [parties.data, prefilledParty]);
  const total = useMemo(() => cart.reduce((sum, line) => {
    const product = productList.find((item) => item.id === line.productId); if (!product) return sum;
    try {
      const qty = parseQuantityMilli(line.quantity); const price = line.unitPrice === undefined ? BigInt(product.salePriceRial) : BigInt(displayToRial(line.unitPrice, currency) || "0");
      const base = (price * qty + 500n) / 1000n; const discount = BigInt(displayToRial(line.discount ?? "", currency) || "0"); if (discount > base) return sum;
      const taxable = base - discount; return sum + taxable + (taxable * BigInt(product.taxRateBasisPoints ?? 0) + 5000n) / 10000n;
    } catch { return sum; }
  }, 0n), [cart, productList, currency]);
  const paidRial = useMemo(() => { try { return displayToRial(paid, currency) || "0"; } catch { return "0"; } }, [paid, currency]);

  const add = useCallback((product: CatalogItem) => {
    setPrefillError(""); setSelectedProducts((items) => ({ ...items, [product.id]: product }));
    setCart((items) => { const existing = items.find((line) => line.productId === product.id && line.unitPrice === undefined && line.discount === undefined); return existing ? items.map((line) => line.rowId === existing.rowId ? { ...line, quantity: String(Number(line.quantity) + 1) } : line) : [...items, { rowId: crypto.randomUUID(), productId: product.id, quantity: "1" }]; });
  }, []);
  useEffect(() => {
    const consumed: string[] = [];
    if (!prefillCustomerId) appliedCustomerPrefill.current = null;
    else if (partyPrefill.data && appliedCustomerPrefill.current !== prefillCustomerId) { appliedCustomerPrefill.current = prefillCustomerId; if (partyPrefill.data.party.type === "CUSTOMER" || partyPrefill.data.party.type === "BOTH") { setPrefilledParty(partyPrefill.data.party); setCustomerId(partyPrefill.data.party.id); } else setPrefillError("این طرف‌حساب مشتری نیست و برای فروش انتخاب نشد."); consumed.push("customerId"); }
    if (!prefillProductId) appliedProductPrefill.current = null;
    else if (productPrefill.data && appliedProductPrefill.current !== prefillProductId) { appliedProductPrefill.current = prefillProductId; if (productPrefill.data.isActive !== false) add(productPrefill.data); else setPrefillError("این کالا بایگانی شده و به فروش افزوده نشد."); consumed.push("productId"); }
    if (consumed.length) setSearchParams((current) => { const next = new URLSearchParams(current); consumed.forEach((key) => next.delete(key)); return next; }, { replace: true });
  }, [add, partyPrefill.data, prefillCustomerId, prefillProductId, productPrefill.data, setSearchParams]);

  const setLineField = (rowId: string, field: "quantity" | "unitPrice" | "discount", value: string) => setCart((items) => items.map((line) => line.rowId === rowId ? { ...line, [field]: value } : line));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!cart.length) { setError("برای ثبت فروش یک کالا یا خدمت اضافه کنید."); return; }
    const missingQuantity = cart.find((line) => !line.quantity.trim());
    if (missingQuantity) { setError(`تعداد «${productList.find((item) => item.id === missingQuantity.productId)?.name ?? "کالا"}» را وارد کنید.`); return; }
    let sale: { customerId?: string; txnDate: string; note?: string; lines: Array<{ productId: string; quantity: string; unitPriceRial?: string; discountRial?: string }> };
    try { sale = { customerId: customerId || undefined, txnDate: date, note: note || undefined, lines: cart.map((line) => ({ productId: line.productId, quantity: line.quantity, ...(canOverridePrice && line.unitPrice?.trim() ? { unitPriceRial: displayToRial(line.unitPrice, currency) } : {}), ...(canOverridePrice && line.discount?.trim() ? { discountRial: displayToRial(line.discount, currency) } : {}) })) }; }
    catch (cause) { setError(messageOf(cause)); return; }
    setBusy(true); setError(""); setSuccess("");
    const operationId = newOperationId();
    try {
      const amountRial = displayToRial(paid, currency); const draft = await post<{ id: string }>("/sales", sale, { "Idempotency-Key": `${operationId}-draft` });
      setCart([]); setPaid(""); setNote(""); await invalidate();
      navigate("/app/invoices/" + draft.id, { state: { openPost: true, payment: amountRial ? { amountRial, financeAccountId: accountId, method } : null } });
    } catch (cause) {
      if (!navigator.onLine || cause instanceof TypeError) {
        try { const businessId = sessionStorage.getItem("shopro_business_id") ?? ""; const branchId = sessionStorage.getItem("shopro_branch_id") ?? ""; const amountRial = displayToRial(paid, currency); const payment = amountRial && accountId ? { amountRial, financeAccountId: accountId, method } : undefined; await savePendingSale({ id: operationId, userId, draftKey: `${operationId}-draft`, postKey: `${operationId}-post`, businessId, branchId, sale, payment }); setPendingCount(countAwaitingServer((await listPendingSales()).filter((item) => item.userId === userId))); setSuccess("فروش به‌صورت پیش‌نویس روی این دستگاه و برای همین حساب ذخیره شد؛ پس از اتصال می‌توانید آن را ارسال کنید."); setCart([]); setPaid(""); setNote(""); }
        catch { setError("این دستگاه نتوانست پیش‌نویس را ذخیره کند. اطلاعات فرم را نگه داشته‌ایم؛ دوباره تلاش کنید."); }
      } else setError(messageOf(cause));
    } finally { setBusy(false); }
  };

  const selectProduct = (product: CatalogItem) => {
    add(product);
    setProductPickerOpen(false);
  };

  return <PageHeader title="ثبت فروش" subtitle="اطلاعات فاکتور را وارد کنید؛ کالاها و مبالغ را پیش از ساخت پیش‌نویس بازبینی کنید." actions={<Link className="button button-secondary" to="/app/invoices"><FileText size={17} />فاکتورها</Link>}>
    <div className="form-page sales-entry-form">
      <form onSubmit={(event) => void submit(event)}>
        <section className="card form-card"><SectionTitle title="اطلاعات فروش" /><div className="form-grid"><JalaliDatePicker value={date} onChange={setDate} label="تاریخ فاکتور" /><SelectField label="مشتری" value={customerId} onChange={(value) => { setCustomerId(value); setPrefillError(""); }} options={customerOptions} optionsKey={customerPicker.key} loadOptions={customerPicker.load} placeholder="بدون مشتری" onAdd={() => setQuickPartyOpen(true)} /><Field label="توضیح" value={note} onChange={setNote} placeholder="اختیاری" /></div>{partyPrefill.isError && <InlineError error={partyPrefill.error} retry={() => void partyPrefill.refetch()} />}
        </section>
        <section className="card form-card"><SectionTitle title="کالا و خدمت" action={<span className="eyebrow">{faNumber(cart.length)} ردیف</span>} /><button type="button" className="button button-secondary product-picker-trigger" onClick={() => setProductPickerOpen(true)}><PackagePlus size={17} />افزودن کالا یا خدمت از فهرست</button>
          {cart.length > 0 && <div className="cart-lines">{cart.map((line) => { const product = productList.find((item) => item.id === line.productId)!; let lineTotal = 0n; try { const price = line.unitPrice === undefined ? BigInt(product.salePriceRial) : BigInt(displayToRial(line.unitPrice, currency) || "0"); const base = (price * parseQuantityMilli(line.quantity) + 500n) / 1000n; const discount = BigInt(displayToRial(line.discount ?? "", currency) || "0"); const taxable = base - discount; lineTotal = taxable + (taxable * BigInt(product.taxRateBasisPoints ?? 0) + 5000n) / 10000n; } catch { /* incomplete values remain editable */ } return <div className="cart-line sales-cart-line" key={line.rowId}><span className="sales-cart-product"><strong>{product.name}</strong><small>{product.kind === "SERVICE" ? "خدمت" : "کالا"} · {product.unit.labelFa}{product.taxRateBasisPoints ? ` · ${faNumber(product.taxRateBasisPoints / 100)}٪ مالیات` : ""}</small></span><label><small>تعداد</small><input className="quantity-input" inputMode="decimal" aria-label={`تعداد ${product.name}`} value={line.quantity} onChange={(event) => setLineField(line.rowId, "quantity", event.target.value)} /></label><label><small>قیمت واحد ({currency === "IRT" ? "تومان" : "ریال"})</small><input className="quantity-input" inputMode="decimal" aria-label={`قیمت واحد ${product.name}`} value={line.unitPrice ?? rialToDisplay(product.salePriceRial, currency)} disabled={!canOverridePrice} onChange={(event) => setLineField(line.rowId, "unitPrice", event.target.value)} /></label><label><small>تخفیف ({currency === "IRT" ? "تومان" : "ریال"})</small><input className="quantity-input" inputMode="decimal" aria-label={`تخفیف ${product.name}`} value={line.discount ?? ""} placeholder="۰" disabled={!canOverridePrice} onChange={(event) => setLineField(line.rowId, "discount", event.target.value)} /></label><strong className="sales-cart-total">{money(lineTotal, currency)}</strong><button type="button" className="remove-line" onClick={() => setCart((items) => items.filter((item) => item.rowId !== line.rowId))} aria-label={`حذف ${product.name}`}><X size={17} /></button></div>; })}</div>}
        </section>
        <section className="card form-card"><SectionTitle title="دریافت وجه" action={<span className="eyebrow">اختیاری</span>} /><div className="form-grid"><Field label={`مبلغ دریافتی (${currency === "IRT" ? "تومان" : "ریال"})`} value={paid} onChange={setPaid} inputMode={currency === "IRT" ? "decimal" : "numeric"} placeholder="۰" /><SelectField label="حساب دریافت" value={accountId} onChange={setAccountId} options={(accounts.data ?? []).map((account) => ({ value: account.id, label: account.name }))} placeholder="انتخاب صندوق یا بانک" onAdd={() => setQuickAccountOpen(true)} /><SelectField label="روش پرداخت" value={method} onChange={(value) => setMethod(value as typeof method)} options={[{ value: "CASH", label: "نقدی" }, { value: "POS", label: "کارت‌خوان" }, { value: "BANK", label: "واریز بانکی" }, { value: "OTHER", label: "سایر" }]} /></div></section>
        <section className="card total-card"><span><small>جمع فاکتور</small><strong>{money(total, currency)}</strong></span><span><small>مبلغ دریافتی</small><strong>{money(paidRial, currency)}</strong></span><span><small>ماندهٔ مشتری</small><strong>{money(total - BigInt(paidRial), currency)}</strong></span></section>
        {prefillError && <div className="notice notice-warning" role="status">{prefillError}</div>}{productPrefill.isError && <InlineError error={productPrefill.error} retry={() => void productPrefill.refetch()} />}{error && <InlineError error={error} />}{success && <div className="notice notice-success">{success}</div>}<div className="form-actions"><SubmitButton busy={busy}>ساخت پیش‌نویس فروش</SubmitButton><span className="muted">ثبت قطعی و دریافت وجه در مرحلهٔ بعد تأیید می‌شود.</span></div>
      </form>
    </div>
    <QuickPartyModal open={quickPartyOpen} type="CUSTOMER" onClose={() => setQuickPartyOpen(false)} onCreated={(party) => { setCustomerId(party.id); setPrefilledParty({ id: party.id, name: party.name, phone: null, type: "CUSTOMER" }); setPrefillError(""); void invalidate(); }} />
    <QuickProductModal open={quickProductOpen} currency={currency} onClose={() => setQuickProductOpen(false)} onCreated={(product) => { setSearch(product.name); setProductPickerOpen(true); void invalidate(); }} />
    <QuickAccountModal open={quickAccountOpen} onClose={() => setQuickAccountOpen(false)} onCreated={(account) => { setAccountId(account.id); void invalidate(); }} />
    <Modal open={productPickerOpen} onClose={() => setProductPickerOpen(false)} title="انتخاب کالا یا خدمت" description="نام، کد یا بارکد را جست‌وجو کنید." size="wide"><div className="search-box"><Search size={17} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="نام، کد کالا یا بارکد" aria-label="جست‌وجوی کالا" /></div><button type="button" className="button button-secondary picker-add" onClick={() => { setProductPickerOpen(false); setQuickProductOpen(true); }}><CirclePlus size={17} />افزودن کالای انبارشونده</button><div className="product-pick-list">{products.isError ? <InlineError error={products.error} retry={() => void products.refetch()} /> : products.isPending ? <LoadingBlock /> : searchedProducts.map((product) => <button type="button" className="product-pick" key={product.id} onClick={() => selectProduct(product)}><span className="product-avatar"><PackagePlus size={18} /></span><span className="row-grow"><strong>{product.name}</strong><small>{product.sku || product.unit.labelFa} · {money(product.salePriceRial, currency)}</small></span><CirclePlus size={19} /></button>)}{!products.isPending && !products.isError && !searchedProducts.length && <p className="muted">کالایی مطابق جست‌وجو پیدا نشد.</p>}</div><LoadMoreButton hasMore={Boolean(products.hasNextPage)} isLoading={products.isFetchingNextPage} onClick={() => void products.fetchNextPage()} /></Modal>
  </PageHeader>;
}

function displayToRial(value: string, currency: Currency) { const normalized = toAsciiDigits(value).replace(/[٬,\s]/g, "").trim(); if (!normalized) return ""; if (currency === "IRT") { const match = /^(\d+)(?:[.٫](\d))?$/.exec(normalized); if (!match) throw new Error("مبلغ تومان حداکثر یک رقم اعشار می‌پذیرد."); return (BigInt(match[1]) * 10n + BigInt(match[2] ?? "0")).toString(); } if (!/^\d+$/.test(normalized)) throw new Error("مبلغ ریالی باید عدد صحیح باشد."); return BigInt(normalized).toString(); }
function rialToDisplay(value: string, currency: Currency) { const amount = BigInt(value); return currency === "IRT" ? `${amount / 10n}${amount % 10n ? `.${amount % 10n}` : ""}` : amount.toString(); }
