import type { FastifyInstance } from "fastify";
import { prisma } from "../../common/prisma.js";
import { ok } from "../../common/response.js";

export async function registerProductRoutes(app: FastifyInstance) {
  app.get("/api/products", async (_request, reply) => {
    const products = await prisma.product.findMany({
      where: {
        status: "active",
        prices: { some: { status: "active" } }
      },
      include: {
        prices: {
          where: { status: "active" }
        }
      },
      orderBy: { createdAt: "asc" }
    });
    return ok(reply, products
      .map((product) => ({
        ...product,
        prices: product.prices.filter((price) => price.fixedPrice !== null || product.billingMode === "pay_as_you_go")
      }))
      .filter((product) => product.prices.length > 0));
  });
}
