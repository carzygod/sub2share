import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import { requireAuth } from "../src/common/auth.js";
import { prisma } from "../src/common/prisma.js";

test("rejects refresh token payloads on access-protected routes", async () => {
  const request = {
    jwtVerify: async () => ({ type: "refresh", sub: "user-1" })
  } as unknown as FastifyRequest;

  await assert.rejects(() => requireAuth(request), { code: "unauthorized" });
});

test.after(async () => {
  await prisma.$disconnect();
});
