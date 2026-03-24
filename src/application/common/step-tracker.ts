import type { AppLogger } from "./logger";

export interface JobStepResult {
	step: string;
	duration: number;
	success: boolean;
	details?: Record<string, unknown>;
}

export class StepTracker {
	public readonly steps: JobStepResult[] = [];

	constructor(private readonly logger: AppLogger) {}

	async executeStep<T>(
		stepName: string,
		operation: () => Promise<T>,
		details?: (result: T) => Record<string, unknown> | undefined,
	): Promise<T> {
		const startTime = performance.now();
		this.logger.debug({ step: stepName }, `Starting: ${stepName}`);

		try {
			const result = await operation();
			const duration = performance.now() - startTime;
			this.logger.info(
				{ step: stepName, duration: `${duration.toFixed(2)}ms` },
				`Completed: ${stepName}`,
			);
			this.steps.push({
				step: stepName,
				duration,
				success: true,
				details: details?.(result),
			});
			return result;
		} catch (err) {
			const duration = performance.now() - startTime;
			const error = err as Error;
			this.logger.error(
				{
					step: stepName,
					duration: `${duration.toFixed(2)}ms`,
					err: { message: error.message, stack: error.stack },
				},
				`Failed: ${stepName}`,
			);
			throw err;
		}
	}

	recordFailure(stepName: string, details?: Record<string, unknown>) {
		this.steps.push({
			step: stepName,
			duration: 0,
			success: false,
			details,
		});
	}
}
