import assert from "node:assert/strict";
import test from "node:test";
import {
  attachProxyRequestIdHeader,
  evaluateProxyRateLimitWindow,
  estimateProxyInputTokens,
  inspectOpenAiProxyContract,
  inspectOpenAiProxyRuntime,
  isOpenAiProxyRoutedPath,
  isProxyRateLimitWindowEmpty,
  isMetadataProxyRequest,
  normalizeProxyRequestLookup,
  openAiProxyErrorPayload,
  openAiProxyErrorType,
  openAiProxyCorsExposedHeaders,
  openAiProxyRouteMethods,
  openAiProxyRoutePath,
  proxyBodyByteLength,
  proxyRequestIdHeaderName,
  proxyBodyText,
  proxyRequestModel,
  pruneProxyRateLimitWindow,
  upstreamHttpProxyErrorCode,
  type ProxyRateLimitWindow
} from "../src/modules/openai-proxy/helpers.js";

test("classifies model metadata requests without charging request limits", () => {
  assert.equal(isMetadataProxyRequest("GET", "/v1/models"), true);
  assert.equal(isMetadataProxyRequest("HEAD", "/v1/models?limit=20"), true);
  assert.equal(isMetadataProxyRequest("GET", "/v1/models/gpt-5.3-codex"), true);
  assert.equal(isMetadataProxyRequest("GET", "/v1/models/gpt-5.3-codex/extra"), false);
});

test("keeps non-metadata OpenAI and Codex calls inside proxy gates", () => {
  assert.equal(isMetadataProxyRequest("POST", "/v1/models"), false);
  assert.equal(isMetadataProxyRequest("GET", "/v1/responses"), false);
  assert.equal(isMetadataProxyRequest("POST", "/v1/responses"), false);
  assert.equal(isMetadataProxyRequest("POST", "/v1/chat/completions"), false);
});

