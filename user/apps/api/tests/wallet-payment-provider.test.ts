import assert from "node:assert/strict";
import test from "node:test";
import {
  isProductionMockRechargeBlocked,
  isRechargeEndpointEnabled
} from "../src/modules/wallet/payment-provider.js";

test("mock recharge is enabled outside production", () => {
  const policy = { provider: "mock" as const, nodeEnv: "development", allowProductionMockRecharge: false };

  assert.equal(isRechargeEndpointEnabled(policy), true);
  assert.equal(isProductionMockRechargeBlocked(policy), false);
});

test("mock recharge is blocked by default in production", () => {
  const policy = { provider: "mock" as const, nodeEnv: "production", allowProductionMockRecharge: false };

  assert.equal(isRechargeEndpointEnabled(policy), false);
  assert.equal(isProductionMockRechargeBlocked(policy), true);
});

test("mock recharge can be explicitly enabled in production", () => {
  const policy = { provider: "mock" as const, nodeEnv: "production", allowProductionMockRecharge: true };

  assert.equal(isRechargeEndpointEnabled(policy), true);
  assert.equal(isProductionMockRechargeBlocked(policy), false);
});

test("disabled payment provider always disables recharge", () => {
  const policy = { provider: "disabled" as const, nodeEnv: "production", allowProductionMockRecharge: true };

  assert.equal(isRechargeEndpointEnabled(policy), false);
  assert.equal(isProductionMockRechargeBlocked(policy), false);
});
