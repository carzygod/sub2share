import { FormEvent, type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  adminProductLookupCandidate,
  adminNavigationItems,
  adminSystemHealthIssueRefFields,
  adminSystemHealthSampleSummaryFields,
  managedListViews,
  type AdminManagedListView as ManagedListView,
  type AdminView as View
} from "@zyz/shared";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Boxes,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CircleDollarSign,
  Copy,
  Download,
  Filter,
  KeyRound,
  PackagePlus,
  ReceiptText,
  RefreshCw,
  Scale,
  ScrollText,
  Search,
  ShieldCheck,
  TrendingUp,
  Users,
  WalletCards,
  X
} from "lucide-react";
import { api, clearAdminToken, saveAdminToken } from "./api";
import {
  resourceCreateDefaultsContextItems,
  resourceCreateDefaultsProductText,
  resourceCreateDefaultsShouldApplyCredential,
  resourceCreateDefaultsShouldRunSmokeTest,
  resourceCreateDefaultsSmokeModel,
  sub2RepairContextItems,
  sub2RepairContextShouldRunSmokeTest,
  sub2RepairContextSmokeModel,
  type ResourceCreateDefaults,
  type Sub2RepairContext
} from "./sub2-repair-context";
import logoUrl from "../assets/zyz-logo.png";
import "../styles/main.css";

type UserStatus = "active" | "disabled" | "banned";
type ResourceStatus = "pending" | "testing" | "online" | "busy" | "paused" | "abnormal" | "disabled";

interface PageMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface PagedResult<T> extends PageMeta {
  items: T[];
}

interface PagedUsageResult extends PagedResult<UsageRecordRow> {
  summary?: AggregateSummary;
}

interface BillingSyncStateRow {
  id: string;
  cursor?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
  lastImported: number;
  lastRecovered: number;
  lastSkipped: number;
  lastUnmatched: number;
  lastStartedAt?: string | null;
  lastFinishedAt?: string | null;
  updatedAt?: string;
}

interface BillingSyncRunRow {
  id: string;
  source: string;
  cursorIn?: string | null;
  cursorOut?: string | null;
  status: string;
  imported: number;
  recovered: number;
  skipped: number;
  unmatched: number;
  error?: string | null;
  startedAt: string;
  finishedAt?: string | null;
}

interface UsageSyncStateResult {
  state?: BillingSyncStateRow | null;
  runs: BillingSyncRunRow[];
}

interface PagedWithdrawalResult extends PagedResult<WithdrawalRow> {
  summary?: AggregateSummary;
}

interface ReconciliationSummary {
  billedUsageMissingWalletTransactions: number;
  walletTransactionsMissingUsage: number;
  usageSettlementMismatches: number;
  settlementOverallocated: number;
  withdrawalAllocationMismatches: number;
  totalIssues: number;
  returnedIssues: number;
}

interface ReconciliationIssue {
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

interface ReconciliationResult {
  checkedAt: string;
  ok: boolean;
  scanLimit: number;
  summary: ReconciliationSummary;
  scanned: Record<string, number>;
  issues: ReconciliationIssue[];
}

interface ListQueryState {
  q: string;
  status: string;
  resourceType: string;
  action: string;
  page: number;
  pageSize: number;
}

interface DashboardHealthCheckPreview {
  id: string;
  label: string;
  status: "ok" | "warning" | "error";
  summary: string;
  metrics?: Record<string, string | number | boolean | null>;
  issueCount: number;
  sampleCount: number;
  primaryIssue?: DashboardHealthDetailPreview;
  primarySample?: DashboardHealthDetailPreview;
}

type DashboardHealthDetailPreview = Record<string, string | number | boolean | null>;

interface Dashboard {
  users: number;
  activeRentals: number;
  onlineResources: number;
  pendingWithdrawals: number;
  usageCount: number;
  gmv: string;
  supplierIncome: string;
  walletAvailable: string;
  walletFrozen: string;
  totalRecharged: string;
  totalSpent: string;
  paidOrderCount: number;
  paidOrderAmount: string;
  latestSystemHealth?: {
    id: string;
    status: "ok" | "warning" | "error";
    source: string;
    summary: {
      totalChecks?: number;
      ok?: number;
      warning?: number;
      error?: number;
    };
    criticalChecks?: DashboardHealthCheckPreview[];
    createdAt: string;
    ageMinutes?: number;
    stale?: boolean;
    staleThresholdMinutes?: number;
  } | null;
}

interface AdminCapabilityOperation {
  id: string;
  label: string;
  method: string;
  path: string;
  roles: string[];
  critical: boolean;
  target?: AdminCapabilityNavigationTarget | null;
}

interface AdminCapabilityNavigationTarget {
  view: View;
  label: string;
}

interface AdminCapabilityArea {
  id: string;
  label: string;
  required: boolean;
  operations: AdminCapabilityOperation[];
}

interface AdminCapabilityCoverageIssue {
  id: string;
  type: string;
  severity: "error";
  areaId?: string;
  operationId?: string;
  method?: string;
  path?: string;
  message: string;
  actionHint: string;
}

interface AdminCapabilityCoverage {
  ok: boolean;
  summary: {
    requiredAreas: number;
    coveredRequiredAreas: number;
    totalOperations: number;
    criticalOperations: number;
    registeredOperations: number;
    missingRoutes: number;
    operationsWithTargets: number;
    missingTargets: number;
  };
  issues: AdminCapabilityCoverageIssue[];
}

interface AdminCapabilitiesResult {
  capabilities: AdminCapabilityArea[];
  coverage: AdminCapabilityCoverage;
}

interface SystemHealthCheckRow {
  id: string;
  label: string;
  status: "ok" | "warning" | "error";
  summary: string;
  metrics?: Record<string, string | number | boolean | null>;
  detail?: unknown;
}

interface SystemHealthIssueRow {
  id: string;
  checkId: string;
  checkLabel: string;
  severity: string;
  type: string;
  ref: string;
  message: string;
  repairAction?: string;
  actionHint?: string;
  resourceId?: string;
  resourceList?: boolean;
  resourceScope?: string;
  resourceType?: string;
  resourceStatus?: string;
  supplierEmail?: string;
  productId?: string;
  productName?: string;
  priceId?: string;
  proxyRequestLookup?: string;
  requestId?: string;
  proxyRequestLogId?: string;
  upstreamRequestId?: string;
  proxyRequestPath?: string;
  proxyRequestStatusCode?: string;
  proxyRequestErrorCode?: string;
  model?: string;
  modelsOk?: string;
  responsesOk?: string;
  localProxyOk?: string;
  smokeTestSkippedReason?: string;
  ageMinutes?: string;
  stale?: string;
  staleThresholdMinutes?: string;
  freshMinutesRemaining?: string;
  staleAt?: string;
  userId?: string;
  orderId?: string;
  rentalId?: string;
  walletList?: boolean;
  walletTransactionList?: boolean;
  walletTransactionType?: string;
  walletTransactionLookup?: string;
  salesList?: boolean;
  walletLookup?: string;
  apiKeyLookup?: string;
  usageLookup?: string;
  productLookup?: string;
  settlementLookup?: string;
  withdrawalLookup?: string;
  sub2AccountId?: string;
  sub2AccountName?: string;
  accountStatus?: string;
  credentialsStatus?: string;
  schedulable?: string;
  accountMessage?: string;
  accountUpdatedAt?: string;
  tempUnschedulableReason?: string;
  sub2Status?: boolean;
  auditLogLookup?: string;
}

interface SystemHealthSampleRow {
  id: string;
  checkId: string;
  checkLabel: string;
  ref: string;
  summary: string;
  sampleType?: string;
  repairAction?: string;
  actionHint?: string;
  proxyRequestLookup?: string;
  requestId?: string;
  proxyRequestLogId?: string;
  upstreamRequestId?: string;
  proxyRequestPath?: string;
  proxyRequestStatusCode?: string;
  proxyRequestErrorCode?: string;
  model?: string;
  modelsOk?: string;
  responsesOk?: string;
  localProxyOk?: string;
  smokeTestSkippedReason?: string;
  ageMinutes?: string;
  stale?: string;
  staleThresholdMinutes?: string;
  freshMinutesRemaining?: string;
  staleAt?: string;
  userId?: string;
  orderId?: string;
  rentalId?: string;
  walletLookup?: string;
  walletList?: boolean;
  walletTransactionList?: boolean;
  walletTransactionType?: string;
  walletTransactionLookup?: string;
  salesList?: boolean;
  resourceList?: boolean;
  resourceId?: string;
  resourceType?: string;
  resourceStatus?: string;
  resourceScope?: string;
  supplierEmail?: string;
  productId?: string;
  productName?: string;
  priceId?: string;
  sub2AccountId?: string;
  sub2AccountName?: string;
  accountStatus?: string;
  credentialsStatus?: string;
  schedulable?: string;
  accountMessage?: string;
  accountUpdatedAt?: string;
  tempUnschedulableReason?: string;
  sub2Status?: boolean;
  apiKeyLookup?: string;
  usageLookup?: string;
  productLookup?: string;
  settlementLookup?: string;
  withdrawalLookup?: string;
  auditLogLookup?: string;
}

interface DeliverySummary {
  status: "ok" | "warning" | "error";
  summary: {
    totalChecks: number;
    ok: number;
    warning: number;
    error: number;
    rentals: number;
    activeRentals: number;
    apiKeys: number;
    activeApiKeys: number;
    proxyRequestCount: number;
  };
  checks: SystemHealthCheckRow[];
}

interface SystemHealthResult {
  checkedAt: string;
  status: "ok" | "warning" | "error";
  summary: {
    totalChecks: number;
    ok: number;
    warning: number;
    error: number;
  };
  checks: SystemHealthCheckRow[];
}

interface SystemMaintenanceResult {
  startedAt: string;
  finishedAt: string;
  actions: {
    expireOverdueRentals?: {
      matched: number;
      expired: number;
      apiKeysDeactivated: number;
      sub2DisableFailed: number;
    };
    deactivateInvalidProxyApiKeys?: {
      matched: number;
      scanned: number;
      deactivated: number;
      truncated: boolean;
      limit: number;
      missingRentals: number;
      inactiveRentals: number;
      expiredRentals: number;
      keyRentalMismatches: number;
      sampleApiKeyIds?: string[];
    };
    releaseAvailableSettlements?: {
      matched: number;
      released: number;
      amountMatched: string;
    };
    syncSub2Usage?: {
      ok: boolean;
      imported?: number;
      recovered?: number;
      skipped?: number;
      unmatched?: number;
      nextCursor?: string;
      cursorOut?: string;
      runId?: string;
      error?: string;
    };
    repairSub2Bindings?: {
      rentalsScanned: number;
      userBindingsUpserted: number;
      apiKeyBindingsUpserted: number;
      conflicts: unknown[];
    };
    cleanupSmokeData?: {
      rentalsMatched: number;
      rentalsClosed: number;
      ordersClosed: number;
      apiKeysDeactivated: number;
      walletReset: boolean;
      sub2KeysDisableAttempted: number;
      sub2KeysDisabled: number;
      sub2DisableFailed: number;
    };
  };
  health: SystemHealthResult;
}

interface SystemHealthSnapshotRow {
  id: string;
  status: "ok" | "warning" | "error";
  source: string;
  summary: {
    totalChecks?: number;
    ok?: number;
    warning?: number;
    error?: number;
  };
  createdAt: string;
  actor?: Pick<UserRow, "id" | "email" | "displayName"> | null;
}

interface RoleRow {
  role: string;
}

interface UserRow {
  id: string;
  email: string;
  displayName?: string | null;
  phone?: string | null;
  status: UserStatus;
  roles: RoleRow[];
  wallet?: WalletRow | null;
  _count?: {
    orders: number;
    rentals: number;
    apiKeys: number;
  };
  createdAt?: string;
}

interface WalletRow {
  id: string;
  userId: string;
  availableBalance: string;
  frozenBalance: string;
  totalRecharged: string;
  totalSpent: string;
  updatedAt?: string;
  user?: UserRow;
  transactions?: WalletTransactionRow[];
}

interface WalletDetailRow extends WalletRow {
  transactionSummary?: AggregateSummary;
}

interface WalletTransactionRow {
  id: string;
  walletId: string;
  type: string;
  amount: string;
  balanceAfter: string;
  currency: string;
  refType?: string | null;
  refId?: string | null;
  note?: string | null;
  createdAt: string;
  wallet?: WalletRow;
}

interface UserIdentityRow {
  id: string;
  provider: string;
  providerUserId: string;
  email?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface OrderRow {
  id: string;
  status: string;
  currency?: string;
  totalAmount: string;
  paidAmount: string;
  paymentRef?: string | null;
  createdAt: string;
  updatedAt?: string;
  user?: UserRow;
  items?: OrderItemRow[];
  rentals?: RentalRow[];
}

interface OrderItemRow {
  id: string;
  productId: string;
  priceId?: string | null;
  quantity: number;
  amount: string;
  meta?: unknown;
  product?: ProductRow;
}

interface ProductRow {
  id: string;
  name: string;
  resourceType: string;
  billingMode: string;
  status: string;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
  deliveryRequired?: boolean;
  deliveryReady?: boolean;
  readyDeliveryResources?: number | null;
  deliveryBlockedReason?: string | null;
  prices?: ProductPriceRow[];
  _count?: {
    prices: number;
    orders: number;
    rentals: number;
  };
}

interface ProductPriceRow {
  id: string;
  productId: string;
  tierCode: string;
  displayName: string;
  discountRate: string;
  tierMultiplier: string;
  fixedPrice?: string | null;
  durationDays?: number | null;
  maxConcurrency: number;
  rpmLimit?: number | null;
  tpmLimit?: number | null;
  requestLimit?: number | null;
  spendLimit?: string | null;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

interface OrderDetailRow extends OrderRow {
  user: UserRow;
  items: OrderItemRow[];
  rentals: RentalRow[];
  statusHistory?: OrderStatusHistoryRow[];
  walletTransactions?: WalletTransactionRow[];
  walletTransactionSummary?: AggregateSummary;
  proxyRequests?: ProxyRequestLogRow[];
  proxyRequestSummary?: { _count: number };
  deliverySummary?: DeliverySummary;
}

interface OrderRetryProvisionResult {
  order: OrderDetailRow;
  rental: RentalRow;
  apiKey: string;
  apiKeyAvailable: boolean;
  sub2KeyId: string;
  walletDebited: boolean;
  debitTransactionId?: string | null;
}

interface OrderStatusHistoryRow {
  id: string;
  orderId: string;
  fromStatus?: string | null;
  toStatus: string;
  actorUserId?: string | null;
  reason?: string | null;
  meta?: unknown;
  createdAt: string;
}

interface RentalRow {
  id: string;
  userId?: string;
  orderId?: string;
  productId?: string;
  status: string;
  resourceType: string;
  endpointUrl?: string | null;
  sub2UserId?: string | null;
  sub2KeyId?: string | null;
  startsAt?: string;
  createdAt: string;
  updatedAt?: string;
  endsAt?: string | null;
  user?: UserRow;
  order?: OrderRow;
  product?: { name: string };
  apiKeys?: ApiKeyRow[];
  limits?: {
    maxConcurrency: number;
    rpmLimit?: number | null;
    tpmLimit?: number | null;
    requestLimit?: number | null;
    spendLimit?: string | null;
    remainingSpend?: string | null;
  } | null;
}

interface RentalDetailRow extends RentalRow {
  order?: OrderRow;
  usages?: UsageRecordRow[];
  proxyRequestLogs?: ProxyRequestLogRow[];
  usageSummary?: AggregateSummary;
  proxyRequestSummary?: { _count: number };
}

interface ResourceRow {
  id: string;
  resourceType: string;
  status: ResourceStatus;
  level: string;
  shareRate?: string;
  dailyCap?: string | null;
  reserveRatio?: string;
  maxConcurrency: number;
  sub2AccountId?: string | null;
  lastCheckedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  credential?: ResourceCredentialRow | null;
  supplier?: {
    id: string;
    displayName?: string | null;
    status?: string;
    defaultShareRate?: string;
    user?: UserRow;
  };
}

interface ResourceCredentialRow {
  id: string;
  credentialType: string;
  encryptionVersion?: string;
  keyFingerprint: string;
  status: string;
  lastRotatedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface WithdrawalRow {
  id: string;
  supplierId?: string;
  amount: string;
  currency?: string;
  status: string;
  payoutRef?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt?: string;
  supplier?: {
    id: string;
    displayName?: string | null;
    user?: UserRow;
  };
  settlements?: WithdrawalSettlementRow[];
}

interface WithdrawalSettlementRow {
  id: string;
  amount: string;
  status: string;
  settlementRecord?: SettlementRow;
}

interface SupplierDetailRow {
  id: string;
  userId?: string;
  displayName?: string | null;
  status: string;
  defaultShareRate: string;
  createdAt?: string;
  updatedAt?: string;
  user?: UserRow;
  resources?: ResourceRow[];
  withdrawals?: WithdrawalRow[];
  _count?: {
    resources: number;
    withdrawals: number;
  };
}

interface ApiKeyRow {
  id: string;
  userId?: string;
  rentalId?: string | null;
  name: string;
  keyPrefix: string;
  status: string;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  user?: UserRow;
  rental?: RentalRow | null;
}

interface ApiKeyBulkStatusResult {
  matched: number;
  processed: number;
  changed: number;
  skippedAlreadyStatus: number;
  truncated: boolean;
  limit: number;
  targetStatus: string;
  sub2SyncAttempted: number;
  sub2SyncFailed: number;
}

interface ProxyRequestLogRow {
  id: string;
  requestId: string;
  userId?: string | null;
  rentalId?: string | null;
  apiKeyId?: string | null;
  apiKeyPrefix?: string | null;
  method: string;
  path: string;
  model?: string | null;
  statusCode?: number | null;
  upstreamStatusCode?: number | null;
  upstreamRequestId?: string | null;
  errorCode?: string | null;
  durationMs: number;
  requestBytes: number;
  estimatedInputTokens: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  user?: Pick<UserRow, "id" | "email" | "displayName"> | null;
  rental?: {
    id: string;
    orderId?: string | null;
    productId?: string | null;
    resourceType: string;
    status: string;
    product?: { name: string } | null;
  } | null;
  apiKey?: {
    id: string;
    name: string;
    keyPrefix: string;
    status: string;
  } | null;
}

interface UserDetailRow extends UserRow {
  phone?: string | null;
  updatedAt?: string;
  identities?: UserIdentityRow[];
  orders?: OrderRow[];
  rentals?: RentalRow[];
  apiKeys?: ApiKeyRow[];
  supplier?: SupplierDetailRow | null;
}

interface SettlementRow {
  id: string;
  supplierResourceId?: string;
  usageRecordId?: string | null;
  amount: string;
  reservedAmount?: string;
  withdrawnAmount?: string;
  status: string;
  shareRate: string;
  availableAt?: string | null;
  createdAt: string;
  supplierResource?: ResourceRow;
  usageRecord?: UsageRecordRow | null;
}

interface UsageRecordRow {
  id: string;
  sub2RequestId: string;
  rentalId: string;
  userId: string;
  resourceType: string;
  model?: string | null;
  inputUnits: string;
  outputUnits: string;
  apiEquivalentCost: string;
  buyerCharge: string;
  supplierIncome: string;
  status: string;
  occurredAt: string;
  createdAt?: string;
  updatedAt?: string;
  rental?: RentalRow;
  supplierResource?: ResourceRow | null;
  settlements?: SettlementRow[];
}

interface AggregateSummary {
  _count: number;
  _sum: Record<string, string | number | null>;
}

interface ResourceDetailRow extends ResourceRow {
  usages?: UsageRecordRow[];
  settlements?: SettlementRow[];
  usageSummary?: AggregateSummary;
  settlementSummary?: AggregateSummary;
  credentialApplyLogs?: AuditLogRow[];
}

interface SalesData extends PageMeta {
  items?: OrderRow[];
  orders: OrderRow[];
  summary: {
    orderCount: number;
    totalAmount: string;
    paidAmount: string;
    usageCount: number;
    usageCharge: string;
    supplierIncome: string;
  };
  breakdown?: {
    byStatus: Array<{
      status: string;
      orderCount: number;
      totalAmount: string;
      paidAmount: string;
    }>;
    byResourceType: Array<{
      resourceType: string;
      orderItemCount: number;
      quantity: number;
      amount: string;
      rentalCount: number;
    }>;
    byProduct: Array<{
      productId: string;
      productName: string;
      resourceType: string;
      orderItemCount: number;
      quantity: number;
      amount: string;
    }>;
    byRentalStatus: Array<{
      status: string;
      rentalCount: number;
    }>;
  };
}

interface Sub2AccountStatus {
  id: number;
  name: string;
  platform: string;
  type: string;
  status: string;
  errorMessage?: string | null;
  credentialsStatus?: string | null;
  groupIds: number[];
  groupNames: string[];
  schedulable?: boolean;
  concurrency?: number;
  currentConcurrency?: number;
  lastUsedAt?: string | null;
  rateLimitedAt?: string | null;
  overloadUntil?: string | null;
  tempUnschedulableUntil?: string | null;
  tempUnschedulableReason?: string | null;
  updatedAt?: string;
}

interface Sub2Status {
  checkedAt: string;
  baseUrl: string;
  publicEndpoint: string;
  defaultGroupId?: number;
  gatewayReachable: boolean;
  ready: boolean;
  blockingReasons: string[];
  openAiGroup?: {
    id: number;
    name: string;
    platform?: string;
    status?: string;
  };
  accounts: Sub2AccountStatus[];
}

interface Sub2AccountTestResult {
  ok: boolean;
  statusCode: number;
  testedAt: string;
  events: Record<string, unknown>[];
  raw: string;
}

interface Sub2ProxySmokeTestResult {
  ok: boolean;
  checkedAt: string;
  model: string;
  gatewayBaseUrl: string;
  publicEndpoint: string;
  sub2UserId?: string;
  sub2KeyId?: string;
  keyDisabled: boolean;
  cleanupError?: string | null;
  provisioning: {
    ok: boolean;
    error?: string | null;
  };
  models: {
    ok: boolean;
    statusCode: number;
    modelCount: number;
    firstModel?: string | null;
    error?: string | null;
  };
  responses: {
    ok: boolean;
    statusCode: number;
    responseId?: string | null;
    responseStatus?: string | null;
    errorType?: string | null;
    errorMessage?: string | null;
  };
  localProxy?: {
    ok: boolean;
    endpoint: string;
    rentalId?: string | null;
    apiKeyPrefix?: string | null;
    proxyRequestLogCount: number;
    proxyRequestLogs?: Array<{
      id: string;
      requestId: string;
      path: string;
      model?: string | null;
      statusCode?: number | null;
      upstreamStatusCode?: number | null;
      errorCode?: string | null;
      createdAt: string;
    }>;
    apiKeyDeactivated: boolean;
    rentalClosed: boolean;
    orderClosed: boolean;
    walletReset: boolean;
  };
}

interface Sub2CredentialApplyResult {
  resourceId?: string;
  accountId: number;
  result: {
    ok: boolean;
    refreshed: boolean;
    applied: boolean;
    error?: string | null;
  };
  test?: Sub2AccountTestResult | null;
  resource?: ResourceRow | null;
  resourceCredentialSync?: {
    saved: boolean;
    skippedReason?: string | null;
    created: boolean;
    resource?: ResourceRow | null;
    credential?: ResourceCredentialRow | null;
  } | null;
  smokeTest?: Sub2ProxySmokeTestResult | null;
  smokeTestSkippedReason?: string | null;
}

interface Sub2BindingIssueRow {
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

interface Sub2BindingReconciliationResult {
  checkedAt: string;
  ok: boolean;
  scanLimit: number;
  summary: {
    rentalsScanned: number;
    bindingsScanned: number;
    totalIssues: number;
    missingUserBindings?: number;
    missingCurrentUserBindings?: number;
    missingCurrentApiKeyBindings: number;
    mismatchedCurrentBindings: number;
    orphanBindings: number;
  };
  issues: Sub2BindingIssueRow[];
}

interface Sub2BindingRepairResult {
  repairedAt: string;
  rentalsScanned: number;
  userBindingsUpserted: number;
  apiKeyBindingsUpserted: number;
  conflicts: Array<{ rentalId: string; sub2Type: string; sub2Id: string; reason: string }>;
  reconciliation: Sub2BindingReconciliationResult;
}

interface AuditLogRow {
  id: string;
  action: string;
  objectType: string;
  objectId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  actor?: {
    id: string;
    email: string;
    displayName?: string | null;
  } | null;
}

const defaultListQuery: ListQueryState = { q: "", status: "", resourceType: "", action: "", page: 1, pageSize: 50 };
const defaultPageMeta: PageMeta = { total: 0, page: 1, pageSize: 50, totalPages: 1 };
const csvExportPageSize = 200;
const userStatusOptions = ["active", "disabled", "banned"];
const productStatusOptions = ["draft", "active", "offline"];
const billingModeOptions = ["pay_as_you_go", "daily", "weekly", "monthly"];
const usageStatusOptions = ["pending", "billed", "refunded", "ignored", "disputed"];
const orderStatusOptions = ["pending", "paid", "provisioning", "active", "failed", "refunding", "refunded", "expired", "cancelled", "closed"];
const rentalStatusOptions = ["active", "low_balance", "limited", "suspended", "expired", "refunded", "closed"];
const apiKeyStatusOptions = ["active", "inactive"];
const systemHealthStatusOptions = ["ok", "warning", "error"];
const supplierStatusOptions = ["pending", "active", "paused", "disabled"];
const resourceStatusOptions = ["pending", "testing", "online", "busy", "paused", "abnormal", "disabled"];
const settlementStatusOptions = ["pending", "frozen", "available", "withdrawn", "cancelled"];
const withdrawalStatusOptions = ["pending", "approved", "rejected", "paid", "cancelled"];
const walletTransactionTypeOptions = ["recharge", "freeze", "unfreeze", "consume", "refund", "withdrawal_freeze", "withdrawal_paid", "adjustment"];
const proxyStatusOptions = ["200", "400", "401", "402", "403", "404", "408", "429", "500", "502", "503", "504"];
const resourceTypeOptions = ["codex", "claude_code", "gemini", "antigravity"];
const resourceCredentialTypeOptions = ["openai_refresh_token", "openai_api_key", "custom"];
const resourceCredentialStatusOptions = ["active", "rotated", "disabled"];

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [systemHealth, setSystemHealth] = useState<SystemHealthResult | null>(null);
  const [systemMaintenance, setSystemMaintenance] = useState<SystemMaintenanceResult | null>(null);
  const [systemHealthSnapshots, setSystemHealthSnapshots] = useState<SystemHealthSnapshotRow[]>([]);
  const [systemHealthHistory, setSystemHealthHistory] = useState<SystemHealthSnapshotRow[]>([]);
  const [adminCapabilities, setAdminCapabilities] = useState<AdminCapabilitiesResult | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserDetailRow | null>(null);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<WalletDetailRow | null>(null);
  const [walletTransactions, setWalletTransactions] = useState<WalletTransactionRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetailRow | null>(null);
  const [rentals, setRentals] = useState<RentalRow[]>([]);
  const [selectedRental, setSelectedRental] = useState<RentalDetailRow | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [usages, setUsages] = useState<UsageRecordRow[]>([]);
  const [usageSummary, setUsageSummary] = useState<AggregateSummary | null>(null);
  const [usageSyncState, setUsageSyncState] = useState<UsageSyncStateResult | null>(null);
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [selectedResource, setSelectedResource] = useState<ResourceDetailRow | null>(null);
  const [resourceCreateDefaults, setResourceCreateDefaults] = useState<ResourceCreateDefaults>({});
  const [suppliers, setSuppliers] = useState<SupplierDetailRow[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [withdrawalSummary, setWithdrawalSummary] = useState<AggregateSummary | null>(null);
  const [sales, setSales] = useState<SalesData | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null);
  const [sub2Status, setSub2Status] = useState<Sub2Status | null>(null);
  const [sub2Tests, setSub2Tests] = useState<Record<number, Sub2AccountTestResult>>({});
  const [sub2Smoke, setSub2Smoke] = useState<Sub2ProxySmokeTestResult | null>(null);
  const [sub2Bindings, setSub2Bindings] = useState<Sub2BindingReconciliationResult | null>(null);
  const [sub2RepairContext, setSub2RepairContext] = useState<Sub2RepairContext>({});
  const [proxyRequests, setProxyRequests] = useState<ProxyRequestLogRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [listQueries, setListQueries] = useState<Record<ManagedListView, ListQueryState>>(() => createDefaultListQueries());
  const [listMeta, setListMeta] = useState<Record<ManagedListView, PageMeta>>(() => createDefaultListMeta());
  const exportInProgressRef = useRef<ManagedListView | null>(null);
  const [message, setMessage] = useState("");
  const [loggedIn, setLoggedIn] = useState(Boolean(localStorage.getItem("zyz_admin_token")));

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = await api<{ token: string; refreshToken?: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
    });
    saveAdminToken(data.token, data.refreshToken);
    setLoggedIn(true);
    setMessage("登录成功");
    await refresh("dashboard");
  }

  async function loadPaged<T>(
    listView: ManagedListView,
    path: string,
    setter: (items: T[]) => void,
    queryOverride?: ListQueryState
  ) {
    const page = await api<PagedResult<T>>(buildListUrl(path, queryOverride ?? listQueries[listView]));
    setter(page.items);
    setListMeta((current) => ({
      ...current,
      [listView]: { total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages }
    }));
  }

  async function loadUsages(queryOverride?: ListQueryState) {
    const [page, syncState] = await Promise.all([
      api<PagedUsageResult>(buildListUrl("/api/admin/usages", queryOverride ?? listQueries.usages)),
      api<UsageSyncStateResult>("/api/admin/usages/sync-state")
    ]);
    setUsages(page.items);
    setUsageSummary(page.summary ?? null);
    setUsageSyncState(syncState);
    setListMeta((current) => ({
      ...current,
      usages: { total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages }
    }));
  }

  async function loadWithdrawals(queryOverride?: ListQueryState) {
    const page = await api<PagedWithdrawalResult>(buildListUrl("/api/admin/withdrawals", queryOverride ?? listQueries.withdrawals));
    setWithdrawals(page.items);
    setWithdrawalSummary(page.summary ?? null);
    setListMeta((current) => ({
      ...current,
      withdrawals: { total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages }
    }));
  }

  async function loadSales(queryOverride?: ListQueryState) {
    const page = await api<SalesData>(buildListUrl("/api/admin/sales", queryOverride ?? listQueries.sales));
    setSales(page);
    setListMeta((current) => ({
      ...current,
      sales: { total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages }
    }));
  }

  async function loadSub2View() {
    const [status, bindings] = await Promise.all([
      api<Sub2Status>("/api/admin/sub2/status"),
      api<Sub2BindingReconciliationResult>("/api/admin/sub2/bindings/reconciliation")
    ]);
    setSub2Status(status);
    setSub2Bindings(bindings);
  }

  async function loadSystemHealthView() {
    const health = await api<SystemHealthResult>("/api/admin/system-health");
    const snapshots = await api<PagedResult<SystemHealthSnapshotRow>>("/api/admin/system-health/snapshots?page=1&pageSize=12");
    setSystemHealth(health);
    setSystemHealthSnapshots(snapshots.items);
  }

  async function refresh(nextView = view, queryOverride?: ListQueryState) {
    try {
      setView(nextView);
      if (nextView === "dashboard") setDashboard(await api<Dashboard>("/api/admin/dashboard"));
      if (nextView === "systemHealth") await loadSystemHealthView();
      if (nextView === "systemHealthHistory") await loadPaged("systemHealthHistory", "/api/admin/system-health/snapshots", setSystemHealthHistory, queryOverride);
      if (nextView === "capabilities") setAdminCapabilities(await api<AdminCapabilitiesResult>("/api/admin/capabilities"));
      if (nextView === "users") await loadPaged("users", "/api/admin/users", setUsers, queryOverride);
      if (nextView === "wallets") await loadPaged("wallets", "/api/admin/wallets", setWallets, queryOverride);
      if (nextView === "walletTransactions") await loadPaged("walletTransactions", "/api/admin/wallet-transactions", setWalletTransactions, queryOverride);
      if (nextView === "reconciliation") setReconciliation(await api<ReconciliationResult>("/api/admin/reconciliation"));
      if (nextView === "sales") await loadSales(queryOverride);
      if (nextView === "usages") await loadUsages(queryOverride);
      if (nextView === "products") await loadPaged("products", "/api/admin/products", setProducts, queryOverride);
      if (nextView === "orders") await loadPaged("orders", "/api/admin/orders", setOrders, queryOverride);
      if (nextView === "rentals") await loadPaged("rentals", "/api/admin/rentals", setRentals, queryOverride);
      if (nextView === "apiKeys") await loadPaged("apiKeys", "/api/admin/api-keys", setApiKeys, queryOverride);
      if (nextView === "sub2") await loadSub2View();
      if (nextView === "proxyRequests") await loadPaged("proxyRequests", "/api/admin/proxy-requests", setProxyRequests, queryOverride);
      if (nextView === "suppliers") await loadPaged("suppliers", "/api/admin/suppliers", setSuppliers, queryOverride);
      if (nextView === "resources") {
        if (!queryOverride) setResourceCreateDefaults({});
        await loadPaged("resources", "/api/admin/resources", setResources, queryOverride);
      }
      if (nextView === "settlements") await loadPaged("settlements", "/api/admin/settlements", setSettlements, queryOverride);
      if (nextView === "withdrawals") await loadWithdrawals(queryOverride);
      if (nextView === "audit") await loadPaged("audit", "/api/admin/audit-logs", setAuditLogs, queryOverride);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function updateListDraft(listView: ManagedListView, patch: Partial<ListQueryState>) {
    setListQueries((current) => ({ ...current, [listView]: { ...current[listView], ...patch } }));
  }

  async function submitListFilters(listView: ManagedListView, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextQuery: ListQueryState = {
      ...listQueries[listView],
      q: String(form.get("q") || "").trim(),
      status: String(form.get("status") || "").trim(),
      resourceType: String(form.get("resourceType") || "").trim(),
      action: String(form.get("action") || "").trim(),
      page: 1,
      pageSize: Number(form.get("pageSize") || listQueries[listView].pageSize)
    };
    setListQueries((current) => ({ ...current, [listView]: nextQuery }));
    await refresh(listView, nextQuery);
  }

  async function clearListFilters(listView: ManagedListView) {
    const nextQuery = { ...defaultListQuery, pageSize: listQueries[listView].pageSize };
    if (listView === "resources") setResourceCreateDefaults({});
    setListQueries((current) => ({ ...current, [listView]: nextQuery }));
    await refresh(listView, nextQuery);
  }

  async function changeListPage(listView: ManagedListView, page: number) {
    const meta = listMeta[listView];
    const nextQuery = { ...listQueries[listView], page: Math.min(Math.max(page, 1), meta.totalPages) };
    setListQueries((current) => ({ ...current, [listView]: nextQuery }));
    await refresh(listView, nextQuery);
  }

  async function copyProxyRequestId(requestId: string) {
    try {
      await navigator.clipboard.writeText(requestId);
      setMessage(`已复制请求 ID：${requestId}`);
    } catch {
      setMessage(`请求 ID：${requestId}`);
    }
  }

  async function fetchAllListPages<T>(listView: ManagedListView, path: string, query: ListQueryState) {
    const baseQuery = { ...query, page: 1, pageSize: csvExportPageSize };
    const firstPage = await api<PagedResult<T>>(buildListUrl(path, baseQuery));
    const rows = [...firstPage.items];
    setMessage(`正在导出${titleFor(listView)}：${rows.length}/${firstPage.total}`);

    for (let page = 2; page <= firstPage.totalPages; page += 1) {
      const nextPage = await api<PagedResult<T>>(buildListUrl(path, { ...baseQuery, page }));
      rows.push(...nextPage.items);
      setMessage(`正在导出${titleFor(listView)}：${rows.length}/${firstPage.total}`);
    }

    return { rows, total: firstPage.total };
  }

  async function exportFilteredList(listView: ManagedListView) {
    if (exportInProgressRef.current) {
      setMessage(`${titleFor(exportInProgressRef.current)}导出仍在进行`);
      return;
    }

    exportInProgressRef.current = listView;
    try {
      const query = listQueries[listView];
      let exported = 0;

      if (listView === "users") {
        const { rows, total } = await fetchAllListPages<UserRow>(listView, "/api/admin/users", query);
        exportUsersCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "systemHealthHistory") {
        const { rows, total } = await fetchAllListPages<SystemHealthSnapshotRow>(listView, "/api/admin/system-health/snapshots", query);
        exportSystemHealthSnapshotsCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "wallets") {
        const { rows, total } = await fetchAllListPages<WalletRow>(listView, "/api/admin/wallets", query);
        exportWalletsCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "walletTransactions") {
        const { rows, total } = await fetchAllListPages<WalletTransactionRow>(listView, "/api/admin/wallet-transactions", query);
        exportWalletTransactionsCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "sales") {
        const { rows, total } = await fetchAllListPages<OrderRow>(listView, "/api/admin/sales", query);
        exportOrdersCsv(rows, "sales-orders", "filtered-all");
        exported = total;
      }
      if (listView === "usages") {
        const { rows, total } = await fetchAllListPages<UsageRecordRow>(listView, "/api/admin/usages", query);
        exportUsagesCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "products") {
        const { rows, total } = await fetchAllListPages<ProductRow>(listView, "/api/admin/products", query);
        exportProductsCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "orders") {
        const { rows, total } = await fetchAllListPages<OrderRow>(listView, "/api/admin/orders", query);
        exportOrdersCsv(rows, "orders", "filtered-all");
        exported = total;
      }
      if (listView === "rentals") {
        const { rows, total } = await fetchAllListPages<RentalRow>(listView, "/api/admin/rentals", query);
        exportRentalsCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "apiKeys") {
        const { rows, total } = await fetchAllListPages<ApiKeyRow>(listView, "/api/admin/api-keys", query);
        exportApiKeysCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "proxyRequests") {
        const { rows, total } = await fetchAllListPages<ProxyRequestLogRow>(listView, "/api/admin/proxy-requests", query);
        exportProxyRequestsCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "suppliers") {
        const { rows, total } = await fetchAllListPages<SupplierDetailRow>(listView, "/api/admin/suppliers", query);
        exportSuppliersCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "resources") {
        const { rows, total } = await fetchAllListPages<ResourceRow>(listView, "/api/admin/resources", query);
        exportResourcesCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "settlements") {
        const { rows, total } = await fetchAllListPages<SettlementRow>(listView, "/api/admin/settlements", query);
        exportSettlementsCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "withdrawals") {
        const { rows, total } = await fetchAllListPages<WithdrawalRow>(listView, "/api/admin/withdrawals", query);
        exportWithdrawalsCsv(rows, "filtered-all");
        exported = total;
      }
      if (listView === "audit") {
        const { rows, total } = await fetchAllListPages<AuditLogRow>(listView, "/api/admin/audit-logs", query);
        exportAuditLogsCsv(rows, "filtered-all");
        exported = total;
      }

      setMessage(`已导出${titleFor(listView)}：${exported} 条`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      exportInProgressRef.current = null;
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const roles = String(form.get("roles") || "buyer").split(",").map((role) => role.trim()).filter(Boolean);
    await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
        displayName: form.get("displayName"),
        roles
      })
    });
    event.currentTarget.reset();
    setMessage("用户已创建");
    await refresh("users");
  }

