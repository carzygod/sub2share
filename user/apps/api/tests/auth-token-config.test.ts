import assert from "node:assert/strict";
import test from "node:test";
import { inspectAuthTokenConfig } from "../src/modules/auth/token-config.js";

test("flags production refresh tokens that reuse the access secret", () => {
  const result = inspectAuthTokenConfig({
    nodeEnv: "production",
    accessSecret: "access-secret",
    accessExpiresIn: "15m",
    refreshExpiresIn: "30d"
  });

  assert.equal(result.ok, false);
  assert.equal(result.summary.refreshSecretConfigured, false);
  assert.equal(result.summary.refreshSecretDistinct, false);
  assert.equal(result.issues.some((issue) => issue.type === "jwt_refresh_secret_missing" && issue.severity === "error"), true);
});

test("accepts distinct access and refresh token settings", () => {
  const result = inspectAuthTokenConfig({
    nodeEnv: "production",
    accessSecret: "access-secret",
    refreshSecret: "refresh-secret",
    accessExpiresIn: "15m",
    refreshExpiresIn: "30d"
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.refreshSecretConfigured, true);
  assert.equal(result.summary.refreshSecretDistinct, true);
  assert.deepEqual(result.issues, []);
});
