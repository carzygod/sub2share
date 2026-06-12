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

  return {
    sub2AccountId: candidate.sub2AccountId,
    sub2AccountName: candidate.sub2AccountName ?? null,
    accountStatus: candidate.accountStatus ?? null,
    credentialsStatus: candidate.credentialsStatus ?? null,
    schedulable: candidate.schedulable ?? null,
    ...(candidate.tempUnschedulableReason !== undefined ? { tempUnschedulableReason: candidate.tempUnschedulableReason } : {}),
    ...(candidate.message !== undefined ? { accountMessage: candidate.message } : {}),
    ...(candidate.updatedAt !== undefined ? { updatedAt: candidate.updatedAt } : {}),
    repairAction: "apply_openai_refresh_token_to_sub2_account"
  };
}

export function resourceCredentialSub2AccountRepairSamples(candidates: ResourceCredentialSub2AccountCandidate[]) {
  return candidates
    .filter((item) => item.sub2AccountId !== undefined && item.sub2AccountId !== null)
    .slice(0, 10)
    .map((candidate) => ({
      ...candidate,
      sampleType: "sub2_account_repair_candidate",
      sub2Status: true,
      repairAction: "apply_openai_refresh_token_to_sub2_account"
    }));
}
