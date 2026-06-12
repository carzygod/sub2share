import type { FastifyReply } from "fastify";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function sendError(reply: FastifyReply, error: unknown) {
  const requestId = reply.request.id;
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      ok: false,
      error: { code: error.code, message: error.message, details: error.details },
      requestId
    });
  }

  if (error instanceof ZodError) {
    return reply.status(400).send({
      ok: false,
      error: {
        code: "validation_error",
        message: "Request validation failed",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
          message: issue.message
        }))
      },
      requestId
    });
  }

  const frameworkError = frameworkHttpError(error);
  if (frameworkError) {
    return reply.status(frameworkError.statusCode).send({
      ok: false,
      error: {
        code: frameworkError.code,
        message: frameworkError.message
      },
      requestId
    });
  }

  reply.request.log.error(error);
  return reply.status(500).send({
    ok: false,
    error: { code: "internal_error", message: "Internal server error" },
    requestId
  });
}

function frameworkHttpError(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const record = error as { statusCode?: unknown; code?: unknown; message?: unknown };
  if (!Number.isInteger(record.statusCode) || typeof record.statusCode !== "number") return null;
  if (record.statusCode < 400 || record.statusCode >= 500) return null;

  return {
    statusCode: record.statusCode,
    code: normalizeErrorCode(record.code) ?? defaultHttpErrorCode(record.statusCode),
    message: typeof record.message === "string" && record.message.trim()
      ? record.message
      : defaultHttpErrorMessage(record.statusCode)
  };
}

function normalizeErrorCode(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || null;
}

function defaultHttpErrorCode(statusCode: number) {
  if (statusCode === 400) return "bad_request";
  if (statusCode === 401) return "unauthorized";
  if (statusCode === 403) return "forbidden";
  if (statusCode === 404) return "not_found";
  if (statusCode === 405) return "method_not_allowed";
  if (statusCode === 413) return "payload_too_large";
  if (statusCode === 415) return "unsupported_media_type";
  if (statusCode === 429) return "rate_limited";
  return "request_error";
}

function defaultHttpErrorMessage(statusCode: number) {
  if (statusCode === 400) return "Bad request";
  if (statusCode === 401) return "Unauthorized";
  if (statusCode === 403) return "Forbidden";
  if (statusCode === 404) return "Not found";
  if (statusCode === 405) return "Method not allowed";
  if (statusCode === 413) return "Payload too large";
  if (statusCode === 415) return "Unsupported media type";
  if (statusCode === 429) return "Too many requests";
  return "Request error";
}
