export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) { super(message); }
}

function cookie(name: string): string | undefined {
  return document.cookie.split("; ").find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const businessId = sessionStorage.getItem("shopro_business_id");
  const branchId = sessionStorage.getItem("shopro_branch_id");
  if (businessId) headers.set("x-business-id", businessId);
  if (branchId) headers.set("x-branch-id", branchId);
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    const csrf = cookie("shopro_csrf");
    if (csrf) headers.set("x-csrf-token", decodeURIComponent(csrf));
  }
  const response = await fetch(`/api/v1${path}`, { ...options, method, headers, credentials: "include" });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null) as { message?: string; code?: string } | null;
  if (!response.ok) throw new ApiError(response.status, body?.message ?? "ارتباط با سرور انجام نشد.", body?.code);
  return body as T;
}

export const get = <T,>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T,>(path: string, body?: unknown, headers?: Record<string, string>) => api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers });
export const patch = <T,>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const newOperationId = () => crypto.randomUUID();
