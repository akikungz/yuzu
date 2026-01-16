import { logger } from "@yuzu/logger";
import { pveApi } from "@yuzu/pve/api";

new Array(36).fill(0).forEach(async (_, i) => {
  const vmid = 1000 + i;

  await pveApi.DELETE("/api2/json/nodes/{node}/qemu/{vmid}", {
    params: {
      path: { node: "pve-9", vmid: vmid.toString() },
    },
  });
});
