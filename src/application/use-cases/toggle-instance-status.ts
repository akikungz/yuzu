import type { AppLogger } from "@yuzu/application/common/logger";
import { StepTracker } from "@yuzu/application/common/step-tracker";
import type { InstanceRepository } from "@yuzu/application/ports/instance-repository";
import type { PlatformCache } from "@yuzu/application/ports/platform-cache";
import type { ProxmoxGateway } from "@yuzu/application/ports/proxmox-gateway";
import type { ResourceLockManager } from "@yuzu/application/ports/resource-lock-manager";
import { env } from "@yuzu/infrastructure/config/env";

export type ToggleAction = "START" | "STOP" | "RESTART";

export class ToggleInstanceStatusUseCase {
	constructor(
		private readonly repository: InstanceRepository,
		private readonly proxmox: ProxmoxGateway,
		private readonly cache: PlatformCache,
		private readonly resourceLockManager: ResourceLockManager,
	) {}

	async execute(
		instanceId: number,
		userId: number,
		action: ToggleAction,
		parentLogger: AppLogger,
	) {
		const log = parentLogger.child({
			instanceId,
			userId,
			action,
			operation: "toggle-status",
		});
		const tracker = new StepTracker(log);

		log.info(`Starting instance ${action.toLowerCase()}`);

		const instance = await tracker.executeStep("fetch-instance", async () => {
			const record = await this.repository.findToggleStatusInstance(instanceId);
			if (!record) {
				throw new Error(`Instance ${instanceId} not found`);
			}
			return record;
		});

		if (!instance.pveVM) {
			throw new Error(`Instance ${instanceId} has no VM assigned`);
		}

		const pveVm = instance.pveVM;
		const vmLog = log.child({
			vmid: pveVm.vmId,
			node: pveVm.pveNode.name,
			hostname: pveVm.hostname,
		});
		const vmidLockKey = `yuzu:resource:vmid:${pveVm.vmId}`;

		return this.resourceLockManager.withLocks(
			[vmidLockKey],
			async () => {
				const currentStatus = await tracker.executeStep(
					"check-current-status",
					async () => this.proxmox.getVmStatus(pveVm.pveNode.name, pveVm.vmId),
					(status) => ({ currentStatus: status }),
				);

				switch (action) {
					case "START":
						await this.handleStart(vmLog, pveVm, currentStatus, tracker);
						break;
					case "STOP":
						await this.handleStop(vmLog, pveVm, currentStatus, tracker);
						break;
					case "RESTART":
						await this.handleRestart(vmLog, pveVm, currentStatus, tracker);
						break;
				}

				const instanceStatus = action === "STOP" ? "INACTIVE" : "ACTIVE";
				const vmStatus = action === "STOP" ? "STOPPED" : "RUNNING";

				await tracker.executeStep(
					"update-database-status",
					async () => {
						await this.repository.updateToggleStatuses({
							instanceId,
							pveVmId: pveVm.id,
							vmStatus,
						});
					},
					() => ({ instanceStatus, vmStatus }),
				);

				await tracker.executeStep("invalidate-cache", async () => {
					await this.cache.invalidateInstanceCache(userId, instanceId);
				});

				vmLog.info(
					{
						totalSteps: tracker.steps.length,
						vmid: pveVm.vmId,
						node: pveVm.pveNode.name,
						action,
						finalStatus: vmStatus,
						vmidLockKey,
					},
					`Instance ${action.toLowerCase()} completed successfully`,
				);

				return { steps: tracker.steps };
			},
			{
				ttlMs: env.YUZU_RESOURCE_LOCK_TTL_MILLIS,
				acquireTimeoutMs: env.YUZU_RESOURCE_LOCK_ACQUIRE_TIMEOUT_MILLIS,
				retryIntervalMs: env.YUZU_RESOURCE_LOCK_RETRY_INTERVAL_MILLIS,
			},
		);
	}

	private async handleStart(
		log: AppLogger,
		pveVm: { vmId: number; pveNode: { name: string } },
		currentStatus: string,
		tracker: StepTracker,
	) {
		if (currentStatus === "running") {
			log.info("VM is already running, skipping start");
			tracker.steps.push({
				step: "start-vm",
				duration: 0,
				success: true,
				details: { skipped: true, reason: "already running" },
			});
			return;
		}

		await tracker.executeStep(
			"start-vm",
			async () => {
				const upid = await this.proxmox.startVm(pveVm.pveNode.name, pveVm.vmId);
				await this.proxmox.waitForTask(pveVm.pveNode.name, upid);
				return upid;
			},
			(upid) => ({ upid }),
		);

		await tracker.executeStep("wait-guest-agent", async () => {
			await this.proxmox.waitForGuestAgent(pveVm.pveNode.name, pveVm.vmId);
		});
	}

	private async handleStop(
		log: AppLogger,
		pveVm: { vmId: number; pveNode: { name: string } },
		currentStatus: string,
		tracker: StepTracker,
	) {
		if (currentStatus === "stopped") {
			log.info("VM is already stopped, skipping stop");
			tracker.steps.push({
				step: "stop-vm",
				duration: 0,
				success: true,
				details: { skipped: true, reason: "already stopped" },
			});
			return;
		}

		await tracker.executeStep(
			"stop-vm",
			async () => {
				const upid = await this.proxmox.stopVm(pveVm.pveNode.name, pveVm.vmId);
				await this.proxmox.waitForTask(pveVm.pveNode.name, upid);
				return upid;
			},
			(upid) => ({ upid }),
		);
	}

	private async handleRestart(
		log: AppLogger,
		pveVm: { vmId: number; pveNode: { name: string } },
		currentStatus: string,
		tracker: StepTracker,
	) {
		if (currentStatus === "running") {
			await tracker.executeStep(
				"restart-vm",
				async () => {
					const upid = await this.proxmox.resetVm(
						pveVm.pveNode.name,
						pveVm.vmId,
					);
					await this.proxmox.waitForTask(pveVm.pveNode.name, upid);
					return upid;
				},
				(upid) => ({ upid, method: "reset" }),
			);
		} else {
			log.info("VM is stopped, starting instead of restarting");
			await tracker.executeStep(
				"restart-vm",
				async () => {
					const upid = await this.proxmox.startVm(
						pveVm.pveNode.name,
						pveVm.vmId,
					);
					await this.proxmox.waitForTask(pveVm.pveNode.name, upid);
					return upid;
				},
				(upid) => ({ upid, method: "start-from-stopped" }),
			);
		}

		await tracker.executeStep("wait-guest-agent", async () => {
			await this.proxmox.waitForGuestAgent(pveVm.pveNode.name, pveVm.vmId);
		});
	}
}
