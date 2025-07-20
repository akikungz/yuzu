import { z } from 'zod';

export const envSchema = z.object({
  PVE_API_TOKEN: z.string()
    .min(1, {
      message: 'PVE_API_TOKEN is required'
    }),
  PVE_API_TOKEN_NAME: z.string()
    .min(1, {
      message: 'PVE_API_TOKEN_NAME is required'
    }),
  PVE_API_TOKEN_USER: z.string()
    .min(1, {
      message: 'PVE_API_TOKEN_USER is required'
    }),
  PVE_API_URL: z.string()
    .url({
      message: 'PVE_API_URL must be a valid URL'
    })
    .min(1, {
      message: 'PVE_API_URL is required'
    }),
  PVE_NODES: z.preprocess(
    (val) => {
      if (typeof val === 'string') {
        return val.split(',').map((node) => node.trim());
      }
      return val;
    },
    z.array(z.string())
      .nonempty({
        message: 'PVE_NODES must be a non-empty array of strings'
      })
  ),
}).strict();

export type Env = z.infer<typeof envSchema>;

export const parseEnv = envSchema.safeParse(process.env);
if (!parseEnv.success) {
  console.error('Invalid environment variables:', parseEnv.error.message);
  process.exit(1);
}

export const env = parseEnv.data as Env;

export const pve_auth_header = `PVEAPIToken=${env.PVE_API_TOKEN_USER}!${env.PVE_API_TOKEN_NAME}=${env.PVE_API_TOKEN}`;
