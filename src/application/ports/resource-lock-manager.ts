export interface ResourceLockOptions {
	ttlMs?: number;
	acquireTimeoutMs?: number;
	retryIntervalMs?: number;
}

export interface ResourceLockManager {
	withLocks<T>(
		keys: string[],
		fn: () => Promise<T>,
		options?: ResourceLockOptions,
	): Promise<T>;
}
