import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { format as formatJalali, getDaysInMonth, parse } from "date-fns-jalali";
import { CalendarDays, ChevronDown, X } from "lucide-react";

const months = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
const digits = (value: string) => value.replace(/[0-9]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
const jalaliParts = (date: Date) => formatJalali(date, "yyyy-M-d").split("-").map(Number) as [number, number, number];
const parseJalali = (year: number, month: number, day: number) => parse(`${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`, "yyyy/MM/dd", new Date(2000, 0, 1));
const toIso = (date: Date) => new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString().slice(0, 10);
const WHEEL_ITEM_HEIGHT = 40;

export function JalaliDatePicker({ value, onChange, label = "تاریخ" }: { value: string; onChange: (iso: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const current = useMemo(() => {
    const date = value ? new Date(`${value}T12:00:00`) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }, [value]);
  const [year, setYear] = useState(() => jalaliParts(current)[0]);
  const [month, setMonth] = useState(() => jalaliParts(current)[1]);
  const [day, setDay] = useState(() => jalaliParts(current)[2]);
  const today = jalaliParts(new Date());
  const monthDate = useMemo(() => parseJalali(year, month, 1), [year, month]);
  const dayCount = getDaysInMonth(monthDate);
  const clampDay = (nextMonth: number, nextYear: number, selected: number) => Math.min(selected, getDaysInMonth(parseJalali(nextYear, nextMonth, 1)));
  const openPicker = () => { const [y, m, d] = jalaliParts(current); setYear(y); setMonth(m); setDay(d); setOpen(true); };
  return <>
    <button type="button" className="date-field" onClick={openPicker} aria-label={`انتخاب ${label}`}><CalendarDays size={18} /><span>{label}</span><strong dir="ltr">{digits(formatJalali(current, "yyyy/MM/dd"))}</strong><ChevronDown size={16} /></button>
    {open && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="date-modal" role="dialog" aria-modal="true" aria-labelledby="date-title" dir="rtl">
        <header className="modal-heading"><div><span className="eyebrow">تقویم خورشیدی</span><h2 id="date-title">انتخاب {label}</h2></div><button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="بستن"><X size={20} /></button></header>
        <div className="date-wheels">
          <Wheel title="روز" value={day} options={Array.from({ length: dayCount }, (_, i) => i + 1)} onChange={setDay} />
          <Wheel title="ماه" value={month} options={months.map((_, i) => i + 1)} labels={months} onChange={(next) => { setMonth(next); setDay((old) => clampDay(next, year, old)); }} />
          <Wheel title="سال" value={year} options={Array.from({ length: 121 }, (_, i) => today[0] - 80 + i)} onChange={(next) => { setYear(next); setDay((old) => clampDay(month, next, old)); }} />
        </div>
        <button className="today-button" type="button" onClick={() => { setYear(today[0]); setMonth(today[1]); setDay(today[2]); }}>رفتن به امروز <span>{digits(formatJalali(new Date(), "yyyy/MM/dd"))}</span></button>
        <p className="date-hint">تاریخ انتخاب‌شده در فاکتور و گزارش شما ثبت می‌شود.</p>
        <button className="button button-primary confirm-date" type="button" onClick={() => { const date = parseJalali(year, month, day); onChange(toIso(date)); setOpen(false); }}>تأیید تاریخ</button>
      </section>
    </div>}
  </>;
}

function Wheel({ title, value, options, labels, onChange }: { title: string; value: number; options: number[]; labels?: string[]; onChange: (value: number) => void }) {
  const wheelId = useId();
  const wheelRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollEndRef = useRef<number | null>(null);
  const optionsRef = useRef(options);
  const onChangeRef = useRef(onChange);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.indexOf(value)));
  optionsRef.current = options;
  onChangeRef.current = onChange;
  const labelFor = (item: number) => labels?.[item - 1] ?? digits(String(item));
  const scrollToIndex = (index: number, behavior: ScrollBehavior) => {
    wheelRef.current?.scrollTo({ top: index * WHEEL_ITEM_HEIGHT, behavior });
  };

  useLayoutEffect(() => {
    const wheel = wheelRef.current;
    if (!wheel || options.length === 0) return;
    const index = Math.max(0, options.indexOf(value));
    setActiveIndex(index);
    if (!initializedRef.current) {
      wheel.scrollTop = index * WHEEL_ITEM_HEIGHT;
      initializedRef.current = true;
    } else {
      scrollToIndex(index, "smooth");
    }
  }, [value, options.length, options[0], options[options.length - 1]]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    if (scrollEndRef.current !== null) window.clearTimeout(scrollEndRef.current);
  }, []);

  const selectIndex = (nextIndex: number) => {
    const boundedIndex = Math.max(0, Math.min(optionsRef.current.length - 1, nextIndex));
    const nextValue = optionsRef.current[boundedIndex];
    if (nextValue === undefined) return;
    setActiveIndex(boundedIndex);
    onChangeRef.current(nextValue);
    scrollToIndex(boundedIndex, "smooth");
  };

  const handleScroll = () => {
    const wheel = wheelRef.current;
    if (!wheel) return;
    if (scrollFrameRef.current === null) {
      scrollFrameRef.current = requestAnimationFrame(() => {
        const items = optionsRef.current;
        const index = Math.max(0, Math.min(items.length - 1, Math.round((wheel.scrollTop || 0) / WHEEL_ITEM_HEIGHT)));
        setActiveIndex(index);
        scrollFrameRef.current = null;
      });
    }
    if (scrollEndRef.current !== null) window.clearTimeout(scrollEndRef.current);
    scrollEndRef.current = window.setTimeout(() => {
      const items = optionsRef.current;
      const index = Math.max(0, Math.min(items.length - 1, Math.round((wheel.scrollTop || 0) / WHEEL_ITEM_HEIGHT)));
      const nextValue = items[index];
      setActiveIndex(index);
      if (nextValue !== undefined) onChangeRef.current(nextValue);
      scrollEndRef.current = null;
    }, 160);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = Math.max(0, Math.min(options.length - 1, activeIndex));
    let nextIndex: number | undefined;
    if (event.key === "ArrowUp") nextIndex = index - 1;
    else if (event.key === "ArrowDown") nextIndex = index + 1;
    else if (event.key === "PageUp") nextIndex = index - 5;
    else if (event.key === "PageDown") nextIndex = index + 5;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = options.length - 1;
    if (nextIndex !== undefined) {
      event.preventDefault();
      selectIndex(nextIndex);
    }
  };

  return <div className="wheel">
    <span className="wheel-title">{title}</span>
    <div ref={wheelRef} className="wheel-list" role="listbox" tabIndex={0} aria-label={title} aria-activedescendant={`${wheelId}-option-${options[activeIndex] ?? value}`} onScroll={handleScroll} onKeyDown={handleKeyDown}>
      {options.map((item, index) => <div key={item} id={`${wheelId}-option-${item}`} className={`wheel-option${index === activeIndex ? " is-active" : ""}`} role="option" aria-selected={index === activeIndex} onClick={() => selectIndex(index)}>
        {labelFor(item)}
      </div>)}
    </div>
  </div>;
}
