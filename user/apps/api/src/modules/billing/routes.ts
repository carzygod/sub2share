import type { FastifyInstance } from "fastify";
import { requireRole } from "../../common/auth.js";
import { prisma } from "../../common/prisma.js";
import { ok } from "../../common/response.js";
import { syncSub2UsageOnce } from "../../jobs/sync-sub2-usage.js";

export async function registerBillingRoutes(app: FastifyInstance) {
  app.post("/api/billing/sync-sub2-usage", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const result = await syncSub2UsageOnce(undefined, { persistCursor: true });
    return ok(reply, result);
  });

  app.get("/api/usages", async (request, reply) => {
    const user = await request.jwtVerify<{ id: string }>();
    const usages = await prisma.usageRecord.findMany({
      where: { userId: user.id },
      orderBy: { occurredAt: "desc" },
      take: 100
    });
    return ok(reply, usages);
  });
}
