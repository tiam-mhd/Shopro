import sharp from "sharp";

const DESKEW_MAX_ANGLE = 8;
const DESKEW_STEP = 0.5;
const DESKEW_MIN_ANGLE = 1.25;
const ANALYSIS_WIDTH = 600;

/**
 * Corrects small document rotation before OCR. The angle estimator uses the
 * concentration of dark pixels along horizontal scan rows, which is robust
 * for printed invoices and does not depend on a template or external service.
 */
export async function deskewInvoiceImage(image: Buffer, limitInputPixels: number) {
  const oriented = await sharp(image, { limitInputPixels }).rotate().toBuffer();
  const { data, info } = await sharp(oriented, { limitInputPixels })
    .resize({ width: ANALYSIS_WIDTH, height: ANALYSIS_WIDTH, fit: "inside", withoutEnlargement: true })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const centerX = (info.width - 1) / 2;
  const centerY = (info.height - 1) / 2;
  const darkPixels: Array<[number, number, number]> = [];
  for (let y = Math.floor(info.height * 0.03); y < info.height * 0.97; y++) {
    for (let x = Math.floor(info.width * 0.03); x < info.width * 0.97; x++) {
      const darkness = 190 - data[y * info.width + x];
      if (darkness > 0) darkPixels.push([x, y, darkness]);
    }
  }

  if (darkPixels.length < 100) return { image: oriented, correctionDegrees: 0 };

  let bestAngle = 0;
  let bestScore = -1;
  const histogramLength = info.height + info.width;
  for (let angle = -DESKEW_MAX_ANGLE; angle <= DESKEW_MAX_ANGLE; angle += DESKEW_STEP) {
    const radians = angle * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const histogram = new Float64Array(histogramLength);
    for (const [x, y, weight] of darkPixels) {
      const alignedY = Math.round(-sin * (x - centerX) + cos * (y - centerY) + centerY + info.width / 2);
      if (alignedY >= 0 && alignedY < histogramLength) histogram[alignedY] += weight;
    }

    const mean = histogram.reduce((sum, value) => sum + value, 0) / histogram.length;
    const threshold = mean * 1.5;
    let score = 0;
    for (const value of histogram) {
      if (value > threshold) score += (value - threshold) ** 2;
    }
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }

  const correctionDegrees = Math.abs(bestAngle) >= DESKEW_MIN_ANGLE ? -bestAngle : 0;
  if (!correctionDegrees) return { image: oriented, correctionDegrees: 0 };

  return {
    image: await sharp(oriented, { limitInputPixels })
      .rotate(correctionDegrees, { background: { r: 255, g: 255, b: 255 } })
      .png()
      .toBuffer(),
    correctionDegrees,
  };
}
