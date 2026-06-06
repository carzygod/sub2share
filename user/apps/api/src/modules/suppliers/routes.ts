import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../common/auth.js";
import { AppError } from "../../common/errors.js";
import { prisma } from "../../common/prisma.js";
import { ok } from "../../common/response.js";

const applySchema = z.object({
  displayName: z.string().min(1).max(64).optional()
});

const resourceSchema = z.object({
  resourceType: z.enum(["codex", "claude_code", "gemini", "antigravity"]),
  maxConcurrency: z.coerce.number().int().min(1).max(20).default(1),
  reserveRatio: z.coerce.number().min(0).max(1).default(0.2),
  dailyCap: z.coerce.number().positive().optional()
});

export async function registerSupplierRoutes(app: FastifyInstance) {
  app.post("/api/supplier/apply", async (request, reply) => {
    const user = await requireAuth(request);
    const input = applySchema.parse(request.body);
    const supplier = await prisma.$transaction(async (tx) => {
      await tx.userRole.upsert({
        where: { userId_role: { userId: user.id, role: "supplier" } },
        update: {},
        create: { userId: user.id, role: "supplier" }
      });
      return tx.supplier.upsert({
        where: { userId: user.id },
        update: { displayName: input.displayName },
        create: { userId: user.id, displayName: input.displayName }
      });
    });
    return ok(reply, supplier);
  });

  app.get("/api/supplier/profile", async (request, reply) => {
    const user = await requireAuth(request);
    const supplier = await prisma.supplier.findUnique({
      where: { userId: user.id },
      include: { resources: true }
    });
    if (!supplier) throw new AppError("supplier_not_found", "Supplier profile not found", 404);
    return ok(reply, supplier);
  });

  app.post("/api/supplier/resources", async (request, reply) => {
    const user = await requireAuth(request);
    const input = resourceSchema.parse(request.body);
    const supplier = await prisma.supplier.findUnique({ where: { userId: user.id } });
    if (!supplier) throw new AppError("supplier_not_found", "Supplier profile not found", 404);
    const resource = await prisma.supplierResource.create({
      data: {
        supplierId: supplier.id,
        resourceType: input.resourceType,
        maxConcurrency: input.maxConcurrency,
        reserveRatio: input.reserveRatio,
        dailyCap: input.dailyCap,
        status: "pending"
      }
    });
    return ok(reply, resource);
  });

  app.get("/api/supplier/resources", async (request, reply) => {
    const user = await requireAuth(request);
    const supplier = await prisma.supplier.findUnique({ where: { userId: user.id } });
    if (!supplier) throw new AppError("supplier_not_found", "Supplier profile not found", 404);
    const resources = await prisma.supplierResource.findMany({
      where: { supplierId: supplier.id },
      orderBy: { createdAt: "desc" }
    });
    return ok(reply, resources);
  });

  app.get("/api/supplier/settlements", async (request, reply) => {
    const user = await requireAuth(request);
    const supplier = await prisma.supplier.findUnique({ where: { userId: user.id }, include: { resources: true } });
    if (!supplier) throw new AppError("supplier_not_found", "Supplier profile not found", 404);
    const settlements = await prisma.settlementRecord.findMany({
      where: { supplierResourceId: { in: supplier.resources.map((resource) => resource.id) } },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    return ok(reply, settlements);
  });
}

