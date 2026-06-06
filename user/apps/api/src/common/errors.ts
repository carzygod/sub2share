import type { FastifyReply } from "fastify";

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

  reply.request.log.error(error);
  return reply.status(500).send({
    ok: false,
    error: { code: "internal_error", message: "Internal server error" },
    requestId
  });
}

