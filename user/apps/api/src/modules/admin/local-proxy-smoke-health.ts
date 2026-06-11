import { resourceCredentialRepairCandidateFields, type ResourceCredentialSub2AccountCandidate } from "./resource-credential-health.js";

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
  resourceId?: string | null;
  sub2AccountId?: string | null;
  createdAt: Date;
  ok: boolean;
  model?: string | null;
  modelsOk: boolean | null;
  responsesOk: boolean | null;
  localProxyOk: boolean | null;
  keyDisabled: boolean | null;
  smokeTestSkippedReason: string | null;
  proxyRequestLogCount: number | null;
  proxyRequestLogs: LocalProxySmokeProxyRequestEvidence[];
  proxyRequestLogId?: string | null;
  requestId?: string | null;
  proxyRequestPath?: string | null;
  proxyRequestStatusCode?: number | null;
  proxyRequestErrorCode?: string | null;
}

export interface LocalProxySmokeProxyRequestEvidence {
  proxyRequestLogId: string;
  requestId: string;
  path?: string | null;
  model?: string | null;
  statusCode?: number | null;
  upstreamStatusCode?: number | null;
  errorCode?: string | null;
  createdAt?: string | null;
}

export interface LocalProxySmokeEvidenceIssue {
  id: string;
  type: string;
  severity: "warning" | "error";
  auditLogId?: string;
  auditAction?: string;
  resourceId?: string | null;
  sub2Status?: true;
  sub2AccountId?: number | string | null;
  sub2AccountName?: string | null;
  accountStatus?: string | null;
  credentialsStatus?: string | null;
  schedulable?: boolean | null;
  repairAction?: string;
  model?: string | null;
  modelsOk?: boolean | null;
  responsesOk?: boolean | null;
  localProxyOk?: boolean | null;
  keyDisabled?: boolean | null;
  smokeTestSkippedReason?: string | null;
  proxyRequestLogCount?: number | null;
  proxyRequestLogId?: string | null;
  requestId?: string | null;
  proxyRequestPath?: string | null;
  proxyRequestStatusCode?: number | null;
  proxyRequestErrorCode?: string | null;
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
  const smoke = isEmbeddedLocalProxySmokeAction(log.action)
    ? jsonRecord(after.smokeTest)
    : after;
  const skippedReason = jsonText(after.smokeTestSkippedReason);
  if (!smoke && !skippedReason) return null;
  const resourceCredentialSync = jsonRecord(after.resourceCredentialSync);
  const models = jsonRecord(smoke?.models);
  const responses = jsonRecord(smoke?.responses);
  const localProxy = jsonRecord(smoke?.localProxy);
  const proxyRequestLogs = jsonArray(localProxy?.proxyRequestLogs)
    .map((item) => normalizeProxyRequestLogEvidence(item))
    .filter((item): item is LocalProxySmokeProxyRequestEvidence => Boolean(item));
  const primaryProxyRequest = primaryProxyRequestLogEvidence(proxyRequestLogs);
  return {
    auditLogId: log.id,
    action: log.action,
    objectId: log.objectId,
    resourceId: localProxySmokeEvidenceResourceId(log, resourceCredentialSync),
    sub2AccountId: localProxySmokeEvidenceSub2AccountId(log, after),
    createdAt: log.createdAt,
    ok: smoke ? Boolean(smoke.ok) : false,
    model: smoke ? jsonText(smoke.model) : null,
    modelsOk: jsonBoolean(models?.ok),
    responsesOk: jsonBoolean(responses?.ok),
    localProxyOk: jsonBoolean(localProxy?.ok),
    keyDisabled: smoke ? jsonBoolean(smoke.keyDisabled) : null,
    smokeTestSkippedReason: skippedReason,
    proxyRequestLogCount: jsonNumber(localProxy?.proxyRequestLogCount),
    proxyRequestLogs,
    proxyRequestLogId: primaryProxyRequest?.proxyRequestLogId ?? null,
    requestId: primaryProxyRequest?.requestId ?? null,
    proxyRequestPath: primaryProxyRequest?.path ?? null,
    proxyRequestStatusCode: primaryProxyRequest?.statusCode ?? null,
    proxyRequestErrorCode: primaryProxyRequest?.errorCode ?? null
  };
}

