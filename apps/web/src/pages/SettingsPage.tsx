import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BriefcaseBusiness,
  Building2,
  Check,
  ChevronDown,
  CirclePlus,
  Download,
  Expand,
  Minimize2,
  Moon,
  Monitor,
  Palette,
  Ruler,
  Save,
  Settings,
  Store,
  Sun,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { BusinessSummary, CursorPage } from "@shopro/contracts";
import { get, patch, post } from "../lib/api.js";
import { downloadCsv } from "../lib/csv.js";
import { faNumber, jalaliDate } from "../lib/format.js";
import { Field, InlineError, LoadMoreButton, PageHeader, SelectField, SubmitButton, messageOf, useInvalidate } from "../App.js";
import { Modal } from "../components/Modal.js";
import { JalaliDatePicker } from "../components/JalaliDatePicker.js";

type SettingsSectionId = "business" | "branches" | "members" | "units" | "appearance" | "new-business";
type Branch = { id: string; name: string; code: string };
type Member = { id: string; role: string; status: string; user: { id: string; phone: string; displayName: string | null }; branchIds: string[] };
type MemberAudit = { action: string; occurredAt: string; actorName: string | null; before: { role?: string; status?: string; branchIds?: string[] } | null; after: { role?: string; status?: string; branchIds?: string[] } | null };
type UnitSetting = { id: string; code: string; labelFa: string; precision: number; isVisible: boolean };
type UnitSettings = { units: Array<UnitSetting & { groupKey: string; groupLabel: string }>; groups: Array<{ key: string; labelFa: string; units: UnitSetting[] }>; visibleCount: number };

const sectionItems: Array<{ id: SettingsSectionId; label: string; icon: LucideIcon }> = [
  { id: "business", label: "مشخصات کسب‌وکار", icon: Building2 },
  { id: "branches", label: "شعبه‌ها", icon: Store },
  { id: "members", label: "اعضای تیم", icon: UsersRound },
  { id: "units", label: "واحدهای اندازه‌گیری", icon: Ruler },
  { id: "appearance", label: "ظاهر و نمایش", icon: Palette },
  { id: "new-business", label: "کسب‌وکار تازه", icon: BriefcaseBusiness },
];

const memberRoleOptions = [{ value: "MANAGER", label: "مدیر شعبه" }, { value: "ACCOUNTANT", label: "حسابدار" }, { value: "CASHIER", label: "صندوقدار" }, { value: "VIEWER", label: "مشاهده‌گر" }];

