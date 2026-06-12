export type AdminCapabilityAreaId =
  | "users"
  | "sharing"
  | "wallets"
  | "sales"
  | "openaiProxy"
  | "governance";

export type AdminCapabilityOperationMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type AdminCapabilityTargetView =
  | "dashboard"
  | "systemHealth"
  | "systemHealthHistory"
  | "capabilities"
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

export interface AdminCapabilityOperation {
  id: string;
  label: string;
  method: AdminCapabilityOperationMethod;
  path: string;
  roles: Array<"operator" | "admin">;
  critical: boolean;
  target: {
    view: AdminCapabilityTargetView;
    label: string;
  } | null;
}

export interface AdminCapabilityArea {
  id: AdminCapabilityAreaId;
  label: string;
  required: boolean;
  operations: AdminCapabilityOperation[];
}

export interface AdminCapabilityCoverageIssue {
  id: string;
  type: "required_area_missing" | "operation_route_missing" | "operation_target_missing";
  severity: "error";
  areaId?: string;
  operationId?: string;
  method?: string;
  path?: string;
  message: string;
  actionHint: string;
}

export interface AdminCapabilityCoverage {
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

export type AdminRouteLookup = (operation: AdminCapabilityOperation) => boolean;

const requiredAreaIds: AdminCapabilityAreaId[] = ["users", "sharing", "wallets", "sales", "openaiProxy"];

const adminCapabilityOperationTargets: Record<string, AdminCapabilityOperation["target"]> = {
  "users.list": target("users", "打开用户"),
  "users.detail": target("users", "打开用户"),
  "users.create": target("users", "打开用户"),
  "users.updateProfile": target("users", "打开用户"),
  "users.updateStatus": target("users", "打开用户"),
  "users.updateRoles": target("users", "打开用户"),
  "suppliers.list": target("suppliers", "打开供给方"),
  "suppliers.update": target("suppliers", "打开供给方"),
  "resources.list": target("resources", "打开共享资源"),
  "resources.detail": target("resources", "打开共享资源"),
  "resources.create": target("resources", "打开共享资源"),
  "resources.update": target("resources", "打开共享资源"),
  "resources.status": target("resources", "打开共享资源"),
  "resources.test": target("resources", "打开共享资源"),
  "resources.credentialUpsert": target("resources", "打开共享资源"),
  "resources.credentialDelete": target("resources", "打开共享资源"),
  "resources.applyCredential": target("resources", "打开共享资源"),
  "wallets.list": target("wallets", "打开余额"),
  "wallets.detail": target("wallets", "打开余额"),
  "wallets.transactions": target("walletTransactions", "打开余额流水"),
  "wallets.adjust": target("wallets", "打开余额"),
  "reconciliation.read": target("reconciliation", "打开对账"),
  "sales.list": target("sales", "打开售出"),
  "orders.list": target("orders", "打开订单"),
  "orders.detail": target("orders", "打开订单"),
  "orders.cancel": target("orders", "打开订单"),
  "orders.refund": target("orders", "打开订单"),
  "orders.retryProvision": target("orders", "打开订单"),
  "rentals.list": target("rentals", "打开租赁"),
  "rentals.detail": target("rentals", "打开租赁"),
  "rentals.status": target("rentals", "打开租赁"),
  "rentals.limits": target("rentals", "打开租赁"),
  "rentals.assignSupplierResource": target("rentals", "打开租赁"),
  "rentals.rotateKey": target("rentals", "打开租赁"),
  "apiKeys.list": target("apiKeys", "打开 API Key"),
  "apiKeys.status": target("apiKeys", "打开 API Key"),
  "apiKeys.bulkStatus": target("apiKeys", "打开 API Key"),
  "usages.list": target("usages", "打开用量"),
  "usages.syncSub2": target("usages", "打开用量"),
  "usages.syncState": target("usages", "打开用量"),
  "rentals.expireOverdue": target("rentals", "打开租赁"),
  "proxyRequests.list": target("proxyRequests", "打开反代请求"),
  "sub2.status": target("sub2", "打开反代状态"),
  "sub2.bindings": target("sub2", "打开反代状态"),
  "sub2.repairBindings": target("sub2", "打开反代状态"),
  "sub2.accountRefresh": target("sub2", "打开反代状态"),
  "sub2.accountTest": target("sub2", "打开反代状态"),
  "sub2.proxySmokeTest": target("sub2", "打开反代状态"),
  "sub2.applyOpenAiRefreshToken": target("sub2", "打开反代状态"),
  "dashboard.read": target("dashboard", "打开总览"),
  "capabilities.read": target("capabilities", "打开能力"),
  "systemHealth.read": target("systemHealth", "打开巡检"),
  "systemHealth.snapshots": target("systemHealthHistory", "打开历史"),
  "systemMaintenance.run": target("systemHealth", "打开巡检"),
  "auditLogs.list": target("audit", "打开审计"),
  "products.list": target("products", "打开商品"),
  "products.create": target("products", "打开商品"),
  "products.detail": target("products", "打开商品"),
  "products.update": target("products", "打开商品"),
  "productPrices.create": target("products", "打开商品"),
  "productPrices.update": target("products", "打开商品"),
  "settlements.list": target("settlements", "打开结算"),
  "settlements.release": target("settlements", "打开结算"),
  "withdrawals.list": target("withdrawals", "打开提现"),
  "withdrawals.create": target("withdrawals", "打开提现"),
  "withdrawals.update": target("withdrawals", "打开提现")
};

const adminCapabilityAreas: AdminCapabilityArea[] = [
  {
    id: "users",
    label: "User management",
    required: true,
    operations: [
      criticalOperation("users.list", "List users", "GET", "/api/admin/users", ["operator", "admin"]),
      criticalOperation("users.detail", "Inspect a user", "GET", "/api/admin/users/:id", ["operator", "admin"]),
      criticalOperation("users.create", "Create a user", "POST", "/api/admin/users", ["admin"]),
      criticalOperation("users.updateProfile", "Update a user profile", "PATCH", "/api/admin/users/:id", ["admin"]),
      criticalOperation("users.updateStatus", "Update a user status", "PATCH", "/api/admin/users/:id/status", ["admin"]),
      criticalOperation("users.updateRoles", "Update user roles", "PATCH", "/api/admin/users/:id/roles", ["admin"])
    ]
  },
  {
    id: "sharing",
    label: "Shared resource and supplier management",
    required: true,
    operations: [
      criticalOperation("suppliers.list", "List suppliers", "GET", "/api/admin/suppliers", ["operator", "admin"]),
      criticalOperation("suppliers.update", "Update supplier settings", "PATCH", "/api/admin/suppliers/:id", ["admin"]),
      criticalOperation("resources.list", "List shared resources", "GET", "/api/admin/resources", ["operator", "admin"]),
      criticalOperation("resources.detail", "Inspect a shared resource", "GET", "/api/admin/resources/:id", ["operator", "admin"]),
      criticalOperation("resources.create", "Create a shared resource", "POST", "/api/admin/resources", ["admin"]),
      criticalOperation("resources.update", "Update a shared resource", "PATCH", "/api/admin/resources/:id", ["admin"]),
      criticalOperation("resources.status", "Update shared resource status", "PATCH", "/api/admin/resources/:id/status", ["operator", "admin"]),
      criticalOperation("resources.test", "Test Sub2 account health", "POST", "/api/admin/resources/:id/test", ["operator", "admin"]),
      criticalOperation("resources.credentialUpsert", "Save encrypted resource credential", "PUT", "/api/admin/resources/:id/credential", ["admin"]),
      criticalOperation("resources.credentialDelete", "Delete resource credential", "DELETE", "/api/admin/resources/:id/credential", ["admin"]),
      criticalOperation("resources.applyCredential", "Apply resource credential to Sub2", "POST", "/api/admin/resources/:id/apply-credential-to-sub2", ["admin"])
    ]
  },
  {
    id: "wallets",
    label: "Balance and wallet management",
    required: true,
    operations: [
      criticalOperation("wallets.list", "List wallets", "GET", "/api/admin/wallets", ["operator", "admin"]),
      criticalOperation("wallets.detail", "Inspect a wallet", "GET", "/api/admin/wallets/:id", ["operator", "admin"]),
      criticalOperation("wallets.transactions", "List wallet transactions", "GET", "/api/admin/wallet-transactions", ["operator", "admin"]),
      criticalOperation("wallets.adjust", "Adjust user wallet balance", "POST", "/api/admin/users/:id/wallet-adjust", ["admin"]),
      operation("reconciliation.read", "Run billing reconciliation", "GET", "/api/admin/reconciliation", ["operator", "admin"])
    ]
  },
  {
    id: "sales",
    label: "Sales, delivery, and usage management",
    required: true,
    operations: [
      criticalOperation("sales.list", "List sold orders and sales summary", "GET", "/api/admin/sales", ["operator", "admin"]),
      criticalOperation("orders.list", "List orders", "GET", "/api/admin/orders", ["operator", "admin"]),
      criticalOperation("orders.detail", "Inspect an order", "GET", "/api/admin/orders/:id", ["operator", "admin"]),
      criticalOperation("orders.cancel", "Cancel an order", "POST", "/api/admin/orders/:id/cancel", ["admin"]),
      criticalOperation("orders.refund", "Refund an order", "POST", "/api/admin/orders/:id/refund", ["admin"]),
      criticalOperation("orders.retryProvision", "Retry failed order provisioning", "POST", "/api/admin/orders/:id/retry-provision", ["admin"]),
      criticalOperation("rentals.list", "List sold rental channels", "GET", "/api/admin/rentals", ["operator", "admin"]),
      criticalOperation("rentals.detail", "Inspect a rental channel", "GET", "/api/admin/rentals/:id", ["operator", "admin"]),
      criticalOperation("rentals.status", "Update rental status", "PATCH", "/api/admin/rentals/:id/status", ["admin"]),
      criticalOperation("rentals.limits", "Update sold rental limits", "PATCH", "/api/admin/rentals/:id/limits", ["admin"]),
      criticalOperation("rentals.assignSupplierResource", "Assign shared resource attribution", "PATCH", "/api/admin/rentals/:id/supplier-resource", ["admin"]),
      criticalOperation("rentals.rotateKey", "Rotate rental API key", "POST", "/api/admin/rentals/:id/rotate-key", ["admin"]),
      criticalOperation("apiKeys.list", "List API keys", "GET", "/api/admin/api-keys", ["operator", "admin"]),
      criticalOperation("apiKeys.status", "Update API key status", "PATCH", "/api/admin/api-keys/:id/status", ["admin"]),
      criticalOperation("apiKeys.bulkStatus", "Bulk update API key status", "POST", "/api/admin/api-keys/bulk-status", ["admin"]),
      criticalOperation("usages.list", "List usage records", "GET", "/api/admin/usages", ["operator", "admin"]),
      criticalOperation("usages.syncSub2", "Sync Sub2 usage", "POST", "/api/admin/usages/sync-sub2", ["operator", "admin"]),
      operation("usages.syncState", "Inspect usage sync state", "GET", "/api/admin/usages/sync-state", ["operator", "admin"]),
      operation("rentals.expireOverdue", "Expire overdue rentals", "POST", "/api/admin/rentals/expire-overdue", ["admin"])
    ]
  },
  {
    id: "openaiProxy",
    label: "Sub2API OpenAI/Codex proxy management",
    required: true,
    operations: [
      criticalOperation("proxyRequests.list", "List OpenAI/Codex proxy requests", "GET", "/api/admin/proxy-requests", ["operator", "admin"]),
      criticalOperation("sub2.status", "Inspect Sub2/OpenAI status", "GET", "/api/admin/sub2/status", ["operator", "admin"]),
      criticalOperation("sub2.bindings", "Inspect Sub2 binding reconciliation", "GET", "/api/admin/sub2/bindings/reconciliation", ["operator", "admin"]),
      criticalOperation("sub2.repairBindings", "Repair Sub2 bindings", "POST", "/api/admin/sub2/bindings/repair", ["admin"]),
      criticalOperation("sub2.accountRefresh", "Refresh a Sub2 account", "POST", "/api/admin/sub2/accounts/:id/refresh", ["admin"]),
      criticalOperation("sub2.accountTest", "Test a Sub2 account", "POST", "/api/admin/sub2/accounts/:id/test", ["admin"]),
      criticalOperation("sub2.proxySmokeTest", "Run end-to-end local proxy smoke test", "POST", "/api/admin/sub2/proxy-smoke-test", ["admin"]),
      criticalOperation("sub2.applyOpenAiRefreshToken", "Apply OpenAI refresh token to Sub2", "POST", "/api/admin/sub2/accounts/:id/apply-openai-refresh-token", ["admin"])
    ]
  },
  {
    id: "governance",
    label: "Governance, health, and audit",
    required: false,
    operations: [
      operation("dashboard.read", "Read admin dashboard", "GET", "/api/admin/dashboard", ["operator", "admin"]),
      operation("capabilities.read", "Read admin capability coverage", "GET", "/api/admin/capabilities", ["operator", "admin"]),
      operation("systemHealth.read", "Run system health inspection", "GET", "/api/admin/system-health", ["operator", "admin"]),
      operation("systemHealth.snapshots", "List system health snapshots", "GET", "/api/admin/system-health/snapshots", ["operator", "admin"]),
      operation("systemMaintenance.run", "Run safe system maintenance", "POST", "/api/admin/system-maintenance/run", ["admin"]),
      operation("auditLogs.list", "List audit logs", "GET", "/api/admin/audit-logs", ["operator", "admin"]),
      operation("products.list", "List products", "GET", "/api/admin/products", ["operator", "admin"]),
      operation("products.create", "Create products", "POST", "/api/admin/products", ["admin"]),
      operation("products.detail", "Inspect products", "GET", "/api/admin/products/:id", ["operator", "admin"]),
      operation("products.update", "Update products", "PATCH", "/api/admin/products/:id", ["admin"]),
      operation("productPrices.create", "Create product prices", "POST", "/api/admin/products/:id/prices", ["admin"]),
      operation("productPrices.update", "Update product prices", "PATCH", "/api/admin/product-prices/:id", ["admin"]),
      operation("settlements.list", "List supplier settlements", "GET", "/api/admin/settlements", ["operator", "admin"]),
      operation("settlements.release", "Release available settlements", "POST", "/api/admin/settlements/release-available", ["admin"]),
      operation("withdrawals.list", "List withdrawals", "GET", "/api/admin/withdrawals", ["operator", "admin"]),
      operation("withdrawals.create", "Create withdrawals", "POST", "/api/admin/withdrawals", ["admin"]),
      operation("withdrawals.update", "Update withdrawals", "PATCH", "/api/admin/withdrawals/:id", ["admin"])
    ]
  }
];

export function adminCapabilities() {
  return adminCapabilityAreas.map((area) => ({
    ...area,
    operations: area.operations.map((item) => ({ ...item, roles: [...item.roles] }))
  }));
}

export function inspectAdminCapabilityRouteCoverage(routeExists: AdminRouteLookup): AdminCapabilityCoverage {
  const capabilities = adminCapabilities();
  const issues: AdminCapabilityCoverageIssue[] = [];
  const requiredAreas = capabilities.filter((area) => area.required);
  const coveredRequiredAreas = requiredAreas.filter((area) => area.operations.some((operation) => routeExists(operation)));
  const registeredOperations = capabilities.flatMap((area) => area.operations).filter((operation) => routeExists(operation));

  for (const areaId of requiredAreaIds) {
    if (!capabilities.some((area) => area.id === areaId && area.required)) {
      issues.push({
        id: `admin_capability:${areaId}:missing_area`,
        type: "required_area_missing",
        severity: "error",
        areaId,
        message: `Required admin capability area ${areaId} is missing from the capability matrix.`,
        actionHint: "Restore the required capability area before treating the admin portal as complete."
      });
    }
  }

  for (const area of capabilities) {
    for (const operation of area.operations) {
      if (!routeExists(operation)) {
        issues.push({
          id: `admin_capability:${operation.id}:missing_route`,
          type: "operation_route_missing",
          severity: "error",
          areaId: area.id,
          operationId: operation.id,
          method: operation.method,
          path: operation.path,
          message: `Admin capability ${operation.id} is declared but ${operation.method} ${operation.path} is not registered.`,
          actionHint: "Register the missing admin route or remove the stale capability declaration."
        });
      }
      if (!operation.target) {
        issues.push({
          id: `admin_capability:${operation.id}:missing_target`,
          type: "operation_target_missing",
          severity: "error",
          areaId: area.id,
          operationId: operation.id,
          method: operation.method,
          path: operation.path,
          message: `Admin capability ${operation.id} is declared but has no frontend management target.`,
          actionHint: "Add a target view so operators can open the matching admin surface from the capability matrix."
        });
      }
    }
  }

  const totalOperations = capabilities.reduce((total, area) => total + area.operations.length, 0);
  const operationsWithTargets = capabilities.reduce(
    (total, area) => total + area.operations.filter((operation) => operation.target).length,
    0
  );
  const criticalOperations = capabilities.reduce(
    (total, area) => total + area.operations.filter((operation) => operation.critical).length,
    0
  );

  return {
    ok: issues.length === 0,
    summary: {
      requiredAreas: requiredAreas.length,
      coveredRequiredAreas: coveredRequiredAreas.length,
      totalOperations,
      criticalOperations,
      registeredOperations: registeredOperations.length,
      missingRoutes: issues.filter((issue) => issue.type === "operation_route_missing").length,
      operationsWithTargets,
      missingTargets: issues.filter((issue) => issue.type === "operation_target_missing").length
    },
    issues
  };
}

function operation(
  id: string,
  label: string,
  method: AdminCapabilityOperationMethod,
  path: string,
  roles: Array<"operator" | "admin">
): AdminCapabilityOperation {
  return { id, label, method, path, roles, critical: false, target: adminCapabilityOperationTargets[id] ?? null };
}

function criticalOperation(
  id: string,
  label: string,
  method: AdminCapabilityOperationMethod,
  path: string,
  roles: Array<"operator" | "admin">
): AdminCapabilityOperation {
  return { ...operation(id, label, method, path, roles), critical: true };
}

function target(view: AdminCapabilityTargetView, label: string): AdminCapabilityOperation["target"] {
  return { view, label };
}
