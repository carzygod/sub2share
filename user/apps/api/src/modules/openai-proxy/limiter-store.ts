import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { env } from "../../config/env.js";
import {
  evaluateProxyRateLimitWindow,
  inspectOpenAiProxyRuntime,
  isProxyRateLimitWindowEmpty,
  pruneProxyRateLimitWindow,
  type ProxyRateLimitWindow
} from "./helpers.js";

export type OpenAiProxyLimiterStoreMode = "memory" | "redis";

const RATE_WINDOW_MS = 60_000;
const RATE_WINDOW_CLEANUP_INTERVAL_MS = RATE_WINDOW_MS;
const redisKeyPrefix = "zyz:openai-proxy:limiter:";
const activeProxyRequests = new Map<string, number>();
const proxyRateWindows = new Map<string, ProxyRateLimitWindow>();
let lastProxyRateWindowCleanupAt = 0;
let redisClient: Redis | null = null;

export const openAiProxyLimiterStoreMode = resolveOpenAiProxyLimiterStoreMode(
  env.NODE_ENV,
  env.OPENAI_PROXY_LIMITER_STORE
);

export function resolveOpenAiProxyLimiterStoreMode(
  nodeEnv: string,
  configured?: OpenAiProxyLimiterStoreMode
): OpenAiProxyLimiterStoreMode {
  return configured ?? (nodeEnv === "production" ? "redis" : "memory");
}

export async function acquireOpenAiProxyConcurrency(rentalId: string, limit: number) {
  return openAiProxyLimiterStoreMode === "redis"
    ? acquireRedisConcurrency(rentalId, limit)
    : acquireMemoryConcurrency(rentalId, limit);
}

export async function consumeOpenAiProxyRateLimit(input: {
  rentalId: string;
  rpmLimit: number | null;
  tpmLimit: number | null;
  estimatedTokens: number;
  now?: number;
}) {
  if (!input.rpmLimit && !input.tpmLimit) {
    return {
      ok: true as const,
      rpmLimit: input.rpmLimit,
      rpmUsed: null,
      tpmLimit: input.tpmLimit,
      tpmUsed: null,
      estimatedTokens: input.estimatedTokens
    };
  }

  return openAiProxyLimiterStoreMode === "redis"
    ? consumeRedisRateLimit(input)
    : consumeMemoryRateLimit(input);
}

export async function inspectOpenAiProxyRuntimeState(now = Date.now()) {
  if (openAiProxyLimiterStoreMode !== "redis") return inspectMemoryRuntimeState(now);

  try {
    return await inspectRedisRuntimeState(now);
  } catch (error) {
    return redisLimiterUnavailable(error);
  }
}

export async function inspectOpenAiProxyLimiterReadiness() {
  if (openAiProxyLimiterStoreMode !== "redis") {
    const runtime = inspectMemoryRuntimeState(Date.now());
    return {
      ok: runtime.ok,
      summary: runtime.summary,
      issues: runtime.issues
    };
  }

  try {
    await getRedisClient().ping();
    return {
      ok: true,
      summary: redisRuntimeSummary({ redisReachable: true }),
      issues: []
    };
  } catch (error) {
    return redisLimiterUnavailable(error);
  }
}

export async function closeOpenAiProxyLimiterStore() {
  activeProxyRequests.clear();
  proxyRateWindows.clear();
  if (redisClient) {
    const client = redisClient;
    redisClient = null;
    await client.quit();
  }
}

function acquireMemoryConcurrency(rentalId: string, limit: number) {
  const normalizedLimit = Math.max(1, limit);
  const activeCount = activeProxyRequests.get(rentalId) ?? 0;
  if (activeCount >= normalizedLimit) {
    return {
      ...failure(429, "concurrency_limit_exceeded", "Rental concurrency limit has been reached"),
      activeCount,
      limit: normalizedLimit,
      retryAfterMs: 1_000
    };
  }

  activeProxyRequests.set(rentalId, activeCount + 1);
  let released = false;
  return {
    ok: true as const,
    activeCount: activeCount + 1,
    limit: normalizedLimit,
    release: async () => {
      if (released) return;
      released = true;
      const current = activeProxyRequests.get(rentalId) ?? 0;
      if (current <= 1) {
        activeProxyRequests.delete(rentalId);
      } else {
        activeProxyRequests.set(rentalId, current - 1);
      }
    }
  };
}

