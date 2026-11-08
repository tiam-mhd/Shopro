import { normalizePersianSearch, toAsciiDigits } from "@shopro/contracts";

export type SalesOcrCurrency = "IRR" | "IRT" | string;
export type SalesOcrSourceAmount = { value: string; currency: string };
export type SalesOcrLine = {
  name: string | null;
  sku: string | null;
  barcode: string | null;
  kind: "STOCK" | "SERVICE" | null;
  quantity: string | null;
  unit: string | null;
  unitPriceRial: string | null;
  sourceUnitPrice: SalesOcrSourceAmount | null;
  discountRial: string | null;
  sourceDiscount: SalesOcrSourceAmount | null;
  taxRateBasisPoints: number | null;
  lineTotalRial: string | null;
  sourceLineTotal: SalesOcrSourceAmount | null;
  confidence: number;
};
export type SalesOcrExtraction = {
  customer: { name: string | null; phone: string | null; email: string | null; nationalId: string | null; address: string | null } | null;
  invoiceDate: string | null;
  invoiceNumber: string | null;
  note: string | null;
  paidAmountRial: string | null;
  paymentMethod: "CASH" | "POS" | "BANK" | "OTHER" | null;
  paymentAccountName: string | null;
  sourceCurrency: string | null;
  paidAmountSource: SalesOcrSourceAmount | null;
  totals: {
    subtotalRial: string | null;
    sourceSubtotal: SalesOcrSourceAmount | null;
    discountRial: string | null;
    sourceDiscount: SalesOcrSourceAmount | null;
    taxRial: string | null;
    sourceTax: SalesOcrSourceAmount | null;
    totalRial: string | null;
    sourceTotal: SalesOcrSourceAmount | null;
  };
  items: SalesOcrLine[];
  warnings: string[];
};
export type RecognizedOcrWord = { text: string; confidence: number; x0: number; y0: number; x1: number; y1: number };
export type RecognizedOcrLine = {
  text: string;
  confidence: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
  words?: RecognizedOcrWord[];
};

const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const NUMBER_TOKEN = /\d[\d٬,٫./-]*\d|\d/g;
const DATE_TOKEN = /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/;
const JALALI_FORMATTER = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
  timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric",
});

function clean(value: string) {
  return toAsciiDigits(value).replace(BIDI, " ").replace(/[\u00a0\t]+/g, " ").replace(/\s+/g, " ").trim();
}

function folded(value: string) {
  return normalizePersianSearch(clean(value)).replace(/[آأإٱ]/g, "ا").replace(/[يى]/g, "ی");
}

