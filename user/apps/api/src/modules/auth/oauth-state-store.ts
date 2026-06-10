import { Redis } from "ioredis";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors.js";

export type OAuthProvider = "google" | "x";
export type OAuthStateStoreMode = "memory" | "redis";

export interface OAuthState {
  provider: OAuthProvider;
  codeVerifier: string;
  expiresAt: number;
}

const oauthStates = new Map<string, OAuthState>();
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const redisKeyPrefix = "zyz:oauth:state:";
let redisClient: Redis | null = null;

export const oauthStateStoreMode = resolveOAuthStateStoreMode(env.NODE_ENV, env.OAUTH_STATE_STORE);

export function resolveOAuthStateStoreMode(nodeEnv: string, configured?: OAuthStateStoreMode): OAuthStateStoreMode {
  return configured ?? (nodeEnv === "production" ? "redis" : "memory");
}

export function inspectOAuthStateStoreContract() {
  const issues: Array<{ type: string; severity: "warning" | "error"; message: string }> = [];

  if (oauthStateStoreMode === "memory") {
    issues.push({
      type: "oauth_state_store_memory",
      severity: env.NODE_ENV === "production" ? "error" : "warning",
      message: "OAuth state is stored in process memory and will not survive restarts or multiple API instances"
    });
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    summary: {
      mode: oauthStateStoreMode,
      shared: oauthStateStoreMode === "redis",
      ttlMs: OAUTH_STATE_TTL_MS,
      redisUrlConfigured: Boolean(env.REDIS_URL)
    },
    issues
  };
}

export async function inspectOAuthStateStoreReadiness() {
  const contract = inspectOAuthStateStoreContract();
  if (oauthStateStoreMode !== "redis") return contract;

  try {
    await getRedisClient().ping();
    return {
      ...contract,
      ok: contract.ok,
      summary: {
        ...contract.summary,
        reachable: true
      }
    };
  } catch (error) {
    return {
      ok: false,
      summary: {
        ...contract.summary,
        reachable: false
      },
      issues: [
        ...contract.issues,
        {
          type: "oauth_state_redis_unreachable",
          severity: "error" as const,
          message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)
        }
      ]
    };
  }
}

export async function createOAuthState(provider: OAuthProvider, token: string, codeVerifier: string, now = Date.now()) {
  const value: OAuthState = {
    provider,
    codeVerifier,
    expiresAt: now + OAUTH_STATE_TTL_MS
  };

  if (oauthStateStoreMode === "redis") {
    await storeRedisOAuthState(token, value);
  } else {
    pruneExpiredMemoryStates(now);
    oauthStates.set(token, value);
  }

  return value;
}

export async function consumeOAuthState(provider: OAuthProvider, token: string, now = Date.now()) {
  const value = oauthStateStoreMode === "redis"
    ? await consumeRedisOAuthState(token)
    : consumeMemoryOAuthState(token, now);

  if (!value || value.provider !== provider || value.expiresAt < now) {
    throw new AppError("invalid_oauth_state", "OAuth state is invalid or expired", 401);
  }

  return value;
}

export function serializeOAuthState(value: OAuthState) {
  return JSON.stringify(value);
}

export function parseOAuthState(value: string | null) {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<OAuthState>;
    if (
      (parsed.provider === "google" || parsed.provider === "x") &&
      typeof parsed.codeVerifier === "string" &&
      typeof parsed.expiresAt === "number"
    ) {
      return parsed as OAuthState;
    }
  } catch {
    return null;
  }

  return null;
}

export async function closeOAuthStateStore() {
  if (!redisClient) return;
  redisClient.disconnect();
  redisClient = null;
}

function consumeMemoryOAuthState(token: string, now: number) {
  pruneExpiredMemoryStates(now);
  const value = oauthStates.get(token) ?? null;
  oauthStates.delete(token);
  return value;
}

function pruneExpiredMemoryStates(now: number) {
  for (const [state, value] of oauthStates.entries()) {
    if (value.expiresAt < now) oauthStates.delete(state);
  }
}

async function storeRedisOAuthState(token: string, value: OAuthState) {
  let result: "OK" | null;
  try {
    result = await getRedisClient().set(redisKey(token), serializeOAuthState(value), "PX", OAUTH_STATE_TTL_MS, "NX");
  } catch (error) {
    throw oauthStateStoreUnavailable(error);
  }
  if (result !== "OK") {
    throw new AppError("oauth_state_store_failed", "OAuth state could not be stored", 503);
  }
}

async function consumeRedisOAuthState(token: string) {
  let result: Awaited<ReturnType<ReturnType<Redis["multi"]>["exec"]>>;
  try {
    result = await getRedisClient().multi().get(redisKey(token)).del(redisKey(token)).exec();
  } catch (error) {
    throw oauthStateStoreUnavailable(error);
  }
  const entry = result?.[0];
  if (entry?.[0]) throw oauthStateStoreUnavailable(entry[0]);
  if (!entry) return null;
  return parseOAuthState(typeof entry[1] === "string" ? entry[1] : null);
}

function redisKey(token: string) {
  return `${redisKeyPrefix}${token}`;
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
      // Errors are surfaced to callers through the command promises.
    });
  }

  return redisClient;
}

function oauthStateStoreUnavailable(error: unknown) {
  return new AppError(
    "oauth_state_store_unavailable",
    "OAuth state store is unavailable",
    503,
    error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)
  );
}
