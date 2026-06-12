import type { Prisma } from "@prisma/client";
import { AppError } from "../../common/errors.js";
import { internalHealthCheckSupplierResourceSub2AccountId } from "../../common/internal-records.js";
import { prisma } from "../../common/prisma.js";

const deliverySupplierResourceSelect = {
  id: true,
  resourceType: true,
  status: true,
  sub2AccountId: true,
  credential: { select: { id: true, credentialType: true, status: true } }
} satisfies Prisma.SupplierResourceSelect;

export type DeliverySupplierResource = Prisma.SupplierResourceGetPayload<{
  select: typeof deliverySupplierResourceSelect;
}>;

export function isDeliveryResourceReadinessRequired(resourceType: string) {
  return resourceType === "codex";
}

export function readyCodexSupplierResourceDeliveryWhere(): Prisma.SupplierResourceWhereInput {
  return {
    resourceType: "codex",
    status: "online",
    sub2AccountId: { not: null },
    NOT: { sub2AccountId: internalHealthCheckSupplierResourceSub2AccountId },
    credential: { is: { credentialType: "openai_refresh_token", status: "active" } }
  };
}

export function codexDeliveryResourceMissingDetails(resourceType: string) {
  return {
    resourceType,
    requiredStatus: "online",
    requiredCredentialType: "openai_refresh_token",
    requiredCredentialStatus: "active",
    excludedSub2AccountId: internalHealthCheckSupplierResourceSub2AccountId
  };
}

export async function findReadySupplierResourceForDelivery(resourceType: string) {
  if (!isDeliveryResourceReadinessRequired(resourceType)) return null;

  return prisma.supplierResource.findFirst({
    where: readyCodexSupplierResourceDeliveryWhere(),
    select: deliverySupplierResourceSelect,
    orderBy: { updatedAt: "desc" }
  });
}

export async function requireReadySupplierResourceForDelivery(resourceType: string) {
  if (!isDeliveryResourceReadinessRequired(resourceType)) {
    return { required: false as const, resource: null };
  }

  const resource = await findReadySupplierResourceForDelivery(resourceType);
  if (!resource) {
    throw new AppError(
      "codex_resource_not_ready_for_delivery",
      "No ready online production Codex shared resource is available for delivery",
      503,
      codexDeliveryResourceMissingDetails(resourceType)
    );
  }

  return { required: true as const, resource };
}
