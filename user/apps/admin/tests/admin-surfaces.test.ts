import assert from "node:assert/strict";
import test from "node:test";
import {
  adminNavigationItems,
  adminSystemHealthIssueRefFields,
  adminSystemHealthSampleSummaryFields,
  inspectAdminSurfaceCoverage,
  managedListViews,
  requiredAdminSurfaceAreas
} from "@zyz/shared";
import {
  resourceCreateDefaultsContextItems,
  resourceCreateDefaultsShouldApplyCredential,
  resourceCreateDefaultsShouldRunSmokeTest,
  resourceCreateDefaultsSmokeModel,
  sub2RepairContextItems,
  sub2RepairContextShouldRunSmokeTest,
  sub2RepairContextSmokeModel
} from "../src/app/sub2-repair-context";

test("admin navigation covers the required management areas", () => {
  const coverage = inspectAdminSurfaceCoverage();

  assert.equal(coverage.ok, true);
  assert.deepEqual([...requiredAdminSurfaceAreas].sort(), ["openaiProxy", "sales", "sharing", "users", "wallets"]);
  assert.equal(coverage.summary.coveredRequiredAreas, requiredAdminSurfaceAreas.length);
  assert.deepEqual(coverage.missingRequiredAreas, []);
});

test("admin navigation exposes the objective-critical entry points", () => {
  const views = new Set(adminNavigationItems.map((item) => item.view));

  for (const view of ["users", "resources", "wallets", "sales", "sub2", "proxyRequests", "capabilities"] as const) {
    assert.ok(views.has(view), `missing admin entry point: ${view}`);
  }

  assert.ok(adminNavigationItems.find((item) => item.view === "users")?.critical);
  assert.ok(adminNavigationItems.find((item) => item.view === "resources")?.critical);
  assert.ok(adminNavigationItems.find((item) => item.view === "wallets")?.critical);
  assert.ok(adminNavigationItems.find((item) => item.view === "sales")?.critical);
  assert.ok(adminNavigationItems.find((item) => item.view === "sub2")?.critical);
});

test("all managed list views are reachable from the sidebar navigation", () => {
  const views = new Set(adminNavigationItems.map((item) => item.view));

  for (const view of managedListViews) {
    assert.ok(views.has(view), `managed list is not reachable from navigation: ${view}`);
  }

  assert.deepEqual(inspectAdminSurfaceCoverage().missingManagedListViews, []);
  assert.deepEqual(inspectAdminSurfaceCoverage().duplicateViews, []);
});

test("system health summaries expose repair actions for operator drilldown", () => {
  assert.ok(adminSystemHealthIssueRefFields.includes("repairAction"));
  assert.ok(adminSystemHealthIssueRefFields.includes("sub2AccountId"));
  assert.ok(adminSystemHealthIssueRefFields.includes("resourceScope"));
  assert.ok(adminSystemHealthIssueRefFields.includes("stale"));
  assert.ok(adminSystemHealthSampleSummaryFields.includes("repairAction"));
  assert.ok(adminSystemHealthSampleSummaryFields.includes("sampleType"));
  assert.ok(adminSystemHealthSampleSummaryFields.includes("proxyRequestLogId"));
  assert.ok(adminSystemHealthSampleSummaryFields.includes("orderId"));
  assert.ok(adminSystemHealthSampleSummaryFields.includes("rentalId"));
  assert.ok(adminSystemHealthSampleSummaryFields.includes("apiKeyId"));
  assert.ok(adminSystemHealthSampleSummaryFields.includes("usageId"));
  assert.ok(adminSystemHealthSampleSummaryFields.includes("walletTransactionId"));
});

test("sub2 repair context summarizes operator drilldown targets", () => {
  const items = sub2RepairContextItems({
    checkId: "localProxySmoke",
    checkLabel: "本地 OpenAI/Codex 反代 smoke",
    repairAction: "apply_openai_refresh_token_to_sub2_account",
    actionHint: "Apply a fresh OpenAI refresh token, then rerun smoke.",
    accountId: "2",
    sub2AccountName: "codex-primary",
    accountStatus: "inactive",
    credentialsStatus: "expired",
    resourceId: "resource-1",
    resourceType: "codex",
    resourceStatus: "online",
    resourceScope: "production",
    supplierEmail: "admin@zhisuan.local",
    requestId: "req-local",
    proxyRequestLogId: "log-1",
    upstreamRequestId: "req-upstream",
    proxyRequestPath: "/v1/responses",
    proxyRequestStatusCode: "503",
    proxyRequestErrorCode: "upstream_http_503",
    model: "gpt-5.3-codex",
    modelsOk: "true",
    responsesOk: "false",
    localProxyOk: "false",
    ageMinutes: "12",
    stale: "true"
  });

  assert.deepEqual(items.map((item) => item.label), ["来源", "维修动作", "维修建议", "目标账号", "账号状态", "资源", "供给方", "请求定位", "Smoke", "失败请求"]);
  assert.equal(items.find((item) => item.label === "来源")?.value, "本地 OpenAI/Codex 反代 smoke / localProxySmoke");
  assert.equal(items.find((item) => item.label === "维修建议")?.value, "Apply a fresh OpenAI refresh token, then rerun smoke.");
  assert.equal(items.find((item) => item.label === "目标账号")?.value, "#2 / codex-primary");
  assert.equal(items.find((item) => item.label === "账号状态")?.value, "inactive / expired");
  assert.equal(items.find((item) => item.label === "资源")?.value, "resource-1 / codex / online / production");
  assert.equal(items.find((item) => item.label === "请求定位")?.value, "req-local / log-1 / req-upstream");
  assert.equal(items.find((item) => item.label === "Smoke")?.value, "model gpt-5.3-codex / models 通过 / responses 失败 / local 失败");
  assert.equal(items.find((item) => item.label === "失败请求")?.value, "/v1/responses / HTTP 503 / upstream_http_503 / 12 分钟前 / 证据已过期");
  assert.ok(items.every((item) => item.value.trim().length > 0));
});

