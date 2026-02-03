import { Redis } from "ioredis";

import { prisma } from "@yuzu/database";
import { env } from "@yuzu/env";
import { logger } from "@yuzu/logger";
import { startMetricsServer } from "@yuzu/metrics";

import { ProvisionQueueWorker } from "@yuzu/queue/provision";
import { DeprovisionQueueWorker } from "@yuzu/queue/deprovision";
import { ToggleStatusQueueWorker } from "@yuzu/queue/toggle-status";

// Start metrics server
await startMetricsServer(env.METRICS_PORT);

const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

const provisionWorker = new ProvisionQueueWorker(redisConnection, prisma);
const deprovisionWorker = new DeprovisionQueueWorker(redisConnection, prisma);
const toggleStatusWorker = new ToggleStatusQueueWorker(redisConnection, prisma);

process.on("SIGINT", async () => {
  logger.info("Shutting down gracefully...");
  await provisionWorker.close();
  await deprovisionWorker.close();
  await toggleStatusWorker.close();
  redisConnection.disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Shutting down gracefully...");
  await provisionWorker.close();
  await deprovisionWorker.close();
  await toggleStatusWorker.close();
  redisConnection.disconnect();
  process.exit(0);
});
