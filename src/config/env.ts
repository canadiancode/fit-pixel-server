import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const emptyToUndefined = (value: unknown) =>
  value === "" || value === undefined || value === null ? undefined : value;

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  CORS_ORIGINS: z.string().default("*"),
  FATSECRET_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  FATSECRET_CLIENT_SECRET: z.preprocess(
    emptyToUndefined,
    z.string().optional(),
  ),
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  SUPABASE_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  SUPABASE_ANON_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  SUPABASE_SERVICE_ROLE_KEY: z.preprocess(
    emptyToUndefined,
    z.string().optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  return parsed.data;
}

export const env = loadEnv();

export function isFatSecretConfigured(): boolean {
  return Boolean(env.FATSECRET_CLIENT_ID && env.FATSECRET_CLIENT_SECRET);
}

export function parseCorsOrigins(raw: string): string[] | "*" {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "*") {
    return "*";
  }
  return trimmed
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
