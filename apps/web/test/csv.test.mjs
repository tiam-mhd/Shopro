import assert from "node:assert/strict";
import test from "node:test";
import { encodeCsv, escapeCsvCell } from "../src/lib/csv.js";

test("CSV cells quote delimiters and neutralize formula-leading values", () => {
  assert.equal(escapeCsvCell("=1+1"), `"'=1+1"`);
  assert.equal(escapeCsvCell("  @SUM(A1:A2)"), `"'  @SUM(A1:A2)"`);
  assert.equal(escapeCsvCell("نام، \"ویژه\""), `"نام، ""ویژه"""`);
});

test("Persian CSV includes a UTF-8 BOM and CRLF row endings", () => {
  assert.equal(encodeCsv([["نام", "عملیات"], ["فروشگاه", "ثبت"]]), "\uFEFF\"نام\",\"عملیات\"\r\n\"فروشگاه\",\"ثبت\"");
});
