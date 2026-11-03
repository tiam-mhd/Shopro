export function jalaliParts(date: Date): [number, number, number];
export function parseJalali(year: number, month: number, day: number): Date;
export function toIsoDate(date: Date): string;
export function gregorianDateFromJalali(year: number, monthIndex: number, day: number): string;
export function jalaliDateFromIso(iso?: string | null): string;
