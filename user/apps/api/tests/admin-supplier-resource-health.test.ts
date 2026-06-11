import assert from "node:assert/strict";
import test from "node:test";
import {
  internalHealthCheckSupplierResourceWhere,
  isInternalHealthCheckSupplierResource,
  nonSmokeSupplierResourceWhere
} from "../src/modules/admin/supplier-resource-health.js";

test("identifies only explicit internal supplier resources", () => {
  assert.equal(isInternalHealthCheckSupplierResource({ sub2AccountId: "admin-disabled-smoke-resource" }), true);
  assert.equal(isInternalHealthCheckSupplierResource({ sub2AccountId: "2" }), false);
  assert.equal(isInternalHealthCheckSupplierResource({ sub2AccountId: null }), false);
});

test("builds a production supplier resource filter that excludes internal health checks", () => {
  assert.deepEqual(internalHealthCheckSupplierResourceWhere(), {
    sub2AccountId: "admin-disabled-smoke-resource"
  });
  assert.deepEqual(nonSmokeSupplierResourceWhere(), {
    NOT: { sub2AccountId: "admin-disabled-smoke-resource" }
  });
});

