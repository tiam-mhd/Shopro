import assert from "node:assert/strict";
import test from "node:test";
import { faNumber, money } from "../src/lib/numeric-format.js";
import { gregorianDateFromJalali, jalaliDateFromIso } from "../src/lib/jalali-date.js";

test("faNumber preserves large integer strings without IEEE-754 rounding", () => {
  assert.equal(faNumber("9007199254740993"), "۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳");
});

test("faNumber rounds decimal strings to three places without converting through Number", () => {
  assert.equal(faNumber("1.2345"), "۱٫۲۳۵");
  assert.equal(faNumber("-1.2399"), "−۱٫۲۴");
});

test("money places one sign before the absolute Rial/Toman value", () => {
  assert.equal(money(-15n), "−۱٫۵ تومان");
  assert.equal(money(-1n), "−۰٫۱ تومان");
  assert.equal(money(-9n), "−۰٫۹ تومان");
  assert.equal(money(-10n), "−۱ تومان");
  assert.equal(money(-11n), "−۱٫۱ تومان");
  assert.equal(money(-15n, "IRR"), "−۱۵ ریال");
  assert.equal(money(9007199254740993n, "IRR"), "۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳ ریال");
  assert.equal(money(0n), "۰ تومان");
  assert.equal(money(null), "قابل محاسبه نیست");
});

test("Jalali leap day and year boundary convert to the expected ISO dates", () => {
  assert.equal(gregorianDateFromJalali(1399, 11, 30), "2021-03-20");
  assert.equal(gregorianDateFromJalali(1403, 11, 30), "2025-03-20");
  assert.equal(gregorianDateFromJalali(1404, 0, 1), "2025-03-21");
  assert.equal(jalaliDateFromIso("2025-03-20"), "۱۴۰۳/۱۲/۳۰");
});

test("invalid Jalali leap day is rejected", () => {
  assert.throws(() => gregorianDateFromJalali(1400, 11, 30), /تاریخ جلالی معتبر نیست/);
});

test("Jalali conversion remains stable at timezone date boundaries", () => {
  const originalTz = process.env.TZ;
  try {
    for (const timeZone of ["UTC", "Asia/Tehran", "Pacific/Honolulu", "Pacific/Kiritimati"]) {
      process.env.TZ = timeZone;
      assert.equal(gregorianDateFromJalali(1404, 0, 1), "2025-03-21");
      assert.equal(jalaliDateFromIso("2025-03-21"), "۱۴۰۴/۰۱/۰۱");
    }
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});
