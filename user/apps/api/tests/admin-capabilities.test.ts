import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/sub2share_test";
process.env.JWT_ACCESS_SECRET ??= "test-secret-at-least-sixteen-characters";
process.env.SUB2_BASE_URL ??= "http://localhost:3001";
process.env.SUB2_PUBLIC_ENDPOINT ??= "http://localhost:3001";
process.env.SUB2_ADMIN_TOKEN ??= "test-sub2-admin-token";

const {
  adminCapabilities,
  inspectAdminCapabilityRouteCoverage
} = await import("../src/modules/admin/capabilities.js");
const { dashboardHealthCheckPreviews, dashboardLatestSystemHealthPreview, enrichSub2RepairContextChecks, registerAdminRoutes } = await import("../src/modules/admin/routes.js");
const { inspectAdminSurfaceCoverage } = await import("@zyz/shared/admin-surfaces");

test("admin capability matrix covers the required management areas", () => {
  const capabilities = adminCapabilities();
  const requiredAreaIds = capabilities.filter((area) => area.required).map((area) => area.id).sort();

  assert.deepEqual(requiredAreaIds, ["openaiProxy", "sales", "sharing", "users", "wallets"]);
  assert.ok(capabilities.find((area) => area.id === "users")?.operations.some((operation) => operation.id === "users.updateRoles"));
  assert.ok(capabilities.find((area) => area.id === "sharing")?.operations.some((operation) => operation.id === "resources.applyCredential"));
  assert.ok(capabilities.find((area) => area.id === "wallets")?.operations.some((operation) => operation.id === "wallets.adjust"));
  assert.ok(capabilities.find((area) => area.id === "sales")?.operations.some((operation) => operation.id === "orders.retryProvision"));
  assert.ok(capabilities.find((area) => area.id === "openaiProxy")?.operations.some((operation) => operation.id === "sub2.proxySmokeTest"));
});

test("admin capability operations include frontend management targets", () => {
  const operations = adminCapabilities().flatMap((area) => area.operations.map((operation) => ({ ...operation, areaId: area.id })));
  const missingTargets = operations.filter((operation) => !operation.target);
  const targetById = new Map(operations.map((operation) => [operation.id, operation.target]));

  assert.equal(operations.length, 65);
  assert.deepEqual(missingTargets, []);
  assert.equal(targetById.get("users.updateRoles")?.view, "users");
  assert.equal(targetById.get("resources.applyCredential")?.view, "resources");
  assert.equal(targetById.get("wallets.adjust")?.view, "wallets");
  assert.equal(targetById.get("orders.retryProvision")?.view, "orders");
  assert.equal(targetById.get("sales.list")?.view, "sales");
  assert.equal(targetById.get("usages.syncSub2")?.view, "usages");
  assert.equal(targetById.get("proxyRequests.list")?.view, "proxyRequests");
  assert.equal(targetById.get("sub2.applyOpenAiRefreshToken")?.view, "sub2");
  assert.equal(targetById.get("capabilities.read")?.view, "capabilities");
  assert.equal(targetById.get("systemHealth.read")?.view, "systemHealth");
  assert.equal(targetById.get("auditLogs.list")?.view, "audit");
  assert.ok(operations.every((operation) => operation.target?.label.startsWith("打开")));
});

test("admin capability coverage reports missing declared routes", () => {
  const result = inspectAdminCapabilityRouteCoverage((operation) => operation.id !== "sales.list");

  assert.equal(result.ok, false);
  assert.equal(result.summary.missingRoutes, 1);
  assert.equal(result.summary.missingTargets, 0);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].operationId, "sales.list");
  assert.equal(result.issues[0].method, "GET");
  assert.equal(result.issues[0].path, "/api/admin/sales");
});

