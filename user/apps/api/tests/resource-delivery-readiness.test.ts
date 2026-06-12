import assert from "node:assert/strict";
import test from "node:test";
import {
  codexDeliveryResourceMissingDetails,
  isDeliveryResourceReadinessRequired,
  readyCodexSupplierResourceDeliveryWhere,
  requireReadySupplierResourceForDelivery
} from "../src/modules/suppliers/resource-delivery-readiness.js";

test("Codex delivery requires a ready production supplier resource", () => {
  assert.equal(isDeliveryResourceReadinessRequired("codex"), true);
  assert.equal(isDeliveryResourceReadinessRequired("gemini"), false);
  assert.equal(isDeliveryResourceReadinessRequired("claude_code"), false);
});

test("builds the Codex delivery-ready resource filter", () => {
  assert.deepEqual(readyCodexSupplierResourceDeliveryWhere(), {
    resourceType: "codex",
    status: "online",
    sub2AccountId: { not: null },
    NOT: { sub2AccountId: "admin-disabled-smoke-resource" },
    credential: { is: { credentialType: "openai_refresh_token", status: "active" } }
  });
});

test("reports actionable missing Codex delivery details", () => {
  assert.deepEqual(codexDeliveryResourceMissingDetails("codex"), {
    resourceType: "codex",
    requiredStatus: "online",
    requiredCredentialType: "openai_refresh_token",
    requiredCredentialStatus: "active",
    excludedSub2AccountId: "admin-disabled-smoke-resource"
  });
});

test("non-Codex delivery skips supplier resource gating", async () => {
  await assert.doesNotReject(async () => {
    assert.deepEqual(await requireReadySupplierResourceForDelivery("gemini"), {
      required: false,
      resource: null
    });
  });
});
