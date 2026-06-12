import type { Prisma } from "@prisma/client";
import { internalHealthCheckSupplierResourceSub2AccountId } from "../../common/internal-records.js";
import { resourceCredentialRepairCandidateFields, type ResourceCredentialSub2AccountCandidate } from "./resource-credential-health.js";

export type SupplierResourceIdentity = {
  sub2AccountId: string | null;
};

export interface SupplierResourceCredentialIdentity {
  credentialType?: string | null;
  status?: string | null;
}

export interface SupplierResourceManualOnlineReadinessInput {
  resourceType: string;
  targetStatus: string;
  sub2AccountId?: string | null;
  credential?: SupplierResourceCredentialIdentity | null;
}

export interface SupplierResourceManualOnlineReadinessResult {
  ok: boolean;
  issues: string[];
  code: "codex_resource_not_ready_for_online";
  message: string;
}

export type SupplierResourceStatus = "pending" | "testing" | "online" | "busy" | "paused" | "abnormal" | "disabled";

export interface SupplierResourceTestStatusTransitionInput {
  currentStatus: SupplierResourceStatus;
  ok: boolean;
  resourceType: string;
  sub2AccountId?: string | null;
  credential?: SupplierResourceCredentialIdentity | null;
}

export interface SupplierResourceTestStatusTransitionResult {
  status: SupplierResourceStatus;
  targetStatus: SupplierResourceStatus;
  blockedOnline: boolean;
  onlineReadiness: SupplierResourceManualOnlineReadinessResult;
}

export interface SupplierResourceCredentialMutationStatusTransitionInput {
  currentStatus: SupplierResourceStatus;
  resourceType: string;
  sub2AccountId?: string | null;
  credential?: SupplierResourceCredentialIdentity | null;
}

export interface SupplierResourceCredentialMutationStatusTransitionResult {
  status: SupplierResourceStatus;
  changed: boolean;
  reason: "codex_resource_not_ready_after_credential_change" | null;
  onlineReadiness: SupplierResourceManualOnlineReadinessResult;
}

export interface SupplierResourceAvailabilityMetricsInput {
  resourcesByStatus: Record<string, number>;
  totalCodexResources: number;
  onlineCodexResources: number;
  readyOnlineCodexResources: number;
  incompleteOnlineCodexResources: number;
  ignoredInternalResources: number;
  issueCount: number;
  resourceSampleCount: number;
}

export interface SupplierResourceMissingCodexIssueFieldsInput {
  supplierEmail?: string | null;
  resourceType?: string | null;
  resourceStatus?: string | null;
  sub2AccountId?: number | string | null;
  sub2AccountCandidates?: ResourceCredentialSub2AccountCandidate[];
}

export function isInternalHealthCheckSupplierResource(resource: SupplierResourceIdentity) {
  return resource.sub2AccountId === internalHealthCheckSupplierResourceSub2AccountId;
}

export function internalHealthCheckSupplierResourceWhere(): Prisma.SupplierResourceWhereInput {
  return { sub2AccountId: internalHealthCheckSupplierResourceSub2AccountId };
}

export function nonSmokeSupplierResourceWhere(): Prisma.SupplierResourceWhereInput {
  return { NOT: internalHealthCheckSupplierResourceWhere() };
}

export function supplierResourceAvailabilityMetrics(input: SupplierResourceAvailabilityMetricsInput) {
  return {
    ...input.resourcesByStatus,
    totalCodexResources: input.totalCodexResources,
    onlineCodexResources: input.onlineCodexResources,
    readyOnlineCodexResources: input.readyOnlineCodexResources,
    incompleteOnlineCodexResources: input.incompleteOnlineCodexResources,
    ignoredInternalResources: input.ignoredInternalResources,
    issueSamples: input.issueCount,
    resourceSamples: input.resourceSampleCount
  };
}

export function inspectSupplierResourceManualOnlineReadiness(
  input: SupplierResourceManualOnlineReadinessInput
): SupplierResourceManualOnlineReadinessResult {
  const issues: string[] = [];
  if (input.targetStatus === "online" && input.resourceType === "codex") {
    if (!input.sub2AccountId?.trim()) {
      issues.push("sub2_account_missing");
    }
    if (input.credential?.credentialType !== "openai_refresh_token" || input.credential.status !== "active") {
      issues.push("active_openai_refresh_token_missing");
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    code: "codex_resource_not_ready_for_online",
    message: issues.length === 0
      ? "Codex resource is ready to switch online"
      : "Codex resources require a Sub2 account id and an active OpenAI refresh token credential before manual online status changes"
  };
}

export function supplierResourceStatusAfterTest(current: SupplierResourceStatus, ok: boolean): SupplierResourceStatus {
  if (["disabled", "paused"].includes(current)) return current;
  if (ok) return current === "testing" || current === "pending" || current === "abnormal" ? "online" : current;
  return current === "online" || current === "testing" || current === "pending" || current === "busy" ? "abnormal" : current;
}

export function inspectSupplierResourceTestStatusTransition(
  input: SupplierResourceTestStatusTransitionInput
): SupplierResourceTestStatusTransitionResult {
  const targetStatus = supplierResourceStatusAfterTest(input.currentStatus, input.ok);
  const onlineReadiness = inspectSupplierResourceManualOnlineReadiness({
    resourceType: input.resourceType,
    targetStatus,
    sub2AccountId: input.sub2AccountId,
    credential: input.credential
  });
  const blockedOnline = targetStatus === "online" && !onlineReadiness.ok;

  return {
    status: blockedOnline ? input.currentStatus : targetStatus,
    targetStatus,
    blockedOnline,
    onlineReadiness
  };
}

export function inspectSupplierResourceCredentialMutationStatusTransition(
  input: SupplierResourceCredentialMutationStatusTransitionInput
): SupplierResourceCredentialMutationStatusTransitionResult {
  const onlineReadiness = inspectSupplierResourceManualOnlineReadiness({
    resourceType: input.resourceType,
    targetStatus: "online",
    sub2AccountId: input.sub2AccountId,
    credential: input.credential
  });
  const activeDeliveryStatus = input.currentStatus === "online" || input.currentStatus === "busy";
  const shouldDemote = input.resourceType === "codex" && activeDeliveryStatus && !onlineReadiness.ok;

  return {
    status: shouldDemote ? "abnormal" : input.currentStatus,
    changed: shouldDemote,
    reason: shouldDemote ? "codex_resource_not_ready_after_credential_change" : null,
    onlineReadiness
  };
}

export function supplierResourceMissingCodexIssueFields(input: SupplierResourceMissingCodexIssueFieldsInput) {
  const hasResourceSub2Account = input.sub2AccountId !== undefined
    && input.sub2AccountId !== null
    && String(input.sub2AccountId).trim().length > 0;
  const supplierEmail = input.supplierEmail?.trim();
  const repairFields = hasResourceSub2Account
    ? {}
    : resourceCredentialRepairCandidateFields(input.sub2AccountCandidates ?? []);
  const repairSub2AccountId = "sub2AccountId" in repairFields ? repairFields.sub2AccountId : null;

  return {
    resourceList: true,
    resourceScope: "production" as const,
    resourceStatus: input.resourceStatus ?? null,
    resourceType: input.resourceType ?? "codex",
    ...(supplierEmail ? { supplierEmail } : {}),
    ...repairFields,
    sub2AccountId: hasResourceSub2Account ? input.sub2AccountId : repairSub2AccountId ?? null
  };
}
