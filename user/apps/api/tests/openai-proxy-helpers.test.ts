import assert from "node:assert/strict";
import test from "node:test";
import {
  attachProxyRequestIdHeader,
  evaluateProxyRateLimitWindow,
  extractUpstreamRequestId,
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
  openAiProxyRateLimitHeaders,
  openAiProxyRateLimitHeaderNames,
  openAiProxyRouteMethods,
  openAiProxyRoutePath,
  openAiProxyRoutePaths,
  proxyBodyByteLength,
  proxyRequestLookupHeaderNames,
  proxyRequestIdHeaderName,
  proxyBodyText,
  proxyRequestModel,
  pruneProxyRateLimitWindow,
  upstreamHttpProxyErrorCode,
  upstreamRequestIdHeaderNames,
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
  assert.deepEqual([...openAiProxyRoutePaths], ["/v1", "/v1/*"]);
  assert.deepEqual([...openAiProxyRouteMethods], ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
  assert.equal(isOpenAiProxyRoutedPath("/v1"), true);
  assert.equal(isOpenAiProxyRoutedPath("/v1/"), true);
  assert.equal(isOpenAiProxyRoutedPath("/v1/responses"), true);
  assert.equal(isOpenAiProxyRoutedPath("/v1/responses/resp_123"), true);
  assert.equal(isOpenAiProxyRoutedPath("/v1/responses/resp_123/input_items?after=item_1"), true);
  assert.equal(isOpenAiProxyRoutedPath("/v1/chat/completions"), true);
  assert.equal(isOpenAiProxyRoutedPath("/v1/models/gpt-5.3-codex"), true);
  assert.equal(isOpenAiProxyRoutedPath("/v10/responses"), false);
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
  assert.equal(rpmExceeded.rpmUsed, 1);
  assert.equal(rpmExceeded.tpmUsed, 4);
  assert.equal(rpmExceeded.retryAfterMs, 59_999);
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
  assert.equal(proxyRequestModel(Buffer.from([
    "--boundary",
    'Content-Disposition: form-data; name="model"',
    "",
    "gpt-5.3-codex",
    "--boundary",
    'Content-Disposition: form-data; name="input"',
    "",
    "ping",
    "--boundary--"
  ].join("\r\n"))), "gpt-5.3-codex");
  assert.equal(proxyRequestModel(Buffer.from([
    "--boundary",
    "Content-Disposition: form-data; name=model",
    "Content-Type: text/plain",
    "",
    " o4-mini ",
    "--boundary--"
  ].join("\r\n"))), "o4-mini");
  assert.equal(
    proxyRequestModel(Buffer.from("model=gpt-5.3-codex&input=ping"), "/v1/responses", "application/x-www-form-urlencoded"),
    "gpt-5.3-codex"
  );
  assert.equal(
    proxyRequestModel(Buffer.from("input=ping&model=%20o4-mini%20"), "/v1/responses", "application/x-www-form-urlencoded; charset=utf-8"),
    "o4-mini"
  );
  assert.equal(proxyRequestModel(Buffer.from("model=not-form"), "/v1/responses", "text/plain"), null);
  assert.equal(proxyRequestModel(undefined, "/v1/responses?model=gpt-5.3-codex"), "gpt-5.3-codex");
  assert.equal(proxyRequestModel(undefined, "https://api.example.com/v1/responses?model=o4-mini"), "o4-mini");
  assert.equal(proxyRequestModel(undefined, "/v1/models/gpt-5.3-codex"), "gpt-5.3-codex");
  assert.equal(proxyRequestModel(undefined, "/v1/models/gpt-5.3-codex/extra"), null);
  assert.equal(proxyRequestModel(undefined, "/v1/responses/resp_123"), null);
  assert.equal(proxyRequestModel(Buffer.from("{not-json")), null);
  assert.equal(proxyRequestModel(Buffer.from(JSON.stringify({ input: "ping" }))), null);
  assert.equal(proxyRequestModel(Buffer.from([
    "--boundary",
    'Content-Disposition: form-data; name="not_model"',
    "",
    "gpt-5.3-codex",
    "--boundary--"
  ].join("\r\n"))), null);
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
  assert.equal(normalizeProxyRequestLookup("openai-request-id: req_openai"), "req_openai");
  assert.equal(normalizeProxyRequestLookup("x-openai-request-id = req_x_openai, next"), "req_x_openai");
  assert.equal(normalizeProxyRequestLookup("request-id=req_generic"), "req_generic");
  for (const headerName of proxyRequestLookupHeaderNames) {
    assert.equal(normalizeProxyRequestLookup(`${headerName}: req_all_headers`), "req_all_headers");
  }
  assert.equal(normalizeProxyRequestLookup("  user@example.com  "), "user@example.com");
  assert.equal(normalizeProxyRequestLookup("   "), "");
});

test("exposes local diagnostics and rate limit headers to browser clients", () => {
  assert.deepEqual(openAiProxyCorsExposedHeaders, [proxyRequestIdHeaderName, ...upstreamRequestIdHeaderNames, ...openAiProxyRateLimitHeaderNames]);
  assert.ok(openAiProxyCorsExposedHeaders.includes("retry-after"));
  assert.ok(openAiProxyCorsExposedHeaders.includes("x-ratelimit-remaining-requests"));
});

