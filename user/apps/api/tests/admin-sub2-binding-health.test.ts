import assert from "node:assert/strict";
import test from "node:test";
import {
  isLocalProxySmokeSub2Binding,
  nonSmokeSub2Bindings
} from "../src/modules/admin/sub2-binding-health.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/sub2share_test";
process.env.JWT_ACCESS_SECRET ??= "test-secret-at-least-sixteen-characters";
process.env.SUB2_BASE_URL ??= "http://localhost:3001";
process.env.SUB2_PUBLIC_ENDPOINT ??= "http://localhost:3001";
process.env.SUB2_ADMIN_TOKEN ??= "test-sub2-admin-token";

const { sub2BindingHealthCheck } = await import("../src/modules/admin/routes.js");

test("identifies only explicit local proxy smoke Sub2 bindings", () => {
  assert.equal(isLocalProxySmokeSub2Binding({ meta: { smokeTest: true } }), true);
  assert.equal(isLocalProxySmokeSub2Binding({ meta: { smokeTest: false } }), false);
  assert.equal(isLocalProxySmokeSub2Binding({ meta: { repairedAt: "2026-06-11T08:00:00.000Z" } }), false);
  assert.equal(isLocalProxySmokeSub2Binding({ meta: null }), false);
  assert.equal(isLocalProxySmokeSub2Binding({ meta: [] }), false);
});

test("keeps repaired production bindings when filtering smoke rows", () => {
  const bindings = [
    { id: "smoke", meta: { smokeTest: true } },
    { id: "repaired", meta: { repairedAt: "2026-06-11T08:00:00.000Z" } },
    { id: "normal", meta: {} },
    { id: "no-meta", meta: null }
  ];

  assert.deepEqual(nonSmokeSub2Bindings(bindings).map((binding) => binding.id), [
    "repaired",
    "normal",
    "no-meta"
  ]);
});

test("Sub2 binding health check exposes issue samples for admin drilldown", () => {
  const issue = {
    id: "missing_current_api_key_binding:rental_1:api_key:none",
    type: "missing_current_api_key_binding",
    severity: "error",
    rentalId: "rental_1",
    sub2Type: "api_key",
    expected: "key_1",
    message: "Rental rental_1 has sub2KeyId but no current api_key binding."
  };
  const check = sub2BindingHealthCheck({
    ok: false,
    summary: {
      rentalsScanned: 1,
      bindingsScanned: 0,
      totalIssues: 1,
      missingCurrentUserBindings: 0,
      missingUserBindings: 0,
      missingCurrentApiKeyBindings: 1,
      duplicateCurrentApiKeyReferences: 0,
      mismatchedCurrentBindings: 0,
      orphanBindings: 0
    },
    issues: [issue]
  });

  assert.equal(check.id, "sub2Bindings");
  assert.equal(check.status, "warning");
  assert.equal(check.summary, "1 个 Sub2 绑定问题");
  assert.deepEqual((check.detail as { issues?: unknown[] }).issues, [issue]);
});
