import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/sub2share_test";
process.env.JWT_ACCESS_SECRET ??= "test-secret-at-least-sixteen-characters";
process.env.SUB2_BASE_URL ??= "http://localhost:3001";
process.env.SUB2_PUBLIC_ENDPOINT ??= "http://localhost:3001";
process.env.SUB2_ADMIN_TOKEN ??= "test-sub2-admin-token";

const { walletHealthCheck } = await import("../src/modules/admin/routes.js");

test("wallet health check exposes negative balance samples for admin drilldown", () => {
  const updatedAt = new Date("2026-06-12T08:00:00.000Z");
  const check = walletHealthCheck(1, [
    {
      id: "wallet_1",
      userId: "user_1",
      availableBalance: new Prisma.Decimal("-1.25"),
      frozenBalance: new Prisma.Decimal("-0.50"),
      updatedAt,
      user: {
        email: "buyer@example.com",
        displayName: "Buyer",
        status: "active"
      }
    }
  ]);

  assert.equal(check.id, "wallets");
  assert.equal(check.status, "error");
  assert.equal(check.summary, "1 个钱包出现负余额");
  assert.equal(check.metrics?.negativeWallets, 1);
  assert.equal(check.metrics?.issueSamples, 2);

  const issues = (check.detail as { issues?: Array<Record<string, unknown>> }).issues ?? [];
  assert.deepEqual(issues.map((issue) => issue.type), ["negative_available_balance", "negative_frozen_balance"]);
  assert.equal(issues[0].walletId, "wallet_1");
  assert.equal(issues[0].walletAccountId, "wallet_1");
  assert.equal(issues[0].userId, "user_1");
  assert.equal(issues[0].userEmail, "buyer@example.com");
  assert.equal(issues[0].availableBalance, "-1.250000");
  assert.equal(issues[0].frozenBalance, "-0.500000");
  assert.equal(issues[0].updatedAt, updatedAt.toISOString());
});