export function localProxySmokeEvidenceSummary(smoke: LocalProxySmokeEvidence, ageMinutes: number, stale: boolean) {
  return {
    auditLogId: smoke.auditLogId,
    auditAction: smoke.action,
    objectId: smoke.objectId ?? null,
    resourceId: smoke.resourceId ?? null,
    sub2AccountId: smoke.sub2AccountId ?? null,
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
    proxyRequestLogCount: smoke.proxyRequestLogCount,
    proxyRequestLogs: smoke.proxyRequestLogs,
    proxyRequestLogId: smoke.proxyRequestLogId ?? null,
    requestId: smoke.requestId ?? null,
    proxyRequestPath: smoke.proxyRequestPath ?? null,
    proxyRequestStatusCode: smoke.proxyRequestStatusCode ?? null,
    proxyRequestErrorCode: smoke.proxyRequestErrorCode ?? null
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
    resourceId: smoke.resourceId ?? null,
    sub2Status: true,
    sub2AccountId: smoke.sub2AccountId ?? null,
    model: smoke.model ?? null,
    modelsOk: smoke.modelsOk,
    responsesOk: smoke.responsesOk,
    localProxyOk: smoke.localProxyOk,
    keyDisabled: smoke.keyDisabled,
    smokeTestSkippedReason: smoke.smokeTestSkippedReason,
    proxyRequestLogCount: smoke.proxyRequestLogCount,
    proxyRequestLogId: smoke.proxyRequestLogId ?? null,
    requestId: smoke.requestId ?? null,
    proxyRequestPath: smoke.proxyRequestPath ?? null,
    proxyRequestStatusCode: smoke.proxyRequestStatusCode ?? null,
    proxyRequestErrorCode: smoke.proxyRequestErrorCode ?? null,
    createdAt: smoke.createdAt.toISOString(),
    ageMinutes,
    message,
    actionHint
  };
}

export function attachLocalProxySmokeIssueRepairCandidate<T extends { issues: LocalProxySmokeEvidenceIssue[] }>(
  result: T,
  candidates: ResourceCredentialSub2AccountCandidate[]
): T {
  const repairFields = resourceCredentialRepairCandidateFields(candidates);
  if (Object.keys(repairFields).length === 0) return result;

  return {
    ...result,
    issues: result.issues.map((issue) => issue.sub2Status ? { ...issue, ...repairFields } : issue)
  } as T;
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

function isEmbeddedLocalProxySmokeAction(action: string) {
  return action === "admin.resource.credential_apply_sub2"
    || action === "admin.sub2.account.apply_openai_refresh_token";
}

function localProxySmokeEvidenceResourceId(log: LocalProxySmokeAuditLog, resourceCredentialSync: Record<string, unknown> | null) {
  if (log.action === "admin.resource.credential_apply_sub2") return log.objectId ?? null;
  if (log.action === "admin.sub2.account.apply_openai_refresh_token") return jsonText(resourceCredentialSync?.resourceId);
  return null;
}

function localProxySmokeEvidenceSub2AccountId(log: LocalProxySmokeAuditLog, after: Record<string, unknown>) {
  if (log.action === "admin.sub2.account.apply_openai_refresh_token") {
    return log.objectId ?? jsonText(after.accountId);
  }
  return jsonText(after.accountId) ?? jsonText(after.sub2AccountId);
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function jsonArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function normalizeProxyRequestLogEvidence(value: unknown): LocalProxySmokeProxyRequestEvidence | null {
  const record = jsonRecord(value);
  if (!record) return null;
  const proxyRequestLogId = jsonText(record.id) ?? jsonText(record.proxyRequestLogId);
  const requestId = jsonText(record.requestId);
  if (!proxyRequestLogId && !requestId) return null;
  return {
    proxyRequestLogId: proxyRequestLogId ?? requestId!,
    requestId: requestId ?? proxyRequestLogId!,
    path: jsonText(record.path),
    model: jsonText(record.model),
    statusCode: jsonNumber(record.statusCode),
    upstreamStatusCode: jsonNumber(record.upstreamStatusCode),
    errorCode: jsonText(record.errorCode),
    createdAt: jsonText(record.createdAt)
  };
}

function primaryProxyRequestLogEvidence(logs: LocalProxySmokeProxyRequestEvidence[]) {
  return logs.find((log) => Boolean(log.errorCode) || (typeof log.statusCode === "number" && log.statusCode >= 400))
    ?? logs[0]
    ?? null;
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
