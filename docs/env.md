# Environment Variables

This document explains the variables used by Yuzu and how they map to `.env.example` and the runtime validation in `src/env/index.ts`.

## Getting started

1. Copy the template:
   - `.env.example` → `.env` (production)
   - or `.env.example` → `.env.development` (local dev)
2. Fill in the values for your environment.
3. Start the app. Missing or invalid values will cause startup to fail with a validation error.

## Required variables

These variables are required in all environments.

- `NODE_ENV` — Runtime mode. Allowed: `development`, `production`, `test`. Default: `development`.
- `PVE_API_URL` — Proxmox VE API base URL. Example: `https://pve.example.com:8006`.
- `PVE_API_TOKEN_ID` — Proxmox API token ID (e.g., `root@pam!yuzu`).
- `PVE_API_TOKEN_SECRET` — Proxmox API token secret.
- `DATABASE_URL` — PostgreSQL connection string (Prisma compatible).
- `REDIS_URL` — Redis connection string for BullMQ.

## Optional variables

These variables are optional and have defaults when omitted.

- `OTEL_SERVICE_NAME` — Service name attached to exported telemetry. Default: `yuzu`.
- `OTEL_EXPORTER_OTLP_ENDPOINT` — Base OTLP HTTP endpoint for the collector. Default: `http://localhost:4318`.
- `OTEL_EXPORTER_OTLP_PROTOCOL` — Shared OTLP transport. Allowed: `http/protobuf`, `http`, `grpc`. Default: `http/protobuf`.
- `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` — Optional full override for the logs endpoint.
- `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL` — Optional protocol override for logs only.
- `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` — Optional full override for the metrics endpoint.
- `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL` — Optional protocol override for metrics only.
- `OTEL_EXPORTER_OTLP_USERNAME` — Optional shared username for OTLP Basic authentication.
- `OTEL_EXPORTER_OTLP_PASSWORD` — Optional shared password for OTLP Basic authentication.
- `OTEL_EXPORTER_OTLP_LOGS_USERNAME` — Optional username override for logs only.
- `OTEL_EXPORTER_OTLP_LOGS_PASSWORD` — Optional password override for logs only.
- `OTEL_EXPORTER_OTLP_METRICS_USERNAME` — Optional username override for metrics only.
- `OTEL_EXPORTER_OTLP_METRICS_PASSWORD` — Optional password override for metrics only.
- `OTEL_METRIC_EXPORT_INTERVAL_MILLIS` — Metric push interval in milliseconds. Default: `10000`.
- `OTEL_EXPORT_TIMEOUT_MILLIS` — OTLP export timeout in milliseconds. Default: `30000`.

## Notes

- The runtime validates these variables using Zod. If a required value is missing or invalid, Yuzu will exit with an error.
- Logs and metrics are exported to an OTLP collector; Yuzu no longer exposes a Prometheus scrape endpoint itself.
- The recommended starting point is `.env.example`, which includes inline example values.
