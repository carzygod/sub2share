export const APP_NAME = "智算驿站";

export const resourceTypes = ["codex", "claude_code", "gemini", "antigravity"] as const;
export type ResourceType = (typeof resourceTypes)[number];

export const rentalStatuses = [
  "active",
  "low_balance",
  "limited",
  "suspended",
  "expired",
  "refunded",
  "closed"
] as const;
export type RentalStatus = (typeof rentalStatuses)[number];

export const supplierLevels = ["L0", "L1", "L2", "L3", "L4"] as const;
export type SupplierLevel = (typeof supplierLevels)[number];

export const supplierShareRates: Record<SupplierLevel, number> = {
  L0: 0.7,
  L1: 0.75,
  L2: 0.8,
  L3: 0.85,
  L4: 0.9
};

export const productBillingModes = ["pay_as_you_go", "daily", "weekly", "monthly"] as const;
export type ProductBillingMode = (typeof productBillingModes)[number];

export interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  requestId: string;
}

export interface ApiErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

export type AdminSurfaceAreaId = "users" | "sharing" | "wallets" | "sales" | "openaiProxy" | "governance";

export type AdminView =
  | "dashboard"
  | "systemHealth"
  | "systemHealthHistory"
  | "users"
  | "wallets"
  | "walletTransactions"
  | "reconciliation"
  | "sales"
  | "usages"
  | "products"
  | "orders"
  | "rentals"
  | "apiKeys"
  | "sub2"
  | "proxyRequests"
  | "suppliers"
  | "resources"
  | "settlements"
  | "withdrawals"
  | "audit";

export type AdminManagedListView =
  | "systemHealthHistory"
  | "users"
  | "wallets"
  | "walletTransactions"
  | "sales"
  | "usages"
  | "products"
  | "orders"
  | "rentals"
  | "apiKeys"
  | "proxyRequests"
  | "suppliers"
  | "resources"
  | "settlements"
  | "withdrawals"
  | "audit";

export interface AdminNavigationItem {
  view: AdminView;
  label: string;
  area: AdminSurfaceAreaId;
  critical?: boolean;
}

export const requiredAdminSurfaceAreas: AdminSurfaceAreaId[] = ["users", "sharing", "wallets", "sales", "openaiProxy"];

export const adminNavigationItems: AdminNavigationItem[] = [
  { view: "dashboard", label: "总览", area: "governance" },
  { view: "systemHealth", label: "可用性巡检", area: "governance" },
  { view: "systemHealthHistory", label: "巡检历史", area: "governance" },
  { view: "users", label: "用户管理", area: "users", critical: true },
  { view: "wallets", label: "余额管理", area: "wallets", critical: true },
  { view: "walletTransactions", label: "余额流水", area: "wallets" },
  { view: "reconciliation", label: "账务对账", area: "wallets" },
  { view: "sales", label: "售出情况", area: "sales", critical: true },
  { view: "usages", label: "用量记录", area: "sales" },
  { view: "products", label: "商品配置", area: "sales" },
  { view: "orders", label: "订单管理", area: "sales" },
  { view: "rentals", label: "租赁通道", area: "sales" },
  { view: "apiKeys", label: "API Key", area: "sales" },
  { view: "sub2", label: "反代状态", area: "openaiProxy", critical: true },
  { view: "proxyRequests", label: "反代请求", area: "openaiProxy" },
  { view: "suppliers", label: "供给方", area: "sharing" },
  { view: "resources", label: "共享资源", area: "sharing", critical: true },
  { view: "settlements", label: "结算", area: "sharing" },
  { view: "withdrawals", label: "提现", area: "sharing" },
  { view: "audit", label: "审计日志", area: "governance" }
];

export const managedListViews: AdminManagedListView[] = [
  "systemHealthHistory",
  "users",
  "wallets",
  "walletTransactions",
  "sales",
  "usages",
  "products",
  "orders",
  "rentals",
  "apiKeys",
  "proxyRequests",
  "suppliers",
  "resources",
  "settlements",
  "withdrawals",
  "audit"
];

export const adminSystemHealthIssueRefFields = [
  "requestId",
  "upstreamRequestId",
  "proxyRequestLogId",
  "proxyRequestPath",
  "proxyRequestStatusCode",
  "proxyRequestErrorCode",
  "path",
  "endpoint",
  "endpointUrl",
  "statusCode",
  "contentType",
  "durationMs",
  "auditLogId",
  "auditAction",
  "areaId",
  "view",
  "resourceId",
  "supplierEmail",
  "resourceType",
  "resourceStatus",
  "resourceScope",
  "productId",
  "priceId",
  "orderId",
  "rentalId",
  "apiKeyId",
  "apiKeyPrefix",
  "model",
  "smokeTestSkippedReason",
  "usageId",
  "userId",
  "userEmail",
  "userStatus",
  "walletId",
  "walletAccountId",
  "walletTransactionId",
  "walletTransactionType",
  "availableBalance",
  "frozenBalance",
  "bindingId",
  "sub2AccountId",
  "sub2AccountName",
  "accountStatus",
  "credentialsStatus",
  "schedulable",
  "sub2BlockingReason",
  "sub2GroupId",
  "sub2GroupName",
  "sub2GroupStatus",
  "openAiAccountCount",
  "activeOpenAiAccountCount",
  "gatewayReachable",
  "repairAction",
  "settlementId",
  "settlementRecordId",
  "withdrawalId",
  "refType",
  "refId",
  "expected",
  "actual"
] as const;

export const adminSystemHealthSampleSummaryFields = [
  "sampleType",
  "userEmail",
  "amount",
  "balanceAfter",
  "currency",
  "refType",
  "refId",
  "createdAt",
  "supplierEmail",
  "resourceType",
  "resourceStatus",
  "sub2AccountId",
  "sub2AccountName",
  "accountStatus",
  "credentialsStatus",
  "schedulable",
  "repairAction",
  "tempUnschedulableReason",
  "level",
  "maxConcurrency",
  "credentialType",
  "status",
  "keyFingerprint",
  "lastRotatedAt",
  "updatedAt",
  "message"
] as const;

export function inspectAdminSurfaceCoverage() {
  const navigationViews = new Set(adminNavigationItems.map((item) => item.view));
  const areas = new Set(adminNavigationItems.map((item) => item.area));
  const criticalViews = adminNavigationItems.filter((item) => item.critical).map((item) => item.view);
  const missingRequiredAreas = requiredAdminSurfaceAreas.filter((area) => !areas.has(area));
  const missingManagedListViews = managedListViews.filter((view) => !navigationViews.has(view));
  const duplicateViews = duplicateValues(adminNavigationItems.map((item) => item.view));

  return {
    ok: missingRequiredAreas.length === 0 && missingManagedListViews.length === 0 && duplicateViews.length === 0,
    summary: {
      requiredAreas: requiredAdminSurfaceAreas.length,
      coveredRequiredAreas: requiredAdminSurfaceAreas.length - missingRequiredAreas.length,
      navigationItems: adminNavigationItems.length,
      managedListViews: managedListViews.length,
      criticalViews: criticalViews.length,
      duplicateViews: duplicateViews.length
    },
    missingRequiredAreas,
    missingManagedListViews,
    duplicateViews,
    criticalViews
  };
}

function duplicateValues(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}
