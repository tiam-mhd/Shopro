export { faNumber, money } from "./numeric-format.js";
export { gregorianDateFromJalali } from "./jalali-date.js";
import { jalaliDateFromIso } from "./jalali-date.js";

export function todayISO(timeZone = "Asia/Tehran") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function jalaliDate(iso?: string | null) {
  return jalaliDateFromIso(iso);
}