export function SettingsPage({ business, theme, setTheme }: { business: BusinessSummary; theme: string; setTheme: (value: string) => void }) {
  const invalidate = useInvalidate();
  const queryClient = useQueryClient();
  const [openSections, setOpenSections] = useState<Record<SettingsSectionId, boolean>>({ business: true, branches: false, members: false, units: false, appearance: false, "new-business": false });
  const [profileOpen, setProfileOpen] = useState(false);
  const [businessModalOpen, setBusinessModalOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [historyMember, setHistoryMember] = useState<Member | null>(null);
  const [displayName, setDisplayName] = useState(business.displayName);
  const [currency, setCurrency] = useState(business.displayCurrency);
  const [branchName, setBranchName] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("CASHIER");
  const [newMemberBranchIds, setNewMemberBranchIds] = useState<string[]>([]);
  const [editMemberRole, setEditMemberRole] = useState("CASHIER");
  const [editMemberStatus, setEditMemberStatus] = useState("ACTIVE");
  const [editMemberBranchIds, setEditMemberBranchIds] = useState<string[]>([]);
  const [newBusinessName, setNewBusinessName] = useState("");
  const [newBusinessType, setNewBusinessType] = useState("فروشگاه");
  const [newBranchName, setNewBranchName] = useState("شعبهٔ اصلی");
  const [newBusinessCurrency, setNewBusinessCurrency] = useState(business.displayCurrency);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [unitVisibility, setUnitVisibility] = useState<Record<string, boolean>>({});
  const [unitVisibilityDirty, setUnitVisibilityDirty] = useState(false);

  const branches = useQuery({ queryKey: ["business-current"], queryFn: () => get<{ branches: Branch[] }>("/businesses/current") });
  const members = useQuery({ queryKey: ["business-members"], queryFn: () => get<Member[]>("/businesses/current/members") });
  const memberHistory = useQuery({ queryKey: ["business-member-history", business.id, historyMember?.id], queryFn: () => get<MemberAudit[]>(`/businesses/current/members/${historyMember!.id}/history`), enabled: Boolean(historyMember) });
  const unitSettings = useQuery({ queryKey: ["unit-settings", business.id], queryFn: () => get<UnitSettings>("/products/units/settings") });
  const branchRows = branches.data?.branches ?? [];
  const memberRows = members.data ?? [];
  const canManageUnits = ["OWNER", "MANAGER", "ACCOUNTANT"].includes(business.role);
  const canManageMembers = business.role === "OWNER";
  const visibleUnitCount = unitSettings.data?.units.filter((unit) => unitVisibility[unit.id] ?? unit.isVisible).length ?? 0;
  const allOpen = sectionItems.every((section) => openSections[section.id]);
  const currentBranchId = sessionStorage.getItem("shopro_branch_id");

  useEffect(() => { setUnitVisibility({}); setUnitVisibilityDirty(false); }, [business.id]);
  useEffect(() => {
    if (unitSettings.data && !unitVisibilityDirty) setUnitVisibility(Object.fromEntries(unitSettings.data.units.map((unit) => [unit.id, unit.isVisible])));
  }, [unitSettings.data, unitVisibilityDirty]);

  const toggleSection = (id: SettingsSectionId) => setOpenSections((previous) => ({ ...previous, [id]: !previous[id] }));
  const toggleAll = () => setOpenSections(Object.fromEntries(sectionItems.map(({ id }) => [id, !allOpen])) as Record<SettingsSectionId, boolean>);
  const jumpToSection = (id: SettingsSectionId) => {
    setOpenSections((previous) => ({ ...previous, [id]: true }));
    requestAnimationFrame(() => document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setSuccess(""); setBusy("profile");
    try {
      await patch("/businesses/current", { displayName, displayCurrency: currency });
      setProfileOpen(false); await invalidate(); setSuccess("مشخصات کسب‌وکار ذخیره شد.");
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(""); }
  };

  const addBranch = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setSuccess(""); setBusy("branch");
    try {
      await post("/businesses/current/branches", { name: branchName, code: branchCode });
      setBranchName(""); setBranchCode(""); setBranchOpen(false); await invalidate(); setSuccess("شعبهٔ جدید اضافه شد.");
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(""); }
  };

  const addMember = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setSuccess(""); setBusy("member");
    try {
      await post("/businesses/current/members", { phone, role, branchIds: newMemberBranchIds });
      setPhone(""); setMemberOpen(false); await invalidate(); setSuccess("عضویت کاربر ثبت شد.");
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(""); }
  };

  const openMemberEditor = (member: Member) => {
    setError(""); setSuccess(""); setEditingMember(member); setEditMemberRole(member.role); setEditMemberStatus(member.status); setEditMemberBranchIds(member.branchIds);
  };

  const saveMemberAccess = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingMember) return;
    if (!editMemberBranchIds.length) { setError("عضو باید دست‌کم به یک شعبه دسترسی داشته باشد."); return; }
    const branchesChanged = [...editingMember.branchIds].sort().join(",") !== [...editMemberBranchIds].sort().join(",");
    const roleChanged = editingMember.role !== editMemberRole;
    const statusChanged = editingMember.status !== editMemberStatus;
    if (!roleChanged && !branchesChanged && !statusChanged) { setEditingMember(null); return; }
    const confirmText = editMemberStatus === "SUSPENDED" && editingMember.status !== "SUSPENDED"
      ? `دسترسی ${editingMember.user.displayName ?? editingMember.user.phone} در این کسب‌وکار متوقف شود؟ نشست‌های بعدی او دیگر به این کسب‌وکار دسترسی نخواهند داشت.`
      : editMemberStatus === "ACTIVE" && editingMember.status !== "ACTIVE"
        ? `دسترسی ${editingMember.user.displayName ?? editingMember.user.phone} دوباره فعال شود؟`
        : "تغییر نقش یا شعبه‌های این عضو ثبت شود؟";
    if (!window.confirm(confirmText)) return;
    setError(""); setSuccess(""); setBusy("member-edit");
    try {
      await patch(`/businesses/current/members/${editingMember.id}`, { role: editMemberRole, status: editMemberStatus, branchIds: editMemberBranchIds });
      setEditingMember(null); await Promise.all([members.refetch(), invalidate()]); setSuccess("دسترسی عضو به‌روزرسانی شد.");
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(""); }
  };

  const createBusiness = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setSuccess(""); setBusy("business");
    try {
      const result = await post<{ id: string; branch: { id: string } }>("/businesses", { displayName: newBusinessName, businessType: newBusinessType, initialBranchName: newBranchName, displayCurrency: newBusinessCurrency });
      sessionStorage.setItem("shopro_business_id", result.id);
      sessionStorage.setItem("shopro_branch_id", result.branch.id);
      await invalidate(); window.location.assign("/app");
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(""); }
  };

  const saveUnitVisibility = async () => {
    const visibleUnitIds = (unitSettings.data?.units ?? []).filter((unit) => unitVisibility[unit.id] ?? unit.isVisible).map((unit) => unit.id);
    if (!visibleUnitIds.length) { setError("برای ثبت کالا، دست‌کم یک واحد باید در فهرست نمایش بماند."); return; }
    setError(""); setSuccess(""); setBusy("units");
    try {
      const saved = await patch<UnitSettings>("/products/units/settings", { visibleUnitIds });
      setUnitVisibility(Object.fromEntries(saved.units.map((unit) => [unit.id, unit.isVisible])));
      queryClient.setQueryData(["unit-settings", business.id], saved);
      queryClient.setQueryData(["units", business.id], saved.units.filter((unit) => unit.isVisible).map(({ id, code, labelFa, precision, groupKey }) => ({ id, code, labelFa, precision, groupKey })));
      setUnitVisibilityDirty(false); invalidate(); setSuccess("فهرست واحدهای قابل‌نمایش ذخیره شد.");
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(""); }
  };

  const setAllUnitsVisible = (visible: boolean) => {
    if (!unitSettings.data) return;
    setUnitVisibility(Object.fromEntries(unitSettings.data.units.map((unit) => [unit.id, visible])));
    setUnitVisibilityDirty(true);
  };

  const setOnlyDefaultUnit = () => {
    if (!unitSettings.data) return;
    const defaultUnit = unitSettings.data.units.find((unit) => unit.code === "pcs") ?? unitSettings.data.units[0];
    setUnitVisibility(Object.fromEntries(unitSettings.data.units.map((unit) => [unit.id, unit.id === defaultUnit?.id])));
    setUnitVisibilityDirty(true);
  };

  return <PageHeader title="تنظیمات کسب‌وکار" subtitle="مدیریت مشخصات، شعبه‌ها، اعضا و تجربهٔ کاربری" actions={<button className="button button-secondary" type="button" onClick={() => jumpToSection("new-business")}><CirclePlus size={17} />کسب‌وکار تازه</button>}>
    <section className="settings-overview card" aria-label="خلاصهٔ کسب‌وکار فعال">
      <div className="settings-overview-main">
        <span className="settings-overview-icon"><Building2 size={24} /></span>
        <div className="settings-overview-copy"><span className="eyebrow">فضای کاری فعال</span><h2>{business.displayName}</h2><p>بخش موردنظرتان را باز کنید یا از میان‌برهای تنظیمات سریع به آن بروید.</p></div>
      </div>
      <div className="settings-overview-meta">
        <div><strong>{branches.isPending ? "—" : faNumber(branchRows.length)}</strong><span>شعبه</span></div>
        <i aria-hidden="true" />
        <div><strong>{members.isPending ? "—" : faNumber(memberRows.length)}</strong><span>عضو تیم</span></div>
        <i aria-hidden="true" />
        <div><strong>{business.displayCurrency === "IRT" ? "تومان" : "ریال"}</strong><span>واحد پول</span></div>
      </div>
    </section>

    {error && <InlineError error={error} />}
    {success && <div className="notice notice-success settings-notice" role="status">{success}</div>}

    <div className="settings-accessbar">
      <div className="settings-access-label"><Settings size={15} /><span>دسترسی سریع</span></div>
      <nav className="settings-jump-nav" aria-label="دسترسی سریع به بخش‌های تنظیمات">
        {sectionItems.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={openSections[id] ? "active" : ""} onClick={() => jumpToSection(id)}><Icon size={15} /><span>{label}</span></button>)}
      </nav>
      <button className="settings-toggle-all" type="button" onClick={toggleAll} aria-label={allOpen ? "بستن همهٔ بخش‌ها" : "بازکردن همهٔ بخش‌ها"}>{allOpen ? <Minimize2 size={15} /> : <Expand size={15} />}<span>{allOpen ? "بستن همه" : "بازکردن همه"}</span></button>
    </div>

    <div className="settings-sections">
      <SettingsAccordion id="business" title="مشخصات کسب‌وکار" summary="نام و واحد پولی که در فاکتورها و گزارش‌ها نمایش داده می‌شود" icon={Building2} open={openSections.business} onToggle={() => toggleSection("business")} meta="اطلاعات پایه">
        <div className="settings-panel-heading"><div><h3>اطلاعات پایه</h3><p>این مشخصات در فضای کاری و اسناد شما استفاده می‌شوند.</p></div><button className="button button-secondary" type="button" onClick={() => { setDisplayName(business.displayName); setCurrency(business.displayCurrency); setProfileOpen(true); }}><Settings size={16} />ویرایش مشخصات</button></div>
        <div className="settings-info-grid"><InfoTile label="نام کسب‌وکار" value={business.displayName} icon={Building2} /><InfoTile label="واحد نمایش پول" value={business.displayCurrency === "IRT" ? "تومان" : "ریال"} icon={Settings} /><InfoTile label="شعبهٔ انتخاب‌شده" value={branchRows.find((item) => item.id === currentBranchId)?.name ?? "شعبهٔ فعال"} icon={Store} /></div>
      </SettingsAccordion>

      <SettingsAccordion id="branches" title="شعبه‌ها" summary="مدیریت شعبی که فعالیت‌های کسب‌وکار در آن‌ها ثبت می‌شود" icon={Store} open={openSections.branches} onToggle={() => toggleSection("branches")} meta={`${branches.isPending ? "…" : faNumber(branchRows.length)} شعبه`}>
        <div className="settings-panel-heading"><div><h3>فهرست شعب</h3><p>شعبهٔ فعال شما در نوار بالای برنامه مشخص است.</p></div><button className="button button-primary" type="button" onClick={() => { setError(""); setBranchName(""); setBranchCode(""); setBranchOpen(true); }}><CirclePlus size={16} />افزودن شعبه</button></div>
        {branches.isError ? <InlineError error={branches.error} retry={() => void branches.refetch()} /> : branches.isPending ? <SettingsLoading label="در حال بارگذاری شعبه‌ها…" /> : branchRows.length ? <div className="settings-branch-grid">{branchRows.map((branch) => <article className={`settings-branch-card ${branch.id === currentBranchId ? "current" : ""}`} key={branch.id}><span className="settings-branch-icon"><Store size={18} /></span><div><strong>{branch.name}</strong><span>کد شعبه: <bdi dir="ltr">{branch.code}</bdi></span></div>{branch.id === currentBranchId && <span className="settings-current-badge"><Check size={13} />شعبهٔ جاری</span>}</article>)}</div> : <SettingsEmpty icon={Store} title="هنوز شعبه‌ای ندارید" text="برای تفکیک فعالیت‌ها، اولین شعبهٔ کسب‌وکارتان را اضافه کنید." action={<button className="button button-primary" type="button" onClick={() => setBranchOpen(true)}><CirclePlus size={16} />افزودن شعبه</button>} />}
      </SettingsAccordion>

      <SettingsAccordion id="members" title="اعضای تیم" summary="افزودن اعضا و مشاهدهٔ نقش و وضعیت دسترسی آن‌ها" icon={UsersRound} open={openSections.members} onToggle={() => toggleSection("members")} meta={`${members.isPending ? "…" : faNumber(memberRows.length)} عضو`}>
        <div className="settings-panel-heading"><div><h3>اعضا و دسترسی‌ها</h3><p>مالک می‌تواند نقش، شعبه‌ها و وضعیت دسترسی اعضا را مدیریت کند.</p></div><button className="button button-primary" type="button" disabled={!canManageMembers || !branchRows.length} onClick={() => { setError(""); setPhone(""); setRole("CASHIER"); setNewMemberBranchIds(branchRows.map((item) => item.id)); setMemberOpen(true); }}><CirclePlus size={16} />افزودن عضو</button></div>
        {!canManageMembers && <div className="settings-inline-hint">فقط مالک کسب‌وکار می‌تواند اعضا و دسترسی آن‌ها را مدیریت کند.</div>}
        {!branchRows.length && !branches.isPending && <div className="settings-inline-hint">برای افزودن عضو، ابتدا دست‌کم یک شعبه بسازید.</div>}
        {members.isError ? <InlineError error={members.error} retry={() => void members.refetch()} /> : members.isPending ? <SettingsLoading label="در حال بارگذاری اعضا…" /> : memberRows.length ? <div className="settings-member-list">{memberRows.map((member) => <article className="settings-member-row" key={member.id}><span className="settings-member-avatar">{(member.user.displayName ?? member.user.phone).slice(0, 1)}</span><div className="settings-member-copy"><strong>{member.user.displayName ?? member.user.phone}</strong><span dir="ltr">{member.user.displayName ? member.user.phone : roleLabel(member.role)}</span><small>{member.branchIds.map((id) => branchRows.find((branch) => branch.id === id)?.name).filter(Boolean).join("، ") || "بدون شعبهٔ فعال"}</small></div><span className="settings-role-badge">{roleLabel(member.role)}</span><span className={`settings-member-status ${member.status === "ACTIVE" ? "active" : "inactive"}`}><i />{member.status === "ACTIVE" ? "فعال" : "متوقف"}</span>{canManageMembers && member.role !== "OWNER" && <div className="settings-member-actions"><button className="button button-text" type="button" onClick={() => openMemberEditor(member)}>مدیریت دسترسی</button><button className="button button-text" type="button" onClick={() => setHistoryMember(member)}>تاریخچه</button></div>}</article>)}</div> : <SettingsEmpty icon={UsersRound} title="اعضایی به تیم اضافه نشده‌اند" text="با افزودن عضو می‌توانید دسترسی همکاران را در شعبه‌های کسب‌وکار مدیریت کنید." action={<button className="button button-primary" type="button" disabled={!canManageMembers || !branchRows.length} onClick={() => { setNewMemberBranchIds(branchRows.map((item) => item.id)); setMemberOpen(true); }}><CirclePlus size={16} />افزودن عضو</button>} />}
        {canManageMembers && <BusinessAuditPanel businessId={business.id} actors={memberRows.map((member) => ({ id: member.user.id, label: member.user.displayName ?? member.user.phone }))} />}
      </SettingsAccordion>

      <SettingsAccordion id="units" title="واحدهای اندازه‌گیری" summary="انتخاب واحدهایی که در فرم تعریف کالا نمایش داده می‌شوند" icon={Ruler} open={openSections.units} onToggle={() => toggleSection("units")} meta={`${unitSettings.isPending ? "…" : faNumber(visibleUnitCount)} واحد فعال`}>
        <div className="settings-panel-heading"><div><h3>واحدهای قابل‌استفاده</h3><p>فقط واحدهای روشن در فهرست انتخاب کالا نمایش داده می‌شوند.</p></div><div className="settings-unit-bulk-actions"><button className="button button-secondary" type="button" disabled={!canManageUnits || unitSettings.isPending || !unitSettings.data?.units.length} onClick={() => setOnlyDefaultUnit()}>فقط عدد</button><button className="button button-text" type="button" disabled={!canManageUnits || unitSettings.isPending || !unitSettings.data?.units.length} onClick={() => setAllUnitsVisible(true)}>نمایش همه</button></div></div>
        {!canManageUnits && <div className="settings-inline-hint">نقش شما اجازهٔ تغییر فهرست واحدهای کسب‌وکار را ندارد.</div>}
        {unitSettings.isError ? <InlineError error={unitSettings.error} retry={() => void unitSettings.refetch()} /> : unitSettings.isPending ? <SettingsLoading label="در حال بارگذاری فهرست واحدها…" /> : <>
          <div className="settings-unit-groups">{unitSettings.data.groups.map((group) => <section className="settings-unit-group" key={group.key}><header><strong>{group.labelFa}</strong><span>{faNumber(group.units.filter((unit) => unitVisibility[unit.id] ?? unit.isVisible).length)} از {faNumber(group.units.length)}</span></header><div className="settings-unit-options">{group.units.map((unit) => { const checked = unitVisibility[unit.id] ?? unit.isVisible; return <label className={`settings-unit-option ${checked ? "selected" : ""}`} key={unit.id}><input type="checkbox" disabled={!canManageUnits} checked={checked} onChange={() => { setUnitVisibility((current) => ({ ...current, [unit.id]: !checked })); setUnitVisibilityDirty(true); }} /><span className="settings-unit-checkbox" aria-hidden="true">{checked && <Check size={13} />}</span><span className="settings-unit-copy"><strong>{unit.labelFa}</strong>{unit.code === "pcs" && <small>واحد پیش‌فرض</small>}</span></label>; })}</div></section>)}</div>
          <div className="settings-unit-footer"><p>{visibleUnitCount === 0 ? "برای ثبت کالا، دست‌کم یک واحد را روشن نگه دارید." : visibleUnitCount === 1 ? "تنها واحد روشن، هنگام تعریف کالا به‌طور خودکار انتخاب می‌شود." : "پنهان‌کردن یک واحد، واحد کالاهای ثبت‌شدهٔ قبلی را تغییر نمی‌دهد."}</p><button className="button button-primary" type="button" disabled={!canManageUnits || !unitVisibilityDirty || !visibleUnitCount || busy === "units"} onClick={() => void saveUnitVisibility()}><Save size={16} />{busy === "units" ? "در حال ذخیره…" : "ذخیرهٔ فهرست واحدها"}</button></div>
        </>}
      </SettingsAccordion>

      <SettingsAccordion id="appearance" title="ظاهر و نمایش" summary="انتخاب حالت نمایش برنامه متناسب با محیط کارتان" icon={Palette} open={openSections.appearance} onToggle={() => toggleSection("appearance")} meta={themeLabel(theme)}>
        <div className="settings-panel-heading"><div><h3>حالت نمایش</h3><p>انتخاب شما روی همین دستگاه ذخیره می‌شود و هر زمان قابل تغییر است.</p></div></div>
        <div className="settings-theme-options" role="group" aria-label="حالت نمایش برنامه">
          <ThemeChoice value="light" current={theme} label="روشن" description="پس‌زمینهٔ روشن" icon={Sun} onChange={setTheme} />
          <ThemeChoice value="dark" current={theme} label="تیره" description="مناسب محیط کم‌نور" icon={Moon} onChange={setTheme} />
          <ThemeChoice value="auto" current={theme} label="همگام با دستگاه" description="تغییر خودکار با سیستم" icon={Monitor} onChange={setTheme} />
        </div>
        <p className="settings-saved-hint"><Check size={14} /> تغییر حالت نمایش بلافاصله ذخیره می‌شود.</p>
      </SettingsAccordion>

      <SettingsAccordion id="new-business" title="کسب‌وکار تازه" summary="برای هر کسب‌وکار، شعبه‌ها و فضای کاری جداگانه داشته باشید" icon={BriefcaseBusiness} open={openSections["new-business"]} onToggle={() => toggleSection("new-business")} meta="ایجاد فضای کاری">
        <div className="settings-create-business"><span className="settings-create-icon"><BriefcaseBusiness size={22} /></span><div><h3>یک فضای کاری دیگر بسازید</h3><p>با ساخت کسب‌وکار تازه، یک شعبهٔ اولیه هم ایجاد می‌شود و می‌توانید در هر زمان بین فضاهای کاری جابه‌جا شوید.</p><button className="button button-primary" type="button" onClick={() => { setError(""); setNewBusinessName(""); setNewBusinessType("فروشگاه"); setNewBranchName("شعبهٔ اصلی"); setNewBusinessCurrency(business.displayCurrency); setOpenSections((previous) => ({ ...previous, "new-business": true })); setBusinessModalOpen(true); }}><CirclePlus size={16} />ساخت کسب‌وکار</button></div></div>
      </SettingsAccordion>
    </div>

    <Modal open={profileOpen} onClose={() => setProfileOpen(false)} title="ویرایش مشخصات کسب‌وکار" description="نام و واحد پول کسب‌وکار را به‌روزرسانی کنید.">
      <form onSubmit={(event) => void saveProfile(event)}><div className="form-grid"><Field label="نام کسب‌وکار" value={displayName} onChange={setDisplayName} required /><SelectField label="واحد نمایش پول" value={currency} onChange={(value) => setCurrency(value as typeof currency)} options={[{ value: "IRT", label: "تومان" }, { value: "IRR", label: "ریال" }]} /></div>{error && <InlineError error={error} />}<div className="modal-form-actions"><SubmitButton busy={busy === "profile"}>ذخیرهٔ تغییرات</SubmitButton></div></form>
    </Modal>

    <Modal open={branchOpen} onClose={() => setBranchOpen(false)} title="افزودن شعبه" description="نام و کد یکتای شعبه را وارد کنید.">
      <form onSubmit={(event) => void addBranch(event)}><div className="form-grid"><Field label="نام شعبه" value={branchName} onChange={setBranchName} required /><Field label="کد شعبه" value={branchCode} onChange={setBranchCode} required placeholder="مثلاً NORTH" /></div>{error && <InlineError error={error} />}<div className="modal-form-actions"><SubmitButton busy={busy === "branch"}>افزودن شعبه</SubmitButton></div></form>
    </Modal>

    <Modal open={memberOpen} onClose={() => setMemberOpen(false)} title="افزودن عضو به کسب‌وکار" description="کاربر باید پیش‌تر یک‌بار با شمارهٔ موبایل خودش وارد شده باشد.">
      <form onSubmit={(event) => void addMember(event)}><div className="form-grid"><Field label="شمارهٔ موبایل" value={phone} onChange={setPhone} required inputMode="tel" dir="ltr" placeholder="۰۹۱۲…" /><SelectField label="نقش" value={role} onChange={setRole} options={memberRoleOptions} /></div><fieldset className="settings-member-branches"><legend>شعبه‌های مجاز</legend>{branchRows.map((branch) => <label key={branch.id}><input type="checkbox" checked={newMemberBranchIds.includes(branch.id)} onChange={() => setNewMemberBranchIds((ids) => ids.includes(branch.id) ? ids.filter((id) => id !== branch.id) : [...ids, branch.id])} /><span>{branch.name}</span></label>)}</fieldset><p className="settings-modal-hint">فقط فعالیت‌های شعبه‌های انتخاب‌شده برای این عضو قابل‌دسترسی خواهد بود.</p>{error && <InlineError error={error} />}{members.isError && <InlineError error={members.error} retry={() => void members.refetch()} />}<div className="modal-form-actions"><SubmitButton busy={busy === "member"}>ثبت دسترسی عضو</SubmitButton></div></form>
    </Modal>

    <Modal open={Boolean(editingMember)} onClose={() => setEditingMember(null)} title="مدیریت دسترسی عضو" description={editingMember ? `تغییر دسترسی ${editingMember.user.displayName ?? editingMember.user.phone} ثبت و در تاریخچه نگه‌داری می‌شود.` : undefined}>
      {editingMember && <form onSubmit={(event) => void saveMemberAccess(event)}><div className="form-grid"><SelectField label="نقش" value={editMemberRole} onChange={setEditMemberRole} options={memberRoleOptions} /><SelectField label="وضعیت دسترسی" value={editMemberStatus} onChange={setEditMemberStatus} options={[{ value: "ACTIVE", label: "فعال" }, { value: "SUSPENDED", label: "متوقف" }]} /></div><fieldset className="settings-member-branches"><legend>شعبه‌های مجاز</legend>{branchRows.map((branch) => <label key={branch.id}><input type="checkbox" checked={editMemberBranchIds.includes(branch.id)} onChange={() => setEditMemberBranchIds((ids) => ids.includes(branch.id) ? ids.filter((id) => id !== branch.id) : [...ids, branch.id])} /><span>{branch.name}</span></label>)}</fieldset><p className="settings-modal-hint">مالک‌های کسب‌وکار از این فرم قابل‌تغییر یا تعلیق نیستند. برای قطع دسترسی عضو، وضعیت «متوقف» را انتخاب کنید.</p>{error && <InlineError error={error} />}<div className="modal-form-actions"><SubmitButton busy={busy === "member-edit"}>ثبت تغییر دسترسی</SubmitButton></div></form>}
    </Modal>

    <Modal open={Boolean(historyMember)} onClose={() => setHistoryMember(null)} title="تاریخچهٔ دسترسی عضو" description={historyMember ? historyMember.user.displayName ?? historyMember.user.phone : undefined}>
      {memberHistory.isError ? <InlineError error={memberHistory.error} retry={() => void memberHistory.refetch()} /> : memberHistory.isPending ? <SettingsLoading label="در حال بارگذاری تاریخچه…" /> : memberHistory.data?.length ? <div className="settings-member-history">{memberHistory.data.map((entry, index) => <article key={`${entry.occurredAt}-${index}`}><div><strong>{memberActionLabel(entry.action)}</strong><time>{jalaliDate(entry.occurredAt.slice(0, 10))}</time></div><small>{memberSnapshot(entry.after, branchRows)}{entry.actorName ? ` · توسط ${entry.actorName}` : ""}</small>{entry.before && <small>پیش از تغییر: {memberSnapshot(entry.before, branchRows)}</small>}</article>)}</div> : <div className="settings-inline-hint">تغییری برای نمایش ثبت نشده است.</div>}
    </Modal>

    <Modal open={businessModalOpen} onClose={() => setBusinessModalOpen(false)} title="ساخت کسب‌وکار تازه" description="پس از ایجاد، وارد فضای کاری جدید می‌شوید.">
      <form onSubmit={(event) => void createBusiness(event)}><div className="form-grid"><Field label="نام کسب‌وکار" value={newBusinessName} onChange={setNewBusinessName} required /><Field label="نوع کسب‌وکار" value={newBusinessType} onChange={setNewBusinessType} required /><Field label="نام شعبهٔ اولیه" value={newBranchName} onChange={setNewBranchName} required /><SelectField label="واحد نمایش پول" value={newBusinessCurrency} onChange={(value) => setNewBusinessCurrency(value as typeof newBusinessCurrency)} options={[{ value: "IRT", label: "تومان" }, { value: "IRR", label: "ریال" }]} /></div>{error && <InlineError error={error} />}<div className="modal-form-actions"><SubmitButton busy={busy === "business"}>ساخت و ورود به کسب‌وکار</SubmitButton></div></form>
    </Modal>
  </PageHeader>;

}