test("registered admin routes cover the declared capability matrix", async () => {
  const app = Fastify({ logger: false });
  await registerAdminRoutes(app);
  const result = inspectAdminCapabilityRouteCoverage((operation) => app.hasRoute({
    method: operation.method,
    url: operation.path
  }));

  assert.equal(result.ok, true);
  assert.equal(result.summary.requiredAreas, 5);
  assert.equal(result.summary.coveredRequiredAreas, 5);
  assert.equal(result.summary.missingRoutes, 0);
  assert.equal(result.summary.operationsWithTargets, result.summary.totalOperations);
  assert.equal(result.summary.missingTargets, 0);
  assert.equal(result.summary.registeredOperations, result.summary.totalOperations);

  await app.close();
});

test("shared admin frontend surface matrix covers the required management areas", () => {
  const result = inspectAdminSurfaceCoverage();

  assert.equal(result.ok, true);
  assert.equal(result.summary.requiredAreas, 5);
  assert.equal(result.summary.coveredRequiredAreas, 5);
  assert.equal(result.summary.criticalViews, 5);
  assert.deepEqual(result.missingRequiredAreas, []);
  assert.deepEqual(result.missingManagedListViews, []);
  assert.deepEqual(result.duplicateViews, []);
});

test("dashboard health previews prioritize blocking checks and retain critical ok evidence", () => {
  const previews = dashboardHealthCheckPreviews([
    {
      id: "database",
      label: "数据库",
      status: "ok",
      summary: "Prisma 查询正常"
    },
    {
      id: "adminCapabilities",
      label: "管理员入口覆盖",
      status: "ok",
      summary: "管理员入口覆盖 5/5 个核心管理范围"
    },
    {
      id: "billingSync",
      label: "用量同步",
      status: "warning",
      summary: "用量同步超过 60 分钟未成功",
      detail: { samples: [{ id: "sync-state", sampleType: "scheduler_state", repairAction: "enable_billing_sync" }] }
    },
    {
      id: "payments",
      label: "支付充值",
      status: "warning",
      summary: "生产环境仍启用 mock 充值",
      detail: {
        issues: [{
          id: "production_mock_recharge",
          walletTransactionList: true,
          walletTransactionType: "recharge",
          walletList: true,
          salesList: true
        }]
      }
    },
    {
      id: "customError",
      label: "自定义异常",
      status: "error",
      summary: "需要首页可见"
    },
    {
      id: "sub2",
      label: "Sub2/OpenAI 上游",
      status: "error",
      summary: "阻断：openai_group_has_no_active_accounts",
      detail: {
        issues: [{
          id: "account-2",
          repairAction: "apply_openai_refresh_token_to_sub2_account",
          actionHint: "Apply a fresh OpenAI refresh token, then rerun smoke.",
          sub2AccountId: 2,
          proxyRequestPath: "/v1/responses",
          proxyRequestStatusCode: 503,
          proxyRequestErrorCode: "upstream_http_503",
          model: "gpt-5.3-codex",
          responsesOk: false,
          localProxyOk: false,
          ageMinutes: 12,
          stale: true,
          staleThresholdMinutes: 1440,
          freshMinutesRemaining: 1428
        }, { id: "account-3" }]
      }
    }
  ]);

  assert.deepEqual(previews.map((item) => item.id), ["sub2", "customError", "payments", "billingSync", "adminCapabilities"]);
  assert.equal(previews[0].issueCount, 2);
  assert.equal(previews[0].primaryIssue?.repairAction, "apply_openai_refresh_token_to_sub2_account");
  assert.equal(previews[0].primaryIssue?.actionHint, "Apply a fresh OpenAI refresh token, then rerun smoke.");
  assert.equal(previews[0].primaryIssue?.sub2AccountId, 2);
  assert.equal(previews[0].primaryIssue?.proxyRequestPath, "/v1/responses");
  assert.equal(previews[0].primaryIssue?.proxyRequestStatusCode, 503);
  assert.equal(previews[0].primaryIssue?.proxyRequestErrorCode, "upstream_http_503");
  assert.equal(previews[0].primaryIssue?.model, "gpt-5.3-codex");
  assert.equal(previews[0].primaryIssue?.responsesOk, false);
  assert.equal(previews[0].primaryIssue?.ageMinutes, 12);
  assert.equal(previews[0].primaryIssue?.stale, true);
  assert.equal(previews[0].primaryIssue?.staleThresholdMinutes, 1440);
  assert.equal(previews[0].primaryIssue?.freshMinutesRemaining, 1428);
  assert.equal(previews[2].primaryIssue?.walletTransactionList, true);
  assert.equal(previews[2].primaryIssue?.walletTransactionType, "recharge");
  assert.equal(previews[2].primaryIssue?.salesList, true);
  assert.equal(previews[3].sampleCount, 1);
  assert.equal(previews[3].primarySample?.sampleType, "scheduler_state");
  assert.equal(previews[3].primarySample?.repairAction, "enable_billing_sync");
});

