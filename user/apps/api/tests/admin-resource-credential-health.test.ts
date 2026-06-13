import assert from "node:assert/strict";
import test from "node:test";
import {
  resourceCredentialCodexResourceListFields,
  resourceCredentialRepairCandidateFields,
  resourceCredentialSub2AccountRepairSamples
} from "../src/modules/admin/resource-credential-health.js";

test("resource credential health points missing credential repairs to Codex resources", () => {
  assert.deepEqual(resourceCredentialCodexResourceListFields(), {
    resourceList: true,
    resourceScope: "production",
    resourceType: "codex",
    resourceStatus: null
  });
});

test("resource credential health exposes the first Sub2 account repair candidate", () => {
  const fields = resourceCredentialRepairCandidateFields([
    {
      id: "sub2_account:2",
      sub2AccountId: 2,
      sub2AccountName: "main",
      accountStatus: "error",
      credentialsStatus: "configured(3)",
      schedulable: false,
      tempUnschedulableReason: "token_invalidated",
      message: "token invalidated",
      updatedAt: "2026-06-12T14:53:59.925Z"
    }
  ]);

  assert.deepEqual(fields, {
    sub2AccountId: 2,
    sub2AccountName: "main",
    accountStatus: "error",
    credentialsStatus: "configured(3)",
    schedulable: false,
    tempUnschedulableReason: "token_invalidated",
    accountMessage: "token invalidated",
    updatedAt: "2026-06-12T14:53:59.925Z",
    repairAction: "apply_openai_refresh_token_to_sub2_account"
  });
});

test("resource credential health normalizes blank repair candidate diagnostics", () => {
  const fields = resourceCredentialRepairCandidateFields([
    {
      id: "sub2_account:2",
      sub2AccountId: 2,
      sub2AccountName: " ",
      accountStatus: " error ",
      credentialsStatus: " ",
      schedulable: false,
      tempUnschedulableReason: " ",
      message: " ",
      updatedAt: " "
    }
  ]);

  assert.deepEqual(fields, {
    sub2AccountId: 2,
    sub2AccountName: null,
    accountStatus: "error",
    credentialsStatus: null,
    schedulable: false,
    tempUnschedulableReason: null,
    accountMessage: null,
    updatedAt: null,
    repairAction: "apply_openai_refresh_token_to_sub2_account"
  });
});

test("resource credential health omits account fields when no candidate is available", () => {
  assert.deepEqual(resourceCredentialRepairCandidateFields([]), {});
  assert.deepEqual(resourceCredentialRepairCandidateFields([{ id: "missing" }]), {});
});

test("resource credential health turns Sub2 accounts into repair samples", () => {
  const samples = resourceCredentialSub2AccountRepairSamples([
    {
      id: "sub2_account:2",
      sub2AccountId: 2,
      sub2AccountName: "main",
      accountStatus: "error",
      credentialsStatus: "configured(3)",
      schedulable: false,
      message: "token invalidated"
    },
    { id: "skip" }
  ]);

  assert.equal(samples.length, 1);
  assert.equal(samples[0].sampleType, "sub2_account_repair_candidate");
  assert.equal(samples[0].sub2Status, true);
  assert.equal(samples[0].repairAction, "apply_openai_refresh_token_to_sub2_account");
  assert.equal(samples[0].sub2AccountId, 2);
  assert.equal(samples[0].message, "token invalidated");
});

test("resource credential health normalizes blank repair samples", () => {
  const samples = resourceCredentialSub2AccountRepairSamples([
    {
      id: "sub2_account:2",
      sub2AccountId: 2,
      sub2AccountName: " ",
      accountStatus: " ",
      credentialsStatus: " ",
      tempUnschedulableReason: " ",
      groupIds: " ",
      groupNames: " ",
      message: " ",
      updatedAt: " "
    }
  ]);

  assert.equal(samples.length, 1);
  assert.equal(samples[0].sub2AccountName, null);
  assert.equal(samples[0].accountStatus, null);
  assert.equal(samples[0].credentialsStatus, null);
  assert.equal(samples[0].tempUnschedulableReason, null);
  assert.equal(samples[0].groupIds, null);
  assert.equal(samples[0].groupNames, null);
  assert.equal(samples[0].message, null);
  assert.equal(samples[0].updatedAt, null);
});
