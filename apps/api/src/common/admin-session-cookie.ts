export const ADMIN_SESSION_COOKIE = process.env.COOKIE_SECURE === "true"
  ? "__Host-shopro_admin_session"
  : "shopro_admin_session";
export const ADMIN_CSRF_COOKIE = "shopro_admin_csrf";
