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
const { dashboardHealthCheckPreviews, dashboardLatestSystemHealthPreview, dashboardManagementStatusCounts, dashboardWalletManagementOverview, enrichSub2RepairContextChecks, registerAdminRoutes } = await import("../src/modules/admin/routes.js");
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

test("dashboard management overview normalizes core status and wallet risk counts", () => {
  const rows = dashboardManagementStatusCounts(["pending", "paid", "failed"], [
    { status: "failed", _count: { _all: 2 }, _sum: { totalAmount: "18.000000", paidAmount: "9.000000" } },
    { status: "paid", _count: { _all: 3 }, _sum: { totalAmount: 12, paidAmount: 12 } },
    { status: "custom", _count: { _all: 1 } }
  ]);

  assert.deepEqual(rows.map((row) => row.status), ["pending", "paid", "failed", "custom"]);
  assert.equal(rows.find((row) => row.status === "pending")?.count, 0);
  assert.equal(rows.find((row) => row.status === "paid")?.count, 3);
  assert.equal(rows.find((row) => row.status === "paid")?.paidAmount, 12);
  assert.equal(rows.find((row) => row.status === "failed")?.totalAmount, "18.000000");
  assert.equal(rows.find((row) => row.status === "custom")?.count, 1);

  assert.deepEqual(dashboardWalletManagementOverview({
    total: 5,
    negative: 1,
    frozen: 2,
    available: null,
    spent: undefined
  }), {
    total: 5,
    negative: 1,
    frozen: 2,
    available: 0,
    spent: 0
  });
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
      id: "openAiProxyContract",
      label: "OpenAI 反代契约",
      status: "ok",
      summary: "OpenAI/Codex 本地反代契约正常",
      metrics: {
        routesCorePathSamples: true,
        preservesRawPathAndQuery: true,
        normalizesSub2BaseTrailingSlash: true,
        forwardsUpstreamHeaders: true,
        corePathSamples: "/v1,/v1/responses,/v1/responses/resp_123/input_items?after=item_1,/v1/chat/completions",
        routesResponsesItems: true,
        requestIdHeader: "x-proxy-request-id",
        upstreamRequestIdHeaders: "x-request-id,openai-request-id,x-openai-request-id,request-id",
        rateLimitHeaders: "retry-after,retry-after-ms,x-ratelimit-limit-requests,x-ratelimit-limit-tokens,x-ratelimit-remaining-requests,x-ratelimit-remaining-tokens,x-ratelimit-reset-requests,x-ratelimit-reset-tokens",
        proxyRequestLookupHeaders: "x-proxy-request-id,x-request-id,openai-request-id,x-openai-request-id,request-id",
        corsExposesRequestId: true,
        corsExposesUpstreamRequestIds: true,
        corsExposesRateLimitHeaders: true,
        setsLocalRateLimitHeaders: true,
        normalizesProxyRequestLookupHeaders: true,
        requestBodyMode: "raw-buffer",
        bodyLimitBytes: 52_428_800,
        upstreamTimeoutMs: 300_000,
        streamIdleTimeoutMs: 300_000,
        extractsMultipartModelForLogs: true,
        extractsFormUrlEncodedModelForLogs: true,
        extractsUrlModelForLogs: true,
        forwardsRequestId: true,
        forwardsForwardedHostAndProto: true,
        abortsUpstreamOnClientClose: true,
        logsStreamCompletion: true,
        logsStreamErrors: true,
        hasStreamIdleTimeout: true,
        insufficientQuotaErrorType: "insufficient_quota",
        rateLimitErrorType: "rate_limit_error",
        apiErrorType: "api_error",
        localErrorPayloadIncludesParam: true,
        endpoint: "https://api.example.com/v1",
        ignoredNested: { ok: true }
      }
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
          sub2Status: true,
          sub2AccountId: 2,
          auditLogId: "audit-smoke-1",
          auditAction: "admin.sub2.proxy_smoke_test",
          keyDisabled: true,
          proxyRequestLogCount: 2,
          proxyRequestPath: "/v1/responses",
          proxyRequestStatusCode: 503,
          proxyRequestErrorCode: "upstream_http_503",
          model: "gpt-5.3-codex",
          responsesOk: false,
          localProxyOk: false,
          ageMinutes: 12,
          stale: true,
          staleThresholdMinutes: 1440,
          freshMinutesRemaining: 1428,
          staleAt: "2026-06-12T04:00:00.000Z"
        }, { id: "account-3" }]
      }
    }
  ]);

  assert.deepEqual(previews.map((item) => item.id), ["sub2", "customError", "payments", "billingSync", "openAiProxyContract", "adminCapabilities"]);
  assert.equal(previews[0].issueCount, 2);
  assert.equal(previews[0].primaryIssue?.repairAction, "apply_openai_refresh_token_to_sub2_account");
  assert.equal(previews[0].primaryIssue?.actionHint, "Apply a fresh OpenAI refresh token, then rerun smoke.");
  assert.equal(previews[0].primaryIssue?.sub2Status, true);
  assert.equal(previews[0].primaryIssue?.sub2AccountId, 2);
  assert.equal(previews[0].primaryIssue?.auditLogId, "audit-smoke-1");
  assert.equal(previews[0].primaryIssue?.auditAction, "admin.sub2.proxy_smoke_test");
  assert.equal(previews[0].primaryIssue?.keyDisabled, true);
  assert.equal(previews[0].primaryIssue?.proxyRequestLogCount, 2);
  assert.equal(previews[0].primaryIssue?.proxyRequestPath, "/v1/responses");
  assert.equal(previews[0].primaryIssue?.proxyRequestStatusCode, 503);
  assert.equal(previews[0].primaryIssue?.proxyRequestErrorCode, "upstream_http_503");
  assert.equal(previews[0].primaryIssue?.model, "gpt-5.3-codex");
  assert.equal(previews[0].primaryIssue?.responsesOk, false);
  assert.equal(previews[0].primaryIssue?.ageMinutes, 12);
  assert.equal(previews[0].primaryIssue?.stale, true);
  assert.equal(previews[0].primaryIssue?.staleThresholdMinutes, 1440);
  assert.equal(previews[0].primaryIssue?.freshMinutesRemaining, 1428);
  assert.equal(previews[0].primaryIssue?.staleAt, "2026-06-12T04:00:00.000Z");
  assert.equal(previews[2].primaryIssue?.walletTransactionList, true);
  assert.equal(previews[2].primaryIssue?.walletTransactionType, "recharge");
  assert.equal(previews[2].primaryIssue?.salesList, true);
  assert.equal(previews[3].sampleCount, 1);
  assert.equal(previews[3].primarySample?.sampleType, "scheduler_state");
  assert.equal(previews[3].primarySample?.repairAction, "enable_billing_sync");
  assert.equal(previews[4].metrics?.routesCorePathSamples, true);
  assert.equal(previews[4].metrics?.preservesRawPathAndQuery, true);
  assert.equal(previews[4].metrics?.normalizesSub2BaseTrailingSlash, true);
  assert.equal(previews[4].metrics?.forwardsUpstreamHeaders, true);
  assert.equal(previews[4].metrics?.routesResponsesItems, true);
  assert.equal(previews[4].metrics?.corePathSamples, "/v1,/v1/responses,/v1/responses/resp_123/input_items?after=item_1,/v1/chat/completions");
  assert.equal(previews[4].metrics?.requestIdHeader, "x-proxy-request-id");
  assert.equal(previews[4].metrics?.upstreamRequestIdHeaders, "x-request-id,openai-request-id,x-openai-request-id,request-id");
  assert.equal(previews[4].metrics?.rateLimitHeaders, "retry-after,retry-after-ms,x-ratelimit-limit-requests,x-ratelimit-limit-tokens,x-ratelimit-remaining-requests,x-ratelimit-remaining-tokens,x-ratelimit-reset-requests,x-ratelimit-reset-tokens");
  assert.equal(previews[4].metrics?.proxyRequestLookupHeaders, "x-proxy-request-id,x-request-id,openai-request-id,x-openai-request-id,request-id");
  assert.equal(previews[4].metrics?.corsExposesRequestId, true);
  assert.equal(previews[4].metrics?.corsExposesUpstreamRequestIds, true);
  assert.equal(previews[4].metrics?.corsExposesRateLimitHeaders, true);
  assert.equal(previews[4].metrics?.setsLocalRateLimitHeaders, true);
  assert.equal(previews[4].metrics?.normalizesProxyRequestLookupHeaders, true);
  assert.equal(previews[4].metrics?.requestBodyMode, "raw-buffer");
  assert.equal(previews[4].metrics?.bodyLimitBytes, 52_428_800);
  assert.equal(previews[4].metrics?.upstreamTimeoutMs, 300_000);
  assert.equal(previews[4].metrics?.streamIdleTimeoutMs, 300_000);
  assert.equal(previews[4].metrics?.extractsMultipartModelForLogs, true);
  assert.equal(previews[4].metrics?.extractsFormUrlEncodedModelForLogs, true);
  assert.equal(previews[4].metrics?.extractsUrlModelForLogs, true);
  assert.equal(previews[4].metrics?.forwardsRequestId, true);
  assert.equal(previews[4].metrics?.forwardsForwardedHostAndProto, true);
  assert.equal(previews[4].metrics?.abortsUpstreamOnClientClose, true);
  assert.equal(previews[4].metrics?.logsStreamCompletion, true);
  assert.equal(previews[4].metrics?.logsStreamErrors, true);
  assert.equal(previews[4].metrics?.hasStreamIdleTimeout, true);
  assert.equal(previews[4].metrics?.insufficientQuotaErrorType, "insufficient_quota");
  assert.equal(previews[4].metrics?.rateLimitErrorType, "rate_limit_error");
  assert.equal(previews[4].metrics?.apiErrorType, "api_error");
  assert.equal(previews[4].metrics?.localErrorPayloadIncludesParam, true);
  assert.equal(previews[4].metrics?.endpoint, "https://api.example.com/v1");
  assert.equal(Object.hasOwn(previews[4].metrics ?? {}, "ignoredNested"), false);
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

