import type { FastifyInstance, FastifyReply } from "fastify";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { inspectAdminSurfaceCoverage } from "@zyz/shared/admin-surfaces";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "../../common/auth.js";
import { AppError } from "../../common/errors.js";
import {
  legacyE2eUserEmailDomain,
  legacyE2eUserEmailPrefix,
  legacyHealthCheckUserEmailDomain,
  legacyHealthCheckUserEmailPrefix,
  legacyLocalProxySmokeProductPrefix,
  legacySmokeWithdrawalNotePrefix,
  legacySmokeWithdrawalPayoutRefPrefix,
  localProxySmokeBuyerId,
  localProxySmokeProductName,
  localProxySmokeUserEmail
} from "../../common/internal-records.js";
import { prisma } from "../../common/prisma.js";
import { ok } from "../../common/response.js";
import { inspectApiCorsPolicy } from "../../common/cors.js";
import { env, openAiProxyPublicEndpoint } from "../../config/env.js";
import { sub2Client, type Sub2GatewayAccountTestResult, type Sub2KeyResult, type Sub2ProxySmokeTestResult } from "../../integrations/sub2/client.js";
import { expireOverdueRentals } from "../../jobs/expire-overdue-rentals.js";
import { releaseAvailableSettlements } from "../../jobs/release-settlements.js";
import { getSub2UsageSyncState, syncSub2UsageOnce } from "../../jobs/sync-sub2-usage.js";
import { inspectOpenAiProxyContract, normalizeProxyRequestLookup } from "../openai-proxy/helpers.js";
import { inspectOpenAiProxyRuntimeState } from "../openai-proxy/limiter-store.js";
import { inspectOAuthStateStoreReadiness } from "../auth/oauth-state-store.js";
import { inspectAuthTokenConfig } from "../auth/token-config.js";
import { rotateRentalApiKey } from "../rentals/key-rotation.js";
import { recordOrderStatusHistory } from "../orders/status-history.js";
import { decryptSupplierResourceCredential, encryptSupplierResourceCredential } from "../suppliers/resource-credential-crypto.js";
import {
  codexCatalogDeliveryReadinessIssueFields,
  codexDeliveryResourceMissingDetails,
  codexProxySmokeDeliveryIssueFields,
  inspectLatestCodexProxySmokeDeliveryReadiness,
  isPurchasableProductPrice,
  publicProductDeliveryReadinessFields,
  readyCodexSupplierResourceDeliveryWhere,
  requireReadySupplierResourceForDelivery,
  shouldBlockUnavailableCodexPriceActivation,
  shouldBlockUnavailableCodexProductActivation
} from "../suppliers/resource-delivery-readiness.js";
import {
  adminCapabilities,
  inspectAdminCapabilityRouteCoverage,
  type AdminCapabilityOperation
} from "./capabilities.js";
import { inspectCurrentDeploymentRuntime } from "./deployment-runtime.js";
import { initialResourceCredentialCreateData } from "./resource-credential-create.js";
import {
  resourceCredentialCodexResourceListFields,
  resourceCredentialRepairCandidateFields,
  resourceCredentialSub2AccountRepairSamples,
  type ResourceCredentialSub2AccountCandidate
} from "./resource-credential-health.js";
import { nonSmokeSub2Bindings } from "./sub2-binding-health.js";
import {
  extractFrontendAssetReferences,
  inspectFrontendRuntime,
  type FrontendAssetProbe,
  type FrontendEndpointName,
  type FrontendEndpointProbe,
  type FrontendRuntimeHealth
} from "./frontend-runtime-health.js";
import {
  attachLocalProxySmokeIssueRepairCandidate,
  localProxySmokeEvidenceCandidates,
  localProxySmokeEvidenceIssue,
  localProxySmokeFailureIssueActionHint,
  localProxySmokeFailureIssueMessage,
  localProxySmokeEvidenceSummary,
  type LocalProxySmokeEvidenceIssue
} from "./local-proxy-smoke-health.js";
import { inspectPaymentProviderHealth, type PaymentRechargeActivitySummary } from "./payment-provider-health.js";
import {
  internalHealthCheckSupplierResourceWhere,
  inspectSupplierResourceManualOnlineReadiness,
  inspectSupplierResourceReadinessMutationStatusTransition,
  inspectSupplierResourceTestStatusTransition,
  nonSmokeSupplierResourceWhere,
  supplierResourceAvailabilityMetrics,
  supplierResourceMissingCodexIssueFields,
  type SupplierResourceStatus
} from "./supplier-resource-health.js";
import {
  buildSub2UpstreamIssues,
  sub2AccountHealthSamples,
  type Sub2UpstreamIssue
} from "./sub2-upstream-health.js";

const redactedFields = new Set(["passwordHash", "keyHash", "sub2KeyHash", "encryptedValue"]);
const userRoles = ["buyer", "supplier", "operator", "admin"] as const;
const userStatuses = ["active", "disabled", "banned"] as const;
const orderStatuses = ["pending", "paid", "provisioning", "active", "failed", "refunding", "refunded", "expired", "cancelled", "closed"] as const;
const rentalStatuses = ["active", "low_balance", "limited", "suspended", "expired", "refunded", "closed"] as const;
const resourceTypes = ["codex", "claude_code", "gemini", "antigravity"] as const;
const productStatuses = ["draft", "active", "offline"] as const;
const billingModes = ["pay_as_you_go", "daily", "weekly", "monthly"] as const;
const usageStatuses = ["pending", "billed", "refunded", "ignored", "disputed"] as const;
const apiKeyStatuses = ["active", "inactive"] as const;
const supplierStatuses = ["pending", "active", "paused", "disabled"] as const;
const resourceStatuses = ["pending", "testing", "online", "busy", "paused", "abnormal", "disabled"] as const;
const resourceLevels = ["L0", "L1", "L2", "L3", "L4"] as const;
const resourceCredentialTypes = ["openai_refresh_token", "openai_api_key", "custom"] as const;
const resourceCredentialStatuses = ["active", "rotated", "disabled"] as const;
type ResourceStatus = SupplierResourceStatus;
const settlementStatuses = ["pending", "frozen", "available", "withdrawn", "cancelled"] as const;
const withdrawalStatuses = ["pending", "approved", "rejected", "paid", "cancelled"] as const;
const walletManagementStatuses = ["negative", "frozen", "available", "spent"] as const;
export const proxyRequestStatusFilters = [
  "failed",
  "client_error",
  "server_error",
  "upstream_error",
  "local_rejection",
  "local_availability",
  "stream_error"
] as const;
const reconciliationScanLimit = 500;
const reconciliationIssueLimit = 50;
const systemHealthProxyWindowMs = 60 * 60 * 1000;
export const proxyClientRejectionErrorCodes = [
  "missing_api_key",
  "invalid_api_key",
  "user_not_active",
  "insufficient_balance",
  "rental_not_active",
  "rental_expired",
  "key_rental_mismatch",
  "unsupported_resource_type",
  "spend_limit_exhausted",
  "request_limit_exceeded",
  "rpm_limit_exceeded",
  "tpm_limit_exceeded",
  "concurrency_limit_exceeded"
] as const;
const proxyLocalAvailabilityErrorCodes = [
  "proxy_limiter_unavailable",
  "upstream_timeout",
  "upstream_unavailable"
] as const;
const proxyStreamErrorCodes = [
  "upstream_stream_error",
  "upstream_stream_closed",
  "upstream_stream_idle_timeout"
] as const;
const proxyClientRejectionErrorCodeSet = new Set<string>(proxyClientRejectionErrorCodes);
const proxyLocalAvailabilityErrorCodeSet = new Set<string>(proxyLocalAvailabilityErrorCodes);
const proxyStreamErrorCodeSet = new Set<string>(proxyStreamErrorCodes);
const systemHealthBillingSyncStaleMs = 24 * 60 * 60 * 1000;
const systemHealthApiKeyScanLimit = 500;
const systemHealthApiKeyIssueLimit = 50;
const systemHealthOrderStatusIssueLimit = 50;
const systemHealthProductCatalogScanLimit = 200;
const systemHealthProductCatalogIssueLimit = 50;
const systemHealthSalesDeliveryScanLimit = 200;
const systemHealthSalesDeliveryIssueLimit = 50;
const systemHealthPendingUsageScanLimit = 200;
const systemHealthPendingUsageIssueLimit = 50;
const systemHealthLocalSmokeFreshMs = 24 * 60 * 60 * 1000;
const dashboardSystemHealthSnapshotStaleMs = 60 * 60 * 1000;
const systemHealthLocalSmokeCredentialAuditScanLimit = 100;
const systemHealthFrontendProbeTimeoutMs = 3000;
const sub2BindingReconciliationLimit = 500;
const systemHealthStatuses = ["ok", "warning", "error"] as const;
let adminCapabilityRouteExists: ((operation: AdminCapabilityOperation) => boolean) | null = null;

const listQuerySchema = z.object({
  q: z.string().trim().max(160).optional(),
  status: z.string().trim().max(80).optional(),
  resourceType: z.string().trim().max(80).optional(),
  action: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50)
});

type ListQuery = z.infer<typeof listQuerySchema>;

const resourceCredentialSummarySelect = {
  id: true,
  credentialType: true,
  encryptionVersion: true,
  keyFingerprint: true,
  status: true,
  lastRotatedAt: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.SupplierResourceCredentialSelect;

const resourceCredentialPrivateSelect = {
  ...resourceCredentialSummarySelect,
  encryptedValue: true
} satisfies Prisma.SupplierResourceCredentialSelect;
type ResourceCredentialSummary = Prisma.SupplierResourceCredentialGetPayload<{ select: typeof resourceCredentialSummarySelect }>;
type ResourceCredentialPrivate = Prisma.SupplierResourceCredentialGetPayload<{ select: typeof resourceCredentialPrivateSelect }>;

interface BillingReconciliationIssue {
  id: string;
  severity: "warning" | "error";
  type: string;
  message: string;
  refType: string;
  refId: string;
  amount?: string;
  expected?: string;
  actual?: string;
  createdAt?: string;
}

type SystemHealthStatus = "ok" | "warning" | "error";

interface SystemHealthCheck {
  id: string;
  label: string;
  status: SystemHealthStatus;
  summary: string;
  metrics?: Record<string, string | number | boolean | null>;
  detail?: unknown;
}

export interface ProxyRequestHealthMetrics {
  proxyRecentTotal: number;
  proxyRecentClientErrors: number;
  proxyRecentClientRejections: number;
  proxyRecentActionableClientErrors: number;
  proxyRecentServerErrors: number;
  proxyRecentLocalErrors: number;
  proxyRecentClientDisconnects: number;
  proxyRecentStreamErrors: number;
}

export function isProxyClientRejectionErrorCode(errorCode: string | null | undefined) {
  return Boolean(errorCode && proxyClientRejectionErrorCodeSet.has(errorCode));
}

export function proxyRequestHealthStatus(metrics: ProxyRequestHealthMetrics): SystemHealthStatus {
  if (metrics.proxyRecentServerErrors > 0 || metrics.proxyRecentLocalErrors > 0 || metrics.proxyRecentStreamErrors > 0) return "error";
  if (metrics.proxyRecentActionableClientErrors > 0 || metrics.proxyRecentClientDisconnects > 0) return "warning";
  return "ok";
}

export function proxyRequestHealthSummary(metrics: ProxyRequestHealthMetrics) {
  if (metrics.proxyRecentTotal === 0) return "最近 1 小时无反代请求";
  return `${metrics.proxyRecentTotal} 次请求，${metrics.proxyRecentServerErrors} 次 5xx，${metrics.proxyRecentClientErrors} 次 4xx，${metrics.proxyRecentClientRejections} 次本地准入拒绝，${metrics.proxyRecentActionableClientErrors} 次需复查 4xx，${metrics.proxyRecentClientDisconnects} 次客户端断开，${metrics.proxyRecentStreamErrors} 次上游流异常`;
}

function isProxyLocalAvailabilityErrorCode(errorCode: string | null | undefined) {
  return Boolean(errorCode && proxyLocalAvailabilityErrorCodeSet.has(errorCode));
}

function isProxyStreamErrorCode(errorCode: string | null | undefined) {
  return Boolean(errorCode && proxyStreamErrorCodeSet.has(errorCode));
}

function proxyRequestIssueSeverity(log: { statusCode: number | null; errorCode: string | null }) {
  if ((log.statusCode ?? 0) >= 500 || isProxyLocalAvailabilityErrorCode(log.errorCode) || isProxyStreamErrorCode(log.errorCode)) return "error";
  return "warning";
}

interface DashboardHealthCheckPreview {
  id: string;
  label: string;
  status: SystemHealthStatus;
  summary: string;
  metrics?: DashboardHealthMetricPreview;
  issueCount: number;
  sampleCount: number;
  primaryIssue?: DashboardHealthDetailPreview;
  primarySample?: DashboardHealthDetailPreview;
}

type DashboardHealthDetailPreview = Record<string, string | number | boolean | null>;
type DashboardHealthMetricPreview = Record<string, string | number | boolean | null>;

interface DashboardAdminEntryCoverageSide {
  status: SystemHealthStatus;
  summary: string;
  issueCount: number;
  metrics: DashboardHealthMetricPreview;
}

interface DashboardAdminEntryCoveragePreview {
  ok: boolean;
  summary: string;
  api?: DashboardAdminEntryCoverageSide;
  frontend?: DashboardAdminEntryCoverageSide;
}

interface DashboardDeploymentRuntimePreview {
  ok: boolean;
  status: SystemHealthStatus;
  summary: string;
  issueCount: number;
  metrics: DashboardHealthMetricPreview;
  commit?: string | null;
  deployedAt?: string | null;
  releaseRoot?: string | null;
  markerPath?: string | null;
  runningFromReplacedRelease?: boolean | null;
  runningFromStagingRelease?: boolean | null;
  check: DashboardHealthCheckPreview;
}

interface DashboardUpstreamBlockerPreview {
  blocked: boolean;
  status: SystemHealthStatus;
  checkId: string;
  label: string;
  summary: string;
  issueCount: number;
  sampleCount: number;
  actionHint?: string | null;
  repairAction?: string | null;
  sub2AccountId?: string | number | boolean | null;
  sub2AccountName?: string | null;
  accountStatus?: string | null;
  credentialsStatus?: string | null;
  schedulable?: boolean | null;
  tempUnschedulableReason?: string | null;
  accountMessage?: string | null;
  accountErrorStatusCode?: number | null;
  accountErrorType?: string | null;
  accountErrorCode?: string | null;
  accountErrorMessage?: string | null;
  accountUpdatedAt?: string | null;
  resourceId?: string | number | boolean | null;
  resourceList?: string | number | boolean | null;
  resourceType?: string | number | boolean | null;
  resourceScope?: string | number | boolean | null;
  evidencePath?: string | null;
  evidenceStatusCode?: number | null;
  evidenceErrorCode?: string | null;
  evidenceModel?: string | null;
  evidenceResponsesOk?: boolean | null;
  evidenceModelsStatusCode?: number | null;
  evidenceModelsError?: string | null;
  evidenceResponsesStatusCode?: number | null;
  evidenceResponsesErrorType?: string | null;
  evidenceResponsesErrorMessage?: string | null;
  evidenceLocalProxyOk?: boolean | null;
  evidenceAgeMinutes?: number | null;
  evidenceStale?: boolean | null;
  evidenceStaleThresholdMinutes?: number | null;
  evidenceFreshMinutesRemaining?: number | null;
  evidenceStaleAt?: string | null;
  proxyRequestFilterStatus?: string | null;
  proxyRequestFilterLookup?: string | null;
  credentialReadiness?: DashboardUpstreamCredentialReadinessPreview;
  check: DashboardHealthCheckPreview;
}

interface DashboardUpstreamCredentialReadinessPreview {
  status: SystemHealthStatus;
  summary: string;
  issueCount: number;
  sampleCount: number;
  metrics?: DashboardHealthMetricPreview;
}

interface DashboardDeliveryBlockerPreview {
  blocked: boolean;
  status: SystemHealthStatus;
  checkId: string;
  label: string;
  summary: string;
  issueCount: number;
  sampleCount: number;
  actionHint?: string | null;
  repairAction?: string | null;
  productId?: string | null;
  productName?: string | null;
  priceId?: string | null;
  orderId?: string | null;
  rentalId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  supplierEmail?: string | null;
  resourceId?: string | number | boolean | null;
  resourceList?: string | number | boolean | null;
  resourceType?: string | number | boolean | null;
  resourceStatus?: string | null;
  resourceScope?: string | number | boolean | null;
  sub2AccountId?: string | number | boolean | null;
  sub2AccountName?: string | null;
  accountStatus?: string | null;
  credentialsStatus?: string | null;
  schedulable?: boolean | null;
  accountMessage?: string | null;
  accountErrorStatusCode?: number | null;
  accountErrorType?: string | null;
  accountErrorCode?: string | null;
  accountErrorMessage?: string | null;
  proxyRequestFilterStatus?: string | null;
  proxyRequestFilterLookup?: string | null;
  check: DashboardHealthCheckPreview;
}

interface DashboardManagementStatusCount {
  status: string;
  count: number;
  totalAmount?: string | number | null;
  paidAmount?: string | number | null;
}

interface DashboardWalletManagementOverview {
  total: number;
  negative: number;
  frozen: number;
  available: number;
  spent: number;
}

const dashboardHealthDetailPreviewFields = [
  "id",
  "type",
  "sampleType",
  "severity",
  "repairAction",
  "actionHint",
  "sub2Status",
  "sub2AccountId",
  "sub2AccountName",
  "accountStatus",
  "credentialsStatus",
  "schedulable",
  "tempUnschedulableReason",
  "accountMessage",
  "accountErrorStatusCode",
  "accountErrorType",
  "accountErrorCode",
  "accountErrorMessage",
  "updatedAt",
  "resourceId",
  "resourceList",
  "resourceType",
  "resourceStatus",
  "resourceScope",
  "supplierEmail",
  "productId",
  "productName",
  "priceId",
  "orderId",
  "rentalId",
  "userId",
  "userEmail",
  "requestId",
  "proxyRequestLookup",
  "proxyRequestLogId",
  "upstreamRequestId",
  "proxyRequestPath",
  "proxyRequestStatusCode",
  "upstreamStatusCode",
  "proxyRequestErrorCode",
  "model",
  "modelsOk",
  "modelsStatusCode",
  "modelsError",
  "responsesOk",
  "responsesStatusCode",
  "responsesErrorType",
  "responsesErrorMessage",
  "localProxyOk",
  "smokeTestSkippedReason",
  "ageMinutes",
  "stale",
  "staleThresholdMinutes",
  "freshMinutesRemaining",
  "staleAt",
  "auditLogId",
  "auditAction",
  "keyDisabled",
  "proxyRequestLogCount",
  "walletTransactionList",
  "walletTransactionType",
  "walletTransactionId",
  "walletLookup",
  "walletList",
  "walletId",
  "userId",
  "salesList",
  "message"
] as const;

const dashboardHealthMetricPreviewFields = [
  "requiredAreas",
  "coveredRequiredAreas",
  "totalOperations",
  "criticalOperations",
  "registeredOperations",
  "missingRoutes",
  "operationsWithTargets",
  "missingTargets",
  "navigationItems",
  "managedListViews",
  "criticalViews",
  "duplicateViews",
  "endpoint",
  "endpointProtocol",
  "endpointEndsWithV1",
  "routePath",
  "routePaths",
  "supportsV1BasePath",
  "routeMethods",
  "supportsAllV1ChildPaths",
  "routesV1BasePath",
  "supportsReadMethods",
  "supportsMutationMethods",
  "routesResponsesApi",
  "routesResponsesItems",
  "routesResponsesLifecycle",
  "routesChatCompletions",
  "routesConversationsApi",
  "routesModelMetadata",
  "routesEmbeddings",
  "routesAssistantsApi",
  "routesThreadsRuns",
  "routesVectorStores",
  "routesFileUploadApis",
  "routesBatchApis",
  "routesAudioImageApis",
  "routesVideoApis",
  "routesFineTuningJobs",
  "routesModerationsApi",
  "routesEvalsApi",
  "routesContainersApi",
  "routesRealtimeApi",
  "corePathSamples",
  "routesCorePathSamples",
  "preservesRawPathAndQuery",
  "normalizesSub2BaseTrailingSlash",
  "forwardsUpstreamHeaders",
  "requestIdHeader",
  "upstreamRequestIdHeaders",
  "rateLimitHeaders",
  "proxyRequestLookupHeaders",
  "corsExposesRequestId",
  "corsExposesUpstreamRequestIds",
  "corsExposesRateLimitHeaders",
  "setsLocalRateLimitHeaders",
  "normalizesProxyRequestLookupHeaders",
  "requestBodyMode",
  "parsesAllContentTypesAsBuffer",
  "forwardsOriginalBodyBytes",
  "bodylessMethods",
  "bodyLimitBytes",
  "upstreamTimeoutMs",
  "streamIdleTimeoutMs",
  "upstreamAcceptEncoding",
  "stripsInboundAuthorization",
  "stripsInboundAcceptEncoding",
  "reinjectsLocalBearerToSub2",
  "extractsMultipartModelForLogs",
  "extractsFormUrlEncodedModelForLogs",
  "extractsUrlModelForLogs",
  "forwardsRequestId",
  "capturesUpstreamRequestId",
  "forwardsForwardedHostAndProto",
  "abortsUpstreamOnClientClose",
  "logsStreamCompletion",
  "logsStreamErrors",
  "hasStreamIdleTimeout",
  "insufficientQuotaErrorType",
  "rateLimitErrorType",
  "apiErrorType",
  "localErrorPayloadIncludesParam",
  "nodeEnv",
  "cwd",
  "releaseRoot",
  "releaseRootName",
  "markerPath",
  "markerPresent",
  "commit",
  "deployedAt",
  "runningFromReplacedRelease",
  "runningFromStagingRelease",
  "encryptionSecretConfigured",
  "encryptionVersion",
  "totalCredentials",
  "activeOpenAiRefreshTokens",
  "activeApplicableCredentials",
  "activeMissingSub2Account",
  "inactiveOpenAiRefreshTokens",
  "storeMode",
  "limiterScope",
  "shared",
  "redisReachable",
  "rateWindowMs",
  "rateWindowCleanupIntervalMs",
  "activeConcurrencyRentals",
  "activeConcurrencyLeases",
  "activeRateWindowRentals",
  "activeRateWindowRequests",
  "activeRateWindowTokenEvents",
  "activeRateWindowEstimatedTokens",
  "lastRateWindowCleanupAt"
] as const;

interface AdminSurfaceCoverageIssue {
  id: string;
  type: "required_surface_area_missing" | "managed_list_view_missing" | "duplicate_navigation_view";
  severity: "error";
  areaId?: string;
  view?: string;
  refId?: string;
  message: string;
  actionHint: string;
}

interface OrderStatusIssue {
  id: string;
  type: string;
  severity: "warning";
  orderId: string;
  userId: string;
  userEmail?: string | null;
  orderStatus: string;
  paidAmount: string;
  rentalId?: string;
  message: string;
}

interface Sub2BindingIssue {
  id: string;
  type: string;
  severity: "warning" | "error";
  rentalId?: string;
  bindingId?: string;
  sub2Type?: string;
  expected?: string | null;
  actual?: string | null;
  message: string;
}

interface ApiKeyReadinessIssue {
  id: string;
  type: string;
  severity: "warning" | "error";
  apiKeyId: string;
  rentalId?: string | null;
  userId: string;
  keyPrefix: string;
  message: string;
}

interface SalesDeliveryIssue {
  id: string;
  type: string;
  severity: "error";
  orderId: string;
  userId: string;
  userEmail?: string | null;
  rentalId?: string;
  resourceId?: string | null;
  resourceList?: boolean;
  resourceScope?: "production";
  resourceType?: string;
  resourceStatus?: string | null;
  supplierEmail?: string | null;
  sub2AccountId?: string | null;
  auditLogId?: string | null;
  auditAction?: string | null;
  model?: string | null;
  modelsOk?: boolean | null;
  modelsStatusCode?: number | null;
  modelsError?: string | null;
  responsesOk?: boolean | null;
  responsesStatusCode?: number | null;
  responsesErrorType?: string | null;
  responsesErrorMessage?: string | null;
  localProxyOk?: boolean | null;
  smokeTestSkippedReason?: string | null;
  proxyRequestLogId?: string | null;
  requestId?: string | null;
  upstreamRequestId?: string | null;
  proxyRequestPath?: string | null;
  proxyRequestStatusCode?: number | null;
  proxyRequestErrorCode?: string | null;
  ageMinutes?: number | null;
  stale?: boolean | null;
  staleThresholdMinutes?: number | null;
  freshMinutesRemaining?: number | null;
  staleAt?: string | null;
  repairAction?: string;
  actionHint?: string;
  message: string;
}

interface ProductCatalogIssue {
  id: string;
  type: string;
  severity: "warning";
  productId?: string | null;
  productName?: string | null;
  priceId?: string | null;
  resourceType?: string;
  resourceList?: boolean;
  resourceScope?: "production";
  resourceStatus?: string | null;
  auditLogId?: string | null;
  auditAction?: string | null;
  sub2AccountId?: string | null;
  model?: string | null;
  modelsOk?: boolean | null;
  modelsStatusCode?: number | null;
  modelsError?: string | null;
  responsesOk?: boolean | null;
  responsesStatusCode?: number | null;
  responsesErrorType?: string | null;
  responsesErrorMessage?: string | null;
  localProxyOk?: boolean | null;
  smokeTestSkippedReason?: string | null;
  proxyRequestLogId?: string | null;
  requestId?: string | null;
  upstreamRequestId?: string | null;
  proxyRequestPath?: string | null;
  proxyRequestStatusCode?: number | null;
  proxyRequestErrorCode?: string | null;
  ageMinutes?: number | null;
  stale?: boolean | null;
  staleThresholdMinutes?: number | null;
  freshMinutesRemaining?: number | null;
  staleAt?: string | null;
  repairAction?: string;
  actionHint?: string;
  message: string;
}

interface ResourceAvailabilityIssue {
  id: string;
  type: string;
  severity: "warning";
  resourceId?: string;
  resourceList?: boolean;
  resourceScope?: "production";
  resourceStatus?: string | null;
  resourceType?: string | null;
  supplierEmail?: string | null;
  sub2AccountId?: number | string | null;
  sub2AccountName?: string | null;
  accountStatus?: string | null;
  credentialsStatus?: string | null;
  schedulable?: boolean | null;
  repairAction?: string;
  actionHint: string;
  message: string;
}

interface PendingUsageBillingIssue {
  id: string;
  type: string;
  severity: "warning" | "error";
  usageId: string;
  rentalId: string;
  rentalStatus?: string | null;
  userId: string;
  userEmail?: string | null;
  buyerCharge: string;
  supplierIncome: string;
  occurredAt: string;
  ageMinutes: number;
  message: string;
}

interface ResourceCredentialReadinessIssue {
  id: string;
  type: string;
  severity: "warning" | "error";
  resourceId?: string;
  resourceList?: boolean;
  resourceScope?: "production";
  resourceType?: string | null;
  resourceStatus?: string | null;
  refId?: string;
  sub2Status?: boolean;
  sub2AccountId?: number | string | null;
  sub2AccountName?: string | null;
  accountStatus?: string | null;
  credentialsStatus?: string | null;
  schedulable?: boolean | null;
  repairAction?: string;
  actionHint?: string;
  message: string;
}

const orderDetailInclude = {
  user: { include: { roles: true, wallet: true } },
  items: { include: { product: true } },
  rentals: {
    include: {
      product: true,
      limits: true,
      supplierResource: { include: { supplier: { include: { user: true } } } },
      apiKeys: { orderBy: { createdAt: "desc" }, take: 20 }
    },
    orderBy: { createdAt: "desc" }
  },
  statusHistory: { orderBy: { createdAt: "desc" }, take: 50 }
} satisfies Prisma.OrderInclude;
type OrderDetailRecord = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;

const withdrawalInclude = {
  supplier: { include: { user: true } },
  settlements: {
    include: { settlementRecord: true },
    orderBy: { createdAt: "asc" }
  }
} satisfies Prisma.WithdrawalInclude;

const userStatusSchema = z.object({
  status: z.enum(["active", "disabled", "banned"])
});

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(64).optional(),
  roles: z.array(z.enum(userRoles)).min(1).default(["buyer"])
});

const nullableProfileText = (max: number) => z.union([z.string().trim().min(1).max(max), z.null()]).optional();

const updateUserSchema = z.object({
  displayName: nullableProfileText(64),
  phone: nullableProfileText(32),
  password: z.string().min(8).max(200).optional()
}).refine((input) => Object.values(input).some((value) => value !== undefined), {
  message: "At least one user field must be provided"
});

const userRolesSchema = z.object({
  roles: z.array(z.enum(userRoles)).min(1)
});

const walletAdjustSchema = z.object({
  amount: z.coerce.number().refine((value) => value !== 0, "Amount cannot be zero"),
  note: z.string().max(240).optional()
});

const orderActionSchema = z.object({
  note: z.string().trim().max(500).optional()
});

const rentalStatusSchema = z.object({
  status: z.enum(rentalStatuses)
});

const nullablePositiveInteger = z.union([z.coerce.number().int().positive(), z.null()]).optional();
const nullablePositiveDecimal = z.union([z.coerce.number().positive(), z.null()]).optional();
const nullableNonNegativeDecimal = z.union([z.coerce.number().nonnegative(), z.null()]).optional();

const rentalLimitsSchema = z.object({
  maxConcurrency: z.coerce.number().int().min(1).max(200).optional(),
  rpmLimit: nullablePositiveInteger,
  tpmLimit: nullablePositiveInteger,
  requestLimit: nullablePositiveInteger,
  spendLimit: nullablePositiveDecimal,
  remainingSpend: nullableNonNegativeDecimal
}).refine((input) => Object.values(input).some((value) => value !== undefined), {
  message: "At least one limit field must be provided"
});

const rentalSupplierResourceSchema = z.object({
  supplierResourceId: z.union([z.string().trim().min(1).max(120), z.null()]),
  requireReady: z.boolean().default(true),
  note: z.string().trim().max(500).optional()
});

const apiKeyStatusSchema = z.object({
  status: z.enum(apiKeyStatuses)
});

const apiKeyBulkStatusSchema = z.object({
  status: z.enum(apiKeyStatuses),
  q: z.string().trim().max(160).optional(),
  currentStatus: z.enum(apiKeyStatuses).optional(),
  resourceType: z.enum(resourceTypes).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500)
});

const createProductSchema = z.object({
  name: z.string().trim().min(1).max(120),
  resourceType: z.enum(resourceTypes),
  billingMode: z.enum(billingModes).default("monthly"),
  status: z.enum(productStatuses).default("draft"),
  description: z.string().trim().max(2000).optional(),
  allowUnavailableDelivery: z.boolean().default(false)
});

const updateProductSchema = createProductSchema
  .partial()
  .extend({
    description: z.union([z.string().trim().max(2000), z.null()]).optional(),
    allowUnavailableDelivery: z.boolean().default(false)
  })
  .refine((input) => input.name !== undefined
    || input.resourceType !== undefined
    || input.billingMode !== undefined
    || input.status !== undefined
    || input.description !== undefined, {
    message: "At least one product field must be provided"
  });

const createProductPriceSchema = z.object({
  tierCode: z.string().trim().min(1).max(80).regex(/^[a-z0-9_-]+$/),
  displayName: z.string().trim().min(1).max(120),
  fixedPrice: nullablePositiveDecimal,
  durationDays: z.coerce.number().int().positive().optional(),
  maxConcurrency: z.coerce.number().int().min(1).max(200).default(1),
  rpmLimit: z.coerce.number().int().positive().optional(),
  tpmLimit: z.coerce.number().int().positive().optional(),
  requestLimit: z.coerce.number().int().positive().optional(),
  spendLimit: z.coerce.number().positive().optional(),
  discountRate: z.coerce.number().min(0).max(1).default(0.2),
  tierMultiplier: z.coerce.number().positive().default(1),
  status: z.enum(productStatuses).default("active"),
  allowUnavailableDelivery: z.boolean().default(false)
});

const updateProductPriceSchema = createProductPriceSchema
  .omit({ tierCode: true })
  .partial()
  .extend({
    durationDays: nullablePositiveInteger,
    rpmLimit: nullablePositiveInteger,
    tpmLimit: nullablePositiveInteger,
    requestLimit: nullablePositiveInteger,
    spendLimit: nullablePositiveDecimal,
    allowUnavailableDelivery: z.boolean().default(false)
  })
  .refine((input) => input.displayName !== undefined
    || input.fixedPrice !== undefined
    || input.durationDays !== undefined
    || input.maxConcurrency !== undefined
    || input.rpmLimit !== undefined
    || input.tpmLimit !== undefined
    || input.requestLimit !== undefined
    || input.spendLimit !== undefined
    || input.discountRate !== undefined
    || input.tierMultiplier !== undefined
    || input.status !== undefined, {
    message: "At least one product price field must be provided"
  });

const resourceStatusSchema = z.object({
  status: z.enum(resourceStatuses),
  level: z.enum(resourceLevels).optional(),
  sub2AccountId: z.string().trim().min(1).nullable().optional()
});

const updateResourceSchema = z.object({
  status: z.enum(resourceStatuses).optional(),
  level: z.enum(resourceLevels).optional(),
  maxConcurrency: z.coerce.number().int().min(1).max(200).optional(),
  shareRate: z.coerce.number().min(0).max(1).optional(),
  reserveRatio: z.coerce.number().min(0).max(1).optional(),
  dailyCap: z.union([z.coerce.number().positive(), z.null()]).optional(),
  sub2AccountId: z.string().trim().min(1).nullable().optional()
}).refine((input) => Object.values(input).some((value) => value !== undefined), {
  message: "At least one resource field must be provided"
});

const createResourceSchema = z.object({
  supplierEmail: z.string().email(),
  displayName: z.string().trim().min(1).max(64).optional(),
  resourceType: z.enum(["codex", "claude_code", "gemini", "antigravity"]),
  status: z.enum(["pending", "testing", "online", "busy", "paused", "abnormal", "disabled"]).default("pending"),
  level: z.enum(resourceLevels).default("L0"),
  maxConcurrency: z.coerce.number().int().min(1).max(200).default(1),
  shareRate: z.coerce.number().min(0).max(1).default(0.7),
  reserveRatio: z.coerce.number().min(0).max(1).default(0.2),
  dailyCap: z.coerce.number().positive().optional(),
  sub2AccountId: z.string().trim().min(1).optional(),
  credentialType: z.enum(resourceCredentialTypes).optional(),
  credentialStatus: z.enum(resourceCredentialStatuses).optional(),
  credentialSecret: z.string().trim().min(8).max(20_000).optional(),
  applyCredentialToSub2: z.boolean().default(false),
  credentialClientId: z.string().trim().min(1).max(240).optional(),
  credentialProxyId: z.coerce.number().int().positive().optional(),
  credentialRunSmokeTest: z.boolean().default(false),
  credentialSmokeModel: z.string().trim().min(1).max(160).optional()
});

const upsertResourceCredentialSchema = z.object({
  credentialType: z.enum(resourceCredentialTypes),
  status: z.enum(resourceCredentialStatuses).default("active"),
  secret: z.string().trim().min(8).max(20_000)
});

const applyResourceCredentialToSub2Schema = z.object({
  clientId: z.string().trim().min(1).max(240).optional(),
  proxyId: z.coerce.number().int().positive().optional(),
  runSmokeTest: z.boolean().default(false),
  smokeModel: z.string().trim().min(1).max(160).optional()
});
type ApplyResourceCredentialToSub2Input = z.infer<typeof applyResourceCredentialToSub2Schema>;

export function validateInitialResourceCredentialApplyRequest(input: {
  applyCredentialToSub2?: boolean;
  credentialRunSmokeTest?: boolean;
  credentialSecret?: string | null;
  credentialType?: string | null;
  credentialStatus?: string | null;
  sub2AccountId?: string | null;
}) {
  if (input.credentialRunSmokeTest && !input.applyCredentialToSub2) {
    throw new AppError("initial_credential_apply_required", "Run smoke test requires applying the initial credential to Sub2", 400);
  }
  if (!input.applyCredentialToSub2) return;
  if (!input.credentialSecret) {
    throw new AppError("initial_credential_required", "Initial credential secret is required before applying it to Sub2", 400);
  }
  if (!input.sub2AccountId) {
    throw new AppError("initial_credential_sub2_account_required", "Sub2 account id is required before applying the initial credential to Sub2", 400);
  }
  if ((input.credentialType ?? "openai_refresh_token") !== "openai_refresh_token") {
    throw new AppError("initial_credential_unsupported", "Only openai_refresh_token credentials can be applied to Sub2 OpenAI accounts", 400);
  }
  if ((input.credentialStatus ?? "active") !== "active") {
    throw new AppError("initial_credential_not_active", "Initial credential must be active before applying it to Sub2", 400);
  }
}

const updateSupplierSchema = z.object({
  displayName: nullableProfileText(64),
  status: z.enum(supplierStatuses).optional(),
  defaultShareRate: z.coerce.number().min(0).max(1).optional()
}).refine((input) => Object.values(input).some((value) => value !== undefined), {
  message: "At least one supplier field must be provided"
});

const sub2AccountParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

const sub2SmokeTestSchema = z.object({
  model: z.string().trim().min(1).max(160).optional()
});

const sub2OpenAiRefreshTokenSchema = z.object({
  refreshToken: z.string().trim().min(10),
  clientId: z.string().trim().min(1).max(240).optional(),
  proxyId: z.coerce.number().int().positive().optional(),
  runAccountTest: z.boolean().default(true),
  runSmokeTest: z.boolean().default(false),
  smokeModel: z.string().trim().min(1).max(160).optional(),
  saveToResource: z.boolean().default(false),
  resourceId: z.string().trim().min(1).max(120).optional(),
  supplierEmail: z.string().email().optional()
});
type Sub2OpenAiRefreshTokenInput = z.infer<typeof sub2OpenAiRefreshTokenSchema>;

const usageSyncSchema = z.object({
  cursor: z.string().trim().min(1).max(500).optional()
});

const expireOverdueRentalsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

const releaseSettlementsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(200)
});

const systemMaintenanceSchema = z.object({
  expireOverdueRentals: z.boolean().default(true),
  expireOverdueRentalsLimit: z.coerce.number().int().min(1).max(500).default(200),
  deactivateInvalidProxyApiKeys: z.boolean().default(true),
  deactivateInvalidProxyApiKeysLimit: z.coerce.number().int().min(1).max(1000).default(500),
  releaseAvailableSettlements: z.boolean().default(true),
  releaseAvailableSettlementsLimit: z.coerce.number().int().min(1).max(1000).default(500),
  syncSub2Usage: z.boolean().default(true),
  repairSub2Bindings: z.boolean().default(true),
  cleanupSmokeData: z.boolean().default(true),
  cleanupSmokeDataAgeMinutes: z.coerce.number().int().min(5).max(1440).default(30),
  cleanupSmokeDataLimit: z.coerce.number().int().min(1).max(500).default(100)
});

const createWithdrawalSchema = z.object({
  supplierEmail: z.string().email(),
  amount: z.coerce.number().positive(),
  currency: z.string().trim().min(1).max(12).default("USD"),
  status: z.enum(withdrawalStatuses).default("pending"),
  payoutRef: z.string().trim().min(1).max(160).optional(),
  note: z.string().trim().max(500).optional()
});

const updateWithdrawalSchema = z.object({
  status: z.enum(withdrawalStatuses),
  payoutRef: z.string().trim().min(1).max(160).optional(),
  note: z.string().trim().max(500).optional()
});

export async function registerAdminRoutes(app: FastifyInstance) {
  app.get("/api/admin/dashboard", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const [
      users,
      activeRentals,
      onlineResources,
      pendingWithdrawals,
      usageAgg,
      walletAgg,
      orderAgg,
      latestSystemHealth,
      userStatusRows,
      orderStatusRows,
      rentalStatusRows,
      resourceStatusRows,
      walletCount,
      negativeWallets,
      frozenWallets,
      availableWallets,
      spentWallets
    ] = await Promise.all([
      prisma.user.count({ where: nonSmokeUserWhere() }),
      prisma.rental.count({ where: { status: "active", ...nonSmokeRentalWhere() } }),
      prisma.supplierResource.count({ where: { status: "online", ...nonSmokeSupplierResourceWhere() } }),
      prisma.withdrawal.count({ where: { status: "pending", ...nonSmokeWithdrawalWhere() } }),
      prisma.usageRecord.aggregate({
        where: nonSmokeUsageWhere(),
        _sum: { buyerCharge: true, supplierIncome: true },
        _count: true
      }),
      prisma.walletAccount.aggregate({
        where: nonSmokeWalletWhere(),
        _sum: { availableBalance: true, frozenBalance: true, totalRecharged: true, totalSpent: true }
      }),
      prisma.order.aggregate({
        where: { status: { in: ["paid", "provisioning", "active", "closed", "expired"] }, ...nonSmokeOrderWhere() },
        _sum: { paidAmount: true },
        _count: true
      }),
      prisma.systemHealthSnapshot.findFirst({
        select: {
          id: true,
          status: true,
          source: true,
          summary: true,
          checks: true,
          createdAt: true
        },
        orderBy: { createdAt: "desc" }
      }),
      prisma.user.groupBy({
        by: ["status"],
        where: nonSmokeUserWhere(),
        _count: { _all: true }
      }),
      prisma.order.groupBy({
        by: ["status"],
        where: nonSmokeOrderWhere(),
        _count: { _all: true },
        _sum: { totalAmount: true, paidAmount: true }
      }),
      prisma.rental.groupBy({
        by: ["status"],
        where: nonSmokeRentalWhere(),
        _count: { _all: true }
      }),
      prisma.supplierResource.groupBy({
        by: ["status"],
        where: nonSmokeSupplierResourceWhere(),
        _count: { _all: true }
      }),
      prisma.walletAccount.count({ where: nonSmokeWalletWhere() }),
      prisma.walletAccount.count({ where: { ...nonSmokeWalletWhere(), availableBalance: { lt: 0 } } }),
      prisma.walletAccount.count({ where: { ...nonSmokeWalletWhere(), frozenBalance: { gt: 0 } } }),
      prisma.walletAccount.count({ where: { ...nonSmokeWalletWhere(), availableBalance: { gt: 0 } } }),
      prisma.walletAccount.count({ where: { ...nonSmokeWalletWhere(), totalSpent: { gt: 0 } } })
    ]);
    const userStatusCounts = dashboardManagementStatusCounts(userStatuses, userStatusRows);
    const orderStatusCounts = dashboardManagementStatusCounts(orderStatuses, orderStatusRows);
    const rentalStatusCounts = dashboardManagementStatusCounts(rentalStatuses, rentalStatusRows);
    const resourceStatusCounts = dashboardManagementStatusCounts(resourceStatuses, resourceStatusRows);

    return adminOk(reply, {
      users,
      activeRentals,
      onlineResources,
      pendingWithdrawals,
      usageCount: usageAgg._count,
      gmv: usageAgg._sum.buyerCharge ?? 0,
      supplierIncome: usageAgg._sum.supplierIncome ?? 0,
      walletAvailable: walletAgg._sum.availableBalance ?? 0,
      walletFrozen: walletAgg._sum.frozenBalance ?? 0,
      totalRecharged: walletAgg._sum.totalRecharged ?? 0,
      totalSpent: walletAgg._sum.totalSpent ?? 0,
      paidOrderCount: orderAgg._count,
      paidOrderAmount: orderAgg._sum.paidAmount ?? 0,
      managementOverview: {
        users: {
          total: users,
          statuses: userStatusCounts
        },
        wallets: dashboardWalletManagementOverview({
          total: walletCount,
          negative: negativeWallets,
          frozen: frozenWallets,
          available: availableWallets,
          spent: spentWallets
        }),
        sales: {
          total: orderStatusCounts.reduce((total, row) => total + row.count, 0),
          statuses: orderStatusCounts
        },
        rentals: {
          total: rentalStatusCounts.reduce((total, row) => total + row.count, 0),
          statuses: rentalStatusCounts
        },
        sharing: {
          total: resourceStatusCounts.reduce((total, row) => total + row.count, 0),
          statuses: resourceStatusCounts
        }
      },
      latestSystemHealth: latestSystemHealth ? {
        ...dashboardLatestSystemHealthPreview(latestSystemHealth, new Date(), deploymentRuntimeHealthCheck())
      } : null
    });
  });

  app.get("/api/admin/capabilities", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    return adminOk(reply, {
      capabilities: adminCapabilities(),
      coverage: inspectRegisteredAdminCapabilityRoutes()
    });
  });

  app.get("/api/admin/system-health", async (request, reply) => {
    const actor = await requireRole(request, ["operator", "admin"]);
    const report = await buildSystemHealthReport();
    await recordSystemHealthSnapshot(report, "manual", actor.id);
    return adminOk(reply, report);
  });

  app.get("/api/admin/system-health/snapshots", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(systemHealthStatuses, query.status);
    const where: Prisma.SystemHealthSnapshotWhereInput = {
      ...(status ? { status } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { source: containsText(query.q) },
          { actorUserId: containsText(query.q) },
          { actor: { email: containsText(query.q) } },
          { actor: { displayName: containsText(query.q) } }
        ]
      } : {})
    };
    const [snapshots, total] = await Promise.all([
      prisma.systemHealthSnapshot.findMany({
        where,
        select: {
          id: true,
          status: true,
          source: true,
          summary: true,
          createdAt: true,
          actor: { select: { id: true, email: true, displayName: true } }
        },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.systemHealthSnapshot.count({ where })
    ]);
    return adminOk(reply, paged(snapshots, total, query));
  });

  app.post("/api/admin/system-maintenance/run", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const input = systemMaintenanceSchema.parse(request.body ?? {});
    const result = await runSystemMaintenance(input);
    await recordSystemHealthSnapshot(result.health, "maintenance", actor.id);
    await writeAuditLog(request, actor.id, "admin.system.maintenance_run", "system", undefined, null, result);
    return adminOk(reply, result);
  });

  app.post("/api/admin/users", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const input = createUserSchema.parse(request.body);
    const email = input.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError("email_exists", "Email already registered", 409);

    const roles = [...new Set(input.roles)];
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(input.password, 12),
        displayName: input.displayName,
        roles: { create: roles.map((role) => ({ role })) },
        wallet: { create: { currency: "USD" } }
      },
      include: { roles: true, wallet: true, supplier: true }
    });
    await writeAuditLog(request, actor.id, "admin.user.create", "user", user.id, null, { email, roles });
    return adminOk(reply, user);
  });

  app.get("/api/admin/users", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(userStatuses, query.status);
    const where: Prisma.UserWhereInput = {
      ...nonSmokeUserWhere(),
      ...(status ? { status } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { email: containsText(query.q) },
          { displayName: containsText(query.q) },
          { phone: containsText(query.q) },
          { roles: { some: { role: oneOf(userRoles, query.q) } } }
        ]
      } : {})
    };
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: {
          roles: true,
          wallet: true,
          supplier: true,
          _count: { select: { orders: true, rentals: true, apiKeys: true } }
        },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.user.count({ where })
    ]);
    return adminOk(reply, paged(users, total, query));
  });

  app.get("/api/admin/users/:id", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const { id } = request.params as { id: string };
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        roles: true,
        wallet: { include: { transactions: { orderBy: { createdAt: "desc" }, take: 50 } } },
        supplier: { include: { resources: true, withdrawals: true } },
        identities: true,
        orders: { include: { items: true, rentals: true }, orderBy: { createdAt: "desc" }, take: 20 },
        rentals: { include: { product: true, limits: true }, orderBy: { createdAt: "desc" }, take: 20 },
        apiKeys: { orderBy: { createdAt: "desc" }, take: 20 }
      }
    });
    if (!user) throw new AppError("user_not_found", "User not found", 404);
    return adminOk(reply, user);
  });

  app.patch("/api/admin/users/:id", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = updateUserSchema.parse(request.body ?? {});
    const before = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, displayName: true, phone: true, status: true }
    });
    if (!before) throw new AppError("user_not_found", "User not found", 404);

    const data: Prisma.UserUpdateInput = {};
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.password !== undefined) data.passwordHash = await bcrypt.hash(input.password, 12);

    const user = await prisma.user.update({
      where: { id },
      data,
      include: {
        roles: true,
        wallet: true,
        supplier: true,
        _count: { select: { orders: true, rentals: true, apiKeys: true } }
      }
    });
    await writeAuditLog(request, actor.id, "admin.user.update", "user", id, {
      email: before.email,
      displayName: before.displayName,
      phone: before.phone,
      status: before.status
    }, {
      email: user.email,
      displayName: user.displayName,
      phone: user.phone,
      status: user.status,
      passwordReset: input.password !== undefined
    });
    return adminOk(reply, user);
  });

  app.patch("/api/admin/users/:id/status", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = userStatusSchema.parse(request.body);
    const before = await prisma.user.findUnique({
      where: { id },
      include: { roles: true }
    });
    if (!before) throw new AppError("user_not_found", "User not found", 404);

    const isAdminTarget = before.roles.some((role) => role.role === "admin");
    if (isAdminTarget && input.status !== "active") {
      if (actor.id === id) {
        throw new AppError("cannot_disable_self", "Cannot disable or ban your own admin account", 400);
      }
      if (before.status === "active") {
        const activeAdminCount = await prisma.user.count({
          where: {
            status: "active",
            roles: { some: { role: "admin" } }
          }
        });
        if (activeAdminCount <= 1) {
          throw new AppError("last_active_admin_required", "At least one active admin user must remain", 400);
        }
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data: { status: input.status },
      include: { roles: true, wallet: true }
    });
    await writeAuditLog(request, actor.id, "admin.user.status", "user", id, {
      status: before.status,
      roles: before.roles.map((role) => role.role)
    }, { status: user.status });
    return adminOk(reply, user);
  });

  app.patch("/api/admin/users/:id/roles", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = userRolesSchema.parse(request.body ?? {});
    const roles = [...new Set(input.roles)];
    const before = await prisma.user.findUnique({
      where: { id },
      include: { roles: true }
    });
    if (!before) throw new AppError("user_not_found", "User not found", 404);

    const previousRoles = before.roles.map((role) => role.role);
    if (previousRoles.includes("admin") && !roles.includes("admin")) {
      if (actor.id === id) {
        throw new AppError("cannot_remove_own_admin_role", "Cannot remove your own admin role", 400);
      }
      const adminCount = await prisma.userRole.count({ where: { role: "admin" } });
      if (adminCount <= 1) {
        throw new AppError("last_admin_role_required", "At least one admin user must remain", 400);
      }
    }

    const user = await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({
        where: {
          userId: id,
          role: { notIn: roles }
        }
      });
      await tx.userRole.createMany({
        data: roles.map((role) => ({ userId: id, role })),
        skipDuplicates: true
      });
      return tx.user.findUniqueOrThrow({
        where: { id },
        include: {
          roles: true,
          wallet: true,
          supplier: true,
          _count: { select: { orders: true, rentals: true, apiKeys: true } }
        }
      });
    });
    await writeAuditLog(request, actor.id, "admin.user.roles", "user", id, { roles: previousRoles }, { roles });
    return adminOk(reply, user);
  });

  app.post("/api/admin/users/:id/wallet-adjust", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = walletAdjustSchema.parse(request.body);
    const amount = new Prisma.Decimal(input.amount);
    const wallet = await prisma.$transaction(async (tx) => {
      const current = await tx.walletAccount.upsert({
        where: { userId: id },
        update: {},
        create: { userId: id, currency: "USD" }
      });
      if (amount.lt(0)) {
        const debit = await tx.walletAccount.updateMany({
          where: {
            id: current.id,
            availableBalance: { gte: amount.abs() }
          },
          data: {
            availableBalance: { decrement: amount.abs() }
          }
        });
        if (debit.count !== 1) {
          throw new AppError("insufficient_balance", "Wallet adjustment would make balance negative", 400);
        }
      } else {
        await tx.walletAccount.update({
          where: { id: current.id },
          data: {
            availableBalance: { increment: amount }
          }
        });
      }
      const updated = await tx.walletAccount.findUniqueOrThrow({ where: { id: current.id } });
      await tx.walletTransaction.create({
        data: {
          walletId: current.id,
          type: "adjustment",
          amount,
          balanceAfter: updated.availableBalance,
          refType: "admin_adjustment",
          refId: id,
          note: input.note ?? "admin wallet adjustment"
        }
      });
      return updated;
    });
    await writeAuditLog(request, actor.id, "admin.wallet.adjust", "wallet", wallet.id, null, {
      userId: id,
      amount: String(amount),
      balanceAfter: String(wallet.availableBalance),
      note: input.note
    });
    return adminOk(reply, wallet);
  });

  app.get("/api/admin/orders", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(orderStatuses, query.status);
    const where: Prisma.OrderWhereInput = {
      ...nonSmokeOrderWhere(),
      ...(status ? { status } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { paymentRef: containsText(query.q) },
          { userId: containsText(query.q) },
          { user: { id: containsText(query.q) } },
          { user: { email: containsText(query.q) } },
          { user: { displayName: containsText(query.q) } },
          { items: { some: { productId: containsText(query.q) } } },
          { items: { some: { priceId: containsText(query.q) } } },
          { items: { some: { product: { id: containsText(query.q) } } } },
          { items: { some: { product: { name: containsText(query.q) } } } }
        ]
      } : {})
    };
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: { user: true, items: true, rentals: true },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.order.count({ where })
    ]);
    return adminOk(reply, paged(orders, total, query));
  });

  app.get("/api/admin/orders/:id", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const { id } = request.params as { id: string };
    const [order, walletTransactions, walletTransactionSummary, proxyRequests, proxyRequestSummary] = await Promise.all([
      prisma.order.findUnique({
        where: { id },
        include: orderDetailInclude
      }),
      prisma.walletTransaction.findMany({
        where: { refType: "order", refId: id },
        include: { wallet: { include: { user: true } } },
        orderBy: { createdAt: "desc" },
        take: 50
      }),
      prisma.walletTransaction.aggregate({
        where: { refType: "order", refId: id },
        _count: true,
        _sum: { amount: true }
      }),
      prisma.proxyRequestLog.findMany({
        where: { rental: { orderId: id } },
        include: {
          user: { select: { id: true, email: true, displayName: true } },
          rental: { select: { id: true, orderId: true, productId: true, resourceType: true, status: true, product: { select: { name: true } } } },
          apiKey: { select: { id: true, name: true, keyPrefix: true, status: true } }
        },
        orderBy: { createdAt: "desc" },
        take: 50
      }),
      prisma.proxyRequestLog.aggregate({
        where: { rental: { orderId: id } },
        _count: true
      })
    ]);
    if (!order) throw new AppError("order_not_found", "Order not found", 404);
    return adminOk(reply, {
      ...order,
      walletTransactions,
      walletTransactionSummary,
      proxyRequests,
      proxyRequestSummary,
      deliverySummary: buildOrderDeliverySummary(order, proxyRequestSummary._count)
    });
  });

  app.post("/api/admin/orders/:id/cancel", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = orderActionSchema.parse(request.body ?? {});
    const before = await prisma.order.findUnique({
      where: { id },
      include: { rentals: true }
    });
    if (!before) throw new AppError("order_not_found", "Order not found", 404);
    if (before.status === "cancelled") {
      return adminOk(reply, { order: await prisma.order.findUniqueOrThrow({ where: { id }, include: orderDetailInclude }), cancelled: false });
    }
    if (before.paidAmount.gt(0) || before.rentals.length > 0) {
      throw new AppError("order_requires_refund", "Paid or provisioned orders must be refunded instead of cancelled", 400);
    }
    if (!["pending", "failed"].includes(before.status)) {
      throw new AppError("order_not_cancellable", `Order cannot be cancelled from ${before.status}`, 400);
    }

    const order = await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: { status: "cancelled" }
      });
      await recordOrderStatusHistory(tx, {
        orderId: id,
        fromStatus: before.status,
        toStatus: "cancelled",
        actorUserId: actor.id,
        reason: "admin.order.cancel",
        meta: { note: input.note }
      });
      return tx.order.findUniqueOrThrow({ where: { id }, include: orderDetailInclude });
    });
    await writeAuditLog(request, actor.id, "admin.order.cancel", "order", id, {
      status: before.status,
      paidAmount: String(before.paidAmount),
      rentalCount: before.rentals.length
    }, {
      status: order.status,
      note: input.note
    });
    return adminOk(reply, { order, cancelled: true });
  });

  app.post("/api/admin/orders/:id/refund", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = orderActionSchema.parse(request.body ?? {});
    const before = await prisma.order.findUnique({
      where: { id },
      include: {
        rentals: { include: { apiKeys: true } },
        user: { include: { wallet: true } }
      }
    });
    if (!before) throw new AppError("order_not_found", "Order not found", 404);
    const existingRefund = await prisma.walletTransaction.findFirst({
      where: { type: "refund", refType: "order", refId: id },
      select: { id: true, amount: true }
    });
    if (["refunded", "cancelled"].includes(before.status)) {
      if (before.status === "refunded" && existingRefund) {
        const order = await prisma.order.findUniqueOrThrow({ where: { id }, include: orderDetailInclude });
        await writeAuditLog(request, actor.id, "admin.order.refund", "order", id, {
          status: before.status,
          paidAmount: String(before.paidAmount),
          existingRefundId: existingRefund.id
        }, {
          status: order.status,
          refundAmount: "0",
          walletRefunded: false,
          replayed: true,
          note: input.note
        });
        return adminOk(reply, {
          order,
          refundAmount: "0",
          walletRefunded: false,
          existingRefundId: existingRefund.id,
          sub2Sync: []
        });
      }
      throw new AppError("order_already_terminal", `Order is already ${before.status}`, 400);
    }
    if (!["paid", "provisioning", "active", "failed", "refunding", "closed", "expired"].includes(before.status)) {
      throw new AppError("order_not_refundable", `Order cannot be refunded from ${before.status}`, 400);
    }
    if (before.paidAmount.lte(0)) {
      throw new AppError("order_has_no_paid_amount", "Order has no paid amount to refund", 400);
    }

    const rentalIds = before.rentals.map((rental) => rental.id);
    if (existingRefund) {
      const order = await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id }, data: { status: "refunded" } });
        await recordOrderStatusHistory(tx, {
          orderId: id,
          fromStatus: before.status,
          toStatus: "refunded",
          actorUserId: actor.id,
          reason: "admin.order.refund.reconcile",
          meta: { existingRefundId: existingRefund.id, note: input.note }
        });
        await tx.rental.updateMany({
          where: { orderId: id, status: { not: "refunded" } },
          data: { status: "refunded" }
        });
        if (rentalIds.length > 0) {
          await tx.apiKey.updateMany({
            where: { rentalId: { in: rentalIds } },
            data: { status: "inactive" }
          });
        }
        return tx.order.findUniqueOrThrow({ where: { id }, include: orderDetailInclude });
      });

      const sub2Sync = [];
      for (const rental of before.rentals) {
        sub2Sync.push({
          rentalId: rental.id,
          sub2KeyId: rental.sub2KeyId,
          ...(await syncSub2KeyForRental(rental.userId, rental.sub2KeyId, false))
        });
      }
      await writeAuditLog(request, actor.id, "admin.order.refund", "order", id, {
        status: before.status,
        paidAmount: String(before.paidAmount),
        existingRefundId: existingRefund.id
      }, {
        status: order.status,
        refundAmount: "0",
        walletRefunded: false,
        existingRefundId: existingRefund.id,
        replayed: true,
        sub2Sync,
        note: input.note
      });
      return adminOk(reply, {
        order,
        refundAmount: "0",
        walletRefunded: false,
        existingRefundId: existingRefund.id,
        sub2Sync
      });
    }

    const refundResult = await prisma.$transaction(async (tx) => {
      const claim = await tx.order.updateMany({
        where: {
          id,
          status: { in: ["paid", "provisioning", "active", "failed", "closed", "expired"] }
        },
        data: { status: "refunding" }
      });
      if (claim.count !== 1) {
        const transaction = await tx.walletTransaction.findFirst({
          where: { type: "refund", refType: "order", refId: id },
          select: { id: true }
        });
        if (!transaction) {
          throw new AppError("refund_in_progress", "Order refund is already in progress", 409);
        }
        return {
          order: await tx.order.findUniqueOrThrow({ where: { id }, include: orderDetailInclude }),
          refundAmount: new Prisma.Decimal(0),
          walletRefunded: false,
          existingRefundId: transaction.id
        };
      }
      await recordOrderStatusHistory(tx, {
        orderId: id,
        fromStatus: before.status,
        toStatus: "refunding",
        actorUserId: actor.id,
        reason: "admin.order.refund.start",
        meta: { note: input.note }
      });

      const wallet = await tx.walletAccount.upsert({
        where: { userId: before.userId },
        update: {},
        create: { userId: before.userId, currency: before.currency }
      });
      await tx.$executeRaw`
        UPDATE "WalletAccount"
        SET
          "availableBalance" = "availableBalance" + ${before.paidAmount},
          "totalSpent" = GREATEST("totalSpent" - ${before.paidAmount}, 0),
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${wallet.id}
      `;
      const updatedWallet = await tx.walletAccount.findUniqueOrThrow({ where: { id: wallet.id } });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "refund",
          amount: before.paidAmount,
          balanceAfter: updatedWallet.availableBalance,
          currency: before.currency,
          refType: "order",
          refId: id,
          note: input.note ?? "admin order refund"
        }
      });
      await tx.order.update({ where: { id }, data: { status: "refunded" } });
      await recordOrderStatusHistory(tx, {
        orderId: id,
        fromStatus: "refunding",
        toStatus: "refunded",
        actorUserId: actor.id,
        reason: "admin.order.refund.complete",
        meta: { refundAmount: String(before.paidAmount), note: input.note }
      });
      await tx.rental.updateMany({
        where: { orderId: id, status: { not: "refunded" } },
        data: { status: "refunded" }
      });
      if (rentalIds.length > 0) {
        await tx.apiKey.updateMany({
          where: { rentalId: { in: rentalIds } },
          data: { status: "inactive" }
        });
      }
      return {
        order: await tx.order.findUniqueOrThrow({ where: { id }, include: orderDetailInclude }),
        refundAmount: before.paidAmount,
        walletRefunded: true,
        existingRefundId: null
      };
    });
    const order = refundResult.order;

    const sub2Sync = [];
    for (const rental of before.rentals) {
      sub2Sync.push({
        rentalId: rental.id,
        sub2KeyId: rental.sub2KeyId,
        ...(await syncSub2KeyForRental(rental.userId, rental.sub2KeyId, false))
      });
    }
    await writeAuditLog(request, actor.id, "admin.order.refund", "order", id, {
      status: before.status,
      paidAmount: String(before.paidAmount),
      rentalStatuses: before.rentals.map((rental) => ({ id: rental.id, status: rental.status, sub2KeyId: rental.sub2KeyId })),
      apiKeyStatuses: before.rentals.flatMap((rental) => rental.apiKeys.map((apiKey) => ({ id: apiKey.id, status: apiKey.status })))
    }, {
      status: order.status,
      refundAmount: String(refundResult.refundAmount),
      walletRefunded: refundResult.walletRefunded,
      existingRefundId: refundResult.existingRefundId,
      sub2Sync,
      note: input.note
    });
    return adminOk(reply, {
      order,
      refundAmount: String(refundResult.refundAmount),
      walletRefunded: refundResult.walletRefunded,
      existingRefundId: refundResult.existingRefundId,
      sub2Sync
    });
  });

  app.post("/api/admin/orders/:id/retry-provision", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = orderActionSchema.parse(request.body ?? {});
    const before = await prisma.order.findUnique({
      where: { id },
      include: {
        user: { include: { wallet: true } },
        items: { include: { product: true } },
        rentals: { include: { product: true, limits: true, apiKeys: true } }
      }
    });
    if (!before) throw new AppError("order_not_found", "Order not found", 404);
    if (before.status !== "failed") {
      throw new AppError("order_retry_requires_failed", `Order cannot be retried from ${before.status}`, 400);
    }
    if (before.rentals.length !== 1) {
      throw new AppError("order_retry_requires_single_rental", "Order retry requires exactly one rental", 400);
    }

    const rental = before.rentals[0];
    const item = before.items[0];
    if (!item?.product) {
      throw new AppError("order_retry_missing_product", "Order retry requires an order item with a product", 400);
    }
    if (!rental.limits) {
      throw new AppError("order_retry_missing_limits", "Order retry requires rental limits", 400);
    }
    if (rental.sub2KeyId || rental.sub2UserId || rental.sub2KeyHash || rental.endpointUrl) {
      throw new AppError("order_retry_has_sub2_key", "Order already has Sub2 delivery fields and must be reconciled manually", 409);
    }
    const activeApiKeys = rental.apiKeys.filter((apiKey) => apiKey.status === "active");
    if (activeApiKeys.length > 0) {
      throw new AppError("order_retry_has_active_api_key", "Order already has an active API key and must be reconciled manually", 409);
    }

    const existingRefund = before.paidAmount.gt(0)
      ? await prisma.walletTransaction.findFirst({
        where: { type: "refund", refType: "order", refId: id },
        select: { id: true, amount: true }
      })
      : null;
    if (before.paidAmount.gt(0) && !existingRefund) {
      throw new AppError("order_retry_refund_missing", "Paid failed orders must have the original failed provisioning refund before retry", 409);
    }

    const deliveryReadiness = await requireReadySupplierResourceForDelivery(rental.resourceType);

    let walletDebited = false;
    let debitTransactionId: string | null = null;
    let reversalTransactionId: string | null = null;
    await prisma.$transaction(async (tx) => {
      const claim = await tx.order.updateMany({
        where: { id, status: "failed" },
        data: { status: "provisioning" }
      });
      if (claim.count !== 1) {
        throw new AppError("order_retry_in_progress", "Order retry is already in progress", 409);
      }
      await recordOrderStatusHistory(tx, {
        orderId: id,
        fromStatus: before.status,
        toStatus: "provisioning",
        actorUserId: actor.id,
        reason: "admin.order.retry_provision.start",
        meta: {
          note: input.note,
          previousRefundId: existingRefund?.id ?? null,
          previousRefundAmount: existingRefund ? String(existingRefund.amount) : null,
          supplierResourceId: deliveryReadiness.resource?.id ?? null
        }
      });
      await tx.rental.update({
        where: { id: rental.id },
        data: {
          status: "active",
          supplierResourceId: deliveryReadiness.resource?.id ?? null
        }
      });

      if (before.paidAmount.gt(0)) {
        const debit = await tx.walletAccount.updateMany({
          where: {
            userId: before.userId,
            availableBalance: { gte: before.paidAmount }
          },
          data: {
            availableBalance: { decrement: before.paidAmount },
            totalSpent: { increment: before.paidAmount }
          }
        });
        if (debit.count !== 1) {
          throw new AppError("insufficient_balance", "Insufficient wallet balance for order retry", 402);
        }
        const wallet = await tx.walletAccount.findUniqueOrThrow({ where: { userId: before.userId } });
        const transaction = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "consume",
            amount: before.paidAmount,
            balanceAfter: wallet.availableBalance,
            currency: before.currency,
            refType: "order",
            refId: id,
            note: input.note ?? "admin retry provisioning"
          }
        });
        walletDebited = true;
        debitTransactionId = transaction.id;
      } else {
        await tx.walletAccount.upsert({
          where: { userId: before.userId },
          update: {},
          create: { userId: before.userId, currency: before.currency }
        });
      }
    });

    let sub2Key: Sub2KeyResult | undefined;
    try {
      sub2Key = await sub2Client.createKey({
        buyerId: before.userId,
        rentalId: rental.id,
        name: `${item.product.name} - ${before.user.email}`,
        resourceType: rental.resourceType,
        maxConcurrency: rental.limits.maxConcurrency,
        requestLimit: rental.limits.requestLimit,
        spendLimit: rental.limits.spendLimit === null ? null : String(rental.limits.spendLimit)
      });
      const createdSub2Key = sub2Key;

      const result = await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id }, data: { status: "active" } });
        await recordOrderStatusHistory(tx, {
          orderId: id,
          fromStatus: "provisioning",
          toStatus: "active",
          actorUserId: actor.id,
          reason: "admin.order.retry_provision.complete",
          meta: {
            note: input.note,
            sub2UserId: createdSub2Key.sub2UserId,
            sub2KeyId: createdSub2Key.sub2KeyId,
            supplierResourceId: deliveryReadiness.resource?.id ?? null,
            walletDebited,
            debitTransactionId
          }
        });
        const updatedRental = await tx.rental.update({
          where: { id: rental.id },
          data: {
            status: "active",
            sub2UserId: createdSub2Key.sub2UserId,
            sub2KeyId: createdSub2Key.sub2KeyId,
            supplierResourceId: deliveryReadiness.resource?.id ?? null,
            endpointUrl: createdSub2Key.endpointUrl,
            sub2KeyHash: hashSecret(createdSub2Key.apiKey)
          }
        });
        const apiKey = await tx.apiKey.create({
          data: {
            userId: before.userId,
            rentalId: rental.id,
            name: item.product.name,
            keyPrefix: createdSub2Key.apiKey.slice(0, 12),
            keyHash: hashSecret(createdSub2Key.apiKey)
          }
        });
        await tx.sub2Binding.createMany({
          data: [
            { objectType: "rental", objectId: rental.id, sub2Type: "user", sub2Id: createdSub2Key.sub2UserId },
            { objectType: "rental", objectId: rental.id, sub2Type: "api_key", sub2Id: createdSub2Key.sub2KeyId }
          ],
          skipDuplicates: true
        });
        return {
          order: await tx.order.findUniqueOrThrow({ where: { id }, include: orderDetailInclude }),
          rental: updatedRental,
          apiKeyId: apiKey.id,
          keyPrefix: apiKey.keyPrefix
        };
      });

      await writeAuditLog(request, actor.id, "admin.order.retry_provision", "order", id, {
        status: before.status,
        paidAmount: String(before.paidAmount),
        rental: {
          id: rental.id,
          status: rental.status,
          sub2KeyId: rental.sub2KeyId,
          activeApiKeys: activeApiKeys.length
        },
        previousRefundId: existingRefund?.id ?? null
      }, {
        status: result.order.status,
        rentalId: result.rental.id,
        sub2UserId: createdSub2Key.sub2UserId,
        sub2KeyId: createdSub2Key.sub2KeyId,
        apiKeyId: result.apiKeyId,
        keyPrefix: result.keyPrefix,
        supplierResourceId: deliveryReadiness.resource?.id ?? null,
        walletDebited,
        debitTransactionId,
        note: input.note
      });

      return adminOk(reply, {
        order: result.order,
        rental: result.rental,
        apiKey: createdSub2Key.apiKey,
        apiKeyAvailable: true,
        sub2KeyId: createdSub2Key.sub2KeyId,
        walletDebited,
        debitTransactionId
      });
    } catch (error) {
      const sub2Cleanup = sub2Key
        ? await syncSub2KeyForRental(before.userId, sub2Key.sub2KeyId, false)
        : { action: "none", ok: true };
      await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id }, data: { status: "failed" } });
        await tx.rental.update({
          where: { id: rental.id },
          data: { status: "closed" }
        });

        if (walletDebited && before.paidAmount.gt(0)) {
          const wallet = await tx.walletAccount.findUniqueOrThrow({ where: { userId: before.userId } });
          const nextBalance = wallet.availableBalance.plus(before.paidAmount);
          const nextSpent = wallet.totalSpent.lessThan(before.paidAmount) ? 0 : wallet.totalSpent.minus(before.paidAmount);
          await tx.walletAccount.update({
            where: { id: wallet.id },
            data: {
              availableBalance: nextBalance,
              totalSpent: nextSpent
            }
          });
          const reversalTransaction = await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              type: "adjustment",
              amount: before.paidAmount,
              balanceAfter: nextBalance,
              currency: before.currency,
              refType: "order",
              refId: id,
              note: input.note ?? "admin retry provisioning failed reversal"
            }
          });
          reversalTransactionId = reversalTransaction.id;
        }
        await recordOrderStatusHistory(tx, {
          orderId: id,
          fromStatus: "provisioning",
          toStatus: "failed",
          actorUserId: actor.id,
          reason: "admin.order.retry_provision_failed",
          meta: {
            note: input.note,
            error: redactError(error),
            sub2KeyId: sub2Key?.sub2KeyId ?? null,
            sub2Cleanup,
            walletDebited,
            debitTransactionId,
            reversalTransactionId
          }
        });
      });
      await writeAuditLog(request, actor.id, "admin.order.retry_provision", "order", id, {
        status: before.status,
        paidAmount: String(before.paidAmount),
        rental: {
          id: rental.id,
          status: rental.status,
          sub2KeyId: rental.sub2KeyId,
          activeApiKeys: activeApiKeys.length
        }
      }, {
        status: "failed",
        error: redactError(error),
        walletDebited,
        debitTransactionId,
        reversalTransactionId,
        sub2KeyId: sub2Key?.sub2KeyId ?? null,
        sub2Cleanup,
        note: input.note
      });
      throw error;
    }
  });

  app.get("/api/admin/rentals", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(rentalStatuses, query.status);
    const resourceType = oneOf(resourceTypes, query.resourceType);
    const where: Prisma.RentalWhereInput = {
      ...nonSmokeRentalWhere(),
      ...(status ? { status } : {}),
      ...(resourceType ? { resourceType } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { orderId: containsText(query.q) },
          { productId: containsText(query.q) },
          { supplierResourceId: containsText(query.q) },
          { userId: containsText(query.q) },
          { sub2UserId: containsText(query.q) },
          { sub2KeyId: containsText(query.q) },
          { endpointUrl: containsText(query.q) },
          { user: { id: containsText(query.q) } },
          { user: { email: containsText(query.q) } },
          { product: { id: containsText(query.q) } },
          { product: { name: containsText(query.q) } },
          { supplierResource: { id: containsText(query.q) } },
          { supplierResource: { sub2AccountId: containsText(query.q) } },
          { supplierResource: { supplier: { user: { email: containsText(query.q) } } } },
          { order: { items: { some: { priceId: containsText(query.q) } } } },
          { order: { items: { some: { productId: containsText(query.q) } } } },
          ...(oneOf(resourceTypes, query.q) ? [{ resourceType: oneOf(resourceTypes, query.q) }] : [])
        ]
      } : {})
    };
    const [rentals, total] = await Promise.all([
      prisma.rental.findMany({
        where,
        include: {
          user: true,
          product: true,
          limits: true,
          order: true,
          supplierResource: { include: { supplier: { include: { user: true } } } },
          apiKeys: { orderBy: { createdAt: "desc" }, take: 5 }
        },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.rental.count({ where })
    ]);
    return adminOk(reply, paged(rentals, total, query));
  });

  app.get("/api/admin/rentals/:id", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const { id } = request.params as { id: string };
    const [rental, usageSummary, proxyRequestSummary] = await Promise.all([
      prisma.rental.findUnique({
        where: { id },
        include: {
          user: { include: { roles: true, wallet: true } },
          product: true,
          limits: true,
          supplierResource: { include: { supplier: { include: { user: true } } } },
          order: {
            include: {
              user: true,
              items: { include: { product: true } }
            }
          },
          apiKeys: { orderBy: { createdAt: "desc" }, take: 20 },
          usages: {
            include: {
              supplierResource: { include: { supplier: { include: { user: true } } } },
              settlements: true
            },
            orderBy: { occurredAt: "desc" },
            take: 50
          },
          proxyRequestLogs: {
            include: {
              user: { select: { id: true, email: true, displayName: true } },
              apiKey: { select: { id: true, name: true, keyPrefix: true, status: true } }
            },
            orderBy: { createdAt: "desc" },
            take: 50
          }
        }
      }),
      prisma.usageRecord.aggregate({
        where: { rentalId: id },
        _count: true,
        _sum: {
          inputUnits: true,
          outputUnits: true,
          apiEquivalentCost: true,
          buyerCharge: true,
          supplierIncome: true
        }
      }),
      prisma.proxyRequestLog.aggregate({
        where: { rentalId: id },
        _count: true
      })
    ]);
    if (!rental) throw new AppError("rental_not_found", "Rental not found", 404);
    return adminOk(reply, { ...rental, usageSummary, proxyRequestSummary });
  });

  app.post("/api/admin/rentals/expire-overdue", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const input = expireOverdueRentalsSchema.parse(request.body ?? {});
    const result = await expireOverdueRentals({ limit: input.limit });
    await writeAuditLog(request, actor.id, "admin.rental.expire_overdue", "rental", undefined, null, result);
    return adminOk(reply, result);
  });

  app.patch("/api/admin/rentals/:id/status", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = rentalStatusSchema.parse(request.body ?? {});
    const before = await prisma.rental.findUnique({
      where: { id },
      include: { apiKeys: true, product: true }
    });
    if (!before) throw new AppError("rental_not_found", "Rental not found", 404);

    const sub2Sync = await syncSub2KeyForRental(before.userId, before.sub2KeyId, input.status === "active");
    if (input.status === "active" && !sub2Sync.ok) {
      throw new AppError("sub2_key_enable_failed", "Sub2 key enable failed", 502, sub2Sync.error);
    }

    const rental = await prisma.$transaction(async (tx) => {
      await tx.rental.update({
        where: { id },
        data: { status: input.status }
      });
      await tx.apiKey.updateMany({
        where: { rentalId: id },
        data: { status: input.status === "active" ? "active" : "inactive" }
      });
      return tx.rental.findUniqueOrThrow({
        where: { id },
        include: { user: true, product: true, limits: true, order: true, apiKeys: { orderBy: { createdAt: "desc" }, take: 5 } }
      });
    });
    await writeAuditLog(request, actor.id, "admin.rental.status", "rental", id, {
      status: before.status,
      sub2KeyId: before.sub2KeyId,
      apiKeyStatuses: before.apiKeys.map((apiKey) => ({ id: apiKey.id, status: apiKey.status }))
    }, {
      status: rental.status,
      sub2Sync
    });
    return adminOk(reply, rental);
  });

  app.patch("/api/admin/rentals/:id/limits", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = rentalLimitsSchema.parse(request.body ?? {});
    const before = await prisma.rental.findUnique({
      where: { id },
      include: { limits: true }
    });
    if (!before) throw new AppError("rental_not_found", "Rental not found", 404);

    const rental = await prisma.$transaction(async (tx) => {
      await tx.rentalLimit.upsert({
        where: { rentalId: id },
        create: {
          rentalId: id,
          maxConcurrency: input.maxConcurrency ?? 1,
          rpmLimit: input.rpmLimit ?? null,
          tpmLimit: input.tpmLimit ?? null,
          requestLimit: input.requestLimit ?? null,
          spendLimit: decimalOrNull(input.spendLimit),
          remainingSpend: input.remainingSpend !== undefined
            ? decimalOrNull(input.remainingSpend)
            : decimalOrNull(input.spendLimit)
        },
        update: rentalLimitUpdateData(input)
      });
      return tx.rental.findUniqueOrThrow({
        where: { id },
        include: { user: true, product: true, limits: true, order: true, apiKeys: { orderBy: { createdAt: "desc" }, take: 5 } }
      });
    });
    await writeAuditLog(request, actor.id, "admin.rental.limits", "rental", id, before.limits, rental.limits);
    return adminOk(reply, rental);
  });

  app.patch("/api/admin/rentals/:id/supplier-resource", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = rentalSupplierResourceSchema.parse(request.body ?? {});
    const before = await prisma.rental.findUnique({
      where: { id },
      include: {
        supplierResource: {
          include: {
            supplier: { include: { user: true } },
            credential: { select: resourceCredentialSummarySelect }
          }
        }
      }
    });
    if (!before) throw new AppError("rental_not_found", "Rental not found", 404);

    let targetResource: Prisma.SupplierResourceGetPayload<{
      include: {
        supplier: { include: { user: true } };
        credential: { select: typeof resourceCredentialSummarySelect };
      };
    }> | null = null;

    if (input.supplierResourceId) {
      targetResource = await prisma.supplierResource.findUnique({
        where: { id: input.supplierResourceId },
        include: {
          supplier: { include: { user: true } },
          credential: { select: resourceCredentialSummarySelect }
        }
      });
      if (!targetResource) throw new AppError("resource_not_found", "Supplier resource not found", 404);
      if (targetResource.resourceType !== before.resourceType) {
        throw new AppError("rental_supplier_resource_type_mismatch", "Supplier resource type does not match the rental resource type", 400, {
          rentalId: id,
          rentalResourceType: before.resourceType,
          supplierResourceId: targetResource.id,
          supplierResourceType: targetResource.resourceType
        });
      }

      if (input.requireReady && before.resourceType === "codex") {
        const readyResource = await prisma.supplierResource.findFirst({
          where: { id: targetResource.id, ...readyCodexSupplierResourceDeliveryWhere() },
          select: { id: true }
        });
        if (!readyResource) {
          throw new AppError("rental_supplier_resource_not_ready", "Codex rentals require an online production Codex shared resource with a Sub2 account and active OpenAI refresh token credential", 400, {
            rentalId: id,
            supplierResourceId: targetResource.id,
            resourceType: targetResource.resourceType,
            resourceStatus: targetResource.status,
            sub2AccountId: targetResource.sub2AccountId,
            credentialType: targetResource.credential?.credentialType ?? null,
            credentialStatus: targetResource.credential?.status ?? null,
            requireReady: input.requireReady
          });
        }
      }
    }

    const rental = await prisma.rental.update({
      where: { id },
      data: { supplierResourceId: input.supplierResourceId },
      include: {
        user: true,
        product: true,
        limits: true,
        order: true,
        supplierResource: { include: { supplier: { include: { user: true } } } },
        apiKeys: { orderBy: { createdAt: "desc" }, take: 5 }
      }
    });
    await writeAuditLog(request, actor.id, "admin.rental.supplier_resource", "rental", id, {
      supplierResourceId: before.supplierResourceId,
      resourceType: before.supplierResource?.resourceType ?? null,
      resourceStatus: before.supplierResource?.status ?? null,
      sub2AccountId: before.supplierResource?.sub2AccountId ?? null,
      supplierEmail: before.supplierResource?.supplier?.user?.email ?? null
    }, {
      supplierResourceId: rental.supplierResourceId,
      resourceType: rental.supplierResource?.resourceType ?? null,
      resourceStatus: rental.supplierResource?.status ?? null,
      sub2AccountId: rental.supplierResource?.sub2AccountId ?? null,
      supplierEmail: rental.supplierResource?.supplier?.user?.email ?? null,
      requireReady: input.requireReady,
      note: input.note
    });
    return adminOk(reply, rental);
  });

  app.post("/api/admin/rentals/:id/rotate-key", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const result = await rotateRentalApiKey({ rentalId: id });
    await writeAuditLog(request, actor.id, "admin.rental.rotate_key", "rental", id, {
      previousSub2KeyId: result.previousSub2KeyId,
      previousApiKeyIds: result.previousApiKeyIds
    }, {
      sub2KeyId: result.sub2KeyId,
      oldSub2KeyDisabled: result.oldSub2KeyDisabled,
      oldSub2KeyDisableError: result.oldSub2KeyDisableError ? redactSensitiveText(result.oldSub2KeyDisableError) : null
    });
    return adminOk(reply, result);
  });

  app.get("/api/admin/api-keys", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(apiKeyStatuses, query.status);
    const resourceType = oneOf(resourceTypes, query.resourceType);
    const where = apiKeyListWhere({ q: query.q, status, resourceType });
    const [apiKeys, total] = await Promise.all([
      prisma.apiKey.findMany({
        where,
        include: {
          user: { include: { roles: true } },
          rental: { include: { product: true, order: true } }
        },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.apiKey.count({ where })
    ]);
    return adminOk(reply, paged(apiKeys, total, query));
  });

  app.post("/api/admin/api-keys/bulk-status", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const input = apiKeyBulkStatusSchema.parse(request.body ?? {});
    const where = apiKeyListWhere({
      q: nonEmpty(input.q),
      status: input.currentStatus,
      resourceType: input.resourceType
    });
    const [total, candidates] = await Promise.all([
      prisma.apiKey.count({ where }),
      prisma.apiKey.findMany({
        where,
        include: { user: true, rental: true },
        orderBy: { createdAt: "desc" },
        take: input.limit
      })
    ]);
    const targetKeys = candidates.filter((apiKey) => apiKey.status !== input.status);
    const inactiveRentalKeys = input.status === "active"
      ? targetKeys.filter((apiKey) => apiKey.rental?.status !== "active")
      : [];
    if (inactiveRentalKeys.length) {
      throw new AppError("rental_not_active", "Cannot activate API keys for inactive rentals", 400, {
        count: inactiveRentalKeys.length,
        apiKeyIds: inactiveRentalKeys.slice(0, 20).map((apiKey) => apiKey.id)
      });
    }

    const sub2SyncResults = [];
    for (const apiKey of targetKeys) {
      const sub2Sync = await syncSub2KeyForRental(apiKey.rental?.userId ?? apiKey.userId, apiKey.rental?.sub2KeyId, input.status === "active");
      sub2SyncResults.push({
        apiKeyId: apiKey.id,
        rentalId: apiKey.rentalId,
        sub2KeyId: apiKey.rental?.sub2KeyId,
        ...sub2Sync
      });
    }
    const failedSub2Sync = sub2SyncResults.filter((result) => !result.ok);
    if (input.status === "active" && failedSub2Sync.length) {
      throw new AppError("sub2_key_enable_failed", "One or more Sub2 keys could not be enabled", 502, {
        failed: failedSub2Sync.slice(0, 20)
      });
    }

    const updated = targetKeys.length
      ? await prisma.apiKey.updateMany({
        where: { id: { in: targetKeys.map((apiKey) => apiKey.id) } },
        data: { status: input.status }
      })
      : { count: 0 };
    const result = {
      matched: total,
      processed: candidates.length,
      changed: updated.count,
      skippedAlreadyStatus: candidates.length - targetKeys.length,
      truncated: total > candidates.length,
      limit: input.limit,
      targetStatus: input.status,
      sub2SyncAttempted: sub2SyncResults.length,
      sub2SyncFailed: failedSub2Sync.length,
      sub2SyncFailures: failedSub2Sync.slice(0, 20)
    };
    await writeAuditLog(request, actor.id, "admin.api_key.bulk_status", "api_key", undefined, {
      filters: {
        q: nonEmpty(input.q),
        currentStatus: input.currentStatus,
        resourceType: input.resourceType,
        limit: input.limit
      },
      matched: total,
      processed: candidates.length
    }, result);
    return adminOk(reply, result);
  });

  app.patch("/api/admin/api-keys/:id/status", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = apiKeyStatusSchema.parse(request.body ?? {});
    const before = await prisma.apiKey.findUnique({
      where: { id },
      include: { user: true, rental: true }
    });
    if (!before) throw new AppError("api_key_not_found", "API key not found", 404);
    if (input.status === "active" && before.rental?.status !== "active") {
      throw new AppError("rental_not_active", "Cannot activate API key for an inactive rental", 400);
    }

    const sub2Sync = await syncSub2KeyForRental(before.rental?.userId ?? before.userId, before.rental?.sub2KeyId, input.status === "active");
    if (input.status === "active" && !sub2Sync.ok) {
      throw new AppError("sub2_key_enable_failed", "Sub2 key enable failed", 502, sub2Sync.error);
    }

    const apiKey = await prisma.apiKey.update({
      where: { id },
      data: { status: input.status }
    });
    await writeAuditLog(request, actor.id, "admin.api_key.status", "api_key", id, {
      status: before.status,
      rentalId: before.rentalId,
      sub2KeyId: before.rental?.sub2KeyId
    }, {
      status: apiKey.status,
      sub2Sync
    });
    return adminOk(reply, apiKey);
  });

  app.get("/api/admin/wallets", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const walletStatus = oneOf(walletManagementStatuses, query.status);
    const where: Prisma.WalletAccountWhereInput = {
      ...nonSmokeWalletWhere(),
      ...walletManagementStatusWhere(walletStatus),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { userId: containsText(query.q) },
          { user: { id: containsText(query.q) } },
          { user: { email: containsText(query.q) } },
          { user: { displayName: containsText(query.q) } }
        ]
      } : {})
    };
    const [wallets, total] = await Promise.all([
      prisma.walletAccount.findMany({
        where,
        include: { user: { include: { roles: true } } },
        orderBy: { updatedAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.walletAccount.count({ where })
    ]);
    return adminOk(reply, paged(wallets, total, query));
  });

  app.get("/api/admin/wallets/:id", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const { id } = request.params as { id: string };
    const wallet = await prisma.walletAccount.findUnique({
      where: { id },
      include: {
        user: { include: { roles: true } },
        transactions: {
          orderBy: { createdAt: "desc" },
          take: 100
        }
      }
    });
    if (!wallet) throw new AppError("wallet_not_found", "Wallet not found", 404);
    const transactionSummary = await prisma.walletTransaction.aggregate({
      where: { walletId: id },
      _count: true,
      _sum: { amount: true }
    });
    return adminOk(reply, { ...wallet, transactionSummary });
  });

  app.get("/api/admin/wallet-transactions", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const where: Prisma.WalletTransactionWhereInput = {
      ...nonSmokeWalletTransactionWhere(),
      ...(oneOf(["recharge", "freeze", "unfreeze", "consume", "refund", "withdrawal_freeze", "withdrawal_paid", "adjustment"] as const, query.status) ? {
        type: oneOf(["recharge", "freeze", "unfreeze", "consume", "refund", "withdrawal_freeze", "withdrawal_paid", "adjustment"] as const, query.status)
      } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { walletId: containsText(query.q) },
          { refType: containsText(query.q) },
          { refId: containsText(query.q) },
          { note: containsText(query.q) },
          { wallet: { user: { email: containsText(query.q) } } }
        ]
      } : {})
    };
    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where,
        include: { wallet: { include: { user: true } } },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.walletTransaction.count({ where })
    ]);
    return adminOk(reply, paged(transactions, total, query));
  });

  app.get("/api/admin/sales", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(orderStatuses, query.status);
    const where: Prisma.OrderWhereInput = {
      ...nonSmokeOrderWhere(),
      ...(status ? { status } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { paymentRef: containsText(query.q) },
          { userId: containsText(query.q) },
          { user: { id: containsText(query.q) } },
          { user: { email: containsText(query.q) } },
          { user: { displayName: containsText(query.q) } },
          { items: { some: { productId: containsText(query.q) } } },
          { items: { some: { priceId: containsText(query.q) } } },
          { items: { some: { product: { id: containsText(query.q) } } } },
          { items: { some: { product: { name: containsText(query.q) } } } },
          { rentals: { some: { id: containsText(query.q) } } },
          { rentals: { some: { productId: containsText(query.q) } } },
          { rentals: { some: { sub2KeyId: containsText(query.q) } } },
          { rentals: { some: { endpointUrl: containsText(query.q) } } }
        ]
      } : {})
    };
    const usageWhere: Prisma.UsageRecordWhereInput = {
      ...nonSmokeUsageWhere(),
      rental: {
        ...nonSmokeRentalWhere(),
        order: where
      }
    };
    const [orders, total, orderAgg, usageAgg, salesBreakdown] = await Promise.all([
      prisma.order.findMany({
        where,
        include: { user: true, items: true, rentals: true },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.order.count({ where }),
      prisma.order.aggregate({
        where,
        _sum: { totalAmount: true, paidAmount: true },
        _count: true
      }),
      prisma.usageRecord.aggregate({
        where: usageWhere,
        _sum: { buyerCharge: true, supplierIncome: true },
        _count: true
      }),
      buildSalesBreakdown(where)
    ]);
    return adminOk(reply, {
      ...paged(orders, total, query),
      orders,
      summary: {
        orderCount: orderAgg._count,
        totalAmount: orderAgg._sum.totalAmount ?? 0,
        paidAmount: orderAgg._sum.paidAmount ?? 0,
        usageCount: usageAgg._count,
        usageCharge: usageAgg._sum.buyerCharge ?? 0,
        supplierIncome: usageAgg._sum.supplierIncome ?? 0
      },
      breakdown: salesBreakdown
    });
  });

  app.get("/api/admin/reconciliation", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    return adminOk(reply, await findBillingReconciliationIssues());
  });

  app.get("/api/admin/usages", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(usageStatuses, query.status);
    const resourceType = oneOf(resourceTypes, query.resourceType);
    const where: Prisma.UsageRecordWhereInput = {
      ...nonSmokeUsageWhere(),
      ...(status ? { status } : {}),
      ...(resourceType ? { resourceType } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { sub2RequestId: containsText(query.q) },
          { rentalId: containsText(query.q) },
          { userId: containsText(query.q) },
          { model: containsText(query.q) },
          { rental: { id: containsText(query.q) } },
          { rental: { productId: containsText(query.q) } },
          { rental: { user: { id: containsText(query.q) } } },
          { rental: { user: { email: containsText(query.q) } } },
          { rental: { product: { id: containsText(query.q) } } },
          { rental: { product: { name: containsText(query.q) } } },
          { rental: { order: { items: { some: { priceId: containsText(query.q) } } } } },
          { rental: { order: { items: { some: { productId: containsText(query.q) } } } } },
          { supplierResource: { id: containsText(query.q) } },
          { supplierResource: { sub2AccountId: containsText(query.q) } },
          { supplierResource: { supplier: { user: { email: containsText(query.q) } } } },
          ...(oneOf(resourceTypes, query.q) ? [{ resourceType: oneOf(resourceTypes, query.q) }] : []),
          ...(oneOf(usageStatuses, query.q) ? [{ status: oneOf(usageStatuses, query.q) }] : [])
        ]
      } : {})
    };
    const [usages, total, summary] = await Promise.all([
      prisma.usageRecord.findMany({
        where,
        include: {
          rental: { include: { user: true, product: true } },
          supplierResource: { include: { supplier: { include: { user: true } } } },
          settlements: { orderBy: { createdAt: "desc" }, take: 5 }
        },
        orderBy: { occurredAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.usageRecord.count({ where }),
      prisma.usageRecord.aggregate({
        where,
        _sum: { buyerCharge: true, supplierIncome: true, inputUnits: true, outputUnits: true },
        _count: true
      })
    ]);
    return adminOk(reply, { ...paged(usages, total, query), summary });
  });

  app.post("/api/admin/usages/sync-sub2", async (request, reply) => {
    const actor = await requireRole(request, ["operator", "admin"]);
    const input = usageSyncSchema.parse(request.body ?? {});
    const result = await syncSub2UsageOnce(input.cursor, { persistCursor: true });
    await writeAuditLog(request, actor.id, "admin.usage.sync_sub2", "usage_sync", undefined, null, result);
    return adminOk(reply, result);
  });

  app.get("/api/admin/usages/sync-state", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    return adminOk(reply, await getSub2UsageSyncState());
  });

  app.get("/api/admin/products", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(productStatuses, query.status);
    const resourceType = oneOf(resourceTypes, query.resourceType);
    const where: Prisma.ProductWhereInput = {
      ...nonSmokeProductWhere(),
      ...(status ? { status } : {}),
      ...(resourceType ? { resourceType } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { name: containsText(query.q) },
          { description: containsText(query.q) },
          { prices: { some: { tierCode: containsText(query.q) } } },
          { prices: { some: { displayName: containsText(query.q) } } },
          ...(oneOf(resourceTypes, query.q) ? [{ resourceType: oneOf(resourceTypes, query.q) }] : []),
          ...(oneOf(productStatuses, query.q) ? [{ status: oneOf(productStatuses, query.q) }] : [])
        ]
      } : {})
    };
    const [products, total, deliveryReadiness] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          prices: { orderBy: { createdAt: "desc" } },
          _count: { select: { prices: true, orders: true, rentals: true } }
        },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.product.count({ where }),
      codexDeliveryReadinessSnapshot()
    ]);
    return adminOk(reply, paged(products.map((product) => productWithDeliveryReadiness(product, deliveryReadiness)), total, query));
  });

  app.post("/api/admin/products", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const input = createProductSchema.parse(request.body);
    await enforceCodexProductActivationReadiness({
      resourceType: input.resourceType,
      productStatus: input.status,
      productName: input.name,
      allowUnavailableDelivery: input.allowUnavailableDelivery
    });
    const product = await prisma.product.create({
      data: {
        name: input.name,
        resourceType: input.resourceType,
        billingMode: input.billingMode,
        status: input.status,
        description: input.description
      },
      include: {
        prices: true,
        _count: { select: { prices: true, orders: true, rentals: true } }
      }
    });
    await writeAuditLog(request, actor.id, "admin.product.create", "product", product.id, null, {
      name: product.name,
      resourceType: product.resourceType,
      billingMode: product.billingMode,
      status: product.status,
      allowUnavailableDelivery: input.allowUnavailableDelivery || undefined
    });
    return adminOk(reply, productWithDeliveryReadiness(product, await codexDeliveryReadinessSnapshot()));
  });

  app.get("/api/admin/products/:id", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const { id } = request.params as { id: string };
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        prices: { orderBy: { createdAt: "desc" } },
        _count: { select: { prices: true, orders: true, rentals: true } }
      }
    });
    if (!product) throw new AppError("product_not_found", "Product not found", 404);
    return adminOk(reply, productWithDeliveryReadiness(product, await codexDeliveryReadinessSnapshot()));
  });

  app.patch("/api/admin/products/:id", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = updateProductSchema.parse(request.body ?? {});
    const before = await prisma.product.findUnique({
      where: { id },
      select: { id: true, name: true, resourceType: true, billingMode: true, status: true, description: true }
    });
    if (!before) throw new AppError("product_not_found", "Product not found", 404);
    await enforceCodexProductActivationReadiness({
      productId: id,
      productName: input.name ?? before.name,
      resourceType: input.resourceType ?? before.resourceType,
      productStatus: input.status ?? before.status,
      allowUnavailableDelivery: input.allowUnavailableDelivery
    });
    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.resourceType !== undefined ? { resourceType: input.resourceType } : {}),
        ...(input.billingMode !== undefined ? { billingMode: input.billingMode } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.description !== undefined ? { description: input.description } : {})
      },
      include: {
        prices: { orderBy: { createdAt: "desc" } },
        _count: { select: { prices: true, orders: true, rentals: true } }
      }
    });
    await writeAuditLog(request, actor.id, "admin.product.update", "product", id, before, {
      name: product.name,
      resourceType: product.resourceType,
      billingMode: product.billingMode,
      status: product.status,
      description: product.description,
      allowUnavailableDelivery: input.allowUnavailableDelivery || undefined
    });
    return adminOk(reply, productWithDeliveryReadiness(product, await codexDeliveryReadinessSnapshot()));
  });

  app.post("/api/admin/products/:id/prices", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = createProductPriceSchema.parse(request.body);
    const product = await prisma.product.findUnique({
      where: { id },
      select: { id: true, name: true, billingMode: true, resourceType: true, status: true }
    });
    if (!product) throw new AppError("product_not_found", "Product not found", 404);
    validateProductPricePurchaseMode(product.billingMode, input.fixedPrice);
    await enforceCodexPriceActivationReadiness({
      productId: id,
      productName: product.name,
      resourceType: product.resourceType,
      productStatus: product.status,
      billingMode: product.billingMode,
      priceStatus: input.status,
      fixedPrice: input.fixedPrice,
      allowUnavailableDelivery: input.allowUnavailableDelivery
    });
    const existing = await prisma.productPrice.findUnique({
      where: { productId_tierCode: { productId: id, tierCode: input.tierCode } },
      select: { id: true }
    });
    if (existing) throw new AppError("product_price_exists", "Product price tier already exists", 409);
    const price = await prisma.productPrice.create({
      data: {
        productId: id,
        tierCode: input.tierCode,
        displayName: input.displayName,
        fixedPrice: decimalOrNull(input.fixedPrice),
        durationDays: input.durationDays,
        maxConcurrency: input.maxConcurrency,
        rpmLimit: input.rpmLimit,
        tpmLimit: input.tpmLimit,
        requestLimit: input.requestLimit,
        spendLimit: input.spendLimit !== undefined ? new Prisma.Decimal(input.spendLimit) : undefined,
        discountRate: new Prisma.Decimal(input.discountRate),
        tierMultiplier: new Prisma.Decimal(input.tierMultiplier),
        status: input.status
      }
    });
    await writeAuditLog(request, actor.id, "admin.product_price.create", "product_price", price.id, null, {
      productId: id,
      tierCode: price.tierCode,
      displayName: price.displayName,
      fixedPrice: price.fixedPrice ? String(price.fixedPrice) : null,
      rpmLimit: price.rpmLimit,
      tpmLimit: price.tpmLimit,
      spendLimit: price.spendLimit ? String(price.spendLimit) : null,
      status: price.status,
      allowUnavailableDelivery: input.allowUnavailableDelivery || undefined
    });
    return adminOk(reply, price);
  });

  app.patch("/api/admin/product-prices/:id", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = updateProductPriceSchema.parse(request.body ?? {});
    const before = await prisma.productPrice.findUnique({
      where: { id },
      select: {
        id: true,
        productId: true,
        displayName: true,
        fixedPrice: true,
        durationDays: true,
        maxConcurrency: true,
        rpmLimit: true,
        tpmLimit: true,
        requestLimit: true,
        spendLimit: true,
        discountRate: true,
        tierMultiplier: true,
        status: true,
        product: { select: { id: true, name: true, billingMode: true, resourceType: true, status: true } }
      }
    });
    if (!before) throw new AppError("product_price_not_found", "Product price not found", 404);
    if (input.fixedPrice !== undefined) {
      validateProductPricePurchaseMode(before.product.billingMode, input.fixedPrice);
    }
    await enforceCodexPriceActivationReadiness({
      productId: before.productId,
      productName: before.product.name,
      priceId: id,
      resourceType: before.product.resourceType,
      productStatus: before.product.status,
      billingMode: before.product.billingMode,
      priceStatus: input.status ?? before.status,
      fixedPrice: input.fixedPrice !== undefined ? input.fixedPrice : before.fixedPrice,
      allowUnavailableDelivery: input.allowUnavailableDelivery
    });
    const price = await prisma.productPrice.update({
      where: { id },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.fixedPrice !== undefined ? { fixedPrice: decimalOrNull(input.fixedPrice) } : {}),
        ...(input.durationDays !== undefined ? { durationDays: input.durationDays } : {}),
        ...(input.maxConcurrency !== undefined ? { maxConcurrency: input.maxConcurrency } : {}),
        ...(input.rpmLimit !== undefined ? { rpmLimit: input.rpmLimit } : {}),
        ...(input.tpmLimit !== undefined ? { tpmLimit: input.tpmLimit } : {}),
        ...(input.requestLimit !== undefined ? { requestLimit: input.requestLimit } : {}),
        ...(input.spendLimit !== undefined ? { spendLimit: decimalOrNull(input.spendLimit) } : {}),
        ...(input.discountRate !== undefined ? { discountRate: new Prisma.Decimal(input.discountRate) } : {}),
        ...(input.tierMultiplier !== undefined ? { tierMultiplier: new Prisma.Decimal(input.tierMultiplier) } : {}),
        ...(input.status !== undefined ? { status: input.status } : {})
      }
    });
    await writeAuditLog(request, actor.id, "admin.product_price.update", "product_price", id, before, {
      productId: price.productId,
      displayName: price.displayName,
      fixedPrice: price.fixedPrice ? String(price.fixedPrice) : null,
      durationDays: price.durationDays,
      maxConcurrency: price.maxConcurrency,
      rpmLimit: price.rpmLimit,
      tpmLimit: price.tpmLimit,
      requestLimit: price.requestLimit,
      spendLimit: price.spendLimit ? String(price.spendLimit) : null,
      discountRate: String(price.discountRate),
      tierMultiplier: String(price.tierMultiplier),
      status: price.status,
      allowUnavailableDelivery: input.allowUnavailableDelivery || undefined
    });
    return adminOk(reply, price);
  });

  app.get("/api/admin/suppliers", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(supplierStatuses, query.status);
    const where: Prisma.SupplierWhereInput = {
      ...(status ? { status } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { displayName: containsText(query.q) },
          { userId: containsText(query.q) },
          { user: { id: containsText(query.q) } },
          { user: { email: containsText(query.q) } },
          { user: { displayName: containsText(query.q) } },
          ...(oneOf(supplierStatuses, query.q) ? [{ status: oneOf(supplierStatuses, query.q) }] : [])
        ]
      } : {})
    };
    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        include: {
          user: { include: { roles: true } },
          resources: { orderBy: { updatedAt: "desc" }, take: 5 },
          _count: { select: { resources: true, withdrawals: true } }
        },
        orderBy: { updatedAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.supplier.count({ where })
    ]);
    return adminOk(reply, paged(suppliers, total, query));
  });

  app.patch("/api/admin/suppliers/:id", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = updateSupplierSchema.parse(request.body ?? {});
    const before = await prisma.supplier.findUnique({
      where: { id },
      select: { id: true, userId: true, displayName: true, status: true, defaultShareRate: true }
    });
    if (!before) throw new AppError("supplier_not_found", "Supplier not found", 404);
    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.defaultShareRate !== undefined ? { defaultShareRate: new Prisma.Decimal(input.defaultShareRate) } : {})
      },
      include: {
        user: { include: { roles: true } },
        resources: { orderBy: { updatedAt: "desc" }, take: 5 },
        _count: { select: { resources: true, withdrawals: true } }
      }
    });
    await writeAuditLog(request, actor.id, "admin.supplier.update", "supplier", id, {
      userId: before.userId,
      displayName: before.displayName,
      status: before.status,
      defaultShareRate: String(before.defaultShareRate)
    }, {
      userId: supplier.userId,
      displayName: supplier.displayName,
      status: supplier.status,
      defaultShareRate: String(supplier.defaultShareRate)
    });
    return adminOk(reply, supplier);
  });

  app.get("/api/admin/resources", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(resourceStatuses, query.status);
    const resourceType = oneOf(resourceTypes, query.resourceType);
    const productionScope = query.action === "production";
    const where: Prisma.SupplierResourceWhereInput = {
      ...(productionScope ? nonSmokeSupplierResourceWhere() : {}),
      ...(status ? { status } : {}),
      ...(resourceType ? { resourceType } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { supplierId: containsText(query.q) },
          { sub2AccountId: containsText(query.q) },
          { supplier: { user: { id: containsText(query.q) } } },
          { supplier: { user: { email: containsText(query.q) } } },
          { supplier: { user: { displayName: containsText(query.q) } } },
          ...(oneOf(resourceTypes, query.q) ? [{ resourceType: oneOf(resourceTypes, query.q) }] : []),
          ...(oneOf(resourceLevels, query.q) ? [{ level: oneOf(resourceLevels, query.q) }] : [])
        ]
      } : {})
    };
    const [resources, total] = await Promise.all([
      prisma.supplierResource.findMany({
        where,
        include: {
          supplier: { include: { user: true } },
          credential: { select: resourceCredentialSummarySelect }
        },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.supplierResource.count({ where })
    ]);
    return adminOk(reply, paged(resources, total, query));
  });

  app.post("/api/admin/resources", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const input = createResourceSchema.parse(request.body);
    const email = input.supplierEmail.toLowerCase();
    validateInitialResourceCredentialApplyRequest(input);
    if (input.credentialSecret && !env.API_KEY_ENCRYPTION_SECRET) {
      throw new AppError("credential_encryption_secret_missing", "API_KEY_ENCRYPTION_SECRET must be configured before storing resource credentials", 500);
    }
    const initialCredential = input.credentialSecret
      ? initialResourceCredentialCreateData({
        credentialType: input.credentialType,
        credentialStatus: input.credentialStatus,
        credentialSecret: input.credentialSecret
      }, env.API_KEY_ENCRYPTION_SECRET!)
      : null;
    const initialOnlineReadiness = inspectSupplierResourceManualOnlineReadiness({
      resourceType: input.resourceType,
      targetStatus: input.status,
      sub2AccountId: input.sub2AccountId,
      credential: initialCredential
    });
    if (input.status === "online" && !initialOnlineReadiness.ok) {
      throw new AppError(initialOnlineReadiness.code, initialOnlineReadiness.message, 400, { issues: initialOnlineReadiness.issues });
    }
    const initialStatusTransition = inspectSupplierResourceReadinessMutationStatusTransition({
      currentStatus: input.status,
      resourceType: input.resourceType,
      sub2AccountId: input.sub2AccountId,
      credential: initialCredential
    });
    const resource = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { email } });
      if (!user) throw new AppError("supplier_user_not_found", "Supplier user not found", 404);
      await tx.userRole.upsert({
        where: { userId_role: { userId: user.id, role: "supplier" } },
        update: {},
        create: { userId: user.id, role: "supplier" }
      });
      const supplier = await tx.supplier.upsert({
        where: { userId: user.id },
        update: { displayName: input.displayName },
        create: { userId: user.id, displayName: input.displayName }
      });
      return tx.supplierResource.create({
        data: {
          supplierId: supplier.id,
          resourceType: input.resourceType,
          status: initialStatusTransition.status,
          level: input.level,
          maxConcurrency: input.maxConcurrency,
          shareRate: new Prisma.Decimal(input.shareRate),
          reserveRatio: new Prisma.Decimal(input.reserveRatio),
          dailyCap: input.dailyCap === undefined ? undefined : new Prisma.Decimal(input.dailyCap),
          sub2AccountId: input.sub2AccountId,
          ...(initialCredential ? { credential: { create: initialCredential } } : {})
        },
        include: {
          supplier: { include: { user: true } },
          credential: { select: resourceCredentialSummarySelect }
        }
      });
    });
    await writeAuditLog(request, actor.id, "admin.resource.create", "supplier_resource", resource.id, null, {
      supplierEmail: email,
      resourceType: resource.resourceType,
      status: resource.status,
      level: resource.level,
      maxConcurrency: resource.maxConcurrency,
      sub2AccountId: resource.sub2AccountId,
      credential: resource.credential ? resourceCredentialAuditPayload(resource.credential) : null,
      statusTransition: initialStatusTransition
    });
    const credentialApply = input.applyCredentialToSub2
      ? await applyStoredResourceCredentialToSub2(request, actor.id, resource.id, {
        clientId: input.credentialClientId,
        proxyId: input.credentialProxyId,
        runSmokeTest: input.credentialRunSmokeTest,
        smokeModel: input.credentialSmokeModel
      })
      : null;
    return adminOk(reply, { ...(credentialApply?.resource ?? resource), credentialApply });
  });

  app.get("/api/admin/resources/:id", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const { id } = request.params as { id: string };
    const resource = await prisma.supplierResource.findUnique({
      where: { id },
      include: {
        supplier: { include: { user: { include: { roles: true } } } },
        credential: { select: resourceCredentialSummarySelect },
        usages: {
          include: { rental: { include: { user: true, product: true } } },
          orderBy: { occurredAt: "desc" },
          take: 50
        },
        settlements: {
          include: { usageRecord: true },
          orderBy: { createdAt: "desc" },
          take: 50
        }
      }
    });
    if (!resource) throw new AppError("resource_not_found", "Supplier resource not found", 404);
    const [usageSummary, settlementSummary, credentialApplyLogs] = await Promise.all([
      prisma.usageRecord.aggregate({
        where: { supplierResourceId: id },
        _count: true,
        _sum: { buyerCharge: true, supplierIncome: true, inputUnits: true, outputUnits: true }
      }),
      prisma.settlementRecord.aggregate({
        where: { supplierResourceId: id },
        _count: true,
        _sum: { amount: true }
      }),
      prisma.auditLog.findMany({
        where: {
          action: { in: ["admin.resource.credential_apply_sub2", "admin.sub2.account.save_refresh_token_resource"] },
          objectType: "supplier_resource",
          objectId: id
        },
        select: {
          id: true,
          action: true,
          objectType: true,
          objectId: true,
          after: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
          actor: { select: { id: true, email: true, displayName: true } }
        },
        orderBy: { createdAt: "desc" },
        take: 5
      })
    ]);
    return adminOk(reply, { ...resource, usageSummary, settlementSummary, credentialApplyLogs });
  });

  app.patch("/api/admin/resources/:id", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = updateResourceSchema.parse(request.body);
    const before = await prisma.supplierResource.findUnique({
      where: { id },
      select: {
        id: true,
        resourceType: true,
        status: true,
        level: true,
        maxConcurrency: true,
        shareRate: true,
        reserveRatio: true,
        dailyCap: true,
        sub2AccountId: true,
        lastCheckedAt: true,
        credential: { select: resourceCredentialSummarySelect }
      }
    });
    if (!before) throw new AppError("resource_not_found", "Supplier resource not found", 404);
    const nextStatus = input.status ?? before.status;
    const nextSub2AccountId = input.sub2AccountId !== undefined ? input.sub2AccountId : before.sub2AccountId;
    const onlineReadiness = inspectSupplierResourceManualOnlineReadiness({
      resourceType: before.resourceType,
      targetStatus: nextStatus,
      sub2AccountId: nextSub2AccountId,
      credential: before.credential
    });
    if (input.status === "online" && !onlineReadiness.ok) {
      throw new AppError(onlineReadiness.code, onlineReadiness.message, 400, { issues: onlineReadiness.issues });
    }
    const statusTransition = inspectSupplierResourceReadinessMutationStatusTransition({
      currentStatus: nextStatus,
      resourceType: before.resourceType,
      sub2AccountId: nextSub2AccountId,
      credential: before.credential
    });

    const data: Prisma.SupplierResourceUpdateInput = {};
    if (input.status !== undefined) data.status = input.status;
    if (input.level !== undefined) data.level = input.level;
    if (input.maxConcurrency !== undefined) data.maxConcurrency = input.maxConcurrency;
    if (input.shareRate !== undefined) data.shareRate = new Prisma.Decimal(input.shareRate);
    if (input.reserveRatio !== undefined) data.reserveRatio = new Prisma.Decimal(input.reserveRatio);
    if (input.dailyCap !== undefined) data.dailyCap = input.dailyCap === null ? null : new Prisma.Decimal(input.dailyCap);
    if (input.sub2AccountId !== undefined) {
      data.sub2AccountId = input.sub2AccountId;
      data.lastCheckedAt = null;
    }
    if (statusTransition.changed) {
      data.status = statusTransition.status;
      data.lastCheckedAt = null;
    }

    const resource = await prisma.supplierResource.update({
      where: { id },
      data,
      include: {
        supplier: { include: { user: true } },
        credential: { select: resourceCredentialSummarySelect }
      }
    });
    await writeAuditLog(request, actor.id, "admin.resource.update", "supplier_resource", id, resourceConfigAuditPayload(before), {
      ...resourceConfigAuditPayload(resource),
      statusTransition
    });
    return adminOk(reply, { ...resource, statusTransition });
  });

  app.put("/api/admin/resources/:id/credential", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = upsertResourceCredentialSchema.parse(request.body);
    const resource = await prisma.supplierResource.findUnique({
      where: { id },
      select: {
        id: true,
        resourceType: true,
        status: true,
        sub2AccountId: true,
        lastCheckedAt: true,
        credential: { select: resourceCredentialSummarySelect }
      }
    });
    if (!resource) throw new AppError("resource_not_found", "Supplier resource not found", 404);
    if (!env.API_KEY_ENCRYPTION_SECRET) {
      throw new AppError("credential_encryption_secret_missing", "API_KEY_ENCRYPTION_SECRET must be configured before storing resource credentials", 500);
    }

    const encrypted = encryptSupplierResourceCredential(input.secret, env.API_KEY_ENCRYPTION_SECRET);
    const credential = await prisma.supplierResourceCredential.upsert({
      where: { supplierResourceId: id },
      update: {
        credentialType: input.credentialType,
        encryptedValue: encrypted.encryptedValue,
        encryptionVersion: encrypted.encryptionVersion,
        keyFingerprint: encrypted.keyFingerprint,
        status: input.status,
        lastRotatedAt: new Date()
      },
      create: {
        supplierResourceId: id,
        credentialType: input.credentialType,
        encryptedValue: encrypted.encryptedValue,
        encryptionVersion: encrypted.encryptionVersion,
        keyFingerprint: encrypted.keyFingerprint,
        status: input.status
      },
      select: resourceCredentialSummarySelect
    });
    const statusTransition = inspectSupplierResourceReadinessMutationStatusTransition({
      currentStatus: resource.status,
      resourceType: resource.resourceType,
      sub2AccountId: resource.sub2AccountId,
      credential
    });
    const resourceStatus = statusTransition.changed
      ? await prisma.supplierResource.update({
        where: { id },
        data: {
          status: statusTransition.status,
          lastCheckedAt: null
        },
        select: { status: true, lastCheckedAt: true }
      })
      : { status: resource.status, lastCheckedAt: resource.lastCheckedAt };
    await writeAuditLog(request, actor.id, "admin.resource.credential_upsert", "supplier_resource", id, {
      credential: resource.credential ? resourceCredentialAuditPayload(resource.credential) : null,
      resource: {
        status: resource.status,
        sub2AccountId: resource.sub2AccountId,
        lastCheckedAt: resource.lastCheckedAt?.toISOString() ?? null
      }
    }, {
      credential: resourceCredentialAuditPayload(credential),
      resource: {
        status: resourceStatus.status,
        sub2AccountId: resource.sub2AccountId,
        lastCheckedAt: resourceStatus.lastCheckedAt?.toISOString() ?? null
      },
      statusTransition
    });
    return adminOk(reply, { credential, statusTransition, resourceStatus });
  });

  app.delete("/api/admin/resources/:id/credential", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const resource = await prisma.supplierResource.findUnique({
      where: { id },
      select: {
        id: true,
        resourceType: true,
        status: true,
        sub2AccountId: true,
        lastCheckedAt: true,
        credential: { select: resourceCredentialSummarySelect }
      }
    });
    if (!resource) throw new AppError("resource_not_found", "Supplier resource not found", 404);

    const deleted = await prisma.supplierResourceCredential.deleteMany({
      where: { supplierResourceId: id }
    });
    const statusTransition = inspectSupplierResourceReadinessMutationStatusTransition({
      currentStatus: resource.status,
      resourceType: resource.resourceType,
      sub2AccountId: resource.sub2AccountId,
      credential: null
    });
    const resourceStatus = statusTransition.changed
      ? await prisma.supplierResource.update({
        where: { id },
        data: {
          status: statusTransition.status,
          lastCheckedAt: null
        },
        select: { status: true, lastCheckedAt: true }
      })
      : { status: resource.status, lastCheckedAt: resource.lastCheckedAt };
    await writeAuditLog(request, actor.id, "admin.resource.credential_delete", "supplier_resource", id, {
      credential: resource.credential ? resourceCredentialAuditPayload(resource.credential) : null,
      resource: {
        status: resource.status,
        sub2AccountId: resource.sub2AccountId,
        lastCheckedAt: resource.lastCheckedAt?.toISOString() ?? null
      }
    }, {
      credential: null,
      deleted: deleted.count,
      resource: {
        status: resourceStatus.status,
        sub2AccountId: resource.sub2AccountId,
        lastCheckedAt: resourceStatus.lastCheckedAt?.toISOString() ?? null
      },
      statusTransition
    });
    return adminOk(reply, { deleted: deleted.count, credential: null, statusTransition, resourceStatus });
  });

  app.post("/api/admin/resources/:id/apply-credential-to-sub2", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = applyResourceCredentialToSub2Schema.parse(request.body ?? {});
    const result = await applyStoredResourceCredentialToSub2(request, actor.id, id, input);
    return adminOk(reply, result);
  });

  app.post("/api/admin/resources/:id/test", async (request, reply) => {
    const actor = await requireRole(request, ["operator", "admin"]);
    const { id } = request.params as { id: string };
    const before = await prisma.supplierResource.findUnique({
      where: { id },
      select: {
        id: true,
        resourceType: true,
        status: true,
        sub2AccountId: true,
        lastCheckedAt: true,
        credential: { select: resourceCredentialSummarySelect }
      }
    });
    if (!before) throw new AppError("resource_not_found", "Supplier resource not found", 404);
    const accountId = parseResourceSub2AccountId(before.sub2AccountId);
    const result = await sub2Client.testAccount(accountId);
    const statusTransition = inspectSupplierResourceTestStatusTransition({
      currentStatus: before.status,
      ok: result.ok,
      resourceType: before.resourceType,
      sub2AccountId: before.sub2AccountId,
      credential: before.credential
    });
    const resource = await prisma.supplierResource.update({
      where: { id },
      data: {
        status: statusTransition.status,
        lastCheckedAt: new Date()
      },
      include: {
        supplier: { include: { user: true } },
        credential: { select: resourceCredentialSummarySelect }
      }
    });
    await writeAuditLog(request, actor.id, "admin.resource.test", "supplier_resource", id, before, {
      status: resource.status,
      sub2AccountId: resource.sub2AccountId,
      ok: result.ok,
      statusCode: result.statusCode,
      events: result.events.map((event) => event.type ?? event.message ?? "event"),
      statusTransition: {
        targetStatus: statusTransition.targetStatus,
        appliedStatus: statusTransition.status,
        blockedOnline: statusTransition.blockedOnline,
        onlineReadiness: statusTransition.onlineReadiness
      }
    });
    return adminOk(reply, { resource, result, statusTransition });
  });

  app.patch("/api/admin/resources/:id/status", async (request, reply) => {
    const actor = await requireRole(request, ["operator", "admin"]);
    const { id } = request.params as { id: string };
    const input = resourceStatusSchema.parse(request.body);
    const before = await prisma.supplierResource.findUnique({
      where: { id },
      select: {
        id: true,
        resourceType: true,
        status: true,
        level: true,
        sub2AccountId: true,
        credential: { select: resourceCredentialSummarySelect }
      }
    });
    if (!before) throw new AppError("resource_not_found", "Supplier resource not found", 404);
    const nextSub2AccountId = input.sub2AccountId !== undefined ? input.sub2AccountId : before.sub2AccountId;
    const onlineReadiness = inspectSupplierResourceManualOnlineReadiness({
      resourceType: before.resourceType,
      targetStatus: input.status,
      sub2AccountId: nextSub2AccountId,
      credential: before.credential
    });
    if (!onlineReadiness.ok) {
      throw new AppError(onlineReadiness.code, onlineReadiness.message, 400, { issues: onlineReadiness.issues });
    }
    const data: Prisma.SupplierResourceUpdateInput = {
      status: input.status,
      lastCheckedAt: new Date()
    };
    if (input.level !== undefined) data.level = input.level;
    if (input.sub2AccountId !== undefined) data.sub2AccountId = input.sub2AccountId;
    const resource = await prisma.supplierResource.update({
      where: { id },
      data,
      include: {
        supplier: { include: { user: true } },
        credential: { select: resourceCredentialSummarySelect }
      }
    });
    await writeAuditLog(request, actor.id, "admin.resource.status", "supplier_resource", id, before, {
      status: resource.status,
      level: resource.level,
      sub2AccountId: resource.sub2AccountId,
      credential: resource.credential ? resourceCredentialAuditPayload(resource.credential) : null
    });
    return adminOk(reply, resource);
  });

  app.get("/api/admin/settlements", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(settlementStatuses, query.status);
    const where: Prisma.SettlementRecordWhereInput = {
      ...(status ? { status } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { supplierResourceId: containsText(query.q) },
          { usageRecordId: containsText(query.q) },
          { supplierResource: { id: containsText(query.q) } },
          { supplierResource: { sub2AccountId: containsText(query.q) } },
          { supplierResource: { supplier: { user: { email: containsText(query.q) } } } },
          { supplierResource: { supplier: { user: { displayName: containsText(query.q) } } } }
        ]
      } : {})
    };
    const [settlements, total] = await Promise.all([
      prisma.settlementRecord.findMany({
        where,
        include: {
          supplierResource: { include: { supplier: { include: { user: true } } } },
          usageRecord: true
        },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.settlementRecord.count({ where })
    ]);
    return adminOk(reply, paged(settlements, total, query));
  });

  app.post("/api/admin/settlements/release-available", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const input = releaseSettlementsSchema.parse(request.body ?? {});
    const result = await releaseAvailableSettlements({ limit: input.limit });
    await writeAuditLog(request, actor.id, "admin.settlement.release_available", "settlement", undefined, null, result);
    return adminOk(reply, result);
  });

  app.get("/api/admin/withdrawals", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(withdrawalStatuses, query.status);
    const where: Prisma.WithdrawalWhereInput = {
      ...(status ? { status } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { supplierId: containsText(query.q) },
          { payoutRef: containsText(query.q) },
          { note: containsText(query.q) },
          { supplier: { id: containsText(query.q) } },
          { supplier: { displayName: containsText(query.q) } },
          { supplier: { user: { id: containsText(query.q) } } },
          { supplier: { user: { email: containsText(query.q) } } },
          { supplier: { user: { displayName: containsText(query.q) } } },
          { settlements: { some: { id: containsText(query.q) } } },
          { settlements: { some: { settlementRecordId: containsText(query.q) } } },
          ...(oneOf(withdrawalStatuses, query.q) ? [{ status: oneOf(withdrawalStatuses, query.q) }] : [])
        ]
      } : {})
    };
    const [withdrawals, total, summary] = await Promise.all([
      prisma.withdrawal.findMany({
        where,
        include: withdrawalInclude,
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.withdrawal.count({ where }),
      prisma.withdrawal.aggregate({
        where,
        _sum: { amount: true },
        _count: true
      })
    ]);
    return adminOk(reply, { ...paged(withdrawals, total, query), summary });
  });

  app.post("/api/admin/withdrawals", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const input = createWithdrawalSchema.parse(request.body ?? {});
    const email = input.supplierEmail.toLowerCase();
    const supplier = await prisma.supplier.findFirst({
      where: { user: { email } },
      include: { user: true }
    });
    if (!supplier) throw new AppError("supplier_not_found", "Supplier not found", 404);

    const amount = new Prisma.Decimal(input.amount);
    ensureMinimumWithdrawalAmount(amount);
    ensurePayoutRefForPaid(input.status, input.payoutRef);
    if (reservesSupplierSettlement(input.status)) {
      await ensureSupplierWithdrawableAmount(supplier.id, amount);
    }

    const withdrawal = await prisma.$transaction(async (tx) => {
      const created = await tx.withdrawal.create({
        data: {
          supplierId: supplier.id,
          amount,
          currency: input.currency.toUpperCase(),
          status: input.status,
          payoutRef: input.payoutRef,
          note: input.note
        }
      });
      if (reservesSupplierSettlement(input.status)) {
        await allocateWithdrawalSettlements(tx, supplier.id, created.id, amount, input.status === "paid" ? "paid" : "reserved");
      }
      return tx.withdrawal.findUniqueOrThrow({ where: { id: created.id }, include: withdrawalInclude });
    });
    await writeAuditLog(request, actor.id, "admin.withdrawal.create", "withdrawal", withdrawal.id, null, {
      supplierEmail: email,
      amount: String(withdrawal.amount),
      currency: withdrawal.currency,
      status: withdrawal.status,
      payoutRef: withdrawal.payoutRef,
      note: withdrawal.note
    });
    return adminOk(reply, withdrawal);
  });

  app.patch("/api/admin/withdrawals/:id", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = updateWithdrawalSchema.parse(request.body ?? {});
    const before = await prisma.withdrawal.findUnique({
      where: { id },
      include: withdrawalInclude
    });
    if (!before) throw new AppError("withdrawal_not_found", "Withdrawal not found", 404);

    ensureWithdrawalTransition(before.status, input.status);
    ensurePayoutRefForPaid(input.status, input.payoutRef ?? before.payoutRef ?? undefined);
    if (reservesSupplierSettlement(input.status)) {
      const missing = before.amount.minus(activeWithdrawalAllocationAmount(before.settlements));
      if (missing.gt(0)) {
        await ensureSupplierWithdrawableAmount(before.supplierId, missing, id);
      }
    }

    const withdrawal = await prisma.$transaction(async (tx) => {
      const missing = before.amount.minus(activeWithdrawalAllocationAmount(before.settlements));
      if (reservesSupplierSettlement(input.status) && missing.gt(0)) {
        await allocateWithdrawalSettlements(tx, before.supplierId, id, missing, input.status === "paid" ? "paid" : "reserved");
      }
      if (input.status === "paid") {
        await payWithdrawalSettlements(tx, id);
      }
      if (["rejected", "cancelled"].includes(input.status)) {
        await releaseWithdrawalSettlements(tx, id);
      }
      await tx.withdrawal.update({
        where: { id },
        data: {
          status: input.status,
          ...(input.payoutRef !== undefined ? { payoutRef: input.payoutRef } : {}),
          ...(input.note !== undefined ? { note: input.note } : {})
        }
      });
      return tx.withdrawal.findUniqueOrThrow({ where: { id }, include: withdrawalInclude });
    });
    await writeAuditLog(request, actor.id, "admin.withdrawal.status", "withdrawal", id, {
      status: before.status,
      payoutRef: before.payoutRef,
      note: before.note
    }, {
      status: withdrawal.status,
      payoutRef: withdrawal.payoutRef,
      note: withdrawal.note
    });
    return adminOk(reply, withdrawal);
  });

  app.get("/api/admin/audit-logs", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: containsText(query.action) } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { action: containsText(query.q) },
          { objectType: containsText(query.q) },
          { objectId: containsText(query.q) },
          { actorUserId: containsText(query.q) },
          { ipAddress: containsText(query.q) },
          { userAgent: containsText(query.q) },
          { actor: { id: containsText(query.q) } },
          { actor: { email: containsText(query.q) } },
          { actor: { displayName: containsText(query.q) } }
        ]
      } : {})
    };
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, email: true, displayName: true } } },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.auditLog.count({ where })
    ]);
    return adminOk(reply, paged(logs, total, query));
  });

  app.get("/api/admin/proxy-requests", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const proxyRequestLookup = normalizeProxyRequestLookup(query.q ?? "");
    const conditions: Prisma.ProxyRequestLogWhereInput[] = [
      proxyRequestStatusWhere(query.status),
      ...(query.action ? [{ errorCode: containsText(query.action) }] : []),
      ...(proxyRequestLookup ? [{
        OR: [
          { id: containsText(proxyRequestLookup) },
          { requestId: containsText(proxyRequestLookup) },
          { userId: containsText(proxyRequestLookup) },
          { rentalId: containsText(proxyRequestLookup) },
          { apiKeyId: containsText(proxyRequestLookup) },
          { apiKeyPrefix: containsText(proxyRequestLookup) },
          { upstreamRequestId: containsText(proxyRequestLookup) },
          { method: containsText(proxyRequestLookup) },
          { path: containsText(proxyRequestLookup) },
          { model: containsText(proxyRequestLookup) },
          { errorCode: containsText(proxyRequestLookup) },
          { ipAddress: containsText(proxyRequestLookup) },
          { userAgent: containsText(proxyRequestLookup) },
          { user: { email: containsText(proxyRequestLookup) } },
          { user: { displayName: containsText(proxyRequestLookup) } },
          { rental: { orderId: containsText(proxyRequestLookup) } },
          { rental: { productId: containsText(proxyRequestLookup) } },
          { rental: { supplierResourceId: containsText(proxyRequestLookup) } },
          { rental: { sub2UserId: containsText(proxyRequestLookup) } },
          { rental: { sub2KeyId: containsText(proxyRequestLookup) } },
          { rental: { endpointUrl: containsText(proxyRequestLookup) } },
          { rental: { supplierResource: { id: containsText(proxyRequestLookup) } } },
          { rental: { supplierResource: { sub2AccountId: containsText(proxyRequestLookup) } } },
          { rental: { supplierResource: { supplier: { user: { email: containsText(proxyRequestLookup) } } } } },
          { rental: { product: { id: containsText(proxyRequestLookup) } } },
          { rental: { product: { name: containsText(proxyRequestLookup) } } },
          { rental: { order: { items: { some: { priceId: containsText(proxyRequestLookup) } } } } },
          { rental: { order: { items: { some: { productId: containsText(proxyRequestLookup) } } } } },
          { apiKey: { name: containsText(proxyRequestLookup) } }
        ]
      }] : [])
    ].filter((condition) => Object.keys(condition).length > 0);
    const where: Prisma.ProxyRequestLogWhereInput = conditions.length > 0 ? { AND: conditions } : {};
    const [logs, total] = await Promise.all([
      prisma.proxyRequestLog.findMany({
        where,
        include: {
          user: { select: { id: true, email: true, displayName: true } },
          rental: {
            select: {
              id: true,
              orderId: true,
              productId: true,
              supplierResourceId: true,
              resourceType: true,
              status: true,
              sub2UserId: true,
              sub2KeyId: true,
              endpointUrl: true,
              supplierResource: {
                select: {
                  id: true,
                  resourceType: true,
                  status: true,
                  sub2AccountId: true,
                  supplier: { select: { id: true, displayName: true, user: { select: { id: true, email: true, displayName: true } } } }
                }
              },
              product: { select: { name: true } }
            }
          },
          apiKey: { select: { id: true, name: true, keyPrefix: true, status: true } }
        },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.proxyRequestLog.count({ where })
    ]);
    return adminOk(reply, paged(logs, total, query));
  });

  app.get("/api/admin/sub2/status", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    return adminOk(reply, await sub2Client.fetchGatewayStatus());
  });

  app.get("/api/admin/sub2/bindings/reconciliation", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    return adminOk(reply, await findSub2BindingIssues());
  });

  app.post("/api/admin/sub2/bindings/repair", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const result = await repairSub2Bindings();
    await writeAuditLog(request, actor.id, "admin.sub2.bindings.repair", "sub2_binding", undefined, null, result);
    return adminOk(reply, result);
  });

  app.post("/api/admin/sub2/accounts/:id/refresh", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = sub2AccountParamsSchema.parse(request.params);
    const result = await sub2Client.refreshAccount(id);
    await writeAuditLog(request, actor.id, "admin.sub2.account.refresh", "sub2_account", String(id), null, result);
    return adminOk(reply, result);
  });

  app.post("/api/admin/sub2/accounts/:id/test", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = sub2AccountParamsSchema.parse(request.params);
    const result = await sub2Client.testAccount(id);
    await writeAuditLog(request, actor.id, "admin.sub2.account.test", "sub2_account", String(id), null, {
      ok: result.ok,
      statusCode: result.statusCode,
      events: result.events.map((event) => event.type ?? event.message ?? "event")
    });
    return adminOk(reply, result);
  });

  app.post("/api/admin/sub2/proxy-smoke-test", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const input = sub2SmokeTestSchema.parse(request.body ?? {});
    const result = await runLocalOpenAiProxySmokeTest(input.model);
    await writeAuditLog(request, actor.id, "admin.sub2.proxy_smoke_test", "sub2_proxy", result.sub2KeyId, null, {
      ok: result.ok,
      model: result.model,
      keyDisabled: result.keyDisabled,
      localProxy: result.localProxy,
      models: result.models,
      responses: result.responses
    });
    return adminOk(reply, result);
  });

  app.post("/api/admin/sub2/accounts/:id/apply-openai-refresh-token", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = sub2AccountParamsSchema.parse(request.params);
    const input = sub2OpenAiRefreshTokenSchema.parse(request.body ?? {});
    const resourceSyncTarget = input.saveToResource ? await validateSub2RefreshTokenResourceSyncTarget(input) : null;
    const result = await sub2Client.applyOpenAiRefreshToken(id, {
      refreshToken: input.refreshToken,
      clientId: input.clientId,
      proxyId: input.proxyId
    });
    let testResult: Sub2GatewayAccountTestResult | null = null;
    let smokeTest: Sub2ProxySmokeTestResult | null = null;
    let smokeTestSkippedReason: string | null = null;
    let resourceCredentialSync: Awaited<ReturnType<typeof syncSub2RefreshTokenToSupplierResource>> | { saved: false; skippedReason: string; created: false; resource: null; credential: null } | null = null;
    if (result.ok && input.runAccountTest) {
      testResult = await testSub2AccountForResourceApply(id);
    }
    if (input.saveToResource) {
      if (result.ok && resourceSyncTarget) {
        resourceCredentialSync = await syncSub2RefreshTokenToSupplierResource(request, actor.id, id, input, resourceSyncTarget, testResult);
      } else {
        resourceCredentialSync = { saved: false, skippedReason: "credential_apply_failed", created: false, resource: null, credential: null };
      }
    }
    if (input.runSmokeTest) {
      if (!result.ok) {
        smokeTestSkippedReason = "credential_apply_failed";
      } else if (testResult && !testResult.ok) {
        smokeTestSkippedReason = "sub2_account_test_failed";
      } else {
        smokeTest = await runLocalOpenAiProxySmokeTest(input.smokeModel);
      }
    }
    await writeAuditLog(request, actor.id, "admin.sub2.account.apply_openai_refresh_token", "sub2_account", String(id), null, {
      ok: result.ok,
      refreshed: result.refreshed,
      applied: result.applied,
      error: result.error,
      testRequested: input.runAccountTest,
      test: testResult ? {
        ok: testResult.ok,
        statusCode: testResult.statusCode,
        events: testResult.events.map((event) => event.type ?? event.message ?? "event")
      } : null,
      smokeTestRequested: input.runSmokeTest,
      smokeTestSkippedReason,
      resourceCredentialSync: resourceCredentialSync ? resourceCredentialSyncAuditPayload(resourceCredentialSync) : null,
      smokeTest: smokeTest ? {
        ok: smokeTest.ok,
        model: smokeTest.model,
        keyDisabled: smokeTest.keyDisabled,
        localProxy: smokeTest.localProxy,
        models: smokeTest.models,
        responses: smokeTest.responses
      } : null
    });
    return adminOk(reply, {
      accountId: id,
      result,
      test: testResult,
      resourceCredentialSync,
      smokeTest,
      smokeTestSkippedReason
    });
  });

  adminCapabilityRouteExists = (operation) => app.hasRoute({
    method: operation.method,
    url: operation.path
  });
}

function adminOk(reply: FastifyReply, data: unknown) {
  return ok(reply, redactSecrets(data));
}

function rentalLimitUpdateData(input: z.infer<typeof rentalLimitsSchema>): Prisma.RentalLimitUpdateInput {
  const data: Prisma.RentalLimitUpdateInput = {};
  if (input.maxConcurrency !== undefined) data.maxConcurrency = input.maxConcurrency;
  if (input.rpmLimit !== undefined) data.rpmLimit = input.rpmLimit;
  if (input.tpmLimit !== undefined) data.tpmLimit = input.tpmLimit;
  if (input.requestLimit !== undefined) data.requestLimit = input.requestLimit;
  if (input.spendLimit !== undefined) data.spendLimit = decimalOrNull(input.spendLimit);
  if (input.remainingSpend !== undefined) data.remainingSpend = decimalOrNull(input.remainingSpend);
  return data;
}

function decimalOrNull(value: number | null | undefined) {
  if (value === undefined || value === null) return null;
  return new Prisma.Decimal(value);
}

function ensureMinimumWithdrawalAmount(amount: Prisma.Decimal) {
  const minimum = new Prisma.Decimal(env.MIN_WITHDRAWAL_AMOUNT);
  if (amount.lt(minimum)) {
    throw new AppError("withdrawal_below_minimum", `Withdrawal amount must be at least ${minimum}`, 400, {
      minimum: String(minimum)
    });
  }
}

function ensurePayoutRefForPaid(status: string, payoutRef?: string) {
  if (status === "paid" && !payoutRef) {
    throw new AppError("withdrawal_payout_ref_required", "Payout reference is required when marking withdrawal as paid", 400);
  }
}

function ensureWithdrawalTransition(current: string, next: string) {
  if (current === next) return;
  const allowed: Record<string, string[]> = {
    pending: ["approved", "rejected", "cancelled"],
    approved: ["paid", "cancelled"],
    rejected: [],
    paid: [],
    cancelled: []
  };
  if (!allowed[current]?.includes(next)) {
    throw new AppError("withdrawal_invalid_transition", `Cannot change withdrawal from ${current} to ${next}`, 400);
  }
}

function reservesSupplierSettlement(status: string) {
  return ["pending", "approved", "paid"].includes(status);
}

function activeWithdrawalAllocationAmount(allocations: Array<{ amount: Prisma.Decimal; status: string }>) {
  return allocations
    .filter((allocation) => ["reserved", "paid"].includes(allocation.status))
    .reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0));
}

async function ensureSupplierWithdrawableAmount(
  supplierId: string,
  amount: Prisma.Decimal,
  excludeWithdrawalId?: string
) {
  const withdrawable = await supplierWithdrawableAmount(supplierId, excludeWithdrawalId);
  if (withdrawable.lt(amount)) {
    throw new AppError("insufficient_withdrawable_amount", "Supplier does not have enough available settlements", 400, {
      withdrawable: String(withdrawable),
      requested: String(amount)
    });
  }
}

async function supplierWithdrawableAmount(supplierId: string, excludeWithdrawalId?: string) {
  const [settlements, reservedWithdrawals] = await Promise.all([
    prisma.settlementRecord.findMany({
      where: {
        status: "available",
        supplierResource: { supplierId }
      },
      select: {
        amount: true,
        reservedAmount: true,
        withdrawnAmount: true
      }
    }),
    prisma.withdrawal.aggregate({
      where: {
        supplierId,
        status: { in: ["pending", "approved", "paid"] },
        settlements: { none: {} },
        ...(excludeWithdrawalId ? { id: { not: excludeWithdrawalId } } : {})
      },
      _sum: { amount: true }
    })
  ]);

  const available = settlements.reduce(
    (sum, settlement) => sum.plus(settlementAvailableAmount(settlement)),
    new Prisma.Decimal(0)
  );
  const reserved = reservedWithdrawals._sum.amount ?? new Prisma.Decimal(0);
  const withdrawable = available.minus(reserved);
  return withdrawable.gt(0) ? withdrawable : new Prisma.Decimal(0);
}

async function allocateWithdrawalSettlements(
  tx: Prisma.TransactionClient,
  supplierId: string,
  withdrawalId: string,
  amount: Prisma.Decimal,
  allocationStatus: "reserved" | "paid"
) {
  let remaining = amount;
  const settlements = await tx.settlementRecord.findMany({
    where: {
      status: "available",
      supplierResource: { supplierId }
    },
    orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }]
  });

  for (const settlement of settlements) {
    if (remaining.lte(0)) break;
    const available = settlementAvailableAmount(settlement);
    if (available.lte(0)) continue;

    const allocationAmount = available.lt(remaining) ? available : remaining;
    await tx.withdrawalSettlement.create({
      data: {
        withdrawalId,
        settlementRecordId: settlement.id,
        amount: allocationAmount,
        status: allocationStatus
      }
    });

    const nextReserved = allocationStatus === "reserved"
      ? settlement.reservedAmount.plus(allocationAmount)
      : settlement.reservedAmount;
    const nextWithdrawn = allocationStatus === "paid"
      ? settlement.withdrawnAmount.plus(allocationAmount)
      : settlement.withdrawnAmount;
    await tx.settlementRecord.update({
      where: { id: settlement.id },
      data: {
        reservedAmount: nextReserved,
        withdrawnAmount: nextWithdrawn,
        status: settlementStatusForAmounts(settlement.amount, nextReserved, nextWithdrawn)
      }
    });
    remaining = remaining.minus(allocationAmount);
  }

  if (remaining.gt(0)) {
    throw new AppError("insufficient_withdrawable_amount", "Supplier does not have enough available settlements", 400, {
      missing: String(remaining),
      requested: String(amount)
    });
  }
}

async function payWithdrawalSettlements(tx: Prisma.TransactionClient, withdrawalId: string) {
  const allocations = await tx.withdrawalSettlement.findMany({
    where: { withdrawalId, status: "reserved" },
    include: { settlementRecord: true }
  });

  for (const allocation of allocations) {
    const settlement = allocation.settlementRecord;
    const nextReserved = decimalMax(settlement.reservedAmount.minus(allocation.amount), new Prisma.Decimal(0));
    const nextWithdrawn = settlement.withdrawnAmount.plus(allocation.amount);
    await tx.withdrawalSettlement.update({
      where: { id: allocation.id },
      data: { status: "paid" }
    });
    await tx.settlementRecord.update({
      where: { id: settlement.id },
      data: {
        reservedAmount: nextReserved,
        withdrawnAmount: nextWithdrawn,
        status: settlementStatusForAmounts(settlement.amount, nextReserved, nextWithdrawn)
      }
    });
  }
}

async function releaseWithdrawalSettlements(tx: Prisma.TransactionClient, withdrawalId: string) {
  const allocations = await tx.withdrawalSettlement.findMany({
    where: { withdrawalId, status: "reserved" },
    include: { settlementRecord: true }
  });

  for (const allocation of allocations) {
    const settlement = allocation.settlementRecord;
    const nextReserved = decimalMax(settlement.reservedAmount.minus(allocation.amount), new Prisma.Decimal(0));
    await tx.withdrawalSettlement.update({
      where: { id: allocation.id },
      data: { status: "released" }
    });
    await tx.settlementRecord.update({
      where: { id: settlement.id },
      data: {
        reservedAmount: nextReserved,
        status: settlementStatusForAmounts(settlement.amount, nextReserved, settlement.withdrawnAmount)
      }
    });
  }
}

function settlementAvailableAmount(settlement: {
  amount: Prisma.Decimal;
  reservedAmount: Prisma.Decimal;
  withdrawnAmount: Prisma.Decimal;
}) {
  return decimalMax(
    settlement.amount.minus(settlement.reservedAmount).minus(settlement.withdrawnAmount),
    new Prisma.Decimal(0)
  );
}

function settlementStatusForAmounts(amount: Prisma.Decimal, reservedAmount: Prisma.Decimal, withdrawnAmount: Prisma.Decimal) {
  if (withdrawnAmount.gte(amount)) return "withdrawn";
  if (reservedAmount.plus(withdrawnAmount).gte(amount)) return "frozen";
  return "available";
}

function decimalMax(left: Prisma.Decimal, right: Prisma.Decimal) {
  return left.gte(right) ? left : right;
}

async function buildSystemHealthReport() {
  const checkedAt = new Date();
  const proxySince = new Date(checkedAt.getTime() - systemHealthProxyWindowMs);
  const proxyRequestWhere: Prisma.ProxyRequestLogWhereInput = {
    createdAt: { gte: proxySince },
    OR: [
      { rentalId: null },
      { rental: nonSmokeRentalWhere() }
    ]
  };
  const negativeWalletWhere: Prisma.WalletAccountWhereInput = {
    ...nonSmokeWalletWhere(),
    OR: [
      { availableBalance: { lt: 0 } },
      { frozenBalance: { lt: 0 } }
    ]
  };
  const [
    userCounts,
    activeRentals,
    overdueActiveRentals,
    constrainedRentals,
    negativeWallets,
    negativeWalletSamples,
    orderCounts,
    orderStatusReadiness,
    resourceCounts,
    pendingWithdrawals,
    pendingSettlements,
    proxyRecentTotal,
    proxyRecentClientErrors,
    proxyRecentClientRejections,
    proxyRecentActionableClientErrors,
    proxyRecentServerErrors,
    proxyRecentLocalErrors,
    proxyRecentClientDisconnects,
    proxyRecentStreamErrors,
    proxyRecentErrorSamples,
    billingSync,
    pendingUsageBilling,
    reconciliation,
    sub2Bindings,
    apiKeyReadiness,
    productCatalog,
    salesDelivery,
    oauthStateStore,
    localProxySmokeEvidence,
    frontendRuntime,
    paymentRechargeActivity
  ] = await Promise.all([
    prisma.user.groupBy({ by: ["status"], where: nonSmokeUserWhere(), _count: true }),
    prisma.rental.count({ where: { status: "active", ...nonSmokeRentalWhere() } }),
    prisma.rental.count({ where: { status: "active", endsAt: { lte: checkedAt }, ...nonSmokeRentalWhere() } }),
    prisma.rental.count({ where: { status: { in: ["low_balance", "limited", "suspended"] }, ...nonSmokeRentalWhere() } }),
    prisma.walletAccount.count({ where: negativeWalletWhere }),
    prisma.walletAccount.findMany({
      where: negativeWalletWhere,
      select: {
        id: true,
        userId: true,
        availableBalance: true,
        frozenBalance: true,
        updatedAt: true,
        user: { select: { email: true, displayName: true, status: true } }
      },
      orderBy: { updatedAt: "desc" },
      take: 20
    }),
    prisma.order.groupBy({ by: ["status"], where: nonSmokeOrderWhere(), _count: true }),
    inspectOrderStatusReadiness(),
    prisma.supplierResource.groupBy({ by: ["status"], where: nonSmokeSupplierResourceWhere(), _count: true }),
    prisma.withdrawal.count({ where: { status: "pending", ...nonSmokeWithdrawalWhere() } }),
    prisma.settlementRecord.count({ where: { status: "pending", availableAt: { lte: checkedAt } } }),
    prisma.proxyRequestLog.count({ where: proxyRequestWhere }),
    prisma.proxyRequestLog.count({ where: { ...proxyRequestWhere, statusCode: { gte: 400, lt: 500 } } }),
    prisma.proxyRequestLog.count({ where: { ...proxyRequestWhere, errorCode: { in: [...proxyClientRejectionErrorCodes] } } }),
    prisma.proxyRequestLog.count({
      where: {
        AND: [
          proxyRequestWhere,
          { statusCode: { gte: 400, lt: 500 } },
          {
            OR: [
              { errorCode: null },
              { NOT: { errorCode: { in: [...proxyClientRejectionErrorCodes] } } }
            ]
          }
        ]
      }
    }),
    prisma.proxyRequestLog.count({ where: { ...proxyRequestWhere, statusCode: { gte: 500 } } }),
    prisma.proxyRequestLog.count({ where: { ...proxyRequestWhere, errorCode: { in: [...proxyLocalAvailabilityErrorCodes] } } }),
    prisma.proxyRequestLog.count({ where: { ...proxyRequestWhere, errorCode: "client_disconnected" } }),
    prisma.proxyRequestLog.count({ where: { ...proxyRequestWhere, errorCode: { in: [...proxyStreamErrorCodes] } } }),
    prisma.proxyRequestLog.findMany({
      where: {
        AND: [
          proxyRequestWhere,
          {
            OR: [
              { statusCode: { gte: 500 } },
              { errorCode: { in: [...proxyLocalAvailabilityErrorCodes, ...proxyStreamErrorCodes, "client_disconnected"] } },
              {
                AND: [
                  { statusCode: { gte: 400, lt: 500 } },
                  {
                    OR: [
                      { errorCode: null },
                      { NOT: { errorCode: { in: [...proxyClientRejectionErrorCodes] } } }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      select: {
        id: true,
        requestId: true,
        rentalId: true,
        apiKeyId: true,
        apiKeyPrefix: true,
        method: true,
        path: true,
        model: true,
        statusCode: true,
        upstreamStatusCode: true,
        upstreamRequestId: true,
        errorCode: true,
        durationMs: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    getSub2UsageSyncState(),
    inspectPendingUsageBilling(checkedAt),
    findBillingReconciliationIssues(),
    findSub2BindingIssues(),
    inspectOpenAiProxyApiKeys(checkedAt),
    inspectProductCatalogReadiness(),
    inspectSalesDeliveryReadiness(),
    inspectOAuthStateStoreReadiness(),
    inspectLocalProxySmokeEvidence(checkedAt),
    inspectFrontendRuntimeEndpoints(),
    inspectPaymentRechargeActivity(checkedAt)
  ]);
  const sub2Status = await fetchSub2HealthStatus();
  const openAiProxyContract = inspectOpenAiProxyContract(openAiProxyPublicEndpoint, {
    bodyLimitBytes: env.OPENAI_PROXY_BODY_LIMIT_BYTES,
    upstreamTimeoutMs: env.OPENAI_PROXY_UPSTREAM_TIMEOUT_MS,
    streamIdleTimeoutMs: env.OPENAI_PROXY_STREAM_IDLE_TIMEOUT_MS
  });
  const openAiProxyRuntime = await inspectOpenAiProxyRuntimeState(checkedAt.getTime());
  const resourceCredentialReadiness = await inspectResourceCredentialReadiness(sub2Status);
  const localProxySmokeEvidenceWithRepair = attachLocalProxySmokeIssueRepairCandidate(localProxySmokeEvidence, sub2Status.accountSamples);
  const apiCorsPolicy = apiCorsPolicyHealthCheck();
  const repairSupplierEmailCandidate = await activeSupplierEmailRepairCandidate();
  const usersByStatus = countGroups(userCounts, "status");
  const ordersByStatus = countGroups(orderCounts, "status");
  const resourcesByStatus = countGroups(resourceCounts, "status");
  const failedOrders = (ordersByStatus.failed ?? 0) + (ordersByStatus.refunding ?? 0);
  const resourceAvailability = await resourceAvailabilityHealthCheck(resourcesByStatus, sub2Status.accountSamples);
  const adminCapabilityCoverage = inspectRegisteredAdminCapabilityRoutes();
  const adminSurfaceCoverage = inspectAdminSurfaceCoverage();
  const deploymentRuntime = deploymentRuntimeHealthCheck();
  const proxyRequestHealthMetrics = {
    proxyRecentTotal,
    proxyRecentClientErrors,
    proxyRecentClientRejections,
    proxyRecentActionableClientErrors,
    proxyRecentServerErrors,
    proxyRecentLocalErrors,
    proxyRecentClientDisconnects,
    proxyRecentStreamErrors
  };

  const checks: SystemHealthCheck[] = [
    systemHealthCheck("database", "数据库", "ok", "Prisma 查询正常", {
      users: totalGroupCount(userCounts),
      rentals: activeRentals
    }),
    deploymentRuntime,
    frontendRuntimeHealthCheck(frontendRuntime),
    adminCapabilityHealthCheck(adminCapabilityCoverage),
    adminSurfaceCoverageHealthCheck(adminSurfaceCoverage),
    systemHealthCheck(
      "users",
      "用户状态",
      (usersByStatus.banned ?? 0) > 0 ? "warning" : "ok",
      `active ${usersByStatus.active ?? 0}, disabled ${usersByStatus.disabled ?? 0}, banned ${usersByStatus.banned ?? 0}`,
      usersByStatus
    ),
    systemHealthCheck(
      "orders",
      "订单状态",
      failedOrders > 0 ? "warning" : "ok",
      failedOrders > 0 ? `${failedOrders} 个订单需要人工复查` : "订单状态无明显阻断",
      {
        ...ordersByStatus,
        ...orderStatusReadiness.summary
      },
      orderStatusReadiness.issues.length > 0 ? { issues: orderStatusReadiness.issues } : undefined
    ),
    systemHealthCheck(
      "productCatalog",
      "商品目录",
      productCatalog.warnings > 0 ? "warning" : "ok",
      productCatalog.warnings > 0
        ? `${productCatalog.warnings} 个商品目录可购买性问题`
        : "公开商品目录可购买性正常",
      productCatalog.summary,
      productCatalog.issues.length > 0 ? { issues: productCatalog.issues } : undefined
    ),
    systemHealthCheck(
      "salesDelivery",
      "售出交付",
      salesDelivery.errors > 0 ? "error" : "ok",
      salesDelivery.errors > 0
        ? `${salesDelivery.errors} 个售出交付问题`
        : "应交付订单未发现交付阻断",
      salesDelivery.summary,
      { issues: salesDelivery.issues }
    ),
    systemHealthCheck(
      "rentals",
      "租赁可用性",
      overdueActiveRentals > 0 ? "error" : constrainedRentals > 0 ? "warning" : "ok",
      overdueActiveRentals > 0
        ? `${overdueActiveRentals} 个 active 租赁已过期`
        : constrainedRentals > 0 ? `${constrainedRentals} 个租赁处于余额/限额/暂停状态` : "租赁状态正常",
      { activeRentals, overdueActiveRentals, constrainedRentals }
    ),
    systemHealthCheck(
      "apiKeys",
      "API Key 可用性",
      apiKeyReadiness.errors > 0 ? "error" : apiKeyReadiness.warnings > 0 ? "warning" : "ok",
      apiKeyReadiness.totalIssues > 0
        ? `${apiKeyReadiness.totalIssues} 个 OpenAI/Codex Key 准入问题`
        : "OpenAI/Codex Key 准入状态正常",
      apiKeyReadiness.summary,
      { issues: apiKeyReadiness.issues }
    ),
    walletHealthCheck(negativeWallets, negativeWalletSamples),
    systemHealthCheck(
      "oauthStateStore",
      "OAuth State",
      oauthStateStore.ok ? "ok" : oauthStateStore.issues.some((issue) => issue.severity === "error") ? "error" : "warning",
      oauthStateStore.summary.mode === "redis"
        ? oauthStateStore.ok ? "OAuth state Redis store is ready" : "OAuth state Redis store is unavailable"
        : "OAuth state is using process memory",
      oauthStateStore.summary,
      oauthStateStore.issues.length > 0 ? { issues: oauthStateStore.issues } : undefined
    ),
    authTokenConfigHealthCheck(),
    apiCorsPolicy,
    paymentProviderHealthCheck(paymentRechargeActivity),
    resourceAvailability,
    resourceCredentialReadiness,
    systemHealthCheck(
      "sub2",
      "Sub2/OpenAI 上游",
      sub2Status.ready ? "ok" : "error",
      sub2Status.ready ? "Sub2API OpenAI 上游可调度" : `阻断：${sub2Status.blockingReasons.join(", ") || "unknown"}`,
      {
        gatewayReachable: sub2Status.gatewayReachable,
        ready: sub2Status.ready,
        defaultGroupId: sub2Status.defaultGroupId ?? null,
        accounts: sub2Status.accountCount,
        openAiAccounts: sub2Status.openAiAccountCount,
        activeOpenAiAccounts: sub2Status.activeOpenAiAccountCount
      },
      {
        blockingReasons: sub2Status.blockingReasons,
        error: sub2Status.error,
        issues: sub2Status.issues,
        samples: sub2Status.accountSamples
      }
    ),
    systemHealthCheck(
      "openAiProxyContract",
      "OpenAI 反代契约",
      openAiProxyContract.ok ? "ok" : "error",
      openAiProxyContract.ok ? "OpenAI/Codex 本地反代契约正常" : `${openAiProxyContract.issues.length} 个本地反代契约问题`,
      openAiProxyContract.summary,
      { issues: openAiProxyContract.issues }
    ),
    systemHealthCheck(
      "openAiProxyRuntime",
      "OpenAI 反代运行态",
      openAiProxyRuntime.issues.some((issue) => issue.severity === "error")
        ? "error"
        : openAiProxyRuntime.issues.length > 0 ? "warning" : "ok",
      openAiProxyRuntime.issues.length > 0
        ? `${openAiProxyRuntime.issues.length} 个 OpenAI/Codex 反代运行态问题`
        : `当前进程 ${openAiProxyRuntime.summary.activeConcurrencyLeases} 个并发租约，${openAiProxyRuntime.summary.activeRateWindowRentals} 个速率窗口`,
      { ...openAiProxyRuntime.summary },
      openAiProxyRuntime.issues.length > 0 ? { issues: openAiProxyRuntime.issues } : undefined
    ),
    localProxySmokeEvidenceHealthCheck(localProxySmokeEvidenceWithRepair),
    sub2BindingHealthCheck(sub2Bindings),
    systemHealthCheck(
      "proxy",
      "反代请求",
      proxyRequestHealthStatus(proxyRequestHealthMetrics),
      proxyRequestHealthSummary(proxyRequestHealthMetrics),
      proxyRequestHealthMetrics,
      proxyRecentErrorSamples.length > 0 ? {
        issues: proxyRecentErrorSamples.map((log) => ({
          id: `proxy_request:${log.id}`,
          type: log.errorCode ?? `http_${log.statusCode ?? "unknown"}`,
          severity: proxyRequestIssueSeverity(log),
          proxyRequestLogId: log.id,
          requestId: log.requestId,
          rentalId: log.rentalId,
          apiKeyId: log.apiKeyId,
          apiKeyPrefix: log.apiKeyPrefix,
          statusCode: log.statusCode,
          upstreamStatusCode: log.upstreamStatusCode,
          upstreamRequestId: log.upstreamRequestId,
          errorCode: log.errorCode,
          model: log.model,
          path: log.path,
          message: `${log.method} ${log.path} / model ${log.model ?? "-"} / HTTP ${log.statusCode ?? "-"} / upstream ${log.upstreamStatusCode ?? "-"} / upstream request ${log.upstreamRequestId ?? "-"} / ${log.errorCode ?? "-"} / ${log.durationMs}ms`,
          createdAt: log.createdAt.toISOString()
        }))
      } : undefined
    ),
    billingSyncHealthCheck(billingSync, checkedAt),
    billingSyncSchedulerHealthCheck(),
    systemHealthCheck(
      "pendingUsageBilling",
      "Pending 用量账务",
      pendingUsageBilling.errors > 0 ? "error" : pendingUsageBilling.warnings > 0 ? "warning" : "ok",
      pendingUsageBilling.errors > 0
        ? `${pendingUsageBilling.errors} 条 pending usage 位于 active 租赁，需要立即复查`
        : pendingUsageBilling.warnings > 0 ? `${pendingUsageBilling.warnings} 条 pending usage 等待余额恢复或重试同步` : "Pending usage 账务无积压",
      pendingUsageBilling.summary,
      pendingUsageBilling.issues.length > 0 ? { issues: pendingUsageBilling.issues } : undefined
    ),
    reconciliationHealthCheck(reconciliation),
    systemHealthCheck(
      "settlements",
      "结算提现",
      pendingSettlements > 0 || pendingWithdrawals > 0 ? "warning" : "ok",
      pendingSettlements > 0 || pendingWithdrawals > 0
        ? `${pendingSettlements} 条到期待释放结算，${pendingWithdrawals} 条待处理提现`
        : "结算提现无待处理阻塞",
      { pendingSettlements, pendingWithdrawals }
    )
  ];

  const enrichedChecks = enrichSub2RepairContextChecks(checks, repairSupplierEmailCandidate, sub2Status.accountSamples);

  return {
    checkedAt: checkedAt.toISOString(),
    status: aggregateHealthStatus(enrichedChecks),
    summary: {
      totalChecks: enrichedChecks.length,
      ok: enrichedChecks.filter((check) => check.status === "ok").length,
      warning: enrichedChecks.filter((check) => check.status === "warning").length,
      error: enrichedChecks.filter((check) => check.status === "error").length
    },
    checks: enrichedChecks
  };
}

type SystemHealthReport = Awaited<ReturnType<typeof buildSystemHealthReport>>;

async function activeSupplierEmailRepairCandidate() {
  const suppliers = await prisma.supplier.findMany({
    where: { user: { status: "active" } },
    select: { user: { select: { email: true } } },
    orderBy: { updatedAt: "desc" },
    take: 2
  });
  return suppliers.length === 1 ? suppliers[0].user.email : null;
}

export function enrichSub2RepairContextChecks(
  checks: SystemHealthCheck[],
  supplierEmail: string | null,
  sub2AccountCandidates: ResourceCredentialSub2AccountCandidate[] = []
) {
  const productContext = productCatalogRepairContextFields(checks);
  const smokeContext = localProxySmokeRepairContextFields(checks);
  if (!supplierEmail && sub2AccountCandidates.length === 0 && !productContext && !smokeContext) return checks;
  const repairCandidateFields = resourceCredentialRepairCandidateFields(sub2AccountCandidates);

  return checks.map((check) => {
    const detail = jsonObject(check.detail);
    if (!detail) return check;

    let changed = false;
    const nextDetail: Record<string, unknown> = { ...detail };
    for (const key of ["issues", "samples"] as const) {
      const rows = nextDetail[key];
      if (!Array.isArray(rows)) continue;
      const nextRows = rows.map((row) => {
        const record = jsonObject(row);
        if (!record) return row;
        const sub2AccountRepairSample = isSub2AccountRepairSample(check.id, key, record);
        if (record.repairAction !== "apply_openai_refresh_token_to_sub2_account" && !sub2AccountRepairSample) return row;
        const additions: Record<string, unknown> = {};
        if (sub2AccountRepairSample) {
          if (!record.repairAction) additions.repairAction = "apply_openai_refresh_token_to_sub2_account";
          if (record.sub2Status !== true) additions.sub2Status = true;
        }
        if (supplierEmail && !record.supplierEmail) additions.supplierEmail = supplierEmail;
        if (!record.resourceType) additions.resourceType = "codex";
        if (productContext && (!record.resourceType || record.resourceType === "codex")) {
          if (productContext.productId && !record.productId) additions.productId = productContext.productId;
          if (productContext.productName && !record.productName) additions.productName = productContext.productName;
          if (productContext.priceId && !record.priceId) additions.priceId = productContext.priceId;
        }
        if (smokeContext && (!record.resourceType || record.resourceType === "codex")) {
          for (const [field, value] of Object.entries(smokeContext)) {
            if (value !== undefined && value !== null && (record[field] === undefined || record[field] === null)) {
              additions[field] = value;
            }
          }
        }
        if (record.sub2AccountId === undefined || record.sub2AccountId === null) {
          for (const [field, value] of Object.entries(repairCandidateFields)) {
            if (value !== undefined && (record[field] === undefined || record[field] === null)) additions[field] = value;
          }
        }
        if (Object.keys(additions).length === 0) return row;
        changed = true;
        return {
          ...record,
          ...additions
        };
      });
      nextDetail[key] = nextRows;
    }

    return changed ? { ...check, detail: nextDetail } : check;
  });
}

function isSub2AccountRepairSample(checkId: string, detailKey: "issues" | "samples", record: Record<string, unknown>) {
  return checkId === "sub2"
    && detailKey === "samples"
    && record.sub2AccountId !== undefined
    && record.sub2AccountId !== null
    && (record.accountStatus !== undefined || record.credentialsStatus !== undefined || record.schedulable !== undefined);
}

function localProxySmokeRepairContextFields(checks: SystemHealthCheck[]) {
  const repairFields = [
    "auditLogId",
    "auditAction",
    "model",
    "modelsOk",
    "modelsStatusCode",
    "modelsError",
    "responsesOk",
    "responsesStatusCode",
    "responsesErrorType",
    "responsesErrorMessage",
    "localProxyOk",
    "smokeTestSkippedReason",
    "keyDisabled",
    "proxyRequestLogCount",
    "proxyRequestLogId",
    "requestId",
    "upstreamRequestId",
    "proxyRequestPath",
    "proxyRequestStatusCode",
    "proxyRequestErrorCode",
    "ageMinutes",
    "stale",
    "staleThresholdMinutes",
    "freshMinutesRemaining",
    "staleAt"
  ] as const;

  for (const check of checks) {
    if (check.id !== "localProxySmoke") continue;
    const detail = jsonObject(check.detail);
    const rows = detail?.issues;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const record = jsonObject(row);
      if (!record || record.sub2Status !== true) continue;
      const fields: Record<string, unknown> = {};
      for (const field of repairFields) {
        if (record[field] !== undefined && record[field] !== null) fields[field] = record[field];
      }
      return Object.keys(fields).length > 0 ? fields : null;
    }
  }
  return null;
}

function productCatalogRepairContextFields(checks: SystemHealthCheck[]) {
  for (const check of checks) {
    if (check.id !== "productCatalog") continue;
    const detail = jsonObject(check.detail);
    const rows = detail?.issues;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const record = jsonObject(row);
      if (!record || ![
        "active_codex_product_without_ready_delivery_resource",
        "active_codex_product_proxy_smoke_failed"
      ].includes(String(record.type ?? ""))) continue;
      const productId = textJsonValue(record.productId);
      const productName = textJsonValue(record.productName);
      const priceId = textJsonValue(record.priceId);
      if (!productId && !productName && !priceId) continue;
      return {
        productId: productId ?? undefined,
        productName: productName ?? undefined,
        priceId: priceId ?? undefined
      };
    }
  }
  return null;
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function recordSystemHealthSnapshot(report: SystemHealthReport, source: string, actorUserId?: string) {
  await prisma.systemHealthSnapshot.create({
    data: {
      status: report.status,
      source,
      summary: JSON.parse(JSON.stringify(report.summary)) as Prisma.InputJsonValue,
      checks: JSON.parse(JSON.stringify(report.checks)) as Prisma.InputJsonValue,
      actorUserId
    }
  });
}

async function runSystemMaintenance(input: z.infer<typeof systemMaintenanceSchema>) {
  const startedAt = new Date();
  const actions: Record<string, unknown> = {};

  if (input.expireOverdueRentals) {
    actions.expireOverdueRentals = await expireOverdueRentals({
      limit: input.expireOverdueRentalsLimit
    });
  }

  if (input.deactivateInvalidProxyApiKeys) {
    actions.deactivateInvalidProxyApiKeys = await deactivateInvalidProxyApiKeys({
      limit: input.deactivateInvalidProxyApiKeysLimit
    });
  }

  if (input.releaseAvailableSettlements) {
    actions.releaseAvailableSettlements = await releaseAvailableSettlements({
      limit: input.releaseAvailableSettlementsLimit
    });
  }

  if (input.syncSub2Usage) {
    actions.syncSub2Usage = await runMaintenanceUsageSync();
  }

  if (input.repairSub2Bindings) {
    actions.repairSub2Bindings = await repairSub2Bindings();
  }

  if (input.cleanupSmokeData) {
    actions.cleanupSmokeData = await cleanupStaleLocalProxySmokeData({
      ageMinutes: input.cleanupSmokeDataAgeMinutes,
      limit: input.cleanupSmokeDataLimit
    });
  }

  const health = await buildSystemHealthReport();
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    actions,
    health
  };
}

async function runMaintenanceUsageSync() {
  try {
    const result = await syncSub2UsageOnce(undefined, { persistCursor: true });
    return {
      ok: true,
      ...result
    };
  } catch (error) {
    return {
      ok: false,
      error: redactSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 500)
    };
  }
}

async function findBillingReconciliationIssues() {
  const [
    billedUsages,
    consumptionTransactions,
    usageSettlementCandidates,
    settlementCandidates,
    withdrawalCandidates
  ] = await Promise.all([
    prisma.usageRecord.findMany({
      where: { status: "billed", buyerCharge: { gt: 0 }, ...nonSmokeUsageWhere() },
      select: { id: true, buyerCharge: true, occurredAt: true },
      orderBy: { occurredAt: "desc" },
      take: reconciliationScanLimit
    }),
    prisma.walletTransaction.findMany({
      where: { type: "consume", refType: "usage", refId: { not: null }, ...nonSmokeWalletTransactionWhere() },
      select: { id: true, amount: true, refId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: reconciliationScanLimit
    }),
    prisma.usageRecord.findMany({
      where: { status: "billed", supplierIncome: { gt: 0 }, ...nonSmokeUsageWhere() },
      select: {
        id: true,
        supplierIncome: true,
        occurredAt: true,
        settlements: { select: { id: true, amount: true, status: true } }
      },
      orderBy: { occurredAt: "desc" },
      take: reconciliationScanLimit
    }),
    prisma.settlementRecord.findMany({
      select: {
        id: true,
        amount: true,
        reservedAmount: true,
        withdrawnAmount: true,
        status: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" },
      take: reconciliationScanLimit
    }),
    prisma.withdrawal.findMany({
      where: { status: { in: ["pending", "approved", "paid"] }, ...nonSmokeWithdrawalWhere() },
      select: {
        id: true,
        amount: true,
        status: true,
        createdAt: true,
        settlements: { select: { amount: true, status: true } }
      },
      orderBy: { createdAt: "desc" },
      take: reconciliationScanLimit
    })
  ]);

  const usageWalletTransactions = await prisma.walletTransaction.findMany({
    where: {
      type: "consume",
      refType: "usage",
      refId: { in: billedUsages.map((usage) => usage.id) },
      ...nonSmokeWalletTransactionWhere()
    },
    select: { refId: true }
  });
  const transactionUsageRefs = new Set(usageWalletTransactions.flatMap((transaction) => transaction.refId ? [transaction.refId] : []));
  const billedUsageMissingWalletTransactions = billedUsages
    .filter((usage) => !transactionUsageRefs.has(usage.id))
    .map((usage) => reconciliationIssue({
      type: "billed_usage_missing_wallet_transaction",
      refType: "usage",
      refId: usage.id,
      amount: decimalText(usage.buyerCharge),
      createdAt: usage.occurredAt.toISOString(),
      message: "Billed usage has buyerCharge but no consume wallet transaction."
    }));

  const usageIdsForTransactions = [
    ...new Set(consumptionTransactions.flatMap((transaction) => transaction.refId ? [transaction.refId] : []))
  ];
  const usagesForTransactions = usageIdsForTransactions.length > 0
    ? await prisma.usageRecord.findMany({
      where: { id: { in: usageIdsForTransactions } },
      select: { id: true }
    })
    : [];
  const usageIds = new Set(usagesForTransactions.map((usage) => usage.id));
  const walletTransactionsMissingUsage = consumptionTransactions
    .filter((transaction) => transaction.refId && !usageIds.has(transaction.refId))
    .map((transaction) => reconciliationIssue({
      type: "wallet_transaction_missing_usage",
      refType: "wallet_transaction",
      refId: transaction.id,
      amount: decimalText(transaction.amount),
      createdAt: transaction.createdAt.toISOString(),
      message: `Consume wallet transaction references missing usage ${transaction.refId}.`
    }));

  const usageSettlementMismatches = usageSettlementCandidates
    .map((usage) => {
      const actual = decimalSum(usage.settlements.map((settlement) => settlement.amount));
      if (decimalEquals(actual, usage.supplierIncome)) return undefined;
      return reconciliationIssue({
        type: "usage_settlement_mismatch",
        refType: "usage",
        refId: usage.id,
        expected: decimalText(usage.supplierIncome),
        actual: decimalText(actual),
        createdAt: usage.occurredAt.toISOString(),
        message: "Usage supplierIncome does not match settlement record amount sum."
      });
    })
    .filter(isReconciliationIssue);

  const settlementOverallocated = settlementCandidates
    .filter((settlement) => settlement.reservedAmount.plus(settlement.withdrawnAmount).gt(settlement.amount))
    .map((settlement) => reconciliationIssue({
      type: "settlement_overallocated",
      refType: "settlement",
      refId: settlement.id,
      amount: decimalText(settlement.amount),
      actual: decimalText(settlement.reservedAmount.plus(settlement.withdrawnAmount)),
      createdAt: settlement.createdAt.toISOString(),
      message: `Settlement reserved plus withdrawn exceeds amount while status is ${settlement.status}.`
    }));

  const withdrawalAllocationMismatches = withdrawalCandidates
    .map((withdrawal) => {
      const allocated = decimalSum(
        withdrawal.settlements
          .filter((allocation) => ["reserved", "paid"].includes(allocation.status))
          .map((allocation) => allocation.amount)
      );
      if (decimalEquals(allocated, withdrawal.amount)) return undefined;
      return reconciliationIssue({
        type: "withdrawal_allocation_mismatch",
        refType: "withdrawal",
        refId: withdrawal.id,
        expected: decimalText(withdrawal.amount),
        actual: decimalText(allocated),
        createdAt: withdrawal.createdAt.toISOString(),
        message: `Active withdrawal status ${withdrawal.status} does not match active allocation sum.`
      });
    })
    .filter(isReconciliationIssue);

  const groups = {
    billedUsageMissingWalletTransactions,
    walletTransactionsMissingUsage,
    usageSettlementMismatches,
    settlementOverallocated,
    withdrawalAllocationMismatches
  };
  const allIssues = Object.values(groups).flat();
  return {
    checkedAt: new Date().toISOString(),
    ok: allIssues.length === 0,
    scanLimit: reconciliationScanLimit,
    summary: {
      billedUsageMissingWalletTransactions: billedUsageMissingWalletTransactions.length,
      walletTransactionsMissingUsage: walletTransactionsMissingUsage.length,
      usageSettlementMismatches: usageSettlementMismatches.length,
      settlementOverallocated: settlementOverallocated.length,
      withdrawalAllocationMismatches: withdrawalAllocationMismatches.length,
      totalIssues: allIssues.length,
      returnedIssues: Math.min(allIssues.length, reconciliationIssueLimit)
    },
    scanned: {
      billedUsages: billedUsages.length,
      usageWalletTransactions: usageWalletTransactions.length,
      walletTransactions: consumptionTransactions.length,
      usageSettlementCandidates: usageSettlementCandidates.length,
      settlements: settlementCandidates.length,
      withdrawals: withdrawalCandidates.length
    },
    issues: allIssues.slice(0, reconciliationIssueLimit)
  };
}

function reconciliationIssue(input: Omit<BillingReconciliationIssue, "id" | "severity"> & {
  severity?: BillingReconciliationIssue["severity"];
}) {
  return {
    id: `${input.type}:${input.refType}:${input.refId}`,
    severity: input.severity ?? "error",
    ...input
  };
}

function isReconciliationIssue(issue: BillingReconciliationIssue | undefined): issue is BillingReconciliationIssue {
  return Boolean(issue);
}

function decimalSum(values: Prisma.Decimal[]) {
  return values.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0));
}

function decimalEquals(left: Prisma.Decimal, right: Prisma.Decimal) {
  return left.toFixed(6) === right.toFixed(6);
}

function decimalText(value: Prisma.Decimal) {
  return value.toFixed(6);
}

function buildOrderDeliverySummary(order: OrderDetailRecord, proxyRequestCount: number) {
  const activeStatuses = new Set(["paid", "provisioning", "active", "closed", "expired", "refunding"]);
  const closedStatuses = new Set(["cancelled", "refunded"]);
  const deliveryClosed = closedStatuses.has(order.status);
  const expectedDelivery = !deliveryClosed && (activeStatuses.has(order.status) || order.paidAmount.gt(0));
  const rentals = order.rentals;
  const codexRentals = rentals.filter((rental) => rental.resourceType === "codex");
  const activeRentals = rentals.filter((rental) => rental.status === "active");
  const missingEndpoints = rentals.filter((rental) => !rental.endpointUrl).length;
  const missingSub2Keys = rentals.filter((rental) => !rental.sub2KeyId).length;
  const apiKeys = rentals.flatMap((rental) => rental.apiKeys);
  const activeApiKeys = apiKeys.filter((apiKey) => apiKey.status === "active");
  const rentalsMissingActiveApiKey = rentals.filter((rental) => !rental.apiKeys.some((apiKey) => apiKey.status === "active")).length;
  const minimumBalance = new Prisma.Decimal(env.OPENAI_PROXY_MIN_WALLET_BALANCE);
  const walletBalance = order.user.wallet?.availableBalance ?? null;
  const walletReady = !codexRentals.length || (walletBalance !== null && walletBalance.gt(minimumBalance));

  const checks: SystemHealthCheck[] = [
    systemHealthCheck(
      "payment",
      "付款状态",
      deliveryClosed || order.paidAmount.gt(0) ? "ok" : expectedDelivery ? "error" : "warning",
      deliveryClosed ? `订单已${order.status}，不要求可用交付` : order.paidAmount.gt(0) ? "订单已有已付金额" : "订单尚无已付金额",
      {
        orderStatus: order.status,
        paidAmount: decimalText(order.paidAmount),
        totalAmount: decimalText(order.totalAmount)
      }
    ),
    systemHealthCheck(
      "rentals",
      "租赁交付",
      deliveryClosed || rentals.length > 0 ? "ok" : expectedDelivery ? "error" : "warning",
      deliveryClosed ? `订单已${order.status}，租赁不要求 active` : rentals.length > 0 ? `已生成 ${rentals.length} 个租赁` : "订单尚未生成租赁",
      {
        rentals: rentals.length,
        activeRentals: activeRentals.length
      }
    ),
    systemHealthCheck(
      "endpoint",
      "OpenAI Endpoint",
      deliveryClosed ? "ok" : rentals.length === 0 ? "warning" : missingEndpoints > 0 ? "error" : "ok",
      deliveryClosed
        ? `订单已${order.status}，endpoint 不要求可用`
        : rentals.length === 0
        ? "无租赁可检查 endpoint"
        : missingEndpoints > 0 ? `${missingEndpoints} 个租赁缺少 endpoint` : "租赁 endpoint 已写入",
      {
        rentals: rentals.length,
        missingEndpoints
      }
    ),
    systemHealthCheck(
      "sub2Key",
      "Sub2 Key",
      deliveryClosed ? "ok" : rentals.length === 0 ? "warning" : missingSub2Keys > 0 ? "error" : "ok",
      deliveryClosed
        ? `订单已${order.status}，Sub2 Key 不要求可用`
        : rentals.length === 0
        ? "无租赁可检查 Sub2 Key"
        : missingSub2Keys > 0 ? `${missingSub2Keys} 个租赁缺少 Sub2 Key` : "租赁已绑定 Sub2 Key",
      {
        rentals: rentals.length,
        missingSub2Keys
      }
    ),
    systemHealthCheck(
      "apiKeys",
      "本地 API Key",
      deliveryClosed ? "ok" : rentals.length === 0 ? "warning" : rentalsMissingActiveApiKey > 0 ? "error" : "ok",
      deliveryClosed
        ? `订单已${order.status}，本地 API Key 不要求 active`
        : rentals.length === 0
        ? "无租赁可检查本地 API Key"
        : rentalsMissingActiveApiKey > 0 ? `${rentalsMissingActiveApiKey} 个租赁缺少 active API Key` : "每个租赁都有 active API Key",
      {
        apiKeys: apiKeys.length,
        activeApiKeys: activeApiKeys.length,
        rentalsMissingActiveApiKey
      }
    ),
    systemHealthCheck(
      "wallet",
      "钱包准入",
      deliveryClosed || walletReady ? "ok" : "error",
      deliveryClosed ? `订单已${order.status}，钱包不要求通过反代准入` : walletReady ? "Codex/OpenAI 反代钱包准入正常" : "钱包余额低于本地反代最低准入",
      {
        codexRentals: codexRentals.length,
        availableBalance: walletBalance ? decimalText(walletBalance) : null,
        minimumBalance: decimalText(minimumBalance)
      }
    ),
    systemHealthCheck(
      "proxyRequests",
      "反代请求证据",
      proxyRequestCount > 0 ? "ok" : "warning",
      proxyRequestCount > 0 ? `已有 ${proxyRequestCount} 条关联反代请求` : "尚未看到该订单关联反代请求",
      {
        proxyRequestCount
      }
    )
  ];

  return {
    status: aggregateHealthStatus(checks),
    summary: {
      totalChecks: checks.length,
      ok: checks.filter((check) => check.status === "ok").length,
      warning: checks.filter((check) => check.status === "warning").length,
      error: checks.filter((check) => check.status === "error").length,
      rentals: rentals.length,
      activeRentals: activeRentals.length,
      apiKeys: apiKeys.length,
      activeApiKeys: activeApiKeys.length,
      proxyRequestCount
    },
    checks
  };
}

async function inspectOrderStatusReadiness() {
  const where: Prisma.OrderWhereInput = {
    ...nonSmokeOrderWhere(),
    status: { in: ["failed", "refunding"] }
  };
  const [matched, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      select: {
        id: true,
        status: true,
        userId: true,
        paidAmount: true,
        user: { select: { email: true } },
        rentals: {
          select: {
            id: true,
            sub2UserId: true,
            sub2KeyId: true,
            sub2KeyHash: true,
            endpointUrl: true,
            limits: { select: { id: true } },
            apiKeys: { select: { status: true } }
          }
        }
      },
      orderBy: { updatedAt: "desc" },
      take: systemHealthOrderStatusIssueLimit
    })
  ]);
  const paidFailedOrderIds = orders
    .filter((order) => order.status === "failed" && order.paidAmount.gt(0))
    .map((order) => order.id);
  const refundTransactions = paidFailedOrderIds.length > 0
    ? await prisma.walletTransaction.findMany({
      where: { type: "refund", refType: "order", refId: { in: paidFailedOrderIds } },
      select: { refId: true }
    })
    : [];
  const refundedOrderIds = new Set(refundTransactions.map((transaction) => transaction.refId).filter((refId): refId is string => Boolean(refId)));
  const issues: OrderStatusIssue[] = [];
  const summary = {
    matched,
    scanned: orders.length,
    truncated: matched > orders.length,
    returnedIssues: 0,
    failedOrderSamples: 0,
    refundingOrderSamples: 0,
    retryCandidates: 0,
    retryBlocked: 0
  };

  for (const order of orders) {
    const rental = order.rentals[0];
    const baseIssue = {
      severity: "warning" as const,
      orderId: order.id,
      userId: order.userId,
      userEmail: order.user.email,
      orderStatus: order.status,
      paidAmount: String(order.paidAmount),
      rentalId: rental?.id
    };

    if (order.status === "refunding") {
      summary.refundingOrderSamples += 1;
      issues.push({
        ...baseIssue,
        id: `refunding_order_review:${order.id}`,
        type: "refunding_order_review",
        message: `Order ${order.id} is refunding and needs refund reconciliation.`
      });
      continue;
    }

    summary.failedOrderSamples += 1;
    const activeApiKeys = order.rentals.flatMap((item) => item.apiKeys).filter((apiKey) => apiKey.status === "active").length;
    const retryBlockers = [
      order.rentals.length !== 1 ? "not exactly one rental" : null,
      !rental?.limits ? "missing rental limits" : null,
      rental?.sub2UserId || rental?.sub2KeyId || rental?.sub2KeyHash || rental?.endpointUrl ? "has Sub2 delivery fields" : null,
      activeApiKeys > 0 ? "has active local API key" : null,
      order.paidAmount.gt(0) && !refundedOrderIds.has(order.id) ? "missing original refund transaction" : null
    ].filter(Boolean);

    if (retryBlockers.length === 0) {
      summary.retryCandidates += 1;
      issues.push({
        ...baseIssue,
        id: `failed_order_retry_candidate:${order.id}`,
        type: "failed_order_retry_candidate",
        message: `Failed order ${order.id} can be retried from Admin order detail.`
      });
    } else {
      summary.retryBlocked += 1;
      issues.push({
        ...baseIssue,
        id: `failed_order_manual_review:${order.id}`,
        type: "failed_order_manual_review",
        message: `Failed order ${order.id} needs manual review before retry: ${retryBlockers.join(", ")}.`
      });
    }
  }

  summary.returnedIssues = issues.length;
  return { summary, issues };
}

async function inspectSalesDeliveryReadiness() {
  const where: Prisma.OrderWhereInput = {
    ...nonSmokeOrderWhere(),
    status: { in: ["paid", "provisioning", "active"] }
  };
  const [matched, orders, deliveryReadiness] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      select: {
        id: true,
        status: true,
        userId: true,
        user: { select: { email: true } },
        rentals: {
          select: {
            id: true,
            status: true,
            resourceType: true,
            supplierResourceId: true,
            endpointUrl: true,
            sub2KeyId: true,
            supplierResource: {
              select: {
                id: true,
                status: true,
                resourceType: true,
                sub2AccountId: true,
                supplier: { select: { user: { select: { email: true } } } }
              }
            },
            apiKeys: { select: { id: true, status: true, keyPrefix: true } }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: systemHealthSalesDeliveryScanLimit
    }),
    codexDeliveryReadinessSnapshot()
  ]);
  const proxySmokeIssueFields = codexProxySmokeDeliveryIssueFields(deliveryReadiness.codexProxySmokeDeliveryReadiness);

  const issues: SalesDeliveryIssue[] = [];
  const ordersWithIssues = new Set<string>();
  const counters = {
    ordersWithoutRentals: 0,
    activeOrdersWithoutActiveRentals: 0,
    rentalsMissingEndpoint: 0,
    rentalsMissingSub2Key: 0,
    rentalsMissingActiveApiKey: 0,
    rentalsMissingSupplierResource: 0,
    rentalsWithUnavailableSupplierResource: 0,
    activeCodexRentalsBlockedByProxySmoke: 0
  };
  let errors = 0;

  const addIssue = (input: Omit<SalesDeliveryIssue, "id" | "severity">) => {
    errors += 1;
    ordersWithIssues.add(input.orderId);
    if (issues.length >= systemHealthSalesDeliveryIssueLimit) return;
    issues.push({
      id: `${input.type}:${input.orderId}:${input.rentalId ?? "order"}`,
      severity: "error",
      ...input
    });
  };

  for (const order of orders) {
    if (order.rentals.length === 0) {
      counters.ordersWithoutRentals += 1;
      addIssue({
        type: "order_without_rental",
        orderId: order.id,
        userId: order.userId,
        userEmail: order.user.email,
        message: `Order ${order.id} is ${order.status} but has no rental.`
      });
      continue;
    }

    if (order.status === "active" && !order.rentals.some((rental) => rental.status === "active")) {
      counters.activeOrdersWithoutActiveRentals += 1;
      addIssue({
        type: "active_order_without_active_rental",
        orderId: order.id,
        userId: order.userId,
        userEmail: order.user.email,
        message: `Active order ${order.id} has no active rental.`
      });
    }

    for (const rental of order.rentals) {
      if (rental.resourceType === "codex") {
        if (!rental.supplierResourceId || !rental.supplierResource) {
          counters.rentalsMissingSupplierResource += 1;
          addIssue({
            type: "rental_missing_supplier_resource",
            orderId: order.id,
            rentalId: rental.id,
            userId: order.userId,
            userEmail: order.user.email,
            resourceList: true,
            resourceScope: "production",
            resourceType: "codex",
            resourceStatus: "online",
            repairAction: "assign_ready_supplier_resource_to_rental",
            actionHint: "Create or repair a production Codex shared resource, then assign it to this rental.",
            message: `Codex rental ${rental.id} has no shared resource attribution.`
          });
        } else if (rental.supplierResource.status !== "online" || !rental.supplierResource.sub2AccountId) {
          counters.rentalsWithUnavailableSupplierResource += 1;
          addIssue({
            type: "rental_supplier_resource_not_ready",
            orderId: order.id,
            rentalId: rental.id,
            userId: order.userId,
            userEmail: order.user.email,
            resourceId: rental.supplierResource.id,
            resourceList: true,
            resourceScope: "production",
            resourceType: "codex",
            resourceStatus: rental.supplierResource.status,
            supplierEmail: rental.supplierResource.supplier?.user?.email ?? null,
            sub2AccountId: rental.supplierResource.sub2AccountId,
            repairAction: "repair_supplier_resource_delivery_readiness",
            actionHint: "Bring the linked Codex shared resource online with a Sub2 account and active OpenAI credential.",
            message: `Codex rental ${rental.id} is linked to shared resource ${rental.supplierResource.id}, but the resource is not ready for delivery.`
          });
        }

        if (rental.status === "active" && proxySmokeIssueFields) {
          counters.activeCodexRentalsBlockedByProxySmoke += 1;
          addIssue({
            type: "active_codex_rental_proxy_smoke_failed",
            orderId: order.id,
            rentalId: rental.id,
            userId: order.userId,
            userEmail: order.user.email,
            ...proxySmokeIssueFields,
            resourceId: rental.supplierResource?.id ?? proxySmokeIssueFields.resourceId ?? null,
            resourceList: true,
            resourceScope: "production",
            resourceType: "codex",
            resourceStatus: rental.supplierResource?.status ?? "online",
            supplierEmail: rental.supplierResource?.supplier?.user?.email ?? null,
            sub2AccountId: rental.supplierResource?.sub2AccountId ?? proxySmokeIssueFields.sub2AccountId ?? null,
            repairAction: "apply_openai_refresh_token_to_sub2_account",
            actionHint: "Repair the failing Sub2/OpenAI account or Codex shared resource, then rerun local proxy smoke before leaving sold Codex rentals active.",
            message: `Active Codex rental ${rental.id} is affected by the latest local OpenAI/Codex proxy smoke failure.`
          });
        }
      }

      if (!rental.endpointUrl) {
        counters.rentalsMissingEndpoint += 1;
        addIssue({
          type: "rental_missing_endpoint",
          orderId: order.id,
          rentalId: rental.id,
          userId: order.userId,
          userEmail: order.user.email,
          message: `Rental ${rental.id} has no endpoint URL.`
        });
      }

      if (!rental.sub2KeyId) {
        counters.rentalsMissingSub2Key += 1;
        addIssue({
          type: "rental_missing_sub2_key",
          orderId: order.id,
          rentalId: rental.id,
          userId: order.userId,
          userEmail: order.user.email,
          message: `Rental ${rental.id} has no Sub2 key ID.`
        });
      }

      if (!rental.apiKeys.some((apiKey) => apiKey.status === "active")) {
        counters.rentalsMissingActiveApiKey += 1;
        addIssue({
          type: "rental_missing_active_api_key",
          orderId: order.id,
          rentalId: rental.id,
          userId: order.userId,
          userEmail: order.user.email,
          message: `Rental ${rental.id} has no active local API key.`
        });
      }
    }
  }

  return {
    ok: errors === 0,
    errors,
    summary: {
      matched,
      scanned: orders.length,
      truncated: matched > orders.length,
      returnedIssues: issues.length,
      ordersWithIssues: ordersWithIssues.size,
      ...counters
    },
    issues
  };
}

async function inspectPendingUsageBilling(checkedAt: Date) {
  const where: Prisma.UsageRecordWhereInput = {
    rental: nonSmokeRentalWhere(),
    status: "pending",
    buyerCharge: { gt: 0 }
  };
  const [summary, activePendingCount, lowBalancePendingCount, limitedPendingCount, usages] = await Promise.all([
    prisma.usageRecord.aggregate({
      where,
      _count: true,
      _sum: { buyerCharge: true, supplierIncome: true },
      _min: { occurredAt: true }
    }),
    prisma.usageRecord.count({
      where: {
        ...where,
        rental: { ...nonSmokeRentalWhere(), status: "active" }
      }
    }),
    prisma.usageRecord.count({
      where: {
        ...where,
        rental: { ...nonSmokeRentalWhere(), status: "low_balance" }
      }
    }),
    prisma.usageRecord.count({
      where: {
        ...where,
        rental: { ...nonSmokeRentalWhere(), status: "limited" }
      }
    }),
    prisma.usageRecord.findMany({
      where,
      select: {
        id: true,
        rentalId: true,
        userId: true,
        buyerCharge: true,
        supplierIncome: true,
        occurredAt: true,
        rental: { select: { status: true, user: { select: { email: true } } } }
      },
      orderBy: { occurredAt: "asc" },
      take: systemHealthPendingUsageScanLimit
    })
  ]);

  const issues: PendingUsageBillingIssue[] = [];
  const counters = {
    pendingUsages: summary._count,
    pendingOnActiveRentals: activePendingCount,
    pendingOnLowBalanceRentals: lowBalancePendingCount,
    pendingOnLimitedRentals: limitedPendingCount,
    pendingOnOtherRentals: Math.max(0, summary._count - activePendingCount - lowBalancePendingCount - limitedPendingCount)
  };
  const errors = counters.pendingOnActiveRentals;
  const warnings = Math.max(0, counters.pendingUsages - counters.pendingOnActiveRentals);

  const addIssue = (usage: (typeof usages)[number], type: string, severity: PendingUsageBillingIssue["severity"], message: string) => {
    if (issues.length >= systemHealthPendingUsageIssueLimit) return;

    const ageMinutes = Math.max(0, Math.floor((checkedAt.getTime() - usage.occurredAt.getTime()) / 60_000));
    issues.push({
      id: `${type}:${usage.id}`,
      type,
      severity,
      usageId: usage.id,
      rentalId: usage.rentalId,
      rentalStatus: usage.rental?.status ?? null,
      userId: usage.userId,
      userEmail: usage.rental?.user.email ?? null,
      buyerCharge: decimalText(usage.buyerCharge),
      supplierIncome: decimalText(usage.supplierIncome),
      occurredAt: usage.occurredAt.toISOString(),
      ageMinutes,
      message
    });
  };

  for (const usage of usages) {
    if (usage.rental?.status === "active") {
      addIssue(
        usage,
        "pending_usage_on_active_rental",
        "error",
        `Usage ${usage.id} is pending while rental ${usage.rentalId} is still active.`
      );
      continue;
    }

    if (usage.rental?.status === "low_balance") {
      addIssue(
        usage,
        "pending_usage_waiting_for_balance",
        "warning",
        `Usage ${usage.id} is pending because rental ${usage.rentalId} is low_balance.`
      );
      continue;
    }

    addIssue(
      usage,
      "pending_usage_on_inactive_rental",
      "warning",
      `Usage ${usage.id} is pending while rental ${usage.rentalId} is ${usage.rental?.status ?? "missing"}.`
    );
  }

  return {
    ok: errors === 0 && warnings === 0,
    errors,
    warnings,
    summary: {
      matched: summary._count,
      scanned: usages.length,
      truncated: summary._count > usages.length,
      scanLimit: systemHealthPendingUsageScanLimit,
      returnedIssues: issues.length,
      totalBuyerCharge: decimalText(summary._sum.buyerCharge ?? new Prisma.Decimal(0)),
      totalSupplierIncome: decimalText(summary._sum.supplierIncome ?? new Prisma.Decimal(0)),
      oldestOccurredAt: summary._min.occurredAt?.toISOString() ?? null,
      ...counters
    },
    issues
  };
}

async function buildSalesBreakdown(orderWhere: Prisma.OrderWhereInput) {
  const zero = new Prisma.Decimal(0);
  const [statusGroups, productGroups, rentalResourceGroups, rentalStatusGroups] = await Promise.all([
    prisma.order.groupBy({
      by: ["status"],
      where: orderWhere,
      _count: { _all: true },
      _sum: { totalAmount: true, paidAmount: true }
    }),
    prisma.orderItem.groupBy({
      by: ["productId"],
      where: { order: orderWhere },
      _count: { _all: true },
      _sum: { quantity: true, amount: true }
    }),
    prisma.rental.groupBy({
      by: ["resourceType"],
      where: { ...nonSmokeRentalWhere(), order: orderWhere },
      _count: { _all: true }
    }),
    prisma.rental.groupBy({
      by: ["status"],
      where: { ...nonSmokeRentalWhere(), order: orderWhere },
      _count: { _all: true }
    })
  ]);

  const productIds = productGroups.map((group) => group.productId);
  const products = productIds.length
    ? await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, resourceType: true }
    })
    : [];
  const productById = new Map(products.map((product) => [product.id, product]));
  const resourceMap = new Map<string, {
    resourceType: string;
    orderItemCount: number;
    quantity: number;
    amount: Prisma.Decimal;
    rentalCount: number;
  }>();

  const byProduct = productGroups.map((group) => {
    const product = productById.get(group.productId);
    const resourceType = product?.resourceType ?? "unknown";
    const amount = group._sum.amount ?? zero;
    const current = resourceMap.get(resourceType) ?? {
      resourceType,
      orderItemCount: 0,
      quantity: 0,
      amount: zero,
      rentalCount: 0
    };
    current.orderItemCount += group._count._all;
    current.quantity += group._sum.quantity ?? 0;
    current.amount = current.amount.plus(amount);
    resourceMap.set(resourceType, current);

    return {
      productId: group.productId,
      productName: product?.name ?? group.productId,
      resourceType,
      orderItemCount: group._count._all,
      quantity: group._sum.quantity ?? 0,
      amount: decimalText(amount)
    };
  }).sort((left, right) => new Prisma.Decimal(right.amount).cmp(left.amount));

  for (const group of rentalResourceGroups) {
    const resourceType = group.resourceType;
    const current = resourceMap.get(resourceType) ?? {
      resourceType,
      orderItemCount: 0,
      quantity: 0,
      amount: zero,
      rentalCount: 0
    };
    current.rentalCount = group._count._all;
    resourceMap.set(resourceType, current);
  }

  return {
    byStatus: statusGroups
      .map((group) => ({
        status: group.status,
        orderCount: group._count._all,
        totalAmount: decimalText(group._sum.totalAmount ?? zero),
        paidAmount: decimalText(group._sum.paidAmount ?? zero)
      }))
      .sort((left, right) => right.orderCount - left.orderCount),
    byResourceType: [...resourceMap.values()]
      .map((group) => ({
        resourceType: group.resourceType,
        orderItemCount: group.orderItemCount,
        quantity: group.quantity,
        amount: decimalText(group.amount),
        rentalCount: group.rentalCount
      }))
      .sort((left, right) => new Prisma.Decimal(right.amount).cmp(left.amount)),
    byProduct: byProduct.slice(0, 12),
    byRentalStatus: rentalStatusGroups
      .map((group) => ({
        status: group.status,
        rentalCount: group._count._all
      }))
      .sort((left, right) => right.rentalCount - left.rentalCount)
  };
}

async function findSub2BindingIssues() {
  const [rentals, loadedBindings] = await Promise.all([
    prisma.rental.findMany({
      where: {
        ...nonSmokeRentalWhere(),
        OR: [
          { sub2UserId: { not: null } },
          { sub2KeyId: { not: null } }
        ]
      },
      select: {
        id: true,
        sub2UserId: true,
        sub2KeyId: true,
        status: true,
        user: { select: { email: true } },
        product: { select: { name: true } }
      },
      orderBy: { createdAt: "desc" },
      take: sub2BindingReconciliationLimit
    }),
    prisma.sub2Binding.findMany({
      where: {
        objectType: { in: ["rental", "rental_api_key_history"] },
        sub2Type: { in: ["user", "api_key"] }
      },
      orderBy: { createdAt: "desc" },
      take: sub2BindingReconciliationLimit * 3
    })
  ]);
  const internalBindingRentalIds = await findInternalHealthCheckRentalIds(loadedBindings);
  const bindings = nonSmokeSub2Bindings(loadedBindings).filter((binding) => {
    const rentalId = sub2BindingRentalId(binding);
    return !rentalId || !internalBindingRentalIds.has(rentalId);
  });

  const issues: Sub2BindingIssue[] = [];
  const rentalIds = new Set(rentals.map((rental) => rental.id));
  const bindingByRentalAndType = new Map<string, { id: string; sub2Id: string }>();
  const bindingBySub2TypeAndId = new Map<string, { id: string; objectType: string; objectId: string }>();
  for (const binding of bindings) {
    bindingBySub2TypeAndId.set(`${binding.sub2Type}:${binding.sub2Id}`, {
      id: binding.id,
      objectType: binding.objectType,
      objectId: binding.objectId
    });
  }
  for (const binding of bindings.filter((item) => item.objectType === "rental")) {
    bindingByRentalAndType.set(`${binding.objectId}:${binding.sub2Type}`, {
      id: binding.id,
      sub2Id: binding.sub2Id
    });
  }

  const activeRentalStatuses = new Set(["active", "low_balance", "limited", "suspended"]);
  const rentalsBySub2Key = new Map<string, typeof rentals>();
  for (const rental of rentals) {
    if (rental.sub2KeyId && activeRentalStatuses.has(rental.status)) {
      const existing = rentalsBySub2Key.get(rental.sub2KeyId) ?? [];
      existing.push(rental);
      rentalsBySub2Key.set(rental.sub2KeyId, existing);
    }
  }
  for (const [sub2KeyId, keyRentals] of rentalsBySub2Key) {
    if (keyRentals.length > 1) {
      for (const rental of keyRentals) {
        issues.push(sub2BindingIssue({
          type: "duplicate_current_api_key_reference",
          rentalId: rental.id,
          sub2Type: "api_key",
          expected: sub2KeyId,
          message: `Rental ${rental.id} shares current sub2KeyId ${sub2KeyId} with ${keyRentals.length - 1} other active rental(s).`
        }));
      }
    }
  }

  for (const rental of rentals) {
    if (rental.sub2UserId) {
      const binding = bindingBySub2TypeAndId.get(`user:${rental.sub2UserId}`);
      if (!binding) {
        issues.push(sub2BindingIssue({
          type: "missing_user_binding",
          rentalId: rental.id,
          sub2Type: "user",
          expected: rental.sub2UserId,
          message: `Rental ${rental.id} has sub2UserId but no user binding for that Sub2 user.`
        }));
      }
    }

    if (rental.sub2KeyId) {
      const binding = bindingByRentalAndType.get(`${rental.id}:api_key`);
      if (!binding) {
        issues.push(sub2BindingIssue({
          type: "missing_current_api_key_binding",
          rentalId: rental.id,
          sub2Type: "api_key",
          expected: rental.sub2KeyId,
          message: `Rental ${rental.id} has sub2KeyId but no current api_key binding.`
        }));
      } else if (binding.sub2Id !== rental.sub2KeyId) {
        issues.push(sub2BindingIssue({
          type: "mismatched_current_api_key_binding",
          rentalId: rental.id,
          bindingId: binding.id,
          sub2Type: "api_key",
          expected: rental.sub2KeyId,
          actual: binding.sub2Id,
          message: `Rental ${rental.id} api_key binding does not match current sub2KeyId.`
        }));
      }
    }
  }

  for (const binding of bindings) {
    const rentalId = binding.objectType === "rental_api_key_history"
      ? binding.objectId.split(":")[0]
      : binding.objectId;
    if (rentalId && !rentalIds.has(rentalId)) {
      issues.push(sub2BindingIssue({
        type: "orphan_binding",
        severity: "warning",
        rentalId,
        bindingId: binding.id,
        sub2Type: binding.sub2Type,
        actual: binding.sub2Id,
        message: `Sub2 binding ${binding.id} points to a missing rental.`
      }));
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    ok: issues.length === 0,
    scanLimit: sub2BindingReconciliationLimit,
    summary: {
      rentalsScanned: rentals.length,
      bindingsScanned: bindings.length,
      totalIssues: issues.length,
      missingCurrentUserBindings: issues.filter((issue) => issue.type === "missing_current_user_binding").length,
      missingUserBindings: issues.filter((issue) => issue.type === "missing_user_binding").length,
      missingCurrentApiKeyBindings: issues.filter((issue) => issue.type === "missing_current_api_key_binding").length,
      duplicateCurrentApiKeyReferences: issues.filter((issue) => issue.type === "duplicate_current_api_key_reference").length,
      mismatchedCurrentBindings: issues.filter((issue) => issue.type.startsWith("mismatched_current")).length,
      orphanBindings: issues.filter((issue) => issue.type === "orphan_binding").length
    },
    issues: issues.slice(0, 100)
  };
}

async function findInternalHealthCheckRentalIds(bindings: Array<{ objectType: string; objectId: string }>) {
  const rentalIds = [...new Set(bindings.map(sub2BindingRentalId).filter((id): id is string => Boolean(id)))];
  if (rentalIds.length === 0) return new Set<string>();
  const rentals = await prisma.rental.findMany({
    where: {
      id: { in: rentalIds },
      user: internalHealthCheckUserWhere()
    },
    select: { id: true }
  });
  return new Set(rentals.map((rental) => rental.id));
}

function sub2BindingRentalId(binding: { objectType: string; objectId: string }) {
  return binding.objectType === "rental_api_key_history"
    ? binding.objectId.split(":")[0]
    : binding.objectType === "rental" ? binding.objectId : null;
}

async function repairSub2Bindings() {
  const rentals = await prisma.rental.findMany({
    where: {
      ...nonSmokeRentalWhere(),
      OR: [
        { sub2UserId: { not: null } },
        { sub2KeyId: { not: null } }
      ]
    },
    select: {
      id: true,
      sub2UserId: true,
      sub2KeyId: true
    },
    orderBy: { createdAt: "desc" },
    take: sub2BindingReconciliationLimit
  });

  let userBindingsUpserted = 0;
  let apiKeyBindingsUpserted = 0;
  const conflicts: Array<{ rentalId: string; sub2Type: string; sub2Id: string; reason: string }> = [];
  const repairedAt = new Date().toISOString();
  await prisma.$transaction(async (tx) => {
    for (const rental of rentals) {
      if (rental.sub2UserId) {
        const result = await ensureSub2Binding(tx, rental.id, "user", rental.sub2UserId, { repairedAt }, {
          preserveExistingSub2IdOwner: true
        });
        if (result.changed) userBindingsUpserted += 1;
        if (!result.ok) conflicts.push({
          rentalId: rental.id,
          sub2Type: "user",
          sub2Id: rental.sub2UserId,
          reason: result.reason
        });
      }

      if (rental.sub2KeyId) {
        const result = await ensureSub2Binding(tx, rental.id, "api_key", rental.sub2KeyId, { repairedAt }, {
          preserveExistingSub2IdOwner: false
        });
        if (result.changed) apiKeyBindingsUpserted += 1;
        if (!result.ok) conflicts.push({
          rentalId: rental.id,
          sub2Type: "api_key",
          sub2Id: rental.sub2KeyId,
          reason: result.reason
        });
      }
    }
  });

  const reconciliation = await findSub2BindingIssues();
  return {
    repairedAt,
    rentalsScanned: rentals.length,
    userBindingsUpserted,
    apiKeyBindingsUpserted,
    conflicts,
    reconciliation
  };
}

async function ensureSub2Binding(
  tx: Prisma.TransactionClient,
  rentalId: string,
  sub2Type: "user" | "api_key",
  sub2Id: string,
  meta: Prisma.InputJsonObject,
  options: { preserveExistingSub2IdOwner: boolean }
) {
  const [bySub2Id, canonical] = await Promise.all([
    tx.sub2Binding.findUnique({
      where: {
        sub2Type_sub2Id: {
          sub2Type,
          sub2Id
        }
      }
    }),
    tx.sub2Binding.findUnique({
      where: {
        objectType_objectId_sub2Type: {
          objectType: "rental",
          objectId: rentalId,
          sub2Type
        }
      }
    })
  ]);

  if (bySub2Id) {
    if (bySub2Id.objectType === "rental" && bySub2Id.objectId === rentalId) {
      await tx.sub2Binding.update({ where: { id: bySub2Id.id }, data: { meta } });
      return { ok: true as const, changed: true };
    }
    if (options.preserveExistingSub2IdOwner) {
      return { ok: true as const, changed: false };
    }
    if (canonical && canonical.id !== bySub2Id.id) {
      return {
        ok: false as const,
        changed: false,
        reason: "canonical_binding_conflicts_with_existing_sub2_id"
      };
    }
    await tx.sub2Binding.update({
      where: { id: bySub2Id.id },
      data: {
        objectType: "rental",
        objectId: rentalId,
        meta
      }
    });
    return { ok: true as const, changed: true };
  }

  await tx.sub2Binding.upsert({
    where: {
      objectType_objectId_sub2Type: {
        objectType: "rental",
        objectId: rentalId,
        sub2Type
      }
    },
    update: { sub2Id, meta },
    create: {
      objectType: "rental",
      objectId: rentalId,
      sub2Type,
      sub2Id,
      meta
    }
  });
  return { ok: true as const, changed: true };
}

function sub2BindingIssue(input: Omit<Sub2BindingIssue, "id" | "severity"> & {
  severity?: Sub2BindingIssue["severity"];
}): Sub2BindingIssue {
  return {
    id: `${input.type}:${input.rentalId ?? "none"}:${input.sub2Type ?? "none"}:${input.bindingId ?? "none"}`,
    severity: input.severity ?? "error",
    ...input
  };
}

function systemHealthCheck(
  id: string,
  label: string,
  status: SystemHealthStatus,
  summary: string,
  metrics?: Record<string, string | number | boolean | null>,
  detail?: unknown
): SystemHealthCheck {
  return { id, label, status, summary, metrics, detail };
}

type WalletHealthSample = {
  id: string;
  userId: string;
  availableBalance: Prisma.Decimal;
  frozenBalance: Prisma.Decimal;
  updatedAt?: Date | null;
  user?: {
    email?: string | null;
    displayName?: string | null;
    status?: string | null;
  } | null;
};

export function walletHealthCheck(negativeWallets: number, samples: WalletHealthSample[]) {
  const issues = samples.flatMap((wallet) => {
    const base = {
      walletId: wallet.id,
      walletAccountId: wallet.id,
      userId: wallet.userId,
      userEmail: wallet.user?.email ?? null,
      userStatus: wallet.user?.status ?? null,
      availableBalance: decimalText(wallet.availableBalance),
      frozenBalance: decimalText(wallet.frozenBalance),
      updatedAt: wallet.updatedAt?.toISOString() ?? null
    };
    const walletIssues: Array<Record<string, string | number | boolean | null>> = [];

    if (wallet.availableBalance.lt(0)) {
      walletIssues.push({
        id: `negative_available_balance:${wallet.id}`,
        type: "negative_available_balance",
        severity: "error",
        amount: decimalText(wallet.availableBalance),
        message: `Wallet ${wallet.id} available balance is negative.`,
        ...base
      });
    }

    if (wallet.frozenBalance.lt(0)) {
      walletIssues.push({
        id: `negative_frozen_balance:${wallet.id}`,
        type: "negative_frozen_balance",
        severity: "error",
        amount: decimalText(wallet.frozenBalance),
        message: `Wallet ${wallet.id} frozen balance is negative.`,
        ...base
      });
    }

    return walletIssues;
  });

  return systemHealthCheck(
    "wallets",
    "余额账户",
    negativeWallets > 0 ? "error" : "ok",
    negativeWallets > 0 ? `${negativeWallets} 个钱包出现负余额` : "余额账户未发现负数",
    { negativeWallets, issueSamples: issues.length },
    issues.length > 0 ? { issues } : undefined
  );
}

export function sub2BindingHealthCheck(sub2Bindings: {
  ok: boolean;
  summary: { totalIssues: number } & Record<string, string | number | boolean | null>;
  issues: unknown[];
}) {
  return systemHealthCheck(
    "sub2Bindings",
    "Sub2 绑定",
    sub2Bindings.ok ? "ok" : "warning",
    sub2Bindings.ok ? "Sub2Binding 与本地租赁一致" : `${sub2Bindings.summary.totalIssues} 个 Sub2 绑定问题`,
    sub2Bindings.summary,
    sub2Bindings.issues.length > 0 ? { issues: sub2Bindings.issues } : undefined
  );
}

export function reconciliationHealthCheck(reconciliation: {
  ok: boolean;
  summary: { totalIssues: number } & Record<string, string | number | boolean | null>;
  issues: unknown[];
}) {
  return systemHealthCheck(
    "reconciliation",
    "账务对账",
    reconciliation.ok ? "ok" : "error",
    reconciliation.ok ? "账务对账未发现问题" : `${reconciliation.summary.totalIssues} 个账务一致性问题`,
    reconciliation.summary,
    reconciliation.issues.length > 0 ? { issues: reconciliation.issues } : undefined
  );
}

const dashboardHealthCheckPriority = [
  "sub2",
  "localProxySmoke",
  "resourceCredentials",
  "resources",
  "productCatalog",
  "payments",
  "openAiProxyContract",
  "openAiProxyRuntime",
  "proxy",
  "salesDelivery",
  "apiKeys",
  "billingSync",
  "billingSyncScheduler",
  "pendingUsageBilling",
  "reconciliation",
  "adminCapabilities",
  "adminSurfaceCoverage",
  "deploymentRuntime"
] as const;

const dashboardHealthCheckPriorityIndex = new Map<string, number>(
  dashboardHealthCheckPriority.map((id, index) => [id, index])
);

interface DashboardLatestSystemHealthSnapshot {
  id: string;
  status: string;
  source: string;
  summary: unknown;
  checks: unknown;
  createdAt: Date;
}

export function dashboardManagementStatusCounts(
  statuses: readonly string[],
  rows: Array<{
    status: string | null;
    _count?: number | { _all?: number | null } | null;
    _sum?: Record<string, string | number | Prisma.Decimal | null | undefined> | null;
  }>
): DashboardManagementStatusCount[] {
  const byStatus = new Map(rows.map((row) => [row.status ?? "", row]));
  const knownStatuses = new Set(statuses);
  const orderedStatuses = [
    ...statuses,
    ...rows.map((row) => row.status ?? "").filter((status) => status && !knownStatuses.has(status))
  ];

  return orderedStatuses.map((status) => {
    const row = byStatus.get(status);
    const totalAmount = dashboardMoneyLikeValue(row?._sum?.totalAmount);
    const paidAmount = dashboardMoneyLikeValue(row?._sum?.paidAmount);
    return {
      status,
      count: dashboardGroupCountValue(row?._count),
      ...(totalAmount !== null ? { totalAmount } : {}),
      ...(paidAmount !== null ? { paidAmount } : {})
    };
  });
}

export function dashboardWalletManagementOverview(input: {
  total?: number | null;
  negative?: number | null;
  frozen?: number | null;
  available?: number | null;
  spent?: number | null;
}): DashboardWalletManagementOverview {
  return {
    total: input.total ?? 0,
    negative: input.negative ?? 0,
    frozen: input.frozen ?? 0,
    available: input.available ?? 0,
    spent: input.spent ?? 0
  };
}

export function dashboardLatestSystemHealthPreview(
  snapshot: DashboardLatestSystemHealthSnapshot,
  now = new Date(),
  liveDeploymentRuntimeCheck?: SystemHealthCheck | null
) {
  const ageMinutes = Math.floor(Math.max(0, now.getTime() - snapshot.createdAt.getTime()) / 60000);
  const staleThresholdMinutes = Math.floor(dashboardSystemHealthSnapshotStaleMs / 60000);
  const deploymentRuntime = liveDeploymentRuntimeCheck
    ? dashboardDeploymentRuntimePreview([liveDeploymentRuntimeCheck]) ?? dashboardDeploymentRuntimePreview(snapshot.checks)
    : dashboardDeploymentRuntimePreview(snapshot.checks);

  return {
    id: snapshot.id,
    status: snapshot.status,
    source: snapshot.source,
    summary: snapshot.summary,
    createdAt: snapshot.createdAt,
    ageMinutes,
    stale: ageMinutes >= staleThresholdMinutes,
    staleThresholdMinutes,
    upstreamBlocker: dashboardUpstreamBlockerPreview(snapshot.checks),
    deliveryBlocker: dashboardDeliveryBlockerPreview(snapshot.checks),
    deploymentRuntime,
    adminEntryCoverage: dashboardAdminEntryCoveragePreview(snapshot.checks),
    criticalChecks: dashboardHealthCheckPreviews(snapshot.checks)
  };
}

export function dashboardHealthCheckPreviews(checks: unknown): DashboardHealthCheckPreview[] {
  if (!Array.isArray(checks)) return [];

  const previews = checks
    .map(dashboardHealthCheckPreview)
    .filter((item): item is DashboardHealthCheckPreview => Boolean(item))
    .filter((item) => item.status !== "ok" || dashboardHealthCheckPriorityIndex.has(item.id));

  return previews
    .sort((left, right) => {
      const statusDelta = systemHealthStatusRank(right.status) - systemHealthStatusRank(left.status);
      if (statusDelta !== 0) return statusDelta;
      return dashboardHealthCheckRank(left.id) - dashboardHealthCheckRank(right.id);
    })
    .slice(0, 8);
}

function dashboardAdminEntryCoveragePreview(checks: unknown): DashboardAdminEntryCoveragePreview | null {
  if (!Array.isArray(checks)) return null;
  const previews = checks
    .map(dashboardHealthCheckPreview)
    .filter((item): item is DashboardHealthCheckPreview => Boolean(item));
  const api = dashboardAdminEntryCoverageSide(previews.find((item) => item.id === "adminCapabilities"), "api");
  const frontend = dashboardAdminEntryCoverageSide(previews.find((item) => item.id === "adminSurfaceCoverage"), "frontend");
  if (!api && !frontend) return null;

  const ok = [api, frontend].filter(Boolean).every((item) => item?.status === "ok");
  const summary = [api?.summary, frontend?.summary].filter(Boolean).join(" / ");
  return {
    ok,
    summary,
    ...(api ? { api } : {}),
    ...(frontend ? { frontend } : {})
  };
}

function dashboardDeploymentRuntimePreview(checks: unknown): DashboardDeploymentRuntimePreview | null {
  if (!Array.isArray(checks)) return null;
  const previews = checks
    .map(dashboardHealthCheckPreview)
    .filter((item): item is DashboardHealthCheckPreview => Boolean(item));
  const check = previews.find((item) => item.id === "deploymentRuntime");
  if (!check) return null;

  const metrics = check.metrics ?? {};
  return {
    ok: check.status === "ok",
    status: check.status,
    summary: check.summary,
    issueCount: check.issueCount,
    metrics,
    commit: textJsonValue(metrics.commit) ?? null,
    deployedAt: textJsonValue(metrics.deployedAt) ?? null,
    releaseRoot: textJsonValue(metrics.releaseRoot) ?? null,
    markerPath: textJsonValue(metrics.markerPath) ?? null,
    runningFromReplacedRelease: dashboardDetailBoolean(metrics, "runningFromReplacedRelease"),
    runningFromStagingRelease: dashboardDetailBoolean(metrics, "runningFromStagingRelease"),
    check
  };
}

function dashboardAdminEntryCoverageSide(
  check: DashboardHealthCheckPreview | undefined,
  kind: "api" | "frontend"
): DashboardAdminEntryCoverageSide | null {
  if (!check) return null;
  const metrics = check.metrics ?? {};
  const coveredRequiredAreas = dashboardMetricNumber(metrics, "coveredRequiredAreas");
  const requiredAreas = dashboardMetricNumber(metrics, "requiredAreas");
  const totalOperations = dashboardMetricNumber(metrics, "totalOperations");
  const registeredOperations = dashboardMetricNumber(metrics, "registeredOperations");
  const operationsWithTargets = dashboardMetricNumber(metrics, "operationsWithTargets");
  const managedListViews = dashboardMetricNumber(metrics, "managedListViews");
  const criticalViews = dashboardMetricNumber(metrics, "criticalViews");

  let summary = check.summary;
  if (kind === "api" && coveredRequiredAreas !== null && requiredAreas !== null) {
    const routeText = totalOperations !== null && registeredOperations !== null ? `，${registeredOperations}/${totalOperations} 路由` : "";
    const targetText = totalOperations !== null && operationsWithTargets !== null ? `，${operationsWithTargets}/${totalOperations} 入口` : "";
    summary = `API ${coveredRequiredAreas}/${requiredAreas} 核心范围${routeText}${targetText}`;
  }
  if (kind === "frontend" && coveredRequiredAreas !== null && requiredAreas !== null) {
    const listText = managedListViews !== null ? `，${managedListViews} 个列表入口` : "";
    const criticalText = criticalViews !== null ? `，${criticalViews} 个关键入口` : "";
    summary = `前端 ${coveredRequiredAreas}/${requiredAreas} 核心范围${listText}${criticalText}`;
  }

  return {
    status: check.status,
    summary,
    issueCount: check.issueCount,
    metrics
  };
}

function dashboardUpstreamBlockerPreview(checks: unknown): DashboardUpstreamBlockerPreview | null {
  if (!Array.isArray(checks)) return null;
  const previews = checks
    .map(dashboardHealthCheckPreview)
    .filter((item): item is DashboardHealthCheckPreview => Boolean(item));
  const check = previews
    .filter((item) => ["sub2", "localProxySmoke", "resourceCredentials", "resources", "productCatalog"].includes(item.id))
    .filter((item) => item.status !== "ok")
    .sort((left, right) => {
      const statusDelta = systemHealthStatusRank(right.status) - systemHealthStatusRank(left.status);
      if (statusDelta !== 0) return statusDelta;
      const actionableDelta = dashboardUpstreamBlockerActionRank(left) - dashboardUpstreamBlockerActionRank(right);
      if (actionableDelta !== 0) return actionableDelta;
      return dashboardHealthCheckRank(left.id) - dashboardHealthCheckRank(right.id);
    })[0];
  if (!check) return null;

  const detail = dashboardUpstreamBlockerDetail(check);
  const credentialReadiness = dashboardUpstreamCredentialReadinessPreview(previews);
  const proxyRequestFilter = dashboardProxyRequestFilter(check, detail, "upstream");
  return {
    blocked: check.status === "error",
    status: check.status,
    checkId: check.id,
    label: check.label,
    summary: check.summary,
    issueCount: check.issueCount,
    sampleCount: check.sampleCount,
    actionHint: textJsonValue(detail.actionHint) ?? null,
    repairAction: textJsonValue(detail.repairAction) ?? null,
    sub2AccountId: dashboardHealthScalarValue(detail.sub2AccountId) ?? null,
    sub2AccountName: textJsonValue(detail.sub2AccountName) ?? null,
    accountStatus: textJsonValue(detail.accountStatus) ?? null,
    credentialsStatus: textJsonValue(detail.credentialsStatus) ?? null,
    schedulable: dashboardDetailBoolean(detail, "schedulable"),
    tempUnschedulableReason: textJsonValue(detail.tempUnschedulableReason) ?? null,
    accountMessage: textJsonValue(detail.accountMessage) ?? null,
    accountErrorStatusCode: dashboardDetailNumber(detail, "accountErrorStatusCode"),
    accountErrorType: textJsonValue(detail.accountErrorType) ?? null,
    accountErrorCode: textJsonValue(detail.accountErrorCode) ?? null,
    accountErrorMessage: textJsonValue(detail.accountErrorMessage) ?? null,
    accountUpdatedAt: textJsonValue(detail.updatedAt) ?? null,
    resourceId: dashboardHealthScalarValue(detail.resourceId) ?? null,
    resourceList: dashboardHealthScalarValue(detail.resourceList) ?? null,
    resourceType: dashboardHealthScalarValue(detail.resourceType) ?? null,
    resourceScope: dashboardHealthScalarValue(detail.resourceScope) ?? null,
    evidencePath: textJsonValue(detail.proxyRequestPath) ?? null,
    evidenceStatusCode: dashboardDetailNumber(detail, "proxyRequestStatusCode"),
    evidenceErrorCode: textJsonValue(detail.proxyRequestErrorCode) ?? null,
    evidenceModel: textJsonValue(detail.model) ?? null,
    evidenceResponsesOk: dashboardDetailBoolean(detail, "responsesOk"),
    evidenceModelsStatusCode: dashboardDetailNumber(detail, "modelsStatusCode"),
    evidenceModelsError: textJsonValue(detail.modelsError) ?? null,
    evidenceResponsesStatusCode: dashboardDetailNumber(detail, "responsesStatusCode"),
    evidenceResponsesErrorType: textJsonValue(detail.responsesErrorType) ?? null,
    evidenceResponsesErrorMessage: textJsonValue(detail.responsesErrorMessage) ?? null,
    evidenceLocalProxyOk: dashboardDetailBoolean(detail, "localProxyOk"),
    evidenceAgeMinutes: dashboardDetailNumber(detail, "ageMinutes"),
    evidenceStale: dashboardDetailBoolean(detail, "stale"),
    evidenceStaleThresholdMinutes: dashboardDetailNumber(detail, "staleThresholdMinutes"),
    evidenceFreshMinutesRemaining: dashboardDetailNumber(detail, "freshMinutesRemaining"),
    evidenceStaleAt: textJsonValue(detail.staleAt) ?? null,
    proxyRequestFilterStatus: proxyRequestFilter.status,
    proxyRequestFilterLookup: proxyRequestFilter.lookup,
    ...(credentialReadiness ? { credentialReadiness } : {}),
    check
  };
}

function dashboardUpstreamCredentialReadinessPreview(previews: DashboardHealthCheckPreview[]): DashboardUpstreamCredentialReadinessPreview | null {
  const check = previews.find((item) => item.id === "resourceCredentials");
  if (!check) return null;
  return {
    status: check.status,
    summary: check.summary,
    issueCount: check.issueCount,
    sampleCount: check.sampleCount,
    ...(check.metrics ? { metrics: check.metrics } : {})
  };
}

function dashboardDeliveryBlockerPreview(checks: unknown): DashboardDeliveryBlockerPreview | null {
  if (!Array.isArray(checks)) return null;
  const previews = checks
    .map(dashboardHealthCheckPreview)
    .filter((item): item is DashboardHealthCheckPreview => Boolean(item));
  const check = previews
    .filter((item) => ["salesDelivery", "productCatalog", "resources"].includes(item.id))
    .filter((item) => item.status !== "ok")
    .sort((left, right) => {
      const statusDelta = systemHealthStatusRank(right.status) - systemHealthStatusRank(left.status);
      if (statusDelta !== 0) return statusDelta;
      const actionableDelta = dashboardDeliveryBlockerActionRank(left) - dashboardDeliveryBlockerActionRank(right);
      if (actionableDelta !== 0) return actionableDelta;
      return dashboardDeliveryCheckRank(left.id) - dashboardDeliveryCheckRank(right.id);
    })[0];
  if (!check) return null;

  const detail = dashboardDeliveryBlockerDetail(check);
  const proxyRequestFilter = dashboardProxyRequestFilter(check, detail, "delivery");
  return {
    blocked: true,
    status: check.status,
    checkId: check.id,
    label: check.label,
    summary: check.summary,
    issueCount: check.issueCount,
    sampleCount: check.sampleCount,
    actionHint: textJsonValue(detail.actionHint) ?? null,
    repairAction: textJsonValue(detail.repairAction) ?? null,
    productId: textJsonValue(detail.productId) ?? null,
    productName: textJsonValue(detail.productName) ?? null,
    priceId: textJsonValue(detail.priceId) ?? null,
    orderId: textJsonValue(detail.orderId) ?? null,
    rentalId: textJsonValue(detail.rentalId) ?? null,
    userId: textJsonValue(detail.userId) ?? null,
    userEmail: textJsonValue(detail.userEmail) ?? null,
    supplierEmail: textJsonValue(detail.supplierEmail) ?? null,
    resourceId: dashboardHealthScalarValue(detail.resourceId) ?? null,
    resourceList: dashboardHealthScalarValue(detail.resourceList) ?? null,
    resourceType: dashboardHealthScalarValue(detail.resourceType) ?? null,
    resourceStatus: textJsonValue(detail.resourceStatus) ?? null,
    resourceScope: dashboardHealthScalarValue(detail.resourceScope) ?? null,
    sub2AccountId: dashboardHealthScalarValue(detail.sub2AccountId) ?? null,
    sub2AccountName: textJsonValue(detail.sub2AccountName) ?? null,
    accountStatus: textJsonValue(detail.accountStatus) ?? null,
    credentialsStatus: textJsonValue(detail.credentialsStatus) ?? null,
    schedulable: dashboardDetailBoolean(detail, "schedulable"),
    accountMessage: textJsonValue(detail.accountMessage) ?? null,
    accountErrorStatusCode: dashboardDetailNumber(detail, "accountErrorStatusCode"),
    accountErrorType: textJsonValue(detail.accountErrorType) ?? null,
    accountErrorCode: textJsonValue(detail.accountErrorCode) ?? null,
    accountErrorMessage: textJsonValue(detail.accountErrorMessage) ?? null,
    proxyRequestFilterStatus: proxyRequestFilter.status,
    proxyRequestFilterLookup: proxyRequestFilter.lookup,
    check
  };
}

function dashboardUpstreamBlockerDetail(check: DashboardHealthCheckPreview): DashboardHealthDetailPreview {
  return [check.primaryIssue, check.primarySample].find(dashboardUpstreamBlockerDetailIsActionable)
    ?? check.primaryIssue
    ?? check.primarySample
    ?? {};
}

function dashboardDeliveryBlockerDetail(check: DashboardHealthCheckPreview): DashboardHealthDetailPreview {
  return [check.primaryIssue, check.primarySample].find(dashboardDeliveryBlockerDetailIsActionable)
    ?? check.primaryIssue
    ?? check.primarySample
    ?? {};
}

function dashboardUpstreamBlockerActionRank(check: DashboardHealthCheckPreview) {
  return dashboardUpstreamBlockerDetailIsActionable(dashboardUpstreamBlockerDetail(check)) ? 0 : 1;
}

function dashboardDeliveryBlockerActionRank(check: DashboardHealthCheckPreview) {
  return dashboardDeliveryBlockerDetailIsActionable(dashboardDeliveryBlockerDetail(check)) ? 0 : 1;
}

function dashboardDeliveryCheckRank(id: string) {
  if (id === "salesDelivery") return 0;
  if (id === "productCatalog") return 1;
  if (id === "resources") return 2;
  return 3;
}

export function dashboardProxyRequestStatusFilter(input: {
  checkId?: string | null;
  statusCode?: unknown;
  upstreamStatusCode?: unknown;
  errorCode?: unknown;
}): string | null {
  const errorCode = textJsonValue(input.errorCode);
  const statusCode = dashboardNumericValue(input.statusCode);
  const upstreamStatusCode = dashboardNumericValue(input.upstreamStatusCode);

  if (errorCode && proxyStreamErrorCodeSet.has(errorCode)) return "stream_error";
  if (errorCode && proxyLocalAvailabilityErrorCodeSet.has(errorCode)) return "local_availability";
  if (errorCode && proxyClientRejectionErrorCodeSet.has(errorCode)) return "local_rejection";
  if ((upstreamStatusCode ?? 0) >= 400 || errorCode?.startsWith("upstream_")) return "upstream_error";
  if ((statusCode ?? 0) >= 500) return "server_error";
  if ((statusCode ?? 0) >= 400) return "client_error";
  if (errorCode) return "failed";
  if (input.checkId === "sub2") return "upstream_error";
  if (input.checkId === "localProxySmoke") return "failed";
  if (input.checkId === "openAiProxyRuntime") return "local_availability";
  return null;
}

function dashboardProxyRequestFilter(
  check: DashboardHealthCheckPreview,
  detail: DashboardHealthDetailPreview,
  fallback: "upstream" | "delivery"
) {
  const lookup = [
    detail.proxyRequestLookup,
    detail.requestId,
    detail.proxyRequestLogId,
    detail.upstreamRequestId
  ].map(textJsonValue).find(Boolean) ?? null;
  const status = dashboardProxyRequestStatusFilter({
    checkId: check.id,
    statusCode: detail.proxyRequestStatusCode,
    upstreamStatusCode: detail.upstreamStatusCode,
    errorCode: detail.proxyRequestErrorCode
  }) ?? (fallback === "upstream" && check.status === "error" ? "failed" : null);

  return { lookup, status };
}

function dashboardUpstreamBlockerDetailIsActionable(detail: DashboardHealthDetailPreview | undefined) {
  return Boolean(
    detail?.actionHint
    || detail?.repairAction
    || detail?.sub2AccountId
    || detail?.resourceId
    || detail?.resourceList
  );
}

function dashboardDeliveryBlockerDetailIsActionable(detail: DashboardHealthDetailPreview | undefined) {
  return Boolean(
    detail?.actionHint
    || detail?.repairAction
    || detail?.productId
    || detail?.priceId
    || detail?.resourceList
    || detail?.resourceId
  );
}

function dashboardHealthCheckPreview(value: unknown): DashboardHealthCheckPreview | null {
  const record = jsonObject(value);
  if (!record) return null;
  const id = textJsonValue(record.id);
  const label = textJsonValue(record.label);
  const status = systemHealthStatusValue(record.status);
  const summary = textJsonValue(record.summary);
  if (!id || !label || !status || !summary) return null;

  const detail = jsonObject(record.detail);
  const issueRows = Array.isArray(detail?.issues) ? detail.issues : [];
  const sampleRows = Array.isArray(detail?.samples) ? detail.samples : [];
  const metrics = dashboardHealthMetricPreview(record.metrics);
  const primaryIssue = dashboardHealthDetailPreview(issueRows[0]);
  const primarySample = dashboardHealthDetailPreview(sampleRows[0]);

  return {
    id,
    label,
    status,
    summary,
    ...(metrics ? { metrics } : {}),
    issueCount: issueRows.length,
    sampleCount: sampleRows.length,
    ...(primaryIssue ? { primaryIssue } : {}),
    ...(primarySample ? { primarySample } : {})
  };
}

function dashboardHealthDetailPreview(value: unknown): DashboardHealthDetailPreview | null {
  const record = jsonObject(value);
  if (!record) return null;

  const preview: DashboardHealthDetailPreview = {};
  for (const field of dashboardHealthDetailPreviewFields) {
    const value = dashboardHealthScalarValue(record[field]);
    if (value !== undefined) preview[field] = value;
  }

  return Object.keys(preview).length > 0 ? preview : null;
}

function dashboardHealthMetricPreview(value: unknown): DashboardHealthMetricPreview | null {
  const record = jsonObject(value);
  if (!record) return null;

  const preview: DashboardHealthMetricPreview = {};
  for (const field of dashboardHealthMetricPreviewFields) {
    const value = dashboardHealthScalarValue(record[field]);
    if (value !== undefined) preview[field] = value;
  }

  return Object.keys(preview).length > 0 ? preview : null;
}

function dashboardMetricNumber(metrics: DashboardHealthMetricPreview, field: string) {
  const value = metrics[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dashboardGroupCountValue(value: number | { _all?: number | null } | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && value && typeof value._all === "number" && Number.isFinite(value._all)) return value._all;
  return 0;
}

function dashboardMoneyLikeValue(value: string | number | Prisma.Decimal | null | undefined) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value.toString === "function") return value.toString();
  return null;
}

function dashboardDetailNumber(detail: DashboardHealthDetailPreview, field: string) {
  const value = detail[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dashboardNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

function dashboardDetailBoolean(detail: DashboardHealthDetailPreview, field: string) {
  const value = detail[field];
  return typeof value === "boolean" ? value : null;
}

function dashboardHealthScalarValue(value: unknown) {
  if (typeof value === "string") return value.trim() ? value : undefined;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value === null) return null;
  return undefined;
}

function dashboardHealthCheckRank(id: string) {
  return dashboardHealthCheckPriorityIndex.get(id) ?? dashboardHealthCheckPriority.length + 1;
}

function systemHealthStatusRank(status: SystemHealthStatus) {
  if (status === "error") return 3;
  if (status === "warning") return 2;
  return 1;
}

function systemHealthStatusValue(value: unknown): SystemHealthStatus | null {
  return value === "ok" || value === "warning" || value === "error" ? value : null;
}

function textJsonValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function inspectRegisteredAdminCapabilityRoutes() {
  return inspectAdminCapabilityRouteCoverage((operation) => adminCapabilityRouteExists?.(operation) ?? false);
}

function deploymentRuntimeHealthCheck() {
  const result = inspectCurrentDeploymentRuntime(env.NODE_ENV);
  return systemHealthCheck(
    "deploymentRuntime",
    "部署运行态",
    result.status,
    result.status === "ok"
      ? `当前进程运行在 release ${result.summary.commit ?? result.summary.releaseRootName}`
      : `${result.issues.length} 个部署运行态问题`,
    {
      nodeEnv: result.summary.nodeEnv,
      cwd: result.summary.cwd,
      releaseRoot: result.summary.releaseRoot,
      releaseRootName: result.summary.releaseRootName,
      markerPath: result.summary.markerPath,
      markerPresent: result.summary.markerPresent,
      commit: result.summary.commit,
      deployedAt: result.summary.deployedAt,
      runningFromReplacedRelease: result.summary.runningFromReplacedRelease,
      runningFromStagingRelease: result.summary.runningFromStagingRelease
    },
    {
      cwd: result.summary.cwd,
      markerPath: result.summary.markerPath,
      issues: result.issues
    }
  );
}

function adminCapabilityHealthCheck(result: ReturnType<typeof inspectRegisteredAdminCapabilityRoutes>) {
  return systemHealthCheck(
    "adminCapabilities",
    "管理员入口覆盖",
    result.ok ? "ok" : "error",
    result.ok
      ? `管理员入口覆盖 ${result.summary.coveredRequiredAreas}/${result.summary.requiredAreas} 个核心管理范围`
      : `${result.issues.length} 个管理员入口覆盖问题`,
    result.summary,
    result.issues.length > 0 ? { issues: result.issues } : undefined
  );
}

function adminSurfaceCoverageHealthCheck(result: ReturnType<typeof inspectAdminSurfaceCoverage>) {
  const issues = adminSurfaceCoverageIssues(result);
  return systemHealthCheck(
    "adminSurfaceCoverage",
    "管理前端入口",
    result.ok ? "ok" : "error",
    result.ok
      ? `管理前端入口覆盖 ${result.summary.coveredRequiredAreas}/${result.summary.requiredAreas} 个核心管理范围`
      : `${issues.length} 个管理前端入口覆盖问题`,
    result.summary,
    issues.length > 0 ? { issues, criticalViews: result.criticalViews } : { criticalViews: result.criticalViews }
  );
}

function adminSurfaceCoverageIssues(result: ReturnType<typeof inspectAdminSurfaceCoverage>): AdminSurfaceCoverageIssue[] {
  return [
    ...result.missingRequiredAreas.map((areaId) => ({
      id: `admin_surface:${areaId}:missing_required_area`,
      type: "required_surface_area_missing" as const,
      severity: "error" as const,
      areaId,
      refId: areaId,
      message: `Required admin frontend area ${areaId} has no navigation entry.`,
      actionHint: "Restore the admin navigation entry for this required management area."
    })),
    ...result.missingManagedListViews.map((view) => ({
      id: `admin_surface:${view}:missing_managed_list`,
      type: "managed_list_view_missing" as const,
      severity: "error" as const,
      view,
      refId: view,
      message: `Managed admin list view ${view} is not reachable from the sidebar navigation.`,
      actionHint: "Add the managed list view to adminNavigationItems before treating the admin portal as complete."
    })),
    ...result.duplicateViews.map((view) => ({
      id: `admin_surface:${view}:duplicate_navigation_view`,
      type: "duplicate_navigation_view" as const,
      severity: "error" as const,
      view,
      refId: view,
      message: `Admin sidebar navigation declares view ${view} more than once.`,
      actionHint: "Keep exactly one sidebar navigation item for each admin view."
    }))
  ];
}

async function inspectFrontendRuntimeEndpoints() {
  const probes = await Promise.all([
    probeFrontendEndpoint("web", env.APP_PUBLIC_URL),
    probeFrontendEndpoint("admin", env.ADMIN_PUBLIC_URL)
  ]);
  return inspectFrontendRuntime(probes);
}

async function probeFrontendEndpoint(endpoint: FrontendEndpointName, url?: string | null): Promise<FrontendEndpointProbe> {
  if (!url) {
    return {
      endpoint,
      url: null,
      ok: false,
      statusCode: null,
      contentType: null,
      durationMs: null,
      error: "missing_url"
    };
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), systemHealthFrontendProbeTimeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "text/html,application/xhtml+xml" },
      signal: controller.signal
    });
    const html = await response.text();
    const assetProbeResult = response.status >= 200 && response.status < 400 && response.headers.get("content-type")?.toLowerCase().includes("text/html")
      ? await probeFrontendAssets(endpoint, url, html)
      : { assetProbes: null, assetScanError: null };
    return {
      endpoint,
      url,
      ok: response.status >= 200 && response.status < 400,
      statusCode: response.status,
      contentType: response.headers.get("content-type"),
      durationMs: Date.now() - startedAt,
      error: null,
      assetProbes: assetProbeResult.assetProbes,
      assetScanError: assetProbeResult.assetScanError
    };
  } catch (error) {
    return {
      endpoint,
      url,
      ok: false,
      statusCode: null,
      contentType: null,
      durationMs: Date.now() - startedAt,
      error: redactSensitiveText(error instanceof Error ? error.message : String(error))
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeFrontendAssets(endpoint: FrontendEndpointName, endpointUrl: string, html: string): Promise<{
  assetProbes: FrontendAssetProbe[] | null;
  assetScanError: string | null;
}> {
  try {
    const assets = extractFrontendAssetReferences(html, endpointUrl);
    const assetProbes = await Promise.all(assets.map((asset) => probeFrontendAsset(endpoint, endpointUrl, asset.assetType, asset.assetUrl)));
    return { assetProbes, assetScanError: null };
  } catch (error) {
    return {
      assetProbes: null,
      assetScanError: redactSensitiveText(error instanceof Error ? error.message : String(error))
    };
  }
}

async function probeFrontendAsset(
  endpoint: FrontendEndpointName,
  endpointUrl: string,
  assetType: FrontendAssetProbe["assetType"],
  assetUrl: string
): Promise<FrontendAssetProbe> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), systemHealthFrontendProbeTimeoutMs);
  try {
    const response = await fetch(assetUrl, {
      method: "GET",
      headers: { accept: assetType === "stylesheet" ? "text/css,*/*;q=0.8" : "text/javascript,application/javascript,*/*;q=0.8" },
      signal: controller.signal
    });
    await response.body?.cancel();
    return {
      endpoint,
      endpointUrl,
      assetType,
      assetUrl,
      ok: response.status >= 200 && response.status < 400,
      statusCode: response.status,
      contentType: response.headers.get("content-type"),
      durationMs: Date.now() - startedAt,
      error: null
    };
  } catch (error) {
    return {
      endpoint,
      endpointUrl,
      assetType,
      assetUrl,
      ok: false,
      statusCode: null,
      contentType: null,
      durationMs: Date.now() - startedAt,
      error: redactSensitiveText(error instanceof Error ? error.message : String(error))
    };
  } finally {
    clearTimeout(timeout);
  }
}

function frontendRuntimeHealthCheck(result: FrontendRuntimeHealth) {
  return systemHealthCheck(
    "frontendRuntime",
    "前端入口",
    result.status,
    result.ok
      ? `Web/Admin frontend endpoints are reachable (${result.summary.okEndpoints}/${result.summary.totalEndpoints})`
      : `${result.issues.length} frontend endpoint issue(s) detected`,
    {
      totalEndpoints: result.summary.totalEndpoints,
      okEndpoints: result.summary.okEndpoints,
      missingEndpoints: result.summary.missingEndpoints,
      failedEndpoints: result.summary.failedEndpoints,
      nonHtmlEndpoints: result.summary.nonHtmlEndpoints,
      totalAssets: result.summary.totalAssets,
      okAssets: result.summary.okAssets,
      failedAssets: result.summary.failedAssets,
      endpointsWithoutAssets: result.summary.endpointsWithoutAssets
    },
    {
      probes: result.probes,
      issues: result.issues
    }
  );
}

function apiCorsPolicyHealthCheck() {
  const result = inspectApiCorsPolicy({
    nodeEnv: env.NODE_ENV,
    appPublicUrl: env.APP_PUBLIC_URL,
    adminPublicUrl: env.ADMIN_PUBLIC_URL,
    apiPublicUrl: env.API_PUBLIC_URL,
    openAiProxyPublicEndpoint,
    corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS
  });
  return systemHealthCheck(
    "corsPolicy",
    "CORS 白名单",
    result.ok ? "ok" : "error",
    result.summary.enforced
      ? result.ok
        ? `生产 CORS 已限制为 ${result.summary.allowedOriginCount} 个 origin`
        : `${result.issues.length} 个 CORS 白名单配置问题`
      : "非生产环境允许任意 origin",
    {
      nodeEnv: result.summary.nodeEnv,
      enforced: result.summary.enforced,
      allowedOriginCount: result.summary.allowedOriginCount,
      configuredOriginCount: result.summary.configuredOriginCount,
      invalidOriginCount: result.summary.invalidOriginCount,
      allowedMethods: result.summary.allowedMethods,
      exposesHeaders: result.summary.exposesHeaders
    },
    {
      allowedOrigins: result.summary.allowedOrigins,
      issues: result.issues
    }
  );
}

function paymentProviderHealthCheck(rechargeActivity: PaymentRechargeActivitySummary) {
  const result = inspectPaymentProviderHealth({
    provider: env.PAYMENT_PROVIDER,
    nodeEnv: env.NODE_ENV,
    allowProductionMockRecharge: env.ALLOW_PRODUCTION_MOCK_RECHARGE,
    minRechargeAmount: env.MIN_RECHARGE_AMOUNT,
    rechargeActivity
  });
  return systemHealthCheck(
    "payments",
    "支付充值",
    result.status,
    result.summary,
    result.metrics,
    result.issues.length > 0 || result.samples.length > 0
      ? { issues: result.issues, samples: result.samples }
      : undefined
  );
}

async function inspectPaymentRechargeActivity(checkedAt: Date): Promise<PaymentRechargeActivitySummary> {
  const rechargeWindowHours = 24;
  const rechargeWindowStartedAt = new Date(checkedAt.getTime() - rechargeWindowHours * 60 * 60 * 1000);
  const [recent, latest, samples] = await Promise.all([
    prisma.walletTransaction.aggregate({
      where: {
        ...nonSmokeWalletTransactionWhere(),
        type: "recharge",
        createdAt: { gte: rechargeWindowStartedAt }
      },
      _count: { _all: true },
      _sum: { amount: true }
    }),
    prisma.walletTransaction.findFirst({
      where: {
        ...nonSmokeWalletTransactionWhere(),
        type: "recharge"
      },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" }
    }),
    prisma.walletTransaction.findMany({
      where: {
        ...nonSmokeWalletTransactionWhere(),
        type: "recharge",
        createdAt: { gte: rechargeWindowStartedAt }
      },
      select: {
        id: true,
        walletId: true,
        amount: true,
        balanceAfter: true,
        currency: true,
        refType: true,
        refId: true,
        createdAt: true,
        wallet: {
          select: {
            userId: true,
            user: { select: { email: true } }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 5
    })
  ]);

  return {
    rechargeWindowHours,
    rechargeWindowStartedAt: rechargeWindowStartedAt.toISOString(),
    recentRechargeTransactions: recent._count._all,
    recentRechargeAmount: decimalText(recent._sum.amount ?? new Prisma.Decimal(0)),
    latestRechargeAt: latest?.createdAt.toISOString() ?? null,
    recentRechargeSamples: samples.map((sample) => ({
      id: sample.id,
      walletId: sample.walletId,
      userId: sample.wallet.userId,
      userEmail: sample.wallet.user.email,
      amount: decimalText(sample.amount),
      balanceAfter: decimalText(sample.balanceAfter),
      currency: sample.currency,
      refType: sample.refType,
      refId: sample.refId,
      createdAt: sample.createdAt.toISOString()
    }))
  };
}

async function resourceAvailabilityHealthCheck(
  resourcesByStatus: Record<string, number>,
  sub2AccountCandidates: ResourceCredentialSub2AccountCandidate[] = []
) {
  const codexResourceWhere: Prisma.SupplierResourceWhereInput = {
    resourceType: "codex",
    ...nonSmokeSupplierResourceWhere()
  };
  const readyOnlineCodexResourceWhere: Prisma.SupplierResourceWhereInput = {
    ...codexResourceWhere,
    status: "online",
    sub2AccountId: { not: null },
    credential: { is: { credentialType: "openai_refresh_token", status: "active" } }
  };
  const [
    onlineCodexResources,
    readyOnlineCodexResources,
    totalCodexResources,
    ignoredInternalResources,
    samples,
    onlineCodexSamples,
    supplierCandidates
  ] = await Promise.all([
    prisma.supplierResource.count({
      where: { ...codexResourceWhere, status: "online" }
    }),
    prisma.supplierResource.count({
      where: readyOnlineCodexResourceWhere
    }),
    prisma.supplierResource.count({
      where: codexResourceWhere
    }),
    prisma.supplierResource.count({
      where: internalHealthCheckSupplierResourceWhere()
    }),
    prisma.supplierResource.findMany({
      where: {
        ...nonSmokeSupplierResourceWhere(),
        OR: [
          { status: "abnormal" },
          { resourceType: "codex", status: { not: "online" } }
        ]
      },
      select: {
        id: true,
        resourceType: true,
        status: true,
        level: true,
        maxConcurrency: true,
        sub2AccountId: true,
        lastCheckedAt: true,
        updatedAt: true,
        supplier: {
          select: {
            user: { select: { email: true } }
          }
        },
        credential: { select: resourceCredentialSummarySelect }
      },
      orderBy: { updatedAt: "desc" },
      take: 10
    }),
    prisma.supplierResource.findMany({
      where: {
        ...codexResourceWhere,
        status: "online"
      },
      select: {
        id: true,
        resourceType: true,
        status: true,
        level: true,
        maxConcurrency: true,
        sub2AccountId: true,
        lastCheckedAt: true,
        updatedAt: true,
        supplier: {
          select: {
            user: { select: { email: true } }
          }
        },
        credential: { select: resourceCredentialSummarySelect }
      },
      orderBy: { updatedAt: "desc" },
      take: 10
    }),
    prisma.supplier.findMany({
      where: { user: { status: "active" } },
      select: {
        user: { select: { email: true } }
      },
      orderBy: { updatedAt: "desc" },
      take: 2
    })
  ]);
  const incompleteOnlineCodexSamples = onlineCodexSamples.filter((resource) => {
    return !resource.sub2AccountId
      || resource.credential?.credentialType !== "openai_refresh_token"
      || resource.credential.status !== "active";
  });
  const incompleteOnlineCodexResources = Math.max(onlineCodexResources - readyOnlineCodexResources, 0);
  const resourceSamplesById = new Map<string, (typeof samples)[number] | (typeof onlineCodexSamples)[number]>();
  for (const resource of [...samples, ...incompleteOnlineCodexSamples]) {
    resourceSamplesById.set(resource.id, resource);
  }
  const resourceSamples = [...resourceSamplesById.values()];
  const abnormalResources = resourcesByStatus.abnormal ?? 0;
  const issues: ResourceAvailabilityIssue[] = [];
  const abnormalSample = resourceSamples.find((resource) => resource.status === "abnormal");
  const nonOnlineCodexSample = resourceSamples.find((resource) => resource.resourceType === "codex" && resource.status !== "online");
  const incompleteOnlineCodexSample = incompleteOnlineCodexSamples[0];
  const supplierEmailCandidate = supplierCandidates.length === 1 ? supplierCandidates[0].user.email : null;

  if (abnormalResources > 0) {
    issues.push({
      id: "resource:abnormal",
      type: "abnormal_supplier_resource",
      severity: "warning",
      resourceId: abnormalSample?.id,
      resourceList: true,
      resourceScope: "production",
      resourceStatus: abnormalSample?.status ?? null,
      resourceType: abnormalSample?.resourceType ?? null,
      supplierEmail: abnormalSample?.supplier.user.email ?? null,
      actionHint: "Open the affected shared resource, review its Sub2 account binding and credential, then test it before moving it online.",
      message: `${abnormalResources} supplier resource(s) are abnormal and need operator review.`
    });
  }
  if (onlineCodexResources === 0) {
    issues.push({
      id: "resource:codex-online-missing",
      type: "codex_online_resource_missing",
      severity: "warning",
      resourceId: nonOnlineCodexSample?.id,
      ...supplierResourceMissingCodexIssueFields({
        supplierEmail: nonOnlineCodexSample?.supplier.user.email ?? supplierEmailCandidate,
        resourceStatus: nonOnlineCodexSample?.status ?? null,
        resourceType: nonOnlineCodexSample?.resourceType ?? "codex",
        sub2AccountId: nonOnlineCodexSample?.sub2AccountId ?? null,
        sub2AccountCandidates
      }),
      actionHint: totalCodexResources > 0
        ? "Open an existing production Codex shared resource, bind a Sub2 account and active credential, test it, then switch it online."
        : "Create a production Codex shared resource, bind a Sub2 account and active OpenAI credential, test it, then switch it online.",
      message: totalCodexResources > 0
        ? `${totalCodexResources} production Codex shared resource(s) exist, but none are online.`
        : "No production Codex shared resource exists for OpenAI/Codex rental delivery."
    });
  }
  if (onlineCodexResources > 0 && readyOnlineCodexResources === 0) {
    issues.push({
      id: "resource:codex-ready-missing",
      type: "codex_ready_resource_missing",
      severity: "warning",
      resourceId: incompleteOnlineCodexSample?.id,
      ...supplierResourceMissingCodexIssueFields({
        supplierEmail: incompleteOnlineCodexSample?.supplier.user.email ?? supplierEmailCandidate,
        resourceStatus: incompleteOnlineCodexSample?.status ?? "online",
        resourceType: "codex",
        sub2AccountId: incompleteOnlineCodexSample?.sub2AccountId ?? null,
        sub2AccountCandidates
      }),
      actionHint: "Open an online Codex resource, bind its Sub2 account and active OpenAI refresh token credential, apply it to Sub2, then rerun smoke.",
      message: `${onlineCodexResources} production Codex shared resource(s) are marked online, but none have both a Sub2 account id and an active OpenAI refresh token credential.`
    });
  } else if (incompleteOnlineCodexResources > 0) {
    issues.push({
      id: "resource:codex-online-incomplete",
      type: "codex_online_resource_incomplete",
      severity: "warning",
      resourceId: incompleteOnlineCodexSample?.id,
      ...supplierResourceMissingCodexIssueFields({
        supplierEmail: incompleteOnlineCodexSample?.supplier.user.email ?? null,
        resourceStatus: incompleteOnlineCodexSample?.status ?? "online",
        resourceType: "codex",
        sub2AccountId: incompleteOnlineCodexSample?.sub2AccountId ?? null,
        sub2AccountCandidates
      }),
      actionHint: "Open the incomplete online Codex resource, bind a Sub2 account and active OpenAI refresh token credential, apply it to Sub2, then retest it.",
      message: `${incompleteOnlineCodexResources} online production Codex resource(s) are missing a Sub2 account id or active OpenAI refresh token credential.`
    });
  }

  const status: SystemHealthStatus = issues.length > 0 ? "warning" : "ok";
  const summary = abnormalResources > 0 && readyOnlineCodexResources === 0
    ? `${abnormalResources} abnormal production resource(s), and no ready online production Codex shared resource`
    : abnormalResources > 0
      ? `${abnormalResources} abnormal production resource(s)`
      : readyOnlineCodexResources === 0
        ? onlineCodexResources === 0 ? "No online production Codex shared resource" : "No ready online production Codex shared resource"
        : incompleteOnlineCodexResources > 0 ? `${incompleteOnlineCodexResources} online production Codex resource(s) need credential repair` : "Production shared resources are healthy";

  return systemHealthCheck(
    "resources",
    "共享资源",
    status,
    summary,
    supplierResourceAvailabilityMetrics({
      resourcesByStatus,
      totalCodexResources,
      onlineCodexResources,
      readyOnlineCodexResources,
      incompleteOnlineCodexResources,
      ignoredInternalResources,
      issueCount: issues.length,
      resourceSampleCount: resourceSamples.length
    }),
    issues.length > 0 || resourceSamples.length > 0 ? {
      issues,
      samples: resourceSamples.map((resource) => ({
        id: resource.id,
        resourceId: resource.id,
        resourceType: resource.resourceType,
        resourceStatus: resource.status,
        level: resource.level,
        maxConcurrency: resource.maxConcurrency,
        sub2AccountId: resource.sub2AccountId,
        supplierEmail: resource.supplier.user.email,
        credentialType: resource.credential?.credentialType ?? null,
        credentialStatus: resource.credential?.status ?? null,
        lastCheckedAt: resource.lastCheckedAt?.toISOString() ?? null,
        updatedAt: resource.updatedAt.toISOString(),
        message: `${resource.resourceType} resource is ${resource.status}; Sub2 account ${resource.sub2AccountId ?? "-"}; credential ${resource.credential?.credentialType ?? "-"}/${resource.credential?.status ?? "-"}`
      }))
    } : undefined
  );
}

async function inspectProductCatalogReadiness() {
  const where: Prisma.ProductWhereInput = {
    status: "active",
    ...nonSmokeProductWhere()
  };
  const [matched, products, deliveryReadiness] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        resourceType: true,
        billingMode: true,
        prices: {
          where: { status: "active" },
          select: {
            id: true,
            tierCode: true,
            displayName: true,
            fixedPrice: true
          }
        }
      },
      orderBy: { updatedAt: "desc" },
      take: systemHealthProductCatalogScanLimit
    }),
    codexDeliveryReadinessSnapshot()
  ]);
  const readyCodexDeliveryResources = deliveryReadiness.readyCodexDeliveryResources;

  const issues: ProductCatalogIssue[] = [];
  const counters = {
    productsWithoutActivePrices: 0,
    productsWithoutPurchasablePrices: 0,
    activePricesWithoutFixedPrice: 0,
    readyCodexDeliveryResources,
    emptyActiveProductCatalog: 0,
    codexProductsWithoutReadyDeliveryResources: 0,
    codexProductsBlockedByProxySmoke: 0
  };
  let warnings = 0;

  const addIssue = (issue: Omit<ProductCatalogIssue, "id" | "severity">) => {
    warnings += 1;
    if (issues.length >= systemHealthProductCatalogIssueLimit) return;
    issues.push({
      id: `${issue.type}:${issue.productId ?? "catalog"}:${issue.priceId ?? "catalog"}`,
      severity: "warning",
      ...issue
    });
  };

  if (matched === 0) {
    counters.emptyActiveProductCatalog = 1;
    addIssue(emptyProductCatalogIssue());
  }

  for (const product of products) {
    if (product.prices.length === 0) {
      counters.productsWithoutActivePrices += 1;
      counters.productsWithoutPurchasablePrices += 1;
      addIssue({
        type: "active_product_without_active_price",
        productId: product.id,
        productName: product.name,
        message: `Active product ${product.name} has no active price and will not be purchasable.`
      });
      continue;
    }

    const purchasablePrices = product.prices.filter((price) => product.billingMode === "pay_as_you_go" || price.fixedPrice !== null);
    if (purchasablePrices.length === 0) {
      counters.productsWithoutPurchasablePrices += 1;
      addIssue({
        type: "active_product_without_purchasable_price",
        productId: product.id,
        productName: product.name,
        message: `Active product ${product.name} has active prices but no fixed price supported by direct purchase.`
      });
    }
    const deliveryReadinessIssue = codexCatalogDeliveryReadinessIssueFields({
      productId: product.id,
      productName: product.name,
      priceId: purchasablePrices[0]?.id,
      resourceType: product.resourceType,
      readyCodexDeliveryResources,
      codexProxySmokeDeliveryReadiness: deliveryReadiness.codexProxySmokeDeliveryReadiness
    });
    if (purchasablePrices.length > 0 && deliveryReadinessIssue) {
      if (deliveryReadinessIssue.type === "active_codex_product_without_ready_delivery_resource") {
        counters.codexProductsWithoutReadyDeliveryResources += 1;
      }
      if (deliveryReadinessIssue.type === "active_codex_product_proxy_smoke_failed") {
        counters.codexProductsBlockedByProxySmoke += 1;
      }
      addIssue(deliveryReadinessIssue);
    }

    for (const price of product.prices) {
      if (product.billingMode === "pay_as_you_go") continue;
      if (price.fixedPrice === null) {
        counters.activePricesWithoutFixedPrice += 1;
        addIssue({
          type: "active_price_without_fixed_price",
          productId: product.id,
          productName: product.name,
          priceId: price.id,
          message: `Active price ${price.displayName} (${price.tierCode}) has no fixedPrice and is hidden from the public catalog.`
        });
      }
    }
  }

  return {
    ok: warnings === 0,
    warnings,
    summary: {
      matched,
      scanned: products.length,
      truncated: matched > products.length,
      returnedIssues: issues.length,
      ...counters
    },
    issues
  };
}

export function emptyProductCatalogIssue(): Omit<ProductCatalogIssue, "id" | "severity"> {
  return {
    type: "empty_active_product_catalog",
    productId: null,
    productName: null,
    priceId: null,
    actionHint: "Create or activate at least one purchasable product before treating the storefront as sellable.",
    message: "No active public product exists, so buyers cannot purchase access from the catalog."
  };
}

async function readyCodexDeliveryResourceCount() {
  return prisma.supplierResource.count({ where: readyCodexSupplierResourceDeliveryWhere() });
}

type CodexDeliveryReadinessSnapshot = {
  readyCodexDeliveryResources: number;
  codexProxySmokeDeliveryReadiness: Awaited<ReturnType<typeof inspectLatestCodexProxySmokeDeliveryReadiness>>;
};

async function codexDeliveryReadinessSnapshot(): Promise<CodexDeliveryReadinessSnapshot> {
  const [readyCodexDeliveryResources, codexProxySmokeDeliveryReadiness] = await Promise.all([
    readyCodexDeliveryResourceCount(),
    inspectLatestCodexProxySmokeDeliveryReadiness("codex")
  ]);
  return { readyCodexDeliveryResources, codexProxySmokeDeliveryReadiness };
}

function productWithDeliveryReadiness<T extends { resourceType: string }>(product: T, readiness: CodexDeliveryReadinessSnapshot) {
  return {
    ...product,
    ...publicProductDeliveryReadinessFields({
      resourceType: product.resourceType,
      readyCodexDeliveryResources: readiness.readyCodexDeliveryResources,
      codexProxySmokeDeliveryReadiness: readiness.codexProxySmokeDeliveryReadiness
    })
  };
}

async function enforceCodexProductActivationReadiness(input: {
  productId?: string;
  productName?: string;
  resourceType: string;
  productStatus: string;
  allowUnavailableDelivery?: boolean;
}) {
  const deliveryReadiness = await codexDeliveryReadinessSnapshot();
  if (!shouldBlockUnavailableCodexProductActivation({
    resourceType: input.resourceType,
    productStatus: input.productStatus,
    readyCodexDeliveryResources: deliveryReadiness.readyCodexDeliveryResources,
    allowUnavailableDelivery: input.allowUnavailableDelivery
  })) {
    if (
      input.resourceType !== "codex"
      || input.productStatus !== "active"
      || input.allowUnavailableDelivery === true
      || deliveryReadiness.codexProxySmokeDeliveryReadiness.ok
    ) return;

    throw new AppError(
      "codex_proxy_smoke_failed_for_product_activation",
      "Cannot activate a Codex product while the latest local OpenAI/Codex proxy smoke test is failing",
      409,
      {
        ...codexDeliveryResourceMissingDetails(input.resourceType),
        productId: input.productId ?? null,
        productName: input.productName ?? null,
        productStatus: input.productStatus,
        readyCodexDeliveryResources: deliveryReadiness.readyCodexDeliveryResources,
        proxySmoke: deliveryReadiness.codexProxySmokeDeliveryReadiness,
        allowUnavailableDelivery: true
      }
    );
  }

  throw new AppError(
    "codex_resource_not_ready_for_product_activation",
    "Cannot activate a Codex product until a ready online production Codex shared resource is available",
    409,
    {
      ...codexDeliveryResourceMissingDetails(input.resourceType),
      productId: input.productId ?? null,
      productName: input.productName ?? null,
      productStatus: input.productStatus,
      readyCodexDeliveryResources: deliveryReadiness.readyCodexDeliveryResources,
      allowUnavailableDelivery: true
    }
  );
}

async function enforceCodexPriceActivationReadiness(input: {
  productId: string;
  productName?: string;
  priceId?: string;
  resourceType: string;
  productStatus: string;
  billingMode: string;
  priceStatus: string;
  fixedPrice: unknown;
  allowUnavailableDelivery?: boolean;
}) {
  const deliveryReadiness = await codexDeliveryReadinessSnapshot();
  if (!shouldBlockUnavailableCodexPriceActivation({
    resourceType: input.resourceType,
    productStatus: input.productStatus,
    priceStatus: input.priceStatus,
    billingMode: input.billingMode,
    fixedPrice: input.fixedPrice,
    readyCodexDeliveryResources: deliveryReadiness.readyCodexDeliveryResources,
    allowUnavailableDelivery: input.allowUnavailableDelivery
  })) {
    if (
      input.resourceType !== "codex"
      || input.productStatus !== "active"
      || input.priceStatus !== "active"
      || input.allowUnavailableDelivery === true
      || !isPurchasableProductPrice({ billingMode: input.billingMode, fixedPrice: input.fixedPrice })
      || deliveryReadiness.codexProxySmokeDeliveryReadiness.ok
    ) return;

    throw new AppError(
      "codex_proxy_smoke_failed_for_price_activation",
      "Cannot activate a purchasable Codex price while the latest local OpenAI/Codex proxy smoke test is failing",
      409,
      {
        ...codexDeliveryResourceMissingDetails(input.resourceType),
        productId: input.productId,
        productName: input.productName ?? null,
        priceId: input.priceId ?? null,
        productStatus: input.productStatus,
        priceStatus: input.priceStatus,
        billingMode: input.billingMode,
        readyCodexDeliveryResources: deliveryReadiness.readyCodexDeliveryResources,
        proxySmoke: deliveryReadiness.codexProxySmokeDeliveryReadiness,
        allowUnavailableDelivery: true
      }
    );
  }

  throw new AppError(
    "codex_resource_not_ready_for_price_activation",
    "Cannot activate a purchasable Codex price until a ready online production Codex shared resource is available",
    409,
    {
      ...codexDeliveryResourceMissingDetails(input.resourceType),
      productId: input.productId,
      productName: input.productName ?? null,
      priceId: input.priceId ?? null,
      productStatus: input.productStatus,
      priceStatus: input.priceStatus,
      billingMode: input.billingMode,
      readyCodexDeliveryResources: deliveryReadiness.readyCodexDeliveryResources,
      allowUnavailableDelivery: true
    }
  );
}

function validateProductPricePurchaseMode(billingMode: (typeof billingModes)[number], fixedPrice: number | null | undefined) {
  if (fixedPrice == null && billingMode !== "pay_as_you_go") {
    throw new AppError("fixed_price_required", "Only pay-as-you-go products can use a price without fixedPrice");
  }
}

function aggregateHealthStatus(checks: SystemHealthCheck[]): SystemHealthStatus {
  if (checks.some((check) => check.status === "error")) return "error";
  if (checks.some((check) => check.status === "warning")) return "warning";
  return "ok";
}

async function inspectOpenAiProxyApiKeys(checkedAt: Date) {
  const openAiProxyKeyWhere: Prisma.ApiKeyWhereInput = {
    status: "active",
    user: nonSmokeUserWhere(),
    OR: [
      { rentalId: null },
      { rental: { resourceType: "codex" } },
      { rental: { product: { resourceType: "codex" } } }
    ]
  };
  const [total, apiKeys] = await Promise.all([
    prisma.apiKey.count({ where: openAiProxyKeyWhere }),
    prisma.apiKey.findMany({
      where: openAiProxyKeyWhere,
      include: {
        user: { include: { wallet: true } },
        rental: { include: { product: true } }
      },
      orderBy: { createdAt: "desc" },
      take: systemHealthApiKeyScanLimit
    })
  ]);
  const minimumBalance = new Prisma.Decimal(env.OPENAI_PROXY_MIN_WALLET_BALANCE);
  const issues: ApiKeyReadinessIssue[] = [];
  const counters = {
    inactiveUsers: 0,
    insufficientWallets: 0,
    missingRentals: 0,
    inactiveRentals: 0,
    expiredRentals: 0,
    missingSub2KeyIds: 0,
    missingSub2KeyHashes: 0,
    keyRentalMismatches: 0
  };

  const pushIssue = (
    apiKey: (typeof apiKeys)[number],
    type: keyof typeof counters,
    severity: ApiKeyReadinessIssue["severity"],
    message: string
  ) => {
    counters[type] += 1;
    if (issues.length >= systemHealthApiKeyIssueLimit) return;
    issues.push({
      id: `${type}:${apiKey.id}`,
      type,
      severity,
      apiKeyId: apiKey.id,
      rentalId: apiKey.rentalId,
      userId: apiKey.userId,
      keyPrefix: apiKey.keyPrefix,
      message
    });
  };

  for (const apiKey of apiKeys) {
    if (apiKey.user.status !== "active") {
      pushIssue(apiKey, "inactiveUsers", "error", `API key ${apiKey.id} belongs to non-active user ${apiKey.userId}.`);
    }
    if (!apiKey.user.wallet || apiKey.user.wallet.availableBalance.lte(minimumBalance)) {
      pushIssue(apiKey, "insufficientWallets", "warning", `API key ${apiKey.id} user wallet cannot pass OpenAI proxy balance gate.`);
    }
    if (!apiKey.rental) {
      pushIssue(apiKey, "missingRentals", "error", `API key ${apiKey.id} is active but has no linked rental.`);
      continue;
    }
    if (apiKey.rental.status !== "active") {
      pushIssue(apiKey, "inactiveRentals", "error", `API key ${apiKey.id} is active but rental ${apiKey.rental.id} is ${apiKey.rental.status}.`);
    }
    if (apiKey.rental.endsAt && apiKey.rental.endsAt.getTime() <= checkedAt.getTime()) {
      pushIssue(apiKey, "expiredRentals", "error", `API key ${apiKey.id} rental ${apiKey.rental.id} is expired.`);
    }
    if (!apiKey.rental.sub2KeyId) {
      pushIssue(apiKey, "missingSub2KeyIds", "warning", `API key ${apiKey.id} rental ${apiKey.rental.id} has no Sub2 key id.`);
    }
    if (!apiKey.rental.sub2KeyHash) {
      pushIssue(apiKey, "missingSub2KeyHashes", "warning", `API key ${apiKey.id} rental ${apiKey.rental.id} has no Sub2 key hash.`);
    } else if (apiKey.rental.sub2KeyHash !== apiKey.keyHash) {
      pushIssue(apiKey, "keyRentalMismatches", "error", `API key ${apiKey.id} hash does not match rental ${apiKey.rental.id}.`);
    }
  }

  const errors = counters.inactiveUsers
    + counters.missingRentals
    + counters.inactiveRentals
    + counters.expiredRentals
    + counters.keyRentalMismatches;
  const warnings = counters.insufficientWallets
    + counters.missingSub2KeyIds
    + counters.missingSub2KeyHashes;
  const totalIssues = errors + warnings;

  return {
    ok: totalIssues === 0,
    totalIssues,
    errors,
    warnings,
    issues,
    summary: {
      activeOpenAiProxyApiKeys: total,
      scanned: apiKeys.length,
      scanLimit: systemHealthApiKeyScanLimit,
      truncated: total > apiKeys.length,
      issueSamples: issues.length,
      ...counters
    }
  };
}

async function deactivateInvalidProxyApiKeys(input: { limit: number }) {
  const checkedAt = new Date();
  const openAiProxyKeyWhere: Prisma.ApiKeyWhereInput = {
    status: "active",
    user: nonSmokeUserWhere(),
    OR: [
      { rentalId: null },
      { rental: { resourceType: "codex" } },
      { rental: { product: { resourceType: "codex" } } }
    ]
  };
  const [matched, apiKeys] = await Promise.all([
    prisma.apiKey.count({ where: openAiProxyKeyWhere }),
    prisma.apiKey.findMany({
      where: openAiProxyKeyWhere,
      include: { rental: { include: { product: true } } },
      orderBy: { createdAt: "desc" },
      take: input.limit
    })
  ]);
  const invalidIds = new Set<string>();
  const counters = {
    missingRentals: 0,
    inactiveRentals: 0,
    expiredRentals: 0,
    keyRentalMismatches: 0
  };

  for (const apiKey of apiKeys) {
    if (!apiKey.rental) {
      counters.missingRentals += 1;
      invalidIds.add(apiKey.id);
      continue;
    }
    if (apiKey.rental.status !== "active") {
      counters.inactiveRentals += 1;
      invalidIds.add(apiKey.id);
    }
    if (apiKey.rental.endsAt && apiKey.rental.endsAt.getTime() <= checkedAt.getTime()) {
      counters.expiredRentals += 1;
      invalidIds.add(apiKey.id);
    }
    if (apiKey.rental.sub2KeyHash && apiKey.rental.sub2KeyHash !== apiKey.keyHash) {
      counters.keyRentalMismatches += 1;
      invalidIds.add(apiKey.id);
    }
  }

  const apiKeyIds = Array.from(invalidIds);
  const update = apiKeyIds.length
    ? await prisma.apiKey.updateMany({
      where: { id: { in: apiKeyIds }, status: "active" },
      data: { status: "inactive" }
    })
    : { count: 0 };

  return {
    matched,
    scanned: apiKeys.length,
    deactivated: update.count,
    truncated: matched > apiKeys.length,
    limit: input.limit,
    sampleApiKeyIds: apiKeyIds.slice(0, 20),
    ...counters
  };
}

async function fetchSub2HealthStatus() {
  try {
    const status = await sub2Client.fetchGatewayStatus();
    const openAiAccounts = status.accounts.filter(
      (account) => account.platform === "openai" && (!status.defaultGroupId || account.groupIds.includes(status.defaultGroupId))
    );
    const activeOpenAiAccounts = openAiAccounts.filter((account) => account.status === "active");
    const base = {
      gatewayReachable: status.gatewayReachable,
      ready: status.ready,
      blockingReasons: status.blockingReasons,
      defaultGroupId: status.defaultGroupId ?? null,
      openAiGroupName: status.openAiGroup?.name ?? null,
      openAiGroupStatus: status.openAiGroup?.status ?? null,
      accountCount: status.accounts.length,
      openAiAccountCount: openAiAccounts.length,
      activeOpenAiAccountCount: activeOpenAiAccounts.length,
      accountSamples: sub2AccountHealthSamples(openAiAccounts),
      error: null as string | null
    };
    return {
      ...base,
      issues: buildSub2UpstreamIssues(base)
    };
  } catch (error) {
    const base = {
      gatewayReachable: false,
      ready: false,
      blockingReasons: ["sub2_status_query_failed"],
      defaultGroupId: null,
      openAiGroupName: null,
      openAiGroupStatus: null,
      accountCount: 0,
      openAiAccountCount: 0,
      activeOpenAiAccountCount: 0,
      accountSamples: [] as ReturnType<typeof sub2AccountHealthSamples>,
      error: redactSensitiveText(error instanceof Error ? error.message : String(error))
    };
    return {
      ...base,
      issues: buildSub2UpstreamIssues(base)
    };
  }
}

async function inspectLocalProxySmokeEvidence(checkedAt: Date) {
  const [directSmokeLogs, credentialApplyLogs, refreshTokenApplyLogs] = await Promise.all([
    prisma.auditLog.findMany({
      where: { action: "admin.sub2.proxy_smoke_test" },
      select: localProxySmokeAuditSelect,
      orderBy: { createdAt: "desc" },
      take: 1
    }),
    prisma.auditLog.findMany({
      where: { action: "admin.resource.credential_apply_sub2" },
      select: localProxySmokeAuditSelect,
      orderBy: { createdAt: "desc" },
      take: systemHealthLocalSmokeCredentialAuditScanLimit
    }),
    prisma.auditLog.findMany({
      where: { action: "admin.sub2.account.apply_openai_refresh_token" },
      select: localProxySmokeAuditSelect,
      orderBy: { createdAt: "desc" },
      take: systemHealthLocalSmokeCredentialAuditScanLimit
    })
  ]);
  const checkedAuditLogs = directSmokeLogs.length + credentialApplyLogs.length + refreshTokenApplyLogs.length;
  const candidates = localProxySmokeEvidenceCandidates([...directSmokeLogs, ...credentialApplyLogs, ...refreshTokenApplyLogs]);
  const latest = candidates[0];
  const issues: LocalProxySmokeEvidenceIssue[] = [];

  if (!latest) {
    issues.push({
      id: "local_proxy_smoke:missing",
      type: "local_proxy_smoke_missing",
      severity: "warning",
      ageMinutes: null,
      stale: null,
      staleThresholdMinutes: Math.floor(systemHealthLocalSmokeFreshMs / 60_000),
      freshMinutesRemaining: null,
      staleAt: null,
      message: "No local OpenAI/Codex end-to-end smoke test evidence was found in recent audit logs.",
      actionHint: "Run the Sub2 proxy end-to-end smoke test from the admin proxy status page."
    });
    return {
      ok: false,
      status: "warning" as const,
      summary: {
        hasEvidence: false,
        latestAuditLogId: null,
        latestAction: null,
        latestAt: null,
        ageMinutes: null,
        stale: null,
        staleThresholdMinutes: Math.floor(systemHealthLocalSmokeFreshMs / 60_000),
        freshMinutesRemaining: null,
        staleAt: null,
        ok: false,
        model: null,
        modelsOk: null,
        modelsStatusCode: null,
        modelsError: null,
        responsesOk: null,
        responsesStatusCode: null,
        responsesErrorType: null,
        responsesErrorMessage: null,
        localProxyOk: null,
        keyDisabled: null,
        smokeTestSkippedReason: null,
        proxyRequestLogCount: null,
        checkedAuditLogs,
        evidenceCandidates: 0,
        freshnessHours: systemHealthLocalSmokeFreshMs / 60 / 60 / 1000
      },
      latest: null,
      issues
    };
  }

  const ageMs = Math.max(0, checkedAt.getTime() - latest.createdAt.getTime());
  const ageMinutes = Math.floor(ageMs / 60_000);
  const stale = ageMs > systemHealthLocalSmokeFreshMs;
  const staleThresholdMinutes = Math.floor(systemHealthLocalSmokeFreshMs / 60_000);
  const freshMinutesRemaining = Math.max(0, staleThresholdMinutes - ageMinutes);
  const staleAt = new Date(latest.createdAt.getTime() + systemHealthLocalSmokeFreshMs).toISOString();
  if (!latest.ok) {
    issues.push(localProxySmokeEvidenceIssue(
      latest,
      "local_proxy_smoke_failed",
      "error",
      ageMinutes,
      localProxySmokeFailureIssueMessage(latest, ageMinutes, stale),
      localProxySmokeFailureIssueActionHint(stale),
      stale,
      staleThresholdMinutes,
      freshMinutesRemaining,
      staleAt
    ));
  } else if (stale) {
    issues.push(localProxySmokeEvidenceIssue(
      latest,
      "local_proxy_smoke_stale",
      "warning",
      ageMinutes,
      `Latest local OpenAI/Codex smoke test passed but is ${ageMinutes} minutes old.`,
      "Rerun the smoke test to refresh live /v1/responses evidence.",
      true,
      staleThresholdMinutes,
      freshMinutesRemaining,
      staleAt
    ));
  }

  return {
    ok: latest.ok && !stale,
    status: latest.ok ? stale ? "warning" as const : "ok" as const : "error" as const,
    summary: {
      hasEvidence: true,
      latestAuditLogId: latest.auditLogId,
      latestAction: latest.action,
      latestAt: latest.createdAt.toISOString(),
      ageMinutes,
      stale,
      ok: latest.ok,
      model: latest.model ?? null,
      modelsOk: latest.modelsOk,
      modelsStatusCode: latest.modelsStatusCode,
      modelsError: latest.modelsError,
      responsesOk: latest.responsesOk,
      responsesStatusCode: latest.responsesStatusCode,
      responsesErrorType: latest.responsesErrorType,
      responsesErrorMessage: latest.responsesErrorMessage,
      localProxyOk: latest.localProxyOk,
      keyDisabled: latest.keyDisabled,
      smokeTestSkippedReason: latest.smokeTestSkippedReason,
      proxyRequestLogCount: latest.proxyRequestLogCount,
      checkedAuditLogs,
      evidenceCandidates: candidates.length,
      freshnessHours: systemHealthLocalSmokeFreshMs / 60 / 60 / 1000,
      staleThresholdMinutes,
      freshMinutesRemaining,
      staleAt
    },
    latest: localProxySmokeEvidenceSummary(latest, ageMinutes, stale, staleThresholdMinutes, freshMinutesRemaining, staleAt),
    issues
  };
}

function localProxySmokeEvidenceHealthCheck(result: Awaited<ReturnType<typeof inspectLocalProxySmokeEvidence>>) {
  return systemHealthCheck(
    "localProxySmoke",
    "本地反代自检",
    result.status,
    result.latest
      ? result.ok ? `最近自检通过：${result.latest.model ?? "-"} / ${result.latest.ageMinutes} 分钟前` : result.issues[0]?.message ?? "最近本地反代自检需要复查"
      : "尚未发现本地 OpenAI/Codex 端到端自检证据",
    result.summary,
    {
      latest: result.latest,
      issues: result.issues
    }
  );
}

const localProxySmokeAuditSelect = {
  id: true,
  action: true,
  objectId: true,
  after: true,
  createdAt: true
} satisfies Prisma.AuditLogSelect;

function billingSyncHealthCheck(
  sync: Awaited<ReturnType<typeof getSub2UsageSyncState>>,
  checkedAt: Date
) {
  const state = sync.state;
  if (!state) {
    return systemHealthCheck("billingSync", "用量同步", "warning", "尚未发现 Sub2 usage 同步状态", {
      runs: sync.runs.length
    });
  }

  const lastFinishedAt = state.lastFinishedAt?.getTime() ?? 0;
  const stale = lastFinishedAt === 0 || checkedAt.getTime() - lastFinishedAt > systemHealthBillingSyncStaleMs;
  const failed = state.lastStatus === "failed";
  return systemHealthCheck(
    "billingSync",
    "用量同步",
    failed ? "error" : stale ? "warning" : "ok",
    failed
      ? `最近同步失败：${state.lastError ?? "unknown"}`
      : stale ? "Sub2 usage 最近同步时间超过 24 小时" : "Sub2 usage 同步状态正常",
    {
      lastStatus: state.lastStatus ?? null,
      lastImported: state.lastImported,
      lastRecovered: state.lastRecovered,
      lastSkipped: state.lastSkipped,
      lastUnmatched: state.lastUnmatched,
      lastFinishedAt: state.lastFinishedAt?.toISOString() ?? null,
      runs: sync.runs.length
    }
  );
}

function authTokenConfigHealthCheck() {
  const result = inspectAuthTokenConfig({
    nodeEnv: env.NODE_ENV,
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN
  });

  return systemHealthCheck(
    "authTokens",
    "Auth Tokens",
    result.ok ? "ok" : result.issues.some((issue) => issue.severity === "error") ? "error" : "warning",
    result.ok ? "Authentication token configuration is production-ready" : `${result.issues.length} authentication token configuration issue(s)`,
    result.summary,
    result.issues.length > 0 ? { issues: result.issues } : undefined
  );
}

async function inspectResourceCredentialReadiness(sub2Status: Awaited<ReturnType<typeof fetchSub2HealthStatus>>) {
  const configured = Boolean(env.API_KEY_ENCRYPTION_SECRET);
  const codexResourceWhere: Prisma.SupplierResourceWhereInput = {
    resourceType: "codex",
    ...nonSmokeSupplierResourceWhere()
  };
  const openAiRefreshTokenWhere: Prisma.SupplierResourceCredentialWhereInput = {
    credentialType: "openai_refresh_token",
    supplierResource: codexResourceWhere
  };
  const activeOpenAiRefreshTokenWhere: Prisma.SupplierResourceCredentialWhereInput = {
    ...openAiRefreshTokenWhere,
    status: "active"
  };
  const activeApplicableWhere: Prisma.SupplierResourceCredentialWhereInput = {
    ...activeOpenAiRefreshTokenWhere,
    supplierResource: {
      ...codexResourceWhere,
      sub2AccountId: { not: null }
    }
  };
  const upstreamNoActiveAccounts = sub2Status.blockingReasons.includes("openai_group_has_no_active_accounts");
  const [
    totalCredentials,
    activeOpenAiRefreshTokens,
    activeApplicableCredentials,
    activeMissingSub2Account,
    inactiveOpenAiRefreshTokens,
    samples,
    missingAccountSamples
  ] = await Promise.all([
    prisma.supplierResourceCredential.count({
      where: { supplierResource: codexResourceWhere }
    }),
    prisma.supplierResourceCredential.count({ where: activeOpenAiRefreshTokenWhere }),
    prisma.supplierResourceCredential.count({ where: activeApplicableWhere }),
    prisma.supplierResourceCredential.count({
      where: {
        ...activeOpenAiRefreshTokenWhere,
        supplierResource: {
          ...codexResourceWhere,
          sub2AccountId: null
        }
      }
    }),
    prisma.supplierResourceCredential.count({
      where: {
        ...openAiRefreshTokenWhere,
        status: { not: "active" }
      }
    }),
    prisma.supplierResourceCredential.findMany({
      where: activeApplicableWhere,
      select: {
        ...resourceCredentialSummarySelect,
        supplierResource: {
          select: {
            id: true,
            status: true,
            sub2AccountId: true,
            supplier: {
              select: {
                user: { select: { email: true } }
              }
            }
          }
        }
      },
      orderBy: { lastRotatedAt: "desc" },
      take: 10
    }),
    prisma.supplierResourceCredential.findMany({
      where: {
        ...activeOpenAiRefreshTokenWhere,
        supplierResource: {
          ...codexResourceWhere,
          sub2AccountId: null
        }
      },
      select: {
        ...resourceCredentialSummarySelect,
        supplierResource: {
          select: {
            id: true,
            status: true,
            sub2AccountId: true,
            supplier: {
              select: {
                user: { select: { email: true } }
              }
            }
          }
        }
      },
      orderBy: { lastRotatedAt: "desc" },
      take: 10
    })
  ]);

  const issues: ResourceCredentialReadinessIssue[] = [];
  const firstApplicableResourceId = samples[0]?.supplierResource.id;
  const firstMissingSub2AccountResourceId = missingAccountSamples[0]?.supplierResource.id;
  const sub2AccountRepairFields = resourceCredentialRepairCandidateFields(sub2Status.accountSamples);
  const sub2AccountRepairSamples = resourceCredentialSub2AccountRepairSamples(sub2Status.accountSamples);
  if (!configured) {
    issues.push({
      id: "resource-credential-encryption-secret-missing",
      type: "api_key_encryption_secret_missing",
      severity: env.NODE_ENV === "production" ? "error" : "warning",
      refId: "API_KEY_ENCRYPTION_SECRET",
      actionHint: "Configure API_KEY_ENCRYPTION_SECRET before saving or applying OpenAI refresh token credentials.",
      message: "API_KEY_ENCRYPTION_SECRET must be configured before storing or applying supplier resource credentials"
    });
  }
  if (activeMissingSub2Account > 0) {
    issues.push({
      id: "openai-refresh-token-sub2-account-missing",
      type: "openai_refresh_token_sub2_account_missing",
      severity: upstreamNoActiveAccounts ? "error" : "warning",
      resourceId: firstMissingSub2AccountResourceId,
      sub2Status: true,
      actionHint: "Open the resource, bind its Sub2 account id, then apply the stored credential to Sub2.",
      message: `${activeMissingSub2Account} active OpenAI refresh token credential(s) are missing a Sub2 account id`
    });
  }
  if (upstreamNoActiveAccounts && activeApplicableCredentials === 0) {
    issues.push({
      id: "openai-refresh-token-candidate-missing",
      type: "openai_refresh_token_candidate_missing",
      severity: "error",
      sub2Status: true,
      ...resourceCredentialCodexResourceListFields(),
      ...sub2AccountRepairFields,
      actionHint: "Create or update a Codex shared resource with an active OpenAI refresh token and a Sub2 account id, or paste a valid token on the Sub2 status page.",
      message: "Sub2 reports no active OpenAI upstream accounts and no active resource credential can be applied"
    });
  } else if (upstreamNoActiveAccounts && activeApplicableCredentials > 0) {
    issues.push({
      id: "openai-refresh-token-apply-needed",
      type: "openai_refresh_token_apply_needed",
      severity: "warning",
      resourceId: firstApplicableResourceId,
      sub2Status: true,
      actionHint: "Open the resource and apply its credential to Sub2, or use the Sub2 status page to apply a fresh token directly.",
      message: `${activeApplicableCredentials} active OpenAI refresh token credential candidate(s) can be applied to Sub2`
    });
  }

  const status = issues.some((issue) => issue.severity === "error")
    ? "error"
    : issues.length > 0 ? "warning" : "ok";
  const summary = !configured
    ? "共享资源凭据加密密钥未配置"
    : upstreamNoActiveAccounts
      ? activeApplicableCredentials > 0
        ? `Sub2 上游无 active 账号，可尝试应用 ${activeApplicableCredentials} 个资源凭据`
        : "Sub2 上游无 active 账号，且没有可应用的资源凭据"
      : activeApplicableCredentials > 0
        ? `资源凭据配置正常，${activeApplicableCredentials} 个可应用候选`
        : "资源凭据配置正常，暂无可应用 OpenAI refresh token";

  return systemHealthCheck(
    "resourceCredentials",
    "资源凭据",
    status,
    summary,
    {
      encryptionSecretConfigured: configured,
      encryptionVersion: "aes-256-gcm:v1",
      totalCredentials,
      activeOpenAiRefreshTokens,
      activeApplicableCredentials,
      activeMissingSub2Account,
      inactiveOpenAiRefreshTokens
    },
    {
      issues,
      samples: [
        ...samples.map((credential) => ({
          sampleType: "applicable",
          id: credential.id,
          credentialType: credential.credentialType,
          keyFingerprint: credential.keyFingerprint,
          status: credential.status,
          lastRotatedAt: credential.lastRotatedAt.toISOString(),
          resourceId: credential.supplierResource.id,
          resourceStatus: credential.supplierResource.status,
          sub2AccountId: credential.supplierResource.sub2AccountId,
          supplierEmail: credential.supplierResource.supplier.user.email
        })),
        ...missingAccountSamples.map((credential) => ({
          sampleType: "missing_sub2_account",
          id: credential.id,
          credentialType: credential.credentialType,
          keyFingerprint: credential.keyFingerprint,
          status: credential.status,
          lastRotatedAt: credential.lastRotatedAt.toISOString(),
          resourceId: credential.supplierResource.id,
          resourceStatus: credential.supplierResource.status,
          sub2AccountId: credential.supplierResource.sub2AccountId,
          supplierEmail: credential.supplierResource.supplier.user.email
        })),
        ...sub2AccountRepairSamples
      ]
    }
  );
}

function billingSyncSchedulerHealthCheck() {
  const intervalMs = env.SUB2_USAGE_SYNC_INTERVAL_MS;
  const enabled = intervalMs > 0;
  const issues: Array<{ id: string; type: string; severity: "warning" | "error"; message: string }> = [];
  let status: SystemHealthStatus = "ok";
  let summary = "Sub2 usage 定时同步已启用";

  if (!enabled) {
    status = env.NODE_ENV === "production" ? "error" : "warning";
    summary = env.NODE_ENV === "production"
      ? "生产环境未启用 Sub2 usage 定时同步"
      : "Sub2 usage 定时同步当前关闭";
    issues.push({
      id: "sub2_usage_scheduler_disabled",
      type: "sub2_usage_scheduler_disabled",
      severity: env.NODE_ENV === "production" ? "error" : "warning",
      message: "SUB2_USAGE_SYNC_INTERVAL_MS=0, usage billing depends on manual admin sync."
    });
  } else if (intervalMs > systemHealthBillingSyncStaleMs) {
    status = "warning";
    summary = "Sub2 usage 定时同步间隔超过 24 小时";
    issues.push({
      id: "sub2_usage_scheduler_interval_too_long",
      type: "sub2_usage_scheduler_interval_too_long",
      severity: "warning",
      message: "SUB2_USAGE_SYNC_INTERVAL_MS is longer than the billing stale threshold."
    });
  }

  if (enabled && !env.SUB2_USAGE_SYNC_ON_START && env.NODE_ENV === "production") {
    if (status === "ok") {
      status = "warning";
      summary = "生产环境启动后不会立即同步 Sub2 usage";
    }
    issues.push({
      id: "sub2_usage_scheduler_no_startup_run",
      type: "sub2_usage_scheduler_no_startup_run",
      severity: "warning",
      message: "SUB2_USAGE_SYNC_ON_START=false, usage billing waits until the first interval after service start."
    });
  }

  return systemHealthCheck(
    "billingSyncScheduler",
    "用量同步调度",
    status,
    summary,
    {
      enabled,
      intervalMs,
      onStart: env.SUB2_USAGE_SYNC_ON_START,
      nodeEnv: env.NODE_ENV,
      staleThresholdMs: systemHealthBillingSyncStaleMs
    },
    issues.length > 0 ? { issues } : undefined
  );
}

function countGroups(groups: Array<Record<string, unknown>>, field: string) {
  const result: Record<string, number> = {};
  for (const group of groups) {
    const key = String(group[field] ?? "unknown");
    result[key] = groupCount(group);
  }
  return result;
}

function totalGroupCount(groups: Array<Record<string, unknown>>) {
  return groups.reduce((sum, group) => sum + groupCount(group), 0);
}

function groupCount(group: Record<string, unknown>) {
  const count = group._count;
  if (typeof count === "number") return count;
  if (count && typeof count === "object" && "_all" in count) {
    return Number((count as { _all?: number })._all ?? 0);
  }
  return 0;
}

function nonSmokeUserWhere(): Prisma.UserWhereInput {
  return { NOT: internalHealthCheckUserWhere() };
}

function internalHealthCheckUserWhere(): Prisma.UserWhereInput {
  return {
    OR: [
      { email: localProxySmokeUserEmail },
      {
        email: {
          startsWith: legacyHealthCheckUserEmailPrefix,
          endsWith: legacyHealthCheckUserEmailDomain
        }
      },
      { email: { endsWith: legacyHealthCheckUserEmailDomain } },
      {
        email: {
          startsWith: legacyE2eUserEmailPrefix,
          endsWith: legacyE2eUserEmailDomain
        }
      }
    ]
  };
}

function nonSmokeOrderWhere(): Prisma.OrderWhereInput {
  return {
    user: nonSmokeUserWhere(),
    items: { none: { product: internalHealthCheckProductWhere() } }
  };
}

function nonSmokeRentalWhere(): Prisma.RentalWhereInput {
  return {
    user: nonSmokeUserWhere(),
    product: { NOT: internalHealthCheckProductWhere() }
  };
}

function nonSmokeWalletWhere(): Prisma.WalletAccountWhereInput {
  return { user: nonSmokeUserWhere() };
}

function nonSmokeWalletTransactionWhere(): Prisma.WalletTransactionWhereInput {
  return { wallet: nonSmokeWalletWhere() };
}

function nonSmokeUsageWhere(): Prisma.UsageRecordWhereInput {
  return { rental: nonSmokeRentalWhere() };
}

function walletManagementStatusWhere(status: (typeof walletManagementStatuses)[number] | undefined): Prisma.WalletAccountWhereInput {
  if (status === "negative") return { availableBalance: { lt: 0 } };
  if (status === "frozen") return { frozenBalance: { gt: 0 } };
  if (status === "available") return { availableBalance: { gt: 0 } };
  if (status === "spent") return { totalSpent: { gt: 0 } };
  return {};
}

function nonSmokeProductWhere(): Prisma.ProductWhereInput {
  return { NOT: internalHealthCheckProductWhere() };
}

function internalHealthCheckProductWhere(): Prisma.ProductWhereInput {
  return {
    OR: [
      { name: localProxySmokeProductName },
      { name: { startsWith: legacyLocalProxySmokeProductPrefix } }
    ]
  };
}

function nonSmokeWithdrawalWhere(): Prisma.WithdrawalWhereInput {
  return {
    NOT: {
      OR: [
        { payoutRef: { startsWith: legacySmokeWithdrawalPayoutRefPrefix } },
        { note: { startsWith: legacySmokeWithdrawalNotePrefix } }
      ]
    }
  };
}

function parseListQuery(raw: unknown): ListQuery {
  const query = listQuerySchema.parse(raw ?? {});
  return {
    ...query,
    q: nonEmpty(query.q),
    status: nonEmpty(query.status),
    resourceType: nonEmpty(query.resourceType),
    action: nonEmpty(query.action)
  };
}

function pageArgs(query: ListQuery) {
  return {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize
  };
}

function paged<T>(items: T[], total: number, query: ListQuery) {
  return {
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize))
  };
}

function containsText(value: string) {
  return { contains: value, mode: Prisma.QueryMode.insensitive };
}

function apiKeyListWhere(input: {
  q?: string;
  status?: (typeof apiKeyStatuses)[number];
  resourceType?: (typeof resourceTypes)[number];
}): Prisma.ApiKeyWhereInput {
  const queryResourceType = oneOf(resourceTypes, input.q);
  return {
    user: nonSmokeUserWhere(),
    ...(input.status ? { status: input.status } : {}),
    ...(input.resourceType ? { rental: { resourceType: input.resourceType } } : {}),
    ...(input.q ? {
      OR: [
        { id: containsText(input.q) },
        { name: containsText(input.q) },
        { keyPrefix: containsText(input.q) },
        { userId: containsText(input.q) },
        { user: { id: containsText(input.q) } },
        { user: { email: containsText(input.q) } },
        { user: { displayName: containsText(input.q) } },
        { rentalId: containsText(input.q) },
        { rental: { id: containsText(input.q) } },
        { rental: { sub2KeyId: containsText(input.q) } },
        { rental: { endpointUrl: containsText(input.q) } },
        { rental: { product: { name: containsText(input.q) } } },
        ...(queryResourceType ? [{ rental: { resourceType: queryResourceType } }] : [])
      ]
    } : {})
  };
}

function oneOf<T extends string>(values: readonly T[], value: string | undefined): T | undefined {
  return value && (values as readonly string[]).includes(value) ? value as T : undefined;
}

function numericStatusCode(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599 ? parsed : undefined;
}

export function proxyRequestStatusWhere(status: string | undefined): Prisma.ProxyRequestLogWhereInput {
  const statusCode = numericStatusCode(status);
  if (statusCode) return { statusCode };

  if (status === "failed") {
    return {
      OR: [
        { statusCode: { gte: 400 } },
        { errorCode: { not: null } }
      ]
    };
  }
  if (status === "client_error") return { statusCode: { gte: 400, lt: 500 } };
  if (status === "server_error") return { statusCode: { gte: 500 } };
  if (status === "upstream_error") {
    return {
      OR: [
        { upstreamStatusCode: { gte: 400 } },
        { errorCode: { startsWith: "upstream_" } }
      ]
    };
  }
  if (status === "local_rejection") return { errorCode: { in: [...proxyClientRejectionErrorCodes] } };
  if (status === "local_availability") return { errorCode: { in: [...proxyLocalAvailabilityErrorCodes] } };
  if (status === "stream_error") return { errorCode: { in: [...proxyStreamErrorCodes] } };
  return {};
}

function nonEmpty(value: string | undefined) {
  return value && value.length > 0 ? value : undefined;
}

interface LocalProxySmokeProvision {
  userId: string;
  productId: string;
  orderId: string;
  rentalId: string;
  apiKeyId: string;
  apiKeyPrefix: string;
}

interface LocalProxyJsonProbe {
  ok: boolean;
  statusCode: number;
  bodyText: string;
  json?: Record<string, any>;
  error?: string | null;
}

async function runLocalOpenAiProxySmokeTest(model = env.SUB2_SMOKE_MODEL): Promise<Sub2ProxySmokeTestResult> {
  const checkedAt = new Date().toISOString();
  const failedModels: Sub2ProxySmokeTestResult["models"] = { ok: false, statusCode: 0, modelCount: 0, firstModel: null, error: "skipped" };
  const failedResponses: Sub2ProxySmokeTestResult["responses"] = { ok: false, statusCode: 0, responseId: null, responseStatus: null, errorType: null, errorMessage: "skipped" };
  let sub2Key: Sub2KeyResult | undefined;
  let local: LocalProxySmokeProvision | undefined;
  let models = failedModels;
  let responses = failedResponses;

  try {
    sub2Key = await sub2Client.createKey({
      buyerId: localProxySmokeBuyerId,
      rentalId: randomUUID(),
      name: `Admin local proxy smoke ${checkedAt}`,
      resourceType: "codex",
      maxConcurrency: 1,
      requestLimit: null,
      spendLimit: null
    });
    local = await provisionLocalProxySmokeRental(sub2Key, checkedAt);
  } catch (error) {
    const cleanup = await cleanupLocalOpenAiProxySmoke(local, sub2Key);
    return {
      ok: false,
      checkedAt,
      model,
      gatewayBaseUrl: env.SUB2_BASE_URL,
      publicEndpoint: openAiProxyPublicEndpoint,
      sub2UserId: sub2Key?.sub2UserId,
      sub2KeyId: sub2Key?.sub2KeyId,
      keyDisabled: cleanup.keyDisabled,
      cleanupError: cleanup.error,
      provisioning: {
        ok: false,
        error: redactSensitiveText(error instanceof Error ? error.message : String(error))
      },
      models: failedModels,
      responses: failedResponses,
      localProxy: {
        ok: false,
        endpoint: openAiProxyPublicEndpoint,
        rentalId: local?.rentalId ?? null,
        apiKeyPrefix: local?.apiKeyPrefix ?? null,
        proxyRequestLogCount: 0,
        proxyRequestLogs: [],
        apiKeyDeactivated: cleanup.apiKeyDeactivated,
        rentalClosed: cleanup.rentalClosed,
        orderClosed: cleanup.orderClosed,
        walletReset: cleanup.walletReset
      }
    };
  }

  const modelsProbe = await fetchLocalProxyJson("/models", sub2Key.apiKey, { method: "GET" }, 30_000);
  const modelItems = Array.isArray(modelsProbe.json?.data) ? modelsProbe.json.data : [];
  models = {
    ok: modelsProbe.ok,
    statusCode: modelsProbe.statusCode,
    modelCount: modelItems.length,
    firstModel: modelItems[0]?.id ? String(modelItems[0].id) : null,
    error: modelsProbe.ok ? null : extractLocalProxyError(modelsProbe)
  };

  const responsesProbe = await fetchLocalProxyJson(
    "/responses",
    sub2Key.apiKey,
    {
      method: "POST",
      body: JSON.stringify({
        model,
        input: "Return exactly OK.",
        max_output_tokens: 8
      })
    },
    90_000
  );
  const responseError = localProxyErrorObject(responsesProbe.json);
  responses = {
    ok: responsesProbe.ok && !responseError,
    statusCode: responsesProbe.statusCode,
    responseId: responsesProbe.json?.id ? String(responsesProbe.json.id) : null,
    responseStatus: responsesProbe.json?.status ? String(responsesProbe.json.status) : null,
    errorType: responseError?.type ? String(responseError.type) : null,
    errorMessage: responseError?.message
      ? redactSensitiveText(String(responseError.message))
      : responsesProbe.ok ? null : extractLocalProxyError(responsesProbe)
  };

  const [proxyRequestLogCount, proxyRequestLogs] = await Promise.all([
    countLocalProxySmokeLogs(local.rentalId),
    listLocalProxySmokeLogs(local.rentalId)
  ]);
  const cleanup = await cleanupLocalOpenAiProxySmoke(local, sub2Key);
  const localProxyOk = models.ok
    && responses.ok
    && proxyRequestLogCount >= 2
    && cleanup.apiKeyDeactivated
    && cleanup.rentalClosed
    && cleanup.orderClosed
    && cleanup.walletReset;

  return {
    ok: localProxyOk && cleanup.keyDisabled,
    checkedAt,
    model,
    gatewayBaseUrl: env.SUB2_BASE_URL,
    publicEndpoint: openAiProxyPublicEndpoint,
    sub2UserId: sub2Key.sub2UserId,
    sub2KeyId: sub2Key.sub2KeyId,
    keyDisabled: cleanup.keyDisabled,
    cleanupError: cleanup.error,
    provisioning: { ok: true },
    models,
    responses,
    localProxy: {
      ok: localProxyOk,
      endpoint: openAiProxyPublicEndpoint,
      rentalId: local.rentalId,
      apiKeyPrefix: local.apiKeyPrefix,
      proxyRequestLogCount,
      proxyRequestLogs,
      apiKeyDeactivated: cleanup.apiKeyDeactivated,
      rentalClosed: cleanup.rentalClosed,
      orderClosed: cleanup.orderClosed,
      walletReset: cleanup.walletReset
    }
  };
}

async function provisionLocalProxySmokeRental(sub2Key: Sub2KeyResult, checkedAt: string): Promise<LocalProxySmokeProvision> {
  const passwordHash = await bcrypt.hash(randomUUID(), 10);
  const keyHash = hashSecret(sub2Key.apiKey);
  const apiKeyPrefix = sub2Key.apiKey.slice(0, 12);
  const smokeMeta = { smokeTest: true, checkedAt };
  const smokeWalletBalance = new Prisma.Decimal(env.OPENAI_PROXY_MIN_WALLET_BALANCE).plus(1);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email: localProxySmokeUserEmail },
      update: {
        displayName: "OpenAI proxy smoke user",
        status: "active"
      },
      create: {
        email: localProxySmokeUserEmail,
        passwordHash,
        displayName: "OpenAI proxy smoke user",
        status: "active"
      }
    });
    await tx.userRole.upsert({
      where: { userId_role: { userId: user.id, role: "buyer" } },
      update: {},
      create: { userId: user.id, role: "buyer" }
    });
    await tx.walletAccount.upsert({
      where: { userId: user.id },
      update: {
        availableBalance: smokeWalletBalance,
        frozenBalance: new Prisma.Decimal(0)
      },
      create: {
        userId: user.id,
        availableBalance: smokeWalletBalance,
        frozenBalance: new Prisma.Decimal(0),
        totalRecharged: new Prisma.Decimal(0),
        totalSpent: new Prisma.Decimal(0)
      }
    });

    let product = await tx.product.findFirst({
      where: { name: localProxySmokeProductName, resourceType: "codex" }
    });
    if (!product) {
      product = await tx.product.create({
        data: {
          name: localProxySmokeProductName,
          resourceType: "codex",
          billingMode: "pay_as_you_go",
          status: "offline",
          description: "Internal product used only for administrator local OpenAI proxy smoke tests."
        }
      });
    }

    const order = await tx.order.create({
      data: {
        userId: user.id,
        status: "active",
        totalAmount: new Prisma.Decimal(0),
        paidAmount: new Prisma.Decimal(0),
        items: {
          create: {
            productId: product.id,
            amount: new Prisma.Decimal(0),
            meta: smokeMeta
          }
        }
      }
    });
    await recordOrderStatusHistory(tx, {
      orderId: order.id,
      fromStatus: null,
      toStatus: "active",
      reason: "admin.local_proxy_smoke.provision",
      meta: smokeMeta
    });

    const rental = await tx.rental.create({
      data: {
        userId: user.id,
        orderId: order.id,
        productId: product.id,
        resourceType: "codex",
        status: "active",
        endsAt: new Date(Date.now() + 30 * 60 * 1000),
        sub2UserId: sub2Key.sub2UserId,
        sub2KeyId: sub2Key.sub2KeyId,
        sub2KeyHash: keyHash,
        endpointUrl: openAiProxyPublicEndpoint,
        limits: {
          create: {
            maxConcurrency: 1,
            requestLimit: 10
          }
        }
      }
    });
    const apiKey = await tx.apiKey.create({
      data: {
        userId: user.id,
        rentalId: rental.id,
        name: localProxySmokeProductName,
        keyPrefix: apiKeyPrefix,
        keyHash
      }
    });
    await tx.sub2Binding.createMany({
      data: [
        {
          objectType: "rental",
          objectId: rental.id,
          sub2Type: "user",
          sub2Id: sub2Key.sub2UserId,
          meta: { ...smokeMeta, rentalId: rental.id }
        },
        {
          objectType: "rental",
          objectId: rental.id,
          sub2Type: "api_key",
          sub2Id: sub2Key.sub2KeyId,
          meta: { ...smokeMeta, rentalId: rental.id }
        }
      ],
      skipDuplicates: true
    });

    return {
      userId: user.id,
      productId: product.id,
      orderId: order.id,
      rentalId: rental.id,
      apiKeyId: apiKey.id,
      apiKeyPrefix
    };
  });
}

async function fetchLocalProxyJson(
  path: string,
  apiKey: string,
  init: RequestInit,
  timeoutMs: number
): Promise<LocalProxyJsonProbe> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${apiKey}`);
    if (init.body) headers.set("content-type", "application/json");

    const response = await fetch(`${openAiProxyPublicEndpoint}${path}`, {
      ...init,
      headers,
      signal: controller.signal
    });
    const rawText = await response.text();
    const bodyText = redactSensitiveText(rawText).slice(0, 3000);
    let json: Record<string, any> | undefined;
    try {
      json = JSON.parse(rawText) as Record<string, any>;
    } catch {
      json = undefined;
    }

    return { ok: response.ok, statusCode: response.status, bodyText, json };
  } catch (error) {
    return {
      ok: false,
      statusCode: 0,
      bodyText: "",
      error: redactSensitiveText(error instanceof Error ? error.message : String(error))
    };
  } finally {
    clearTimeout(timeout);
  }
}

function localProxyErrorObject(json?: Record<string, any>) {
  const error = json?.error;
  if (!error) return undefined;
  if (typeof error === "string") {
    return { message: redactSensitiveText(error), type: null };
  }
  if (typeof error === "object") {
    return error as { message?: string | null; type?: string | null };
  }
  return undefined;
}

function extractLocalProxyError(probe: LocalProxyJsonProbe) {
  const proxyError = localProxyErrorObject(probe.json);
  if (proxyError?.message) return redactSensitiveText(String(proxyError.message));
  const fallback = probe.error ?? probe.bodyText.slice(0, 300);
  return fallback || null;
}

async function countLocalProxySmokeLogs(rentalId: string) {
  try {
    return await prisma.proxyRequestLog.count({ where: { rentalId } });
  } catch {
    return 0;
  }
}

async function listLocalProxySmokeLogs(rentalId: string) {
  try {
    const logs = await prisma.proxyRequestLog.findMany({
      where: { rentalId },
      select: {
        id: true,
        requestId: true,
        path: true,
        model: true,
        statusCode: true,
        upstreamStatusCode: true,
        upstreamRequestId: true,
        errorCode: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" },
      take: 5
    });
    return logs.map((log) => ({
      id: log.id,
      requestId: log.requestId,
      path: log.path,
      model: log.model,
      statusCode: log.statusCode,
      upstreamStatusCode: log.upstreamStatusCode,
      upstreamRequestId: log.upstreamRequestId,
      errorCode: log.errorCode,
      createdAt: log.createdAt.toISOString()
    }));
  } catch {
    return [];
  }
}

async function cleanupLocalOpenAiProxySmoke(local?: LocalProxySmokeProvision, sub2Key?: Sub2KeyResult) {
  const errors: string[] = [];
  let apiKeyDeactivated = false;
  let rentalClosed = false;
  let orderClosed = false;
  let walletReset = false;
  let keyDisabled = false;

  if (local) {
    try {
      const result = await prisma.apiKey.updateMany({
        where: { id: local.apiKeyId },
        data: { status: "inactive" }
      });
      apiKeyDeactivated = result.count === 1;
    } catch (error) {
      errors.push(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    }

    try {
      const result = await prisma.rental.updateMany({
        where: { id: local.rentalId },
        data: { status: "closed", endsAt: new Date() }
      });
      rentalClosed = result.count === 1;
    } catch (error) {
      errors.push(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    }

    try {
      const result = await prisma.order.updateMany({
        where: { id: local.orderId },
        data: { status: "closed" }
      });
      orderClosed = result.count === 1;
    } catch (error) {
      errors.push(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    }

    try {
      const result = await prisma.walletAccount.updateMany({
        where: { userId: local.userId },
        data: {
          availableBalance: new Prisma.Decimal(0),
          frozenBalance: new Prisma.Decimal(0)
        }
      });
      walletReset = result.count === 1;
    } catch (error) {
      errors.push(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    }
  }

  if (sub2Key) {
    try {
      await sub2Client.disableKey(localProxySmokeBuyerId, sub2Key.sub2KeyId);
      keyDisabled = true;
    } catch (error) {
      errors.push(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    }
  }

  return {
    apiKeyDeactivated,
    rentalClosed,
    orderClosed,
    walletReset,
    keyDisabled,
    error: errors.length > 0 ? errors.join("; ") : null
  };
}

async function cleanupStaleLocalProxySmokeData(input: { ageMinutes: number; limit: number }) {
  const checkedAt = new Date();
  const cutoff = new Date(checkedAt.getTime() - input.ageMinutes * 60 * 1000);
  const smokeUsers = await prisma.user.findMany({
    where: internalHealthCheckUserWhere(),
    include: { wallet: true }
  });

  if (smokeUsers.length === 0) {
    return {
      checkedAt: checkedAt.toISOString(),
      cutoff: cutoff.toISOString(),
      smokeUserFound: false,
      usersMatched: 0,
      rentalsMatched: 0,
      rentalsClosed: 0,
      ordersClosed: 0,
      apiKeysDeactivated: 0,
      walletReset: false,
      walletsReset: 0,
      sub2KeysDisableAttempted: 0,
      sub2KeysDisabled: 0,
      sub2DisableFailed: 0,
      sub2DisableSkipped: 0,
      bindingsDeleted: 0,
      errors: [] as string[]
    };
  }

  const smokeUserIds = smokeUsers.map((user) => user.id);
  const staleRentals = await prisma.rental.findMany({
    where: {
      AND: [
        {
          OR: [
            { userId: { in: smokeUserIds } },
            { product: internalHealthCheckProductWhere() }
          ]
        },
        {
          OR: [
            { createdAt: { lte: cutoff } },
            { endsAt: { lte: checkedAt } },
            { apiKeys: { some: { status: { not: "inactive" }, createdAt: { lte: cutoff } } } },
            { order: { status: { not: "closed" }, createdAt: { lte: cutoff } } }
          ]
        }
      ]
    },
    select: {
      id: true,
      userId: true,
      orderId: true,
      sub2UserId: true,
      sub2KeyId: true,
      user: { select: { email: true } }
    },
    orderBy: { createdAt: "asc" },
    take: input.limit
  });

  let rentalsClosed = 0;
  let ordersClosed = 0;
  let apiKeysDeactivated = 0;
  let sub2KeysDisableAttempted = 0;
  let sub2KeysDisabled = 0;
  let sub2DisableFailed = 0;
  let sub2DisableSkipped = 0;
  let bindingsDeleted = 0;
  const errors: string[] = [];

  for (const rental of staleRentals) {
    try {
      const result = await prisma.apiKey.updateMany({
        where: { rentalId: rental.id, status: { not: "inactive" } },
        data: { status: "inactive" }
      });
      apiKeysDeactivated += result.count;
    } catch (error) {
      errors.push(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    }

    try {
      const result = await prisma.rental.updateMany({
        where: { id: rental.id, status: { not: "closed" } },
        data: { status: "closed", endsAt: checkedAt }
      });
      rentalsClosed += result.count;
    } catch (error) {
      errors.push(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    }

    try {
      const result = await prisma.order.updateMany({
        where: { id: rental.orderId, status: { not: "closed" } },
        data: { status: "closed" }
      });
      ordersClosed += result.count;
    } catch (error) {
      errors.push(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    }

    if (rental.sub2KeyId) {
      const sharedActiveRentals = await prisma.rental.count({
        where: {
          id: { not: rental.id },
          sub2KeyId: rental.sub2KeyId,
          status: { in: ["active", "low_balance", "limited", "suspended"] },
          user: nonSmokeUserWhere()
        }
      });
      if (rental.user.email !== localProxySmokeUserEmail || sharedActiveRentals > 0) {
        sub2DisableSkipped += 1;
        continue;
      }
      sub2KeysDisableAttempted += 1;
      try {
        await sub2Client.disableKey(localProxySmokeBuyerId, rental.sub2KeyId);
        sub2KeysDisabled += 1;
      } catch (error) {
        sub2DisableFailed += 1;
        errors.push(redactSensitiveText(error instanceof Error ? error.message : String(error)));
      }
    }
  }

  const staleRentalIds = staleRentals.map((rental) => rental.id);
  if (staleRentalIds.length > 0) {
    try {
      const deleted = await prisma.sub2Binding.deleteMany({
        where: {
          OR: [
            { objectType: "rental", objectId: { in: staleRentalIds } },
            ...staleRentalIds.map((rentalId) => ({
              objectType: "rental_api_key_history",
              objectId: { startsWith: `${rentalId}:` }
            }))
          ]
        }
      });
      bindingsDeleted = deleted.count;
    } catch (error) {
      errors.push(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    }
  }

  const [staleOrders, staleApiKeys] = await Promise.all([
    prisma.order.updateMany({
      where: {
        OR: [
          { userId: { in: smokeUserIds } },
          { items: { some: { product: internalHealthCheckProductWhere() } } }
        ],
        createdAt: { lte: cutoff },
        status: { not: "closed" }
      },
      data: { status: "closed" }
    }),
    prisma.apiKey.updateMany({
      where: {
        OR: [
          { userId: { in: smokeUserIds } },
          { rental: { product: internalHealthCheckProductWhere() } }
        ],
        createdAt: { lte: cutoff },
        status: { not: "inactive" }
      },
      data: { status: "inactive" }
    })
  ]);
  ordersClosed += staleOrders.count;
  apiKeysDeactivated += staleApiKeys.count;

  let walletsReset = 0;
  for (const smokeUser of smokeUsers) {
    const freshActiveRentals = await prisma.rental.count({
      where: {
        userId: smokeUser.id,
        status: "active",
        createdAt: { gt: cutoff }
      }
    });
    if (smokeUser.wallet && freshActiveRentals === 0 && smokeUser.wallet.updatedAt.getTime() <= cutoff.getTime()) {
      const wallet = await prisma.walletAccount.update({
        where: { id: smokeUser.wallet.id },
        data: {
          availableBalance: new Prisma.Decimal(0),
          frozenBalance: new Prisma.Decimal(0)
        }
      });
      if (wallet.availableBalance.eq(0) && wallet.frozenBalance.eq(0)) {
        walletsReset += 1;
      }
    }
  }

  return {
    checkedAt: checkedAt.toISOString(),
    cutoff: cutoff.toISOString(),
    smokeUserFound: true,
    usersMatched: smokeUsers.length,
    rentalsMatched: staleRentals.length,
    rentalsClosed,
    ordersClosed,
    apiKeysDeactivated,
    walletReset: walletsReset > 0,
    walletsReset,
    sub2KeysDisableAttempted,
    sub2KeysDisabled,
    sub2DisableFailed,
    sub2DisableSkipped,
    bindingsDeleted,
    errors
  };
}

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function redactSecrets(data: unknown) {
  return JSON.parse(JSON.stringify(data, (key, value) => redactedFields.has(key) ? undefined : value)) as unknown;
}

async function syncSub2KeyForRental(userId: string | undefined, sub2KeyId: string | null | undefined, active: boolean) {
  if (!userId || !sub2KeyId) {
    return { action: "none", ok: true };
  }
  try {
    if (active) {
      await sub2Client.enableKey(userId, sub2KeyId);
      return { action: "enable", ok: true };
    }
    await sub2Client.disableKey(userId, sub2KeyId);
    return { action: "disable", ok: true };
  } catch (error) {
    return {
      action: active ? "enable" : "disable",
      ok: false,
      error: redactSensitiveText(error instanceof Error ? error.message : String(error))
    };
  }
}

function redactSensitiveText(value: string) {
  return value
    .replace(/(access_token|refresh_token|id_token|token|key|password)\s*[:=]\s*[^,}\s]+/gi, "$1:[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/g, "Bearer [REDACTED]")
    .replace(/(zyz_[A-Za-z0-9]{8})[A-Za-z0-9]+/g, "$1[REDACTED]")
    .replace(/(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, "$1[REDACTED]");
}

function redactError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitiveText(message).slice(0, 500);
}

function resourceConfigAuditPayload(resource: {
  status: string;
  level: string;
  maxConcurrency: number;
  shareRate: Prisma.Decimal | string | number;
  reserveRatio: Prisma.Decimal | string | number;
  dailyCap: Prisma.Decimal | string | number | null;
  sub2AccountId: string | null;
  lastCheckedAt?: Date | string | null;
}) {
  return {
    status: resource.status,
    level: resource.level,
    maxConcurrency: resource.maxConcurrency,
    shareRate: String(resource.shareRate),
    reserveRatio: String(resource.reserveRatio),
    dailyCap: resource.dailyCap === null ? null : String(resource.dailyCap),
    sub2AccountId: resource.sub2AccountId,
    lastCheckedAt: resource.lastCheckedAt instanceof Date ? resource.lastCheckedAt.toISOString() : resource.lastCheckedAt ?? null
  };
}

async function testSub2AccountForResourceApply(accountId: number): Promise<Sub2GatewayAccountTestResult> {
  try {
    return await sub2Client.testAccount(accountId);
  } catch (error) {
    const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
    return {
      ok: false,
      statusCode: 0,
      testedAt: new Date().toISOString(),
      events: [{ type: "error", message }],
      raw: message.slice(0, 3000)
    };
  }
}

function parseResourceSub2AccountId(value: string | null | undefined) {
  if (!value) {
    throw new AppError("resource_sub2_account_missing", "Supplier resource does not have a Sub2 account id", 400);
  }

  const normalized = value.trim();
  const accountId = Number.parseInt(normalized, 10);
  if (!Number.isFinite(accountId) || String(accountId) !== normalized) {
    throw new AppError("resource_sub2_account_invalid", "Supplier resource Sub2 account id must be numeric", 400);
  }

  return accountId;
}

type Sub2RefreshTokenResourceSyncTarget =
  | {
    mode: "resource";
    resource: Prisma.SupplierResourceGetPayload<{
      include: {
        supplier: { include: { user: true } };
        credential: { select: typeof resourceCredentialSummarySelect };
      };
    }>;
  }
  | {
    mode: "supplier";
    supplierEmail: string;
    user: { id: string; email: string; displayName: string | null };
  };

async function validateSub2RefreshTokenResourceSyncTarget(input: Sub2OpenAiRefreshTokenInput): Promise<Sub2RefreshTokenResourceSyncTarget> {
  if (!env.API_KEY_ENCRYPTION_SECRET) {
    throw new AppError("credential_encryption_secret_missing", "API_KEY_ENCRYPTION_SECRET must be configured before storing resource credentials", 500);
  }

  if (input.resourceId) {
    const resource = await prisma.supplierResource.findUnique({
      where: { id: input.resourceId },
      include: {
        supplier: { include: { user: true } },
        credential: { select: resourceCredentialSummarySelect }
      }
    });
    if (!resource) throw new AppError("resource_not_found", "Supplier resource not found", 404);
    if (resource.resourceType !== "codex") {
      throw new AppError("resource_type_unsupported", "Only Codex resources can store OpenAI refresh tokens for Sub2", 400);
    }
    return { mode: "resource", resource };
  }

  const supplierEmail = input.supplierEmail?.toLowerCase();
  if (!supplierEmail) {
    throw new AppError("supplier_email_required", "Supplier email is required when saving a direct Sub2 credential to a new resource", 400);
  }
  const user = await prisma.user.findUnique({
    where: { email: supplierEmail },
    select: { id: true, email: true, displayName: true }
  });
  if (!user) throw new AppError("supplier_user_not_found", "Supplier user not found", 404);
  return { mode: "supplier", supplierEmail, user };
}

async function syncSub2RefreshTokenToSupplierResource(
  request: Parameters<typeof requireRole>[0],
  actorUserId: string,
  accountId: number,
  input: Sub2OpenAiRefreshTokenInput,
  target: Sub2RefreshTokenResourceSyncTarget,
  testResult: Sub2GatewayAccountTestResult | null
) {
  const encrypted = encryptSupplierResourceCredential(input.refreshToken, env.API_KEY_ENCRYPTION_SECRET!);
  const credentialData = {
    credentialType: "openai_refresh_token",
    encryptedValue: encrypted.encryptedValue,
    encryptionVersion: encrypted.encryptionVersion,
    keyFingerprint: encrypted.keyFingerprint,
    status: "active"
  };
  const now = new Date();
  const sub2AccountId = String(accountId);

  if (target.mode === "resource") {
    const before = {
      id: target.resource.id,
      resourceType: target.resource.resourceType,
      status: target.resource.status,
      sub2AccountId: target.resource.sub2AccountId,
      lastCheckedAt: target.resource.lastCheckedAt?.toISOString() ?? null,
      credential: target.resource.credential ? resourceCredentialAuditPayload(target.resource.credential) : null
    };
    const statusTransition = testResult ? inspectSupplierResourceTestStatusTransition({
      currentStatus: target.resource.status,
      ok: testResult.ok,
      resourceType: target.resource.resourceType,
      sub2AccountId,
      credential: credentialData
    }) : null;
    const nextStatus = statusTransition ? statusTransition.status : statusAfterDirectCredentialSync(target.resource.status);
    const resource = await prisma.supplierResource.update({
      where: { id: target.resource.id },
      data: {
        sub2AccountId,
        status: nextStatus,
        ...(testResult ? { lastCheckedAt: now } : {}),
        credential: {
          upsert: {
            update: {
              ...credentialData,
              lastRotatedAt: now
            },
            create: credentialData
          }
        }
      },
      include: {
        supplier: { include: { user: true } },
        credential: { select: resourceCredentialSummarySelect }
      }
    });
    await writeAuditLog(request, actorUserId, "admin.sub2.account.save_refresh_token_resource", "supplier_resource", resource.id, before, {
      id: resource.id,
      resourceType: resource.resourceType,
      status: resource.status,
      sub2AccountId: resource.sub2AccountId,
      lastCheckedAt: resource.lastCheckedAt?.toISOString() ?? null,
      credential: resource.credential ? resourceCredentialAuditPayload(resource.credential) : null,
      source: "sub2_direct_refresh_token_apply",
      accountId,
      test: resourceSyncTestAuditPayload(testResult),
      statusTransition
    });
    return { saved: true, skippedReason: null, created: false, resource, credential: resource.credential, statusTransition };
  }

  const initialStatusTransition = testResult ? inspectSupplierResourceTestStatusTransition({
    currentStatus: "testing",
    ok: testResult.ok,
    resourceType: "codex",
    sub2AccountId,
    credential: credentialData
  }) : null;
  const initialStatus = initialStatusTransition ? initialStatusTransition.status : "testing";
  const resource = await prisma.$transaction(async (tx) => {
    await tx.userRole.upsert({
      where: { userId_role: { userId: target.user.id, role: "supplier" } },
      update: {},
      create: { userId: target.user.id, role: "supplier" }
    });
    const supplier = await tx.supplier.upsert({
      where: { userId: target.user.id },
      update: {},
      create: { userId: target.user.id, displayName: target.user.displayName }
    });
    return tx.supplierResource.create({
      data: {
        supplierId: supplier.id,
        resourceType: "codex",
        status: initialStatus,
        level: "L0",
        maxConcurrency: 1,
        shareRate: supplier.defaultShareRate,
        reserveRatio: new Prisma.Decimal(0.2),
        sub2AccountId,
        lastCheckedAt: testResult ? now : undefined,
        credential: { create: credentialData }
      },
      include: {
        supplier: { include: { user: true } },
        credential: { select: resourceCredentialSummarySelect }
      }
    });
  });
  await writeAuditLog(request, actorUserId, "admin.sub2.account.save_refresh_token_resource", "supplier_resource", resource.id, null, {
    id: resource.id,
    resourceType: resource.resourceType,
    status: resource.status,
    sub2AccountId: resource.sub2AccountId,
    supplierEmail: target.supplierEmail,
    credential: resource.credential ? resourceCredentialAuditPayload(resource.credential) : null,
    source: "sub2_direct_refresh_token_apply",
    accountId,
    test: resourceSyncTestAuditPayload(testResult),
    statusTransition: initialStatusTransition
  });
  return { saved: true, skippedReason: null, created: true, resource, credential: resource.credential, statusTransition: initialStatusTransition };
}

function statusAfterDirectCredentialSync(current: ResourceStatus): ResourceStatus {
  if (["disabled", "paused"].includes(current)) return current;
  if (["pending", "abnormal"].includes(current)) return "testing";
  return current;
}

function resourceSyncTestAuditPayload(testResult: Sub2GatewayAccountTestResult | null) {
  return testResult ? {
    ok: testResult.ok,
    statusCode: testResult.statusCode,
    events: testResult.events.map((event) => event.type ?? event.message ?? "event")
  } : null;
}

function resourceCredentialSyncAuditPayload(sync: Awaited<ReturnType<typeof syncSub2RefreshTokenToSupplierResource>> | { saved: false; skippedReason: string; created: false; resource: null; credential: null }) {
  return {
    saved: sync.saved,
    skippedReason: sync.skippedReason,
    created: sync.created,
    resourceId: sync.resource?.id ?? null,
    resourceStatus: sync.resource?.status ?? null,
    sub2AccountId: sync.resource?.sub2AccountId ?? null,
    credential: sync.credential ? resourceCredentialAuditPayload(sync.credential) : null,
    statusTransition: "statusTransition" in sync ? sync.statusTransition : null
  };
}

async function applyStoredResourceCredentialToSub2(
  request: Parameters<typeof requireRole>[0],
  actorUserId: string,
  id: string,
  input: ApplyResourceCredentialToSub2Input
) {
  const resource = await prisma.supplierResource.findUnique({
    where: { id },
    select: {
      id: true,
      resourceType: true,
      status: true,
      sub2AccountId: true,
      lastCheckedAt: true,
      credential: { select: resourceCredentialPrivateSelect }
    }
  });
  if (!resource) throw new AppError("resource_not_found", "Supplier resource not found", 404);
  const accountId = parseResourceSub2AccountId(resource.sub2AccountId);
  if (!resource.credential) {
    throw new AppError("resource_credential_missing", "Supplier resource does not have a stored credential", 400);
  }
  if (resource.credential.status !== "active") {
    throw new AppError("resource_credential_not_active", "Supplier resource credential is not active", 400);
  }
  if (resource.credential.credentialType !== "openai_refresh_token") {
    throw new AppError("resource_credential_unsupported", "Only openai_refresh_token credentials can be applied to Sub2 OpenAI accounts", 400);
  }
  if (!env.API_KEY_ENCRYPTION_SECRET) {
    throw new AppError("credential_encryption_secret_missing", "API_KEY_ENCRYPTION_SECRET must be configured before reading resource credentials", 500);
  }

  let refreshToken: string;
  try {
    refreshToken = decryptSupplierResourceCredential(resource.credential.encryptedValue, env.API_KEY_ENCRYPTION_SECRET);
  } catch {
    throw new AppError("resource_credential_decrypt_failed", "Supplier resource credential could not be decrypted", 500);
  }

  const result = await sub2Client.applyOpenAiRefreshToken(accountId, {
    refreshToken,
    clientId: input.clientId,
    proxyId: input.proxyId
  });
  let testResult: Sub2GatewayAccountTestResult | null = null;
  let updatedResource: Prisma.SupplierResourceGetPayload<{
    include: {
      supplier: { include: { user: true } };
      credential: { select: typeof resourceCredentialSummarySelect };
    };
  }> | null = null;
  let statusTransition: ReturnType<typeof inspectSupplierResourceTestStatusTransition> | null = null;
  let smokeTest: Sub2ProxySmokeTestResult | null = null;
  let smokeTestSkippedReason: string | null = null;
  if (result.ok) {
    testResult = await testSub2AccountForResourceApply(accountId);
    statusTransition = inspectSupplierResourceTestStatusTransition({
      currentStatus: resource.status,
      ok: testResult.ok,
      resourceType: resource.resourceType,
      sub2AccountId: resource.sub2AccountId,
      credential: resource.credential
    });
    updatedResource = await prisma.supplierResource.update({
      where: { id },
      data: {
        status: statusTransition.status,
        lastCheckedAt: new Date()
      },
      include: {
        supplier: { include: { user: true } },
        credential: { select: resourceCredentialSummarySelect }
      }
    });
    if (input.runSmokeTest) {
      if (testResult.ok) {
        smokeTest = await runLocalOpenAiProxySmokeTest(input.smokeModel);
      } else {
        smokeTestSkippedReason = "sub2_account_test_failed";
      }
    }
  } else if (input.runSmokeTest) {
    smokeTestSkippedReason = "credential_apply_failed";
  }
  const credentialSummary = resourceCredentialAuditPayload(resource.credential);
  await writeAuditLog(request, actorUserId, "admin.resource.credential_apply_sub2", "supplier_resource", id, {
    sub2AccountId: resource.sub2AccountId,
    status: resource.status,
    lastCheckedAt: resource.lastCheckedAt?.toISOString() ?? null,
    credential: credentialSummary
  }, {
    sub2AccountId: resource.sub2AccountId,
    accountId,
    credential: credentialSummary,
    ok: result.ok,
    refreshed: result.refreshed,
    applied: result.applied,
    error: result.error,
    test: testResult ? {
      ok: testResult.ok,
      statusCode: testResult.statusCode,
      events: testResult.events.map((event) => event.type ?? event.message ?? "event")
    } : null,
    statusTransition,
    resource: updatedResource ? {
      status: updatedResource.status,
      lastCheckedAt: updatedResource.lastCheckedAt?.toISOString() ?? null
    } : null,
    smokeTestRequested: input.runSmokeTest,
    smokeTestSkippedReason,
    smokeTest: smokeTest ? {
      ok: smokeTest.ok,
      model: smokeTest.model,
      keyDisabled: smokeTest.keyDisabled,
      localProxy: smokeTest.localProxy,
      models: smokeTest.models,
      responses: smokeTest.responses
    } : null
  });

  return { resourceId: id, accountId, credential: credentialSummary, result, test: testResult, statusTransition, resource: updatedResource, smokeTest, smokeTestSkippedReason };
}

function resourceCredentialAuditPayload(credential: ResourceCredentialSummary | ResourceCredentialPrivate) {
  return {
    id: credential.id,
    credentialType: credential.credentialType,
    encryptionVersion: credential.encryptionVersion,
    keyFingerprint: credential.keyFingerprint,
    status: credential.status,
    lastRotatedAt: credential.lastRotatedAt instanceof Date ? credential.lastRotatedAt.toISOString() : credential.lastRotatedAt,
    createdAt: credential.createdAt instanceof Date ? credential.createdAt.toISOString() : credential.createdAt,
    updatedAt: credential.updatedAt instanceof Date ? credential.updatedAt.toISOString() : credential.updatedAt
  };
}

async function writeAuditLog(
  request: Parameters<typeof requireRole>[0],
  actorUserId: string | undefined,
  action: string,
  objectType: string,
  objectId: string | undefined,
  before: unknown,
  after: unknown
) {
  await prisma.auditLog.create({
    data: {
      actorUserId,
      action,
      objectType,
      objectId,
      before: before === undefined ? undefined : JSON.parse(JSON.stringify(redactSecrets(before))),
      after: after === undefined ? undefined : JSON.parse(JSON.stringify(redactSecrets(after))),
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"]
    }
  });
}
