import type { AppLogger } from "@yuzu/application/common/logger";
import { StepTracker } from "@yuzu/application/common/step-tracker";
import type { InstanceRepository } from "@yuzu/application/ports/instance-repository";
import type { PlatformCache } from "@yuzu/application/ports/platform-cache";
import type { ProxmoxGateway } from "@yuzu/application/ports/proxmox-gateway";

export class DeprovisionInstanceUseCase {
	constructor(
		private readonly repository: InstanceRepository,
		private readonly proxmox: ProxmoxGateway,
		private readonly cache: PlatformCache,
	) {}

	async execute(instanceId: number, userId: number, parentLogger: AppLogger) {
		const log = parentLogger.child({
			instanceId,
			userId,
			operation: "deprovision",
		});
		const tracker = new StepTracker(log);

		log.info("Starting instance deprovision");

		const instance = await tracker.executeStep("fetch-instance", async () => {
			const record = await this.repository.findDeprovisionInstance(instanceId);
			if (!record) {
				throw new Error(`Instance ${instanceId} not found`);
			}
			return record;
		});

		if (!instance.pveVM) {
			log.warn("Instance has no PVEVM assigned, marking as deprovisioned");
			await tracker.executeStep("update-status-no-vm", async () => {
				await this.repository.markInstanceDeleted(instanceId);
			});
			return { steps: tracker.steps };
		}

		const pveVm = instance.pveVM;
		const vmLog = log.child({
			vmid: pveVm.vmId,
			node: pveVm.pveNode.name,
			hostname: pveVm.hostname,
			ipAddress: pveVm.pveNetworkIP?.ipAddress,
		});

		await tracker.executeStep("update-status-deprovisioning", async () => {
			await this.repository.markInstanceDeprovisioning(instanceId);
		});

		const currentStatus = await tracker.executeStep(
			"check-vm-status",
			async () => this.proxmox.getVmStatus(pveVm.pveNode.name, pveVm.vmId),
			(status) => ({ status }),
		);

		if (currentStatus === "running") {
			await tracker.executeStep(
				"stop-vm",
				async () => {
					const upid = await this.proxmox.stopVm(
						pveVm.pveNode.name,
						pveVm.vmId,
					);
					await this.proxmox.waitForTask(pveVm.pveNode.name, upid);
					return upid;
				},
				(upid) => ({ upid }),
			);
		}

		await tracker.executeStep("delete-vm-proxmox", async () => {
			await this.proxmox.deleteVm(pveVm.pveNode.name, pveVm.vmId);
		});

		await tracker.executeStep(
			"cleanup-database-records",
			async () => {
				await this.repository.cleanupDeprovision({
					instanceId,
					pveVmId: pveVm.id,
					networkIpId: pveVm.pveNetworkIPId,
				});
			},
			() => ({
				ipDeallocated: !!pveVm.pveNetworkIPId,
				pveVmDeleted: true,
			}),
		);

		await tracker.executeStep("invalidate-cache", async () => {
			await this.cache.invalidateInstanceCache(userId, instanceId);
		});

		vmLog.info(
			{
				totalSteps: tracker.steps.length,
				vmid: pveVm.vmId,
				node: pveVm.pveNode.name,
			},
			"Instance deprovisioned successfully",
		);

		return { steps: tracker.steps };
	}
}
