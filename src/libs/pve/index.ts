import https from "https";
import axios from "axios";
import { env, pve_auth_header } from "@yuzu/libs/env";
import * as PVE from "./types";

type ExtractRequest<API> = API extends { request: infer Req } ? Req : {};
type ExtractResponse<API> = API extends { response: infer Res } ? Res : never;

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

export async function pve_api<
  Path extends keyof PVE.PVE_API,
  Method extends keyof PVE.PVE_API[Path],
  Req extends ExtractRequest<PVE.PVE_API[Path][Method]>
>(
  path: Path,
  method: Method,
  request: Req
): Promise<{
  data: ExtractResponse<PVE.PVE_API[Path][Method]>;
  status: number;
}> {
  const { params = {}, body, headers } = request as Partial<{
    params: Record<string, string | number>;
    body: Record<string, unknown>;
    headers: Record<string, string>;
  }>;

  const resolvedPath = path.replace(/:([a-zA-Z_]+)/g, (_, key) => {
    const value = params?.[key];
    if (value === undefined) {
      throw new Error(`Missing required param: ${key}`);
    }
    return encodeURIComponent(String(value));
  });

  const url = `${env.PVE_API_URL}${resolvedPath}`;

  const processHeaders: Record<string, string> = {
    "Authorization": pve_auth_header,
    "Accept": "application/json",
    "Content-Type": headers?.["Content-Type"] || "application/json",
  };

  const data = processHeaders["Content-Type"] === "application/x-www-form-urlencoded"
    ? new URLSearchParams(body as Record<string, string>).toString()
    : body;

  console.log(data);

  const response = await axios({
    url,
    method: method.toString().toUpperCase(),
    headers: processHeaders,
    data: method === "get" ? undefined : data,
    httpsAgent,
  });

  return {
    data: response.data as ExtractResponse<PVE.PVE_API[Path][Method]>,
    status: response.status,
  };
}

export const sshkey_encoded = (key: string) => encodeURIComponent(key);

export const ipv4_config = (cidr: string, gateway: string): string => `ipconfig0=${cidr}&ipconfig1=${gateway}`;