test("dashboard health previews retain OpenAI proxy runtime limiter metrics", () => {
  const previews = dashboardHealthCheckPreviews([{
    id: "openAiProxyRuntime",
    label: "OpenAI 反代运行态",
    status: "ok",
    summary: "Redis limiter is ready",
    metrics: {
      storeMode: "redis",
      limiterScope: "redis",
      shared: true,
      redisReachable: true,
      rateWindowMs: 60_000,
      rateWindowCleanupIntervalMs: 60_000,
      activeConcurrencyRentals: 1,
      activeConcurrencyLeases: 2,
      activeRateWindowRentals: 3,
      activeRateWindowRequests: 4,
      activeRateWindowTokenEvents: 5,
      activeRateWindowEstimatedTokens: 6,
      lastRateWindowCleanupAt: "2026-06-13T04:48:48.000Z",
      ignoredNested: { ok: true }
    }
  }]);

  assert.equal(previews[0].metrics?.storeMode, "redis");
  assert.equal(previews[0].metrics?.limiterScope, "redis");
  assert.equal(previews[0].metrics?.shared, true);
  assert.equal(previews[0].metrics?.redisReachable, true);
  assert.equal(previews[0].metrics?.rateWindowMs, 60_000);
  assert.equal(previews[0].metrics?.rateWindowCleanupIntervalMs, 60_000);
  assert.equal(previews[0].metrics?.activeConcurrencyRentals, 1);
  assert.equal(previews[0].metrics?.activeConcurrencyLeases, 2);
  assert.equal(previews[0].metrics?.activeRateWindowRentals, 3);
  assert.equal(previews[0].metrics?.activeRateWindowRequests, 4);
  assert.equal(previews[0].metrics?.activeRateWindowTokenEvents, 5);
  assert.equal(previews[0].metrics?.activeRateWindowEstimatedTokens, 6);
  assert.equal(previews[0].metrics?.lastRateWindowCleanupAt, "2026-06-13T04:48:48.000Z");
  assert.equal(Object.hasOwn(previews[0].metrics ?? {}, "ignoredNested"), false);
});

