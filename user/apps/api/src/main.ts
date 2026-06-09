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

if (process.env.NODE_ENV !== "test") {
  const app = await buildServer();
  const stopSub2UsageSyncScheduler = startSub2UsageSyncScheduler(app.log);
  app.addHook("onClose", async () => {
    stopSub2UsageSyncScheduler();
  });
  await app.listen({ host: "0.0.0.0", port: env.API_PORT });
}
