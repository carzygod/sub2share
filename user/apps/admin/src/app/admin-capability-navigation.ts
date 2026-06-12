import type { AdminView as View } from "@zyz/shared";

export interface AdminCapabilityNavigationTarget {
  view: View;
  label: string;
}

const capabilityOperationTargets: Record<string, AdminCapabilityNavigationTarget> = {
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

export function adminCapabilityOperationTarget(operationId: string) {
  return capabilityOperationTargets[operationId] ?? null;
}

function target(view: View, label: string): AdminCapabilityNavigationTarget {
  return { view, label };
}
