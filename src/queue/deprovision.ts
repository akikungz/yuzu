import type { AppLogger } from "@yuzu/application/common/logger";
import { DeprovisionInstanceUseCase } from "@yuzu/application/use-cases/deprovision-instance";
import { RedisPlatformCache } from "@yuzu/infrastructure/cache/redis-platform-cache";
import { env } from "@yuzu/infrastructure/config/env";
import { logger as rootLogger } from "@yuzu/infrastructure/observability/logger";
import {
	activeJobsGauge,
	jobDurationSeconds,
	jobProcessedTotal,
} from "@yuzu/infrastructure/observability/metrics";
import type { PrismaClient } from "@yuzu/infrastructure/persistence/database";
import { PrismaInstanceRepository } from "@yuzu/infrastructure/persistence/prisma-instance-repository";
import { DefaultProxmoxGateway } from "@yuzu/infrastructure/proxmox/proxmox-gateway";
import { Worker } from "bullmq";
import type { Redis } from "ioredis";

export class DeprovisionQueueWorker {
	private readonly logger = rootLogger.child({ service: "deprovision-worker" });
	private readonly queueName = `${env.NODE_ENV}_deprovision-instance`;
	private readonly useCase: DeprovisionInstanceUseCase;
	private readonly worker: Worker;

	constructor(
		private readonly redisConnection: Redis,
		private readonly prisma: PrismaClient,
	) {
		this.useCase = new DeprovisionInstanceUseCase(
			new PrismaInstanceRepository(this.prisma),
			new DefaultProxmoxGateway(),
			new RedisPlatformCache(this.redisConnection),
		);

		this.worker = new Worker(
			this.queueName,
			async (job) => {
				const jobLogger = this.logger.child({
					jobId: job.id,
					jobName: job.name,
					attempt: job.attemptsMade + 1,
					maxAttempts: job.opts.attempts,
				});

				jobLogger.info({ data: job.data }, "Processing deprovision job");

				if (job.name !== "deprovision") {
					throw new Error(`Unknown job type: ${job.name}`);
				}

				const startTime = performance.now();

				try {
					const result = await this.instanceDeprovisionJob(
						job.data.instanceId,
						job.data.userId,
						jobLogger,
					);

					const totalDuration = performance.now() - startTime;
					const durationSeconds = totalDuration / 1000;
					jobProcessedTotal.inc({ queue: this.queueName, status: "success" });
					jobDurationSeconds.observe(
						{ queue: this.queueName, status: "success" },
						durationSeconds,
					);
					jobLogger.info(
						{
							duration: `${totalDuration.toFixed(2)}ms`,
							steps: result.steps,
						},
						"Deprovision job completed successfully",
					);

					return {
						instanceId: job.data.instanceId,
						status: "success" as const,
						message: "Instance deprovisioned successfully",
						duration: totalDuration,
						steps: result.steps,
					};
				} catch (err) {
					const totalDuration = performance.now() - startTime;
					const durationSeconds = totalDuration / 1000;
					const willRetry = job.attemptsMade < (job.opts.attempts || 0) - 1;
					const statusLabel = willRetry ? "retry" : "failed";
					const error = err as Error;

					jobProcessedTotal.inc({ queue: this.queueName, status: statusLabel });
					jobDurationSeconds.observe(
						{ queue: this.queueName, status: statusLabel },
						durationSeconds,
					);
					jobLogger.error(
						{
							err: { message: error.message, stack: error.stack },
							duration: `${totalDuration.toFixed(2)}ms`,
							willRetry,
						},
						"Deprovision job failed",
					);

					if (willRetry) {
						throw err;
					}

					await this.prisma.instance.update({
						where: { id: job.data.instanceId },
						data: {
							provisionStatus: "FAILED",
							provisionError: `Deprovision failed: ${error.message}`,
						},
					});

					return {
						instanceId: job.data.instanceId,
						status: "failed" as const,
						message: error.message,
						duration: totalDuration,
					};
				}
			},
			{
				connection: this.redisConnection.options,
				concurrency: 5,
				lockDuration: 180000,
				stalledInterval: 5000,
				maxStalledCount: 2,
			},
		);

		this.worker.on("active", (job) => {
			activeJobsGauge.inc({ queue: this.queueName });
			this.logger.info(
				{ jobId: job.id, instanceId: job.data?.instanceId },
				"Job activated",
			);
		});

		this.worker.on("completed", (job, result) => {
			activeJobsGauge.dec({ queue: this.queueName });
			this.logger.info(
				{
					jobId: job.id,
					instanceId: job.data?.instanceId,
					duration: result?.duration,
				},
				"Job completed",
			);
		});

		this.worker.on("failed", (job, err) => {
			activeJobsGauge.dec({ queue: this.queueName });
			this.logger.error(
				{
					jobId: job?.id,
					instanceId: job?.data?.instanceId,
					err: { message: err.message, stack: err.stack },
					attempt: job?.attemptsMade,
				},
				"Job failed",
			);
		});

		this.worker.on("ready", () => {
			this.logger.info("Deprovision queue worker ready");
		});

		this.worker.on("error", (err) => {
			this.logger.error(
				{ err: { message: err.message, stack: err.stack } },
				"Worker error",
			);
		});
	}

	public async instanceDeprovisionJob(
		instanceId: number,
		userId: number,
		parentLogger?: AppLogger,
	) {
		return this.useCase.execute(
			instanceId,
			userId,
			parentLogger || this.logger,
		);
	}

	public close() {
		return this.worker.close();
	}
}
