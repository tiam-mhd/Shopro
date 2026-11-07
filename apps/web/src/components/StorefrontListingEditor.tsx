import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Store } from "lucide-react";
import { toAsciiDigits } from "@shopro/contracts";
import { InlineError, LoadingBlock, messageOf } from "../App.js";
import { get, patch } from "../lib/api.js";
import { faNumber, money } from "../lib/format.js";
import "../storefront.css";

export type StorefrontListingConfig = {
  publicTitle: string;
  publicDescription: string;
  publicPriceRial: string;
  isPublished: boolean;
  canOrder: boolean;
  stockPolicy: "EXACT" | "APPROXIMATE" | "INQUIRY";
  minimumQuantity: string;
  maximumQuantity: string;
  displayOrder: number;
};

export type StorefrontListingProduct = {
  productId: string;
  name: string;
  sku: string | null;
  kind: "STOCK" | "SERVICE";
  categoryId: string | null;
  category: string | null;
  unit: string;
  unitPrecision: number;
  salePriceRial: string;
  taxRateBasisPoints: number;
  quantityOnHand: string;
  trackInventory: boolean;
  isConfigured: boolean;
  priceInherited: boolean;
  listing: StorefrontListingConfig;
};

export type StorefrontListingCategory = { id: string | null; name: string; count: number };
export type StorefrontListingPage = { items: StorefrontListingProduct[]; total: number; page: number; pageSize: number; totalPages: number; categories: StorefrontListingCategory[] };

export function storefrontPriceOverride(item: StorefrontListingProduct, value: StorefrontListingConfig) {
  return item.priceInherited && value.publicPriceRial === item.salePriceRial ? undefined : value.publicPriceRial || undefined;
}

