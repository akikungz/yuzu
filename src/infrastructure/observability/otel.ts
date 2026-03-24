import { Metadata } from "@grpc/grpc-js";
import { metrics } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter as OTLPGrpcLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter as OTLPGrpcMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BatchLogRecordProcessor,
	LoggerProvider,
} from "@opentelemetry/sdk-logs";
import {
	MeterProvider,
	PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";

import { env } from "@yuzu/infrastructure/config/env";

const resource = resourceFromAttributes({
	"service.name": env.OTEL_SERVICE_NAME,
	"deployment.environment.name": env.NODE_ENV,
});

const loggerProvider = new LoggerProvider({
	resource,
	processors: [new BatchLogRecordProcessor(createLogExporter())],
});

const meterProvider = new MeterProvider({
	resource,
	readers: [
		new PeriodicExportingMetricReader({
			exporter: createMetricExporter(),
			exportIntervalMillis: env.OTEL_METRIC_EXPORT_INTERVAL_MILLIS,
			exportTimeoutMillis: env.OTEL_EXPORT_TIMEOUT_MILLIS,
		}),
	],
});

metrics.setGlobalMeterProvider(meterProvider);

export const otelLogger = loggerProvider.getLogger(env.OTEL_SERVICE_NAME);
export const otelMeter = meterProvider.getMeter(env.OTEL_SERVICE_NAME);

export const otelSeverityNumbers = {
	trace: SeverityNumber.TRACE,
	debug: SeverityNumber.DEBUG,
	info: SeverityNumber.INFO,
	warn: SeverityNumber.WARN,
	error: SeverityNumber.ERROR,
} as const;

export async function shutdownObservability() {
	await Promise.allSettled([
		loggerProvider.forceFlush(),
		meterProvider.forceFlush(),
	]);

	await Promise.allSettled([
		loggerProvider.shutdown(),
		meterProvider.shutdown(),
	]);
}

function resolveOtlpEndpoint(signal: "logs" | "metrics") {
	const protocol = getSignalProtocol(signal);
	const specific =
		signal === "logs"
			? env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
			: env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;

	if (specific) {
		return specific;
	}

	const base = env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, "");
	if (protocol === "grpc") {
		return base;
	}

	return `${base}/v1/${signal}`;
}

function getSignalProtocol(signal: "logs" | "metrics") {
	const specific =
		signal === "logs"
			? env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL
			: env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL;

	const protocol = specific ?? env.OTEL_EXPORTER_OTLP_PROTOCOL;
	return protocol === "http" ? "http/protobuf" : protocol;
}

function createLogExporter() {
	const protocol = getSignalProtocol("logs");
	const url = resolveOtlpEndpoint("logs");

	if (protocol === "grpc") {
		return new OTLPGrpcLogExporter({
			url,
			metadata: createMetadata("logs"),
		});
	}

	return new OTLPLogExporter({
		url,
		headers: createAuthHeaders("logs"),
	});
}

function createMetricExporter() {
	const protocol = getSignalProtocol("metrics");
	const url = resolveOtlpEndpoint("metrics");

	if (protocol === "grpc") {
		return new OTLPGrpcMetricExporter({
			url,
			metadata: createMetadata("metrics"),
		});
	}

	return new OTLPMetricExporter({
		url,
		headers: createAuthHeaders("metrics"),
	});
}

function createAuthHeaders(signal: "logs" | "metrics"): Record<string, string> {
	const credentials = resolveCredentials(signal);
	if (!credentials) {
		return {};
	}

	return {
		authorization: `Basic ${Buffer.from(
			`${credentials.username}:${credentials.password}`,
		).toString("base64")}`,
	};
}

function createMetadata(signal: "logs" | "metrics") {
	const metadata = new Metadata();
	const headers = createAuthHeaders(signal);

	for (const [key, value] of Object.entries(headers)) {
		metadata.set(key, value);
	}

	return metadata;
}

function resolveCredentials(signal: "logs" | "metrics") {
	const username =
		signal === "logs"
			? env.OTEL_EXPORTER_OTLP_LOGS_USERNAME ?? env.OTEL_EXPORTER_OTLP_USERNAME
			: env.OTEL_EXPORTER_OTLP_METRICS_USERNAME ?? env.OTEL_EXPORTER_OTLP_USERNAME;

	const password =
		signal === "logs"
			? env.OTEL_EXPORTER_OTLP_LOGS_PASSWORD ?? env.OTEL_EXPORTER_OTLP_PASSWORD
			: env.OTEL_EXPORTER_OTLP_METRICS_PASSWORD ?? env.OTEL_EXPORTER_OTLP_PASSWORD;

	if (!username || !password) {
		return undefined;
	}

	return { username, password };
}
