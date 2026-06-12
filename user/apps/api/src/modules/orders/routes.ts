import type { FastifyInstance, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireAuth } from "../../common/auth.js";
import { AppError } from "../../common/errors.js";
import { prisma } from "../../common/prisma.js";
import { ok } from "../../common/response.js";
import { sub2Client } from "../../integrations/sub2/client.js";
import { requireReadySupplierResourceForDelivery } from "../suppliers/resource-delivery-readiness.js";
import { recordOrderStatusHistory } from "./status-history.js";

const idempotencyKeySchema = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/);

const createOrderSchema = z.object({
  productId: z.string().uuid(),
  priceId: z.string().uuid(),
  idempotencyKey: idempotencyKeySchema.optional()
});

const orderResponseInclude = {
  items: true,
  rentals: true
} satisfies Prisma.OrderInclude;

type OrderResponseRecord = Prisma.OrderGetPayload<{ include: typeof orderResponseInclude }>;

export async function registerOrderRoutes(app: FastifyInstance) {
  app.post("/api/orders", async (request, reply) => {
    const user = await requireAuth(request);
    const input = createOrderSchema.parse(request.body);
    const idempotencyKey = getOrderIdempotencyKey(request, input.idempotencyKey);

    const price = await prisma.productPrice.findUnique({
      where: { id: input.priceId },
      include: { product: true }
    });
    if (!price || price.productId !== input.productId || price.status !== "active" || price.product.status !== "active") {
      throw new AppError("product_price_not_found", "Product price not found", 404);
    }
    const amount = orderPurchaseAmount(price);

    if (idempotencyKey) {
      const existing = await findIdempotentOrder(user.id, idempotencyKey);
      if (existing) {
        ensureIdempotentOrderMatches(existing, input.productId, input.priceId);
        reply.header("Idempotency-Replayed", "true");
        return ok(reply, replayOrderResponse(existing));
      }
    }

    const deliveryReadiness = await requireReadySupplierResourceForDelivery(price.product.resourceType);

    let result: {
      order: Prisma.OrderGetPayload<Record<string, never>>;
      rental: Prisma.RentalGetPayload<Record<string, never>>;
    };

    try {
      result = await prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            userId: user.id,
            idempotencyKey,
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
        await recordOrderStatusHistory(tx, {
          orderId: order.id,
          fromStatus: null,
          toStatus: "provisioning",
          actorUserId: user.id,
          reason: "user.order.create",
          meta: {
            productId: price.productId,
            priceId: price.id,
            amount: String(amount),
            supplierResourceId: deliveryReadiness.resource?.id ?? null
          }
        });
        if (amount.gt(0)) {
          const debit = await tx.walletAccount.updateMany({
            where: {
              userId: user.id,
              availableBalance: { gte: amount }
            },
            data: {
              availableBalance: { decrement: amount },
              totalSpent: { increment: amount }
            }
          });
          if (debit.count !== 1) {
            throw new AppError("insufficient_balance", "Insufficient wallet balance", 402);
          }
          const wallet = await tx.walletAccount.findUniqueOrThrow({ where: { userId: user.id } });
          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              type: "consume",
              amount,
              balanceAfter: wallet.availableBalance,
              refType: "order",
              refId: order.id,
              note: "purchase rental"
            }
          });
        } else {
          await tx.walletAccount.findUniqueOrThrow({ where: { userId: user.id } });
        }

        const endsAt = price.durationDays
          ? new Date(Date.now() + price.durationDays * 24 * 60 * 60 * 1000)
          : null;
        const rental = await tx.rental.create({
          data: {
            userId: user.id,
            orderId: order.id,
            productId: price.productId,
            supplierResourceId: deliveryReadiness.resource?.id ?? null,
            resourceType: price.product.resourceType,
            status: "active",
            endsAt,
            limits: {
              create: {
                maxConcurrency: price.maxConcurrency,
                rpmLimit: price.rpmLimit,
                tpmLimit: price.tpmLimit,
                requestLimit: price.requestLimit,
                spendLimit: price.spendLimit,
                remainingSpend: price.spendLimit
              }
            }
          }
        });

        return { order, rental };
      });
    } catch (error) {
      if (idempotencyKey && isUniqueConstraintError(error)) {
        const existing = await findIdempotentOrder(user.id, idempotencyKey);
        if (existing) {
          ensureIdempotentOrderMatches(existing, input.productId, input.priceId);
          reply.header("Idempotency-Replayed", "true");
          return ok(reply, replayOrderResponse(existing));
        }
      }
      throw error;
    }

    try {
      const sub2Key = await sub2Client.createKey({
        buyerId: user.id,
        rentalId: result.rental.id,
        name: `${price.product.name} - ${user.email}`,
        resourceType: price.product.resourceType,
        maxConcurrency: price.maxConcurrency,
        requestLimit: price.requestLimit,
        spendLimit: price.spendLimit ? String(price.spendLimit) : null
      });

      const updatedRental = await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: result.order.id }, data: { status: "active" } });
        await recordOrderStatusHistory(tx, {
          orderId: result.order.id,
          fromStatus: result.order.status,
          toStatus: "active",
          actorUserId: user.id,
          reason: "user.order.provisioned",
          meta: {
            sub2UserId: sub2Key.sub2UserId,
            sub2KeyId: sub2Key.sub2KeyId,
            supplierResourceId: deliveryReadiness.resource?.id ?? null
          }
        });
        const rental = await tx.rental.update({
          where: { id: result.rental.id },
          data: {
            sub2UserId: sub2Key.sub2UserId,
            sub2KeyId: sub2Key.sub2KeyId,
            supplierResourceId: deliveryReadiness.resource?.id ?? null,
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
        apiKey: sub2Key.apiKey,
        idempotent: false,
        apiKeyAvailable: true
      });
    } catch (error) {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: result.order.id }, data: { status: "failed" } });
        await recordOrderStatusHistory(tx, {
          orderId: result.order.id,
          fromStatus: result.order.status,
          toStatus: "failed",
          actorUserId: user.id,
          reason: "user.order.provision_failed",
          meta: { error: redactError(error) }
        });
        await tx.rental.update({ where: { id: result.rental.id }, data: { status: "closed" } });

        if (amount.gt(0)) {
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
        }
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

