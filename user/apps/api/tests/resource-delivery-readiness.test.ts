import assert from "node:assert/strict";
import test from "node:test";
import {
  codexDeliveryLocalProxySmokeFreshMs,
  codexDeliveryResourceMissingDetails,
  codexCatalogDeliveryReadinessIssueFields,
  inspectCodexProxySmokeDeliveryReadiness,
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

test("catalog delivery readiness reports ready Codex resources blocked by proxy smoke", () => {
  const readiness = inspectCodexProxySmokeDeliveryReadiness({
    resourceType: "codex",
    checkedAt: new Date("2026-06-13T12:10:00.000Z"),
    latest: localProxySmokeEvidence({
      createdAt: new Date("2026-06-13T12:00:00.000Z"),
      ok: false,
      responsesOk: false,
      responsesStatusCode: 503,
      responsesErrorType: "api_error",
      responsesErrorMessage: "Service temporarily unavailable"
    })
  });

  assert.deepEqual(codexCatalogDeliveryReadinessIssueFields({
    productId: "product-1",
    productName: "Codex Monthly",
    priceId: "price-monthly",
    resourceType: "codex",
    readyCodexDeliveryResources: 1,
    codexProxySmokeDeliveryReadiness: readiness
  }), {
    type: "active_codex_product_proxy_smoke_failed",
    productId: "product-1",
    productName: "Codex Monthly",
    priceId: "price-monthly",
    resourceType: "codex",
    resourceList: true,
    resourceScope: "production",
    resourceStatus: "online",
    repairAction: "apply_openai_refresh_token_to_sub2_account",
    actionHint: "Repair the failing Sub2/OpenAI account or Codex shared resource, then rerun the local proxy smoke test before selling Codex access.",
    message: "Active Codex product Codex Monthly is purchasable but the latest local OpenAI/Codex proxy smoke test is failing.",
    auditLogId: "audit-smoke",
    auditAction: "admin.sub2.proxy_smoke_test",
    resourceId: null,
    sub2AccountId: "2",
    model: "gpt-5.3-codex",
    modelsOk: true,
    modelsStatusCode: 200,
    modelsError: null,
    responsesOk: false,
    responsesStatusCode: 503,
    responsesErrorType: "api_error",
    responsesErrorMessage: "Service temporarily unavailable",
    localProxyOk: true,
    smokeTestSkippedReason: null,
    proxyRequestLogId: "proxy-log",
    requestId: "req-smoke",
    upstreamRequestId: "upstream-smoke",
    proxyRequestPath: "/v1/responses",
    proxyRequestStatusCode: 200,
    proxyRequestErrorCode: null,
    ageMinutes: 10,
    stale: false,
    staleThresholdMinutes: 1440,
    freshMinutesRemaining: 1430,
    staleAt: "2026-06-14T12:00:00.000Z"
  });
});

test("public product delivery readiness blocks unavailable Codex products", () => {
  assert.deepEqual(publicProductDeliveryReadinessFields({
    resourceType: "codex",
    readyCodexDeliveryResources: 0
  }), {
    deliveryRequired: true,
    deliveryReady: false,
    readyDeliveryResources: 0,
    deliveryBlockedReason: "codex_resource_not_ready_for_delivery",
    codexProxySmokeDeliveryReady: true,
    codexProxySmokeDeliveryLatest: null
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
    deliveryBlockedReason: null,
    codexProxySmokeDeliveryReady: true,
    codexProxySmokeDeliveryLatest: null
  });
  assert.deepEqual(publicProductDeliveryReadinessFields({
    resourceType: "gemini",
    readyCodexDeliveryResources: 0
  }), {
    deliveryRequired: false,
    deliveryReady: true,
    readyDeliveryResources: null,
    deliveryBlockedReason: null,
    codexProxySmokeDeliveryReady: null,
    codexProxySmokeDeliveryLatest: null
  });
});

test("public product delivery readiness reports fresh Codex proxy smoke failures", () => {
  const readiness = inspectCodexProxySmokeDeliveryReadiness({
    resourceType: "codex",
    checkedAt: new Date("2026-06-13T12:10:00.000Z"),
    latest: localProxySmokeEvidence({
      createdAt: new Date("2026-06-13T12:00:00.000Z"),
      ok: false,
      responsesOk: false,
      responsesStatusCode: 503,
      responsesErrorType: "api_error",
      responsesErrorMessage: "Service temporarily unavailable",
      proxyRequestPath: "/v1/responses",
      proxyRequestStatusCode: 503
    })
  });

  assert.equal(readiness.ok, false);
  assert.equal(readiness.reason, "codex_proxy_smoke_failed_for_delivery");
  assert.equal(readiness.latest?.ageMinutes, 10);
  assert.equal(readiness.latest?.responsesStatusCode, 503);
  assert.deepEqual(publicProductDeliveryReadinessFields({
    resourceType: "codex",
    readyCodexDeliveryResources: 1,
    codexProxySmokeDeliveryReadiness: readiness
  }), {
    deliveryRequired: true,
    deliveryReady: false,
    readyDeliveryResources: 1,
    deliveryBlockedReason: "codex_proxy_smoke_failed_for_delivery",
    codexProxySmokeDeliveryReady: false,
    codexProxySmokeDeliveryLatest: readiness.latest
  });
});

test("public product delivery readiness prioritizes missing resources before proxy smoke failures", () => {
  const readiness = inspectCodexProxySmokeDeliveryReadiness({
    resourceType: "codex",
    checkedAt: new Date("2026-06-13T12:10:00.000Z"),
    latest: localProxySmokeEvidence({
      createdAt: new Date("2026-06-13T12:00:00.000Z"),
      ok: false,
      responsesOk: false
    })
  });

  const fields = publicProductDeliveryReadinessFields({
    resourceType: "codex",
    readyCodexDeliveryResources: 0,
    codexProxySmokeDeliveryReadiness: readiness
  });

  assert.equal(fields.deliveryReady, false);
  assert.equal(fields.deliveryBlockedReason, "codex_resource_not_ready_for_delivery");
  assert.equal(fields.codexProxySmokeDeliveryReady, false);
});

test("Codex proxy smoke delivery gate ignores stale and skipped failures", () => {
  const checkedAt = new Date("2026-06-13T12:00:00.000Z");
  const stale = inspectCodexProxySmokeDeliveryReadiness({
    resourceType: "codex",
    checkedAt,
    latest: localProxySmokeEvidence({
      createdAt: new Date(checkedAt.getTime() - codexDeliveryLocalProxySmokeFreshMs - 60_000),
      ok: false,
      responsesOk: false
    })
  });
  const skipped = inspectCodexProxySmokeDeliveryReadiness({
    resourceType: "codex",
    checkedAt,
    latest: localProxySmokeEvidence({
      createdAt: checkedAt,
      ok: false,
      smokeTestSkippedReason: "credential_apply_failed"
    })
  });
  const nonCodex = inspectCodexProxySmokeDeliveryReadiness({
    resourceType: "gemini",
    checkedAt,
    latest: localProxySmokeEvidence({
      createdAt: checkedAt,
      ok: false,
      responsesOk: false
    })
  });

  assert.equal(stale.ok, true);
  assert.equal(stale.latest?.stale, true);
  assert.equal(skipped.ok, true);
  assert.equal(nonCodex.required, false);
  assert.equal(nonCodex.ok, true);
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

function localProxySmokeEvidence(overrides: Partial<ReturnType<typeof baseLocalProxySmokeEvidence>>) {
  return {
    ...baseLocalProxySmokeEvidence(),
    ...overrides
  };
}

function baseLocalProxySmokeEvidence() {
  return {
    auditLogId: "audit-smoke",
    action: "admin.sub2.proxy_smoke_test",
    objectId: "sub2-key",
    resourceId: null,
    sub2AccountId: "2",
    createdAt: new Date("2026-06-13T12:00:00.000Z"),
    ok: true,
    model: "gpt-5.3-codex",
    modelsOk: true,
    modelsStatusCode: 200,
    modelsError: null,
    responsesOk: true,
    responsesStatusCode: 200,
    responsesErrorType: null,
    responsesErrorMessage: null,
    localProxyOk: true,
    keyDisabled: true,
    smokeTestSkippedReason: null,
    proxyRequestLogCount: 2,
    proxyRequestLogs: [],
    proxyRequestLogId: "proxy-log",
    requestId: "req-smoke",
    upstreamRequestId: "upstream-smoke",
    proxyRequestPath: "/v1/responses",
    proxyRequestStatusCode: 200,
    proxyRequestErrorCode: null
  };
}
