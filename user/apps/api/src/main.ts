import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import { env } from "./config/env.js";
import { sendError } from "./common/errors.js";
import { ok } from "./common/response.js";
import { prisma } from "./common/prisma.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { registerWalletRoutes } from "./modules/wallet/routes.js";
import { registerProductRoutes } from "./modules/products/routes.js";
import { registerOrderRoutes } from "./modules/orders/routes.js";
import { registerRentalRoutes } from "./modules/rentals/routes.js";
import { registerSupplierRoutes } from "./modules/suppliers/routes.js";
import { registerBillingRoutes } from "./modules/billing/routes.js";
import { registerAdminRoutes } from "./modules/admin/routes.js";
import { registerOpenAiProxyRoutes } from "./modules/openai-proxy/routes.js";
import { startSub2UsageSyncScheduler } from "./jobs/sub2-usage-scheduler.js";

const readinessTimeoutMs = 5_000;

export async function buildServer() {
  const app = Fastify({
    logger: true,
    genReqId: () => crypto.randomUUID()
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(jwt, { secret: env.JWT_ACCESS_SECRET });

  app.setErrorHandler((error, _request, reply) => sendError(reply, error));

  app.get("/health", async (_request, reply) => {
    await prisma.$queryRaw`SELECT 1`;
    return ok(reply, { status: "ok", service: "zhisuan-yizhan-api" });
  });

  app.get("/live", async (_request, reply) => {
    return ok(reply, {
      status: "ok",
      service: "zhisuan-yizhan-api",
      checkedAt: new Date().toISOString()
    });
  });

  app.get("/ready", async (_request, reply) => {
    const checkedAt = new Date().toISOString();
    const [database, sub2api] = await Promise.all([
      checkDatabase(),
      checkSub2Api()
    ]);
    const ready = database.ok && sub2api.ok;
    return reply.status(ready ? 200 : 503).send({
      ok: ready,
      data: {
        status: ready ? "ok" : "degraded",
        service: "zhisuan-yizhan-api",
        checkedAt,
        dependencies: {
          database,
          sub2api
        }
      }
    });
  });

  await registerAuthRoutes(app);
  await registerWalletRoutes(app);
  await registerProductRoutes(app);
  await registerOrderRoutes(app);
  await registerRentalRoutes(app);
  await registerSupplierRoutes(app);
  await registerBillingRoutes(app);
  await registerAdminRoutes(app);
  await registerOpenAiProxyRoutes(app);

  return app;
}

async function checkDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, status: "ok" };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: readinessError(error)
    };
  }
}

async function checkSub2Api() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), readinessTimeoutMs);
  try {
    const response = await fetch(`${env.SUB2_BASE_URL.replace(/\/$/, "")}/health`, {
      signal: controller.signal
    });
    return {
      ok: response.ok,
      status: response.ok ? "ok" : "error",
      statusCode: response.status
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: readinessError(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function readinessError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
}

if (process.env.NODE_ENV !== "test") {
  const app = await buildServer();
  const stopSub2UsageSyncScheduler = startSub2UsageSyncScheduler(app.log);
  app.addHook("onClose", async () => {
    stopSub2UsageSyncScheduler();
  });
  await app.listen({ host: "0.0.0.0", port: env.API_PORT });
}
