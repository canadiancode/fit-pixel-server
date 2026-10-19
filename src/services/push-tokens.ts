import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env";
import { AppError } from "../types/api";
import type { RegisterPushTokenBody } from "../types/push";

function throwIfError(error: { message: string; code?: string } | null): void {
  if (!error) return;
  if (env.NODE_ENV !== "production") {
    console.error("Push token query failed:", error.code, error.message);
  }
  throw new AppError(503, "SERVICE_UNAVAILABLE", "Push token request failed");
}

/** Claims this device's token for the caller (moves it off any other account). */
export async function registerPushToken(
  supabase: SupabaseClient,
  body: RegisterPushTokenBody,
): Promise<void> {
  const { error } = await supabase.rpc("register_push_token", {
    push_token: body.token,
    push_platform: body.platform,
  });
  throwIfError(error);
}

/** RLS limits the delete to the caller's own rows. */
export async function unregisterPushToken(
  supabase: SupabaseClient,
  userId: string,
  token: string,
): Promise<void> {
  const { error } = await supabase
    .from("push_tokens")
    .delete()
    .eq("user_id", userId)
    .eq("token", token);
  throwIfError(error);
}
