export const proxyRequestIdHeaderName = "x-proxy-request-id";
export const upstreamRequestIdHeaderNames = ["x-request-id", "openai-request-id", "x-openai-request-id", "request-id"] as const;
export const openAiProxyRateLimitHeaderNames = [
  "retry-after",
  "retry-after-ms",
  "x-ratelimit-limit-requests",
  "x-ratelimit-limit-tokens",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-remaining-tokens",
  "x-ratelimit-reset-requests",
  "x-ratelimit-reset-tokens"
] as const;
export const openAiProxyCorsExposedHeaders = [proxyRequestIdHeaderName, ...upstreamRequestIdHeaderNames, ...openAiProxyRateLimitHeaderNames];
export const proxyRequestLookupHeaderNames = [proxyRequestIdHeaderName, ...upstreamRequestIdHeaderNames] as const;
export const openAiProxyRouteBasePath = "/v1";
export const openAiProxyRoutePath = "/v1/*";
export const openAiProxyRoutePaths = [openAiProxyRouteBasePath, openAiProxyRoutePath] as const;
export const openAiProxyRouteMethods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;
export const openAiProxyHopByHopHeaderNames = [
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
] as const;
export const openAiProxyCorePathSamples = [
  "/v1",
  "/v1/models",
  "/v1/models/gpt-5.3-codex",
  "/v1/responses",
  "/v1/responses/resp_123",
  "/v1/responses/resp_123/input_items?after=item_1",
  "/v1/chat/completions",
  "/v1/files",
  "/v1/uploads",
  "/v1/batches"
] as const;
export type OpenAiProxyErrorType = "invalid_request_error" | "insufficient_quota" | "rate_limit_error" | "api_error";
export type OpenAiProxyContractIssueSeverity = "warning" | "error";
export type OpenAiProxyRateLimitHeaderName = typeof openAiProxyRateLimitHeaderNames[number];

export interface OpenAiProxyRateLimitHeaderInput {
  retryAfterMs?: number | null;
  requestLimit?: number | null;
  requestUsed?: number | null;
  rpmLimit?: number | null;
  rpmUsed?: number | null;
  tpmLimit?: number | null;
  tpmUsed?: number | null;
}

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

export interface OpenAiProxyUpstreamHeaderInput {
  headers: Record<string, string | string[] | undefined>;
  apiKey: string;
  hostname: string;
  protocol: string;
  ip: string;
  requestId: string;
}

export const openAiProxyForwardingContract = {
  requestBodyMode: "raw-buffer",
  parsesAllContentTypesAsBuffer: true,
  forwardsOriginalBodyBytes: true,
  bodylessMethods: "GET,HEAD",
  upstreamAcceptEncoding: "identity",
  routesV1BasePath: true,
  stripsInboundAuthorization: true,
  stripsInboundAcceptEncoding: true,
  reinjectsLocalBearerToSub2: true,
  extractsMultipartModelForLogs: true,
  extractsFormUrlEncodedModelForLogs: true,
  extractsUrlModelForLogs: true,
  forwardsRequestId: true,
  capturesUpstreamRequestId: true,
  forwardsForwardedHostAndProto: true,
  abortsUpstreamOnClientClose: true,
  logsStreamCompletion: true,
  logsStreamErrors: true,
  hasStreamIdleTimeout: true
} as const;

const openAiProxyHopByHopHeaderSet = new Set<string>(openAiProxyHopByHopHeaderNames);

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

  const headerMatch = text.match(proxyRequestLookupHeaderPattern);
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
      param: null,
      code
    }
  };
}

