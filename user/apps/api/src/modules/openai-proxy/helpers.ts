export function isMetadataProxyRequest(method: string, url: string) {
  const normalizedMethod = method.toUpperCase();
  if (!["GET", "HEAD"].includes(normalizedMethod)) return false;

  const path = url.split("?")[0]?.replace(/\/+$/, "");
  return path === "/v1/models" || Boolean(path?.match(/^\/v1\/models\/[^/]+$/));
}

export function estimateProxyInputTokens(method: string, body: unknown) {
  if (["GET", "HEAD"].includes(method.toUpperCase())) return 1;

  const text = proxyBodyText(body);
  if (!text) return 1;

  return Math.max(1, Math.ceil(text.length / 4));
}

export function proxyBodyText(body: unknown) {
  if (body === undefined || body === null) return "";
  if (typeof body === "string") return body;
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  return JSON.stringify(body);
}

export function proxyBodyByteLength(body: unknown) {
  if (body === undefined || body === null) return 0;
  if (typeof body === "string") return Buffer.byteLength(body);
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return body.byteLength;
  return Buffer.byteLength(JSON.stringify(body));
}
