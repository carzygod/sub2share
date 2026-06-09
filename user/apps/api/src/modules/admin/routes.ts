import type { FastifyInstance, FastifyReply } from "fastify";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "../../common/auth.js";
import { AppError } from "../../common/errors.js";
import { prisma } from "../../common/prisma.js";
import { ok } from "../../common/response.js";
import { sub2Client } from "../../integrations/sub2/client.js";
import { expireOverdueRentals } from "../../jobs/expire-overdue-rentals.js";
import { syncSub2UsageOnce } from "../../jobs/sync-sub2-usage.js";
import { rotateRentalApiKey } from "../rentals/key-rotation.js";

const redactedFields = new Set(["passwordHash", "keyHash", "sub2KeyHash"]);
const userRoles = ["buyer", "supplier", "operator", "admin"] as const;
const userStatuses = ["active", "disabled", "banned"] as const;
const orderStatuses = ["pending", "paid", "provisioning", "active", "failed", "refunding", "refunded", "expired", "cancelled", "closed"] as const;
const rentalStatuses = ["active", "low_balance", "limited", "suspended", "expired", "refunded", "closed"] as const;
const resourceTypes = ["codex", "claude_code", "gemini", "antigravity"] as const;
const productStatuses = ["draft", "active", "offline"] as const;
const billingModes = ["pay_as_you_go", "daily", "weekly", "monthly"] as const;
const usageStatuses = ["pending", "billed", "refunded", "ignored", "disputed"] as const;
const resourceStatuses = ["pending", "testing", "online", "busy", "paused", "abnormal", "disabled"] as const;
type ResourceStatus = (typeof resourceStatuses)[number];
const settlementStatuses = ["pending", "frozen", "available", "withdrawn", "cancelled"] as const;
const withdrawalStatuses = ["pending", "approved", "rejected", "paid", "cancelled"] as const;

const listQuerySchema = z.object({
  q: z.string().trim().max(160).optional(),
  status: z.string().trim().max(80).optional(),
  resourceType: z.string().trim().max(80).optional(),
  action: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50)
});

type ListQuery = z.infer<typeof listQuerySchema>;

const userStatusSchema = z.object({
  status: z.enum(["active", "disabled", "banned"])
});

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(64).optional(),
  roles: z.array(z.enum(userRoles)).min(1).default(["buyer"])
});

const userRolesSchema = z.object({
  roles: z.array(z.enum(userRoles)).min(1)
});

const walletAdjustSchema = z.object({
  amount: z.coerce.number().refine((value) => value !== 0, "Amount cannot be zero"),
  note: z.string().max(240).optional()
});

const rentalStatusSchema = z.object({
  status: z.enum(rentalStatuses)
});

const apiKeyStatusSchema = z.object({
  status: z.enum(["active", "inactive"])
});

const createProductSchema = z.object({
  name: z.string().trim().min(1).max(120),
  resourceType: z.enum(resourceTypes),
  billingMode: z.enum(billingModes).default("monthly"),
  status: z.enum(productStatuses).default("draft"),
  description: z.string().trim().max(2000).optional()
});

const updateProductSchema = createProductSchema.partial();

const createProductPriceSchema = z.object({
  tierCode: z.string().trim().min(1).max(80).regex(/^[a-z0-9_-]+$/),
  displayName: z.string().trim().min(1).max(120),
  fixedPrice: z.coerce.number().positive(),
  durationDays: z.coerce.number().int().positive().optional(),
  maxConcurrency: z.coerce.number().int().min(1).max(200).default(1),
  requestLimit: z.coerce.number().int().positive().optional(),
  discountRate: z.coerce.number().min(0).max(1).default(0.2),
  tierMultiplier: z.coerce.number().positive().default(1),
  status: z.enum(productStatuses).default("active")
});

const updateProductPriceSchema = createProductPriceSchema
  .omit({ tierCode: true })
  .partial();

const resourceStatusSchema = z.object({
  status: z.enum(["pending", "testing", "online", "busy", "paused", "abnormal", "disabled"]),
  level: z.enum(["L0", "L1", "L2", "L3", "L4"]).optional(),
  sub2AccountId: z.string().trim().min(1).optional()
});

const createResourceSchema = z.object({
  supplierEmail: z.string().email(),
  displayName: z.string().trim().min(1).max(64).optional(),
  resourceType: z.enum(["codex", "claude_code", "gemini", "antigravity"]),
  status: z.enum(["pending", "testing", "online", "busy", "paused", "abnormal", "disabled"]).default("pending"),
  level: z.enum(["L0", "L1", "L2", "L3", "L4"]).default("L0"),
  maxConcurrency: z.coerce.number().int().min(1).max(200).default(1),
  shareRate: z.coerce.number().min(0).max(1).default(0.7),
  reserveRatio: z.coerce.number().min(0).max(1).default(0.2),
  dailyCap: z.coerce.number().positive().optional(),
  sub2AccountId: z.string().trim().min(1).optional()
});

const sub2AccountParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

const sub2SmokeTestSchema = z.object({
  model: z.string().trim().min(1).max(160).optional()
});

const sub2OpenAiRefreshTokenSchema = z.object({
  refreshToken: z.string().trim().min(10),
  clientId: z.string().trim().min(1).max(240).optional(),
  proxyId: z.coerce.number().int().positive().optional()
});

const usageSyncSchema = z.object({
  cursor: z.string().trim().min(1).max(500).optional()
});

const expireOverdueRentalsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

