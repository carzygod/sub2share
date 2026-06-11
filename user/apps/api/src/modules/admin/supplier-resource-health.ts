import type { Prisma } from "@prisma/client";
import { internalHealthCheckSupplierResourceSub2AccountId } from "../../common/internal-records.js";

export type SupplierResourceIdentity = {
  sub2AccountId: string | null;
};

export interface SupplierResourceAvailabilityMetricsInput {
  resourcesByStatus: Record<string, number>;
  totalCodexResources: number;
  onlineCodexResources: number;
  ignoredInternalResources: number;
  issueCount: number;
  resourceSampleCount: number;
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
    ignoredInternalResources: input.ignoredInternalResources,
    issueSamples: input.issueCount,
    resourceSamples: input.resourceSampleCount
  };
}
