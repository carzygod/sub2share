import assert from "node:assert/strict";
import test from "node:test";
import {
  adminNavigationItems,
  inspectAdminSurfaceCoverage,
  managedListViews,
  requiredAdminSurfaceAreas
} from "@zyz/shared";

test("admin navigation covers the required management areas", () => {
  const coverage = inspectAdminSurfaceCoverage();

  assert.equal(coverage.ok, true);
  assert.deepEqual([...requiredAdminSurfaceAreas].sort(), ["openaiProxy", "sales", "sharing", "users", "wallets"]);
  assert.equal(coverage.summary.coveredRequiredAreas, requiredAdminSurfaceAreas.length);
  assert.deepEqual(coverage.missingRequiredAreas, []);
});

test("admin navigation exposes the objective-critical entry points", () => {
  const views = new Set(adminNavigationItems.map((item) => item.view));

  for (const view of ["users", "resources", "wallets", "sales", "sub2", "proxyRequests"] as const) {
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