export function openAiProxyRateLimitHeaders(input: OpenAiProxyRateLimitHeaderInput) {
  const headers: Partial<Record<OpenAiProxyRateLimitHeaderName, string>> = {};
  const retryAfterMs = normalizePositiveInteger(input.retryAfterMs);

  if (retryAfterMs !== null) {
    headers["retry-after-ms"] = String(retryAfterMs);
    headers["retry-after"] = String(Math.max(1, Math.ceil(retryAfterMs / 1000)));
  }

  const requestLimit = normalizeNonNegativeInteger(input.rpmLimit ?? input.requestLimit);
  if (requestLimit !== null) {
    const requestUsed = normalizeNonNegativeInteger(input.rpmUsed ?? input.requestUsed) ?? requestLimit;
    headers["x-ratelimit-limit-requests"] = String(requestLimit);
    headers["x-ratelimit-remaining-requests"] = String(Math.max(0, requestLimit - requestUsed));
    if (retryAfterMs !== null) {
      headers["x-ratelimit-reset-requests"] = formatRateLimitReset(retryAfterMs);
    }
  }

  const tokenLimit = normalizeNonNegativeInteger(input.tpmLimit);
  if (tokenLimit !== null) {
    const tokenUsed = normalizeNonNegativeInteger(input.tpmUsed) ?? tokenLimit;
    headers["x-ratelimit-limit-tokens"] = String(tokenLimit);
    headers["x-ratelimit-remaining-tokens"] = String(Math.max(0, tokenLimit - tokenUsed));
    if (retryAfterMs !== null) {
      headers["x-ratelimit-reset-tokens"] = formatRateLimitReset(retryAfterMs);
    }
  }

  return headers;
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

export function isOpenAiProxyHopByHopHeader(name: string) {
  return openAiProxyHopByHopHeaderSet.has(name.toLowerCase());
}

export function buildOpenAiProxyUpstreamHeaders(input: OpenAiProxyUpstreamHeaderInput) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(input.headers)) {
    const lower = name.toLowerCase();
    if (isOpenAiProxyHopByHopHeader(lower) || lower === "host" || lower === "authorization" || lower === "accept-encoding") continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, String(value));
    }
  }
  headers.set("authorization", `Bearer ${input.apiKey}`);
  headers.set("accept-encoding", "identity");
  headers.set("x-forwarded-host", input.hostname);
  headers.set("x-forwarded-proto", input.protocol);
  appendOpenAiProxyForwardedFor(headers, input.ip);
  headers.set("x-request-id", input.requestId);
  return headers;
}

export function buildSub2ProxyUrl(baseUrl: string, rawUrl: string) {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  const normalizedRawUrl = rawUrl.trim().replace(/^\/+/, "");
  return `${normalizedBase}/${normalizedRawUrl}`;
}

