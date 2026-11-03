export function faNumber(value) {
  const raw = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 3 }).format(Number(value));
  const negative = match[1] === "-";
  const fraction = (match[3] ?? "").padEnd(4, "0");
  let scaled = BigInt(match[2]) * 1000n + BigInt(fraction.slice(0, 3));
  if (fraction[3] >= "5") scaled += 1n;
  if (negative) scaled = -scaled;
  const magnitude = scaled < 0n ? -scaled : scaled;
  const whole = magnitude / 1000n;
  const decimal = (magnitude % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  const formattedWhole = new Intl.NumberFormat("fa-IR").format(whole);
  return `${negative && magnitude !== 0n ? "−" : ""}${formattedWhole}${decimal ? `٫${decimal.replace(/[0-9]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)])}` : ""}`;
}

export function money(amount, currency = "IRT") {
  if (amount === null || amount === undefined) return "قابل محاسبه نیست";
  const rial = typeof amount === "bigint" ? amount : BigInt(amount);
  const negative = rial < 0n;
  const magnitude = negative ? -rial : rial;
  const shown = currency === "IRT" ? magnitude / 10n : magnitude;
  const rest = currency === "IRT" ? magnitude % 10n : 0n;
  const main = new Intl.NumberFormat("fa-IR").format(shown);
  return `${negative ? "−" : ""}${main}${rest ? `٫${faNumber(rest.toString())}` : ""} ${currency === "IRT" ? "تومان" : "ریال"}`;
}
