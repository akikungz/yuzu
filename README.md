# 🍊 Yuzu

A **Proxmox VE VM lifecycle management service** built with Bun, providing automated provisioning, deprovisioning, and status management of virtual machines through a job queue system.

## 📋 Overview

Yuzu is a background worker service designed to manage virtual machine instances on Proxmox VE clusters. It handles:

- **VM Provisioning** – Clone templates, configure specs (CPU, memory, disk), and set up networking
- **VM Deprovisioning** – Safely stop and remove VMs, release network IPs
- **Status Management** – Start, stop, and restart VM instances

The service uses BullMQ for reliable job processing with Redis as the message broker and PostgreSQL (via Prisma) for persistent data storage.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Yuzu Service                          │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  Provision  │  │ Deprovision  │  │  Toggle Status   │   │
│  │   Worker    │  │    Worker    │  │     Worker       │   │
│  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘   │
│         │                │                    │             │
│         └────────────────┼────────────────────┘             │
│                          │                                  │
│                   ┌──────▼──────┐                           │
│                   │  Proxmox VE │                           │
│                   │     API     │                           │
│                   └─────────────┘                           │
└─────────────────────────────────────────────────────────────┘
         │                                    │
    ┌────▼────┐                          ┌────▼────┐
    │  Redis  │                          │ Postgres │
    │ (Queue) │                          │   (DB)   │
    └─────────┘                          └──────────┘
```

## ✨ Features

- **Job Queue System** – Reliable async job processing with BullMQ
- **Automatic Retries** – Failed jobs are retried with configurable attempts
- **Concurrent Processing** – Multiple workers handle jobs in parallel
- **OpenTelemetry Logs** – Structured logs exported to an OTLP collector
- **Cloud-Init Support** – VMs are configured with cloud-init for SSH access
- **Network IP Management** – Automatic IP allocation and deallocation
- **Type-Safe API** – Proxmox API types generated from OpenAPI spec
- **OpenTelemetry Metrics** – Periodic OTLP metric export to a collector

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1.2.17+
- PostgreSQL database
- Redis server
- Proxmox VE cluster with API access

### Installation

```bash
# Clone the repository
git clone https://github.com/akikungz/yuzu.git
cd yuzu

# Install dependencies
bun install

# Generate Prisma client
bunx prisma generate
```

### Configuration

Copy `.env.example` to `.env` (or `.env.development` for dev) and update the values. For full details, see `docs/env.md`.

```env
# Environment
NODE_ENV=development

# Proxmox VE API
PVE_API_URL=https://your-pve-host:8006
PVE_API_TOKEN_ID=user@pam!token-name
PVE_API_TOKEN_SECRET=your-api-token-secret

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/yuzu

# Redis
REDIS_URL=redis://localhost:6379

# Queue worker concurrency
YUZU_PROVISION_CONCURRENCY=5
YUZU_DEPROVISION_CONCURRENCY=5
YUZU_TOGGLE_STATUS_CONCURRENCY=10
YUZU_RESOURCE_LOCK_TTL_MILLIS=900000
YUZU_RESOURCE_LOCK_ACQUIRE_TIMEOUT_MILLIS=30000
YUZU_RESOURCE_LOCK_RETRY_INTERVAL_MILLIS=250

# OpenTelemetry / OTLP (optional)
OTEL_SERVICE_NAME=yuzu
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
# OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://localhost:4318/v1/logs
# OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=grpc
# OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://localhost:4318/v1/metrics
# OTEL_EXPORTER_OTLP_METRICS_PROTOCOL=grpc
# OTEL_EXPORTER_OTLP_USERNAME=collector-user
# OTEL_EXPORTER_OTLP_PASSWORD=collector-pass
OTEL_METRIC_EXPORT_INTERVAL_MILLIS=30000
OTEL_EXPORT_TIMEOUT_MILLIS=10000
```

### Database Setup

```bash
# Run migrations
bunx prisma migrate dev

# (Optional) Open Prisma Studio to view data
bunx prisma studio
```

### Running

```bash
# Development mode with hot reload
bun run dev

# Or with custom env file
bun --env-file=.env.development --watch src/index.ts

# Production mode
bun run start
```

## 📁 Project Structure

```
yuzu/
├── src/
│   ├── index.ts              # Application entry point
│   ├── database/             # Prisma client & database utilities
│   │   └── prisma/
│   │       └── schema.prisma # Database schema
│   ├── env/                  # Environment variable validation (Zod)
│   ├── logger/               # OpenTelemetry-backed logger facade
│   ├── metrics/              # OpenTelemetry-backed metric instruments
│   ├── pve/                  # Proxmox VE API integration
│   │   ├── api.ts            # OpenAPI client setup
│   │   ├── qemu.ts           # QEMU VM operations
│   │   ├── shared.ts         # Shared utilities (UPID monitoring)
│   │   └── type.ts           # Generated API types
│   └── queue/                # BullMQ job workers
│       ├── provision.ts      # VM provisioning worker
│       ├── deprovision.ts    # VM deprovisioning worker
│       └── toggle-status.ts  # VM status management worker
├── snippets/
│   └── allow_ssh.yaml        # Cloud-init config for SSH access
├── package.json
├── tsconfig.json
└── prisma.config.ts
```

## 📊 OpenTelemetry Metrics

Yuzu exports metrics to an OTLP collector over either HTTP or gRPC. With `http/protobuf` it defaults to `http://localhost:4318/v1/metrics`. With `grpc` it uses the collector endpoint directly, which is commonly `http://localhost:4317`.

