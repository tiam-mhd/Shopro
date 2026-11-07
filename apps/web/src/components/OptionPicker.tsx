import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Check, List, Plus, Search } from "lucide-react";
import type { CursorPage } from "@shopro/contracts";
import { Modal } from "./Modal.js";

export type PickerOption = { value: string; label: string };
export type PickerOptionLoader = (search: string, cursor?: string) => Promise<CursorPage<PickerOption>>;

export function OptionPicker({ label, value, options, onChange, placeholder, onAdd, addLabel = "افزودن مورد تازه", optionsKey, loadOptions, onBrowseAll, browseAllLabel = "نمایش همهٔ واحدها" }: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  onAdd?: () => void;
  addLabel?: string;
  optionsKey?: string;
  loadOptions?: PickerOptionLoader;
  onBrowseAll?: () => void;
  browseAllLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [lastSelectedOption, setLastSelectedOption] = useState<PickerOption | null>(null);
  useEffect(() => { const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 220); return () => window.clearTimeout(timeout); }, [search]);
  const remote = useInfiniteQuery({ queryKey: ["option-picker", optionsKey ?? label, debouncedSearch], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => loadOptions!(debouncedSearch, pageParam), getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined, enabled: open && Boolean(loadOptions), staleTime: 30_000 });
  const remoteOptions = remote.data?.pages.flatMap((page) => page.items) ?? [];
  const availableOptions = loadOptions ? [...options, ...remoteOptions] : options;
  const selected = availableOptions.find((option) => option.value === value) ?? (lastSelectedOption?.value === value ? lastSelectedOption : undefined);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("fa-IR");
    return loadOptions ? remoteOptions : query ? options.filter((option) => option.label.toLocaleLowerCase("fa-IR").includes(query)) : options;
  }, [loadOptions, options, remoteOptions, search]);
  const close = () => { setOpen(false); setSearch(""); setDebouncedSearch(""); };
  const choose = (next: string) => { setLastSelectedOption(availableOptions.find((option) => option.value === next) ?? null); onChange(next); close(); };

  return <div className="field option-picker-field">
    <span className="field-label">{label}</span>
    <button type="button" className="option-picker-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <span className={selected ? "" : "placeholder"}>{selected?.label ?? placeholder ?? "انتخاب کنید"}</span>
      <Search size={16} aria-hidden="true" />
    </button>
    <Modal open={open} onClose={close} title={`انتخاب ${label}`} description="برای پیدا کردن سریع، نام یا بخشی از آن را جست‌وجو کنید.">
      <div className={`option-picker-search ${onBrowseAll ? "has-browse-all" : ""}`}><Search size={17} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`جست‌وجوی ${label}`} aria-label={`جست‌وجوی ${label}`} />{onBrowseAll && <button type="button" className="option-picker-browse-all" onClick={() => { close(); onBrowseAll(); }}><List size={14} />{browseAllLabel}</button>}</div>
      {onAdd && <button type="button" className="button button-secondary picker-add" onClick={() => { close(); onAdd(); }}><Plus size={17} />{addLabel}</button>}
      <div className="option-picker-list" role="listbox" aria-label={label}>
        {placeholder && <button type="button" role="option" aria-selected={!value} className="option-picker-item" onClick={() => choose("")}><span>{placeholder}</span>{!value && <Check size={17} />}</button>}
        {loadOptions && remote.isError && <div className="option-picker-empty"><p>دریافت گزینه‌ها ناموفق بود.</p><button type="button" className="button button-secondary" onClick={() => void remote.refetch()}>تلاش دوباره</button></div>}
        {loadOptions && remote.isPending && <p className="option-picker-empty">در حال جست‌وجو…</p>}
        {filtered.map((option) => <button type="button" role="option" aria-selected={option.value === value} className="option-picker-item" key={option.value} onClick={() => choose(option.value)}><span>{option.label}</span>{option.value === value && <Check size={17} />}</button>)}
        {!remote.isPending && !filtered.length && <p className="option-picker-empty">موردی با این عبارت پیدا نشد.</p>}
      </div>
      {loadOptions && (remote.hasNextPage || remote.isFetchingNextPage) && <div className="pagination-more"><button type="button" className="button button-secondary" disabled={!remote.hasNextPage || remote.isFetchingNextPage} onClick={() => void remote.fetchNextPage()}>{remote.isFetchingNextPage ? "در حال بارگذاری…" : "نمایش موارد بیشتر"}</button></div>}
    </Modal>
  </div>;
}
