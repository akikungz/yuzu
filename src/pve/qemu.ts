import { logger } from "@yuzu/logger";
import { pveApi } from "./api";
import { upidStatusCheck } from "./shared";

/**
 * Clone a QEMU VM
 * @param node the node where the source VM is located
 * @param vmid the ID of the source VM
 * @param newVmid the ID for the new cloned VM
 * @param targetNode the node where the cloned VM will be created
 * @returns The UPID of the clone task
 */
export const cloneQemu = async (
  node: string,
  vmid: number,
  newVmid: number,
  targetNode: string,
  hostname: string
) => {
  // Start the clone operation
  const cloneRes = await pveApi.POST("/api2/json/nodes/{node}/qemu/{vmid}/clone", {
    params: {
      path: { node, vmid: vmid.toString() },
    },
    body: {
      newid: newVmid,
      target: targetNode,
      full: false,
      name: hostname,
    },
  });

  if (cloneRes.data && cloneRes.data.data) {
    const upid = cloneRes.data.data;
    logger.info(`Clone task started with UPID: ${upid}`);

    return upid;
  }

  logger.error("Failed to start clone task");
  logger.trace(cloneRes);
  throw new Error("Failed to start clone task");
}

/**
 * Resize a QEMU VM disk
 * @param node The node where the VM is located
 * @param vmid The ID of the VM
 * @param targetSize The new size for the disk in GB
 * @returns The UPID of the resize task
 */
export const resizeQemuDisk = async (
  node: string,
  vmid: number,
  targetSize: number
) => {
  // Resize the disk
  const resizeDiskRes = await pveApi.PUT("/api2/json/nodes/{node}/qemu/{vmid}/resize", {
    params: {
      path: { node, vmid: vmid.toString() },
    },
    body: {
      disk: "scsi0",
      size: `+${targetSize}G`,
    },
  });

  if (resizeDiskRes.data && resizeDiskRes.data.data) {
    const upid = resizeDiskRes.data.data;
    logger.info(`Resize disk task started with UPID: ${upid}`);

    return upid;
  }

  logger.error("Failed to start resize disk task");
  logger.trace(resizeDiskRes);
  throw new Error("Failed to start resize disk task");
}

/**
 * Edit QEMU VM specifications and network configuration
 * @param node The node where the VM is located
 * @param vmid The ID of the VM
 * @param cpuCores CPU core count
 * @param memorySizeMB Memory size in MB
 * 
 */
export const editQemu = async (
  node: string,
  vmid: number,
  cpuCores: number,
  memorySizeMB: number,
  credentials: {
    username: string;
    password: string;
  },
  sshPublicKeys: string[],
  ipconfig: {
    bridge: string;
    vlan: number;
    ip: string;
    gw: string;
  }
) => {
  const normalizedSshKeys = sshPublicKeys
    .map((key) => key.trim())
    .filter((key) => key.length > 0);

  // Proxmox expects `sshkeys` as a URL-encoded string (newline-delimited keys).
  const encodedSshKeys = encodeURIComponent(normalizedSshKeys.join("\n"));

  const editRes = await pveApi.PUT("/api2/json/nodes/{node}/qemu/{vmid}/config", {
    params: {
      path: { node, vmid: vmid.toString() },
    },
    body: {
      cores: cpuCores,
      memory: memorySizeMB.toString(),
      "net0": `virtio,bridge=${ipconfig.bridge},tag=${ipconfig.vlan}`,
      "ipconfig0": `ip=${ipconfig.ip},gw=${ipconfig.gw}`,
      ciuser: credentials.username,
      cipassword: credentials.password,
      cicustom: "user=cephfs:snippets/allow_ssh.yaml",
      ...(normalizedSshKeys.length > 0 ? { sshkeys: encodedSshKeys } : {}),
    },
  });

  if (editRes.response.ok) {
    logger.info(`Updated VM ${vmid} specs successfully.`);
  } else {
    logger.error("Failed to update VM specs");
    logger.error(editRes);
    throw new Error("Failed to update VM specs");
  }
}

/**
 * Get the current status of a QEMU VM
 * @param node The node where the VM is located
 * @param vmid The ID of the VM
 * @returns Status string (e.g., "running", "stopped")
 */
export const getQemuStatus = async (node: string, vmid: number) => {
  const statusRes = await pveApi.GET("/api2/json/nodes/{node}/qemu/{vmid}/status/current", {
    params: {
      path: { node, vmid: vmid.toString() },
    },
  });

  if (statusRes.data && statusRes.data.data) {
    return statusRes.data.data.status;
  } else {
    logger.error("Failed to get VM status");
    logger.trace(statusRes);
    throw new Error("Failed to get VM status");
  }
}

/**
 * Set the status of a QEMU VM
 * @param node The node where the VM is located
 * @param vmid The ID of the VM
 * @param action Status action: "start", "stop", "reset", "shutdown"
 * @returns The UPID of the status change task 
 */
