import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../common/auth.js";
import { AppError } from "../../common/errors.js";
import { prisma } from "../../common/prisma.js";
import { ok } from "../../common/response.js";
import { sub2Client } from "../../integrations/sub2/client.js";
import { rotateRentalApiKey } from "./key-rotation.js";

export async function registerRentalRoutes(app: FastifyInstance) {
  app.get("/api/rentals", async (request, reply) => {
    const user = await requireAuth(request);
    const rentals = await prisma.rental.findMany({
      where: { userId: user.id },
      include: { product: true, limits: true },
      orderBy: { createdAt: "desc" }
    });
    return ok(reply, rentals.map(publicRental));
  });

  app.get("/api/rentals/:id", async (request, reply) => {
    const user = await requireAuth(request);
    const { id } = request.params as { id: string };
    const rental = await prisma.rental.findFirst({
      where: { id, userId: user.id },
      include: { product: true, limits: true, usages: { orderBy: { occurredAt: "desc" }, take: 50 } }
    });
    if (!rental) throw new AppError("rental_not_found", "Rental not found", 404);
    return ok(reply, publicRental(rental));
  });

  app.post("/api/rentals/:id/rotate-key", async (request, reply) => {
    const user = await requireAuth(request);
    const { id } = request.params as { id: string };
    const result = await rotateRentalApiKey({ rentalId: id, userId: user.id });
    return ok(reply, {
      rental: publicRental(result.rental),
      apiKey: result.apiKey,
      oldSub2KeyDisabled: result.oldSub2KeyDisabled
    });
  });

  app.post("/api/rentals/:id/suspend", async (request, reply) => {
    const user = await requireAuth(request);
    const { id } = request.params as { id: string };
    const rental = await prisma.rental.findFirst({ where: { id, userId: user.id } });
    if (!rental) throw new AppError("rental_not_found", "Rental not found", 404);
    if (rental.sub2KeyId) await sub2Client.disableKey(rental.userId, rental.sub2KeyId);
    const updated = await prisma.rental.update({ where: { id }, data: { status: "suspended" } });
    return ok(reply, publicRental(updated));
  });

  app.post("/api/rentals/:id/resume", async (request, reply) => {
    const user = await requireAuth(request);
    const { id } = request.params as { id: string };
    const rental = await prisma.rental.findFirst({ where: { id, userId: user.id } });
    if (!rental) throw new AppError("rental_not_found", "Rental not found", 404);
    if (rental.sub2KeyId) await sub2Client.enableKey(rental.userId, rental.sub2KeyId);
    const updated = await prisma.rental.update({ where: { id }, data: { status: "active" } });
    return ok(reply, publicRental(updated));
  });
}

function publicRental<T extends { sub2KeyHash?: string | null; user?: unknown; order?: unknown; apiKeys?: unknown }>(rental: T) {
  const {
    sub2KeyHash: _sub2KeyHash,
    user: _user,
    order: _order,
    apiKeys: _apiKeys,
    ...safeRental
  } = rental;
  return safeRental;
}
