import { format, isValid, parse } from "date-fns-jalali";

export function jalaliParts(date) {
  return format(date, "yyyy-M-d").split("-").map(Number);
}

export function parseJalali(year, month, day) {
  const value = `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
  return parse(value, "yyyy/MM/dd", new Date(2000, 0, 1));
}

export function toIsoDate(date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString().slice(0, 10);
}

export function gregorianDateFromJalali(year, monthIndex, day) {
  const parsed = parseJalali(year, monthIndex + 1, day);
  if (!isValid(parsed)) throw new Error("تاریخ جلالی معتبر نیست.");
  return toIsoDate(parsed);
}

export function jalaliDateFromIso(iso) {
  if (!iso) return "—";
  const date = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "yyyy/MM/dd").replace(/[0-9]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}