test("routes every concrete OpenAI v1 child path through the local proxy", () => {
  assert.equal(openAiProxyRoutePath, "/v1/*");
  assert.deepEqual([...openAiProxyRouteMethods], ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
  assert.equal(isOpenAiProxyRoutedPath("/v1/responses"), true);
  assert.equal(isOpenAiProxyRoutedPath("/v1/responses/resp_123"), true);
  assert.equal(isOpenAiProxyRoutedPath("/v1/responses/resp_123/input_items?after=item_1"), true);
  assert.equal(isOpenAiProxyRoutedPath("/v1/chat/completions"), true);
  assert.equal(isOpenAiProxyRoutedPath("/v1/models/gpt-5.3-codex"), true);
  assert.equal(isOpenAiProxyRoutedPath("/v1"), false);
  assert.equal(isOpenAiProxyRoutedPath("/api/admin/system-health"), false);
});

test("estimates proxy input tokens from raw request bodies", () => {
  assert.equal(estimateProxyInputTokens("GET", undefined), 1);
  assert.equal(estimateProxyInputTokens("POST", ""), 1);
  assert.equal(estimateProxyInputTokens("POST", Buffer.from("123456789")), 3);
  assert.equal(estimateProxyInputTokens("POST", { input: "hello" }), 5);
});

test("defers proxy RPM and TPM accounting until a rate check is committed", () => {
  const window: ProxyRateLimitWindow = { requests: [], tokens: [] };

  const check = evaluateProxyRateLimitWindow({
    window,
    now: 1_000,
    windowMs: 60_000,
    rpmLimit: 1,
    tpmLimit: 10,
    estimatedTokens: 4
  });

  assert.equal(check.ok, true);
  if (!check.ok) assert.fail("expected rate limit check to pass");
  assert.equal(check.rpmUsed, 1);
  assert.equal(check.tpmUsed, 4);
  assert.deepEqual(window.requests, []);
  assert.deepEqual(window.tokens, []);

  check.commit();
  assert.deepEqual(window.requests, [1_000]);
  assert.deepEqual(window.tokens, [{ at: 1_000, tokens: 4 }]);

  const rpmExceeded = evaluateProxyRateLimitWindow({
    window,
    now: 1_001,
    windowMs: 60_000,
    rpmLimit: 1,
    tpmLimit: 10,
    estimatedTokens: 1
  });
  assert.equal(rpmExceeded.ok, false);
  if (rpmExceeded.ok) assert.fail("expected RPM limit to fail after commit");
  assert.equal(rpmExceeded.code, "rpm_limit_exceeded");
});

test("prunes expired proxy RPM and TPM events from a rolling window", () => {
  const window: ProxyRateLimitWindow = {
    requests: [1_000, 61_000],
    tokens: [
      { at: 1_000, tokens: 3 },
      { at: 61_000, tokens: 4 }
    ]
  };

  pruneProxyRateLimitWindow(window, 62_000, 60_000);
  assert.deepEqual(window.requests, [61_000]);
  assert.deepEqual(window.tokens, [{ at: 61_000, tokens: 4 }]);
  assert.equal(isProxyRateLimitWindowEmpty(window), false);

  pruneProxyRateLimitWindow(window, 122_000, 60_000);
  assert.deepEqual(window.requests, []);
  assert.deepEqual(window.tokens, []);
  assert.equal(isProxyRateLimitWindowEmpty(window), true);
});

test("measures proxy body text and bytes for buffers and json objects", () => {
  const bufferBody = Buffer.from("hello");
  const objectBody = { model: "gpt-5.3-codex", input: "ping" };

  assert.equal(proxyBodyText(bufferBody), "hello");
  assert.equal(proxyBodyByteLength(bufferBody), 5);
  assert.equal(proxyBodyText(objectBody), JSON.stringify(objectBody));
  assert.equal(proxyBodyByteLength(objectBody), Buffer.byteLength(JSON.stringify(objectBody)));
});

test("extracts a top-level proxy model without retaining request bodies", () => {
  assert.equal(proxyRequestModel(Buffer.from(JSON.stringify({ model: "gpt-5.3-codex", input: "ping" }))), "gpt-5.3-codex");
  assert.equal(proxyRequestModel({ model: " o4-mini ", input: "ping" }), "o4-mini");
  assert.equal(proxyRequestModel(Buffer.from("{not-json")), null);
  assert.equal(proxyRequestModel(Buffer.from(JSON.stringify({ input: "ping" }))), null);
  assert.equal(proxyRequestModel(Buffer.from(JSON.stringify({ model: "" }))), null);
  assert.equal(proxyRequestModel(Buffer.from(JSON.stringify({ model: "m".repeat(200) }))), "m".repeat(160));
});

test("attaches a stable proxy request id header for local and upstream responses", () => {
  const headers = new Map<string, string>();
  attachProxyRequestIdHeader({
    header(name: string, value: string) {
      headers.set(name, value);
    }
  }, "req-123");

  assert.equal(proxyRequestIdHeaderName, "x-proxy-request-id");
  assert.equal(headers.get("x-proxy-request-id"), "req-123");
});

test("normalizes copied proxy request id headers for admin search", () => {
  assert.equal(normalizeProxyRequestLookup("x-proxy-request-id: req-123"), "req-123");
  assert.equal(normalizeProxyRequestLookup("X-Request-Id=req-456;"), "req-456");
  assert.equal(normalizeProxyRequestLookup("  user@example.com  "), "user@example.com");
  assert.equal(normalizeProxyRequestLookup("   "), "");
});

test("exposes the proxy request id header to browser clients", () => {
  assert.deepEqual(openAiProxyCorsExposedHeaders, [proxyRequestIdHeaderName]);
});

test("maps local proxy errors to OpenAI-compatible error types", () => {
  assert.equal(openAiProxyErrorType(401, "missing_api_key"), "invalid_request_error");
  assert.equal(openAiProxyErrorType(403, "rental_not_active"), "invalid_request_error");
  assert.equal(openAiProxyErrorType(402, "insufficient_balance"), "insufficient_quota");
  assert.equal(openAiProxyErrorType(402, "spend_limit_exhausted"), "insufficient_quota");
  assert.equal(openAiProxyErrorType(429, "rpm_limit_exceeded"), "rate_limit_error");
  assert.equal(openAiProxyErrorType(429, "concurrency_limit_exceeded"), "rate_limit_error");
  assert.equal(openAiProxyErrorType(502, "upstream_unavailable"), "api_error");
  assert.equal(openAiProxyErrorType(503, "proxy_limiter_unavailable"), "api_error");
  assert.equal(openAiProxyErrorType(504, "upstream_timeout"), "api_error");
});

test("builds OpenAI-compatible local proxy error payloads", () => {
  assert.deepEqual(openAiProxyErrorPayload(429, "request_limit_exceeded", "Rental request limit has been exhausted"), {
    error: {
      message: "Rental request limit has been exhausted",
      type: "rate_limit_error",
      code: "request_limit_exceeded"
    }
  });
});

test("labels upstream HTTP errors for proxy request logs", () => {
  assert.equal(upstreamHttpProxyErrorCode(undefined), null);
  assert.equal(upstreamHttpProxyErrorCode(null), null);
  assert.equal(upstreamHttpProxyErrorCode(200), null);
  assert.equal(upstreamHttpProxyErrorCode(302), null);
  assert.equal(upstreamHttpProxyErrorCode(400), "upstream_http_400");
  assert.equal(upstreamHttpProxyErrorCode(429), "upstream_http_429");
  assert.equal(upstreamHttpProxyErrorCode(500), "upstream_http_500");
});

test("inspects the local OpenAI proxy public contract", () => {
  const result = inspectOpenAiProxyContract(" https://api.example.com/v1/ ", {
    bodyLimitBytes: 52_428_800,
    upstreamTimeoutMs: 300_000,
    streamIdleTimeoutMs: 300_000
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.endpoint, "https://api.example.com/v1");
  assert.equal(result.summary.endpointEndsWithV1, true);
  assert.equal(result.summary.routePath, "/v1/*");
  assert.equal(result.summary.routeMethods, "GET,HEAD,POST,PUT,PATCH,DELETE");
  assert.equal(result.summary.supportsAllV1ChildPaths, true);
  assert.equal(result.summary.supportsReadMethods, true);
  assert.equal(result.summary.supportsMutationMethods, true);
  assert.equal(result.summary.routesResponsesApi, true);
  assert.equal(result.summary.routesResponsesItems, true);
  assert.equal(result.summary.routesChatCompletions, true);
  assert.equal(result.summary.routesModelMetadata, true);
  assert.equal(result.summary.corsExposesRequestId, true);
  assert.equal(result.summary.requestBodyMode, "raw-buffer");
  assert.equal(result.summary.parsesAllContentTypesAsBuffer, true);
  assert.equal(result.summary.forwardsOriginalBodyBytes, true);
  assert.equal(result.summary.bodylessMethods, "GET,HEAD");
  assert.equal(result.summary.bodyLimitBytes, 52_428_800);
  assert.equal(result.summary.upstreamTimeoutMs, 300_000);
  assert.equal(result.summary.streamIdleTimeoutMs, 300_000);
  assert.equal(result.summary.upstreamAcceptEncoding, "identity");
  assert.equal(result.summary.stripsInboundAuthorization, true);
  assert.equal(result.summary.stripsInboundAcceptEncoding, true);
  assert.equal(result.summary.reinjectsLocalBearerToSub2, true);
  assert.equal(result.summary.forwardsRequestId, true);
  assert.equal(result.summary.forwardsForwardedHostAndProto, true);
  assert.equal(result.summary.abortsUpstreamOnClientClose, true);
  assert.equal(result.summary.logsStreamCompletion, true);
  assert.equal(result.summary.logsStreamErrors, true);
  assert.equal(result.summary.hasStreamIdleTimeout, true);
  assert.equal(result.summary.insufficientQuotaErrorType, "insufficient_quota");
  assert.equal(result.summary.rateLimitErrorType, "rate_limit_error");
  assert.equal(result.summary.apiErrorType, "api_error");
  assert.deepEqual(result.errorTypes, {
    insufficientQuota: "insufficient_quota",
    rateLimit: "rate_limit_error",
    apiError: "api_error"
  });
  assert.deepEqual(result.issues, []);
});

test("reports invalid OpenAI proxy contract endpoints", () => {
  const invalidUrl = inspectOpenAiProxyContract("not-a-url");
  assert.equal(invalidUrl.ok, false);
  assert.equal(invalidUrl.issues.some((issue) => issue.type === "invalid_endpoint_url"), true);
  assert.equal(invalidUrl.issues.some((issue) => issue.type === "endpoint_not_v1"), true);

  const missingV1 = inspectOpenAiProxyContract("https://api.example.com");
  assert.equal(missingV1.ok, false);
  assert.equal(missingV1.issues.some((issue) => issue.type === "endpoint_not_v1"), true);

  const invalidProtocol = inspectOpenAiProxyContract("ftp://api.example.com/v1");
  assert.equal(invalidProtocol.ok, false);
  assert.equal(invalidProtocol.issues.some((issue) => issue.type === "invalid_endpoint_protocol"), true);
});

test("reports invalid OpenAI proxy runtime contract options", () => {
  const result = inspectOpenAiProxyContract("https://api.example.com/v1", {
    bodyLimitBytes: 0,
    upstreamTimeoutMs: -1,
    streamIdleTimeoutMs: 1.5
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.type === "invalid_body_limit"), true);
  assert.equal(result.issues.some((issue) => issue.type === "invalid_upstream_timeout"), true);
  assert.equal(result.issues.some((issue) => issue.type === "invalid_stream_idle_timeout"), true);
});

test("flags production OpenAI proxy runtime when limiter state is process-local", () => {
  const result = inspectOpenAiProxyRuntime({
    nodeEnv: "production",
    storeMode: "memory",
    limiterScope: "process",
    shared: false,
    redisReachable: null,
    rateWindowMs: 60_000,
    rateWindowCleanupIntervalMs: 60_000,
    activeConcurrencyRentals: 2,
    activeConcurrencyLeases: 3,
    activeRateWindowRentals: 4,
    activeRateWindowRequests: 5,
    activeRateWindowTokenEvents: 6,
    activeRateWindowEstimatedTokens: 7,
    lastRateWindowCleanupAt: "2026-06-10T00:00:00.000Z"
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.activeConcurrencyLeases, 3);
  assert.equal(result.summary.activeRateWindowEstimatedTokens, 7);
  assert.equal(result.issues.some((issue) => issue.type === "process_local_limiter" && issue.severity === "warning"), true);
});
