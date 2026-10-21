import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const emptyToUndefined = (value: unknown) =>
  value === "" || value === undefined || value === null ? undefined : value;

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  /**
   * Loopback by default: nginx is the only way in, so a firewall slip can't
   * expose the port (where X-Forwarded-For would dodge the IP rate limit).
   * 0.0.0.0 to reach a local dev server from a phone on the LAN.
   */
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  CORS_ORIGINS: z.string().default(""),
  FATSECRET_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  FATSECRET_CLIENT_SECRET: z.preprocess(
    emptyToUndefined,
    z.string().optional(),
  ),
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Push worker's least-privilege login (`npm run db:push-role`). */
  PUSH_DATABASE_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  SUPABASE_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  SUPABASE_ANON_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  SUPABASE_SERVICE_ROLE_KEY: z.preprocess(
    emptyToUndefined,
    z.string().optional(),
  ),
  /** Optional: only needed if "Enhanced push security" is on in Expo. */
  EXPO_ACCESS_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
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

/** JWKS verification needs the project URL. Fail closed in requireAuth if missing. */
export function isJwtConfigured(): boolean {
  return Boolean(env.SUPABASE_URL);
}

/** User-scoped PostgREST client (anon key + user JWT). */
export function isSupabaseUserClientConfigured(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
}

export function getSupabaseUrl(): string | undefined {
  const raw = env.SUPABASE_URL?.trim();
  if (!raw) return undefined;
  return raw.replace(/\/$/, "");
}

export function parseCorsOrigins(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "*") {
    return [];
  }
  return trimmed
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
