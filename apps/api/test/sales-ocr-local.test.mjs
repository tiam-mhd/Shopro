import test from "node:test";
import assert from "node:assert/strict";
import { extractSalesInvoice } from "../dist/sales/sales-ocr-local.js";

const line = (text, confidence = 92) => ({ text, confidence });

test("extracts Persian invoice fields and keeps row quantity, unit price, and total distinct", () => {
  const result = extractSalesInvoice([
    line("فاکتور فروش شماره: ۲۱۵"),
    line("تاریخ: ۱۳۹۵/۱۰/۱۴"),
    line("نام مشتری: سارا احمدی موبایل: ۰۹۱۲۳۴۵۶۷۸۹ آدرس: تهران"),
    line("شرح کالا | تعداد | قیمت واحد | مبلغ کل"),
    line("پیچ فولادی | ۲ عدد | ۱,۵۰۰,۰۰۰ ریال | ۳,۰۰۰,۰۰۰ ریال"),
    line("جمع اقلام: ۳,۰۰۰,۰۰۰ ریال"),
    line("تخفیف: ۱۰۰,۰۰۰ ریال"),
    line("مالیات بر ارزش افزوده: ۲۹۰,۰۰۰ ریال"),
    line("مبلغ نهایی: ۳,۱۹۰,۰۰۰ ریال"),
    line("پرداخت نقدی: ۳,۱۹۰,۰۰۰ ریال"),
  ], "IRR");

  assert.equal(result.extraction.invoiceNumber, "215");
  assert.equal(result.extraction.invoiceDate, "2017-01-03");
  assert.equal(result.extraction.customer.name, "سارا احمدی");
  assert.equal(result.extraction.customer.phone, "09123456789");
  assert.equal(result.extraction.customer.address, "تهران");
  assert.equal(result.extraction.totals.subtotalRial, "3000000");
  assert.equal(result.extraction.totals.discountRial, "100000");
  assert.equal(result.extraction.totals.taxRial, "290000");
  assert.equal(result.extraction.totals.totalRial, "3190000");
  assert.equal(result.extraction.paidAmountRial, "3190000");
  assert.equal(result.extraction.paymentMethod, "CASH");
  assert.equal(result.extraction.items.length, 1);
  assert.equal(result.extraction.items[0].quantity, "2");
  assert.equal(result.extraction.items[0].unit, "عدد");
  assert.equal(result.extraction.items[0].unitPriceRial, "1500000");
  assert.equal(result.extraction.items[0].lineTotalRial, "3000000");
});

test("converts explicit toman and configured display-currency amounts to Rial", () => {
  const explicit = extractSalesInvoice([line("مبلغ نهایی: ۳۰۰,۰۰۰ تومان")], "IRR");
  const configured = extractSalesInvoice([line("مبلغ نهایی: ۳۰۰,۰۰۰")], "IRT");
  assert.equal(explicit.extraction.totals.totalRial, "3000000");
  assert.equal(configured.extraction.totals.totalRial, "3000000");
});

test("preserves the first amount after a total label and refuses foreign currency", () => {
  const trailingColumns = extractSalesInvoice([line("مبلغ نهایی: ۱۲۳,۰۰۰ ریال ۷ ۹")], "IRT");
  const foreign = extractSalesInvoice([line("Invoice Total: RM 123.45")], "IRT");
  assert.equal(trailingColumns.extraction.totals.totalRial, "123000");
  assert.equal(foreign.extraction.totals.totalRial, null);
  assert.match(foreign.extraction.warnings.join(" "), /واحد پول این تصویر/);
});

test("does not treat English decimal receipts as amounts in the business currency", () => {
  const result = extractSalesInvoice([
    line("SOON HUAT MACHINERY ENTERPRISE"),
    line("Description Qty Price Amount"),
    line("ENGINE OIL 1 17.00 17.00"),
    line("Total Sales: 32700"),
    line("Cash: 327.00"),
  ], "IRT");
  assert.equal(result.extraction.totals.totalRial, null);
  assert.equal(result.extraction.paidAmountRial, null);
  assert.equal(result.extraction.items.length, 1);
  assert.equal(result.extraction.items[0].name, "ENGINE OIL");
  assert.equal(result.extraction.items[0].quantity, null);
  assert.equal(result.extraction.items[0].lineTotalRial, null);
  assert.match(result.extraction.warnings.join(" "), /واحد پول این تصویر/);
});

