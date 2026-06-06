export async function api<T>(path: string, options: RequestInit = {}) {
  const apiBase = import.meta.env.VITE_API_BASE ?? "";
  const token = localStorage.getItem("zyz_admin_token");
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${apiBase}${path}`, { ...options, headers });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new Error(body?.error?.message ?? `Request failed: ${response.status}`);
  }
  return body.data as T;
}

export function saveAdminToken(token: string) {
  localStorage.setItem("zyz_admin_token", token);
}

export function clearAdminToken() {
  localStorage.removeItem("zyz_admin_token");
}
