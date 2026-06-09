import type { OrderStatus, Prisma } from "@prisma/client";

interface RecordOrderStatusHistoryInput {
  orderId: string;
  fromStatus?: OrderStatus | null;
  toStatus: OrderStatus;
  actorUserId?: string | null;
  reason?: string;
  meta?: unknown;
}

export async function recordOrderStatusHistory(
  tx: Prisma.TransactionClient,
  input: RecordOrderStatusHistoryInput
) {
  if (input.fromStatus === input.toStatus) return;

  await tx.orderStatusHistory.create({
    data: {
      orderId: input.orderId,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus,
      actorUserId: input.actorUserId,
      reason: input.reason,
      meta: toJson(input.meta)
    }
  });
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