export function inspectOpenAiProxyContract(endpoint: string, runtimeOptions: OpenAiProxyContractRuntimeOptions = {}) {
  const trimmedEndpoint = endpoint.trim();
  const normalizedEndpoint = trimmedEndpoint.replace(/\/+$/, "");
  const issues: OpenAiProxyContractIssue[] = [];
  const routePath = openAiProxyRoutePath;
  const routePaths = [...openAiProxyRoutePaths];
  const routeMethods = [...openAiProxyRouteMethods];
  const supportsV1BasePath = routePaths.includes(openAiProxyRouteBasePath) && isOpenAiProxyRoutedPath(openAiProxyRouteBasePath);
  const supportsAllV1ChildPaths = routePath === "/v1/*";
  const routesV1BasePath = isOpenAiProxyRoutedPath("/v1");
  const supportsReadMethods = ["GET", "HEAD"].every((method) => routeMethods.includes(method as typeof openAiProxyRouteMethods[number]));
  const supportsMutationMethods = ["POST", "PUT", "PATCH", "DELETE"].every((method) => routeMethods.includes(method as typeof openAiProxyRouteMethods[number]));
  const routesResponsesApi = isOpenAiProxyRoutedPath("/v1/responses");
  const routesResponsesItems = isOpenAiProxyRoutedPath("/v1/responses/resp_123");
  const routesChatCompletions = isOpenAiProxyRoutedPath("/v1/chat/completions");
  const routesModelMetadata = isOpenAiProxyRoutedPath("/v1/models/gpt-5.3-codex");
  const routesCorePathSamples = openAiProxyCorePathSamples.every((path) => isOpenAiProxyRoutedPath(path));
  const sub2UrlWithTrailingBase = buildSub2ProxyUrl("https://sub2.example.com/api/", "/v1/responses/resp_123/input_items?after=item_1&include=output_text");
  const sub2UrlWithoutLeadingPath = buildSub2ProxyUrl("https://sub2.example.com/api", "v1/chat/completions?stream=true");
  const preservesRawPathAndQuery = sub2UrlWithTrailingBase === "https://sub2.example.com/api/v1/responses/resp_123/input_items?after=item_1&include=output_text";
  const normalizesSub2BaseTrailingSlash = sub2UrlWithoutLeadingPath === "https://sub2.example.com/api/v1/chat/completions?stream=true";
  const upstreamHeaderSample = buildOpenAiProxyUpstreamHeaders({
    headers: {
      authorization: "Bearer local-user-key",
      host: "api.local.test",
      "accept-encoding": "gzip",
      "content-length": "123",
      "content-type": "application/json",
      "x-client-trace": "trace-1",
      "x-forwarded-for": "203.0.113.1"
    },
    apiKey: "sub2-rental-key",
    hostname: "proxy.example.com",
    protocol: "https",
    ip: "198.51.100.2",
    requestId: "req-contract"
  });
  const forwardsUpstreamHeaders = upstreamHeaderSample.get("authorization") === "Bearer sub2-rental-key"
    && upstreamHeaderSample.get("accept-encoding") === "identity"
    && upstreamHeaderSample.get("content-type") === "application/json"
    && upstreamHeaderSample.get("x-client-trace") === "trace-1"
    && upstreamHeaderSample.get("x-forwarded-host") === "proxy.example.com"
    && upstreamHeaderSample.get("x-forwarded-proto") === "https"
    && upstreamHeaderSample.get("x-forwarded-for") === "203.0.113.1, 198.51.100.2"
    && upstreamHeaderSample.get("x-request-id") === "req-contract"
    && upstreamHeaderSample.get("host") === null
    && upstreamHeaderSample.get("content-length") === null;

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
  const corsExposesRateLimitHeaders = openAiProxyRateLimitHeaderNames.every((headerName) => openAiProxyCorsExposedHeaders.includes(headerName));
  const localRateLimitHeaders = openAiProxyRateLimitHeaders({
    retryAfterMs: 60_000,
    rpmLimit: 1,
    rpmUsed: 1,
    tpmLimit: 1_000,
    tpmUsed: 1_000
  });
  const setsLocalRateLimitHeaders = openAiProxyRateLimitHeaderNames.every((headerName) => Boolean(localRateLimitHeaders[headerName]));
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
  if (!corsExposesRateLimitHeaders) {
    issues.push({
      type: "rate_limit_headers_not_exposed",
      severity: "error",
      message: "CORS must expose retry-after and OpenAI rate limit headers for browser-side OpenAI proxy clients"
    });
  }
  if (!setsLocalRateLimitHeaders) {
    issues.push({
      type: "local_rate_limit_headers_incomplete",
      severity: "error",
      message: "Local 429 proxy responses must set retry-after and x-ratelimit headers for OpenAI-compatible clients"
    });
  }
  if (!supportsAllV1ChildPaths) {
    issues.push({
      type: "route_not_v1_wildcard",
      severity: "error",
      message: "OpenAI proxy must forward every concrete /v1 child path to Sub2API"
    });
  }
  if (!supportsV1BasePath || !routesV1BasePath) {
    issues.push({
      type: "route_base_path_not_registered",
      severity: "error",
      message: "OpenAI proxy must forward the exact /v1 API base path to Sub2API"
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
  if (!routesCorePathSamples) {
    issues.push({
      type: "core_openai_path_samples_not_routed",
      severity: "error",
      message: "OpenAI proxy route must cover representative Responses, Chat Completions, files, uploads, and batches paths"
    });
  }
  if (!preservesRawPathAndQuery || !normalizesSub2BaseTrailingSlash) {
    issues.push({
      type: "sub2_proxy_url_forwarding_incomplete",
      severity: "error",
      message: "OpenAI proxy must forward the raw /v1 path and query to Sub2API after normalizing the Sub2 base URL"
    });
  }
  if (!forwardsUpstreamHeaders) {
    issues.push({
      type: "upstream_header_forwarding_incomplete",
      severity: "error",
      message: "OpenAI proxy must strip local hop-by-hop/auth headers, reinject the sold Sub2 key, and preserve diagnostic forwarding headers"
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
  const normalizesProxyRequestLookupHeaders = proxyRequestLookupHeaderNames.every((headerName) => (
    normalizeProxyRequestLookup(`${headerName}: proxy-request-lookup-sample`) === "proxy-request-lookup-sample"
  ));
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
  const sampleErrorPayload = openAiProxyErrorPayload(401, "missing_api_key", "Missing bearer API key");
  const localErrorPayloadIncludesParam = Object.prototype.hasOwnProperty.call(sampleErrorPayload.error, "param")
    && sampleErrorPayload.error.param === null;
  if (!localErrorPayloadIncludesParam) {
    issues.push({
      type: "local_error_param_missing",
      severity: "error",
      message: "Local OpenAI proxy errors must include error.param for OpenAI-compatible clients"
    });
  }
  if (!normalizesProxyRequestLookupHeaders) {
    issues.push({
      type: "proxy_request_lookup_header_normalization_incomplete",
      severity: "error",
      message: "Admin proxy request search must normalize every exposed local and upstream request id header"
    });
  }

  return {
    ok: issues.length === 0,
    summary: {
      endpoint: normalizedEndpoint || trimmedEndpoint,
      endpointProtocol,
      endpointEndsWithV1: normalizedEndpoint.endsWith("/v1"),
      routePath,
      routePaths: routePaths.join(","),
      supportsV1BasePath,
      routeMethods: routeMethods.join(","),
      supportsAllV1ChildPaths,
      routesV1BasePath: routesV1BasePath && openAiProxyForwardingContract.routesV1BasePath,
      supportsReadMethods,
      supportsMutationMethods,
      routesResponsesApi,
      routesResponsesItems,
      routesChatCompletions,
      routesModelMetadata,
      corePathSamples: openAiProxyCorePathSamples.join(","),
      routesCorePathSamples,
      preservesRawPathAndQuery,
      normalizesSub2BaseTrailingSlash,
      forwardsUpstreamHeaders,
      requestIdHeader: proxyRequestIdHeaderName,
      upstreamRequestIdHeaders: upstreamRequestIdHeaderNames.join(","),
      rateLimitHeaders: openAiProxyRateLimitHeaderNames.join(","),
      proxyRequestLookupHeaders: proxyRequestLookupHeaderNames.join(","),
      corsExposesRequestId,
      corsExposesUpstreamRequestIds,
      corsExposesRateLimitHeaders,
      setsLocalRateLimitHeaders,
      normalizesProxyRequestLookupHeaders,
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
      extractsFormUrlEncodedModelForLogs: openAiProxyForwardingContract.extractsFormUrlEncodedModelForLogs,
      extractsUrlModelForLogs: openAiProxyForwardingContract.extractsUrlModelForLogs,
      forwardsRequestId: openAiProxyForwardingContract.forwardsRequestId,
      capturesUpstreamRequestId: openAiProxyForwardingContract.capturesUpstreamRequestId,
      forwardsForwardedHostAndProto: openAiProxyForwardingContract.forwardsForwardedHostAndProto,
      abortsUpstreamOnClientClose: openAiProxyForwardingContract.abortsUpstreamOnClientClose,
      logsStreamCompletion: openAiProxyForwardingContract.logsStreamCompletion,
      logsStreamErrors: openAiProxyForwardingContract.logsStreamErrors,
      hasStreamIdleTimeout: openAiProxyForwardingContract.hasStreamIdleTimeout,
      insufficientQuotaErrorType: errorTypes.insufficientQuota,
      rateLimitErrorType: errorTypes.rateLimit,
      apiErrorType: errorTypes.apiError,
      localErrorPayloadIncludesParam
    },
    errorTypes,
    issues
  };
}

function appendOpenAiProxyForwardedFor(headers: Headers, ip: string) {
  const existing = headers.get("x-forwarded-for");
  headers.set("x-forwarded-for", existing ? `${existing}, ${ip}` : ip);
}

function normalizeHeaderValue(value: string | null | undefined) {
  const normalized = value?.replace(/[\r\n]/g, " ").trim() ?? "";
  return normalized ? normalized.slice(0, 240) : null;
}

function normalizePositiveInteger(value: number | null | undefined) {
  if (value === undefined || value === null || !Number.isFinite(value) || value <= 0) return null;
  return Math.ceil(value);
}

function normalizeNonNegativeInteger(value: number | null | undefined) {
  if (value === undefined || value === null || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function formatRateLimitReset(retryAfterMs: number) {
  return retryAfterMs % 1000 === 0 ? `${retryAfterMs / 1000}s` : `${retryAfterMs}ms`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const proxyRequestLookupHeaderPattern = new RegExp(
  `\\b(?:${proxyRequestLookupHeaderNames.map(escapeRegExp).join("|")})\\b\\s*[:=]\\s*([^\\s,;]+)`,
  "i"
);

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
  return path === openAiProxyRouteBasePath || Boolean(path && path.startsWith(`${openAiProxyRouteBasePath}/`));
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

export function proxyRequestModel(body: unknown, url?: string, contentType?: unknown) {
  const record = proxyBodyRecord(body);
  const model = record && typeof record.model === "string" ? normalizeProxyModel(record.model) : "";
  return model
    || proxyFormUrlEncodedModel(body, contentType)
    || proxyMultipartModel(body)
    || proxyQueryModel(url)
    || proxyPathModel(url);
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

function proxyFormUrlEncodedModel(body: unknown, contentType: unknown) {
  if (!isFormUrlEncodedContentType(contentType)) return null;
  const text = proxyBodyText(body).trim();
  if (!text || !/(?:^|&)model=/i.test(text)) return null;
  return normalizeProxyModel(new URLSearchParams(text).get("model") ?? undefined);
}

function isFormUrlEncodedContentType(value: unknown) {
  const text = Array.isArray(value) ? value.join(";") : typeof value === "string" ? value : "";
  return text.toLowerCase().split(";").some((part) => part.trim() === "application/x-www-form-urlencoded");
}

function proxyQueryModel(url: string | undefined) {
  if (!url) return null;
  try {
    return normalizeProxyModel(new URL(url, "http://local.invalid").searchParams.get("model") ?? undefined);
  } catch {
    const query = url.split("?")[1] ?? "";
    return normalizeProxyModel(new URLSearchParams(query).get("model") ?? undefined);
  }
}

function proxyPathModel(url: string | undefined) {
  const path = proxyUrlPath(url);
  const match = path?.match(/^\/v1\/models\/([^/]+)$/);
  if (!match) return null;
  const encodedModel = match[1];
  if (!encodedModel) return null;
  try {
    return normalizeProxyModel(decodeURIComponent(encodedModel));
  } catch {
    return normalizeProxyModel(encodedModel);
  }
}

function proxyUrlPath(url: string | undefined) {
  if (!url) return "";
  try {
    return new URL(url, "http://local.invalid").pathname.replace(/\/+$/, "");
  } catch {
    return url.split("?")[0]?.replace(/\/+$/, "") ?? "";
  }
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
      message: "Rental RPM limit has been reached",
      rpmUsed: window.requests.length,
      tpmUsed: tpmLimit ? window.tokens.reduce((total, event) => total + event.tokens, 0) : null,
      retryAfterMs: retryAfterForRequestWindow(window.requests, rpmLimit, now, windowMs)
    };
  }

  const currentTokens = window.tokens.reduce((total, event) => total + event.tokens, 0);
  if (tpmLimit && currentTokens + estimatedTokens > tpmLimit) {
    return {
      ok: false as const,
      code: "tpm_limit_exceeded",
      message: "Rental TPM limit has been reached",
      rpmUsed: rpmLimit ? window.requests.length : null,
      tpmUsed: currentTokens,
      retryAfterMs: retryAfterForTokenWindow(window.tokens, tpmLimit, estimatedTokens, now, windowMs)
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

function retryAfterForRequestWindow(requests: number[], rpmLimit: number, now: number, windowMs: number) {
  const sorted = [...requests].sort((left, right) => left - right);
  const expiresIndex = Math.max(0, sorted.length - rpmLimit);
  return Math.max(1, (sorted[expiresIndex] ?? now) + windowMs - now);
}

function retryAfterForTokenWindow(
  tokens: Array<{ at: number; tokens: number }>,
  tpmLimit: number,
  estimatedTokens: number,
  now: number,
  windowMs: number
) {
  let projectedTokens = tokens.reduce((total, event) => total + event.tokens, 0) + estimatedTokens;
  const sorted = [...tokens].sort((left, right) => left.at - right.at);

  for (const event of sorted) {
    projectedTokens -= event.tokens;
    if (projectedTokens <= tpmLimit) {
      return Math.max(1, event.at + windowMs - now);
    }
  }

  return windowMs;
}
