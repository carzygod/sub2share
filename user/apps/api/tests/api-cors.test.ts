import assert from "node:assert/strict";
import test from "node:test";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { apiCorsOptions, buildApiCorsOptions, inspectApiCorsPolicy } from "../src/common/cors.js";
import { openAiProxyCorsExposedHeaders, openAiProxyRateLimitHeaderNames, openAiProxyRouteMethods, proxyRequestIdHeaderName } from "../src/modules/openai-proxy/helpers.js";

test("api cors exposes proxy diagnostics and rate limit headers on browser requests", async () => {
  const app = Fastify({ logger: false });
  try {
    await app.register(cors, apiCorsOptions);
    app.get("/v1/models", async (_request, reply) => {
      reply.header(proxyRequestIdHeaderName, "req-browser");
      return { object: "list", data: [] };
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: {
        origin: "https://app.example.test"
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["access-control-allow-origin"], "https://app.example.test");
    assert.equal(response.headers["access-control-expose-headers"], openAiProxyCorsExposedHeaders.join(", "));
    assert.ok(csvHeaderValues(response.headers["access-control-expose-headers"]).includes("retry-after"));
    assert.ok(openAiProxyRateLimitHeaderNames.every((headerName) => csvHeaderValues(response.headers["access-control-expose-headers"]).includes(headerName)));
    assert.equal(response.headers[proxyRequestIdHeaderName], "req-browser");
  } finally {
    await app.close();
  }
});

test("production api cors only exposes approved origins", async () => {
  const app = Fastify({ logger: false });
  try {
    await app.register(cors, buildApiCorsOptions({
      nodeEnv: "production",
      appPublicUrl: "https://app.example.test",
      adminPublicUrl: "https://admin.example.test",
      apiPublicUrl: "https://api.example.test",
      corsAllowedOrigins: "https://console.example.test"
    }));
    app.get("/health", async () => ({ ok: true }));

    const allowed = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://admin.example.test" }
    });
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.headers["access-control-allow-origin"], "https://admin.example.test");

    const denied = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://evil.example.test" }
    });
    assert.equal(denied.statusCode, 200);
    assert.equal(denied.headers["access-control-allow-origin"], undefined);
  } finally {
    await app.close();
  }
});

test("api cors preflight allows every local OpenAI proxy route method", async () => {
  const app = Fastify({ logger: false });
  try {
    await app.register(cors, apiCorsOptions);
    app.patch("/v1/responses/:id", async () => ({ ok: true }));

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/responses/resp_123",
      headers: {
        origin: "https://app.example.test",
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "authorization, content-type"
      }
    });

    assert.equal(response.statusCode, 204);
    assert.deepEqual(csvHeaderValues(response.headers["access-control-allow-methods"]), [...openAiProxyRouteMethods]);
    assert.equal(response.headers["access-control-allow-headers"], "authorization, content-type");
  } finally {
    await app.close();
  }
});

test("api cors policy reports production wildcard and missing origins", () => {
  const wildcard = inspectApiCorsPolicy({
    nodeEnv: "production",
    corsAllowedOrigins: "*"
  });
  assert.equal(wildcard.ok, false);
  assert.equal(wildcard.issues.some((issue) => issue.type === "cors_wildcard_origin_rejected"), true);

  const missing = inspectApiCorsPolicy({ nodeEnv: "production" });
  assert.equal(missing.ok, false);
  assert.equal(missing.issues.some((issue) => issue.type === "cors_allowed_origins_missing"), true);

  const nonProduction = inspectApiCorsPolicy({ nodeEnv: "test" });
  assert.equal(nonProduction.ok, true);
  assert.equal(nonProduction.summary.enforced, false);
  assert.equal(nonProduction.summary.allowedMethods, openAiProxyRouteMethods.join(","));
  assert.ok(nonProduction.summary.exposesHeaders.includes("retry-after"));
  assert.ok(nonProduction.summary.exposesHeaders.includes("x-ratelimit-remaining-requests"));
});

function csvHeaderValues(value: string | string[] | number | undefined) {
  assert.equal(typeof value, "string");
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
