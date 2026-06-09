export const localProxySmokeBuyerId = "admin-openai-proxy-smoke";
export const localProxySmokeUserEmail = "admin-openai-proxy-smoke@local.invalid";
export const localProxySmokeProductName = "Admin OpenAI proxy smoke";

export function isLocalProxySmokeMeta(meta: unknown) {
  return Boolean(
    meta
      && typeof meta === "object"
      && !Array.isArray(meta)
      && (meta as { smokeTest?: unknown }).smokeTest === true
  );
}
