import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../types/api";
import { env, getSupabaseUrl, isSupabaseUserClientConfigured } from "./env";

/**
 * PostgREST client that runs as the end user so RLS `auth.uid()` applies.
 * Never use the service role on request paths.
 */
export function createUserSupabaseClient(accessToken: string): SupabaseClient {
  const url = getSupabaseUrl();
  if (!url || !env.SUPABASE_ANON_KEY || !isSupabaseUserClientConfigured()) {
    throw new AppError(
      503,
      "SERVICE_UNAVAILABLE",
      "Supabase is not configured",
    );
  }

  return createClient(url, env.SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