  async function setUserStatus(userId: string, status: UserStatus) {
    if (status !== "active" && !confirmAdminAction("确认调整用户状态？", `用户 ${userId}\n目标状态：${status}`)) return;
    await api(`/api/admin/users/${userId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    setMessage("用户状态已更新");
    await refresh("users");
    if (selectedUser?.id === userId) await openUserDetail(userId);
  }

  async function setUserRoles(userId: string, roles: string[]) {
    const user = selectedUser?.id === userId ? selectedUser : users.find((item) => item.id === userId);
    const currentRoles = user?.roles.map((role) => role.role).join(", ") || "-";
    if (!confirmAdminAction("确认更新用户角色？", `用户 ${user?.email ?? userId}\n当前角色：${currentRoles}\n目标角色：${roles.join(", ") || "-"}`)) return;
    await api(`/api/admin/users/${userId}/roles`, {
      method: "PATCH",
      body: JSON.stringify({ roles })
    });
    setMessage("User roles updated");
    await refresh("users");
    if (selectedUser?.id === userId) await openUserDetail(userId);
  }

  async function updateUserProfile(event: FormEvent<HTMLFormElement>, userId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = optionalFormString(form, "password");
    if (!confirmAdminAction("确认更新用户资料？", `用户 ID：${userId}\n显示名：${nullableFormString(form, "displayName") ?? "-"}\n手机号：${nullableFormString(form, "phone") ?? "-"}\n重置密码：${password ? "是" : "否"}`)) return;
    await api<UserRow>(`/api/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({
        displayName: nullableFormString(form, "displayName"),
        phone: nullableFormString(form, "phone"),
        password
      })
    });
    setMessage("用户资料已更新");
    await refresh("users");
    if (selectedUser?.id === userId) await openUserDetail(userId);
  }

