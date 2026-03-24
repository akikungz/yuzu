# Observability

Yuzu now exports both logs and metrics through OpenTelemetry using OTLP over HTTP or gRPC.

## What Yuzu sends

- Logs: structured application logs with service and environment attributes
- Metrics: queue throughput, job latency, active-job counts, and Proxmox API metrics

## Collector endpoints

By default Yuzu uses these OTLP HTTP endpoints:

- Logs: `http://localhost:4318/v1/logs`
- Metrics: `http://localhost:4318/v1/metrics`

If you switch to `grpc`, Yuzu uses the collector endpoint directly instead of appending `/v1/...`. A common collector address is:

- `http://localhost:4317`

You can override the shared base endpoint or each signal independently:

```env
OTEL_SERVICE_NAME=yuzu
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
# OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://otel-collector:4318/v1/logs
# OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://otel-collector:4318/v1/metrics
# OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=grpc
# OTEL_EXPORTER_OTLP_METRICS_PROTOCOL=grpc
# OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer token
# OTEL_EXPORTER_OTLP_LOGS_HEADERS=x-scope-orgid=tenant-a
# OTEL_EXPORTER_OTLP_METRICS_HEADERS=x-scope-orgid=tenant-a
OTEL_METRIC_EXPORT_INTERVAL_MILLIS=10000
OTEL_EXPORT_TIMEOUT_MILLIS=30000
```

## Common backends

An OTEL collector can forward telemetry to:

- Grafana Loki for logs
- Grafana Mimir or Prometheus-compatible backends for metrics
- Tempo or Jaeger for traces if tracing is added later

## Important change

Yuzu no longer exposes its own Prometheus `/metrics` HTTP endpoint and no longer uses the previous Pino-based logger path.
