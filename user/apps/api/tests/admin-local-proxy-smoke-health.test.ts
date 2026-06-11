import assert from "node:assert/strict";
import test from "node:test";
import {
  attachLocalProxySmokeIssueRepairCandidate,
  latestLocalProxySmokeEvidence,
  localProxySmokeEvidenceCandidates,
  localProxySmokeEvidenceIssue,
  localProxySmokeFailureSummary,
  normalizeLocalProxySmokeAuditLog
} from "../src/modules/admin/local-proxy-smoke-health.js";

test("normalizes direct local proxy smoke audit evidence", () => {
  const evidence = normalizeLocalProxySmokeAuditLog({
    id: "audit-1",
    action: "admin.sub2.proxy_smoke_test",
    objectId: "sub2-key-1",
    createdAt: new Date("2026-06-11T01:00:00.000Z"),
    after: {
      ok: true,
      model: "gpt-5.3-codex",
      keyDisabled: true,
      models: { ok: true, statusCode: 200 },
      responses: { ok: true, statusCode: 200 },
      localProxy: {
        ok: true,
        proxyRequestLogCount: 2,
        proxyRequestLogs: [
          { id: "proxy-2", requestId: "req-responses", path: "/v1/responses", statusCode: 200 },
          { id: "proxy-1", requestId: "req-models", path: "/v1/models", statusCode: 200 }
        ]
      }
    }
  });

  assert.ok(evidence);
  assert.equal(evidence.auditLogId, "audit-1");
  assert.equal(evidence.resourceId, null);
  assert.equal(evidence.sub2AccountId, null);
  assert.equal(evidence.ok, true);
  assert.equal(evidence.model, "gpt-5.3-codex");
  assert.equal(evidence.modelsOk, true);
  assert.equal(evidence.responsesOk, true);
  assert.equal(evidence.localProxyOk, true);
  assert.equal(evidence.keyDisabled, true);
  assert.equal(evidence.proxyRequestLogCount, 2);
  assert.equal(evidence.proxyRequestLogs.length, 2);
  assert.equal(evidence.proxyRequestLogId, "proxy-2");
  assert.equal(evidence.requestId, "req-responses");
  assert.equal(evidence.proxyRequestPath, "/v1/responses");
  assert.equal(evidence.proxyRequestStatusCode, 200);
  assert.equal(evidence.smokeTestSkippedReason, null);
});

test("normalizes direct refresh token apply smoke evidence", () => {
  const evidence = normalizeLocalProxySmokeAuditLog({
    id: "audit-direct-apply",
    action: "admin.sub2.account.apply_openai_refresh_token",
    objectId: "2",
    createdAt: new Date("2026-06-11T02:30:00.000Z"),
    after: {
      ok: true,
      accountId: 2,
      smokeTestRequested: true,
      resourceCredentialSync: {
        saved: true,
        resourceId: "resource-from-direct-apply",
        sub2AccountId: "2"
      },
      smokeTest: {
        ok: false,
        model: "gpt-5.3-codex",
        keyDisabled: true,
        models: { ok: true, statusCode: 200 },
        responses: { ok: false, statusCode: 401, errorType: "invalid_auth" },
        localProxy: {
          ok: false,
          proxyRequestLogCount: 1,
          proxyRequestLogs: [
            { id: "direct-apply-proxy", requestId: "direct-apply-req", path: "/v1/responses", statusCode: 401, errorCode: "upstream_http_401" }
          ]
        }
      }
    }
  });

  assert.ok(evidence);
  assert.equal(evidence.auditLogId, "audit-direct-apply");
  assert.equal(evidence.action, "admin.sub2.account.apply_openai_refresh_token");
  assert.equal(evidence.resourceId, "resource-from-direct-apply");
  assert.equal(evidence.sub2AccountId, "2");
  assert.equal(evidence.ok, false);
  assert.equal(evidence.responsesOk, false);
  assert.equal(evidence.proxyRequestLogId, "direct-apply-proxy");
  assert.equal(evidence.requestId, "direct-apply-req");
  assert.equal(localProxySmokeFailureSummary(evidence), "Latest local OpenAI/Codex smoke test failed at /v1/responses.");
});

test("normalizes credential apply smoke skip evidence", () => {
  const evidence = normalizeLocalProxySmokeAuditLog({
    id: "audit-2",
    action: "admin.resource.credential_apply_sub2",
    objectId: "resource-1",
    createdAt: new Date("2026-06-11T02:00:00.000Z"),
    after: {
      smokeTestRequested: true,
      smokeTestSkippedReason: "sub2_account_test_failed",
      test: { ok: false, statusCode: 500 }
    }
  });

  assert.ok(evidence);
  assert.equal(evidence.ok, false);
  assert.equal(evidence.model, null);
  assert.equal(evidence.modelsOk, null);
  assert.equal(evidence.responsesOk, null);
  assert.equal(evidence.localProxyOk, null);
  assert.equal(evidence.keyDisabled, null);
  assert.equal(evidence.smokeTestSkippedReason, "sub2_account_test_failed");
  assert.equal(localProxySmokeFailureSummary(evidence), "Latest requested local OpenAI/Codex smoke test was skipped because the Sub2 account test failed.");
});

