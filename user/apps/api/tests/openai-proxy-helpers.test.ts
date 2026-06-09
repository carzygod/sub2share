import assert from "node:assert/strict";
import test from "node:test";
import {
  attachProxyRequestIdHeader,
  estimateProxyInputTokens,
  isMetadataProxyRequest,
  normalizeProxyRequestLookup,
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
