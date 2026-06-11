import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSub2UpstreamIssues,
  sub2AccountHealthSamples
} from "../src/modules/admin/sub2-upstream-health.js";

test("sub2 upstream samples expose failed OpenAI account repair candidates", () => {
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
      errorMessage: "token invalidated"
    }
  ]);

  assert.equal(samples.length, 1);
  assert.equal(samples[0].sub2AccountId, 2);
  assert.equal(samples[0].sub2AccountName, "revoked");
  assert.equal(samples[0].accountStatus, "error");
  assert.equal(samples[0].schedulable, false);
  assert.equal(samples[0].message, "token invalidated");
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
        schedulable: false
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
