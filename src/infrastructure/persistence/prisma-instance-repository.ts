import type {
	AvailableNetworkIpRecord,
	DeprovisionInstanceRecord,
	InstanceRepository,
	ProvisionInstanceRecord,
	PveVmRecord,
	ToggleStatusInstanceRecord,
} from "@yuzu/application/ports/instance-repository";
import type { PrismaClient } from "@yuzu/infrastructure/persistence/database";

export class PrismaInstanceRepository implements InstanceRepository {
	constructor(private readonly prisma: PrismaClient) {}

	async findProvisionInstance(
		instanceId: number,
	): Promise<ProvisionInstanceRecord | null> {
		return this.prisma.instance.findUnique({
			where: { id: instanceId },
			include: {
				pveTemplate: {
					include: { pveNode: true },
				},
			},
		});
	}

	async markInstanceProvisioning(instanceId: number): Promise<void> {
		await this.prisma.instance.update({
			where: { id: instanceId },
			data: { provisionStatus: "PROVISIONING" },
		});
	}

	async markInstanceProvisionFailed(
		instanceId: number,
		error: string,
	): Promise<void> {
		await this.prisma.instance.update({
			where: { id: instanceId },
			data: { provisionStatus: "FAILED", provisionError: error },
		});
	}

	async findOwnerSshKeys(ownerId: number): Promise<string[]> {
		const keys = await this.prisma.platformSSHKey.findMany({
			where: { ownerId },
			select: { publicKey: true },
		});
		return keys.map((key) => key.publicKey);
	}

	async findAvailableNetworkIp(): Promise<AvailableNetworkIpRecord | null> {
		return this.prisma.pVENetworkIP.findFirst({
			where: { isAllocated: false },
			include: { pveNetwork: true },
		});
	}

	async upsertPveVm(input: {
		vmId: number;
		hostname: string;
		targetNode: string;
		networkIpId: number;
	}): Promise<PveVmRecord> {
		return this.prisma.pVEVM.upsert({
			where: { vmId: input.vmId },
			create: {
				vmId: input.vmId,
				hostname: input.hostname,
				pveNode: { connect: { name: input.targetNode } },
				pveNetworkIP: { connect: { id: input.networkIpId } },
			},
			update: {
				hostname: input.hostname,
				status: "STOPPED",
				pveNode: { connect: { name: input.targetNode } },
				pveNetworkIP: { connect: { id: input.networkIpId } },
			},
			include: {
				pveNode: true,
				pveNetworkIP: true,
			},
		});
	}

	async completeProvision(input: {
		instanceId: number;
		pveVmId: number;
		networkIpId: number;
		defaultPassword: string;
	}): Promise<void> {
		await this.prisma.$transaction([
			this.prisma.pVENetworkIP.update({
				where: { id: input.networkIpId },
				data: { isAllocated: true },
			}),
			this.prisma.instance.update({
				where: { id: input.instanceId },
				data: {
					provisionStatus: "COMPLETED",
					defaultPassword: input.defaultPassword,
					pveVM: { connect: { id: input.pveVmId } },
				},
			}),
		]);
	}

	async finalizeProvision(input: {
		instanceId: number;
		pveVmId: number;
	}): Promise<void> {
		await this.prisma.$transaction([
			this.prisma.pVEVM.update({
				where: { id: input.pveVmId },
				data: { status: "RUNNING" },
			}),
			this.prisma.instance.update({
				where: { id: input.instanceId },
				data: { status: "ACTIVE" },
			}),
		]);
	}

	async findDeprovisionInstance(
		instanceId: number,
	): Promise<DeprovisionInstanceRecord | null> {
		return this.prisma.instance.findUnique({
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
	}

	async markInstanceDeleted(instanceId: number): Promise<void> {
		await this.prisma.instance.update({
			where: { id: instanceId },
			data: { status: "DELETED" },
		});
	}

	async markInstanceDeprovisioning(instanceId: number): Promise<void> {
		await this.prisma.instance.update({
			where: { id: instanceId },
			data: { provisionStatus: "PROVISIONING", status: "PENDING" },
		});
	}

	async cleanupDeprovision(input: {
		instanceId: number;
		pveVmId: number;
		networkIpId: number | null;
	}): Promise<void> {
		await this.prisma.$transaction(async (tx) => {
			await tx.instance.update({
				where: { id: input.instanceId },
				data: {
					pveVMId: null,
					status: "DELETED",
				},
			});

			if (input.networkIpId) {
				await tx.pVENetworkIP.update({
					where: { id: input.networkIpId },
					data: { isAllocated: false },
				});
			}

			await tx.pVEVM.delete({
				where: { id: input.pveVmId },
			});
		});
	}

	async findToggleStatusInstance(
		instanceId: number,
	): Promise<ToggleStatusInstanceRecord | null> {
		return this.prisma.instance.findUnique({
			where: { id: instanceId },
			include: {
				pveVM: {
					include: {
						pveNode: true,
					},
				},
			},
		});
	}

	async updateToggleStatuses(input: {
		instanceId: number;
		pveVmId: number;
		vmStatus: "RUNNING" | "STOPPED";
	}): Promise<void> {
		await this.prisma.$transaction([
			this.prisma.pVEVM.update({
				where: { id: input.pveVmId },
				data: { status: input.vmStatus },
			}),
		]);
	}
}
