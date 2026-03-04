import { pveApi } from "@yuzu/pve/api";

// Clean all instances with vmid >= 1000
async function cleanInstances() {
  const nodesRes = await pveApi.GET("/api2/json/nodes");

  if (nodesRes.data && nodesRes.data.data) {
    for (const node of nodesRes.data.data) {
      const vmsRes = await pveApi.GET("/api2/json/nodes/{node}/qemu", {
        params: {
          path: { node: node.node },
        },
      });

      if (vmsRes.data && vmsRes.data.data) {
        for (const vm of vmsRes.data.data) {
          if (vm.vmid >= 1000) {
            console.log(`Deleting VM ${vm.vmid} on node ${node.node}`);
            // Check if VM is running and stop it before deletion
            const statusRes = await pveApi.GET("/api2/json/nodes/{node}/qemu/{vmid}/status/current", {
              params: {
                path: { node: node.node, vmid: vm.vmid.toString() },
              },
            });

            if (statusRes.data && statusRes.data.data) {
              const status = statusRes.data.data.status;
              if (status === "running") {
                console.log(`Stopping VM ${vm.vmid} on node ${node.node} before deletion`);
                await pveApi.POST(`/api2/json/nodes/{node}/qemu/{vmid}/status/stop`, {
                  params: {
                    path: { node: node.node, vmid: vm.vmid.toString() },
                  },
                  body: {},
                });
              }

              await pveApi.DELETE("/api2/json/nodes/{node}/qemu/{vmid}", {
                params: {
                  path: { node: node.node, vmid: vm.vmid.toString() },
                },
              });
            }
          }
        }
      }
    }
  }
}

cleanInstances();
