import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { deskewInvoiceImage } from "../dist/sales/sales-ocr-image.js";

const svgPage = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="100%" height="100%" fill="white"/><g fill="black"><rect x="100" y="110" width="700" height="5"/>${Array.from({ length: 18 }, (_, index) => `<rect x="100" y="${190 + index * 42}" width="700" height="3"/><rect x="120" y="${202 + index * 42}" width="330" height="9"/><rect x="500" y="${202 + index * 42}" width="110" height="9"/><rect x="650" y="${202 + index * 42}" width="130" height="9"/>`).join("")}<rect x="100" y="970" width="700" height="5"/></g></svg>`);

test("deskews rotated invoice pages using page layout rather than a fixed invoice template", async () => {
  const skewed = await sharp(svgPage).rotate(4, { background: "white" }).png().toBuffer();
  const result = await deskewInvoiceImage(skewed, 40_000_000);

  assert.ok(Math.abs(result.correctionDegrees + 4) <= 0.5, `expected about -4°, got ${result.correctionDegrees}°`);
  const corrected = await sharp(result.image).metadata();
  assert.ok(corrected.width > 900 && corrected.height > 1200);
});

test("leaves already aligned invoice pages unrotated", async () => {
  const result = await deskewInvoiceImage(svgPage, 40_000_000);
  assert.equal(result.correctionDegrees, 0);
});
