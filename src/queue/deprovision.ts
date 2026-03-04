import { Redis } from "ioredis";
import { Worker } from "bullmq";
import type { Logger } from "pino";

import { type PrismaClient } from "@yuzu/database";
import { env } from "@yuzu/env";
import { logger as rootLogger } from "@yuzu/logger";
import {
  activeJobsGauge,
  jobDurationSeconds,
  jobProcessedTotal,
  pveApiCallDurationSeconds,
  pveApiCallsTotal
} from "@yuzu/metrics";
import { upidStatusCheck } from "@yuzu/pve/shared";
import * as qemu from "@yuzu/pve/qemu";

interface DeprovisionStepResult {
  step: string;
  duration: number;
  success: boolean;
  details?: Record<string, unknown>;
}

export class DeprovisionQueueWorker {
  private worker: Worker;
  private logger = rootLogger.child({ service: "deprovision-worker" });
  private readonly queueName = `${env.NODE_ENV}_deprovision-instance`;

  constructor(private redisConnection: Redis, private prisma: PrismaClient) {
    this.worker = new Worker(
      this.queueName,
      async (job) => {
        const jobLogger = this.logger.child({
          jobId: job.id,
          jobName: job.name,
          attempt: job.attemptsMade + 1,
          maxAttempts: job.opts.attempts
        });

        jobLogger.info({ data: job.data }, "Processing deprovision job");

        if (job.name === "deprovision") {
          const startTime = performance.now();
          try {
            const result = await this.instanceDeprovisionJob(
              job.data.instanceId,
              job.data.userId,
              jobLogger
            );

            const totalDuration = performance.now() - startTime;
            const durationSeconds = totalDuration / 1000;
            jobProcessedTotal.inc({ queue: this.queueName, status: "success" });
            jobDurationSeconds.observe({ queue: this.queueName, status: "success" }, durationSeconds);
            jobLogger.info({
              duration: `${totalDuration.toFixed(2)}ms`,
              steps: result.steps
            }, "Deprovision job completed successfully");

            return {
              instanceId: job.data.instanceId,
              status: "success",
              message: "Instance deprovisioned successfully",
              duration: totalDuration,
              steps: result.steps,
            };
          } catch (err) {
            const totalDuration = performance.now() - startTime;
            const durationSeconds = totalDuration / 1000;
            const willRetry = job.attemptsMade < (job.opts.attempts || 0) - 1;
            const statusLabel = willRetry ? "retry" : "failed";
            jobProcessedTotal.inc({ queue: this.queueName, status: statusLabel });
            jobDurationSeconds.observe({ queue: this.queueName, status: statusLabel }, durationSeconds);
            const error = err as Error;

            jobLogger.error({
              err: { message: error.message, stack: error.stack },
              duration: `${totalDuration.toFixed(2)}ms`,
              willRetry
            }, "Deprovision job failed");

            if (job.attemptsMade < job.opts.attempts! - 1) {
              throw err; // Re-throw to trigger a retry
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
              status: "failed",
              message: error.message,
              duration: totalDuration,
            };
          }
        }

        throw new Error(`Unknown job type: ${job.name}`);
      },
      {
        connection: this.redisConnection.options,
        concurrency: 5,
        lockDuration: 180000, // 3 minutes for deprovision operations
        stalledInterval: 5000,
        maxStalledCount: 2,
      }
    );

    this.worker.on("active", (job) => {
      activeJobsGauge.inc({ queue: this.queueName });
      this.logger.info({ jobId: job.id, instanceId: job.data?.instanceId }, "Job activated");
    });

    this.worker.on("completed", (job, result) => {
      activeJobsGauge.dec({ queue: this.queueName });
      this.logger.info({
        jobId: job.id,
        instanceId: job.data?.instanceId,
        duration: result?.duration
      }, "Job completed");
    });

    this.worker.on("failed", (job, err) => {
      activeJobsGauge.dec({ queue: this.queueName });
      this.logger.error({
        jobId: job?.id,
        instanceId: job?.data?.instanceId,
        err: { message: err.message, stack: err.stack },
        attempt: job?.attemptsMade
      }, "Job failed");
    });

    this.worker.on("ready", () => {
      this.logger.info("Deprovision queue worker ready");
    });

    this.worker.on("error", (err) => {
      this.logger.error({ err: { message: err.message, stack: err.stack } }, "Worker error");
    });
  }