test("builds OpenAI-compatible local rate limit response headers", () => {
  const headers = openAiProxyRateLimitHeaders({
    retryAfterMs: 60_000,
    rpmLimit: 10,
    rpmUsed: 10,
    tpmLimit: 1_000,
    tpmUsed: 750
  });

  assert.equal(headers["retry-after"], "60");
  assert.equal(headers["retry-after-ms"], "60000");
  assert.equal(headers["x-ratelimit-limit-requests"], "10");
  assert.equal(headers["x-ratelimit-remaining-requests"], "0");
  assert.equal(headers["x-ratelimit-reset-requests"], "60s");
  assert.equal(headers["x-ratelimit-limit-tokens"], "1000");
  assert.equal(headers["x-ratelimit-remaining-tokens"], "250");
  assert.equal(headers["x-ratelimit-reset-tokens"], "60s");

  const exhaustedRequestLedgerHeaders = openAiProxyRateLimitHeaders({
    requestLimit: 25,
    requestUsed: 25
  });
  assert.equal(exhaustedRequestLedgerHeaders["x-ratelimit-limit-requests"], "25");
  assert.equal(exhaustedRequestLedgerHeaders["x-ratelimit-remaining-requests"], "0");
  assert.equal(exhaustedRequestLedgerHeaders["retry-after"], undefined);
});

test("extracts upstream request ids from common OpenAI and gateway headers", () => {
  assert.equal(extractUpstreamRequestId(new Headers({ "openai-request-id": "req_openai" })), "req_openai");
  assert.equal(extractUpstreamRequestId(new Headers({ "x-openai-request-id": " req_x_openai " })), "req_x_openai");
  assert.equal(extractUpstreamRequestId({ get: (name) => name === "request-id" ? "req_generic\r\nignored" : null }), "req_generic  ignored");
  assert.equal(extractUpstreamRequestId(new Headers({ "x-request-id": "sub2_req", "openai-request-id": "req_openai" })), "sub2_req");
  assert.equal(extractUpstreamRequestId(new Headers({ "content-type": "application/json" })), null);
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
      param: null,
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
  assert.equal(result.summary.routePaths, "/v1,/v1/*");
  assert.equal(result.summary.supportsV1BasePath, true);
  assert.equal(result.summary.routeMethods, "GET,HEAD,POST,PUT,PATCH,DELETE");
  assert.equal(result.summary.supportsAllV1ChildPaths, true);
  assert.equal(result.summary.routesV1BasePath, true);
  assert.equal(result.summary.supportsReadMethods, true);
  assert.equal(result.summary.supportsMutationMethods, true);
  assert.equal(result.summary.routesResponsesApi, true);
  assert.equal(result.summary.routesResponsesItems, true);
  assert.equal(result.summary.routesChatCompletions, true);
  assert.equal(result.summary.routesModelMetadata, true);
  assert.equal(result.summary.upstreamRequestIdHeaders, "x-request-id,openai-request-id,x-openai-request-id,request-id");
  assert.equal(result.summary.rateLimitHeaders, "retry-after,retry-after-ms,x-ratelimit-limit-requests,x-ratelimit-limit-tokens,x-ratelimit-remaining-requests,x-ratelimit-remaining-tokens,x-ratelimit-reset-requests,x-ratelimit-reset-tokens");
  assert.equal(result.summary.proxyRequestLookupHeaders, "x-proxy-request-id,x-request-id,openai-request-id,x-openai-request-id,request-id");
  assert.equal(result.summary.corsExposesRequestId, true);
  assert.equal(result.summary.corsExposesUpstreamRequestIds, true);
  assert.equal(result.summary.corsExposesRateLimitHeaders, true);
  assert.equal(result.summary.setsLocalRateLimitHeaders, true);
  assert.equal(result.summary.normalizesProxyRequestLookupHeaders, true);
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
  assert.equal(result.summary.extractsMultipartModelForLogs, true);
  assert.equal(result.summary.extractsFormUrlEncodedModelForLogs, true);
  assert.equal(result.summary.extractsUrlModelForLogs, true);
  assert.equal(result.summary.forwardsRequestId, true);
  assert.equal(result.summary.capturesUpstreamRequestId, true);
  assert.equal(result.summary.forwardsForwardedHostAndProto, true);
  assert.equal(result.summary.abortsUpstreamOnClientClose, true);
  assert.equal(result.summary.logsStreamCompletion, true);
  assert.equal(result.summary.logsStreamErrors, true);
  assert.equal(result.summary.hasStreamIdleTimeout, true);
  assert.equal(result.summary.insufficientQuotaErrorType, "insufficient_quota");
  assert.equal(result.summary.rateLimitErrorType, "rate_limit_error");
  assert.equal(result.summary.apiErrorType, "api_error");
  assert.equal(result.summary.localErrorPayloadIncludesParam, true);
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