test("sub2 repair context prefills smoke verification after failed proxy evidence", () => {
  const failedSmokeContext = {
    checkId: "localProxySmoke",
    model: "gpt-5.3-codex",
    responsesOk: "false",
    proxyRequestPath: "/v1/responses"
  };

  assert.equal(sub2RepairContextShouldRunSmokeTest(failedSmokeContext), true);
  assert.equal(sub2RepairContextSmokeModel(failedSmokeContext), "gpt-5.3-codex");
  assert.equal(sub2RepairContextShouldRunSmokeTest({ checkId: "sub2", accountId: "2" }), false);
  assert.equal(sub2RepairContextSmokeModel({ model: "  " }), "");
});

test("resource create defaults continue the OpenAI credential repair flow", () => {
  const repairDefaults = {
    checkId: "resources",
    resourceType: "codex",
    resourceScope: "production",
    sub2AccountId: "2",
    repairAction: "apply_openai_refresh_token_to_sub2_account",
    model: " gpt-5.3-codex "
  };

  assert.equal(resourceCreateDefaultsShouldApplyCredential(repairDefaults), true);
  assert.equal(resourceCreateDefaultsShouldRunSmokeTest(repairDefaults), true);
  assert.equal(resourceCreateDefaultsSmokeModel(repairDefaults), "gpt-5.3-codex");
  assert.equal(resourceCreateDefaultsShouldApplyCredential({
    checkId: "productCatalog",
    resourceType: "codex",
    resourceScope: "production",
    sub2AccountId: "2",
    repairAction: "apply_openai_refresh_token_to_sub2_account"
  }), true);
  assert.equal(resourceCreateDefaultsShouldRunSmokeTest({
    checkId: "productCatalog",
    resourceType: "codex",
    resourceScope: "production",
    sub2AccountId: "2",
    repairAction: "apply_openai_refresh_token_to_sub2_account"
  }), true);
  assert.equal(resourceCreateDefaultsShouldApplyCredential({ resourceType: "codex", sub2AccountId: "2" }), false);
  assert.equal(resourceCreateDefaultsShouldRunSmokeTest({ ...repairDefaults, sub2AccountId: "" }), false);
});

test("resource create defaults expose repair context for operators", () => {
  const items = resourceCreateDefaultsContextItems({
    checkId: "resources",
    supplierEmail: "admin@zhisuan.local",
    resourceType: "codex",
    resourceScope: "production",
    sub2AccountId: "2",
    repairAction: "apply_openai_refresh_token_to_sub2_account",
    model: "gpt-5.3-codex",
    responsesOk: "false",
    localProxyOk: "false",
    proxyRequestPath: "/v1/responses",
    proxyRequestStatusCode: "503",
    proxyRequestErrorCode: "upstream_http_503"
  });

  assert.deepEqual(items.map((item) => item.label), [
    "Source",
    "Repair action",
    "Supplier",
    "Resource",
    "Sub2 account",
    "Credential apply",
    "Smoke",
    "Failure"
  ]);
  assert.equal(items.find((item) => item.label === "Source")?.value, "resources / production");
  assert.equal(items.find((item) => item.label === "Supplier")?.value, "admin@zhisuan.local");
  assert.equal(items.find((item) => item.label === "Resource")?.value, "codex / production");
  assert.equal(items.find((item) => item.label === "Sub2 account")?.value, "#2");
  assert.equal(items.find((item) => item.label === "Credential apply")?.value, "enabled after create");
  assert.match(items.find((item) => item.label === "Smoke")?.value ?? "", /model gpt-5.3-codex/);
  assert.equal(items.find((item) => item.label === "Failure")?.value, "/v1/responses / HTTP 503 / upstream_http_503");
});
