import { Redis } from "ioredis";
import { Worker } from "bullmq";
import type { Logger } from "pino";
import { randomBytes } from "node:crypto";

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
import { generateNextVmid, getNodeWithLeastLoad, upidStatusCheck } from "@yuzu/pve/shared";
import * as qemu from "@yuzu/pve/qemu";

interface ProvisionStepResult {
  step: string;
  duration: number;
  success: boolean;
  details?: Record<string, unknown>;
}

export class ProvisionQueueWorker {
  private worker: Worker;
  private logger = rootLogger.child({ service: "provision-worker" });
  private readonly queueName = `${env.NODE_ENV}_provision-instance`;

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

        jobLogger.info({ data: job.data }, "Processing provision job");

        if (job.name === "provision") {
          const startTime = performance.now();
          try {
            const result = await this.instanceProvisionJob(
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
            }, "Provision job completed successfully");

            return {
              instanceId: job.data.instanceId,
              status: 'success',
              message: 'Instance provisioned successfully',
              duration: totalDuration,
              steps: result.steps,
            }
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
            }, "Provision job failed");

            if (job.attemptsMade < job.opts.attempts! - 1) {
              throw err; // Re-throw to trigger a retry
            }

            await this.prisma.instance.update({
              where: { id: job.data.instanceId },
              data: { provisionStatus: 'FAILED', provisionError: error.message },
            });

            return {
              instanceId: job.data.instanceId,
              status: 'failed',
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
        lockDuration: 300000, // 5 minutes to handle long-running clone operations
        stalledInterval: 5000, // Check for stalled jobs every 5 seconds
        maxStalledCount: 2, // Allow 2 stall checks before marking as failed
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
      this.logger.info("Provision queue worker ready");
    });

    this.worker.on("error", (err) => {
      this.logger.error({ err: { message: err.message, stack: err.stack } }, "Worker error");
    });
  }

  /**
   * Execute a provision step with timing and logging
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

  public async instanceProvisionJob(instanceId: number, userId: number, parentLogger?: Logger) {
    const steps: ProvisionStepResult[] = [];
    const log = (parentLogger || this.logger).child({
      instanceId,
      userId,
      operation: "provision"
    });

    log.info("Starting instance provision");

    // Step 1: Fetch instance and validate
    const { result: instance, duration: fetchDuration } = await this.executeStep(
      "fetch-instance",
      log,
      async () => {
        const inst = await this.prisma.instance.findUnique({
          where: { id: instanceId },
          include: {
            pveTemplate: {
              include: { pveNode: true }
            }
          }
        });
        if (!inst) throw new Error(`Instance ${instanceId} not found`);
        return inst;
      }
    );
    steps.push({ step: "fetch-instance", duration: fetchDuration, success: true });

    const template = instance.pveTemplate;
    const vmLog = log.child({
      templateId: template.id,
      templateVmid: template.vmId,
      sourceNode: template.pveNode.name
    });

    // Step 2: Update status to PROVISIONING
    const { duration: statusUpdateDuration } = await this.executeStep(
      "update-status-provisioning",
      vmLog,
      () => this.prisma.instance.update({
        where: { id: instanceId },
        data: { provisionStatus: 'PROVISIONING' }
      })
    );
    steps.push({ step: "update-status-provisioning", duration: statusUpdateDuration, success: true });

    // Step 3: Generate VMID and get target node in parallel
    const { result: [targetId, targetNode], duration: prepDuration } = await this.executeStep(
      "prepare-vm-resources",
      vmLog,
      async () => {
        const [vmid, node] = await Promise.all([
          this.generateNextVmid(),
          this.recordPveCall("/api2/json/nodes", "GET", () => getNodeWithLeastLoad())
        ]);
        return [vmid, node] as const;
      }
    );
    steps.push({
      step: "prepare-vm-resources",
      duration: prepDuration,
      success: true,
      details: { vmid: targetId, targetNode }
    });

    // Create enriched logger with VM context
    const provisionLog = vmLog.child({ vmid: targetId, targetNode });
    provisionLog.info("VM resources allocated, starting clone operation");

    const hostname = this.generateRandomHostname(instanceId);

    // Step 4: Clone VM
    const { result: cloneUpid, duration: cloneDuration } = await this.executeStep(
      "clone-vm",
      provisionLog,
      () => this.recordPveCall("/api2/json/nodes/{node}/qemu/{vmid}/clone", "POST", () =>
        qemu.cloneQemu(template.pveNode.name, template.vmId, targetId, targetNode, hostname)
      )
    );

    provisionLog.debug({ upid: cloneUpid }, "Clone task initiated, waiting for completion");

    const { duration: cloneWaitDuration } = await this.executeStep(
      "wait-clone-completion",
      provisionLog,
      () => this.recordPveCall("/api2/json/nodes/{node}/tasks/{upid}/status", "GET", () =>
        upidStatusCheck(template.pveNode.name, cloneUpid)
      )
    );
    steps.push({
      step: "clone-vm",
      duration: cloneDuration + cloneWaitDuration,
      success: true,
      details: { upid: cloneUpid }
    });

    // Step 5: Fetch owner SSH public keys
    const { result: ownerSshKeys, duration: sshKeysDuration } = await this.executeStep(
      "fetch-owner-ssh-keys",
      provisionLog,
      () => this.prisma.platformSSHKey.findMany({
        where: { ownerId: instance.platformUserId },
        select: { publicKey: true }
      })
    );
    steps.push({
      step: "fetch-owner-ssh-keys",
      duration: sshKeysDuration,
      success: true,
      details: { keyCount: ownerSshKeys.length }
    });

    const sshPublicKeys = ownerSshKeys.map((key) => key.publicKey);

    // Step 6: Allocate IP address
    const { result: pickedIp, duration: ipDuration } = await this.executeStep(
      "allocate-ip",
      provisionLog,
      async () => {
        const ip = await this.prisma.pVENetworkIP.findFirst({
          where: { isAllocated: false },
          include: { pveNetwork: true }
        });
        if (!ip) throw new Error("No available IP addresses for allocation");
        return ip;
      }
    );
    steps.push({
      step: "allocate-ip",
      duration: ipDuration,
      success: true,
      details: { ip: pickedIp.ipAddress, network: pickedIp.pveNetwork.name }
    });

    const ipLog = provisionLog.child({
      allocatedIp: pickedIp.ipAddress,
      network: pickedIp.pveNetwork.name
    });

    // Step 7: Create or update PVEVM record (upsert handles reprovisioning cases)
    const { result: pveVm, duration: createVmDuration } = await this.executeStep(
      "create-pvevm-record",
      ipLog,
      () => this.prisma.pVEVM.upsert({
        where: { vmId: targetId },
        create: {
          vmId: targetId,
          hostname,
          pveNode: { connect: { name: targetNode } },
          pveNetworkIP: { connect: { id: pickedIp.id } }
        },
        update: {
          hostname,
          status: "STOPPED",
          pveNode: { connect: { name: targetNode } },
          pveNetworkIP: { connect: { id: pickedIp.id } }
        }
      })
    );
    steps.push({ step: "create-pvevm-record", duration: createVmDuration, success: true });

    // Step 8: Resize disk
    const { result: resizeUpid, duration: resizeDuration } = await this.executeStep(
      "resize-disk",
      ipLog,
      () => this.recordPveCall("/api2/json/nodes/{node}/qemu/{vmid}/resize", "PUT", () =>
        qemu.resizeQemuDisk(targetNode, targetId, instance.diskGB)
      )
    );

    const { duration: resizeWaitDuration } = await this.executeStep(
      "wait-resize-completion",
      ipLog,
      () => this.recordPveCall("/api2/json/nodes/{node}/tasks/{upid}/status", "GET", () =>
        upidStatusCheck(targetNode, resizeUpid)
      )
    );
    steps.push({
      step: "resize-disk",
      duration: resizeDuration + resizeWaitDuration,
      success: true,
      details: { diskGB: instance.diskGB, upid: resizeUpid }
    });

    // Step 9: Configure VM (network, CPU, memory)
    const ipConfig = {
      bridge: pickedIp.pveNetwork.bridge,
      vlan: parseInt(pickedIp.pveNetwork.name) || 1,
      ip: `${pickedIp.ipAddress}/${pickedIp.pveNetwork.subnet.split("/")[1]}`,
      gw: pickedIp.pveNetwork.gateway,
    };
    const defaultUserCredentials = {
      username: "user",
      password: this.generateRandomPassword(),
    };

    const { duration: configDuration } = await this.executeStep(
      "configure-vm",
      ipLog,
      () => this.recordPveCall("/api2/json/nodes/{node}/qemu/{vmid}/config", "PUT", () =>
        qemu.editQemu(
          targetNode,
          targetId,
          instance.cpus,
          instance.memoryMB,
          defaultUserCredentials,
          sshPublicKeys,
          ipConfig
        )
      )
    );
    steps.push({
      step: "configure-vm",
      duration: configDuration,
      success: true,
      details: { cpus: instance.cpus, memoryMB: instance.memoryMB, ipConfig }
    });

    // Step 10: Update database records (IP allocation + instance status)
    const { duration: dbUpdateDuration } = await this.executeStep(
      "update-database-records",
      ipLog,
      () => this.prisma.$transaction([
        this.prisma.pVENetworkIP.update({
          where: { id: pickedIp.id },
          data: { isAllocated: true }
        }),
        this.prisma.instance.update({
          where: { id: instanceId },
          data: {
            provisionStatus: "COMPLETED",
            defaultPassword: defaultUserCredentials.password,
            pveVM: { connect: { id: pveVm.id } }
          }
        })
      ])
    );
    steps.push({ step: "update-database-records", duration: dbUpdateDuration, success: true });

    // Step 11: Start VM
    const { result: startUpid, duration: startDuration } = await this.executeStep(
      "start-vm",
      ipLog,
      () => this.recordPveCall("/api2/json/nodes/{node}/qemu/{vmid}/status/start", "POST", () =>
        qemu.setQemuStatus(targetNode, targetId, "start")
      )
    );

    const { duration: startWaitDuration } = await this.executeStep(
      "wait-vm-start",
      ipLog,
      () => this.recordPveCall("/api2/json/nodes/{node}/tasks/{upid}/status", "GET", () =>
        upidStatusCheck(targetNode, startUpid)
      )
    );
    steps.push({
      step: "start-vm",
      duration: startDuration + startWaitDuration,
      success: true,
      details: { upid: startUpid }
    });

    // Step 12: Wait for QEMU Guest Agent if failed, continue anyway
    try {
      const { duration: agentDuration } = await this.executeStep(
        "wait-guest-agent",
        ipLog,
        () => this.recordPveCall("/api2/json/nodes/{node}/qemu/{vmid}/agent/info", "GET", () =>
          qemu.agentCheckQemu(targetNode, targetId)
        )
      );
      steps.push({ step: "wait-guest-agent", duration: agentDuration, success: true });

      const { duration: setPasswordDuration } = await this.executeStep(
        "set-guest-user-password",
        ipLog,
        () => this.recordPveCall("/api2/json/nodes/{node}/qemu/{vmid}/agent/set-user-password", "POST", () =>
          qemu.setQemuGuestUserPassword(
            targetNode,
            targetId,
            defaultUserCredentials.username,
            defaultUserCredentials.password
          )
        )
      );
      steps.push({ step: "set-guest-user-password", duration: setPasswordDuration, success: true });

      const { duration: setHostnameDuration } = await this.executeStep(
        "set-guest-hostname",
        ipLog,
        () => this.recordPveCall("/api2/json/nodes/{node}/qemu/{vmid}/agent/exec", "POST", () =>
          qemu.setQemuGuestHostname(targetNode, targetId, hostname)
        )
      );
      steps.push({ step: "set-guest-hostname", duration: setHostnameDuration, success: true });
    } catch (err) {
      const error = err as Error;
      ipLog.warn({ err: { message: error.message } }, "Guest agent check failed, continuing anyway");
      steps.push({ step: "wait-guest-agent", duration: 0, success: false, details: { error: error.message } });
      steps.push({ step: "set-guest-user-password", duration: 0, success: false, details: { error: "Skipped because guest agent is unavailable" } });
      steps.push({ step: "set-guest-hostname", duration: 0, success: false, details: { error: "Skipped because guest agent is unavailable" } });
    }

    // Step 13: Final status update
    const { duration: finalUpdateDuration } = await this.executeStep(
      "finalize-status",
      ipLog,
      () => this.prisma.$transaction([
        this.prisma.pVEVM.update({
          where: { id: pveVm.id },
          data: { status: "RUNNING" }
        }),
        this.prisma.instance.update({
          where: { id: instanceId },
          data: { status: "ACTIVE" }
        })
      ])
    );
    steps.push({ step: "finalize-status", duration: finalUpdateDuration, success: true });

    // Step 14: Invalidate cache
    const { duration: cacheDuration } = await this.executeStep(
      "invalidate-cache",
      ipLog,
      async () => {
        await Promise.all([
          this.redisConnection.del(`user:${userId}:instances:*`),
          this.redisConnection.del(`instance:${instanceId}`)
        ]);
      }
    );
    steps.push({ step: "invalidate-cache", duration: cacheDuration, success: true });

    ipLog.info({
      totalSteps: steps.length,
      vmid: targetId,
      node: targetNode,
      ip: pickedIp.ipAddress
    }, "Instance provisioned successfully");

    return { steps };
  }

  private async generateNextVmid(): Promise<number> {
    const prevIdKey = "pve:vmid:next";
    const prevIdCache = await this.redisConnection.get(prevIdKey);

    let nextVmid: number;
    if (prevIdCache) {
      const prevId = parseInt(prevIdCache, 10);
      nextVmid = await generateNextVmid(prevId);
    } else {
      nextVmid = await generateNextVmid(0);
    }

    await this.redisConnection.set(prevIdKey, nextVmid.toString());
    return nextVmid;
  }

  private generateRandomHostname(instanceId: number): string {
    const adjectives = ["quick", "lazy", "happy", "sad", "bright", "dark"];
    const nouns = ["fox", "dog", "cat", "mouse", "lion", "tiger"];

    const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];

    return `${randomAdjective}-${randomNoun}-${instanceId}`;
  }

  private generateRandomPassword(length = 16): string {
    // Keep password transport/copy-safe for cloud-init and API form-encoding layers.
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const bytes = randomBytes(length * 2);
    let password = "";

    for (const byte of bytes) {
      if (password.length >= length) break;
      password += charset[byte % charset.length];
    }

    return password;
  }

  public close() {
    return this.worker.close();
  }
}
