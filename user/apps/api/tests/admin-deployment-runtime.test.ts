import assert from "node:assert/strict";
import test from "node:test";
import { inspectDeploymentRuntime } from "../src/modules/admin/deployment-runtime.js";

test("deployment runtime accepts the current release root", () => {
  const result = inspectDeploymentRuntime({
    nodeEnv: "production",
    cwd: "/opt/zhisuan-yizhan/user/apps/api",
    markerText: "commit=37d8e75\ndeployed_at=20260611T104737Z\n"
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "ok");
  assert.equal(result.summary.releaseRoot, "/opt/zhisuan-yizhan/user");
  assert.equal(result.summary.commit, "37d8e75");
  assert.equal(result.summary.deployedAt, "20260611T104737Z");
  assert.equal(result.summary.runningFromReplacedRelease, false);
  assert.equal(result.summary.runningFromStagingRelease, false);
  assert.deepEqual(result.issues, []);
});

test("deployment runtime flags processes still serving from replaced releases", () => {
  const result = inspectDeploymentRuntime({
    nodeEnv: "production",
    cwd: "/opt/zhisuan-yizhan/user-replaced-20260611T104737Z-37d8e75/apps/api",
    markerText: "commit=408ba09\ndeployed_at=20260611T103600Z\n"
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "error");
  assert.equal(result.summary.runningFromReplacedRelease, true);
  assert.equal(result.issues.some((issue) => issue.type === "running_from_replaced_release"), true);
});

test("deployment runtime flags staging release directories", () => {
  const result = inspectDeploymentRuntime({
    nodeEnv: "production",
    cwd: "/opt/zhisuan-yizhan/user.new-20260611T104737Z-37d8e75/apps/api",
    markerText: "commit=37d8e75\ndeployed_at=20260611T104737Z\n"
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "error");
  assert.equal(result.summary.runningFromStagingRelease, true);
  assert.equal(result.issues.some((issue) => issue.type === "running_from_staging_release"), true);
});

test("deployment runtime warns when production marker is missing", () => {
  const result = inspectDeploymentRuntime({
    nodeEnv: "production",
    cwd: "/opt/zhisuan-yizhan/user/apps/api",
    markerText: null
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "warning");
  assert.equal(result.summary.markerPresent, false);
  assert.equal(result.issues.some((issue) => issue.type === "release_marker_missing"), true);
});
