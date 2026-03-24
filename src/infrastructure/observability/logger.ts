import type { AnyValue, AnyValueMap } from "@opentelemetry/api-logs";

import type { AppLogger } from "@yuzu/application/common/logger";
import {
	logErrorsTotal,
	logEventsTotal,
} from "@yuzu/infrastructure/observability/metrics";
import {
	otelLogger,
	otelSeverityNumbers,
} from "@yuzu/infrastructure/observability/otel";

type LogLevel = keyof typeof otelSeverityNumbers;

class OpenTelemetryLogger implements AppLogger {
	constructor(private readonly bindings: Record<string, unknown> = {}) {}

	child(bindings: Record<string, unknown>): AppLogger {
		return new OpenTelemetryLogger({
			...this.bindings,
			...bindings,
		});
	}

	trace(obj: unknown, msg?: string): void;
	trace(msg: string): void;
	trace(objOrMsg: unknown, msg?: string) {
		this.emit("trace", objOrMsg, msg);
	}

	debug(obj: unknown, msg?: string): void;
	debug(msg: string): void;
	debug(objOrMsg: unknown, msg?: string) {
		this.emit("debug", objOrMsg, msg);
	}

	info(obj: unknown, msg?: string): void;
	info(msg: string): void;
	info(objOrMsg: unknown, msg?: string) {
		this.emit("info", objOrMsg, msg);
	}

	warn(obj: unknown, msg?: string): void;
	warn(msg: string): void;
	warn(objOrMsg: unknown, msg?: string) {
		this.emit("warn", objOrMsg, msg);
	}

	error(obj: unknown, msg?: string): void;
	error(msg: string): void;
	error(objOrMsg: unknown, msg?: string) {
		this.emit("error", objOrMsg, msg);
	}

	private emit(level: LogLevel, objOrMsg: unknown, msg?: string) {
		const isMessageOnly = typeof objOrMsg === "string";
		const body = isMessageOnly ? objOrMsg : msg || "structured log";
		const attributes = {
			...normalizeAttributes(this.bindings),
			...normalizeAttributes(isMessageOnly ? undefined : objOrMsg),
			"log.level": level,
		};
		const exception = extractException(isMessageOnly ? undefined : objOrMsg);

		logEventsTotal.inc({
			level,
			service:
				typeof this.bindings.service === "string"
					? this.bindings.service
					: "app",
		});

		if (level === "error") {
			logErrorsTotal.inc({
				service:
					typeof this.bindings.service === "string"
						? this.bindings.service
						: "app",
				error_type: exception instanceof Error ? exception.name : "unknown",
			});
		}

		otelLogger.emit({
			severityNumber: otelSeverityNumbers[level],
			severityText: level.toUpperCase(),
			body,
			attributes,
			exception,
		});
	}
}

export const logger = new OpenTelemetryLogger();

export function createLogger(context: Record<string, unknown>) {
	return logger.child(context);
}

function extractException(value: unknown) {
	if (value instanceof Error) {
		return value;
	}

	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		if (record.err instanceof Error) {
			return record.err;
		}
		if (record.error instanceof Error) {
			return record.error;
		}
	}

	return undefined;
}

function normalizeAttributes(value: unknown): AnyValueMap {
	if (!value || typeof value !== "object") {
		return {};
	}

	return Object.entries(value as Record<string, unknown>).reduce<AnyValueMap>(
		(acc, [key, entry]) => {
			const normalized = normalizeValue(entry, new WeakSet());
			if (normalized !== undefined) {
				acc[key] = normalized;
			}
			return acc;
		},
		{},
	);
}

function normalizeValue(
	value: unknown,
	seen: WeakSet<object>,
): AnyValue | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}

	if (value instanceof Error) {
		return {
			name: value.name,
			message: value.message,
			stack: value.stack ?? "",
		};
	}

	if (Array.isArray(value)) {
		return value
			.map((item) => normalizeValue(item, seen))
			.filter((item): item is AnyValue => item !== undefined);
	}

	if (typeof value === "object") {
		if (seen.has(value)) {
			return "[Circular]";
		}

		seen.add(value);

		return Object.entries(value as Record<string, unknown>).reduce<
			Record<string, AnyValue>
		>((acc, [key, entry]) => {
			const normalized = normalizeValue(entry, seen);
			if (normalized !== undefined) {
				acc[key] = normalized;
			}
			return acc;
		}, {});
	}

	return String(value);
}
