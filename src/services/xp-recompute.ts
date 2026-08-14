import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DAILY_SUMMARY_GOAL_KEYS,
  XP_DAY_COMPLETE,
  XP_PER_GOAL_MET,
  XP_PER_HABIT_LOG,
  XP_PER_LEVEL,
  type DailySummaryGoalKey,
} from "../types/limits";
import { convertWaterAmount } from "../utils/units";

type HabitRow = {
  id: string;
  type: string;
  day_key: string;
  payload: unknown;
};

type GoalsRow = {
  food_kcal: number;
  water_amount: number;
  water_unit: "oz" | "ml";
  train_minutes: number;
  sleep_hours: number;
  steps: number;
  active_kcal: number;
};

type DayTotals = {
  foodKcal: number;
  waterAmount: number;
  trainMinutes: number;
  sleepHours: number;
  steps: number;
  activeKcal: number;
};

function emptyTotals(): DayTotals {
  return {
    foodKcal: 0,
    waterAmount: 0,
    trainMinutes: 0,
    sleepHours: 0,
    steps: 0,
    activeKcal: 0,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function addLogToTotals(
  totals: DayTotals,
  type: string,
  payload: Record<string, unknown>,
  waterUnit: "oz" | "ml",
): void {
  switch (type) {
    case "food": {
      const kcal = payload.kcal;
      if (typeof kcal === "number" && Number.isFinite(kcal)) {
        totals.foodKcal += kcal;
      }
      break;
    }
    case "water": {
      const amount = payload.amount;
      const unit = payload.unit === "ml" ? "ml" : payload.unit === "oz" ? "oz" : null;
      if (typeof amount === "number" && Number.isFinite(amount) && unit) {
        totals.waterAmount += convertWaterAmount(amount, unit, waterUnit);
      }
      break;
    }
    case "train": {
      const durationMin = payload.durationMin;
      if (typeof durationMin === "number" && Number.isFinite(durationMin)) {
        totals.trainMinutes += durationMin;
      }
      break;
    }
    case "sleep": {
      const durationHours = payload.durationHours;
      if (typeof durationHours === "number" && Number.isFinite(durationHours)) {
        totals.sleepHours += durationHours;
      }
      break;
    }
    case "steps": {
      const steps = payload.steps;
      if (typeof steps === "number" && Number.isFinite(steps)) {
        totals.steps += steps;
      }
      break;
    }
    case "active_kcal": {
      const kcal = payload.kcal;
      if (typeof kcal === "number" && Number.isFinite(kcal)) {
        totals.activeKcal += kcal;
      }
      break;
    }
    default:
      break;
  }
}

function isGoalMet(
  key: DailySummaryGoalKey,
  totals: DayTotals,
  goals: GoalsRow,
): boolean {
  switch (key) {
    case "food":
      return totals.foodKcal >= goals.food_kcal;
    case "water":
      return totals.waterAmount >= goals.water_amount;
    case "train":
      return totals.trainMinutes >= goals.train_minutes;
    case "sleep":
      return totals.sleepHours >= goals.sleep_hours;
    case "steps":
      return totals.steps >= goals.steps;
    case "active_kcal":
      return totals.activeKcal >= goals.active_kcal;
  }
}

/**
 * Server truth for XP / level. Never uses client xp_award or source.
 * Does not read habit notes.
 */
export async function recomputeXpState(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const [logsResult, goalsResult] = await Promise.all([
    supabase
      .from("habit_logs")
      .select("id,type,day_key,payload")
      .eq("user_id", userId),
    supabase.from("daily_goals").select(
      "food_kcal,water_amount,water_unit,train_minutes,sleep_hours,steps,active_kcal",
    ).eq("user_id", userId).maybeSingle(),
  ]);

  if (logsResult.error) {
    throw logsResult.error;
  }
  if (goalsResult.error) {
    throw goalsResult.error;
  }

  const logs = (logsResult.data ?? []) as HabitRow[];
  const goals = (goalsResult.data ?? null) as GoalsRow | null;
  const waterUnit = goals?.water_unit ?? "oz";

  const byDay = new Map<string, DayTotals>();
  for (const log of logs) {
    const totals = byDay.get(log.day_key) ?? emptyTotals();
    addLogToTotals(totals, log.type, asRecord(log.payload), waterUnit);
    byDay.set(log.day_key, totals);
  }

  let bonusXp = 0;
  if (goals) {
    for (const totals of byDay.values()) {
      const met = DAILY_SUMMARY_GOAL_KEYS.filter((key: DailySummaryGoalKey) =>
        isGoalMet(key, totals, goals),
      );
      bonusXp += met.length * XP_PER_GOAL_MET;
      if (met.length === DAILY_SUMMARY_GOAL_KEYS.length) {
        bonusXp += XP_DAY_COMPLETE;
      }
    }
  }

  const lifetimeXp = logs.length * XP_PER_HABIT_LOG + bonusXp;
  const level = Math.floor(lifetimeXp / XP_PER_LEVEL);
  const updatedAt = new Date().toISOString();

  const { error } = await supabase.from("xp_state").upsert(
    {
      user_id: userId,
      lifetime_xp: lifetimeXp,
      level,
      updated_at: updatedAt,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    throw error;
  }
}
