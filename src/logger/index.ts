import pino, { transport, type Logger, type LoggerOptions } from "pino";

import { env } from "@yuzu/env";

/**
 * Logger configuration for Kubernetes deployment with Promtail.
 *
 * Outputs structured JSON logs to stdout which Promtail scrapes and forwards to Loki.
 * In development mode with LOG_PRETTY=true, uses pino-pretty for human-readable output.
 */

// Build transport based on configuration
function buildTransport() {
  if (env.LOG_PRETTY) {
    return transport({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    });
  }
  // Default: JSON output to stdout (Promtail will scrape this)
  return undefined;
}

const loggerOptions: LoggerOptions = {
  level: env.NODE_ENV === "production" ? "info" : "debug",
  base: {
    app: "yuzu",
    env: env.NODE_ENV,
  },
  // Add timestamp in ISO format for Promtail parsing
  timestamp: pino.stdTimeFunctions.isoTime,
  // Format error objects properly
  formatters: {
    level: (label) => ({ level: label }),
  },
};

export const logger: Logger = pino(loggerOptions, buildTransport());

// Export a function to create child loggers with additional context
export function createLogger(context: Record<string, unknown>): Logger {
  return logger.child(context);
}
