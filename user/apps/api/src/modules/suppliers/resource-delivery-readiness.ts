import type { Prisma } from "@prisma/client";
import { AppError } from "../../common/errors.js";
import { internalHealthCheckSupplierResourceSub2AccountId } from "../../common/internal-records.js";
import { prisma } from "../../common/prisma.js";
import {
  latestLocalProxySmokeEvidence,
  localProxySmokeFailureSummary,
  type LocalProxySmokeAuditLog,
  type LocalProxySmokeEvidence
} from "../admin/local-proxy-smoke-health.js";

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

export const codexDeliveryLocalProxySmokeFreshMs = 24 * 60 * 60 * 1000;
const codexDeliveryLocalProxySmokeAuditScanLimit = 300;
const codexDeliveryLocalProxySmokeActions = [
  "admin.sub2.proxy_smoke_test",
  "admin.resource.credential_apply_sub2",
  "admin.sub2.account.apply_openai_refresh_token"
] as const;

const codexDeliveryLocalProxySmokeAuditSelect = {
  id: true,
  action: true,
  objectId: true,
  after: true,
  createdAt: true
} satisfies Prisma.AuditLogSelect;

export interface CodexProxySmokeDeliveryReadiness {
  required: boolean;
  ok: boolean;
  reason: string | null;
  message: string | null;
  latest: CodexProxySmokeDeliveryEvidence | null;
}