function nonEmpty(value: string, max: number) {
  const result = clean(value).replace(/^[\s:：#،؛|\-–—]+|[\s،؛|\-–—]+$/g, "").trim();
  return result && /[\p{L}\d]/u.test(result) ? result.slice(0, max) : null;
}

function tokensOf(text: string) {
  return Array.from(clean(text).matchAll(NUMBER_TOKEN), (match) => ({
    value: match[0],
    index: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function amountInteger(value: string): bigint | null {
  let normalized = clean(value).replace(/[\s٬,]/g, "");
  if (!normalized || !/^[\d./٫-]+$/.test(normalized) || normalized.startsWith("-")) return null;
  if (normalized.includes("/")) {
    const parts = normalized.split("/");
    if (parts.length > 1 && parts.slice(1).every((part) => part.length === 3)) normalized = parts.join("");
    else normalized = normalized.replace(/\//g, ".");
  }
  normalized = normalized.replace(/٫/g, ".");
  const dot = normalized.lastIndexOf(".");
  let whole = normalized;
  let fraction = "";
  if (dot >= 0) {
    const tail = normalized.slice(dot + 1);
    if (tail.length <= 2) {
      whole = normalized.slice(0, dot);
      fraction = tail;
    } else {
      whole = normalized.replace(/\./g, "");
    }
  }
  if (!/^\d{1,20}$/.test(whole) || (fraction && !/^\d{1,2}$/.test(fraction))) return null;
  let result = BigInt(whole);
  if (fraction && Number(fraction.padEnd(2, "0")[0]) >= 5) result += 1n;
  return result;
}

function rialAmount(value: string, context: string, currency: SalesOcrCurrency): string | null {
  const amount = amountInteger(value);
  if (amount === null) return null;
  const normalizedContext = folded(context);
  const hasToman = /تومان|تومن|toman/.test(normalizedContext);
  const hasRial = /ریال|rial/.test(normalizedContext);
  const hasDecimalFraction = /[.٫]\d{1,2}$/.test(clean(value).replace(/,/g, ""));
  if (hasDecimalFraction && !hasToman && !hasRial) return null;
  if (currency === "UNSUPPORTED" && !hasToman && !hasRial) return null;
  const toman = hasToman
    ? true
    : hasRial
      ? false
      : currency === "IRT";
  const rial = toman ? amount * 10n : amount;
  return rial.toString().length <= 20 ? rial.toString() : null;
}

function sourceCurrencyOf(context: string, fallback: SalesOcrCurrency) {
  const value = folded(context);
  if (/تومان|تومن|toman/.test(value)) return "IRT";
  if (/ریال|rial/.test(value)) return "IRR";
  const codes = ["USD", "EUR", "GBP", "CAD", "AUD", "MYR", "RM", "IDR", "PHP", "SGD"];
  const code = codes.find((entry) => new RegExp(`\\b${entry}\\b`, "i").test(value));
  if (code) return code === "RM" ? "MYR" : code;
  if (/C\$|CA\$/i.test(context)) return "CAD";
  if (/A\$/i.test(context)) return "AUD";
  if (/[$]/.test(context)) return "USD";
  if (/[€]/.test(context)) return "EUR";
  if (/[£]/.test(context)) return "GBP";
  return fallback === "UNSUPPORTED" ? "UNKNOWN" : fallback;
}

function sourceAmount(value: string, context: string, currency: SalesOcrCurrency): SalesOcrSourceAmount | null {
  let normalized = clean(value).replace(/[\s,٬]/g, "").replace(/٫/g, ".");
  if (normalized.includes("/")) {
    const parts = normalized.split("/");
    normalized = parts.length > 1 && parts.slice(1).every((part) => part.length === 3)
      ? parts.join("")
      : normalized.replace(/\//g, ".");
  }
  if (!/^\d{1,20}(?:\.\d{1,6})?$/.test(normalized)) return null;
  return { value: normalized, currency: sourceCurrencyOf(context, currency) };
}

function sourceAmountFromRial(value: string | null, context: string, currency: SalesOcrCurrency): SalesOcrSourceAmount | null {
  if (!value) return null;
  const unit = sourceCurrencyOf(context, currency);
  if (unit === "IRT") {
    const rial = BigInt(value);
    if (rial % 10n !== 0n) return null;
    return { value: (rial / 10n).toString(), currency: unit };
  }
  return unit === "IRR" ? { value, currency: unit } : null;
}

function sourceAmountAfter(text: string, labelEnd: number, context: string, currency: SalesOcrCurrency) {
  const rest = clean(text.slice(labelEnd));
  const token = tokensOf(rest).find((candidate) => !DATE_TOKEN.test(candidate.value) && amountInteger(candidate.value) !== null);
  return token ? sourceAmount(token.value, context, currency) : null;
}

function moneyTokenAfter(text: string, labelEnd: number, context: string, currency: SalesOcrCurrency) {
  const rest = clean(text.slice(labelEnd));
  const tokens = tokensOf(rest).filter((token) => {
    if (DATE_TOKEN.test(token.value)) return false;
    const after = rest.slice(token.end);
    if (/^\s*[٪%]/.test(after)) return false;
    return amountInteger(token.value) !== null;
  });
  const selected = tokens[0];
  return selected ? rialAmount(selected.value, context, currency) : null;
}

function findAmount(lines: RecognizedOcrLine[], labels: RegExp[], currency: SalesOcrCurrency, exclude: RegExp[] = []) {
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].confidence < 28) continue;
    const line = clean(lines[index].text);
    const norm = folded(line);
    if (exclude.some((pattern) => pattern.test(norm))) continue;
    for (const pattern of labels) {
      pattern.lastIndex = 0;
      const match = pattern.exec(line);
      if (!match) continue;
      const value = moneyTokenAfter(line, (match.index ?? 0) + match[0].length, line, currency);
      if (value) return value;
      const next = lines[index + 1] ? clean(lines[index + 1].text) : "";
      if (next && lines[index + 1].confidence >= 28 && /^[\s\d٬,٫./ریالتومان]+$/u.test(next)) {
        const nextTokens = tokensOf(next).filter((token) => amountInteger(token.value) !== null);
        const first = nextTokens[0];
        if (first) return rialAmount(first.value, `${line} ${next}`, currency);
      }
    }
  }
  return null;
}

function findSourceAmount(lines: RecognizedOcrLine[], labels: RegExp[], currency: SalesOcrCurrency, exclude: RegExp[] = []) {
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].confidence < 28) continue;
    const line = clean(lines[index].text);
    const norm = folded(line);
    if (exclude.some((pattern) => pattern.test(norm))) continue;
    for (const pattern of labels) {
      pattern.lastIndex = 0;
      const match = pattern.exec(line);
      if (!match) continue;
      const value = sourceAmountAfter(line, (match.index ?? 0) + match[0].length, line, currency);
      if (value) return value;
      const next = lines[index + 1] ? clean(lines[index + 1].text) : "";
      const first = tokensOf(next).find((token) => amountInteger(token.value) !== null);
      if (next && lines[index + 1].confidence >= 28 && first) {
        const source = sourceAmount(first.value, `${line} ${next}`, currency);
        if (source) return source;
      }
    }
  }
  return null;
}

function persianWordsAmount(value: string) {
  const words = folded(value)
    .replace(/(?:ریال|ریالی|تومان|تومن|به\s*حروف|فقط)/g, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word && word !== "و");
  if (!words.length || words.length > 40) return null;

  const values = new Map<string, bigint>([
    ["صفر", 0n], ["یک", 1n], ["دو", 2n], ["سه", 3n], ["چهار", 4n], ["پنج", 5n], ["شش", 6n], ["هفت", 7n], ["هشت", 8n], ["نه", 9n],
    ["ده", 10n], ["یازده", 11n], ["دوازده", 12n], ["سیزده", 13n], ["چهارده", 14n], ["پانزده", 15n], ["شانزده", 16n], ["هفده", 17n], ["هجده", 18n], ["نوزده", 19n],
    ["بیست", 20n], ["سی", 30n], ["چهل", 40n], ["پنجاه", 50n], ["شصت", 60n], ["هفتاد", 70n], ["هشتاد", 80n], ["نود", 90n],
    ["صد", 100n], ["یکصد", 100n], ["دویست", 200n], ["سیصد", 300n], ["چهارصد", 400n], ["پانصد", 500n], ["ششصد", 600n], ["هفتصد", 700n], ["هشتصد", 800n], ["نهصد", 900n],
  ]);
  const scales = new Map<string, bigint>([["هزار", 1_000n], ["میلیون", 1_000_000n], ["میلیارد", 1_000_000_000n], ["تریلیون", 1_000_000_000_000n]]);
  let group = 0n;
  let total = 0n;
  for (const word of words) {
    const scale = scales.get(word);
    if (scale) {
      total += (group || 1n) * scale;
      group = 0n;
      continue;
    }
    const amount = values.get(word);
    if (amount === undefined) return null;
    group += amount;
  }
  const result = total + group;
  return result > 0n && result.toString().length <= 20 ? result : null;
}

function findPersianWordsTotal(lines: RecognizedOcrLine[], currency: SalesOcrCurrency) {
  const label = /(?:کل\s*)?مبلغ\s*(?:به\s*)?حروف\s*[:：]?/iu;
  for (const line of lines) {
    if (line.confidence < 28) continue;
    const text = clean(line.text);
    const match = label.exec(text);
    if (!match) continue;
    const tail = text.slice((match.index ?? 0) + match[0].length);
    const words = persianWordsAmount(tail);
    if (words === null) continue;
    const normalizedTail = folded(tail);
    const hasToman = /تومان|تومن/.test(normalizedTail);
    const hasRial = /ریال/.test(normalizedTail);
    if (currency === "UNSUPPORTED" && !hasToman && !hasRial) continue;
    const toman = hasToman || (!hasRial && currency === "IRT");
    const rial = toman ? words * 10n : words;
    if (rial.toString().length <= 20) return rial.toString();
  }
  return null;
}

function persianToGregorian(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const start = new Date(Date.UTC(year + 621, 0, 1, 12));
  for (let offset = 0; offset < 400; offset++) {
    const candidate = new Date(start.getTime() + offset * 86_400_000);
    const parts = Object.fromEntries(JALALI_FORMATTER.formatToParts(candidate).map((part) => [part.type, Number(part.value)]));
    if (parts.year === year && parts.month === month && parts.day === day) return candidate.toISOString().slice(0, 10);
  }
  return null;
}

function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : null;
}

function normalizeDate(value: string) {
  const numbers = toAsciiDigits(value).match(/\d+/g)?.map(Number) ?? [];
  if (numbers.length !== 3) return null;
  let [first, second, third] = numbers;
  if (first >= 1300 && first <= 1500) return persianToGregorian(first, second, third);
  if (third >= 1300 && third <= 1500) return persianToGregorian(third, second, first);
  if (first >= 1900 && first <= 2200) return isoDate(first, second, third);
  if (third >= 1900 && third <= 2200) return isoDate(third, second, first);
  return null;
}

function invoiceDate(lines: RecognizedOcrLine[]) {
  const datePattern = /\d{4}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2}|\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4}/g;
  const ordered = [...lines].sort((a, b) => Number(!/(?:تاریخ|date)/i.test(folded(a.text))) - Number(!/(?:تاریخ|date)/i.test(folded(b.text))));
  for (const line of ordered) {
    if (line.confidence < 25) continue;
    const matches = clean(line.text).match(datePattern) ?? [];
    for (const match of matches) {
      const parsed = normalizeDate(match);
      if (parsed) return parsed;
    }
  }
  return null;
}

