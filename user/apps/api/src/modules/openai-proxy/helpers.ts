export const proxyRequestIdHeaderName = "x-proxy-request-id";
export const upstreamRequestIdHeaderNames = ["x-request-id", "openai-request-id", "x-openai-request-id", "request-id"] as const;
export const openAiProxyCorsExposedHeaders = [proxyRequestIdHeaderName, ...upstreamRequestIdHeaderNames];
export const openAiProxyRoutePath = "/v1/*";
export const openAiProxyRouteMethods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;
export type OpenAiProxyErrorType = "invalid_request_error" | "insufficient_quota" | "rate_limit_error" | "api_error";
export type OpenAiProxyContractIssueSeverity = "warning" | "error";

export interface OpenAiProxyContractIssue {
  type: string;
  severity: OpenAiProxyContractIssueSeverity;
  message: string;
}

export interface OpenAiProxyContractRuntimeOptions {
  bodyLimitBytes?: number;
  upstreamTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
}

export const openAiProxyForwardingContract = {
  requestBodyMode: "raw-buffer",
  parsesAllContentTypesAsBuffer: true,
  forwardsOriginalBodyBytes: true,
  bodylessMethods: "GET,HEAD",
  upstreamAcceptEncoding: "identity",
  stripsInboundAuthorization: true,
  stripsInboundAcceptEncoding: true,
  reinjectsLocalBearerToSub2: true,
  extractsMultipartModelForLogs: true,
  forwardsRequestId: true,
  capturesUpstreamRequestId: true,
  forwardsForwardedHostAndProto: true,
  abortsUpstreamOnClientClose: true,
  logsStreamCompletion: true,
  logsStreamErrors: true,
  hasStreamIdleTimeout: true
} as const;

export interface ProxyRateLimitWindow {
  requests: number[];
  tokens: Array<{ at: number; tokens: number }>;
}

export interface OpenAiProxyRuntimeSummary {
  nodeEnv: string;
  storeMode: "memory" | "redis";
  limiterScope: "process" | "redis";
  shared: boolean;
  redisReachable: boolean | null;
  rateWindowMs: number;
  rateWindowCleanupIntervalMs: number;
  activeConcurrencyRentals: number;
  activeConcurrencyLeases: number;
  activeRateWindowRentals: number;
  activeRateWindowRequests: number;
  activeRateWindowTokenEvents: number;
  activeRateWindowEstimatedTokens: number;
  lastRateWindowCleanupAt: string | null;
}

