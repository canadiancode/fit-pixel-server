import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server truth for XP / level. Never uses client xp_award or source.
 * Does not read habit notes.
 *
 * Clients can't write xp_state, so the math lives in the security definer
 * `public.recompute_my_xp()` (20261021000000_harden_direct_writes.sql), which
 * scores the caller's own habit_logs + daily_goals. Keep its constants in step
 * with the XP_* values in ../types/limits.
 */
export async function recomputeXpState(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("recompute_my_xp");
  if (error) {
    throw error;
  }
}