test("chooses the newest valid smoke evidence across audit sources", () => {
  const logs = [
    {
      id: "direct-older",
      action: "admin.sub2.proxy_smoke_test",
      objectId: "key-older",
      createdAt: new Date("2026-06-11T01:00:00.000Z"),
      after: {
        ok: true,
        model: "gpt-5.3-codex",
        keyDisabled: true,
        models: { ok: true },
        responses: { ok: true },
        localProxy: { ok: true, proxyRequestLogCount: 2 }
      }
    },
    {
      id: "direct-apply-newest",
      action: "admin.sub2.account.apply_openai_refresh_token",
      objectId: "2",
      createdAt: new Date("2026-06-11T04:00:00.000Z"),
      after: {
        smokeTest: {
          ok: true,
          model: "gpt-5.3-codex",
          keyDisabled: true,
          models: { ok: true },
          responses: { ok: true },
          localProxy: { ok: true, proxyRequestLogCount: 2 }
        }
      }
    },
    {
      id: "credential-without-smoke",
      action: "admin.resource.credential_apply_sub2",
      objectId: "resource-no-smoke",
      createdAt: new Date("2026-06-11T03:00:00.000Z"),
      after: {
        ok: true,
        smokeTestRequested: false
      }
    },
    {
      id: "credential-newer",
      action: "admin.resource.credential_apply_sub2",
      objectId: "resource-newer",
      createdAt: new Date("2026-06-11T02:00:00.000Z"),
      after: {
        smokeTest: {
          ok: false,
          model: "gpt-5.3-codex",
          keyDisabled: true,
          models: { ok: true },
          responses: { ok: false },
          localProxy: { ok: false, proxyRequestLogCount: 2 }
        }
      }
    }
  ];
  const candidates = localProxySmokeEvidenceCandidates(logs);

  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].auditLogId, "direct-apply-newest");
  assert.equal(candidates[1].auditLogId, "credential-newer");
  assert.equal(candidates[2].auditLogId, "direct-older");
  assert.equal(latestLocalProxySmokeEvidence(logs)?.auditLogId, "direct-apply-newest");
  assert.equal(localProxySmokeFailureSummary(candidates[1]), "Latest local OpenAI/Codex smoke test failed at /v1/responses.");
});

