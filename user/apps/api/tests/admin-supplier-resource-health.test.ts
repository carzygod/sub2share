import assert from "node:assert/strict";
import test from "node:test";
import {
  internalHealthCheckSupplierResourceWhere,
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
    ignoredInternalResources: 1,
    issueCount: 1,
    resourceSampleCount: 0
  }), {
    disabled: 1,
    totalCodexResources: 0,
    onlineCodexResources: 0,
    ignoredInternalResources: 1,
    issueSamples: 1,
    resourceSamples: 0
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