### Available Metrics

| Metric                                 | Type      | Description                                            |
| -------------------------------------- | --------- | ------------------------------------------------------ |
| `yuzu_log_events_total`                | Counter   | Total number of log events (labels: level, service)    |
| `yuzu_log_errors_total`                | Counter   | Total number of error log events                       |
| `yuzu_jobs_processed_total`            | Counter   | Total number of jobs processed (labels: queue, status) |
| `yuzu_job_duration_seconds`            | Histogram | Duration of job processing in seconds                  |
| `yuzu_active_jobs`                     | Gauge     | Number of currently active jobs                        |
| `yuzu_waiting_jobs`                    | Gauge     | Number of jobs waiting in queue                        |
| `yuzu_provision_step_duration_seconds` | Histogram | Duration of each provision step                        |
| `yuzu_instances_total`                 | Counter   | Total number of instances created                      |
| `yuzu_vm_operations_total`             | Counter   | Total number of VM operations                          |
| `yuzu_pve_api_calls_total`             | Counter   | Total number of PVE API calls                          |
| `yuzu_pve_api_call_duration_seconds`   | Histogram | Duration of PVE API calls                              |

For dashboards, logs, and tracing guidance, see `docs/observability.md`.

## 📝 OpenTelemetry Logs

Yuzu exports logs to an OTLP collector over either HTTP or gRPC. With `http/protobuf` it defaults to `http://localhost:4318/v1/logs`. With `grpc` it uses the collector endpoint directly, commonly `http://localhost:4317`.

### Configuration

Set the following environment variables to configure OTLP log export:

```env
OTEL_SERVICE_NAME=yuzu
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
# OTEL_EXPORTER_OTLP_USERNAME=collector-user
# OTEL_EXPORTER_OTLP_PASSWORD=collector-pass
```

### Grafana Dashboard

With OTLP logs and metrics flowing into your collector, you can route them to Grafana-compatible backends such as Loki, Tempo, Mimir, or any OpenTelemetry-supported sink.

For deployment details, see `docs/observability.md`.

## 🔧 Queue Workers

Each worker supports configurable in-process concurrency via environment variables:

- `YUZU_PROVISION_CONCURRENCY` for provision jobs
- `YUZU_DEPROVISION_CONCURRENCY` for deprovision jobs
- `YUZU_TOGGLE_STATUS_CONCURRENCY` for power-state jobs

This lets one Yuzu instance process multiple jobs concurrently without increasing the number of pods, while still keeping separate limits per queue type.

Yuzu also uses Redis-backed resource locks to prevent conflicting jobs from operating on the same resource at the same time:

- per-`instanceId` locks across all queue types
- per-`vmid` locks for operations targeting the same VM

The lock behavior can be tuned with:

- `YUZU_RESOURCE_LOCK_TTL_MILLIS`
- `YUZU_RESOURCE_LOCK_ACQUIRE_TIMEOUT_MILLIS`
- `YUZU_RESOURCE_LOCK_RETRY_INTERVAL_MILLIS`

### Provision Worker
Handles VM creation from templates:
1. Fetches instance details and validates request
2. Generates unique VMID and selects target node (load balancing)
3. Allocates network IP from pool
4. Clones template VM (linked clone)
5. Configures VM specs (CPU, memory, disk, network)
6. Starts VM and waits for QEMU Guest Agent
7. Updates database with VM details

### Deprovision Worker
Handles VM removal:
1. Stops the running VM gracefully
2. Destroys the VM and releases resources
3. Deallocates network IP back to pool
4. Updates database status

### Toggle Status Worker
Handles VM power state changes:
- **START** – Boots the VM and waits for guest agent
- **STOP** – Gracefully shuts down the VM
- **RESTART** – Stops then starts the VM

## 📊 Data Model

Key entities in the database:

| Model                       | Description                                  |
| --------------------------- | -------------------------------------------- |
| `PlatformUser`              | Users who can request/manage instances       |
| `Instance`                  | VM instance with specs and status            |
| `PVEVM`                     | Proxmox VM reference (vmid, node, IP)        |
| `PVETemplate`               | VM templates for cloning                     |
| `PVENode`                   | Proxmox cluster nodes                        |
| `PVENetwork`                | Network pools with IP ranges                 |
| `Request`                   | VM provisioning requests (approval workflow) |
| `Course` / `CourseOffering` | Academic course associations                 |

## 🛠️ Development

### Regenerate Proxmox API Types

```bash
# Requires pve-openapi server running on localhost:3006
bun run pve-api:gen
```

See [pve-openapi](https://github.com/akikungz/pve-openapi) for the OpenAPI specification.

### Path Aliases

The project uses TypeScript path aliases for cleaner imports:

```typescript
import { prisma } from "@yuzu/database";
import { env } from "@yuzu/env";
import { logger } from "@yuzu/logger";
import * as qemu from "@yuzu/pve/qemu";
```

## 📦 Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Database**: PostgreSQL with [Prisma](https://prisma.io)
- **Queue**: [BullMQ](https://bullmq.io) + Redis
- **HTTP Client**: [openapi-fetch](https://openapi-ts.dev/openapi-fetch/)
- **Logging**: [Pino](https://getpino.io)
- **Validation**: [Zod](https://zod.dev)

## 📄 License

This project is private.

---

Built with 🍊 and Bun
