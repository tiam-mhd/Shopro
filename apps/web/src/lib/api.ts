export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string, public readonly details?: unknown) { super(message); }
}

function cookie(name: string): string | undefined {
  return document.cookie.split("; ").find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function api<T>(path: string, options: RequestInit = {}, csrfToken?: string): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers);
  if (options.body && !(typeof FormData !== "undefined" && options.body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");
  const businessId = sessionStorage.getItem("shopro_business_id");
  const branchId = sessionStorage.getItem("shopro_branch_id");
  if (businessId) headers.set("x-business-id", businessId);
  if (branchId) headers.set("x-branch-id", branchId);
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    const csrf = csrfToken ?? cookie("shopro_csrf");
    if (csrf) headers.set("x-csrf-token", decodeURIComponent(csrf));
  }
  const response = await fetch(`/api/v1${path}`, { ...options, method, headers, credentials: "include" });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null) as { message?: string; code?: string } | null;
  if (!response.ok) throw new ApiError(response.status, body?.message ?? "ارتباط با سرور انجام نشد.", body?.code, body);
  return body as T;
}

/** Public storefront requests are capability based and must not send an app session or branch scope. */
export async function publicApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers);
  if (options.body && !(typeof FormData !== "undefined" && options.body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`/api/v1${path}`, { ...options, method, headers, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null) as { message?: string; code?: string } | null;
  if (!response.ok) throw new ApiError(response.status, body?.message ?? "ارتباط با سرور انجام نشد.", body?.code, body);
  return body as T;
}

export const publicGet = <T,>(path: string, signal?: AbortSignal) => publicApi<T>(path, { signal });
export const publicPost = <T,>(path: string, body?: unknown, headers?: Record<string, string>) => publicApi<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers });
export const publicUpload = <T,>(path: string, body: FormData) => publicApi<T>(path, { method: "POST", body });

export const get = <T,>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T,>(path: string, body?: unknown, headers?: Record<string, string>) => api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers });
export const adminApi = <T,>(path: string, options: RequestInit = {}, csrfToken?: string) => api<T>(path, options, csrfToken);
export const patch = <T,>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = <T,>(path: string) => api<T>(path, { method: "DELETE" });
export const uploadFile = <T,>(path: string, file: File) => { const body = new FormData(); body.append("file", file); return api<T>(path, { method: "POST", body }); };
export async function downloadFile(path: string, additionalHeaders: Record<string, string> = {}) {
  const headers = new Headers();
  const businessId = sessionStorage.getItem("shopro_business_id");
  const branchId = sessionStorage.getItem("shopro_branch_id");
  if (businessId) headers.set("x-business-id", businessId);
  if (branchId) headers.set("x-branch-id", branchId);
  for (const [name, value] of Object.entries(additionalHeaders)) headers.set(name, value);
  const response = await fetch(`/api/v1${path}`, { headers, credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; code?: string } | null;
    throw new ApiError(response.status, body?.message ?? "دریافت فایل انجام نشد.", body?.code);
  }
  return response.blob();
}
export const newOperationId = () => crypto.randomUUID();
