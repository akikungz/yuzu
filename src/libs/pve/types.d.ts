export type PVE_Node = {
  status: "online" | "offline";
  node: string;
  uptime: number;
  cpu: number;
  maxcpu: number;
  mem: number;
  maxmem: number;
}

export type PVE_QEMU = {
  vmid: number;
  name: string;
  status: "running" | "stopped" | "suspended";
  uptime: number;
  cpu: number;
  cpus: number;
  mem: number;
  maxmem: number;
  maxdisk: number;
}

export type PVE_NodeParams = { node: string };
export type PVE_VMParams = PVE_NodeParams & { vmid: number };
export type PVE_EmptyResponse = Record<string, never>;

export interface PVE_API {
  "/nodes/": {
    GET: {
      request: {};
      response: {
        data: PVE_Node[];
        status: number;
      };
    };
  };

  "/nodes/:node/status": {
    GET: {
      request: {
        params: PVE_NodeParams;
        headers: {
          "Accept": "application/json";
        }
      };
      response: {
        data: PVE_Node;
      };
    };
  };

  "/nodes/:node/qemu": {
    GET: {
      request: {
        params: PVE_NodeParams;
        headers?: {
          "Accept": "application/json";
        };
      };
      response: {
        data: PVE_QEMU[];
      };
    };
  };

  "/nodes/:node/qemu/:vmid": {
    GET: {
      request: {
        params: PVE_VMParams;
        headers?: {
          "Accept": "application/json";
        };
      };
      response: {
        data: PVE_QEMU;
      };
    };
    DELETE: {
      request: {
        params: PVE_VMParams;
        body: {
          "destroy-unreferenced-disks"?: boolean;
          "purge"?: boolean;
          "skiplock"?: boolean;
        }
      };
      response: PVE_EmptyResponse;
    };
  };

  "/nodes/:node/qemu/:vmid/status/current": {
    GET: {
      request: {
        params: VMParams;
        headers?: {
          "Accept": "application/json";
        };
      };
      response: {
        data: PVE_QEMU;
      };
    };
  };

  "/nodes/:node/qemu/:vmid/status/:state": {
    POST: {
      request: {
        params: VMParams & {
          state: "start" | "shutdown" | "restart" | "resume";
        };
        headers?: {
          "Accept": "application/json";
          "Content-Type": "application/x-www-form-urlencoded" | "application/json";
        };
      };
      response: PVE_EmptyResponse;
    };
  };

  "/nodes/:node/qemu/:vmid/clone": {
    POST: {
      request: {
        params: VMParams;
        headers?: {
          "Accept": "application/json";
          "Content-Type": "application/x-www-form-urlencoded" | "application/json";
        };
        body: {
          newid: number;
          name: string;
          target?: string;
        };
      };
      response: PVE_EmptyResponse;
    };
  };

  "/nodes/:node/qemu/:vmid/config": {
    GET: {
      request: {
        params: VMParams;
        headers?: {
          "Accept": "application/json";
          "Content-Type": "application/x-www-form-urlencoded" | "application/json";
        };
      };
      response: {
        data: Record<string, any>;
      };
    };
    POST: {
      request: {
        params: VMParams;
        body: {
          // Network configuration
          ipconfig0?: string;
          // Cloud-init configuration
          cicustom?: string;
          ciuser?: string;
          cipassword?: string;
          sshkeys?: string;
          // CPU and memory configuration
          cores?: number;
          memory?: number;
        };
      };
      response: PVE_EmptyResponse;
    };
    PUT: {
      request: {
        params: VMParams;
        headers?: {
          "Accept": "application/json";
          "Content-Type": "application/x-www-form-urlencoded" | "application/json";
        };
        body: {
          // Network configuration
          ipconfig0?: string;
          // Cloud-init configuration
          cicustom?: string;
          ciuser?: string;
          cipassword?: string;
          sshkeys?: string;
          // CPU and memory configuration
          cores?: number;
          memory?: number;
        };
      };
      response: PVE_EmptyResponse;
    };
  };

  "/nodes/:node/qemu/:vmid/resize": {
    PUT: {
      request: {
        params: VMParams;
        headers?: {
          "Accept": "application/json";
          "Content-Type": "application/x-www-form-urlencoded" | "application/json";
        };
        body: {
          disk: string;
          size: string;
        };
      };
      response: PVE_EmptyResponse;
    };
  };
}
