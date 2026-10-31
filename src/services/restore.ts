import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../types/api";
import type {
  FoodMealType,
  HabitLogPayload,
  HabitLogSource,
  HabitLogSyncPayload,
  HabitLogType,
} from "../types/habits";
import {
  RESTORE_LIMITS,
  type HabitsPage,
  type RestoreDailyGoals,
  type RestoreLoadout,
  type RestorePrefs,
  type RestoreProfile,
  type RestoreSavedMeal,
  type RestoreSnapshot,
  type RestoreTrainingPlan,
  type RestoreWeightJourney,
  type RestoreWorkoutSession,
  type RestoreXp,
  type WorkoutsPage,
} from "../types/restore";

type HabitLogRow = {
  id: string;
  type: HabitLogType;
  timestamp: string;
  created_at: string;
  source: HabitLogSource;
  notes: string | null;
  day_key: string;
  payload: unknown;
};

function throwIfError(
  error: { message: string; code?: string } | null,
): void {
  if (!error) return;
  console.error("Restore query failed:", error.code, error.message);
  throw new AppError(503, "SERVICE_UNAVAILABLE", "Restore request failed");
}

function asStringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return out;
  }
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && item.length > 0) out[key] = item;
  }
  return out;
}

function toHabitLog(row: HabitLogRow): HabitLogSyncPayload {
  const payload =
    row.payload != null &&
    typeof row.payload === "object" &&
    !Array.isArray(row.payload)
      ? (row.payload as HabitLogPayload)
      : ({} as HabitLogPayload);
  return {
    id: row.id,
    type: row.type,
    timestamp: row.timestamp,
    createdAt: row.created_at,
    source: row.source,
    notes: row.notes,
    // Server re-derives day keys from the synced day boundary; send that.
    dayKey: row.day_key,
    payload,
  };
}

/** Keyset page over the caller's habit logs, ordered by id. */
export async function listHabitLogsPage(
  supabase: SupabaseClient,
  userId: string,
  options: { after?: string; limit: number },
): Promise<HabitsPage> {
  let query = supabase
    .from("habit_logs")
    .select("id,type,timestamp,created_at,source,notes,day_key,payload")
    .eq("user_id", userId)
    .order("id", { ascending: true })
    .limit(options.limit);
  if (options.after) {
    query = query.gt("id", options.after);
  }

  const { data, error } = await query;
  throwIfError(error);

  const logs = ((data ?? []) as HabitLogRow[]).map(toHabitLog);
  const last = logs[logs.length - 1];
  return {
    logs,
    nextCursor: logs.length === options.limit && last ? last.id : null,
  };
}

type WorkoutSessionRow = {
  id: string;
  workout_id: string;
  workout_name: string;
  unit: "lb" | "kg";
  started_at: string;
  finished_at: string;
  day_key: string;
  sets_done: number;
  exercises: unknown;
};

/** Keyset page over the caller's finished workouts, ordered by id. */
export async function listWorkoutSessionsPage(
  supabase: SupabaseClient,
  userId: string,
  options: { after?: string; limit: number },
): Promise<WorkoutsPage> {
  let query = supabase
    .from("workout_sessions")
    .select(
      "id,workout_id,workout_name,unit,started_at,finished_at,day_key,sets_done,exercises",
    )
    .eq("user_id", userId)
    .order("id", { ascending: true })
    .limit(options.limit);
  if (options.after) {
    query = query.gt("id", options.after);
  }

  const { data, error } = await query;
  throwIfError(error);

  const sessions: RestoreWorkoutSession[] = (
    (data ?? []) as WorkoutSessionRow[]
  ).map((row) => ({
    id: row.id,
    workoutId: row.workout_id,
    workoutName: row.workout_name,
    unit: row.unit,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    dayKey: row.day_key,
    setsDone: row.sets_done,
    exercises: Array.isArray(row.exercises) ? row.exercises : [],
  }));
  const last = sessions[sessions.length - 1];
  return {
    sessions,
    nextCursor: sessions.length === options.limit && last ? last.id : null,
  };
}

