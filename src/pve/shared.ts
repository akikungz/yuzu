import { logger } from "@yuzu/logger";
import { pveApi } from "./api";

interface UPIDStatusResult {
  status: string;
  exitstatus?: string;
  type?: string;
  starttime?: number;
  pid?: number;
}

/**
 * Fetch and log the status of a UPID task until it is no longer running.
 * @param node Proxmox VE node name
 * @param upid The UPID of the task to monitor
 * @param options Configuration options for the status check
 * @returns Promise that resolves when the task is no longer running
 */
export const upidStatusCheck = async (
  node: string,
  upid: string,
  options: {
    pollInterval?: number;
    maxWaitTime?: number;
    logProgress?: boolean;
  } = {}
): Promise<UPIDStatusResult> => {
  const {
    pollInterval = 2000,
    maxWaitTime = 300000, // 5 minutes default timeout
    logProgress = true
  } = options;

  const startTime = performance.now();
  const taskLog = logger.child({ node, upid: upid.slice(-20), operation: "upid-check" });

  if (logProgress) {
    taskLog.debug("Starting task status monitoring");
  }

  return new Promise<UPIDStatusResult>((resolve, reject) => {
    let pollCount = 0;

    const upidInterval = setInterval(async () => {
      pollCount++;
      const elapsed = performance.now() - startTime;

      // Check for timeout
      if (elapsed > maxWaitTime) {
        clearInterval(upidInterval);
        taskLog.error({ elapsed: `${elapsed.toFixed(0)}ms`, pollCount }, "Task monitoring timed out");
        reject(new Error(`UPID task timed out after ${(maxWaitTime / 1000).toFixed(0)}s: ${upid}`));
        return;
      }

      try {
        const statusRes = await pveApi.GET("/api2/json/nodes/{node}/tasks/{upid}/status", {
          params: { path: { node, upid } },
        });

        if (statusRes.data?.data) {
          const data = statusRes.data.data;
          const status = data.status;

          if (logProgress && pollCount % 5 === 0) {
            // Log progress every 5 polls to reduce noise
            taskLog.debug({
              status,
              elapsed: `${elapsed.toFixed(0)}ms`,
              pollCount
            }, "Task still running");
          }

          if (status === "stopped") {
            clearInterval(upidInterval);
            const totalTime = performance.now() - startTime;

            const result: UPIDStatusResult = {
              status,
              exitstatus: data.exitstatus ?? undefined,
              type: data.type ?? undefined,
              starttime: data.starttime ?? undefined,
              pid: data.pid ?? undefined,
            };

            if (data.exitstatus && data.exitstatus !== "OK") {
              taskLog.warn({
                ...result,
                duration: `${totalTime.toFixed(0)}ms`
              }, "Task completed with non-OK status");
            } else if (logProgress) {
              taskLog.info({
                duration: `${totalTime.toFixed(0)}ms`,
                exitstatus: data.exitstatus
              }, "Task completed successfully");
            }

            resolve(result);
          }
        } else {
          clearInterval(upidInterval);
          taskLog.error({ response: statusRes }, "Failed to get task status - empty response");
          reject(new Error(`Failed to get status for UPID ${upid} on node ${node}: empty response`));
        }
      } catch (err) {
        clearInterval(upidInterval);
        const error = err as Error;
        taskLog.error({
          err: { message: error.message, stack: error.stack },
          pollCount,
          elapsed: `${(performance.now() - startTime).toFixed(0)}ms`
        }, "Error polling task status");
        reject(new Error(`Failed to poll UPID ${upid}: ${error.message}`));
      }
    }, pollInterval);
  });
}

/**
 * Get the node with the least load based on CPU and memory usage.
 * @returns Promise that resolves to the name of the node with the least load 
 */
