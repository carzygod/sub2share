import type { FastifyReply } from "fastify";

export function ok<T>(reply: FastifyReply, data: T) {
  return reply.send({
    ok: true,
    data,
    requestId: reply.request.id
  });
}

