import { resourceCredentialRepairCandidateFields, type ResourceCredentialSub2AccountCandidate } from "./resource-credential-health.js";

export interface Sub2AccountHealthSource {
  id: number | string;
  name: string;
  platform: string;
  type: string;
  status: string;
  credentialsStatus?: string | null;
  schedulable?: boolean | null;
  groupIds: number[];
  groupNames: string[];
  currentConcurrency?: number | null;
  concurrency?: number | null;
  rateLimitedAt?: string | null;
  overloadUntil?: string | null;
  tempUnschedulableUntil?: string | null;
  tempUnschedulableReason?: string | null;
  updatedAt?: string | null;
  errorMessage?: string | null;
}

export interface Sub2AccountHealthSample extends ResourceCredentialSub2AccountCandidate {
  id: string;
  sub2AccountId: number | string;
  sub2AccountName: string;
  platform: string;
  accountType: string;
  accountStatus: string;
  credentialsStatus: string | null;
  schedulable: boolean | null;
  groupIds: string;
  groupNames: string;
  currentConcurrency: number | null;
  concurrency: number | null;
  rateLimitedAt: string | null;
  overloadUntil: string | null;
  tempUnschedulableUntil: string | null;
  tempUnschedulableReason: string | null;
  updatedAt: string | null;
  message: string;
}

export interface Sub2UpstreamIssue {
  id: string;
  type: string;
  severity: "error";
  sub2Status: true;
  sub2BlockingReason: string;
  sub2GroupId?: number | null;
  sub2GroupName?: string | null;
  sub2GroupStatus?: string | null;
  sub2AccountId?: number | string | null;
  sub2AccountName?: string | null;
  accountStatus?: string | null;
  credentialsStatus?: string | null;
  schedulable?: boolean | null;
  repairAction?: string;
  sub2AccountCount: number;
  openAiAccountCount: number;
  activeOpenAiAccountCount: number;
  gatewayReachable: boolean;
  error?: string | null;
  actionHint: string;
  message: string;
}

export function sub2AccountHealthSamples(accounts: Sub2AccountHealthSource[]) {
  return accounts
    .filter((account) => account.status !== "active" || account.schedulable === false)
    .slice(0, 20)
    .map((account): Sub2AccountHealthSample => ({
      id: `sub2_account:${account.id}`,
      sub2AccountId: account.id,
      sub2AccountName: account.name,
      platform: account.platform,
      accountType: account.type,
      accountStatus: account.status,
      credentialsStatus: account.credentialsStatus ?? null,
      schedulable: account.schedulable ?? null,
      groupIds: account.groupIds.join(","),
      groupNames: account.groupNames.join(","),
      currentConcurrency: account.currentConcurrency ?? null,
      concurrency: account.concurrency ?? null,
      rateLimitedAt: account.rateLimitedAt ?? null,
      overloadUntil: account.overloadUntil ?? null,
      tempUnschedulableUntil: account.tempUnschedulableUntil ?? null,
      tempUnschedulableReason: account.tempUnschedulableReason ?? null,
      updatedAt: account.updatedAt ?? null,
      message: account.errorMessage
        ?? account.tempUnschedulableReason
        ?? `Sub2 OpenAI account ${account.name} #${account.id} is ${account.status}${account.schedulable === false ? " and not schedulable" : ""}.`
    }));
}

export function buildSub2UpstreamIssues(input: {
  gatewayReachable: boolean;
  blockingReasons: string[];
  defaultGroupId: number | null;
  openAiGroupName?: string | null;
  openAiGroupStatus?: string | null;
  accountCount: number;
  openAiAccountCount: number;
  activeOpenAiAccountCount: number;
  accountSamples?: ResourceCredentialSub2AccountCandidate[];
  error?: string | null;
}): Sub2UpstreamIssue[] {
  return input.blockingReasons.map((reason) => ({
    id: `sub2_upstream:${reason}`,
    type: reason,
    severity: "error",
    sub2Status: true,
    sub2BlockingReason: reason,
    sub2GroupId: input.defaultGroupId,
    sub2GroupName: input.openAiGroupName ?? null,
    sub2GroupStatus: input.openAiGroupStatus ?? null,
    ...sub2UpstreamRepairCandidateFields(reason, input.accountSamples ?? []),
    sub2AccountCount: input.accountCount,
    openAiAccountCount: input.openAiAccountCount,
    activeOpenAiAccountCount: input.activeOpenAiAccountCount,
    gatewayReachable: input.gatewayReachable,
    error: input.error ?? null,
    actionHint: sub2UpstreamIssueActionHint(reason),
    message: sub2UpstreamIssueMessage(reason, input)
  }));
}

function sub2UpstreamRepairCandidateFields(reason: string, accountSamples: ResourceCredentialSub2AccountCandidate[]) {
  if (reason !== "openai_group_has_no_active_accounts") return {};
  return resourceCredentialRepairCandidateFields(accountSamples);
}

function sub2UpstreamIssueMessage(
  reason: string,
  input: {
    defaultGroupId: number | null;
    openAiGroupName?: string | null;
    openAiGroupStatus?: string | null;
    accountCount: number;
    openAiAccountCount: number;
    activeOpenAiAccountCount: number;
    error?: string | null;
  }
) {
  const group = input.defaultGroupId ? `${input.openAiGroupName ?? "OpenAI group"} #${input.defaultGroupId}` : "default OpenAI group";
  if (reason === "sub2api_health_unreachable") return "Sub2API gateway health endpoint is unreachable.";
  if (reason === "openai_group_missing") return "Sub2API has no default OpenAI group for Codex proxy scheduling.";
  if (reason === "openai_group_inactive") return `${group} is not active; current status is ${input.openAiGroupStatus ?? "unknown"}.`;
  if (reason === "openai_group_has_no_accounts") return `${group} has no OpenAI accounts; ${input.accountCount} total Sub2 accounts were returned.`;
  if (reason === "openai_group_has_no_active_accounts") return `${group} has ${input.openAiAccountCount} OpenAI account(s), but ${input.activeOpenAiAccountCount} active account(s).`;
  if (reason === "sub2_status_query_failed") return `Sub2API status query failed: ${input.error ?? "unknown error"}.`;
  return `Sub2/OpenAI upstream is blocked by ${reason}.`;
}

function sub2UpstreamIssueActionHint(reason: string) {
  if (reason === "sub2api_health_unreachable") return "Check SUB2_BASE_URL, Sub2API service health, firewall, and admin token connectivity before retrying the smoke test.";
  if (reason === "openai_group_missing") return "Create or configure the default OpenAI group in Sub2API, then refresh Sub2 status.";
  if (reason === "openai_group_inactive") return "Activate the default OpenAI group in Sub2API or switch the configured default group.";
  if (reason === "openai_group_has_no_accounts") return "Add an OpenAI account to the default group or apply a stored supplier refresh token to a bound Sub2 account.";
  if (reason === "openai_group_has_no_active_accounts") return "Refresh/test existing OpenAI accounts or apply a valid refresh token, then run the local end-to-end proxy smoke test.";
  if (reason === "sub2_status_query_failed") return "Review the redacted error, verify Sub2 admin credentials, and retry the status query.";
  return "Review Sub2API status and run the local end-to-end proxy smoke test after repair.";
}