export interface OpenAiProxyRuntimeIssue {
  id: string;
  type: string;
  severity: "warning" | "error";
  refId: string;
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

export function upstreamHttpProxyErrorCode(statusCode: number | null | undefined) {
  if (statusCode === undefined || statusCode === null || statusCode < 400) return null;
  return `upstream_http_${statusCode}`;
}

export function extractUpstreamRequestId(headers: Pick<Headers, "get">) {
  for (const headerName of upstreamRequestIdHeaderNames) {
    const value = headers.get(headerName);
    const normalized = normalizeHeaderValue(value);
    if (normalized) return normalized;
  }
  return null;
}

export function inspectOpenAiProxyContract(endpoint: string, runtimeOptions: OpenAiProxyContractRuntimeOptions = {}) {
  const trimmedEndpoint = endpoint.trim();
  const normalizedEndpoint = trimmedEndpoint.replace(/\/+$/, "");
  const issues: OpenAiProxyContractIssue[] = [];
  const routePath = openAiProxyRoutePath;
  const routeMethods = [...openAiProxyRouteMethods];
  const supportsAllV1ChildPaths = routePath === "/v1/*";
  const supportsReadMethods = ["GET", "HEAD"].every((method) => routeMethods.includes(method as typeof openAiProxyRouteMethods[number]));
  const supportsMutationMethods = ["POST", "PUT", "PATCH", "DELETE"].every((method) => routeMethods.includes(method as typeof openAiProxyRouteMethods[number]));
  const routesResponsesApi = isOpenAiProxyRoutedPath("/v1/responses");
  const routesResponsesItems = isOpenAiProxyRoutedPath("/v1/responses/resp_123");
  const routesChatCompletions = isOpenAiProxyRoutedPath("/v1/chat/completions");
  const routesModelMetadata = isOpenAiProxyRoutedPath("/v1/models/gpt-5.3-codex");

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
  const corsExposesUpstreamRequestIds = upstreamRequestIdHeaderNames.every((headerName) => openAiProxyCorsExposedHeaders.includes(headerName));
  if (!corsExposesRequestId) {
    issues.push({
      type: "request_id_header_not_exposed",
      severity: "error",
      message: "CORS must expose x-proxy-request-id for browser clients"
    });
  }
  if (!corsExposesUpstreamRequestIds) {
    issues.push({
      type: "upstream_request_id_headers_not_exposed",
      severity: "error",
      message: "CORS must expose upstream request id headers for browser-side OpenAI proxy diagnostics"
    });
  }
  if (!supportsAllV1ChildPaths) {
    issues.push({
      type: "route_not_v1_wildcard",
      severity: "error",
      message: "OpenAI proxy must forward every concrete /v1 child path to Sub2API"
    });
  }
  if (!supportsReadMethods || !supportsMutationMethods) {
    issues.push({
      type: "route_methods_incomplete",
      severity: "error",
      message: "OpenAI proxy must support GET, HEAD, POST, PUT, PATCH, and DELETE methods"
    });
  }
  if (!routesResponsesApi || !routesResponsesItems || !routesChatCompletions || !routesModelMetadata) {
    issues.push({
      type: "core_openai_paths_not_routed",
      severity: "error",
      message: "OpenAI proxy route must cover Responses API, response item paths, Chat Completions, and model metadata"
    });
  }

  validatePositiveIntegerRuntimeOption(issues, "bodyLimitBytes", runtimeOptions.bodyLimitBytes, "invalid_body_limit", "OpenAI proxy body limit must be a positive integer");
  validatePositiveIntegerRuntimeOption(issues, "upstreamTimeoutMs", runtimeOptions.upstreamTimeoutMs, "invalid_upstream_timeout", "OpenAI proxy upstream timeout must be a positive integer");
  validatePositiveIntegerRuntimeOption(issues, "streamIdleTimeoutMs", runtimeOptions.streamIdleTimeoutMs, "invalid_stream_idle_timeout", "OpenAI proxy stream idle timeout must be a positive integer");

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
      routePath,
      routeMethods: routeMethods.join(","),
      supportsAllV1ChildPaths,
      supportsReadMethods,
      supportsMutationMethods,
      routesResponsesApi,
      routesResponsesItems,
      routesChatCompletions,
      routesModelMetadata,
      requestIdHeader: proxyRequestIdHeaderName,
      upstreamRequestIdHeaders: upstreamRequestIdHeaderNames.join(","),
      corsExposesRequestId,
      corsExposesUpstreamRequestIds,
      requestBodyMode: openAiProxyForwardingContract.requestBodyMode,
      parsesAllContentTypesAsBuffer: openAiProxyForwardingContract.parsesAllContentTypesAsBuffer,
      forwardsOriginalBodyBytes: openAiProxyForwardingContract.forwardsOriginalBodyBytes,
      bodylessMethods: openAiProxyForwardingContract.bodylessMethods,
      bodyLimitBytes: runtimeOptions.bodyLimitBytes ?? null,
      upstreamTimeoutMs: runtimeOptions.upstreamTimeoutMs ?? null,
      streamIdleTimeoutMs: runtimeOptions.streamIdleTimeoutMs ?? null,
      upstreamAcceptEncoding: openAiProxyForwardingContract.upstreamAcceptEncoding,
      stripsInboundAuthorization: openAiProxyForwardingContract.stripsInboundAuthorization,
      stripsInboundAcceptEncoding: openAiProxyForwardingContract.stripsInboundAcceptEncoding,
      reinjectsLocalBearerToSub2: openAiProxyForwardingContract.reinjectsLocalBearerToSub2,
      extractsMultipartModelForLogs: openAiProxyForwardingContract.extractsMultipartModelForLogs,
      forwardsRequestId: openAiProxyForwardingContract.forwardsRequestId,
      capturesUpstreamRequestId: openAiProxyForwardingContract.capturesUpstreamRequestId,
      forwardsForwardedHostAndProto: openAiProxyForwardingContract.forwardsForwardedHostAndProto,
      abortsUpstreamOnClientClose: openAiProxyForwardingContract.abortsUpstreamOnClientClose,
      logsStreamCompletion: openAiProxyForwardingContract.logsStreamCompletion,
      logsStreamErrors: openAiProxyForwardingContract.logsStreamErrors,
      hasStreamIdleTimeout: openAiProxyForwardingContract.hasStreamIdleTimeout,
      insufficientQuotaErrorType: errorTypes.insufficientQuota,
      rateLimitErrorType: errorTypes.rateLimit,
      apiErrorType: errorTypes.apiError
    },
    errorTypes,
    issues
  };
}