test("local proxy smoke issues link operators back to repair surfaces", () => {
  const direct = normalizeLocalProxySmokeAuditLog({
    id: "direct-failed",
    action: "admin.sub2.proxy_smoke_test",
    objectId: "sub2-key-1",
    createdAt: new Date("2026-06-11T04:00:00.000Z"),
    after: {
      ok: false,
      model: "gpt-5.3-codex",
      keyDisabled: true,
      models: { ok: true },
      responses: { ok: false },
      localProxy: {
        ok: false,
        proxyRequestLogCount: 2,
        proxyRequestLogs: [
          { id: "proxy-models", requestId: "req-models", path: "/v1/models", statusCode: 200 },
          { id: "proxy-responses", requestId: "req-responses", path: "/v1/responses", statusCode: 503, errorCode: "upstream_server_error" }
        ]
      }
    }
  });
  assert.ok(direct);

  const directIssue = localProxySmokeEvidenceIssue(
    direct,
    "local_proxy_smoke_failed",
    "error",
    3,
    localProxySmokeFailureSummary(direct),
    "Repair the failing stage, then rerun the local end-to-end proxy smoke test."
  );

  assert.equal(directIssue.sub2Status, true);
  assert.equal(directIssue.resourceId, null);
  assert.equal(directIssue.auditLogId, "direct-failed");
  assert.equal(directIssue.proxyRequestLogId, "proxy-responses");
  assert.equal(directIssue.requestId, "req-responses");
  assert.equal(directIssue.proxyRequestPath, "/v1/responses");
  assert.equal(directIssue.proxyRequestStatusCode, 503);
  assert.equal(directIssue.proxyRequestErrorCode, "upstream_server_error");

  const credentialApply = normalizeLocalProxySmokeAuditLog({
    id: "credential-apply-failed",
    action: "admin.resource.credential_apply_sub2",
    objectId: "resource-1",
    createdAt: new Date("2026-06-11T05:00:00.000Z"),
    after: {
      smokeTest: {
        ok: false,
        model: "gpt-5.3-codex",
        keyDisabled: true,
        models: { ok: true },
        responses: { ok: false },
        localProxy: {
          ok: false,
          proxyRequestLogCount: 2,
          proxyRequestLogs: [
            { id: "credential-proxy-responses", requestId: "credential-req-responses", path: "/v1/responses", statusCode: 503 }
          ]
        }
      }
    }
  });
  assert.ok(credentialApply);

  const credentialIssue = localProxySmokeEvidenceIssue(
    credentialApply,
    "local_proxy_smoke_failed",
    "error",
    4,
    localProxySmokeFailureSummary(credentialApply),
    "Repair the failing stage, then rerun the local end-to-end proxy smoke test."
  );

  assert.equal(credentialIssue.sub2Status, true);
  assert.equal(credentialIssue.resourceId, "resource-1");
  assert.equal(credentialIssue.auditLogId, "credential-apply-failed");
  assert.equal(credentialIssue.proxyRequestLogId, "credential-proxy-responses");
  assert.equal(credentialIssue.requestId, "credential-req-responses");

  const directApply = normalizeLocalProxySmokeAuditLog({
    id: "direct-apply-failed",
    action: "admin.sub2.account.apply_openai_refresh_token",
    objectId: "2",
    createdAt: new Date("2026-06-11T06:00:00.000Z"),
    after: {
      smokeTest: {
        ok: false,
        model: "gpt-5.3-codex",
        keyDisabled: true,
        models: { ok: true },
        responses: { ok: false },
        localProxy: {
          ok: false,
          proxyRequestLogCount: 1,
          proxyRequestLogs: [
            { id: "direct-apply-proxy-responses", requestId: "direct-apply-req-responses", path: "/v1/responses", statusCode: 502 }
          ]
        }
      },
      resourceCredentialSync: {
        saved: true,
        resourceId: "resource-direct-apply"
      }
    }
  });
  assert.ok(directApply);

  const directApplyIssue = localProxySmokeEvidenceIssue(
    directApply,
    "local_proxy_smoke_failed",
    "error",
    5,
    localProxySmokeFailureSummary(directApply),
    "Repair the failing stage, then rerun the local end-to-end proxy smoke test."
  );

  assert.equal(directApplyIssue.sub2Status, true);
  assert.equal(directApplyIssue.resourceId, "resource-direct-apply");
  assert.equal(directApplyIssue.sub2AccountId, "2");
  assert.equal(directApplyIssue.auditLogId, "direct-apply-failed");
  assert.equal(directApplyIssue.proxyRequestLogId, "direct-apply-proxy-responses");
  assert.equal(directApplyIssue.requestId, "direct-apply-req-responses");
});

test("local proxy smoke issues inherit Sub2 repair account candidates", () => {
  const direct = normalizeLocalProxySmokeAuditLog({
    id: "direct-failed",
    action: "admin.sub2.proxy_smoke_test",
    objectId: "sub2-key-1",
    createdAt: new Date("2026-06-11T04:00:00.000Z"),
    after: {
      ok: false,
      model: "gpt-5.3-codex",
      keyDisabled: true,
      models: { ok: true },
      responses: { ok: false },
      localProxy: {
        ok: false,
        proxyRequestLogCount: 1,
        proxyRequestLogs: [
          { id: "proxy-responses", requestId: "req-responses", path: "/v1/responses", statusCode: 503, errorCode: "upstream_http_503" }
        ]
      }
    }
  });
  assert.ok(direct);

  const issue = localProxySmokeEvidenceIssue(
    direct,
    "local_proxy_smoke_failed",
    "error",
    3,
    localProxySmokeFailureSummary(direct),
    "Repair the failing stage, then rerun the local end-to-end proxy smoke test."
  );

  const enriched = attachLocalProxySmokeIssueRepairCandidate({ issues: [issue] }, [
    {
      id: "sub2_account:2",
      sub2AccountId: 2,
      sub2AccountName: "main",
      accountStatus: "error",
      credentialsStatus: "configured(3)",
      schedulable: false
    }
  ]);

  assert.equal(enriched.issues[0].sub2Status, true);
  assert.equal(enriched.issues[0].sub2AccountId, 2);
  assert.equal(enriched.issues[0].sub2AccountName, "main");
  assert.equal(enriched.issues[0].accountStatus, "error");
  assert.equal(enriched.issues[0].credentialsStatus, "configured(3)");
  assert.equal(enriched.issues[0].schedulable, false);
  assert.equal(enriched.issues[0].repairAction, "apply_openai_refresh_token_to_sub2_account");
  assert.equal(enriched.issues[0].requestId, "req-responses");
  assert.equal(enriched.issues[0].proxyRequestLogId, "proxy-responses");
});
