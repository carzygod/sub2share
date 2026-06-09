import { Prisma } from "@prisma/client";
import { isLocalProxySmokeMeta } from "../common/internal-records.js";
import { env } from "../config/env.js";
import { prisma } from "../common/prisma.js";
import { sub2Client, type Sub2UsageRecord } from "../integrations/sub2/client.js";

const SUB2_USAGE_SYNC_SOURCE = "sub2_usage";

interface SyncSub2UsageOptions {
  persistCursor?: boolean;
}

interface BillingRule {
  source: "product_price" | "default_discount_rate";
  priceId: string | null;
  tierCode: string | null;
  discountRate: Prisma.Decimal;
  tierMultiplier: Prisma.Decimal;
}

export async function syncSub2UsageOnce(cursor?: string, options: SyncSub2UsageOptions = {}) {
  if (options.persistCursor) {
    return syncSub2UsageWithState(cursor);
  }

  return syncSub2UsageFromCursor(cursor);
}

export async function getSub2UsageSyncState() {
  const [state, runs] = await Promise.all([
    prisma.billingSyncState.findUnique({ where: { id: SUB2_USAGE_SYNC_SOURCE } }),
    prisma.billingSyncRun.findMany({
      where: { source: SUB2_USAGE_SYNC_SOURCE },
      orderBy: { startedAt: "desc" },
      take: 10
    })
  ]);

  return { state, runs };
}

async function syncSub2UsageWithState(cursor?: string) {
  const startedAt = new Date();
  const state = await prisma.billingSyncState.upsert({
    where: { id: SUB2_USAGE_SYNC_SOURCE },
    update: {
      lastStartedAt: startedAt,
      lastStatus: "running",
      lastError: null
    },
    create: {
      id: SUB2_USAGE_SYNC_SOURCE,
      lastStartedAt: startedAt,
      lastStatus: "running"
    }
  });
  const cursorIn = cursor ?? state.cursor ?? undefined;
  const run = await prisma.billingSyncRun.create({
    data: {
      source: SUB2_USAGE_SYNC_SOURCE,
      cursorIn,
      status: "running",
      startedAt
    }
  });

  try {
    const result = await syncSub2UsageFromCursor(cursorIn);
    const finishedAt = new Date();
    const cursorOut = result.nextCursor ?? cursorIn;
    await prisma.$transaction([
      prisma.billingSyncRun.update({
        where: { id: run.id },
        data: {
          status: "success",
          imported: result.imported,
          skipped: result.skipped,
          unmatched: result.unmatched,
          cursorOut,
          finishedAt
        }
      }),
      prisma.billingSyncState.update({
        where: { id: SUB2_USAGE_SYNC_SOURCE },
        data: {
          cursor: cursorOut,
          lastStatus: "success",
          lastError: null,
          lastImported: result.imported,
          lastSkipped: result.skipped,
          lastUnmatched: result.unmatched,
          lastFinishedAt: finishedAt
        }
      })
    ]);
    return { ...result, cursorIn, cursorOut, runId: run.id };
  } catch (error) {
    const finishedAt = new Date();
    const message = redactSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 2000);
    await prisma.$transaction([
      prisma.billingSyncRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          error: message,
          finishedAt
        }
      }),
      prisma.billingSyncState.update({
        where: { id: SUB2_USAGE_SYNC_SOURCE },
        data: {
          lastStatus: "failed",
          lastError: message,
          lastFinishedAt: finishedAt
        }
      })
    ]);
    throw error;
  }
}

