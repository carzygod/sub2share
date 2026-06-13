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
    sub2AccountName: nullableText(candidate.sub2AccountName),
    accountStatus: nullableText(candidate.accountStatus),
    credentialsStatus: nullableText(candidate.credentialsStatus),
    schedulable: candidate.schedulable ?? null,
    ...(candidate.tempUnschedulableReason !== undefined ? { tempUnschedulableReason: optionalText(candidate.tempUnschedulableReason) } : {}),
    ...(candidate.message !== undefined ? { accountMessage: optionalText(candidate.message) } : {}),
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
      updatedAt: optionalText(candidate.updatedAt),
      sampleType: "sub2_account_repair_candidate",
      sub2Status: true,
      repairAction: "apply_openai_refresh_token_to_sub2_account"
    }));
}

function nullableText(value?: string | null) {
  return optionalText(value) ?? null;
}

function optionalText(value?: string | null) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
