import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocalDayKey } from "../utils/day-key";

/** PostgREST caps a response at 1000 rows by default; page under that. */
const HABIT_ROW_PAGE = 1000;
/** Rows per upsert request when writing re-derived day keys back. */
const HABIT_WRITE_CHUNK = 500;

type HabitDayKeyRow = {
  id: string;
  type: string;
  timestamp: string;
  day_key: string;
};

/**
 * Re-bucket every habit log for `userId` into app days for the given boundary.
 * Call after prefs.time_zone / day_starts_at_minutes change so day_key (and the
 * XP goal bonuses built on it) follow the user's local day.
 * Returns how many rows changed.
 */
export async function rederiveHabitDayKeys(
  supabase: SupabaseClient,
  userId: string,
  dayStartsAtMinutes: number,
  timeZone: string,
): Promise<number> {
  const changed: HabitDayKeyRow[] = [];
  let after: string | null = null;
  for (;;) {
    let query = supabase
      .from("habit_logs")
      .select("id,type,timestamp,day_key")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .limit(HABIT_ROW_PAGE);
    if (after) {
      query = query.gt("id", after);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    const page = (data ?? []) as HabitDayKeyRow[];
    for (const row of page) {
      const dayKey = getLocalDayKey(
        new Date(row.timestamp),
        dayStartsAtMinutes,
        timeZone,
      );
      if (dayKey !== row.day_key) {
        changed.push({ ...row, day_key: dayKey });
      }
    }
    if (page.length < HABIT_ROW_PAGE) {
      break;
    }
    after = page[page.length - 1].id;
  }

  // Upsert only touches the columns sent; type/timestamp are echoed back
  // unchanged because they are NOT NULL without defaults on the insert path.
  for (let i = 0; i < changed.length; i += HABIT_WRITE_CHUNK) {
    const chunk = changed.slice(i, i + HABIT_WRITE_CHUNK).map((row) => ({
      user_id: userId,
      id: row.id,
      type: row.type,
      timestamp: row.timestamp,
      day_key: row.day_key,
    }));
    const { error } = await supabase
      .from("habit_logs")
      .upsert(chunk, { onConflict: "user_id,id" });
    if (error) {
      throw error;
    }
  }

  return changed.length;
}