type BusinessAuditRow = { id: string; action: string; entityType: string; entityId: string; occurredAt: string; actorId: string | null; actorName: string | null };
type AuditFilters = { actorId: string; action: string; entityType: string; from: string; to: string };

function BusinessAuditPanel({ businessId, actors }: { businessId: string; actors: Array<{ id: string; label: string }> }) {
  const [draft, setDraft] = useState<AuditFilters>({ actorId: "", action: "", entityType: "", from: "", to: "" });
  const [filters, setFilters] = useState(draft);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const query = useInfiniteQuery({ queryKey: ["business-audit", businessId, filters], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => get<CursorPage<BusinessAuditRow>>(`/businesses/current/audit?${auditQuery(filters, pageParam, 50)}`), getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined });
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  const update = (key: keyof AuditFilters, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const exportCsv = async () => {
    setExportBusy(true); setExportError("");
    try {
      const all: BusinessAuditRow[] = [];
      let cursor: string | undefined;
      do {
        const page = await get<CursorPage<BusinessAuditRow>>(`/businesses/current/audit?${auditQuery(filters, cursor, 100)}`);
        all.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        if (all.length >= 10_000 && cursor) throw new Error("بیش از ۱۰٬۰۰۰ رویداد پیدا شد؛ بازه یا فیلتر را محدودتر کنید.");
      } while (cursor);
      downloadCsv(`shopro-audit-${businessId}.csv`, [
        ["زمان", "عملیات", "نوع مورد", "کاربر", "شناسهٔ مورد"],
        ...all.map((row) => [row.occurredAt, row.action, row.entityType, row.actorName ?? "کاربر حذف‌شده", row.entityId]),
      ]);
    } catch (cause) { setExportError(messageOf(cause)); }
    finally { setExportBusy(false); }
  };
  return <section className="settings-audit-panel">
    <div className="settings-panel-heading"><div><h3>رویدادهای کسب‌وکار</h3><p>تغییرات مدیریتی و مالی این کسب‌وکار؛ اطلاعات قبل و بعد برای دانلود در دسترس نیست.</p></div><button type="button" className="button button-secondary" disabled={exportBusy || query.isPending} onClick={() => void exportCsv()}><Download size={16} />{exportBusy ? "در حال آماده‌سازی…" : "دریافت CSV فیلترشده"}</button></div>
    <form className="settings-audit-filters" onSubmit={(event) => { event.preventDefault(); setFilters({ ...draft }); }}>
      <SelectField label="کاربر" value={draft.actorId} onChange={(value) => update("actorId", value)} options={actors.map((actor) => ({ value: actor.id, label: actor.label }))} placeholder="همهٔ کاربران" />
      <Field label="عملیات" value={draft.action} onChange={(value) => update("action", value)} placeholder="مثلاً member.suspended" />
      <Field label="نوع مورد" value={draft.entityType} onChange={(value) => update("entityType", value)} placeholder="مثلاً product" />
      <JalaliDatePicker label="از تاریخ" value={draft.from} onChange={(value) => update("from", value)} clearable />
      <JalaliDatePicker label="تا تاریخ" value={draft.to} onChange={(value) => update("to", value)} clearable />
      <button type="button" className="button button-secondary" onClick={() => { const empty = { actorId: "", action: "", entityType: "", from: "", to: "" }; setDraft(empty); setFilters(empty); }}>پاک‌کردن فیلترها</button>
      <button type="submit" className="button button-primary">اعمال فیلتر</button>
    </form>
    {exportError && <InlineError error={exportError} />}
    {query.isError ? <InlineError error={query.error} retry={() => void query.refetch()} /> : query.isPending ? <SettingsLoading label="در حال بارگذاری رویدادها…" /> : rows.length ? <div className="settings-audit-list">{rows.map((row) => <article key={row.id}><div><strong>{auditActionLabel(row.action)}</strong><time>{jalaliDate(row.occurredAt.slice(0, 10))}</time></div><small>{auditEntityLabel(row.entityType)} · {row.actorName ?? "کاربر حذف‌شده"}</small></article>)}</div> : <div className="settings-inline-hint">با فیلتر فعلی رویدادی پیدا نشد.</div>}
    <LoadMoreButton hasMore={Boolean(query.hasNextPage)} isLoading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} />
  </section>;
}

