# Observability (Metrics, Logs, Traces, Grafana)

This guide explains how to analyze **metrics**, **logs**, and **traces** from Yuzu and how to build **Grafana dashboards**. It also includes a **Grafana provisioning guide** for data sources and dashboards.

> ✅ Yuzu already exposes Prometheus metrics and can ship logs to Loki.  
> ⚠️ Tracing (Jaeger) is **not built-in** yet—see the tracing section for how to add OpenTelemetry if you need it.

## Metrics (Prometheus)

Yuzu exposes Prometheus metrics at:

- `http://<yuzu-host>:<METRICS_PORT>/metrics`
- Default port is `9090` via `METRICS_PORT`

### Key metrics to analyze

| Metric                                                | Type      | What it tells you                      |
| ----------------------------------------------------- | --------- | -------------------------------------- |
| `yuzu_jobs_processed_total{queue,status}`             | Counter   | Job throughput and success/error rates |
| `yuzu_job_duration_seconds{queue,status}`             | Histogram | Job duration (p50/p95/p99)             |
| `yuzu_active_jobs{queue}`                             | Gauge     | Current active jobs                    |
| `yuzu_waiting_jobs{queue}`                            | Gauge     | Queue backlog                          |
| `yuzu_provision_step_duration_seconds{step,status}`   | Histogram | Slow provisioning steps                |
| `yuzu_pve_api_calls_total{endpoint,method,status}`    | Counter   | PVE API call volumes and failures      |
| `yuzu_pve_api_call_duration_seconds{endpoint,method}` | Histogram | PVE API latency                        |
| `yuzu_log_events_total{level,service}`                | Counter   | Log volume by level                    |
| `yuzu_log_errors_total{service,error_type}`           | Counter   | Error rates                            |

### Example PromQL queries

```promql
sum(rate(yuzu_jobs_processed_total[5m])) by (queue, status)
```

```promql
histogram_quantile(0.95, sum(rate(yuzu_job_duration_seconds_bucket[5m])) by (le, queue))
```

```promql
sum(yuzu_active_jobs) by (queue)
```

```promql
sum(rate(yuzu_pve_api_calls_total{status=~"5.."}[5m])) by (endpoint)
```

## Logs (Loki)

Yuzu can ship logs to Loki via `pino-loki`.

### Required environment variables

```env
LOKI_ENABLED=true
LOKI_HOST=http://<loki-host>:3100
LOKI_LABELS=app=yuzu,env=production
# Optional auth:
# LOKI_BASIC_AUTH_USER=your-username
# LOKI_BASIC_AUTH_PASSWORD=your-password
```

### Example LogQL queries

```logql
{app="yuzu"}
```

```logql
{app="yuzu"} |= "error"
```

```logql
{app="yuzu"} | json | level="error"
```

## Traces (Jaeger)

Yuzu **does not emit traces by default**. If you need distributed tracing, add OpenTelemetry instrumentation and export to Jaeger. A minimal approach typically includes:

- OpenTelemetry SDK for Node/Bun
- OTLP or Jaeger exporter
- Manual spans around provisioning steps and PVE API calls

### Suggested trace attributes

Use consistent attributes so Grafana can correlate traces with metrics and logs:

- `service.name = "yuzu"`
- `queue.name`
- `job.id`
- `instance.id`
- `pve.node`, `pve.vmid`

### Grafana Jaeger data source

Once Jaeger is running, add a Grafana data source pointing to:

- **HTTP**: `http://<jaeger-query-host>:16686`

In Grafana, you can then link dashboards to traces using **Explore → Traces**.

## Grafana dashboard: recommended panels

Use these panels to build a dashboard that correlates queue health, PVE latency, and error rates:

### Queue health

- **Jobs processed (rate)**
  - PromQL: `sum(rate(yuzu_jobs_processed_total[5m])) by (queue, status)`
- **Active jobs**
  - PromQL: `sum(yuzu_active_jobs) by (queue)`
- **Waiting jobs**
  - PromQL: `sum(yuzu_waiting_jobs) by (queue)`

### Job latency

- **p95 job duration**
  - PromQL: `histogram_quantile(0.95, sum(rate(yuzu_job_duration_seconds_bucket[5m])) by (le, queue))`
- **p99 provision step duration (slow steps)**
  - PromQL: `histogram_quantile(0.99, sum(rate(yuzu_provision_step_duration_seconds_bucket[5m])) by (le, step))`

### PVE API performance

- **API error rate**
  - PromQL: `sum(rate(yuzu_pve_api_calls_total{status=~"5.."}[5m])) by (endpoint)`
- **API latency (p95)**
  - PromQL: `histogram_quantile(0.95, sum(rate(yuzu_pve_api_call_duration_seconds_bucket[5m])) by (le, endpoint))`

### Logs and error correlation

- **Error log rate (panel)**
  - PromQL: `sum(rate(yuzu_log_errors_total[5m])) by (service)`
- **Log panel (Loki)**
  - LogQL: `{app="yuzu"} |= "error"`

## Grafana provisioning guide (data sources + dashboards)

Grafana can load data sources and dashboards automatically using provisioning files.

### Directory layout

```
<grafana-root>/
  conf/
  provisioning/
    datasources/
      yuzu-datasources.yaml
    dashboards/
      yuzu-dashboards.yaml
  dashboards/
    yuzu-overview.json
```

### Data source provisioning (example)

Create `provisioning/datasources/yuzu-datasources.yaml`:

```yaml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://<prometheus-host>:9090
    isDefault: true

  - name: Loki
    type: loki
    access: proxy
    url: http://<loki-host>:3100

  - name: Jaeger
    type: jaeger
    access: proxy
    url: http://<jaeger-query-host>:16686
```

### Dashboard provisioning (example)

Create `provisioning/dashboards/yuzu-dashboards.yaml`:

```yaml
apiVersion: 1

providers:
  - name: yuzu
    orgId: 1
    folder: Yuzu
    type: file
    disableDeletion: false
    editable: true
    options:
      path: /etc/grafana/dashboards
```

### Dashboard JSON

Create `dashboards/yuzu-overview.json` and add your panels using the queries in this document. Once Grafana restarts, the dashboard will load automatically.

## Tips for correlation

- Use **shared labels** (`app=yuzu`, `env=...`) across metrics and logs.
- In Grafana panels, add **links** to Explore using a LogQL filter like `{app="yuzu"}`.
- If you add tracing, set `service.name = "yuzu"` so traces are easy to find.