export function StorefrontListingFields({ item, value, canManage, busy, onChange, onSave }: {
  item: StorefrontListingProduct;
  value: StorefrontListingConfig;
  canManage: boolean;
  busy: boolean;
  onChange: <K extends keyof StorefrontListingConfig>(key: K, next: StorefrontListingConfig[K]) => void;
  onSave: () => void;
}) {
  const normalizeQuantity = (draft: string) => toAsciiDigits(draft).replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
  const stockPolicyLabels: Record<StorefrontListingConfig["stockPolicy"], string> = { EXACT: "تعداد دقیق طبق تنظیم فروشگاه", APPROXIMATE: "فقط موجود / ناموجود", INQUIRY: "استعلام موجودی" };
  const disabled = !canManage || busy;
  return <>
    <p className="sf-listing-editor-note">عنوان و قیمت عمومی در ویترین نمایش داده می‌شوند. قیمت پایهٔ کالا {money(item.salePriceRial, "IRR")} است. {item.priceInherited ? "قیمت فروشگاه از همین قیمت پیروی می‌کند." : "قیمت فروشگاه جداگانه تنظیم شده است."}</p>
    <div className="sf-listing-form">
      <label>عنوان عمومی<input required maxLength={120} value={value.publicTitle} disabled={disabled} onChange={(event) => onChange("publicTitle", event.target.value)} /></label>
      <label>قیمت عمومی (ریال)<input required dir="ltr" inputMode="numeric" value={value.publicPriceRial} disabled={disabled} onChange={(event) => onChange("publicPriceRial", toAsciiDigits(event.target.value).replace(/\D/g, ""))} /><small>مقدار پیش‌فرض از قیمت پایهٔ کالا آمده است.</small></label>
      <label>حداقل تعداد ({item.unit})<input required dir="ltr" inputMode="decimal" value={value.minimumQuantity} disabled={disabled} onChange={(event) => onChange("minimumQuantity", normalizeQuantity(event.target.value))} /><small>تا {faNumber(item.unitPrecision)} رقم اعشار مجاز است.</small></label>
      <label>حداکثر تعداد (اختیاری)<input dir="ltr" inputMode="decimal" value={value.maximumQuantity} disabled={disabled} onChange={(event) => onChange("maximumQuantity", normalizeQuantity(event.target.value))} /><small>خالی بماند تا محدودیتی اعمال نشود.</small></label>
      <label>نمایش موجودی<select value={value.stockPolicy} disabled={disabled} onChange={(event) => onChange("stockPolicy", event.target.value as StorefrontListingConfig["stockPolicy"])}>{Object.entries(stockPolicyLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>ترتیب نمایش<input type="number" min="0" max="100000" step="1" dir="ltr" inputMode="numeric" value={value.displayOrder} disabled={disabled} onChange={(event) => onChange("displayOrder", Math.max(0, Number(event.target.value) || 0))} /><small>عدد کمتر زودتر نمایش داده می‌شود.</small></label>
      <label className="sf-span-all">توضیحات عمومی (اختیاری)<textarea value={value.publicDescription} maxLength={1000} disabled={disabled} onChange={(event) => onChange("publicDescription", event.target.value)} rows={2} placeholder="توضیحی برای نمایش در فروشگاه بنویسید" /></label>
    </div>
    <div className="sf-listing-actions">
      <label className="sf-check"><input type="checkbox" checked={value.isPublished} disabled={disabled} onChange={(event) => onChange("isPublished", event.target.checked)} /><span>انتشار در فروشگاه</span></label>
      <label className="sf-check"><input type="checkbox" checked={value.canOrder} disabled={disabled} onChange={(event) => onChange("canOrder", event.target.checked)} /><span>پذیرش سفارش این کالا</span></label>
      {canManage && <button type="button" className="sf-button sf-primary" disabled={busy || !value.publicTitle.trim() || !value.minimumQuantity} onClick={onSave}>{busy ? "در حال ذخیره…" : "ذخیرهٔ تنظیمات"}</button>}
    </div>
  </>;
}

export function ProductStorefrontSettings({ productId, productName }: { productId: string; productName: string }) {
  const businessId = sessionStorage.getItem("shopro_business_id") ?? "none";
  const branchId = sessionStorage.getItem("shopro_branch_id") ?? "none";
  const query = useQuery({
    queryKey: ["storefront-listing", businessId, branchId, productId],
    queryFn: () => get<StorefrontListingPage>("/storefront/listings?page=1&limit=1&productId=" + encodeURIComponent(productId)),
  });
  const [draft, setDraft] = useState<StorefrontListingConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const item = query.data?.items[0];

  useEffect(() => { if (item) setDraft({ ...item.listing }); }, [item]);

  const change = <K extends keyof StorefrontListingConfig,>(key: K, value: StorefrontListingConfig[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);
  const save = async () => {
    if (!item || !draft) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await patch("/storefront/listings/" + item.productId, {
        publicTitle: draft.publicTitle,
        publicDescription: draft.publicDescription,
        publicPriceRial: storefrontPriceOverride(item, draft),
        isPublished: draft.isPublished,
        canOrder: draft.canOrder,
        stockPolicy: draft.stockPolicy,
        minimumQuantity: draft.minimumQuantity,
        maximumQuantity: draft.maximumQuantity || undefined,
        displayOrder: draft.displayOrder,
      });
      setNotice("تنظیمات نمایش این کالا در فروشگاه ذخیره شد.");
      await query.refetch();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };

  return <section className="sf-card sf-admin-form sf-product-storefront-settings">
    <div className="sf-section-head"><div><span className="sf-eyebrow">فروشگاه عمومی</span><h2><Store size={17} /> نمایش {productName} در ویترین</h2></div>{item && <span className={"sf-badge " + (item.listing.isPublished ? "is-good" : "")}>{item.listing.isPublished ? "منتشرشده" : item.isConfigured ? "پیش‌نویس" : "تنظیم‌نشده"}</span>}</div>
    {query.isPending ? <LoadingBlock /> : query.isError ? <><InlineError error={query.error} retry={() => void query.refetch()} /><p className="sf-product-storefront-setup"><Link to="/app/storefront">رفتن به تنظیمات فروشگاه عمومی</Link></p></> : !item ? <div className="sf-alert sf-alert-neutral">این کالا در فهرست کالاهای فعال فروشگاه پیدا نشد.</div> : draft && <StorefrontListingFields item={item} value={draft} canManage busy={busy} onChange={change} onSave={() => void save()} />}
    {error && <div className="sf-alert sf-alert-error" role="alert">{error}</div>}
    {notice && <div className="sf-alert sf-alert-success" role="status">{notice}</div>}
    {!query.isError && query.data && !query.data.items.length && <p className="sf-product-storefront-setup"><Link to="/app/storefront">رفتن به تنظیمات فروشگاه عمومی</Link></p>}
  </section>;
}