function auditQuery(filters: AuditFilters, cursor: string | undefined, limit: number) {
  const params = new URLSearchParams({ limit: String(limit) });
  for (const key of Object.keys(filters) as Array<keyof AuditFilters>) if (filters[key]) params.set(key, filters[key]);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = { "business.created": "ساخت کسب‌وکار", "business.updated": "تغییر تنظیمات کسب‌وکار", "branch.created": "افزودن شعبه", "member.assigned": "افزودن عضو", "member.access.updated": "تغییر دسترسی عضو", "member.suspended": "توقف دسترسی عضو", "member.reactivated": "فعال‌سازی عضو", "product.created": "تعریف کالا", "product.updated": "تغییر کالا", "product.price.updated": "تغییر قیمت کالا", "party.created": "افزودن طرف‌حساب", "party.updated": "تغییر طرف‌حساب", "sale.posted": "ثبت نهایی فروش", "purchase.posted": "ثبت نهایی خرید", "expense.posted": "ثبت نهایی هزینه" };
  return labels[action] ?? action;
}

function auditEntityLabel(entityType: string) {
  return ({ business: "کسب‌وکار", branch: "شعبه", business_member: "عضو", product: "کالا", party: "طرف‌حساب", sale_invoice: "فاکتور فروش", purchase: "فاکتور خرید", expense: "هزینه", cash_transaction: "تراکنش مالی" } as Record<string, string>)[entityType] ?? entityType;
}

