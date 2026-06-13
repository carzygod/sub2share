export interface ResourceCredentialSub2AccountCandidate {
  id?: string;
  sub2AccountId?: number | string | null;
  sub2AccountName?: string | null;
  accountStatus?: string | null;
  credentialsStatus?: string | null;
  schedulable?: boolean | null;
  tempUnschedulableReason?: string | null;
  groupIds?: string | null;
  groupNames?: string | null;
  message?: string | null;
  accountErrorStatusCode?: number | null;
  accountErrorType?: string | null;
  accountErrorCode?: string | null;
  accountErrorMessage?: string | null;
  updatedAt?: string | null;
}

export interface ResourceCredentialRepairCandidateFields {
  sub2AccountId?: number | string | null;
  sub2AccountName?: string | null;
  accountStatus?: string | null;
  credentialsStatus?: string | null;
  schedulable?: boolean | null;
  tempUnschedulableReason?: string | null;
  accountMessage?: string | null;
  accountErrorStatusCode?: number | null;
  accountErrorType?: string | null;
  accountErrorCode?: string | null;
  accountErrorMessage?: string | null;
  updatedAt?: string | null;
  repairAction?: "apply_openai_refresh_token_to_sub2_account";
}

export function resourceCredentialCodexResourceListFields() {
  return {
    resourceList: true,
    resourceScope: "production" as const,
    resourceType: "codex",
    resourceStatus: null
  };
}

export function resourceCredentialRepairCandidateFields(candidates: ResourceCredentialSub2AccountCandidate[]): ResourceCredentialRepairCandidateFields {
  const candidate = candidates.find((item) => item.sub2AccountId !== undefined && item.sub2AccountId !== null);
  if (!candidate) return {};
  const accountErrorFields = resourceCredentialAccountErrorFields(candidate);

  return {
    sub2AccountId: candidate.sub2AccountId,
    sub2AccountName: nullableText(candidate.sub2AccountName),
    accountStatus: nullableText(candidate.accountStatus),
    credentialsStatus: nullableText(candidate.credentialsStatus),
    schedulable: candidate.schedulable ?? null,
    ...(candidate.tempUnschedulableReason !== undefined ? { tempUnschedulableReason: optionalText(candidate.tempUnschedulableReason) } : {}),
    ...(candidate.message !== undefined ? { accountMessage: optionalText(candidate.message) } : {}),
    ...accountErrorFields,
    ...(candidate.updatedAt !== undefined ? { updatedAt: optionalText(candidate.updatedAt) } : {}),
    repairAction: "apply_openai_refresh_token_to_sub2_account"
  };
}

export function resourceCredentialSub2AccountRepairSamples(candidates: ResourceCredentialSub2AccountCandidate[]) {
  return candidates
    .filter((item) => item.sub2AccountId !== undefined && item.sub2AccountId !== null)
    .slice(0, 10)
    .map((candidate) => ({
      ...candidate,
      sub2AccountName: optionalText(candidate.sub2AccountName),
      accountStatus: optionalText(candidate.accountStatus),
      credentialsStatus: optionalText(candidate.credentialsStatus),
      tempUnschedulableReason: optionalText(candidate.tempUnschedulableReason),
      groupIds: optionalText(candidate.groupIds),
      groupNames: optionalText(candidate.groupNames),
      message: optionalText(candidate.message),
      ...resourceCredentialAccountErrorFields(candidate),
      updatedAt: optionalText(candidate.updatedAt),
      sampleType: "sub2_account_repair_candidate",
      sub2Status: true,
      repairAction: "apply_openai_refresh_token_to_sub2_account"
    }));
}

export function resourceCredentialAccountErrorFields(
  candidate: ResourceCredentialSub2AccountCandidate
): Pick<ResourceCredentialRepairCandidateFields, "accountErrorStatusCode" | "accountErrorType" | "accountErrorCode" | "accountErrorMessage"> {
  const parsed = parseSub2AccountErrorDiagnostics(nullableText(candidate.message) ?? nullableText(candidate.tempUnschedulableReason));
  return {
    accountErrorStatusCode: candidate.accountErrorStatusCode ?? parsed.accountErrorStatusCode ?? null,
    accountErrorType: nullableText(candidate.accountErrorType) ?? parsed.accountErrorType ?? null,
    accountErrorCode: nullableText(candidate.accountErrorCode) ?? parsed.accountErrorCode ?? null,
    accountErrorMessage: nullableText(candidate.accountErrorMessage) ?? parsed.accountErrorMessage ?? null
  };
}

export function parseSub2AccountErrorDiagnostics(value?: string | null) {
  const text = nullableText(value);
  if (!text) return {};

  const parsed = parseJsonSuffix(text);
  const parsedError = jsonObject(parsed?.error);
  return {
    accountErrorStatusCode: numericStatus(parsed?.status) ?? statusCodeFromText(text) ?? null,
    accountErrorType: nullableText(parsedError?.type) ?? jsonStringField(text, "type") ?? null,
    accountErrorCode: nullableText(parsedError?.code) ?? jsonStringField(text, "code") ?? knownAccountErrorCode(text) ?? null,
    accountErrorMessage: nullableText(parsedError?.message) ?? jsonStringField(text, "message") ?? null
  };
}

function parseJsonSuffix(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  try {
    return jsonObject(JSON.parse(text.slice(start)));
  } catch {
    return null;
  }
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numericStatus(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

function statusCodeFromText(text: string) {
  const match = text.match(/\((\d{3})\)/) ?? text.match(/"status"\s*:\s*(\d{3})/);
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isInteger(status) ? status : null;
}

function jsonStringField(text: string, field: string) {
  const match = text.match(new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`));
  return optionalText(match?.[1]) ?? null;
}

function knownAccountErrorCode(text: string) {
  const normalized = text.toLowerCase();
  for (const code of ["token_invalidated", "invalid_api_key", "insufficient_quota", "rate_limit_exceeded"]) {
    if (normalized.includes(code)) return code;
  }
  if (normalized.includes("token") && normalized.includes("invalidated")) return "token_invalidated";
  return null;
}

function nullableText(value: unknown) {
  return optionalText(value) ?? null;
}

function optionalText(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
