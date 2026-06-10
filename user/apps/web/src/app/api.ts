export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export interface ApiResult<T> {
  ok: boolean;
  data: T;
  requestId: string;
}

interface AuthRefreshResult {
  token: string;
  refreshToken?: string;
}

export async function api<T>(path: string, options: RequestInit = {}) {
  const response = await sendApiRequest(path, options);
  let body = await response.json().catch(() => null);
  if (response.status === 401 && path !== "/api/auth/refresh" && await refreshAccessToken()) {
    const retry = await sendApiRequest(path, options);
    body = await retry.json().catch(() => null);
    if (!retry.ok || !body?.ok) {
      throw new Error(body?.error?.message ?? `Request failed: ${retry.status}`);
    }
    return body.data as T;
  }

  if (!response.ok || !body?.ok) {
    throw new Error(body?.error?.message ?? `Request failed: ${response.status}`);
  }
  return body.data as T;
}

async function sendApiRequest(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem("zyz_token");
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);

  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem("zyz_refresh_token");
  if (!refreshToken) return false;

  const response = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    clearToken();
    return false;
  }
  const data = body.data as AuthRefreshResult;
  saveToken(data.token, data.refreshToken ?? refreshToken);
  return true;
}

export function saveToken(token: string, refreshToken?: string | null) {
  localStorage.setItem("zyz_token", token);
  if (refreshToken) localStorage.setItem("zyz_refresh_token", refreshToken);
}

export function clearToken() {
  localStorage.removeItem("zyz_token");
  localStorage.removeItem("zyz_refresh_token");
}
