import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { prisma } from "../../common/prisma.js";
import { env } from "../../config/env.js";
import { expireOverdueRental } from "../../jobs/expire-overdue-rentals.js";
import {
  attachProxyRequestIdHeader,
  evaluateProxyRateLimitWindow,
  estimateProxyInputTokens,
  isProxyRateLimitWindowEmpty,
  isMetadataProxyRequest,
  openAiProxyErrorPayload,
  proxyBodyByteLength,
  proxyBodyText,
  pruneProxyRateLimitWindow,
  type ProxyRateLimitWindow
} from "./helpers.js";

const sub2BaseUrl = env.SUB2_BASE_URL.replace(/\/$/, "");
const activeProxyRequests = new Map<string, number>();
const proxyRateWindows = new Map<string, ProxyRateLimitWindow>();
const RATE_WINDOW_MS = 60_000;
const RATE_WINDOW_CLEANUP_INTERVAL_MS = RATE_WINDOW_MS;
let lastProxyRateWindowCleanupAt = 0;
const hopByHopHeaders = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

type ActiveApiKeyRecord = Extract<Awaited<ReturnType<typeof findActiveLocalKey>>, { ok: true }>["apiKey"];

interface ProxyRequestLogEntry {
  userId?: string | null;
  rentalId?: string | null;
  apiKeyId?: string | null;
  apiKeyPrefix?: string | null;
  statusCode: number;
  upstreamStatusCode?: number | null;
  errorCode?: string | null;
  estimatedInputTokens?: number;
}

interface ForwardedUpstream {
  response: Response;
  cleanup: () => void;
  abort: () => void;
}

