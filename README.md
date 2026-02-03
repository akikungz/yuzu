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
- **Structured Logging** – Detailed logs with Pino for debugging and monitoring
- **Cloud-Init Support** – VMs are configured with cloud-init for SSH access
- **Network IP Management** – Automatic IP allocation and deallocation
- **Type-Safe API** – Proxmox API types generated from OpenAPI spec
- **Prometheus Metrics** – Built-in metrics endpoint for monitoring and alerting

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

Create a `.env` file (or `.env.development` for dev) with the following variables:

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

# Logging (optional)
LOG_PRETTY=true

# Prometheus Metrics (optional, default: 9090)
METRICS_PORT=9090

# Loki Logging (optional)
LOKI_ENABLED=false
LOKI_HOST=http://localhost:3100
LOKI_LABELS=app=yuzu,env=development
# LOKI_BASIC_AUTH_USER=your-username
# LOKI_BASIC_AUTH_PASSWORD=your-password
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
│   ├── logger/               # Pino logger configuration
│   ├── metrics/              # Prometheus metrics & HTTP server
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

## 📊 Prometheus Metrics

Yuzu exposes Prometheus metrics at `http://localhost:9090/metrics` (configurable via `METRICS_PORT`).

### Available Endpoints

| Endpoint   | Description                       |
| ---------- | --------------------------------- |
| `/metrics` | Prometheus metrics in text format |
| `/health`  | Health check endpoint             |

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

Default Node.js/Bun metrics (CPU, memory, event loop) are also collected.

## 📝 Loki Integration

Yuzu supports sending logs to Grafana Loki for centralized log aggregation. When enabled, logs are sent to both stdout and Loki simultaneously.

### Configuration

Set the following environment variables to enable Loki:

```env
LOKI_ENABLED=true
LOKI_HOST=http://localhost:3100
LOKI_LABELS=app=yuzu,env=production
```

For authenticated Loki instances:

```env
LOKI_BASIC_AUTH_USER=your-username
LOKI_BASIC_AUTH_PASSWORD=your-password
```

### Grafana Dashboard

With Prometheus metrics and Loki logs, you can create dashboards that correlate metrics with log events. Use the following LogQL query to filter logs:

```logql
{app="yuzu"} |= "error"
```

Example Prometheus alert rule that links to logs:

```yaml
groups:
  - name: yuzu-alerts
    rules:
      - alert: HighErrorRate
        expr: rate(yuzu_log_errors_total[5m]) > 0.1
        labels:
          severity: warning
        annotations:
          summary: "High error rate in Yuzu"
          dashboard: "http://grafana/explore?expr={app=\"yuzu\"} |= \"error\""
```

## 🔧 Queue Workers

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