const createWithdrawalSchema = z.object({
  supplierEmail: z.string().email(),
  amount: z.coerce.number().positive(),
  currency: z.string().trim().min(1).max(12).default("USD"),
  status: z.enum(withdrawalStatuses).default("pending"),
  payoutRef: z.string().trim().min(1).max(160).optional(),
  note: z.string().trim().max(500).optional()
});

const updateWithdrawalSchema = z.object({
  status: z.enum(withdrawalStatuses),
  payoutRef: z.string().trim().min(1).max(160).optional(),
  note: z.string().trim().max(500).optional()
});

export async function registerAdminRoutes(app: FastifyInstance) {
  app.get("/api/admin/dashboard", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const [users, activeRentals, onlineResources, pendingWithdrawals, usageAgg, walletAgg, orderAgg] = await Promise.all([
      prisma.user.count(),
      prisma.rental.count({ where: { status: "active" } }),
      prisma.supplierResource.count({ where: { status: "online" } }),
      prisma.withdrawal.count({ where: { status: "pending" } }),
      prisma.usageRecord.aggregate({
        _sum: { buyerCharge: true, supplierIncome: true },
        _count: true
      }),
      prisma.walletAccount.aggregate({
        _sum: { availableBalance: true, frozenBalance: true, totalRecharged: true, totalSpent: true }
      }),
      prisma.order.aggregate({
        where: { status: { in: ["paid", "provisioning", "active", "closed", "expired"] } },
        _sum: { paidAmount: true },
        _count: true
      })
    ]);

    return adminOk(reply, {
      users,
      activeRentals,
      onlineResources,
      pendingWithdrawals,
      usageCount: usageAgg._count,
      gmv: usageAgg._sum.buyerCharge ?? 0,
      supplierIncome: usageAgg._sum.supplierIncome ?? 0,
      walletAvailable: walletAgg._sum.availableBalance ?? 0,
      walletFrozen: walletAgg._sum.frozenBalance ?? 0,
      totalRecharged: walletAgg._sum.totalRecharged ?? 0,
      totalSpent: walletAgg._sum.totalSpent ?? 0,
      paidOrderCount: orderAgg._count,
      paidOrderAmount: orderAgg._sum.paidAmount ?? 0
    });
  });

  app.post("/api/admin/users", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const input = createUserSchema.parse(request.body);
    const email = input.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError("email_exists", "Email already registered", 409);

    const roles = [...new Set(input.roles)];
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(input.password, 12),
        displayName: input.displayName,
        roles: { create: roles.map((role) => ({ role })) },
        wallet: { create: { currency: "USD" } }
      },
      include: { roles: true, wallet: true, supplier: true }
    });
    await writeAuditLog(request, actor.id, "admin.user.create", "user", user.id, null, { email, roles });
    return adminOk(reply, user);
  });

  app.get("/api/admin/users", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(userStatuses, query.status);
    const where: Prisma.UserWhereInput = {
      ...(status ? { status } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { email: containsText(query.q) },
          { displayName: containsText(query.q) },
          { phone: containsText(query.q) },
          { roles: { some: { role: oneOf(userRoles, query.q) } } }
        ]
      } : {})
    };
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: {
          roles: true,
          wallet: true,
          supplier: true,
          _count: { select: { orders: true, rentals: true, apiKeys: true } }
        },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.user.count({ where })
    ]);
    return adminOk(reply, paged(users, total, query));
  });

  app.get("/api/admin/users/:id", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const { id } = request.params as { id: string };
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        roles: true,
        wallet: { include: { transactions: { orderBy: { createdAt: "desc" }, take: 50 } } },
        supplier: { include: { resources: true, withdrawals: true } },
        identities: true,
        orders: { include: { items: true, rentals: true }, orderBy: { createdAt: "desc" }, take: 20 },
        rentals: { include: { product: true, limits: true }, orderBy: { createdAt: "desc" }, take: 20 },
        apiKeys: { orderBy: { createdAt: "desc" }, take: 20 }
      }
    });
    if (!user) throw new AppError("user_not_found", "User not found", 404);
    return adminOk(reply, user);
  });

  app.patch("/api/admin/users/:id/status", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = userStatusSchema.parse(request.body);
    const before = await prisma.user.findUnique({ where: { id }, select: { id: true, status: true } });
    const user = await prisma.user.update({
      where: { id },
      data: { status: input.status },
      include: { roles: true, wallet: true }
    });
    await writeAuditLog(request, actor.id, "admin.user.status", "user", id, before, { status: user.status });
    return adminOk(reply, user);
  });

  app.patch("/api/admin/users/:id/roles", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = userRolesSchema.parse(request.body ?? {});
    const roles = [...new Set(input.roles)];
    const before = await prisma.user.findUnique({
      where: { id },
      include: { roles: true }
    });
    if (!before) throw new AppError("user_not_found", "User not found", 404);

    const previousRoles = before.roles.map((role) => role.role);
    if (previousRoles.includes("admin") && !roles.includes("admin")) {
      if (actor.id === id) {
        throw new AppError("cannot_remove_own_admin_role", "Cannot remove your own admin role", 400);
      }
      const adminCount = await prisma.userRole.count({ where: { role: "admin" } });
      if (adminCount <= 1) {
        throw new AppError("last_admin_role_required", "At least one admin user must remain", 400);
      }
    }

    const user = await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({
        where: {
          userId: id,
          role: { notIn: roles }
        }
      });
      await tx.userRole.createMany({
        data: roles.map((role) => ({ userId: id, role })),
        skipDuplicates: true
      });
      return tx.user.findUniqueOrThrow({
        where: { id },
        include: {
          roles: true,
          wallet: true,
          supplier: true,
          _count: { select: { orders: true, rentals: true, apiKeys: true } }
        }
      });
    });
    await writeAuditLog(request, actor.id, "admin.user.roles", "user", id, { roles: previousRoles }, { roles });
    return adminOk(reply, user);
  });

  app.post("/api/admin/users/:id/wallet-adjust", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = walletAdjustSchema.parse(request.body);
    const amount = new Prisma.Decimal(input.amount);
    const wallet = await prisma.$transaction(async (tx) => {
      const current = await tx.walletAccount.upsert({
        where: { userId: id },
        update: {},
        create: { userId: id, currency: "USD" }
      });
      const nextBalance = current.availableBalance.plus(amount);
      if (nextBalance.lt(0)) {
        throw new AppError("insufficient_balance", "Wallet adjustment would make balance negative", 400);
      }
      const updated = await tx.walletAccount.update({
        where: { id: current.id },
        data: { availableBalance: nextBalance }
      });
      await tx.walletTransaction.create({
        data: {
          walletId: current.id,
          type: "adjustment",
          amount,
          balanceAfter: nextBalance,
          refType: "admin_adjustment",
          refId: id,
          note: input.note ?? "admin wallet adjustment"
        }
      });
      return updated;
    });
    await writeAuditLog(request, actor.id, "admin.wallet.adjust", "wallet", wallet.id, null, {
      userId: id,
      amount: String(amount),
      balanceAfter: String(wallet.availableBalance),
      note: input.note
    });
    return adminOk(reply, wallet);
  });

  app.get("/api/admin/orders", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(orderStatuses, query.status);
    const where: Prisma.OrderWhereInput = {
      ...(status ? { status } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { paymentRef: containsText(query.q) },
          { userId: containsText(query.q) },
          { user: { id: containsText(query.q) } },
          { user: { email: containsText(query.q) } },
          { user: { displayName: containsText(query.q) } }
        ]
      } : {})
    };
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: { user: true, items: true, rentals: true },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.order.count({ where })
    ]);
    return adminOk(reply, paged(orders, total, query));
  });

  app.get("/api/admin/orders/:id", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const { id } = request.params as { id: string };
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        user: { include: { roles: true, wallet: true } },
        items: { include: { product: true } },
        rentals: {
          include: {
            product: true,
            limits: true,
            apiKeys: { orderBy: { createdAt: "desc" }, take: 20 }
          },
          orderBy: { createdAt: "desc" }
        }
      }
    });
    if (!order) throw new AppError("order_not_found", "Order not found", 404);
    return adminOk(reply, order);
  });

  app.get("/api/admin/rentals", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(rentalStatuses, query.status);
    const resourceType = oneOf(resourceTypes, query.resourceType);
    const where: Prisma.RentalWhereInput = {
      ...(status ? { status } : {}),
      ...(resourceType ? { resourceType } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { orderId: containsText(query.q) },
          { userId: containsText(query.q) },
          { sub2UserId: containsText(query.q) },
          { sub2KeyId: containsText(query.q) },
          { endpointUrl: containsText(query.q) },
          { user: { id: containsText(query.q) } },
          { user: { email: containsText(query.q) } },
          { product: { name: containsText(query.q) } },
          ...(oneOf(resourceTypes, query.q) ? [{ resourceType: oneOf(resourceTypes, query.q) }] : [])
        ]
      } : {})
    };
    const [rentals, total] = await Promise.all([
      prisma.rental.findMany({
        where,
        include: { user: true, product: true, limits: true, order: true, apiKeys: { orderBy: { createdAt: "desc" }, take: 5 } },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.rental.count({ where })
    ]);
    return adminOk(reply, paged(rentals, total, query));
  });

  app.post("/api/admin/rentals/expire-overdue", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const input = expireOverdueRentalsSchema.parse(request.body ?? {});
    const result = await expireOverdueRentals({ limit: input.limit });
    await writeAuditLog(request, actor.id, "admin.rental.expire_overdue", "rental", undefined, null, result);
    return adminOk(reply, result);
  });

  app.patch("/api/admin/rentals/:id/status", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = rentalStatusSchema.parse(request.body ?? {});
    const before = await prisma.rental.findUnique({
      where: { id },
      include: { apiKeys: true, product: true }
    });
    if (!before) throw new AppError("rental_not_found", "Rental not found", 404);

    const sub2Sync = await syncSub2KeyForRental(before.userId, before.sub2KeyId, input.status === "active");
    if (input.status === "active" && !sub2Sync.ok) {
      throw new AppError("sub2_key_enable_failed", "Sub2 key enable failed", 502, sub2Sync.error);
    }

    const rental = await prisma.$transaction(async (tx) => {
      await tx.rental.update({
        where: { id },
        data: { status: input.status }
      });
      await tx.apiKey.updateMany({
        where: { rentalId: id },
        data: { status: input.status === "active" ? "active" : "inactive" }
      });
      return tx.rental.findUniqueOrThrow({
        where: { id },
        include: { user: true, product: true, limits: true, order: true, apiKeys: { orderBy: { createdAt: "desc" }, take: 5 } }
      });
    });
    await writeAuditLog(request, actor.id, "admin.rental.status", "rental", id, {
      status: before.status,
      sub2KeyId: before.sub2KeyId,
      apiKeyStatuses: before.apiKeys.map((apiKey) => ({ id: apiKey.id, status: apiKey.status }))
    }, {
      status: rental.status,
      sub2Sync
    });
    return adminOk(reply, rental);
  });

  app.post("/api/admin/rentals/:id/rotate-key", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const result = await rotateRentalApiKey({ rentalId: id });
    await writeAuditLog(request, actor.id, "admin.rental.rotate_key", "rental", id, {
      previousSub2KeyId: result.previousSub2KeyId,
      previousApiKeyIds: result.previousApiKeyIds
    }, {
      sub2KeyId: result.sub2KeyId,
      oldSub2KeyDisabled: result.oldSub2KeyDisabled,
      oldSub2KeyDisableError: result.oldSub2KeyDisableError ? redactSensitiveText(result.oldSub2KeyDisableError) : null
    });
    return adminOk(reply, result);
  });

  app.patch("/api/admin/api-keys/:id/status", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = apiKeyStatusSchema.parse(request.body ?? {});
    const before = await prisma.apiKey.findUnique({
      where: { id },
      include: { user: true, rental: true }
    });
    if (!before) throw new AppError("api_key_not_found", "API key not found", 404);
    if (input.status === "active" && before.rental?.status !== "active") {
      throw new AppError("rental_not_active", "Cannot activate API key for an inactive rental", 400);
    }

    const sub2Sync = await syncSub2KeyForRental(before.rental?.userId ?? before.userId, before.rental?.sub2KeyId, input.status === "active");
    if (input.status === "active" && !sub2Sync.ok) {
      throw new AppError("sub2_key_enable_failed", "Sub2 key enable failed", 502, sub2Sync.error);
    }

    const apiKey = await prisma.apiKey.update({
      where: { id },
      data: { status: input.status }
    });
    await writeAuditLog(request, actor.id, "admin.api_key.status", "api_key", id, {
      status: before.status,
      rentalId: before.rentalId,
      sub2KeyId: before.rental?.sub2KeyId
    }, {
      status: apiKey.status,
      sub2Sync
    });
    return adminOk(reply, apiKey);
  });

  app.get("/api/admin/wallets", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const where: Prisma.WalletAccountWhereInput = query.q ? {
      OR: [
        { id: containsText(query.q) },
        { userId: containsText(query.q) },
        { user: { id: containsText(query.q) } },
        { user: { email: containsText(query.q) } },
        { user: { displayName: containsText(query.q) } }
      ]
    } : {};
    const [wallets, total] = await Promise.all([
      prisma.walletAccount.findMany({
        where,
        include: { user: { include: { roles: true } } },
        orderBy: { updatedAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.walletAccount.count({ where })
    ]);
    return adminOk(reply, paged(wallets, total, query));
  });

  app.get("/api/admin/wallet-transactions", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const where: Prisma.WalletTransactionWhereInput = {
      ...(oneOf(["recharge", "freeze", "unfreeze", "consume", "refund", "withdrawal_freeze", "withdrawal_paid", "adjustment"] as const, query.status) ? {
        type: oneOf(["recharge", "freeze", "unfreeze", "consume", "refund", "withdrawal_freeze", "withdrawal_paid", "adjustment"] as const, query.status)
      } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { walletId: containsText(query.q) },
          { refType: containsText(query.q) },
          { refId: containsText(query.q) },
          { note: containsText(query.q) },
          { wallet: { user: { email: containsText(query.q) } } }
        ]
      } : {})
    };
    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where,
        include: { wallet: { include: { user: true } } },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.walletTransaction.count({ where })
    ]);
    return adminOk(reply, paged(transactions, total, query));
  });

  app.get("/api/admin/sales", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const [orders, orderAgg, usageAgg] = await Promise.all([
      prisma.order.findMany({
        include: { user: true, items: true, rentals: true },
        orderBy: { createdAt: "desc" },
        take: 100
      }),
      prisma.order.aggregate({
        _sum: { totalAmount: true, paidAmount: true },
        _count: true
      }),
      prisma.usageRecord.aggregate({
        _sum: { buyerCharge: true, supplierIncome: true },
        _count: true
      })
    ]);
    return adminOk(reply, {
      orders,
      summary: {
        orderCount: orderAgg._count,
        totalAmount: orderAgg._sum.totalAmount ?? 0,
        paidAmount: orderAgg._sum.paidAmount ?? 0,
        usageCount: usageAgg._count,
        usageCharge: usageAgg._sum.buyerCharge ?? 0,
        supplierIncome: usageAgg._sum.supplierIncome ?? 0
      }
    });
  });

  app.get("/api/admin/usages", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(usageStatuses, query.status);
    const resourceType = oneOf(resourceTypes, query.resourceType);
    const where: Prisma.UsageRecordWhereInput = {
      ...(status ? { status } : {}),
      ...(resourceType ? { resourceType } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { sub2RequestId: containsText(query.q) },
          { rentalId: containsText(query.q) },
          { userId: containsText(query.q) },
          { model: containsText(query.q) },
          { rental: { id: containsText(query.q) } },
          { rental: { user: { id: containsText(query.q) } } },
          { rental: { user: { email: containsText(query.q) } } },
          { rental: { product: { name: containsText(query.q) } } },
          { supplierResource: { id: containsText(query.q) } },
          { supplierResource: { sub2AccountId: containsText(query.q) } },
          { supplierResource: { supplier: { user: { email: containsText(query.q) } } } },
          ...(oneOf(resourceTypes, query.q) ? [{ resourceType: oneOf(resourceTypes, query.q) }] : []),
          ...(oneOf(usageStatuses, query.q) ? [{ status: oneOf(usageStatuses, query.q) }] : [])
        ]
      } : {})
    };
    const [usages, total, summary] = await Promise.all([
      prisma.usageRecord.findMany({
        where,
        include: {
          rental: { include: { user: true, product: true } },
          supplierResource: { include: { supplier: { include: { user: true } } } },
          settlements: { orderBy: { createdAt: "desc" }, take: 5 }
        },
        orderBy: { occurredAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.usageRecord.count({ where }),
      prisma.usageRecord.aggregate({
        where,
        _sum: { buyerCharge: true, supplierIncome: true, inputUnits: true, outputUnits: true },
        _count: true
      })
    ]);
    return adminOk(reply, { ...paged(usages, total, query), summary });
  });

  app.post("/api/admin/usages/sync-sub2", async (request, reply) => {
    const actor = await requireRole(request, ["operator", "admin"]);
    const input = usageSyncSchema.parse(request.body ?? {});
    const result = await syncSub2UsageOnce(input.cursor);
    await writeAuditLog(request, actor.id, "admin.usage.sync_sub2", "usage_sync", undefined, null, result);
    return adminOk(reply, result);
  });

  app.get("/api/admin/products", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(productStatuses, query.status);
    const resourceType = oneOf(resourceTypes, query.resourceType);
    const where: Prisma.ProductWhereInput = {
      ...(status ? { status } : {}),
      ...(resourceType ? { resourceType } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { name: containsText(query.q) },
          { description: containsText(query.q) },
          { prices: { some: { tierCode: containsText(query.q) } } },
          { prices: { some: { displayName: containsText(query.q) } } },
          ...(oneOf(resourceTypes, query.q) ? [{ resourceType: oneOf(resourceTypes, query.q) }] : []),
          ...(oneOf(productStatuses, query.q) ? [{ status: oneOf(productStatuses, query.q) }] : [])
        ]
      } : {})
    };
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          prices: { orderBy: { createdAt: "desc" } },
          _count: { select: { prices: true, orders: true, rentals: true } }
        },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.product.count({ where })
    ]);
    return adminOk(reply, paged(products, total, query));
  });

  app.post("/api/admin/products", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const input = createProductSchema.parse(request.body);
    const product = await prisma.product.create({
      data: {
        name: input.name,
        resourceType: input.resourceType,
        billingMode: input.billingMode,
        status: input.status,
        description: input.description
      },
      include: {
        prices: true,
        _count: { select: { prices: true, orders: true, rentals: true } }
      }
    });
    await writeAuditLog(request, actor.id, "admin.product.create", "product", product.id, null, {
      name: product.name,
      resourceType: product.resourceType,
      billingMode: product.billingMode,
      status: product.status
    });
    return adminOk(reply, product);
  });

  app.get("/api/admin/products/:id", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const { id } = request.params as { id: string };
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        prices: { orderBy: { createdAt: "desc" } },
        _count: { select: { prices: true, orders: true, rentals: true } }
      }
    });
    if (!product) throw new AppError("product_not_found", "Product not found", 404);
    return adminOk(reply, product);
  });

  app.patch("/api/admin/products/:id", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = updateProductSchema.parse(request.body ?? {});
    const before = await prisma.product.findUnique({
      where: { id },
      select: { id: true, name: true, resourceType: true, billingMode: true, status: true, description: true }
    });
    if (!before) throw new AppError("product_not_found", "Product not found", 404);
    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.resourceType !== undefined ? { resourceType: input.resourceType } : {}),
        ...(input.billingMode !== undefined ? { billingMode: input.billingMode } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.description !== undefined ? { description: input.description } : {})
      },
      include: {
        prices: { orderBy: { createdAt: "desc" } },
        _count: { select: { prices: true, orders: true, rentals: true } }
      }
    });
    await writeAuditLog(request, actor.id, "admin.product.update", "product", id, before, {
      name: product.name,
      resourceType: product.resourceType,
      billingMode: product.billingMode,
      status: product.status,
      description: product.description
    });
    return adminOk(reply, product);
  });

  app.post("/api/admin/products/:id/prices", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = createProductPriceSchema.parse(request.body);
    const product = await prisma.product.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!product) throw new AppError("product_not_found", "Product not found", 404);
    const existing = await prisma.productPrice.findUnique({
      where: { productId_tierCode: { productId: id, tierCode: input.tierCode } },
      select: { id: true }
    });
    if (existing) throw new AppError("product_price_exists", "Product price tier already exists", 409);
    const price = await prisma.productPrice.create({
      data: {
        productId: id,
        tierCode: input.tierCode,
        displayName: input.displayName,
        fixedPrice: new Prisma.Decimal(input.fixedPrice),
        durationDays: input.durationDays,
        maxConcurrency: input.maxConcurrency,
        requestLimit: input.requestLimit,
        discountRate: new Prisma.Decimal(input.discountRate),
        tierMultiplier: new Prisma.Decimal(input.tierMultiplier),
        status: input.status
      }
    });
    await writeAuditLog(request, actor.id, "admin.product_price.create", "product_price", price.id, null, {
      productId: id,
      tierCode: price.tierCode,
      displayName: price.displayName,
      fixedPrice: String(price.fixedPrice),
      status: price.status
    });
    return adminOk(reply, price);
  });

  app.patch("/api/admin/product-prices/:id", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = updateProductPriceSchema.parse(request.body ?? {});
    const before = await prisma.productPrice.findUnique({
      where: { id },
      select: {
        id: true,
        productId: true,
        displayName: true,
        fixedPrice: true,
        durationDays: true,
        maxConcurrency: true,
        requestLimit: true,
        discountRate: true,
        tierMultiplier: true,
        status: true
      }
    });
    if (!before) throw new AppError("product_price_not_found", "Product price not found", 404);
    const price = await prisma.productPrice.update({
      where: { id },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.fixedPrice !== undefined ? { fixedPrice: new Prisma.Decimal(input.fixedPrice) } : {}),
        ...(input.durationDays !== undefined ? { durationDays: input.durationDays } : {}),
        ...(input.maxConcurrency !== undefined ? { maxConcurrency: input.maxConcurrency } : {}),
        ...(input.requestLimit !== undefined ? { requestLimit: input.requestLimit } : {}),
        ...(input.discountRate !== undefined ? { discountRate: new Prisma.Decimal(input.discountRate) } : {}),
        ...(input.tierMultiplier !== undefined ? { tierMultiplier: new Prisma.Decimal(input.tierMultiplier) } : {}),
        ...(input.status !== undefined ? { status: input.status } : {})
      }
    });
    await writeAuditLog(request, actor.id, "admin.product_price.update", "product_price", id, before, {
      productId: price.productId,
      displayName: price.displayName,
      fixedPrice: String(price.fixedPrice),
      status: price.status
    });
    return adminOk(reply, price);
  });

  app.get("/api/admin/resources", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(resourceStatuses, query.status);
    const resourceType = oneOf(resourceTypes, query.resourceType);
    const where: Prisma.SupplierResourceWhereInput = {
      ...(status ? { status } : {}),
      ...(resourceType ? { resourceType } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { supplierId: containsText(query.q) },
          { sub2AccountId: containsText(query.q) },
          { supplier: { user: { id: containsText(query.q) } } },
          { supplier: { user: { email: containsText(query.q) } } },
          { supplier: { user: { displayName: containsText(query.q) } } },
          ...(oneOf(resourceTypes, query.q) ? [{ resourceType: oneOf(resourceTypes, query.q) }] : []),
          ...(oneOf(["L0", "L1", "L2", "L3", "L4"] as const, query.q) ? [{ level: oneOf(["L0", "L1", "L2", "L3", "L4"] as const, query.q) }] : [])
        ]
      } : {})
    };
    const [resources, total] = await Promise.all([
      prisma.supplierResource.findMany({
        where,
        include: { supplier: { include: { user: true } } },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.supplierResource.count({ where })
    ]);
    return adminOk(reply, paged(resources, total, query));
  });

  app.post("/api/admin/resources", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const input = createResourceSchema.parse(request.body);
    const email = input.supplierEmail.toLowerCase();
    const resource = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { email } });
      if (!user) throw new AppError("supplier_user_not_found", "Supplier user not found", 404);
      await tx.userRole.upsert({
        where: { userId_role: { userId: user.id, role: "supplier" } },
        update: {},
        create: { userId: user.id, role: "supplier" }
      });
      const supplier = await tx.supplier.upsert({
        where: { userId: user.id },
        update: { displayName: input.displayName },
        create: { userId: user.id, displayName: input.displayName }
      });
      return tx.supplierResource.create({
        data: {
          supplierId: supplier.id,
          resourceType: input.resourceType,
          status: input.status,
          level: input.level,
          maxConcurrency: input.maxConcurrency,
          shareRate: new Prisma.Decimal(input.shareRate),
          reserveRatio: new Prisma.Decimal(input.reserveRatio),
          dailyCap: input.dailyCap === undefined ? undefined : new Prisma.Decimal(input.dailyCap),
          sub2AccountId: input.sub2AccountId
        },
        include: { supplier: { include: { user: true } } }
      });
    });
    await writeAuditLog(request, actor.id, "admin.resource.create", "supplier_resource", resource.id, null, {
      supplierEmail: email,
      resourceType: resource.resourceType,
      status: resource.status,
      level: resource.level,
      maxConcurrency: resource.maxConcurrency,
      sub2AccountId: resource.sub2AccountId
    });
    return adminOk(reply, resource);
  });

  app.get("/api/admin/resources/:id", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const { id } = request.params as { id: string };
    const resource = await prisma.supplierResource.findUnique({
      where: { id },
      include: {
        supplier: { include: { user: { include: { roles: true } } } },
        usages: {
          include: { rental: { include: { user: true, product: true } } },
          orderBy: { occurredAt: "desc" },
          take: 50
        },
        settlements: {
          include: { usageRecord: true },
          orderBy: { createdAt: "desc" },
          take: 50
        }
      }
    });
    if (!resource) throw new AppError("resource_not_found", "Supplier resource not found", 404);
    const usageSummary = await prisma.usageRecord.aggregate({
      where: { supplierResourceId: id },
      _count: true,
      _sum: { buyerCharge: true, supplierIncome: true, inputUnits: true, outputUnits: true }
    });
    const settlementSummary = await prisma.settlementRecord.aggregate({
      where: { supplierResourceId: id },
      _count: true,
      _sum: { amount: true }
    });
    return adminOk(reply, { ...resource, usageSummary, settlementSummary });
  });

  app.post("/api/admin/resources/:id/test", async (request, reply) => {
    const actor = await requireRole(request, ["operator", "admin"]);
    const { id } = request.params as { id: string };
    const before = await prisma.supplierResource.findUnique({
      where: { id },
      select: { id: true, status: true, sub2AccountId: true, lastCheckedAt: true }
    });
    if (!before) throw new AppError("resource_not_found", "Supplier resource not found", 404);
    if (!before.sub2AccountId) {
      throw new AppError("resource_sub2_account_missing", "Supplier resource does not have a Sub2 account id", 400);
    }

    const accountId = Number.parseInt(before.sub2AccountId, 10);
    if (!Number.isFinite(accountId) || String(accountId) !== before.sub2AccountId.trim()) {
      throw new AppError("resource_sub2_account_invalid", "Supplier resource Sub2 account id must be numeric", 400);
    }

    const result = await sub2Client.testAccount(accountId);
    const nextStatus = statusAfterResourceTest(before.status, result.ok);
    const resource = await prisma.supplierResource.update({
      where: { id },
      data: {
        status: nextStatus,
        lastCheckedAt: new Date()
      },
      include: { supplier: { include: { user: true } } }
    });
    await writeAuditLog(request, actor.id, "admin.resource.test", "supplier_resource", id, before, {
      status: resource.status,
      sub2AccountId: resource.sub2AccountId,
      ok: result.ok,
      statusCode: result.statusCode,
      events: result.events.map((event) => event.type ?? event.message ?? "event")
    });
    return adminOk(reply, { resource, result });
  });

  app.patch("/api/admin/resources/:id/status", async (request, reply) => {
    const actor = await requireRole(request, ["operator", "admin"]);
    const { id } = request.params as { id: string };
    const input = resourceStatusSchema.parse(request.body);
    const before = await prisma.supplierResource.findUnique({
      where: { id },
      select: { id: true, status: true, level: true, sub2AccountId: true }
    });
    const resource = await prisma.supplierResource.update({
      where: { id },
      data: {
        status: input.status,
        level: input.level,
        sub2AccountId: input.sub2AccountId,
        lastCheckedAt: new Date()
      },
      include: { supplier: { include: { user: true } } }
    });
    await writeAuditLog(request, actor.id, "admin.resource.status", "supplier_resource", id, before, {
      status: resource.status,
      level: resource.level,
      sub2AccountId: resource.sub2AccountId
    });
    return adminOk(reply, resource);
  });

  app.get("/api/admin/settlements", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(settlementStatuses, query.status);
    const where: Prisma.SettlementRecordWhereInput = {
      ...(status ? { status } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { supplierResourceId: containsText(query.q) },
          { usageRecordId: containsText(query.q) },
          { supplierResource: { id: containsText(query.q) } },
          { supplierResource: { sub2AccountId: containsText(query.q) } },
          { supplierResource: { supplier: { user: { email: containsText(query.q) } } } },
          { supplierResource: { supplier: { user: { displayName: containsText(query.q) } } } }
        ]
      } : {})
    };
    const [settlements, total] = await Promise.all([
      prisma.settlementRecord.findMany({
        where,
        include: {
          supplierResource: { include: { supplier: { include: { user: true } } } },
          usageRecord: true
        },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.settlementRecord.count({ where })
    ]);
    return adminOk(reply, paged(settlements, total, query));
  });

  app.get("/api/admin/withdrawals", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(withdrawalStatuses, query.status);
    const where: Prisma.WithdrawalWhereInput = {
      ...(status ? { status } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { supplierId: containsText(query.q) },
          { payoutRef: containsText(query.q) },
          { note: containsText(query.q) },
          { supplier: { id: containsText(query.q) } },
          { supplier: { displayName: containsText(query.q) } },
          { supplier: { user: { id: containsText(query.q) } } },
          { supplier: { user: { email: containsText(query.q) } } },
          { supplier: { user: { displayName: containsText(query.q) } } },
          ...(oneOf(withdrawalStatuses, query.q) ? [{ status: oneOf(withdrawalStatuses, query.q) }] : [])
        ]
      } : {})
    };
    const [withdrawals, total, summary] = await Promise.all([
      prisma.withdrawal.findMany({
        where,
        include: { supplier: { include: { user: true } } },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.withdrawal.count({ where }),
      prisma.withdrawal.aggregate({
        where,
        _sum: { amount: true },
        _count: true
      })
    ]);
    return adminOk(reply, { ...paged(withdrawals, total, query), summary });
  });

  app.post("/api/admin/withdrawals", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const input = createWithdrawalSchema.parse(request.body ?? {});
    const email = input.supplierEmail.toLowerCase();
    const supplier = await prisma.supplier.findFirst({
      where: { user: { email } },
      include: { user: true }
    });
    if (!supplier) throw new AppError("supplier_not_found", "Supplier not found", 404);

    const withdrawal = await prisma.withdrawal.create({
      data: {
        supplierId: supplier.id,
        amount: new Prisma.Decimal(input.amount),
        currency: input.currency.toUpperCase(),
        status: input.status,
        payoutRef: input.payoutRef,
        note: input.note
      },
      include: { supplier: { include: { user: true } } }
    });
    await writeAuditLog(request, actor.id, "admin.withdrawal.create", "withdrawal", withdrawal.id, null, {
      supplierEmail: email,
      amount: String(withdrawal.amount),
      currency: withdrawal.currency,
      status: withdrawal.status,
      payoutRef: withdrawal.payoutRef,
      note: withdrawal.note
    });
    return adminOk(reply, withdrawal);
  });

  app.patch("/api/admin/withdrawals/:id", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = updateWithdrawalSchema.parse(request.body ?? {});
    const before = await prisma.withdrawal.findUnique({
      where: { id },
      include: { supplier: { include: { user: true } } }
    });
    if (!before) throw new AppError("withdrawal_not_found", "Withdrawal not found", 404);

    const withdrawal = await prisma.withdrawal.update({
      where: { id },
      data: {
        status: input.status,
        ...(input.payoutRef !== undefined ? { payoutRef: input.payoutRef } : {}),
        ...(input.note !== undefined ? { note: input.note } : {})
      },
      include: { supplier: { include: { user: true } } }
    });
    await writeAuditLog(request, actor.id, "admin.withdrawal.status", "withdrawal", id, {
      status: before.status,
      payoutRef: before.payoutRef,
      note: before.note
    }, {
      status: withdrawal.status,
      payoutRef: withdrawal.payoutRef,
      note: withdrawal.note
    });
    return adminOk(reply, withdrawal);
  });

  app.get("/api/admin/audit-logs", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: containsText(query.action) } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { action: containsText(query.q) },
          { objectType: containsText(query.q) },
          { objectId: containsText(query.q) },
          { actorUserId: containsText(query.q) },
          { ipAddress: containsText(query.q) },
          { userAgent: containsText(query.q) },
          { actor: { id: containsText(query.q) } },
          { actor: { email: containsText(query.q) } },
          { actor: { displayName: containsText(query.q) } }
        ]
      } : {})
    };
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, email: true, displayName: true } } },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.auditLog.count({ where })
    ]);
    return adminOk(reply, paged(logs, total, query));
  });

  app.get("/api/admin/sub2/status", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    return adminOk(reply, await sub2Client.fetchGatewayStatus());
  });

  app.post("/api/admin/sub2/accounts/:id/refresh", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = sub2AccountParamsSchema.parse(request.params);
    const result = await sub2Client.refreshAccount(id);
    await writeAuditLog(request, actor.id, "admin.sub2.account.refresh", "sub2_account", String(id), null, result);
    return adminOk(reply, result);
  });

  app.post("/api/admin/sub2/accounts/:id/test", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = sub2AccountParamsSchema.parse(request.params);
    const result = await sub2Client.testAccount(id);
    await writeAuditLog(request, actor.id, "admin.sub2.account.test", "sub2_account", String(id), null, {
      ok: result.ok,
      statusCode: result.statusCode,
      events: result.events.map((event) => event.type ?? event.message ?? "event")
    });
    return adminOk(reply, result);
  });

  app.post("/api/admin/sub2/proxy-smoke-test", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const input = sub2SmokeTestSchema.parse(request.body ?? {});
    const result = await sub2Client.runProxySmokeTest(input.model);
    await writeAuditLog(request, actor.id, "admin.sub2.proxy_smoke_test", "sub2_proxy", result.sub2KeyId, null, {
      ok: result.ok,
      model: result.model,
      keyDisabled: result.keyDisabled,
      models: result.models,
      responses: result.responses
    });
    return adminOk(reply, result);
  });

  app.post("/api/admin/sub2/accounts/:id/apply-openai-refresh-token", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = sub2AccountParamsSchema.parse(request.params);
    const input = sub2OpenAiRefreshTokenSchema.parse(request.body ?? {});
    const result = await sub2Client.applyOpenAiRefreshToken(id, input);
    await writeAuditLog(request, actor.id, "admin.sub2.account.apply_openai_refresh_token", "sub2_account", String(id), null, {
      ok: result.ok,
      refreshed: result.refreshed,
      applied: result.applied,
      error: result.error
    });
    return adminOk(reply, result);
  });
}