export async function registerOpenAiProxyRoutes(app: FastifyInstance) {
  await app.register(async (proxy) => {
    proxy.removeAllContentTypeParsers();
    proxy.addContentTypeParser(
      "*",
      { parseAs: "buffer", bodyLimit: env.OPENAI_PROXY_BODY_LIMIT_BYTES },
      (_request, body, done) => done(null, body)
    );

    proxy.route({
      method: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
      url: "/v1/*",
      bodyLimit: env.OPENAI_PROXY_BODY_LIMIT_BYTES,
      handler: async (request, reply) => {
        const startedAt = Date.now();
        attachProxyRequestIdHeader(reply, request.id);
        const apiKey = bearerToken(request);
        if (!apiKey) {
          await writeProxyRequestLog(request, startedAt, {
            statusCode: 401,
            errorCode: "missing_api_key"
          });
          return openAiError(reply, 401, "missing_api_key", "Missing bearer API key");
        }

        const keyRecord = await findActiveLocalKey(apiKey);
        if (!keyRecord.ok) {
          await writeProxyRequestLog(request, startedAt, {
            statusCode: keyRecord.statusCode,
            errorCode: keyRecord.code
          });
          return openAiError(reply, keyRecord.statusCode, keyRecord.code, keyRecord.message);
        }
        const logContext = proxyRequestLogContext(keyRecord.apiKey);

        const limitCheck = await checkRentalRequestLimit(keyRecord.apiKey.rental, request);
        if (!limitCheck.ok) {
          await writeProxyRequestLog(request, startedAt, {
            ...logContext,
            statusCode: limitCheck.statusCode,
            errorCode: limitCheck.code
          });
          return openAiError(reply, limitCheck.statusCode, limitCheck.code, limitCheck.message);
        }

        const rateLimitCheck = checkRentalRateLimits(keyRecord.apiKey.rental, request);
        if (!rateLimitCheck.ok) {
          await writeProxyRequestLog(request, startedAt, {
            ...logContext,
            statusCode: rateLimitCheck.statusCode,
            errorCode: rateLimitCheck.code
          });
          return openAiError(reply, rateLimitCheck.statusCode, rateLimitCheck.code, rateLimitCheck.message);
        }

        const concurrencyLease = acquireProxyConcurrency(keyRecord.apiKey.rental);
        if (!concurrencyLease.ok) {
          await writeProxyRequestLog(request, startedAt, {
            ...logContext,
            statusCode: concurrencyLease.statusCode,
            errorCode: concurrencyLease.code,
            estimatedInputTokens: rateLimitCheck.estimatedTokens
          });
          return openAiError(reply, concurrencyLease.statusCode, concurrencyLease.code, concurrencyLease.message);
        }
        rateLimitCheck.record();
        releaseLeaseOnReplyEnd(reply, concurrencyLease.release);

        await prisma.apiKey.update({
          where: { id: keyRecord.apiKey.id },
          data: { lastUsedAt: new Date() }
        });

        const upstreamUrl = `${sub2BaseUrl}${request.raw.url ?? request.url}`;
        let upstream: ForwardedUpstream;
        try {
          upstream = await forwardToSub2(request, reply, upstreamUrl, apiKey);
        } catch (error) {
          request.log.error({ error, path: request.url, apiKeyId: keyRecord.apiKey.id }, "openai proxy upstream request failed");
          const timedOut = error instanceof Error && error.name === "AbortError";
          await writeProxyRequestLog(request, startedAt, {
            ...logContext,
            statusCode: timedOut ? 504 : 502,
            errorCode: timedOut ? "upstream_timeout" : "upstream_unavailable",
            estimatedInputTokens: rateLimitCheck.estimatedTokens
          });
          return openAiError(
            reply,
            timedOut ? 504 : 502,
            timedOut ? "upstream_timeout" : "upstream_unavailable",
            timedOut ? "Sub2API upstream timed out" : "Sub2API upstream is unavailable"
          );
        }
        const upstreamResponse = upstream.response;

        request.log.info({
          method: request.method,
          path: request.url,
          upstreamStatus: upstreamResponse.status,
          durationMs: Date.now() - startedAt,
          apiKeyId: keyRecord.apiKey.id,
          rentalId: keyRecord.apiKey.rentalId,
          activeProxyRequests: concurrencyLease.activeCount,
          proxyConcurrencyLimit: concurrencyLease.limit,
          proxyRequestLimit: limitCheck.requestLimit,
          proxyRequestUsed: limitCheck.requestUsed,
          proxyUsageRecordCount: limitCheck.usageRecordCount,
          proxyLedgerRequestCount: limitCheck.proxyRequestCount,
          proxyRpmLimit: rateLimitCheck.rpmLimit,
          proxyRpmUsed: rateLimitCheck.rpmUsed,
          proxyTpmLimit: rateLimitCheck.tpmLimit,
          proxyTpmUsed: rateLimitCheck.tpmUsed,
          proxyEstimatedInputTokens: rateLimitCheck.estimatedTokens
        }, "openai proxy request");

        const proxyRequestLogId = await writeProxyRequestLog(request, startedAt, {
          ...logContext,
          statusCode: upstreamResponse.status,
          upstreamStatusCode: upstreamResponse.status,
          estimatedInputTokens: rateLimitCheck.estimatedTokens
        });

        copyResponseHeaders(upstreamResponse, reply);
        attachProxyRequestIdHeader(reply, request.id);
        reply.status(upstreamResponse.status);

        if (request.method === "HEAD" || !upstreamResponse.body) {
          upstream.cleanup();
          return reply.send();
        }

        const upstreamStream = Readable.fromWeb(upstreamResponse.body as never);
        const forwardedStream = trackForwardedUpstreamStream(request, reply, upstreamStream, {
          abort: upstream.abort,
          cleanup: upstream.cleanup,
          idleTimeoutMs: env.OPENAI_PROXY_STREAM_IDLE_TIMEOUT_MS,
          logId: proxyRequestLogId,
          startedAt
        });
        return reply.send(forwardedStream);
      }
    });
  });
}

