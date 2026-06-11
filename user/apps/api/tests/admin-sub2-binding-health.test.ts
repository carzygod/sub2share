import assert from "node:assert/strict";
import test from "node:test";
import {
  isLocalProxySmokeSub2Binding,
  nonSmokeSub2Bindings
} from "../src/modules/admin/sub2-binding-health.js";

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
