import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/sub2share_test";
process.env.JWT_ACCESS_SECRET ??= "test-secret-at-least-sixteen-characters";
process.env.SUB2_BASE_URL ??= "http://localhost:3001";
process.env.SUB2_PUBLIC_ENDPOINT ??= "http://localhost:3001";
process.env.SUB2_ADMIN_TOKEN ??= "test-sub2-admin-token";

const {
  closeOAuthStateStore,
  consumeOAuthState,
  createOAuthState,
  inspectOAuthStateStoreContract,
  parseOAuthState,
  resolveOAuthStateStoreMode,
  serializeOAuthState
} = await import("../src/modules/auth/oauth-state-store.js");

test("defaults OAuth state storage to Redis in production and memory outside production", () => {
  assert.equal(resolveOAuthStateStoreMode("production", undefined), "redis");
  assert.equal(resolveOAuthStateStoreMode("development", undefined), "memory");
  assert.equal(resolveOAuthStateStoreMode("production", "memory"), "memory");
});

test("serializes and validates OAuth state payloads", () => {
  const state = { provider: "google" as const, codeVerifier: "verifier", expiresAt: 1_000 };

  assert.deepEqual(parseOAuthState(serializeOAuthState(state)), state);
  assert.equal(parseOAuthState(null), null);
  assert.equal(parseOAuthState("{"), null);
  assert.equal(parseOAuthState(JSON.stringify({ provider: "github", codeVerifier: "v", expiresAt: 1 })), null);
});

test("memory OAuth state can be consumed once and enforces provider matching", async () => {
  await createOAuthState("google", "state-1", "verifier-1", 1_000);

  const consumed = await consumeOAuthState("google", "state-1", 1_001);
  assert.equal(consumed.codeVerifier, "verifier-1");

  await assert.rejects(() => consumeOAuthState("google", "state-1", 1_002), { code: "invalid_oauth_state" });

  await createOAuthState("x", "state-2", "verifier-2", 2_000);
  await assert.rejects(() => consumeOAuthState("google", "state-2", 2_001), { code: "invalid_oauth_state" });
});

test("reports memory OAuth state store as a non-shared test mode", () => {
  const result = inspectOAuthStateStoreContract();

  assert.equal(result.ok, true);
  assert.equal(result.summary.mode, "memory");
  assert.equal(result.summary.shared, false);
  assert.equal(result.issues.some((issue) => issue.type === "oauth_state_store_memory"), true);
});

test.after(async () => {
  await closeOAuthStateStore();
});
