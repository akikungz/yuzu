import { env } from "@yuzu/infrastructure/config/env";
import createClient from "openapi-fetch";
import type { paths } from "./type";

export const pveApi = createClient<paths>({
	baseUrl: `${env.PVE_API_URL}`,
	headers: {
		Authorization: `PVEAPIToken=${env.PVE_API_TOKEN_ID}=${env.PVE_API_TOKEN_SECRET}`,
	},
	fetch: (request) =>
		fetch(request, {
			tls: {
				rejectUnauthorized: false,
			},
		}),
});