export async function getRestoreSnapshot(
  supabase: SupabaseClient,
  userId: string,
): Promise<RestoreSnapshot> {
  const [
    profile,
    prefs,
    goals,
    xp,
    loadout,
    meals,
    logCount,
    plan,
    workoutCount,
    journey,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "display_name,bio,home_gym_id,home_gym_name,profile_visible,instagram,tiktok,youtube,updated_at",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("prefs")
      .select(
        "unit_system,selected_theme_id,notif_accountability,notif_news,day_starts_at_minutes,time_zone,updated_at",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("daily_goals")
      .select(
        "food_kcal,water_amount,water_unit,train_minutes,sleep_hours,steps,active_kcal,weight_goal,weight_unit,updated_at",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("xp_state")
      .select("lifetime_xp,level,updated_at")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("loadouts")
      .select("equipped,updated_at")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("saved_meals")
      .select(
        "id,name,vendor,portion_size,kcal,protein_g,carbs_g,fat_g,meal_type,created_at,updated_at",
      )
      .eq("user_id", userId)
      .eq("deleted", false)
      .order("updated_at", { ascending: false })
      .limit(RESTORE_LIMITS.savedMealsMax),
    supabase
      .from("habit_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("training_plans")
      .select("plan,updated_at")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("workout_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("weight_journeys")
      .select(
        "start_weight,start_unit,start_day_key,weigh_in_weekday,reminder_enabled,hide_numbers,updated_at",
      )
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  for (const result of [
    profile,
    prefs,
    goals,
    xp,
    loadout,
    meals,
    logCount,
    plan,
    workoutCount,
    journey,
  ]) {
    throwIfError(result.error);
  }

  const p = profile.data;
  const restoreProfile: RestoreProfile | null = p
    ? {
        displayName: p.display_name,
        bio: p.bio,
        homeGymId: p.home_gym_id,
        homeGymName: p.home_gym_name,
        profileVisible: p.profile_visible,
        instagram: p.instagram,
        tiktok: p.tiktok,
        youtube: p.youtube,
        updatedAt: p.updated_at,
      }
    : null;

  const pr = prefs.data;
  const restorePrefs: RestorePrefs | null = pr
    ? {
        unitSystem: pr.unit_system,
        selectedThemeId: pr.selected_theme_id,
        notifAccountability: pr.notif_accountability,
        notifNews: pr.notif_news,
        dayStartsAtMinutes: pr.day_starts_at_minutes,
        timeZone: pr.time_zone,
        updatedAt: pr.updated_at,
      }
    : null;

  const g = goals.data;
  const restoreGoals: RestoreDailyGoals | null = g
    ? {
        foodKcal: g.food_kcal,
        waterAmount: g.water_amount,
        waterUnit: g.water_unit,
        trainMinutes: g.train_minutes,
        sleepHours: g.sleep_hours,
        steps: g.steps,
        activeKcal: g.active_kcal,
        weightGoal: g.weight_goal,
        weightUnit: g.weight_unit,
        updatedAt: g.updated_at,
      }
    : null;

  const x = xp.data;
  const restoreXp: RestoreXp | null = x
    ? { lifetimeXp: x.lifetime_xp, level: x.level, updatedAt: x.updated_at }
    : null;

  const l = loadout.data;
  const restoreLoadout: RestoreLoadout | null = l
    ? { equipped: asStringRecord(l.equipped), updatedAt: l.updated_at }
    : null;

  const savedMeals: RestoreSavedMeal[] = (meals.data ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    vendor: m.vendor,
    portionSize: m.portion_size,
    kcal: m.kcal,
    proteinG: m.protein_g,
    carbsG: m.carbs_g,
    fatG: m.fat_g,
    mealType: m.meal_type as FoodMealType | null,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  }));

  const tp = plan.data;
  const trainingPlan: RestoreTrainingPlan | null =
    tp && tp.plan != null && typeof tp.plan === "object" && !Array.isArray(tp.plan)
      ? { plan: tp.plan as Record<string, unknown>, updatedAt: tp.updated_at }
      : null;

  const wj = journey.data;
  const weightJourney: RestoreWeightJourney | null = wj
    ? {
        // numeric comes back as a string from PostgREST.
        startWeight: wj.start_weight == null ? null : Number(wj.start_weight),
        startUnit:
          wj.start_unit === "lb" || wj.start_unit === "kg" ? wj.start_unit : null,
        startDayKey: wj.start_day_key,
        weighInWeekday: wj.weigh_in_weekday,
        reminderEnabled: wj.reminder_enabled,
        hideNumbers: wj.hide_numbers,
        updatedAt: wj.updated_at,
      }
    : null;

  return {
    serverTime: new Date().toISOString(),
    profile: restoreProfile,
    prefs: restorePrefs,
    dailyGoals: restoreGoals,
    xp: restoreXp,
    loadout: restoreLoadout,
    savedMeals,
    habitLogCount: logCount.count ?? 0,
    trainingPlan,
    workoutSessionCount: workoutCount.count ?? 0,
    weightJourney,
  };
}
