import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { prisma } from "../../common/prisma.js";
import { env } from "../../config/env.js";

const sub2BaseUrl = env.SUB2_BASE_URL.replace(/\/$/, "");
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
        const apiKey = bearerToken(request);
        if (!apiKey) {
          return openAiError(reply, 401, "missing_api_key", "Missing bearer API key");
        }

        const keyRecord = await findActiveLocalKey(apiKey);
        if (!keyRecord.ok) {
          return openAiError(reply, keyRecord.statusCode, keyRecord.code, keyRecord.message);
        }

        await prisma.apiKey.update({
          where: { id: keyRecord.apiKey.id },
          data: { lastUsedAt: new Date() }
        });

        const upstreamUrl = `${sub2BaseUrl}${request.raw.url ?? request.url}`;
        let upstream: Response;
        try {
          upstream = await forwardToSub2(request, reply, upstreamUrl, apiKey);
        } catch (error) {
          request.log.error({ error, path: request.url, apiKeyId: keyRecord.apiKey.id }, "openai proxy upstream request failed");
          const timedOut = error instanceof Error && error.name === "AbortError";
          return openAiError(
            reply,
            timedOut ? 504 : 502,
            timedOut ? "upstream_timeout" : "upstream_unavailable",
            timedOut ? "Sub2API upstream timed out" : "Sub2API upstream is unavailable"
          );
        }

        request.log.info({
          method: request.method,
          path: request.url,
          upstreamStatus: upstream.status,
          durationMs: Date.now() - startedAt,
          apiKeyId: keyRecord.apiKey.id,
          rentalId: keyRecord.apiKey.rentalId
        }, "openai proxy request");

        copyResponseHeaders(upstream, reply);
        reply.header("x-proxy-request-id", request.id);
        reply.status(upstream.status);

        if (request.method === "HEAD" || !upstream.body) {
          return reply.send();
        }

        return reply.send(Readable.fromWeb(upstream.body as never));
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
  const timeout = setTimeout(() => controller.abort(), env.OPENAI_PROXY_UPSTREAM_TIMEOUT_MS);
  const abortOnClose = () => {
    if (!reply.raw.writableEnded) controller.abort();
  };
  reply.raw.once("close", abortOnClose);
  try {
    return await fetch(url, {
      method: request.method,
      headers,
      body,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
    reply.raw.off("close", abortOnClose);
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
  return reply.status(statusCode).send({
    error: {
      message,
      type: "invalid_request_error",
      code
    }
  });
}