async function syncSub2UsageFromCursor(cursor?: string) {
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
  const rental = await findRentalForUsage(record.apiKeyId);
  if (!rental) return "unmatched";

  const supplierResource = record.upstreamAccountId
    ? await prisma.supplierResource.findFirst({ where: { sub2AccountId: record.upstreamAccountId } })
    : null;

  const apiEquivalentCost = new Prisma.Decimal(record.apiEquivalentCost);
  const billingRule = await resolveBillingRule(rental);
  const isSmokeUsage = isLocalProxySmokeRental(rental);
  const buyerCharge = isSmokeUsage ? new Prisma.Decimal(0) : calculateBuyerCharge(apiEquivalentCost, billingRule);
  const shareRate = supplierResource?.shareRate ?? new Prisma.Decimal(0);
  const supplierIncome = isSmokeUsage ? new Prisma.Decimal(0) : buyerCharge.mul(shareRate);

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.usageRecord.findUnique({
        where: { sub2RequestId: record.id },
        select: { id: true }
      });
      if (existing) return "skipped";

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
          status: isSmokeUsage ? "ignored" : buyerCharge.gt(0) ? "pending" : "billed",
          occurredAt: new Date(record.occurredAt)
        }
      });

      const limitStatus = isSmokeUsage
        ? { exhausted: false }
        : await updateRentalLimitsAfterUsage(tx, rental.id, buyerCharge);

      if (!isSmokeUsage && buyerCharge.gt(0)) {
        const debit = await tx.walletAccount.updateMany({
          where: {
            userId: rental.userId,
            availableBalance: { gte: buyerCharge }
          },
          data: {
            availableBalance: { decrement: buyerCharge },
            totalSpent: { increment: buyerCharge }
          }
        });
        if (debit.count !== 1) {
          await tx.rental.update({ where: { id: rental.id }, data: { status: "low_balance" } });
          return "imported";
        }

        const wallet = await tx.walletAccount.findUniqueOrThrow({ where: { userId: rental.userId } });
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "consume",
            amount: buyerCharge,
            balanceAfter: wallet.availableBalance,
            refType: "usage",
            refId: usage.id,
            note: billingNote(billingRule)
          }
        });
        await tx.usageRecord.update({ where: { id: usage.id }, data: { status: "billed" } });
      }

      if (!isSmokeUsage && limitStatus.exhausted) {
        await tx.rental.update({ where: { id: rental.id }, data: { status: "limited" } });
      }

      if (!isSmokeUsage && supplierResource && supplierIncome.gt(0)) {
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

async function findRentalForUsage(sub2KeyId: string) {
  const currentRental = await prisma.rental.findFirst({
    where: { sub2KeyId },
    include: {
      limits: true,
      order: { include: { items: true } }
    }
  });
  if (currentRental) return currentRental;

  const binding = await prisma.sub2Binding.findUnique({
    where: {
      sub2Type_sub2Id: {
        sub2Type: "api_key",
        sub2Id: sub2KeyId
      }
    }
  });
  if (!binding) return null;

  const rentalId = rentalIdFromBinding(binding);
  if (!rentalId) return null;

  return prisma.rental.findUnique({
    where: { id: rentalId },
    include: {
      limits: true,
      order: { include: { items: true } }
    }
  });
}

async function resolveBillingRule(rental: NonNullable<Awaited<ReturnType<typeof findRentalForUsage>>>): Promise<BillingRule> {
  const orderItem = rental.order.items.find((item) => item.productId === rental.productId && item.priceId)
    ?? rental.order.items.find((item) => item.priceId);

  if (!orderItem?.priceId) return defaultBillingRule();

  const price = await prisma.productPrice.findUnique({
    where: { id: orderItem.priceId },
    select: {
      id: true,
      tierCode: true,
      discountRate: true,
      tierMultiplier: true
    }
  });

  if (!price) return defaultBillingRule();

  return {
    source: "product_price",
    priceId: price.id,
    tierCode: price.tierCode,
    discountRate: price.discountRate,
    tierMultiplier: price.tierMultiplier
  };
}

function defaultBillingRule(): BillingRule {
  return {
    source: "default_discount_rate",
    priceId: null,
    tierCode: null,
    discountRate: new Prisma.Decimal(env.DEFAULT_DISCOUNT_RATE),
    tierMultiplier: new Prisma.Decimal(1)
  };
}

function calculateBuyerCharge(apiEquivalentCost: Prisma.Decimal, rule: BillingRule) {
  return apiEquivalentCost.mul(rule.discountRate).mul(rule.tierMultiplier);
}

function billingNote(rule: BillingRule) {
  if (rule.source === "product_price") {
    return `sub2 usage billing product_price:${rule.tierCode ?? rule.priceId}`;
  }
  return "sub2 usage billing default_discount_rate";
}

function isLocalProxySmokeRental(rental: NonNullable<Awaited<ReturnType<typeof findRentalForUsage>>>) {
  return rental.order.items.some((item) => isLocalProxySmokeMeta(item.meta));
}

function rentalIdFromBinding(binding: { objectType: string; objectId: string; meta: Prisma.JsonValue | null }) {
  if (binding.objectType === "rental") return binding.objectId;
  if (binding.objectType !== "rental_api_key_history") return null;

  if (binding.meta && typeof binding.meta === "object" && !Array.isArray(binding.meta)) {
    const value = binding.meta.rentalId;
    if (typeof value === "string" && value.length > 0) return value;
  }

  const separatorIndex = binding.objectId.indexOf(":");
  return separatorIndex > 0 ? binding.objectId.slice(0, separatorIndex) : null;
}

function redactSensitiveText(value: string) {
  return value
    .replace(/(access_token|refresh_token|id_token|token|key|password)\s*[:=]\s*[^,}\s]+/gi, "$1:[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/g, "Bearer [REDACTED]")
    .replace(/(zyz_[A-Za-z0-9]{8})[A-Za-z0-9]+/g, "$1[REDACTED]")
    .replace(/(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, "$1[REDACTED]");
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
