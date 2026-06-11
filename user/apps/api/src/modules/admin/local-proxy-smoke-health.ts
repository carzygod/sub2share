export interface LocalProxySmokeAuditLog {
  id: string;
  action: string;
  objectId: string | null;
  after: unknown;
  createdAt: Date;
}

export interface LocalProxySmokeEvidence {
  auditLogId: string;
  action: string;
  objectId?: string | null;
  createdAt: Date;
  ok: boolean;
  model?: string | null;
  modelsOk: boolean | null;
  responsesOk: boolean | null;
  localProxyOk: boolean | null;
  keyDisabled: boolean | null;
  smokeTestSkippedReason: string | null;
  proxyRequestLogCount: number | null;
}

export interface LocalProxySmokeEvidenceIssue {
  id: string;
  type: string;
  severity: "warning" | "error";
  auditLogId?: string;
  auditAction?: string;
  resourceId?: string | null;
  sub2Status?: true;
  model?: string | null;
  modelsOk?: boolean | null;
  responsesOk?: boolean | null;
  localProxyOk?: boolean | null;
  keyDisabled?: boolean | null;
  smokeTestSkippedReason?: string | null;
  proxyRequestLogCount?: number | null;
  createdAt?: string;
  ageMinutes?: number | null;
  message: string;
  actionHint: string;
}

export function localProxySmokeEvidenceCandidates(logs: LocalProxySmokeAuditLog[]) {
  return logs
    .map((log) => normalizeLocalProxySmokeAuditLog(log))
    .filter((result): result is LocalProxySmokeEvidence => Boolean(result))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}

export function latestLocalProxySmokeEvidence(logs: LocalProxySmokeAuditLog[]) {
  return localProxySmokeEvidenceCandidates(logs)[0] ?? null;
}

export function normalizeLocalProxySmokeAuditLog(log: LocalProxySmokeAuditLog): LocalProxySmokeEvidence | null {
  const after = jsonRecord(log.after);
  if (!after) return null;
  const smoke = log.action === "admin.resource.credential_apply_sub2"
    ? jsonRecord(after.smokeTest)
    : after;
  const skippedReason = jsonText(after.smokeTestSkippedReason);
  if (!smoke && !skippedReason) return null;
  const models = jsonRecord(smoke?.models);
  const responses = jsonRecord(smoke?.responses);
  const localProxy = jsonRecord(smoke?.localProxy);
  return {
    auditLogId: log.id,
    action: log.action,
    objectId: log.objectId,
    createdAt: log.createdAt,
    ok: smoke ? Boolean(smoke.ok) : false,
    model: smoke ? jsonText(smoke.model) : null,
    modelsOk: jsonBoolean(models?.ok),
    responsesOk: jsonBoolean(responses?.ok),
    localProxyOk: jsonBoolean(localProxy?.ok),
    keyDisabled: smoke ? jsonBoolean(smoke.keyDisabled) : null,
    smokeTestSkippedReason: skippedReason,
    proxyRequestLogCount: jsonNumber(localProxy?.proxyRequestLogCount)
  };
}

export function localProxySmokeEvidenceSummary(smoke: LocalProxySmokeEvidence, ageMinutes: number, stale: boolean) {
  return {
    auditLogId: smoke.auditLogId,
    auditAction: smoke.action,
    objectId: smoke.objectId ?? null,
    createdAt: smoke.createdAt.toISOString(),
    ageMinutes,
    stale,
    ok: smoke.ok,
    model: smoke.model ?? null,
    modelsOk: smoke.modelsOk,
    responsesOk: smoke.responsesOk,
    localProxyOk: smoke.localProxyOk,
    keyDisabled: smoke.keyDisabled,
    smokeTestSkippedReason: smoke.smokeTestSkippedReason,
    proxyRequestLogCount: smoke.proxyRequestLogCount
  };
}

export function localProxySmokeEvidenceIssue(
  smoke: LocalProxySmokeEvidence,
  type: string,
  severity: "warning" | "error",
  ageMinutes: number,
  message: string,
  actionHint: string
): LocalProxySmokeEvidenceIssue {
  return {
    id: `local_proxy_smoke:${smoke.auditLogId}:${type}`,
    type,
    severity,
    auditLogId: smoke.auditLogId,
    auditAction: smoke.action,
    resourceId: smoke.action === "admin.resource.credential_apply_sub2" ? smoke.objectId ?? null : null,
    sub2Status: true,
    model: smoke.model ?? null,
    modelsOk: smoke.modelsOk,
    responsesOk: smoke.responsesOk,
    localProxyOk: smoke.localProxyOk,
    keyDisabled: smoke.keyDisabled,
    smokeTestSkippedReason: smoke.smokeTestSkippedReason,
    proxyRequestLogCount: smoke.proxyRequestLogCount,
    createdAt: smoke.createdAt.toISOString(),
    ageMinutes,
    message,
    actionHint
  };
}

export function localProxySmokeFailureSummary(smoke: LocalProxySmokeEvidence) {
  if (smoke.smokeTestSkippedReason === "credential_apply_failed") return "Latest requested local OpenAI/Codex smoke test was skipped because credential application failed.";
  if (smoke.smokeTestSkippedReason === "sub2_account_test_failed") return "Latest requested local OpenAI/Codex smoke test was skipped because the Sub2 account test failed.";
  if (smoke.smokeTestSkippedReason) return `Latest requested local OpenAI/Codex smoke test was skipped: ${smoke.smokeTestSkippedReason}.`;
  if (smoke.modelsOk === false) return "Latest local OpenAI/Codex smoke test failed at /v1/models.";
  if (smoke.responsesOk === false) return "Latest local OpenAI/Codex smoke test failed at /v1/responses.";
  if (smoke.localProxyOk === false) return "Latest local OpenAI/Codex smoke test did not complete local proxy cleanup or log evidence.";
  if (smoke.keyDisabled === false) return "Latest local OpenAI/Codex smoke test did not disable the temporary Sub2 key.";
  return "Latest local OpenAI/Codex smoke test failed.";
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function jsonText(value: unknown) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : null;
}

function jsonBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function jsonNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
