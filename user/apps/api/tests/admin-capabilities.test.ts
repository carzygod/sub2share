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
const { dashboardHealthCheckPreviews, registerAdminRoutes } = await import("../src/modules/admin/routes.js");
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

test("admin capability coverage reports missing declared routes", () => {
  const result = inspectAdminCapabilityRouteCoverage((operation) => operation.id !== "sales.list");

  assert.equal(result.ok, false);
  assert.equal(result.summary.missingRoutes, 1);
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
          ageMinutes: 12
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
  assert.equal(previews[2].primaryIssue?.walletTransactionList, true);
  assert.equal(previews[2].primaryIssue?.walletTransactionType, "recharge");
  assert.equal(previews[2].primaryIssue?.salesList, true);
  assert.equal(previews[3].sampleCount, 1);
  assert.equal(previews[3].primarySample?.sampleType, "scheduler_state");
  assert.equal(previews[3].primarySample?.repairAction, "enable_billing_sync");
});