async function acquireRedisConcurrency(rentalId: string, limit: number) {
  const normalizedLimit = Math.max(1, limit);
  const key = redisConcurrencyKey(rentalId);
  const ttlMs = redisConcurrencyLeaseTtlMs();
  const now = Date.now();
  const leaseId = randomUUID();
  const result = await redisEvalArray(
    redisAcquireConcurrencyScript,
    1,
    key,
    String(now),
    String(now + ttlMs),
    String(normalizedLimit),
    leaseId,
    String(ttlMs)
  );
  const allowed = numberAt(result, 0) === 1;
  const activeCount = numberAt(result, 1);
  if (!allowed) {
    return {
      ...failure(429, "concurrency_limit_exceeded", "Rental concurrency limit has been reached"),
      activeCount,
      limit: normalizedLimit,
      retryAfterMs: 1_000
    };
  }

  let released = false;
  const renewEveryMs = Math.max(1_000, Math.floor(ttlMs / 2));
  const renewTimer = setInterval(() => {
    void redisEvalArray(
      redisRenewConcurrencyScript,
      1,
      key,
      leaseId,
      String(Date.now() + ttlMs),
      String(ttlMs)
    ).catch(() => undefined);
  }, renewEveryMs);
  renewTimer.unref?.();

  return {
    ok: true as const,
    activeCount,
    limit: normalizedLimit,
    release: async () => {
      if (released) return;
      released = true;
      clearInterval(renewTimer);
      await redisEvalArray(redisReleaseConcurrencyScript, 1, key, leaseId);
    }
  };
}

