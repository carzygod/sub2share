import type { FastifyInstance } from "fastify";
import { prisma } from "../../common/prisma.js";
import { ok } from "../../common/response.js";

export async function registerProductRoutes(app: FastifyInstance) {
  app.get("/api/products", async (_request, reply) => {
    const products = await prisma.product.findMany({
      where: {
        status: "active",
        prices: { some: { status: "active", fixedPrice: { not: null } } }
      },
      include: {
        prices: {
          where: { status: "active", fixedPrice: { not: null } }
        }
      },
      orderBy: { createdAt: "asc" }
    });
    return ok(reply, products);
  });
}
