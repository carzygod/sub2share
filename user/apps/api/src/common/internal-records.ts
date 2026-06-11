export const localProxySmokeBuyerId = "admin-openai-proxy-smoke";
export const localProxySmokeUserEmail = "admin-openai-proxy-smoke@local.invalid";
export const localProxySmokeProductName = "Admin OpenAI proxy smoke";
export const legacyHealthCheckUserEmailPrefix = "codex_health_";
export const legacyHealthCheckUserEmailDomain = "@example.invalid";

export function isInternalHealthCheckUserEmail(email: string) {
  return email === localProxySmokeUserEmail
    || (email.startsWith(legacyHealthCheckUserEmailPrefix) && email.endsWith(legacyHealthCheckUserEmailDomain));
}

export function isLocalProxySmokeMeta(meta: unknown) {
  return Boolean(
    meta
      && typeof meta === "object"
      && !Array.isArray(meta)
      && (meta as { smokeTest?: unknown }).smokeTest === true
  );
}
