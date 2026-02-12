import z from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PVE_API_TOKEN_ID: z.string().min(1),
  PVE_API_TOKEN_SECRET: z.string().min(1),
  PVE_API_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  LOG_PRETTY: z.coerce.boolean().default(false),
  METRICS_PORT: z.coerce.number().default(9090),
});

const _safeEnv = envSchema.safeParse(process.env);
if (!_safeEnv.success) {
  console.error("❌ Invalid environment variables:", z.formatError(_safeEnv.error));
  throw new Error("Invalid environment variables");
}

export const env = _safeEnv.data;
export type Env = typeof env;
