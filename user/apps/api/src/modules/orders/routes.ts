import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireAuth } from "../../common/auth.js";
import { AppError } from "../../common/errors.js";
import { prisma } from "../../common/prisma.js";
import { ok } from "../../common/response.js";
import { sub2Client } from "../../integrations/sub2/client.js";

const createOrderSchema = z.object({
  productId: z.string().uuid(),
  priceId: z.string().uuid()
});

export async function registerOrderRoutes(app: FastifyInstance) {
  app.post("/api/orders", async (request, reply) => {
    const user = await requireAuth(request);
    const input = createOrderSchema.parse(request.body);

    const price = await prisma.productPrice.findUnique({
      where: { id: input.priceId },
      include: { product: true }
    });
    if (!price || price.productId !== input.productId || price.status !== "active") {
      throw new AppError("product_price_not_found", "Product price not found", 404);
    }
    const amount = price.fixedPrice ?? 0;
    if (!price.fixedPrice) {
      throw new AppError("unsupported_price", "Only fixed price products can be purchased directly in MVP");
    }

    const result = await prisma.$transaction(async (tx) => {
      const wallet = await tx.walletAccount.findUniqueOrThrow({ where: { userId: user.id } });
      if (wallet.availableBalance.lessThan(amount)) {
        throw new AppError("insufficient_balance", "Insufficient wallet balance", 402);
      }
      const nextBalance = wallet.availableBalance.minus(amount);
      await tx.walletAccount.update({
        where: { id: wallet.id },
        data: {
          availableBalance: nextBalance,
          totalSpent: wallet.totalSpent.plus(amount)
        }
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "consume",
          amount,
          balanceAfter: nextBalance,
          refType: "order",
          note: "purchase rental"
        }
      });

      const order = await tx.order.create({
        data: {
          userId: user.id,
          status: "provisioning",
          totalAmount: amount,
          paidAmount: amount,
          items: {
            create: {
              productId: price.productId,
              priceId: price.id,
              amount
            }
          }
        }
      });

      const endsAt = price.durationDays
        ? new Date(Date.now() + price.durationDays * 24 * 60 * 60 * 1000)
        : null;
      const rental = await tx.rental.create({
        data: {
          userId: user.id,
          orderId: order.id,
          productId: price.productId,
          resourceType: price.product.resourceType,
          status: "active",
          endsAt,
          limits: {
            create: {
              maxConcurrency: price.maxConcurrency,
              requestLimit: price.requestLimit
            }
          }
        }
      });

      return { order, rental };
    });

    try {
      const sub2Key = await sub2Client.createKey({
        buyerId: user.id,
        rentalId: result.rental.id,
        name: `${price.product.name} - ${user.email}`,
        resourceType: price.product.resourceType,
        maxConcurrency: price.maxConcurrency,
        requestLimit: price.requestLimit,
        spendLimit: null
      });

      const updatedRental = await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: result.order.id }, data: { status: "active" } });
        const rental = await tx.rental.update({
          where: { id: result.rental.id },
          data: {
            sub2UserId: sub2Key.sub2UserId,
            sub2KeyId: sub2Key.sub2KeyId,
            endpointUrl: sub2Key.endpointUrl,
            sub2KeyHash: hashSecret(sub2Key.apiKey)
          }
        });

        await tx.apiKey.create({
          data: {
            userId: user.id,
            rentalId: result.rental.id,
            name: price.product.name,
            keyPrefix: sub2Key.apiKey.slice(0, 12),
            keyHash: hashSecret(sub2Key.apiKey)
          }
        });

        await tx.sub2Binding.createMany({
          data: [
            { objectType: "rental", objectId: result.rental.id, sub2Type: "user", sub2Id: sub2Key.sub2UserId },
            { objectType: "rental", objectId: result.rental.id, sub2Type: "api_key", sub2Id: sub2Key.sub2KeyId }
          ],
          skipDuplicates: true
        });

        return rental;
      });

      return ok(reply, {
        order: { ...result.order, status: "active" },
        rental: updatedRental,
        apiKey: sub2Key.apiKey
      });
    } catch (error) {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: result.order.id }, data: { status: "failed" } });
        await tx.rental.update({ where: { id: result.rental.id }, data: { status: "closed" } });

        const wallet = await tx.walletAccount.findUniqueOrThrow({ where: { userId: user.id } });
        const nextBalance = wallet.availableBalance.plus(amount);
        const nextSpent = wallet.totalSpent.lessThan(amount) ? 0 : wallet.totalSpent.minus(amount);
        await tx.walletAccount.update({
          where: { id: wallet.id },
          data: {
            availableBalance: nextBalance,
            totalSpent: nextSpent
          }
        });
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "refund",
            amount,
            balanceAfter: nextBalance,
            refType: "order",
            refId: result.order.id,
            note: "provisioning failed"
          }
        });
      });
      throw error;
    }
  });

  app.get("/api/orders", async (request, reply) => {
    const user = await requireAuth(request);
    const orders = await prisma.order.findMany({
      where: { userId: user.id },
      include: { items: true, rentals: true },
      orderBy: { createdAt: "desc" }
    });
    return ok(reply, orders);
  });
}

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
