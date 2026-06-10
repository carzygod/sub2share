import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/sub2share_test";
process.env.JWT_ACCESS_SECRET ??= "test-secret-at-least-sixteen-characters";
process.env.SUB2_BASE_URL ??= "http://localhost:3001";
process.env.SUB2_PUBLIC_ENDPOINT ??= "http://localhost:3001";
process.env.SUB2_ADMIN_TOKEN ??= "test-sub2-admin-token";

const {
  acquireOpenAiProxyConcurrency,
  closeOpenAiProxyLimiterStore,
  consumeOpenAiProxyRateLimit,
  inspectOpenAiProxyLimiterReadiness,
  inspectOpenAiProxyRuntimeState,
  resolveOpenAiProxyLimiterStoreMode
} = await import("../src/modules/openai-proxy/limiter-store.js");

test("defaults OpenAI proxy limiter storage to Redis only in production", () => {
  assert.equal(resolveOpenAiProxyLimiterStoreMode("production", undefined), "redis");
  assert.equal(resolveOpenAiProxyLimiterStoreMode("development", undefined), "memory");
  assert.equal(resolveOpenAiProxyLimiterStoreMode("test", undefined), "memory");
  assert.equal(resolveOpenAiProxyLimiterStoreMode("production", "memory"), "memory");
});

test("memory OpenAI proxy limiter enforces concurrency leases", async () => {
  const first = await acquireOpenAiProxyConcurrency("rental-concurrency-test", 1);
  assert.equal(first.ok, true);
  if (!first.ok) assert.fail("expected first concurrency lease");

  const second = await acquireOpenAiProxyConcurrency("rental-concurrency-test", 1);
  assert.equal(second.ok, false);
  if (second.ok) assert.fail("expected concurrency limit to fail");
  assert.equal(second.code, "concurrency_limit_exceeded");

  await first.release();
  const third = await acquireOpenAiProxyConcurrency("rental-concurrency-test", 1);
  assert.equal(third.ok, true);
  if (third.ok) await third.release();
});

test("memory OpenAI proxy limiter consumes RPM windows", async () => {
  const first = await consumeOpenAiProxyRateLimit({
    rentalId: "rental-rpm-test",
    rpmLimit: 1,
    tpmLimit: null,
    estimatedTokens: 0,
    now: 1_000
  });
  assert.equal(first.ok, true);
  if (!first.ok) assert.fail("expected first RPM event");
  assert.equal(first.rpmUsed, 1);

  const second = await consumeOpenAiProxyRateLimit({
    rentalId: "rental-rpm-test",
    rpmLimit: 1,
    tpmLimit: null,
    estimatedTokens: 0,
    now: 1_001
  });
  assert.equal(second.ok, false);
  if (second.ok) assert.fail("expected RPM limit to fail");
  assert.equal(second.code, "rpm_limit_exceeded");
});

test("memory OpenAI proxy runtime exposes process-local state", async () => {
  const result = await inspectOpenAiProxyRuntimeState(2_000);

  assert.equal(result.summary.storeMode, "memory");
  assert.equal(result.summary.limiterScope, "process");
  assert.equal(result.summary.shared, false);
  assert.equal(result.summary.redisReachable, null);
});

test("memory OpenAI proxy limiter readiness does not require Redis", async () => {
  const result = await inspectOpenAiProxyLimiterReadiness();

  assert.equal(result.ok, true);
  assert.equal(result.summary.storeMode, "memory");
  assert.equal(result.summary.redisReachable, null);
});

test.after(async () => {
  await closeOpenAiProxyLimiterStore();
});
