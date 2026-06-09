import { prisma } from "../common/prisma.js";
import { sub2Client } from "../integrations/sub2/client.js";

const expirableRentalStatuses = ["active", "low_balance", "limited", "suspended"] as const;

interface ExpireOverdueRentalOptions {
  now?: Date;
  disableSub2?: boolean;
}

interface ExpireOverdueRentalsOptions extends ExpireOverdueRentalOptions {
  limit?: number;
}

interface RentalCandidate {
  id: string;
  userId: string;
  status: string;
  sub2KeyId: string | null;
}

export interface ExpiredRentalResult {
  rentalId: string;
  previousStatus: string;
  apiKeysDeactivated: number;
  sub2Sync: {
    action: "disable" | "none";
    ok: boolean;
    error?: string;
  };
}

export async function expireOverdueRentals(options: ExpireOverdueRentalsOptions = {}) {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 100;
  const rentals = await prisma.rental.findMany({
    where: {
      status: { in: [...expirableRentalStatuses] },
      endsAt: { lte: now }
    },
    select: {
      id: true,
      userId: true,
      status: true,
      sub2KeyId: true
    },
    orderBy: { endsAt: "asc" },
    take: limit
  });

  const results: ExpiredRentalResult[] = [];
  for (const rental of rentals) {
    const result = await expireOverdueRentalByRecord(rental, {
      now,
      disableSub2: options.disableSub2
    });
    if (result) results.push(result);
  }

  return {
    checkedAt: now.toISOString(),
    matched: rentals.length,
    expired: results.length,
    apiKeysDeactivated: results.reduce((sum, result) => sum + result.apiKeysDeactivated, 0),
    sub2Disabled: results.filter((result) => result.sub2Sync.action === "disable" && result.sub2Sync.ok).length,
    sub2DisableFailed: results.filter((result) => result.sub2Sync.action === "disable" && !result.sub2Sync.ok).length,
    results
  };
}

export async function expireOverdueRental(rentalId: string, options: ExpireOverdueRentalOptions = {}) {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    select: {
      id: true,
      userId: true,
      status: true,
      sub2KeyId: true,
      endsAt: true
    }
  });
  if (!rental || !isOverdue(rental.endsAt, options.now ?? new Date())) return null;
  return expireOverdueRentalByRecord(rental, options);
}

async function expireOverdueRentalByRecord(rental: RentalCandidate, options: ExpireOverdueRentalOptions) {
  const now = options.now ?? new Date();
  const transition = await prisma.$transaction(async (tx) => {
    const current = await tx.rental.findUnique({
      where: { id: rental.id },
      select: { status: true, endsAt: true }
    });
    if (!current || !isExpirableStatus(current.status) || !isOverdue(current.endsAt, now)) return null;

    await tx.rental.update({
      where: { id: rental.id },
      data: { status: "expired" }
    });
    const apiKeys = await tx.apiKey.updateMany({
      where: { rentalId: rental.id, status: { not: "inactive" } },
      data: { status: "inactive" }
    });

    return {
      previousStatus: current.status,
      apiKeysDeactivated: apiKeys.count
    };
  });

  if (!transition) return null;

  return {
    rentalId: rental.id,
    previousStatus: transition.previousStatus,
    apiKeysDeactivated: transition.apiKeysDeactivated,
    sub2Sync: options.disableSub2 === false
      ? { action: "none" as const, ok: true }
      : await disableSub2KeyBestEffort(rental)
  };
}

function isExpirableStatus(status: string) {
  return (expirableRentalStatuses as readonly string[]).includes(status);
}

function isOverdue(endsAt: Date | null, now: Date) {
  return Boolean(endsAt && endsAt.getTime() <= now.getTime());
}

async function disableSub2KeyBestEffort(rental: RentalCandidate) {
  if (!rental.userId || !rental.sub2KeyId) {
    return { action: "none" as const, ok: true };
  }

  try {
    await sub2Client.disableKey(rental.userId, rental.sub2KeyId);
    return { action: "disable" as const, ok: true };
  } catch (error) {
    return {
      action: "disable" as const,
      ok: false,
      error: redactSensitiveText(error instanceof Error ? error.message : String(error))
    };
  }
}

function redactSensitiveText(value: string) {
  return value
    .replace(/(access_token|refresh_token|id_token|token|key|password)\s*[:=]\s*[^,}\s]+/gi, "$1:[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/g, "Bearer [REDACTED]")
    .replace(/(zyz_[A-Za-z0-9]{8})[A-Za-z0-9]+/g, "$1[REDACTED]")
    .replace(/(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, "$1[REDACTED]");
}
