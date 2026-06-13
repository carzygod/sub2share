import type { FastifyInstance } from "fastify";
import { prisma } from "../../common/prisma.js";
import { ok } from "../../common/response.js";
import {
  inspectLatestCodexProxySmokeDeliveryReadiness,
  publicProductDeliveryReadinessFields,
  readyCodexSupplierResourceDeliveryWhere
} from "../suppliers/resource-delivery-readiness.js";

export async function registerProductRoutes(app: FastifyInstance) {
  app.get("/api/products", async (_request, reply) => {
    const [products, readyCodexDeliveryResources, codexProxySmokeDeliveryReadiness] = await Promise.all([
      prisma.product.findMany({
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
      }),
      prisma.supplierResource.count({ where: readyCodexSupplierResourceDeliveryWhere() }),
      inspectLatestCodexProxySmokeDeliveryReadiness("codex")
    ]);
    return ok(reply, products
      .map((product) => ({
        ...product,
        ...publicProductDeliveryReadinessFields({
          resourceType: product.resourceType,
          readyCodexDeliveryResources,
          codexProxySmokeDeliveryReadiness
        }),
        prices: product.prices.filter((price) => price.fixedPrice !== null || product.billingMode === "pay_as_you_go")
      }))
      .filter((product) => product.prices.length > 0));
  });
}
