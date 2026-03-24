import { otelMeter } from "@yuzu/infrastructure/observability/otel";

type MetricAttributes = Record<string, string | number | boolean | undefined>;

export const logEventsTotal = createCounter(
	"yuzu_log_events_total",
	"Total number of log events",
);
export const logErrorsTotal = createCounter(
	"yuzu_log_errors_total",
	"Total number of error log events",
);
export const jobProcessedTotal = createCounter(
	"yuzu_jobs_processed_total",
	"Total number of jobs processed",
);
export const jobDurationSeconds = createHistogram(
	"yuzu_job_duration_seconds",
	"Duration of job processing in seconds",
);
export const activeJobsGauge = createUpDownCounter(
	"yuzu_active_jobs",
	"Number of currently active jobs",
);
export const waitingJobsGauge = createUpDownCounter(
	"yuzu_waiting_jobs",
	"Number of jobs waiting in queue",
);
export const provisionStepDurationSeconds = createHistogram(
	"yuzu_provision_step_duration_seconds",
	"Duration of each provision step in seconds",
);
export const instancesTotal = createCounter(
	"yuzu_instances_total",
	"Total number of instances created",
);
export const vmOperationsTotal = createCounter(
	"yuzu_vm_operations_total",
	"Total number of VM operations",
);
export const pveApiCallsTotal = createCounter(
	"yuzu_pve_api_calls_total",
	"Total number of PVE API calls",
);
export const pveApiCallDurationSeconds = createHistogram(
	"yuzu_pve_api_call_duration_seconds",
	"Duration of PVE API calls in seconds",
);

function createCounter(name: string, description: string) {
	const instrument = otelMeter.createCounter(name, {
		description,
	});

	return {
		inc(attributes?: MetricAttributes, value = 1) {
			instrument.add(value, sanitizeAttributes(attributes));
		},
	};
}

function createUpDownCounter(name: string, description: string) {
	const instrument = otelMeter.createUpDownCounter(name, {
		description,
	});

	return {
		inc(attributes?: MetricAttributes, value = 1) {
			instrument.add(value, sanitizeAttributes(attributes));
		},
		dec(attributes?: MetricAttributes, value = 1) {
			instrument.add(-value, sanitizeAttributes(attributes));
		},
	};
}

function createHistogram(name: string, description: string) {
	const instrument = otelMeter.createHistogram(name, {
		description,
		unit: "s",
	});

	return {
		observe(attributes: MetricAttributes | undefined, value: number) {
			instrument.record(value, sanitizeAttributes(attributes));
		},
	};
}

function sanitizeAttributes(attributes?: MetricAttributes) {
	if (!attributes) {
		return {};
	}

	return Object.fromEntries(
		Object.entries(attributes).filter(
			(entry): entry is [string, string | number | boolean] => {
				return entry[1] !== undefined;
			},
		),
	);
}