function extractCustomer(lines: RecognizedOcrLine[]) {
  const label = /(?:نام\s*(?:مشتری|خریدار)|مشتری|خریدار|customer|buyer)\s*[:：\-]?\s*/iu;
  const stop = /(?:تلفن|موبایل|همراه|نشانی|آدرس|کد\s*ملی|شناسه|ایمیل|email|خرید\s*توسط|فروشنده|seller|تاریخ|شماره\s*فاکتور)\s*[:：]?/iu;
  const englishCustomerLabel = /\b(?:bill\s*to|invoice\s*to|sold\s*to)\b/i;
  const englishStop = /\b(?:date|due|payment|subtotal|total|tax|invoice|receipt)\b/i;
  let index = -1;
  let name: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const text = clean(lines[i].text);
    if (lines[i].confidence < 30) continue;
    if (/فروشنده|seller/i.test(folded(text))) continue;
    const match = label.exec(text) ?? englishCustomerLabel.exec(text);
    if (!match) continue;
    index = i;
    const attention = text.match(/\bATTN\b\s*[:.]?\s*(.+)/i)?.[1];
    const tail = (attention ?? text.slice((match.index ?? 0) + match[0].length)).split(stop)[0].split(englishStop)[0].replace(/\s+\d{1,4}[/. -]\d{1,4}[/. -]\d{2,4}.*$/, "");
    name = nonEmpty(tail.replace(/^[\s:：،\-–—]+/, ""), 160);
    if (name && !/\d/.test(name) && !/^(?:اول|اولین|دوم|سوم|second|third|name|نام|خریدار|مشتری|نامشخص|ناشناس)$/iu.test(name)) break;
    name = null;
  }
  const contextLines = index < 0 ? [] : lines.slice(index, index + 4).filter((line) =>
    !/فروشنده|seller/i.test(folded(line.text)) && !isTableHeader(line.text) && !isInvoiceEnd(line.text),
  );
  const contextText = contextLines.map((line) => line.text).join(" ");
  const phoneCandidate = contextText.match(/(?:شماره\s*تماس|موبایل|همراه|تلفن|phone|mobile)\s*[:：\-]?\s*((?:\+?98|0098|0)?\s*9(?:[\s-]*\d){9})/iu)?.[1] ?? null;
  let phone = phoneCandidate ? toAsciiDigits(phoneCandidate).replace(/\D/g, "") : null;
  if (phone?.startsWith("0098")) phone = `0${phone.slice(4)}`;
  else if (phone?.startsWith("98")) phone = `0${phone.slice(2)}`;
  if (phone && /^9\d{9}$/.test(phone)) phone = `0${phone}`;
  if (phone && !/^09\d{9}$/.test(phone)) phone = null;
  const email = contextText.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0]?.slice(0, 254) ?? null;
  const nationalIdRaw = contextText.match(/(?:کد\s*ملی|شناسه\s*ملی|national\s*id)\s*[:：\-]?\s*(\d{10})/iu)?.[1] ?? null;
  const addressLine = contextLines.find((line) => /(?:آ?درس|نشانی)(?:\s*(?:مشتری|خریدار))?|(?:buyer|customer)\s*address/i.test(folded(line.text)));
  const addressMatch = addressLine?.text.match(/(?:آ?درس|نشانی)(?:\s*(?:مشتری|خریدار))?\s*[:：\-]?\s*(.+)/iu)?.[1] ?? null;
  const address = addressMatch ? nonEmpty(addressMatch.split(stop)[0], 500) : null;
  if (!name && index >= 0) {
    for (const line of contextLines.slice(1, 5)) {
      const candidate = clean(line.text);
      const attention = candidate.match(/\bATTN\b\s*[:.]?\s*(.+)/i)?.[1];
      const explicitName = candidate.match(/(?:نام\s*(?:شخص\s*(?:حقیقی|حقوقی)?|مشتری|خریدار)?|(?:company|customer|buyer)\s*name|name)\s*[:：-]\s*(.+)/iu)?.[1];
      let value = (explicitName ?? attention ?? candidate).split(englishStop)[0];
      value = value.replace(/\s+\d{1,4}[/. -]\d{1,4}[/. -]\d{2,4}.*$/, "").replace(/\s+\d+.*$/, "").trim();
      if (line.confidence < 30 || !value || /seller|فروشنده|customer|buyer|bill\s*to|address|phone|mobile|email|date|total|invoice|receipt/i.test(folded(value))) continue;
      if (!explicitName && !attention && /مبلغ|تخفیف|مالیات|جمع|شماره|شناسه|کد|تاریخ|نشانی|آدرس|تلفن/u.test(value)) continue;
      if (/\d/.test(value) || isTableHeader(value) || isInvoiceEnd(value)) continue;
      const letters = value.match(/[\p{L}]/gu)?.length ?? 0;
      if (letters >= 4) { name = nonEmpty(value, 160); break; }
    }
  }
  if (!name && !phone && !email && !nationalIdRaw && !address) return null;
  return { name, phone, email, nationalId: nationalIdRaw, address };
}

function labelledValue(lines: RecognizedOcrLine[], pattern: RegExp, max: number) {
  for (const line of lines) {
    if (line.confidence < 30) continue;
    const text = clean(line.text);
    const match = pattern.exec(text);
    if (match) {
      const tail = text.slice((match.index ?? 0) + match[0].length).split(/(?:تلفن|موبایل|نشانی|آدرس|تاریخ|شماره\s*فاکتور|مبلغ|جمع|توضیحات)\s*[:：]?/iu)[0];
      const value = nonEmpty(tail, max);
      if (value) return value;
    }
  }
  return null;
}

function itemUnit(text: string) {
  const value = folded(text);
  const units: Array<[RegExp, string]> = [
    [/کیلو(?:گرم)?|\bkg\b/, "کیلوگرم"], [/\b(?:gr|g)\b|گرم/, "گرم"], [/متر|\bm\b/, "متر"],
    [/لیتر|\bliter\b|\blitre\b/, "لیتر"], [/بسته|\bpack\b/, "بسته"], [/جفت/, "جفت"], [/ساعت|\bhour\b/, "ساعت"],
    [/عدد|\bpcs?\b|\bunit\b/, "عدد"],
  ];
  return units.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}

function itemKind(text: string): "STOCK" | "SERVICE" | null {
  const value = folded(text);
  if (/خدمت|خدمات|اجرت|تعمیر|سرویس|service|labor/.test(value)) return "SERVICE";
  if (/کالا|محصول|product|goods/.test(value)) return "STOCK";
  return null;
}

function isTableHeader(text: string) {
  const value = folded(text);
  return /شرح|نام\s*(?:کالا|محصول)|ردیف|تعداد|qty|description|item/.test(value)
    && /مبلغ|قیمت|فی|واحد|amount|price|total|discount|final\s*p?rice|finalpice/.test(value);
}

function isTotalOrFooter(text: string) {
  return /جمع|مجموع|تخفیف|مالیات|ارزش\s*افزوده|مبلغ\s*(?:کل|نهایی|قابل)|قابل\s*پرداخت|پرداخت\s*شده|دریافتی|مانده|total|subtotal|discount|tax|cash|change|rounding|page|صفحه|امضا|توضیحات|کد\s*پستی|شناسه\s*ملی|شماره\s*(?:فاکتور|سند|رسید|اقتصادی)|تلفن|موبایل|نشانی|آدرس|فروشنده|خریدار|مشتری|تاریخ|date|invoice|receipt|فکس|ایمیل|وب\s*سایت/.test(folded(text));
}

