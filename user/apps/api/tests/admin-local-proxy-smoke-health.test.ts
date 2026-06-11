import assert from "node:assert/strict";
import test from "node:test";
import {
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
      localProxy: { ok: true, proxyRequestLogCount: 2 }
    }
  });

  assert.ok(evidence);
  assert.equal(evidence.auditLogId, "audit-1");
  assert.equal(evidence.ok, true);
  assert.equal(evidence.model, "gpt-5.3-codex");
  assert.equal(evidence.modelsOk, true);
  assert.equal(evidence.responsesOk, true);
  assert.equal(evidence.localProxyOk, true);
  assert.equal(evidence.keyDisabled, true);
  assert.equal(evidence.proxyRequestLogCount, 2);
  assert.equal(evidence.smokeTestSkippedReason, null);
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

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].auditLogId, "credential-newer");
  assert.equal(candidates[1].auditLogId, "direct-older");
  assert.equal(latestLocalProxySmokeEvidence(logs)?.auditLogId, "credential-newer");
  assert.equal(localProxySmokeFailureSummary(candidates[0]), "Latest local OpenAI/Codex smoke test failed at /v1/responses.");
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
      localProxy: { ok: false, proxyRequestLogCount: 2 }
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
        localProxy: { ok: false, proxyRequestLogCount: 2 }
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
});
