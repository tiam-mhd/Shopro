import test from "node:test";
import assert from "node:assert/strict";
import { extractSalesInvoice } from "../dist/sales/sales-ocr-local.js";

const line = (text, confidence = 92) => ({ text, confidence });

function spatialLine(entries, y, confidence = 92) {
  const words = entries.map(([text, x0, width = 42]) => ({ text, confidence, x0, y0: y, x1: x0 + width, y1: y + 16 }));
  return { text: words.map((word) => word.text).join(" "), confidence, words };
}

test("keeps the invoice currency and original Toman/Rial amount beside canonical Rial values", () => {
  const toman = extractSalesInvoice([line("Grand Total: 350,000 Toman")], "IRR");
  const rial = extractSalesInvoice([line("Grand Total: 3,500,000 Rial")], "IRT");

  assert.equal(toman.extraction.totals.totalRial, "3500000");
  assert.deepEqual(toman.extraction.totals.sourceTotal, { value: "350000", currency: "IRT" });
  assert.equal(rial.extraction.totals.totalRial, "3500000");
  assert.deepEqual(rial.extraction.totals.sourceTotal, { value: "3500000", currency: "IRR" });
});

test("detects Persian Rial and Toman labels even when the business display currency differs", () => {
  const toman = extractSalesInvoice([line("جمع کل: ۳۵۰,۰۰۰ تومان")], "IRR");
  const rial = extractSalesInvoice([line("مبلغ کل: ۳,۵۰۰,۰۰۰ ریال")], "IRT");

  assert.equal(toman.extraction.totals.totalRial, "3500000");
  assert.deepEqual(toman.extraction.totals.sourceTotal, { value: "350000", currency: "IRT" });
  assert.equal(rial.extraction.totals.totalRial, "3500000");
  assert.deepEqual(rial.extraction.totals.sourceTotal, { value: "3500000", currency: "IRR" });
});

test("reads customer identity below an English Bill To section heading", () => {
  const result = extractSalesInvoice([line("Bill To"), line("John Doe"), line("Dublin 2")], "IRR");
  assert.equal(result.extraction.customer?.name, "John Doe");
});

test("preserves source-currency amounts on foreign-currency item rows without treating them as Rials", () => {
  const result = extractSalesInvoice([
    line("Description | Qty | Price | Amount"),
    line("Socks | 2 | RM 9.50 | RM 19.00"),
    line("Total: RM 19.00"),
  ], "IRR");

  assert.equal(result.extraction.items.length, 1);
  assert.equal(result.extraction.items[0].quantity, "2");
  assert.equal(result.extraction.items[0].unitPriceRial, null);
  assert.deepEqual(result.extraction.items[0].sourceUnitPrice, { value: "9.50", currency: "MYR" });
  assert.deepEqual(result.extraction.items[0].sourceLineTotal, { value: "19.00", currency: "MYR" });
  assert.equal(result.extraction.totals.totalRial, null);
  assert.deepEqual(result.extraction.totals.sourceTotal, { value: "19.00", currency: "MYR" });
});

test("reconstructs item rows and numeric columns from word bounding boxes when OCR line order is unreliable", () => {
  const result = extractSalesInvoice([
    spatialLine([["Amount", 20], ["Price", 120], ["Qty", 220], ["Description", 320, 95]], 30),
    spatialLine([["3000", 20], ["1500", 120], ["2", 220], ["Gear", 320]], 70),
    spatialLine([["900", 20], ["900", 120], ["1", 220], ["Filter", 320]], 110),
    spatialLine([["Total:", 20], ["3900", 120]], 160),
  ], "IRR");

  assert.equal(result.extraction.items.length, 2);
  assert.deepEqual(result.extraction.items.map((item) => [item.name, item.quantity, item.unitPriceRial, item.lineTotalRial]), [
    ["Gear", "2", "1500", "3000"],
    ["Filter", "1", "900", "900"],
  ]);
});

test("does not treat an unverified zero as an invoice total", () => {
  const result = extractSalesInvoice([line("Grand Total: 0")], "IRR");
  assert.equal(result.extraction.totals.totalRial, null);
  assert.equal(result.extraction.totals.sourceTotal, null);
});

test("leaves mismatched table prices empty and asks the user to verify them", () => {
  const result = extractSalesInvoice([
    spatialLine([["Description", 320, 95], ["Qty", 220], ["Price", 120], ["Total", 20]], 30),
    spatialLine([["Widget", 320], ["2", 220], ["100", 120], ["999", 20]], 70),
  ], "IRR");

  assert.equal(result.extraction.items.length, 1);
  assert.equal(result.extraction.items[0].quantity, "2");
  assert.equal(result.extraction.items[0].sourceUnitPrice, null);
  assert.equal(result.extraction.items[0].sourceLineTotal, null);
  assert.ok(result.extraction.warnings.some((warning) => warning.includes("محاسبهٔ مبلغ واحد")));
});

test("recognizes Persian table headers and maps each amount to its visual column", () => {
  const result = extractSalesInvoice([
    spatialLine([["شرح کالا", 320, 70], ["تعداد", 220], ["قیمت واحد", 120, 65], ["مبلغ کل", 20, 55]], 30),
    spatialLine([["دنده", 320], ["2", 220], ["1500", 120], ["3000", 20]], 70),
  ], "IRR");

  assert.equal(result.extraction.items.length, 1);
  assert.deepEqual(result.extraction.items.map((item) => [item.name, item.quantity, item.unitPriceRial, item.lineTotalRial]), [["دنده", "2", "1500", "3000"]]);
});

test("rejects a detected invoice total that is far below a verified line total", () => {
  const result = extractSalesInvoice([
    line("Description Qty Price Amount"),
    line("Gear | 2 | 1500 | 3000"),
    line("Grand Total: 10"),
  ], "IRR");

  assert.equal(result.extraction.items[0]?.lineTotalRial, "3000");
  assert.equal(result.extraction.totals.totalRial, null);
  assert.equal(result.extraction.totals.sourceTotal, null);
});
