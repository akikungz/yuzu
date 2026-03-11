import createClient from "openapi-fetch";
import { Agent } from "undici";

import type { paths } from "./type";
import { env } from "@yuzu/env";

// Disable SSL certificate verification for self-signed certificates in development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

export const pveApi = createClient<paths>({
  baseUrl: `${env.PVE_API_URL}`,
  headers: {
    Authorization: `PVEAPIToken=${env.PVE_API_TOKEN_ID}=${env.PVE_API_TOKEN_SECRET}`,
  },
  dispatcher: new Agent({
    connect: {
      rejectUnauthorized: false,
    }
  }),
});