function normalizeHeaderValue(value: string | null | undefined) {
  const normalized = value?.replace(/[\r\n]/g, " ").trim() ?? "";
  return normalized ? normalized.slice(0, 240) : null;
}

function validatePositiveIntegerRuntimeOption(
  issues: OpenAiProxyContractIssue[],
  field: string,
  value: number | undefined,
  type: string,
  message: string
) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value <= 0) {
    issues.push({
      type,
      severity: "error",
      message: `${message}: ${field}=${value}`
    });
  }
}

export function isOpenAiProxyRoutedPath(url: string) {
  const path = url.split("?")[0]?.replace(/\/+$/, "");
  return Boolean(path && path.startsWith("/v1/"));
}

export function inspectOpenAiProxyRuntime(summary: OpenAiProxyRuntimeSummary) {
  const issues: OpenAiProxyRuntimeIssue[] = [];

  if (summary.nodeEnv === "production" && summary.storeMode === "memory") {
    issues.push({
      id: "openai-proxy-process-local-limiter",
      type: "process_local_limiter",
      severity: "warning",
      refId: "openai-proxy-runtime",
      message: "OpenAI proxy concurrency and RPM/TPM windows are process-local; keep a single API instance or migrate the limiter to Redis/gateway scope before horizontal scaling"
    });
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    summary,
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

export function proxyRequestModel(body: unknown) {
  const record = proxyBodyRecord(body);
  const model = record && typeof record.model === "string" ? normalizeProxyModel(record.model) : "";
  return model || proxyMultipartModel(body);
}

function proxyBodyRecord(body: unknown): Record<string, unknown> | null {
  if (body === undefined || body === null) return null;
  if (typeof body === "object" && !Buffer.isBuffer(body) && !(body instanceof Uint8Array) && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }

  const text = proxyBodyText(body).trim();
  if (!text.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function proxyMultipartModel(body: unknown) {
  const text = proxyBodyText(body);
  if (!text.includes('name="model"') && !text.match(/\bname=model\b/i)) return null;

  const match = text.match(/(?:^|\r?\n)content-disposition:[^\r\n]*;\s*name=(?:"model"|model)(?:;[^\r\n]*)?\r?\n(?:[A-Za-z0-9-]+:[^\r\n]*\r?\n)*\r?\n([\s\S]*?)(?=\r?\n--[^\r\n]*|$)/i);
  return normalizeProxyModel(match?.[1]);
}

function normalizeProxyModel(value: string | undefined) {
  const model = value?.trim() ?? "";
  return model ? model.slice(0, 160) : null;
}

export function evaluateProxyRateLimitWindow(options: {
  window: ProxyRateLimitWindow;
  now: number;
  windowMs: number;
  rpmLimit: number | null;
  tpmLimit: number | null;
  estimatedTokens: number;
}) {
  const { window, now, windowMs, rpmLimit, tpmLimit, estimatedTokens } = options;
  pruneProxyRateLimitWindow(window, now, windowMs);

  if (rpmLimit && window.requests.length >= rpmLimit) {
    return {
      ok: false as const,
      code: "rpm_limit_exceeded",
      message: "Rental RPM limit has been reached"
    };
  }

  const currentTokens = window.tokens.reduce((total, event) => total + event.tokens, 0);
  if (tpmLimit && currentTokens + estimatedTokens > tpmLimit) {
    return {
      ok: false as const,
      code: "tpm_limit_exceeded",
      message: "Rental TPM limit has been reached"
    };
  }

  return {
    ok: true as const,
    rpmUsed: rpmLimit ? window.requests.length + 1 : null,
    tpmUsed: tpmLimit ? currentTokens + estimatedTokens : null,
    commit: () => {
      window.requests.push(now);
      if (estimatedTokens > 0) {
        window.tokens.push({ at: now, tokens: estimatedTokens });
      }
    }
  };
}

export function pruneProxyRateLimitWindow(window: ProxyRateLimitWindow, now: number, windowMs: number) {
  const cutoff = now - windowMs;
  window.requests = window.requests.filter((timestamp) => timestamp > cutoff);
  window.tokens = window.tokens.filter((event) => event.at > cutoff);
}

export function isProxyRateLimitWindowEmpty(window: ProxyRateLimitWindow) {
  return window.requests.length === 0 && window.tokens.length === 0;
}
