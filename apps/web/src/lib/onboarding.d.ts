export type DisplayCurrency = "IRR" | "IRT";
export type OnboardingDeviceType = "MOBILE" | "TABLET" | "DESKTOP" | "UNKNOWN";
export function displayAmountToRial(input: string, currency: DisplayCurrency): string;
export function deviceTypeFromUserAgent(userAgent?: string): OnboardingDeviceType;
export function businessCreationKey(userId: string, storage?: Pick<Storage, "getItem" | "setItem">, createId?: () => string): string;
export function clearBusinessCreationKey(userId: string, storage?: Pick<Storage, "removeItem">): void;
