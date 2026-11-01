import { useMemo, useState } from "react";
import { Check, Plus, Search } from "lucide-react";
import { Modal } from "./Modal.js";

export type PickerOption = { value: string; label: string };

export function OptionPicker({ label, value, options, onChange, placeholder, onAdd, addLabel = "افزودن مورد تازه" }: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  onAdd?: () => void;
  addLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("fa-IR");
    return query ? options.filter((option) => option.label.toLocaleLowerCase("fa-IR").includes(query)) : options;
  }, [options, search]);
  const close = () => { setOpen(false); setSearch(""); };
  const choose = (next: string) => { onChange(next); close(); };

  return <div className="field option-picker-field">
    <span className="field-label">{label}</span>
    <button type="button" className="option-picker-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <span className={selected ? "" : "placeholder"}>{selected?.label ?? placeholder ?? "انتخاب کنید"}</span>
      <Search size={16} aria-hidden="true" />
    </button>
    <Modal open={open} onClose={close} title={`انتخاب ${label}`} description="برای پیدا کردن سریع، نام یا بخشی از آن را جست‌وجو کنید.">
      <div className="option-picker-search"><Search size={17} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`جست‌وجوی ${label}`} aria-label={`جست‌وجوی ${label}`} /></div>
      {onAdd && <button type="button" className="button button-secondary picker-add" onClick={() => { close(); onAdd(); }}><Plus size={17} />{addLabel}</button>}
      <div className="option-picker-list" role="listbox" aria-label={label}>
        {placeholder && <button type="button" role="option" aria-selected={!value} className="option-picker-item" onClick={() => choose("")}><span>{placeholder}</span>{!value && <Check size={17} />}</button>}
        {filtered.map((option) => <button type="button" role="option" aria-selected={option.value === value} className="option-picker-item" key={option.value} onClick={() => choose(option.value)}><span>{option.label}</span>{option.value === value && <Check size={17} />}</button>)}
        {!filtered.length && <p className="option-picker-empty">موردی با این عبارت پیدا نشد.</p>}
      </div>
    </Modal>
  </div>;
}
