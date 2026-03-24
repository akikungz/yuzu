import z from "zod";

export const envSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	PVE_API_TOKEN_ID: z.string().min(1),
	PVE_API_TOKEN_SECRET: z.string().min(1),
	PVE_API_URL: z.url(),
	DATABASE_URL: z.string().min(1),
	REDIS_URL: z.string().min(1),
	OTEL_SERVICE_NAME: z.string().min(1).default("yuzu"),
	OTEL_EXPORTER_OTLP_ENDPOINT: z.url().default("http://localhost:4318"),
	OTEL_EXPORTER_OTLP_PROTOCOL: z.enum(["http", "grpc"]).default("http"),
	OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: z.url().optional(),
	OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: z.enum(["http", "grpc"]).optional(),
	OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: z.url().optional(),
	OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: z.enum(["http", "grpc"]).optional(),
	OTEL_EXPORTER_OTLP_USERNAME: z.string().optional(),
	OTEL_EXPORTER_OTLP_PASSWORD: z.string().optional(),
	OTEL_EXPORTER_OTLP_LOGS_USERNAME: z.string().optional(),
	OTEL_EXPORTER_OTLP_LOGS_PASSWORD: z.string().optional(),
	OTEL_EXPORTER_OTLP_METRICS_USERNAME: z.string().optional(),
	OTEL_EXPORTER_OTLP_METRICS_PASSWORD: z.string().optional(),
	OTEL_METRIC_EXPORT_INTERVAL_MILLIS: z.coerce.number().default(30000),
	OTEL_EXPORT_TIMEOUT_MILLIS: z.coerce.number().default(10000),
});

const _safeEnv = envSchema.safeParse(process.env);
if (!_safeEnv.success) {
	console.error(
		"❌ Invalid environment variables:",
		z.formatError(_safeEnv.error),
	);
	throw new Error("Invalid environment variables");
}

export const env = _safeEnv.data;
export type Env = typeof env;
