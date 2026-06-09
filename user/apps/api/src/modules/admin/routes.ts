import type { FastifyInstance, FastifyReply } from "fastify";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "../../common/auth.js";
import { AppError } from "../../common/errors.js";
import { localProxySmokeBuyerId, localProxySmokeProductName, localProxySmokeUserEmail } from "../../common/internal-records.js";
import { prisma } from "../../common/prisma.js";
import { ok } from "../../common/response.js";
import { env, openAiProxyPublicEndpoint } from "../../config/env.js";
import { sub2Client, type Sub2KeyResult, type Sub2ProxySmokeTestResult } from "../../integrations/sub2/client.js";
import { expireOverdueRentals } from "../../jobs/expire-overdue-rentals.js";
import { releaseAvailableSettlements } from "../../jobs/release-settlements.js";
import { getSub2UsageSyncState, syncSub2UsageOnce } from "../../jobs/sync-sub2-usage.js";
import { rotateRentalApiKey } from "../rentals/key-rotation.js";
import { recordOrderStatusHistory } from "../orders/status-history.js";

const redactedFields = new Set(["passwordHash", "keyHash", "sub2KeyHash"]);
const userRoles = ["buyer", "supplier", "operator", "admin"] as const;
const userStatuses = ["active", "disabled", "banned"] as const;
const orderStatuses = ["pending", "paid", "provisioning", "active", "failed", "refunding", "refunded", "expired", "cancelled", "closed"] as const;
const rentalStatuses = ["active", "low_balance", "limited", "suspended", "expired", "refunded", "closed"] as const;
const resourceTypes = ["codex", "claude_code", "gemini", "antigravity"] as const;
const productStatuses = ["draft", "active", "offline"] as const;
const billingModes = ["pay_as_you_go", "daily", "weekly", "monthly"] as const;
const usageStatuses = ["pending", "billed", "refunded", "ignored", "disputed"] as const;
const apiKeyStatuses = ["active", "inactive"] as const;
const supplierStatuses = ["pending", "active", "paused", "disabled"] as const;
const resourceStatuses = ["pending", "testing", "online", "busy", "paused", "abnormal", "disabled"] as const;
const resourceLevels = ["L0", "L1", "L2", "L3", "L4"] as const;
type ResourceStatus = (typeof resourceStatuses)[number];
const settlementStatuses = ["pending", "frozen", "available", "withdrawn", "cancelled"] as const;
const withdrawalStatuses = ["pending", "approved", "rejected", "paid", "cancelled"] as const;
const reconciliationScanLimit = 500;
const reconciliationIssueLimit = 50;
const systemHealthProxyWindowMs = 60 * 60 * 1000;
const systemHealthBillingSyncStaleMs = 24 * 60 * 60 * 1000;
const systemHealthApiKeyScanLimit = 500;
const systemHealthApiKeyIssueLimit = 50;
const sub2BindingReconciliationLimit = 500;
const systemHealthStatuses = ["ok", "warning", "error"] as const;

const listQuerySchema = z.object({
  q: z.string().trim().max(160).optional(),
  status: z.string().trim().max(80).optional(),
  resourceType: z.string().trim().max(80).optional(),
  action: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50)
});

type ListQuery = z.infer<typeof listQuerySchema>;

interface BillingReconciliationIssue {
  id: string;
  severity: "warning" | "error";
  type: string;
  message: string;
  refType: string;
  refId: string;
  amount?: string;
  expected?: string;
  actual?: string;
  createdAt?: string;
}

type SystemHealthStatus = "ok" | "warning" | "error";

interface SystemHealthCheck {
  id: string;
  label: string;
  status: SystemHealthStatus;
  summary: string;
  metrics?: Record<string, string | number | boolean | null>;
  detail?: unknown;
}

interface Sub2BindingIssue {
  id: string;
  type: string;
  severity: "warning" | "error";
  rentalId?: string;
  bindingId?: string;
  sub2Type?: string;
  expected?: string | null;
  actual?: string | null;
  message: string;
}

interface ApiKeyReadinessIssue {
  id: string;
  type: string;
  severity: "warning" | "error";
  apiKeyId: string;
  rentalId?: string | null;
  userId: string;
  keyPrefix: string;
  message: string;
}

const orderDetailInclude = {
  user: { include: { roles: true, wallet: true } },
  items: { include: { product: true } },
  rentals: {
    include: {
      product: true,
      limits: true,
      apiKeys: { orderBy: { createdAt: "desc" }, take: 20 }
    },
    orderBy: { createdAt: "desc" }
  },
  statusHistory: { orderBy: { createdAt: "desc" }, take: 50 }
} satisfies Prisma.OrderInclude;

const withdrawalInclude = {
  supplier: { include: { user: true } },
  settlements: {
    include: { settlementRecord: true },
    orderBy: { createdAt: "asc" }
  }
} satisfies Prisma.WithdrawalInclude;

const userStatusSchema = z.object({
  status: z.enum(["active", "disabled", "banned"])
});

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(64).optional(),
  roles: z.array(z.enum(userRoles)).min(1).default(["buyer"])
});

const nullableProfileText = (max: number) => z.union([z.string().trim().min(1).max(max), z.null()]).optional();

const updateUserSchema = z.object({
  displayName: nullableProfileText(64),
  phone: nullableProfileText(32),
  password: z.string().min(8).max(200).optional()
}).refine((input) => Object.values(input).some((value) => value !== undefined), {
  message: "At least one user field must be provided"
});

const userRolesSchema = z.object({
  roles: z.array(z.enum(userRoles)).min(1)
});

const walletAdjustSchema = z.object({
  amount: z.coerce.number().refine((value) => value !== 0, "Amount cannot be zero"),
  note: z.string().max(240).optional()
});

const orderActionSchema = z.object({
  note: z.string().trim().max(500).optional()
});

const rentalStatusSchema = z.object({
  status: z.enum(rentalStatuses)
});

const nullablePositiveInteger = z.union([z.coerce.number().int().positive(), z.null()]).optional();
const nullablePositiveDecimal = z.union([z.coerce.number().positive(), z.null()]).optional();
const nullableNonNegativeDecimal = z.union([z.coerce.number().nonnegative(), z.null()]).optional();

const rentalLimitsSchema = z.object({
  maxConcurrency: z.coerce.number().int().min(1).max(200).optional(),
  rpmLimit: nullablePositiveInteger,
  tpmLimit: nullablePositiveInteger,
  requestLimit: nullablePositiveInteger,
  spendLimit: nullablePositiveDecimal,
  remainingSpend: nullableNonNegativeDecimal
}).refine((input) => Object.values(input).some((value) => value !== undefined), {
  message: "At least one limit field must be provided"
});

const apiKeyStatusSchema = z.object({
  status: z.enum(apiKeyStatuses)
});

const apiKeyBulkStatusSchema = z.object({
  status: z.enum(apiKeyStatuses),
  q: z.string().trim().max(160).optional(),
  currentStatus: z.enum(apiKeyStatuses).optional(),
  resourceType: z.enum(resourceTypes).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500)
});

const createProductSchema = z.object({
  name: z.string().trim().min(1).max(120),
  resourceType: z.enum(resourceTypes),
  billingMode: z.enum(billingModes).default("monthly"),
  status: z.enum(productStatuses).default("draft"),
  description: z.string().trim().max(2000).optional()
});

const updateProductSchema = createProductSchema
  .partial()
  .extend({
    description: z.union([z.string().trim().max(2000), z.null()]).optional()
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: "At least one product field must be provided"
  });

const createProductPriceSchema = z.object({
  tierCode: z.string().trim().min(1).max(80).regex(/^[a-z0-9_-]+$/),
  displayName: z.string().trim().min(1).max(120),
  fixedPrice: z.coerce.number().positive(),
  durationDays: z.coerce.number().int().positive().optional(),
  maxConcurrency: z.coerce.number().int().min(1).max(200).default(1),
  rpmLimit: z.coerce.number().int().positive().optional(),
  tpmLimit: z.coerce.number().int().positive().optional(),
  requestLimit: z.coerce.number().int().positive().optional(),
  spendLimit: z.coerce.number().positive().optional(),
  discountRate: z.coerce.number().min(0).max(1).default(0.2),
  tierMultiplier: z.coerce.number().positive().default(1),
  status: z.enum(productStatuses).default("active")
});

const updateProductPriceSchema = createProductPriceSchema
  .omit({ tierCode: true })
  .partial()
  .extend({
    durationDays: nullablePositiveInteger,
    rpmLimit: nullablePositiveInteger,
    tpmLimit: nullablePositiveInteger,
    requestLimit: nullablePositiveInteger,
    spendLimit: nullablePositiveDecimal
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: "At least one product price field must be provided"
  });

const resourceStatusSchema = z.object({
  status: z.enum(resourceStatuses),
  level: z.enum(resourceLevels).optional(),
  sub2AccountId: z.string().trim().min(1).nullable().optional()
});

const updateResourceSchema = z.object({
  status: z.enum(resourceStatuses).optional(),
  level: z.enum(resourceLevels).optional(),
  maxConcurrency: z.coerce.number().int().min(1).max(200).optional(),
  shareRate: z.coerce.number().min(0).max(1).optional(),
  reserveRatio: z.coerce.number().min(0).max(1).optional(),
  dailyCap: z.union([z.coerce.number().positive(), z.null()]).optional(),
  sub2AccountId: z.string().trim().min(1).nullable().optional()
}).refine((input) => Object.values(input).some((value) => value !== undefined), {
  message: "At least one resource field must be provided"
});

const createResourceSchema = z.object({
  supplierEmail: z.string().email(),
  displayName: z.string().trim().min(1).max(64).optional(),
  resourceType: z.enum(["codex", "claude_code", "gemini", "antigravity"]),
  status: z.enum(["pending", "testing", "online", "busy", "paused", "abnormal", "disabled"]).default("pending"),
  level: z.enum(resourceLevels).default("L0"),
  maxConcurrency: z.coerce.number().int().min(1).max(200).default(1),
  shareRate: z.coerce.number().min(0).max(1).default(0.7),
  reserveRatio: z.coerce.number().min(0).max(1).default(0.2),
  dailyCap: z.coerce.number().positive().optional(),
  sub2AccountId: z.string().trim().min(1).optional()
});

const updateSupplierSchema = z.object({
  displayName: nullableProfileText(64),
  status: z.enum(supplierStatuses).optional(),
  defaultShareRate: z.coerce.number().min(0).max(1).optional()
}).refine((input) => Object.values(input).some((value) => value !== undefined), {
  message: "At least one supplier field must be provided"
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

const releaseSettlementsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(200)
});

