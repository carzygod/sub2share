import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { AppError } from "../../common/errors.js";
import { prisma } from "../../common/prisma.js";
import { sub2Client } from "../../integrations/sub2/client.js";
import { requireReadySupplierResourceForDelivery } from "../suppliers/resource-delivery-readiness.js";

export interface RotateRentalKeyInput {
  rentalId: string;
  userId?: string;
}

export async function rotateRentalApiKey(input: RotateRentalKeyInput) {
  const rental = await prisma.rental.findFirst({
    where: {
      id: input.rentalId,
      ...(input.userId ? { userId: input.userId } : {})
    },
    include: {
      user: true,
      product: true,
      limits: true,
      order: true,
      apiKeys: { orderBy: { createdAt: "desc" } }
    }
  });

  if (!rental) throw new AppError("rental_not_found", "Rental not found", 404);
  if (rental.status !== "active") {
    throw new AppError("rental_not_active", "Only active rentals can rotate API keys", 400);
  }
  if (rental.endsAt && rental.endsAt.getTime() <= Date.now()) {
    await prisma.$transaction([
      prisma.rental.update({ where: { id: rental.id }, data: { status: "expired" } }),
      prisma.apiKey.updateMany({ where: { rentalId: rental.id }, data: { status: "inactive" } })
    ]);
    if (rental.sub2KeyId) await disableSub2KeyBestEffort(rental.userId, rental.sub2KeyId);
    throw new AppError("rental_expired", "Rental has expired", 403);
  }
  const remainingSpend = effectiveRemainingSpend(rental.limits);
  if (remainingSpend && remainingSpend.lte(0)) {
    throw new AppError("spend_limit_exhausted", "Rental spend limit has been exhausted", 402);
  }

  const deliveryReadiness = await requireReadySupplierResourceForDelivery(rental.resourceType);

  const previousSub2KeyId = rental.sub2KeyId;
  const previousApiKeyIds = rental.apiKeys.map((apiKey) => apiKey.id);
  const sub2Key = await sub2Client.createKey({
    buyerId: rental.userId,
    rentalId: rental.id,
    name: `${rental.product.name} - ${rental.user.email} - rotated`,
    resourceType: rental.resourceType,
    maxConcurrency: rental.limits?.maxConcurrency ?? 1,
    requestLimit: rental.limits?.requestLimit ?? null,
    spendLimit: remainingSpend ? String(remainingSpend) : null
  });

  try {
    const updatedRental = await prisma.$transaction(async (tx) => {
      await tx.apiKey.updateMany({
        where: { rentalId: rental.id },
        data: { status: "inactive" }
      });

      await tx.rental.update({
        where: { id: rental.id },
        data: {
          sub2UserId: sub2Key.sub2UserId,
          sub2KeyId: sub2Key.sub2KeyId,
          supplierResourceId: deliveryReadiness.resource?.id ?? null,
          sub2KeyHash: hashSecret(sub2Key.apiKey),
          endpointUrl: sub2Key.endpointUrl
        }
      });

      await tx.apiKey.create({
        data: {
          userId: rental.userId,
          rentalId: rental.id,
          name: `${rental.product.name} rotated`,
          keyPrefix: sub2Key.apiKey.slice(0, 12),
          keyHash: hashSecret(sub2Key.apiKey)
        }
      });

      await upsertSub2Binding(tx, rental.id, "user", sub2Key.sub2UserId, {
        rotatedAt: new Date().toISOString()
      });
      await upsertSub2Binding(tx, rental.id, "api_key", sub2Key.sub2KeyId, {
        rotatedAt: new Date().toISOString(),
        previousSub2KeyId
      });
      if (previousSub2KeyId && previousSub2KeyId !== sub2Key.sub2KeyId) {
        await upsertHistoricalApiKeyBinding(tx, rental.id, previousSub2KeyId, {
          rentalId: rental.id,
          rotatedAt: new Date().toISOString(),
          replacedBySub2KeyId: sub2Key.sub2KeyId,
          previousApiKeyIds
        });
      }

      return tx.rental.findUniqueOrThrow({
        where: { id: rental.id },
        include: {
          user: true,
          product: true,
          limits: true,
          order: true,
          supplierResource: { include: { supplier: { include: { user: true } } } },
          apiKeys: { orderBy: { createdAt: "desc" }, take: 20 }
        }
      });
    });

    const oldKeyDisable = previousSub2KeyId && previousSub2KeyId !== sub2Key.sub2KeyId
      ? await disableSub2KeyBestEffort(rental.userId, previousSub2KeyId)
      : { ok: true as const };

    return {
      rental: updatedRental,
      apiKey: sub2Key.apiKey,
      sub2KeyId: sub2Key.sub2KeyId,
      previousSub2KeyId,
      previousApiKeyIds,
      oldSub2KeyDisabled: oldKeyDisable.ok,
      oldSub2KeyDisableError: oldKeyDisable.ok ? null : oldKeyDisable.error
    };
  } catch (error) {
    await disableSub2KeyBestEffort(rental.userId, sub2Key.sub2KeyId);
    throw error;
  }
}

async function upsertSub2Binding(
  tx: Prisma.TransactionClient,
  rentalId: string,
  sub2Type: string,
  sub2Id: string,
  meta: Prisma.InputJsonObject
) {
  await tx.sub2Binding.upsert({
    where: {
      objectType_objectId_sub2Type: {
        objectType: "rental",
        objectId: rentalId,
        sub2Type
      }
    },
    update: { sub2Id, meta },
    create: {
      objectType: "rental",
      objectId: rentalId,
      sub2Type,
      sub2Id,
      meta
    }
  });
}

async function upsertHistoricalApiKeyBinding(
  tx: Prisma.TransactionClient,
  rentalId: string,
  sub2KeyId: string,
  meta: Prisma.InputJsonObject
) {
  await tx.sub2Binding.upsert({
    where: {
      objectType_objectId_sub2Type: {
        objectType: "rental_api_key_history",
        objectId: `${rentalId}:${sub2KeyId}`,
        sub2Type: "api_key"
      }
    },
    update: {
      sub2Id: sub2KeyId,
      meta
    },
    create: {
      objectType: "rental_api_key_history",
      objectId: `${rentalId}:${sub2KeyId}`,
      sub2Type: "api_key",
      sub2Id: sub2KeyId,
      meta
    }
  });
}

async function disableSub2KeyBestEffort(buyerId: string, keyId: string) {
  try {
    await sub2Client.disableKey(buyerId, keyId);
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: redactSensitiveText(error instanceof Error ? error.message : String(error))
    };
  }
}

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function effectiveRemainingSpend(limits: { remainingSpend?: Prisma.Decimal | null; spendLimit?: Prisma.Decimal | null } | null) {
  return limits?.remainingSpend ?? limits?.spendLimit ?? null;
}

function redactSensitiveText(value: string) {
  return value
    .replace(/(access_token|refresh_token|id_token|token|key|password)\s*[:=]\s*[^,}\s]+/gi, "$1:[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/g, "Bearer [REDACTED]")
    .replace(/(zyz_[A-Za-z0-9]{8})[A-Za-z0-9]+/g, "$1[REDACTED]")
    .replace(/(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, "$1[REDACTED]");
}