function isInvoiceEnd(text: string) {
  return /(?:جمع\s*(?:کل|فاکتور|اقلام)|مجموع\s*(?:کل|فاکتور)|کل\s*مبلغ|مبلغ\s*(?:کل|نهایی|قابل)|قیمت\s*کل|قیمت\s*نهایی|قابل\s*پرداخت|به\s*حروف|grand\s*total|total(?:\s*(?:sales|amount|incl\.?|due))?\s*[:：]|subtotal|amount\s*due|cash\s*[:：]|change\s*[:：]|مانده\s*[:：])/i.test(folded(text));
}

function itemNameFromLine(text: string) {
  return nonEmpty(clean(text)
    .replace(/\d[\d٬,٫./-]*\d|\d/g, " ")
    .replace(/\b(?:RM|MYR|USD|EUR|GBP|CAD|AUD|IDR|PHP|SGD)\b/giu, " ")
      .replace(/(?:شرح|ردیف|تعداد|قیمت|مبلغ|واحد|qty|amount|price|item|description)/giu, " ")
    .replace(/[|:：#=+*<>()[\]{}%٪]/g, " "), 160);
}

function quantityFromDelimitedCell(value: string | undefined) {
  if (!value || /[\p{L}%٪]/u.test(value)) return null;
  const first = tokensOf(value)[0]?.value;
  if (!first || !/^\d{1,6}$/.test(first)) return null;
  const parsed = quantityValue(first);
  return parsed && Number(parsed) > 0 && Number(parsed) <= 100_000 ? parsed : null;
}

function stripCurrencyLabel(value: string) {
  return value.replace(/\b(?:RM|MYR|USD|EUR|GBP|CAD|AUD|IDR|PHP|SGD)\b/giu, "")
    .replace(/ریال|ریالی|تومان/gu, "")
    .replace(/[$€£¥]/g, "").trim();
}

function exactMoneyCell(value: string | undefined, context: string, currency: SalesOcrCurrency) {
  if (!value || /[\p{L}%]/u.test(stripCurrencyLabel(value))) return null;
  const tokens = tokensOf(stripCurrencyLabel(value));
  return tokens.length === 1 ? rialAmount(tokens[0].value, context, currency) : null;
}

function delimitedItem(text: string, currency: SalesOcrCurrency) {
  const cells = clean(text).split(/[|¦│]/).map((cell) => cell.trim()).filter(Boolean);
  if (cells.length < 2) return null;
  const nameIndex = cells.findIndex((cell) => {
    const name = itemNameFromLine(cell);
    const letters = name?.match(/[\p{L}]/gu)?.length ?? 0;
    return letters >= 4 && !isTableHeader(cell) && !isTotalOrFooter(cell);
  });
  if (nameIndex < 0) return null;
  const name = itemNameFromLine(cells[nameIndex]);
  const later = cells.slice(nameIndex + 1);
  if (!later.some((cell) => tokensOf(cell).length > 0)) return null;
  const quantity = quantityFromDelimitedCell(later[0]);
  const noisy = cells.length < 4 || later.some((cell) => /[\p{L}\[\]{}*]/u.test(stripCurrencyLabel(cell)));
  const unitPrice = quantity && !noisy ? exactMoneyCell(later[1], text, currency) : null;
  const sourceUnitPrice = quantity && !noisy && later[1] ? sourceAmount(tokensOf(later[1])[0]?.value ?? "", text, currency) : null;
  const sourceLineTotal = quantity && !noisy && later[2] ? sourceAmount(tokensOf(later[2])[0]?.value ?? "", text, currency) : null;
  return name ? { name, quantity, unitPrice, sourceUnitPrice, sourceLineTotal, noisy } : null;
}

function quantityValue(raw: string | undefined) {
  if (!raw) return null;
  const normalized = clean(raw).replace(/[٬,\s]/g, "").replace(/٫/g, ".");
  return /^\d{1,15}(?:\.\d{1,3})?$/.test(normalized) ? normalized : null;
}

function taxRate(text: string) {
  const match = clean(text).match(/(\d{1,2}(?:[.,٫]\d{1,2})?)\s*[٪%]|[٪%]\s*(\d{1,2}(?:[.,٫]\d{1,2})?)/);
  if (!match) return null;
  const rate = Math.round(Number((match[1] ?? match[2]).replace(/[٫,]/g, ".")) * 100);
  return Number.isInteger(rate) && rate >= 0 && rate <= 10_000 ? rate : null;
}

function mathConsistent(quantity: string | null, unitPrice: string | null, lineTotal: string | null) {
  if (!quantity || !unitPrice || !lineTotal) return false;
  const count = Number(quantity);
  const price = Number(unitPrice);
  const total = Number(lineTotal);
  if (!Number.isFinite(count) || count <= 0 || count > 100_000 || !Number.isFinite(price) || !Number.isFinite(total) || total <= 0) return false;
  const expected = count * price;
  return Number.isFinite(expected) && (Math.abs(expected - total) <= Math.max(2, total * 0.05));
}

function decimalScaled(value: string) {
  const match = /^(\d{1,20})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) return null;
  return BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}

function mathConsistentSource(quantity: string | null, unitPrice: SalesOcrSourceAmount | null, lineTotal: SalesOcrSourceAmount | null) {
  if (!quantity || !unitPrice || !lineTotal || unitPrice.currency !== lineTotal.currency) return false;
  const quantityScaled = decimalScaled(quantity);
  const priceScaled = decimalScaled(unitPrice.value);
  const totalScaled = decimalScaled(lineTotal.value);
  if (quantityScaled === null || priceScaled === null || totalScaled === null || quantityScaled <= 0n || priceScaled <= 0n || totalScaled <= 0n) return false;
  const expected = quantityScaled * priceScaled / 1_000_000n;
  const delta = expected > totalScaled ? expected - totalScaled : totalScaled - expected;
  const tolerance = totalScaled / 20n > 3_000_000n ? totalScaled / 20n : 3_000_000n;
  return delta <= tolerance;
}

function findPartialItemName(lines: RecognizedOcrLine[], rowIndex: number, usedNames: Set<number>, preferFollowing: boolean) {
  const directions = preferFollowing ? [1, -1] : [-1, 1];
  for (const direction of directions) {
    for (let distance = 1; distance <= 3; distance++) {
      const index = rowIndex + direction * distance;
      if (index < 0 || index >= lines.length || usedNames.has(index)) continue;
      const candidate = lines[index];
      const text = clean(candidate.text);
      if (isTableHeader(text) || isTotalOrFooter(text)) continue;
      if (tokensOf(text).length >= 2) continue;
      const name = itemNameFromLine(text);
      const letterCount = name?.match(/[\p{L}]/gu)?.length ?? 0;
      if (candidate.confidence >= 60 && name && letterCount >= 5) return { index, name };
    }
  }
  return null;
}

type SpatialCell = { text: string; x0: number; x1: number; words: RecognizedOcrWord[] };
type SpatialRow = { text: string; y0: number; y1: number; words: RecognizedOcrWord[]; cells: SpatialCell[] };

function spatialRows(lines: RecognizedOcrLine[]): SpatialRow[] {
  const words = lines.flatMap((line) => line.words ?? []).filter((word) => word.text.trim() &&
    [word.x0, word.y0, word.x1, word.y1].every(Number.isFinite) && word.x1 > word.x0 && word.y1 > word.y0 && word.confidence >= 10);
  if (!words.length) return [];
  const heights = words.map((word) => word.y1 - word.y0).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 12;
  const rows: Array<{ words: RecognizedOcrWord[]; center: number; y0: number; y1: number }> = [];
  for (const word of words.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1))) {
    const center = (word.y0 + word.y1) / 2;
    const tolerance = Math.max(4, Math.min(14, medianHeight * 0.65));
    let target = rows.reduce<{ row: (typeof rows)[number] | null; distance: number }>((best, row) => {
      const distance = Math.abs(center - row.center);
      return distance <= tolerance && distance < best.distance ? { row, distance } : best;
    }, { row: null, distance: Number.POSITIVE_INFINITY }).row;
    if (!target) {
      target = { words: [], center, y0: word.y0, y1: word.y1 };
      rows.push(target);
    }
    target.words.push(word);
    target.center = target.words.reduce((sum, item) => sum + (item.y0 + item.y1) / 2, 0) / target.words.length;
    target.y0 = Math.min(target.y0, word.y0);
    target.y1 = Math.max(target.y1, word.y1);
  }
  return rows.sort((a, b) => a.center - b.center).map((row) => {
    const sorted = [...row.words].sort((a, b) => a.x0 - b.x0);
    const gaps = sorted.slice(1).map((word, index) => Math.max(0, word.x0 - sorted[index].x1)).sort((a, b) => a - b);
    const medianGap = gaps[Math.floor(gaps.length / 2)] ?? 0;
    const gapLimit = Math.max(8, medianHeight * 1.4, Math.min(30, medianGap * 2.2));
    const cells: SpatialCell[] = [];
    for (const word of sorted) {
      const current = cells.at(-1);
      if (!current || word.x0 - current.x1 > gapLimit) cells.push({ text: "", x0: word.x0, x1: word.x1, words: [word] });
      else { current.words.push(word); current.x1 = Math.max(current.x1, word.x1); }
    }
    for (const cell of cells) {
      const rtl = /[\u0600-\u06ff]/.test(cell.words.map((word) => word.text).join(""));
      cell.text = cell.words.slice().sort((a, b) => rtl ? b.x0 - a.x0 : a.x0 - b.x0).map((word) => word.text).join(" ").trim();
    }
    const rtl = /[\u0600-\u06ff]/.test(row.words.map((word) => word.text).join(""));
    const readingCells = rtl ? [...cells].sort((a, b) => b.x0 - a.x0) : cells;
    return { text: readingCells.map((cell) => cell.text).join(" | "), y0: row.y0, y1: row.y1, words: row.words, cells };
  });
}