const systemMaintenanceSchema = z.object({
  expireOverdueRentals: z.boolean().default(true),
  expireOverdueRentalsLimit: z.coerce.number().int().min(1).max(500).default(200),
  deactivateInvalidProxyApiKeys: z.boolean().default(true),
  deactivateInvalidProxyApiKeysLimit: z.coerce.number().int().min(1).max(1000).default(500),
  releaseAvailableSettlements: z.boolean().default(true),
  releaseAvailableSettlementsLimit: z.coerce.number().int().min(1).max(1000).default(500),
  repairSub2Bindings: z.boolean().default(true),
  cleanupSmokeData: z.boolean().default(true),
  cleanupSmokeDataAgeMinutes: z.coerce.number().int().min(5).max(1440).default(30),
  cleanupSmokeDataLimit: z.coerce.number().int().min(1).max(500).default(100)
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
      prisma.user.count({ where: nonSmokeUserWhere() }),
      prisma.rental.count({ where: { status: "active", ...nonSmokeRentalWhere() } }),
      prisma.supplierResource.count({ where: { status: "online" } }),
      prisma.withdrawal.count({ where: { status: "pending" } }),
      prisma.usageRecord.aggregate({
        where: nonSmokeUsageWhere(),
        _sum: { buyerCharge: true, supplierIncome: true },
        _count: true
      }),
      prisma.walletAccount.aggregate({
        where: nonSmokeWalletWhere(),
        _sum: { availableBalance: true, frozenBalance: true, totalRecharged: true, totalSpent: true }
      }),
      prisma.order.aggregate({
        where: { status: { in: ["paid", "provisioning", "active", "closed", "expired"] }, ...nonSmokeOrderWhere() },
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

  app.get("/api/admin/system-health", async (request, reply) => {
    const actor = await requireRole(request, ["operator", "admin"]);
    const report = await buildSystemHealthReport();
    await recordSystemHealthSnapshot(report, "manual", actor.id);
    return adminOk(reply, report);
  });

  app.get("/api/admin/system-health/snapshots", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(systemHealthStatuses, query.status);
    const where: Prisma.SystemHealthSnapshotWhereInput = {
      ...(status ? { status } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { source: containsText(query.q) },
          { actorUserId: containsText(query.q) },
          { actor: { email: containsText(query.q) } },
          { actor: { displayName: containsText(query.q) } }
        ]
      } : {})
    };
    const [snapshots, total] = await Promise.all([
      prisma.systemHealthSnapshot.findMany({
        where,
        select: {
          id: true,
          status: true,
          source: true,
          summary: true,
          createdAt: true,
          actor: { select: { id: true, email: true, displayName: true } }
        },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.systemHealthSnapshot.count({ where })
    ]);
    return adminOk(reply, paged(snapshots, total, query));
  });

  app.post("/api/admin/system-maintenance/run", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const input = systemMaintenanceSchema.parse(request.body ?? {});
    const result = await runSystemMaintenance(input);
    await recordSystemHealthSnapshot(result.health, "maintenance", actor.id);
    await writeAuditLog(request, actor.id, "admin.system.maintenance_run", "system", undefined, null, result);
    return adminOk(reply, result);
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
      ...nonSmokeUserWhere(),
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

  app.patch("/api/admin/users/:id", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = updateUserSchema.parse(request.body ?? {});
    const before = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, displayName: true, phone: true, status: true }
    });
    if (!before) throw new AppError("user_not_found", "User not found", 404);

    const data: Prisma.UserUpdateInput = {};
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.password !== undefined) data.passwordHash = await bcrypt.hash(input.password, 12);

    const user = await prisma.user.update({
      where: { id },
      data,
      include: {
        roles: true,
        wallet: true,
        supplier: true,
        _count: { select: { orders: true, rentals: true, apiKeys: true } }
      }
    });
    await writeAuditLog(request, actor.id, "admin.user.update", "user", id, {
      email: before.email,
      displayName: before.displayName,
      phone: before.phone,
      status: before.status
    }, {
      email: user.email,
      displayName: user.displayName,
      phone: user.phone,
      status: user.status,
      passwordReset: input.password !== undefined
    });
    return adminOk(reply, user);
  });

  app.patch("/api/admin/users/:id/status", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = userStatusSchema.parse(request.body);
    const before = await prisma.user.findUnique({
      where: { id },
      include: { roles: true }
    });
    if (!before) throw new AppError("user_not_found", "User not found", 404);

    const isAdminTarget = before.roles.some((role) => role.role === "admin");
    if (isAdminTarget && input.status !== "active") {
      if (actor.id === id) {
        throw new AppError("cannot_disable_self", "Cannot disable or ban your own admin account", 400);
      }
      if (before.status === "active") {
        const activeAdminCount = await prisma.user.count({
          where: {
            status: "active",
            roles: { some: { role: "admin" } }
          }
        });
        if (activeAdminCount <= 1) {
          throw new AppError("last_active_admin_required", "At least one active admin user must remain", 400);
        }
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data: { status: input.status },
      include: { roles: true, wallet: true }
    });
    await writeAuditLog(request, actor.id, "admin.user.status", "user", id, {
      status: before.status,
      roles: before.roles.map((role) => role.role)
    }, { status: user.status });
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
      if (amount.lt(0)) {
        const debit = await tx.walletAccount.updateMany({
          where: {
            id: current.id,
            availableBalance: { gte: amount.abs() }
          },
          data: {
            availableBalance: { decrement: amount.abs() }
          }
        });
        if (debit.count !== 1) {
          throw new AppError("insufficient_balance", "Wallet adjustment would make balance negative", 400);
        }
      } else {
        await tx.walletAccount.update({
          where: { id: current.id },
          data: {
            availableBalance: { increment: amount }
          }
        });
      }
      const updated = await tx.walletAccount.findUniqueOrThrow({ where: { id: current.id } });
      await tx.walletTransaction.create({
        data: {
          walletId: current.id,
          type: "adjustment",
          amount,
          balanceAfter: updated.availableBalance,
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
      ...nonSmokeOrderWhere(),
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
    const [order, walletTransactions, walletTransactionSummary, proxyRequests, proxyRequestSummary] = await Promise.all([
      prisma.order.findUnique({
        where: { id },
        include: orderDetailInclude
      }),
      prisma.walletTransaction.findMany({
        where: { refType: "order", refId: id },
        include: { wallet: { include: { user: true } } },
        orderBy: { createdAt: "desc" },
        take: 50
      }),
      prisma.walletTransaction.aggregate({
        where: { refType: "order", refId: id },
        _count: true,
        _sum: { amount: true }
      }),
      prisma.proxyRequestLog.findMany({
        where: { rental: { orderId: id } },
        include: {
          user: { select: { id: true, email: true, displayName: true } },
          rental: { select: { id: true, resourceType: true, status: true, product: { select: { name: true } } } },
          apiKey: { select: { id: true, name: true, keyPrefix: true, status: true } }
        },
        orderBy: { createdAt: "desc" },
        take: 50
      }),
      prisma.proxyRequestLog.aggregate({
        where: { rental: { orderId: id } },
        _count: true
      })
    ]);
    if (!order) throw new AppError("order_not_found", "Order not found", 404);
    return adminOk(reply, { ...order, walletTransactions, walletTransactionSummary, proxyRequests, proxyRequestSummary });
  });

  app.post("/api/admin/orders/:id/cancel", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = orderActionSchema.parse(request.body ?? {});
    const before = await prisma.order.findUnique({
      where: { id },
      include: { rentals: true }
    });
    if (!before) throw new AppError("order_not_found", "Order not found", 404);
    if (before.status === "cancelled") {
      return adminOk(reply, { order: await prisma.order.findUniqueOrThrow({ where: { id }, include: orderDetailInclude }), cancelled: false });
    }
    if (before.paidAmount.gt(0) || before.rentals.length > 0) {
      throw new AppError("order_requires_refund", "Paid or provisioned orders must be refunded instead of cancelled", 400);
    }
    if (!["pending", "failed"].includes(before.status)) {
      throw new AppError("order_not_cancellable", `Order cannot be cancelled from ${before.status}`, 400);
    }

    const order = await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: { status: "cancelled" }
      });
      await recordOrderStatusHistory(tx, {
        orderId: id,
        fromStatus: before.status,
        toStatus: "cancelled",
        actorUserId: actor.id,
        reason: "admin.order.cancel",
        meta: { note: input.note }
      });
      return tx.order.findUniqueOrThrow({ where: { id }, include: orderDetailInclude });
    });
    await writeAuditLog(request, actor.id, "admin.order.cancel", "order", id, {
      status: before.status,
      paidAmount: String(before.paidAmount),
      rentalCount: before.rentals.length
    }, {
      status: order.status,
      note: input.note
    });
    return adminOk(reply, { order, cancelled: true });
  });

  app.post("/api/admin/orders/:id/refund", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = orderActionSchema.parse(request.body ?? {});
    const before = await prisma.order.findUnique({
      where: { id },
      include: {
        rentals: { include: { apiKeys: true } },
        user: { include: { wallet: true } }
      }
    });
    if (!before) throw new AppError("order_not_found", "Order not found", 404);
    const existingRefund = await prisma.walletTransaction.findFirst({
      where: { type: "refund", refType: "order", refId: id },
      select: { id: true, amount: true }
    });
    if (["refunded", "cancelled"].includes(before.status)) {
      if (before.status === "refunded" && existingRefund) {
        const order = await prisma.order.findUniqueOrThrow({ where: { id }, include: orderDetailInclude });
        await writeAuditLog(request, actor.id, "admin.order.refund", "order", id, {
          status: before.status,
          paidAmount: String(before.paidAmount),
          existingRefundId: existingRefund.id
        }, {
          status: order.status,
          refundAmount: "0",
          walletRefunded: false,
          replayed: true,
          note: input.note
        });
        return adminOk(reply, {
          order,
          refundAmount: "0",
          walletRefunded: false,
          existingRefundId: existingRefund.id,
          sub2Sync: []
        });
      }
      throw new AppError("order_already_terminal", `Order is already ${before.status}`, 400);
    }
    if (!["paid", "provisioning", "active", "failed", "refunding", "closed", "expired"].includes(before.status)) {
      throw new AppError("order_not_refundable", `Order cannot be refunded from ${before.status}`, 400);
    }
    if (before.paidAmount.lte(0)) {
      throw new AppError("order_has_no_paid_amount", "Order has no paid amount to refund", 400);
    }

    const rentalIds = before.rentals.map((rental) => rental.id);
    if (existingRefund) {
      const order = await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id }, data: { status: "refunded" } });
        await recordOrderStatusHistory(tx, {
          orderId: id,
          fromStatus: before.status,
          toStatus: "refunded",
          actorUserId: actor.id,
          reason: "admin.order.refund.reconcile",
          meta: { existingRefundId: existingRefund.id, note: input.note }
        });
        await tx.rental.updateMany({
          where: { orderId: id, status: { not: "refunded" } },
          data: { status: "refunded" }
        });
        if (rentalIds.length > 0) {
          await tx.apiKey.updateMany({
            where: { rentalId: { in: rentalIds } },
            data: { status: "inactive" }
          });
        }
        return tx.order.findUniqueOrThrow({ where: { id }, include: orderDetailInclude });
      });

      const sub2Sync = [];
      for (const rental of before.rentals) {
        sub2Sync.push({
          rentalId: rental.id,
          sub2KeyId: rental.sub2KeyId,
          ...(await syncSub2KeyForRental(rental.userId, rental.sub2KeyId, false))
        });
      }
      await writeAuditLog(request, actor.id, "admin.order.refund", "order", id, {
        status: before.status,
        paidAmount: String(before.paidAmount),
        existingRefundId: existingRefund.id
      }, {
        status: order.status,
        refundAmount: "0",
        walletRefunded: false,
        existingRefundId: existingRefund.id,
        replayed: true,
        sub2Sync,
        note: input.note
      });
      return adminOk(reply, {
        order,
        refundAmount: "0",
        walletRefunded: false,
        existingRefundId: existingRefund.id,
        sub2Sync
      });
    }

    const refundResult = await prisma.$transaction(async (tx) => {
      const claim = await tx.order.updateMany({
        where: {
          id,
          status: { in: ["paid", "provisioning", "active", "failed", "closed", "expired"] }
        },
        data: { status: "refunding" }
      });
      if (claim.count !== 1) {
        const transaction = await tx.walletTransaction.findFirst({
          where: { type: "refund", refType: "order", refId: id },
          select: { id: true }
        });
        if (!transaction) {
          throw new AppError("refund_in_progress", "Order refund is already in progress", 409);
        }
        return {
          order: await tx.order.findUniqueOrThrow({ where: { id }, include: orderDetailInclude }),
          refundAmount: new Prisma.Decimal(0),
          walletRefunded: false,
          existingRefundId: transaction.id
        };
      }
      await recordOrderStatusHistory(tx, {
        orderId: id,
        fromStatus: before.status,
        toStatus: "refunding",
        actorUserId: actor.id,
        reason: "admin.order.refund.start",
        meta: { note: input.note }
      });

      const wallet = await tx.walletAccount.upsert({
        where: { userId: before.userId },
        update: {},
        create: { userId: before.userId, currency: before.currency }
      });
      await tx.$executeRaw`
        UPDATE "WalletAccount"
        SET
          "availableBalance" = "availableBalance" + ${before.paidAmount},
          "totalSpent" = GREATEST("totalSpent" - ${before.paidAmount}, 0),
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${wallet.id}
      `;
      const updatedWallet = await tx.walletAccount.findUniqueOrThrow({ where: { id: wallet.id } });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "refund",
          amount: before.paidAmount,
          balanceAfter: updatedWallet.availableBalance,
          currency: before.currency,
          refType: "order",
          refId: id,
          note: input.note ?? "admin order refund"
        }
      });
      await tx.order.update({ where: { id }, data: { status: "refunded" } });
      await recordOrderStatusHistory(tx, {
        orderId: id,
        fromStatus: "refunding",
        toStatus: "refunded",
        actorUserId: actor.id,
        reason: "admin.order.refund.complete",
        meta: { refundAmount: String(before.paidAmount), note: input.note }
      });
      await tx.rental.updateMany({
        where: { orderId: id, status: { not: "refunded" } },
        data: { status: "refunded" }
      });
      if (rentalIds.length > 0) {
        await tx.apiKey.updateMany({
          where: { rentalId: { in: rentalIds } },
          data: { status: "inactive" }
        });
      }
      return {
        order: await tx.order.findUniqueOrThrow({ where: { id }, include: orderDetailInclude }),
        refundAmount: before.paidAmount,
        walletRefunded: true,
        existingRefundId: null
      };
    });
    const order = refundResult.order;

    const sub2Sync = [];
    for (const rental of before.rentals) {
      sub2Sync.push({
        rentalId: rental.id,
        sub2KeyId: rental.sub2KeyId,
        ...(await syncSub2KeyForRental(rental.userId, rental.sub2KeyId, false))
      });
    }
    await writeAuditLog(request, actor.id, "admin.order.refund", "order", id, {
      status: before.status,
      paidAmount: String(before.paidAmount),
      rentalStatuses: before.rentals.map((rental) => ({ id: rental.id, status: rental.status, sub2KeyId: rental.sub2KeyId })),
      apiKeyStatuses: before.rentals.flatMap((rental) => rental.apiKeys.map((apiKey) => ({ id: apiKey.id, status: apiKey.status })))
    }, {
      status: order.status,
      refundAmount: String(refundResult.refundAmount),
      walletRefunded: refundResult.walletRefunded,
      existingRefundId: refundResult.existingRefundId,
      sub2Sync,
      note: input.note
    });
    return adminOk(reply, {
      order,
      refundAmount: String(refundResult.refundAmount),
      walletRefunded: refundResult.walletRefunded,
      existingRefundId: refundResult.existingRefundId,
      sub2Sync
    });
  });

  app.get("/api/admin/rentals", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(rentalStatuses, query.status);
    const resourceType = oneOf(resourceTypes, query.resourceType);
    const where: Prisma.RentalWhereInput = {
      ...nonSmokeRentalWhere(),
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

  app.get("/api/admin/rentals/:id", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const { id } = request.params as { id: string };
    const [rental, usageSummary, proxyRequestSummary] = await Promise.all([
      prisma.rental.findUnique({
        where: { id },
        include: {
          user: { include: { roles: true, wallet: true } },
          product: true,
          limits: true,
          order: {
            include: {
              user: true,
              items: { include: { product: true } }
            }
          },
          apiKeys: { orderBy: { createdAt: "desc" }, take: 20 },
          usages: {
            include: {
              supplierResource: { include: { supplier: { include: { user: true } } } },
              settlements: true
            },
            orderBy: { occurredAt: "desc" },
            take: 50
          },
          proxyRequestLogs: {
            include: {
              user: { select: { id: true, email: true, displayName: true } },
              apiKey: { select: { id: true, name: true, keyPrefix: true, status: true } }
            },
            orderBy: { createdAt: "desc" },
            take: 50
          }
        }
      }),
      prisma.usageRecord.aggregate({
        where: { rentalId: id },
        _count: true,
        _sum: {
          inputUnits: true,
          outputUnits: true,
          apiEquivalentCost: true,
          buyerCharge: true,
          supplierIncome: true
        }
      }),
      prisma.proxyRequestLog.aggregate({
        where: { rentalId: id },
        _count: true
      })
    ]);
    if (!rental) throw new AppError("rental_not_found", "Rental not found", 404);
    return adminOk(reply, { ...rental, usageSummary, proxyRequestSummary });
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

  app.patch("/api/admin/rentals/:id/limits", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = rentalLimitsSchema.parse(request.body ?? {});
    const before = await prisma.rental.findUnique({
      where: { id },
      include: { limits: true }
    });
    if (!before) throw new AppError("rental_not_found", "Rental not found", 404);

    const rental = await prisma.$transaction(async (tx) => {
      await tx.rentalLimit.upsert({
        where: { rentalId: id },
        create: {
          rentalId: id,
          maxConcurrency: input.maxConcurrency ?? 1,
          rpmLimit: input.rpmLimit ?? null,
          tpmLimit: input.tpmLimit ?? null,
          requestLimit: input.requestLimit ?? null,
          spendLimit: decimalOrNull(input.spendLimit),
          remainingSpend: input.remainingSpend !== undefined
            ? decimalOrNull(input.remainingSpend)
            : decimalOrNull(input.spendLimit)
        },
        update: rentalLimitUpdateData(input)
      });
      return tx.rental.findUniqueOrThrow({
        where: { id },
        include: { user: true, product: true, limits: true, order: true, apiKeys: { orderBy: { createdAt: "desc" }, take: 5 } }
      });
    });
    await writeAuditLog(request, actor.id, "admin.rental.limits", "rental", id, before.limits, rental.limits);
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

  app.get("/api/admin/api-keys", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(apiKeyStatuses, query.status);
    const resourceType = oneOf(resourceTypes, query.resourceType);
    const where = apiKeyListWhere({ q: query.q, status, resourceType });
    const [apiKeys, total] = await Promise.all([
      prisma.apiKey.findMany({
        where,
        include: {
          user: { include: { roles: true } },
          rental: { include: { product: true, order: true } }
        },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.apiKey.count({ where })
    ]);
    return adminOk(reply, paged(apiKeys, total, query));
  });

  app.post("/api/admin/api-keys/bulk-status", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const input = apiKeyBulkStatusSchema.parse(request.body ?? {});
    const where = apiKeyListWhere({
      q: nonEmpty(input.q),
      status: input.currentStatus,
      resourceType: input.resourceType
    });
    const [total, candidates] = await Promise.all([
      prisma.apiKey.count({ where }),
      prisma.apiKey.findMany({
        where,
        include: { user: true, rental: true },
        orderBy: { createdAt: "desc" },
        take: input.limit
      })
    ]);
    const targetKeys = candidates.filter((apiKey) => apiKey.status !== input.status);
    const inactiveRentalKeys = input.status === "active"
      ? targetKeys.filter((apiKey) => apiKey.rental?.status !== "active")
      : [];
    if (inactiveRentalKeys.length) {
      throw new AppError("rental_not_active", "Cannot activate API keys for inactive rentals", 400, {
        count: inactiveRentalKeys.length,
        apiKeyIds: inactiveRentalKeys.slice(0, 20).map((apiKey) => apiKey.id)
      });
    }

    const sub2SyncResults = [];
    for (const apiKey of targetKeys) {
      const sub2Sync = await syncSub2KeyForRental(apiKey.rental?.userId ?? apiKey.userId, apiKey.rental?.sub2KeyId, input.status === "active");
      sub2SyncResults.push({
        apiKeyId: apiKey.id,
        rentalId: apiKey.rentalId,
        sub2KeyId: apiKey.rental?.sub2KeyId,
        ...sub2Sync
      });
    }
    const failedSub2Sync = sub2SyncResults.filter((result) => !result.ok);
    if (input.status === "active" && failedSub2Sync.length) {
      throw new AppError("sub2_key_enable_failed", "One or more Sub2 keys could not be enabled", 502, {
        failed: failedSub2Sync.slice(0, 20)
      });
    }

    const updated = targetKeys.length
      ? await prisma.apiKey.updateMany({
        where: { id: { in: targetKeys.map((apiKey) => apiKey.id) } },
        data: { status: input.status }
      })
      : { count: 0 };
    const result = {
      matched: total,
      processed: candidates.length,
      changed: updated.count,
      skippedAlreadyStatus: candidates.length - targetKeys.length,
      truncated: total > candidates.length,
      limit: input.limit,
      targetStatus: input.status,
      sub2SyncAttempted: sub2SyncResults.length,
      sub2SyncFailed: failedSub2Sync.length,
      sub2SyncFailures: failedSub2Sync.slice(0, 20)
    };
    await writeAuditLog(request, actor.id, "admin.api_key.bulk_status", "api_key", undefined, {
      filters: {
        q: nonEmpty(input.q),
        currentStatus: input.currentStatus,
        resourceType: input.resourceType,
        limit: input.limit
      },
      matched: total,
      processed: candidates.length
    }, result);
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
    const where: Prisma.WalletAccountWhereInput = {
      ...nonSmokeWalletWhere(),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { userId: containsText(query.q) },
          { user: { id: containsText(query.q) } },
          { user: { email: containsText(query.q) } },
          { user: { displayName: containsText(query.q) } }
        ]
      } : {})
    };
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

  app.get("/api/admin/wallets/:id", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const { id } = request.params as { id: string };
    const wallet = await prisma.walletAccount.findUnique({
      where: { id },
      include: {
        user: { include: { roles: true } },
        transactions: {
          orderBy: { createdAt: "desc" },
          take: 100
        }
      }
    });
    if (!wallet) throw new AppError("wallet_not_found", "Wallet not found", 404);
    const transactionSummary = await prisma.walletTransaction.aggregate({
      where: { walletId: id },
      _count: true,
      _sum: { amount: true }
    });
    return adminOk(reply, { ...wallet, transactionSummary });
  });

  app.get("/api/admin/wallet-transactions", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const where: Prisma.WalletTransactionWhereInput = {
      ...nonSmokeWalletTransactionWhere(),
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
    const query = parseListQuery(request.query);
    const status = oneOf(orderStatuses, query.status);
    const where: Prisma.OrderWhereInput = {
      ...nonSmokeOrderWhere(),
      ...(status ? { status } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { paymentRef: containsText(query.q) },
          { userId: containsText(query.q) },
          { user: { id: containsText(query.q) } },
          { user: { email: containsText(query.q) } },
          { user: { displayName: containsText(query.q) } },
          { items: { some: { product: { name: containsText(query.q) } } } },
          { rentals: { some: { id: containsText(query.q) } } },
          { rentals: { some: { sub2KeyId: containsText(query.q) } } },
          { rentals: { some: { endpointUrl: containsText(query.q) } } }
        ]
      } : {})
    };
    const usageWhere: Prisma.UsageRecordWhereInput = {
      ...nonSmokeUsageWhere(),
      rental: {
        ...nonSmokeRentalWhere(),
        order: where
      }
    };
    const [orders, total, orderAgg, usageAgg] = await Promise.all([
      prisma.order.findMany({
        where,
        include: { user: true, items: true, rentals: true },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.order.count({ where }),
      prisma.order.aggregate({
        where,
        _sum: { totalAmount: true, paidAmount: true },
        _count: true
      }),
      prisma.usageRecord.aggregate({
        where: usageWhere,
        _sum: { buyerCharge: true, supplierIncome: true },
        _count: true
      })
    ]);
    return adminOk(reply, {
      ...paged(orders, total, query),
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

  app.get("/api/admin/reconciliation", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    return adminOk(reply, await findBillingReconciliationIssues());
  });

  app.get("/api/admin/usages", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(usageStatuses, query.status);
    const resourceType = oneOf(resourceTypes, query.resourceType);
    const where: Prisma.UsageRecordWhereInput = {
      ...nonSmokeUsageWhere(),
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
    const result = await syncSub2UsageOnce(input.cursor, { persistCursor: true });
    await writeAuditLog(request, actor.id, "admin.usage.sync_sub2", "usage_sync", undefined, null, result);
    return adminOk(reply, result);
  });

  app.get("/api/admin/usages/sync-state", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    return adminOk(reply, await getSub2UsageSyncState());
  });

  app.get("/api/admin/products", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(productStatuses, query.status);
    const resourceType = oneOf(resourceTypes, query.resourceType);
    const where: Prisma.ProductWhereInput = {
      ...nonSmokeProductWhere(),
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
        rpmLimit: input.rpmLimit,
        tpmLimit: input.tpmLimit,
        requestLimit: input.requestLimit,
        spendLimit: input.spendLimit !== undefined ? new Prisma.Decimal(input.spendLimit) : undefined,
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
      rpmLimit: price.rpmLimit,
      tpmLimit: price.tpmLimit,
      spendLimit: price.spendLimit ? String(price.spendLimit) : null,
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
        rpmLimit: true,
        tpmLimit: true,
        requestLimit: true,
        spendLimit: true,
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
        ...(input.rpmLimit !== undefined ? { rpmLimit: input.rpmLimit } : {}),
        ...(input.tpmLimit !== undefined ? { tpmLimit: input.tpmLimit } : {}),
        ...(input.requestLimit !== undefined ? { requestLimit: input.requestLimit } : {}),
        ...(input.spendLimit !== undefined ? { spendLimit: decimalOrNull(input.spendLimit) } : {}),
        ...(input.discountRate !== undefined ? { discountRate: new Prisma.Decimal(input.discountRate) } : {}),
        ...(input.tierMultiplier !== undefined ? { tierMultiplier: new Prisma.Decimal(input.tierMultiplier) } : {}),
        ...(input.status !== undefined ? { status: input.status } : {})
      }
    });
    await writeAuditLog(request, actor.id, "admin.product_price.update", "product_price", id, before, {
      productId: price.productId,
      displayName: price.displayName,
      fixedPrice: String(price.fixedPrice),
      durationDays: price.durationDays,
      maxConcurrency: price.maxConcurrency,
      rpmLimit: price.rpmLimit,
      tpmLimit: price.tpmLimit,
      requestLimit: price.requestLimit,
      spendLimit: price.spendLimit ? String(price.spendLimit) : null,
      discountRate: String(price.discountRate),
      tierMultiplier: String(price.tierMultiplier),
      status: price.status
    });
    return adminOk(reply, price);
  });

  app.get("/api/admin/suppliers", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const status = oneOf(supplierStatuses, query.status);
    const where: Prisma.SupplierWhereInput = {
      ...(status ? { status } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { displayName: containsText(query.q) },
          { userId: containsText(query.q) },
          { user: { id: containsText(query.q) } },
          { user: { email: containsText(query.q) } },
          { user: { displayName: containsText(query.q) } },
          ...(oneOf(supplierStatuses, query.q) ? [{ status: oneOf(supplierStatuses, query.q) }] : [])
        ]
      } : {})
    };
    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        include: {
          user: { include: { roles: true } },
          resources: { orderBy: { updatedAt: "desc" }, take: 5 },
          _count: { select: { resources: true, withdrawals: true } }
        },
        orderBy: { updatedAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.supplier.count({ where })
    ]);
    return adminOk(reply, paged(suppliers, total, query));
  });

  app.patch("/api/admin/suppliers/:id", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = updateSupplierSchema.parse(request.body ?? {});
    const before = await prisma.supplier.findUnique({
      where: { id },
      select: { id: true, userId: true, displayName: true, status: true, defaultShareRate: true }
    });
    if (!before) throw new AppError("supplier_not_found", "Supplier not found", 404);
    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.defaultShareRate !== undefined ? { defaultShareRate: new Prisma.Decimal(input.defaultShareRate) } : {})
      },
      include: {
        user: { include: { roles: true } },
        resources: { orderBy: { updatedAt: "desc" }, take: 5 },
        _count: { select: { resources: true, withdrawals: true } }
      }
    });
    await writeAuditLog(request, actor.id, "admin.supplier.update", "supplier", id, {
      userId: before.userId,
      displayName: before.displayName,
      status: before.status,
      defaultShareRate: String(before.defaultShareRate)
    }, {
      userId: supplier.userId,
      displayName: supplier.displayName,
      status: supplier.status,
      defaultShareRate: String(supplier.defaultShareRate)
    });
    return adminOk(reply, supplier);
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
          ...(oneOf(resourceLevels, query.q) ? [{ level: oneOf(resourceLevels, query.q) }] : [])
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

  app.patch("/api/admin/resources/:id", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const { id } = request.params as { id: string };
    const input = updateResourceSchema.parse(request.body);
    const before = await prisma.supplierResource.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        level: true,
        maxConcurrency: true,
        shareRate: true,
        reserveRatio: true,
        dailyCap: true,
        sub2AccountId: true,
        lastCheckedAt: true
      }
    });
    if (!before) throw new AppError("resource_not_found", "Supplier resource not found", 404);

    const data: Prisma.SupplierResourceUpdateInput = {};
    if (input.status !== undefined) data.status = input.status;
    if (input.level !== undefined) data.level = input.level;
    if (input.maxConcurrency !== undefined) data.maxConcurrency = input.maxConcurrency;
    if (input.shareRate !== undefined) data.shareRate = new Prisma.Decimal(input.shareRate);
    if (input.reserveRatio !== undefined) data.reserveRatio = new Prisma.Decimal(input.reserveRatio);
    if (input.dailyCap !== undefined) data.dailyCap = input.dailyCap === null ? null : new Prisma.Decimal(input.dailyCap);
    if (input.sub2AccountId !== undefined) {
      data.sub2AccountId = input.sub2AccountId;
      data.lastCheckedAt = null;
    }

    const resource = await prisma.supplierResource.update({
      where: { id },
      data,
      include: { supplier: { include: { user: true } } }
    });
    await writeAuditLog(request, actor.id, "admin.resource.update", "supplier_resource", id, resourceConfigAuditPayload(before), resourceConfigAuditPayload(resource));
    return adminOk(reply, resource);
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
    if (!before) throw new AppError("resource_not_found", "Supplier resource not found", 404);
    const data: Prisma.SupplierResourceUpdateInput = {
      status: input.status,
      lastCheckedAt: new Date()
    };
    if (input.level !== undefined) data.level = input.level;
    if (input.sub2AccountId !== undefined) data.sub2AccountId = input.sub2AccountId;
    const resource = await prisma.supplierResource.update({
      where: { id },
      data,
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

  app.post("/api/admin/settlements/release-available", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const input = releaseSettlementsSchema.parse(request.body ?? {});
    const result = await releaseAvailableSettlements({ limit: input.limit });
    await writeAuditLog(request, actor.id, "admin.settlement.release_available", "settlement", undefined, null, result);
    return adminOk(reply, result);
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
        include: withdrawalInclude,
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

    const amount = new Prisma.Decimal(input.amount);
    ensureMinimumWithdrawalAmount(amount);
    ensurePayoutRefForPaid(input.status, input.payoutRef);
    if (reservesSupplierSettlement(input.status)) {
      await ensureSupplierWithdrawableAmount(supplier.id, amount);
    }

    const withdrawal = await prisma.$transaction(async (tx) => {
      const created = await tx.withdrawal.create({
        data: {
          supplierId: supplier.id,
          amount,
          currency: input.currency.toUpperCase(),
          status: input.status,
          payoutRef: input.payoutRef,
          note: input.note
        }
      });
      if (reservesSupplierSettlement(input.status)) {
        await allocateWithdrawalSettlements(tx, supplier.id, created.id, amount, input.status === "paid" ? "paid" : "reserved");
      }
      return tx.withdrawal.findUniqueOrThrow({ where: { id: created.id }, include: withdrawalInclude });
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
      include: withdrawalInclude
    });
    if (!before) throw new AppError("withdrawal_not_found", "Withdrawal not found", 404);

    ensureWithdrawalTransition(before.status, input.status);
    ensurePayoutRefForPaid(input.status, input.payoutRef ?? before.payoutRef ?? undefined);
    if (reservesSupplierSettlement(input.status)) {
      const missing = before.amount.minus(activeWithdrawalAllocationAmount(before.settlements));
      if (missing.gt(0)) {
        await ensureSupplierWithdrawableAmount(before.supplierId, missing, id);
      }
    }

    const withdrawal = await prisma.$transaction(async (tx) => {
      const missing = before.amount.minus(activeWithdrawalAllocationAmount(before.settlements));
      if (reservesSupplierSettlement(input.status) && missing.gt(0)) {
        await allocateWithdrawalSettlements(tx, before.supplierId, id, missing, input.status === "paid" ? "paid" : "reserved");
      }
      if (input.status === "paid") {
        await payWithdrawalSettlements(tx, id);
      }
      if (["rejected", "cancelled"].includes(input.status)) {
        await releaseWithdrawalSettlements(tx, id);
      }
      await tx.withdrawal.update({
        where: { id },
        data: {
          status: input.status,
          ...(input.payoutRef !== undefined ? { payoutRef: input.payoutRef } : {}),
          ...(input.note !== undefined ? { note: input.note } : {})
        }
      });
      return tx.withdrawal.findUniqueOrThrow({ where: { id }, include: withdrawalInclude });
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

  app.get("/api/admin/proxy-requests", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    const query = parseListQuery(request.query);
    const statusCode = numericStatusCode(query.status);
    const where: Prisma.ProxyRequestLogWhereInput = {
      ...(statusCode ? { statusCode } : {}),
      ...(query.action ? { errorCode: containsText(query.action) } : {}),
      ...(query.q ? {
        OR: [
          { id: containsText(query.q) },
          { requestId: containsText(query.q) },
          { userId: containsText(query.q) },
          { rentalId: containsText(query.q) },
          { apiKeyId: containsText(query.q) },
          { apiKeyPrefix: containsText(query.q) },
          { method: containsText(query.q) },
          { path: containsText(query.q) },
          { errorCode: containsText(query.q) },
          { ipAddress: containsText(query.q) },
          { userAgent: containsText(query.q) },
          { user: { email: containsText(query.q) } },
          { user: { displayName: containsText(query.q) } },
          { rental: { product: { name: containsText(query.q) } } },
          { apiKey: { name: containsText(query.q) } }
        ]
      } : {})
    };
    const [logs, total] = await Promise.all([
      prisma.proxyRequestLog.findMany({
        where,
        include: {
          user: { select: { id: true, email: true, displayName: true } },
          rental: { select: { id: true, resourceType: true, status: true, product: { select: { name: true } } } },
          apiKey: { select: { id: true, name: true, keyPrefix: true, status: true } }
        },
        orderBy: { createdAt: "desc" },
        ...pageArgs(query)
      }),
      prisma.proxyRequestLog.count({ where })
    ]);
    return adminOk(reply, paged(logs, total, query));
  });

  app.get("/api/admin/sub2/status", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    return adminOk(reply, await sub2Client.fetchGatewayStatus());
  });

  app.get("/api/admin/sub2/bindings/reconciliation", async (request, reply) => {
    await requireRole(request, ["operator", "admin"]);
    return adminOk(reply, await findSub2BindingIssues());
  });

  app.post("/api/admin/sub2/bindings/repair", async (request, reply) => {
    const actor = await requireRole(request, ["admin"]);
    const result = await repairSub2Bindings();
    await writeAuditLog(request, actor.id, "admin.sub2.bindings.repair", "sub2_binding", undefined, null, result);
    return adminOk(reply, result);
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
    const result = await runLocalOpenAiProxySmokeTest(input.model);
    await writeAuditLog(request, actor.id, "admin.sub2.proxy_smoke_test", "sub2_proxy", result.sub2KeyId, null, {
      ok: result.ok,
      model: result.model,
      keyDisabled: result.keyDisabled,
      localProxy: result.localProxy,
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

function rentalLimitUpdateData(input: z.infer<typeof rentalLimitsSchema>): Prisma.RentalLimitUpdateInput {
  const data: Prisma.RentalLimitUpdateInput = {};
  if (input.maxConcurrency !== undefined) data.maxConcurrency = input.maxConcurrency;
  if (input.rpmLimit !== undefined) data.rpmLimit = input.rpmLimit;
  if (input.tpmLimit !== undefined) data.tpmLimit = input.tpmLimit;
  if (input.requestLimit !== undefined) data.requestLimit = input.requestLimit;
  if (input.spendLimit !== undefined) data.spendLimit = decimalOrNull(input.spendLimit);
  if (input.remainingSpend !== undefined) data.remainingSpend = decimalOrNull(input.remainingSpend);
  return data;
}

function decimalOrNull(value: number | null | undefined) {
  if (value === undefined || value === null) return null;
  return new Prisma.Decimal(value);
}

function ensureMinimumWithdrawalAmount(amount: Prisma.Decimal) {
  const minimum = new Prisma.Decimal(env.MIN_WITHDRAWAL_AMOUNT);
  if (amount.lt(minimum)) {
    throw new AppError("withdrawal_below_minimum", `Withdrawal amount must be at least ${minimum}`, 400, {
      minimum: String(minimum)
    });
  }
}

function ensurePayoutRefForPaid(status: string, payoutRef?: string) {
  if (status === "paid" && !payoutRef) {
    throw new AppError("withdrawal_payout_ref_required", "Payout reference is required when marking withdrawal as paid", 400);
  }
}

function ensureWithdrawalTransition(current: string, next: string) {
  if (current === next) return;
  const allowed: Record<string, string[]> = {
    pending: ["approved", "rejected", "cancelled"],
    approved: ["paid", "cancelled"],
    rejected: [],
    paid: [],
    cancelled: []
  };
  if (!allowed[current]?.includes(next)) {
    throw new AppError("withdrawal_invalid_transition", `Cannot change withdrawal from ${current} to ${next}`, 400);
  }
}

function reservesSupplierSettlement(status: string) {
  return ["pending", "approved", "paid"].includes(status);
}

function activeWithdrawalAllocationAmount(allocations: Array<{ amount: Prisma.Decimal; status: string }>) {
  return allocations
    .filter((allocation) => ["reserved", "paid"].includes(allocation.status))
    .reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0));
}

async function ensureSupplierWithdrawableAmount(
  supplierId: string,
  amount: Prisma.Decimal,
  excludeWithdrawalId?: string
) {
  const withdrawable = await supplierWithdrawableAmount(supplierId, excludeWithdrawalId);
  if (withdrawable.lt(amount)) {
    throw new AppError("insufficient_withdrawable_amount", "Supplier does not have enough available settlements", 400, {
      withdrawable: String(withdrawable),
      requested: String(amount)
    });
  }
}

async function supplierWithdrawableAmount(supplierId: string, excludeWithdrawalId?: string) {
  const [settlements, reservedWithdrawals] = await Promise.all([
    prisma.settlementRecord.findMany({
      where: {
        status: "available",
        supplierResource: { supplierId }
      },
      select: {
        amount: true,
        reservedAmount: true,
        withdrawnAmount: true
      }
    }),
    prisma.withdrawal.aggregate({
      where: {
        supplierId,
        status: { in: ["pending", "approved", "paid"] },
        settlements: { none: {} },
        ...(excludeWithdrawalId ? { id: { not: excludeWithdrawalId } } : {})
      },
      _sum: { amount: true }
    })
  ]);

  const available = settlements.reduce(
    (sum, settlement) => sum.plus(settlementAvailableAmount(settlement)),
    new Prisma.Decimal(0)
  );
  const reserved = reservedWithdrawals._sum.amount ?? new Prisma.Decimal(0);
  const withdrawable = available.minus(reserved);
  return withdrawable.gt(0) ? withdrawable : new Prisma.Decimal(0);
}

async function allocateWithdrawalSettlements(
  tx: Prisma.TransactionClient,
  supplierId: string,
  withdrawalId: string,
  amount: Prisma.Decimal,
  allocationStatus: "reserved" | "paid"
) {
  let remaining = amount;
  const settlements = await tx.settlementRecord.findMany({
    where: {
      status: "available",
      supplierResource: { supplierId }
    },
    orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }]
  });

  for (const settlement of settlements) {
    if (remaining.lte(0)) break;
    const available = settlementAvailableAmount(settlement);
    if (available.lte(0)) continue;

    const allocationAmount = available.lt(remaining) ? available : remaining;
    await tx.withdrawalSettlement.create({
      data: {
        withdrawalId,
        settlementRecordId: settlement.id,
        amount: allocationAmount,
        status: allocationStatus
      }
    });

    const nextReserved = allocationStatus === "reserved"
      ? settlement.reservedAmount.plus(allocationAmount)
      : settlement.reservedAmount;
    const nextWithdrawn = allocationStatus === "paid"
      ? settlement.withdrawnAmount.plus(allocationAmount)
      : settlement.withdrawnAmount;
    await tx.settlementRecord.update({
      where: { id: settlement.id },
      data: {
        reservedAmount: nextReserved,
        withdrawnAmount: nextWithdrawn,
        status: settlementStatusForAmounts(settlement.amount, nextReserved, nextWithdrawn)
      }
    });
    remaining = remaining.minus(allocationAmount);
  }

  if (remaining.gt(0)) {
    throw new AppError("insufficient_withdrawable_amount", "Supplier does not have enough available settlements", 400, {
      missing: String(remaining),
      requested: String(amount)
    });
  }
}

async function payWithdrawalSettlements(tx: Prisma.TransactionClient, withdrawalId: string) {
  const allocations = await tx.withdrawalSettlement.findMany({
    where: { withdrawalId, status: "reserved" },
    include: { settlementRecord: true }
  });

  for (const allocation of allocations) {
    const settlement = allocation.settlementRecord;
    const nextReserved = decimalMax(settlement.reservedAmount.minus(allocation.amount), new Prisma.Decimal(0));
    const nextWithdrawn = settlement.withdrawnAmount.plus(allocation.amount);
    await tx.withdrawalSettlement.update({
      where: { id: allocation.id },
      data: { status: "paid" }
    });
    await tx.settlementRecord.update({
      where: { id: settlement.id },
      data: {
        reservedAmount: nextReserved,
        withdrawnAmount: nextWithdrawn,
        status: settlementStatusForAmounts(settlement.amount, nextReserved, nextWithdrawn)
      }
    });
  }
}

async function releaseWithdrawalSettlements(tx: Prisma.TransactionClient, withdrawalId: string) {
  const allocations = await tx.withdrawalSettlement.findMany({
    where: { withdrawalId, status: "reserved" },
    include: { settlementRecord: true }
  });

  for (const allocation of allocations) {
    const settlement = allocation.settlementRecord;
    const nextReserved = decimalMax(settlement.reservedAmount.minus(allocation.amount), new Prisma.Decimal(0));
    await tx.withdrawalSettlement.update({
      where: { id: allocation.id },
      data: { status: "released" }
    });
    await tx.settlementRecord.update({
      where: { id: settlement.id },
      data: {
        reservedAmount: nextReserved,
        status: settlementStatusForAmounts(settlement.amount, nextReserved, settlement.withdrawnAmount)
      }
    });
  }
}

function settlementAvailableAmount(settlement: {
  amount: Prisma.Decimal;
  reservedAmount: Prisma.Decimal;
  withdrawnAmount: Prisma.Decimal;
}) {
  return decimalMax(
    settlement.amount.minus(settlement.reservedAmount).minus(settlement.withdrawnAmount),
    new Prisma.Decimal(0)
  );
}

function settlementStatusForAmounts(amount: Prisma.Decimal, reservedAmount: Prisma.Decimal, withdrawnAmount: Prisma.Decimal) {
  if (withdrawnAmount.gte(amount)) return "withdrawn";
  if (reservedAmount.plus(withdrawnAmount).gte(amount)) return "frozen";
  return "available";
}

function decimalMax(left: Prisma.Decimal, right: Prisma.Decimal) {
  return left.gte(right) ? left : right;
}

async function buildSystemHealthReport() {
  const checkedAt = new Date();
  const proxySince = new Date(checkedAt.getTime() - systemHealthProxyWindowMs);
  const [
    userCounts,
    activeRentals,
    overdueActiveRentals,
    constrainedRentals,
    negativeWallets,
    orderCounts,
    resourceCounts,
    pendingWithdrawals,
    pendingSettlements,
    proxyRecentTotal,
    proxyRecentClientErrors,
    proxyRecentServerErrors,
    proxyRecentLocalErrors,
    proxyRecentClientDisconnects,
    proxyRecentStreamErrors,
    billingSync,
    reconciliation,
    sub2Bindings,
    apiKeyReadiness
  ] = await Promise.all([
    prisma.user.groupBy({ by: ["status"], where: nonSmokeUserWhere(), _count: true }),
    prisma.rental.count({ where: { status: "active", ...nonSmokeRentalWhere() } }),
    prisma.rental.count({ where: { status: "active", endsAt: { lte: checkedAt }, ...nonSmokeRentalWhere() } }),
    prisma.rental.count({ where: { status: { in: ["low_balance", "limited", "suspended"] }, ...nonSmokeRentalWhere() } }),
    prisma.walletAccount.count({
      where: {
        ...nonSmokeWalletWhere(),
        OR: [
          { availableBalance: { lt: 0 } },
          { frozenBalance: { lt: 0 } }
        ]
      }
    }),
    prisma.order.groupBy({ by: ["status"], where: nonSmokeOrderWhere(), _count: true }),
    prisma.supplierResource.groupBy({ by: ["status"], _count: true }),
    prisma.withdrawal.count({ where: { status: "pending" } }),
    prisma.settlementRecord.count({ where: { status: "pending", availableAt: { lte: checkedAt } } }),
    prisma.proxyRequestLog.count({ where: { createdAt: { gte: proxySince } } }),
    prisma.proxyRequestLog.count({ where: { createdAt: { gte: proxySince }, statusCode: { gte: 400, lt: 500 } } }),
    prisma.proxyRequestLog.count({ where: { createdAt: { gte: proxySince }, statusCode: { gte: 500 } } }),
    prisma.proxyRequestLog.count({ where: { createdAt: { gte: proxySince }, errorCode: { not: null } } }),
    prisma.proxyRequestLog.count({ where: { createdAt: { gte: proxySince }, errorCode: "client_disconnected" } }),
    prisma.proxyRequestLog.count({ where: { createdAt: { gte: proxySince }, errorCode: { in: ["upstream_stream_error", "upstream_stream_closed"] } } }),
    getSub2UsageSyncState(),
    findBillingReconciliationIssues(),
    findSub2BindingIssues(),
    inspectOpenAiProxyApiKeys(checkedAt)
  ]);
  const sub2Status = await fetchSub2HealthStatus();
  const usersByStatus = countGroups(userCounts, "status");
  const ordersByStatus = countGroups(orderCounts, "status");
  const resourcesByStatus = countGroups(resourceCounts, "status");
  const failedOrders = (ordersByStatus.failed ?? 0) + (ordersByStatus.refunding ?? 0);
  const abnormalResources = resourcesByStatus.abnormal ?? 0;
  const onlineCodexResources = await prisma.supplierResource.count({
    where: { resourceType: "codex", status: "online" }
  });

  const checks: SystemHealthCheck[] = [
    systemHealthCheck("database", "数据库", "ok", "Prisma 查询正常", {
      users: totalGroupCount(userCounts),
      rentals: activeRentals
    }),
    systemHealthCheck(
      "users",
      "用户状态",
      (usersByStatus.banned ?? 0) > 0 ? "warning" : "ok",
      `active ${usersByStatus.active ?? 0}, disabled ${usersByStatus.disabled ?? 0}, banned ${usersByStatus.banned ?? 0}`,
      usersByStatus
    ),
    systemHealthCheck(
      "orders",
      "订单状态",
      failedOrders > 0 ? "warning" : "ok",
      failedOrders > 0 ? `${failedOrders} 个订单需要人工复查` : "订单状态无明显阻断",
      ordersByStatus
    ),
    systemHealthCheck(
      "rentals",
      "租赁可用性",
      overdueActiveRentals > 0 ? "error" : constrainedRentals > 0 ? "warning" : "ok",
      overdueActiveRentals > 0
        ? `${overdueActiveRentals} 个 active 租赁已过期`
        : constrainedRentals > 0 ? `${constrainedRentals} 个租赁处于余额/限额/暂停状态` : "租赁状态正常",
      { activeRentals, overdueActiveRentals, constrainedRentals }
    ),
    systemHealthCheck(
      "apiKeys",
      "API Key 可用性",
      apiKeyReadiness.errors > 0 ? "error" : apiKeyReadiness.warnings > 0 ? "warning" : "ok",
      apiKeyReadiness.totalIssues > 0
        ? `${apiKeyReadiness.totalIssues} 个 OpenAI/Codex Key 准入问题`
        : "OpenAI/Codex Key 准入状态正常",
      apiKeyReadiness.summary,
      { issues: apiKeyReadiness.issues }
    ),
    systemHealthCheck(
      "wallets",
      "余额账户",
      negativeWallets > 0 ? "error" : "ok",
      negativeWallets > 0 ? `${negativeWallets} 个钱包出现负余额` : "余额账户未发现负数",
      { negativeWallets }
    ),
    systemHealthCheck(
      "resources",
      "共享资源",
      abnormalResources > 0 ? "warning" : onlineCodexResources === 0 ? "warning" : "ok",
      abnormalResources > 0
        ? `${abnormalResources} 个资源异常`
        : onlineCodexResources === 0 ? "没有 online 的 Codex 共享资源" : "共享资源状态正常",
      { ...resourcesByStatus, onlineCodexResources }
    ),
    systemHealthCheck(
      "sub2",
      "Sub2/OpenAI 上游",
      sub2Status.ready ? "ok" : "error",
      sub2Status.ready ? "Sub2API OpenAI 上游可调度" : `阻断：${sub2Status.blockingReasons.join(", ") || "unknown"}`,
      {
        gatewayReachable: sub2Status.gatewayReachable,
        ready: sub2Status.ready,
        defaultGroupId: sub2Status.defaultGroupId ?? null,
        accounts: sub2Status.accountCount
      },
      sub2Status.error ? { error: sub2Status.error } : { blockingReasons: sub2Status.blockingReasons }
    ),
    systemHealthCheck(
      "sub2Bindings",
      "Sub2 绑定",
      sub2Bindings.ok ? "ok" : "warning",
      sub2Bindings.ok ? "Sub2Binding 与本地租赁一致" : `${sub2Bindings.summary.totalIssues} 个 Sub2 绑定问题`,
      sub2Bindings.summary
    ),
    systemHealthCheck(
      "proxy",
      "反代请求",
      proxyRecentServerErrors > 0 || proxyRecentStreamErrors > 0 ? "error" : proxyRecentClientErrors > 0 || proxyRecentLocalErrors > 0 || proxyRecentClientDisconnects > 0 ? "warning" : "ok",
      proxyRecentTotal === 0
        ? "最近 1 小时无反代请求"
        : `${proxyRecentTotal} 次请求，${proxyRecentServerErrors} 次 5xx，${proxyRecentClientErrors} 次 4xx，${proxyRecentClientDisconnects} 次客户端断开，${proxyRecentStreamErrors} 次上游流异常`,
      { proxyRecentTotal, proxyRecentClientErrors, proxyRecentServerErrors, proxyRecentLocalErrors, proxyRecentClientDisconnects, proxyRecentStreamErrors }
    ),
    billingSyncHealthCheck(billingSync, checkedAt),
    systemHealthCheck(
      "reconciliation",
      "账务对账",
      reconciliation.ok ? "ok" : "error",
      reconciliation.ok ? "账务对账未发现问题" : `${reconciliation.summary.totalIssues} 个账务一致性问题`,
      reconciliation.summary
    ),
    systemHealthCheck(
      "settlements",
      "结算提现",
      pendingSettlements > 0 || pendingWithdrawals > 0 ? "warning" : "ok",
      pendingSettlements > 0 || pendingWithdrawals > 0
        ? `${pendingSettlements} 条到期待释放结算，${pendingWithdrawals} 条待处理提现`
        : "结算提现无待处理阻塞",
      { pendingSettlements, pendingWithdrawals }
    )
  ];

  return {
    checkedAt: checkedAt.toISOString(),
    status: aggregateHealthStatus(checks),
    summary: {
      totalChecks: checks.length,
      ok: checks.filter((check) => check.status === "ok").length,
      warning: checks.filter((check) => check.status === "warning").length,
      error: checks.filter((check) => check.status === "error").length
    },
    checks
  };
}

type SystemHealthReport = Awaited<ReturnType<typeof buildSystemHealthReport>>;

async function recordSystemHealthSnapshot(report: SystemHealthReport, source: string, actorUserId?: string) {
  await prisma.systemHealthSnapshot.create({
    data: {
      status: report.status,
      source,
      summary: JSON.parse(JSON.stringify(report.summary)) as Prisma.InputJsonValue,
      checks: JSON.parse(JSON.stringify(report.checks)) as Prisma.InputJsonValue,
      actorUserId
    }
  });
}

async function runSystemMaintenance(input: z.infer<typeof systemMaintenanceSchema>) {
  const startedAt = new Date();
  const actions: Record<string, unknown> = {};

  if (input.expireOverdueRentals) {
    actions.expireOverdueRentals = await expireOverdueRentals({
      limit: input.expireOverdueRentalsLimit
    });
  }

  if (input.deactivateInvalidProxyApiKeys) {
    actions.deactivateInvalidProxyApiKeys = await deactivateInvalidProxyApiKeys({
      limit: input.deactivateInvalidProxyApiKeysLimit
    });
  }

  if (input.releaseAvailableSettlements) {
    actions.releaseAvailableSettlements = await releaseAvailableSettlements({
      limit: input.releaseAvailableSettlementsLimit
    });
  }

  if (input.repairSub2Bindings) {
    actions.repairSub2Bindings = await repairSub2Bindings();
  }

  if (input.cleanupSmokeData) {
    actions.cleanupSmokeData = await cleanupStaleLocalProxySmokeData({
      ageMinutes: input.cleanupSmokeDataAgeMinutes,
      limit: input.cleanupSmokeDataLimit
    });
  }

  const health = await buildSystemHealthReport();
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    actions,
    health
  };
}

async function findBillingReconciliationIssues() {
  const [
    billedUsages,
    consumptionTransactions,
    usageSettlementCandidates,
    settlementCandidates,
    withdrawalCandidates
  ] = await Promise.all([
    prisma.usageRecord.findMany({
      where: { status: "billed", buyerCharge: { gt: 0 }, ...nonSmokeUsageWhere() },
      select: { id: true, buyerCharge: true, occurredAt: true },
      orderBy: { occurredAt: "desc" },
      take: reconciliationScanLimit
    }),
    prisma.walletTransaction.findMany({
      where: { type: "consume", refType: "usage", refId: { not: null }, ...nonSmokeWalletTransactionWhere() },
      select: { id: true, amount: true, refId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: reconciliationScanLimit
    }),
    prisma.usageRecord.findMany({
      where: { status: "billed", supplierIncome: { gt: 0 }, ...nonSmokeUsageWhere() },
      select: {
        id: true,
        supplierIncome: true,
        occurredAt: true,
        settlements: { select: { id: true, amount: true, status: true } }
      },
      orderBy: { occurredAt: "desc" },
      take: reconciliationScanLimit
    }),
    prisma.settlementRecord.findMany({
      select: {
        id: true,
        amount: true,
        reservedAmount: true,
        withdrawnAmount: true,
        status: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" },
      take: reconciliationScanLimit
    }),
    prisma.withdrawal.findMany({
      where: { status: { in: ["pending", "approved", "paid"] } },
      select: {
        id: true,
        amount: true,
        status: true,
        createdAt: true,
        settlements: { select: { amount: true, status: true } }
      },
      orderBy: { createdAt: "desc" },
      take: reconciliationScanLimit
    })
  ]);

  const usageWalletTransactions = await prisma.walletTransaction.findMany({
    where: {
      type: "consume",
      refType: "usage",
      refId: { in: billedUsages.map((usage) => usage.id) },
      ...nonSmokeWalletTransactionWhere()
    },
    select: { refId: true }
  });
  const transactionUsageRefs = new Set(usageWalletTransactions.flatMap((transaction) => transaction.refId ? [transaction.refId] : []));
  const billedUsageMissingWalletTransactions = billedUsages
    .filter((usage) => !transactionUsageRefs.has(usage.id))
    .map((usage) => reconciliationIssue({
      type: "billed_usage_missing_wallet_transaction",
      refType: "usage",
      refId: usage.id,
      amount: decimalText(usage.buyerCharge),
      createdAt: usage.occurredAt.toISOString(),
      message: "Billed usage has buyerCharge but no consume wallet transaction."
    }));

  const usageIdsForTransactions = [
    ...new Set(consumptionTransactions.flatMap((transaction) => transaction.refId ? [transaction.refId] : []))
  ];
  const usagesForTransactions = usageIdsForTransactions.length > 0
    ? await prisma.usageRecord.findMany({
      where: { id: { in: usageIdsForTransactions } },
      select: { id: true }
    })
    : [];
  const usageIds = new Set(usagesForTransactions.map((usage) => usage.id));
  const walletTransactionsMissingUsage = consumptionTransactions
    .filter((transaction) => transaction.refId && !usageIds.has(transaction.refId))
    .map((transaction) => reconciliationIssue({
      type: "wallet_transaction_missing_usage",
      refType: "wallet_transaction",
      refId: transaction.id,
      amount: decimalText(transaction.amount),
      createdAt: transaction.createdAt.toISOString(),
      message: `Consume wallet transaction references missing usage ${transaction.refId}.`
    }));

  const usageSettlementMismatches = usageSettlementCandidates
    .map((usage) => {
      const actual = decimalSum(usage.settlements.map((settlement) => settlement.amount));
      if (decimalEquals(actual, usage.supplierIncome)) return undefined;
      return reconciliationIssue({
        type: "usage_settlement_mismatch",
        refType: "usage",
        refId: usage.id,
        expected: decimalText(usage.supplierIncome),
        actual: decimalText(actual),
        createdAt: usage.occurredAt.toISOString(),
        message: "Usage supplierIncome does not match settlement record amount sum."
      });
    })
    .filter(isReconciliationIssue);

  const settlementOverallocated = settlementCandidates
    .filter((settlement) => settlement.reservedAmount.plus(settlement.withdrawnAmount).gt(settlement.amount))
    .map((settlement) => reconciliationIssue({
      type: "settlement_overallocated",
      refType: "settlement",
      refId: settlement.id,
      amount: decimalText(settlement.amount),
      actual: decimalText(settlement.reservedAmount.plus(settlement.withdrawnAmount)),
      createdAt: settlement.createdAt.toISOString(),
      message: `Settlement reserved plus withdrawn exceeds amount while status is ${settlement.status}.`
    }));

  const withdrawalAllocationMismatches = withdrawalCandidates
    .map((withdrawal) => {
      const allocated = decimalSum(
        withdrawal.settlements
          .filter((allocation) => ["reserved", "paid"].includes(allocation.status))
          .map((allocation) => allocation.amount)
      );
      if (decimalEquals(allocated, withdrawal.amount)) return undefined;
      return reconciliationIssue({
        type: "withdrawal_allocation_mismatch",
        refType: "withdrawal",
        refId: withdrawal.id,
        expected: decimalText(withdrawal.amount),
        actual: decimalText(allocated),
        createdAt: withdrawal.createdAt.toISOString(),
        message: `Active withdrawal status ${withdrawal.status} does not match active allocation sum.`
      });
    })
    .filter(isReconciliationIssue);

  const groups = {
    billedUsageMissingWalletTransactions,
    walletTransactionsMissingUsage,
    usageSettlementMismatches,
    settlementOverallocated,
    withdrawalAllocationMismatches
  };
  const allIssues = Object.values(groups).flat();
  return {
    checkedAt: new Date().toISOString(),
    ok: allIssues.length === 0,
    scanLimit: reconciliationScanLimit,
    summary: {
      billedUsageMissingWalletTransactions: billedUsageMissingWalletTransactions.length,
      walletTransactionsMissingUsage: walletTransactionsMissingUsage.length,
      usageSettlementMismatches: usageSettlementMismatches.length,
      settlementOverallocated: settlementOverallocated.length,
      withdrawalAllocationMismatches: withdrawalAllocationMismatches.length,
      totalIssues: allIssues.length,
      returnedIssues: Math.min(allIssues.length, reconciliationIssueLimit)
    },
    scanned: {
      billedUsages: billedUsages.length,
      usageWalletTransactions: usageWalletTransactions.length,
      walletTransactions: consumptionTransactions.length,
      usageSettlementCandidates: usageSettlementCandidates.length,
      settlements: settlementCandidates.length,
      withdrawals: withdrawalCandidates.length
    },
    issues: allIssues.slice(0, reconciliationIssueLimit)
  };
}

function reconciliationIssue(input: Omit<BillingReconciliationIssue, "id" | "severity"> & {
  severity?: BillingReconciliationIssue["severity"];
}) {
  return {
    id: `${input.type}:${input.refType}:${input.refId}`,
    severity: input.severity ?? "error",
    ...input
  };
}

function isReconciliationIssue(issue: BillingReconciliationIssue | undefined): issue is BillingReconciliationIssue {
  return Boolean(issue);
}

function decimalSum(values: Prisma.Decimal[]) {
  return values.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0));
}

function decimalEquals(left: Prisma.Decimal, right: Prisma.Decimal) {
  return left.toFixed(6) === right.toFixed(6);
}

function decimalText(value: Prisma.Decimal) {
  return value.toFixed(6);
}

async function findSub2BindingIssues() {
  const [rentals, bindings] = await Promise.all([
    prisma.rental.findMany({
      where: {
        ...nonSmokeRentalWhere(),
        OR: [
          { sub2UserId: { not: null } },
          { sub2KeyId: { not: null } }
        ]
      },
      select: {
        id: true,
        sub2UserId: true,
        sub2KeyId: true,
        status: true,
        user: { select: { email: true } },
        product: { select: { name: true } }
      },
      orderBy: { createdAt: "desc" },
      take: sub2BindingReconciliationLimit
    }),
    prisma.sub2Binding.findMany({
      where: {
        objectType: { in: ["rental", "rental_api_key_history"] },
        sub2Type: { in: ["user", "api_key"] },
        NOT: [localProxySmokeBindingWhere()]
      },
      orderBy: { createdAt: "desc" },
      take: sub2BindingReconciliationLimit * 3
    })
  ]);

  const issues: Sub2BindingIssue[] = [];
  const rentalIds = new Set(rentals.map((rental) => rental.id));
  const bindingByRentalAndType = new Map<string, { id: string; sub2Id: string }>();
  const bindingBySub2TypeAndId = new Map<string, { id: string; objectType: string; objectId: string }>();
  for (const binding of bindings) {
    bindingBySub2TypeAndId.set(`${binding.sub2Type}:${binding.sub2Id}`, {
      id: binding.id,
      objectType: binding.objectType,
      objectId: binding.objectId
    });
  }
  for (const binding of bindings.filter((item) => item.objectType === "rental")) {
    bindingByRentalAndType.set(`${binding.objectId}:${binding.sub2Type}`, {
      id: binding.id,
      sub2Id: binding.sub2Id
    });
  }

  for (const rental of rentals) {
    if (rental.sub2UserId) {
      const binding = bindingBySub2TypeAndId.get(`user:${rental.sub2UserId}`);
      if (!binding) {
        issues.push(sub2BindingIssue({
          type: "missing_user_binding",
          rentalId: rental.id,
          sub2Type: "user",
          expected: rental.sub2UserId,
          message: `Rental ${rental.id} has sub2UserId but no user binding for that Sub2 user.`
        }));
      }
    }

    if (rental.sub2KeyId) {
      const binding = bindingByRentalAndType.get(`${rental.id}:api_key`);
      if (!binding) {
        issues.push(sub2BindingIssue({
          type: "missing_current_api_key_binding",
          rentalId: rental.id,
          sub2Type: "api_key",
          expected: rental.sub2KeyId,
          message: `Rental ${rental.id} has sub2KeyId but no current api_key binding.`
        }));
      } else if (binding.sub2Id !== rental.sub2KeyId) {
        issues.push(sub2BindingIssue({
          type: "mismatched_current_api_key_binding",
          rentalId: rental.id,
          bindingId: binding.id,
          sub2Type: "api_key",
          expected: rental.sub2KeyId,
          actual: binding.sub2Id,
          message: `Rental ${rental.id} api_key binding does not match current sub2KeyId.`
        }));
      }
    }
  }

  for (const binding of bindings) {
    const rentalId = binding.objectType === "rental_api_key_history"
      ? binding.objectId.split(":")[0]
      : binding.objectId;
    if (rentalId && !rentalIds.has(rentalId)) {
      issues.push(sub2BindingIssue({
        type: "orphan_binding",
        severity: "warning",
        rentalId,
        bindingId: binding.id,
        sub2Type: binding.sub2Type,
        actual: binding.sub2Id,
        message: `Sub2 binding ${binding.id} points to a missing rental.`
      }));
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    ok: issues.length === 0,
    scanLimit: sub2BindingReconciliationLimit,
    summary: {
      rentalsScanned: rentals.length,
      bindingsScanned: bindings.length,
      totalIssues: issues.length,
      missingCurrentUserBindings: issues.filter((issue) => issue.type === "missing_current_user_binding").length,
      missingUserBindings: issues.filter((issue) => issue.type === "missing_user_binding").length,
      missingCurrentApiKeyBindings: issues.filter((issue) => issue.type === "missing_current_api_key_binding").length,
      mismatchedCurrentBindings: issues.filter((issue) => issue.type.startsWith("mismatched_current")).length,
      orphanBindings: issues.filter((issue) => issue.type === "orphan_binding").length
    },
    issues: issues.slice(0, 100)
  };
}

async function repairSub2Bindings() {
  const rentals = await prisma.rental.findMany({
    where: {
      ...nonSmokeRentalWhere(),
      OR: [
        { sub2UserId: { not: null } },
        { sub2KeyId: { not: null } }
      ]
    },
    select: {
      id: true,
      sub2UserId: true,
      sub2KeyId: true
    },
    orderBy: { createdAt: "desc" },
    take: sub2BindingReconciliationLimit
  });

  let userBindingsUpserted = 0;
  let apiKeyBindingsUpserted = 0;
  const conflicts: Array<{ rentalId: string; sub2Type: string; sub2Id: string; reason: string }> = [];
  const repairedAt = new Date().toISOString();
  await prisma.$transaction(async (tx) => {
    for (const rental of rentals) {
      if (rental.sub2UserId) {
        const result = await ensureSub2Binding(tx, rental.id, "user", rental.sub2UserId, { repairedAt }, {
          preserveExistingSub2IdOwner: true
        });
        if (result.changed) userBindingsUpserted += 1;
        if (!result.ok) conflicts.push({
          rentalId: rental.id,
          sub2Type: "user",
          sub2Id: rental.sub2UserId,
          reason: result.reason
        });
      }

      if (rental.sub2KeyId) {
        const result = await ensureSub2Binding(tx, rental.id, "api_key", rental.sub2KeyId, { repairedAt }, {
          preserveExistingSub2IdOwner: false
        });
        if (result.changed) apiKeyBindingsUpserted += 1;
        if (!result.ok) conflicts.push({
          rentalId: rental.id,
          sub2Type: "api_key",
          sub2Id: rental.sub2KeyId,
          reason: result.reason
        });
      }
    }
  });

  const reconciliation = await findSub2BindingIssues();
  return {
    repairedAt,
    rentalsScanned: rentals.length,
    userBindingsUpserted,
    apiKeyBindingsUpserted,
    conflicts,
    reconciliation
  };
}

async function ensureSub2Binding(
  tx: Prisma.TransactionClient,
  rentalId: string,
  sub2Type: "user" | "api_key",
  sub2Id: string,
  meta: Prisma.InputJsonObject,
  options: { preserveExistingSub2IdOwner: boolean }
) {
  const [bySub2Id, canonical] = await Promise.all([
    tx.sub2Binding.findUnique({
      where: {
        sub2Type_sub2Id: {
          sub2Type,
          sub2Id
        }
      }
    }),
    tx.sub2Binding.findUnique({
      where: {
        objectType_objectId_sub2Type: {
          objectType: "rental",
          objectId: rentalId,
          sub2Type
        }
      }
    })
  ]);

  if (bySub2Id) {
    if (bySub2Id.objectType === "rental" && bySub2Id.objectId === rentalId) {
      await tx.sub2Binding.update({ where: { id: bySub2Id.id }, data: { meta } });
      return { ok: true as const, changed: true };
    }
    if (options.preserveExistingSub2IdOwner) {
      return { ok: true as const, changed: false };
    }
    if (canonical && canonical.id !== bySub2Id.id) {
      return {
        ok: false as const,
        changed: false,
        reason: "canonical_binding_conflicts_with_existing_sub2_id"
      };
    }
    await tx.sub2Binding.update({
      where: { id: bySub2Id.id },
      data: {
        objectType: "rental",
        objectId: rentalId,
        meta
      }
    });
    return { ok: true as const, changed: true };
  }

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
  return { ok: true as const, changed: true };
}

function sub2BindingIssue(input: Omit<Sub2BindingIssue, "id" | "severity"> & {
  severity?: Sub2BindingIssue["severity"];
}): Sub2BindingIssue {
  return {
    id: `${input.type}:${input.rentalId ?? "none"}:${input.sub2Type ?? "none"}:${input.bindingId ?? "none"}`,
    severity: input.severity ?? "error",
    ...input
  };
}

function systemHealthCheck(
  id: string,
  label: string,
  status: SystemHealthStatus,
  summary: string,
  metrics?: Record<string, string | number | boolean | null>,
  detail?: unknown
): SystemHealthCheck {
  return { id, label, status, summary, metrics, detail };
}

function aggregateHealthStatus(checks: SystemHealthCheck[]): SystemHealthStatus {
  if (checks.some((check) => check.status === "error")) return "error";
  if (checks.some((check) => check.status === "warning")) return "warning";
  return "ok";
}

async function inspectOpenAiProxyApiKeys(checkedAt: Date) {
  const openAiProxyKeyWhere: Prisma.ApiKeyWhereInput = {
    status: "active",
    user: nonSmokeUserWhere(),
    OR: [
      { rentalId: null },
      { rental: { resourceType: "codex" } },
      { rental: { product: { resourceType: "codex" } } }
    ]
  };
  const [total, apiKeys] = await Promise.all([
    prisma.apiKey.count({ where: openAiProxyKeyWhere }),
    prisma.apiKey.findMany({
      where: openAiProxyKeyWhere,
      include: {
        user: { include: { wallet: true } },
        rental: { include: { product: true } }
      },
      orderBy: { createdAt: "desc" },
      take: systemHealthApiKeyScanLimit
    })
  ]);
  const minimumBalance = new Prisma.Decimal(env.OPENAI_PROXY_MIN_WALLET_BALANCE);
  const issues: ApiKeyReadinessIssue[] = [];
  const counters = {
    inactiveUsers: 0,
    insufficientWallets: 0,
    missingRentals: 0,
    inactiveRentals: 0,
    expiredRentals: 0,
    missingSub2KeyIds: 0,
    missingSub2KeyHashes: 0,
    keyRentalMismatches: 0
  };

  const pushIssue = (
    apiKey: (typeof apiKeys)[number],
    type: keyof typeof counters,
    severity: ApiKeyReadinessIssue["severity"],
    message: string
  ) => {
    counters[type] += 1;
    if (issues.length >= systemHealthApiKeyIssueLimit) return;
    issues.push({
      id: `${type}:${apiKey.id}`,
      type,
      severity,
      apiKeyId: apiKey.id,
      rentalId: apiKey.rentalId,
      userId: apiKey.userId,
      keyPrefix: apiKey.keyPrefix,
      message
    });
  };

  for (const apiKey of apiKeys) {
    if (apiKey.user.status !== "active") {
      pushIssue(apiKey, "inactiveUsers", "error", `API key ${apiKey.id} belongs to non-active user ${apiKey.userId}.`);
    }
    if (!apiKey.user.wallet || apiKey.user.wallet.availableBalance.lte(minimumBalance)) {
      pushIssue(apiKey, "insufficientWallets", "warning", `API key ${apiKey.id} user wallet cannot pass OpenAI proxy balance gate.`);
    }
    if (!apiKey.rental) {
      pushIssue(apiKey, "missingRentals", "error", `API key ${apiKey.id} is active but has no linked rental.`);
      continue;
    }
    if (apiKey.rental.status !== "active") {
      pushIssue(apiKey, "inactiveRentals", "error", `API key ${apiKey.id} is active but rental ${apiKey.rental.id} is ${apiKey.rental.status}.`);
    }
    if (apiKey.rental.endsAt && apiKey.rental.endsAt.getTime() <= checkedAt.getTime()) {
      pushIssue(apiKey, "expiredRentals", "error", `API key ${apiKey.id} rental ${apiKey.rental.id} is expired.`);
    }
    if (!apiKey.rental.sub2KeyId) {
      pushIssue(apiKey, "missingSub2KeyIds", "warning", `API key ${apiKey.id} rental ${apiKey.rental.id} has no Sub2 key id.`);
    }
    if (!apiKey.rental.sub2KeyHash) {
      pushIssue(apiKey, "missingSub2KeyHashes", "warning", `API key ${apiKey.id} rental ${apiKey.rental.id} has no Sub2 key hash.`);
    } else if (apiKey.rental.sub2KeyHash !== apiKey.keyHash) {
      pushIssue(apiKey, "keyRentalMismatches", "error", `API key ${apiKey.id} hash does not match rental ${apiKey.rental.id}.`);
    }
  }

  const errors = counters.inactiveUsers
    + counters.missingRentals
    + counters.inactiveRentals
    + counters.expiredRentals
    + counters.keyRentalMismatches;
  const warnings = counters.insufficientWallets
    + counters.missingSub2KeyIds
    + counters.missingSub2KeyHashes;
  const totalIssues = errors + warnings;

  return {
    ok: totalIssues === 0,
    totalIssues,
    errors,
    warnings,
    issues,
    summary: {
      activeOpenAiProxyApiKeys: total,
      scanned: apiKeys.length,
      scanLimit: systemHealthApiKeyScanLimit,
      truncated: total > apiKeys.length,
      issueSamples: issues.length,
      ...counters
    }
  };
}

async function deactivateInvalidProxyApiKeys(input: { limit: number }) {
  const checkedAt = new Date();
  const openAiProxyKeyWhere: Prisma.ApiKeyWhereInput = {
    status: "active",
    user: nonSmokeUserWhere(),
    OR: [
      { rentalId: null },
      { rental: { resourceType: "codex" } },
      { rental: { product: { resourceType: "codex" } } }
    ]
  };
  const [matched, apiKeys] = await Promise.all([
    prisma.apiKey.count({ where: openAiProxyKeyWhere }),
    prisma.apiKey.findMany({
      where: openAiProxyKeyWhere,
      include: { rental: { include: { product: true } } },
      orderBy: { createdAt: "desc" },
      take: input.limit
    })
  ]);
  const invalidIds = new Set<string>();
  const counters = {
    missingRentals: 0,
    inactiveRentals: 0,
    expiredRentals: 0,
    keyRentalMismatches: 0
  };

  for (const apiKey of apiKeys) {
    if (!apiKey.rental) {
      counters.missingRentals += 1;
      invalidIds.add(apiKey.id);
      continue;
    }
    if (apiKey.rental.status !== "active") {
      counters.inactiveRentals += 1;
      invalidIds.add(apiKey.id);
    }
    if (apiKey.rental.endsAt && apiKey.rental.endsAt.getTime() <= checkedAt.getTime()) {
      counters.expiredRentals += 1;
      invalidIds.add(apiKey.id);
    }
    if (apiKey.rental.sub2KeyHash && apiKey.rental.sub2KeyHash !== apiKey.keyHash) {
      counters.keyRentalMismatches += 1;
      invalidIds.add(apiKey.id);
    }
  }

  const apiKeyIds = Array.from(invalidIds);
  const update = apiKeyIds.length
    ? await prisma.apiKey.updateMany({
      where: { id: { in: apiKeyIds }, status: "active" },
      data: { status: "inactive" }
    })
    : { count: 0 };

  return {
    matched,
    scanned: apiKeys.length,
    deactivated: update.count,
    truncated: matched > apiKeys.length,
    limit: input.limit,
    sampleApiKeyIds: apiKeyIds.slice(0, 20),
    ...counters
  };
}

async function fetchSub2HealthStatus() {
  try {
    const status = await sub2Client.fetchGatewayStatus();
    return {
      gatewayReachable: status.gatewayReachable,
      ready: status.ready,
      blockingReasons: status.blockingReasons,
      defaultGroupId: status.defaultGroupId ?? null,
      accountCount: status.accounts.length,
      error: null as string | null
    };
  } catch (error) {
    return {
      gatewayReachable: false,
      ready: false,
      blockingReasons: ["sub2_status_query_failed"],
      defaultGroupId: null,
      accountCount: 0,
      error: redactSensitiveText(error instanceof Error ? error.message : String(error))
    };
  }
}

function billingSyncHealthCheck(
  sync: Awaited<ReturnType<typeof getSub2UsageSyncState>>,
  checkedAt: Date
) {
  const state = sync.state;
  if (!state) {
    return systemHealthCheck("billingSync", "用量同步", "warning", "尚未发现 Sub2 usage 同步状态", {
      runs: sync.runs.length
    });
  }

  const lastFinishedAt = state.lastFinishedAt?.getTime() ?? 0;
  const stale = lastFinishedAt === 0 || checkedAt.getTime() - lastFinishedAt > systemHealthBillingSyncStaleMs;
  const failed = state.lastStatus === "failed";
  return systemHealthCheck(
    "billingSync",
    "用量同步",
    failed ? "error" : stale ? "warning" : "ok",
    failed
      ? `最近同步失败：${state.lastError ?? "unknown"}`
      : stale ? "Sub2 usage 最近同步时间超过 24 小时" : "Sub2 usage 同步状态正常",
    {
      lastStatus: state.lastStatus ?? null,
      lastImported: state.lastImported,
      lastSkipped: state.lastSkipped,
      lastUnmatched: state.lastUnmatched,
      lastFinishedAt: state.lastFinishedAt?.toISOString() ?? null,
      runs: sync.runs.length
    }
  );
}

function countGroups(groups: Array<Record<string, unknown>>, field: string) {
  const result: Record<string, number> = {};
  for (const group of groups) {
    const key = String(group[field] ?? "unknown");
    result[key] = groupCount(group);
  }
  return result;
}

function totalGroupCount(groups: Array<Record<string, unknown>>) {
  return groups.reduce((sum, group) => sum + groupCount(group), 0);
}

function groupCount(group: Record<string, unknown>) {
  const count = group._count;
  if (typeof count === "number") return count;
  if (count && typeof count === "object" && "_all" in count) {
    return Number((count as { _all?: number })._all ?? 0);
  }
  return 0;
}

function nonSmokeUserWhere(): Prisma.UserWhereInput {
  return { email: { not: localProxySmokeUserEmail } };
}

function nonSmokeOrderWhere(): Prisma.OrderWhereInput {
  return { user: nonSmokeUserWhere() };
}

function nonSmokeRentalWhere(): Prisma.RentalWhereInput {
  return { user: nonSmokeUserWhere() };
}

function nonSmokeWalletWhere(): Prisma.WalletAccountWhereInput {
  return { user: nonSmokeUserWhere() };
}

function nonSmokeWalletTransactionWhere(): Prisma.WalletTransactionWhereInput {
  return { wallet: nonSmokeWalletWhere() };
}

function nonSmokeUsageWhere(): Prisma.UsageRecordWhereInput {
  return { rental: nonSmokeRentalWhere() };
}

function nonSmokeProductWhere(): Prisma.ProductWhereInput {
  return { name: { not: localProxySmokeProductName } };
}

function localProxySmokeBindingWhere(): Prisma.Sub2BindingWhereInput {
  return { meta: { path: ["smokeTest"], equals: true } };
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

function apiKeyListWhere(input: {
  q?: string;
  status?: (typeof apiKeyStatuses)[number];
  resourceType?: (typeof resourceTypes)[number];
}): Prisma.ApiKeyWhereInput {
  const queryResourceType = oneOf(resourceTypes, input.q);
  return {
    user: nonSmokeUserWhere(),
    ...(input.status ? { status: input.status } : {}),
    ...(input.resourceType ? { rental: { resourceType: input.resourceType } } : {}),
    ...(input.q ? {
      OR: [
        { id: containsText(input.q) },
        { name: containsText(input.q) },
        { keyPrefix: containsText(input.q) },
        { userId: containsText(input.q) },
        { user: { id: containsText(input.q) } },
        { user: { email: containsText(input.q) } },
        { user: { displayName: containsText(input.q) } },
        { rentalId: containsText(input.q) },
        { rental: { id: containsText(input.q) } },
        { rental: { sub2KeyId: containsText(input.q) } },
        { rental: { endpointUrl: containsText(input.q) } },
        { rental: { product: { name: containsText(input.q) } } },
        ...(queryResourceType ? [{ rental: { resourceType: queryResourceType } }] : [])
      ]
    } : {})
  };
}

function oneOf<T extends string>(values: readonly T[], value: string | undefined): T | undefined {
  return value && (values as readonly string[]).includes(value) ? value as T : undefined;
}

function numericStatusCode(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599 ? parsed : undefined;
}

function nonEmpty(value: string | undefined) {
  return value && value.length > 0 ? value : undefined;
}

function statusAfterResourceTest(current: ResourceStatus, ok: boolean): ResourceStatus {
  if (["disabled", "paused"].includes(current)) return current;
  if (ok) return current === "testing" || current === "pending" || current === "abnormal" ? "online" : current;
  return current === "online" || current === "testing" || current === "pending" || current === "busy" ? "abnormal" : current;
}

interface LocalProxySmokeProvision {
  userId: string;
  productId: string;
  orderId: string;
  rentalId: string;
  apiKeyId: string;
  apiKeyPrefix: string;
}

interface LocalProxyJsonProbe {
  ok: boolean;
  statusCode: number;
  bodyText: string;
  json?: Record<string, any>;
  error?: string | null;
}

async function runLocalOpenAiProxySmokeTest(model = env.SUB2_SMOKE_MODEL): Promise<Sub2ProxySmokeTestResult> {
  const checkedAt = new Date().toISOString();
  const failedModels: Sub2ProxySmokeTestResult["models"] = { ok: false, statusCode: 0, modelCount: 0, firstModel: null, error: "skipped" };
  const failedResponses: Sub2ProxySmokeTestResult["responses"] = { ok: false, statusCode: 0, responseId: null, responseStatus: null, errorType: null, errorMessage: "skipped" };
  let sub2Key: Sub2KeyResult | undefined;
  let local: LocalProxySmokeProvision | undefined;
  let models = failedModels;
  let responses = failedResponses;

  try {
    sub2Key = await sub2Client.createKey({
      buyerId: localProxySmokeBuyerId,
      rentalId: randomUUID(),
      name: `Admin local proxy smoke ${checkedAt}`,
      resourceType: "codex",
      maxConcurrency: 1,
      requestLimit: null,
      spendLimit: null
    });
    local = await provisionLocalProxySmokeRental(sub2Key, checkedAt);
  } catch (error) {
    const cleanup = await cleanupLocalOpenAiProxySmoke(local, sub2Key);
    return {
      ok: false,
      checkedAt,
      model,
      gatewayBaseUrl: env.SUB2_BASE_URL,
      publicEndpoint: openAiProxyPublicEndpoint,
      sub2UserId: sub2Key?.sub2UserId,
      sub2KeyId: sub2Key?.sub2KeyId,
      keyDisabled: cleanup.keyDisabled,
      cleanupError: cleanup.error,
      provisioning: {
        ok: false,
        error: redactSensitiveText(error instanceof Error ? error.message : String(error))
      },
      models: failedModels,
      responses: failedResponses,
      localProxy: {
        ok: false,
        endpoint: openAiProxyPublicEndpoint,
        rentalId: local?.rentalId ?? null,
        apiKeyPrefix: local?.apiKeyPrefix ?? null,
        proxyRequestLogCount: 0,
        apiKeyDeactivated: cleanup.apiKeyDeactivated,
        rentalClosed: cleanup.rentalClosed,
        orderClosed: cleanup.orderClosed,
        walletReset: cleanup.walletReset
      }
    };
  }

  const modelsProbe = await fetchLocalProxyJson("/models", sub2Key.apiKey, { method: "GET" }, 30_000);
  const modelItems = Array.isArray(modelsProbe.json?.data) ? modelsProbe.json.data : [];
  models = {
    ok: modelsProbe.ok,
    statusCode: modelsProbe.statusCode,
    modelCount: modelItems.length,
    firstModel: modelItems[0]?.id ? String(modelItems[0].id) : null,
    error: modelsProbe.ok ? null : extractLocalProxyError(modelsProbe)
  };

  const responsesProbe = await fetchLocalProxyJson(
    "/responses",
    sub2Key.apiKey,
    {
      method: "POST",
      body: JSON.stringify({
        model,
        input: "Return exactly OK.",
        max_output_tokens: 8
      })
    },
    90_000
  );
  const responseError = localProxyErrorObject(responsesProbe.json);
  responses = {
    ok: responsesProbe.ok && !responseError,
    statusCode: responsesProbe.statusCode,
    responseId: responsesProbe.json?.id ? String(responsesProbe.json.id) : null,
    responseStatus: responsesProbe.json?.status ? String(responsesProbe.json.status) : null,
    errorType: responseError?.type ? String(responseError.type) : null,
    errorMessage: responseError?.message
      ? redactSensitiveText(String(responseError.message))
      : responsesProbe.ok ? null : extractLocalProxyError(responsesProbe)
  };

  const proxyRequestLogCount = await countLocalProxySmokeLogs(local.rentalId);
  const cleanup = await cleanupLocalOpenAiProxySmoke(local, sub2Key);
  const localProxyOk = models.ok
    && responses.ok
    && proxyRequestLogCount >= 2
    && cleanup.apiKeyDeactivated
    && cleanup.rentalClosed
    && cleanup.orderClosed
    && cleanup.walletReset;

  return {
    ok: localProxyOk && cleanup.keyDisabled,
    checkedAt,
    model,
    gatewayBaseUrl: env.SUB2_BASE_URL,
    publicEndpoint: openAiProxyPublicEndpoint,
    sub2UserId: sub2Key.sub2UserId,
    sub2KeyId: sub2Key.sub2KeyId,
    keyDisabled: cleanup.keyDisabled,
    cleanupError: cleanup.error,
    provisioning: { ok: true },
    models,
    responses,
    localProxy: {
      ok: localProxyOk,
      endpoint: openAiProxyPublicEndpoint,
      rentalId: local.rentalId,
      apiKeyPrefix: local.apiKeyPrefix,
      proxyRequestLogCount,
      apiKeyDeactivated: cleanup.apiKeyDeactivated,
      rentalClosed: cleanup.rentalClosed,
      orderClosed: cleanup.orderClosed,
      walletReset: cleanup.walletReset
    }
  };
}

async function provisionLocalProxySmokeRental(sub2Key: Sub2KeyResult, checkedAt: string): Promise<LocalProxySmokeProvision> {
  const passwordHash = await bcrypt.hash(randomUUID(), 10);
  const keyHash = hashSecret(sub2Key.apiKey);
  const apiKeyPrefix = sub2Key.apiKey.slice(0, 12);
  const smokeMeta = { smokeTest: true, checkedAt };
  const smokeWalletBalance = new Prisma.Decimal(env.OPENAI_PROXY_MIN_WALLET_BALANCE).plus(1);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email: localProxySmokeUserEmail },
      update: {
        displayName: "OpenAI proxy smoke user",
        status: "active"
      },
      create: {
        email: localProxySmokeUserEmail,
        passwordHash,
        displayName: "OpenAI proxy smoke user",
        status: "active"
      }
    });
    await tx.userRole.upsert({
      where: { userId_role: { userId: user.id, role: "buyer" } },
      update: {},
      create: { userId: user.id, role: "buyer" }
    });
    await tx.walletAccount.upsert({
      where: { userId: user.id },
      update: {
        availableBalance: smokeWalletBalance,
        frozenBalance: new Prisma.Decimal(0)
      },
      create: {
        userId: user.id,
        availableBalance: smokeWalletBalance,
        frozenBalance: new Prisma.Decimal(0),
        totalRecharged: new Prisma.Decimal(0),
        totalSpent: new Prisma.Decimal(0)
      }
    });

    let product = await tx.product.findFirst({
      where: { name: localProxySmokeProductName, resourceType: "codex" }
    });
    if (!product) {
      product = await tx.product.create({
        data: {
          name: localProxySmokeProductName,
          resourceType: "codex",
          billingMode: "pay_as_you_go",
          status: "offline",
          description: "Internal product used only for administrator local OpenAI proxy smoke tests."
        }
      });
    }

    const order = await tx.order.create({
      data: {
        userId: user.id,
        status: "active",
        totalAmount: new Prisma.Decimal(0),
        paidAmount: new Prisma.Decimal(0),
        items: {
          create: {
            productId: product.id,
            amount: new Prisma.Decimal(0),
            meta: smokeMeta
          }
        }
      }
    });
    await recordOrderStatusHistory(tx, {
      orderId: order.id,
      fromStatus: null,
      toStatus: "active",
      reason: "admin.local_proxy_smoke.provision",
      meta: smokeMeta
    });

    const rental = await tx.rental.create({
      data: {
        userId: user.id,
        orderId: order.id,
        productId: product.id,
        resourceType: "codex",
        status: "active",
        endsAt: new Date(Date.now() + 30 * 60 * 1000),
        sub2UserId: sub2Key.sub2UserId,
        sub2KeyId: sub2Key.sub2KeyId,
        sub2KeyHash: keyHash,
        endpointUrl: openAiProxyPublicEndpoint,
        limits: {
          create: {
            maxConcurrency: 1,
            requestLimit: 10
          }
        }
      }
    });
    const apiKey = await tx.apiKey.create({
      data: {
        userId: user.id,
        rentalId: rental.id,
        name: localProxySmokeProductName,
        keyPrefix: apiKeyPrefix,
        keyHash
      }
    });
    await tx.sub2Binding.createMany({
      data: [
        {
          objectType: "rental",
          objectId: rental.id,
          sub2Type: "user",
          sub2Id: sub2Key.sub2UserId,
          meta: { ...smokeMeta, rentalId: rental.id }
        },
        {
          objectType: "rental",
          objectId: rental.id,
          sub2Type: "api_key",
          sub2Id: sub2Key.sub2KeyId,
          meta: { ...smokeMeta, rentalId: rental.id }
        }
      ],
      skipDuplicates: true
    });

    return {
      userId: user.id,
      productId: product.id,
      orderId: order.id,
      rentalId: rental.id,
      apiKeyId: apiKey.id,
      apiKeyPrefix
    };
  });
}

