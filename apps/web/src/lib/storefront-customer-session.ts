export const STOREFRONT_CUSTOMER_SESSION_KEY = "shopro_storefront_customer_session";

export function readStorefrontCustomerSession() {
  try { return window.localStorage.getItem(STOREFRONT_CUSTOMER_SESSION_KEY) ?? ""; }
  catch { return ""; }
}

export function saveStorefrontCustomerSession(token: string) {
  try { window.localStorage.setItem(STOREFRONT_CUSTOMER_SESSION_KEY, token); return true; }
  catch { return false; }
}

export function clearStorefrontCustomerSession() {
  try { window.localStorage.removeItem(STOREFRONT_CUSTOMER_SESSION_KEY); } catch { /* Browser storage is optional. */ }
}
