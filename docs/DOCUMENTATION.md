# Yuzu — Comprehensive Technical Documentation

> **Version:** 1.0.0  
> **Runtime:** Bun 1.3  
> **Last updated:** March 9, 2026

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Technology Stack](#2-technology-stack)
3. [Architecture](#3-architecture)
4. [Project Structure](#4-project-structure)
5. [Modules & Components](#5-modules--components)
   - [Entry Point](#51-entry-point)
   - [Environment (`src/env`)](#52-environment-srcenv)
   - [Logger (`src/logger`)](#53-logger-srclogger)
   - [Metrics (`src/metrics`)](#54-metrics-srcmetrics)
   - [Database (`src/database`)](#55-database-srcdatabase)
   - [PVE API (`src/pve`)](#56-pve-api-srcpve)
   - [Queue Workers (`src/queue`)](#57-queue-workers-srcqueue)
6. [Data Models](#6-data-models)
7. [Queue Job Reference](#7-queue-job-reference)
8. [Provisioning Workflow](#8-provisioning-workflow)
9. [Deprovisioning Workflow](#9-deprovisioning-workflow)
10. [Toggle Status Workflow](#10-toggle-status-workflow)
11. [Environment Variables Reference](#11-environment-variables-reference)
12. [Metrics Reference](#12-metrics-reference)
13. [Observability](#13-observability)
14. [Docker & Deployment](#14-docker--deployment)
15. [Development Guide](#15-development-guide)
16. [Dependency Versions](#16-dependency-versions)

---

## 1. Project Overview

**Yuzu** is a background worker service that manages the full lifecycle of virtual machine instances on a **Proxmox VE (PVE)** cluster. It is built as a **queue-driven microservice** — it does not expose an HTTP API itself but consumes jobs from Redis queues and performs the heavy PVE operations asynchronously.

### Core Responsibilities

| Responsibility         | Description                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------- |
| **VM Provisioning**    | Clone a PVE template, resize disk, configure CPU/memory/network, start via cloud-init |
| **VM Deprovisioning**  | Gracefully stop VM, delete it from PVE, release the allocated network IP              |
| **VM Status Toggling** | Start, stop, or restart a running VM via PVE QEMU API                                 |
| **Metrics Exposure**   | Prometheus metrics endpoint for job throughput, latency, and PVE API health           |
| **Structured Logging** | JSON logs via Pino, optionally shipped to Loki                                        |

---

## 2. Technology Stack

| Layer             | Technology                   | Version               |
| ----------------- | ---------------------------- | --------------------- |
| **Runtime**       | Bun                          | `1.3`                 |
| **Language**      | TypeScript                   | `^5.8.3`              |
| **Queue**         | BullMQ                       | `^5.70.1`             |
| **Queue Broker**  | Redis (via ioredis)          | `^5.10.0`             |
| **Database ORM**  | Prisma (client)              | `^7.4.2`              |
| **Database**      | PostgreSQL (via pg driver)   | `^8.19.0`             |
| **PrismaAdapter** | @prisma/adapter-pg           | `^7.4.2`              |
| **HTTP Client**   | openapi-fetch                | `^0.15.2`             |
| **HTTP Engine**   | undici                       | `^7.22.0`             |
| **Validation**    | Zod                          | `^4.3.6`              |
| **Logging**       | Pino + pino-pretty           | `^10.3.1` / `^13.1.3` |
| **Metrics**       | prom-client                  | `^15.1.3`             |
| **PVE Types**     | openapi-typescript (dev)     | `^7.13.0`             |
| **Container**     | Docker (oven/bun:1.3-debian) | —                     |

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          Yuzu Service                            │
│                                                                  │
│  ┌──────────────────┐  ┌───────────────────┐  ┌──────────────┐  │
│  │  Provision       │  │  Deprovision      │  │ Toggle       │  │
│  │  QueueWorker     │  │  QueueWorker      │  │ Status       │  │
│  │  (concurrency=5) │  │  (concurrency=5)  │  │ QueueWorker  │  │
│  └────────┬─────────┘  └────────┬──────────┘  └──────┬───────┘  │
│           │                     │                     │          │
│           └─────────────────────┼─────────────────────┘          │
│                                 │                                │
│               ┌─────────────────▼──────────────────┐            │
│               │           PVE API Client            │            │
│               │  (openapi-fetch + generated types)  │            │
│               └─────────────────────────────────────┘            │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Metrics Server  (Prometheus – port 9090 by default)    │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
           │                  │                  │
    ┌──────▼──────┐   ┌───────▼───────┐  ┌──────▼──────┐
    │    Redis    │   │  PostgreSQL   │  │ Proxmox VE  │
    │  (BullMQ)   │   │  (via Prisma) │  │  REST API   │
    └─────────────┘   └───────────────┘  └─────────────┘
```

### Key design decisions

- **Workers only read job IDs** — all full object data is fetched from the database inside the worker, keeping queue payloads thin and avoiding stale data.
- **Retries are handled by BullMQ** — workers re-throw errors to trigger automatic retries. On final failure the database record is updated to `FAILED`.
- **All PVE calls are instrumented** — every Proxmox API call is wrapped in `recordPveCall()` to capture latency and error counters.
- **Graceful shutdown** — SIGINT / SIGTERM signals close workers, Redis, metrics server, and Prisma in order before exit.

---

## 4. Project Structure

```
yuzu/
├── Dockerfile                  # Multi-stage Docker build
├── package.json                # Dependencies and scripts
├── prisma.config.ts            # Prisma configuration
├── tsconfig.json               # TypeScript compiler config
├── docs/
│   ├── DOCUMENTATION.md        # This file
│   ├── env.md                  # Environment variable reference
│   └── observability.md        # Metrics, logs, traces guide
├── scripts/
│   └── clean-instance.ts       # Utility script for cleanup
├── snippets/
│   └── allow_ssh.yaml          # Cloud-init / SSH helper snippet
└── src/
    ├── index.ts                # Application entry point
    ├── database/
    │   ├── index.ts            # Prisma client initialization
    │   └── prisma/
    │       ├── schema.prisma   # Database schema definition
    │       └── generated/      # Auto-generated Prisma client
    ├── env/
    │   └── index.ts            # Environment variable validation (Zod)
    ├── logger/
    │   └── index.ts            # Pino logger configuration
    ├── metrics/
    │   └── index.ts            # Prometheus metrics registry + HTTP server
    ├── pve/
    │   ├── api.ts              # PVE API client (openapi-fetch)
    │   ├── qemu.ts             # QEMU VM operations (clone, resize, config, start, stop)
    │   ├── shared.ts           # UPID polling, node selection, VMID generation
    │   └── type.ts             # Auto-generated OpenAPI types for PVE
    └── queue/
        ├── types.ts            # Job data/result TypeScript interfaces
        ├── provision.ts        # ProvisionQueueWorker
        ├── deprovision.ts      # DeprovisionQueueWorker
        └── toggle-status.ts    # ToggleStatusQueueWorker
```

---

## 5. Modules & Components

### 5.1 Entry Point

**File:** [src/index.ts](../src/index.ts)

Responsibilities:
1. Start the Prometheus metrics HTTP server.
2. Create a shared Redis connection (`ioredis`).
3. Instantiate each of the three queue workers.
4. Register graceful shutdown handlers for `SIGINT`, `SIGTERM`, `uncaughtException`, and `unhandledRejection`.

**Shutdown order:**
1. Close all three BullMQ workers (drains active jobs up to `SHUTDOWN_TIMEOUT = 30s`).
2. Disconnect Redis connection.
3. Stop metrics HTTP server.
4. Disconnect Prisma.

---

### 5.2 Environment (`src/env`)

**File:** [src/env/index.ts](../src/env/index.ts)

Uses **Zod** to parse and validate `process.env` at startup. The application exits immediately with a descriptive error if any required variable is missing or malformed.

```ts
export const envSchema = z.object({
  NODE_ENV:               z.enum(["development", "production", "test"]).default("development"),
  PVE_API_URL:            z.url(),
  PVE_API_TOKEN_ID:       z.string().min(1),
  PVE_API_TOKEN_SECRET:   z.string().min(1),
  DATABASE_URL:           z.string().min(1),
  REDIS_URL:              z.string().min(1),
  LOG_PRETTY:             z.coerce.boolean().default(false),
  METRICS_PORT:           z.coerce.number().default(9090),
});
```

The validated object is exported as `env` and imported throughout the codebase via the `@yuzu/env` path alias.

---

### 5.3 Logger (`src/logger`)

**File:** [src/logger/index.ts](../src/logger/index.ts)

Built on **Pino**. Key behaviours:

| Setting      | Value                                                             |
| ------------ | ----------------------------------------------------------------- |
| Log level    | `debug` in development, `info` in production                      |
| Base fields  | `app: "yuzu"`, `env: NODE_ENV`                                    |
| Timestamp    | ISO 8601                                                          |
| Level format | `{ level: "info" }` (string, not number)                          |
| Transport    | `pino-pretty` when `LOG_PRETTY=true`, otherwise raw JSON (stdout) |

Child loggers are used extensively to attach contextual fields:
```ts
const log = logger.child({ service: "provision-worker", jobId, instanceId });
```

---

### 5.4 Metrics (`src/metrics`)

**File:** [src/metrics/index.ts](../src/metrics/index.ts)

Creates a **custom Prometheus registry** (`metricsRegistry`) with the default label `app=yuzu` and exposes a lightweight HTTP server at `METRICS_PORT` (default: `9090`) at the `/metrics` endpoint.

Default Node.js/process metrics (CPU, memory, event loop lag, GC) are also collected via `collectDefaultMetrics`.

See [§12 Metrics Reference](#12-metrics-reference) for all exported metric names.

---

### 5.5 Database (`src/database`)

**File:** [src/database/index.ts](../src/database/index.ts)

Initializes a `PrismaClient` using the `@prisma/adapter-pg` driver (the Bun-compatible PostgreSQL adapter). A `pg.Pool` with `max: 10` connections is used.

```ts
export const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: env.DATABASE_URL, max: 10 })),
});
```

**Re-exports:** Prisma enums and the `PrismaClient` type so workers import from a single `@yuzu/database` alias.

**Prisma config:** `prisma.config.ts` uses `engineType: "client"` and `runtime: "bun"` to generate a Bun-native client without a native binary engine.

---

### 5.6 PVE API (`src/pve`)

#### `api.ts`
Creates the `pveApi` client using **openapi-fetch** targeting `PVE_API_URL`. Authentication is via the `Authorization: PVEAPIToken=<TOKEN_ID>=<SECRET>` header injected on every request.

#### `qemu.ts`
Provides individual QEMU VM operations, each of which starts an async PVE task and returns a **UPID** (Universal Process ID) that is then polled via `upidStatusCheck`:

| Function         | PVE Endpoint                                     | Description                          |
| ---------------- | ------------------------------------------------ | ------------------------------------ |
| `cloneQemu`      | `POST /nodes/{node}/qemu/{vmid}/clone`           | Clone a template into a new VM       |
| `resizeQemuDisk` | `PUT /nodes/{node}/qemu/{vmid}/resize`           | Resize `scsi0` disk by `+{n}G`       |
| `editQemu`       | `PUT /nodes/{node}/qemu/{vmid}/config`           | Set CPU, memory, network, cloud-init |
| `startQemu`      | `POST /nodes/{node}/qemu/{vmid}/status/start`    | Start a VM                           |
| `stopQemu`       | `POST /nodes/{node}/qemu/{vmid}/status/stop`     | Stop a VM                            |
| `shutdownQemu`   | `POST /nodes/{node}/qemu/{vmid}/status/shutdown` | Graceful shutdown a VM               |
| `deleteQemu`     | `DELETE /nodes/{node}/qemu/{vmid}`               | Delete a VM permanently              |

#### `shared.ts`
Utility functions shared across workers:

| Function               | Description                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `upidStatusCheck`      | Polls a PVE UPID task until `status === "stopped"`. Default timeout: 5 min, poll interval: 2s |
| `getNodeWithLeastLoad` | Queries all PVE nodes and returns the name of the one with the lowest CPU utilization         |
| `generateNextVmid`     | Calls the PVE `nextid` endpoint to get the next available VM ID                               |

---

### 5.7 Queue Workers (`src/queue`)

All three workers share the same patterns:

- Extend `Worker` from **BullMQ** with the Redis connection and `concurrency: 5`.
- Queue names are **prefixed with `NODE_ENV`** to avoid collision across environments (e.g. `development_provision-instance`).
- `lockDuration: 300000` (5 minutes) ensures long-running clone operations are not incorrectly marked stalled.
- `stalledInterval: 5000` / `maxStalledCount: 2` — extra stall protection.
- Every step is wrapped in `executeStep()` for per-step timing and structured logging.
- PVE calls are wrapped in `recordPveCall()` to track API latency and call counts.

#### Worker event listeners

| Event       | Action                                           |
| ----------- | ------------------------------------------------ |
| `active`    | Increment `yuzu_active_jobs`                     |
| `completed` | Decrement `yuzu_active_jobs`, log result summary |
| `failed`    | Decrement `yuzu_active_jobs`, log error details  |
| `error`     | Log the worker-level error                       |

#### `close()` method
Each worker exposes `close()` which calls `this.worker.close()` for clean shutdown.

---

## 6. Data Models

The Prisma schema defines the following key models relevant to Yuzu:

### Instance
The central entity Yuzu manages. Fields relevant to Yuzu:

| Field             | Type              | Description                                                     |
| ----------------- | ----------------- | --------------------------------------------------------------- |
| `id`              | `Int`             | Primary key                                                     |
| `platformUserId`  | `Int`             | Owner (links to `PlatformUser`)                                 |
| `pveTemplateId`   | `Int`             | Which PVE template to clone                                     |
| `pveVmId`         | `Int?`            | Assigned VM ID (null before provisioning)                       |
| `provisionStatus` | `ProvisionStatus` | Enum: `PENDING`, `PROVISIONING`, `RUNNING`, `STOPPED`, `FAILED` |
| `provisionError`  | `String?`         | Error message on failure                                        |
| `cpus`            | `Int`             | vCPU count                                                      |
| `memoryMB`        | `Int`             | RAM in MB                                                       |
| `diskGB`          | `Int`             | Additional disk size in GB                                      |

### PVETemplate
Represents a cloneable VM template on PVE:

| Field       | Type  | Description                     |
| ----------- | ----- | ------------------------------- |
| `id`        | `Int` | Primary key                     |
| `vmId`      | `Int` | PVE VM ID of the template       |
| `pveNodeId` | `Int` | Node where the template resides |

### PVEVM
Tracks the actual VM after provisioning:

| Field          | Type     | Description                            |
| -------------- | -------- | -------------------------------------- |
| `vmId`         | `Int`    | PVE VM ID (unique)                     |
| `hostname`     | `String` | Generated hostname                     |
| `pveNodeName`  | `String` | Node the VM lives on                   |
| `pveNetworkIP` | Relation | Associated `PVENetworkIP` (IP address) |
| `status`       | `String` | `RUNNING` / `STOPPED`                  |

### PVENetworkIP
An IP address pool managed by Yuzu:

| Field         | Type      | Description                            |
| ------------- | --------- | -------------------------------------- |
| `id`          | `Int`     | Primary key                            |
| `ipAddress`   | `String`  | The IPv4 address                       |
| `isAllocated` | `Boolean` | Whether currently assigned to a VM     |
| `pveNetwork`  | Relation  | Parent network (bridge, VLAN, gateway) |

### PlatformSSHKey
SSH public keys belonging to platform users, injected via cloud-init at provisioning time.

---

## 7. Queue Job Reference

Queue names follow the pattern: `{NODE_ENV}_{queue-type}`

| Queue Name                     | Job Name        | Worker Class              |
| ------------------------------ | --------------- | ------------------------- |
| `{env}_provision-instance`     | `provision`     | `ProvisionQueueWorker`    |
| `{env}_deprovision-instance`   | `deprovision`   | `DeprovisionQueueWorker`  |
| `{env}_toggle-instance-status` | `toggle-status` | `ToggleStatusQueueWorker` |

### Job Payloads

```ts
// Provision
interface ProvisionInstanceJobData {
  instanceId: number;
  userId: number;
}

// Deprovision
interface DeprovisionInstanceJobData {
  instanceId: number;
  userId: number;
}

// Toggle Status
interface ToggleInstanceStatusJobData {
  instanceId: number;
  userId: number;
  status: "START" | "STOP" | "RESTART";
}
```

### Job Results

All workers return a structured result on success or failure:

```ts
interface ProvisionInstanceJobResult {
  instanceId: number;
  status: 'success' | 'failed';
  message: string;
  duration?: number;      // total ms
  steps?: JobStepResult[];
}

interface JobStepResult {
  step: string;
  duration: number;
  success: boolean;
  details?: Record<string, unknown>;
}
```

---

## 8. Provisioning Workflow

The **ProvisionQueueWorker** performs these steps in order:

```
1.  fetch-instance              → Load instance + template + node from DB
2.  update-status-provisioning  → Set provisionStatus = PROVISIONING
3.  prepare-vm-resources        → Generate VMID + select least-loaded PVE node (parallel)
4.  clone-vm                    → POST clone to PVE, poll UPID until stopped
5.  fetch-owner-ssh-keys        → Load SSH public keys for the instance owner
6.  allocate-ip                 → Pick first free IP from PVENetworkIP pool
7.  create-pvevm-record         → Upsert PVEVM row with vmId, hostname, node, IP
8.  resize-disk                 → PUT resize scsi0 disk by +{diskGB}G, poll UPID
9.  configure-vm                → PUT config: CPU, memory, network bridge/VLAN, cloud-init (SSH keys, user/pass)
10. mark-ip-allocated           → Set PVENetworkIP.isAllocated = true
11. start-vm                    → POST start VM, poll UPID until stopped
12. update-instance-record      → Link instance → PVEVM, set provisionStatus = RUNNING
```

On **any step failure** after the configured retry attempts are exhausted, the instance `provisionStatus` is set to `FAILED` and `provisionError` is populated.

Cloud-init is configured with:
- **SSH public keys** from `PlatformSSHKey` for the owner
- **Default user credentials** (`username: "user"`, randomly generated password)
- **Static IP** from the allocated `PVENetworkIP`

---

## 9. Deprovisioning Workflow

The **DeprovisionQueueWorker** performs these steps in order:

```
1.  fetch-instance          → Load instance + PVEVM + network IP from DB
2.  stop-vm                 → POST stop to PVE (force), poll UPID until stopped
3.  delete-vm               → DELETE VM from PVE, poll UPID until stopped
4.  release-ip              → Set PVENetworkIP.isAllocated = false
5.  update-instance-record  → Clear pveVmId, set provisionStatus back to PENDING / remove record
```

If the VM is already stopped, the stop step is skipped gracefully.

---

## 10. Toggle Status Workflow

The **ToggleStatusQueueWorker** handles `START`, `STOP`, and `RESTART` actions:

```
START:
  1. fetch-instance  → Load instance + PVEVM from DB
  2. start-vm        → POST start VM, poll UPID
  3. update-status   → Set PVEVM.status = RUNNING

STOP:
  1. fetch-instance  → Load instance + PVEVM from DB
  2. shutdown-vm     → POST graceful shutdown, poll UPID
  3. update-status   → Set PVEVM.status = STOPPED

RESTART:
  1. fetch-instance  → Load instance + PVEVM from DB
  2. shutdown-vm     → POST graceful shutdown, poll UPID
  3. start-vm        → POST start VM, poll UPID
  4. update-status   → Set PVEVM.status = RUNNING
```

---

## 11. Environment Variables Reference

| Variable                   | Required | Default                 | Description                                             |
| -------------------------- | -------- | ----------------------- | ------------------------------------------------------- |
| `NODE_ENV`                 | No       | `development`           | Runtime mode: `development`, `production`, `test`       |
| `PVE_API_URL`              | **Yes**  | —                       | Proxmox VE API base URL (e.g. `https://pve.host:8006`)  |
| `PVE_API_TOKEN_ID`         | **Yes**  | —                       | PVE API token ID (e.g. `root@pam!yuzu`)                 |
| `PVE_API_TOKEN_SECRET`     | **Yes**  | —                       | PVE API token secret UUID                               |
| `DATABASE_URL`             | **Yes**  | —                       | PostgreSQL connection string (Prisma-compatible)        |
| `REDIS_URL`                | **Yes**  | —                       | Redis connection string (e.g. `redis://localhost:6379`) |
| `LOG_PRETTY`               | No       | `false`                 | Enable `pino-pretty` colored output                     |
| `METRICS_PORT`             | No       | `9090`                  | Port to expose Prometheus `/metrics` endpoint           |
| `LOKI_ENABLED`             | No       | `false`                 | Enable log shipping to Loki                             |
| `LOKI_HOST`                | No       | `http://localhost:3100` | Loki base URL                                           |
| `LOKI_LABELS`              | No       | `app=yuzu`              | Comma-separated Loki stream labels                      |
| `LOKI_BASIC_AUTH_USER`     | No       | —                       | Loki basic auth username                                |
| `LOKI_BASIC_AUTH_PASSWORD` | No       | —                       | Loki basic auth password                                |

> The runtime will **exit immediately** if any required variable is missing or fails Zod validation, printing a descriptive error to stderr.

---

## 12. Metrics Reference

All metrics are prefixed with `yuzu_` and carry the default label `app="yuzu"`.

### Queue Metrics

| Metric Name                 | Type      | Labels            | Description                                       |
| --------------------------- | --------- | ----------------- | ------------------------------------------------- |
| `yuzu_jobs_processed_total` | Counter   | `queue`, `status` | Total jobs processed (`success`/`retry`/`failed`) |
| `yuzu_job_duration_seconds` | Histogram | `queue`, `status` | End-to-end job processing duration                |
| `yuzu_active_jobs`          | Gauge     | `queue`           | Number of currently active jobs                   |
| `yuzu_waiting_jobs`         | Gauge     | `queue`           | Number of jobs waiting in queue                   |

Histogram buckets for `yuzu_job_duration_seconds`: `0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300` seconds.

### Provisioning Metrics

| Metric Name                            | Type      | Labels                | Description                        |
| -------------------------------------- | --------- | --------------------- | ---------------------------------- |
| `yuzu_provision_step_duration_seconds` | Histogram | `step`, `status`      | Duration of each provisioning step |
| `yuzu_instances_total`                 | Counter   | `status`              | Total instances created            |
| `yuzu_vm_operations_total`             | Counter   | `operation`, `status` | Total VM operations performed      |

Histogram buckets for `yuzu_provision_step_duration_seconds`: `0.1, 0.5, 1, 2, 5, 10, 30, 60, 120` seconds.

### PVE API Metrics

| Metric Name                          | Type      | Labels                         | Description          |
| ------------------------------------ | --------- | ------------------------------ | -------------------- |
| `yuzu_pve_api_calls_total`           | Counter   | `endpoint`, `method`, `status` | Total PVE API calls  |
| `yuzu_pve_api_call_duration_seconds` | Histogram | `endpoint`, `method`           | PVE API call latency |

### Logging Metrics

| Metric Name             | Type    | Labels                  | Description              |
| ----------------------- | ------- | ----------------------- | ------------------------ |
| `yuzu_log_events_total` | Counter | `level`, `service`      | Total log events emitted |
| `yuzu_log_errors_total` | Counter | `service`, `error_type` | Total error log events   |

### Default Process Metrics

Collected by `prom-client`'s `collectDefaultMetrics`: CPU usage, memory heap/RSS, event loop lag, active handles, GC pause durations, etc.

---

## 13. Observability

For full details see [docs/observability.md](./observability.md).

### Prometheus

Yuzu exposes metrics at:
```
http://<host>:<METRICS_PORT>/metrics
```

Useful PromQL queries:
```promql
# Job throughput by queue and status
sum(rate(yuzu_jobs_processed_total[5m])) by (queue, status)

# p95 job duration
histogram_quantile(0.95, sum(rate(yuzu_job_duration_seconds_bucket[5m])) by (le, queue))

# Current backlog
sum(yuzu_active_jobs) by (queue)

# PVE API 5xx error rate
sum(rate(yuzu_pve_api_calls_total{status=~"5.."}[5m])) by (endpoint)
```

### Logs (Loki / stdout)

Logs are structured JSON written to **stdout**. Set `LOKI_ENABLED=true` to ship them to a Loki instance. Without Loki, use Promtail or any log aggregator that reads container stdout.

Log levels: `debug` (development) / `info` (production). All logs include `app`, `env`, and ISO timestamps.

### Traces

Distributed tracing is **not built-in**. To add it, instrument workers with OpenTelemetry SDK spans around provisioning steps and PVE API calls and export to Jaeger or an OTLP collector. Suggested span attributes: `service.name`, `queue.name`, `job.id`, `instance.id`, `pve.node`, `pve.vmid`.

---

## 14. Docker & Deployment

### Multi-stage Dockerfile

The build uses two stages to minimize the final image size:

**Stage 1 (`build`)** — `oven/bun:1.3-debian`
1. Install dependencies (`bun install`).
2. Generate Prisma client (`bun prisma generate`).

**Stage 2 (`runtime`)** — `oven/bun:1.3-debian`
1. Install `ca-certificates` and refresh the CA bundle (required for TLS to PVE HTTPS API).
2. Copy `node_modules`, `src/`, `package.json`, and `tsconfig.json` from the build stage.
3. `CMD ["bun", "run", "src/index.ts"]`

### Build & Run

```bash
# Build image
docker build -t yuzu:latest .

# Run with environment variables
docker run -d \
  --name yuzu \
  -e NODE_ENV=production \
  -e PVE_API_URL=https://pve.example.com:8006 \
  -e PVE_API_TOKEN_ID="root@pam!yuzu" \
  -e PVE_API_TOKEN_SECRET="<secret>" \
  -e DATABASE_URL="postgresql://user:pass@db:5432/yuzu" \
  -e REDIS_URL="redis://redis:6379" \
  -p 9090:9090 \
  yuzu:latest
```

### Kubernetes

Recommended deployment pattern:
- Run as a `Deployment` with `replicas: 1` (or use Redis-based distributed locking for multi-replica).
- Mount env vars from a `Secret`.
- Expose the metrics port via a `Service` and `ServiceMonitor` (Prometheus Operator).
- Use a `PodDisruptionBudget` to protect against simultaneous evictions.

---

## 15. Development Guide

### Prerequisites

- [Bun](https://bun.sh) v1.2.17+
- PostgreSQL instance
- Redis instance
- Proxmox VE cluster with API token access

### Setup

```bash
git clone https://github.com/akikungz/yuzu.git
cd yuzu

# Install dependencies
bun install

# Generate Prisma client
bunx prisma generate

# Copy and fill in environment variables
cp .env.example .env.development
```

### Running Locally

```bash
# Development mode with file watching
bun dev

# Production mode
bun start
```

### Regenerating PVE API Types

If the PVE OpenAPI spec changes, regenerate the TypeScript types:

```bash
# Requires a running local proxy at localhost:3006 forwarding PVE's /openapi/json
bun run pve-api:gen
```

This updates [src/pve/type.ts](../src/pve/type.ts).

### Database Migrations

```bash
# Apply pending migrations
bunx prisma migrate deploy

# Create a new migration during development
bunx prisma migrate dev --name <migration-name>
```

### Path Aliases

TypeScript path aliases are configured in `tsconfig.json`. The following aliases are available:

| Alias            | Resolves to    |
| ---------------- | -------------- |
| `@yuzu/database` | `src/database` |
| `@yuzu/env`      | `src/env`      |
| `@yuzu/logger`   | `src/logger`   |
| `@yuzu/metrics`  | `src/metrics`  |
| `@yuzu/pve/*`    | `src/pve/*`    |
| `@yuzu/queue/*`  | `src/queue/*`  |

---

## 16. Dependency Versions

### Runtime Dependencies

| Package              | Version   | Purpose                                          |
| -------------------- | --------- | ------------------------------------------------ |
| `@prisma/adapter-pg` | `^7.4.2`  | Bun-compatible PostgreSQL adapter for Prisma     |
| `@prisma/client`     | `^7.4.2`  | Prisma ORM client                                |
| `bullmq`             | `^5.70.1` | Redis-based job queue                            |
| `ioredis`            | `^5.10.0` | Redis client (used by BullMQ and directly)       |
| `openapi-fetch`      | `^0.15.2` | Type-safe HTTP client for PVE OpenAPI            |
| `pg`                 | `^8.19.0` | PostgreSQL driver (backing Prisma adapter)       |
| `pino`               | `^10.3.1` | Fast structured JSON logger                      |
| `pino-pretty`        | `^13.1.3` | Human-readable log formatter (development)       |
| `prom-client`        | `^15.1.3` | Prometheus metrics client                        |
| `undici`             | `^7.22.0` | HTTP/1.1 & HTTP/2 client (used by openapi-fetch) |
| `zod`                | `^4.3.6`  | Schema validation for environment variables      |

### Development Dependencies

| Package              | Version   | Purpose                                          |
| -------------------- | --------- | ------------------------------------------------ |
| `@types/bun`         | `latest`  | TypeScript types for Bun runtime                 |
| `@types/pg`          | `^8.18.0` | TypeScript types for `pg` driver                 |
| `openapi-typescript` | `^7.13.0` | Generates TypeScript types from PVE OpenAPI spec |
| `prisma`             | `^7.4.2`  | Prisma CLI (migrations, generate)                |

### Peer Dependencies

| Package      | Version  | Purpose             |
| ------------ | -------- | ------------------- |
| `typescript` | `^5.8.3` | TypeScript compiler |

### Runtime

| Tool | Version                                         |
| ---- | ----------------------------------------------- |
| Bun  | `1.3` (Docker base image `oven/bun:1.3-debian`) |
