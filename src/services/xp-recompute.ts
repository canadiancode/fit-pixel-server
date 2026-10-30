import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server truth for XP / level. Counts client xp_award ops only for weight XP,
 * through claim_my_weight_xp(). Does not read habit notes.
 *
 * Clients can't write xp_state, so the math lives in the security definer
 * `public.recompute_my_xp()` (latest: 20261103000000_xp_parity.sql), which
 * scores the caller's own habit_logs, goal history, workouts and weight
 * awards. Keep its constants in step with the XP_* values in ../types/limits.
 */
export async function recomputeXpState(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("recompute_my_xp");
  if (error) {
    throw error;
  }
}

export type ServerXp = {
  lifetimeXp: number;
  level: number;
  updatedAt: string;
};

/** Recompute, then return the caller's XP (GET /v1/me/xp). */
export async function getServerXp(supabase: SupabaseClient): Promise<ServerXp> {
  const { data, error } = await supabase.rpc("recompute_my_xp");
  if (error) {
    throw error;
  }
  const row = data as {
    lifetime_xp: number;
    level: number;
    updated_at: string;
  };
  return {
    lifetimeXp: row.lifetime_xp,
    level: row.level,
    updatedAt: row.updated_at,
  };
}