test("dashboard latest system health preview exposes snapshot freshness", () => {
  const snapshot = {
    id: "snapshot-1",
    status: "warning",
    source: "manual",
    summary: { totalChecks: 2, ok: 1, warning: 1, error: 0 },
    checks: [{
      id: "sub2",
      label: "Sub2/OpenAI 上游",
      status: "warning",
      summary: "需要更新 OpenAI refresh token",
      detail: { issues: [{ repairAction: "apply_openai_refresh_token_to_sub2_account", sub2AccountId: 2 }] }
    }],
    createdAt: new Date("2026-06-12T10:00:00.000Z")
  };

  const fresh = dashboardLatestSystemHealthPreview(snapshot, new Date("2026-06-12T10:59:59.000Z"));
  assert.equal(fresh.ageMinutes, 59);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.staleThresholdMinutes, 60);
  assert.equal(fresh.criticalChecks[0].id, "sub2");
  assert.equal(fresh.criticalChecks[0].primaryIssue?.sub2AccountId, 2);

  const stale = dashboardLatestSystemHealthPreview(snapshot, new Date("2026-06-12T11:00:00.000Z"));
  assert.equal(stale.ageMinutes, 60);
  assert.equal(stale.stale, true);
});

test("dashboard health previews retain product catalog drilldown fields", () => {
  const previews = dashboardHealthCheckPreviews([
    {
      id: "productCatalog",
      label: "商品目录",
      status: "warning",
      summary: "1 个商品目录可购买性问题",
      detail: {
        issues: [{
          id: "active_codex_product_without_ready_delivery_resource:prod-codex:product",
          type: "active_codex_product_without_ready_delivery_resource",
          severity: "warning",
          productId: "prod-codex",
          productName: "Codex Pro",
          priceId: "price-monthly",
          resourceType: "codex",
          resourceList: true,
          resourceScope: "production",
          repairAction: "apply_openai_refresh_token_to_sub2_account",
          message: "Active Codex product is purchasable but no ready production Codex shared resource is available."
        }]
      }
    }
  ]);

  assert.equal(previews.length, 1);
  assert.equal(previews[0].id, "productCatalog");
  assert.equal(previews[0].primaryIssue?.productId, "prod-codex");
  assert.equal(previews[0].primaryIssue?.productName, "Codex Pro");
  assert.equal(previews[0].primaryIssue?.priceId, "price-monthly");
  assert.equal(previews[0].primaryIssue?.resourceList, true);
  assert.equal(previews[0].primaryIssue?.resourceType, "codex");
  assert.equal(previews[0].primaryIssue?.resourceScope, "production");
  assert.equal(previews[0].primaryIssue?.repairAction, "apply_openai_refresh_token_to_sub2_account");
});

test("dashboard health previews keep product catalog warnings in the critical slice", () => {
  const checks: unknown[] = Array.from({ length: 8 }, (_, index) => ({
    id: `customWarning${index}`,
    label: `Custom warning ${index}`,
    status: "warning",
    summary: "Non-priority warning"
  }));

  checks.push({
    id: "productCatalog",
    label: "商品目录",
    status: "warning",
    summary: "1 个商品目录可购买性问题",
    detail: { issues: [{ productId: "prod-codex", productName: "Codex Pro" }] }
  });

  const previews = dashboardHealthCheckPreviews(checks);

  assert.equal(previews.length, 8);
  assert.equal(previews[0].id, "productCatalog");
  assert.ok(previews.some((item) => item.id === "productCatalog"));
});

