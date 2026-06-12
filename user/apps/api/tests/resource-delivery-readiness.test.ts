import assert from "node:assert/strict";
import test from "node:test";
import {
  codexDeliveryResourceMissingDetails,
  codexCatalogDeliveryReadinessIssueFields,
  isDeliveryResourceReadinessRequired,
  publicProductDeliveryReadinessFields,
  readyCodexSupplierResourceDeliveryWhere,
  requireReadySupplierResourceForDelivery,
  shouldBlockUnavailableCodexPriceActivation,
  shouldBlockUnavailableCodexProductActivation
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

test("reports purchasable Codex catalog products without delivery resources", () => {
  assert.deepEqual(codexCatalogDeliveryReadinessIssueFields({
    productId: "product-1",
    productName: "Codex Monthly",
    priceId: "price-monthly",
    resourceType: "codex",
    readyCodexDeliveryResources: 0
  }), {
    type: "active_codex_product_without_ready_delivery_resource",
    productId: "product-1",
    productName: "Codex Monthly",
    priceId: "price-monthly",
    resourceType: "codex",
    resourceList: true,
    resourceScope: "production",
    resourceStatus: "online",
    repairAction: "apply_openai_refresh_token_to_sub2_account",
    actionHint: "Create or repair a production Codex shared resource with a Sub2 account id and an active OpenAI refresh token credential before selling Codex access.",
    message: "Active Codex product Codex Monthly is purchasable but no ready production Codex shared resource is available for delivery."
  });
});

test("catalog delivery readiness ignores ready Codex resources and non-Codex products", () => {
  assert.equal(codexCatalogDeliveryReadinessIssueFields({
    productId: "product-1",
    productName: "Codex Monthly",
    resourceType: "codex",
    readyCodexDeliveryResources: 1
  }), null);
  assert.equal(codexCatalogDeliveryReadinessIssueFields({
    productId: "product-2",
    productName: "Gemini Monthly",
    resourceType: "gemini",
    readyCodexDeliveryResources: 0
  }), null);
});

test("public product delivery readiness blocks unavailable Codex products", () => {
  assert.deepEqual(publicProductDeliveryReadinessFields({
    resourceType: "codex",
    readyCodexDeliveryResources: 0
  }), {
    deliveryRequired: true,
    deliveryReady: false,
    readyDeliveryResources: 0,
    deliveryBlockedReason: "codex_resource_not_ready_for_delivery"
  });
});

test("public product delivery readiness allows ready Codex and non-Codex products", () => {
  assert.deepEqual(publicProductDeliveryReadinessFields({
    resourceType: "codex",
    readyCodexDeliveryResources: 1
  }), {
    deliveryRequired: true,
    deliveryReady: true,
    readyDeliveryResources: 1,
    deliveryBlockedReason: null
  });
  assert.deepEqual(publicProductDeliveryReadinessFields({
    resourceType: "gemini",
    readyCodexDeliveryResources: 0
  }), {
    deliveryRequired: false,
    deliveryReady: true,
    readyDeliveryResources: null,
    deliveryBlockedReason: null
  });
});

test("blocks Codex product activation without ready delivery resources unless explicitly overridden", () => {
  assert.equal(shouldBlockUnavailableCodexProductActivation({
    resourceType: "codex",
    productStatus: "active",
    readyCodexDeliveryResources: 0
  }), true);
  assert.equal(shouldBlockUnavailableCodexProductActivation({
    resourceType: "codex",
    productStatus: "active",
    readyCodexDeliveryResources: 0,
    allowUnavailableDelivery: true
  }), false);
  assert.equal(shouldBlockUnavailableCodexProductActivation({
    resourceType: "codex",
    productStatus: "offline",
    readyCodexDeliveryResources: 0
  }), false);
  assert.equal(shouldBlockUnavailableCodexProductActivation({
    resourceType: "gemini",
    productStatus: "active",
    readyCodexDeliveryResources: 0
  }), false);
  assert.equal(shouldBlockUnavailableCodexProductActivation({
    resourceType: "codex",
    productStatus: "active",
    readyCodexDeliveryResources: 1
  }), false);
});

test("blocks active purchasable Codex prices on active products without ready delivery resources", () => {
  assert.equal(shouldBlockUnavailableCodexPriceActivation({
    resourceType: "codex",
    productStatus: "active",
    priceStatus: "active",
    billingMode: "monthly",
    fixedPrice: "20",
    readyCodexDeliveryResources: 0
  }), true);
  assert.equal(shouldBlockUnavailableCodexPriceActivation({
    resourceType: "codex",
    productStatus: "active",
    priceStatus: "active",
    billingMode: "monthly",
    fixedPrice: "20",
    readyCodexDeliveryResources: 0,
    allowUnavailableDelivery: true
  }), false);
  assert.equal(shouldBlockUnavailableCodexPriceActivation({
    resourceType: "codex",
    productStatus: "active",
    priceStatus: "offline",
    billingMode: "monthly",
    fixedPrice: "20",
    readyCodexDeliveryResources: 0
  }), false);
  assert.equal(shouldBlockUnavailableCodexPriceActivation({
    resourceType: "codex",
    productStatus: "offline",
    priceStatus: "active",
    billingMode: "monthly",
    fixedPrice: "20",
    readyCodexDeliveryResources: 0
  }), false);
  assert.equal(shouldBlockUnavailableCodexPriceActivation({
    resourceType: "codex",
    productStatus: "active",
    priceStatus: "active",
    billingMode: "monthly",
    fixedPrice: null,
    readyCodexDeliveryResources: 0
  }), false);
  assert.equal(shouldBlockUnavailableCodexPriceActivation({
    resourceType: "codex",
    productStatus: "active",
    priceStatus: "active",
    billingMode: "pay_as_you_go",
    fixedPrice: null,
    readyCodexDeliveryResources: 0
  }), true);
});