async function fetchLocalProxyJson(
  path: string,
  apiKey: string,
  init: RequestInit,
  timeoutMs: number
): Promise<LocalProxyJsonProbe> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${apiKey}`);
    if (init.body) headers.set("content-type", "application/json");

    const response = await fetch(`${openAiProxyPublicEndpoint}${path}`, {
      ...init,
      headers,
      signal: controller.signal
    });
    const rawText = await response.text();
    const bodyText = redactSensitiveText(rawText).slice(0, 3000);
    let json: Record<string, any> | undefined;
    try {
      json = JSON.parse(rawText) as Record<string, any>;
    } catch {
      json = undefined;
    }

    return { ok: response.ok, statusCode: response.status, bodyText, json };
  } catch (error) {
    return {
      ok: false,
      statusCode: 0,
      bodyText: "",
      error: redactSensitiveText(error instanceof Error ? error.message : String(error))
    };
  } finally {
    clearTimeout(timeout);
  }
}

function localProxyErrorObject(json?: Record<string, any>) {
  const error = json?.error;
  if (!error) return undefined;
  if (typeof error === "string") {
    return { message: redactSensitiveText(error), type: null };
  }
  if (typeof error === "object") {
    return error as { message?: string | null; type?: string | null };
  }
  return undefined;
}

function extractLocalProxyError(probe: LocalProxyJsonProbe) {
  const proxyError = localProxyErrorObject(probe.json);
  if (proxyError?.message) return redactSensitiveText(String(proxyError.message));
  const fallback = probe.error ?? probe.bodyText.slice(0, 300);
  return fallback || null;
}

async function countLocalProxySmokeLogs(rentalId: string) {
  try {
    return await prisma.proxyRequestLog.count({ where: { rentalId } });
  } catch {
    return 0;
  }
}

async function cleanupLocalOpenAiProxySmoke(local?: LocalProxySmokeProvision, sub2Key?: Sub2KeyResult) {
  const errors: string[] = [];
  let apiKeyDeactivated = false;
  let rentalClosed = false;
  let orderClosed = false;
  let walletReset = false;
  let keyDisabled = false;

  if (local) {
    try {
      const result = await prisma.apiKey.updateMany({
        where: { id: local.apiKeyId },
        data: { status: "inactive" }
      });
      apiKeyDeactivated = result.count === 1;
    } catch (error) {
      errors.push(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    }

    try {
      const result = await prisma.rental.updateMany({
        where: { id: local.rentalId },
        data: { status: "closed", endsAt: new Date() }
      });
      rentalClosed = result.count === 1;
    } catch (error) {
      errors.push(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    }

    try {
      const result = await prisma.order.updateMany({
        where: { id: local.orderId },
        data: { status: "closed" }
      });
      orderClosed = result.count === 1;
    } catch (error) {
      errors.push(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    }

    try {
      const result = await prisma.walletAccount.updateMany({
        where: { userId: local.userId },
        data: {
          availableBalance: new Prisma.Decimal(0),
          frozenBalance: new Prisma.Decimal(0)
        }
      });
      walletReset = result.count === 1;
    } catch (error) {
      errors.push(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    }
  }

  if (sub2Key) {
    try {
      await sub2Client.disableKey(localProxySmokeBuyerId, sub2Key.sub2KeyId);
      keyDisabled = true;
    } catch (error) {
      errors.push(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    }
  }

  return {
    apiKeyDeactivated,
    rentalClosed,
    orderClosed,
    walletReset,
    keyDisabled,
    error: errors.length > 0 ? errors.join("; ") : null
  };
}

async function cleanupStaleLocalProxySmokeData(input: { ageMinutes: number; limit: number }) {
  const checkedAt = new Date();
  const cutoff = new Date(checkedAt.getTime() - input.ageMinutes * 60 * 1000);
  const smokeUser = await prisma.user.findUnique({
    where: { email: localProxySmokeUserEmail },
    include: { wallet: true }
  });

  if (!smokeUser) {
    return {
      checkedAt: checkedAt.toISOString(),
      cutoff: cutoff.toISOString(),
      smokeUserFound: false,
      rentalsMatched: 0,
      rentalsClosed: 0,
      ordersClosed: 0,
      apiKeysDeactivated: 0,
      walletReset: false,
      sub2KeysDisableAttempted: 0,
      sub2KeysDisabled: 0,
      sub2DisableFailed: 0,
      errors: [] as string[]
    };
  }

  const staleRentals = await prisma.rental.findMany({
    where: {
      userId: smokeUser.id,
      OR: [
        { createdAt: { lte: cutoff } },
        { endsAt: { lte: checkedAt } },
        { apiKeys: { some: { status: { not: "inactive" }, createdAt: { lte: cutoff } } } },
        { order: { status: { not: "closed" }, createdAt: { lte: cutoff } } }
      ]
    },
    select: {
      id: true,
      orderId: true,
      sub2KeyId: true
    },
    orderBy: { createdAt: "asc" },
    take: input.limit
  });

  let rentalsClosed = 0;
  let ordersClosed = 0;
  let apiKeysDeactivated = 0;
  let sub2KeysDisableAttempted = 0;
  let sub2KeysDisabled = 0;
  let sub2DisableFailed = 0;
  const errors: string[] = [];

  for (const rental of staleRentals) {
    try {
      const result = await prisma.apiKey.updateMany({
        where: { rentalId: rental.id, status: { not: "inactive" } },
        data: { status: "inactive" }
      });
      apiKeysDeactivated += result.count;
    } catch (error) {
      errors.push(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    }

    try {
      const result = await prisma.rental.updateMany({
        where: { id: rental.id, status: { not: "closed" } },
        data: { status: "closed", endsAt: checkedAt }
      });
      rentalsClosed += result.count;
    } catch (error) {
      errors.push(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    }

    try {
      const result = await prisma.order.updateMany({
        where: { id: rental.orderId, status: { not: "closed" } },
        data: { status: "closed" }
      });
      ordersClosed += result.count;
    } catch (error) {
      errors.push(redactSensitiveText(error instanceof Error ? error.message : String(error)));
    }

    if (rental.sub2KeyId) {
      sub2KeysDisableAttempted += 1;
      try {
        await sub2Client.disableKey(localProxySmokeBuyerId, rental.sub2KeyId);
        sub2KeysDisabled += 1;
      } catch (error) {
        sub2DisableFailed += 1;
        errors.push(redactSensitiveText(error instanceof Error ? error.message : String(error)));
      }
    }
  }

  const [staleOrders, staleApiKeys] = await Promise.all([
    prisma.order.updateMany({
      where: {
        userId: smokeUser.id,
        createdAt: { lte: cutoff },
        status: { not: "closed" }
      },
      data: { status: "closed" }
    }),
    prisma.apiKey.updateMany({
      where: {
        userId: smokeUser.id,
        createdAt: { lte: cutoff },
        status: { not: "inactive" }
      },
      data: { status: "inactive" }
    })
  ]);
  ordersClosed += staleOrders.count;
  apiKeysDeactivated += staleApiKeys.count;

  const freshActiveRentals = await prisma.rental.count({
    where: {
      userId: smokeUser.id,
      status: "active",
      createdAt: { gt: cutoff }
    }
  });
  let walletReset = false;
  if (smokeUser.wallet && freshActiveRentals === 0 && smokeUser.wallet.updatedAt.getTime() <= cutoff.getTime()) {
    const wallet = await prisma.walletAccount.update({
      where: { id: smokeUser.wallet.id },
      data: {
        availableBalance: new Prisma.Decimal(0),
        frozenBalance: new Prisma.Decimal(0)
      }
    });
    walletReset = wallet.availableBalance.eq(0) && wallet.frozenBalance.eq(0);
  }

  return {
    checkedAt: checkedAt.toISOString(),
    cutoff: cutoff.toISOString(),
    smokeUserFound: true,
    rentalsMatched: staleRentals.length,
    rentalsClosed,
    ordersClosed,
    apiKeysDeactivated,
    walletReset,
    sub2KeysDisableAttempted,
    sub2KeysDisabled,
    sub2DisableFailed,
    errors
  };
}

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
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

function resourceConfigAuditPayload(resource: {
  status: string;
  level: string;
  maxConcurrency: number;
  shareRate: Prisma.Decimal | string | number;
  reserveRatio: Prisma.Decimal | string | number;
  dailyCap: Prisma.Decimal | string | number | null;
  sub2AccountId: string | null;
  lastCheckedAt?: Date | string | null;
}) {
  return {
    status: resource.status,
    level: resource.level,
    maxConcurrency: resource.maxConcurrency,
    shareRate: String(resource.shareRate),
    reserveRatio: String(resource.reserveRatio),
    dailyCap: resource.dailyCap === null ? null : String(resource.dailyCap),
    sub2AccountId: resource.sub2AccountId,
    lastCheckedAt: resource.lastCheckedAt instanceof Date ? resource.lastCheckedAt.toISOString() : resource.lastCheckedAt ?? null
  };
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