test("dashboard latest system health preview exposes actionable upstream blocker", () => {
  const snapshot = {
    id: "snapshot-upstream-blocker",
    status: "error",
    source: "manual",
    summary: { totalChecks: 3, ok: 1, warning: 0, error: 2 },
    checks: [
      {
        id: "sub2",
        label: "Sub2/OpenAI 上游",
        status: "error",
        summary: "阻断：openai_group_has_no_active_accounts",
        detail: { issues: [{ id: "openai-group-empty", type: "openai_group_has_no_active_accounts" }] }
      },
      {
        id: "resourceCredentials",
        label: "资源凭据",
        status: "error",
        summary: "Sub2 上游无 active 账号，且没有可应用的资源凭据",
        metrics: {
          encryptionSecretConfigured: true,
          encryptionVersion: "aes-256-gcm:v1",
          totalCredentials: 2,
          activeOpenAiRefreshTokens: 1,
          activeApplicableCredentials: 0,
          activeMissingSub2Account: 1,
          inactiveOpenAiRefreshTokens: 1
        },
        detail: {
          issues: [{
            id: "openai-refresh-token-candidate-missing",
            type: "openai_refresh_token_candidate_missing",
            repairAction: "apply_openai_refresh_token_to_sub2_account",
            actionHint: "Create or update a Codex shared resource with an active OpenAI refresh token and a Sub2 account id.",
            sub2AccountId: 2,
            sub2AccountName: "main",
            accountStatus: "error",
            credentialsStatus: "configured(3)",
            schedulable: false,
            tempUnschedulableReason: "",
            accountMessage: 'Authentication failed (401): {"error":{"message":"Your authentication token has been invalidated.","code":"token_invalidated"},"status":401}',
            updatedAt: "2026-06-12T22:53:59.925286+08:00",
            resourceList: true,
            resourceType: "codex",
            resourceScope: "production",
            proxyRequestPath: "/v1/responses",
            proxyRequestStatusCode: 503,
            proxyRequestErrorCode: "upstream_http_503",
            model: "gpt-5.3-codex",
            responsesOk: false,
            localProxyOk: false,
            ageMinutes: 1_448,
            stale: true,
            staleThresholdMinutes: 1_440,
            freshMinutesRemaining: 0,
            staleAt: "2026-06-12T20:13:33.340Z"
          }]
        }
      },
      {
        id: "openAiProxyContract",
        label: "OpenAI 反代契约",
        status: "ok",
        summary: "OpenAI/Codex 本地反代契约正常"
      }
    ],
    createdAt: new Date("2026-06-12T10:00:00.000Z")
  };

  const preview = dashboardLatestSystemHealthPreview(snapshot, new Date("2026-06-12T10:01:00.000Z"));

  assert.equal(preview.upstreamBlocker?.blocked, true);
  assert.equal(preview.upstreamBlocker?.status, "error");
  assert.equal(preview.upstreamBlocker?.checkId, "resourceCredentials");
  assert.equal(preview.upstreamBlocker?.label, "资源凭据");
  assert.equal(preview.upstreamBlocker?.repairAction, "apply_openai_refresh_token_to_sub2_account");
  assert.equal(preview.upstreamBlocker?.sub2AccountId, 2);
  assert.equal(preview.upstreamBlocker?.sub2AccountName, "main");
  assert.equal(preview.upstreamBlocker?.accountStatus, "error");
  assert.equal(preview.upstreamBlocker?.credentialsStatus, "configured(3)");
  assert.equal(preview.upstreamBlocker?.schedulable, false);
  assert.equal(preview.upstreamBlocker?.tempUnschedulableReason, null);
  assert.equal(preview.upstreamBlocker?.accountMessage, 'Authentication failed (401): {"error":{"message":"Your authentication token has been invalidated.","code":"token_invalidated"},"status":401}');
  assert.equal(preview.upstreamBlocker?.accountUpdatedAt, "2026-06-12T22:53:59.925286+08:00");
  assert.equal(preview.upstreamBlocker?.resourceList, true);
  assert.equal(preview.upstreamBlocker?.resourceType, "codex");
  assert.equal(preview.upstreamBlocker?.resourceScope, "production");
  assert.equal(preview.upstreamBlocker?.evidencePath, "/v1/responses");
  assert.equal(preview.upstreamBlocker?.evidenceStatusCode, 503);
  assert.equal(preview.upstreamBlocker?.evidenceErrorCode, "upstream_http_503");
  assert.equal(preview.upstreamBlocker?.evidenceModel, "gpt-5.3-codex");
  assert.equal(preview.upstreamBlocker?.evidenceResponsesOk, false);
  assert.equal(preview.upstreamBlocker?.evidenceLocalProxyOk, false);
  assert.equal(preview.upstreamBlocker?.evidenceAgeMinutes, 1_448);
  assert.equal(preview.upstreamBlocker?.evidenceStale, true);
  assert.equal(preview.upstreamBlocker?.evidenceStaleThresholdMinutes, 1_440);
  assert.equal(preview.upstreamBlocker?.evidenceFreshMinutesRemaining, 0);
  assert.equal(preview.upstreamBlocker?.evidenceStaleAt, "2026-06-12T20:13:33.340Z");
  assert.equal(preview.upstreamBlocker?.credentialReadiness?.status, "error");
  assert.equal(preview.upstreamBlocker?.credentialReadiness?.summary, "Sub2 上游无 active 账号，且没有可应用的资源凭据");
  assert.equal(preview.upstreamBlocker?.credentialReadiness?.metrics?.encryptionSecretConfigured, true);
  assert.equal(preview.upstreamBlocker?.credentialReadiness?.metrics?.activeOpenAiRefreshTokens, 1);
  assert.equal(preview.upstreamBlocker?.credentialReadiness?.metrics?.activeApplicableCredentials, 0);
  assert.equal(preview.upstreamBlocker?.credentialReadiness?.metrics?.activeMissingSub2Account, 1);
  assert.equal(preview.upstreamBlocker?.credentialReadiness?.metrics?.inactiveOpenAiRefreshTokens, 1);
  assert.equal(preview.upstreamBlocker?.check.primaryIssue?.actionHint, "Create or update a Codex shared resource with an active OpenAI refresh token and a Sub2 account id.");
});

