import { randomUUID } from "node:crypto";

import type {
	ResourceLockManager,
	ResourceLockOptions,
} from "@yuzu/application/ports/resource-lock-manager";
import type { Redis } from "ioredis";

const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
	return redis.call("del", KEYS[1])
end
return 0
`;

interface AcquiredLock {
	key: string;
	token: string;
}

export class ResourceLockTimeoutError extends Error {
	constructor(public readonly key: string, public readonly timeoutMs: number) {
		super(
			`Timed out acquiring resource lock for "${key}" after ${timeoutMs}ms`,
		);
		this.name = "ResourceLockTimeoutError";
	}
}

export class RedisResourceLockManager implements ResourceLockManager {
	constructor(
		private readonly redis: Redis,
		private readonly defaults: Required<ResourceLockOptions>,
	) {}

	public async withLocks<T>(
		keys: string[],
		fn: () => Promise<T>,
		options?: ResourceLockOptions,
	): Promise<T> {
		const uniqueKeys = [...new Set(keys)].sort();
		const acquiredLocks: AcquiredLock[] = [];

		try {
			for (const key of uniqueKeys) {
				const lock = await this.acquireLock(key, options);
				acquiredLocks.push(lock);
			}

			return await fn();
		} finally {
			for (const lock of acquiredLocks.reverse()) {
				await this.releaseLock(lock);
			}
		}
	}

	private async acquireLock(
		key: string,
		options?: ResourceLockOptions,
	): Promise<AcquiredLock> {
		const ttlMs = options?.ttlMs ?? this.defaults.ttlMs;
		const acquireTimeoutMs =
			options?.acquireTimeoutMs ?? this.defaults.acquireTimeoutMs;
		const retryIntervalMs =
			options?.retryIntervalMs ?? this.defaults.retryIntervalMs;
		const token = randomUUID();
		const startedAt = Date.now();

		while (Date.now() - startedAt < acquireTimeoutMs) {
			const result = await this.redis.set(key, token, "PX", ttlMs, "NX");
			if (result === "OK") {
				return { key, token };
			}

			await this.sleep(retryIntervalMs);
		}

		throw new ResourceLockTimeoutError(key, acquireTimeoutMs);
	}

	private async releaseLock(lock: AcquiredLock): Promise<void> {
		await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, lock.key, lock.token);
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
