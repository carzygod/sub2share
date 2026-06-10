interface AuthRefreshResult {
  token: string;
  refreshToken?: string;
}

export async function api<T>(path: string, options: RequestInit = {}) {
  const response = await sendApiRequest(path, options);
  let body = await response.json().catch(() => null);
  if (response.status === 401 && path !== "/api/auth/refresh" && await refreshAdminAccessToken()) {
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

function apiBase() {
  return import.meta.env.VITE_API_BASE ?? "";
}

async function sendApiRequest(path: string, options: RequestInit = {}) {
  const apiBase = import.meta.env.VITE_API_BASE ?? "";
  const token = localStorage.getItem("zyz_admin_token");
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(`${apiBase}${path}`, { ...options, headers });
}

async function refreshAdminAccessToken() {
  const refreshToken = localStorage.getItem("zyz_admin_refresh_token");
  if (!refreshToken) return false;

  const response = await fetch(`${apiBase()}/api/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    clearAdminToken();
    return false;
  }
  const data = body.data as AuthRefreshResult;
  saveAdminToken(data.token, data.refreshToken ?? refreshToken);
  return true;
}

export function saveAdminToken(token: string, refreshToken?: string | null) {
  localStorage.setItem("zyz_admin_token", token);
  if (refreshToken) localStorage.setItem("zyz_admin_refresh_token", refreshToken);
}

export function clearAdminToken() {
  localStorage.removeItem("zyz_admin_token");
  localStorage.removeItem("zyz_admin_refresh_token");
}