function layoutItemRows(lines: RecognizedOcrLine[], currency: SalesOcrCurrency): SalesOcrLine[] {
  const rows = spatialRows(lines);
  if (rows.length < 2) return [];
  const headerIndex = rows.findIndex((row) => {
    const text = folded(row.text);
    const hints = Number(/description|item|شرح|نام|کالا|محصول/.test(text))
      + Number(/qty|quantity|تعداد/.test(text))
      + Number(/price|rate|قیمت|فی/.test(text))
      + Number(/amount|total|مبلغ|جمع/.test(text));
    return hints >= 3;
  });
  if (headerIndex < 0) return [];
  const header = headerIndex >= 0 ? rows[headerIndex] : null;
  const headerCell = (pattern: RegExp, exclude?: RegExp) => header?.cells.find((cell) => pattern.test(folded(cell.text)) && !exclude?.test(folded(cell.text))) ?? null;
  const descriptionHeader = headerCell(/description|item|شرح|نام|کالا|محصول/);
  const quantityHeader = headerCell(/qty|quantity|تعداد/);
  const priceHeader = headerCell(/price|rate|قیمت|فی/, /total|amount|discount|جمع|مبلغ|تخفیف/);
  const totalHeader = headerCell(/amount|total|مبلغ|جمع/);
  const center = (cell: SpatialCell | null) => cell ? (cell.x0 + cell.x1) / 2 : null;
  const nearest = (cells: SpatialCell[], x: number | null, valid: (cell: SpatialCell) => boolean) => {
    const candidates = cells.filter(valid);
    return x === null ? candidates[0] ?? null : candidates.sort((a, b) => Math.abs(center(a)! - x) - Math.abs(center(b)! - x))[0] ?? null;
  };
  const results: SalesOcrLine[] = [];
  for (const row of rows.slice(headerIndex >= 0 ? headerIndex + 1 : 0)) {
    const rowText = clean(row.text);
    if (!rowText || isTableHeader(rowText)) continue;
    if (/\b(?:grand\s*total|total\s*sales|amount\s*due|subtotal)\b|جمع\s*(?:کل|اقلام)|مبلغ\s*(?:کل|نهایی)/i.test(folded(rowText))) break;
    if (isTotalOrFooter(rowText)) continue;
    const description = nearest(row.cells, center(descriptionHeader), (cell) => {
      const name = itemNameFromLine(cell.text);
      return Boolean(name && (name.match(/[\p{L}]/gu)?.length ?? 0) >= 3 && !isTableHeader(cell.text) && !isTotalOrFooter(cell.text));
    });
    if (!description) continue;
    const descriptionName = itemNameFromLine(description.text);
    const name = descriptionName ? nonEmpty(descriptionName, 160) : null;
    if (!name) continue;
    const quantityCell = nearest(row.cells, center(quantityHeader), (cell) => Boolean(quantityFromDelimitedCell(cell.text)));
    const quantity = quantityFromDelimitedCell(quantityCell?.text);
    const moneyCells = row.cells.map((cell) => ({ cell, amount: sourceAmount(tokensOf(cell.text).find((token) => amountInteger(token.value) !== null)?.value ?? "", rowText, currency) }))
      .filter((entry): entry is { cell: SpatialCell; amount: SalesOcrSourceAmount } => Boolean(entry.amount) && entry.cell !== quantityCell);
    let priceEntry = nearest(row.cells, center(priceHeader), (cell) => moneyCells.some((entry) => entry.cell === cell));
    let totalEntry = nearest(row.cells, center(totalHeader), (cell) => moneyCells.some((entry) => entry.cell === cell && entry.cell !== priceEntry));
    let matchedPrice: SalesOcrSourceAmount | null = moneyCells.find((entry) => entry.cell === priceEntry)?.amount ?? null;
    let matchedTotal: SalesOcrSourceAmount | null = moneyCells.find((entry) => entry.cell === totalEntry)?.amount ?? null;
    if (quantity && moneyCells.length >= 2) {
      let best: { price: SalesOcrSourceAmount; total: SalesOcrSourceAmount; score: number } | null = null;
      for (const price of moneyCells) for (const total of moneyCells) {
        if (price === total) continue;
        const qty = Number(quantity);
        const unit = Number(price.amount.value);
        const line = Number(total.amount.value);
        if (!Number.isFinite(qty) || !Number.isFinite(unit) || !Number.isFinite(line) || unit <= 0 || line <= 0) continue;
        const tolerance = Math.max(0.03, Math.abs(line) * 0.03);
        const delta = Math.abs(qty * unit - line);
        if (delta > tolerance) continue;
        const expectedDirection = priceHeader && totalHeader ? Number(price.cell === priceEntry) + Number(total.cell === totalEntry) : 0;
        const score = 2 - delta / Math.max(tolerance, 1e-6) + expectedDirection * 2;
        if (!best || score > best.score) best = { price: price.amount, total: total.amount, score };
      }
      if (best) { matchedPrice = best.price; matchedTotal = best.total; }
      else { matchedPrice = null; matchedTotal = null; }
    }
    const sourceUnitPrice = matchedPrice;
    const sourceLineTotal = matchedTotal;
    const unitPriceRial = sourceUnitPrice ? rialAmount(sourceUnitPrice.value, `${rowText} ${sourceUnitPrice.currency}`, currency) : null;
    const lineTotalRial = sourceLineTotal ? rialAmount(sourceLineTotal.value, `${rowText} ${sourceLineTotal.currency}`, currency) : null;
    const confidence = row.words.reduce((sum, word) => sum + word.confidence, 0) / Math.max(1, row.words.length);
    results.push({
      name, sku: null, barcode: null, kind: itemKind(name), quantity: quantity ?? null, unit: itemUnit(rowText),
      unitPriceRial, sourceUnitPrice, discountRial: null, sourceDiscount: null, taxRateBasisPoints: taxRate(rowText),
      lineTotalRial, sourceLineTotal,
      confidence: Number(Math.max(0.25, Math.min(0.82, confidence / 100 * 0.82)).toFixed(2)),
    });
  }
  return results;
}

