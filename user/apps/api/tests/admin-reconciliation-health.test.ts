import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/sub2share_test";
process.env.JWT_ACCESS_SECRET ??= "test-secret-at-least-sixteen-characters";
process.env.SUB2_BASE_URL ??= "http://localhost:3001";
process.env.SUB2_PUBLIC_ENDPOINT ??= "http://localhost:3001";
process.env.SUB2_ADMIN_TOKEN ??= "test-sub2-admin-token";

const { reconciliationHealthCheck } = await import("../src/modules/admin/routes.js");

test("reconciliation health check exposes issue samples for admin drilldown", () => {
  const issue = {
    id: "wallet_transaction_missing_usage:wallet_transaction:txn_1",
    type: "wallet_transaction_missing_usage",
    severity: "error",
    refType: "wallet_transaction",
    refId: "txn_1",
    amount: "-1.20",
    message: "Consume wallet transaction references missing usage usage_missing."
  };
  const check = reconciliationHealthCheck({
    ok: false,
    summary: {
      billedUsageMissingWalletTransactions: 0,
      walletTransactionsMissingUsage: 1,
      usageSettlementMismatches: 0,
      settlementOverallocated: 0,
      withdrawalAllocationMismatches: 0,
      totalIssues: 1,
      returnedIssues: 1
    },
    issues: [issue]
  });

  assert.equal(check.id, "reconciliation");
  assert.equal(check.status, "error");
  assert.equal(check.summary, "1 个账务一致性问题");
  assert.deepEqual((check.detail as { issues?: unknown[] }).issues, [issue]);
});
