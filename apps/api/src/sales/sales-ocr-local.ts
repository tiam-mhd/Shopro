import { normalizePersianSearch, toAsciiDigits } from "@shopro/contracts";

export type SalesOcrCurrency = "IRR" | "IRT" | string;
export type SalesOcrLine = {
  name: string | null;
  sku: string | null;
  barcode: string | null;
  kind: "STOCK" | "SERVICE" | null;
  quantity: string | null;
  unit: string | null;
  unitPriceRial: string | null;
  discountRial: string | null;
  taxRateBasisPoints: number | null;
  lineTotalRial: string | null;
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
  totals: { subtotalRial: string | null; discountRial: string | null; taxRial: string | null; totalRial: string | null };
  items: SalesOcrLine[];
  warnings: string[];
};
export type RecognizedOcrLine = { text: string; confidence: number };

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
  let index = -1;
  let name: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const text = clean(lines[i].text);
    if (lines[i].confidence < 30) continue;
    if (/فروشنده|seller/i.test(folded(text))) continue;
    const match = label.exec(text);
    if (!match) continue;
    index = i;
    const tail = text.slice((match.index ?? 0) + match[0].length).split(stop)[0];
    name = nonEmpty(tail.replace(/^[\s:：،\-–—]+/, ""), 160);
    if (name && !/\d/.test(name) && !/^(?:اول|اولین|دوم|سوم|second|third|name|نام|خریدار|مشتری|نامشخص|ناشناس)$/iu.test(name)) break;
    name = null;
  }
  const contextLines = index < 0 ? [] : [lines[index]].filter((line) => !/فروشنده|seller/i.test(folded(line.text)));
  const contextText = contextLines.map((line) => line.text).join(" ");
  const phoneCandidate = contextText.match(/(?:موبایل|همراه|تلفن|phone|mobile)\s*[:：\-]?\s*((?:\+?98|0098|0)?\s*9(?:[\s-]*\d){9})/iu)?.[1] ?? null;
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
  return /شرح|نام\s*کالا|ردیف|تعداد|qty|description|item/.test(value)
    && /مبلغ|قیمت|فی|واحد|amount|price|total/.test(value);
}

function isTotalOrFooter(text: string) {
  return /جمع|مجموع|تخفیف|مالیات|ارزش\s*افزوده|مبلغ\s*(?:کل|نهایی|قابل)|قابل\s*پرداخت|پرداخت\s*شده|دریافتی|مانده|total|subtotal|discount|tax|cash|change|rounding|page|صفحه|امضا|توضیحات|کد\s*پستی|شناسه\s*ملی|شماره\s*(?:فاکتور|سند|رسید|اقتصادی)|تلفن|موبایل|نشانی|آدرس|فروشنده|خریدار|مشتری|تاریخ|date|invoice|receipt|فکس|ایمیل|وب\s*سایت/.test(folded(text));
}

