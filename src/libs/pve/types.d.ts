export interface PVE_Node {
  status: "online" | "offline";
  node: string;
  uptime: number;
  cpu: number;
  maxcpu: number;
  mem: number;
  maxmem: number;
}

export interface PVE_QEMU {
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

export interface PVE_Request<
  Params extends Record<string, never> = Record<string, never>,
  Headers extends Record<string, never> = Record<string, never>,
  Body extends Record<string, never> = Record<string, never>
> {
  params?: Params;
  headers?: Headers;
  body?: Body;
}

export interface PVE_Response<Data extends Record<string, never> = Record<string, never>> {
  data: Data;
}

export interface PVE_NodeParams {
  node: string;
}

export interface PVE_VMParams extends PVE_NodeParams {
  vmid: number;
}

export type PVE_EmptyResponse = Record<string, never>;

export interface PVE_FullRequest<
  Req extends PVE_Request = PVE_Request, 
  Res extends PVE_Response = PVE_Response
> {
  request: Req;
  response: Res;
}

export interface PVE_API {
  "/nodes/": {
    GET: PVE_FullRequest<
      PVE_Request<{}, { Accept: "application/json" }>,
      PVE_Response<PVE_Node[]>
    >;
  };

  "/nodes/:node/status": {
    GET: PVE_FullRequest<
      PVE_Request<PVE_NodeParams, { Accept: "application/json" }>,
      PVE_Response<PVE_Node>
    >;
  };

  "/nodes/:node/qemu": {
    GET: PVE_FullRequest<
      PVE_Request<PVE_NodeParams, { Accept?: "application/json" }>,
      PVE_Response<PVE_QEMU[]>
    >;
  };

  "/nodes/:node/qemu/:vmid/status/current": {
    GET: PVE_FullRequest<
      PVE_Request<PVE_VMParams, { Accept: "application/json" }>,
      PVE_Response<PVE_QEMU>
    >;
  };

  "/nodes/:node/qemu/:vmid/status/:state": {
    POST: PVE_FullRequest<
      PVE_Request<PVE_VMParams & {
        state: "start" | "stop" | "suspend" | "resume";
      }, { Accept: "application/json" }>,
      PVE_Response<PVE_EmptyResponse>
    >;
  };

  "/nodes/:node/qemu/:vmid/clone": {
    POST: PVE_FullRequest<
      PVE_Request<PVE_VMParams, { Accept: "application/json" }, {
        newid: number;
        name: string;
        target?: string;
      }>,
      PVE_Response<PVE_EmptyResponse>
    >;
  };

  "/nodes/:node/qemu/:vmid/config": {
    GET: PVE_FullRequest<
      PVE_Request<PVE_VMParams, { Accept?: "application/json" }>,
      PVE_Response<Record<string, unknown>>
    >;

    POST: PVE_FullRequest<
      PVE_Request<PVE_VMParams, { Accept: "application/json" }, {
        // Network configuration
        ipconfig0?: `ip=${string}/${number},gw=${string}`;
        // Cloud-init configuration
        cicustom?: string;
        ciuser?: string;
        cipassword?: string;
        sshkeys?: string;
        // CPU configuration
        cores?: number;
        memory?: number;
      }>,
      PVE_Response<PVE_EmptyResponse>
    >;

    PUT: PVE_API["/nodes/:node/qemu/:vmid/config"]["POST"];
  };

  "/nodes/:node/qemu/:vmid/resize": {
    POST: PVE_FullRequest<
      PVE_Request<PVE_VMParams, { Accept: "application/json" }, {
        memory?: number;
        cores?: number;
      }>,
      PVE_Response<PVE_EmptyResponse>
    >;
  };
}