function consumeMemoryRateLimit(input: {
  rentalId: string;
  rpmLimit: number | null;
  tpmLimit: number | null;
  estimatedTokens: number;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  cleanupInactiveProxyRateWindows(now);
  const window = rateWindowForRental(input.rentalId);
  const windowCheck = evaluateProxyRateLimitWindow({
    window,
    now,
    windowMs: RATE_WINDOW_MS,
    rpmLimit: input.rpmLimit,
    tpmLimit: input.tpmLimit,
    estimatedTokens: input.estimatedTokens
  });
  if (!windowCheck.ok) {
    return {
      ...failure(429, windowCheck.code, windowCheck.message),
      rpmLimit: input.rpmLimit,
      rpmUsed: windowCheck.rpmUsed,
      tpmLimit: input.tpmLimit,
      tpmUsed: windowCheck.tpmUsed,
      estimatedTokens: input.estimatedTokens,
      retryAfterMs: windowCheck.retryAfterMs
    };
  }

  windowCheck.commit();
  return {
    ok: true as const,
    rpmLimit: input.rpmLimit,
    rpmUsed: windowCheck.rpmUsed,
    tpmLimit: input.tpmLimit,
    tpmUsed: windowCheck.tpmUsed,
    estimatedTokens: input.estimatedTokens
  };
}

async function consumeRedisRateLimit(input: {
  rentalId: string;
  rpmLimit: number | null;
  tpmLimit: number | null;
  estimatedTokens: number;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const result = await redisEvalArray(
    redisConsumeRateLimitScript,
    2,
    redisRateRequestsKey(input.rentalId),
    redisRateTokensKey(input.rentalId),
    String(now),
    String(RATE_WINDOW_MS),
    String(input.rpmLimit ?? 0),
    String(input.tpmLimit ?? 0),
    String(input.estimatedTokens),
    `${now}:${randomUUID()}`,
    String(RATE_WINDOW_MS * 2)
  );
  const allowed = numberAt(result, 0) === 1;
  const code = stringAt(result, 1);
  const rpmUsed = nullablePositive(numberAt(result, 2));
  const tpmUsed = nullablePositive(numberAt(result, 3));

  if (!allowed) {
    return {
      ...failure(
        429,
        code,
        code === "tpm_limit_exceeded" ? "Rental TPM limit has been reached" : "Rental RPM limit has been reached"
      ),
      rpmLimit: input.rpmLimit,
      rpmUsed,
      tpmLimit: input.tpmLimit,
      tpmUsed,
      estimatedTokens: input.estimatedTokens,
      retryAfterMs: RATE_WINDOW_MS
    };
  }

  return {
    ok: true as const,
    rpmLimit: input.rpmLimit,
    rpmUsed,
    tpmLimit: input.tpmLimit,
    tpmUsed,
    estimatedTokens: input.estimatedTokens
  };
}

function inspectMemoryRuntimeState(now: number) {
  cleanupInactiveProxyRateWindows(now, true);

  let activeRateWindowRequests = 0;
  let activeRateWindowTokenEvents = 0;
  let activeRateWindowEstimatedTokens = 0;
  for (const window of proxyRateWindows.values()) {
    activeRateWindowRequests += window.requests.length;
    activeRateWindowTokenEvents += window.tokens.length;
    activeRateWindowEstimatedTokens += window.tokens.reduce((total, event) => total + event.tokens, 0);
  }

  return inspectOpenAiProxyRuntime({
    nodeEnv: env.NODE_ENV,
    storeMode: openAiProxyLimiterStoreMode,
    limiterScope: "process",
    shared: false,
    redisReachable: null,
    rateWindowMs: RATE_WINDOW_MS,
    rateWindowCleanupIntervalMs: RATE_WINDOW_CLEANUP_INTERVAL_MS,
    activeConcurrencyRentals: activeProxyRequests.size,
    activeConcurrencyLeases: [...activeProxyRequests.values()].reduce((total, count) => total + count, 0),
    activeRateWindowRentals: proxyRateWindows.size,
    activeRateWindowRequests,
    activeRateWindowTokenEvents,
    activeRateWindowEstimatedTokens,
    lastRateWindowCleanupAt: lastProxyRateWindowCleanupAt ? new Date(lastProxyRateWindowCleanupAt).toISOString() : null
  });
}

async function inspectRedisRuntimeState(now: number) {
  const client = getRedisClient();
  const [concurrencyKeys, requestKeys, tokenKeys] = await Promise.all([
    scanRedisKeys(`${redisKeyPrefix}concurrency:v2:*`),
    scanRedisKeys(`${redisKeyPrefix}rate:requests:*`),
    scanRedisKeys(`${redisKeyPrefix}rate:tokens:*`)
  ]);
  let activeConcurrencyLeases = 0;
  let activeConcurrencyRentals = 0;
  for (const key of concurrencyKeys) {
    await client.zremrangebyscore(key, "-inf", String(now));
    const count = await client.zcard(key);
    if (count > 0) {
      activeConcurrencyRentals += 1;
      activeConcurrencyLeases += count;
    } else {
      await client.del(key);
    }
  }

  let activeRateWindowRequests = 0;
  let activeRateWindowTokenEvents = 0;
  let activeRateWindowEstimatedTokens = 0;
  const activeRateWindowRentalIds = new Set<string>();
  const cutoff = now - RATE_WINDOW_MS;
  for (const key of requestKeys) {
    await client.zremrangebyscore(key, "-inf", String(cutoff));
    const count = await client.zcard(key);
    if (count > 0) {
      activeRateWindowRentalIds.add(redisRentalIdFromKey(key));
      activeRateWindowRequests += count;
    }
  }
  for (const key of tokenKeys) {
    await client.zremrangebyscore(key, "-inf", String(cutoff));
    const members = await client.zrangebyscore(key, String(cutoff + 1), "+inf");
    if (members.length > 0) {
      activeRateWindowRentalIds.add(redisRentalIdFromKey(key));
      activeRateWindowTokenEvents += members.length;
      activeRateWindowEstimatedTokens += members.reduce((total, member) => total + tokenCountFromRedisMember(member), 0);
    }
  }

  return inspectOpenAiProxyRuntime({
    ...redisRuntimeSummary({ redisReachable: true }),
    activeConcurrencyRentals,
    activeConcurrencyLeases,
    activeRateWindowRentals: activeRateWindowRentalIds.size,
    activeRateWindowRequests,
    activeRateWindowTokenEvents,
    activeRateWindowEstimatedTokens
  });
}

function redisLimiterUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
  return {
    ok: false,
    summary: redisRuntimeSummary({ redisReachable: false }),
    issues: [
      {
        id: "openai-proxy-limiter-redis-unreachable",
        type: "redis_unreachable",
        severity: "error" as const,
        refId: "openai-proxy-runtime",
        message
      }
    ]
  };
}

function redisRuntimeSummary(input: { redisReachable: boolean }) {
  return {
    nodeEnv: env.NODE_ENV,
    storeMode: openAiProxyLimiterStoreMode,
    limiterScope: "redis" as const,
    shared: true,
    redisReachable: input.redisReachable,
    rateWindowMs: RATE_WINDOW_MS,
    rateWindowCleanupIntervalMs: RATE_WINDOW_CLEANUP_INTERVAL_MS,
    activeConcurrencyRentals: 0,
    activeConcurrencyLeases: 0,
    activeRateWindowRentals: 0,
    activeRateWindowRequests: 0,
    activeRateWindowTokenEvents: 0,
    activeRateWindowEstimatedTokens: 0,
    lastRateWindowCleanupAt: null
  };
}

function rateWindowForRental(rentalId: string) {
  const existing = proxyRateWindows.get(rentalId);
  if (existing) return existing;
  const created: ProxyRateLimitWindow = { requests: [], tokens: [] };
  proxyRateWindows.set(rentalId, created);
  return created;
}

function cleanupInactiveProxyRateWindows(now: number, force = false) {
  if (!force && now - lastProxyRateWindowCleanupAt < RATE_WINDOW_CLEANUP_INTERVAL_MS) return;
  lastProxyRateWindowCleanupAt = now;

  for (const [rentalId, window] of proxyRateWindows) {
    pruneProxyRateLimitWindow(window, now, RATE_WINDOW_MS);
    if (isProxyRateLimitWindowEmpty(window)) {
      proxyRateWindows.delete(rentalId);
    }
  }
}

function redisConcurrencyLeaseTtlMs() {
  return Math.max(60_000, env.OPENAI_PROXY_STREAM_IDLE_TIMEOUT_MS + 60_000);
}

function redisConcurrencyKey(rentalId: string) {
  return `${redisKeyPrefix}concurrency:v2:${rentalId}`;
}

function redisRateRequestsKey(rentalId: string) {
  return `${redisKeyPrefix}rate:requests:${rentalId}`;
}

function redisRateTokensKey(rentalId: string) {
  return `${redisKeyPrefix}rate:tokens:${rentalId}`;
}

function redisRentalIdFromKey(key: string) {
  return key.slice(key.lastIndexOf(":") + 1);
}

function tokenCountFromRedisMember(member: string) {
  const match = member.match(/:(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function nullablePositive(value: number) {
  return value >= 0 ? value : null;
}

async function scanRedisKeys(pattern: string) {
  const client = getRedisClient();
  const keys: string[] = [];
  let cursor = "0";
  do {
    const result = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = result[0];
    keys.push(...result[1]);
  } while (cursor !== "0");
  return keys;
}

async function redisEvalArray(script: string, keyCount: number, ...args: string[]) {
  const result = await getRedisClient().eval(script, keyCount, ...args);
  return Array.isArray(result) ? result : [];
}

function numberAt(values: unknown[], index: number) {
  const value = values[index];
  return typeof value === "number" ? value : Number(value ?? 0);
}

function stringAt(values: unknown[], index: number) {
  return String(values[index] ?? "");
}

function getRedisClient() {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      commandTimeout: 2_000
    });
    redisClient.on("error", () => {
      // Redis command promises surface failures to request/readiness callers.
    });
  }

  return redisClient;
}

function failure(statusCode: number, code: string, message: string) {
  return { ok: false as const, statusCode, code, message };
}

const redisAcquireConcurrencyScript = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local expiresAt = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local leaseId = ARGV[4]
local ttl = tonumber(ARGV[5])
redis.call("ZREMRANGEBYSCORE", key, "-inf", now)
local current = redis.call("ZCARD", key)
if current >= limit then
  return {0, current, limit}
end
redis.call("ZADD", key, expiresAt, leaseId)
redis.call("PEXPIRE", key, ttl)
return {1, current + 1, limit}
`;

const redisReleaseConcurrencyScript = `
local key = KEYS[1]
local leaseId = ARGV[1]
redis.call("ZREM", key, leaseId)
local current = redis.call("ZCARD", key)
if current <= 0 then
  redis.call("DEL", key)
  return {1, 0}
end
return {1, current}
`;

const redisRenewConcurrencyScript = `
local key = KEYS[1]
local leaseId = ARGV[1]
local expiresAt = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
if redis.call("ZSCORE", key, leaseId) then
  redis.call("ZADD", key, expiresAt, leaseId)
  redis.call("PEXPIRE", key, ttl)
  return {1}
end
return {0}
`;

const redisConsumeRateLimitScript = `
local requestKey = KEYS[1]
local tokenKey = KEYS[2]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local rpmLimit = tonumber(ARGV[3])
local tpmLimit = tonumber(ARGV[4])
local estimatedTokens = tonumber(ARGV[5])
local eventId = ARGV[6]
local ttl = tonumber(ARGV[7])
local cutoff = now - windowMs

redis.call("ZREMRANGEBYSCORE", requestKey, "-inf", cutoff)
redis.call("ZREMRANGEBYSCORE", tokenKey, "-inf", cutoff)

local requestCount = redis.call("ZCARD", requestKey)
local tokenMembers = redis.call("ZRANGEBYSCORE", tokenKey, cutoff + 1, "+inf")
local tokenTotal = 0
for _, member in ipairs(tokenMembers) do
  local tokenText = string.match(member, ":(%d+)$")
  if tokenText then
    tokenTotal = tokenTotal + tonumber(tokenText)
  end
end

if rpmLimit > 0 and requestCount >= rpmLimit then
  return {0, "rpm_limit_exceeded", requestCount, tokenTotal}
end
if tpmLimit > 0 and tokenTotal + estimatedTokens > tpmLimit then
  return {0, "tpm_limit_exceeded", requestCount, tokenTotal}
end

redis.call("ZADD", requestKey, now, eventId)
if estimatedTokens > 0 then
  redis.call("ZADD", tokenKey, now, eventId .. ":" .. estimatedTokens)
end
redis.call("PEXPIRE", requestKey, ttl)
redis.call("PEXPIRE", tokenKey, ttl)

local rpmUsed = -1
if rpmLimit > 0 then
  rpmUsed = requestCount + 1
end
local tpmUsed = -1
if tpmLimit > 0 then
  tpmUsed = tokenTotal + estimatedTokens
end
return {1, "", rpmUsed, tpmUsed}
`;
