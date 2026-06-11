import assert from "node:assert/strict";
import test from "node:test";
import { isInternalHealthCheckUserEmail } from "../src/common/internal-records.js";

test("recognizes current and legacy internal health check users", () => {
  assert.equal(isInternalHealthCheckUserEmail("admin-openai-proxy-smoke@local.invalid"), true);
  assert.equal(isInternalHealthCheckUserEmail("codex_health_1780934029650@example.invalid"), true);
  assert.equal(isInternalHealthCheckUserEmail("codex_health_after_1780934029650@example.invalid"), true);
  assert.equal(isInternalHealthCheckUserEmail("codex_health_1780934029650@example.com"), false);
  assert.equal(isInternalHealthCheckUserEmail("buyer@example.invalid"), false);
});
