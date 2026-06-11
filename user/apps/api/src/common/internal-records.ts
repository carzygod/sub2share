export const localProxySmokeBuyerId = "admin-openai-proxy-smoke";
export const localProxySmokeUserEmail = "admin-openai-proxy-smoke@local.invalid";
export const localProxySmokeProductName = "Admin OpenAI proxy smoke";
export const legacyHealthCheckUserEmailPrefix = "codex_health_";
export const legacyHealthCheckUserEmailDomain = "@example.invalid";
export const legacyE2eUserEmailPrefix = "e2e-";
export const legacyE2eUserEmailDomain = "@zhisuan.local";
export const legacyLocalProxySmokeProductPrefix = "Codex Local Proxy Smoke";
export const legacySmokeWithdrawalPayoutRefPrefix = "smoke-payout-";
export const legacySmokeWithdrawalNotePrefix = "Paid smoke";

export function isInternalHealthCheckUserEmail(email: string) {
  return email === localProxySmokeUserEmail
    || email.endsWith(legacyHealthCheckUserEmailDomain)
    || (email.startsWith(legacyE2eUserEmailPrefix) && email.endsWith(legacyE2eUserEmailDomain));
}

export function isLocalProxySmokeMeta(meta: unknown) {
  return Boolean(
    meta
      && typeof meta === "object"
      && !Array.isArray(meta)
      && (meta as { smokeTest?: unknown }).smokeTest === true
  );
}
