import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { z } from "zod";

import { AppError, sendError } from "../src/common/errors.js";

test("framework 4xx errors keep their status and code", async () => {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => sendError(reply, error));
  app.post("/empty-json", async () => ({ ok: true }));

  const response = await app.inject({
    method: "POST",
    url: "/empty-json",
    headers: { "content-type": "application/json" }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().ok, false);
  assert.equal(response.json().error.code, "fst_err_ctp_empty_json_body");
  assert.match(response.json().error.message, /Body cannot be empty/);

  await app.close();
});

test("zod validation errors return structured 400 responses", async () => {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => sendError(reply, error));
  app.get("/validated", async () => {
    z.object({ id: z.string().uuid() }).parse({ id: "not-a-uuid" });
    return { ok: true };
  });

  const response = await app.inject({ method: "GET", url: "/validated" });
  const body = response.json();

  assert.equal(response.statusCode, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "validation_error");
  assert.equal(body.error.details[0].path, "id");

  await app.close();
});

test("app errors keep their explicit status", async () => {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => sendError(reply, error));
  app.get("/app-error", async () => {
    throw new AppError("custom_block", "Custom block", 409, { ref: "abc" });
  });

  const response = await app.inject({ method: "GET", url: "/app-error" });
  const body = response.json();

  assert.equal(response.statusCode, 409);
  assert.equal(body.error.code, "custom_block");
  assert.deepEqual(body.error.details, { ref: "abc" });

  await app.close();
});
