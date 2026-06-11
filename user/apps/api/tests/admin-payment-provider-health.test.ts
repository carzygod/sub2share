import assert from "node:assert/strict";
import test from "node:test";
import { inspectPaymentProviderHealth, type PaymentRechargeActivitySummary } from "../src/modules/admin/payment-provider-health.js";

const noRecentRecharge: PaymentRechargeActivitySummary = {
  rechargeWindowHours: 24,
  rechargeWindowStartedAt: "2026-06-11T00:00:00.000Z",
  recentRechargeTransactions: 0,
  recentRechargeAmount: "0",
  latestRechargeAt: null
};

test("flags production mock recharge without recent ledger impact", () => {
  const result = inspectPaymentProviderHealth({
    provider: "mock",
    nodeEnv: "production",
    minRechargeAmount: 10,
    rechargeActivity: noRecentRecharge
  });

  assert.equal(result.status, "warning");
  assert.equal(result.summary, "生产环境仍启用 mock 充值");
  assert.equal(result.metrics.rechargeEndpointEnabled, true);
  assert.equal(result.metrics.recentRechargeTransactions, 0);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].type, "production_mock_recharge");
  assert.equal(result.issues[0].walletList, true);
  assert.equal(result.issues[0].walletTransactionList, true);
  assert.equal(result.issues[0].walletTransactionType, "recharge");
  assert.equal(result.issues[0].salesList, true);
  assert.match(result.issues[0].actionHint, /real payment provider/);
});

test("highlights recent production mock recharge ledger impact", () => {
  const result = inspectPaymentProviderHealth({
    provider: "mock",
    nodeEnv: "production",
    minRechargeAmount: 10,
    rechargeActivity: {
      ...noRecentRecharge,
      recentRechargeTransactions: 3,
      recentRechargeAmount: "42.500000",
      latestRechargeAt: "2026-06-11T10:00:00.000Z"
    }
  });

  assert.equal(result.status, "warning");
  assert.equal(result.metrics.recentRechargeTransactions, 3);
  assert.equal(result.metrics.recentRechargeAmount, "42.500000");
  assert.match(result.issues[0].message, /wrote 3 recharge transaction/);
  assert.match(result.issues[0].actionHint, /review recharge transactions/);
});

test("reports disabled recharge as unavailable", () => {
  const result = inspectPaymentProviderHealth({
    provider: "disabled",
    nodeEnv: "production",
    minRechargeAmount: 10,
    rechargeActivity: noRecentRecharge
  });

  assert.equal(result.status, "error");
  assert.equal(result.metrics.rechargeEndpointEnabled, false);
  assert.equal(result.issues[0].type, "payment_provider_disabled");
  assert.equal(result.issues[0].salesList, true);
});
