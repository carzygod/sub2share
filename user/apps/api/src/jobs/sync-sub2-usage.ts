import { Prisma } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../common/prisma.js";
import { sub2Client, type Sub2UsageRecord } from "../integrations/sub2/client.js";

export async function syncSub2UsageOnce(cursor?: string) {
  const result = await sub2Client.fetchUsageSince(cursor);
  let imported = 0;
  for (const record of result.records) {
    await upsertUsage(record);
    imported += 1;
  }
  return { imported, nextCursor: result.nextCursor };
}

async function upsertUsage(record: Sub2UsageRecord) {
  const rental = await prisma.rental.findFirst({ where: { sub2KeyId: record.apiKeyId } });
  if (!rental) return;

  const supplierResource = record.upstreamAccountId
    ? await prisma.supplierResource.findFirst({ where: { sub2AccountId: record.upstreamAccountId } })
    : null;

  const apiEquivalentCost = new Prisma.Decimal(record.apiEquivalentCost);
  const buyerCharge = apiEquivalentCost.mul(env.DEFAULT_DISCOUNT_RATE);
  const shareRate = supplierResource?.shareRate ?? new Prisma.Decimal(0);
  const supplierIncome = buyerCharge.mul(shareRate);

  await prisma.$transaction(async (tx) => {
    await tx.usageRecord.upsert({
      where: { sub2RequestId: record.id },
      update: {},
      create: {
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
        status: "billed",
        occurredAt: new Date(record.occurredAt)
      }
    });

    const wallet = await tx.walletAccount.findUnique({ where: { userId: rental.userId } });
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
          refId: record.id,
          note: "sub2 usage billing"
        }
      });
    }

    if (supplierResource && supplierIncome.gt(0)) {
      const usage = await tx.usageRecord.findUniqueOrThrow({ where: { sub2RequestId: record.id } });
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
  });
}