test("dashboard latest system health preview exposes actionable delivery blocker", () => {
  const snapshot = {
    id: "snapshot-delivery-blocker",
    status: "warning",
    source: "manual",
    summary: { totalChecks: 3, ok: 1, warning: 2, error: 0 },
    checks: [
      {
        id: "resources",
        label: "共享资源",
        status: "warning",
        summary: "No online production Codex shared resource",
        detail: {
          issues: [{
            id: "resource:codex-online-missing",
            type: "codex_online_resource_missing",
            resourceList: true,
            resourceType: "codex",
            resourceScope: "production",
            supplierEmail: "admin@zhisuan.local",
            repairAction: "apply_openai_refresh_token_to_sub2_account"
          }]
        }
      },
      {
        id: "productCatalog",
        label: "商品目录",
        status: "warning",
        summary: "1 个商品目录可购买性问题",
        detail: {
          issues: [{
            id: "active_codex_product_without_ready_delivery_resource:product-1:price-1",
            type: "active_codex_product_without_ready_delivery_resource",
            productId: "product-1",
            productName: "Codex 标准租赁",
            priceId: "price-1",
            resourceList: true,
            resourceType: "codex",
            resourceStatus: "online",
            resourceScope: "production",
            supplierEmail: "admin@zhisuan.local",
            sub2AccountId: 2,
            sub2AccountName: "main",
            accountStatus: "error",
            credentialsStatus: "configured(3)",
            schedulable: false,
            accountMessage: "token_invalidated",
            repairAction: "apply_openai_refresh_token_to_sub2_account",
            actionHint: "Create or repair a production Codex shared resource before selling Codex access."
          }]
        }
      },
      {
        id: "salesDelivery",
        label: "售出交付",
        status: "ok",
        summary: "应交付订单未发现交付阻断"
      }
    ],
    createdAt: new Date("2026-06-12T10:00:00.000Z")
  };

  const preview = dashboardLatestSystemHealthPreview(snapshot, new Date("2026-06-12T10:01:00.000Z"));

  assert.equal(preview.deliveryBlocker?.blocked, true);
  assert.equal(preview.deliveryBlocker?.status, "warning");
  assert.equal(preview.deliveryBlocker?.checkId, "productCatalog");
  assert.equal(preview.deliveryBlocker?.label, "商品目录");
  assert.equal(preview.deliveryBlocker?.repairAction, "apply_openai_refresh_token_to_sub2_account");
  assert.equal(preview.deliveryBlocker?.productId, "product-1");
  assert.equal(preview.deliveryBlocker?.productName, "Codex 标准租赁");
  assert.equal(preview.deliveryBlocker?.priceId, "price-1");
  assert.equal(preview.deliveryBlocker?.resourceList, true);
  assert.equal(preview.deliveryBlocker?.resourceType, "codex");
  assert.equal(preview.deliveryBlocker?.resourceStatus, "online");
  assert.equal(preview.deliveryBlocker?.resourceScope, "production");
  assert.equal(preview.deliveryBlocker?.supplierEmail, "admin@zhisuan.local");
  assert.equal(preview.deliveryBlocker?.sub2AccountId, 2);
  assert.equal(preview.deliveryBlocker?.sub2AccountName, "main");
  assert.equal(preview.deliveryBlocker?.accountStatus, "error");
  assert.equal(preview.deliveryBlocker?.credentialsStatus, "configured(3)");
  assert.equal(preview.deliveryBlocker?.schedulable, false);
  assert.equal(preview.deliveryBlocker?.accountMessage, "token_invalidated");
  assert.equal(preview.deliveryBlocker?.check.primaryIssue?.productName, "Codex 标准租赁");
});

