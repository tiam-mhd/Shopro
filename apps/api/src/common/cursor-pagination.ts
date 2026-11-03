import { BadRequestException } from "@nestjs/common";

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function pageLimit(value: string | undefined, fallback = 50, maximum = 100) {
  if (value === undefined) return fallback;
  if (!/^\d{1,4}$/.test(value)) throw new BadRequestException("اندازهٔ صفحه معتبر نیست.");
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new BadRequestException("اندازهٔ صفحه باید بین ۱ تا ۱۰۰ باشد.");
  return Math.min(parsed, maximum);
}

export function cursorPage<T>(rows: T[], limit: number, cursorOf: (row: T) => string): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore && items.length ? cursorOf(items[items.length - 1]) : null, hasMore };
}
