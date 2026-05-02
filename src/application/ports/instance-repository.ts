export interface ProvisionInstanceRecord {
	id: number;
	platformUserId: number;
	cpus: number;
	memoryMB: number;
	diskGB: number;
	pveTemplate: {
		id: number;
		vmId: number;
		pveNode: {
			name: string;
		};
	};
}

export interface AvailableNetworkIpRecord {
	id: number;
	ipAddress: string;
	pveNetwork: {
		name: string;
		subnet: string;
		gateway: string;
		bridge: string;
	};
}

export interface PveVmRecord {
	id: number;
	vmId: number;
	hostname: string;
	pveNode: {
		name: string;
	};
	pveNetworkIPId: number | null;
	pveNetworkIP?: {
		ipAddress: string;
	} | null;
}

export interface DeprovisionInstanceRecord {
	id: number;
	pveVM: PveVmRecord | null;
}

export interface ToggleStatusInstanceRecord {
	id: number;
	pveVM: {
		id: number;
		vmId: number;
		hostname: string;
		pveNode: {
			name: string;
		};
	} | null;
}

export interface InstanceRepository {
	findProvisionInstance(
		instanceId: number,
	): Promise<ProvisionInstanceRecord | null>;
	markInstanceProvisioning(instanceId: number): Promise<void>;
	markInstanceProvisionFailed(instanceId: number, error: string): Promise<void>;
	findOwnerSshKeys(ownerId: number): Promise<string[]>;
	findAvailableNetworkIp(): Promise<AvailableNetworkIpRecord | null>;
	upsertPveVm(input: {
		vmId: number;
		hostname: string;
		targetNode: string;
		networkIpId: number;
	}): Promise<PveVmRecord>;
	completeProvision(input: {
		instanceId: number;
		pveVmId: number;
		networkIpId: number;
		defaultPassword: string;
	}): Promise<void>;
	finalizeProvision(input: {
		instanceId: number;
		pveVmId: number;
	}): Promise<void>;
	findDeprovisionInstance(
		instanceId: number,
	): Promise<DeprovisionInstanceRecord | null>;
	markInstanceDeleted(instanceId: number): Promise<void>;
	markInstanceDeprovisioning(instanceId: number): Promise<void>;
	cleanupDeprovision(input: {
		instanceId: number;
		pveVmId: number;
		networkIpId: number | null;
	}): Promise<void>;
	findToggleStatusInstance(
		instanceId: number,
	): Promise<ToggleStatusInstanceRecord | null>;
	updateToggleStatuses(input: {
		instanceId: number;
		pveVmId: number;
		vmStatus: "RUNNING" | "STOPPED";
	}): Promise<void>;
}
