export interface ResourceCredentialSub2AccountCandidate {
  id?: string;
  sub2AccountId?: number | string | null;
  sub2AccountName?: string | null;
  accountStatus?: string | null;
  credentialsStatus?: string | null;
  schedulable?: boolean | null;
  groupIds?: string | null;
  groupNames?: string | null;
  message?: string | null;
  updatedAt?: string | null;
}

export function resourceCredentialCodexResourceListFields() {
  return {
    resourceList: true,
    resourceType: "codex",
    resourceStatus: null
  };
}

export function resourceCredentialRepairCandidateFields(candidates: ResourceCredentialSub2AccountCandidate[]) {
  const candidate = candidates.find((item) => item.sub2AccountId !== undefined && item.sub2AccountId !== null);
  if (!candidate) return {};

  return {
    sub2AccountId: candidate.sub2AccountId,
    sub2AccountName: candidate.sub2AccountName ?? null,
    accountStatus: candidate.accountStatus ?? null,
    credentialsStatus: candidate.credentialsStatus ?? null,
    schedulable: candidate.schedulable ?? null,
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
