export interface PlatformCache {
	invalidateInstanceCache(userId: number, instanceId: number): Promise<void>;
	getLastProvisionedVmid(): Promise<number | null>;
	setLastProvisionedVmid(vmid: number): Promise<void>;
}
