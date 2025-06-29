import { z } from 'zod';

export const envSchema = z.object({
  PVE_API_TOKEN: z.string().min(1, 'PVE_API_TOKEN is required'),
  PVE_API_TOKEN_NAME: z.string().min(1, 'PVE_API_TOKEN_NAME is required'),
  PVE_API_TOKEN_USER: z.string().min(1, 'PVE_API_TOKEN_USER is required'),
  PVE_API_URL: z.string().url('PVE_API_URL must be a valid URL').min(1, 'PVE_API_URL is required'),
  PVE_NODES: z.array(z.string()).min(1, 'PVE_NODES must contain at least one node'),
}).strict();

export type Env = z.infer<typeof envSchema>;

export function validateEnv(env: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Environment validation failed: ${parsed.error.message}`);
  }
  return parsed.data;
}

export const env: Env = validateEnv({
  PVE_API_TOKEN: process.env.PVE_API_TOKEN,
  PVE_API_TOKEN_NAME: process.env.PVE_API_TOKEN_NAME,
  PVE_API_TOKEN_USER: process.env.PVE_API_TOKEN_USER,
  PVE_API_URL: process.env.PVE_API_URL,
  PVE_NODES: process.env.PVE_NODES?.split(',') || [],
});

export const pve_auth_header = `PVEAPIToken=${env.PVE_API_TOKEN_USER}!${env.PVE_API_TOKEN_NAME}=${env.PVE_API_TOKEN}`;