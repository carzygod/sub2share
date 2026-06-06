import type { FastifyInstance } from "fastify";
import { requireRole } from "../../common/auth.js";
import { prisma } from "../../common/prisma.js";
import { ok } from "../../common/response.js";

export async function registerAdminRoutes(app: FastifyInstance) {
  app.get("/api/admin/dashboard", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const [users, activeRentals, onlineResources, pendingWithdrawals, usageAgg] = await Promise.all([
      prisma.user.count(),
      prisma.rental.count({ where: { status: "active" } }),
      prisma.supplierResource.count({ where: { status: "online" } }),
      prisma.withdrawal.count({ where: { status: "pending" } }),
      prisma.usageRecord.aggregate({
        _sum: { buyerCharge: true, supplierIncome: true },
        _count: true
      })
    ]);

    return ok(reply, {
      users,
      activeRentals,
      onlineResources,
      pendingWithdrawals,
      usageCount: usageAgg._count,
      gmv: usageAgg._sum.buyerCharge ?? 0,
      supplierIncome: usageAgg._sum.supplierIncome ?? 0
    });
  });

  app.get("/api/admin/users", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const users = await prisma.user.findMany({
      include: { roles: true, wallet: true },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    return ok(reply, users);
  });

  app.get("/api/admin/orders", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const orders = await prisma.order.findMany({
      include: { user: true, items: true, rentals: true },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    return ok(reply, orders);
  });

  app.get("/api/admin/resources", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const resources = await prisma.supplierResource.findMany({
      include: { supplier: { include: { user: true } } },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    return ok(reply, resources);
  });
}

