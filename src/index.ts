import { Redis } from "ioredis";

import { prisma } from "@yuzu/database";
import { env } from "@yuzu/env";
import { logger } from "@yuzu/logger";
import { startMetricsServer } from "@yuzu/metrics";

import { ProvisionQueueWorker } from "@yuzu/queue/provision";
import { DeprovisionQueueWorker } from "@yuzu/queue/deprovision";
import { ToggleStatusQueueWorker } from "@yuzu/queue/toggle-status";

const SHUTDOWN_TIMEOUT = 30000; // 30 seconds
let shuttingDown = false;

// Start metrics server
const metricsServer = await startMetricsServer(env.METRICS_PORT);

const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

const provisionWorker = new ProvisionQueueWorker(redisConnection, prisma);
const deprovisionWorker = new DeprovisionQueueWorker(redisConnection, prisma);
const toggleStatusWorker = new ToggleStatusQueueWorker(redisConnection, prisma);

// Graceful shutdown handler
const gracefulShutdown = async (signal: string) => {
  if (shuttingDown) {
    logger.warn({ signal }, "Shutdown already in progress, ignoring signal");
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, "Shutdown signal received, starting graceful shutdown...");

  // Set a timeout to force exit if shutdown takes too long
  const shutdownTimeout = setTimeout(() => {
    logger.error(
      "Graceful shutdown timeout reached, forcing exit"
    );
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);

  try {
    // Close queue workers
    await Promise.all([
      provisionWorker.close(),
      deprovisionWorker.close(),
      toggleStatusWorker.close(),
    ]);
    logger.info("Queue workers closed");

    // Disconnect Redis
    redisConnection.disconnect();
    logger.info("Redis connection closed");

    // Close metrics server
    metricsServer.stop();
    logger.info("Metrics server stopped");

    // Close Prisma connection
    await prisma.$disconnect();
    logger.info("Database connection closed");

    clearTimeout(shutdownTimeout);
    logger.info("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    clearTimeout(shutdownTimeout);
    logger.error({ error }, "Error during graceful shutdown");
    process.exit(1);
  }
};

// Handle termination signals
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// Handle uncaught exceptions
process.on("uncaughtException", async (error) => {
  logger.error({ error }, "Uncaught exception");
  await gracefulShutdown("uncaughtException");
});

// Handle unhandled promise rejections
process.on("unhandledRejection", async (reason, promise) => {
  logger.error({ reason, promise }, "Unhandled promise rejection");
  await gracefulShutdown("unhandledRejection");
});
