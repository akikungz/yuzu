import { randomBytes } from "node:crypto";

import type { AppLogger } from "@yuzu/application/common/logger";
import { StepTracker } from "@yuzu/application/common/step-tracker";
import type { InstanceRepository } from "@yuzu/application/ports/instance-repository";
import type { PlatformCache } from "@yuzu/application/ports/platform-cache";
import type { ProxmoxGateway } from "@yuzu/application/ports/proxmox-gateway";

export class ProvisionInstanceUseCase {
	constructor(
		private readonly repository: InstanceRepository,
		private readonly proxmox: ProxmoxGateway,
		private readonly cache: PlatformCache,
	) {}

	async execute(instanceId: number, userId: number, parentLogger: AppLogger) {
		const log = parentLogger.child({
			instanceId,
			userId,
			operation: "provision",
		});
		const tracker = new StepTracker(log);

		log.info("Starting instance provision");

		const instance = await tracker.executeStep("fetch-instance", async () => {
			const record = await this.repository.findProvisionInstance(instanceId);
			if (!record) {
				throw new Error(`Instance ${instanceId} not found`);
			}
			return record;
		});

		const template = instance.pveTemplate;
		const vmLog = log.child({
			templateId: template.id,
			templateVmid: template.vmId,
			sourceNode: template.pveNode.name,
		});

		await tracker.executeStep("update-status-provisioning", async () => {
			await this.repository.markInstanceProvisioning(instanceId);
		});

		const [targetId, targetNode] = await tracker.executeStep(
			"prepare-vm-resources",
			async () => {
				const previousVmid = await this.cache.getLastProvisionedVmid();
				const [vmid, node] = await Promise.all([
					this.proxmox.generateNextVmid(previousVmid ?? undefined),
					this.proxmox.getNodeWithLeastLoad(),
				]);
				await this.cache.setLastProvisionedVmid(vmid);
				return [vmid, node] as const;
			},
			([vmid, node]) => ({ vmid, targetNode: node }),
		);

		const provisionLog = vmLog.child({ vmid: targetId, targetNode });
		provisionLog.info("VM resources allocated, starting clone operation");

		const hostname = this.generateRandomHostname(instanceId);

		await tracker.executeStep(
			"clone-vm",
			async () => {
				const upid = await this.proxmox.cloneVm({
					sourceNode: template.pveNode.name,
					templateVmid: template.vmId,
					newVmid: targetId,
					targetNode,
					hostname,
				});
				await this.proxmox.waitForTask(template.pveNode.name, upid);
				return upid;
			},
			(upid) => ({ upid }),
		);

		const sshPublicKeys = await tracker.executeStep(
			"fetch-owner-ssh-keys",
			async () => this.repository.findOwnerSshKeys(instance.platformUserId),
			(keys) => ({ keyCount: keys.length }),
		);

		const pickedIp = await tracker.executeStep(
			"allocate-ip",
			async () => {
				const ip = await this.repository.findAvailableNetworkIp();
				if (!ip) {
					throw new Error("No available IP addresses for allocation");
				}
				return ip;
			},
			(ip) => ({ ip: ip.ipAddress, network: ip.pveNetwork.name }),
		);

		const ipLog = provisionLog.child({
			allocatedIp: pickedIp.ipAddress,
			network: pickedIp.pveNetwork.name,
		});

		const pveVm = await tracker.executeStep("create-pvevm-record", async () => {
			return this.repository.upsertPveVm({
				vmId: targetId,
				hostname,
				targetNode,
				networkIpId: pickedIp.id,
			});
		});

		await tracker.executeStep(
			"resize-disk",
			async () => {
				const upid = await this.proxmox.resizeDisk(
					targetNode,
					targetId,
					instance.diskGB,
				);
				await this.proxmox.waitForTask(targetNode, upid);
				return upid;
			},
			(upid) => ({ diskGB: instance.diskGB, upid }),
		);

		const ipConfig = {
			bridge: pickedIp.pveNetwork.bridge,
			vlan: parseInt(pickedIp.pveNetwork.name, 10) || 1,
			ip: `${pickedIp.ipAddress}/${pickedIp.pveNetwork.subnet.split("/")[1]}`,
			gw: pickedIp.pveNetwork.gateway,
		};
		const defaultUserCredentials = {
			username: "user",
			password: this.generateRandomPassword(),
		};

		await tracker.executeStep(
			"configure-vm",
			async () => {
				await this.proxmox.configureVm({
					node: targetNode,
					vmid: targetId,
					cpuCores: instance.cpus,
					memoryMB: instance.memoryMB,
					credentials: defaultUserCredentials,
					sshPublicKeys,
					networkConfig: ipConfig,
				});
			},
			() => ({ cpus: instance.cpus, memoryMB: instance.memoryMB, ipConfig }),
		);

		await tracker.executeStep("update-database-records", async () => {
			await this.repository.completeProvision({
				instanceId,
				pveVmId: pveVm.id,
				networkIpId: pickedIp.id,
				defaultPassword: defaultUserCredentials.password,
			});
		});

		await tracker.executeStep(
			"start-vm",
			async () => {
				const upid = await this.proxmox.startVm(targetNode, targetId);
				await this.proxmox.waitForTask(targetNode, upid);
				return upid;
			},
			(upid) => ({ upid }),
		);

		try {
			await tracker.executeStep("wait-guest-agent", async () => {
				await this.proxmox.waitForGuestAgent(targetNode, targetId);
			});
			await tracker.executeStep("set-guest-user-password", async () => {
				await this.proxmox.setGuestUserPassword(
					targetNode,
					targetId,
					defaultUserCredentials.username,
					defaultUserCredentials.password,
				);
			});
			await tracker.executeStep("set-guest-hostname", async () => {
				await this.proxmox.setGuestHostname(targetNode, targetId, hostname);
			});
		} catch (err) {
			const error = err as Error;
			ipLog.warn(
				{ err: { message: error.message } },
				"Guest agent check failed, continuing anyway",
			);
			tracker.recordFailure("wait-guest-agent", { error: error.message });
			tracker.recordFailure("set-guest-user-password", {
				error: "Skipped because guest agent is unavailable",
			});
			tracker.recordFailure("set-guest-hostname", {
				error: "Skipped because guest agent is unavailable",
			});
		}

		await tracker.executeStep("finalize-status", async () => {
			await this.repository.finalizeProvision({
				instanceId,
				pveVmId: pveVm.id,
			});
		});

		await tracker.executeStep("invalidate-cache", async () => {
			await this.cache.invalidateInstanceCache(userId, instanceId);
		});

		ipLog.info(
			{
				totalSteps: tracker.steps.length,
				vmid: targetId,
				node: targetNode,
				ip: pickedIp.ipAddress,
			},
			"Instance provisioned successfully",
		);

		return { steps: tracker.steps };
	}

	markFailed(instanceId: number, error: string) {
		return this.repository.markInstanceProvisionFailed(instanceId, error);
	}

	private generateRandomHostname(instanceId: number): string {
		const adjectives = ["quick", "lazy", "happy", "sad", "bright", "dark"];
		const nouns = ["fox", "dog", "cat", "mouse", "lion", "tiger"];

		const randomAdjective =
			adjectives[Math.floor(Math.random() * adjectives.length)];
		const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];

		return `${randomAdjective}-${randomNoun}-${instanceId}`;
	}

	private generateRandomPassword(length = 16): string {
		const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
		const bytes = randomBytes(length * 2);
		let password = "";

		for (const byte of bytes) {
			if (password.length >= length) {
				break;
			}
			password += charset[byte % charset.length];
		}

		return password;
	}
}
