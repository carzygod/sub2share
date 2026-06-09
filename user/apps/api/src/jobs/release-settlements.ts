import { Prisma } from "@prisma/client";
import { prisma } from "../common/prisma.js";

interface ReleaseAvailableSettlementsOptions {
  now?: Date;
  limit?: number;
}

export async function releaseAvailableSettlements(options: ReleaseAvailableSettlementsOptions = {}) {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 200;
  const settlements = await prisma.settlementRecord.findMany({
    where: {
      status: "pending",
      availableAt: { lte: now }
    },
    select: {
      id: true,
      amount: true,
      supplierResourceId: true,
      availableAt: true
    },
    orderBy: { availableAt: "asc" },
    take: limit
  });

  if (settlements.length === 0) {
    return {
      checkedAt: now.toISOString(),
      matched: 0,
      released: 0,
      amountMatched: "0",
      settlementIds: []
    };
  }

  const update = await prisma.settlementRecord.updateMany({
    where: {
      id: { in: settlements.map((settlement) => settlement.id) },
      status: "pending"
    },
    data: { status: "available" }
  });

  const amountMatched = settlements.reduce(
    (sum, settlement) => sum.plus(settlement.amount),
    new Prisma.Decimal(0)
  );
  return {
    checkedAt: now.toISOString(),
    matched: settlements.length,
    released: update.count,
    amountMatched: String(amountMatched),
    settlementIds: settlements.map((settlement) => settlement.id)
  };
}