function orderPurchaseAmount(price: { fixedPrice: Prisma.Decimal | null; product: { billingMode: string } }) {
  if (price.fixedPrice !== null) return price.fixedPrice;
  if (price.product.billingMode === "pay_as_you_go") return new Prisma.Decimal(0);
  throw new AppError("unsupported_price", "Only fixed price or pay-as-you-go products can be purchased directly");
}

function getOrderIdempotencyKey(request: FastifyRequest, bodyKey?: string) {
  const headerKey = normalizeIdempotencyKey(request.headers["idempotency-key"] ?? request.headers["x-idempotency-key"]);
  if (headerKey && bodyKey && headerKey !== bodyKey) {
    throw new AppError("idempotency_key_conflict", "Idempotency key header and body value do not match", 409);
  }
  return headerKey ?? bodyKey ?? null;
}

function normalizeIdempotencyKey(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return null;
  const parsed = idempotencyKeySchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("invalid_idempotency_key", "Idempotency key must be 1-160 characters using letters, numbers, dot, underscore, colon or dash", 400);
  }
  return parsed.data;
}

async function findIdempotentOrder(userId: string, idempotencyKey: string) {
  return prisma.order.findFirst({
    where: { userId, idempotencyKey },
    include: orderResponseInclude
  });
}

function ensureIdempotentOrderMatches(order: OrderResponseRecord, productId: string, priceId: string) {
  const item = order.items[0];
  if (!item || item.productId !== productId || item.priceId !== priceId) {
    throw new AppError("idempotency_key_conflict", "Idempotency key has already been used for a different order request", 409);
  }
}

function replayOrderResponse(order: OrderResponseRecord) {
  return {
    order,
    rental: order.rentals[0] ?? null,
    apiKey: null,
    idempotent: true,
    apiKeyAvailable: false
  };
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function redactError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}