  /**
   * Execute a deprovision step with timing and logging
   */
  private async executeStep<T>(
    stepName: string,
    log: Logger,
    operation: () => Promise<T>
  ): Promise<{ result: T; duration: number }> {
    const startTime = performance.now();
    log.debug({ step: stepName }, `Starting: ${stepName}`);

    try {
      const result = await operation();
      const duration = performance.now() - startTime;
      log.info({ step: stepName, duration: `${duration.toFixed(2)}ms` }, `Completed: ${stepName}`);
      return { result, duration };
    } catch (err) {
      const duration = performance.now() - startTime;
      const error = err as Error;
      log.error({
        step: stepName,
        duration: `${duration.toFixed(2)}ms`,
        err: { message: error.message, stack: error.stack }
      }, `Failed: ${stepName}`);
      throw err;
    }
  }

  private async recordPveCall<T>(
    endpoint: string,
    method: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const startTime = performance.now();

    try {
      const result = await operation();
      const durationSeconds = (performance.now() - startTime) / 1000;
      pveApiCallsTotal.inc({ endpoint, method, status: "success" });
      pveApiCallDurationSeconds.observe({ endpoint, method }, durationSeconds);
      return result;
    } catch (err) {
      const durationSeconds = (performance.now() - startTime) / 1000;
      pveApiCallsTotal.inc({ endpoint, method, status: "error" });
      pveApiCallDurationSeconds.observe({ endpoint, method }, durationSeconds);
      throw err;
    }
  }

