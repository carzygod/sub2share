import assert from "node:assert/strict";
import test from "node:test";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { apiCorsOptions } from "../src/common/cors.js";
import { proxyRequestIdHeaderName } from "../src/modules/openai-proxy/helpers.js";

test("api cors exposes the proxy request id header on browser requests", async () => {
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
    assert.equal(response.headers["access-control-expose-headers"], proxyRequestIdHeaderName);
    assert.equal(response.headers[proxyRequestIdHeaderName], "req-browser");
  } finally {
    await app.close();
  }
});
