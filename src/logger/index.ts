import pino, { transport, type Logger, type LoggerOptions } from "pino";

import { env } from "@yuzu/env";

// Parse Loki labels from environment variable (format: "key1=value1,key2=value2")
function parseLokiLabels(labelsStr: string): Record<string, string> {
  const labels: Record<string, string> = {};
  labelsStr.split(",").forEach((pair) => {
    const [key, value] = pair.split("=");
    if (key && value) {
      labels[key.trim()] = value.trim();
    }
  });
  return labels;
}

// Build transport targets based on configuration
function buildTransportTargets(): pino.TransportTargetOptions[] {
  const targets: pino.TransportTargetOptions[] = [];

  // Console transport (pretty or JSON)
  if (env.LOG_PRETTY) {
    targets.push({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
      level: "trace",
    });
  } else {
    targets.push({
      target: "pino/file",
      options: { destination: 1 }, // stdout
      level: "trace",
    });
  }

  // Loki transport (if enabled)
  if (env.LOKI_ENABLED) {
    const lokiOptions: Record<string, unknown> = {
      host: env.LOKI_HOST,
      labels: parseLokiLabels(env.LOKI_LABELS),
      batching: true,
      interval: 5, // Send logs every 5 seconds
    };

    // Add basic auth if configured
    if (env.LOKI_BASIC_AUTH_USER && env.LOKI_BASIC_AUTH_PASSWORD) {
      lokiOptions.basicAuth = {
        username: env.LOKI_BASIC_AUTH_USER,
        password: env.LOKI_BASIC_AUTH_PASSWORD,
      };
    }

    targets.push({
      target: "pino-loki",
      options: lokiOptions,
      level: "trace",
    });
  }

  return targets;
}

// Create the logger with configured transports
const transportTargets = buildTransportTargets();

const loggerTransport = transport({
  targets: transportTargets,
});

const loggerOptions: LoggerOptions = {
  level: env.NODE_ENV === "production" ? "info" : "debug",
  base: {
    env: env.NODE_ENV,
  },
};

export const logger: Logger = pino(loggerOptions, loggerTransport);

// Export a function to create child loggers with additional context
export function createLogger(context: Record<string, unknown>): Logger {
  return logger.child(context);
}

// Log startup information
if (env.LOKI_ENABLED) {
  logger.info({ lokiHost: env.LOKI_HOST }, "Loki logging enabled");
}