function bearerToken(request: FastifyRequest) {
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function findActiveLocalKey(apiKey: string) {
  const keyHash = hashSecret(apiKey);
  const record = await prisma.apiKey.findFirst({
    where: { keyHash },
    include: {
      user: {
        include: {
          wallet: true
        }
      },
      rental: {
        include: {
          product: true,
          limits: true
        }
      }
    }
  });

  if (!record || record.status !== "active") {
    return failure(401, "invalid_api_key", "Invalid or inactive API key");
  }
  if (record.user.status !== "active") {
    return failure(403, "user_not_active", "User is not active");
  }
  const minimumBalance = new Prisma.Decimal(env.OPENAI_PROXY_MIN_WALLET_BALANCE);
  if (!record.user.wallet || record.user.wallet.availableBalance.lte(minimumBalance)) {
    return failure(402, "insufficient_balance", "Wallet balance is not enough to use this API key");
  }
  if (!record.rental || record.rental.status !== "active") {
    return failure(403, "rental_not_active", "Rental is not active");
  }
  if (record.rental.endsAt && record.rental.endsAt.getTime() <= Date.now()) {
    await expireOverdueRental(record.rental.id);
    return failure(403, "rental_expired", "Rental has expired");
  }
  if (record.rental.sub2KeyHash && record.rental.sub2KeyHash !== keyHash) {
    return failure(401, "key_rental_mismatch", "API key does not match the rental");
  }
  if (record.rental.product.resourceType !== "codex") {
    return failure(403, "unsupported_resource_type", "This endpoint requires a Codex/OpenAI rental");
  }
  if (record.rental.limits?.remainingSpend && record.rental.limits.remainingSpend.lte(0)) {
    return failure(402, "spend_limit_exhausted", "Rental spend limit has been exhausted");
  }

  return { ok: true as const, apiKey: record };
}

function failure(statusCode: number, code: string, message: string) {
  return { ok: false as const, statusCode, code, message };
}

function proxyRequestLogContext(apiKey: ActiveApiKeyRecord): Pick<ProxyRequestLogEntry, "userId" | "rentalId" | "apiKeyId" | "apiKeyPrefix"> {
  return {
    userId: apiKey.userId,
    rentalId: apiKey.rentalId,
    apiKeyId: apiKey.id,
    apiKeyPrefix: apiKey.keyPrefix
  };
}

async function writeProxyRequestLog(
  request: FastifyRequest,
  startedAt: number,
  entry: ProxyRequestLogEntry
) {
  try {
    const log = await prisma.proxyRequestLog.create({
      data: {
        requestId: request.id,
        userId: entry.userId ?? null,
        rentalId: entry.rentalId ?? null,
        apiKeyId: entry.apiKeyId ?? null,
        apiKeyPrefix: entry.apiKeyPrefix ?? null,
        method: request.method.toUpperCase(),
        path: proxyRequestPath(request).slice(0, 2048),
        statusCode: entry.statusCode,
        upstreamStatusCode: entry.upstreamStatusCode ?? null,
        errorCode: entry.errorCode ?? null,
        durationMs: Math.max(0, Date.now() - startedAt),
        requestBytes: requestBodyByteLength(request),
        estimatedInputTokens: entry.estimatedInputTokens ?? 0,
        ipAddress: request.ip,
        userAgent: requestUserAgent(request)
      }
    });
    return log.id;
  } catch (error) {
    request.log.warn({ error, path: request.url }, "failed to persist openai proxy request log");
    return null;
  }
}

async function updateProxyRequestLogCompletion(
  request: FastifyRequest,
  logId: string | null,
  startedAt: number,
  errorCode?: string
) {
  if (!logId) return;
  try {
    await prisma.proxyRequestLog.update({
      where: { id: logId },
      data: {
        durationMs: Math.max(0, Date.now() - startedAt),
        ...(errorCode ? { errorCode } : {})
      }
    });
  } catch (error) {
    request.log.warn({ error, path: request.url, proxyRequestLogId: logId }, "failed to update openai proxy request log completion");
  }
}

async function checkRentalRequestLimit(
  rental: ActiveApiKeyRecord["rental"],
  request: FastifyRequest
) {
  const requestLimit = rental?.limits?.requestLimit ?? null;
  if (!rental || !requestLimit || isMetadataRequest(request)) {
    return {
      ok: true as const,
      requestLimit,
      requestUsed: null,
      usageRecordCount: null,
      proxyRequestCount: null
    };
  }

  const [usageRecordCount, proxyRequestCount] = await Promise.all([
    prisma.usageRecord.count({
      where: {
        rentalId: rental.id,
        status: { in: ["pending", "billed", "disputed"] }
      }
    }),
    prisma.proxyRequestLog.count({
      where: {
        rentalId: rental.id,
        upstreamStatusCode: { not: null },
        NOT: metadataProxyRequestLogFilters()
      }
    })
  ]);

  const requestUsed = Math.max(usageRecordCount, proxyRequestCount);
  if (requestUsed >= requestLimit) {
    return failure(429, "request_limit_exceeded", "Rental request limit has been exhausted");
  }

  return {
    ok: true as const,
    requestLimit,
    requestUsed,
    usageRecordCount,
    proxyRequestCount
  };
}

function metadataProxyRequestLogFilters(): Prisma.ProxyRequestLogWhereInput[] {
  const metadataMethods = ["GET", "HEAD"];
  return [
    {
      method: { in: metadataMethods },
      path: { in: ["/v1/models", "/v1/models/"] }
    },
    {
      method: { in: metadataMethods },
      path: { startsWith: "/v1/models?" }
    },
    {
      method: { in: metadataMethods },
      path: { startsWith: "/v1/models/" }
    }
  ];
}

function acquireProxyConcurrency(rental: ActiveApiKeyRecord["rental"]) {
  if (!rental) {
    return failure(403, "rental_not_active", "Rental is not active");
  }

  const limit = Math.max(1, rental?.limits?.maxConcurrency ?? 1);
  const key = rental.id;
  const activeCount = activeProxyRequests.get(key) ?? 0;

  if (activeCount >= limit) {
    return failure(429, "concurrency_limit_exceeded", "Rental concurrency limit has been reached");
  }

  activeProxyRequests.set(key, activeCount + 1);
  let released = false;
  return {
    ok: true as const,
    activeCount: activeCount + 1,
    limit,
    release: () => {
      if (released) return;
      released = true;
      const current = activeProxyRequests.get(key) ?? 0;
      if (current <= 1) {
        activeProxyRequests.delete(key);
      } else {
        activeProxyRequests.set(key, current - 1);
      }
    }
  };
}

function checkRentalRateLimits(
  rental: ActiveApiKeyRecord["rental"],
  request: FastifyRequest
) {
  if (!rental) {
    return failure(403, "rental_not_active", "Rental is not active");
  }
  if (isMetadataRequest(request)) {
    return {
      ok: true as const,
      rpmLimit: rental.limits?.rpmLimit ?? null,
      rpmUsed: null,
      tpmLimit: rental.limits?.tpmLimit ?? null,
      tpmUsed: null,
      estimatedTokens: 0,
      record: noop
    };
  }

  const rpmLimit = rental.limits?.rpmLimit ?? null;
  const tpmLimit = rental.limits?.tpmLimit ?? null;
  if (!rpmLimit && !tpmLimit) {
    return { ok: true as const, rpmLimit, rpmUsed: null, tpmLimit, tpmUsed: null, estimatedTokens: 0, record: noop };
  }

  const now = Date.now();
  cleanupInactiveProxyRateWindows(now);
  const window = rateWindowForRental(rental.id);
  const estimatedTokens = tpmLimit ? estimateInputTokens(request) : 0;
  const windowCheck = evaluateProxyRateLimitWindow({
    window,
    now,
    windowMs: RATE_WINDOW_MS,
    rpmLimit,
    tpmLimit,
    estimatedTokens
  });
  if (!windowCheck.ok) {
    return failure(429, windowCheck.code, windowCheck.message);
  }

  return {
    ok: true as const,
    rpmLimit,
    rpmUsed: windowCheck.rpmUsed,
    tpmLimit,
    tpmUsed: windowCheck.tpmUsed,
    estimatedTokens,
    record: windowCheck.commit
  };
}

function noop() {
  // No-op reservation for metadata requests or rentals without local RPM/TPM limits.
}

function rateWindowForRental(rentalId: string) {
  const existing = proxyRateWindows.get(rentalId);
  if (existing) return existing;
  const created: ProxyRateLimitWindow = { requests: [], tokens: [] };
  proxyRateWindows.set(rentalId, created);
  return created;
}

function cleanupInactiveProxyRateWindows(now: number) {
  if (now - lastProxyRateWindowCleanupAt < RATE_WINDOW_CLEANUP_INTERVAL_MS) return;
  lastProxyRateWindowCleanupAt = now;

  for (const [rentalId, window] of proxyRateWindows) {
    pruneProxyRateLimitWindow(window, now, RATE_WINDOW_MS);
    if (isProxyRateLimitWindowEmpty(window)) {
      proxyRateWindows.delete(rentalId);
    }
  }
}

function estimateInputTokens(request: FastifyRequest) {
  return estimateProxyInputTokens(request.method, request.body);
}

function requestBodyText(request: FastifyRequest) {
  return proxyBodyText(request.body);
}

function requestBodyByteLength(request: FastifyRequest) {
  return proxyBodyByteLength(request.body);
}

function proxyRequestPath(request: FastifyRequest) {
  return request.raw.url ?? request.url;
}

function requestUserAgent(request: FastifyRequest) {
  const value = request.headers["user-agent"];
  return Array.isArray(value) ? value.join(", ") : value;
}

function releaseLeaseOnReplyEnd(reply: FastifyReply, release: () => void) {
  reply.raw.once("finish", release);
  reply.raw.once("close", release);
}

function trackForwardedUpstreamStream(
  request: FastifyRequest,
  reply: FastifyReply,
  stream: Readable,
  options: {
    abort: () => void;
    cleanup: () => void;
    idleTimeoutMs: number;
    logId: string | null;
    startedAt: number;
  }
) {
  const monitoredStream = new Transform({
    transform(chunk, encoding, callback) {
      resetIdleTimer();
      callback(null, chunk);
    }
  });
  let cleaned = false;
  let streamEnded = false;
  let clientClosedEarly = false;
  let idleTimedOut = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const clearIdleTimer = () => {
    if (!idleTimer) return;
    clearTimeout(idleTimer);
    idleTimer = null;
  };

  const resetIdleTimer = () => {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      idleTimedOut = true;
      request.log.warn({
        path: request.url,
        idleTimeoutMs: options.idleTimeoutMs,
        proxyRequestLogId: options.logId
      }, "openai proxy upstream stream idle timeout");
      options.abort();
      stream.destroy(new Error("upstream_stream_idle_timeout"));
      monitoredStream.destroy(new Error("upstream_stream_idle_timeout"));
      finalize("upstream_stream_idle_timeout");
    }, options.idleTimeoutMs);
    idleTimer.unref?.();
  };

  const markClientClose = () => {
    if (!reply.raw.writableEnded && !streamEnded) {
      clientClosedEarly = true;
      options.abort();
      stream.destroy();
      monitoredStream.destroy();
      finalize("client_disconnected");
    }
  };

  const finalize = (errorCode?: string) => {
    if (cleaned) return;
    cleaned = true;
    clearIdleTimer();
    reply.raw.off("close", markClientClose);
    options.cleanup();
    void updateProxyRequestLogCompletion(request, options.logId, options.startedAt, errorCode);
  };

  reply.raw.once("close", markClientClose);
  stream.once("end", () => {
    streamEnded = true;
    finalize();
  });
  stream.once("error", (error) => {
    if (!monitoredStream.destroyed) {
      monitoredStream.destroy(error instanceof Error ? error : undefined);
    }
    finalize(idleTimedOut ? "upstream_stream_idle_timeout" : clientClosedEarly ? "client_disconnected" : "upstream_stream_error");
  });
  stream.once("close", () => {
    if (!streamEnded) {
      finalize(idleTimedOut ? "upstream_stream_idle_timeout" : clientClosedEarly ? "client_disconnected" : "upstream_stream_closed");
    }
  });
  monitoredStream.once("error", () => undefined);
  resetIdleTimer();
  stream.pipe(monitoredStream);
  return monitoredStream;
}

