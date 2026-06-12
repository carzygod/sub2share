import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/sub2share_test";
process.env.JWT_ACCESS_SECRET ??= "test-secret-at-least-sixteen-characters";
process.env.SUB2_BASE_URL ??= "http://localhost:3001";
process.env.SUB2_PUBLIC_ENDPOINT ??= "http://localhost:3001";
process.env.SUB2_ADMIN_TOKEN ??= "test-sub2-admin-token";

const {
  isProxyClientRejectionErrorCode,
  proxyClientRejectionErrorCodes,
  proxyRequestHealthStatus,
  proxyRequestHealthSummary
} = await import("../src/modules/admin/routes.js");

const baseMetrics = {
  proxyRecentTotal: 0,
  proxyRecentClientErrors: 0,
  proxyRecentClientRejections: 0,
  proxyRecentActionableClientErrors: 0,
  proxyRecentServerErrors: 0,
  proxyRecentLocalErrors: 0,
  proxyRecentClientDisconnects: 0,
  proxyRecentStreamErrors: 0
};

test("classifies local proxy client rejections as non-blocking health traffic", () => {
  assert.ok(proxyClientRejectionErrorCodes.includes("missing_api_key"));
  assert.equal(isProxyClientRejectionErrorCode("missing_api_key"), true);
  assert.equal(isProxyClientRejectionErrorCode("invalid_api_key"), true);
  assert.equal(isProxyClientRejectionErrorCode("upstream_unavailable"), false);

  const metrics = {
    ...baseMetrics,
    proxyRecentTotal: 3,
    proxyRecentClientErrors: 3,
    proxyRecentClientRejections: 3
  };

  assert.equal(proxyRequestHealthStatus(metrics), "ok");
  assert.equal(proxyRequestHealthSummary(metrics), "3 次请求，0 次 5xx，3 次 4xx，3 次本地准入拒绝，0 次需复查 4xx，0 次客户端断开，0 次上游流异常");
});

test("keeps actionable proxy failures visible in health status", () => {
  assert.equal(proxyRequestHealthStatus({ ...baseMetrics, proxyRecentTotal: 1, proxyRecentClientErrors: 1, proxyRecentActionableClientErrors: 1 }), "warning");
  assert.equal(proxyRequestHealthStatus({ ...baseMetrics, proxyRecentTotal: 1, proxyRecentClientDisconnects: 1 }), "warning");
  assert.equal(proxyRequestHealthStatus({ ...baseMetrics, proxyRecentTotal: 1, proxyRecentServerErrors: 1 }), "error");
  assert.equal(proxyRequestHealthStatus({ ...baseMetrics, proxyRecentTotal: 1, proxyRecentLocalErrors: 1 }), "error");
  assert.equal(proxyRequestHealthStatus({ ...baseMetrics, proxyRecentTotal: 1, proxyRecentStreamErrors: 1 }), "error");
});