export const getNodeWithLeastLoad = async (): Promise<string> => {
  const nodesRes = await pveApi.GET("/api2/json/nodes");
  if (nodesRes.data && nodesRes.data.data) {
    let onlineNodes = nodesRes.data.data.filter((node: any) => node.status === 'online');

    if (onlineNodes.length === 0) {
      throw new Error("No online nodes available");
    }

    onlineNodes = onlineNodes.sort((a, b) => {
      const cpus = (!!a.cpu && !!a.maxcpu && !!b.cpu && !!b.maxcpu) ?
        (a.cpu / a.maxcpu) - (b.cpu / b.maxcpu) :
        0;

      const mem = (!!a.mem && !!a.maxmem && !!b.mem && !!b.maxmem) ?
        (a.mem / a.maxmem) - (b.mem / b.maxmem) :
        0;

      return cpus + mem;
    });

    if (onlineNodes[0]) {
      return onlineNodes[0].node;
    }

    logger.error("Failed to determine node with least load");
    throw new Error("Failed to determine node with least load");
  }

  logger.error("Failed to get nodes");
  throw new Error("Failed to get nodes");
}

export interface VmidWithNode {
  vmid: number;
  node: string;
}

/**
 * Get a list of all QEMU VMs across all nodes.
 * @returns Promise that resolves to an array of objects containing vmid and node
 */
export const listQemuVmsAllNodes = async (): Promise<VmidWithNode[]> => {
  const nodesRes = await pveApi.GET("/api2/json/nodes");

  if (nodesRes.data && nodesRes.data.data) {
    const allVms: VmidWithNode[] = [];
    for (const node of nodesRes.data.data) {
      const vmsRes = await pveApi.GET("/api2/json/nodes/{node}/qemu", {
        params: {
          path: { node: node.node },
        },
      });
      if (vmsRes.data && vmsRes.data.data) {
        allVms.push(
          ...vmsRes.data.data.map(
            (vm) => ({ vmid: vm.vmid, node: node.node })
          )
        );
      }
    }

    return allVms;
  }

  logger.error("Failed to get nodes for listing VMs");
  throw new Error("Failed to get nodes for listing VMs");
}

/**
 * Get a list of all LXC VMs across all nodes.
 * @returns Promise that resolves to an array of objects containing vmid and node
 */
export const listLxcVmsAllNodes = async (): Promise<VmidWithNode[]> => {
  const nodesRes = await pveApi.GET("/api2/json/nodes");

  if (nodesRes.data && nodesRes.data.data) {
    const allVms: VmidWithNode[] = [];

    for (const node of nodesRes.data.data) {
      const vmsRes = await pveApi.GET("/api2/json/nodes/{node}/lxc", {
        params: {
          path: { node: node.node },
        },
      });

      if (vmsRes.data && vmsRes.data.data) {
        allVms.push(
          ...vmsRes.data.data.map(
            (vm) => ({ vmid: vm.vmid, node: node.node })
          )
        );
      }
    }

    return allVms;
  }

  logger.error("Failed to get nodes for listing LXC VMs");
  throw new Error("Failed to get nodes for listing LXC VMs");
}

/**
 * Get the maximum VMID currently in use across all QEMU and LXC VMs.
 * @returns Promise that resolves to the maximum VMID number 
 */
export const getMaxVmid = async (): Promise<number> => {
  const vms = [
    ...(await listQemuVmsAllNodes()),
    ...(await listLxcVmsAllNodes()),
  ];

  const vmids = vms.map(vm => vm.vmid);
  const maxVmid = vmids.length > 0 ? Math.max(...vmids) : 100;

  return maxVmid;
}

/**
 * Generate the next available VMID, starting from a base value.
 * @param base The base VMID to start from (default: 1000)
 * @returns Promise that resolves to the next available VMID number
 */
export const generateNextVmid = async (prevId?: number, base: number = 1000): Promise<number> => {
  if (prevId && prevId >= base) {
    return prevId + 1;
  }

  const maxVmid = await getMaxVmid();
  if (maxVmid < base) {
    return base;
  }

  return maxVmid + 1;
}