test("keeps a clear item name from a foreign-currency row while leaving its money and quantity blank", () => {
  const result = extractSalesInvoice([
    line("Description Qty Price Amount"),
    line("Socks 1 RM 9.50 RM 9.50"),
    line("Total: RM 9.50"),
    line("UNRELATED 1 RM 1.00 RM 1.00"),
  ], "IRT");
  assert.equal(result.extraction.items.length, 1);
  assert.equal(result.extraction.items[0].name, "Socks");
  assert.equal(result.extraction.items[0].quantity, null);
  assert.equal(result.extraction.items[0].unitPriceRial, null);
  assert.equal(result.extraction.items[0].lineTotalRial, null);
});

test("pairs split item descriptions with code-led rows without importing foreign amounts", () => {
  const result = extractSalesInvoice([
    line("Mem Qty S/Price Amount Tax"),
    line("1072 1 80.00 80.00 80.00"),
    line("REPAIR ENGINE POWER SPRAYER (1UNIT)"),
    line("70548 1 160.00 160.00 160.00"),
    line("GIANT 606 OVERFLOW ASSY"),
    line("Total Incl. GST RM 240.00"),
  ], "IRT");
  assert.equal(result.extraction.items.length, 2);
  assert.match(result.extraction.items[0].name, /^REPAIR ENGINE POWER SPRAYER/);
  assert.equal(result.extraction.items[0].quantity, "1");
  assert.equal(result.extraction.items[0].unitPriceRial, null);
  assert.equal(result.extraction.items[1].name, "GIANT OVERFLOW ASSY");
  assert.equal(result.extraction.items[1].quantity, "1");
  assert.equal(result.extraction.items[1].lineTotalRial, null);
});

test("does not treat a seller phone number as customer identity", () => {
  const result = extractSalesInvoice([
    line("فاکتور فروش"),
    line("فروشنده: فروشگاه نمونه"),
    line("تلفن: ۰۹۱۲۰۰۰۰۰۰۰"),
    line("مبلغ نهایی: ۱۲۰,۰۰۰ ریال"),
  ], "IRR");
  assert.equal(result.extraction.customer, null);
  assert.equal(result.extraction.totals.totalRial, "120000");
  assert.equal(result.extraction.items.length, 0);
});

test("does not invent invoice totals, dates, or catalog items from unrelated numbers", () => {
  const result = extractSalesInvoice([
    line("شماره اقتصادی: ۱۲۳۴۵۶۷۸۹۰"),
    line("کد پستی: ۱۲۳۴۵۶۷۸۹۰"),
    line("شماره تماس: ۰۹۱۲۳۴۵۶۷۸۹"),
  ], "IRT");
  assert.equal(result.extraction.invoiceDate, null);
  assert.equal(result.extraction.totals.totalRial, null);
  assert.equal(result.extraction.paidAmountRial, null);
  assert.equal(result.extraction.items.length, 0);
  assert.equal(result.extraction.customer, null);
});

test("rejects low-confidence labels and item rows whose quantities and totals do not agree", () => {
  const result = extractSalesInvoice([
    line("نام مشتری: مشتری اول", 18),
    line("شرح کالا | تعداد | قیمت واحد | مبلغ کل"),
    line("کالای برنج | ۲ | ۳۰۰ | ۹۹۹", 88),
  ], "IRR");
  assert.equal(result.extraction.customer, null);
  assert.equal(result.extraction.items.length, 0);
});

test("retains product names containing the word کالا when row math verifies", () => {
  const result = extractSalesInvoice([
    line("شرح کالا | تعداد | قیمت واحد | مبلغ کل"),
    line("کالای برنج | ۲ | ۳۰۰ | ۶۰۰ | %10"),
  ], "IRR");
  assert.equal(result.extraction.items.length, 1);
  assert.equal(result.extraction.items[0].name, "کالای برنج");
  assert.equal(result.extraction.items[0].lineTotalRial, "600");
  assert.equal(result.extraction.items[0].taxRateBasisPoints, 1000);
});