function isMetadataRequest(request: FastifyRequest) {
  return isMetadataProxyRequest(request.method, request.raw.url ?? request.url);
}

async function forwardToSub2(request: FastifyRequest, reply: FastifyReply, url: string, apiKey: string) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    const lower = name.toLowerCase();
    if (hopByHopHeaders.has(lower) || lower === "host" || lower === "authorization" || lower === "accept-encoding") continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, String(value));
    }
  }
  headers.set("authorization", `Bearer ${apiKey}`);
  headers.set("accept-encoding", "identity");
  headers.set("x-forwarded-host", request.hostname);
  headers.set("x-forwarded-proto", request.protocol);
  appendForwardedFor(headers, request.ip);
  headers.set("x-request-id", request.id);

  const body = bodyForUpstream(request);
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };
  const timeout = setTimeout(abort, env.OPENAI_PROXY_UPSTREAM_TIMEOUT_MS);
  const abortOnClose = () => {
    if (!reply.raw.writableEnded) abort();
  };
  const cleanup = () => {
    clearTimeout(timeout);
    reply.raw.off("close", abortOnClose);
  };
  reply.raw.once("close", abortOnClose);
  try {
    const response = await fetch(url, {
      method: request.method,
      headers,
      body,
      signal: controller.signal
    });
    clearTimeout(timeout);
    return { response, cleanup, abort };
  } catch (error) {
    cleanup();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function bodyForUpstream(request: FastifyRequest): BodyInit | undefined {
  if (["GET", "HEAD"].includes(request.method)) return undefined;
  const body = request.body;
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  if (Buffer.isBuffer(body)) return new Blob([arrayBufferFromBytes(body)]);
  if (body instanceof Uint8Array) return new Blob([arrayBufferFromBytes(body)]);
  return JSON.stringify(body);
}

function appendForwardedFor(headers: Headers, ip: string) {
  const existing = headers.get("x-forwarded-for");
  headers.set("x-forwarded-for", existing ? `${existing}, ${ip}` : ip);
}

function arrayBufferFromBytes(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function copyResponseHeaders(upstream: Response, reply: FastifyReply) {
  upstream.headers.forEach((value, name) => {
    if (hopByHopHeaders.has(name.toLowerCase())) return;
    reply.header(name, value);
  });
}

function openAiError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.status(statusCode).send(openAiProxyErrorPayload(statusCode, code, message));
}
