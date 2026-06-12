import assert from "node:assert/strict";
import test from "node:test";
import {
  internalHealthCheckSupplierResourceWhere,
  inspectSupplierResourceManualOnlineReadiness,
  inspectSupplierResourceReadinessMutationStatusTransition,
  inspectSupplierResourceTestStatusTransition,
  isInternalHealthCheckSupplierResource,
  nonSmokeSupplierResourceWhere,
  supplierResourceAvailabilityMetrics,
  supplierResourceMissingCodexIssueFields
} from "../src/modules/admin/supplier-resource-health.js";

test("identifies only explicit internal supplier resources", () => {
  assert.equal(isInternalHealthCheckSupplierResource({ sub2AccountId: "admin-disabled-smoke-resource" }), true);
  assert.equal(isInternalHealthCheckSupplierResource({ sub2AccountId: "2" }), false);
  assert.equal(isInternalHealthCheckSupplierResource({ sub2AccountId: null }), false);
});

test("builds a production supplier resource filter that excludes internal health checks", () => {
  assert.deepEqual(internalHealthCheckSupplierResourceWhere(), {
    sub2AccountId: "admin-disabled-smoke-resource"
  });
  assert.deepEqual(nonSmokeSupplierResourceWhere(), {
    NOT: { sub2AccountId: "admin-disabled-smoke-resource" }
  });
});

test("separates resource health issues from concrete resource samples", () => {
  assert.deepEqual(supplierResourceAvailabilityMetrics({
    resourcesByStatus: { disabled: 1 },
    totalCodexResources: 0,
    onlineCodexResources: 0,
    readyOnlineCodexResources: 0,
    incompleteOnlineCodexResources: 0,
    ignoredInternalResources: 1,
    issueCount: 1,
    resourceSampleCount: 0
  }), {
    disabled: 1,
    totalCodexResources: 0,
    onlineCodexResources: 0,
    readyOnlineCodexResources: 0,
    incompleteOnlineCodexResources: 0,
    ignoredInternalResources: 1,
    issueSamples: 1,
    resourceSamples: 0
  });
});

test("reports ready and incomplete online Codex resource metrics", () => {
  assert.deepEqual(supplierResourceAvailabilityMetrics({
    resourcesByStatus: { online: 3 },
    totalCodexResources: 4,
    onlineCodexResources: 3,
    readyOnlineCodexResources: 1,
    incompleteOnlineCodexResources: 2,
    ignoredInternalResources: 0,
    issueCount: 1,
    resourceSampleCount: 2
  }), {
    online: 3,
    totalCodexResources: 4,
    onlineCodexResources: 3,
    readyOnlineCodexResources: 1,
    incompleteOnlineCodexResources: 2,
    ignoredInternalResources: 0,
    issueSamples: 1,
    resourceSamples: 2
  });
});

test("prefills missing Codex resource issues from Sub2 repair candidates", () => {
  assert.deepEqual(supplierResourceMissingCodexIssueFields({
    supplierEmail: "ops@example.com",
    sub2AccountCandidates: [
      {
        id: "sub2_account:2",
        sub2AccountId: 2,
        sub2AccountName: "main",
        accountStatus: "error",
        credentialsStatus: "configured(3)",
        schedulable: false
      }
    ]
  }), {
    resourceList: true,
    resourceScope: "production",
    resourceStatus: null,
    resourceType: "codex",
    supplierEmail: "ops@example.com",
    sub2AccountId: 2,
    sub2AccountName: "main",
    accountStatus: "error",
    credentialsStatus: "configured(3)",
    schedulable: false,
    repairAction: "apply_openai_refresh_token_to_sub2_account"
  });
});

test("keeps an existing resource Sub2 binding over repair candidates", () => {
  assert.deepEqual(supplierResourceMissingCodexIssueFields({
    resourceType: "codex",
    resourceStatus: "disabled",
    sub2AccountId: "17",
    sub2AccountCandidates: [
      {
        id: "sub2_account:2",
        sub2AccountId: 2,
        sub2AccountName: "main",
        accountStatus: "error",
        credentialsStatus: "configured(3)",
        schedulable: false
      }
    ]
  }), {
    resourceList: true,
    resourceScope: "production",
    resourceStatus: "disabled",
    resourceType: "codex",
    sub2AccountId: "17"
  });
});