test("extracts delimited Persian invoice rows even when the Discount header and OCR noise interrupt row math", () => {
  const result = extractSalesInvoice([
    line("محل لوگوفاکت"),
    line("کتور فروش"),
    line("[EE"),
    line("FEES"),
    line("[Eee"),
    line("3 (ریال) مبلغ کل(ریال)"),
    line("finalpice | Discount | 0035 | QTY | 060000 | ["),
    line("| اسم‌نموه محصول 1 | 5 | 1399999 | 9 ]9]11198191919"),
    line("سم نموه محصول 2 | 2 ] 1599999 | vex | *]*]*1113]7]511"),
    line("اسم نمونه محصول 3 | 3 | 355799499 ]| vex |*]*]131116]7]519"),
    line("4 سم نموه محصول 4 ]| JF 85999 | اس [LL [afafe]efefe]"),
    line("اسم‌نمونه محصول 5 | 1 ]39399 | — ]16119 LLL"),
    line("شب شا]ما1"),
    line("اب لبلب cere errr"),
    line("شرب لبلب با ]|ا"),
    line("ee لبلب ای eee"),
    line("بر لبلب با]چا"),
    line("RY 0 شت Sg بنجاههزا"),
    line("Ju,"),
    line("11|] توضیحات: له"),
    line("1313]8]9]5]0[]01010[] est |"),
  ], "IRT");

  assert.equal(result.extraction.customer, null);
  assert.equal(result.extraction.items.length, 5);
  assert.deepEqual(result.extraction.items.map((item) => item.quantity), ["5", "2", "3", null, "1"]);
  assert.equal(result.extraction.items[0].name, "اسم‌نموه محصول");
  assert.equal(result.extraction.items[0].unitPriceRial, null);
  assert.equal(result.extraction.items[1].unitPriceRial, null);
  assert.equal(result.extraction.totals.totalRial, null);
});

test("recognizes numeric totals labelled مبلغ کل or قیمت کل", () => {
  assert.equal(extractSalesInvoice([line("مبلغ کل: ۳۳۸,۸۹۵,۰۰۰ ریال")], "IRT").extraction.totals.totalRial, "338895000");
  assert.equal(extractSalesInvoice([line("قیمت کل: ۳۳۸,۸۹۵,۰۰۰ ریال")], "IRT").extraction.totals.totalRial, "338895000");
});

test("reads customer fields on nearby lines and converts a legible Persian amount in words", () => {
  const result = extractSalesInvoice([
    line("خریدار: آقای حمیدی"),
    line("شماره تماس: ۰۹۱۲۳۴۵۶۷۸۹"),
    line("آدرس: تهران"),
    line("کل مبلغ به حروف: سیصد و سی و هشت میلیون و هشتصد و نود و پنج هزار ریال"),
  ], "IRT");
  assert.equal(result.extraction.customer.name, "آقای حمیدی");
  assert.equal(result.extraction.customer.phone, "09123456789");
  assert.equal(result.extraction.customer.address, "تهران");
  assert.equal(result.extraction.totals.totalRial, "338895000");
});

test("leaves ambiguous and invalid dates empty while accepting Gregorian dates", () => {
  assert.equal(extractSalesInvoice([line("تاریخ: 03/04/24")], "IRR").extraction.invoiceDate, null);
  assert.equal(extractSalesInvoice([line("تاریخ: ۱۴۰۰/۱۲/۳۰")], "IRR").extraction.invoiceDate, null);
  assert.equal(extractSalesInvoice([line("Date: 11/01/2019")], "IRR").extraction.invoiceDate, "2019-01-11");
});

test("limits returned OCR text and reports low-confidence or empty recognition", () => {
  const empty = extractSalesInvoice([], "IRR");
  const long = extractSalesInvoice([line("فاکتور " + "آ".repeat(13_000), 10)], "IRR");
  assert.match(empty.extraction.warnings.join(" "), /متنی از تصویر خوانده نشد/);
  assert.ok(long.documentText.length <= 12_000);
  assert.match(long.extraction.warnings.join(" "), /کیفیت تشخیص متن پایین/);
});
