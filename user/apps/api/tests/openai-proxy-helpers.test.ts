import assert from "node:assert/strict";
import test from "node:test";
import {
  attachProxyRequestIdHeader,
  estimateProxyInputTokens,
  isMetadataProxyRequest,
  normalizeProxyRequestLookup,
  openAiProxyErrorPayload,
  openAiProxyErrorType,
  openAiProxyCorsExposedHeaders,
  proxyBodyByteLength,
  proxyRequestIdHeaderName,
  proxyBodyText
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

test("estimates proxy input tokens from raw request bodies", () => {
  assert.equal(estimateProxyInputTokens("GET", undefined), 1);
  assert.equal(estimateProxyInputTokens("POST", ""), 1);
  assert.equal(estimateProxyInputTokens("POST", Buffer.from("123456789")), 3);
  assert.equal(estimateProxyInputTokens("POST", { input: "hello" }), 5);
});

test("measures proxy body text and bytes for buffers and json objects", () => {
  const bufferBody = Buffer.from("hello");
  const objectBody = { model: "gpt-5.3-codex", input: "ping" };

  assert.equal(proxyBodyText(bufferBody), "hello");
  assert.equal(proxyBodyByteLength(bufferBody), 5);
  assert.equal(proxyBodyText(objectBody), JSON.stringify(objectBody));
  assert.equal(proxyBodyByteLength(objectBody), Buffer.byteLength(JSON.stringify(objectBody)));
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