  public async instanceDeprovisionJob(instanceId: number, userId: number, parentLogger?: Logger) {
    const steps: DeprovisionStepResult[] = [];
    const log = (parentLogger || this.logger).child({
      instanceId,
      userId,
      operation: "deprovision"
    });

    log.info("Starting instance deprovision");

    // Step 1: Fetch instance with PVEVM and network info
    const { result: instance, duration: fetchDuration } = await this.executeStep(
      "fetch-instance",
      log,
      async () => {
        const inst = await this.prisma.instance.findUnique({
          where: { id: instanceId },
          include: {
            pveVM: {
              include: {
                pveNode: true,
                pveNetworkIP: true,
              },
            },
          },
        });
        if (!inst) throw new Error(`Instance ${instanceId} not found`);
        return inst;
      }
    );
    steps.push({ step: "fetch-instance", duration: fetchDuration, success: true });

    // Validate that instance has a PVEVM assigned
    if (!instance.pveVM) {
      log.warn("Instance has no PVEVM assigned, marking as deprovisioned");

      const { duration: updateDuration } = await this.executeStep(
        "update-status-no-vm",
        log,
        () =>
          this.prisma.instance.update({
            where: { id: instanceId },
            data: {
              status: "DELETED",
            },
          })
      );
      steps.push({ step: "update-status-no-vm", duration: updateDuration, success: true });

      return { steps };
    }

    const pveVm = instance.pveVM;
    const vmLog = log.child({
      vmid: pveVm.vmId,
      node: pveVm.pveNode.name,
      hostname: pveVm.hostname,
      ipAddress: pveVm.pveNetworkIP?.ipAddress
    });

    vmLog.info("Found PVEVM, starting deprovision process");

    // Step 2: Update instance status to indicate deprovisioning
    const { duration: statusUpdateDuration } = await this.executeStep(
      "update-status-deprovisioning",
      vmLog,
      () =>
        this.prisma.instance.update({
          where: { id: instanceId },
          data: { provisionStatus: "PROVISIONING", status: "PENDING" }, // Reuse PROVISIONING for deprovisioning state
        })
    );
    steps.push({
      step: "update-status-deprovisioning",
      duration: statusUpdateDuration,
      success: true,
    });

    // Step 3: Stop VM if running
    const { result: currentStatus, duration: statusCheckDuration } =
      await this.executeStep("check-vm-status", vmLog, () =>
        this.recordPveCall("/api2/json/nodes/{node}/qemu/{vmid}/status/current", "GET", () =>
          qemu.getQemuStatus(pveVm.pveNode.name, pveVm.vmId)
        )
      );
    steps.push({
      step: "check-vm-status",
      duration: statusCheckDuration,
      success: true,
      details: { status: currentStatus },
    });

    if (currentStatus === "running") {
      vmLog.info("VM is running, stopping before deletion");

      const { result: stopUpid, duration: stopDuration } = await this.executeStep(
        "stop-vm",
        vmLog,
        () => this.recordPveCall(`/api2/json/nodes/{node}/qemu/{vmid}/status/stop`, "POST", () =>
          qemu.setQemuStatus(pveVm.pveNode.name, pveVm.vmId, "stop")
        )
      );

      const { duration: stopWaitDuration } = await this.executeStep(
        "wait-vm-stop",
        vmLog,
        () => this.recordPveCall("/api2/json/nodes/{node}/tasks/{upid}/status", "GET", () =>
          upidStatusCheck(pveVm.pveNode.name, stopUpid)
        )
      );
      steps.push({
        step: "stop-vm",
        duration: stopDuration + stopWaitDuration,
        success: true,
        details: { upid: stopUpid },
      });
    } else {
      vmLog.debug({ currentStatus }, "VM is not running, skipping stop");
    }

    // Step 4: Delete VM from Proxmox
    const { duration: deleteDuration } = await this.executeStep(
      "delete-vm-proxmox",
      vmLog,
      () => this.recordPveCall("/api2/json/nodes/{node}/qemu/{vmid}", "DELETE", () =>
        qemu.deleteQemu(pveVm.pveNode.name, pveVm.vmId)
      )
    );
    steps.push({
      step: "delete-vm-proxmox",
      duration: deleteDuration,
      success: true,
    });

    // Step 5: Cleanup database records in a transaction
    const { duration: dbCleanupDuration } = await this.executeStep(
      "cleanup-database-records",
      vmLog,
      async () => {
        await this.prisma.$transaction(async (tx) => {
          // Disconnect PVEVM from instance first
          await tx.instance.update({
            where: { id: instanceId },
            data: {
              pveVMId: null,
              status: "DELETED",
            },
          });

          // Deallocate IP if assigned
          if (pveVm.pveNetworkIPId) {
            await tx.pVENetworkIP.update({
              where: { id: pveVm.pveNetworkIPId },
              data: { isAllocated: false },
            });
            vmLog.debug(
              { ipId: pveVm.pveNetworkIPId },
              "Deallocated IP address"
            );
          }

          // Delete PVEVM record
          await tx.pVEVM.delete({
            where: { id: pveVm.id },
          });
        });
      }
    );
    steps.push({
      step: "cleanup-database-records",
      duration: dbCleanupDuration,
      success: true,
      details: {
        ipDeallocated: !!pveVm.pveNetworkIPId,
        pveVmDeleted: true,
      },
    });

    // Step 6: Invalidate cache
    const { duration: cacheDuration } = await this.executeStep(
      "invalidate-cache",
      vmLog,
      async () => {
        await Promise.all([
          this.redisConnection.del(`user:${userId}:instances:*`),
          this.redisConnection.del(`instance:${instanceId}`),
        ]);
      }
    );
    steps.push({ step: "invalidate-cache", duration: cacheDuration, success: true });

    vmLog.info({
      totalSteps: steps.length,
      vmid: pveVm.vmId,
      node: pveVm.pveNode.name
    }, "Instance deprovisioned successfully");

    return { steps };
  }

  public close() {
    return this.worker.close();
  }
}
