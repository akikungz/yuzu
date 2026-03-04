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

interface ToggleStatusStepResult {
  step: string;
  duration: number;
  success: boolean;
  details?: Record<string, unknown>;
}

type ToggleAction = "START" | "STOP" | "RESTART";

export class ToggleStatusQueueWorker {
  private worker: Worker;
  private logger = rootLogger.child({ service: "toggle-status-worker" });
  private readonly queueName = `${env.NODE_ENV}_toggle-instance-status`;

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

        jobLogger.info({ data: job.data }, "Processing toggle status job");

        if (job.name === "toggle-status") {
          const startTime = performance.now();
          try {
            const result = await this.instanceToggleStatusJob(
              job.data.instanceId,
              job.data.userId,
              job.data.status,
              jobLogger
            );

            const totalDuration = performance.now() - startTime;
            const durationSeconds = totalDuration / 1000;
            jobProcessedTotal.inc({ queue: this.queueName, status: "success" });
            jobDurationSeconds.observe({ queue: this.queueName, status: "success" }, durationSeconds);
            jobLogger.info({
              duration: `${totalDuration.toFixed(2)}ms`,
              steps: result.steps
            }, "Toggle status job completed successfully");

            return {
              instanceId: job.data.instanceId,
              status: "success",
              message: `Instance ${job.data.status.toLowerCase()} completed successfully`,
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
            }, "Toggle status job failed");

            if (job.attemptsMade < job.opts.attempts! - 1) {
              throw err; // Re-throw to trigger a retry
            }

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
        concurrency: 10, // Higher concurrency for quick status changes
        lockDuration: 120000, // 2 minutes for status toggle operations
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
      this.logger.info("Toggle status queue worker ready");
    });

    this.worker.on("error", (err) => {
      this.logger.error({ err: { message: err.message, stack: err.stack } }, "Worker error");
    });
  }

  /**
   * Execute a toggle status step with timing and logging
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

  public async instanceToggleStatusJob(
    instanceId: number,
    userId: number,
    action: ToggleAction,
    parentLogger?: Logger
  ) {
    const steps: ToggleStatusStepResult[] = [];
    const log = (parentLogger || this.logger).child({
      instanceId,
      userId,
      action,
      operation: "toggle-status"
    });

    log.info(`Starting instance ${action.toLowerCase()}`);

    // Step 1: Fetch instance with PVEVM info
    const { result: instance, duration: fetchDuration } = await this.executeStep(
      "fetch-instance",
      log,
      async () => {
        const inst = await this.prisma.instance.findUnique({
          where: { id: instanceId },
          include: {
            pveVM: {
              include: {
                pveNode: true
              }
            }
          }
        });
        if (!inst) throw new Error(`Instance ${instanceId} not found`);
        return inst;
      }
    );
    steps.push({ step: "fetch-instance", duration: fetchDuration, success: true });

    // Validate that instance has a PVEVM assigned
    if (!instance.pveVM) {
      throw new Error(`Instance ${instanceId} has no VM assigned`);
    }

    const pveVm = instance.pveVM;
    const vmLog = log.child({
      vmid: pveVm.vmId,
      node: pveVm.pveNode.name,
      hostname: pveVm.hostname
    });

    // Step 2: Get current VM status
    const { result: currentStatus, duration: statusCheckDuration } = await this.executeStep(
      "check-current-status",
      vmLog,
      () => this.recordPveCall("/api2/json/nodes/{node}/qemu/{vmid}/status/current", "GET", () =>
        qemu.getQemuStatus(pveVm.pveNode.name, pveVm.vmId)
      )
    );
    steps.push({
      step: "check-current-status",
      duration: statusCheckDuration,
      success: true,
      details: { currentStatus }
    });

    vmLog.info({ currentStatus, requestedAction: action }, "Current VM status retrieved");

    // Step 3: Execute the action based on current status
    switch (action) {
      case "START":
        await this.handleStart(vmLog, pveVm, currentStatus, steps);
        break;
      case "STOP":
        await this.handleStop(vmLog, pveVm, currentStatus, steps);
        break;
      case "RESTART":
        await this.handleRestart(vmLog, pveVm, currentStatus, steps);
        break;
    }

    // Step 4: Update database status
    const newDbStatus = action === "STOP" ? "INACTIVE" : "ACTIVE";
    const newVmStatus = action === "STOP" ? "STOPPED" : "RUNNING";

    const { duration: dbUpdateDuration } = await this.executeStep(
      "update-database-status",
      vmLog,
      () => this.prisma.$transaction([
        this.prisma.pVEVM.update({
          where: { id: pveVm.id },
          data: { status: newVmStatus }
        }),
        this.prisma.instance.update({
          where: { id: instanceId },
          data: { status: newDbStatus }
        })
      ])
    );
    steps.push({
      step: "update-database-status",
      duration: dbUpdateDuration,
      success: true,
      details: { instanceStatus: newDbStatus, vmStatus: newVmStatus }
    });

    // Step 5: Invalidate cache
    const { duration: cacheDuration } = await this.executeStep(
      "invalidate-cache",
      vmLog,
      async () => {
        await Promise.all([
          this.redisConnection.del(`user:${userId}:instances:*`),
          this.redisConnection.del(`instance:${instanceId}`)
        ]);
      }
    );
    steps.push({ step: "invalidate-cache", duration: cacheDuration, success: true });

    vmLog.info({
      totalSteps: steps.length,
      vmid: pveVm.vmId,
      node: pveVm.pveNode.name,
      action,
      finalStatus: newVmStatus
    }, `Instance ${action.toLowerCase()} completed successfully`);

    return { steps };
  }

  private async handleStart(
    log: Logger,
    pveVm: { id: number; vmId: number; pveNode: { name: string } },
    currentStatus: string,
    steps: ToggleStatusStepResult[]
  ) {
    if (currentStatus === "running") {
      log.info("VM is already running, skipping start");
      steps.push({
        step: "start-vm",
        duration: 0,
        success: true,
        details: { skipped: true, reason: "already running" }
      });
      return;
    }

    const { result: startUpid, duration: startDuration } = await this.executeStep(
      "start-vm",
      log,
      () => this.recordPveCall("/api2/json/nodes/{node}/qemu/{vmid}/status/start", "POST", () =>
        qemu.setQemuStatus(pveVm.pveNode.name, pveVm.vmId, "start")
      )
    );

    const { duration: waitDuration } = await this.executeStep(
      "wait-vm-start",
      log,
      () => this.recordPveCall("/api2/json/nodes/{node}/tasks/{upid}/status", "GET", () =>
        upidStatusCheck(pveVm.pveNode.name, startUpid)
      )
    );

    steps.push({
      step: "start-vm",
      duration: startDuration + waitDuration,
      success: true,
      details: { upid: startUpid }
    });

    // Wait for guest agent to be ready
    const { duration: agentDuration } = await this.executeStep(
      "wait-guest-agent",
      log,
      () => this.recordPveCall("/api2/json/nodes/{node}/qemu/{vmid}/agent/info", "GET", () =>
        qemu.agentCheckQemu(pveVm.pveNode.name, pveVm.vmId)
      )
    );
    steps.push({ step: "wait-guest-agent", duration: agentDuration, success: true });
  }

  private async handleStop(
    log: Logger,
    pveVm: { id: number; vmId: number; pveNode: { name: string } },
    currentStatus: string,
    steps: ToggleStatusStepResult[]
  ) {
    if (currentStatus === "stopped") {
      log.info("VM is already stopped, skipping stop");
      steps.push({
        step: "stop-vm",
        duration: 0,
        success: true,
        details: { skipped: true, reason: "already stopped" }
      });
      return;
    }

    const { result: stopUpid, duration: stopDuration } = await this.executeStep(
      "stop-vm",
      log,
      () => this.recordPveCall("/api2/json/nodes/{node}/qemu/{vmid}/status/stop", "POST", () =>
        qemu.setQemuStatus(pveVm.pveNode.name, pveVm.vmId, "stop")
      )
    );

    const { duration: waitDuration } = await this.executeStep(
      "wait-vm-stop",
      log,
      () => this.recordPveCall("/api2/json/nodes/{node}/tasks/{upid}/status", "GET", () =>
        upidStatusCheck(pveVm.pveNode.name, stopUpid)
      )
    );

    steps.push({
      step: "stop-vm",
      duration: stopDuration + waitDuration,
      success: true,
      details: { upid: stopUpid }
    });
  }

  private async handleRestart(
    log: Logger,
    pveVm: { id: number; vmId: number; pveNode: { name: string } },
    currentStatus: string,
    steps: ToggleStatusStepResult[]
  ) {
    if (currentStatus === "running") {
      // Use reset for a hard restart (faster than stop + start)
      const { result: resetUpid, duration: resetDuration } = await this.executeStep(
        "reset-vm",
        log,
        () => this.recordPveCall("/api2/json/nodes/{node}/qemu/{vmid}/status/reset", "POST", () =>
          qemu.setQemuStatus(pveVm.pveNode.name, pveVm.vmId, "reset")
        )
      );

      const { duration: waitDuration } = await this.executeStep(
        "wait-vm-reset",
        log,
        () => this.recordPveCall("/api2/json/nodes/{node}/tasks/{upid}/status", "GET", () =>
          upidStatusCheck(pveVm.pveNode.name, resetUpid)
        )
      );

      steps.push({
        step: "restart-vm",
        duration: resetDuration + waitDuration,
        success: true,
        details: { upid: resetUpid, method: "reset" }
      });
    } else {
      // VM is stopped, just start it
      log.info("VM is stopped, starting instead of restarting");

      const { result: startUpid, duration: startDuration } = await this.executeStep(
        "start-vm",
        log,
        () => this.recordPveCall("/api2/json/nodes/{node}/qemu/{vmid}/status/start", "POST", () =>
          qemu.setQemuStatus(pveVm.pveNode.name, pveVm.vmId, "start")
        )
      );

      const { duration: waitDuration } = await this.executeStep(
        "wait-vm-start",
        log,
        () => this.recordPveCall("/api2/json/nodes/{node}/tasks/{upid}/status", "GET", () =>
          upidStatusCheck(pveVm.pveNode.name, startUpid)
        )
      );

      steps.push({
        step: "restart-vm",
        duration: startDuration + waitDuration,
        success: true,
        details: { upid: startUpid, method: "start-from-stopped" }
      });
    }

    // Wait for guest agent to be ready after restart
    const { duration: agentDuration } = await this.executeStep(
      "wait-guest-agent",
      log,
      () => this.recordPveCall("/api2/json/nodes/{node}/qemu/{vmid}/agent/info", "GET", () =>
        qemu.agentCheckQemu(pveVm.pveNode.name, pveVm.vmId)
      )
    );
    steps.push({ step: "wait-guest-agent", duration: agentDuration, success: true });
  }

  public close() {
    return this.worker.close();
  }
}
