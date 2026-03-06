import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";
import { logger } from "@yuzu/logger";

// Create a custom registry
export const metricsRegistry = new Registry();

// Set default labels
metricsRegistry.setDefaultLabels({
  app: "yuzu",
});

// Collect default metrics (CPU, memory, event loop lag, etc.)
collectDefaultMetrics({ register: metricsRegistry });

// =============================================================================
// Logging metrics (for correlation with Loki)
// =============================================================================

export const logEventsTotal = new Counter({
  name: "yuzu_log_events_total",
  help: "Total number of log events",
  labelNames: ["level", "service"] as const,
  registers: [metricsRegistry],
});

export const logErrorsTotal = new Counter({
  name: "yuzu_log_errors_total",
  help: "Total number of error log events",
  labelNames: ["service", "error_type"] as const,
  registers: [metricsRegistry],
});

// =============================================================================
// Queue job metrics
// =============================================================================

export const jobProcessedTotal = new Counter({
  name: "yuzu_jobs_processed_total",
  help: "Total number of jobs processed",
  labelNames: ["queue", "status"] as const,
  registers: [metricsRegistry],
});

export const jobDurationSeconds = new Histogram({
  name: "yuzu_job_duration_seconds",
  help: "Duration of job processing in seconds",
  labelNames: ["queue", "status"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [metricsRegistry],
});

export const activeJobsGauge = new Gauge({
  name: "yuzu_active_jobs",
  help: "Number of currently active jobs",
  labelNames: ["queue"] as const,
  registers: [metricsRegistry],
});

export const waitingJobsGauge = new Gauge({
  name: "yuzu_waiting_jobs",
  help: "Number of jobs waiting in queue",
  labelNames: ["queue"] as const,
  registers: [metricsRegistry],
});

// Instance provisioning specific metrics
export const provisionStepDurationSeconds = new Histogram({
  name: "yuzu_provision_step_duration_seconds",
  help: "Duration of each provision step in seconds",
  labelNames: ["step", "status"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [metricsRegistry],
});

export const instancesTotal = new Counter({
  name: "yuzu_instances_total",
  help: "Total number of instances created",
  labelNames: ["status"] as const,
  registers: [metricsRegistry],
});

// VM operations metrics
export const vmOperationsTotal = new Counter({
  name: "yuzu_vm_operations_total",
  help: "Total number of VM operations",
  labelNames: ["operation", "status"] as const,
  registers: [metricsRegistry],
});

// PVE API call metrics
export const pveApiCallsTotal = new Counter({
  name: "yuzu_pve_api_calls_total",
  help: "Total number of PVE API calls",
  labelNames: ["endpoint", "method", "status"] as const,
  registers: [metricsRegistry],
});

export const pveApiCallDurationSeconds = new Histogram({
  name: "yuzu_pve_api_call_duration_seconds",
  help: "Duration of PVE API calls in seconds",
  labelNames: ["endpoint", "method"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

// Start HTTP server for metrics endpoint
export async function startMetricsServer(port: number) {
  const server = Bun.serve({
    port,
    fetch: async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/metrics") {
        try {
          const metrics = await metricsRegistry.metrics();
          return new Response(metrics, {
            headers: {
              "Content-Type": metricsRegistry.contentType,
            },
          });
        } catch (error) {
          logger.error({ error }, "Failed to collect metrics");
          return new Response("Error collecting metrics", { status: 500 });
        }
      }

      if (url.pathname === "/health") {
        return new Response("OK", { status: 200 });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  logger.info({ port: server.port }, "Metrics server started");
  return server;
}
