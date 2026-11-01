export const UNIT_GROUPS = [
  { key: "count", labelFa: "تعداد و بسته‌بندی" },
  { key: "weight", labelFa: "وزن" },
  { key: "length", labelFa: "طول" },
  { key: "area", labelFa: "مساحت" },
  { key: "volume", labelFa: "حجم" },
  { key: "time", labelFa: "زمان" },
  { key: "service", labelFa: "خدمات" },
] as const;

export type UnitGroupKey = typeof UNIT_GROUPS[number]["key"];

export const UNIT_CATALOG: ReadonlyArray<{
  code: string;
  labelFa: string;
  precision: number;
  groupKey: UnitGroupKey;
  defaultVisible: boolean;
}> = [
  { code: "pcs", labelFa: "عدد", precision: 0, groupKey: "count", defaultVisible: true },
  { code: "pair", labelFa: "جفت", precision: 0, groupKey: "count", defaultVisible: false },
  { code: "set", labelFa: "ست", precision: 0, groupKey: "count", defaultVisible: false },
  { code: "pack", labelFa: "بسته", precision: 0, groupKey: "count", defaultVisible: false },
  { code: "box", labelFa: "جعبه", precision: 0, groupKey: "count", defaultVisible: false },
  { code: "carton", labelFa: "کارتن", precision: 0, groupKey: "count", defaultVisible: false },
  { code: "bag", labelFa: "کیسه", precision: 0, groupKey: "count", defaultVisible: false },
  { code: "bottle", labelFa: "بطری", precision: 0, groupKey: "count", defaultVisible: false },
  { code: "sheet", labelFa: "ورق", precision: 0, groupKey: "count", defaultVisible: false },
  { code: "rod", labelFa: "شاخه", precision: 0, groupKey: "count", defaultVisible: false },
  { code: "roll", labelFa: "رول", precision: 0, groupKey: "count", defaultVisible: false },
  { code: "bundle", labelFa: "بندیل", precision: 0, groupKey: "count", defaultVisible: false },
  { code: "dozen", labelFa: "دوجین", precision: 0, groupKey: "count", defaultVisible: false },
  { code: "person", labelFa: "نفر", precision: 0, groupKey: "count", defaultVisible: false },
  { code: "mg", labelFa: "میلی‌گرم", precision: 3, groupKey: "weight", defaultVisible: false },
  { code: "g", labelFa: "گرم", precision: 3, groupKey: "weight", defaultVisible: false },
  { code: "kg", labelFa: "کیلوگرم", precision: 3, groupKey: "weight", defaultVisible: false },
  { code: "ton", labelFa: "تن", precision: 3, groupKey: "weight", defaultVisible: false },
  { code: "mm", labelFa: "میلی‌متر", precision: 3, groupKey: "length", defaultVisible: false },
  { code: "cm", labelFa: "سانتی‌متر", precision: 3, groupKey: "length", defaultVisible: false },
  { code: "inch", labelFa: "اینچ", precision: 3, groupKey: "length", defaultVisible: false },
  { code: "m", labelFa: "متر", precision: 3, groupKey: "length", defaultVisible: false },
  { code: "km", labelFa: "کیلومتر", precision: 3, groupKey: "length", defaultVisible: false },
  { code: "cm2", labelFa: "سانتی‌متر مربع", precision: 3, groupKey: "area", defaultVisible: false },
  { code: "m2", labelFa: "متر مربع", precision: 3, groupKey: "area", defaultVisible: false },
  { code: "ha", labelFa: "هکتار", precision: 3, groupKey: "area", defaultVisible: false },
  { code: "ml", labelFa: "میلی‌لیتر", precision: 3, groupKey: "volume", defaultVisible: false },
  { code: "l", labelFa: "لیتر", precision: 3, groupKey: "volume", defaultVisible: false },
  { code: "gallon", labelFa: "گالن", precision: 3, groupKey: "volume", defaultVisible: false },
  { code: "m3", labelFa: "متر مکعب", precision: 3, groupKey: "volume", defaultVisible: false },
  { code: "minute", labelFa: "دقیقه", precision: 3, groupKey: "time", defaultVisible: false },
  { code: "hour", labelFa: "ساعت", precision: 3, groupKey: "time", defaultVisible: false },
  { code: "day", labelFa: "روز", precision: 0, groupKey: "time", defaultVisible: false },
  { code: "month", labelFa: "ماه", precision: 0, groupKey: "time", defaultVisible: false },
  { code: "service", labelFa: "خدمت", precision: 0, groupKey: "service", defaultVisible: false },
  { code: "session", labelFa: "جلسه", precision: 0, groupKey: "service", defaultVisible: false },
  { code: "visit", labelFa: "نوبت", precision: 0, groupKey: "service", defaultVisible: false },
];

export const unitGroupLabel = (key: string) => UNIT_GROUPS.find((group) => group.key === key)?.labelFa ?? "سایر واحدها";
