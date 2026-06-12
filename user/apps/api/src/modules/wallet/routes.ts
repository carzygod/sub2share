import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../common/auth.js";
import { AppError } from "../../common/errors.js";
import { prisma } from "../../common/prisma.js";
import { ok } from "../../common/response.js";
import { env } from "../../config/env.js";
import { isRechargeEndpointEnabled } from "./payment-provider.js";

const rechargeSchema = z.object({
  amount: z.coerce.number().positive()
});

export async function registerWalletRoutes(app: FastifyInstance) {
  app.get("/api/wallet", async (request, reply) => {
    const user = await requireAuth(request);
    const wallet = await prisma.walletAccount.findUnique({ where: { userId: user.id } });
    if (!wallet) throw new AppError("wallet_not_found", "Wallet not found", 404);
    return ok(reply, wallet);
  });

  app.post("/api/wallet/recharge", async (request, reply) => {
    const user = await requireAuth(request);
    if (!isRechargeEndpointEnabled({
      provider: env.PAYMENT_PROVIDER,
      nodeEnv: env.NODE_ENV,
      allowProductionMockRecharge: env.ALLOW_PRODUCTION_MOCK_RECHARGE
    })) {
      throw new AppError("recharge_unavailable", "Recharge is not available for the configured payment provider", 503);
    }

    const input = rechargeSchema.parse(request.body);
    if (input.amount < env.MIN_RECHARGE_AMOUNT) {
      throw new AppError("amount_too_low", `Minimum recharge amount is ${env.MIN_RECHARGE_AMOUNT}`);
    }

    const wallet = await prisma.$transaction(async (tx) => {
      const current = await tx.walletAccount.findUniqueOrThrow({ where: { userId: user.id } });
      await tx.walletAccount.update({
        where: { id: current.id },
        data: {
          availableBalance: { increment: input.amount },
          totalRecharged: { increment: input.amount }
        }
      });
      const updated = await tx.walletAccount.findUniqueOrThrow({ where: { id: current.id } });
      await tx.walletTransaction.create({
        data: {
          walletId: current.id,
          type: "recharge",
          amount: input.amount,
          balanceAfter: updated.availableBalance,
          note: "mock recharge"
        }
      });
      return updated;
    });

    return ok(reply, wallet);
  });

  app.get("/api/wallet/transactions", async (request, reply) => {
    const user = await requireAuth(request);
    const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { userId: user.id } });
    const rows = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    return ok(reply, rows);
  });
}
