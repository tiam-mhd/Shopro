export function displayAmountToRial(input, currency) {
  const value = String(input)
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[٬,\s]/g, "")
    .trim();
  if (currency === "IRT") {
    const match = /^(\d+)(?:[.٫](\d))?$/.exec(value);
    if (!match) throw new Error("مبلغ تومان حداکثر یک رقم اعشار می‌پذیرد.");
    return (BigInt(match[1]) * 10n + BigInt(match[2] ?? "0")).toString();
  }
  if (currency !== "IRR" || !/^\d+$/.test(value)) throw new Error("مبلغ ریالی باید عدد صحیح باشد.");
  return BigInt(value).toString();
}

export function deviceTypeFromUserAgent(userAgent = "") {
  if (/iPad|Tablet|PlayBook|Silk/i.test(userAgent)) return "TABLET";
  if (/Android|iPhone|iPod|Mobile|Windows Phone/i.test(userAgent)) return "MOBILE";
  return userAgent ? "DESKTOP" : "UNKNOWN";
}

export function businessCreationKey(userId, storage = globalThis.localStorage, createId = () => globalThis.crypto.randomUUID()) {
  const storageKey = `shopro_business_create_key_${userId}`;
  const current = storage.getItem(storageKey);
  if (current && /^[A-Za-z0-9][A-Za-z0-9:._-]{7,127}$/.test(current)) return current;
  const created = createId();
  storage.setItem(storageKey, created);
  return created;
}

export function clearBusinessCreationKey(userId, storage = globalThis.localStorage) {
  storage.removeItem(`shopro_business_create_key_${userId}`);
}
