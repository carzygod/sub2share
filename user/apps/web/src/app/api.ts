export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export interface ApiResult<T> {
  ok: boolean;
  data: T;
  requestId: string;
}

export async function api<T>(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem("zyz_token");
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new Error(body?.error?.message ?? `Request failed: ${response.status}`);
  }
  return body.data as T;
}

export function saveToken(token: string) {
  localStorage.setItem("zyz_token", token);
}

export function clearToken() {
  localStorage.removeItem("zyz_token");
}