test("dashboard latest system health preview always exposes admin entry coverage", () => {
  const snapshot = {
    id: "snapshot-admin-entry",
    status: "warning",
    source: "manual",
    summary: { totalChecks: 10, ok: 4, warning: 6, error: 0 },
    checks: [
      { id: "sub2", label: "Sub2/OpenAI 上游", status: "warning", summary: "需要复查" },
      { id: "localProxySmoke", label: "本地反代 smoke", status: "warning", summary: "需要复查" },
      { id: "resourceCredentials", label: "资源凭据", status: "warning", summary: "需要复查" },
      { id: "resources", label: "共享资源", status: "warning", summary: "需要复查" },
      { id: "productCatalog", label: "商品目录", status: "warning", summary: "需要复查" },
      { id: "payments", label: "支付充值", status: "warning", summary: "需要复查" },
      { id: "openAiProxyContract", label: "OpenAI 反代契约", status: "ok", summary: "契约正常" },
      { id: "openAiProxyRuntime", label: "OpenAI 反代运行态", status: "ok", summary: "运行态正常" },
      {
        id: "adminCapabilities",
        label: "管理员入口覆盖",
        status: "ok",
        summary: "管理员入口覆盖 5/5 个核心管理范围",
        metrics: {
          requiredAreas: 5,
          coveredRequiredAreas: 5,
          totalOperations: 65,
          registeredOperations: 65,
          operationsWithTargets: 65,
          missingRoutes: 0,
          missingTargets: 0
        }
      },
      {
        id: "adminSurfaceCoverage",
        label: "管理前端入口",
        status: "ok",
        summary: "管理前端入口覆盖 5/5 个核心管理范围",
        metrics: {
          requiredAreas: 5,
          coveredRequiredAreas: 5,
          navigationItems: 18,
          managedListViews: 18,
          criticalViews: 5,
          duplicateViews: 0
        }
      }
    ],
    createdAt: new Date("2026-06-12T10:00:00.000Z")
  };

  const preview = dashboardLatestSystemHealthPreview(snapshot, new Date("2026-06-12T10:01:00.000Z"));

  assert.equal(preview.criticalChecks.length, 8);
  assert.equal(preview.criticalChecks.some((check) => check.id === "adminCapabilities"), false);
  assert.equal(preview.criticalChecks.some((check) => check.id === "adminSurfaceCoverage"), false);
  assert.equal(preview.adminEntryCoverage?.ok, true);
  assert.equal(preview.adminEntryCoverage?.summary, "API 5/5 核心范围，65/65 路由，65/65 入口 / 前端 5/5 核心范围，18 个列表入口，5 个关键入口");
  assert.equal(preview.adminEntryCoverage?.api?.metrics.missingRoutes, 0);
  assert.equal(preview.adminEntryCoverage?.api?.metrics.missingTargets, 0);
  assert.equal(preview.adminEntryCoverage?.frontend?.metrics.managedListViews, 18);
  assert.equal(preview.adminEntryCoverage?.frontend?.metrics.criticalViews, 5);
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

test("sub2 repair context enrichment shares local smoke evidence with repair issues", () => {
  const checks = enrichSub2RepairContextChecks([
    {
      id: "resources",
      label: "鍏变韩璧勬簮",
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
      label: "璧勬簮鍑嵁",
      status: "error",
      summary: "No applicable credential",
      detail: {
        issues: [{
          id: "openai-refresh-token-candidate-missing",
          type: "openai_refresh_token_candidate_missing",
          repairAction: "apply_openai_refresh_token_to_sub2_account"
        }]
      }
    },
    {
      id: "sub2",
      label: "Sub2/OpenAI 涓婃父",
      status: "error",
      summary: "No active accounts",
      detail: {
        issues: [{
          id: "sub2_upstream:openai_group_has_no_active_accounts",
          type: "openai_group_has_no_active_accounts",
          repairAction: "apply_openai_refresh_token_to_sub2_account",
          actionHint: "Apply a valid token."
        }],
        samples: [{
          id: "sub2_account:2",
          sub2AccountId: 2,
          sub2AccountName: "revoked",
          accountStatus: "error",
          credentialsStatus: "configured(3)",
          schedulable: false
        }]
      }
    },
    {
      id: "localProxySmoke",
      label: "鏈湴鍙嶄唬鑷",
      status: "error",
      summary: "Latest local OpenAI/Codex smoke test failed at /v1/responses.",
      detail: {
        issues: [{
          id: "local_proxy_smoke:failed",
          type: "local_proxy_smoke_failed",
          sub2Status: true,
          repairAction: "apply_openai_refresh_token_to_sub2_account",
          auditLogId: "audit-smoke-1",
          auditAction: "admin.sub2.proxy_smoke_test",
          model: "gpt-5.3-codex",
          modelsOk: true,
          responsesOk: false,
          localProxyOk: false,
          smokeTestSkippedReason: null,
          keyDisabled: true,
          proxyRequestLogCount: 2,
          proxyRequestLogId: "proxy-log-1",
          requestId: "req-local",
          upstreamRequestId: "req-upstream",
          proxyRequestPath: "/v1/responses",
          proxyRequestStatusCode: 503,
          proxyRequestErrorCode: "upstream_http_503",
          ageMinutes: 1366,
          stale: false,
          staleThresholdMinutes: 1440,
          freshMinutesRemaining: 74,
          staleAt: "2026-06-12T20:13:33.340Z"
        }]
      }
    }
  ], null, []);

  const resourceIssue = (checks[0].detail as { issues: Array<Record<string, unknown>> }).issues[0];
  const credentialIssue = (checks[1].detail as { issues: Array<Record<string, unknown>> }).issues[0];
  const sub2Issue = (checks[2].detail as { issues: Array<Record<string, unknown>> }).issues[0];
  const sub2Sample = (checks[2].detail as { samples: Array<Record<string, unknown>> }).samples[0];

  for (const issue of [resourceIssue, credentialIssue, sub2Issue, sub2Sample]) {
    assert.equal(issue.auditLogId, "audit-smoke-1");
    assert.equal(issue.auditAction, "admin.sub2.proxy_smoke_test");
    assert.equal(issue.repairAction, "apply_openai_refresh_token_to_sub2_account");
    assert.equal(issue.resourceType, "codex");
    assert.equal(issue.model, "gpt-5.3-codex");
    assert.equal(issue.responsesOk, false);
    assert.equal(issue.localProxyOk, false);
    assert.equal(issue.keyDisabled, true);
    assert.equal(issue.proxyRequestLogCount, 2);
    assert.equal(issue.proxyRequestPath, "/v1/responses");
    assert.equal(issue.proxyRequestStatusCode, 503);
    assert.equal(issue.proxyRequestErrorCode, "upstream_http_503");
    assert.equal(issue.requestId, "req-local");
    assert.equal(issue.proxyRequestLogId, "proxy-log-1");
    assert.equal(issue.upstreamRequestId, "req-upstream");
    assert.equal(issue.ageMinutes, 1366);
    assert.equal(issue.staleThresholdMinutes, 1440);
    assert.equal(issue.freshMinutesRemaining, 74);
    assert.equal(issue.staleAt, "2026-06-12T20:13:33.340Z");
  }
  assert.equal(sub2Issue.actionHint, "Apply a valid token.");
  assert.equal(sub2Sample.sub2Status, true);
  assert.equal(sub2Sample.sub2AccountName, "revoked");
  assert.equal(sub2Sample.accountStatus, "error");
});