function SettingsAccordion({ id, title, summary, icon: Icon, open, onToggle, meta, children }: { id: SettingsSectionId; title: string; summary: string; icon: LucideIcon; open: boolean; onToggle: () => void; meta: string; children: ReactNode }) {
  return <section id={`settings-${id}`} className={`settings-accordion card ${open ? "open" : ""}`}>
    <button className="settings-accordion-trigger" type="button" aria-expanded={open} aria-controls={`settings-panel-${id}`} onClick={onToggle}>
      <span className="settings-accordion-icon"><Icon size={20} /></span>
      <span className="settings-accordion-title"><strong>{title}</strong><small>{summary}</small></span>
      <span className="settings-accordion-meta">{meta}</span>
      <span className="settings-accordion-chevron"><ChevronDown size={18} /></span>
    </button>
    <div id={`settings-panel-${id}`} className="settings-accordion-panel" hidden={!open}>
      <div className="settings-accordion-content">{children}</div>
    </div>
  </section>;
}

function InfoTile({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return <div className="settings-info-tile"><span><Icon size={16} /></span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function ThemeChoice({ value, current, label, description, icon: Icon, onChange }: { value: string; current: string; label: string; description: string; icon: LucideIcon; onChange: (value: string) => void }) {
  const selected = current === value;
  return <button type="button" aria-pressed={selected} className={`settings-theme-choice ${selected ? "selected" : ""}`} onClick={() => onChange(value)}><span className="settings-theme-icon"><Icon size={19} /></span><span><strong>{label}</strong><small>{description}</small></span><span className="settings-theme-check">{selected && <Check size={14} />}</span></button>;
}

function SettingsLoading({ label }: { label: string }) { return <div className="settings-loading" role="status"><span className="loading-spinner" />{label}</div>; }

function SettingsEmpty({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text: string; action: ReactNode }) {
  return <div className="settings-empty"><span><Icon size={22} /></span><div><strong>{title}</strong><p>{text}</p></div>{action}</div>;
}

function themeLabel(theme: string) { return ({ auto: "همگام با دستگاه", light: "روشن", dark: "تیره" } as Record<string, string>)[theme] ?? "همگام با دستگاه"; }
function roleLabel(role: string) { return ({ OWNER: "مالک", MANAGER: "مدیر شعبه", ACCOUNTANT: "حسابدار", CASHIER: "صندوقدار", VIEWER: "مشاهده‌گر" } as Record<string, string>)[role] ?? "عضو"; }
function memberActionLabel(action: string) { return ({ "member.assigned": "افزودن عضو", "member.access.updated": "تغییر دسترسی", "member.suspended": "توقف دسترسی", "member.reactivated": "فعال‌سازی دوباره" } as Record<string, string>)[action] ?? "تغییر دسترسی"; }
function memberSnapshot(snapshot: MemberAudit["after"], branches: Branch[]) {
  if (!snapshot) return "";
  const names = (snapshot.branchIds ?? []).map((id) => branches.find((branch) => branch.id === id)?.name).filter(Boolean);
  return [snapshot.role ? roleLabel(snapshot.role) : null, snapshot.status ? snapshot.status === "ACTIVE" ? "فعال" : "متوقف" : null, names.length ? names.join("، ") : null].filter(Boolean).join(" · ");
}
