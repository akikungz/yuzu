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

- `LOG_PRETTY` — Pretty-print logs. Default: `false`.
- `METRICS_PORT` — Prometheus metrics port. Default: `9090`.

### Loki logging (optional)

Enable and configure Loki log shipping.

- `LOKI_ENABLED` — Enable Loki logging. Default: `false`.
- `LOKI_HOST` — Loki base URL. Default: `http://localhost:3100`.
- `LOKI_LABELS` — Comma-separated labels. Default: `app=yuzu`.
- `LOKI_BASIC_AUTH_USER` — Basic auth username (optional).
- `LOKI_BASIC_AUTH_PASSWORD` — Basic auth password (optional).

## Notes

- The runtime validates these variables using Zod. If a required value is missing or invalid, Yuzu will exit with an error.
- The recommended starting point is `.env.example`, which includes inline example values.