function adminOk(reply: FastifyReply, data: unknown) {
  return ok(reply, redactSecrets(data));
}

function parseListQuery(raw: unknown): ListQuery {
  const query = listQuerySchema.parse(raw ?? {});
  return {
    ...query,
    q: nonEmpty(query.q),
    status: nonEmpty(query.status),
    resourceType: nonEmpty(query.resourceType),
    action: nonEmpty(query.action)
  };
}

function pageArgs(query: ListQuery) {
  return {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize
  };
}

function paged<T>(items: T[], total: number, query: ListQuery) {
  return {
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize))
  };
}

function containsText(value: string) {
  return { contains: value, mode: Prisma.QueryMode.insensitive };
}

function oneOf<T extends string>(values: readonly T[], value: string | undefined): T | undefined {
  return value && (values as readonly string[]).includes(value) ? value as T : undefined;
}

function nonEmpty(value: string | undefined) {
  return value && value.length > 0 ? value : undefined;
}

function statusAfterResourceTest(current: ResourceStatus, ok: boolean): ResourceStatus {
  if (["disabled", "paused"].includes(current)) return current;
  if (ok) return current === "testing" || current === "pending" || current === "abnormal" ? "online" : current;
  return current === "online" || current === "testing" || current === "pending" || current === "busy" ? "abnormal" : current;
}

function redactSecrets(data: unknown) {
  return JSON.parse(JSON.stringify(data, (key, value) => redactedFields.has(key) ? undefined : value)) as unknown;
}

async function syncSub2KeyForRental(userId: string | undefined, sub2KeyId: string | null | undefined, active: boolean) {
  if (!userId || !sub2KeyId) {
    return { action: "none", ok: true };
  }
  try {
    if (active) {
      await sub2Client.enableKey(userId, sub2KeyId);
      return { action: "enable", ok: true };
    }
    await sub2Client.disableKey(userId, sub2KeyId);
    return { action: "disable", ok: true };
  } catch (error) {
    return {
      action: active ? "enable" : "disable",
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

async function writeAuditLog(
  request: Parameters<typeof requireRole>[0],
  actorUserId: string | undefined,
  action: string,
  objectType: string,
  objectId: string | undefined,
  before: unknown,
  after: unknown
) {
  await prisma.auditLog.create({
    data: {
      actorUserId,
      action,
      objectType,
      objectId,
      before: before === undefined ? undefined : JSON.parse(JSON.stringify(redactSecrets(before))),
      after: after === undefined ? undefined : JSON.parse(JSON.stringify(redactSecrets(after))),
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"]
    }
  });
}
