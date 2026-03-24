import type { PlatformCache } from "@yuzu/application/ports/platform-cache";
import type { Redis } from "ioredis";

export class RedisPlatformCache implements PlatformCache {
	constructor(private readonly redis: Redis) {}

	async invalidateInstanceCache(
		userId: number,
		instanceId: number,
	): Promise<void> {
		await Promise.all([
			this.redis.del(`user:${userId}:instances:*`),
			this.redis.del(`instance:${instanceId}`),
		]);
	}

	async getLastProvisionedVmid(): Promise<number | null> {
		const value = await this.redis.get("pve:vmid:next");
		if (!value) {
			return null;
		}

		return parseInt(value, 10);
	}

	async setLastProvisionedVmid(vmid: number): Promise<void> {
		await this.redis.set("pve:vmid:next", vmid.toString());
	}
}