export interface CodexProxySmokeDeliveryEvidence {
  auditLogId: string;
  auditAction: string;
  objectId: string | null;
  resourceId: string | null;
  sub2AccountId: string | null;
  createdAt: string;
  ageMinutes: number;
  stale: boolean;
  staleThresholdMinutes: number;
  freshMinutesRemaining: number;
  staleAt: string;
  ok: boolean;
  model: string | null;
  modelsOk: boolean | null;
  modelsStatusCode: number | null;
  modelsError: string | null;
  responsesOk: boolean | null;
  responsesStatusCode: number | null;
  responsesErrorType: string | null;
  responsesErrorMessage: string | null;
  localProxyOk: boolean | null;
  smokeTestSkippedReason: string | null;
  proxyRequestLogId: string | null;
  requestId: string | null;
  upstreamRequestId: string | null;
  proxyRequestPath: string | null;
  proxyRequestStatusCode: number | null;
  proxyRequestErrorCode: string | null;
}

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
  codexProxySmokeDeliveryReadiness?: CodexProxySmokeDeliveryReadiness | null;
}) {
  const deliveryRequired = isDeliveryResourceReadinessRequired(input.resourceType);
  const proxyReady = !deliveryRequired || input.codexProxySmokeDeliveryReadiness?.ok !== false;
  const deliveryReady = !deliveryRequired || (input.readyCodexDeliveryResources > 0 && proxyReady);

  return {
    deliveryRequired,
    deliveryReady,
    readyDeliveryResources: deliveryRequired ? input.readyCodexDeliveryResources : null,
    deliveryBlockedReason: deliveryReady
      ? null
      : input.readyCodexDeliveryResources <= 0 ? "codex_resource_not_ready_for_delivery" : "codex_proxy_smoke_failed_for_delivery",
    codexProxySmokeDeliveryReady: deliveryRequired ? proxyReady : null,
    codexProxySmokeDeliveryLatest: deliveryRequired ? input.codexProxySmokeDeliveryReadiness?.latest ?? null : null
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

export function inspectCodexProxySmokeDeliveryReadiness(input: {
  resourceType: string;
  latest: LocalProxySmokeEvidence | null;
  checkedAt?: Date;
  freshMs?: number;
}): CodexProxySmokeDeliveryReadiness {
  if (!isDeliveryResourceReadinessRequired(input.resourceType)) {
    return { required: false, ok: true, reason: null, message: null, latest: null };
  }
  const latest = input.latest;
  if (!latest) {
    return { required: true, ok: true, reason: null, message: null, latest: null };
  }

  const checkedAt = input.checkedAt ?? new Date();
  const freshMs = input.freshMs ?? codexDeliveryLocalProxySmokeFreshMs;
  const ageMs = Math.max(0, checkedAt.getTime() - latest.createdAt.getTime());
  const stale = ageMs > freshMs;
  const evidence = codexProxySmokeDeliveryEvidence(latest, ageMs, stale, freshMs);
  const blocked = !stale && isBlockingCodexProxySmokeFailure(latest);

  return {
    required: true,
    ok: !blocked,
    reason: blocked ? "codex_proxy_smoke_failed_for_delivery" : null,
    message: blocked ? localProxySmokeFailureSummary(latest) : null,
    latest: evidence
  };
}

export async function inspectLatestCodexProxySmokeDeliveryReadiness(resourceType: string) {
  if (!isDeliveryResourceReadinessRequired(resourceType)) {
    return inspectCodexProxySmokeDeliveryReadiness({ resourceType, latest: null });
  }

  const logs = await prisma.auditLog.findMany({
    where: { action: { in: [...codexDeliveryLocalProxySmokeActions] } },
    select: codexDeliveryLocalProxySmokeAuditSelect,
    orderBy: { createdAt: "desc" },
    take: codexDeliveryLocalProxySmokeAuditScanLimit
  });

  return inspectCodexProxySmokeDeliveryReadiness({
    resourceType,
    latest: latestLocalProxySmokeEvidence(logs as LocalProxySmokeAuditLog[])
  });
}

export async function requireReadySupplierResourceForDelivery(resourceType: string) {
  if (!isDeliveryResourceReadinessRequired(resourceType)) {
    return { required: false as const, resource: null };
  }

  const [resource, proxySmokeReadiness] = await Promise.all([
    findReadySupplierResourceForDelivery(resourceType),
    inspectLatestCodexProxySmokeDeliveryReadiness(resourceType)
  ]);
  if (!resource) {
    throw new AppError(
      "codex_resource_not_ready_for_delivery",
      "No ready online production Codex shared resource is available for delivery",
      503,
      codexDeliveryResourceMissingDetails(resourceType)
    );
  }
  if (!proxySmokeReadiness.ok) {
    throw new AppError(
      "codex_proxy_smoke_failed_for_delivery",
      "Latest local OpenAI/Codex proxy smoke test is failing; Codex delivery is paused until the proxy path passes again",
      503,
      {
        ...codexDeliveryResourceMissingDetails(resourceType),
        proxySmoke: proxySmokeReadiness
      }
    );
  }

  return { required: true as const, resource };
}

function isBlockingCodexProxySmokeFailure(smoke: LocalProxySmokeEvidence) {
  if (smoke.smokeTestSkippedReason) return false;
  return smoke.modelsOk === false || smoke.responsesOk === false || smoke.localProxyOk === false;
}

function codexProxySmokeDeliveryEvidence(
  smoke: LocalProxySmokeEvidence,
  ageMs: number,
  stale: boolean,
  freshMs: number
): CodexProxySmokeDeliveryEvidence {
  const ageMinutes = Math.floor(ageMs / 60_000);
  const staleThresholdMinutes = Math.floor(freshMs / 60_000);
  return {
    auditLogId: smoke.auditLogId,
    auditAction: smoke.action,
    objectId: smoke.objectId ?? null,
    resourceId: smoke.resourceId ?? null,
    sub2AccountId: smoke.sub2AccountId ?? null,
    createdAt: smoke.createdAt.toISOString(),
    ageMinutes,
    stale,
    staleThresholdMinutes,
    freshMinutesRemaining: Math.max(0, staleThresholdMinutes - ageMinutes),
    staleAt: new Date(smoke.createdAt.getTime() + freshMs).toISOString(),
    ok: smoke.ok,
    model: smoke.model ?? null,
    modelsOk: smoke.modelsOk,
    modelsStatusCode: smoke.modelsStatusCode,
    modelsError: smoke.modelsError,
    responsesOk: smoke.responsesOk,
    responsesStatusCode: smoke.responsesStatusCode,
    responsesErrorType: smoke.responsesErrorType,
    responsesErrorMessage: smoke.responsesErrorMessage,
    localProxyOk: smoke.localProxyOk,
    smokeTestSkippedReason: smoke.smokeTestSkippedReason,
    proxyRequestLogId: smoke.proxyRequestLogId ?? null,
    requestId: smoke.requestId ?? null,
    upstreamRequestId: smoke.upstreamRequestId ?? null,
    proxyRequestPath: smoke.proxyRequestPath ?? null,
    proxyRequestStatusCode: smoke.proxyRequestStatusCode ?? null,
    proxyRequestErrorCode: smoke.proxyRequestErrorCode ?? null
  };
}