test("sub2 repair context enrichment fills product catalog repair candidates", () => {
  const [check] = enrichSub2RepairContextChecks([
    {
      id: "productCatalog",
      label: "商品目录",
      status: "warning",
      summary: "1 个商品目录可购买性问题",
      detail: {
        issues: [{
          id: "product-risk",
          type: "active_codex_product_without_ready_delivery_resource",
          repairAction: "apply_openai_refresh_token_to_sub2_account",
          resourceType: "codex",
          resourceScope: "production",
          productId: "prod-codex"
        }]
      }
    }
  ], "admin@zhisuan.local", [{
    sub2AccountId: 2,
    sub2AccountName: "codex-primary",
    accountStatus: "error",
    credentialsStatus: "configured(3)",
    schedulable: false
  }]);

  const issue = (check.detail as { issues: Array<Record<string, unknown>> }).issues[0];
  assert.equal(issue.supplierEmail, "admin@zhisuan.local");
  assert.equal(issue.sub2AccountId, 2);
  assert.equal(issue.sub2AccountName, "codex-primary");
  assert.equal(issue.accountStatus, "error");
  assert.equal(issue.credentialsStatus, "configured(3)");
  assert.equal(issue.schedulable, false);
  assert.equal(issue.productId, "prod-codex");
});

test("sub2 repair context enrichment shares product context with resource repairs", () => {
  const checks = enrichSub2RepairContextChecks([
    {
      id: "productCatalog",
      label: "商品目录",
      status: "warning",
      summary: "1 个商品目录可购买性问题",
      detail: {
        issues: [{
          id: "product-risk",
          type: "active_codex_product_without_ready_delivery_resource",
          productId: "prod-codex",
          productName: "Codex Pro",
          priceId: "price-monthly",
          repairAction: "apply_openai_refresh_token_to_sub2_account",
          resourceType: "codex"
        }]
      }
    },
    {
      id: "resources",
      label: "共享资源",
      status: "warning",
      summary: "No online production Codex shared resource",
      detail: {
        issues: [{
          id: "resource:codex-online-missing",
          type: "codex_online_resource_missing",
          repairAction: "apply_openai_refresh_token_to_sub2_account",
          resourceType: "codex"
        }]
      }
    },
    {
      id: "resourceCredentials",
      label: "资源凭据",
      status: "error",
      summary: "No applicable credential",
      detail: {
        issues: [{
          id: "openai-refresh-token-candidate-missing",
          type: "openai_refresh_token_candidate_missing",
          repairAction: "apply_openai_refresh_token_to_sub2_account"
        }]
      }
    }
  ], "admin@zhisuan.local", [{
    sub2AccountId: 2,
    sub2AccountName: "codex-primary"
  }]);

  const resourceIssue = (checks[1].detail as { issues: Array<Record<string, unknown>> }).issues[0];
  assert.equal(resourceIssue.productId, "prod-codex");
  assert.equal(resourceIssue.productName, "Codex Pro");
  assert.equal(resourceIssue.priceId, "price-monthly");
  assert.equal(resourceIssue.supplierEmail, "admin@zhisuan.local");
  assert.equal(resourceIssue.sub2AccountId, 2);

  const credentialIssue = (checks[2].detail as { issues: Array<Record<string, unknown>> }).issues[0];
  assert.equal(credentialIssue.productId, "prod-codex");
  assert.equal(credentialIssue.productName, "Codex Pro");
  assert.equal(credentialIssue.priceId, "price-monthly");
  assert.equal(credentialIssue.resourceType, "codex");
  assert.equal(credentialIssue.sub2AccountId, 2);
});
