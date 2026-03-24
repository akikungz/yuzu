export interface VmNetworkConfig {
	bridge: string;
	vlan: number;
	ip: string;
	gw: string;
}

export interface VmCredentials {
	username: string;
	password: string;
}

export interface ProxmoxGateway {
	getNodeWithLeastLoad(): Promise<string>;
	generateNextVmid(previousVmid?: number): Promise<number>;
	cloneVm(input: {
		sourceNode: string;
		templateVmid: number;
		newVmid: number;
		targetNode: string;
		hostname: string;
	}): Promise<string>;
	waitForTask(node: string, upid: string): Promise<void>;
	resizeDisk(node: string, vmid: number, diskGB: number): Promise<string>;
	configureVm(input: {
		node: string;
		vmid: number;
		cpuCores: number;
		memoryMB: number;
		credentials: VmCredentials;
		sshPublicKeys: string[];
		networkConfig: VmNetworkConfig;
	}): Promise<void>;
	getVmStatus(node: string, vmid: number): Promise<string>;
	startVm(node: string, vmid: number): Promise<string>;
	stopVm(node: string, vmid: number): Promise<string>;
	resetVm(node: string, vmid: number): Promise<string>;
	deleteVm(node: string, vmid: number): Promise<void>;
	waitForGuestAgent(node: string, vmid: number): Promise<void>;
	setGuestUserPassword(
		node: string,
		vmid: number,
		username: string,
		password: string,
	): Promise<void>;
	setGuestHostname(node: string, vmid: number, hostname: string): Promise<void>;
}
