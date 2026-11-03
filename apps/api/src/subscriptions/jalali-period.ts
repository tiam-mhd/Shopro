const DAY_MS = 86_400_000;
const TEHRAN = "Asia/Tehran";

type CalendarParts = { year: number; month: number; day: number };
type WallClockParts = CalendarParts & { hour: number; minute: number; second: number };

function partsFor(formatter: Intl.DateTimeFormat, date: Date): Record<string, number> {
  return Object.fromEntries(formatter.formatToParts(date).flatMap(({ type, value }) => {
    if (type === "literal") return [];
    const number = Number(value);
    return Number.isFinite(number) ? [[type, number]] : [];
  }));
}

const jalaliFormatter = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
  timeZone: TEHRAN, year: "numeric", month: "numeric", day: "numeric",
});
const wallClockFormatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
  timeZone: TEHRAN, year: "numeric", month: "numeric", day: "numeric",
  hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23",
});

function jalaliParts(date: Date): CalendarParts {
  const { year, month, day } = partsFor(jalaliFormatter, date);
  return { year, month, day };
}

function monthStartUtcDate(year: number, month: number): Date {
  // A Jalali year starts in March around Gregorian year + 621. Starting on
  // January 1 gives a bounded, locale-backed search that also handles leap years.
  const cursor = new Date(Date.UTC(year + 621, 2, 1));
  for (let day = 0; day < 400; day++) {
    const candidate = new Date(cursor.getTime() + day * DAY_MS);
    const current = jalaliParts(candidate);
    if (current.year === year && current.month === month && current.day === 1) return candidate;
  }
  throw new RangeError("Jalali month could not be resolved in Asia/Tehran.");
}

function targetLocalInstant(date: Date, targetDate: Date, timeZone: string): Date {
  const local = partsFor(new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
    timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric",
    minute: "numeric", second: "numeric", hourCycle: "h23",
  }), date);
  const requested = Date.UTC(
    targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(),
    local.hour, local.minute, local.second,
  );
  const milliseconds = date.getUTCMilliseconds();
  let guess = requested;
  const formatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
    timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric",
    minute: "numeric", second: "numeric", hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    const shown = partsFor(formatter, new Date(guess));
    const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
    const adjustment = requested - shownAsUtc;
    guess += adjustment;
    if (adjustment === 0) return new Date(guess + milliseconds);
  }
  throw new RangeError("Could not preserve the local wall-clock time in the requested timezone.");
}

/** Adds calendar months in the Jalali calendar, preserving Tehran wall time. */
export function addJalaliMonths(date: Date, months: number, timeZone = TEHRAN): Date {
  if (!Number.isFinite(date.getTime())) throw new RangeError("A valid start instant is required.");
  if (!Number.isInteger(months) || months < 1 || months > 120) throw new RangeError("Month duration must be an integer from 1 to 120.");
  if (timeZone !== TEHRAN) throw new RangeError("Subscription periods use Asia/Tehran.");

  const start = jalaliParts(date);
  const absoluteMonth = start.month - 1 + months;
  const targetYear = start.year + Math.floor(absoluteMonth / 12);
  const targetMonth = absoluteMonth % 12 + 1;
  const targetStart = monthStartUtcDate(targetYear, targetMonth);
  const nextAbsoluteMonth = targetMonth === 12 ? { year: targetYear + 1, month: 1 } : { year: targetYear, month: targetMonth + 1 };
  const nextStart = monthStartUtcDate(nextAbsoluteMonth.year, nextAbsoluteMonth.month);
  const lastDay = Math.round((nextStart.getTime() - targetStart.getTime()) / DAY_MS);
  const targetDay = Math.min(start.day, lastDay);
  const targetDate = new Date(targetStart.getTime() + (targetDay - 1) * DAY_MS);
  return targetLocalInstant(date, targetDate, timeZone);
}

export function getTehranJalaliDate(date: Date): CalendarParts {
  if (!Number.isFinite(date.getTime())) throw new RangeError("A valid date is required.");
  return jalaliParts(date);
}

export function getTehranWallClock(date: Date): WallClockParts {
  if (!Number.isFinite(date.getTime())) throw new RangeError("A valid date is required.");
  const { year, month, day, hour, minute, second } = partsFor(wallClockFormatter, date);
  return { year, month, day, hour, minute, second };
}

export function isSubscriptionPeriodActive(startsAt: Date, endsAt: Date, now: Date): boolean {
  return Number.isFinite(startsAt.getTime()) && Number.isFinite(endsAt.getTime()) && Number.isFinite(now.getTime())
    && startsAt.getTime() <= now.getTime() && now.getTime() < endsAt.getTime();
}
