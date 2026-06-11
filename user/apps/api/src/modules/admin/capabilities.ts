export type AdminCapabilityAreaId =
  | "users"
  | "sharing"
  | "wallets"
  | "sales"
  | "openaiProxy"
  | "governance";

export type AdminCapabilityOperationMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface AdminCapabilityOperation {
  id: string;
  label: string;
  method: AdminCapabilityOperationMethod;
  path: string;
  roles: Array<"operator" | "admin">;
  critical: boolean;
}

export interface AdminCapabilityArea {
  id: AdminCapabilityAreaId;
  label: string;
  required: boolean;
  operations: AdminCapabilityOperation[];
}

export interface AdminCapabilityCoverageIssue {
  id: string;
  type: "required_area_missing" | "operation_route_missing";
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
  };
  issues: AdminCapabilityCoverageIssue[];
}

export type AdminRouteLookup = (operation: AdminCapabilityOperation) => boolean;

const requiredAreaIds: AdminCapabilityAreaId[] = ["users", "sharing", "wallets", "sales", "openaiProxy"];

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
    }
  }

  const totalOperations = capabilities.reduce((total, area) => total + area.operations.length, 0);
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
      missingRoutes: issues.filter((issue) => issue.type === "operation_route_missing").length
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
  return { id, label, method, path, roles, critical: false };
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
