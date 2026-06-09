import type { FastifyBaseLogger } from "fastify";
import { env } from "../config/env.js";
import { syncSub2UsageOnce } from "./sync-sub2-usage.js";

export function startSub2UsageSyncScheduler(logger: FastifyBaseLogger) {
  const intervalMs = env.SUB2_USAGE_SYNC_INTERVAL_MS;
  if (intervalMs <= 0) {
    logger.info("Sub2 usage sync scheduler is disabled");
    return () => undefined;
  }

  let running = false;
  let stopped = false;

  const run = async (trigger: "startup" | "interval") => {
    if (running || stopped) {
      logger.warn({ trigger }, "Sub2 usage sync skipped because a previous run is still active");
      return;
    }

    running = true;
    try {
      const result = await syncSub2UsageOnce(undefined, { persistCursor: true });
      logger.info({ trigger, ...result }, "Sub2 usage sync completed");
    } catch (error) {
      logger.error({ trigger, error }, "Sub2 usage sync failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void run("interval");
  }, intervalMs);
  timer.unref?.();

  if (env.SUB2_USAGE_SYNC_ON_START) {
    void run("startup");
  }

  logger.info({ intervalMs, onStart: env.SUB2_USAGE_SYNC_ON_START }, "Sub2 usage sync scheduler started");
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