test("blocks manual online status for Codex resources without Sub2 binding and active OpenAI credential", () => {
  const result = inspectSupplierResourceManualOnlineReadiness({
    resourceType: "codex",
    targetStatus: "online",
    sub2AccountId: null,
    credential: null
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "codex_resource_not_ready_for_online");
  assert.deepEqual(result.issues, ["sub2_account_missing", "active_openai_refresh_token_missing"]);
});

test("allows manual online status for Codex resources with Sub2 binding and active OpenAI refresh token", () => {
  const result = inspectSupplierResourceManualOnlineReadiness({
    resourceType: "codex",
    targetStatus: "online",
    sub2AccountId: "2",
    credential: { credentialType: "openai_refresh_token", status: "active" }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("manual online readiness does not block non-Codex resources or non-online status changes", () => {
  assert.equal(inspectSupplierResourceManualOnlineReadiness({
    resourceType: "gemini",
    targetStatus: "online"
  }).ok, true);
  assert.equal(inspectSupplierResourceManualOnlineReadiness({
    resourceType: "codex",
    targetStatus: "paused"
  }).ok, true);
});

test("resource tests do not auto-online incomplete Codex resources", () => {
  const result = inspectSupplierResourceTestStatusTransition({
    currentStatus: "testing",
    ok: true,
    resourceType: "codex",
    sub2AccountId: "2",
    credential: null
  });

  assert.equal(result.targetStatus, "online");
  assert.equal(result.status, "testing");
  assert.equal(result.blockedOnline, true);
  assert.deepEqual(result.onlineReadiness.issues, ["active_openai_refresh_token_missing"]);
});

test("resource tests auto-online ready Codex resources", () => {
  const result = inspectSupplierResourceTestStatusTransition({
    currentStatus: "testing",
    ok: true,
    resourceType: "codex",
    sub2AccountId: "2",
    credential: { credentialType: "openai_refresh_token", status: "active" }
  });

  assert.equal(result.targetStatus, "online");
  assert.equal(result.status, "online");
  assert.equal(result.blockedOnline, false);
  assert.deepEqual(result.onlineReadiness.issues, []);
});

test("resource tests still move failing active resources to abnormal", () => {
  const result = inspectSupplierResourceTestStatusTransition({
    currentStatus: "online",
    ok: false,
    resourceType: "codex",
    sub2AccountId: "2",
    credential: { credentialType: "openai_refresh_token", status: "active" }
  });

  assert.equal(result.targetStatus, "abnormal");
  assert.equal(result.status, "abnormal");
  assert.equal(result.blockedOnline, false);
});

test("credential mutations demote online Codex resources when readiness is lost", () => {
  const result = inspectSupplierResourceReadinessMutationStatusTransition({
    currentStatus: "online",
    resourceType: "codex",
    sub2AccountId: "2",
    credential: { credentialType: "openai_refresh_token", status: "disabled" }
  });

  assert.equal(result.status, "abnormal");
  assert.equal(result.changed, true);
  assert.equal(result.reason, "codex_resource_not_ready_after_readiness_change");
  assert.deepEqual(result.onlineReadiness.issues, ["active_openai_refresh_token_missing"]);
});

test("credential deletion demotes busy Codex resources", () => {
  const result = inspectSupplierResourceReadinessMutationStatusTransition({
    currentStatus: "busy",
    resourceType: "codex",
    sub2AccountId: "2",
    credential: null
  });

  assert.equal(result.status, "abnormal");
  assert.equal(result.changed, true);
  assert.deepEqual(result.onlineReadiness.issues, ["active_openai_refresh_token_missing"]);
});

test("credential mutations keep ready Codex and non-Codex resources unchanged", () => {
  assert.deepEqual(inspectSupplierResourceReadinessMutationStatusTransition({
    currentStatus: "online",
    resourceType: "codex",
    sub2AccountId: "2",
    credential: { credentialType: "openai_refresh_token", status: "active" }
  }), {
    status: "online",
    changed: false,
    reason: null,
    onlineReadiness: {
      ok: true,
      issues: [],
      code: "codex_resource_not_ready_for_online",
      message: "Codex resource is ready to switch online"
    }
  });

  assert.equal(inspectSupplierResourceReadinessMutationStatusTransition({
    currentStatus: "online",
    resourceType: "gemini",
    credential: null
  }).status, "online");
});

test("readiness mutations demote online Codex resources when Sub2 binding is removed", () => {
  const result = inspectSupplierResourceReadinessMutationStatusTransition({
    currentStatus: "online",
    resourceType: "codex",
    sub2AccountId: null,
    credential: { credentialType: "openai_refresh_token", status: "active" }
  });

  assert.equal(result.status, "abnormal");
  assert.equal(result.changed, true);
  assert.deepEqual(result.onlineReadiness.issues, ["sub2_account_missing"]);
});

test("online creation readiness rejects Codex resources without initial active credential", () => {
  const result = inspectSupplierResourceManualOnlineReadiness({
    resourceType: "codex",
    targetStatus: "online",
    sub2AccountId: "2",
    credential: null
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "codex_resource_not_ready_for_online");
  assert.deepEqual(result.issues, ["active_openai_refresh_token_missing"]);
});
