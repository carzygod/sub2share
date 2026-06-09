import { Prisma } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../common/prisma.js";
import { sub2Client, type Sub2UsageRecord } from "../integrations/sub2/client.js";

export async function syncSub2UsageOnce(cursor?: string) {
  const result = await sub2Client.fetchUsageSince(cursor);
  let imported = 0;
  let skipped = 0;
  let unmatched = 0;
  for (const record of result.records) {
    const status = await upsertUsage(record);
    if (status === "imported") imported += 1;
    if (status === "skipped") skipped += 1;
    if (status === "unmatched") unmatched += 1;
  }
  return { imported, skipped, unmatched, nextCursor: result.nextCursor };
}

async function upsertUsage(record: Sub2UsageRecord): Promise<"imported" | "skipped" | "unmatched"> {
  const rental = await prisma.rental.findFirst({
    where: { sub2KeyId: record.apiKeyId },
    include: { limits: true }
  });
  if (!rental) return "unmatched";

  const supplierResource = record.upstreamAccountId
    ? await prisma.supplierResource.findFirst({ where: { sub2AccountId: record.upstreamAccountId } })
    : null;

  const apiEquivalentCost = new Prisma.Decimal(record.apiEquivalentCost);
  const buyerCharge = apiEquivalentCost.mul(env.DEFAULT_DISCOUNT_RATE);
  const shareRate = supplierResource?.shareRate ?? new Prisma.Decimal(0);
  const supplierIncome = buyerCharge.mul(shareRate);

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.usageRecord.findUnique({
        where: { sub2RequestId: record.id },
        select: { id: true }
      });
      if (existing) return "skipped";

      const wallet = await tx.walletAccount.findUnique({ where: { userId: rental.userId } });
      const canBillWallet = !buyerCharge.gt(0) || Boolean(wallet && wallet.availableBalance.gte(buyerCharge));

      const usage = await tx.usageRecord.create({
        data: {
          sub2RequestId: record.id,
          rentalId: rental.id,
          userId: rental.userId,
          supplierResourceId: supplierResource?.id,
          resourceType: record.resourceType as never,
          model: record.model,
          inputUnits: record.inputUnits,
          outputUnits: record.outputUnits,
          apiEquivalentCost,
          buyerCharge,
          supplierIncome,
          status: canBillWallet ? "billed" : "pending",
          occurredAt: new Date(record.occurredAt)
        }
      });

      const limitStatus = await updateRentalLimitsAfterUsage(tx, rental.id, buyerCharge);

      if (!canBillWallet) {
        await tx.rental.update({ where: { id: rental.id }, data: { status: "low_balance" } });
        return "imported";
      }

      if (limitStatus.exhausted) {
        await tx.rental.update({ where: { id: rental.id }, data: { status: "limited" } });
      }

      if (wallet && buyerCharge.gt(0)) {
        const nextBalance = wallet.availableBalance.minus(buyerCharge);
        await tx.walletAccount.update({
          where: { id: wallet.id },
          data: {
            availableBalance: nextBalance,
            totalSpent: wallet.totalSpent.plus(buyerCharge)
          }
        });
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "consume",
            amount: buyerCharge,
            balanceAfter: nextBalance,
            refType: "usage",
            refId: usage.id,
            note: "sub2 usage billing"
          }
        });
      }

      if (supplierResource && supplierIncome.gt(0)) {
        await tx.settlementRecord.create({
          data: {
            supplierResourceId: supplierResource.id,
            usageRecordId: usage.id,
            amount: supplierIncome,
            shareRate,
            status: "pending",
            availableAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
          }
        });
      }

      return "imported";
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return "skipped";
    }
    throw error;
  }
}

async function updateRentalLimitsAfterUsage(
  tx: Prisma.TransactionClient,
  rentalId: string,
  buyerCharge: Prisma.Decimal
) {
  const limits = await tx.rentalLimit.findUnique({ where: { rentalId } });
  if (!limits) return { exhausted: false };

  let exhausted = false;
  const data: Prisma.RentalLimitUpdateInput = {};

  if (buyerCharge.gt(0) && (limits.spendLimit || limits.remainingSpend)) {
    const currentRemaining = limits.remainingSpend ?? limits.spendLimit ?? new Prisma.Decimal(0);
    const nextRemaining = currentRemaining.minus(buyerCharge);
    data.remainingSpend = nextRemaining.gt(0) ? nextRemaining : new Prisma.Decimal(0);
    if (nextRemaining.lte(0)) exhausted = true;
  }

  if (limits.requestLimit) {
    const usedRequests = await tx.usageRecord.count({
      where: {
        rentalId,
        status: { in: ["pending", "billed", "disputed"] }
      }
    });
    if (usedRequests >= limits.requestLimit) exhausted = true;
  }

  if (Object.keys(data).length > 0) {
    await tx.rentalLimit.update({ where: { rentalId }, data });
  }

  return { exhausted };
}
