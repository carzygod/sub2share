import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../common/auth.js";
import { AppError } from "../../common/errors.js";
import { prisma } from "../../common/prisma.js";
import { ok } from "../../common/response.js";
import { sub2Client } from "../../integrations/sub2/client.js";

export async function registerRentalRoutes(app: FastifyInstance) {
  app.get("/api/rentals", async (request, reply) => {
    const user = await requireAuth(request);
    const rentals = await prisma.rental.findMany({
      where: { userId: user.id },
      include: { product: true, limits: true },
      orderBy: { createdAt: "desc" }
    });
    return ok(reply, rentals);
  });

  app.get("/api/rentals/:id", async (request, reply) => {
    const user = await requireAuth(request);
    const { id } = request.params as { id: string };
    const rental = await prisma.rental.findFirst({
      where: { id, userId: user.id },
      include: { product: true, limits: true, usages: { orderBy: { occurredAt: "desc" }, take: 50 } }
    });
    if (!rental) throw new AppError("rental_not_found", "Rental not found", 404);
    return ok(reply, rental);
  });

  app.post("/api/rentals/:id/suspend", async (request, reply) => {
    const user = await requireAuth(request);
    const { id } = request.params as { id: string };
    const rental = await prisma.rental.findFirst({ where: { id, userId: user.id } });
    if (!rental) throw new AppError("rental_not_found", "Rental not found", 404);
    if (rental.sub2KeyId) await sub2Client.disableKey(rental.userId, rental.sub2KeyId);
    const updated = await prisma.rental.update({ where: { id }, data: { status: "suspended" } });
    return ok(reply, updated);
  });

  app.post("/api/rentals/:id/resume", async (request, reply) => {
    const user = await requireAuth(request);
    const { id } = request.params as { id: string };
    const rental = await prisma.rental.findFirst({ where: { id, userId: user.id } });
    if (!rental) throw new AppError("rental_not_found", "Rental not found", 404);
    if (rental.sub2KeyId) await sub2Client.enableKey(rental.userId, rental.sub2KeyId);
    const updated = await prisma.rental.update({ where: { id }, data: { status: "active" } });
    return ok(reply, updated);
  });
}
