/**
 * Queue job data types for all background tasks
 * Jobs only contain trigger data (IDs). Workers query the database for full details.
 */

export interface ProvisionInstanceJobData {
	instanceId: number;
	userId: number;
}

export interface DeprovisionInstanceJobData {
	instanceId: number;
	userId: number;
}

export interface ToggleInstanceStatusJobData {
	instanceId: number;
	userId: number;
	status: "START" | "STOP" | "RESTART";
}

/**
 * Step result for tracking individual operation performance
 */
export interface JobStepResult {
	step: string;
	duration: number;
	success: boolean;
	details?: Record<string, unknown>;
}

export interface ProvisionInstanceJobResult {
	instanceId: number;
	status: "success" | "failed";
	message: string;
	duration?: number;
	steps?: JobStepResult[];
}

export interface DeprovisionInstanceJobResult {
	instanceId: number;
	status: "success" | "failed";
	message: string;
	duration?: number;
	steps?: JobStepResult[];
}

export interface ToggleInstanceStatusJobResult {
	instanceId: number;
	status: "success" | "failed";
	message: string;
	duration?: number;
	steps?: JobStepResult[];
}
