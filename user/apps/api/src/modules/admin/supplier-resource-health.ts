import type { Prisma } from "@prisma/client";
import { internalHealthCheckSupplierResourceSub2AccountId } from "../../common/internal-records.js";
import { resourceCredentialRepairCandidateFields, type ResourceCredentialSub2AccountCandidate } from "./resource-credential-health.js";

export type SupplierResourceIdentity = {
  sub2AccountId: string | null;
};

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