function tableHeaderBlock(lines: RecognizedOcrLine[]) {
  for (let start = 0; start < lines.length; start++) {
    let text = "";
    for (let end = start; end < Math.min(lines.length, start + 4); end++) {
      text += (text ? " " : "") + lines[end].text;
      if (isTableHeader(text)) return { start, end, text };
    }
  }
  return null;
}

function extractItems(lines: RecognizedOcrLine[], currency: SalesOcrCurrency): SalesOcrLine[] {
  const header = tableHeaderBlock(lines);
  const headerIndex = header?.start ?? -1;
  const headerEndIndex = header?.end ?? -1;
  const invoiceStart = currency === "UNSUPPORTED" ? lines.findIndex((line) => /(?:tax\s*invoice|sales\s*invoice|فاکتور\s*فروش)/iu.test(line.text)) : -1;
  const start = headerIndex >= 0 ? headerEndIndex + 1 : invoiceStart >= 0 ? invoiceStart + 1 : 0;
  const hasQuantityColumn = headerIndex >= 0 && /qty|quantity|hours|hrs|count/.test(header?.text ?? "");
  const items: SalesOcrLine[] = [];
  let tableSeen = headerIndex >= 0 || invoiceStart >= 0;
  const usedDescriptionLines = new Set<number>();
  for (let index = start; index < lines.length && items.length < 100; index++) {
    if (usedDescriptionLines.has(index)) continue;
    const line = lines[index];
    const text = clean(line.text);
    if (isTableHeader(text)) { tableSeen = true; continue; }
    if (tableSeen && (isInvoiceEnd(text) || /(?:توضیحات|امضا(?:ی)?|seller|فروشنده|خریدار|buyer)/iu.test(text)) && !isTableHeader(text)) break;
    if (isTotalOrFooter(text)) continue;
    if (line.confidence < 40) continue;
    const numbers = tokensOf(text).filter((token) => !DATE_TOKEN.test(token.value) && amountInteger(token.value) !== null);
    const delimited = tableSeen ? delimitedItem(text, currency) : null;
    let name = delimited?.name ?? itemNameFromLine(text);
    let descriptionIndex = -1;
    if (!name || name.replace(/\s/g, "").length < 2 || !/[\p{L}]/u.test(name)) {
      if (currency !== "UNSUPPORTED") continue;
      const rowStartsWithCode = /^\s*\d{4,}\b/.test(text);
      const description = findPartialItemName(lines, index, usedDescriptionLines, rowStartsWithCode);
      if (!description) continue;
      name = description.name;
      descriptionIndex = description.index;
    }
    if (numbers.length < 3) {
      if (tableSeen && delimited?.name && (delimited.noisy || delimited.quantity) && line.confidence >= 40) {
        items.push({ name, sku: null, barcode: null, kind: itemKind(name), quantity: delimited.quantity, unit: itemUnit(text), unitPriceRial: delimited.unitPrice, sourceUnitPrice: delimited.sourceUnitPrice, discountRial: null, sourceDiscount: null, taxRateBasisPoints: taxRate(text), lineTotalRial: null, sourceLineTotal: delimited.sourceLineTotal, confidence: Number(Math.min(0.75, line.confidence / 100 * 0.75).toFixed(2)) });
      }
      continue;
    }
    let verifiedRow: { quantity: string; unitPrice: string | null; lineTotal: string | null; sourceUnitPrice: SalesOcrSourceAmount | null; sourceLineTotal: SalesOcrSourceAmount | null } | null = null;
    for (let numberIndex = numbers.length - 3; numberIndex >= 0; numberIndex--) {
      const rowNumbers = numbers.slice(numberIndex, numberIndex + 3);
      if (rowNumbers.length !== 3) continue;
      const quantity = quantityValue(rowNumbers[0].value);
      const unitPrice = rialAmount(rowNumbers[1].value, text, currency);
      const lineTotal = rialAmount(rowNumbers[2].value, text, currency);
      const sourceUnitPrice = sourceAmount(rowNumbers[1].value, text, currency);
      const sourceLineTotal = sourceAmount(rowNumbers[2].value, text, currency);
      if (mathConsistent(quantity, unitPrice, lineTotal) || mathConsistentSource(quantity, sourceUnitPrice, sourceLineTotal)) {
        verifiedRow = {
          quantity: quantity!, unitPrice, lineTotal, sourceUnitPrice, sourceLineTotal,
        };
        break;
      }
    }
    const code = text.match(/(?:کد\s*کالا|sku)\s*[:：#-]?\s*([A-Za-z0-9-]{2,48})/iu)?.[1] ?? null;
    const barcode = text.match(/(?:بارکد|barcode)\s*[:：#-]?\s*(\d{8,14})/iu)?.[1] ?? null;
    if (!verifiedRow) {
      if (tableSeen && line.confidence >= 40 && name.replace(/\s/g, "").length >= 4 && (delimited?.noisy || currency === "UNSUPPORTED")) {
        const rowStartsWithCode = /^\s*\d{4,}\b/.test(text);
        const quantityIndex = rowStartsWithCode ? 1 : 0;
        const quantity = hasQuantityColumn && !delimited?.noisy ? quantityValue(numbers[quantityIndex]?.value) : null;
        const rawUnitPrice = numbers[quantityIndex + 1]?.value;
        const rawLineTotal = numbers[quantityIndex + 2]?.value;
        const sourceUnitPrice = delimited?.noisy ? null : delimited?.sourceUnitPrice ?? (rawUnitPrice ? sourceAmount(rawUnitPrice, text, currency) : null);
        const sourceLineTotal = delimited?.noisy ? null : delimited?.sourceLineTotal ?? (rawLineTotal ? sourceAmount(rawLineTotal, text, currency) : null);
        items.push({
          name, sku: code, barcode: barcode ? toAsciiDigits(barcode) : null, kind: itemKind(name), quantity: delimited?.quantity ?? quantity,
          unit: itemUnit(text), unitPriceRial: delimited?.noisy ? null : delimited?.unitPrice ?? (sourceUnitPrice ? rialAmount(sourceUnitPrice.value, text, currency) : null), sourceUnitPrice, discountRial: null, sourceDiscount: null, taxRateBasisPoints: taxRate(text),
          lineTotalRial: sourceLineTotal ? rialAmount(sourceLineTotal.value, text, currency) : null, sourceLineTotal, confidence: Number(Math.min(0.75, Math.min(line.confidence, lines[descriptionIndex]?.confidence ?? line.confidence) / 100 * 0.75).toFixed(2)),
        });
        if (descriptionIndex >= 0) usedDescriptionLines.add(descriptionIndex);
      }
      continue;
    }
    const confidence = Math.max(0, Math.min(1, line.confidence / 100 * 0.78 + 0.12 + (name.length >= 4 ? 0.08 : 0)));
    items.push({
      name, sku: code, barcode: barcode ? toAsciiDigits(barcode) : null, kind: itemKind(text), quantity: verifiedRow.quantity,
      unit: itemUnit(text), unitPriceRial: verifiedRow.unitPrice, sourceUnitPrice: verifiedRow.sourceUnitPrice, discountRial: null, sourceDiscount: null, taxRateBasisPoints: taxRate(text),
      lineTotalRial: verifiedRow.lineTotal, sourceLineTotal: verifiedRow.sourceLineTotal, confidence: Number(confidence.toFixed(2)),
    });
  }
  const spatial = layoutItemRows(lines, currency);
  if (!spatial.length) return items;
  const merged = [...spatial];
  for (const item of items) {
    const key = normalizePersianSearch(item.name ?? "").replace(/\s/g, "");
    const duplicate = merged.find((candidate) => {
      const candidateKey = normalizePersianSearch(candidate.name ?? "").replace(/\s/g, "");
      return key && candidateKey && (key === candidateKey || key.includes(candidateKey) || candidateKey.includes(key))
        && (!item.quantity || !candidate.quantity || item.quantity === candidate.quantity);
    });
    if (!duplicate) merged.push(item);
    else {
      duplicate.quantity ??= item.quantity;
      duplicate.unitPriceRial ??= item.unitPriceRial;
      duplicate.sourceUnitPrice ??= item.sourceUnitPrice;
      duplicate.lineTotalRial ??= item.lineTotalRial;
      duplicate.sourceLineTotal ??= item.sourceLineTotal;
    }
  }
  return merged.slice(0, 100);
}

function invoiceNumber(lines: RecognizedOcrLine[]) {
  const patterns = [
    /(?:شماره\s*(?:فاکتور|رسید|سند)|فاکتور\s*شماره|رسید\s*شماره|invoice\s*(?:no\.?|number)|doc\s*no\.?|receipt\s*(?:no\.?|number))\s*[:：#\-]?\s*([\p{L}\d][\p{L}\d\-/.]{0,39})/iu,
  ];
  for (const line of lines) {
    if (line.confidence < 30) continue;
    for (const pattern of patterns) {
      const match = clean(line.text).match(pattern);
      if (match?.[1]) return match[1].slice(0, 80);
    }
    const text = clean(line.text);
    if (/شماره\s*[:：#]/iu.test(text) && /فاکتور|رسید|invoice|receipt/i.test(folded(text))) {
      const match = text.match(/شماره\s*[:：#\-]?\s*([\p{L}\d][\p{L}\d\-/.]{0,39})/iu);
      if (match?.[1]) return match[1].slice(0, 80);
    }
  }
  return null;
}

export function extractSalesInvoice(linesInput: RecognizedOcrLine[], displayCurrency: SalesOcrCurrency) {
  const lines = linesInput.slice(0, 500).map((line) => ({
    text: clean(line.text).slice(0, 1000),
    confidence: Number.isFinite(line.confidence) ? Math.max(0, Math.min(100, line.confidence)) : 0,
    bbox: line.bbox,
    words: line.words?.slice(0, 200).map((word) => ({ ...word, text: clean(word.text).slice(0, 80) })),
  })).filter((line) => line.text);
  const fullText = lines.map((line) => line.text).join("\n").slice(0, 12_000);
  const globalToman = /تومان|تومن|toman/.test(folded(fullText));
  const globalRial = /ریال|rial/.test(folded(fullText));
  const hasPersianUnit = globalToman || globalRial;
  const englishLetters = (fullText.match(/[A-Za-z]/g) ?? []).length;
  const persianLetters = (fullText.match(/[\u0600-\u06ff]/g) ?? []).length;
  const englishInvoice = /total|subtotal|amount\s*due|gst|cash|invoice|description|qty|price/i.test(fullText);
  const hasEnglishDecimalAmounts = lines.some((line) => /total|subtotal|amount|gst|cash|description|qty|price/i.test(line.text) && /\d[.,]\d{2}\b/.test(clean(line.text)));
  const foreignCurrencyCode = /(?:\b(?:rm|myr|usd|eur|gbp|cad|aud|idr|php|sgd)\b\s*(?:[:\-]?\s*)\d|\d\s*\b(?:rm|myr|usd|eur|gbp|cad|aud|idr|php|sgd)\b|\bcurrency\s*[:=]?\s*(?:rm|myr|usd|eur|gbp|cad|aud|idr|php|sgd)\b)/i.test(fullText);
  const foreignCurrencySymbol = /(?:[$€£¥]\s*\d|\d\s*[$€£¥])/.test(fullText);
  const unsupportedCurrency = foreignCurrencyCode || foreignCurrencySymbol || (!hasPersianUnit && englishInvoice && hasEnglishDecimalAmounts && englishLetters > persianLetters);
  const effectiveCurrency = unsupportedCurrency
    ? "UNSUPPORTED"
    : globalToman && !globalRial
      ? "IRT"
      : globalRial && !globalToman
        ? "IRR"
        : displayCurrency;
  const items = extractItems(lines, effectiveCurrency);
  const detectedTotalRial = findAmount(lines, [
    /(?:مبلغ\s*(?:کل|نهایی)|قیمت\s*(?:کل|نهایی)|کل\s*مبلغ|قابل\s*پرداخت|جمع\s*(?:کل|فاکتور)|مبلغ\s*قابل\s*پرداخت|total\s*sales|grand\s*total|amount\s*due|net\s*amount|total\s*:)/iu,
  ], effectiveCurrency, [/جمع\s*اقلام/]);
  const largestItemTotal = items.reduce((largest, item) => {
    if (!item.lineTotalRial) return largest;
    try { const value = BigInt(item.lineTotalRial); return value > largest ? value : largest; } catch { return largest; }
  }, 0n);
  const detectedTotal = detectedTotalRial ? BigInt(detectedTotalRial) : null;
  const totalRial = detectedTotal && detectedTotal > 0n && (!largestItemTotal || detectedTotal * 10n >= largestItemTotal)
    ? detectedTotal.toString()
    : null;
  const resolvedTotalRial = totalRial ?? findPersianWordsTotal(lines, effectiveCurrency);
  const subtotalRial = findAmount(lines, [/(?:جمع\s*اقلام|جمع\s*جزء|جمع\s*قبل\s*از|subtotal|sub\s*total)/iu], effectiveCurrency);
  const discountRial = findAmount(lines, [/(?:تخفیف|discount)/iu], effectiveCurrency);
  const taxRial = findAmount(lines, [/(?:مالیات|ارزش\s*افزوده|tax\s*amount|vat\s*amount)/iu], effectiveCurrency);
  const paidAmountRial = findAmount(lines, [/(?:مبلغ\s*پرداخت\s*شده|مبلغ\s*پرداختی|مبلغ\s*دریافتی|پرداخت\s*(?:نقدی|کارت|بانکی)|دریافتی|cash\s*:|paid\s*:|amount\s*paid)/iu], effectiveCurrency, [/مانده|change|تغییر|قابل\s*پرداخت/]);
  const paymentLines = lines.filter((line) => /پرداخت|دریافت|تسویه|واریز|cash\s*sales|payment/i.test(folded(line.text)));
  const paymentText = paymentLines.map((line) => folded(line.text)).join(" ");
  const paymentMethod = /نقدی|cash/.test(paymentText) ? "CASH" : /کارتخوان|pos/.test(paymentText) ? "POS" : /انتقال\s*وجه|واریز\s*بانکی|bank\s*transfer/.test(paymentText) ? "BANK" : /پرداخت/.test(paymentText) ? "OTHER" : null;
  const detectedSourceTotal = findSourceAmount(lines, [/(?:grand\s*total|total\s*(?:sales|amount)|amount\s*due|total\s*:)/i], effectiveCurrency, [/subtotal/]);
  const largestSourceItemTotal = items.reduce((largest, item) => {
    if (!item.sourceLineTotal || item.sourceLineTotal.currency !== detectedSourceTotal?.currency) return largest;
    const value = decimalScaled(item.sourceLineTotal.value);
    return value !== null && value > largest ? value : largest;
  }, 0n);
  const detectedSourceTotalValue = detectedSourceTotal ? decimalScaled(detectedSourceTotal.value) : null;
  const plausibleSourceTotal = detectedSourceTotal && detectedSourceTotalValue !== null
    && detectedSourceTotalValue > 0n
    && (!largestSourceItemTotal || detectedSourceTotalValue * 10n >= largestSourceItemTotal);
  const sourceTotal = plausibleSourceTotal
    ? detectedSourceTotal
    : sourceAmountFromRial(resolvedTotalRial, fullText, effectiveCurrency);
  const sourceSubtotal = findSourceAmount(lines, [/(?:sub\s*total|subtotal)/i], effectiveCurrency)
    ?? sourceAmountFromRial(subtotalRial, fullText, effectiveCurrency);
  const sourceDiscount = findSourceAmount(lines, [/discount/i], effectiveCurrency)
    ?? sourceAmountFromRial(discountRial, fullText, effectiveCurrency);
  const sourceTax = findSourceAmount(lines, [/(?:tax\s*amount|vat\s*amount|tax\s*:)/i], effectiveCurrency)
    ?? sourceAmountFromRial(taxRial, fullText, effectiveCurrency);
  const paidAmountSource = findSourceAmount(lines, [/(?:amount\s*paid|paid\s*:|cash\s*:)/i], effectiveCurrency)
    ?? sourceAmountFromRial(paidAmountRial, fullText, effectiveCurrency);
  const customer = extractCustomer(lines);
  const warnings: string[] = [];
  const averageConfidence = lines.length ? lines.reduce((sum, line) => sum + line.confidence, 0) / lines.length : 0;
  if (!fullText) warnings.push("متنی از تصویر خوانده نشد؛ تصویر واضح‌تر یا نسخهٔ دستی را وارد کنید.");
  else if (averageConfidence < 40) warnings.push("کیفیت تشخیص متن پایین است؛ پیش از ثبت، همهٔ اعداد و نام‌ها را با تصویر تطبیق دهید.");
  else if (averageConfidence < 70) warnings.push("کیفیت تشخیص متوسط است؛ پیش از ثبت، همهٔ اطلاعات استخراج‌شده را با تصویر تطبیق دهید.");
  if (!items.length) warnings.push("ردیف کالایی قابل‌اعتماد پیدا نشد؛ اقلام را در فرم فروش کامل کنید.");
  if (items.length && items.some((item) => !item.quantity || !item.sourceUnitPrice || !item.sourceLineTotal)) {
    warnings.push("تعداد یا مبلغ بعضی ردیف‌ها با محاسبهٔ مبلغ واحد و جمع ردیف تأیید نشد؛ این خانه‌ها را از روی تصویر بازبینی کنید.");
  }
  if (items.length && !resolvedTotalRial && !sourceTotal) warnings.push("مبلغ کل فاکتور به‌صورت قابل‌اعتماد تشخیص داده نشد؛ پیش از ثبت آن را از روی تصویر وارد کنید.");
  if (globalToman && (resolvedTotalRial || subtotalRial || discountRial || taxRial || paidAmountRial)) warnings.push("مبالغ با فرض واحد تومان به ریال تبدیل شده‌اند؛ واحد پول را بررسی کنید.");
  if (unsupportedCurrency) warnings.push("واحد پول این تصویر قابل تأیید نیست؛ مقادیر مالی بدون برچسب صریح ریال یا تومان منتقل نشدند.");
  if (!resolvedTotalRial && !items.length && !customer && !invoiceDate(lines) && !paidAmountRial) warnings.push("اطلاعات فروش قابل‌استفاده‌ای پیدا نشد؛ تصویر واضح‌تر انتخاب کنید یا فروش را دستی ثبت کنید.");
  const extraction: SalesOcrExtraction = {
    customer,
    invoiceDate: invoiceDate(lines),
    invoiceNumber: invoiceNumber(lines),
    note: labelledValue(lines, /(?:توضیحات|یادداشت|شرح\s*کلی|note|remarks)\s*[:：]?\s*/iu, 1000),
    paidAmountRial,
    sourceCurrency: sourceCurrencyOf(fullText, effectiveCurrency),
    paidAmountSource,
    paymentMethod,
    paymentAccountName: labelledValue(lines, /(?:حساب\s*(?:مقصد|دریافت|بانکی)|پرداخت\s*به)\s*[:：]?\s*/iu, 120),
    totals: { subtotalRial, sourceSubtotal, discountRial, sourceDiscount, taxRial, sourceTax, totalRial: resolvedTotalRial, sourceTotal },
    items,
    warnings: [...new Set(warnings)].slice(0, 12),
  };
  return { extraction, documentText: fullText, confidence: Math.round(averageConfidence), recognizedLineCount: lines.length };
}
