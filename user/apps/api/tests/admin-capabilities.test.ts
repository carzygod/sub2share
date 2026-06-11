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
const { registerAdminRoutes } = await import("../src/modules/admin/routes.js");
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
