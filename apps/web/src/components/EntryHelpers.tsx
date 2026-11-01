import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { get, post } from "../lib/api.js";
import { Modal } from "./Modal.js";
import { Field, InlineError, SelectField, SubmitButton, messageOf } from "../App.js";

type PartyType = "CUSTOMER" | "SUPPLIER" | "BOTH";
export type CreatedOption = { id: string; name: string };

export function QuickPartyModal({ open, type, onClose, onCreated }: { open: boolean; type: PartyType; onClose: () => void; onCreated: (party: CreatedOption) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const title = type === "CUSTOMER" ? "مشتری تازه" : type === "SUPPLIER" ? "تأمین‌کنندهٔ تازه" : "طرف‌حساب تازه";
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const party = await post<CreatedOption>("/parties", { name, phone: phone || undefined, type });
      onCreated(party); setName(""); setPhone(""); onClose();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title={title} description="پس از ذخیره، این مورد به‌عنوان انتخاب جاری ثبت می‌شود.">
    <form onSubmit={(event) => void submit(event)}><div className="form-grid"><Field label="نام" value={name} onChange={setName} required /><Field label="شمارهٔ همراه" value={phone} onChange={setPhone} dir="ltr" inputMode="tel" placeholder="اختیاری" /></div>{error && <InlineError error={error} />}<div className="modal-form-actions"><SubmitButton busy={busy}>ذخیره و انتخاب</SubmitButton></div></form>
  </Modal>;
}

export function QuickExpenseCategoryModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (category: CreatedOption) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const category = await post<CreatedOption>("/expenses/categories", { name });
      onCreated(category); setName(""); onClose();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title="دستهٔ هزینهٔ تازه" description="هزینه در دفتر مالی با حساب عمومی ثبت می‌شود و با این دسته قابل جست‌وجو خواهد بود.">
    <form onSubmit={(event) => void submit(event)}><Field label="نام دسته" value={name} onChange={setName} required /><div className="modal-form-actions"><SubmitButton busy={busy}>ذخیره و انتخاب</SubmitButton></div>{error && <InlineError error={error} />}</form>
  </Modal>;
}

export function QuickProductModal({ open, currency, onClose, onCreated }: { open: boolean; currency: "IRR" | "IRT"; onClose: () => void; onCreated: (product: CreatedOption) => void }) {
  const unitBusinessId = sessionStorage.getItem("shopro_business_id");
  const units = useQuery({ queryKey: ["units", unitBusinessId], queryFn: () => get<Array<{ id: string; labelFa: string }>>("/products/units"), enabled: open });
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [unitId, setUnitId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setUnitId(""); }, [unitBusinessId]);
  useEffect(() => {
    if (!open) { setUnitId(""); return; }
    if (units.data?.length === 1) setUnitId((current) => current || units.data![0].id);
  }, [open, units.data]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    if (!unitId) { setError("یک واحد برای کالا انتخاب کنید."); return; }
    setBusy(true);
    try {
      const normalized = price.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/[٬,\s]/g, "");
      let salePriceRial: string;
      if (currency === "IRT") {
        const match = /^(\d+)(?:[.٫](\d))?$/.exec(normalized);
        if (!match) throw new Error("قیمت تومان حداکثر یک رقم اعشار می‌پذیرد.");
        salePriceRial = (BigInt(match[1]) * 10n + BigInt(match[2] ?? "0")).toString();
      } else {
        if (!/^\d+$/.test(normalized)) throw new Error("قیمت ریالی باید عدد صحیح باشد.");
        salePriceRial = BigInt(normalized).toString();
      }
      const product = await post<CreatedOption>("/products", { name, unitId: unitId || undefined, kind: "STOCK", salePriceRial });
      onCreated(product); setName(""); setPrice(""); setUnitId(""); onClose();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title="کالای تازه" description="کالا را همین‌جا بسازید و به سند جاری اضافه کنید.">
    <form onSubmit={(event) => void submit(event)}><div className="form-grid"><Field label="نام کالا" value={name} onChange={setName} required /><Field label={`قیمت فروش (${currency === "IRT" ? "تومان" : "ریال"})`} value={price} onChange={setPrice} inputMode="numeric" required /><SelectField label="واحد" value={unitId} onChange={setUnitId} options={(units.data ?? []).map((unit) => ({ value: unit.id, label: unit.labelFa }))} /></div>{units.isError && <InlineError error={units.error} retry={() => void units.refetch()} />}{error && <InlineError error={error} />}<div className="modal-form-actions"><SubmitButton busy={busy}>ذخیره و انتخاب</SubmitButton></div></form>
  </Modal>;
}

export function QuickAccountModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (account: CreatedOption) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("BANK");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const account = await post<CreatedOption>("/finance/accounts", { name, kind });
      onCreated(account); setName(""); setKind("BANK"); onClose();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title="حساب مالی تازه" description="حساب پس از ساخت در فهرست انتخاب‌های همین شعبه قرار می‌گیرد.">
    <form onSubmit={(event) => void submit(event)}><div className="form-grid"><Field label="نام حساب" value={name} onChange={setName} required /><SelectField label="نوع حساب" value={kind} onChange={setKind} options={[{ value: "CASH", label: "صندوق" }, { value: "BANK", label: "بانک" }, { value: "POS", label: "کارت‌خوان" }, { value: "OTHER", label: "سایر" }]} /></div>{error && <InlineError error={error} />}<div className="modal-form-actions"><SubmitButton busy={busy}>ذخیره و انتخاب</SubmitButton></div></form>
  </Modal>;
}
