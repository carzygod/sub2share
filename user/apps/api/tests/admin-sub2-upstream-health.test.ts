import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSub2UpstreamIssues,
  sub2AccountHealthSamples
} from "../src/modules/admin/sub2-upstream-health.js";

test("sub2 upstream samples expose failed OpenAI account repair candidates", () => {
  const authMessage = 'Authentication failed (401): {"error":{"message":"Your authentication token has been invalidated.","type":"invalid_request_error","code":"token_invalidated"},"status":401}';
  const samples = sub2AccountHealthSamples([
    {
      id: 1,
      name: "healthy",
      platform: "openai",
      type: "oauth",
      status: "active",
      credentialsStatus: "configured(3)",
      schedulable: true,
      groupIds: [2],
      groupNames: ["oai"],
      currentConcurrency: 0,
      concurrency: 1
    },
    {
      id: 2,
      name: "revoked",
      platform: "openai",
      type: "oauth",
      status: "error",
      credentialsStatus: "configured(3)",
      schedulable: false,
      groupIds: [2],
      groupNames: ["oai"],
      currentConcurrency: 0,
      concurrency: 1,
      tempUnschedulableReason: "token_invalidated",
      updatedAt: "2026-06-12T14:53:59.925Z",
      errorMessage: authMessage
    }
  ]);

  assert.equal(samples.length, 1);
  assert.equal(samples[0].sub2AccountId, 2);
  assert.equal(samples[0].sub2AccountName, "revoked");
  assert.equal(samples[0].accountStatus, "error");
  assert.equal(samples[0].schedulable, false);
  assert.equal(samples[0].tempUnschedulableReason, "token_invalidated");
  assert.equal(samples[0].updatedAt, "2026-06-12T14:53:59.925Z");
  assert.equal(samples[0].message, authMessage);
  assert.equal(samples[0].accountErrorStatusCode, 401);
  assert.equal(samples[0].accountErrorType, "invalid_request_error");
  assert.equal(samples[0].accountErrorCode, "token_invalidated");
  assert.equal(samples[0].accountErrorMessage, "Your authentication token has been invalidated.");
});

test("sub2 upstream samples prioritize configured auth failures for repair", () => {
  const samples = sub2AccountHealthSamples([
    {
      id: 9,
      name: "disabled",
      platform: "openai",
      type: "oauth",
      status: "disabled",
      credentialsStatus: null,
      schedulable: false,
      groupIds: [2],
      groupNames: ["oai"],
      updatedAt: "2026-06-12T15:10:00.000Z",
      tempUnschedulableReason: "manual_disable"
    },
    {
      id: 12,
      name: "old-revoked",
      platform: "openai",
      type: "oauth",
      status: "error",
      credentialsStatus: "configured(3)",
      schedulable: false,
      groupIds: [2],
      groupNames: ["oai"],
      updatedAt: "2026-06-12T14:50:00.000Z",
      tempUnschedulableReason: "token_invalidated",
      errorMessage: "token invalidated"
    },
    {
      id: 3,
      name: "new-revoked",
      platform: "openai",
      type: "oauth",
      status: "error",
      credentialsStatus: "configured(3)",
      schedulable: false,
      groupIds: [2],
      groupNames: ["oai"],
      updatedAt: "2026-06-12T15:00:00.000Z",
      tempUnschedulableReason: "token_invalidated"
    },
    {
      id: 4,
      name: "generic-error",
      platform: "openai",
      type: "oauth",
      status: "error",
      credentialsStatus: null,
      schedulable: false,
      groupIds: [2],
      groupNames: ["oai"],
      updatedAt: "2026-06-12T15:20:00.000Z",
      errorMessage: "overloaded"
    }
  ]);

  assert.deepEqual(
    samples.map((sample) => sample.sub2AccountId),
    [3, 12, 4, 9]
  );

  const issues = buildSub2UpstreamIssues({
    gatewayReachable: true,
    blockingReasons: ["openai_group_has_no_active_accounts"],
    defaultGroupId: 2,
    openAiGroupName: "oai",
    openAiGroupStatus: "active",
    accountCount: 4,
    openAiAccountCount: 4,
    activeOpenAiAccountCount: 0,
    accountSamples: samples
  });

  assert.equal(issues[0].sub2AccountId, 3);
  assert.equal(issues[0].sub2AccountName, "new-revoked");
  assert.equal(issues[0].tempUnschedulableReason, "token_invalidated");
  assert.equal(issues[0].accountErrorCode, "token_invalidated");
  assert.equal(issues[0].repairAction, "apply_openai_refresh_token_to_sub2_account");
});

