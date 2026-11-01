import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { CirclePlus, Settings, Store, UsersRound } from "lucide-react";
import type { BusinessSummary } from "@shopro/contracts";
import { get, patch, post } from "../lib/api.js";
import { faNumber } from "../lib/format.js";
import { DataRows, Field, InlineError, PageHeader, SectionTitle, SelectField, SubmitButton, messageOf, useInvalidate } from "../App.js";
import { Modal } from "../components/Modal.js";

export function SettingsPage({ business, theme, setTheme }: { business: BusinessSummary; theme: string; setTheme: (value: string) => void }) {
  const invalidate = useInvalidate();
  const [businessOpen, setBusinessOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState(false);
  const [displayName, setDisplayName] = useState(business.displayName);
  const [currency, setCurrency] = useState(business.displayCurrency);
  const [branchName, setBranchName] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("CASHIER");
  const [newBusinessName, setNewBusinessName] = useState("");
  const [newBusinessType, setNewBusinessType] = useState("فروشگاه");
  const [newBranchName, setNewBranchName] = useState("شعبهٔ اصلی");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const branches = useQuery({ queryKey: ["business-current"], queryFn: () => get<{ branches: Array<{ id: string; name: string; code: string }> }>("/businesses/current") });
  const members = useQuery({ queryKey: ["business-members"], queryFn: () => get<Array<{ id: string; role: string; status: string; user: { phone: string; displayName: string | null }; branchIds: string[] }>>("/businesses/current/members") });

  const save = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setSuccess("");
    try { await patch("/businesses/current", { displayName, displayCurrency: currency }); setProfileOpen(false); await invalidate(); setSuccess("تنظیمات ذخیره شد."); }
    catch (cause) { setError(messageOf(cause)); }
  };
  const addBranch = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    try { await post("/businesses/current/branches", { name: branchName, code: branchCode }); setBranchName(""); setBranchCode(""); setBranchOpen(false); await invalidate(); setSuccess("شعبه اضافه شد."); }
    catch (cause) { setError(messageOf(cause)); }
  };
  const addMember = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    try { await post("/businesses/current/members", { phone, role, branchIds: (branches.data?.branches ?? []).map((item) => item.id) }); setPhone(""); setMemberOpen(false); await invalidate(); setSuccess("عضویت کاربر ثبت شد."); }
    catch (cause) { setError(messageOf(cause)); }
  };
  const createBusiness = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    try {
      const result = await post<{ id: string; branch: { id: string } }>("/businesses", { displayName: newBusinessName, businessType: newBusinessType, initialBranchName: newBranchName, displayCurrency: currency });
      sessionStorage.setItem("shopro_business_id", result.id); sessionStorage.setItem("shopro_branch_id", result.branch.id); await invalidate(); window.location.assign("/app");
    } catch (cause) { setError(messageOf(cause)); }
  };

  return <PageHeader title="تنظیمات کسب‌وکار" subtitle="مشخصات، شعبه‌ها و دسترسی اعضا" actions={<button className="button button-secondary" type="button" onClick={() => { setNewBusinessName(""); setBusinessOpen(true); }}><CirclePlus size={17} />افزودن کسب‌وکار</button>}>
    {error && <InlineError error={error} />}{success && <div className="notice notice-success" role="status">{success}</div>}
    <section className="card"><SectionTitle title="مشخصات عمومی" action={<button className="button button-secondary" type="button" onClick={() => { setDisplayName(business.displayName); setCurrency(business.displayCurrency); setProfileOpen(true); }}><Settings size={16} />ویرایش مشخصات</button>} /><div className="detail-grid"><div className="detail-field"><small>نام کسب‌وکار</small><strong>{business.displayName}</strong></div><div className="detail-field"><small>واحد نمایش پول</small><strong>{business.displayCurrency === "IRT" ? "تومان" : "ریال"}</strong></div></div></section>
    <section className="card"><SectionTitle title="شعبه‌ها" action={<button className="button button-secondary" type="button" onClick={() => { setBranchName(""); setBranchCode(""); setBranchOpen(true); }}><Store size={16} />افزودن شعبه</button>} />{branches.isError && <InlineError error={branches.error} retry={() => void branches.refetch()} />}{branches.isPending ? <div className="muted">در حال بارگیری شعبه‌ها…</div> : <div className="branch-list">{(branches.data?.branches ?? []).map((branch) => <article className="branch-row" key={branch.id}><strong>{branch.name}</strong><span>{branch.code}</span>{branch.id === sessionStorage.getItem("shopro_branch_id") && <small>شعبهٔ جاری</small>}</article>)}{!branches.data?.branches.length && <p className="muted">شعبه‌ای ثبت نشده است.</p>}</div>}</section>
    <section className="card"><SectionTitle title="اعضای کسب‌وکار" action={<button className="button button-secondary" type="button" onClick={() => { setPhone(""); setRole("CASHIER"); setMemberOpen(true); }}><UsersRound size={16} />افزودن عضو</button>} />{members.isError && <InlineError error={members.error} retry={() => void members.refetch()} />}{members.isPending ? <div className="muted">در حال بارگیری اعضا…</div> : <DataRows icon={UsersRound} rows={(members.data ?? []).map((member) => ({ id: member.id, title: member.user.displayName ?? member.user.phone, subtitle: roleLabel(member.role) + " · " + faNumber(member.branchIds.length) + " شعبه", status: member.status === "ACTIVE" ? "فعال" : "غیرفعال" }))} emptyTitle="عضوی اضافه نشده" emptyText="اعضای این کسب‌وکار و دسترسی شعبه‌هایشان نمایش داده می‌شوند." />}</section>
    <Modal open={businessOpen} onClose={() => setBusinessOpen(false)} title="کسب‌وکار تازه" description="با ایجاد کسب‌وکار، یک شعبهٔ نخست هم ساخته می‌شود.">
      <form onSubmit={(event) => void createBusiness(event)}><div className="form-grid"><Field label="نام کسب‌وکار" value={newBusinessName} onChange={setNewBusinessName} required /><Field label="نوع کسب‌وکار" value={newBusinessType} onChange={setNewBusinessType} required /><Field label="نام شعبهٔ اول" value={newBranchName} onChange={setNewBranchName} required /><SelectField label="واحد نمایش پول" value={currency} onChange={(value) => setCurrency(value as typeof currency)} options={[{ value: "IRT", label: "تومان" }, { value: "IRR", label: "ریال" }]} /></div><div className="modal-form-actions"><SubmitButton>ساخت کسب‌وکار و جابه‌جایی</SubmitButton></div></form>
    </Modal>
    <Modal open={profileOpen} onClose={() => setProfileOpen(false)} title="ویرایش مشخصات کسب‌وکار">
      <form onSubmit={(event) => void save(event)}><div className="form-grid"><Field label="نام کسب‌وکار" value={displayName} onChange={setDisplayName} required /><SelectField label="واحد نمایش پول" value={currency} onChange={(value) => setCurrency(value as typeof currency)} options={[{ value: "IRT", label: "تومان" }, { value: "IRR", label: "ریال" }]} /><SelectField label="پوستهٔ نمایش" value={theme} onChange={setTheme} options={[{ value: "auto", label: "همگام با دستگاه" }, { value: "light", label: "روشن" }, { value: "dark", label: "تیره" }]} /></div><div className="modal-form-actions"><SubmitButton>ذخیرهٔ تغییرات</SubmitButton></div></form>
    </Modal>
    <Modal open={branchOpen} onClose={() => setBranchOpen(false)} title="افزودن شعبه" description="کد شعبه باید در همین کسب‌وکار یکتا باشد.">
      <form onSubmit={(event) => void addBranch(event)}><div className="form-grid"><Field label="نام شعبه" value={branchName} onChange={setBranchName} required /><Field label="کد شعبه" value={branchCode} onChange={setBranchCode} required placeholder="مثلاً NORTH" /></div><div className="modal-form-actions"><SubmitButton>افزودن شعبه</SubmitButton></div></form>
    </Modal>
    <Modal open={memberOpen} onClose={() => setMemberOpen(false)} title="افزودن عضو" description="کاربر باید یک‌بار با شمارهٔ خودش وارد شده باشد.">
      <form onSubmit={(event) => void addMember(event)}><div className="form-grid"><Field label="شمارهٔ موبایل" value={phone} onChange={setPhone} required inputMode="tel" dir="ltr" /><SelectField label="نقش" value={role} onChange={setRole} options={[{ value: "MANAGER", label: "مدیر شعبه" }, { value: "ACCOUNTANT", label: "حسابدار" }, { value: "CASHIER", label: "صندوقدار" }, { value: "VIEWER", label: "مشاهده‌گر" }]} /></div><div className="modal-form-actions"><SubmitButton>ثبت دسترسی عضو</SubmitButton></div></form>
    </Modal>
  </PageHeader>;
}

function roleLabel(role: string) { return ({ OWNER: "مالک", MANAGER: "مدیر", ACCOUNTANT: "حسابدار", CASHIER: "صندوقدار", VIEWER: "مشاهده‌گر" } as Record<string, string>)[role] ?? "عضو"; }
