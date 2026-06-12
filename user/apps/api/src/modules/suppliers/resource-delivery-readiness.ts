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

export function publicProductDeliveryReadinessFields(input: {
  resourceType: string;
  readyCodexDeliveryResources: number;
}) {
  const deliveryRequired = isDeliveryResourceReadinessRequired(input.resourceType);
  const deliveryReady = !deliveryRequired || input.readyCodexDeliveryResources > 0;

  return {
    deliveryRequired,
    deliveryReady,
    readyDeliveryResources: deliveryRequired ? input.readyCodexDeliveryResources : null,
    deliveryBlockedReason: deliveryReady ? null : "codex_resource_not_ready_for_delivery"
  };
}

export function codexCatalogDeliveryReadinessIssueFields(input: {
  productId: string;
  productName: string;
  priceId?: string;
  resourceType: string;
  readyCodexDeliveryResources: number;
}) {
  if (input.resourceType !== "codex" || input.readyCodexDeliveryResources > 0) return null;

  return {
    type: "active_codex_product_without_ready_delivery_resource",
    productId: input.productId,
    productName: input.productName,
    priceId: input.priceId,
    resourceType: "codex",
    resourceList: true,
    resourceScope: "production" as const,
    resourceStatus: "online",
    repairAction: "apply_openai_refresh_token_to_sub2_account",
    actionHint: "Create or repair a production Codex shared resource with a Sub2 account id and an active OpenAI refresh token credential before selling Codex access.",
    message: `Active Codex product ${input.productName} is purchasable but no ready production Codex shared resource is available for delivery.`
  };
}

export function isPurchasableProductPrice(input: {
  billingMode: string;
  fixedPrice: unknown;
}) {
  return input.billingMode === "pay_as_you_go" || input.fixedPrice !== null;
}

export function shouldBlockUnavailableCodexProductActivation(input: {
  resourceType: string;
  productStatus: string;
  readyCodexDeliveryResources: number;
  allowUnavailableDelivery?: boolean;
}) {
  return input.resourceType === "codex"
    && input.productStatus === "active"
    && input.readyCodexDeliveryResources <= 0
    && input.allowUnavailableDelivery !== true;
}

export function shouldBlockUnavailableCodexPriceActivation(input: {
  resourceType: string;
  productStatus: string;
  priceStatus: string;
  billingMode: string;
  fixedPrice: unknown;
  readyCodexDeliveryResources: number;
  allowUnavailableDelivery?: boolean;
}) {
  return shouldBlockUnavailableCodexProductActivation({
    resourceType: input.resourceType,
    productStatus: input.productStatus,
    readyCodexDeliveryResources: input.readyCodexDeliveryResources,
    allowUnavailableDelivery: input.allowUnavailableDelivery
  }) && input.priceStatus === "active" && isPurchasableProductPrice(input);
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
