import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../types/api";
import { env, getSupabaseUrl, isSupabaseUserClientConfigured } from "./env";

/**
 * supabase-js always constructs RealtimeClient. Node 20 has no global WebSocket,
 * so createClient throws unless we supply a transport. This API never subscribes.
 */
class UnusedRealtimeTransport {
  readonly url: string;
  readonly readyState = 3;
  constructor(url: string) {
    this.url = url;
  }
  close(): void {}
  send(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

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
    realtime: {
      transport: UnusedRealtimeTransport as unknown as typeof WebSocket,
    },
  });
}
