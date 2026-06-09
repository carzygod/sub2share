import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { requireAuth } from "../../common/auth.js";
import { AppError } from "../../common/errors.js";
import { prisma } from "../../common/prisma.js";
import { ok } from "../../common/response.js";
import { env } from "../../config/env.js";
import { sub2Client } from "../../integrations/sub2/client.js";
import { rotateRentalApiKey } from "./key-rotation.js";

const terminalRentalStatuses = new Set(["expired", "refunded", "closed"]);

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
    if (terminalRentalStatuses.has(rental.status)) {
      throw new AppError("rental_not_suspendable", "Terminal rentals cannot be suspended", 400);
    }
    if (isExpired(rental)) {
      await expireRental(rental.id);
      await disableRentalKeyBestEffort(rental);
      throw new AppError("rental_expired", "Rental has expired", 403);
    }
    if (rental.status === "suspended") {
      return ok(reply, publicRental(rental));
    }
    if (rental.sub2KeyId) await sub2Client.disableKey(rental.userId, rental.sub2KeyId);
    const updated = await prisma.rental.update({ where: { id }, data: { status: "suspended" } });
    return ok(reply, publicRental(updated));
  });

  app.post("/api/rentals/:id/resume", async (request, reply) => {
    const user = await requireAuth(request);
    const { id } = request.params as { id: string };
    const rental = await prisma.rental.findFirst({
      where: { id, userId: user.id },
      include: {
        limits: true,
        user: { include: { wallet: true } }
      }
    });
    if (!rental) throw new AppError("rental_not_found", "Rental not found", 404);
    if (terminalRentalStatuses.has(rental.status)) {
      throw new AppError("rental_not_resumable", "Terminal rentals cannot be resumed", 400);
    }
    if (isExpired(rental)) {
      await expireRental(rental.id);
      await disableRentalKeyBestEffort(rental);
      throw new AppError("rental_expired", "Rental has expired", 403);
    }
    if (rental.status === "active") {
      return ok(reply, publicRental(rental));
    }
    if (!["suspended", "low_balance", "limited"].includes(rental.status)) {
      throw new AppError("rental_not_resumable", `Rental cannot be resumed from ${rental.status}`, 400);
    }
    if (!hasEnoughWalletBalance(rental.user.wallet)) {
      throw new AppError("insufficient_balance", "Wallet balance is not enough to resume this rental", 402);
    }
    const limitStatus = await rentalLimitStatus(rental.id, rental.limits);
    if (limitStatus.exhausted) {
      throw new AppError(limitStatus.code, limitStatus.message, 402);
    }
    if (rental.sub2KeyId) await sub2Client.enableKey(rental.userId, rental.sub2KeyId);
    const updated = await prisma.rental.update({ where: { id }, data: { status: "active" } });
    return ok(reply, publicRental(updated));
  });
}

function isExpired(rental: { endsAt?: Date | null }) {
  return Boolean(rental.endsAt && rental.endsAt.getTime() <= Date.now());
}

async function expireRental(rentalId: string) {
  await prisma.$transaction([
    prisma.rental.update({ where: { id: rentalId }, data: { status: "expired" } }),
    prisma.apiKey.updateMany({ where: { rentalId }, data: { status: "inactive" } })
  ]);
}

async function disableRentalKeyBestEffort(rental: { userId: string; sub2KeyId?: string | null }) {
  if (!rental.sub2KeyId) return;
  try {
    await sub2Client.disableKey(rental.userId, rental.sub2KeyId);
  } catch {
    // Expiry is authoritative locally; Sub2 sync can be retried by admin status controls.
  }
}

function hasEnoughWalletBalance(wallet: { availableBalance: Prisma.Decimal } | null | undefined) {
  const minimumBalance = new Prisma.Decimal(env.OPENAI_PROXY_MIN_WALLET_BALANCE);
  return Boolean(wallet && wallet.availableBalance.gt(minimumBalance));
}

async function rentalLimitStatus(
  rentalId: string,
  limits: { remainingSpend?: Prisma.Decimal | null; requestLimit?: number | null } | null
) {
  if (limits?.remainingSpend && limits.remainingSpend.lte(0)) {
    return {
      exhausted: true as const,
      code: "spend_limit_exhausted",
      message: "Rental spend limit has been exhausted"
    };
  }

  if (limits?.requestLimit) {
    const usedRequests = await prisma.usageRecord.count({
      where: {
        rentalId,
        status: { in: ["pending", "billed", "disputed"] }
      }
    });
    if (usedRequests >= limits.requestLimit) {
      return {
        exhausted: true as const,
        code: "request_limit_exceeded",
        message: "Rental request limit has been exhausted"
      };
    }
  }

  return { exhausted: false as const };
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