export const setQemuStatus = async (
  node: string,
  vmid: number,
  action: "start" | "stop" | "reset" | "shutdown"
) => {
  const statusRes = await pveApi.POST(`/api2/json/nodes/{node}/qemu/{vmid}/status/${action}`, {
    params: {
      path: { node, vmid: vmid.toString() },
    },
    body: {},
  });

  if (statusRes.data && statusRes.data.data) {
    const upid = statusRes.data.data;
    logger.info(`${action} VM task started with UPID: ${upid}`);

    return upid;
  }

  logger.error(`Failed to ${action} VM`);
  logger.trace(statusRes);
  throw new Error(`Failed to ${action} VM`);
}

/**
 * Check if QEMU Agent is running for a VM
 * @param node The node where the VM is located
 * @param vmid The ID of the VM
 * @param options Configuration options for the agent check
 * @returns Promise that resolves when the agent is detected
 */
export const agentCheckQemu = (
  node: string,
  vmid: number,
  options: {
    pollInterval?: number;
    maxWaitTime?: number;
  } = {}
): Promise<void> => {
  const {
    pollInterval = 5000,
    maxWaitTime = 300000, // 5 minutes
  } = options;

  const startTime = performance.now();
  const agentLog = logger.child({ node, vmid, operation: "agent-check" });

  agentLog.debug("Starting QEMU Guest Agent detection");

  return new Promise<void>((resolve, reject) => {
    let pollCount = 0;

    const agentInterval = setInterval(async () => {
      pollCount++;
      const elapsed = performance.now() - startTime;

      // Check for timeout
      if (elapsed > maxWaitTime) {
        clearInterval(agentInterval);
        agentLog.error({
          elapsed: `${elapsed.toFixed(0)}ms`,
          pollCount
        }, "QEMU Guest Agent detection timed out");
        reject(new Error(`QEMU Guest Agent not responding after ${(maxWaitTime / 1000).toFixed(0)}s for VM ${vmid}`));
        return;
      }

      try {
        const agentRes = await pveApi.GET("/api2/json/nodes/{node}/qemu/{vmid}/agent/info", {
          params: { path: { node, vmid: vmid.toString() } },
        });

        if (agentRes.data?.data) {
          clearInterval(agentInterval);
          const totalTime = performance.now() - startTime;
          agentLog.info({
            duration: `${totalTime.toFixed(0)}ms`,
            pollCount
          }, "QEMU Guest Agent is responsive");
          resolve();
        } else if (pollCount % 3 === 0) {
          // Log every 3rd attempt to reduce noise
          agentLog.debug({
            elapsed: `${elapsed.toFixed(0)}ms`,
            pollCount
          }, "Waiting for QEMU Guest Agent...");
        }
      } catch (err) {
        // Agent not ready yet, continue polling (don't reject on transient errors)
        if (pollCount % 3 === 0) {
          agentLog.debug({
            elapsed: `${elapsed.toFixed(0)}ms`,
            pollCount
          }, "Agent not ready, continuing to poll...");
        }
      }
    }, pollInterval);
  });
};

/**
 * Set a guest user password through QEMU Guest Agent
 * @param node The node where the VM is located
 * @param vmid The ID of the VM
 * @param username The guest username
 * @param password The new guest password
 */
export const setQemuGuestUserPassword = async (
  node: string,
  vmid: number,
  username: string,
  password: string
) => {
  const setPasswordRes = await pveApi.POST("/api2/json/nodes/{node}/qemu/{vmid}/agent/set-user-password", {
    params: {
      path: { node, vmid: vmid.toString() },
    },
    body: {
      username,
      password,
      crypted: false,
    },
  });

  if (setPasswordRes.response.ok) {
    logger.info(`Updated guest password for VM ${vmid} user ${username}.`);
    return;
  }

  logger.error(`Failed to set guest password for VM ${vmid} user ${username}.`);
  logger.trace(setPasswordRes);
  throw new Error(`Failed to set guest password for VM ${vmid} user ${username}.`);
}

/**
 * Delete a QEMU VM
 * @param node The node where the VM is located
 * @param vmid The ID of the VM
 * @returns Promise that resolves when the VM is deleted
 */
export const deleteQemu = async (node: string, vmid: number) => {
  const currentStatus = await getQemuStatus(node, vmid);

  if (currentStatus === "running") {
    logger.info(`Stopping VM ${vmid} on node ${node} before deletion.`);
    const stopUpid = await setQemuStatus(node, vmid, "stop");
    await upidStatusCheck(node, stopUpid);
  }

  const deleteRes = await pveApi.DELETE("/api2/json/nodes/{node}/qemu/{vmid}", {
    params: {
      path: { node, vmid: vmid.toString() },
    },
  });

  if (deleteRes.response.ok) {
    logger.info(`Deleted VM ${vmid} on node ${node} successfully.`);
    return Promise.resolve();
  }

  logger.error(`Failed to delete VM ${vmid} on node ${node}.`);
  logger.trace(deleteRes);
  throw new Error(`Failed to delete VM ${vmid} on node ${node}.`);
}
