export const proxyRequestIdHeaderName = "x-proxy-request-id";
export const openAiProxyCorsExposedHeaders = [proxyRequestIdHeaderName];
export type OpenAiProxyErrorType = "invalid_request_error" | "insufficient_quota" | "rate_limit_error" | "api_error";
export type OpenAiProxyContractIssueSeverity = "warning" | "error";

export interface OpenAiProxyContractIssue {
  type: string;
  severity: OpenAiProxyContractIssueSeverity;
  message: string;
}

export function attachProxyRequestIdHeader(reply: { header: (name: string, value: string) => unknown }, requestId: string) {
  reply.header(proxyRequestIdHeaderName, requestId);
}

export function normalizeProxyRequestLookup(value: string) {
  const text = value.trim();
  if (!text) return "";

  const headerMatch = text.match(/\b(?:x-proxy-request-id|x-request-id)\b\s*[:=]\s*([^\s,;]+)/i);
  return headerMatch?.[1] ?? text;
}

export function openAiProxyErrorType(statusCode: number, code: string): OpenAiProxyErrorType {
  if (statusCode === 402 || code === "insufficient_balance" || code === "spend_limit_exhausted") {
    return "insufficient_quota";
  }
  if (statusCode === 429) return "rate_limit_error";
  if (statusCode >= 500) return "api_error";
  return "invalid_request_error";
}

export function openAiProxyErrorPayload(statusCode: number, code: string, message: string) {
  return {
    error: {
      message,
      type: openAiProxyErrorType(statusCode, code),
      code
    }
  };
}

export function inspectOpenAiProxyContract(endpoint: string) {
  const trimmedEndpoint = endpoint.trim();
  const normalizedEndpoint = trimmedEndpoint.replace(/\/+$/, "");
  const issues: OpenAiProxyContractIssue[] = [];

  let endpointProtocol: string | null = null;
  try {
    const parsed = new URL(trimmedEndpoint);
    endpointProtocol = parsed.protocol.replace(/:$/, "");
    if (!["http", "https"].includes(endpointProtocol)) {
      issues.push({
        type: "invalid_endpoint_protocol",
        severity: "error",
        message: "OpenAI proxy public endpoint must use http or https"
      });
    }
  } catch {
    issues.push({
      type: "invalid_endpoint_url",
      severity: "error",
      message: "OpenAI proxy public endpoint is not a valid URL"
    });
  }

  if (!normalizedEndpoint.endsWith("/v1")) {
    issues.push({
      type: "endpoint_not_v1",
      severity: "error",
      message: "OpenAI proxy public endpoint must point to the /v1 API base path"
    });
  }

  const corsExposesRequestId = openAiProxyCorsExposedHeaders.includes(proxyRequestIdHeaderName);
  if (!corsExposesRequestId) {
    issues.push({
      type: "request_id_header_not_exposed",
      severity: "error",
      message: "CORS must expose x-proxy-request-id for browser clients"
    });
  }

  const errorTypes = {
    insufficientQuota: openAiProxyErrorPayload(402, "insufficient_balance", "Wallet balance is not enough").error.type,
    rateLimit: openAiProxyErrorPayload(429, "rpm_limit_exceeded", "RPM limit has been reached").error.type,
    apiError: openAiProxyErrorPayload(502, "upstream_unavailable", "Sub2API upstream is unavailable").error.type
  };
  if (errorTypes.insufficientQuota !== "insufficient_quota") {
    issues.push({
      type: "insufficient_quota_error_type_mismatch",
      severity: "error",
      message: "402 local proxy errors must map to insufficient_quota"
    });
  }
  if (errorTypes.rateLimit !== "rate_limit_error") {
    issues.push({
      type: "rate_limit_error_type_mismatch",
      severity: "error",
      message: "429 local proxy errors must map to rate_limit_error"
    });
  }
  if (errorTypes.apiError !== "api_error") {
    issues.push({
      type: "api_error_type_mismatch",
      severity: "error",
      message: "5xx local proxy errors must map to api_error"
    });
  }

  return {
    ok: issues.length === 0,
    summary: {
      endpoint: normalizedEndpoint || trimmedEndpoint,
      endpointProtocol,
      endpointEndsWithV1: normalizedEndpoint.endsWith("/v1"),
      requestIdHeader: proxyRequestIdHeaderName,
      corsExposesRequestId,
      insufficientQuotaErrorType: errorTypes.insufficientQuota,
      rateLimitErrorType: errorTypes.rateLimit,
      apiErrorType: errorTypes.apiError
    },
    errorTypes,
    issues
  };
}

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
