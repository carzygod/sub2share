import assert from "node:assert/strict";
import test from "node:test";
import { inspectPaymentProviderHealth, type PaymentRechargeActivitySummary } from "../src/modules/admin/payment-provider-health.js";

const noRecentRecharge: PaymentRechargeActivitySummary = {
  rechargeWindowHours: 24,
  rechargeWindowStartedAt: "2026-06-11T00:00:00.000Z",
  recentRechargeTransactions: 0,
  recentRechargeAmount: "0",
  latestRechargeAt: null,
  recentRechargeSamples: []
};

const recentRechargeActivity: PaymentRechargeActivitySummary = {
  ...noRecentRecharge,
  recentRechargeTransactions: 3,
  recentRechargeAmount: "42.500000",
  latestRechargeAt: "2026-06-11T10:00:00.000Z",
  recentRechargeSamples: [
    {
      id: "txn_1",
      walletId: "wallet_1",
      userId: "user_1",
      userEmail: "buyer@example.com",
      amount: "12.500000",
      balanceAfter: "20.000000",
      currency: "USD",
      refType: "mock_recharge",
      refId: "mock_1",
      createdAt: "2026-06-11T10:00:00.000Z"
    }
  ]
};

test("reports production mock recharge as blocked by default", () => {
  const result = inspectPaymentProviderHealth({
    provider: "mock",
    nodeEnv: "production",
    allowProductionMockRecharge: false,
    minRechargeAmount: 10,
    rechargeActivity: noRecentRecharge
  });

  assert.equal(result.status, "ok");
  assert.equal(result.summary, "生产 mock 充值已禁用");
  assert.equal(result.metrics.allowProductionMockRecharge, false);
  assert.equal(result.metrics.rechargeEndpointEnabled, false);
  assert.equal(result.metrics.productionMockRechargeBlocked, true);
  assert.equal(result.metrics.recentRechargeTransactions, 0);
  assert.equal(result.metrics.recentRechargeSamples, 0);
  assert.equal(result.issues.length, 0);
  assert.equal(result.samples.length, 0);
});

test("flags explicitly allowed production mock recharge without recent ledger impact", () => {
  const result = inspectPaymentProviderHealth({
    provider: "mock",
    nodeEnv: "production",
    allowProductionMockRecharge: true,
    minRechargeAmount: 10,
    rechargeActivity: noRecentRecharge
  });

  assert.equal(result.status, "warning");
  assert.equal(result.summary, "生产环境显式启用 mock 充值");
  assert.equal(result.metrics.allowProductionMockRecharge, true);
  assert.equal(result.metrics.rechargeEndpointEnabled, true);
  assert.equal(result.metrics.productionMockRechargeBlocked, false);
  assert.equal(result.metrics.recentRechargeTransactions, 0);
  assert.equal(result.metrics.recentRechargeSamples, 0);
  assert.equal(result.issues.length, 1);
  assert.equal(result.samples.length, 0);
  assert.equal(result.issues[0].type, "production_mock_recharge");
  assert.equal(result.issues[0].walletList, true);
  assert.equal(result.issues[0].walletTransactionList, true);
  assert.equal(result.issues[0].walletTransactionType, "recharge");
  assert.equal(result.issues[0].salesList, true);
  assert.match(result.issues[0].actionHint, /real payment provider/);
});

test("highlights recent explicitly allowed production mock recharge ledger impact", () => {
  const result = inspectPaymentProviderHealth({
    provider: "mock",
    nodeEnv: "production",
    allowProductionMockRecharge: true,
    minRechargeAmount: 10,
    rechargeActivity: recentRechargeActivity
  });

  assert.equal(result.status, "warning");
  assert.equal(result.metrics.rechargeEndpointEnabled, true);
  assert.equal(result.metrics.productionMockRechargeBlocked, false);
  assert.equal(result.metrics.recentRechargeTransactions, 3);
  assert.equal(result.metrics.recentRechargeAmount, "42.500000");
  assert.equal(result.metrics.recentRechargeSamples, 1);
  assert.equal(result.issues[0].type, "production_mock_recharge");
  assert.match(result.issues[0].message, /wrote 3 recharge transaction/);
  assert.match(result.issues[0].actionHint, /review recharge transactions/);
  assert.equal(result.samples.length, 1);
  assert.equal(result.samples[0].id, "payment_recharge:txn_1");
  assert.equal(result.samples[0].walletTransactionId, "txn_1");
  assert.equal(result.samples[0].walletTransactionList, true);
  assert.equal(result.samples[0].walletTransactionType, "recharge");
  assert.equal(result.samples[0].walletLookup, "wallet_1");
  assert.equal(result.samples[0].salesList, true);
  assert.match(result.samples[0].message, /buyer@example.com recharged 12.500000 USD/);
});

test("warns when blocked production mock recharge has recent ledger impact", () => {
  const result = inspectPaymentProviderHealth({
    provider: "mock",
    nodeEnv: "production",
    allowProductionMockRecharge: false,
    minRechargeAmount: 10,
    rechargeActivity: recentRechargeActivity
  });

  assert.equal(result.status, "warning");
  assert.equal(result.summary, "生产 mock 充值已禁用但存在近期充值流水");
  assert.equal(result.metrics.rechargeEndpointEnabled, false);
  assert.equal(result.metrics.productionMockRechargeBlocked, true);
  assert.equal(result.issues[0].type, "production_mock_recharge_recent_ledger");
  assert.match(result.issues[0].message, /3 recharge transaction/);
  assert.match(result.issues[0].actionHint, /now blocked by default/);
  assert.equal(result.samples.length, 1);
  assert.equal(result.samples[0].walletTransactionType, "recharge");
});

test("reports disabled recharge as unavailable", () => {
  const result = inspectPaymentProviderHealth({
    provider: "disabled",
    nodeEnv: "production",
    allowProductionMockRecharge: false,
    minRechargeAmount: 10,
    rechargeActivity: noRecentRecharge
  });

  assert.equal(result.status, "error");
  assert.equal(result.metrics.rechargeEndpointEnabled, false);
  assert.equal(result.metrics.productionMockRechargeBlocked, false);
  assert.equal(result.issues[0].type, "payment_provider_disabled");
  assert.equal(result.issues[0].salesList, true);
});