function itemNameFromLine(text: string) {
  return nonEmpty(clean(text)
    .replace(/\d[\d٬,٫./-]*\d|\d/g, " ")
    .replace(/\b(?:RM|MYR|USD|EUR|GBP|CAD|AUD|IDR|PHP|SGD)\b/giu, " ")
      .replace(/(?:شرح|ردیف|تعداد|قیمت|مبلغ|واحد|qty|amount|price|item|description)/giu, " ")
    .replace(/[|:：#=+*<>()[\]{}%٪]/g, " "), 160);
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

function extractItems(lines: RecognizedOcrLine[], currency: SalesOcrCurrency): SalesOcrLine[] {
  const headerIndex = lines.findIndex((line) => isTableHeader(line.text));
  const invoiceStart = currency === "UNSUPPORTED" ? lines.findIndex((line) => /(?:tax\s*invoice|sales\s*invoice|فاکتور\s*فروش)/iu.test(line.text)) : -1;
  const start = headerIndex >= 0 ? headerIndex : invoiceStart >= 0 ? invoiceStart + 1 : 0;
  const hasQuantityColumn = headerIndex >= 0 && /qty|تعداد/iu.test(lines[headerIndex].text);
  const items: SalesOcrLine[] = [];
  let tableSeen = headerIndex >= 0 || invoiceStart >= 0;
  const usedDescriptionLines = new Set<number>();
  for (let index = start; index < lines.length && items.length < 100; index++) {
    const line = lines[index];
    const text = clean(line.text);
    if (isTableHeader(text)) { tableSeen = true; continue; }
    if (tableSeen && isTotalOrFooter(text)) break;
    if (!tableSeen && isTotalOrFooter(text)) continue;
    if (line.confidence < 40) continue;
    const numbers = tokensOf(text).filter((token) => !DATE_TOKEN.test(token.value) && amountInteger(token.value) !== null);
    if (numbers.length < 3) continue;
    let name = itemNameFromLine(text);
    let descriptionIndex = -1;
    if (!name || name.replace(/\s/g, "").length < 2 || !/[\p{L}]/u.test(name)) {
      if (currency !== "UNSUPPORTED") continue;
      const rowStartsWithCode = /^\s*\d{4,}\b/.test(text);
      const description = findPartialItemName(lines, index, usedDescriptionLines, rowStartsWithCode);
      if (!description) continue;
      name = description.name;
      descriptionIndex = description.index;
    }
    let verifiedRow: { quantity: string; unitPrice: string; lineTotal: string } | null = null;
    for (let numberIndex = numbers.length - 3; numberIndex >= 0; numberIndex--) {
      const rowNumbers = numbers.slice(numberIndex, numberIndex + 3);
      if (rowNumbers.length !== 3) continue;
      const quantity = quantityValue(rowNumbers[0].value);
      const unitPrice = rialAmount(rowNumbers[1].value, text, currency);
      const lineTotal = rialAmount(rowNumbers[2].value, text, currency);
      if (mathConsistent(quantity, unitPrice, lineTotal)) {
        verifiedRow = { quantity: quantity!, unitPrice: unitPrice!, lineTotal: lineTotal! };
        break;
      }
    }
    const code = text.match(/(?:کد\s*کالا|sku)\s*[:：#-]?\s*([A-Za-z0-9-]{2,48})/iu)?.[1] ?? null;
    const barcode = text.match(/(?:بارکد|barcode)\s*[:：#-]?\s*(\d{8,14})/iu)?.[1] ?? null;
    if (!verifiedRow) {
      if (currency === "UNSUPPORTED" && tableSeen && numbers.length >= 2 && line.confidence >= 60 && name.replace(/\s/g, "").length >= 4) {
        const quantity = hasQuantityColumn && /^\s*\d{4,}\b/.test(text) ? quantityValue(numbers[1]?.value) : null;
        items.push({
          name, sku: code, barcode: barcode ? toAsciiDigits(barcode) : null, kind: itemKind(text), quantity,
          unit: itemUnit(text), unitPriceRial: null, discountRial: null, taxRateBasisPoints: taxRate(text),
          lineTotalRial: null, confidence: Number(Math.min(0.75, Math.min(line.confidence, lines[descriptionIndex]?.confidence ?? line.confidence) / 100 * 0.75).toFixed(2)),
        });
        if (descriptionIndex >= 0) usedDescriptionLines.add(descriptionIndex);
      }
      continue;
    }
    const confidence = Math.max(0, Math.min(1, line.confidence / 100 * 0.78 + 0.12 + (name.length >= 4 ? 0.08 : 0)));
    items.push({
      name, sku: code, barcode: barcode ? toAsciiDigits(barcode) : null, kind: itemKind(text), quantity: verifiedRow.quantity,
      unit: itemUnit(text), unitPriceRial: verifiedRow.unitPrice, discountRial: null, taxRateBasisPoints: taxRate(text),
      lineTotalRial: verifiedRow.lineTotal, confidence: Number(confidence.toFixed(2)),
    });
  }
  return items;
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
  const lines = linesInput.slice(0, 500).map((line) => ({ text: clean(line.text).slice(0, 1000), confidence: Number.isFinite(line.confidence) ? Math.max(0, Math.min(100, line.confidence)) : 0 })).filter((line) => line.text);
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
  const effectiveCurrency = unsupportedCurrency ? "UNSUPPORTED" : globalToman && !globalRial ? "IRT" : displayCurrency;
  const totalRial = findAmount(lines, [
    /(?:مبلغ\s*نهایی|قابل\s*پرداخت|جمع\s*(?:کل|فاکتور)|مبلغ\s*قابل\s*پرداخت|total\s*sales|grand\s*total|amount\s*due|net\s*amount|total\s*:)/iu,
  ], effectiveCurrency, [/جمع\s*اقلام/]);
  const subtotalRial = findAmount(lines, [/(?:جمع\s*اقلام|جمع\s*جزء|جمع\s*قبل\s*از|subtotal|sub\s*total)/iu], effectiveCurrency);
  const discountRial = findAmount(lines, [/(?:تخفیف|discount)/iu], effectiveCurrency);
  const taxRial = findAmount(lines, [/(?:مالیات|ارزش\s*افزوده|tax\s*amount|vat\s*amount)/iu], effectiveCurrency);
  const paidAmountRial = findAmount(lines, [/(?:مبلغ\s*پرداخت\s*شده|مبلغ\s*پرداختی|مبلغ\s*دریافتی|پرداخت\s*(?:نقدی|کارت|بانکی)|دریافتی|cash\s*:|paid\s*:|amount\s*paid)/iu], effectiveCurrency, [/مانده|change|تغییر|قابل\s*پرداخت/]);
  const paymentLines = lines.filter((line) => /پرداخت|دریافت|تسویه|واریز|cash\s*sales|payment/i.test(folded(line.text)));
  const paymentText = paymentLines.map((line) => folded(line.text)).join(" ");
  const paymentMethod = /نقدی|cash/.test(paymentText) ? "CASH" : /کارتخوان|pos/.test(paymentText) ? "POS" : /انتقال\s*وجه|واریز\s*بانکی|bank\s*transfer/.test(paymentText) ? "BANK" : /پرداخت/.test(paymentText) ? "OTHER" : null;
  const items = extractItems(lines, effectiveCurrency);
  const customer = extractCustomer(lines);
  const warnings: string[] = [];
  const averageConfidence = lines.length ? lines.reduce((sum, line) => sum + line.confidence, 0) / lines.length : 0;
  if (!fullText) warnings.push("متنی از تصویر خوانده نشد؛ تصویر واضح‌تر یا نسخهٔ دستی را وارد کنید.");
  else if (averageConfidence < 40) warnings.push("کیفیت تشخیص متن پایین است؛ پیش از ثبت، همهٔ اعداد و نام‌ها را با تصویر تطبیق دهید.");
  else if (averageConfidence < 70) warnings.push("کیفیت تشخیص متوسط است؛ پیش از ثبت، همهٔ اطلاعات استخراج‌شده را با تصویر تطبیق دهید.");
  if (!items.length) warnings.push("ردیف کالایی قابل‌اعتماد پیدا نشد؛ اقلام را در فرم فروش کامل کنید.");
  if (globalToman && (totalRial || subtotalRial || discountRial || taxRial || paidAmountRial)) warnings.push("مبالغ با فرض واحد تومان به ریال تبدیل شده‌اند؛ واحد پول را بررسی کنید.");
  if (unsupportedCurrency) warnings.push("واحد پول این تصویر قابل تأیید نیست؛ مقادیر مالی بدون برچسب صریح ریال یا تومان منتقل نشدند.");
  if (!totalRial && !items.length && !customer && !invoiceDate(lines) && !paidAmountRial) warnings.push("اطلاعات فروش قابل‌استفاده‌ای پیدا نشد؛ تصویر واضح‌تر انتخاب کنید یا فروش را دستی ثبت کنید.");
  const extraction: SalesOcrExtraction = {
    customer,
    invoiceDate: invoiceDate(lines),
    invoiceNumber: invoiceNumber(lines),
    note: labelledValue(lines, /(?:توضیحات|یادداشت|شرح\s*کلی|note|remarks)\s*[:：]?\s*/iu, 1000),
    paidAmountRial,
    paymentMethod,
    paymentAccountName: labelledValue(lines, /(?:حساب\s*(?:مقصد|دریافت|بانکی)|پرداخت\s*به)\s*[:：]?\s*/iu, 120),
    totals: { subtotalRial, discountRial, taxRial, totalRial },
    items,
    warnings: [...new Set(warnings)].slice(0, 12),
  };
  return { extraction, documentText: fullText, confidence: Math.round(averageConfidence), recognizedLineCount: lines.length };
}