test("sub2 upstream samples normalize blank optional diagnostics", () => {
  const samples = sub2AccountHealthSamples([
    {
      id: 7,
      name: "blank-diagnostics",
      platform: "openai",
      type: "oauth",
      status: "error",
      credentialsStatus: " ",
      schedulable: false,
      groupIds: [2],
      groupNames: ["oai"],
      rateLimitedAt: " ",
      overloadUntil: " ",
      tempUnschedulableUntil: " ",
      tempUnschedulableReason: " ",
      updatedAt: " ",
      errorMessage: " "
    }
  ]);

  assert.equal(samples.length, 1);
  assert.equal(samples[0].credentialsStatus, null);
  assert.equal(samples[0].rateLimitedAt, null);
  assert.equal(samples[0].overloadUntil, null);
  assert.equal(samples[0].tempUnschedulableUntil, null);
  assert.equal(samples[0].tempUnschedulableReason, null);
  assert.equal(samples[0].updatedAt, null);
  assert.equal(samples[0].message, "Sub2 OpenAI account blank-diagnostics #7 is error and not schedulable.");
});

test("sub2 upstream issues point no-active-account repairs to the first account candidate", () => {
  const issues = buildSub2UpstreamIssues({
    gatewayReachable: true,
    blockingReasons: ["openai_group_has_no_active_accounts"],
    defaultGroupId: 2,
    openAiGroupName: "oai",
    openAiGroupStatus: "active",
    accountCount: 2,
    openAiAccountCount: 2,
    activeOpenAiAccountCount: 0,
    accountSamples: [
      {
        id: "sub2_account:2",
        sub2AccountId: 2,
        sub2AccountName: "revoked",
        accountStatus: "error",
        credentialsStatus: "configured(3)",
        schedulable: false,
        tempUnschedulableReason: "token_invalidated",
        message: "token invalidated",
        updatedAt: "2026-06-12T14:53:59.925Z"
      }
    ]
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0].sub2Status, true);
  assert.equal(issues[0].sub2AccountId, 2);
  assert.equal(issues[0].sub2AccountName, "revoked");
  assert.equal(issues[0].accountStatus, "error");
  assert.equal(issues[0].credentialsStatus, "configured(3)");
  assert.equal(issues[0].schedulable, false);
  assert.equal(issues[0].tempUnschedulableReason, "token_invalidated");
  assert.equal(issues[0].accountMessage, "token invalidated");
  assert.equal(issues[0].accountErrorCode, "token_invalidated");
  assert.equal(issues[0].updatedAt, "2026-06-12T14:53:59.925Z");
  assert.equal(issues[0].repairAction, "apply_openai_refresh_token_to_sub2_account");
  assert.equal(issues[0].message, "oai #2 has 2 OpenAI account(s), but 0 active account(s).");
});

test("sub2 upstream issues still open status when no account candidate exists", () => {
  const issues = buildSub2UpstreamIssues({
    gatewayReachable: false,
    blockingReasons: ["sub2_status_query_failed"],
    defaultGroupId: null,
    accountCount: 0,
    openAiAccountCount: 0,
    activeOpenAiAccountCount: 0,
    accountSamples: [],
    error: "connection refused"
  });

  assert.equal(issues[0].sub2Status, true);
  assert.equal(issues[0].sub2AccountId, undefined);
  assert.equal(issues[0].message, "Sub2API status query failed: connection refused.");
});
