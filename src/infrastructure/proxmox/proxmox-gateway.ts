import type { ProxmoxGateway } from "@yuzu/application/ports/proxmox-gateway";
import {
	pveApiCallDurationSeconds,
	pveApiCallsTotal,
} from "@yuzu/infrastructure/observability/metrics";
import * as qemu from "@yuzu/pve/qemu";
import {
	generateNextVmid,
	getNodeWithLeastLoad,
	upidStatusCheck,
} from "@yuzu/pve/shared";

export class DefaultProxmoxGateway implements ProxmoxGateway {
	async getNodeWithLeastLoad(): Promise<string> {
		return this.recordCall("/api2/json/nodes", "GET", () =>
			getNodeWithLeastLoad(),
		);
	}

	async generateNextVmid(previousVmid?: number): Promise<number> {
		return generateNextVmid(previousVmid);
	}

	async cloneVm(input: {
		sourceNode: string;
		templateVmid: number;
		newVmid: number;
		targetNode: string;
		hostname: string;
	}): Promise<string> {
		return this.recordCall(
			"/api2/json/nodes/{node}/qemu/{vmid}/clone",
			"POST",
			() =>
				qemu.cloneQemu(
					input.sourceNode,
					input.templateVmid,
					input.newVmid,
					input.targetNode,
					input.hostname,
				),
		);
	}

	async waitForTask(node: string, upid: string): Promise<void> {
		await this.recordCall(
			"/api2/json/nodes/{node}/tasks/{upid}/status",
			"GET",
			() => upidStatusCheck(node, upid),
		);
	}

	async resizeDisk(
		node: string,
		vmid: number,
		diskGB: number,
	): Promise<string> {
		return this.recordCall(
			"/api2/json/nodes/{node}/qemu/{vmid}/resize",
			"PUT",
			() => qemu.resizeQemuDisk(node, vmid, diskGB),
		);
	}

	async configureVm(input: {
		node: string;
		vmid: number;
		cpuCores: number;
		memoryMB: number;
		credentials: { username: string; password: string };
		sshPublicKeys: string[];
		networkConfig: { bridge: string; vlan: number; ip: string; gw: string };
	}): Promise<void> {
		await this.recordCall(
			"/api2/json/nodes/{node}/qemu/{vmid}/config",
			"PUT",
			() =>
				qemu.editQemu(
					input.node,
					input.vmid,
					input.cpuCores,
					input.memoryMB,
					input.credentials,
					input.sshPublicKeys,
					input.networkConfig,
				),
		);
	}

	async getVmStatus(node: string, vmid: number): Promise<string> {
		return this.recordCall(
			"/api2/json/nodes/{node}/qemu/{vmid}/status/current",
			"GET",
			() => qemu.getQemuStatus(node, vmid),
		);
	}

	async startVm(node: string, vmid: number): Promise<string> {
		return this.recordCall(
			"/api2/json/nodes/{node}/qemu/{vmid}/status/start",
			"POST",
			() => qemu.setQemuStatus(node, vmid, "start"),
		);
	}

	async stopVm(node: string, vmid: number): Promise<string> {
		return this.recordCall(
			"/api2/json/nodes/{node}/qemu/{vmid}/status/stop",
			"POST",
			() => qemu.setQemuStatus(node, vmid, "stop"),
		);
	}

	async resetVm(node: string, vmid: number): Promise<string> {
		return this.recordCall(
			"/api2/json/nodes/{node}/qemu/{vmid}/status/reset",
			"POST",
			() => qemu.setQemuStatus(node, vmid, "reset"),
		);
	}

	async deleteVm(node: string, vmid: number): Promise<void> {
		await this.recordCall("/api2/json/nodes/{node}/qemu/{vmid}", "DELETE", () =>
			qemu.deleteQemu(node, vmid),
		);
	}

	async waitForGuestAgent(node: string, vmid: number): Promise<void> {
		await this.recordCall(
			"/api2/json/nodes/{node}/qemu/{vmid}/agent/info",
			"GET",
			() => qemu.agentCheckQemu(node, vmid),
		);
	}

	async setGuestUserPassword(
		node: string,
		vmid: number,
		username: string,
		password: string,
	): Promise<void> {
		await this.recordCall(
			"/api2/json/nodes/{node}/qemu/{vmid}/agent/set-user-password",
			"POST",
			() => qemu.setQemuGuestUserPassword(node, vmid, username, password),
		);
	}

	async setGuestHostname(
		node: string,
		vmid: number,
		hostname: string,
	): Promise<void> {
		await this.recordCall(
			"/api2/json/nodes/{node}/qemu/{vmid}/agent/exec",
			"POST",
			() => qemu.setQemuGuestHostname(node, vmid, hostname),
		);
	}

	private async recordCall<T>(
		endpoint: string,
		method: string,
		operation: () => Promise<T>,
	): Promise<T> {
		const startTime = performance.now();

		try {
			const result = await operation();
			const durationSeconds = (performance.now() - startTime) / 1000;
			pveApiCallsTotal.inc({ endpoint, method, status: "success" });
			pveApiCallDurationSeconds.observe({ endpoint, method }, durationSeconds);
			return result;
		} catch (error) {
			const durationSeconds = (performance.now() - startTime) / 1000;
			pveApiCallsTotal.inc({ endpoint, method, status: "error" });
			pveApiCallDurationSeconds.observe({ endpoint, method }, durationSeconds);
			throw error;
		}
	}
}