  async function adjustWallet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const userId = String(form.get("userId") || "");
    const amount = String(form.get("amount") || "").trim();
    if (!confirmAdminAction("确认手动调整余额？", `用户 ID：${userId}\n调整金额：${amount}\n备注：${optionalFormString(form, "note") ?? "-"}`)) return;
    await api(`/api/admin/users/${userId}/wallet-adjust`, {
      method: "POST",
      body: JSON.stringify({ amount: form.get("amount"), note: form.get("note") })
    });
    event.currentTarget.reset();
    setMessage("余额已调整");
    await refresh("wallets");
    if (selectedWallet?.userId === userId) await openWalletDetail(selectedWallet.id);
    if (selectedUser?.id === userId) await openUserDetail(userId);
  }

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/admin/products", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        description: optionalFormString(form, "description"),
        resourceType: form.get("resourceType"),
        billingMode: form.get("billingMode"),
        status: form.get("status")
      })
    });
    event.currentTarget.reset();
    setMessage("Product created");
    await refresh("products");
  }

  async function setProductStatus(productId: string, status: string) {
    if (status === "offline" && !confirmAdminAction("确认下线商品？", `商品 ID：${productId}`)) return;
    await api(`/api/admin/products/${productId}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    setMessage("Product status updated");
    await refresh("products");
  }

  async function updateProductConfig(event: FormEvent<HTMLFormElement>, productId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!confirmAdminAction("确认更新商品配置？", `商品 ID：${productId}\n名称：${form.get("name")}\n资源：${form.get("resourceType")}\n计费：${form.get("billingMode")}\n状态：${form.get("status")}\n描述：${nullableFormString(form, "description") ?? "-"}`)) return;
    await api(`/api/admin/products/${productId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: form.get("name"),
        description: nullableFormString(form, "description"),
        resourceType: form.get("resourceType"),
        billingMode: form.get("billingMode"),
        status: form.get("status")
      })
    });
    setMessage("Product config updated");
    await refresh("products");
  }

  async function createProductPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const productId = String(form.get("productId") || "");
    await api(`/api/admin/products/${productId}/prices`, {
      method: "POST",
      body: JSON.stringify({
        tierCode: form.get("tierCode"),
        displayName: form.get("displayName"),
        fixedPrice: optionalFormString(form, "fixedPrice"),
        durationDays: optionalFormString(form, "durationDays"),
        maxConcurrency: form.get("maxConcurrency"),
        rpmLimit: optionalFormString(form, "rpmLimit"),
        tpmLimit: optionalFormString(form, "tpmLimit"),
        requestLimit: optionalFormString(form, "requestLimit"),
        spendLimit: optionalFormString(form, "spendLimit"),
        discountRate: form.get("discountRate"),
        tierMultiplier: form.get("tierMultiplier"),
        status: form.get("status")
      })
    });
    event.currentTarget.reset();
    setMessage("Product price created");
    await refresh("products");
  }

  async function setProductPriceStatus(priceId: string, status: string) {
    if (status === "offline" && !confirmAdminAction("确认下线价格档位？", `价格 ID：${priceId}`)) return;
    await api(`/api/admin/product-prices/${priceId}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    setMessage("Product price status updated");
    await refresh("products");
  }

  async function updateProductPrice(event: FormEvent<HTMLFormElement>, priceId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!confirmAdminAction("确认更新价格档位？", `价格 ID：${priceId}\n名称：${form.get("displayName")}\n固定价格：${nullableFormNumber(form, "fixedPrice") ?? "按量"}\n租期：${nullableFormNumber(form, "durationDays") ?? "-"}\n并发：${form.get("maxConcurrency")}\nRPM：${nullableFormNumber(form, "rpmLimit") ?? "-"}\nTPM：${nullableFormNumber(form, "tpmLimit") ?? "-"}\n请求数：${nullableFormNumber(form, "requestLimit") ?? "-"}\n消费上限：${nullableFormNumber(form, "spendLimit") ?? "-"}\n状态：${form.get("status")}`)) return;
    await api(`/api/admin/product-prices/${priceId}`, {
      method: "PATCH",
      body: JSON.stringify({
        displayName: form.get("displayName"),
        fixedPrice: nullableFormNumber(form, "fixedPrice"),
        durationDays: nullableFormNumber(form, "durationDays"),
        maxConcurrency: form.get("maxConcurrency"),
        rpmLimit: nullableFormNumber(form, "rpmLimit"),
        tpmLimit: nullableFormNumber(form, "tpmLimit"),
        requestLimit: nullableFormNumber(form, "requestLimit"),
        spendLimit: nullableFormNumber(form, "spendLimit"),
        discountRate: form.get("discountRate"),
        tierMultiplier: form.get("tierMultiplier"),
        status: form.get("status")
      })
    });
    setMessage("Product price updated");
    await refresh("products");
  }

  async function setRentalStatus(rentalId: string, status: string) {
    if (status !== "active" && !confirmAdminAction("确认调整租赁状态？", `租赁 ID：${rentalId}\n目标状态：${status}`)) return;
    await api(`/api/admin/rentals/${rentalId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    setMessage("Rental status updated");
    await refresh("rentals");
    if (selectedOrder?.rentals.some((rental) => rental.id === rentalId)) {
      await openOrderDetail(selectedOrder.id);
    }
    if (selectedRental?.id === rentalId) await openRentalDetail(rentalId);
  }

  async function updateRentalLimits(event: FormEvent<HTMLFormElement>, rentalId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!confirmAdminAction("确认更新已售租赁限额？", `租赁 ID：${rentalId}\n并发：${form.get("maxConcurrency")}\nRPM：${nullableFormNumber(form, "rpmLimit") ?? "-"}\nTPM：${nullableFormNumber(form, "tpmLimit") ?? "-"}\n请求数：${nullableFormNumber(form, "requestLimit") ?? "-"}\n消费上限：${nullableFormNumber(form, "spendLimit") ?? "-"}\n剩余额度：${nullableFormNumber(form, "remainingSpend") ?? "-"}`)) return;
    await api(`/api/admin/rentals/${rentalId}/limits`, {
      method: "PATCH",
      body: JSON.stringify({
        maxConcurrency: form.get("maxConcurrency"),
        rpmLimit: nullableFormNumber(form, "rpmLimit"),
        tpmLimit: nullableFormNumber(form, "tpmLimit"),
        requestLimit: nullableFormNumber(form, "requestLimit"),
        spendLimit: nullableFormNumber(form, "spendLimit"),
        remainingSpend: nullableFormNumber(form, "remainingSpend")
      })
    });
    setMessage("Rental limits updated");
    await refresh("rentals");
    if (selectedOrder?.rentals.some((rental) => rental.id === rentalId)) {
      await openOrderDetail(selectedOrder.id);
    }
    if (selectedRental?.id === rentalId) await openRentalDetail(rentalId);
  }

  async function setApiKeyStatus(apiKeyId: string, status: string) {
    if (status !== "active" && !confirmAdminAction("确认停用 API Key？", `API Key ID：${apiKeyId}`)) return;
    await api(`/api/admin/api-keys/${apiKeyId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    setMessage("API key status updated");
    await refresh(view === "apiKeys" ? "apiKeys" : "rentals");
    if (selectedOrder?.rentals.some((rental) => (rental.apiKeys ?? []).some((apiKey) => apiKey.id === apiKeyId))) {
      await openOrderDetail(selectedOrder.id);
    }
    if (selectedUser?.apiKeys?.some((apiKey) => apiKey.id === apiKeyId)) {
      await openUserDetail(selectedUser.id);
    }
    if (selectedRental?.apiKeys?.some((apiKey) => apiKey.id === apiKeyId)) {
      await openRentalDetail(selectedRental.id);
    }
  }

  async function bulkSetApiKeyStatus(status: string) {
    const query = listQueries.apiKeys;
    const actionText = status === "active" ? "启用" : "停用";
    if (!confirmAdminAction(
      `确认批量${actionText}当前筛选 API Key？`,
      [
        `目标状态：${status}`,
        `命中总数：${listMeta.apiKeys.total}`,
        `搜索：${query.q || "-"}`,
        `当前状态：${query.status || "-"}`,
        `资源类型：${query.resourceType || "-"}`,
        "单次最多处理：500"
      ].join("\n")
    )) return;
    const result = await api<ApiKeyBulkStatusResult>("/api/admin/api-keys/bulk-status", {
      method: "POST",
      body: JSON.stringify({
        status,
        q: query.q || undefined,
        currentStatus: query.status || undefined,
        resourceType: query.resourceType || undefined,
        limit: 500
      })
    });
    setMessage(`Bulk API key status updated: ${result.changed}/${result.processed}${result.truncated ? ` (limited to ${result.limit}/${result.matched})` : ""}${result.sub2SyncFailed ? `, ${result.sub2SyncFailed} Sub2 sync failures need review` : ""}`);
    await refresh("apiKeys");
  }

  async function rotateRentalKey(rentalId: string) {
    if (!confirmAdminAction("确认轮换租赁 API Key？", `租赁 ID：${rentalId}\n旧 Key 将被停用或需要人工复查。`)) return;
    const result = await api<{ apiKey: string; oldSub2KeyDisabled: boolean }>(`/api/admin/rentals/${rentalId}/rotate-key`, {
      method: "POST"
    });
    setMessage(`API key rotated. New key: ${result.apiKey}${result.oldSub2KeyDisabled ? "" : " (old Sub2 key disable needs manual check)"}`);
    await refresh("rentals");
    if (selectedOrder?.rentals.some((rental) => rental.id === rentalId)) {
      await openOrderDetail(selectedOrder.id);
    }
    if (selectedRental?.id === rentalId) await openRentalDetail(rentalId);
  }

  async function expireOverdueRentals() {
    if (!confirmAdminAction("确认批量处理过期租赁？", "系统会关闭过期租赁并停用对应本地 Key。")) return;
    const result = await api<{
      matched: number;
      expired: number;
      apiKeysDeactivated: number;
      sub2DisableFailed: number;
    }>("/api/admin/rentals/expire-overdue", {
      method: "POST",
      body: JSON.stringify({ limit: 200 })
    });
    setMessage(`Expired ${result.expired}/${result.matched} rentals, disabled ${result.apiKeysDeactivated} local keys${result.sub2DisableFailed ? `, ${result.sub2DisableFailed} Sub2 disables need review` : ""}`);
    await refresh("rentals");
    if (selectedRental) await openRentalDetail(selectedRental.id);
  }

  async function runSystemMaintenance() {
    if (!confirmAdminAction("确认运行系统维护？", "系统会批量处理过期租赁、停用确定不可用的反代 Key、释放结算、同步 Sub2 用量、修复绑定并清理过期自检数据。")) return;
    const result = await api<SystemMaintenanceResult>("/api/admin/system-maintenance/run", {
      method: "POST",
      body: JSON.stringify({})
    });
    setSystemMaintenance(result);
    setSystemHealth(result.health);
    const snapshots = await api<PagedResult<SystemHealthSnapshotRow>>("/api/admin/system-health/snapshots?page=1&pageSize=12");
    setSystemHealthSnapshots(snapshots.items);
    const expired = result.actions.expireOverdueRentals?.expired ?? 0;
    const deactivatedKeys = result.actions.deactivateInvalidProxyApiKeys?.deactivated ?? 0;
    const released = result.actions.releaseAvailableSettlements?.released ?? 0;
    const repaired = (result.actions.repairSub2Bindings?.userBindingsUpserted ?? 0)
      + (result.actions.repairSub2Bindings?.apiKeyBindingsUpserted ?? 0);
    const smokeCleaned = result.actions.cleanupSmokeData?.rentalsClosed ?? 0;
    const usageSync = result.actions.syncSub2Usage;
    const usageText = usageSync ? usageSync.ok ? `usage imported ${usageSync.imported ?? 0}, recovered ${usageSync.recovered ?? 0}` : "usage sync failed" : "usage sync skipped";
    setMessage(`Maintenance done: expired ${expired}, deactivated keys ${deactivatedKeys}, released ${released}, ${usageText}, repaired bindings ${repaired}, cleaned smoke ${smokeCleaned}`);
  }

  async function syncSub2Usages(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api<{ imported: number; recovered?: number; skipped: number; unmatched: number; nextCursor?: string; runId?: string; cursorOut?: string }>("/api/admin/usages/sync-sub2", {
      method: "POST",
      body: JSON.stringify({ cursor: optionalFormString(form, "cursor") })
    });
    setMessage(`Usage sync imported ${result.imported}, recovered ${result.recovered ?? 0}, skipped ${result.skipped}, unmatched ${result.unmatched}${result.cursorOut ? ` / cursor ${result.cursorOut}` : ""}`);
    await refresh("usages");
  }

  async function createWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const status = String(form.get("status") || "pending");
    if (status !== "pending" && !confirmAdminAction("确认直接创建非待处理提现？", `供给方：${form.get("supplierEmail")}\n金额：${form.get("amount")}\n状态：${status}`)) return;
    await api("/api/admin/withdrawals", {
      method: "POST",
      body: JSON.stringify({
        supplierEmail: form.get("supplierEmail"),
        amount: form.get("amount"),
        currency: optionalFormString(form, "currency") ?? "USD",
        status: form.get("status"),
        payoutRef: optionalFormString(form, "payoutRef"),
        note: optionalFormString(form, "note")
      })
    });
    event.currentTarget.reset();
    setMessage("Withdrawal created");
    await refresh("withdrawals");
  }

  async function releaseAvailableSettlements() {
    if (!confirmAdminAction("确认释放到期结算？", "系统会批量把到期 pending/frozen 结算推进为 available。")) return;
    const result = await api<{ matched: number; released: number; amountMatched: string }>("/api/admin/settlements/release-available", {
      method: "POST",
      body: JSON.stringify({ limit: 200 })
    });
    setMessage(`Released ${result.released}/${result.matched} settlements, amount ${result.amountMatched}`);
    await refresh("settlements");
  }

  async function setWithdrawalStatus(withdrawalId: string, status: string, payoutRef?: string) {
    if (status === "paid" && !payoutRef?.trim()) {
      setMessage("打款引用必填");
      return;
    }
    const note = promptAdminNote(`确认更新提现状态为 ${status}？`, `admin withdrawal ${status}`);
    if (note === null) return;
    await api(`/api/admin/withdrawals/${withdrawalId}`, {
      method: "PATCH",
      body: JSON.stringify({ status, payoutRef, note })
    });
    setMessage("Withdrawal status updated");
    await refresh("withdrawals");
  }

  async function openUserDetail(userId: string) {
    try {
      setSelectedUser(await api<UserDetailRow>(`/api/admin/users/${userId}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function openWalletDetail(walletId: string) {
    try {
      setSelectedWallet(await api<WalletDetailRow>(`/api/admin/wallets/${walletId}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function openOrderDetail(orderId: string) {
    try {
      setSelectedOrder(await api<OrderDetailRow>(`/api/admin/orders/${orderId}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function openRentalDetail(rentalId: string) {
    try {
      setSelectedRental(await api<RentalDetailRow>(`/api/admin/rentals/${rentalId}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function openFilteredListCandidate(listView: ManagedListView, lookup: string, message: string) {
    const query = { ...defaultListQuery, q: lookup };
    setListQueries((current) => ({ ...current, [listView]: query }));
    await refresh(listView, query);
    setMessage(message);
  }

  async function openStatusListCandidate(listView: ManagedListView, status: string, message: string) {
    const query = { ...defaultListQuery, status };
    setListQueries((current) => ({ ...current, [listView]: query }));
    await refresh(listView, query);
    setMessage(message);
  }

  async function openUserCandidate(userId: string) {
    await openFilteredListCandidate("users", userId, "已打开巡检关联用户");
    await openUserDetail(userId);
  }

  async function openWalletCandidate(lookup: string) {
    await openFilteredListCandidate("wallets", lookup, "已打开巡检关联余额账户");
  }

  async function openWalletTransactionsCandidate(filter?: { type?: string }) {
    const query = {
      ...defaultListQuery,
      status: filter?.type ?? ""
    };
    setListQueries((current) => ({ ...current, walletTransactions: query }));
    await refresh("walletTransactions", query);
    setMessage(filter?.type ? "已打开巡检关联余额流水" : "已打开余额流水");
  }

  async function openWalletTransactionCandidate(lookup: string) {
    await openFilteredListCandidate("walletTransactions", lookup, "已打开用户关联余额流水");
  }

  async function openSalesCandidate(lookup?: string) {
    const query = { ...defaultListQuery, q: lookup ?? "" };
    setListQueries((current) => ({ ...current, sales: query }));
    await refresh("sales", query);
    setMessage(lookup ? "已打开关联售出情况" : "已打开巡检关联售出情况");
  }

  async function openOrderListCandidate(lookup: string) {
    await openFilteredListCandidate("orders", lookup, "已打开关联订单列表");
  }

  async function openRentalListCandidate(lookup: string) {
    await openFilteredListCandidate("rentals", lookup, "已打开关联租赁列表");
  }

  async function openOrderCandidate(orderId: string) {
    await openFilteredListCandidate("orders", orderId, "已打开巡检关联订单");
    await openOrderDetail(orderId);
  }

  async function openRentalCandidate(rentalId: string) {
    await openFilteredListCandidate("rentals", rentalId, "已打开巡检关联租赁");
    await openRentalDetail(rentalId);
  }

  async function openApiKeyCandidate(lookup: string) {
    await openFilteredListCandidate("apiKeys", lookup, "已打开巡检关联 API Key");
  }

  async function openUsageCandidate(lookup: string) {
    await openFilteredListCandidate("usages", lookup, "已打开巡检关联用量");
  }

  async function openProductCandidate(lookup: string) {
    await openFilteredListCandidate("products", lookup, "已打开巡检关联商品");
  }

  async function openResourcesCandidate(filter?: ResourceCreateDefaults & { status?: string; scope?: string }) {
    const hasFilter = Boolean(filter?.supplierEmail || filter?.resourceType || filter?.status || filter?.resourceStatus || filter?.scope || filter?.resourceScope || filter?.sub2AccountId);
    const resourceType = resourceTypeOptions.includes(filter?.resourceType ?? "") ? filter!.resourceType! : "";
    const resourceScope = filter?.resourceScope ?? filter?.scope;
    const query = {
      ...defaultListQuery,
      q: filter?.supplierEmail ?? "",
      action: resourceScope === "production" ? "production" : "",
      resourceType,
      status: filter?.status ?? filter?.resourceStatus ?? ""
    };
    setResourceCreateDefaults({
      supplierEmail: filter?.supplierEmail,
      resourceType: resourceType || undefined,
      sub2AccountId: filter?.sub2AccountId,
      sub2AccountName: filter?.sub2AccountName,
      accountStatus: filter?.accountStatus,
      credentialsStatus: filter?.credentialsStatus,
      schedulable: filter?.schedulable,
      tempUnschedulableReason: filter?.tempUnschedulableReason,
      accountMessage: filter?.accountMessage,
      accountUpdatedAt: filter?.accountUpdatedAt,
      repairAction: filter?.repairAction,
      checkId: filter?.checkId,
      resourceScope,
      productId: filter?.productId,
      productName: filter?.productName,
      priceId: filter?.priceId,
      model: filter?.model,
      responsesOk: filter?.responsesOk,
      localProxyOk: filter?.localProxyOk,
      smokeTestSkippedReason: filter?.smokeTestSkippedReason,
      proxyRequestPath: filter?.proxyRequestPath,
      proxyRequestStatusCode: filter?.proxyRequestStatusCode,
      proxyRequestErrorCode: filter?.proxyRequestErrorCode,
      ageMinutes: filter?.ageMinutes,
      stale: filter?.stale,
      staleThresholdMinutes: filter?.staleThresholdMinutes,
      freshMinutesRemaining: filter?.freshMinutesRemaining,
      staleAt: filter?.staleAt
    });
    setSelectedResource(null);
    setListQueries((current) => ({ ...current, resources: query }));
    await refresh("resources", query);
    setMessage(hasFilter ? "已打开巡检关联共享资源列表" : "已打开共享资源列表");
  }

  async function openSettlementCandidate(lookup: string) {
    await openFilteredListCandidate("settlements", lookup, "已打开巡检关联结算");
  }

  async function openWithdrawalCandidate(lookup: string) {
    await openFilteredListCandidate("withdrawals", lookup, "已打开巡检关联提现");
  }

  async function cancelOrder(orderId: string) {
    const note = promptAdminNote("确认取消订单？", "admin cancelled order");
    if (note === null) return;
    const result = await api<{ cancelled: boolean }>(`/api/admin/orders/${orderId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ note })
    });
    setMessage(result.cancelled ? "Order cancelled" : "Order was already cancelled");
    await refresh(view === "sales" ? "sales" : "orders");
    if (selectedOrder?.id === orderId) await openOrderDetail(orderId);
  }

  async function refundOrder(orderId: string) {
    const note = promptAdminNote("确认退款订单？", "admin refunded order");
    if (note === null) return;
    const result = await api<{ refundAmount: string; walletRefunded: boolean; sub2Sync: unknown[] }>(`/api/admin/orders/${orderId}/refund`, {
      method: "POST",
      body: JSON.stringify({ note })
    });
    setMessage(`Order refunded ${money(result.refundAmount)}${result.walletRefunded ? "" : " (wallet already had refund)"}`);
    await refresh(view === "sales" ? "sales" : "orders");
    if (selectedOrder?.id === orderId) await openOrderDetail(orderId);
  }

  async function retryProvisionOrder(orderId: string) {
    const note = promptAdminNote("Retry failed order provisioning?", "admin retry provisioning");
    if (note === null) return;
    const result = await api<OrderRetryProvisionResult>(`/api/admin/orders/${orderId}/retry-provision`, {
      method: "POST",
      body: JSON.stringify({ note })
    });
    setMessage(`Order provisioned. API key: ${result.apiKey}${result.walletDebited ? " (wallet debited)" : ""}`);
    await refresh(view === "sales" ? "sales" : "orders");
    if (selectedOrder?.id === orderId) await openOrderDetail(orderId);
    if (selectedRental?.id === result.rental.id) await openRentalDetail(result.rental.id);
  }

  async function openResourceDetail(resourceId: string) {
    try {
      setSelectedResource(await api<ResourceDetailRow>(`/api/admin/resources/${resourceId}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function openResourceCandidate(resourceId: string) {
    await openFilteredListCandidate("resources", resourceId, "已打开巡检候选资源");
    await openResourceDetail(resourceId);
  }

  async function openProxyRequestCandidate(lookup: string) {
    await openFilteredListCandidate("proxyRequests", lookup, "已打开巡检关联反代请求");
  }

  async function openAuditLogCandidate(lookup: string) {
    await openFilteredListCandidate("audit", lookup, "已打开巡检关联审计记录");
  }

  async function openSub2StatusCandidate(context?: string | Sub2RepairContext) {
    const repairContext = typeof context === "string" ? { accountId: context } : context ?? {};
    setSub2RepairContext(repairContext);
    await refresh("sub2");
    setMessage(repairContext.accountId
      ? `Opened Sub2/OpenAI proxy status for account #${repairContext.accountId}`
      : "Opened Sub2/OpenAI proxy status for the selected health issue");
  }

  async function openCapabilityTarget(target: AdminCapabilityNavigationTarget, operation: AdminCapabilityOperation) {
    await refresh(target.view);
    setMessage(`已打开能力项 ${operation.id} 对应入口：${titleFor(target.view)}`);
  }

  async function openDashboardHealthCheck(check: DashboardHealthCheckPreview) {
    const record = dashboardHealthDetailRecord(check);
    if (dashboardHealthShouldOpenResourcesFirst(check, record)) {
      await openResourcesCandidate(dashboardHealthResourceFilter(record));
      return;
    }

    if (dashboardHealthCheckHasSub2Repair(check)) {
      await openSub2StatusCandidate(dashboardHealthSub2RepairContext(check));
      return;
    }

    const proxyLookup = dashboardHealthProxyLookup(check);
    if ((check.id === "proxy" || check.id === "localProxySmoke") && proxyLookup) {
      await openProxyRequestCandidate(proxyLookup);
      return;
    }

    if (["resources", "resourceCredentials"].includes(check.id) && dashboardHealthHasResourceFilter(record)) {
      await openResourcesCandidate(dashboardHealthResourceFilter(record));
      return;
    }

    if (check.id === "productCatalog") {
      const productLookup = dashboardHealthProductLookup(check);
      if (productLookup) {
        await openProductCandidate(productLookup);
        return;
      }
    }

    if (check.id === "payments") {
      const transactionLookup = dashboardHealthWalletTransactionLookup(record);
      if (transactionLookup) {
        await openWalletTransactionCandidate(transactionLookup);
        return;
      }
      if (dashboardHealthHasWalletTransactionFilter(record)) {
        await openWalletTransactionsCandidate({ type: textValue(record?.walletTransactionType) });
        return;
      }
      if (dashboardHealthHasWalletLookup(record)) {
        await openWalletCandidate(textValue(record?.walletLookup) ?? textValue(record?.walletId)!);
        return;
      }
      if (textValue(record?.salesList)?.toLowerCase() === "true") {
        await openSalesCandidate();
        return;
      }
    }

    const target = dashboardHealthCheckTarget(check);
    if (target) await refresh(target.view);
  }

  async function setResourceStatus(resourceId: string, status: ResourceStatus) {
    if (["paused", "abnormal", "disabled"].includes(status) && !confirmAdminAction("确认调整共享资源状态？", `资源 ID：${resourceId}\n目标状态：${status}`)) return;
    await api(`/api/admin/resources/${resourceId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    setMessage("资源状态已更新");
    await refresh("resources");
    if (selectedResource?.id === resourceId) await openResourceDetail(resourceId);
  }

  async function testResource(resourceId: string) {
    const result = await api<{ result: { ok: boolean; statusCode: number }; resource: ResourceRow }>(`/api/admin/resources/${resourceId}/test`, {
      method: "POST"
    });
    setMessage(`Resource test ${result.result.ok ? "passed" : "failed"} / HTTP ${result.result.statusCode} / status ${result.resource.status}`);
    await refresh("resources");
    if (selectedResource?.id === resourceId) await openResourceDetail(resourceId);
  }

  async function createResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const applyCredentialToSub2 = form.get("applyCredentialToSub2") === "on";
    const credentialRunSmokeTest = form.get("credentialRunSmokeTest") === "on";
    const credentialClientId = optionalFormString(form, "credentialClientId");
    const credentialProxyIdText = String(form.get("credentialProxyId") || "").trim();
    const credentialSmokeModel = optionalFormString(form, "credentialSmokeModel");
    const productContext = resourceCreateDefaultsProductText(resourceCreateDefaults);
    const credentialConfirmation = [
      `供给方：${form.get("supplierEmail")}`,
      productContext ? `关联商品：${productContext}` : undefined,
      `资源类型：${form.get("resourceType")}`,
      `Sub2 账号：${optionalFormString(form, "sub2AccountId") ?? "-"}`,
      `Client ID：${credentialClientId ?? "-"}`,
      `Proxy ID：${credentialProxyIdText || "-"}`,
      `端到端自检：${credentialRunSmokeTest ? "是" : "否"}`,
      `自检模型：${credentialSmokeModel ?? "-"}`
    ].filter(Boolean).join("\n");
    if (applyCredentialToSub2 && !confirmAdminAction("确认创建后应用初始凭据到 Sub2？", credentialConfirmation)) return;
    const resource = await api<ResourceRow & { credentialApply?: Sub2CredentialApplyResult | null }>("/api/admin/resources", {
      method: "POST",
      body: JSON.stringify({
        supplierEmail: form.get("supplierEmail"),
        displayName: optionalFormString(form, "displayName"),
        resourceType: form.get("resourceType"),
        status: form.get("status"),
        level: form.get("level"),
        maxConcurrency: form.get("maxConcurrency"),
        shareRate: form.get("shareRate"),
        reserveRatio: form.get("reserveRatio"),
        dailyCap: optionalFormString(form, "dailyCap"),
        sub2AccountId: optionalFormString(form, "sub2AccountId"),
        credentialType: optionalFormString(form, "credentialType"),
        credentialStatus: optionalFormString(form, "credentialStatus"),
        credentialSecret: optionalFormString(form, "credentialSecret"),
        applyCredentialToSub2,
        credentialClientId,
        credentialProxyId: credentialProxyIdText ? Number(credentialProxyIdText) : undefined,
        credentialRunSmokeTest,
        credentialSmokeModel
      })
    });
    event.currentTarget.reset();
    const applyMessage = resource.credentialApply
      ? `，${credentialApplyMessage(resource.credentialApply, "初始凭据已应用", "初始凭据应用失败")}`
      : "";
    setMessage(`${resource.credential ? "共享资源已创建，初始凭据已保存" : "共享资源已创建"}${applyMessage}`);
    await refresh("resources");
    await openResourceDetail(resource.id);
    if (resource.credentialApply) await refresh("sub2");
  }

  async function updateResourceConfig(event: FormEvent<HTMLFormElement>, resourceId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!confirmAdminAction("确认更新共享资源配置？", `资源 ID：${resourceId}\n状态：${form.get("status")}\n等级：${form.get("level")}\n并发：${form.get("maxConcurrency")}\n分成：${form.get("shareRate")}\n保留比例：${form.get("reserveRatio")}\n日上限：${nullableFormNumber(form, "dailyCap") ?? "-"}\nSub2 账号：${nullableFormString(form, "sub2AccountId") ?? "-"}`)) return;
    const resource = await api<ResourceRow>(`/api/admin/resources/${resourceId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: form.get("status"),
        level: form.get("level"),
        maxConcurrency: form.get("maxConcurrency"),
        shareRate: form.get("shareRate"),
        reserveRatio: form.get("reserveRatio"),
        dailyCap: nullableFormNumber(form, "dailyCap"),
        sub2AccountId: nullableFormString(form, "sub2AccountId")
      })
    });
    setMessage("共享资源配置已更新");
    await refresh("resources");
    await openResourceDetail(resource.id);
  }

  async function upsertResourceCredential(event: FormEvent<HTMLFormElement>, resourceId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!confirmAdminAction("确认保存共享资源凭据？", `资源 ID：${resourceId}\n类型：${form.get("credentialType")}\n状态：${form.get("status")}`)) return;
    await api(`/api/admin/resources/${resourceId}/credential`, {
      method: "PUT",
      body: JSON.stringify({
        credentialType: form.get("credentialType"),
        status: form.get("status"),
        secret: form.get("secret")
      })
    });
    event.currentTarget.reset();
    setMessage("共享资源凭据已加密保存");
    await refresh("resources");
    await openResourceDetail(resourceId);
  }

  async function deleteResourceCredential(resourceId: string) {
    if (!confirmAdminAction("确认删除共享资源凭据？", `资源 ID：${resourceId}\n删除后后台不会保留该凭据密文。`)) return;
    await api(`/api/admin/resources/${resourceId}/credential`, {
      method: "DELETE"
    });
    setMessage("共享资源凭据已删除");
    await refresh("resources");
    await openResourceDetail(resourceId);
  }

  async function applyResourceCredentialToSub2(event: FormEvent<HTMLFormElement>, resourceId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const clientId = String(form.get("clientId") || "").trim();
    const proxyIdText = String(form.get("proxyId") || "").trim();
    const runSmokeTest = form.get("runSmokeTest") === "on";
    const smokeModel = optionalFormString(form, "smokeModel");
    if (!confirmAdminAction("确认应用共享资源凭据到 Sub2？", `资源 ID：${resourceId}\nClient ID：${clientId || "-"}\nProxy ID：${proxyIdText || "-"}\n端到端自检：${runSmokeTest ? "是" : "否"}\n自检模型：${smokeModel ?? "-"}`)) return;
    const result = await api<Sub2CredentialApplyResult>(`/api/admin/resources/${resourceId}/apply-credential-to-sub2`, {
      method: "POST",
      body: JSON.stringify({
        clientId: clientId || undefined,
        proxyId: proxyIdText ? Number(proxyIdText) : undefined,
        runSmokeTest,
        smokeModel
      })
    });
    event.currentTarget.reset();
    setMessage(credentialApplyMessage(result, "资源凭据已应用", "资源凭据应用失败"));
    await refresh("resources");
    await openResourceDetail(resourceId);
  }

  async function updateSupplierConfig(event: FormEvent<HTMLFormElement>, supplierId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!confirmAdminAction("确认更新供给方配置？", `供给方 ID：${supplierId}\n显示名：${nullableFormString(form, "displayName") ?? "-"}\n状态：${form.get("status")}\n默认分成：${form.get("defaultShareRate")}`)) return;
    await api(`/api/admin/suppliers/${supplierId}`, {
      method: "PATCH",
      body: JSON.stringify({
        displayName: nullableFormString(form, "displayName"),
        status: form.get("status"),
        defaultShareRate: form.get("defaultShareRate")
      })
    });
    setMessage("供给方配置已更新");
    await refresh("suppliers");
    if (selectedResource?.supplier?.id === supplierId) await openResourceDetail(selectedResource.id);
    if (selectedUser?.supplier?.id === supplierId) await openUserDetail(selectedUser.id);
  }

  async function refreshSub2Account(accountId: number) {
    const result = await api<{ ok: boolean; error?: string | null }>(`/api/admin/sub2/accounts/${accountId}/refresh`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setMessage(result.ok ? "Sub2 上游账号刷新已触发" : `刷新失败：${result.error ?? "未知错误"}`);
    await refresh("sub2");
  }

  async function testSub2Account(accountId: number) {
    const result = await api<Sub2AccountTestResult>(`/api/admin/sub2/accounts/${accountId}/test`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setSub2Tests((current) => ({ ...current, [accountId]: result }));
    setMessage(result.ok ? "Sub2 上游账号测试通过" : `测试失败：${testSummary(result)}`);
    await refresh("sub2");
  }

  async function runSub2SmokeTest() {
    const result = await api<Sub2ProxySmokeTestResult>("/api/admin/sub2/proxy-smoke-test", {
      method: "POST",
      body: JSON.stringify({})
    });
    setSub2Smoke(result);
    setMessage(result.ok ? "Codex 反代端到端自检通过" : `反代自检失败：${smokeSummary(result)}`);
    await refresh("sub2");
  }

  async function checkSub2Bindings() {
    const result = await api<Sub2BindingReconciliationResult>("/api/admin/sub2/bindings/reconciliation");
    setSub2Bindings(result);
    setMessage(result.ok ? "Sub2 bindings are consistent" : `Sub2 bindings need review: ${result.summary.totalIssues} issues`);
  }

  async function repairSub2Bindings() {
    if (!confirmAdminAction("确认修复 Sub2 绑定？", "系统会根据本地用户、API Key 和租赁记录补齐缺失绑定。")) return;
    const result = await api<Sub2BindingRepairResult>("/api/admin/sub2/bindings/repair", {
      method: "POST",
      body: JSON.stringify({})
    });
    setSub2Bindings(result.reconciliation);
    setMessage(`Sub2 bindings repaired: user ${result.userBindingsUpserted}, api_key ${result.apiKeyBindingsUpserted}, conflicts ${result.conflicts.length}`);
    await refresh("sub2");
  }

  async function applySub2RefreshToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const accountId = String(form.get("accountId") || "");
    const clientId = String(form.get("clientId") || "").trim();
    const proxyIdText = String(form.get("proxyId") || "").trim();
    const refreshToken = String(form.get("refreshToken") || "");
    const runAccountTest = form.get("runAccountTest") === "on";
    const runSmokeTest = form.get("runSmokeTest") === "on";
    const smokeModel = optionalFormString(form, "smokeModel");
    const saveToResource = form.get("saveToResource") === "on";
    const resourceId = optionalFormString(form, "resourceId");
    const supplierEmail = optionalFormString(form, "supplierEmail");
    if (!confirmAdminAction("确认应用 OpenAI Refresh Token？", `Sub2 账号 ID：${accountId}\nClient ID：${clientId || "-"}\nProxy ID：${proxyIdText || "-"}\n应用后测试账号：${runAccountTest ? "是" : "否"}\n端到端自检：${runSmokeTest ? "是" : "否"}\n自检模型：${smokeModel ?? "-"}`)) return;
    if (saveToResource && !confirmAdminAction("确认同步保存共享资源凭据？", `目标资源：${resourceId ?? "-"}\n供给方邮箱：${supplierEmail ?? "-"}\n未填写目标资源时会为供给方创建 Codex 共享资源。`)) return;
    const result = await api<Sub2CredentialApplyResult>(
      `/api/admin/sub2/accounts/${accountId}/apply-openai-refresh-token`,
      {
        method: "POST",
        body: JSON.stringify({
          refreshToken,
          clientId: clientId || undefined,
          proxyId: proxyIdText ? Number(proxyIdText) : undefined,
          runAccountTest,
          runSmokeTest,
          smokeModel,
          saveToResource,
          resourceId,
          supplierEmail
        })
      }
    );
    event.currentTarget.reset();
    if (result.test) setSub2Tests((current) => ({ ...current, [result.accountId]: result.test! }));
    if (result.smokeTest) setSub2Smoke(result.smokeTest);
    const testMessage = result.test
      ? `，测试${result.test.ok ? "通过" : "失败"} / HTTP ${result.test.statusCode} / ${testSummary(result.test)}`
      : "";
    const smokeMessage = result.smokeTest
      ? result.smokeTest.ok ? "，端到端通过" : `，端到端失败 / ${smokeSummary(result.smokeTest)}`
      : result.smokeTestSkippedReason ? `，端到端跳过：${credentialApplySmokeSkipLabel(result.smokeTestSkippedReason)}` : "";
    const resourceSyncMessage = result.resourceCredentialSync ? `，${resourceCredentialSyncMessage(result.resourceCredentialSync)}` : "";
    setMessage(result.result.ok ? `OpenAI 上游凭据已应用到账号 #${result.accountId}${testMessage}${smokeMessage}${resourceSyncMessage}` : `凭据应用失败：${result.result.error ?? "未知错误"}${smokeMessage}${resourceSyncMessage}`);
    if (result.resourceCredentialSync?.saved) await refresh("resources");
    await refresh("sub2");
  }

  useEffect(() => {
    if (loggedIn) void refresh("dashboard");
  }, [loggedIn]);

  if (!loggedIn) {
    return (
      <main className="login-page">
        <section className="login-shell glass-panel">
          <div className="login-copy">
            <div className="brand-lockup">
              <img className="brand-mark" src={logoUrl} alt="" aria-hidden="true" />
              <div>
                <strong>智算驿站</strong>
                <span>运营中枢</span>
              </div>
            </div>
            <h1>供需调度与结算控制台</h1>
            <p>面向用户、共享资源、余额、销售和租赁的统一管理入口。</p>
          </div>
          <form onSubmit={login}>
            <span className="eyebrow">Admin Access</span>
            <h2>登录后台</h2>
            {message && <div className="notice compact">{message}</div>}
            <input name="email" type="email" placeholder="邮箱" required />
            <input name="password" type="password" placeholder="密码" required />
            <button>进入控制台</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <aside className="sidebar glass-panel">
        <div className="brand-lockup">
          <img className="brand-mark" src={logoUrl} alt="" aria-hidden="true" />
          <div>
            <strong>智算驿站</strong>
            <span>Admin Console</span>
          </div>
        </div>
        <nav>
          {adminNavigationItems.map((item) => (
            <NavButton key={item.view} active={view === item.view} onClick={() => refresh(item.view)} icon={navigationIcon(item.view)}>
              {item.label}
            </NavButton>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar glass-panel">
          <div>
            <span className="eyebrow">Operations</span>
            <h1>{titleFor(view)}</h1>
            <p>集中管理所有用户、共享资源、余额、销售订单和 Sub2API 租赁通道。</p>
          </div>
          <div className="actions">
            <button className="secondary" onClick={() => refresh()}><RefreshCw size={18} />刷新</button>
            <button className="ghost" onClick={() => { clearAdminToken(); setLoggedIn(false); }}>退出</button>
          </div>
        </header>

        {message && <div className="notice glass-panel">{message}</div>}
        {view === "dashboard" && (
          <DashboardView
            dashboard={dashboard}
            onOpenSystemHealth={() => refresh("systemHealth")}
            onOpenView={(nextView) => { void refresh(nextView); }}
            onOpenHealthCheck={(check) => { void openDashboardHealthCheck(check); }}
            onOpenHealthResources={(check) => { void openResourcesCandidate(dashboardHealthResourceFilter(dashboardHealthDetailRecord(check), check.id)); }}
            onOpenActiveRentals={() => { void openStatusListCandidate("rentals", "active", "已打开 active 租赁通道"); }}
            onOpenOnlineResources={() => { void openResourcesCandidate({ status: "online" }); }}
            onOpenRechargeTransactions={() => { void openWalletTransactionsCandidate({ type: "recharge" }); }}
            onOpenConsumeTransactions={() => { void openWalletTransactionsCandidate({ type: "consume" }); }}
            onOpenPendingWithdrawals={() => { void openStatusListCandidate("withdrawals", "pending", "已打开待处理提现"); }}
          />
        )}
        {view === "systemHealth" && (
          <SystemHealthView
            health={systemHealth}
            maintenance={systemMaintenance}
            snapshots={systemHealthSnapshots}
            onRefresh={() => refresh("systemHealth")}
            onRunMaintenance={runSystemMaintenance}
            onOpenResources={openResourcesCandidate}
            onOpenResource={openResourceCandidate}
            onOpenProxyRequest={openProxyRequestCandidate}
            onOpenWallets={() => { void refresh("wallets"); }}
            onOpenWalletTransactions={openWalletTransactionsCandidate}
            onOpenWalletTransaction={openWalletTransactionCandidate}
            onOpenSales={openSalesCandidate}
            onOpenUser={openUserCandidate}
            onOpenWallet={openWalletCandidate}
            onOpenOrder={openOrderCandidate}
            onOpenRental={openRentalCandidate}
            onOpenApiKey={openApiKeyCandidate}
            onOpenUsage={openUsageCandidate}
            onOpenProduct={openProductCandidate}
            onOpenSettlement={openSettlementCandidate}
            onOpenWithdrawal={openWithdrawalCandidate}
            onOpenSub2Status={openSub2StatusCandidate}
            onOpenAuditLog={openAuditLogCandidate}
          />
        )}
        {view === "systemHealthHistory" && (
          <SystemHealthHistoryView
            snapshots={systemHealthHistory}
            query={listQueries.systemHealthHistory}
            meta={listMeta.systemHealthHistory}
            onDraft={(patch) => updateListDraft("systemHealthHistory", patch)}
            onFilter={(event) => submitListFilters("systemHealthHistory", event)}
            onClear={() => clearListFilters("systemHealthHistory")}
            onPage={(page) => changeListPage("systemHealthHistory", page)}
            onExport={() => exportFilteredList("systemHealthHistory")}
          />
        )}
        {view === "capabilities" && (
          <CapabilitiesView
            capabilities={adminCapabilities}
            onRefresh={() => refresh("capabilities")}
            onOpenTarget={openCapabilityTarget}
          />
        )}
        {view === "users" && (
          <UsersView
            users={users}
            selectedUser={selectedUser}
            query={listQueries.users}
            meta={listMeta.users}
            onCreate={createUser}
            onStatus={setUserStatus}
            onUpdate={updateUserProfile}
            onRoles={setUserRoles}
            onDetail={openUserDetail}
            onCloseDetail={() => setSelectedUser(null)}
            onOpenWallet={openWalletCandidate}
            onOpenWalletTransaction={openWalletTransactionCandidate}
            onOpenOrder={openOrderCandidate}
            onOpenRental={openRentalCandidate}
            onOpenApiKey={openApiKeyCandidate}
            onOpenResource={openResourceCandidate}
            onOpenWithdrawal={openWithdrawalCandidate}
            onDraft={(patch) => updateListDraft("users", patch)}
            onFilter={(event) => submitListFilters("users", event)}
            onClear={() => clearListFilters("users")}
            onPage={(page) => changeListPage("users", page)}
            onExport={() => exportFilteredList("users")}
          />
        )}
        {view === "wallets" && (
          <WalletsView
            wallets={wallets}
            selectedWallet={selectedWallet}
            users={users}
            query={listQueries.wallets}
            meta={listMeta.wallets}
            onAdjust={adjustWallet}
            onDetail={openWalletDetail}
            onCloseDetail={() => setSelectedWallet(null)}
            onOpenUser={openUserCandidate}
            onOpenWalletTransaction={openWalletTransactionCandidate}
            onOpenOrder={openOrderCandidate}
            onOpenUsage={openUsageCandidate}
            onOpenWithdrawal={openWithdrawalCandidate}
            onDraft={(patch) => updateListDraft("wallets", patch)}
            onFilter={(event) => submitListFilters("wallets", event)}
            onClear={() => clearListFilters("wallets")}
            onPage={(page) => changeListPage("wallets", page)}
            onExport={() => exportFilteredList("wallets")}
          />
        )}
        {view === "walletTransactions" && (
          <WalletTransactionsView
            transactions={walletTransactions}
            query={listQueries.walletTransactions}
            meta={listMeta.walletTransactions}
            onOpenWallet={openWalletCandidate}
            onOpenUser={openUserCandidate}
            onOpenOrder={openOrderCandidate}
            onOpenUsage={openUsageCandidate}
            onOpenWithdrawal={openWithdrawalCandidate}
            onDraft={(patch) => updateListDraft("walletTransactions", patch)}
            onFilter={(event) => submitListFilters("walletTransactions", event)}
            onClear={() => clearListFilters("walletTransactions")}
            onPage={(page) => changeListPage("walletTransactions", page)}
            onExport={() => exportFilteredList("walletTransactions")}
          />
        )}
        {view === "reconciliation" && (
          <ReconciliationView
            reconciliation={reconciliation}
            onRefresh={() => refresh("reconciliation")}
          />
        )}
        {view === "sales" && (
          <SalesView
            sales={sales}
            selectedOrder={selectedOrder}
            query={listQueries.sales}
            meta={listMeta.sales}
            onDetail={openOrderDetail}
            onCancel={cancelOrder}
            onRefund={refundOrder}
            onRetryProvision={retryProvisionOrder}
            onCloseDetail={() => setSelectedOrder(null)}
            onOpenSales={openSalesCandidate}
            onOpenUser={openUserCandidate}
            onOpenWalletTransaction={openWalletTransactionCandidate}
            onOpenProxyRequest={openProxyRequestCandidate}
            onOpenRental={openRentalCandidate}
            onOpenRentals={openRentalListCandidate}
            onOpenOrders={openOrderListCandidate}
            onOpenApiKey={openApiKeyCandidate}
            onOpenProduct={openProductCandidate}
            onOpenUsage={openUsageCandidate}
            onDraft={(patch) => updateListDraft("sales", patch)}
            onFilter={(event) => submitListFilters("sales", event)}
            onClear={() => clearListFilters("sales")}
            onPage={(page) => changeListPage("sales", page)}
            onExport={() => exportFilteredList("sales")}
          />
        )}
        {view === "usages" && (
          <UsagesView
            usages={usages}
            summary={usageSummary}
            syncState={usageSyncState}
            query={listQueries.usages}
            meta={listMeta.usages}
            onSync={syncSub2Usages}
            onOpenUser={openUserCandidate}
            onOpenOrder={openOrderCandidate}
            onOpenRental={openRentalCandidate}
            onOpenProduct={openProductCandidate}
            onOpenResource={openResourceCandidate}
            onOpenProxyRequest={openProxyRequestCandidate}
            onOpenSettlement={openSettlementCandidate}
            onDraft={(patch) => updateListDraft("usages", patch)}
            onFilter={(event) => submitListFilters("usages", event)}
            onClear={() => clearListFilters("usages")}
            onPage={(page) => changeListPage("usages", page)}
            onExport={() => exportFilteredList("usages")}
          />
        )}
        {view === "products" && (
          <ProductsView
            products={products}
            query={listQueries.products}
            meta={listMeta.products}
            onCreate={createProduct}
            onUpdate={updateProductConfig}
            onProductStatus={setProductStatus}
            onCreatePrice={createProductPrice}
            onUpdatePrice={updateProductPrice}
            onPriceStatus={setProductPriceStatus}
            onOpenSales={openSalesCandidate}
            onOpenOrders={openOrderListCandidate}
            onOpenRentals={openRentalListCandidate}
            onOpenUsage={openUsageCandidate}
            onOpenProxyRequest={openProxyRequestCandidate}
            onDraft={(patch) => updateListDraft("products", patch)}
            onFilter={(event) => submitListFilters("products", event)}
            onClear={() => clearListFilters("products")}
            onPage={(page) => changeListPage("products", page)}
            onExport={() => exportFilteredList("products")}
          />
        )}
        {view === "orders" && (
          <OrdersView
            orders={orders}
            selectedOrder={selectedOrder}
            query={listQueries.orders}
            meta={listMeta.orders}
            onDetail={openOrderDetail}
            onCancel={cancelOrder}
            onRefund={refundOrder}
            onRetryProvision={retryProvisionOrder}
            onCloseDetail={() => setSelectedOrder(null)}
            onOpenUser={openUserCandidate}
            onOpenWalletTransaction={openWalletTransactionCandidate}
            onOpenProxyRequest={openProxyRequestCandidate}
            onOpenRental={openRentalCandidate}
            onOpenApiKey={openApiKeyCandidate}
            onOpenProduct={openProductCandidate}
            onDraft={(patch) => updateListDraft("orders", patch)}
            onFilter={(event) => submitListFilters("orders", event)}
            onClear={() => clearListFilters("orders")}
            onPage={(page) => changeListPage("orders", page)}
            onExport={() => exportFilteredList("orders")}
          />
        )}
        {view === "rentals" && (
          <RentalsView
            rentals={rentals}
            selectedRental={selectedRental}
            query={listQueries.rentals}
            meta={listMeta.rentals}
            onDetail={openRentalDetail}
            onCloseDetail={() => setSelectedRental(null)}
            onRentalStatus={setRentalStatus}
            onUpdateLimits={updateRentalLimits}
            onApiKeyStatus={setApiKeyStatus}
            onRotateKey={rotateRentalKey}
            onExpireOverdue={expireOverdueRentals}
            onOpenUser={openUserCandidate}
            onOpenOrder={openOrderCandidate}
            onOpenProduct={openProductCandidate}
            onOpenApiKey={openApiKeyCandidate}
            onOpenUsage={openUsageCandidate}
            onOpenSettlement={openSettlementCandidate}
            onOpenProxyRequest={openProxyRequestCandidate}
            onDraft={(patch) => updateListDraft("rentals", patch)}
            onFilter={(event) => submitListFilters("rentals", event)}
            onClear={() => clearListFilters("rentals")}
            onPage={(page) => changeListPage("rentals", page)}
            onExport={() => exportFilteredList("rentals")}
          />
        )}
        {view === "apiKeys" && (
          <ApiKeysView
            apiKeys={apiKeys}
            query={listQueries.apiKeys}
            meta={listMeta.apiKeys}
            onStatus={setApiKeyStatus}
            onBulkStatus={bulkSetApiKeyStatus}
            onOpenUser={openUserCandidate}
            onOpenOrder={openOrderCandidate}
            onOpenRental={openRentalCandidate}
            onOpenProduct={openProductCandidate}
            onOpenProxyRequest={openProxyRequestCandidate}
            onOpenUsage={openUsageCandidate}
            onDraft={(patch) => updateListDraft("apiKeys", patch)}
            onFilter={(event) => submitListFilters("apiKeys", event)}
            onClear={() => clearListFilters("apiKeys")}
            onPage={(page) => changeListPage("apiKeys", page)}
            onExport={() => exportFilteredList("apiKeys")}
          />
        )}
        {view === "sub2" && (
          <Sub2StatusView
            status={sub2Status}
            tests={sub2Tests}
            smoke={sub2Smoke}
            bindings={sub2Bindings}
            repairContext={sub2RepairContext}
            onRefreshAccount={refreshSub2Account}
            onTestAccount={testSub2Account}
            onSmokeTest={runSub2SmokeTest}
            onCheckBindings={checkSub2Bindings}
            onRepairBindings={repairSub2Bindings}
            onApplyRefreshToken={applySub2RefreshToken}
          />
        )}
        {view === "proxyRequests" && (
          <ProxyRequestsView
            logs={proxyRequests}
            query={listQueries.proxyRequests}
            meta={listMeta.proxyRequests}
            onDraft={(patch) => updateListDraft("proxyRequests", patch)}
            onFilter={(event) => submitListFilters("proxyRequests", event)}
            onClear={() => clearListFilters("proxyRequests")}
            onPage={(page) => changeListPage("proxyRequests", page)}
            onExport={() => exportFilteredList("proxyRequests")}
            onCopyRequestId={copyProxyRequestId}
            onOpenUser={openUserCandidate}
            onOpenOrder={openOrderCandidate}
            onOpenRental={openRentalCandidate}
            onOpenApiKey={openApiKeyCandidate}
            onOpenProduct={openProductCandidate}
            onOpenUsage={openUsageCandidate}
          />
        )}
        {view === "suppliers" && (
          <SuppliersView
            suppliers={suppliers}
            query={listQueries.suppliers}
            meta={listMeta.suppliers}
            onUpdate={updateSupplierConfig}
            onOpenUser={openUserCandidate}
            onOpenResources={openResourcesCandidate}
            onOpenResource={openResourceCandidate}
            onOpenWithdrawal={openWithdrawalCandidate}
            onDraft={(patch) => updateListDraft("suppliers", patch)}
            onFilter={(event) => submitListFilters("suppliers", event)}
            onClear={() => clearListFilters("suppliers")}
            onPage={(page) => changeListPage("suppliers", page)}
            onExport={() => exportFilteredList("suppliers")}
          />
        )}
        {view === "resources" && (
          <ResourcesView
            resources={resources}
            selectedResource={selectedResource}
            createDefaults={resourceCreateDefaults}
            query={listQueries.resources}
            meta={listMeta.resources}
            onCreate={createResource}
            onUpdate={updateResourceConfig}
            onCredential={upsertResourceCredential}
            onDeleteCredential={deleteResourceCredential}
            onApplyCredentialToSub2={applyResourceCredentialToSub2}
            onStatus={setResourceStatus}
            onTest={testResource}
            onDetail={openResourceDetail}
            onCloseDetail={() => setSelectedResource(null)}
            onOpenUser={openUserCandidate}
            onOpenSub2Status={openSub2StatusCandidate}
            onOpenUsage={openUsageCandidate}
            onOpenSettlement={openSettlementCandidate}
            onOpenWithdrawal={openWithdrawalCandidate}
            onOpenRental={openRentalCandidate}
            onOpenProxyRequest={openProxyRequestCandidate}
            onDraft={(patch) => updateListDraft("resources", patch)}
            onFilter={(event) => submitListFilters("resources", event)}
            onClear={() => clearListFilters("resources")}
            onPage={(page) => changeListPage("resources", page)}
            onExport={() => exportFilteredList("resources")}
          />
        )}
        {view === "settlements" && (
          <SettlementsView
            settlements={settlements}
            query={listQueries.settlements}
            meta={listMeta.settlements}
            onReleaseAvailable={releaseAvailableSettlements}
            onOpenUser={openUserCandidate}
            onOpenResource={openResourceCandidate}
            onOpenUsage={openUsageCandidate}
            onOpenWithdrawal={openWithdrawalCandidate}
            onDraft={(patch) => updateListDraft("settlements", patch)}
            onFilter={(event) => submitListFilters("settlements", event)}
            onClear={() => clearListFilters("settlements")}
            onPage={(page) => changeListPage("settlements", page)}
            onExport={() => exportFilteredList("settlements")}
          />
        )}
        {view === "withdrawals" && (
          <WithdrawalsView
            withdrawals={withdrawals}
            summary={withdrawalSummary}
            query={listQueries.withdrawals}
            meta={listMeta.withdrawals}
            onCreate={createWithdrawal}
            onStatus={setWithdrawalStatus}
            onOpenUser={openUserCandidate}
            onOpenResource={openResourceCandidate}
            onOpenUsage={openUsageCandidate}
            onOpenSettlement={openSettlementCandidate}
            onDraft={(patch) => updateListDraft("withdrawals", patch)}
            onFilter={(event) => submitListFilters("withdrawals", event)}
            onClear={() => clearListFilters("withdrawals")}
            onPage={(page) => changeListPage("withdrawals", page)}
            onExport={() => exportFilteredList("withdrawals")}
          />
        )}
        {view === "audit" && (
          <AuditLogsView
            logs={auditLogs}
            query={listQueries.audit}
            meta={listMeta.audit}
            onOpenUser={openUserCandidate}
            onOpenWallet={openWalletCandidate}
            onOpenOrder={openOrderCandidate}
            onOpenRental={openRentalCandidate}
            onOpenApiKey={openApiKeyCandidate}
            onOpenUsage={openUsageCandidate}
            onOpenProduct={openProductCandidate}
            onOpenResource={openResourceCandidate}
            onOpenSettlement={openSettlementCandidate}
            onOpenWithdrawal={openWithdrawalCandidate}
            onOpenSub2Status={openSub2StatusCandidate}
            onOpenProxyRequest={openProxyRequestCandidate}
            onDraft={(patch) => updateListDraft("audit", patch)}
            onFilter={(event) => submitListFilters("audit", event)}
            onClear={() => clearListFilters("audit")}
            onPage={(page) => changeListPage("audit", page)}
            onExport={() => exportFilteredList("audit")}
          />
        )}
      </section>
    </main>
  );
}

interface ManagedListProps {
  query: ListQueryState;
  meta: PageMeta;
  onDraft: (patch: Partial<ListQueryState>) => void;
  onFilter: (event: FormEvent<HTMLFormElement>) => void;
  onClear: () => void;
  onPage: (page: number) => void;
  onExport?: () => void;
}

function DashboardView({
  dashboard,
  onOpenSystemHealth,
  onOpenView,
  onOpenHealthCheck,
  onOpenHealthResources,
  onOpenActiveRentals,
  onOpenOnlineResources,
  onOpenRechargeTransactions,
  onOpenConsumeTransactions,
  onOpenPendingWithdrawals
}: {
  dashboard: Dashboard | null;
  onOpenSystemHealth: () => void;
  onOpenView: (view: View) => void;
  onOpenHealthCheck: (check: DashboardHealthCheckPreview) => void;
  onOpenHealthResources: (check: DashboardHealthCheckPreview) => void;
  onOpenActiveRentals: () => void;
  onOpenOnlineResources: () => void;
  onOpenRechargeTransactions: () => void;
  onOpenConsumeTransactions: () => void;
  onOpenPendingWithdrawals: () => void;
}) {
  const latestHealth = dashboard?.latestSystemHealth ?? null;
  const criticalChecks = latestHealth?.criticalChecks ?? [];
  const cards: Array<{ label: string; value: string | number; icon: ReactElement; onClick: () => void }> = [
    { label: "用户数", value: dashboard?.users ?? 0, icon: <Users size={20} />, onClick: () => onOpenView("users") },
    { label: "有效租赁", value: dashboard?.activeRentals ?? 0, icon: <KeyRound size={20} />, onClick: onOpenActiveRentals },
    { label: "在线资源", value: dashboard?.onlineResources ?? 0, icon: <Boxes size={20} />, onClick: onOpenOnlineResources },
    { label: "售出金额", value: money(dashboard?.paidOrderAmount), icon: <TrendingUp size={20} />, onClick: () => onOpenView("sales") },
    { label: "可用余额", value: money(dashboard?.walletAvailable), icon: <WalletCards size={20} />, onClick: () => onOpenView("wallets") },
    { label: "累计充值", value: money(dashboard?.totalRecharged), icon: <CircleDollarSign size={20} />, onClick: onOpenRechargeTransactions },
    { label: "累计消费", value: money(dashboard?.totalSpent), icon: <BarChart3 size={20} />, onClick: onOpenConsumeTransactions },
    { label: "供给收益", value: money(dashboard?.supplierIncome), icon: <ShieldCheck size={20} />, onClick: () => onOpenView("settlements") }
  ];

  return (
    <>
      <section className="cards">
        {cards.map((card) => (
          <button className="metric-card" key={card.label} onClick={card.onClick}>
            <div className="metric-icon">{card.icon}</div>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </button>
        ))}
      </section>
      <section className="content-grid">
        <div className="panel glass-panel">
          <span className="eyebrow">Settlement</span>
          <h2>经营摘要</h2>
          <table>
            <tbody>
              <tr><td>待提现</td><td><button className="secondary mini" onClick={onOpenPendingWithdrawals}>{dashboard?.pendingWithdrawals ?? 0}</button></td></tr>
              <tr><td>订单数</td><td><button className="secondary mini" onClick={() => onOpenView("orders")}>{dashboard?.paidOrderCount ?? 0}</button></td></tr>
              <tr><td>用量记录</td><td><button className="secondary mini" onClick={() => onOpenView("usages")}>{dashboard?.usageCount ?? 0}</button></td></tr>
              <tr><td>按量 GMV</td><td><button className="secondary mini" onClick={() => onOpenView("sales")}>{money(dashboard?.gmv)}</button></td></tr>
            </tbody>
          </table>
        </div>
        <div className="panel glass-panel">
          <span className="eyebrow">Risk Signal</span>
          <h2>系统状态</h2>
          {latestHealth ? (
            <>
              <div className={latestHealth.stale ? "health-row warning" : healthRowClass(latestHealth.status)}>
                {latestHealth.status === "ok" && !latestHealth.stale ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                <strong>{latestHealth.stale ? `${healthStatusText(latestHealth.status)} / 快照过期` : healthStatusText(latestHealth.status)}</strong>
              </div>
              <table>
                <tbody>
                  <tr><td>最近巡检</td><td>{dateTime(latestHealth.createdAt)} / {dashboardSnapshotAgeText(latestHealth.ageMinutes)}</td></tr>
                  <tr><td>快照状态</td><td>{dashboardSnapshotFreshnessText(latestHealth)}</td></tr>
                  <tr><td>来源</td><td>{latestHealth.source}</td></tr>
                  <tr><td>摘要</td><td>{latestHealth.summary.ok ?? 0} ok / {latestHealth.summary.warning ?? 0} warning / {latestHealth.summary.error ?? 0} error</td></tr>
                </tbody>
              </table>
              {criticalChecks.length > 0 && (
                <div className="dashboard-health-list">
                  {criticalChecks.map((check) => {
                    const target = dashboardHealthCheckTarget(check);
                    const context = dashboardHealthPreviewContext(check);
                    const resourceRepairTarget = dashboardHealthCanOpenResourceRepair(check);
                    return (
                      <div className="dashboard-health-item" key={check.id}>
                        <div className={healthRowClass(check.status)}>
                          {check.status === "ok" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                          <strong>{check.label}</strong>
                        </div>
                        <p>{check.summary}</p>
                        {context && <small>{context}</small>}
                        <div className="health-preview-actions">
                          {(check.issueCount > 0 || check.sampleCount > 0) && (
                            <small>{check.issueCount} issue / {check.sampleCount} sample</small>
                          )}
                          {target && (
                            <button className="secondary mini" onClick={() => onOpenHealthCheck(check)}>
                              <ChevronRight size={14} />{target.label}
                            </button>
                          )}
                          {resourceRepairTarget && (
                            <button className="secondary mini" onClick={() => onOpenHealthResources(check)}>
                              <ChevronRight size={14} />打开共享资源
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="actions left">
                <button className="secondary" onClick={onOpenSystemHealth}><Activity size={16} />打开巡检</button>
              </div>
            </>
          ) : (
            <div className="health-row warning"><AlertTriangle size={18} />尚无巡检快照</div>
          )}
        </div>
      </section>
    </>
  );
}

function SystemHealthView({ health, maintenance, snapshots, onRefresh, onRunMaintenance, onOpenResources, onOpenResource, onOpenProxyRequest, onOpenWallets, onOpenWalletTransactions, onOpenWalletTransaction, onOpenSales, onOpenUser, onOpenWallet, onOpenOrder, onOpenRental, onOpenApiKey, onOpenUsage, onOpenProduct, onOpenSettlement, onOpenWithdrawal, onOpenSub2Status, onOpenAuditLog }: {
  health: SystemHealthResult | null;
  maintenance: SystemMaintenanceResult | null;
  snapshots: SystemHealthSnapshotRow[];
  onRefresh: () => void;
  onRunMaintenance: () => void;
  onOpenResources: (filter?: ResourceCreateDefaults & { status?: string; scope?: string }) => void;
  onOpenResource: (resourceId: string) => void;
  onOpenProxyRequest: (lookup: string) => void;
  onOpenWallets: () => void;
  onOpenWalletTransactions: (filter?: { type?: string }) => void;
  onOpenWalletTransaction: (lookup: string) => void;
  onOpenSales: () => void;
  onOpenUser: (userId: string) => void;
  onOpenWallet: (lookup: string) => void;
  onOpenOrder: (orderId: string) => void;
  onOpenRental: (rentalId: string) => void;
  onOpenApiKey: (lookup: string) => void;
  onOpenUsage: (lookup: string) => void;
  onOpenProduct: (lookup: string) => void;
  onOpenSettlement: (lookup: string) => void;
  onOpenWithdrawal: (lookup: string) => void;
  onOpenSub2Status: (context?: string | Sub2RepairContext) => void;
  onOpenAuditLog: (lookup: string) => void;
}) {
  const checks = health?.checks ?? [];
  const issueRows = checks.flatMap(systemHealthIssueRows);
  const sampleRows = checks.flatMap(systemHealthSampleRows);
  return (
    <section className="stack">
      <div className="panel glass-panel export-strip">
        <div>
          <span className="eyebrow">System health</span>
          <div className={health?.status === "ok" ? "health-row" : "health-row warning"}>
            {health?.status === "ok" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            <strong>{health ? healthStatusText(health.status) : "等待巡检"}</strong>
          </div>
          {health && <small>检查时间 {dateTime(health.checkedAt)}</small>}
        </div>
        <div className="row-actions">
          <button className="secondary" onClick={onRefresh}><RefreshCw size={16} />重新巡检</button>
          <button className="secondary" onClick={onRunMaintenance}><ShieldCheck size={16} />运行安全维护</button>
        </div>
      </div>
      {maintenance && (
        <div className="panel glass-panel">
          <span className="eyebrow">Last maintenance</span>
          <div className="diagnostic-grid">
            <div><span>过期租赁</span><strong>{maintenance.actions.expireOverdueRentals?.expired ?? 0}</strong></div>
            <div><span>异常 Key</span><strong>{maintenance.actions.deactivateInvalidProxyApiKeys?.deactivated ?? 0}</strong></div>
            <div><span>释放结算</span><strong>{maintenance.actions.releaseAvailableSettlements?.released ?? 0}</strong></div>
            <div><span>用量同步</span><strong>{maintenance.actions.syncSub2Usage ? maintenance.actions.syncSub2Usage.ok ? `${maintenance.actions.syncSub2Usage.imported ?? 0}/${maintenance.actions.syncSub2Usage.recovered ?? 0}` : "失败" : "-"}</strong></div>
            <div><span>修复绑定</span><strong>{(maintenance.actions.repairSub2Bindings?.userBindingsUpserted ?? 0) + (maintenance.actions.repairSub2Bindings?.apiKeyBindingsUpserted ?? 0)}</strong></div>
            <div><span>清理自检</span><strong>{maintenance.actions.cleanupSmokeData?.rentalsClosed ?? 0}</strong></div>
            <div><span>自检 Key</span><strong>{maintenance.actions.cleanupSmokeData ? `${maintenance.actions.cleanupSmokeData.sub2KeysDisabled}/${maintenance.actions.cleanupSmokeData.sub2KeysDisableAttempted}` : "-"}</strong></div>
            <div><span>完成时间</span><strong>{dateTime(maintenance.finishedAt)}</strong></div>
          </div>
        </div>
      )}
      <section className="cards compact-cards">
        <Metric label="检查项" value={health?.summary.totalChecks ?? 0} />
        <Metric label="正常" value={health?.summary.ok ?? 0} />
        <Metric label="警告" value={health?.summary.warning ?? 0} />
        <Metric label="错误" value={health?.summary.error ?? 0} />
      </section>
      <TablePanel title="可用性检查项" count={checks.length} headers={["状态", "检查项", "结论", "关键指标"]}>
        {checks.map((check) => (
          <tr key={check.id}>
            <td><StatusPill status={healthStatusTone(check.status)} /></td>
            <td><strong>{check.label}</strong><small>{check.id}</small></td>
            <td><small>{check.summary}</small></td>
            <td><small>{healthMetricSummary(check.metrics)}</small></td>
          </tr>
        ))}
        {!health && (
          <tr>
            <td colSpan={4}><small>点击重新巡检开始读取系统健康信号。</small></td>
          </tr>
        )}
      </TablePanel>
      <TablePanel title="巡检问题样本" count={issueRows.length} headers={["级别", "检查项", "类型", "对象", "说明", "操作"]}>
        {issueRows.map((issue) => (
          <tr key={`${issue.checkId}-${issue.id}`}>
            <td><StatusPill status={healthIssueTone(issue.severity)} /></td>
            <td><strong>{issue.checkLabel}</strong><small>{issue.checkId}</small></td>
            <td><small>{issue.type}</small></td>
            <td><small>{issue.ref}</small></td>
            <td><small>{issue.message}</small></td>
            <td>
              <div className="row-actions">
                {issue.proxyRequestLookup && <button className="secondary mini" onClick={() => onOpenProxyRequest(issue.proxyRequestLookup!)}>打开反代请求</button>}
                {issue.sub2Status && <button className="secondary mini" onClick={() => onOpenSub2Status(systemHealthIssueSub2RepairContext(issue))}>打开反代状态</button>}
                {issue.resourceList && <button className="secondary mini" onClick={() => onOpenResources({ supplierEmail: issue.supplierEmail, resourceType: issue.resourceType, status: issue.resourceStatus, scope: issue.resourceScope, sub2AccountId: issue.sub2AccountId, sub2AccountName: issue.sub2AccountName, accountStatus: issue.accountStatus, credentialsStatus: issue.credentialsStatus, schedulable: issue.schedulable, tempUnschedulableReason: issue.tempUnschedulableReason, accountMessage: issue.accountMessage, accountUpdatedAt: issue.accountUpdatedAt, repairAction: issue.repairAction, productId: issue.productId, productName: issue.productName, priceId: issue.priceId, model: issue.model, responsesOk: issue.responsesOk, localProxyOk: issue.localProxyOk, smokeTestSkippedReason: issue.smokeTestSkippedReason, proxyRequestPath: issue.proxyRequestPath, proxyRequestStatusCode: issue.proxyRequestStatusCode, proxyRequestErrorCode: issue.proxyRequestErrorCode, ageMinutes: issue.ageMinutes, stale: issue.stale, staleThresholdMinutes: issue.staleThresholdMinutes, freshMinutesRemaining: issue.freshMinutesRemaining, staleAt: issue.staleAt })}>打开共享资源</button>}
                {issue.resourceId && <button className="secondary mini" onClick={() => onOpenResource(issue.resourceId!)}>打开资源</button>}
                {issue.orderId && <button className="secondary mini" onClick={() => onOpenOrder(issue.orderId!)}>打开订单</button>}
                {issue.rentalId && <button className="secondary mini" onClick={() => onOpenRental(issue.rentalId!)}>打开租赁</button>}
                {issue.userId && <button className="secondary mini" onClick={() => onOpenUser(issue.userId!)}>打开用户</button>}
                {issue.walletList && <button className="secondary mini" onClick={onOpenWallets}>打开余额列表</button>}
                {issue.walletTransactionList && <button className="secondary mini" onClick={() => onOpenWalletTransactions({ type: issue.walletTransactionType })}>打开余额流水</button>}
                {issue.walletTransactionLookup && <button className="secondary mini" onClick={() => onOpenWalletTransaction(issue.walletTransactionLookup!)}>打开流水</button>}
                {issue.salesList && <button className="secondary mini" onClick={onOpenSales}>打开售出情况</button>}
                {issue.walletLookup && <button className="secondary mini" onClick={() => onOpenWallet(issue.walletLookup!)}>打开余额</button>}
                {issue.apiKeyLookup && <button className="secondary mini" onClick={() => onOpenApiKey(issue.apiKeyLookup!)}>打开 Key</button>}
                {issue.usageLookup && <button className="secondary mini" onClick={() => onOpenUsage(issue.usageLookup!)}>打开用量</button>}
                {issue.productLookup && <button className="secondary mini" onClick={() => onOpenProduct(issue.productLookup!)}>打开商品</button>}
                {issue.settlementLookup && <button className="secondary mini" onClick={() => onOpenSettlement(issue.settlementLookup!)}>打开结算</button>}
                {issue.withdrawalLookup && <button className="secondary mini" onClick={() => onOpenWithdrawal(issue.withdrawalLookup!)}>打开提现</button>}
                {issue.auditLogLookup && <button className="secondary mini" onClick={() => onOpenAuditLog(issue.auditLogLookup!)}>打开审计</button>}
                {!systemHealthIssueHasAction(issue) && <small>-</small>}
              </div>
            </td>
          </tr>
        ))}
        {health && issueRows.length === 0 && (
          <tr><td colSpan={6}><small>暂无巡检问题样本。</small></td></tr>
        )}
        {!health && (
          <tr><td colSpan={6}><small>点击重新巡检开始读取问题样本。</small></td></tr>
        )}
      </TablePanel>
      {sampleRows.length > 0 && (
        <TablePanel title="巡检候选样本" count={sampleRows.length} headers={["检查项", "对象", "摘要", "操作"]}>
          {sampleRows.map((sample) => (
            <tr key={`${sample.checkId}-${sample.id}`}>
              <td><strong>{sample.checkLabel}</strong><small>{sample.checkId}</small></td>
              <td><small>{sample.ref}</small></td>
              <td><small>{sample.summary}</small></td>
              <td>
                <div className="row-actions">
                  {sample.proxyRequestLookup && <button className="secondary mini" onClick={() => onOpenProxyRequest(sample.proxyRequestLookup!)}>打开反代请求</button>}
                  {sample.resourceList && <button className="secondary mini" onClick={() => onOpenResources({ supplierEmail: sample.supplierEmail, resourceType: sample.resourceType, status: sample.resourceStatus, scope: sample.resourceScope, sub2AccountId: sample.sub2AccountId, sub2AccountName: sample.sub2AccountName, accountStatus: sample.accountStatus, credentialsStatus: sample.credentialsStatus, schedulable: sample.schedulable, tempUnschedulableReason: sample.tempUnschedulableReason, accountMessage: sample.accountMessage, accountUpdatedAt: sample.accountUpdatedAt, repairAction: sample.repairAction, productId: sample.productId, productName: sample.productName, priceId: sample.priceId, model: sample.model, responsesOk: sample.responsesOk, localProxyOk: sample.localProxyOk, smokeTestSkippedReason: sample.smokeTestSkippedReason, proxyRequestPath: sample.proxyRequestPath, proxyRequestStatusCode: sample.proxyRequestStatusCode, proxyRequestErrorCode: sample.proxyRequestErrorCode, ageMinutes: sample.ageMinutes, stale: sample.stale, staleThresholdMinutes: sample.staleThresholdMinutes, freshMinutesRemaining: sample.freshMinutesRemaining, staleAt: sample.staleAt })}>打开共享资源</button>}
                  {sample.resourceId && <button className="secondary mini" onClick={() => onOpenResource(sample.resourceId!)}>打开资源</button>}
                  {sample.sub2Status && <button className="secondary mini" onClick={() => onOpenSub2Status(systemHealthSampleSub2RepairContext(sample))}>打开反代状态</button>}
                  {sample.orderId && <button className="secondary mini" onClick={() => onOpenOrder(sample.orderId!)}>打开订单</button>}
                  {sample.rentalId && <button className="secondary mini" onClick={() => onOpenRental(sample.rentalId!)}>打开租赁</button>}
                  {sample.userId && <button className="secondary mini" onClick={() => onOpenUser(sample.userId!)}>打开用户</button>}
                  {sample.walletList && <button className="secondary mini" onClick={onOpenWallets}>打开余额列表</button>}
                  {sample.walletTransactionList && <button className="secondary mini" onClick={() => onOpenWalletTransactions({ type: sample.walletTransactionType })}>打开余额流水</button>}
                  {sample.walletTransactionLookup && <button className="secondary mini" onClick={() => onOpenWalletTransaction(sample.walletTransactionLookup!)}>打开流水</button>}
                  {sample.salesList && <button className="secondary mini" onClick={onOpenSales}>打开售出情况</button>}
                  {sample.walletLookup && <button className="secondary mini" onClick={() => onOpenWallet(sample.walletLookup!)}>打开余额</button>}
                  {sample.apiKeyLookup && <button className="secondary mini" onClick={() => onOpenApiKey(sample.apiKeyLookup!)}>打开 Key</button>}
                  {sample.usageLookup && <button className="secondary mini" onClick={() => onOpenUsage(sample.usageLookup!)}>打开用量</button>}
                  {sample.productLookup && <button className="secondary mini" onClick={() => onOpenProduct(sample.productLookup!)}>打开商品</button>}
                  {sample.settlementLookup && <button className="secondary mini" onClick={() => onOpenSettlement(sample.settlementLookup!)}>打开结算</button>}
                  {sample.withdrawalLookup && <button className="secondary mini" onClick={() => onOpenWithdrawal(sample.withdrawalLookup!)}>打开提现</button>}
                  {sample.auditLogLookup && <button className="secondary mini" onClick={() => onOpenAuditLog(sample.auditLogLookup!)}>打开审计</button>}
                  {!systemHealthSampleHasAction(sample) && <small>-</small>}
                </div>
              </td>
            </tr>
          ))}
        </TablePanel>
      )}
      <TablePanel title="巡检历史" count={snapshots.length} headers={["状态", "来源", "摘要", "操作者", "时间"]}>
        {snapshots.map((snapshot) => (
          <tr key={snapshot.id}>
            <td><StatusPill status={healthStatusTone(snapshot.status)} /></td>
            <td><strong>{snapshot.source}</strong><small>{snapshot.id}</small></td>
            <td>
              <strong>{snapshot.summary.ok ?? 0} ok / {snapshot.summary.warning ?? 0} warning / {snapshot.summary.error ?? 0} error</strong>
              <small>{snapshot.summary.totalChecks ?? 0} checks</small>
            </td>
            <td><strong>{snapshot.actor?.email ?? "-"}</strong><small>{snapshot.actor?.displayName ?? snapshot.actor?.id ?? "-"}</small></td>
            <td>{dateTime(snapshot.createdAt)}</td>
          </tr>
        ))}
        {snapshots.length === 0 && (
          <tr><td colSpan={5}><small>暂无巡检历史。</small></td></tr>
        )}
      </TablePanel>
    </section>
  );
}

function SystemHealthHistoryView({ snapshots, query, meta, onDraft, onFilter, onClear, onPage, onExport }: {
  snapshots: SystemHealthSnapshotRow[];
} & ManagedListProps) {
  return (
    <section className="stack">
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="快照 / 来源 / 操作者"
        statusOptions={systemHealthStatusOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="巡检历史" count={meta.total} headers={["状态", "来源", "摘要", "操作者", "时间"]}>
        {snapshots.map((snapshot) => (
          <tr key={snapshot.id}>
            <td><StatusPill status={healthStatusTone(snapshot.status)} /></td>
            <td><strong>{snapshot.source}</strong><small>{snapshot.id}</small></td>
            <td>
              <strong>{snapshot.summary.ok ?? 0} ok / {snapshot.summary.warning ?? 0} warning / {snapshot.summary.error ?? 0} error</strong>
              <small>{snapshot.summary.totalChecks ?? 0} checks</small>
            </td>
            <td><strong>{snapshot.actor?.email ?? "-"}</strong><small>{snapshot.actor?.displayName ?? snapshot.actor?.id ?? "-"}</small></td>
            <td>{dateTime(snapshot.createdAt)}</td>
          </tr>
        ))}
        {snapshots.length === 0 && (
          <tr><td colSpan={5}><small>暂无巡检历史。</small></td></tr>
        )}
      </TablePanel>
    </section>
  );
}

function CapabilitiesView({ capabilities, onRefresh, onOpenTarget }: {
  capabilities: AdminCapabilitiesResult | null;
  onRefresh: () => void;
  onOpenTarget: (target: AdminCapabilityNavigationTarget, operation: AdminCapabilityOperation) => void;
}) {
  const coverage = capabilities?.coverage;
  const areas = capabilities?.capabilities ?? [];
  const summary = coverage?.summary;
  return (
    <section className="stack">
      <div className="panel glass-panel export-strip">
        <div>
          <span className="eyebrow">Admin capabilities</span>
          <div className={coverage?.ok ? "health-row" : "health-row warning"}>
            {coverage?.ok ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            <strong>{coverage ? coverage.ok ? "能力覆盖完整" : "能力覆盖缺失" : "等待读取能力矩阵"}</strong>
          </div>
          <small>用户、共享、余额、售出和 OpenAI/Codex 反代管理范围的 API 路由覆盖。</small>
        </div>
        <div className="row-actions">
          <button className="secondary" onClick={onRefresh}><RefreshCw size={16} />刷新矩阵</button>
        </div>
      </div>
      <section className="cards compact-cards">
        <Metric label="核心范围" value={`${summary?.coveredRequiredAreas ?? 0}/${summary?.requiredAreas ?? 0}`} />
        <Metric label="声明操作" value={summary?.totalOperations ?? 0} />
        <Metric label="关键操作" value={summary?.criticalOperations ?? 0} />
        <Metric label="已注册" value={summary?.registeredOperations ?? 0} />
        <Metric label="缺失路由" value={summary?.missingRoutes ?? 0} />
        <Metric label="可达入口" value={`${summary?.operationsWithTargets ?? 0}/${summary?.totalOperations ?? 0}`} />
      </section>
      {coverage && coverage.issues.length > 0 && (
        <TablePanel title="能力覆盖问题" count={coverage.issues.length} headers={["级别", "范围", "操作", "路由", "说明"]}>
          {coverage.issues.map((issue) => (
            <tr key={issue.id}>
              <td><StatusPill status="error" /></td>
              <td><small>{issue.areaId ?? "-"}</small></td>
              <td><strong>{issue.operationId ?? issue.type}</strong><small>{issue.id}</small></td>
              <td><small>{[issue.method, issue.path].filter(Boolean).join(" ") || "-"}</small></td>
              <td><small>{issue.message} 建议：{issue.actionHint}</small></td>
            </tr>
          ))}
        </TablePanel>
      )}
      {areas.map((area) => (
        <TablePanel
          key={area.id}
          title={`${area.label}${area.required ? " / required" : ""}`}
          count={area.operations.length}
          headers={["范围", "操作", "方法", "路径", "角色", "级别", "入口"]}
        >
          {area.operations.map((operation) => {
            const target = operation.target;
            return (
              <tr key={operation.id}>
                <td><strong>{area.id}</strong><small>{area.required ? "required" : "optional"}</small></td>
                <td><strong>{operation.label}</strong><small>{operation.id}</small></td>
                <td><small>{operation.method}</small></td>
                <td><small>{operation.path}</small></td>
                <td><small>{operation.roles.join(", ")}</small></td>
                <td><StatusPill status={operation.critical ? "warning" : "active"} /></td>
                <td>
                  {target
                    ? <button className="secondary mini" onClick={() => onOpenTarget(target, operation)}>{target.label}</button>
                    : <small>-</small>}
                </td>
              </tr>
            );
          })}
        </TablePanel>
      ))}
      {!capabilities && (
        <div className="panel glass-panel">
          <div className="health-row warning"><AlertTriangle size={18} />尚未读取能力矩阵</div>
        </div>
      )}
    </section>
  );
}

function UsersView({ users, selectedUser, query, meta, onCreate, onStatus, onUpdate, onRoles, onDetail, onCloseDetail, onOpenWallet, onOpenWalletTransaction, onOpenOrder, onOpenRental, onOpenApiKey, onOpenResource, onOpenWithdrawal, onDraft, onFilter, onClear, onPage, onExport }: {
  users: UserRow[];
  selectedUser: UserDetailRow | null;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onStatus: (userId: string, status: UserStatus) => void;
  onUpdate: (event: FormEvent<HTMLFormElement>, userId: string) => void;
  onRoles: (userId: string, roles: string[]) => void;
  onDetail: (userId: string) => void;
  onCloseDetail: () => void;
  onOpenWallet: (lookup: string) => void;
  onOpenWalletTransaction: (lookup: string) => void;
  onOpenOrder: (orderId: string) => void;
  onOpenRental: (rentalId: string) => void;
  onOpenApiKey: (lookup: string) => void;
  onOpenResource: (resourceId: string) => void;
  onOpenWithdrawal: (withdrawalId: string) => void;
} & ManagedListProps) {
  return (
    <section className="stack">
      <form className="panel glass-panel inline-form" onSubmit={onCreate}>
        <span className="eyebrow">Create user</span>
        <input name="email" type="email" placeholder="邮箱" required />
        <input name="displayName" placeholder="显示名称" />
        <input name="password" type="password" placeholder="初始密码" minLength={8} required />
        <input name="roles" placeholder="角色，逗号分隔" defaultValue="buyer" />
        <button>创建用户</button>
      </form>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="email / user id / role"
        statusOptions={userStatusOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="用户管理" count={meta.total} headers={["邮箱", "角色", "状态", "余额", "订单/租赁", "操作"]}>
        {users.map((user) => (
          <tr key={user.id}>
            <td><strong>{user.email}</strong><small>{user.displayName ?? user.id}</small></td>
            <td>{user.roles.map((role) => role.role).join(", ")}</td>
            <td><StatusPill status={user.status} /></td>
            <td>{money(user.wallet?.availableBalance)}</td>
            <td>{user._count?.orders ?? 0} / {user._count?.rentals ?? 0}</td>
            <td>
              <div className="row-actions">
                <button className="secondary mini" onClick={() => onDetail(user.id)}>详情</button>
                <button className="secondary mini" onClick={() => onStatus(user.id, "active")}>启用</button>
                <button className="secondary mini" onClick={() => onStatus(user.id, "disabled")}>禁用</button>
                <button className="danger mini" onClick={() => onStatus(user.id, "banned")}>封禁</button>
              </div>
            </td>
          </tr>
        ))}
      </TablePanel>
      {selectedUser && (
        <UserDetailPanel
          user={selectedUser}
          onUpdate={onUpdate}
          onRoles={onRoles}
          onClose={onCloseDetail}
          onOpenWallet={onOpenWallet}
          onOpenWalletTransaction={onOpenWalletTransaction}
          onOpenOrder={onOpenOrder}
          onOpenRental={onOpenRental}
          onOpenApiKey={onOpenApiKey}
          onOpenResource={onOpenResource}
          onOpenWithdrawal={onOpenWithdrawal}
        />
      )}
    </section>
  );
}

function UserDetailPanel({ user, onUpdate, onRoles, onClose, onOpenWallet, onOpenWalletTransaction, onOpenOrder, onOpenRental, onOpenApiKey, onOpenResource, onOpenWithdrawal }: {
  user: UserDetailRow;
  onUpdate: (event: FormEvent<HTMLFormElement>, userId: string) => void;
  onRoles: (userId: string, roles: string[]) => void;
  onClose: () => void;
  onOpenWallet: (lookup: string) => void;
  onOpenWalletTransaction: (lookup: string) => void;
  onOpenOrder: (orderId: string) => void;
  onOpenRental: (rentalId: string) => void;
  onOpenApiKey: (lookup: string) => void;
  onOpenResource: (resourceId: string) => void;
  onOpenWithdrawal: (withdrawalId: string) => void;
}) {
  const transactions = user.wallet?.transactions ?? [];
  const orders = user.orders ?? [];
  const rentals = user.rentals ?? [];
  const resources = user.supplier?.resources ?? [];
  const withdrawals = user.supplier?.withdrawals ?? [];
  const identities = user.identities ?? [];
  const apiKeys = user.apiKeys ?? [];

  return (
    <section className="panel glass-panel wide detail-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">User Detail</span>
          <h2>{user.email}</h2>
        </div>
        <div className="row-actions">
          <StatusPill status={user.status} />
          {user.wallet?.id && <button className="secondary mini" onClick={() => onOpenWallet(user.wallet!.id)}>打开余额</button>}
          <button className="secondary mini" onClick={onClose}>关闭</button>
        </div>
      </div>

      <div className="diagnostic-grid">
        <div><span>用户 ID</span><strong>{user.id}</strong></div>
        <div><span>显示名</span><strong>{user.displayName ?? "-"}</strong></div>
        <div><span>手机号</span><strong>{user.phone ?? "-"}</strong></div>
        <div><span>角色</span><strong>{user.roles.map((role) => role.role).join(", ") || "-"}</strong></div>
        <div><span>可用余额</span><strong>{money(user.wallet?.availableBalance)}</strong></div>
        <div><span>累计消费</span><strong>{money(user.wallet?.totalSpent)}</strong></div>
        <div><span>订单 / 租赁</span><strong>{orders.length} / {rentals.length}</strong></div>
        <div><span>API Key</span><strong>{apiKeys.length}</strong></div>
        <div><span>供给资源</span><strong>{resources.length}</strong></div>
        <div><span>创建时间</span><strong>{dateTime(user.createdAt)}</strong></div>
      </div>

      <form className="inline-form" key={`${user.id}-${user.updatedAt ?? ""}-profile`} onSubmit={(event) => onUpdate(event, user.id)}>
        <span className="eyebrow">Profile</span>
        <input name="displayName" defaultValue={user.displayName ?? ""} placeholder="显示名称，留空清除" />
        <input name="phone" defaultValue={user.phone ?? ""} placeholder="手机号，留空清除" />
        <input name="password" type="password" minLength={8} placeholder="新密码，可选" autoComplete="new-password" />
        <button>保存资料</button>
      </form>

      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const roles = String(form.get("roles") || "")
            .split(",")
            .map((role) => role.trim())
            .filter(Boolean);
          onRoles(user.id, roles);
        }}
      >
        <span className="eyebrow">Roles</span>
        <input name="roles" defaultValue={user.roles.map((role) => role.role).join(", ")} />
        <button>Update roles</button>
      </form>

      <section className="detail-grid">
        <DetailBlock title="最近钱包流水">
          <MiniTable headers={["类型", "金额", "余额后", "引用", "时间", "操作"]}>
            {transactions.slice(0, 8).map((transaction) => (
              <tr key={transaction.id}>
                <td><StatusPill status={transaction.type} /></td>
                <td>{money(transaction.amount)}</td>
                <td>{money(transaction.balanceAfter)}</td>
                <td><strong>{transaction.refType ?? "-"}</strong><small>{transaction.refId ?? "-"}</small></td>
                <td>{dateTime(transaction.createdAt)}</td>
                <td><button className="secondary mini" onClick={() => onOpenWalletTransaction(transaction.id)}>打开</button></td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="最近订单">
          <MiniTable headers={["订单", "状态", "金额", "租赁", "时间", "操作"]}>
            {orders.slice(0, 8).map((order) => (
              <tr key={order.id}>
                <td><small>{order.id}</small></td>
                <td><StatusPill status={order.status} /></td>
                <td>{money(order.paidAmount)} / {money(order.totalAmount)}</td>
                <td>{order.rentals?.length ?? 0}</td>
                <td>{dateTime(order.createdAt)}</td>
                <td><button className="secondary mini" onClick={() => onOpenOrder(order.id)}>打开</button></td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="最近租赁">
          <MiniTable headers={["租赁", "资源", "状态", "Endpoint", "到期", "操作"]}>
            {rentals.slice(0, 8).map((rental) => (
              <tr key={rental.id}>
                <td><small>{rental.id}</small></td>
                <td>{rental.product?.name ?? rental.resourceType}</td>
                <td><StatusPill status={rental.status} /></td>
                <td><small>{rental.endpointUrl ?? "-"}</small></td>
                <td>{dateTime(rental.endsAt)}</td>
                <td><button className="secondary mini" onClick={() => onOpenRental(rental.id)}>打开</button></td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="API Key">
          <MiniTable headers={["名称", "前缀", "状态", "最近使用", "创建", "操作"]}>
            {apiKeys.slice(0, 8).map((apiKey) => (
              <tr key={apiKey.id}>
                <td>{apiKey.name}</td>
                <td><small>{apiKey.keyPrefix}</small></td>
                <td><StatusPill status={apiKey.status} /></td>
                <td>{dateTime(apiKey.lastUsedAt)}</td>
                <td>{dateTime(apiKey.createdAt)}</td>
                <td><button className="secondary mini" onClick={() => onOpenApiKey(apiKey.id)}>打开</button></td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="供给资源">
          <MiniTable headers={["资源", "状态", "等级", "Sub2 账号", "更新时间", "操作"]}>
            {resources.slice(0, 8).map((resource) => (
              <tr key={resource.id}>
                <td>{resource.resourceType}</td>
                <td><StatusPill status={resource.status} /></td>
                <td>{resource.level}</td>
                <td><small>{resource.sub2AccountId ?? "-"}</small></td>
                <td>{dateTime(resource.updatedAt)}</td>
                <td><button className="secondary mini" onClick={() => onOpenResource(resource.id)}>打开</button></td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="提现记录">
          <MiniTable headers={["金额", "状态", "引用", "备注", "创建", "操作"]}>
            {withdrawals.slice(0, 8).map((withdrawal) => (
              <tr key={withdrawal.id}>
                <td>{money(withdrawal.amount)}</td>
                <td><StatusPill status={withdrawal.status} /></td>
                <td><small>{withdrawal.payoutRef ?? "-"}</small></td>
                <td><small>{withdrawal.note ?? "-"}</small></td>
                <td>{dateTime(withdrawal.createdAt)}</td>
                <td><button className="secondary mini" onClick={() => onOpenWithdrawal(withdrawal.id)}>打开</button></td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="登录身份">
          <MiniTable headers={["Provider", "邮箱", "名称", "创建"]}>
            {identities.slice(0, 8).map((identity) => (
              <tr key={identity.id}>
                <td>{identity.provider}</td>
                <td><small>{identity.email ?? "-"}</small></td>
                <td>{identity.displayName ?? "-"}</td>
                <td>{dateTime(identity.createdAt)}</td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>
      </section>
    </section>
  );
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="detail-block">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function MiniTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="table-wrap compact-table">
      <table>
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function WalletsView({ wallets, selectedWallet, users, query, meta, onAdjust, onDetail, onCloseDetail, onOpenUser, onOpenWalletTransaction, onOpenOrder, onOpenUsage, onOpenWithdrawal, onDraft, onFilter, onClear, onPage, onExport }: {
  wallets: WalletRow[];
  selectedWallet: WalletDetailRow | null;
  users: UserRow[];
  onAdjust: (event: FormEvent<HTMLFormElement>) => void;
  onDetail: (walletId: string) => void;
  onCloseDetail: () => void;
  onOpenUser: (userId: string) => void;
  onOpenWalletTransaction: (lookup: string) => void;
  onOpenOrder: (orderId: string) => void;
  onOpenUsage: (lookup: string) => void;
  onOpenWithdrawal: (withdrawalId: string) => void;
} & ManagedListProps) {
  const userOptions = useMemo(() => {
    const seen = new Set(wallets.map((wallet) => wallet.userId));
    return [...wallets.map((wallet) => ({ id: wallet.userId, email: wallet.user?.email ?? wallet.userId })), ...users.filter((user) => !seen.has(user.id)).map((user) => ({ id: user.id, email: user.email }))];
  }, [wallets, users]);

  return (
    <section className="stack">
      <form className="panel glass-panel inline-form" onSubmit={onAdjust}>
        <span className="eyebrow">Adjust balance</span>
        <select name="userId" required>
          <option value="">选择用户</option>
          {userOptions.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}
        </select>
        <input name="amount" type="number" step="0.01" placeholder="调整金额，可为负数" required />
        <input name="note" placeholder="备注" />
        <button>调整余额</button>
      </form>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="email / user id / wallet id"
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="余额管理" count={meta.total} headers={["用户", "可用", "冻结", "充值", "消费", "更新时间", "操作"]}>
        {wallets.map((wallet) => (
          <tr key={wallet.id}>
            <td><strong>{wallet.user?.email ?? wallet.userId}</strong><small>{wallet.userId}</small></td>
            <td>{money(wallet.availableBalance)}</td>
            <td>{money(wallet.frozenBalance)}</td>
            <td>{money(wallet.totalRecharged)}</td>
            <td>{money(wallet.totalSpent)}</td>
            <td>{dateTime(wallet.updatedAt)}</td>
            <td>
              <div className="row-actions">
                <button type="button" className="secondary mini" onClick={() => onDetail(wallet.id)}>详情</button>
                <button type="button" className="secondary mini" onClick={() => onOpenUser(wallet.userId)}>用户</button>
                <button type="button" className="secondary mini" onClick={() => onOpenWalletTransaction(wallet.id)}>流水</button>
              </div>
            </td>
          </tr>
        ))}
      </TablePanel>
      {selectedWallet && (
        <WalletDetailPanel
          wallet={selectedWallet}
          onClose={onCloseDetail}
          onOpenUser={onOpenUser}
          onOpenWalletTransaction={onOpenWalletTransaction}
          onOpenOrder={onOpenOrder}
          onOpenUsage={onOpenUsage}
          onOpenWithdrawal={onOpenWithdrawal}
        />
      )}
    </section>
  );
}

function WalletDetailPanel({ wallet, onClose, onOpenUser, onOpenWalletTransaction, onOpenOrder, onOpenUsage, onOpenWithdrawal }: {
  wallet: WalletDetailRow;
  onClose: () => void;
  onOpenUser: (userId: string) => void;
  onOpenWalletTransaction: (lookup: string) => void;
  onOpenOrder: (orderId: string) => void;
  onOpenUsage: (lookup: string) => void;
  onOpenWithdrawal: (withdrawalId: string) => void;
}) {
  const transactions = wallet.transactions ?? [];
  return (
    <section className="panel glass-panel wide detail-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">Wallet Detail</span>
          <h2>{wallet.user?.email ?? wallet.userId}</h2>
        </div>
        <div className="row-actions">
          <button className="secondary mini" onClick={() => onOpenUser(wallet.userId)}>打开用户</button>
          <button className="secondary mini" onClick={() => onOpenWalletTransaction(wallet.id)}>打开流水</button>
          <button className="secondary mini" onClick={onClose}>关闭</button>
        </div>
      </div>

      <div className="diagnostic-grid">
        <div><span>钱包 ID</span><strong>{wallet.id}</strong></div>
        <div><span>用户 ID</span><strong>{wallet.userId}</strong></div>
        <div><span>可用余额</span><strong>{money(wallet.availableBalance)}</strong></div>
        <div><span>冻结余额</span><strong>{money(wallet.frozenBalance)}</strong></div>
        <div><span>累计充值</span><strong>{money(wallet.totalRecharged)}</strong></div>
        <div><span>累计消费</span><strong>{money(wallet.totalSpent)}</strong></div>
        <div><span>流水数量</span><strong>{wallet.transactionSummary?._count ?? transactions.length}</strong></div>
        <div><span>更新时间</span><strong>{dateTime(wallet.updatedAt)}</strong></div>
      </div>

      <DetailBlock title="最近余额流水">
        <MiniTable headers={["类型", "金额", "余额后", "引用", "备注", "时间", "操作"]}>
          {transactions.slice(0, 20).map((transaction) => (
            <tr key={transaction.id}>
              <td><StatusPill status={transaction.type} /></td>
              <td>{money(transaction.amount)}</td>
              <td>{money(transaction.balanceAfter)}</td>
              <td><strong>{transaction.refType ?? "-"}</strong><small>{transaction.refId ?? "-"}</small></td>
              <td><small>{transaction.note ?? "-"}</small></td>
              <td>{dateTime(transaction.createdAt)}</td>
              <td>
                <div className="row-actions">
                  <WalletTransactionActions
                    transaction={transaction}
                    onOpenWalletTransaction={onOpenWalletTransaction}
                    onOpenOrder={onOpenOrder}
                    onOpenUsage={onOpenUsage}
                    onOpenWithdrawal={onOpenWithdrawal}
                  />
                </div>
              </td>
            </tr>
          ))}
          {transactions.length === 0 && (
            <tr><td colSpan={7}><small>暂无余额流水。</small></td></tr>
          )}
        </MiniTable>
      </DetailBlock>
    </section>
  );
}

function WalletTransactionsView({ transactions, query, meta, onOpenWallet, onOpenUser, onOpenOrder, onOpenUsage, onOpenWithdrawal, onDraft, onFilter, onClear, onPage, onExport }: {
  transactions: WalletTransactionRow[];
  onOpenWallet: (lookup: string) => void;
  onOpenUser: (userId: string) => void;
  onOpenOrder: (orderId: string) => void;
  onOpenUsage: (lookup: string) => void;
  onOpenWithdrawal: (withdrawalId: string) => void;
} & ManagedListProps) {
  return (
    <>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="email / tx id / ref / note"
        statusOptions={walletTransactionTypeOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="余额流水" count={meta.total} headers={["用户", "类型", "金额", "余额后", "引用", "备注", "时间", "操作"]}>
        {transactions.map((transaction) => (
          <tr key={transaction.id}>
            <td><strong>{transaction.wallet?.user?.email ?? transaction.walletId}</strong><small>{transaction.id}</small></td>
            <td><StatusPill status={transaction.type} /></td>
            <td>{money(transaction.amount)}</td>
            <td>{money(transaction.balanceAfter)}</td>
            <td><strong>{transaction.refType ?? "-"}</strong><small>{transaction.refId ?? "-"}</small></td>
            <td><small>{transaction.note ?? "-"}</small></td>
            <td>{dateTime(transaction.createdAt)}</td>
            <td>
              <div className="row-actions">
                <button className="secondary mini" onClick={() => onOpenWallet(transaction.walletId)}>钱包</button>
                {transaction.wallet?.userId && <button className="secondary mini" onClick={() => onOpenUser(transaction.wallet!.userId)}>用户</button>}
                <WalletTransactionActions
                  transaction={transaction}
                  onOpenOrder={onOpenOrder}
                  onOpenUsage={onOpenUsage}
                  onOpenWithdrawal={onOpenWithdrawal}
                />
              </div>
            </td>
          </tr>
        ))}
      </TablePanel>
    </>
  );
}

function WalletTransactionActions({ transaction, onOpenWalletTransaction, onOpenOrder, onOpenUsage, onOpenWithdrawal }: {
  transaction: WalletTransactionRow;
  onOpenWalletTransaction?: (lookup: string) => void;
  onOpenOrder: (orderId: string) => void;
  onOpenUsage: (lookup: string) => void;
  onOpenWithdrawal: (withdrawalId: string) => void;
}) {
  const refType = transaction.refType?.toLowerCase() ?? "";
  const refId = transaction.refId ?? "";
  return (
    <>
      {onOpenWalletTransaction && <button className="secondary mini" onClick={() => onOpenWalletTransaction(transaction.id)}>流水</button>}
      {refType === "order" && refId && <button className="secondary mini" onClick={() => onOpenOrder(refId)}>订单</button>}
      {refType === "usage" && refId && <button className="secondary mini" onClick={() => onOpenUsage(refId)}>用量</button>}
      {refType === "withdrawal" && refId && <button className="secondary mini" onClick={() => onOpenWithdrawal(refId)}>提现</button>}
    </>
  );
}

function ReconciliationView({ reconciliation, onRefresh }: {
  reconciliation: ReconciliationResult | null;
  onRefresh: () => void;
}) {
  const summary = reconciliation?.summary;
  const issues = reconciliation?.issues ?? [];
  return (
    <section className="stack">
      <div className="panel glass-panel export-strip">
        <div>
          <span className="eyebrow">Billing reconciliation</span>
          <div className={reconciliation?.ok ? "health-row" : "health-row warning"}>
            {reconciliation?.ok ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            <strong>{reconciliation ? (reconciliation.ok ? "账务一致" : "发现账务问题") : "等待巡检"}</strong>
          </div>
          {reconciliation && <small>扫描上限 {reconciliation.scanLimit}，检查时间 {dateTime(reconciliation.checkedAt)}</small>}
        </div>
        <button className="secondary" onClick={onRefresh}><RefreshCw size={16} />重新对账</button>
      </div>
      <section className="cards compact-cards">
        <Metric label="问题总数" value={summary?.totalIssues ?? 0} />
        <Metric label="缺少扣费流水" value={summary?.billedUsageMissingWalletTransactions ?? 0} />
        <Metric label="流水引用缺失" value={summary?.walletTransactionsMissingUsage ?? 0} />
        <Metric label="用量结算不平" value={summary?.usageSettlementMismatches ?? 0} />
        <Metric label="结算超分配" value={summary?.settlementOverallocated ?? 0} />
        <Metric label="提现分配不平" value={summary?.withdrawalAllocationMismatches ?? 0} />
      </section>
      <TablePanel title="账务问题明细" count={summary?.totalIssues ?? 0} headers={["级别", "类型", "引用", "金额", "期望/实际", "说明", "时间"]}>
        {issues.map((issue) => (
          <tr key={issue.id}>
            <td><StatusPill status={issue.severity} /></td>
            <td><strong>{issue.type}</strong></td>
            <td><strong>{issue.refType}</strong><small>{issue.refId}</small></td>
            <td>{issue.amount ? money(issue.amount) : "-"}</td>
            <td><strong>{issue.expected ? money(issue.expected) : "-"}</strong><small>{issue.actual ? money(issue.actual) : "-"}</small></td>
            <td><small>{issue.message}</small></td>
            <td>{dateTime(issue.createdAt)}</td>
          </tr>
        ))}
        {reconciliation && issues.length === 0 && (
          <tr>
            <td colSpan={7}><small>当前扫描范围内未发现账务一致性问题。</small></td>
          </tr>
        )}
        {!reconciliation && (
          <tr>
            <td colSpan={7}><small>点击重新对账开始扫描。</small></td>
          </tr>
        )}
      </TablePanel>
    </section>
  );
}

function SalesView({ sales, selectedOrder, query, meta, onDetail, onCancel, onRefund, onRetryProvision, onCloseDetail, onOpenSales, onOpenUser, onOpenWalletTransaction, onOpenProxyRequest, onOpenRental, onOpenRentals, onOpenOrders, onOpenApiKey, onOpenProduct, onOpenUsage, onDraft, onFilter, onClear, onPage, onExport }: {
  sales: SalesData | null;
  selectedOrder: OrderDetailRow | null;
  onDetail: (orderId: string) => void;
  onCancel: (orderId: string) => void;
  onRefund: (orderId: string) => void;
  onRetryProvision: (orderId: string) => void;
  onCloseDetail: () => void;
  onOpenSales: (lookup: string) => void;
  onOpenUser: (userId: string) => void;
  onOpenWalletTransaction: (lookup: string) => void;
  onOpenProxyRequest: (lookup: string) => void;
  onOpenRental: (rentalId: string) => void;
  onOpenRentals: (lookup: string) => void;
  onOpenOrders: (lookup: string) => void;
  onOpenApiKey: (lookup: string) => void;
  onOpenProduct: (lookup: string) => void;
  onOpenUsage: (lookup: string) => void;
} & ManagedListProps) {
  const orders = sales?.orders ?? [];
  const breakdown = sales?.breakdown;
  return (
    <section className="stack">
      <section className="cards compact-cards">
        <Metric label="订单数" value={sales?.summary.orderCount ?? meta.total} />
        <Metric label="订单金额" value={money(sales?.summary.totalAmount)} />
        <Metric label="已付金额" value={money(sales?.summary.paidAmount)} />
        <Metric label="按量收入" value={money(sales?.summary.usageCharge)} />
        <Metric label="供给收入" value={money(sales?.summary.supplierIncome)} />
      </section>
      <section className="detail-grid">
        <DetailBlock title="订单状态分布">
          <MiniTable headers={["状态", "订单", "已付", "应付"]}>
            {(breakdown?.byStatus ?? []).map((row) => (
              <tr key={row.status}>
                <td><StatusPill status={row.status} /></td>
                <td>{row.orderCount}</td>
                <td>{money(row.paidAmount)}</td>
                <td>{money(row.totalAmount)}</td>
              </tr>
            ))}
            {(breakdown?.byStatus ?? []).length === 0 && (
              <tr><td colSpan={4}><small>暂无售出订单。</small></td></tr>
            )}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="资源类型分布">
          <MiniTable headers={["资源", "订单项", "数量", "租赁", "金额"]}>
            {(breakdown?.byResourceType ?? []).map((row) => (
              <tr key={row.resourceType}>
                <td>{row.resourceType}</td>
                <td>{row.orderItemCount}</td>
                <td>{row.quantity}</td>
                <td>{row.rentalCount}</td>
                <td>{money(row.amount)}</td>
              </tr>
            ))}
            {(breakdown?.byResourceType ?? []).length === 0 && (
              <tr><td colSpan={5}><small>暂无资源分布。</small></td></tr>
            )}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="商品排行">
          <MiniTable headers={["商品", "资源", "订单项", "数量", "金额", "操作"]}>
            {(breakdown?.byProduct ?? []).map((row) => (
              <tr key={row.productId}>
                <td><strong>{row.productName}</strong><small>{row.productId}</small></td>
                <td>{row.resourceType}</td>
                <td>{row.orderItemCount}</td>
                <td>{row.quantity}</td>
                <td>{money(row.amount)}</td>
                <td>
                  <div className="row-actions">
                    <button type="button" className="secondary mini" onClick={() => onOpenProduct(row.productId)}>商品</button>
                    <button type="button" className="secondary mini" onClick={() => onOpenSales(row.productId)}>售出</button>
                    <button type="button" className="secondary mini" onClick={() => onOpenOrders(row.productId)}>订单</button>
                    <button type="button" className="secondary mini" onClick={() => onOpenRentals(row.productId)}>租赁</button>
                    <button type="button" className="secondary mini" onClick={() => onOpenUsage(row.productId)}>用量</button>
                  </div>
                </td>
              </tr>
            ))}
            {(breakdown?.byProduct ?? []).length === 0 && (
              <tr><td colSpan={6}><small>暂无商品销售数据。</small></td></tr>
            )}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="租赁交付状态">
          <MiniTable headers={["状态", "租赁"]}>
            {(breakdown?.byRentalStatus ?? []).map((row) => (
              <tr key={row.status}>
                <td><StatusPill status={row.status} /></td>
                <td>{row.rentalCount}</td>
              </tr>
            ))}
            {(breakdown?.byRentalStatus ?? []).length === 0 && (
              <tr><td colSpan={2}><small>暂无租赁交付数据。</small></td></tr>
            )}
          </MiniTable>
        </DetailBlock>
      </section>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="order / email / product / rental"
        statusOptions={orderStatusOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <OrdersView
        orders={orders}
        title="售出订单"
        selectedOrder={selectedOrder}
        meta={meta}
        onDetail={onDetail}
        onCancel={onCancel}
        onRefund={onRefund}
        onRetryProvision={onRetryProvision}
        onCloseDetail={onCloseDetail}
        onOpenUser={onOpenUser}
        onOpenWalletTransaction={onOpenWalletTransaction}
        onOpenProxyRequest={onOpenProxyRequest}
        onOpenRental={onOpenRental}
        onOpenApiKey={onOpenApiKey}
        onOpenProduct={onOpenProduct}
      />
    </section>
  );
}

function UsagesView({ usages, summary, syncState, query, meta, onSync, onOpenUser, onOpenOrder, onOpenRental, onOpenProduct, onOpenResource, onOpenProxyRequest, onOpenSettlement, onDraft, onFilter, onClear, onPage, onExport }: {
  usages: UsageRecordRow[];
  summary: AggregateSummary | null;
  syncState: UsageSyncStateResult | null;
  onSync: (event: FormEvent<HTMLFormElement>) => void;
  onOpenUser: (userId: string) => void;
  onOpenOrder: (orderId: string) => void;
  onOpenRental: (rentalId: string) => void;
  onOpenProduct: (lookup: string) => void;
  onOpenResource: (resourceId: string) => void;
  onOpenProxyRequest: (lookup: string) => void;
  onOpenSettlement: (lookup: string) => void;
} & ManagedListProps) {
  const state = syncState?.state;
  const runs = syncState?.runs ?? [];
  return (
    <section className="stack">
      <section className="cards compact-cards">
        <Metric label="用量记录" value={summary?._count ?? meta.total} />
        <Metric label="买家计费" value={money(summary?._sum?.buyerCharge)} />
        <Metric label="供给收入" value={money(summary?._sum?.supplierIncome)} />
        <Metric label="Tokens" value={`${Number(summary?._sum?.inputUnits ?? 0).toFixed(0)} / ${Number(summary?._sum?.outputUnits ?? 0).toFixed(0)}`} />
      </section>
      <section className="panel glass-panel wide">
        <div className="section-head">
          <div>
            <span className="eyebrow">Sub2 usage cursor</span>
            <h2>同步状态</h2>
          </div>
          <StatusPill status={state?.lastStatus ?? "idle"} />
        </div>
        <div className="diagnostic-grid">
          <div><span>Cursor</span><strong>{state?.cursor ?? "-"}</strong></div>
          <div><span>最近开始</span><strong>{dateTime(state?.lastStartedAt)}</strong></div>
          <div><span>最近完成</span><strong>{dateTime(state?.lastFinishedAt)}</strong></div>
          <div><span>最近结果</span><strong>{state ? `${state.lastImported}/${state.lastRecovered}/${state.lastSkipped}/${state.lastUnmatched}` : "-"}</strong></div>
          <div><span>最近错误</span><strong>{state?.lastError ?? "-"}</strong></div>
        </div>
        {runs.length > 0 && (
          <MiniTable headers={["批次", "状态", "导入/恢复/跳过/未匹配", "Cursor", "时间"]}>
            {runs.slice(0, 5).map((run) => (
              <tr key={run.id}>
                <td><small>{run.id}</small></td>
                <td><StatusPill status={run.status} /></td>
                <td>{run.imported} / {run.recovered} / {run.skipped} / {run.unmatched}</td>
                <td><small>{run.cursorIn ?? "-"} → {run.cursorOut ?? "-"}</small></td>
                <td>{dateTime(run.finishedAt ?? run.startedAt)}</td>
              </tr>
            ))}
          </MiniTable>
        )}
      </section>
      <form className="panel glass-panel inline-form usage-sync-form" onSubmit={onSync}>
        <span className="eyebrow">Sub2 usage</span>
        <input name="cursor" placeholder="cursor，可选" />
        <button>同步用量</button>
      </form>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="request / user / rental / model"
        statusOptions={usageStatusOptions}
        resourceTypeOptions={resourceTypeOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="用量记录" count={meta.total} headers={["用户", "模型", "状态", "Tokens", "计费", "供给方", "时间", "操作"]}>
        {usages.map((usage) => (
          <tr key={usage.id}>
            <td>
              <strong>{usage.rental?.user?.email ?? usage.userId}</strong>
              <small>{usage.sub2RequestId}</small>
            </td>
            <td>
              <strong>{usage.model ?? "-"}</strong>
              <small>{usage.resourceType} / {usage.rental?.product?.name ?? usage.rentalId}</small>
            </td>
            <td><StatusPill status={usage.status} /></td>
            <td>{Number(usage.inputUnits).toFixed(0)} / {Number(usage.outputUnits).toFixed(0)}</td>
            <td>
              <strong>{money(usage.buyerCharge)}</strong>
              <small>API cost {money(usage.apiEquivalentCost)}</small>
            </td>
            <td>
              <strong>{money(usage.supplierIncome)}</strong>
              <small>{usage.supplierResource?.supplier?.user?.email ?? usage.supplierResource?.sub2AccountId ?? "-"}</small>
            </td>
            <td>{dateTime(usage.occurredAt)}</td>
            <td>
              <div className="row-actions">
                {usage.userId && <button className="secondary mini" onClick={() => onOpenUser(usage.userId)}>用户</button>}
                {usage.rental?.orderId && <button className="secondary mini" onClick={() => onOpenOrder(usage.rental!.orderId!)}>订单</button>}
                {usage.rentalId && <button className="secondary mini" onClick={() => onOpenRental(usage.rentalId)}>租赁</button>}
                {usage.rental?.productId && <button className="secondary mini" onClick={() => onOpenProduct(usage.rental!.productId!)}>商品</button>}
                {usage.supplierResource?.id && <button className="secondary mini" onClick={() => onOpenResource(usage.supplierResource!.id)}>资源</button>}
                <button className="secondary mini" onClick={() => onOpenProxyRequest(usage.sub2RequestId)}>反代</button>
                {(usage.settlements ?? [])[0]?.id && <button className="secondary mini" onClick={() => onOpenSettlement((usage.settlements ?? [])[0]!.id)}>结算</button>}
              </div>
            </td>
          </tr>
        ))}
        {usages.length === 0 && (
          <tr><td colSpan={8}><small>暂无用量记录。</small></td></tr>
        )}
      </TablePanel>
    </section>
  );
}

function ProductsView({ products, query, meta, onCreate, onUpdate, onProductStatus, onCreatePrice, onUpdatePrice, onPriceStatus, onOpenSales, onOpenOrders, onOpenRentals, onOpenUsage, onOpenProxyRequest, onDraft, onFilter, onClear, onPage, onExport }: {
  products: ProductRow[];
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onUpdate: (event: FormEvent<HTMLFormElement>, productId: string) => void;
  onProductStatus: (productId: string, status: string) => void;
  onCreatePrice: (event: FormEvent<HTMLFormElement>) => void;
  onUpdatePrice: (event: FormEvent<HTMLFormElement>, priceId: string) => void;
  onPriceStatus: (priceId: string, status: string) => void;
  onOpenSales: (lookup: string) => void;
  onOpenOrders: (lookup: string) => void;
  onOpenRentals: (lookup: string) => void;
  onOpenUsage: (lookup: string) => void;
  onOpenProxyRequest: (lookup: string) => void;
} & ManagedListProps) {
  return (
    <section className="stack">
      <form className="panel glass-panel inline-form" onSubmit={onCreate}>
        <span className="eyebrow">Create product</span>
        <input name="name" placeholder="商品名称" required />
        <input name="description" placeholder="描述，可选" />
        <select name="resourceType" defaultValue="codex" required>
          {resourceTypeOptions.map((resourceType) => <option key={resourceType} value={resourceType}>{resourceType}</option>)}
        </select>
        <select name="billingMode" defaultValue="monthly" required>
          {billingModeOptions.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
        </select>
        <select name="status" defaultValue="draft" required>
          {productStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <button>创建商品</button>
      </form>

      <form className="panel glass-panel inline-form product-price-form" onSubmit={onCreatePrice}>
        <span className="eyebrow">Create price</span>
        <select name="productId" required>
          <option value="">选择商品</option>
          {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
        <input name="tierCode" placeholder="tier_code" pattern="[a-z0-9_-]+" required />
        <input name="displayName" placeholder="价格名称" required />
        <input name="fixedPrice" type="number" step="0.01" min={0.01} placeholder="固定价格，按量可留空" />
        <input name="durationDays" type="number" min={1} placeholder="租期天数，可选" />
        <input name="maxConcurrency" type="number" min={1} max={200} defaultValue={1} placeholder="并发" required />
        <input name="rpmLimit" type="number" min={1} placeholder="RPM，可选" />
        <input name="tpmLimit" type="number" min={1} placeholder="TPM，可选" />
        <input name="requestLimit" type="number" min={1} placeholder="请求数，可选" />
        <input name="spendLimit" type="number" step="0.000001" min={0.000001} placeholder="消费上限，可选" />
        <input name="discountRate" type="number" step="0.01" min={0} max={1} defaultValue={0.2} placeholder="折扣率" required />
        <input name="tierMultiplier" type="number" step="0.01" min={0.01} defaultValue={1} placeholder="倍率" required />
        <select name="status" defaultValue="active" required>
          {productStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <button>创建价格</button>
      </form>

      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="product / tier / resource"
        statusOptions={productStatusOptions}
        resourceTypeOptions={resourceTypeOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />

      <TablePanel title="商品与价格" count={meta.total} headers={["商品", "资源", "状态", "交付", "价格", "订单/租赁", "操作"]}>
        {products.map((product) => (
          <tr key={product.id}>
            <td>
              <strong>{product.name}</strong><small>{product.description ?? product.id}</small>
              <form className="limits-form" key={`${product.id}-${product.updatedAt ?? ""}`} onSubmit={(event) => onUpdate(event, product.id)}>
                <input name="name" defaultValue={product.name} placeholder="商品名称" required />
                <input name="description" defaultValue={product.description ?? ""} placeholder="描述，留空清除" />
                <select name="resourceType" defaultValue={product.resourceType} required>
                  {resourceTypeOptions.map((resourceType) => <option key={resourceType} value={resourceType}>{resourceType}</option>)}
                </select>
                <select name="billingMode" defaultValue={product.billingMode} required>
                  {billingModeOptions.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                </select>
                <select name="status" defaultValue={product.status} required>
                  {productStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
                <button type="submit" className="secondary mini">保存商品</button>
              </form>
            </td>
            <td>{product.resourceType} / {product.billingMode}</td>
            <td><StatusPill status={product.status} /></td>
            <td>
              <StatusPill status={product.deliveryReady === false ? "blocked" : "active"} />
              <small>{product.deliveryRequired ? `ready ${product.readyDeliveryResources ?? 0}` : "not required"}</small>
              {product.deliveryBlockedReason && <small>{product.deliveryBlockedReason}</small>}
            </td>
            <td>
              {(product.prices ?? []).map((price) => (
                <div className="price-line" key={price.id}>
                  <strong>{price.displayName} / {priceAmountLabel(price.fixedPrice)}</strong>
                  <small>{price.tierCode} / {price.durationDays ?? "-"}d / 并发 {price.maxConcurrency} / RPM {price.rpmLimit ?? "-"} / TPM {price.tpmLimit ?? "-"} / 请求 {price.requestLimit ?? "-"} / 消费 {price.spendLimit ?? "-"}</small>
                  <div className="row-actions">
                    <StatusPill status={price.status} />
                    <button type="button" className="secondary mini" onClick={() => onOpenSales(price.id)}>售出</button>
                    <button type="button" className="secondary mini" onClick={() => onOpenOrders(price.id)}>订单</button>
                    <button type="button" className="secondary mini" onClick={() => onOpenRentals(price.id)}>租赁</button>
                    <button type="button" className="secondary mini" onClick={() => onOpenUsage(price.id)}>用量</button>
                    <button type="button" className="secondary mini" onClick={() => onOpenProxyRequest(price.id)}>反代</button>
                    <button type="button" className="secondary mini" onClick={() => onPriceStatus(price.id, "active")}>启用</button>
                    <button type="button" className="secondary mini" onClick={() => onPriceStatus(price.id, "offline")}>下线</button>
                  </div>
                  <form className="limits-form" key={`${price.id}-${price.updatedAt ?? ""}`} onSubmit={(event) => onUpdatePrice(event, price.id)}>
                    <input name="displayName" defaultValue={price.displayName} placeholder="名称" required />
                    <input name="fixedPrice" type="number" step="0.01" min={0.01} defaultValue={price.fixedPrice ?? ""} placeholder="价格，按量可留空" />
                    <input name="durationDays" type="number" min={1} defaultValue={price.durationDays ?? ""} placeholder="天数" />
                    <input name="maxConcurrency" type="number" min={1} max={200} defaultValue={price.maxConcurrency} placeholder="并发" required />
                    <input name="rpmLimit" type="number" min={1} defaultValue={price.rpmLimit ?? ""} placeholder="RPM" />
                    <input name="tpmLimit" type="number" min={1} defaultValue={price.tpmLimit ?? ""} placeholder="TPM" />
                    <input name="requestLimit" type="number" min={1} defaultValue={price.requestLimit ?? ""} placeholder="请求" />
                    <input name="spendLimit" type="number" step="0.000001" min={0.000001} defaultValue={price.spendLimit ?? ""} placeholder="消费" />
                    <input name="discountRate" type="number" step="0.01" min={0} max={1} defaultValue={price.discountRate} placeholder="折扣" required />
                    <input name="tierMultiplier" type="number" step="0.01" min={0.01} defaultValue={price.tierMultiplier} placeholder="倍率" required />
                    <select name="status" defaultValue={price.status} required>
                      {productStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                    <button type="submit" className="secondary mini">保存价格</button>
                  </form>
                </div>
              ))}
            </td>
            <td>
              <strong>{product._count?.orders ?? 0} / {product._count?.rentals ?? 0}</strong>
              <small>订单 / 租赁</small>
              <div className="row-actions">
                <button type="button" className="secondary mini" onClick={() => onOpenSales(product.id)}>售出</button>
                <button type="button" className="secondary mini" onClick={() => onOpenOrders(product.id)}>订单</button>
                <button type="button" className="secondary mini" onClick={() => onOpenRentals(product.id)}>租赁</button>
                <button type="button" className="secondary mini" onClick={() => onOpenUsage(product.id)}>用量</button>
                <button type="button" className="secondary mini" onClick={() => onOpenProxyRequest(product.id)}>反代</button>
              </div>
            </td>
            <td>
              <div className="row-actions">
                <button type="button" className="secondary mini" onClick={() => onProductStatus(product.id, "draft")}>草稿</button>
                <button type="button" className="secondary mini" onClick={() => onProductStatus(product.id, "active")}>上架</button>
                <button type="button" className="danger mini" onClick={() => onProductStatus(product.id, "offline")}>下线</button>
              </div>
            </td>
          </tr>
        ))}
      </TablePanel>
    </section>
  );
}

function OrdersView({ orders, title = "订单列表", selectedOrder, query, meta, onDetail, onCancel, onRefund, onRetryProvision, onCloseDetail, onOpenUser, onOpenWalletTransaction, onOpenProxyRequest, onOpenRental, onOpenApiKey, onOpenProduct, onDraft, onFilter, onClear, onPage, onExport }: {
  orders: OrderRow[];
  title?: string;
  selectedOrder?: OrderDetailRow | null;
  onDetail?: (orderId: string) => void;
  onCancel?: (orderId: string) => void;
  onRefund?: (orderId: string) => void;
  onRetryProvision?: (orderId: string) => void;
  onCloseDetail?: () => void;
  onOpenUser?: (userId: string) => void;
  onOpenWalletTransaction?: (lookup: string) => void;
  onOpenProxyRequest?: (lookup: string) => void;
  onOpenRental?: (rentalId: string) => void;
  onOpenApiKey?: (lookup: string) => void;
  onOpenProduct?: (lookup: string) => void;
} & Partial<ManagedListProps>) {
  return (
    <>
      {query && meta && onDraft && onFilter && onClear && onPage && (
        <ListControls
          query={query}
          meta={meta}
          searchPlaceholder="order id / email / payment ref"
          statusOptions={orderStatusOptions}
          onDraft={onDraft}
          onFilter={onFilter}
          onClear={onClear}
          onPage={onPage}
          onExport={onExport}
        />
      )}
      <TablePanel title={title} count={meta?.total ?? orders.length} headers={["用户", "状态", "金额", "租赁", "创建时间", "操作"]}>
        {orders.map((order) => (
          <tr key={order.id}>
            <td><strong>{order.user?.email ?? "-"}</strong><small>{order.id}</small></td>
            <td><StatusPill status={order.status} /></td>
            <td>{money(order.paidAmount)} / {money(order.totalAmount)}</td>
            <td>{order.rentals?.length ?? 0}</td>
            <td>{dateTime(order.createdAt)}</td>
            <td>
              <div className="row-actions">
                {onDetail && <button className="secondary mini" onClick={() => onDetail(order.id)}>详情</button>}
                {onRetryProvision && order.status === "failed" && <button className="secondary mini" onClick={() => onRetryProvision(order.id)}>Retry</button>}
                {onCancel && <button className="secondary mini" onClick={() => onCancel(order.id)}>取消</button>}
                {onRefund && <button className="danger mini" onClick={() => onRefund(order.id)}>退款</button>}
              </div>
            </td>
          </tr>
        ))}
      </TablePanel>
      {selectedOrder && onCloseDetail && (
        <OrderDetailPanel
          order={selectedOrder}
          onCancel={onCancel}
          onRefund={onRefund}
          onRetryProvision={onRetryProvision}
          onClose={onCloseDetail}
          onOpenUser={onOpenUser}
          onOpenWalletTransaction={onOpenWalletTransaction}
          onOpenProxyRequest={onOpenProxyRequest}
          onOpenRental={onOpenRental}
          onOpenApiKey={onOpenApiKey}
          onOpenProduct={onOpenProduct}
        />
      )}
    </>
  );
}

function OrderDetailPanel({ order, onCancel, onRefund, onRetryProvision, onClose, onOpenUser, onOpenWalletTransaction, onOpenProxyRequest, onOpenRental, onOpenApiKey, onOpenProduct }: {
  order: OrderDetailRow;
  onCancel?: (orderId: string) => void;
  onRefund?: (orderId: string) => void;
  onRetryProvision?: (orderId: string) => void;
  onClose: () => void;
  onOpenUser?: (userId: string) => void;
  onOpenWalletTransaction?: (lookup: string) => void;
  onOpenProxyRequest?: (lookup: string) => void;
  onOpenRental?: (rentalId: string) => void;
  onOpenApiKey?: (lookup: string) => void;
  onOpenProduct?: (lookup: string) => void;
}) {
  const walletTransactions = order.walletTransactions ?? [];
  const proxyRequests = order.proxyRequests ?? [];
  const deliverySummary = order.deliverySummary;
  return (
    <section className="panel glass-panel wide detail-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">Order Detail</span>
          <h2>{order.id}</h2>
        </div>
        <div className="row-actions">
          <StatusPill status={order.status} />
          {onOpenUser && <button className="secondary mini" onClick={() => onOpenUser(order.user.id)}>打开用户</button>}
          {onRetryProvision && order.status === "failed" && <button className="secondary mini" onClick={() => onRetryProvision(order.id)}>Retry</button>}
          {onCancel && <button className="secondary mini" onClick={() => onCancel(order.id)}>取消</button>}
          {onRefund && <button className="danger mini" onClick={() => onRefund(order.id)}>退款</button>}
          <button className="secondary mini" onClick={onClose}>关闭</button>
        </div>
      </div>

      <div className="diagnostic-grid">
        <div><span>用户</span><strong>{order.user?.email ?? "-"}</strong></div>
        <div><span>已付 / 应付</span><strong>{money(order.paidAmount)} / {money(order.totalAmount)}</strong></div>
        <div><span>币种</span><strong>{order.currency ?? "USD"}</strong></div>
        <div><span>支付引用</span><strong>{order.paymentRef ?? "-"}</strong></div>
        <div><span>订单项</span><strong>{order.items.length}</strong></div>
        <div><span>租赁</span><strong>{order.rentals.length}</strong></div>
        <div><span>创建时间</span><strong>{dateTime(order.createdAt)}</strong></div>
        <div><span>更新时间</span><strong>{dateTime(order.updatedAt)}</strong></div>
        <div><span>钱包流水</span><strong>{order.walletTransactionSummary?._count ?? walletTransactions.length}</strong></div>
        <div><span>流水金额</span><strong>{money(order.walletTransactionSummary?._sum?.amount)}</strong></div>
        <div><span>反代请求</span><strong>{order.proxyRequestSummary?._count ?? proxyRequests.length}</strong></div>
        <div><span>交付核查</span><strong>{deliverySummary ? deliveryStatusText(deliverySummary.status) : "-"}</strong></div>
      </div>

      <section className="detail-grid">
        <DetailBlock title="交付核查">
          <MiniTable headers={["状态", "检查项", "结论", "指标"]}>
            {(deliverySummary?.checks ?? []).map((check) => (
              <tr key={check.id}>
                <td><StatusPill status={healthStatusTone(check.status)} /></td>
                <td><strong>{check.label}</strong><small>{check.id}</small></td>
                <td><small>{check.summary}</small></td>
                <td><small>{healthMetricSummary(check.metrics)}</small></td>
              </tr>
            ))}
            {!deliverySummary && (
              <tr><td colSpan={4}><small>暂无交付核查结果。</small></td></tr>
            )}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="钱包流水">
          <MiniTable headers={["类型", "金额", "余额后", "用户", "备注", "时间", "操作"]}>
            {walletTransactions.slice(0, 10).map((transaction) => (
              <tr key={transaction.id}>
                <td><StatusPill status={transaction.type} /></td>
                <td>{money(transaction.amount)}</td>
                <td>{money(transaction.balanceAfter)}</td>
                <td><small>{transaction.wallet?.user?.email ?? transaction.walletId}</small></td>
                <td><small>{transaction.note ?? "-"}</small></td>
                <td>{dateTime(transaction.createdAt)}</td>
                <td>{onOpenWalletTransaction ? <button className="secondary mini" onClick={() => onOpenWalletTransaction(transaction.id)}>打开</button> : <small>-</small>}</td>
              </tr>
            ))}
            {walletTransactions.length === 0 && (
              <tr><td colSpan={7}><small>暂无关联钱包流水。</small></td></tr>
            )}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="最近反代请求">
          <MiniTable headers={["状态", "请求", "租赁", "耗时", "体积", "时间", "操作"]}>
            {proxyRequests.slice(0, 10).map((log) => (
              <tr key={log.id}>
                <td>
                  <StatusPill status={proxyStatusTone(log.statusCode)} />
                  <small>{log.statusCode ?? "-"} / upstream {log.upstreamStatusCode ?? "-"}</small>
                  {log.errorCode && <small>{log.errorCode}</small>}
                </td>
                <td><strong>{log.method}</strong><small>{log.path}</small><small>{log.model ?? "-"}</small></td>
                <td><strong>{log.rental?.product?.name ?? log.rentalId ?? "-"}</strong><small>{log.apiKeyPrefix ?? log.apiKey?.keyPrefix ?? "-"}</small></td>
                <td>{log.durationMs}ms</td>
                <td><strong>{log.estimatedInputTokens} tokens</strong><small>{log.requestBytes} bytes</small></td>
                <td>{dateTime(log.createdAt)}</td>
                <td>{onOpenProxyRequest ? <button className="secondary mini" onClick={() => onOpenProxyRequest(log.requestId ?? log.id)}>打开</button> : <small>-</small>}</td>
              </tr>
            ))}
            {proxyRequests.length === 0 && (
              <tr><td colSpan={7}><small>暂无关联反代请求。</small></td></tr>
            )}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="状态历史">
          <MiniTable headers={["从", "到", "原因", "操作者", "Meta", "时间"]}>
            {(order.statusHistory ?? []).map((history) => (
              <tr key={history.id}>
                <td>{history.fromStatus ?? "-"}</td>
                <td><StatusPill status={history.toStatus} /></td>
                <td>{history.reason ?? "-"}</td>
                <td><small>{history.actorUserId ?? "-"}</small></td>
                <td><small>{auditSummary(history.meta)}</small></td>
                <td>{dateTime(history.createdAt)}</td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="订单项">
          <MiniTable headers={["商品", "资源", "数量", "金额", "价格 ID", "操作"]}>
            {order.items.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.product?.name ?? item.productId}</strong><small>{item.productId}</small></td>
                <td>{item.product?.resourceType ?? "-"}</td>
                <td>{item.quantity}</td>
                <td>{money(item.amount)}</td>
                <td><small>{item.priceId ?? "-"}</small></td>
                <td>{onOpenProduct ? <button className="secondary mini" onClick={() => onOpenProduct(item.productId)}>打开</button> : <small>-</small>}</td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="租赁交付">
          <MiniTable headers={["租赁", "状态", "资源", "Endpoint", "Sub2 Key", "到期", "操作"]}>
            {order.rentals.map((rental) => (
              <tr key={rental.id}>
                <td><small>{rental.id}</small></td>
                <td><StatusPill status={rental.status} /></td>
                <td>{rental.product?.name ?? rental.resourceType}</td>
                <td><small>{rental.endpointUrl ?? "-"}</small></td>
                <td><small>{rental.sub2KeyId ?? "-"}</small></td>
                <td>{dateTime(rental.endsAt)}</td>
                <td>{onOpenRental ? <button className="secondary mini" onClick={() => onOpenRental(rental.id)}>打开</button> : <small>-</small>}</td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="租赁限制">
          <MiniTable headers={["租赁", "并发", "RPM", "TPM", "请求数", "消费上限", "剩余额度", "操作"]}>
            {order.rentals.map((rental) => (
              <tr key={rental.id}>
                <td><small>{rental.id}</small></td>
                <td>{rental.limits?.maxConcurrency ?? "-"}</td>
                <td>{rental.limits?.rpmLimit ?? "-"}</td>
                <td>{rental.limits?.tpmLimit ?? "-"}</td>
                <td>{rental.limits?.requestLimit ?? "-"}</td>
                <td>{rental.limits?.spendLimit ?? "-"}</td>
                <td>{rental.limits?.remainingSpend ?? "-"}</td>
                <td>{onOpenRental ? <button className="secondary mini" onClick={() => onOpenRental(rental.id)}>打开</button> : <small>-</small>}</td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="API Key">
          <MiniTable headers={["租赁", "名称", "前缀", "状态", "最近使用", "创建", "操作"]}>
            {order.rentals.flatMap((rental) => (rental.apiKeys ?? []).map((apiKey) => (
              <tr key={apiKey.id}>
                <td><small>{rental.id}</small></td>
                <td>{apiKey.name}</td>
                <td><small>{apiKey.keyPrefix}</small></td>
                <td><StatusPill status={apiKey.status} /></td>
                <td>{dateTime(apiKey.lastUsedAt)}</td>
                <td>{dateTime(apiKey.createdAt)}</td>
                <td>{onOpenApiKey ? <button className="secondary mini" onClick={() => onOpenApiKey(apiKey.id)}>打开</button> : <small>-</small>}</td>
              </tr>
            )))}
          </MiniTable>
        </DetailBlock>
      </section>
    </section>
  );
}

function RentalsView({ rentals, selectedRental, query, meta, onDetail, onCloseDetail, onRentalStatus, onUpdateLimits, onApiKeyStatus, onRotateKey, onExpireOverdue, onOpenUser, onOpenOrder, onOpenProduct, onOpenApiKey, onOpenUsage, onOpenSettlement, onOpenProxyRequest, onDraft, onFilter, onClear, onPage, onExport }: {
  rentals: RentalRow[];
  selectedRental: RentalDetailRow | null;
  onDetail: (rentalId: string) => void;
  onCloseDetail: () => void;
  onRentalStatus: (rentalId: string, status: string) => void;
  onUpdateLimits: (event: FormEvent<HTMLFormElement>, rentalId: string) => void;
  onApiKeyStatus: (apiKeyId: string, status: string) => void;
  onRotateKey: (rentalId: string) => void;
  onExpireOverdue: () => void;
  onOpenUser: (userId: string) => void;
  onOpenOrder: (orderId: string) => void;
  onOpenProduct: (lookup: string) => void;
  onOpenApiKey: (lookup: string) => void;
  onOpenUsage: (lookup: string) => void;
  onOpenSettlement: (lookup: string) => void;
  onOpenProxyRequest: (lookup: string) => void;
} & ManagedListProps) {
  return (
    <>
      <div className="panel glass-panel export-strip">
        <span className="eyebrow">Maintenance</span>
        <button className="secondary" onClick={onExpireOverdue}><RefreshCw size={16} />Expire overdue rentals</button>
      </div>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="rental id / email / endpoint"
        statusOptions={rentalStatusOptions}
        resourceTypeOptions={resourceTypeOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="租赁通道" count={meta.total} headers={["用户", "资源", "状态", "限制", "Endpoint", "API Key", "到期", "操作"]}>
        {rentals.map((rental) => (
          <tr key={rental.id}>
            <td><strong>{rental.user?.email ?? "-"}</strong><small>{rental.id}</small></td>
            <td>{rental.product?.name ?? rental.resourceType}</td>
            <td><StatusPill status={rental.status} /></td>
            <td>
              <form className="limits-form" onSubmit={(event) => onUpdateLimits(event, rental.id)}>
                <input name="maxConcurrency" type="number" min={1} max={200} defaultValue={rental.limits?.maxConcurrency ?? 1} aria-label="并发" />
                <input name="rpmLimit" type="number" min={1} defaultValue={rental.limits?.rpmLimit ?? ""} placeholder="RPM" aria-label="RPM" />
                <input name="tpmLimit" type="number" min={1} defaultValue={rental.limits?.tpmLimit ?? ""} placeholder="TPM" aria-label="TPM" />
                <input name="requestLimit" type="number" min={1} defaultValue={rental.limits?.requestLimit ?? ""} placeholder="请求" aria-label="请求数" />
                <input name="spendLimit" type="number" step="0.000001" min={0.000001} defaultValue={rental.limits?.spendLimit ?? ""} placeholder="消费" aria-label="消费上限" />
                <input name="remainingSpend" type="number" step="0.000001" min={0} defaultValue={rental.limits?.remainingSpend ?? ""} placeholder="剩余" aria-label="剩余额度" />
                <button type="submit" className="secondary mini">保存</button>
              </form>
            </td>
            <td>{rental.endpointUrl ?? "-"}</td>
            <td>
              {(rental.apiKeys ?? []).slice(0, 3).map((apiKey) => (
                <div className="key-line" key={apiKey.id}>
                  <strong>{apiKey.name}</strong>
                  <small>{apiKey.keyPrefix} / {dateTime(apiKey.lastUsedAt)}</small>
                  <div className="row-actions">
                    <StatusPill status={apiKey.status} />
                    <button type="button" className="secondary mini" onClick={() => onApiKeyStatus(apiKey.id, "active")}>Key 启用</button>
                    <button type="button" className="danger mini" onClick={() => onApiKeyStatus(apiKey.id, "inactive")}>Key 停用</button>
                  </div>
                </div>
              ))}
            </td>
            <td>{dateTime(rental.endsAt)}</td>
            <td>
              <div className="row-actions">
                <button type="button" className="secondary mini" onClick={() => onDetail(rental.id)}>Detail</button>
                {rental.userId && <button type="button" className="secondary mini" onClick={() => onOpenUser(rental.userId!)}>用户</button>}
                {rental.orderId && <button type="button" className="secondary mini" onClick={() => onOpenOrder(rental.orderId!)}>订单</button>}
                {rental.productId && <button type="button" className="secondary mini" onClick={() => onOpenProduct(rental.productId!)}>商品</button>}
                {(rental.apiKeys ?? [])[0]?.id && <button type="button" className="secondary mini" onClick={() => onOpenApiKey((rental.apiKeys ?? [])[0]!.id)}>Key</button>}
                <button type="button" className="secondary mini" onClick={() => onOpenUsage(rental.id)}>用量</button>
                <button type="button" className="secondary mini" onClick={() => onOpenProxyRequest(rental.id)}>反代</button>
                <button type="button" className="secondary mini" onClick={() => onRotateKey(rental.id)}>Rotate Key</button>
                <button type="button" className="secondary mini" onClick={() => onRentalStatus(rental.id, "active")}>恢复</button>
                <button type="button" className="secondary mini" onClick={() => onRentalStatus(rental.id, "suspended")}>暂停</button>
                <button type="button" className="danger mini" onClick={() => onRentalStatus(rental.id, "closed")}>关闭</button>
              </div>
            </td>
          </tr>
        ))}
      </TablePanel>
      {selectedRental && (
        <RentalDetailPanel
          rental={selectedRental}
          onClose={onCloseDetail}
          onOpenUser={onOpenUser}
          onOpenOrder={onOpenOrder}
          onOpenProduct={onOpenProduct}
          onOpenApiKey={onOpenApiKey}
          onOpenUsage={onOpenUsage}
          onOpenSettlement={onOpenSettlement}
          onOpenProxyRequest={onOpenProxyRequest}
        />
      )}
    </>
  );
}

function ApiKeysView({ apiKeys, query, meta, onStatus, onBulkStatus, onOpenUser, onOpenOrder, onOpenRental, onOpenProduct, onOpenProxyRequest, onOpenUsage, onDraft, onFilter, onClear, onPage, onExport }: {
  apiKeys: ApiKeyRow[];
  onStatus: (apiKeyId: string, status: string) => void;
  onBulkStatus: (status: string) => void;
  onOpenUser: (userId: string) => void;
  onOpenOrder: (orderId: string) => void;
  onOpenRental: (rentalId: string) => void;
  onOpenProduct: (lookup: string) => void;
  onOpenProxyRequest: (lookup: string) => void;
  onOpenUsage: (lookup: string) => void;
} & ManagedListProps) {
  const filterSummary = [
    `${meta.total} matched`,
    query.q ? `q=${query.q}` : null,
    query.status ? `status=${query.status}` : null,
    query.resourceType ? `resource=${query.resourceType}` : null
  ].filter(Boolean).join(" / ");
  return (
    <>
      <div className="panel glass-panel export-strip">
        <div>
          <span className="eyebrow">Maintenance</span>
          <strong>当前筛选 API Key</strong>
          <small>{filterSummary}</small>
        </div>
        <div className="row-actions">
          <button type="button" className="secondary" onClick={() => onBulkStatus("active")}>批量启用</button>
          <button type="button" className="danger" onClick={() => onBulkStatus("inactive")}>批量停用</button>
        </div>
      </div>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="key / user / rental / product"
        statusOptions={apiKeyStatusOptions}
        resourceTypeOptions={resourceTypeOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="API Key 管理" count={meta.total} headers={["用户", "Key", "租赁", "状态", "最近使用", "操作"]}>
        {apiKeys.map((apiKey) => (
          <tr key={apiKey.id}>
            <td>
              <strong>{apiKey.user?.email ?? apiKey.userId ?? "-"}</strong>
              <small>{apiKey.user?.displayName ?? apiKey.user?.id ?? "-"}</small>
            </td>
            <td>
              <strong>{apiKey.name}</strong>
              <small>{apiKey.keyPrefix}</small>
            </td>
            <td>
              <strong>{apiKey.rental?.product?.name ?? apiKey.rental?.resourceType ?? "-"}</strong>
              <small>{apiKey.rental?.id ?? apiKey.rentalId ?? "-"}</small>
              <small>{apiKey.rental?.endpointUrl ?? "-"}</small>
            </td>
            <td><StatusPill status={apiKey.status} /></td>
            <td>
              <strong>{dateTime(apiKey.lastUsedAt)}</strong>
              <small>创建 {dateTime(apiKey.createdAt)}</small>
            </td>
            <td>
              <div className="row-actions">
                {apiKey.userId && <button type="button" className="secondary mini" onClick={() => onOpenUser(apiKey.userId!)}>用户</button>}
                {apiKey.rental?.orderId && <button type="button" className="secondary mini" onClick={() => onOpenOrder(apiKey.rental!.orderId!)}>订单</button>}
                {(apiKey.rental?.id ?? apiKey.rentalId) && <button type="button" className="secondary mini" onClick={() => onOpenRental((apiKey.rental?.id ?? apiKey.rentalId)!)}>租赁</button>}
                {apiKey.rental?.productId && <button type="button" className="secondary mini" onClick={() => onOpenProduct(apiKey.rental!.productId!)}>商品</button>}
                <button type="button" className="secondary mini" onClick={() => onOpenProxyRequest(apiKey.id)}>反代</button>
                {(apiKey.rental?.id ?? apiKey.rentalId) && <button type="button" className="secondary mini" onClick={() => onOpenUsage((apiKey.rental?.id ?? apiKey.rentalId)!)}>用量</button>}
                <button type="button" className="secondary mini" onClick={() => onStatus(apiKey.id, "active")}>启用</button>
                <button type="button" className="danger mini" onClick={() => onStatus(apiKey.id, "inactive")}>停用</button>
              </div>
            </td>
          </tr>
        ))}
        {apiKeys.length === 0 && (
          <tr><td colSpan={6}><small>当前筛选没有匹配的 API Key。</small></td></tr>
        )}
      </TablePanel>
    </>
  );
}

function RentalDetailPanel({ rental, onClose, onOpenUser, onOpenOrder, onOpenProduct, onOpenApiKey, onOpenUsage, onOpenSettlement, onOpenProxyRequest }: {
  rental: RentalDetailRow;
  onClose: () => void;
  onOpenUser: (userId: string) => void;
  onOpenOrder: (orderId: string) => void;
  onOpenProduct: (lookup: string) => void;
  onOpenApiKey: (lookup: string) => void;
  onOpenUsage: (lookup: string) => void;
  onOpenSettlement: (lookup: string) => void;
  onOpenProxyRequest: (lookup: string) => void;
}) {
  const apiKeys = rental.apiKeys ?? [];
  const usages = rental.usages ?? [];
  const proxyRequests = rental.proxyRequestLogs ?? [];
  const usageCount = rental.usageSummary?._count ?? usages.length;
  const proxyRequestCount = rental.proxyRequestSummary?._count ?? proxyRequests.length;
  const usageSum = (key: string) => rental.usageSummary?._sum?.[key];

  return (
    <section className="panel glass-panel wide detail-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">Rental Detail</span>
          <h2>{rental.id}</h2>
        </div>
        <div className="row-actions">
          <StatusPill status={rental.status} />
          {rental.userId && <button className="secondary mini" onClick={() => onOpenUser(rental.userId!)}>打开用户</button>}
          {(rental.order?.id ?? rental.orderId) && <button className="secondary mini" onClick={() => onOpenOrder((rental.order?.id ?? rental.orderId)!)}>打开订单</button>}
          {rental.productId && <button className="secondary mini" onClick={() => onOpenProduct(rental.productId!)}>打开商品</button>}
          <button className="secondary mini" onClick={() => onOpenUsage(rental.id)}>打开用量</button>
          <button className="secondary mini" onClick={() => onOpenProxyRequest(rental.id)}>打开反代请求</button>
          <button className="secondary mini" onClick={onClose}>Close</button>
        </div>
      </div>

      <div className="diagnostic-grid">
        <div><span>User</span><strong>{rental.user?.email ?? rental.userId ?? "-"}</strong></div>
        <div><span>Product</span><strong>{rental.product?.name ?? rental.resourceType}</strong></div>
        <div><span>Order</span><strong>{rental.order?.id ?? "-"}</strong></div>
        <div><span>Endpoint</span><strong>{rental.endpointUrl ?? "-"}</strong></div>
        <div><span>Sub2 user</span><strong>{rental.sub2UserId ?? "-"}</strong></div>
        <div><span>Sub2 key</span><strong>{rental.sub2KeyId ?? "-"}</strong></div>
        <div><span>API keys</span><strong>{apiKeys.length}</strong></div>
        <div><span>Usage records</span><strong>{usageCount}</strong></div>
        <div><span>Buyer charge</span><strong>{money(usageSum("buyerCharge"))}</strong></div>
        <div><span>Supplier income</span><strong>{money(usageSum("supplierIncome"))}</strong></div>
        <div><span>Proxy requests</span><strong>{proxyRequestCount}</strong></div>
        <div><span>Ends at</span><strong>{dateTime(rental.endsAt)}</strong></div>
      </div>

      <section className="detail-grid">
        <DetailBlock title="Delivery">
          <MiniTable headers={["Field", "Value"]}>
            <tr><td>Rental ID</td><td><small>{rental.id}</small></td></tr>
            <tr><td>Status</td><td><StatusPill status={rental.status} /></td></tr>
            <tr><td>Resource type</td><td>{rental.resourceType}</td></tr>
            <tr><td>Endpoint</td><td><small>{rental.endpointUrl ?? "-"}</small></td></tr>
            <tr><td>Sub2 user ID</td><td><small>{rental.sub2UserId ?? "-"}</small></td></tr>
            <tr><td>Sub2 key ID</td><td><small>{rental.sub2KeyId ?? "-"}</small></td></tr>
            <tr><td>Created</td><td>{dateTime(rental.createdAt)}</td></tr>
            <tr><td>Expires</td><td>{dateTime(rental.endsAt)}</td></tr>
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="Limits">
          <MiniTable headers={["Field", "Value"]}>
            <tr><td>Max concurrency</td><td>{rental.limits?.maxConcurrency ?? "-"}</td></tr>
            <tr><td>RPM</td><td>{rental.limits?.rpmLimit ?? "-"}</td></tr>
            <tr><td>TPM</td><td>{rental.limits?.tpmLimit ?? "-"}</td></tr>
            <tr><td>Request limit</td><td>{rental.limits?.requestLimit ?? "-"}</td></tr>
            <tr><td>Spend limit</td><td>{money(rental.limits?.spendLimit)}</td></tr>
            <tr><td>Remaining spend</td><td>{money(rental.limits?.remainingSpend)}</td></tr>
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="API Keys">
          <MiniTable headers={["Name", "Prefix", "Status", "Last used", "Created", "操作"]}>
            {apiKeys.map((apiKey) => (
              <tr key={apiKey.id}>
                <td>{apiKey.name}</td>
                <td><small>{apiKey.keyPrefix}</small></td>
                <td><StatusPill status={apiKey.status} /></td>
                <td>{dateTime(apiKey.lastUsedAt)}</td>
                <td>{dateTime(apiKey.createdAt)}</td>
                <td><button className="secondary mini" onClick={() => onOpenApiKey(apiKey.id)}>打开</button></td>
              </tr>
            ))}
            {apiKeys.length === 0 && (
              <tr><td colSpan={6}><small>No API keys linked to this rental.</small></td></tr>
            )}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="Recent Usage">
          <MiniTable headers={["Request", "Model", "Status", "Tokens", "Charge", "Supplier", "Time", "操作"]}>
            {usages.slice(0, 10).map((usage) => (
              <tr key={usage.id}>
                <td><small>{usage.sub2RequestId}</small></td>
                <td>{usage.model ?? "-"}</td>
                <td><StatusPill status={usage.status} /></td>
                <td>{Number(usage.inputUnits).toFixed(0)} / {Number(usage.outputUnits).toFixed(0)}</td>
                <td><strong>{money(usage.buyerCharge)}</strong><small>Cost {money(usage.apiEquivalentCost)}</small></td>
                <td><strong>{money(usage.supplierIncome)}</strong><small>{usage.supplierResource?.supplier?.user?.email ?? usage.supplierResource?.sub2AccountId ?? "-"}</small></td>
                <td>{dateTime(usage.occurredAt)}</td>
                <td>
                  <div className="row-actions">
                    <button className="secondary mini" onClick={() => onOpenUsage(usage.id)}>用量</button>
                    <button className="secondary mini" onClick={() => onOpenProxyRequest(usage.sub2RequestId)}>反代</button>
                    {(usage.settlements ?? [])[0]?.id && <button className="secondary mini" onClick={() => onOpenSettlement((usage.settlements ?? [])[0]!.id)}>结算</button>}
                  </div>
                </td>
              </tr>
            ))}
            {usages.length === 0 && (
              <tr><td colSpan={8}><small>No usage records linked to this rental.</small></td></tr>
            )}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="Recent Proxy Requests">
          <MiniTable headers={["Status", "Request", "Key", "Duration", "Size", "Source", "Time", "操作"]}>
            {proxyRequests.slice(0, 10).map((log) => (
              <tr key={log.id}>
                <td>
                  <StatusPill status={proxyStatusTone(log.statusCode)} />
                  <small>{log.statusCode ?? "-"} / upstream {log.upstreamStatusCode ?? "-"}</small>
                  {log.errorCode && <small>{log.errorCode}</small>}
                </td>
                <td><strong>{log.method}</strong><small>{log.path}</small><small>{log.model ?? "-"}</small></td>
                <td><strong>{log.apiKey?.name ?? log.apiKeyPrefix ?? "-"}</strong><small>{log.apiKey?.keyPrefix ?? log.apiKeyPrefix ?? "-"}</small></td>
                <td>{log.durationMs}ms</td>
                <td><strong>{log.estimatedInputTokens} tokens</strong><small>{log.requestBytes} bytes</small></td>
                <td><small>{log.ipAddress ?? "-"}</small><small>{log.userAgent ?? "-"}</small></td>
                <td>{dateTime(log.createdAt)}</td>
                <td>
                  <div className="row-actions">
                    <button className="secondary mini" onClick={() => onOpenProxyRequest(log.requestId)}>反代</button>
                    {(log.apiKeyId ?? log.apiKey?.id ?? log.apiKeyPrefix ?? log.apiKey?.keyPrefix) && (
                      <button className="secondary mini" onClick={() => onOpenApiKey((log.apiKeyId ?? log.apiKey?.id ?? log.apiKeyPrefix ?? log.apiKey?.keyPrefix)!)}>Key</button>
                    )}
                    <button className="secondary mini" onClick={() => onOpenUsage(log.upstreamRequestId ?? log.requestId)}>用量</button>
                  </div>
                </td>
              </tr>
            ))}
            {proxyRequests.length === 0 && (
              <tr><td colSpan={8}><small>No proxy requests linked to this rental.</small></td></tr>
            )}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="Order">
          <MiniTable headers={["Field", "Value"]}>
            <tr><td>Order ID</td><td><small>{rental.order?.id ?? "-"}</small></td></tr>
            <tr><td>Order status</td><td>{rental.order ? <StatusPill status={rental.order.status} /> : "-"}</td></tr>
            <tr><td>Paid / total</td><td>{money(rental.order?.paidAmount)} / {money(rental.order?.totalAmount)}</td></tr>
            <tr><td>Items</td><td>{rental.order?.items?.length ?? 0}</td></tr>
            <tr><td>Created</td><td>{dateTime(rental.order?.createdAt)}</td></tr>
          </MiniTable>
        </DetailBlock>
      </section>
    </section>
  );
}

function Sub2StatusView({ status, tests, smoke, bindings, repairContext, onRefreshAccount, onTestAccount, onSmokeTest, onCheckBindings, onRepairBindings, onApplyRefreshToken }: {
  status: Sub2Status | null;
  tests: Record<number, Sub2AccountTestResult>;
  smoke: Sub2ProxySmokeTestResult | null;
  bindings: Sub2BindingReconciliationResult | null;
  repairContext: Sub2RepairContext;
  onRefreshAccount: (accountId: number) => void;
  onTestAccount: (accountId: number) => void;
  onSmokeTest: () => void;
  onCheckBindings: () => void;
  onRepairBindings: () => void;
  onApplyRefreshToken: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const accounts = status?.accounts ?? [];
  const openAiAccounts = accounts.filter((account) => account.platform === "openai");
  const groupAccounts = status?.defaultGroupId
    ? openAiAccounts.filter((account) => account.groupIds.includes(status.defaultGroupId!))
    : [];
  const activeAccounts = groupAccounts.filter((account) => account.status === "active");
  const preferredAccount = repairContext.accountId
    ? openAiAccounts.find((account) => String(account.id) === repairContext.accountId)
    : undefined;
  const repairAccount = preferredAccount
    ?? groupAccounts.find((account) => account.status !== "active" || account.schedulable === false)
    ?? openAiAccounts.find((account) => account.status !== "active" || account.schedulable === false)
    ?? openAiAccounts[0];
  const actionHints = Array.from(new Set((status?.blockingReasons ?? []).map(sub2BlockingReasonActionHint)));
  const repairContextItems = sub2RepairContextItems(repairContext);
  const shouldRunSmokeTest = sub2RepairContextShouldRunSmokeTest(repairContext);
  const smokeModel = sub2RepairContextSmokeModel(repairContext);

  return (
    <section className="stack">
      <section className="cards compact-cards">
        <Metric label="网关健康" value={status?.gatewayReachable ? "正常" : "异常"} />
        <Metric label="默认分组" value={status?.openAiGroup ? `${status.openAiGroup.name} #${status.openAiGroup.id}` : "-"} />
        <Metric label="可用上游" value={`${activeAccounts.length}/${groupAccounts.length}`} />
        <Metric label="反代状态" value={status?.ready ? "可用" : "阻断"} />
      </section>
      <div className="panel glass-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Codex Proxy</span>
            <h2>OpenAI/Codex 反代诊断</h2>
          </div>
          <div className="row-actions">
            <StatusPill status={status?.ready ? "active" : "failed"} />
            <button className="secondary mini" onClick={onSmokeTest}>端到端自检</button>
          </div>
        </div>
        <div className="diagnostic-grid">
          <div><span>Sub2API</span><strong>{status?.baseUrl ?? "-"}</strong></div>
          <div><span>Endpoint</span><strong>{status?.publicEndpoint ?? "-"}</strong></div>
          <div><span>检查时间</span><strong>{dateTime(status?.checkedAt)}</strong></div>
          <div><span>阻断原因</span><strong>{status?.blockingReasons.length ? status.blockingReasons.join(", ") : "none"}</strong></div>
          <div><span>维修建议</span><strong>{actionHints.length ? actionHints.join(" / ") : "运行端到端自检确认真实生成"}</strong></div>
        </div>
        {smoke && (
          <div className="diagnostic-grid">
            <div><span>自检模型</span><strong>{smoke.model}</strong></div>
            <div><span>临时 Key</span><strong>{smoke.keyDisabled ? "已禁用" : "未清理"}</strong></div>
            <div><span>Models</span><strong>{smoke.models.ok ? `通过 / ${smoke.models.modelCount}` : `失败 / HTTP ${smoke.models.statusCode}`}</strong></div>
            <div><span>Responses</span><strong>{smoke.responses.ok ? "通过" : smoke.responses.errorMessage ?? smoke.responses.errorType ?? `HTTP ${smoke.responses.statusCode}`}</strong></div>
            <div><span>本地代理</span><strong>{smoke.localProxy?.ok ? "通过" : "失败"}</strong></div>
            <div><span>代理日志</span><strong>{smoke.localProxy?.proxyRequestLogCount ?? 0}</strong></div>
            <div><span>本地清理</span><strong>{smoke.localProxy?.apiKeyDeactivated && smoke.localProxy.rentalClosed && smoke.localProxy.orderClosed && smoke.localProxy.walletReset ? "完成" : "待复查"}</strong></div>
          </div>
        )}
      </div>
      {repairContextItems.length > 0 && (
        <div className="panel glass-panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">Repair Context</span>
              <h2>修复定位</h2>
            </div>
            <StatusPill status={repairContext.accountId ? "active" : "warning"} />
          </div>
          <div className="diagnostic-grid">
            {repairContextItems.map((item) => (
              <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>
            ))}
          </div>
        </div>
      )}
      <div className="panel glass-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Object mapping</span>
            <h2>Sub2 绑定巡检</h2>
          </div>
          <div className="row-actions">
            <StatusPill status={bindings?.ok ? "active" : "warning"} />
            <button className="secondary mini" onClick={onCheckBindings}>巡检绑定</button>
            <button className="secondary mini" onClick={onRepairBindings}>修复绑定</button>
          </div>
        </div>
        <div className="diagnostic-grid">
          <div><span>租赁扫描</span><strong>{bindings?.summary.rentalsScanned ?? "-"}</strong></div>
          <div><span>绑定扫描</span><strong>{bindings?.summary.bindingsScanned ?? "-"}</strong></div>
          <div><span>问题数</span><strong>{bindings?.summary.totalIssues ?? "-"}</strong></div>
          <div><span>检查时间</span><strong>{dateTime(bindings?.checkedAt)}</strong></div>
        </div>
        {bindings && bindings.issues.length > 0 && (
          <div className="compact-table table-wrap">
            <table>
              <thead><tr><th>类型</th><th>租赁</th><th>期望/实际</th><th>说明</th></tr></thead>
              <tbody>
                {bindings.issues.slice(0, 8).map((issue) => (
                  <tr key={issue.id}>
                    <td><StatusPill status={issue.severity} /><small>{issue.type}</small></td>
                    <td><small>{issue.rentalId ?? "-"}</small></td>
                    <td><strong>{issue.expected ?? "-"}</strong><small>{issue.actual ?? "-"}</small></td>
                    <td><small>{issue.message}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <form className="panel glass-panel inline-form credential-form" key={`credential-${repairContext.accountId ?? "auto"}-${repairContext.resourceId ?? ""}-${repairContext.supplierEmail ?? ""}-${smokeModel}-${shouldRunSmokeTest ? "smoke" : "manual"}`} onSubmit={onApplyRefreshToken}>
        <span className="eyebrow">Apply OpenAI Credentials</span>
        <select key={`${repairAccount?.id ?? "none"}-${repairContext.accountId ?? "auto"}`} name="accountId" required defaultValue={repairAccount ? String(repairAccount.id) : ""}>
          <option value="">选择上游账号</option>
          {openAiAccounts.map((account) => (
            <option key={account.id} value={account.id}>#{account.id} {account.name}{preferredAccount?.id === account.id ? " · 巡检定位" : repairAccount?.id === account.id ? " · 建议修复" : ""}</option>
          ))}
        </select>
        <input name="refreshToken" type="password" placeholder="OpenAI refresh token" autoComplete="off" required />
        <input name="clientId" placeholder="client_id，可选" autoComplete="off" />
        <input name="proxyId" type="number" min={1} placeholder="proxy_id，可选" />
        <label className="checkbox-line">
          <input name="runAccountTest" type="checkbox" defaultChecked />
          <span>应用后测试账号</span>
        </label>
        <label className="checkbox-line">
          <input name="runSmokeTest" type="checkbox" defaultChecked={shouldRunSmokeTest} />
          <span>应用后端到端自检</span>
        </label>
        <input name="smokeModel" defaultValue={smokeModel} placeholder="自检模型，可选" autoComplete="off" />
        <label className="checkbox-line">
          <input name="saveToResource" type="checkbox" defaultChecked={Boolean(repairContext.resourceId || repairContext.supplierEmail)} />
          <span>保存为共享资源凭据</span>
        </label>
        <input name="resourceId" defaultValue={repairContext.resourceId ?? ""} placeholder="目标资源 ID，可选" autoComplete="off" />
        <input name="supplierEmail" type="email" defaultValue={repairContext.supplierEmail ?? ""} placeholder="供给方邮箱，新建资源时必填" autoComplete="off" />
        <button>应用凭据</button>
      </form>
      <TablePanel title="OpenAI 上游账号" count={accounts.length} headers={["账号", "分组", "状态", "凭据 / 调度", "并发", "最近错误 / 测试结果", "操作"]}>
        {accounts.map((account) => (
          <tr key={account.id}>
            <td><strong>{account.name}</strong><small>#{account.id} / {account.platform} / {account.type}</small></td>
            <td>{account.groupNames.length ? account.groupNames.join(", ") : account.groupIds.join(", ") || "-"}</td>
            <td><StatusPill status={account.status} /></td>
            <td>
              <small>凭据 {account.credentialsStatus ?? "-"}</small>
              <small>调度 {account.schedulable === undefined ? "-" : account.schedulable ? "可调度" : "不可调度"}</small>
              <small>更新 {dateTime(account.updatedAt)}</small>
            </td>
            <td>{account.currentConcurrency ?? 0} / {account.concurrency ?? "-"}</td>
            <td>
              <small>{account.errorMessage ?? account.tempUnschedulableReason ?? "-"}</small>
              {(account.rateLimitedAt || account.overloadUntil || account.tempUnschedulableUntil) && (
                <small>
                  {account.rateLimitedAt ? `限速 ${dateTime(account.rateLimitedAt)}` : ""}
                  {account.overloadUntil ? ` 过载到 ${dateTime(account.overloadUntil)}` : ""}
                  {account.tempUnschedulableUntil ? ` 临时阻断到 ${dateTime(account.tempUnschedulableUntil)}` : ""}
                </small>
              )}
              {tests[account.id] && (
                <small>
                  测试 {tests[account.id].ok ? "通过" : "失败"} / HTTP {tests[account.id].statusCode} / {testSummary(tests[account.id])}
                </small>
              )}
            </td>
            <td>
              <div className="row-actions">
                <button className="secondary mini" onClick={() => onTestAccount(account.id)}>测试账号</button>
                <button className="secondary mini" onClick={() => onRefreshAccount(account.id)}>刷新凭据</button>
              </div>
            </td>
          </tr>
        ))}
      </TablePanel>
    </section>
  );
}

function ProxyRequestsView({ logs, query, meta, onDraft, onFilter, onClear, onPage, onExport, onCopyRequestId, onOpenUser, onOpenOrder, onOpenRental, onOpenApiKey, onOpenProduct, onOpenUsage }: {
  logs: ProxyRequestLogRow[];
  onCopyRequestId: (requestId: string) => void;
  onOpenUser: (userId: string) => void;
  onOpenOrder: (orderId: string) => void;
  onOpenRental: (rentalId: string) => void;
  onOpenApiKey: (lookup: string) => void;
  onOpenProduct: (lookup: string) => void;
  onOpenUsage: (lookup: string) => void;
} & ManagedListProps) {
  return (
    <>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="request id / upstream id / user / rental / key / model / path"
        statusOptions={proxyStatusOptions}
        actionPlaceholder="error code contains"
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="OpenAI/Codex 反代请求" count={meta.total} headers={["请求 ID", "用户", "租赁 / Key", "请求", "状态", "耗时", "用量估算", "来源", "时间", "操作"]}>
        {logs.map((log) => {
          const orderId = log.rental?.orderId;
          const productId = log.rental?.productId;
          const apiKeyLookup = log.apiKeyId ?? log.apiKey?.id ?? log.apiKeyPrefix ?? log.apiKey?.keyPrefix;
          const usageLookup = log.upstreamRequestId ?? log.requestId;
          return (
            <tr key={log.id}>
              <td>
                <strong>{log.requestId}</strong>
                <button className="secondary mini" type="button" title="复制请求 ID" onClick={() => onCopyRequestId(log.requestId)}><Copy size={14} /></button>
                {log.upstreamRequestId && <small>upstream {log.upstreamRequestId}</small>}
              </td>
              <td><strong>{log.user?.email ?? log.userId ?? "-"}</strong><small>{log.user?.displayName ?? log.user?.id ?? "-"}</small></td>
              <td>
                <strong>{log.rental?.product?.name ?? log.rentalId ?? "-"}</strong>
                <small>{log.apiKey?.name ?? log.apiKeyPrefix ?? log.apiKeyId ?? "-"}</small>
              </td>
              <td><strong>{log.method}</strong><small>{log.path}</small><small>{log.model ?? "-"}</small></td>
              <td>
                <StatusPill status={proxyStatusTone(log.statusCode)} />
                <small>{log.statusCode ?? "-"} / upstream {log.upstreamStatusCode ?? "-"}</small>
                {log.errorCode && <small>{log.errorCode}</small>}
              </td>
              <td>{log.durationMs}ms</td>
              <td><strong>{log.estimatedInputTokens} tokens</strong><small>{log.requestBytes} bytes</small></td>
              <td><small>{log.ipAddress ?? "-"}</small><small>{log.userAgent ?? "-"}</small></td>
              <td>{dateTime(log.createdAt)}</td>
              <td>
                <div className="row-actions">
                  {log.userId && <button className="secondary mini" onClick={() => onOpenUser(log.userId!)}>用户</button>}
                  {orderId && <button className="secondary mini" onClick={() => onOpenOrder(orderId)}>订单</button>}
                  {log.rentalId && <button className="secondary mini" onClick={() => onOpenRental(log.rentalId!)}>租赁</button>}
                  {apiKeyLookup && <button className="secondary mini" onClick={() => onOpenApiKey(apiKeyLookup)}>API Key</button>}
                  {productId && <button className="secondary mini" onClick={() => onOpenProduct(productId)}>商品</button>}
                  <button className="secondary mini" onClick={() => onOpenUsage(usageLookup)}>用量</button>
                </div>
              </td>
            </tr>
          );
        })}
      </TablePanel>
    </>
  );
}

function SuppliersView({ suppliers, query, meta, onUpdate, onOpenUser, onOpenResources, onOpenResource, onOpenWithdrawal, onDraft, onFilter, onClear, onPage, onExport }: {
  suppliers: SupplierDetailRow[];
  onUpdate: (event: FormEvent<HTMLFormElement>, supplierId: string) => void;
  onOpenUser: (userId: string) => void;
  onOpenResources: (filter?: { supplierEmail?: string; resourceType?: string; status?: string; scope?: string; sub2AccountId?: string }) => void;
  onOpenResource: (resourceId: string) => void;
  onOpenWithdrawal: (lookup: string) => void;
} & ManagedListProps) {
  return (
    <>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="supplier / email / user id"
        statusOptions={supplierStatusOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="供给方管理" count={meta.total} headers={["供给方", "状态", "默认分成", "资源 / 提现", "最近资源", "配置"]}>
        {suppliers.map((supplier) => {
          const supplierEmail = supplier.user?.email;
          return (
            <tr key={supplier.id}>
              <td>
                <strong>{supplierEmail ?? supplier.userId ?? "-"}</strong>
                <small>{supplier.displayName ?? supplier.user?.displayName ?? supplier.id}</small>
              </td>
              <td><StatusPill status={supplier.status} /></td>
              <td>{supplier.defaultShareRate}</td>
              <td>{supplier._count?.resources ?? supplier.resources?.length ?? 0} / {supplier._count?.withdrawals ?? supplier.withdrawals?.length ?? 0}</td>
              <td>
                {(supplier.resources ?? []).slice(0, 3).map((resource) => (
                  <small key={resource.id}>
                    {resource.resourceType} / {resource.status} / {resource.sub2AccountId ?? "-"}
                    <button className="secondary mini inline-action" type="button" onClick={() => onOpenResource(resource.id)}>打开</button>
                  </small>
                ))}
                {(supplier.resources ?? []).length === 0 && <small>-</small>}
              </td>
              <td>
                <div className="row-actions">
                  {supplier.userId && <button type="button" className="secondary mini" onClick={() => onOpenUser(supplier.userId!)}>用户</button>}
                  <button type="button" className="secondary mini" onClick={() => onOpenResources({ supplierEmail })}>资源</button>
                  <button type="button" className="secondary mini" onClick={() => onOpenWithdrawal(supplierEmail ?? supplier.id)}>提现</button>
                </div>
                <form className="limits-form" key={`${supplier.id}-${supplier.updatedAt ?? ""}`} onSubmit={(event) => onUpdate(event, supplier.id)}>
                  <input name="displayName" defaultValue={supplier.displayName ?? ""} placeholder="显示名，留空清除" />
                  <select name="status" defaultValue={supplier.status} required>
                    {supplierStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                  <input name="defaultShareRate" type="number" step="0.01" min={0} max={1} defaultValue={supplier.defaultShareRate} placeholder="默认分成" required />
                  <button type="submit" className="secondary mini">保存供给方</button>
                </form>
              </td>
            </tr>
          );
        })}
      </TablePanel>
    </>
  );
}

function ResourcesView({ resources, selectedResource, createDefaults, query, meta, onCreate, onUpdate, onCredential, onDeleteCredential, onApplyCredentialToSub2, onStatus, onTest, onDetail, onCloseDetail, onOpenUser, onOpenSub2Status, onOpenUsage, onOpenSettlement, onOpenWithdrawal, onOpenRental, onOpenProxyRequest, onDraft, onFilter, onClear, onPage, onExport }: {
  resources: ResourceRow[];
  selectedResource: ResourceDetailRow | null;
  createDefaults: ResourceCreateDefaults;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onUpdate: (event: FormEvent<HTMLFormElement>, resourceId: string) => void;
  onCredential: (event: FormEvent<HTMLFormElement>, resourceId: string) => void;
  onDeleteCredential: (resourceId: string) => void;
  onApplyCredentialToSub2: (event: FormEvent<HTMLFormElement>, resourceId: string) => void;
  onStatus: (resourceId: string, status: ResourceStatus) => void;
  onTest: (resourceId: string) => void;
  onDetail: (resourceId: string) => void;
  onCloseDetail: () => void;
  onOpenUser: (userId: string) => void;
  onOpenSub2Status: (context?: string | Sub2RepairContext) => void;
  onOpenUsage: (lookup: string) => void;
  onOpenSettlement: (lookup: string) => void;
  onOpenWithdrawal: (lookup: string) => void;
  onOpenRental: (rentalId: string) => void;
  onOpenProxyRequest: (lookup: string) => void;
} & ManagedListProps) {
  const createResourceType = resourceTypeOptions.includes(createDefaults.resourceType ?? "") ? createDefaults.resourceType! : "codex";
  const createSub2AccountId = createDefaults.sub2AccountId ?? "";
  const createSupplierEmail = createDefaults.supplierEmail ?? "";
  const createApplyCredentialToSub2 = resourceCreateDefaultsShouldApplyCredential(createDefaults);
  const createRunSmokeTest = resourceCreateDefaultsShouldRunSmokeTest(createDefaults);
  const createSmokeModel = resourceCreateDefaultsSmokeModel(createDefaults);
  const createContextItems = resourceCreateDefaultsContextItems(createDefaults);
  return (
    <>
      <form key={`${createSupplierEmail}:${createResourceType}:${createSub2AccountId}:${createApplyCredentialToSub2 ? "apply" : "manual"}:${createRunSmokeTest ? "smoke" : "no-smoke"}:${createSmokeModel}`} className="panel glass-panel inline-form resource-form" onSubmit={onCreate}>
        <span className="eyebrow">Create resource</span>
        {createContextItems.length > 0 && (
          <div className="diagnostic-grid resource-create-context wide">
            {createContextItems.map((item) => (
              <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>
            ))}
          </div>
        )}
        <input name="supplierEmail" type="email" defaultValue={createSupplierEmail} placeholder="供给方邮箱" required />
        <input name="displayName" placeholder="供给方显示名，可选" />
        <select name="resourceType" defaultValue={createResourceType} required>
          {resourceTypeOptions.map((resourceType) => <option key={resourceType} value={resourceType}>{resourceType}</option>)}
        </select>
        <select name="status" defaultValue="pending" required>
          {resourceStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <select name="level" defaultValue="L0" required>
          {["L0", "L1", "L2", "L3", "L4"].map((level) => <option key={level} value={level}>{level}</option>)}
        </select>
        <input name="maxConcurrency" type="number" min={1} max={200} defaultValue={1} placeholder="并发" required />
        <input name="shareRate" type="number" step="0.01" min={0} max={1} defaultValue={0.7} placeholder="分成" required />
        <input name="reserveRatio" type="number" step="0.01" min={0} max={1} defaultValue={0.2} placeholder="保留比例" required />
        <input name="dailyCap" type="number" step="0.01" min={0} placeholder="日上限，可选" />
        <input name="sub2AccountId" defaultValue={createSub2AccountId} placeholder="Sub2 账号 ID，可选" />
        <select name="credentialType" defaultValue="openai_refresh_token">
          {resourceCredentialTypeOptions.map((credentialType) => <option key={credentialType} value={credentialType}>{credentialType}</option>)}
        </select>
        <select name="credentialStatus" defaultValue="active">
          {resourceCredentialStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <input name="credentialSecret" type="password" minLength={8} placeholder="初始凭据，可选" autoComplete="off" />
        <label className="checkbox-line"><input name="applyCredentialToSub2" type="checkbox" defaultChecked={createApplyCredentialToSub2} /><span>创建后应用到 Sub2</span></label>
        <input name="credentialClientId" placeholder="client_id，可选" autoComplete="off" />
        <input name="credentialProxyId" type="number" min={1} placeholder="proxy_id，可选" />
        <label className="checkbox-line"><input name="credentialRunSmokeTest" type="checkbox" defaultChecked={createRunSmokeTest} /><span>应用后端到端自检</span></label>
        <input name="credentialSmokeModel" defaultValue={createSmokeModel} placeholder="自检模型，可选" autoComplete="off" />
        <button>创建共享资源</button>
      </form>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="supplier / resource id / sub2 account"
        statusOptions={resourceStatusOptions}
        resourceTypeOptions={resourceTypeOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="共享资源池" count={meta.total} headers={["供给方", "资源", "状态", "等级", "分成 / 日限额", "Sub2 / 凭据", "操作"]}>
        {resources.map((resource) => {
          const supplierUserId = resource.supplier?.user?.id;
          const supplierEmail = resource.supplier?.user?.email;
          return (
            <tr key={resource.id}>
              <td><strong>{supplierEmail ?? "-"}</strong><small>{resource.id}</small></td>
              <td>{resource.resourceType} / 并发 {resource.maxConcurrency}</td>
              <td><StatusPill status={resource.status} /></td>
              <td>{resource.level}</td>
              <td><strong>{resource.shareRate ?? "-"}</strong><small>{resource.reserveRatio ?? "-"} / {money(resource.dailyCap)}</small></td>
              <td><strong>{resource.sub2AccountId ?? "-"}</strong><small>{resource.credential ? `${resource.credential.credentialType} / ${resource.credential.status}` : "无凭据"}</small></td>
              <td>
                <div className="row-actions">
                  <button className="secondary mini" onClick={() => onDetail(resource.id)}>详情</button>
                  {supplierUserId && <button className="secondary mini" onClick={() => onOpenUser(supplierUserId)}>供给方</button>}
                  {resource.sub2AccountId && (
                    <button className="secondary mini" onClick={() => onOpenSub2Status(resourceRepairContext(resource, supplierEmail))}>反代</button>
                  )}
                  <button className="secondary mini" onClick={() => onOpenUsage(resource.id)}>用量</button>
                  <button className="secondary mini" onClick={() => onOpenSettlement(resource.id)}>结算</button>
                  <button className="secondary mini" onClick={() => onTest(resource.id)}>测试</button>
                  <button className="secondary mini" onClick={() => onStatus(resource.id, "online")}>上线</button>
                  <button className="secondary mini" onClick={() => onStatus(resource.id, "paused")}>暂停</button>
                  <button className="danger mini" onClick={() => onStatus(resource.id, "disabled")}>禁用</button>
                </div>
              </td>
            </tr>
          );
        })}
      </TablePanel>
      {selectedResource && (
        <ResourceDetailPanel
          resource={selectedResource}
          onUpdate={onUpdate}
          onCredential={onCredential}
          onDeleteCredential={onDeleteCredential}
          onApplyCredentialToSub2={onApplyCredentialToSub2}
          onClose={onCloseDetail}
          onOpenUser={onOpenUser}
          onOpenSub2Status={onOpenSub2Status}
          onOpenUsage={onOpenUsage}
          onOpenSettlement={onOpenSettlement}
          onOpenWithdrawal={onOpenWithdrawal}
          onOpenRental={onOpenRental}
          onOpenProxyRequest={onOpenProxyRequest}
        />
      )}
    </>
  );
}

function resourceRepairContext(resource: ResourceRow, supplierEmail?: string): Sub2RepairContext {
  return {
    accountId: resource.sub2AccountId,
    resourceId: resource.id,
    resourceType: resource.resourceType,
    resourceStatus: resource.status,
    supplierEmail
  };
}

function systemHealthIssueSub2RepairContext(issue: SystemHealthIssueRow): Sub2RepairContext {
  return {
    accountId: issue.sub2AccountId,
    sub2AccountName: issue.sub2AccountName,
    accountStatus: issue.accountStatus,
    credentialsStatus: issue.credentialsStatus,
    schedulable: issue.schedulable,
    accountMessage: issue.accountMessage,
    accountUpdatedAt: issue.accountUpdatedAt,
    tempUnschedulableReason: issue.tempUnschedulableReason,
    checkId: issue.checkId,
    checkLabel: issue.checkLabel,
    repairAction: issue.repairAction,
    actionHint: issue.actionHint,
    resourceId: issue.resourceId,
    resourceType: issue.resourceType,
    resourceStatus: issue.resourceStatus,
    resourceScope: issue.resourceScope,
    supplierEmail: issue.supplierEmail,
    requestId: issue.requestId ?? issue.proxyRequestLookup,
    proxyRequestLogId: issue.proxyRequestLogId,
    upstreamRequestId: issue.upstreamRequestId,
    proxyRequestPath: issue.proxyRequestPath,
    proxyRequestStatusCode: issue.proxyRequestStatusCode,
    proxyRequestErrorCode: issue.proxyRequestErrorCode,
    model: issue.model,
    modelsOk: issue.modelsOk,
    responsesOk: issue.responsesOk,
    localProxyOk: issue.localProxyOk,
    smokeTestSkippedReason: issue.smokeTestSkippedReason,
    ageMinutes: issue.ageMinutes,
    stale: issue.stale,
    staleThresholdMinutes: issue.staleThresholdMinutes,
    freshMinutesRemaining: issue.freshMinutesRemaining,
    staleAt: issue.staleAt
  };
}

function systemHealthSampleSub2RepairContext(sample: SystemHealthSampleRow): Sub2RepairContext {
  return {
    accountId: sample.sub2AccountId,
    sub2AccountName: sample.sub2AccountName,
    accountStatus: sample.accountStatus,
    credentialsStatus: sample.credentialsStatus,
    schedulable: sample.schedulable,
    accountMessage: sample.accountMessage,
    accountUpdatedAt: sample.accountUpdatedAt,
    tempUnschedulableReason: sample.tempUnschedulableReason,
    checkId: sample.checkId,
    checkLabel: sample.sampleType ? `${sample.checkLabel} / ${sample.sampleType}` : sample.checkLabel,
    repairAction: sample.repairAction,
    actionHint: sample.actionHint,
    resourceId: sample.resourceId,
    resourceType: sample.resourceType,
    resourceStatus: sample.resourceStatus,
    resourceScope: sample.resourceScope,
    supplierEmail: sample.supplierEmail,
    requestId: sample.requestId ?? sample.proxyRequestLookup,
    proxyRequestLogId: sample.proxyRequestLogId,
    upstreamRequestId: sample.upstreamRequestId,
    proxyRequestPath: sample.proxyRequestPath,
    proxyRequestStatusCode: sample.proxyRequestStatusCode,
    proxyRequestErrorCode: sample.proxyRequestErrorCode,
    model: sample.model,
    modelsOk: sample.modelsOk,
    responsesOk: sample.responsesOk,
    localProxyOk: sample.localProxyOk,
    smokeTestSkippedReason: sample.smokeTestSkippedReason,
    ageMinutes: sample.ageMinutes,
    stale: sample.stale,
    staleThresholdMinutes: sample.staleThresholdMinutes,
    freshMinutesRemaining: sample.freshMinutesRemaining,
    staleAt: sample.staleAt
  };
}

function ResourceDetailPanel({ resource, onUpdate, onCredential, onDeleteCredential, onApplyCredentialToSub2, onClose, onOpenUser, onOpenSub2Status, onOpenUsage, onOpenSettlement, onOpenWithdrawal, onOpenRental, onOpenProxyRequest }: {
  resource: ResourceDetailRow;
  onUpdate: (event: FormEvent<HTMLFormElement>, resourceId: string) => void;
  onCredential: (event: FormEvent<HTMLFormElement>, resourceId: string) => void;
  onDeleteCredential: (resourceId: string) => void;
  onApplyCredentialToSub2: (event: FormEvent<HTMLFormElement>, resourceId: string) => void;
  onClose: () => void;
  onOpenUser: (userId: string) => void;
  onOpenSub2Status: (context?: string | Sub2RepairContext) => void;
  onOpenUsage: (lookup: string) => void;
  onOpenSettlement: (lookup: string) => void;
  onOpenWithdrawal: (lookup: string) => void;
  onOpenRental: (rentalId: string) => void;
  onOpenProxyRequest: (lookup: string) => void;
}) {
  const usages = resource.usages ?? [];
  const settlements = resource.settlements ?? [];
  const usageCount = resource.usageSummary?._count ?? usages.length;
  const settlementCount = resource.settlementSummary?._count ?? settlements.length;
  const supplierUserId = resource.supplier?.user?.id;
  const supplierEmail = resource.supplier?.user?.email;

  return (
    <section className="panel glass-panel wide detail-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">Resource Detail</span>
          <h2>{resource.resourceType} / {resource.id}</h2>
        </div>
        <div className="row-actions">
          <StatusPill status={resource.status} />
          {supplierUserId && <button className="secondary mini" onClick={() => onOpenUser(supplierUserId)}>打开供给方</button>}
          {resource.sub2AccountId && (
            <button className="secondary mini" onClick={() => onOpenSub2Status(resourceRepairContext(resource, supplierEmail))}>打开反代状态</button>
          )}
          <button className="secondary mini" onClick={() => onOpenUsage(resource.id)}>打开用量</button>
          <button className="secondary mini" onClick={() => onOpenSettlement(resource.id)}>打开结算</button>
          <button className="secondary mini" onClick={() => onOpenWithdrawal(supplierEmail ?? resource.supplier?.id ?? resource.id)}>打开提现</button>
          <button className="secondary mini" onClick={onClose}>关闭</button>
        </div>
      </div>

      <div className="diagnostic-grid">
        <div><span>供给方</span><strong>{resource.supplier?.user?.email ?? "-"}</strong></div>
        <div><span>等级 / 并发</span><strong>{resource.level} / {resource.maxConcurrency}</strong></div>
        <div><span>Sub2 账号</span><strong>{resource.sub2AccountId ?? "-"}</strong></div>
        <div><span>接入凭据</span><strong>{resource.credential ? resource.credential.status : "未登记"}</strong></div>
        <div><span>分成 / 保留</span><strong>{resource.shareRate ?? "-"} / {resource.reserveRatio ?? "-"}</strong></div>
        <div><span>用量记录</span><strong>{usageCount}</strong></div>
        <div><span>买家计费</span><strong>{money(resource.usageSummary?._sum?.buyerCharge)}</strong></div>
        <div><span>供给收入</span><strong>{money(resource.usageSummary?._sum?.supplierIncome)}</strong></div>
        <div><span>结算金额</span><strong>{money(resource.settlementSummary?._sum?.amount)}</strong></div>
      </div>

      <section className="detail-grid">
        <DetailBlock title="资源配置">
          <MiniTable headers={["字段", "值"]}>
            <tr><td>资源类型</td><td>{resource.resourceType}</td></tr>
            <tr><td>状态</td><td><StatusPill status={resource.status} /></td></tr>
            <tr><td>日上限</td><td>{money(resource.dailyCap)}</td></tr>
            <tr><td>最后检查</td><td>{dateTime(resource.lastCheckedAt)}</td></tr>
            <tr><td>创建时间</td><td>{dateTime(resource.createdAt)}</td></tr>
            <tr><td>更新时间</td><td>{dateTime(resource.updatedAt)}</td></tr>
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="配置调整">
          <form className="resource-config-form" key={`${resource.id}-${resource.updatedAt ?? ""}`} onSubmit={(event) => onUpdate(event, resource.id)}>
            <select name="status" defaultValue={resource.status} required>
              {resourceStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <select name="level" defaultValue={resource.level} required>
              {["L0", "L1", "L2", "L3", "L4"].map((level) => <option key={level} value={level}>{level}</option>)}
            </select>
            <input name="maxConcurrency" type="number" min={1} max={200} defaultValue={resource.maxConcurrency} placeholder="并发" required />
            <input name="shareRate" type="number" step="0.01" min={0} max={1} defaultValue={resource.shareRate ?? "0.7"} placeholder="分成" required />
            <input name="reserveRatio" type="number" step="0.01" min={0} max={1} defaultValue={resource.reserveRatio ?? "0.2"} placeholder="保留比例" required />
            <input name="dailyCap" type="number" step="0.01" min={0} defaultValue={resource.dailyCap ?? ""} placeholder="日上限，留空清除" />
            <input name="sub2AccountId" defaultValue={resource.sub2AccountId ?? ""} placeholder="Sub2 账号 ID，留空清除" />
            <button>保存配置</button>
          </form>
        </DetailBlock>

        <DetailBlock title="接入凭据">
          <MiniTable headers={["字段", "值"]}>
            <tr><td>类型</td><td>{resource.credential?.credentialType ?? "-"}</td></tr>
            <tr><td>状态</td><td>{resource.credential?.status ?? "-"}</td></tr>
            <tr><td>指纹</td><td>{resource.credential?.keyFingerprint ?? "-"}</td></tr>
            <tr><td>加密</td><td>{resource.credential?.encryptionVersion ?? "-"}</td></tr>
            <tr><td>轮换时间</td><td>{dateTime(resource.credential?.lastRotatedAt)}</td></tr>
          </MiniTable>
          <form className="resource-config-form" onSubmit={(event) => onCredential(event, resource.id)}>
            <select name="credentialType" defaultValue={resource.credential?.credentialType ?? "openai_refresh_token"} required>
              {resourceCredentialTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <select name="status" defaultValue={resource.credential?.status ?? "active"} required>
              {resourceCredentialStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <input name="secret" type="password" minLength={8} placeholder="新凭据" autoComplete="off" required />
            <button>保存凭据</button>
          </form>
          {resource.credential?.credentialType === "openai_refresh_token" && (
            <form className="resource-config-form" onSubmit={(event) => onApplyCredentialToSub2(event, resource.id)}>
              <input name="clientId" placeholder="client_id，可选" autoComplete="off" />
              <input name="proxyId" type="number" min={1} placeholder="proxy_id，可选" />
              <label className="checkbox-line">
                <input name="runSmokeTest" type="checkbox" />
                <span>应用后端到端自检</span>
              </label>
              <input name="smokeModel" placeholder="自检模型，可选" autoComplete="off" />
              <button disabled={!resource.sub2AccountId || resource.credential.status !== "active"}>应用到 Sub2</button>
            </form>
          )}
          {resource.credential && (
            <button className="danger mini" type="button" onClick={() => onDeleteCredential(resource.id)}>删除凭据</button>
          )}
        </DetailBlock>

        <DetailBlock title="最近凭据应用">
          <ResourceCredentialApplyLogTable logs={resource.credentialApplyLogs} onOpenProxyRequest={onOpenProxyRequest} onOpenSub2Status={onOpenSub2Status} />
        </DetailBlock>

        <DetailBlock title="供给方">
          <MiniTable headers={["字段", "值"]}>
            <tr><td>邮箱</td><td>{resource.supplier?.user?.email ?? "-"}</td></tr>
            <tr><td>显示名</td><td>{resource.supplier?.displayName ?? resource.supplier?.user?.displayName ?? "-"}</td></tr>
            <tr><td>状态</td><td>{resource.supplier?.status ?? "-"}</td></tr>
            <tr><td>默认分成</td><td>{resource.supplier?.defaultShareRate ?? "-"}</td></tr>
            <tr>
              <td>操作</td>
              <td>
                <div className="row-actions">
                  {supplierUserId && <button className="secondary mini" onClick={() => onOpenUser(supplierUserId)}>打开用户</button>}
                  <button className="secondary mini" onClick={() => onOpenWithdrawal(supplierEmail ?? resource.supplier?.id ?? resource.id)}>打开提现</button>
                </div>
              </td>
            </tr>
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="最近用量">
          <MiniTable headers={["请求", "用户", "模型", "状态", "买家计费", "供给收入", "时间", "操作"]}>
            {usages.slice(0, 10).map((usage) => (
              <tr key={usage.id}>
                <td><small>{usage.sub2RequestId}</small></td>
                <td><small>{usage.rental?.user?.email ?? "-"}</small></td>
                <td>{usage.model ?? "-"}</td>
                <td><StatusPill status={usage.status} /></td>
                <td>{money(usage.buyerCharge)}</td>
                <td>{money(usage.supplierIncome)}</td>
                <td>{dateTime(usage.occurredAt)}</td>
                <td>
                  <div className="row-actions">
                    <button className="secondary mini" onClick={() => onOpenUsage(usage.id)}>用量</button>
                    {usage.userId && <button className="secondary mini" onClick={() => onOpenUser(usage.userId)}>用户</button>}
                    {usage.rentalId && <button className="secondary mini" onClick={() => onOpenRental(usage.rentalId)}>租赁</button>}
                    <button className="secondary mini" onClick={() => onOpenProxyRequest(usage.sub2RequestId)}>反代</button>
                  </div>
                </td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>

        <DetailBlock title="最近结算">
          <MiniTable headers={["结算", "状态", "金额", "分成", "可用时间", "创建", "操作"]}>
            {settlements.slice(0, 10).map((settlement) => (
              <tr key={settlement.id}>
                <td><small>{settlement.id}</small></td>
                <td><StatusPill status={settlement.status} /></td>
                <td>{money(settlement.amount)}</td>
                <td>{settlement.shareRate}</td>
                <td>{dateTime(settlement.availableAt)}</td>
                <td>{dateTime(settlement.createdAt)}</td>
                <td>
                  <div className="row-actions">
                    <button className="secondary mini" onClick={() => onOpenSettlement(settlement.id)}>结算</button>
                    {settlement.usageRecord?.id && <button className="secondary mini" onClick={() => onOpenUsage(settlement.usageRecord!.id)}>用量</button>}
                  </div>
                </td>
              </tr>
            ))}
          </MiniTable>
        </DetailBlock>
      </section>
    </section>
  );
}

function ResourceCredentialApplyLogTable({ logs = [], onOpenProxyRequest, onOpenSub2Status }: {
  logs?: AuditLogRow[];
  onOpenProxyRequest: (lookup: string) => void;
  onOpenSub2Status: (context?: string | Sub2RepairContext) => void;
}) {
  return (
    <MiniTable headers={["时间", "来源", "Sub2 账号", "结果", "账号测试", "端到端", "请求", "操作"]}>
      {logs.length === 0 && (
        <tr>
          <td colSpan={8}><small>暂无凭据应用记录</small></td>
        </tr>
      )}
      {logs.map((log) => {
        const after = credentialApplyAuditAfter(log);
        const ok = credentialApplyAuditOk(after);
        const request = credentialApplyAuditProxyRequest(after);
        const accountId = textValue(after.accountId) ?? textValue(after.sub2AccountId);
        return (
          <tr key={log.id}>
            <td>
              {dateTime(log.createdAt)}
              <small>{log.actor?.email ?? "system"}</small>
            </td>
            <td><small>{credentialApplyAuditSource(log, after)}</small></td>
            <td>
              <strong>#{textValue(after.accountId) ?? "-"}</strong>
              <small>{textValue(after.sub2AccountId) ?? "-"}</small>
            </td>
            <td>
              <strong>{ok === undefined ? "-" : ok ? "通过" : "失败"}</strong>
              <small>{credentialApplyAuditApplyMeta(after)}</small>
            </td>
            <td><small>{credentialApplyAuditTestSummary(after)}</small></td>
            <td><small>{credentialApplyAuditSmokeSummary(after)}</small></td>
            <td>
              <small>{request.summary}</small>
              {request.requestId && <small>{request.requestId}</small>}
            </td>
            <td>
              <div className="row-actions">
                {accountId && <button className="secondary mini" onClick={() => onOpenSub2Status(accountId)}>反代</button>}
                {request.requestId && <button className="secondary mini" onClick={() => onOpenProxyRequest(request.requestId!)}>请求</button>}
              </div>
            </td>
          </tr>
        );
      })}
    </MiniTable>
  );
}

function SettlementsView({ settlements, query, meta, onReleaseAvailable, onOpenUser, onOpenResource, onOpenUsage, onOpenWithdrawal, onDraft, onFilter, onClear, onPage, onExport }: {
  settlements: SettlementRow[];
  onReleaseAvailable: () => void;
  onOpenUser: (userId: string) => void;
  onOpenResource: (resourceId: string) => void;
  onOpenUsage: (lookup: string) => void;
  onOpenWithdrawal: (lookup: string) => void;
} & ManagedListProps) {
  return (
    <>
      <div className="panel glass-panel export-strip">
        <span className="eyebrow">Maintenance</span>
        <button className="secondary" onClick={onReleaseAvailable}><RefreshCw size={16} />Release available</button>
      </div>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="supplier / settlement id / usage id"
        statusOptions={settlementStatusOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="供给方结算" count={meta.total} headers={["供给方", "金额", "占用/已提", "状态", "分成", "可用时间", "创建时间", "操作"]}>
        {settlements.map((settlement) => (
          <tr key={settlement.id}>
            <td><strong>{settlement.supplierResource?.supplier?.user?.email ?? "-"}</strong><small>{settlement.supplierResource?.resourceType ?? settlement.id}</small></td>
            <td>{money(settlement.amount)}</td>
            <td>{money(settlement.reservedAmount)} / {money(settlement.withdrawnAmount)}</td>
            <td><StatusPill status={settlement.status} /></td>
            <td>{settlement.shareRate}</td>
            <td>{dateTime(settlement.availableAt)}</td>
            <td>{dateTime(settlement.createdAt)}</td>
            <td>
              <div className="row-actions">
                {settlement.supplierResource?.supplier?.user?.id && <button className="secondary mini" onClick={() => onOpenUser(settlement.supplierResource!.supplier!.user!.id)}>用户</button>}
                {(settlement.supplierResource?.id ?? settlement.supplierResourceId) && <button className="secondary mini" onClick={() => onOpenResource((settlement.supplierResource?.id ?? settlement.supplierResourceId)!)}>资源</button>}
                {(settlement.usageRecord?.id ?? settlement.usageRecordId) && <button className="secondary mini" onClick={() => onOpenUsage((settlement.usageRecord?.id ?? settlement.usageRecordId)!)}>用量</button>}
                <button className="secondary mini" onClick={() => onOpenWithdrawal(settlement.id)}>提现</button>
              </div>
            </td>
          </tr>
        ))}
        {settlements.length === 0 && (
          <tr><td colSpan={8}><small>当前筛选没有匹配的结算记录。</small></td></tr>
        )}
      </TablePanel>
    </>
  );
}

function WithdrawalsView({ withdrawals, summary, query, meta, onCreate, onStatus, onOpenUser, onOpenResource, onOpenUsage, onOpenSettlement, onDraft, onFilter, onClear, onPage, onExport }: {
  withdrawals: WithdrawalRow[];
  summary: AggregateSummary | null;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onStatus: (withdrawalId: string, status: string, payoutRef?: string) => void;
  onOpenUser: (userId: string) => void;
  onOpenResource: (resourceId: string) => void;
  onOpenUsage: (lookup: string) => void;
  onOpenSettlement: (lookup: string) => void;
} & ManagedListProps) {
  function changeWithdrawalStatus(withdrawal: WithdrawalRow, status: string) {
    let payoutRef: string | undefined;
    if (status === "paid") {
      const value = window.prompt("Payout reference", withdrawal.payoutRef ?? "");
      if (value === null) return;
      payoutRef = value.trim();
      if (!payoutRef) return;
    }
    onStatus(withdrawal.id, status, payoutRef);
  }

  return (
    <section className="stack">
      <section className="cards compact-cards">
        <Metric label="提现记录" value={summary?._count ?? meta.total} />
        <Metric label="提现金额" value={money(summary?._sum?.amount)} />
        <Metric label="当前页" value={withdrawals.length} />
        <Metric label="待处理" value={withdrawals.filter((withdrawal) => withdrawal.status === "pending").length} />
      </section>
      <form className="panel glass-panel inline-form withdrawal-form" onSubmit={onCreate}>
        <span className="eyebrow">Create withdrawal</span>
        <input name="supplierEmail" type="email" placeholder="供给方邮箱" required />
        <input name="amount" type="number" step="0.01" min={0.01} placeholder="金额" required />
        <input name="currency" placeholder="币种" defaultValue="USD" />
        <select name="status" defaultValue="pending" required>
          {withdrawalStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <input name="payoutRef" placeholder="打款引用，可选" />
        <input name="note" placeholder="备注" />
        <button>录入提现</button>
      </form>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="supplier / withdrawal / payout"
        statusOptions={withdrawalStatusOptions}
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="提现管理" count={meta.total} headers={["供给方", "金额", "状态", "结算分配", "打款引用", "备注", "时间", "操作"]}>
        {withdrawals.map((withdrawal) => {
          const firstSettlement = (withdrawal.settlements ?? [])[0]?.settlementRecord;
          return (
            <tr key={withdrawal.id}>
              <td><strong>{withdrawal.supplier?.user?.email ?? withdrawal.supplierId}</strong><small>{withdrawal.id}</small></td>
              <td>{money(withdrawal.amount)} {withdrawal.currency ?? "USD"}</td>
              <td><StatusPill status={withdrawal.status} /></td>
              <td><strong>{money(allocationAmount(withdrawal.settlements))}</strong><small>{withdrawal.settlements?.length ?? 0} records</small></td>
              <td><small>{withdrawal.payoutRef ?? "-"}</small></td>
              <td><small>{withdrawal.note ?? "-"}</small></td>
              <td>{dateTime(withdrawal.createdAt)}</td>
              <td>
                <div className="row-actions">
                  {withdrawal.supplier?.user?.id && <button type="button" className="secondary mini" onClick={() => onOpenUser(withdrawal.supplier!.user!.id)}>用户</button>}
                  {firstSettlement?.supplierResourceId && <button type="button" className="secondary mini" onClick={() => onOpenResource(firstSettlement.supplierResourceId!)}>资源</button>}
                  {firstSettlement?.usageRecordId && <button type="button" className="secondary mini" onClick={() => onOpenUsage(firstSettlement.usageRecordId!)}>用量</button>}
                  {firstSettlement?.id && <button type="button" className="secondary mini" onClick={() => onOpenSettlement(firstSettlement.id)}>结算</button>}
                  {withdrawal.status === "pending" && (
                    <>
                      <button type="button" className="secondary mini" onClick={() => changeWithdrawalStatus(withdrawal, "approved")}>通过</button>
                      <button type="button" className="secondary mini" onClick={() => changeWithdrawalStatus(withdrawal, "rejected")}>驳回</button>
                      <button type="button" className="danger mini" onClick={() => changeWithdrawalStatus(withdrawal, "cancelled")}>取消</button>
                    </>
                  )}
                  {withdrawal.status === "approved" && (
                    <>
                      <button type="button" className="secondary mini" onClick={() => changeWithdrawalStatus(withdrawal, "paid")}>打款</button>
                      <button type="button" className="danger mini" onClick={() => changeWithdrawalStatus(withdrawal, "cancelled")}>取消</button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
        {withdrawals.length === 0 && (
          <tr><td colSpan={8}><small>当前筛选没有匹配的提现记录。</small></td></tr>
        )}
      </TablePanel>
    </section>
  );
}

interface AuditLogOpenHandlers {
  onOpenUser: (userId: string) => void;
  onOpenWallet: (lookup: string) => void;
  onOpenOrder: (orderId: string) => void;
  onOpenRental: (rentalId: string) => void;
  onOpenApiKey: (lookup: string) => void;
  onOpenUsage: (lookup: string) => void;
  onOpenProduct: (lookup: string) => void;
  onOpenResource: (resourceId: string) => void;
  onOpenSettlement: (lookup: string) => void;
  onOpenWithdrawal: (lookup: string) => void;
  onOpenSub2Status: (context?: string | Sub2RepairContext) => void;
  onOpenProxyRequest: (lookup: string) => void;
}

interface AuditLogTargetAction {
  key: string;
  label: string;
  onClick: () => void;
}

function AuditLogsView({ logs, query, meta, onDraft, onFilter, onClear, onPage, onExport, ...openHandlers }: {
  logs: AuditLogRow[];
} & ManagedListProps & AuditLogOpenHandlers) {
  return (
    <>
      <ListControls
        query={query}
        meta={meta}
        searchPlaceholder="actor / object / ip"
        actionPlaceholder="action contains"
        onDraft={onDraft}
        onFilter={onFilter}
        onClear={onClear}
        onPage={onPage}
        onExport={onExport}
      />
      <TablePanel title="操作审计" count={meta.total} headers={["操作者", "动作", "对象", "结果摘要", "来源", "时间", "操作"]}>
        {logs.map((log) => {
          const actions = auditLogTargetActions(log, openHandlers);
          return (
            <tr key={log.id}>
              <td><strong>{log.actor?.email ?? "-"}</strong><small>{log.actor?.displayName ?? log.actor?.id ?? "-"}</small></td>
              <td>{log.action}</td>
              <td><strong>{log.objectType}</strong><small>{log.objectId ?? "-"}</small></td>
              <td><small>{auditSummary(log.after)}</small></td>
              <td><small>{log.ipAddress ?? "-"}</small><small>{log.userAgent ?? "-"}</small></td>
              <td>{dateTime(log.createdAt)}</td>
              <td>
                <div className="row-actions">
                  {actions.map((action) => (
                    <button key={action.key} type="button" className="secondary mini" onClick={action.onClick}>{action.label}</button>
                  ))}
                  {actions.length === 0 && <small>-</small>}
                </div>
              </td>
            </tr>
          );
        })}
      </TablePanel>
    </>
  );
}

function auditLogTargetActions(log: AuditLogRow, handlers: AuditLogOpenHandlers) {
  const actions: AuditLogTargetAction[] = [];
  const seen = new Set<string>();
  const records = [log.after, log.before].filter(isPlainRecord);

  function add(label: string, target: string, lookup: unknown, open: (value: string) => void) {
    const value = textValue(lookup);
    if (!value) return;
    const key = `${target}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    actions.push({ key, label, onClick: () => open(value) });
  }

  add("操作者", "user", log.actor?.id, handlers.onOpenUser);

  const objectId = textValue(log.objectId);
  switch (log.objectType) {
    case "auth":
    case "user":
      add("对象用户", "user", objectId, handlers.onOpenUser);
      break;
    case "wallet":
      add("余额", "wallet", objectId, handlers.onOpenWallet);
      break;
    case "order":
      add("订单", "order", objectId, handlers.onOpenOrder);
      break;
    case "rental":
      add("租赁", "rental", objectId, handlers.onOpenRental);
      break;
    case "api_key":
      add("API Key", "apiKey", objectId, handlers.onOpenApiKey);
      break;
    case "product":
      add("商品", "product", objectId, handlers.onOpenProduct);
      break;
    case "product_price":
      add("商品", "product", auditLogRecordText(records, "productId"), handlers.onOpenProduct);
      break;
    case "supplier":
      add("供给方用户", "user", auditLogRecordText(records, "userId"), handlers.onOpenUser);
      break;
    case "supplier_resource":
      add("资源", "resource", objectId, handlers.onOpenResource);
      break;
    case "settlement":
      add("结算", "settlement", objectId, handlers.onOpenSettlement);
      break;
    case "withdrawal":
      add("提现", "withdrawal", objectId, handlers.onOpenWithdrawal);
      break;
    case "sub2_account":
      add("反代状态", "sub2", objectId, handlers.onOpenSub2Status);
      break;
    case "sub2_proxy":
      add("API Key", "apiKey", objectId, handlers.onOpenApiKey);
      break;
    default:
      break;
  }

  add("用户", "user", auditLogRecordText(records, "userId"), handlers.onOpenUser);
  add("余额", "wallet", auditLogRecordText(records, "walletId"), handlers.onOpenWallet);
  add("订单", "order", auditLogRecordText(records, "orderId"), handlers.onOpenOrder);
  add("租赁", "rental", auditLogRecordText(records, "rentalId") ?? auditLogNestedText(records, ["localProxy", "rentalId"]) ?? auditLogNestedText(records, ["smokeTest", "localProxy", "rentalId"]), handlers.onOpenRental);
  add("API Key", "apiKey", auditLogRecordText(records, "apiKeyId") ?? auditLogRecordText(records, "apiKeyPrefix") ?? auditLogNestedText(records, ["localProxy", "apiKeyPrefix"]) ?? auditLogNestedText(records, ["smokeTest", "localProxy", "apiKeyPrefix"]), handlers.onOpenApiKey);
  add("商品", "product", auditLogRecordText(records, "productId"), handlers.onOpenProduct);
  add("资源", "resource", auditLogRecordText(records, "resourceId") ?? auditLogRecordText(records, "supplierResourceId") ?? auditLogNestedText(records, ["resourceCredentialSync", "resource", "id"]), handlers.onOpenResource);
  add("用量", "usage", auditLogRecordText(records, "usageRecordId") ?? auditLogRecordText(records, "usageId") ?? auditLogRecordText(records, "sub2RequestId") ?? auditLogRecordText(records, "upstreamRequestId"), handlers.onOpenUsage);
  add("结算", "settlement", auditLogRecordText(records, "settlementId"), handlers.onOpenSettlement);
  add("提现", "withdrawal", auditLogRecordText(records, "withdrawalId"), handlers.onOpenWithdrawal);
  add("反代状态", "sub2", auditLogRecordText(records, "sub2AccountId") ?? auditLogRecordText(records, "accountId") ?? auditLogNestedText(records, ["resourceCredentialSync", "resource", "sub2AccountId"]), handlers.onOpenSub2Status);
  add("反代请求", "proxyRequest", auditLogRecordText(records, "requestId") ?? auditLogProxyRequestLookup(records), handlers.onOpenProxyRequest);

  return actions;
}

function auditLogRecordText(records: Record<string, unknown>[], key: string) {
  for (const record of records) {
    const value = textValue(record[key]);
    if (value) return value;
  }
  return undefined;
}

function auditLogNestedText(records: Record<string, unknown>[], path: string[]) {
  for (const record of records) {
    let current: unknown = record;
    for (const segment of path) {
      if (!isPlainRecord(current)) {
        current = undefined;
        break;
      }
      current = current[segment];
    }
    const value = textValue(current);
    if (value) return value;
  }
  return undefined;
}

function auditLogProxyRequestLookup(records: Record<string, unknown>[]) {
  for (const record of records) {
    const direct = auditLogProxyRequestFromLocalProxy(nestedRecord(record, "localProxy"));
    if (direct) return direct;
    const smokeTest = nestedRecord(record, "smokeTest");
    const smoke = smokeTest ? auditLogProxyRequestFromLocalProxy(nestedRecord(smokeTest, "localProxy")) : undefined;
    if (smoke) return smoke;
  }
  return undefined;
}

function auditLogProxyRequestFromLocalProxy(localProxy: Record<string, unknown> | null) {
  const logsValue = localProxy?.proxyRequestLogs;
  const logs = Array.isArray(logsValue) ? logsValue.filter(isPlainRecord) : [];
  const failed = logs.find((log) => {
    const status = Number(textValue(log.statusCode) ?? 0);
    return status >= 400 || Boolean(textValue(log.errorCode));
  }) ?? logs[0];
  return failed ? textValue(failed.requestId) ?? textValue(failed.id) : undefined;
}

function ListControls({ query, meta, searchPlaceholder, statusOptions = [], resourceTypeOptions = [], actionPlaceholder, onDraft, onFilter, onClear, onPage, onExport }: {
  query: ListQueryState;
  meta: PageMeta;
  searchPlaceholder?: string;
  statusOptions?: string[];
  resourceTypeOptions?: string[];
  actionPlaceholder?: string;
  onDraft: (patch: Partial<ListQueryState>) => void;
  onFilter: (event: FormEvent<HTMLFormElement>) => void;
  onClear: () => void;
  onPage: (page: number) => void;
  onExport?: () => void;
}) {
  return (
    <form className="panel glass-panel list-controls" onSubmit={onFilter}>
      <div className="filter-fields">
        <label className="input-with-icon">
          <Search size={16} />
          <input
            name="q"
            value={query.q}
            placeholder={searchPlaceholder ?? "search"}
            onChange={(event) => onDraft({ q: event.target.value })}
          />
        </label>
        {statusOptions.length > 0 && (
          <select name="status" value={query.status} onChange={(event) => onDraft({ status: event.target.value })}>
            <option value="">All status</option>
            {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        )}
        {resourceTypeOptions.length > 0 && (
          <select name="resourceType" value={query.resourceType} onChange={(event) => onDraft({ resourceType: event.target.value })}>
            <option value="">All resources</option>
            {resourceTypeOptions.map((resourceType) => <option key={resourceType} value={resourceType}>{resourceType}</option>)}
          </select>
        )}
        {actionPlaceholder && (
          <input
            name="action"
            value={query.action}
            placeholder={actionPlaceholder}
            onChange={(event) => onDraft({ action: event.target.value })}
          />
        )}
        <select name="pageSize" value={query.pageSize} onChange={(event) => onDraft({ pageSize: Number(event.target.value) })}>
          {[25, 50, 100, 200].map((size) => <option key={size} value={size}>{size} / page</option>)}
        </select>
      </div>
      <div className="filter-actions">
        <button type="submit"><Filter size={16} />筛选</button>
        <button type="button" className="secondary" onClick={onClear}><X size={16} />清空</button>
        {onExport && <button type="button" className="secondary" onClick={onExport}><Download size={16} />导出全部筛选</button>}
        <div className="pager">
          <button type="button" className="secondary mini" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}><ChevronLeft size={15} /></button>
          <span>{meta.page} / {meta.totalPages}</span>
          <button type="button" className="secondary mini" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}><ChevronRight size={15} /></button>
        </div>
      </div>
    </form>
  );
}

function TablePanel({ title, count, headers, children }: {
  title: string;
  count: number;
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="panel glass-panel wide">
      <div className="section-head">
        <div>
          <span className="eyebrow">Data Table</span>
          <h2>{title}</h2>
        </div>
        <strong>{count} 条</strong>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric-card"><span>{label}</span><strong>{value}</strong></div>;
}

function NavButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return <button className={active ? "active" : ""} onClick={onClick}>{icon}<span>{children}</span></button>;
}

function StatusPill({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{status}</span>;
}

function proxyStatusTone(statusCode?: number | null) {
  if (!statusCode) return "pending";
  if (statusCode < 300) return "active";
  if (statusCode < 500) return "warning";
  return "failed";
}

function healthStatusTone(status: SystemHealthResult["status"]) {
  if (status === "ok") return "active";
  if (status === "warning") return "warning";
  return "error";
}

function healthStatusText(status: SystemHealthResult["status"]) {
  if (status === "ok") return "系统可用";
  if (status === "warning") return "存在警告";
  return "存在阻断";
}

function healthRowClass(status: SystemHealthResult["status"]) {
  if (status === "ok") return "health-row";
  if (status === "warning") return "health-row warning";
  return "health-row error";
}

function dashboardSnapshotAgeText(ageMinutes?: number) {
  if (typeof ageMinutes !== "number" || !Number.isFinite(ageMinutes)) return "-";
  if (ageMinutes < 1) return "刚刚";
  if (ageMinutes < 60) return `${ageMinutes} 分钟前`;
  const hours = Math.floor(ageMinutes / 60);
  const minutes = ageMinutes % 60;
  return minutes > 0 ? `${hours} 小时 ${minutes} 分钟前` : `${hours} 小时前`;
}

function dashboardSnapshotFreshnessText(snapshot: NonNullable<Dashboard["latestSystemHealth"]>) {
  const threshold = snapshot.staleThresholdMinutes ?? 60;
  return snapshot.stale ? `已过期，建议重新巡检（阈值 ${threshold} 分钟）` : `有效（阈值 ${threshold} 分钟）`;
}

function dashboardHealthCheckTarget(check: DashboardHealthCheckPreview): { view: View; label: string } | null {
  const checkId = check.id;
  if (checkId === "productCatalog" && dashboardHealthProductLookup(check)) {
    return { view: "products", label: "打开商品" };
  }

  if (dashboardHealthShouldOpenResourcesFirst(check, dashboardHealthDetailRecord(check))) {
    return { view: "resources", label: "打开共享资源" };
  }

  if (dashboardHealthCheckHasSub2Repair(check)) {
    return { view: "sub2", label: "打开反代状态" };
  }
  if ((checkId === "proxy" || checkId === "localProxySmoke") && dashboardHealthProxyLookup(check)) {
    return { view: "proxyRequests", label: "打开反代请求" };
  }
  if (["sub2", "localProxySmoke", "openAiProxyContract", "openAiProxyRuntime"].includes(checkId)) {
    return { view: "sub2", label: "打开反代状态" };
  }
  if (["resources", "resourceCredentials"].includes(checkId)) {
    return { view: "resources", label: "打开共享资源" };
  }
  if (checkId === "proxy") return { view: "proxyRequests", label: "打开反代请求" };
  if (checkId === "payments" && dashboardHealthHasWalletTransactionFilter(dashboardHealthDetailRecord(check))) {
    return { view: "walletTransactions", label: "打开充值流水" };
  }
  if (["salesDelivery", "payments"].includes(checkId)) return { view: "sales", label: "打开售出情况" };
  if (checkId === "apiKeys") return { view: "apiKeys", label: "打开 API Key" };
  if (["billingSync", "pendingUsageBilling"].includes(checkId)) return { view: "usages", label: "打开用量记录" };
  if (checkId === "reconciliation") return { view: "reconciliation", label: "打开账务对账" };
  if (checkId === "productCatalog") return { view: "products", label: "打开商品配置" };
  if (checkId === "orders") return { view: "orders", label: "打开订单管理" };
  if (checkId === "rentals") return { view: "rentals", label: "打开租赁通道" };
  if (checkId === "wallets") return { view: "wallets", label: "打开余额管理" };
  if (checkId === "settlements") return { view: "settlements", label: "打开结算" };
  if (["adminCapabilities", "adminSurfaceCoverage", "deploymentRuntime", "frontendRuntime", "corsPolicy", "authTokens", "oauthStateStore"].includes(checkId)) {
    return { view: "systemHealth", label: "打开巡检详情" };
  }
  return null;
}

function dashboardHealthDetailRecord(check: DashboardHealthCheckPreview) {
  return check.primaryIssue ?? check.primarySample;
}

function dashboardHealthCheckHasSub2Repair(check: DashboardHealthCheckPreview) {
  const record = dashboardHealthDetailRecord(check);
  if (!["sub2", "localProxySmoke", "resourceCredentials", "resources"].includes(check.id)) return false;
  return textValue(record?.repairAction) === "apply_openai_refresh_token_to_sub2_account" || Boolean(textValue(record?.sub2AccountId));
}

function dashboardHealthShouldOpenResourcesFirst(check: DashboardHealthCheckPreview, record: DashboardHealthDetailPreview | undefined) {
  return check.id === "resources" && dashboardHealthHasResourceFilter(record);
}

function dashboardHealthSub2RepairContext(check: DashboardHealthCheckPreview): Sub2RepairContext {
  const record = dashboardHealthDetailRecord(check);
  return {
    accountId: textValue(record?.sub2AccountId) ?? null,
    sub2AccountName: textValue(record?.sub2AccountName),
    accountStatus: textValue(record?.accountStatus),
    credentialsStatus: textValue(record?.credentialsStatus),
    schedulable: textValue(record?.schedulable),
    accountMessage: textValue(record?.accountMessage) ?? textValue(record?.message),
    accountUpdatedAt: textValue(record?.updatedAt),
    tempUnschedulableReason: textValue(record?.tempUnschedulableReason),
    checkId: check.id,
    checkLabel: check.label,
    repairAction: textValue(record?.repairAction),
    actionHint: textValue(record?.actionHint),
    resourceId: textValue(record?.resourceId),
    resourceType: textValue(record?.resourceType),
    resourceStatus: textValue(record?.resourceStatus),
    resourceScope: textValue(record?.resourceScope),
    supplierEmail: textValue(record?.supplierEmail),
    requestId: textValue(record?.requestId),
    proxyRequestLogId: textValue(record?.proxyRequestLogId),
    upstreamRequestId: textValue(record?.upstreamRequestId),
    proxyRequestPath: textValue(record?.proxyRequestPath),
    proxyRequestStatusCode: textValue(record?.proxyRequestStatusCode),
    proxyRequestErrorCode: textValue(record?.proxyRequestErrorCode),
    model: textValue(record?.model),
    modelsOk: textValue(record?.modelsOk),
    responsesOk: textValue(record?.responsesOk),
    localProxyOk: textValue(record?.localProxyOk),
    smokeTestSkippedReason: textValue(record?.smokeTestSkippedReason),
    ageMinutes: textValue(record?.ageMinutes),
    stale: textValue(record?.stale),
    staleThresholdMinutes: textValue(record?.staleThresholdMinutes),
    freshMinutesRemaining: textValue(record?.freshMinutesRemaining),
    staleAt: textValue(record?.staleAt)
  };
}

function dashboardHealthProxyLookup(check: DashboardHealthCheckPreview) {
  const record = dashboardHealthDetailRecord(check);
  return textValue(record?.requestId) ?? textValue(record?.proxyRequestLogId) ?? textValue(record?.upstreamRequestId);
}

function dashboardHealthHasResourceFilter(record: DashboardHealthDetailPreview | undefined) {
  return Boolean(
    textValue(record?.supplierEmail)
    || textValue(record?.resourceType)
    || textValue(record?.resourceStatus)
    || textValue(record?.resourceScope)
    || textValue(record?.sub2AccountId)
  );
}

function dashboardHealthResourceFilter(record: DashboardHealthDetailPreview | undefined, checkId = "resources") {
  return {
    supplierEmail: textValue(record?.supplierEmail),
    resourceType: textValue(record?.resourceType),
    status: textValue(record?.resourceStatus),
    scope: textValue(record?.resourceScope),
    sub2AccountId: textValue(record?.sub2AccountId),
    sub2AccountName: textValue(record?.sub2AccountName),
    accountStatus: textValue(record?.accountStatus),
    credentialsStatus: textValue(record?.credentialsStatus),
    schedulable: textValue(record?.schedulable),
    tempUnschedulableReason: textValue(record?.tempUnschedulableReason),
    accountMessage: textValue(record?.accountMessage) ?? textValue(record?.message),
    accountUpdatedAt: textValue(record?.updatedAt),
    repairAction: textValue(record?.repairAction),
    checkId,
    productId: textValue(record?.productId),
    productName: textValue(record?.productName),
    priceId: textValue(record?.priceId),
    model: textValue(record?.model),
    responsesOk: textValue(record?.responsesOk),
    localProxyOk: textValue(record?.localProxyOk),
    smokeTestSkippedReason: textValue(record?.smokeTestSkippedReason),
    proxyRequestPath: textValue(record?.proxyRequestPath),
    proxyRequestStatusCode: textValue(record?.proxyRequestStatusCode),
    proxyRequestErrorCode: textValue(record?.proxyRequestErrorCode),
    ageMinutes: textValue(record?.ageMinutes),
    stale: textValue(record?.stale),
    staleThresholdMinutes: textValue(record?.staleThresholdMinutes),
    freshMinutesRemaining: textValue(record?.freshMinutesRemaining),
    staleAt: textValue(record?.staleAt)
  };
}

function dashboardHealthWalletTransactionLookup(record: DashboardHealthDetailPreview | undefined) {
  return textValue(record?.walletTransactionId);
}

function dashboardHealthHasWalletTransactionFilter(record: DashboardHealthDetailPreview | undefined) {
  return textValue(record?.walletTransactionList)?.toLowerCase() === "true" || Boolean(textValue(record?.walletTransactionType));
}

function dashboardHealthHasWalletLookup(record: DashboardHealthDetailPreview | undefined) {
  return Boolean(textValue(record?.walletLookup) ?? textValue(record?.walletId));
}

function dashboardHealthProductLookup(check: DashboardHealthCheckPreview) {
  const record = dashboardHealthDetailRecord(check);
  return adminProductLookupCandidate(record);
}

function dashboardHealthCanOpenResourceRepair(check: DashboardHealthCheckPreview) {
  return check.id === "productCatalog" && dashboardHealthHasResourceFilter(dashboardHealthDetailRecord(check));
}

function dashboardHealthPreviewContext(check: DashboardHealthCheckPreview) {
  const record = dashboardHealthDetailRecord(check);
  if (!record) return check.metrics ? healthMetricSummary(check.metrics) : "";
  const fields = [
    "repairAction",
    "actionHint",
    "sub2AccountId",
    "sub2AccountName",
    "accountStatus",
    "credentialsStatus",
    "schedulable",
    "tempUnschedulableReason",
    "accountMessage",
    "updatedAt",
    "resourceList",
    "resourceType",
    "resourceStatus",
    "resourceScope",
    "supplierEmail",
    "productId",
    "productName",
    "priceId",
    "requestId",
    "proxyRequestLogId",
    "upstreamRequestId",
    "proxyRequestPath",
    "proxyRequestStatusCode",
    "proxyRequestErrorCode",
    "model",
    "modelsOk",
    "responsesOk",
    "localProxyOk",
    "smokeTestSkippedReason",
    "ageMinutes",
    "stale",
    "staleThresholdMinutes",
    "freshMinutesRemaining",
    "staleAt",
    "walletTransactionType",
    "walletTransactionId",
    "walletLookup",
    "walletId"
  ];
  return fields
    .map((field) => textValue(record[field]) ? `${field}: ${textValue(record[field])}` : null)
    .filter(Boolean)
    .join(" / ");
}

function deliveryStatusText(status: DeliverySummary["status"]) {
  if (status === "ok") return "交付正常";
  if (status === "warning") return "待复查";
  return "交付异常";
}

function healthMetricSummary(metrics?: Record<string, string | number | boolean | null>) {
  if (!metrics) return "-";
  const text = Object.entries(metrics)
    .map(([key, value]) => `${key}: ${value ?? "-"}`)
    .join(" / ");
  return text || "-";
}

function systemHealthIssueRows(check: SystemHealthCheckRow) {
  if (!isPlainRecord(check.detail) || !Array.isArray(check.detail.issues)) return [];

  return check.detail.issues.slice(0, 100).map((issue, index): SystemHealthIssueRow => {
    const record = isPlainRecord(issue) ? issue : {};
    const sub2StatusFlag = record.sub2Status === true || textValue(record.sub2Status)?.toLowerCase() === "true";
    const refType = textValue(record.refType)?.toLowerCase();
    const refId = textValue(record.refId);
    return {
      id: textValue(record.id) ?? String(index),
      checkId: check.id,
      checkLabel: check.label,
      severity: textValue(record.severity) ?? check.status,
      type: textValue(record.type) ?? "-",
      ref: systemHealthIssueRef(record),
      message: systemHealthIssueMessage(record, issue),
      repairAction: textValue(record.repairAction),
      actionHint: textValue(record.actionHint),
      resourceId: textValue(record.resourceId),
      resourceList: record.resourceList === true || textValue(record.resourceList)?.toLowerCase() === "true",
      resourceScope: textValue(record.resourceScope),
      resourceType: textValue(record.resourceType),
      resourceStatus: textValue(record.resourceStatus),
      supplierEmail: textValue(record.supplierEmail),
      productId: textValue(record.productId),
      productName: textValue(record.productName),
      priceId: textValue(record.priceId),
      proxyRequestLookup: proxyRequestIssueLookup(record, check.id),
      requestId: textValue(record.requestId),
      proxyRequestLogId: textValue(record.proxyRequestLogId),
      upstreamRequestId: textValue(record.upstreamRequestId),
      proxyRequestPath: textValue(record.proxyRequestPath),
      proxyRequestStatusCode: textValue(record.proxyRequestStatusCode),
      proxyRequestErrorCode: textValue(record.proxyRequestErrorCode),
      model: textValue(record.model),
      modelsOk: textValue(record.modelsOk),
      responsesOk: textValue(record.responsesOk),
      localProxyOk: textValue(record.localProxyOk),
      smokeTestSkippedReason: textValue(record.smokeTestSkippedReason),
      ageMinutes: textValue(record.ageMinutes),
      stale: textValue(record.stale),
      staleThresholdMinutes: textValue(record.staleThresholdMinutes),
      freshMinutesRemaining: textValue(record.freshMinutesRemaining),
      staleAt: textValue(record.staleAt),
      userId: textValue(record.userId),
      orderId: textValue(record.orderId) ?? refTypeLookup(refType, refId, "order"),
      rentalId: textValue(record.rentalId),
      walletList: record.walletList === true || textValue(record.walletList)?.toLowerCase() === "true",
      walletTransactionList: record.walletTransactionList === true || textValue(record.walletTransactionList)?.toLowerCase() === "true",
      walletTransactionType: textValue(record.walletTransactionType),
      walletTransactionLookup: textValue(record.walletTransactionId) ?? refTypeLookup(refType, refId, "wallet_transaction"),
      salesList: record.salesList === true || textValue(record.salesList)?.toLowerCase() === "true",
      walletLookup: textValue(record.walletId) ?? textValue(record.walletAccountId),
      apiKeyLookup: textValue(record.apiKeyId) ?? textValue(record.apiKeyPrefix),
      usageLookup: textValue(record.usageId) ?? refTypeLookup(refType, refId, "usage"),
      productLookup: adminProductLookupCandidate(record),
      settlementLookup: textValue(record.settlementId) ?? textValue(record.settlementRecordId) ?? refTypeLookup(refType, refId, "settlement"),
      withdrawalLookup: textValue(record.withdrawalId) ?? refTypeLookup(refType, refId, "withdrawal"),
      sub2AccountId: textValue(record.sub2AccountId),
      sub2AccountName: textValue(record.sub2AccountName),
      accountStatus: textValue(record.accountStatus),
      credentialsStatus: textValue(record.credentialsStatus),
      schedulable: textValue(record.schedulable),
      accountMessage: textValue(record.accountMessage) ?? textValue(record.message),
      accountUpdatedAt: textValue(record.updatedAt),
      tempUnschedulableReason: textValue(record.tempUnschedulableReason),
      sub2Status: check.id === "sub2" || sub2StatusFlag || Boolean(textValue(record.sub2BlockingReason) ?? textValue(record.sub2GroupId)),
      auditLogLookup: textValue(record.auditLogId) ?? textValue(record.auditAction)
    };
  });
}

function systemHealthSampleRows(check: SystemHealthCheckRow) {
  if (!isPlainRecord(check.detail) || !Array.isArray(check.detail.samples)) return [];

  return check.detail.samples.slice(0, 100).map((sample, index): SystemHealthSampleRow => {
    const record = isPlainRecord(sample) ? sample : {};
    const sub2StatusFlag = record.sub2Status === true || check.id === "sub2" || Boolean(textValue(record.sub2AccountId));
    const refType = textValue(record.refType)?.toLowerCase();
    const refId = textValue(record.refId);
    return {
      id: textValue(record.id) ?? String(index),
      checkId: check.id,
      checkLabel: check.label,
      ref: systemHealthIssueRef(record),
      summary: systemHealthSampleSummary(record, sample),
      sampleType: textValue(record.sampleType),
      repairAction: textValue(record.repairAction),
      actionHint: textValue(record.actionHint),
      proxyRequestLookup: proxyRequestIssueLookup(record, check.id),
      requestId: textValue(record.requestId),
      proxyRequestLogId: textValue(record.proxyRequestLogId),
      upstreamRequestId: textValue(record.upstreamRequestId),
      proxyRequestPath: textValue(record.proxyRequestPath),
      proxyRequestStatusCode: textValue(record.proxyRequestStatusCode),
      proxyRequestErrorCode: textValue(record.proxyRequestErrorCode),
      model: textValue(record.model),
      modelsOk: textValue(record.modelsOk),
      responsesOk: textValue(record.responsesOk),
      localProxyOk: textValue(record.localProxyOk),
      smokeTestSkippedReason: textValue(record.smokeTestSkippedReason),
      ageMinutes: textValue(record.ageMinutes),
      stale: textValue(record.stale),
      staleThresholdMinutes: textValue(record.staleThresholdMinutes),
      freshMinutesRemaining: textValue(record.freshMinutesRemaining),
      staleAt: textValue(record.staleAt),
      userId: textValue(record.userId),
      orderId: textValue(record.orderId) ?? refTypeLookup(refType, refId, "order"),
      rentalId: textValue(record.rentalId),
      walletLookup: textValue(record.walletId) ?? textValue(record.walletAccountId) ?? textValue(record.walletLookup),
      walletList: record.walletList === true || textValue(record.walletList)?.toLowerCase() === "true",
      walletTransactionList: record.walletTransactionList === true || textValue(record.walletTransactionList)?.toLowerCase() === "true",
      walletTransactionType: textValue(record.walletTransactionType),
      walletTransactionLookup: textValue(record.walletTransactionId) ?? refTypeLookup(refType, refId, "wallet_transaction"),
      salesList: record.salesList === true || textValue(record.salesList)?.toLowerCase() === "true",
      resourceList: record.resourceList === true || textValue(record.resourceList)?.toLowerCase() === "true",
      resourceId: textValue(record.resourceId),
      resourceType: textValue(record.resourceType),
      resourceStatus: textValue(record.resourceStatus),
      resourceScope: textValue(record.resourceScope),
      supplierEmail: textValue(record.supplierEmail),
      productId: textValue(record.productId),
      productName: textValue(record.productName),
      priceId: textValue(record.priceId),
      sub2AccountId: textValue(record.sub2AccountId),
      sub2AccountName: textValue(record.sub2AccountName),
      accountStatus: textValue(record.accountStatus),
      credentialsStatus: textValue(record.credentialsStatus),
      schedulable: textValue(record.schedulable),
      accountMessage: textValue(record.accountMessage) ?? textValue(record.message),
      accountUpdatedAt: textValue(record.updatedAt),
      tempUnschedulableReason: textValue(record.tempUnschedulableReason),
      sub2Status: sub2StatusFlag,
      apiKeyLookup: textValue(record.apiKeyId) ?? textValue(record.apiKeyPrefix),
      usageLookup: textValue(record.usageId) ?? refTypeLookup(refType, refId, "usage"),
      productLookup: adminProductLookupCandidate(record),
      settlementLookup: textValue(record.settlementId) ?? textValue(record.settlementRecordId) ?? refTypeLookup(refType, refId, "settlement"),
      withdrawalLookup: textValue(record.withdrawalId) ?? refTypeLookup(refType, refId, "withdrawal"),
      auditLogLookup: textValue(record.auditLogId) ?? textValue(record.auditAction)
    };
  });
}

function systemHealthIssueRef(issue: Record<string, unknown>) {
  const parts = adminSystemHealthIssueRefFields
    .map((field) => textValue(issue[field]) ? `${field}: ${textValue(issue[field])}` : null)
    .filter(Boolean);
  return parts.join(" / ") || textValue(issue.id) || "-";
}

function systemHealthIssueMessage(record: Record<string, unknown>, raw: unknown) {
  const message = textValue(record.message) ?? compactJson(raw);
  const actionHint = textValue(record.actionHint);
  return actionHint ? `${message} 建议：${actionHint}` : message;
}

function proxyRequestIssueLookup(issue: Record<string, unknown>, checkId: string) {
  const directLookup = textValue(issue.requestId) ?? textValue(issue.proxyRequestLogId) ?? textValue(issue.upstreamRequestId);
  if (directLookup) return directLookup;
  if (checkId !== "proxy") return undefined;
  return textValue(issue.rentalId) ?? textValue(issue.apiKeyId) ?? textValue(issue.apiKeyPrefix);
}

function refTypeLookup(refType: string | undefined, refId: string | undefined, expectedRefType: string) {
  return refType === expectedRefType ? refId : undefined;
}

function systemHealthIssueHasAction(issue: SystemHealthIssueRow) {
  return Boolean(
    issue.proxyRequestLookup
    || issue.resourceList
    || issue.resourceId
    || issue.orderId
    || issue.rentalId
    || issue.userId
    || issue.walletList
    || issue.walletTransactionList
    || issue.walletTransactionLookup
    || issue.salesList
    || issue.walletLookup
    || issue.apiKeyLookup
    || issue.usageLookup
    || issue.productLookup
    || issue.settlementLookup
    || issue.withdrawalLookup
    || issue.sub2Status
    || issue.auditLogLookup
  );
}

function systemHealthSampleHasAction(sample: SystemHealthSampleRow) {
  return Boolean(
    sample.proxyRequestLookup
    || sample.resourceList
    || sample.resourceId
    || sample.sub2Status
    || sample.orderId
    || sample.rentalId
    || sample.userId
    || sample.walletList
    || sample.walletTransactionList
    || sample.walletTransactionLookup
    || sample.salesList
    || sample.walletLookup
    || sample.apiKeyLookup
    || sample.usageLookup
    || sample.productLookup
    || sample.settlementLookup
    || sample.withdrawalLookup
    || sample.auditLogLookup
  );
}

function systemHealthSampleSummary(record: Record<string, unknown>, raw: unknown) {
  const parts = adminSystemHealthSampleSummaryFields
    .map((field) => textValue(record[field]) ? `${field}: ${textValue(record[field])}` : null)
    .filter(Boolean);
  return parts.join(" / ") || compactJson(raw);
}

function healthIssueTone(severity: string) {
  if (severity === "error") return "error";
  if (severity === "warning") return "warning";
  if (severity === "ok") return "active";
  return severity;
}

function sub2BlockingReasonActionHint(reason: string) {
  if (reason === "sub2api_health_unreachable") return "检查 Sub2API 地址、服务健康、网络和后台令牌";
  if (reason === "openai_group_missing") return "在 Sub2API 配置默认 OpenAI 分组";
  if (reason === "openai_group_inactive") return "启用默认 OpenAI 分组或切换默认分组";
  if (reason === "openai_group_has_no_accounts") return "向默认分组添加 OpenAI 账号或应用已保存凭据";
  if (reason === "openai_group_has_no_active_accounts") return "刷新/测试现有账号或应用有效 refresh token，再运行端到端自检";
  if (reason === "sub2_status_query_failed") return "复查 Sub2 管理凭据与状态查询错误";
  return "复查 Sub2 状态，修复后运行端到端自检";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function compactJson(value: unknown) {
  try {
    const text = JSON.stringify(value);
    if (!text) return "-";
    return text.length > 180 ? `${text.slice(0, 177)}...` : text;
  } catch {
    return "-";
  }
}

function nestedRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return isPlainRecord(value) ? value : null;
}

function credentialApplyAuditAfter(log: AuditLogRow) {
  return isPlainRecord(log.after) ? log.after : {};
}

function credentialApplyAuditOk(after: Record<string, unknown>) {
  if (typeof after.ok === "boolean") return after.ok;
  if (after.source === "sub2_direct_refresh_token_apply" && isPlainRecord(after.credential)) return true;
  const result = nestedRecord(after, "result");
  return typeof result?.ok === "boolean" ? result.ok : undefined;
}

function credentialApplyAuditSource(log: AuditLogRow, after: Record<string, unknown>) {
  if (log.action === "admin.sub2.account.save_refresh_token_resource") return "Sub2 直接保存";
  if (after.source === "sub2_direct_refresh_token_apply") return "Sub2 直接保存";
  return "资源应用";
}

function credentialApplyAuditApplyMeta(after: Record<string, unknown>) {
  const credential = nestedRecord(after, "credential");
  if (after.source === "sub2_direct_refresh_token_apply") {
    return ["saved", textValue(credential?.status), textValue(credential?.keyFingerprint)].filter(Boolean).join(" / ") || "saved";
  }
  const parts: string[] = [];
  if (after.refreshed === true) parts.push("refreshed");
  if (after.applied === true) parts.push("applied");
  const error = textValue(after.error);
  if (error) parts.push(error);
  return parts.join(" / ") || "-";
}

function credentialApplyAuditTestSummary(after: Record<string, unknown>) {
  const test = nestedRecord(after, "test");
  if (!test) return "-";
  const ok = test.ok === true ? "通过" : "失败";
  const status = textValue(test.statusCode);
  const events = Array.isArray(test.events) ? test.events.map((event) => textValue(event) ?? compactJson(event)).filter(Boolean).slice(0, 2) : [];
  return `${ok}${status ? ` / HTTP ${status}` : ""}${events.length ? ` / ${events.join(" / ")}` : ""}`;
}

function credentialApplyAuditSmokeSummary(after: Record<string, unknown>) {
  const skippedReason = textValue(after.smokeTestSkippedReason);
  if (skippedReason) return `跳过 / ${credentialApplySmokeSkipLabel(skippedReason)}`;
  const smokeTest = nestedRecord(after, "smokeTest");
  if (!smokeTest) return "-";
  const ok = smokeTest.ok === true;
  const model = textValue(smokeTest.model);
  const responses = nestedRecord(smokeTest, "responses");
  const responseStatus = textValue(responses?.statusCode);
  const responseError = textValue(responses?.errorMessage) ?? textValue(responses?.errorType);
  const detail = ok ? undefined : responseError ?? (responseStatus ? `Responses HTTP ${responseStatus}` : undefined);
  return `${ok ? "通过" : "失败"}${model ? ` / ${model}` : ""}${detail ? ` / ${detail}` : ""}`;
}

function credentialApplyAuditProxyRequest(after: Record<string, unknown>) {
  const smokeTest = nestedRecord(after, "smokeTest");
  const localProxy = smokeTest ? nestedRecord(smokeTest, "localProxy") : null;
  const logsValue = localProxy?.proxyRequestLogs;
  const logs = Array.isArray(logsValue) ? logsValue.filter(isPlainRecord) : [];
  const failed = logs.find((log) => {
    const status = Number(textValue(log.statusCode) ?? 0);
    return status >= 400 || Boolean(textValue(log.errorCode));
  }) ?? logs[0];
  if (!failed) return { summary: "-", requestId: undefined };
  const path = textValue(failed.path) ?? "-";
  const status = textValue(failed.statusCode);
  const upstreamStatus = textValue(failed.upstreamStatusCode);
  const error = textValue(failed.errorCode);
  const statusText = status ? ` / HTTP ${status}` : "";
  const upstreamText = upstreamStatus && upstreamStatus !== status ? ` / upstream ${upstreamStatus}` : "";
  const errorText = error ? ` / ${error}` : "";
  return {
    summary: `${path}${statusText}${upstreamText}${errorText}`,
    requestId: textValue(failed.requestId)
  };
}

function navigationIcon(view: View) {
  const size = 18;
  const map: Record<View, ReactElement> = {
    dashboard: <BarChart3 size={size} />,
    systemHealth: <ShieldCheck size={size} />,
    systemHealthHistory: <ScrollText size={size} />,
    capabilities: <ShieldCheck size={size} />,
    users: <Users size={size} />,
    wallets: <WalletCards size={size} />,
    walletTransactions: <ReceiptText size={size} />,
    reconciliation: <Scale size={size} />,
    sales: <TrendingUp size={size} />,
    usages: <Activity size={size} />,
    products: <PackagePlus size={size} />,
    orders: <KeyRound size={size} />,
    rentals: <ShieldCheck size={size} />,
    apiKeys: <KeyRound size={size} />,
    sub2: <Activity size={size} />,
    proxyRequests: <ScrollText size={size} />,
    suppliers: <Users size={size} />,
    resources: <Boxes size={size} />,
    settlements: <CircleDollarSign size={size} />,
    withdrawals: <WalletCards size={size} />,
    audit: <ScrollText size={size} />
  };
  return map[view];
}

function titleFor(view: View) {
  const map: Record<View, string> = {
    capabilities: "入口能力",
    dashboard: "经营看板",
    systemHealth: "可用性巡检",
    systemHealthHistory: "巡检历史",
    users: "用户管理",
    wallets: "余额管理",
    walletTransactions: "余额流水",
    reconciliation: "账务对账",
    sales: "售出情况",
    usages: "用量记录",
    products: "商品管理",
    orders: "订单管理",
    rentals: "租赁通道",
    apiKeys: "API Key 管理",
    sub2: "反代状态",
    proxyRequests: "反代请求",
    suppliers: "供给方管理",
    resources: "共享资源",
    settlements: "结算管理",
    withdrawals: "提现管理",
    audit: "操作审计"
  };
  return map[view];
}

function createDefaultListQueries() {
  return Object.fromEntries(managedListViews.map((listView) => [listView, { ...defaultListQuery }])) as Record<ManagedListView, ListQueryState>;
}

function createDefaultListMeta() {
  return Object.fromEntries(managedListViews.map((listView) => [listView, { ...defaultPageMeta }])) as Record<ManagedListView, PageMeta>;
}

function buildListUrl(path: string, query: ListQueryState) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status) params.set("status", query.status);
  if (query.resourceType) params.set("resourceType", query.resourceType);
  if (query.action) params.set("action", query.action);
  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  return `${path}?${params.toString()}`;
}

function optionalFormString(form: FormData, name: string) {
  const value = String(form.get(name) || "").trim();
  return value || undefined;
}

function nullableFormNumber(form: FormData, name: string) {
  const value = String(form.get(name) || "").trim();
  return value || null;
}

function nullableFormString(form: FormData, name: string) {
  const value = String(form.get(name) || "").trim();
  return value || null;
}

function confirmAdminAction(title: string, detail?: string) {
  return window.confirm([title, detail, "该操作会立即生效，并写入后台审计日志。"].filter(Boolean).join("\n\n"));
}

function promptAdminNote(title: string, fallback: string) {
  const value = window.prompt(`${title}\n\n请输入审计备注；取消则不执行。`, fallback);
  if (value === null) return null;
  return value.trim() || fallback;
}

type CsvCell = string | number | null | undefined;

function exportUsersCsv(rows: UserRow[], scope = "current-page") {
  downloadCsv(`users-${scope}`, ["id", "email", "displayName", "phone", "status", "roles", "balance", "orders", "rentals", "createdAt"], rows.map((user) => [
    user.id,
    user.email,
    user.displayName,
    user.phone,
    user.status,
    user.roles.map((role) => role.role).join("|"),
    user.wallet?.availableBalance,
    user._count?.orders,
    user._count?.rentals,
    user.createdAt
  ]));
}

function exportSystemHealthSnapshotsCsv(rows: SystemHealthSnapshotRow[], scope = "current-page") {
  downloadCsv(`system-health-snapshots-${scope}`, ["id", "status", "source", "totalChecks", "ok", "warning", "error", "actorEmail", "actorId", "createdAt"], rows.map((snapshot) => [
    snapshot.id,
    snapshot.status,
    snapshot.source,
    snapshot.summary.totalChecks ?? 0,
    snapshot.summary.ok ?? 0,
    snapshot.summary.warning ?? 0,
    snapshot.summary.error ?? 0,
    snapshot.actor?.email,
    snapshot.actor?.id,
    snapshot.createdAt
  ]));
}

function exportWalletsCsv(rows: WalletRow[], scope = "current-page") {
  downloadCsv(`wallets-${scope}`, ["walletId", "userId", "email", "available", "frozen", "recharged", "spent", "updatedAt"], rows.map((wallet) => [
    wallet.id,
    wallet.userId,
    wallet.user?.email,
    wallet.availableBalance,
    wallet.frozenBalance,
    wallet.totalRecharged,
    wallet.totalSpent,
    wallet.updatedAt
  ]));
}

function exportWalletTransactionsCsv(rows: WalletTransactionRow[], scope = "current-page") {
  downloadCsv(`wallet-transactions-${scope}`, ["id", "email", "walletId", "type", "amount", "balanceAfter", "currency", "refType", "refId", "note", "createdAt"], rows.map((transaction) => [
    transaction.id,
    transaction.wallet?.user?.email,
    transaction.walletId,
    transaction.type,
    transaction.amount,
    transaction.balanceAfter,
    transaction.currency,
    transaction.refType,
    transaction.refId,
    transaction.note,
    transaction.createdAt
  ]));
}

function exportUsagesCsv(rows: UsageRecordRow[], scope = "current-page") {
  downloadCsv(`usages-${scope}`, ["id", "sub2RequestId", "email", "rentalId", "resourceType", "model", "status", "inputUnits", "outputUnits", "apiEquivalentCost", "buyerCharge", "supplierIncome", "supplierEmail", "occurredAt"], rows.map((usage) => [
    usage.id,
    usage.sub2RequestId,
    usage.rental?.user?.email,
    usage.rentalId,
    usage.resourceType,
    usage.model,
    usage.status,
    usage.inputUnits,
    usage.outputUnits,
    usage.apiEquivalentCost,
    usage.buyerCharge,
    usage.supplierIncome,
    usage.supplierResource?.supplier?.user?.email,
    usage.occurredAt
  ]));
}

function exportProductsCsv(rows: ProductRow[], scope = "current-page") {
  downloadCsv(`products-${scope}`, ["id", "name", "resourceType", "billingMode", "status", "deliveryReady", "readyDeliveryResources", "deliveryBlockedReason", "priceCount", "priceLimits", "orders", "rentals", "updatedAt"], rows.map((product) => [
    product.id,
    product.name,
    product.resourceType,
    product.billingMode,
    product.status,
    product.deliveryReady === undefined ? undefined : String(product.deliveryReady),
    product.readyDeliveryResources,
    product.deliveryBlockedReason,
    product._count?.prices ?? product.prices?.length ?? 0,
    productPriceLimitSummary(product.prices),
    product._count?.orders,
    product._count?.rentals,
    product.updatedAt
  ]));
}

function productPriceLimitSummary(prices?: ProductPriceRow[]) {
  return (prices ?? [])
    .map((price) => `${price.tierCode}: concurrency=${price.maxConcurrency}, rpm=${price.rpmLimit ?? "-"}, tpm=${price.tpmLimit ?? "-"}, requests=${price.requestLimit ?? "-"}, spend=${price.spendLimit ?? "-"}`)
    .join(" | ");
}

function exportOrdersCsv(rows: OrderRow[], filename = "orders", scope = "current-page") {
  downloadCsv(`${filename}-${scope}`, ["id", "email", "status", "paidAmount", "totalAmount", "rentals", "createdAt"], rows.map((order) => [
    order.id,
    order.user?.email,
    order.status,
    order.paidAmount,
    order.totalAmount,
    order.rentals?.length ?? 0,
    order.createdAt
  ]));
}

function exportRentalsCsv(rows: RentalRow[], scope = "current-page") {
  downloadCsv(`rentals-${scope}`, ["id", "email", "status", "resourceType", "product", "endpointUrl", "sub2KeyId", "apiKeys", "createdAt", "endsAt"], rows.map((rental) => [
    rental.id,
    rental.user?.email,
    rental.status,
    rental.resourceType,
    rental.product?.name,
    rental.endpointUrl,
    rental.sub2KeyId,
    (rental.apiKeys ?? []).map((apiKey) => `${apiKey.keyPrefix}:${apiKey.status}`).join("|"),
    rental.createdAt,
    rental.endsAt
  ]));
}

function exportApiKeysCsv(rows: ApiKeyRow[], scope = "current-page") {
  downloadCsv(`api-keys-${scope}`, ["id", "email", "name", "keyPrefix", "status", "rentalId", "product", "resourceType", "endpointUrl", "lastUsedAt", "createdAt"], rows.map((apiKey) => [
    apiKey.id,
    apiKey.user?.email,
    apiKey.name,
    apiKey.keyPrefix,
    apiKey.status,
    apiKey.rental?.id ?? apiKey.rentalId,
    apiKey.rental?.product?.name,
    apiKey.rental?.resourceType,
    apiKey.rental?.endpointUrl,
    apiKey.lastUsedAt,
    apiKey.createdAt
  ]));
}

function exportResourcesCsv(rows: ResourceRow[], scope = "current-page") {
  downloadCsv(`resources-${scope}`, ["id", "supplierEmail", "resourceType", "status", "level", "maxConcurrency", "shareRate", "reserveRatio", "dailyCap", "sub2AccountId", "credentialType", "credentialStatus", "credentialFingerprint", "lastCheckedAt", "updatedAt"], rows.map((resource) => [
    resource.id,
    resource.supplier?.user?.email,
    resource.resourceType,
    resource.status,
    resource.level,
    resource.maxConcurrency,
    resource.shareRate,
    resource.reserveRatio,
    resource.dailyCap,
    resource.sub2AccountId,
    resource.credential?.credentialType,
    resource.credential?.status,
    resource.credential?.keyFingerprint,
    resource.lastCheckedAt,
    resource.updatedAt
  ]));
}

function exportSuppliersCsv(rows: SupplierDetailRow[], scope = "current-page") {
  downloadCsv(`suppliers-${scope}`, ["id", "email", "displayName", "status", "defaultShareRate", "resources", "withdrawals", "updatedAt"], rows.map((supplier) => [
    supplier.id,
    supplier.user?.email,
    supplier.displayName,
    supplier.status,
    supplier.defaultShareRate,
    supplier._count?.resources ?? supplier.resources?.length ?? 0,
    supplier._count?.withdrawals ?? supplier.withdrawals?.length ?? 0,
    supplier.updatedAt
  ]));
}

function exportSettlementsCsv(rows: SettlementRow[], scope = "current-page") {
  downloadCsv(`settlements-${scope}`, ["id", "supplierEmail", "resourceType", "amount", "status", "shareRate", "availableAt", "createdAt"], rows.map((settlement) => [
    settlement.id,
    settlement.supplierResource?.supplier?.user?.email,
    settlement.supplierResource?.resourceType,
    settlement.amount,
    settlement.status,
    settlement.shareRate,
    settlement.availableAt,
    settlement.createdAt
  ]));
}

function exportWithdrawalsCsv(rows: WithdrawalRow[], scope = "current-page") {
  downloadCsv(`withdrawals-${scope}`, ["id", "supplierEmail", "amount", "currency", "status", "payoutRef", "note", "createdAt", "updatedAt"], rows.map((withdrawal) => [
    withdrawal.id,
    withdrawal.supplier?.user?.email,
    withdrawal.amount,
    withdrawal.currency,
    withdrawal.status,
    withdrawal.payoutRef,
    withdrawal.note,
    withdrawal.createdAt,
    withdrawal.updatedAt
  ]));
}

function exportAuditLogsCsv(rows: AuditLogRow[], scope = "current-page") {
  downloadCsv(`audit-logs-${scope}`, ["id", "actorEmail", "action", "objectType", "objectId", "summary", "ipAddress", "userAgent", "createdAt"], rows.map((log) => [
    log.id,
    log.actor?.email,
    log.action,
    log.objectType,
    log.objectId,
    auditSummary(log.after),
    log.ipAddress,
    log.userAgent,
    log.createdAt
  ]));
}

function exportProxyRequestsCsv(rows: ProxyRequestLogRow[], scope = "current-page") {
  downloadCsv(`proxy-requests-${scope}`, ["id", "requestId", "upstreamRequestId", "email", "rentalId", "apiKeyPrefix", "method", "path", "model", "statusCode", "upstreamStatusCode", "errorCode", "durationMs", "requestBytes", "estimatedInputTokens", "ipAddress", "userAgent", "createdAt"], rows.map((log) => [
    log.id,
    log.requestId,
    log.upstreamRequestId,
    log.user?.email,
    log.rentalId,
    log.apiKey?.keyPrefix ?? log.apiKeyPrefix,
    log.method,
    log.path,
    log.model,
    log.statusCode,
    log.upstreamStatusCode,
    log.errorCode,
    log.durationMs,
    log.requestBytes,
    log.estimatedInputTokens,
    log.ipAddress,
    log.userAgent,
    log.createdAt
  ]));
}

function downloadCsv(filenameBase: string, headers: string[], rows: CsvCell[][]) {
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `${filenameBase}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: CsvCell) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function money(value?: string | number | null) {
  const numberValue = Number(value ?? 0);
  return `$${numberValue.toFixed(2)}`;
}

function priceAmountLabel(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return "按量";
  return money(value);
}

function allocationAmount(settlements?: WithdrawalSettlementRow[]) {
  return settlements?.reduce((sum, settlement) => sum + Number(settlement.amount || 0), 0) ?? 0;
}

function testSummary(result: Sub2AccountTestResult) {
  const errorEvent = result.events.find((event) => event.type === "error" || typeof event.error === "string");
  const message = errorEvent?.error ?? errorEvent?.message ?? result.raw;
  return String(message || "-").slice(0, 180);
}

function smokeSummary(result: Sub2ProxySmokeTestResult) {
  if (!result.provisioning.ok) return result.provisioning.error ?? "开通临时 Key 失败";
  if (!result.models.ok) return result.models.error ?? `Models HTTP ${result.models.statusCode}`;
  if (!result.responses.ok) return result.responses.errorMessage ?? result.responses.errorType ?? `Responses HTTP ${result.responses.statusCode}`;
  if (!result.localProxy?.ok) {
    const cleanupOk = result.localProxy?.apiKeyDeactivated && result.localProxy.rentalClosed && result.localProxy.orderClosed && result.localProxy.walletReset;
    return cleanupOk ? `本地代理日志不足：${result.localProxy?.proxyRequestLogCount ?? 0}` : "本地 smoke 租赁清理失败";
  }
  if (!result.keyDisabled) return result.cleanupError ?? "临时 Key 清理失败";
  return "-";
}

function credentialApplyMessage(result: Sub2CredentialApplyResult, successPrefix: string, failurePrefix: string) {
  const testMessage = result.test
    ? `，测试${result.test.ok ? "通过" : "失败"} / HTTP ${result.test.statusCode} / ${testSummary(result.test)}`
    : "";
  const smokeMessage = result.smokeTest
    ? result.smokeTest.ok ? "，端到端通过" : `，端到端失败 / ${smokeSummary(result.smokeTest)}`
    : result.smokeTestSkippedReason ? `，端到端跳过：${credentialApplySmokeSkipLabel(result.smokeTestSkippedReason)}` : "";
  return result.result.ok
    ? `${successPrefix}到 Sub2 账号 #${result.accountId}${testMessage}${smokeMessage}`
    : `${failurePrefix}：${result.result.error ?? "未知错误"}${smokeMessage}`;
}

function resourceCredentialSyncMessage(sync: NonNullable<Sub2CredentialApplyResult["resourceCredentialSync"]>) {
  if (!sync.saved) return `共享资源凭据未保存：${resourceCredentialSyncSkipLabel(sync.skippedReason)}`;
  const action = sync.created ? "已新建共享资源并保存凭据" : "已更新共享资源凭据";
  const resourceId = sync.resource?.id ? ` #${sync.resource.id}` : "";
  const status = sync.resource?.status ? ` / ${sync.resource.status}` : "";
  return `${action}${resourceId}${status}`;
}

function resourceCredentialSyncSkipLabel(reason?: string | null) {
  if (reason === "credential_apply_failed") return "Sub2 应用失败";
  return reason ?? "未知原因";
}

function credentialApplySmokeSkipLabel(reason: string) {
  if (reason === "credential_apply_failed") return "凭据应用失败";
  if (reason === "sub2_account_test_failed") return "Sub2 账号测试失败";
  return reason;
}

function auditSummary(value: unknown) {
  if (!value) return "-";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}

function dateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

createRoot(document.getElementById("root")!).render(<App />);
