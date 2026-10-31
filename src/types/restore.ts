import { z } from "zod";
import type { FoodMealType, HabitLogSyncPayload } from "./habits";
import { TRAINING_LIMITS } from "./limits";

/**
 * Restore contract (server → app). Mirrors the POST /v1/sync fact payloads so
 * the app can write rows back into SQLite without re-enqueueing them.
 */

export const RESTORE_LIMITS = {
  habitPageDefault: 500,
  habitPageMax: 1_000,
  savedMealsMax: 1_000,
} as const;

export const habitsPageQuerySchema = z.object({
  after: z.string().uuid().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(RESTORE_LIMITS.habitPageMax)
    .optional()
    .default(RESTORE_LIMITS.habitPageDefault),
});

export const workoutsPageQuerySchema = z.object({
  after: z.string().uuid().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(TRAINING_LIMITS.sessionPageMax)
    .optional()
    .default(TRAINING_LIMITS.sessionPageDefault),
});

/** A finished workout as synced (workout_session op), with the server's day key. */
export type RestoreWorkoutSession = {
  id: string;
  workoutId: string;
  workoutName: string;
  unit: "lb" | "kg";
  startedAt: string;
  finishedAt: string;
  dayKey: string;
  setsDone: number;
  exercises: unknown[];
};

export type WorkoutsPage = {
  sessions: RestoreWorkoutSession[];
  /** Pass as `after` for the next page; null when this was the last page. */
  nextCursor: string | null;
};

export type RestoreTrainingPlan = {
  /** The plan document exactly as the app synced it. */
  plan: Record<string, unknown>;
  updatedAt: string;
};

export type RestoreWeightJourney = {
  startWeight: number | null;
  startUnit: "lb" | "kg" | null;
  startDayKey: string | null;
  weighInWeekday: number;
  reminderEnabled: boolean;
  hideNumbers: boolean;
  updatedAt: string;
};

export type HabitsPage = {
  logs: HabitLogSyncPayload[];
  /** Pass as `after` for the next page; null when this was the last page. */
  nextCursor: string | null;
};

export type RestoreProfile = {
  displayName: string;
  bio: string;
  homeGymId: string | null;
  homeGymName: string | null;
  profileVisible: boolean;
  instagram: string | null;
  tiktok: string | null;
  youtube: string | null;
  updatedAt: string;
};

export type RestorePrefs = {
  unitSystem: "metric" | "imperial";
  selectedThemeId: string;
  notifAccountability: boolean;
  notifNews: boolean;
  dayStartsAtMinutes: number;
  timeZone: string;
  updatedAt: string;
};

export type RestoreDailyGoals = {
  foodKcal: number;
  waterAmount: number;
  waterUnit: "oz" | "ml";
  trainMinutes: number;
  sleepHours: number;
  steps: number;
  activeKcal: number;
  weightGoal: number;
  weightUnit: "lb" | "kg";
  updatedAt: string;
};

export type RestoreXp = {
  lifetimeXp: number;
  level: number;
  updatedAt: string;
};

export type RestoreLoadout = {
  /** Layer id → item id, exactly as the app synced it. */
  equipped: Record<string, string>;
  updatedAt: string;
};

export type RestoreSavedMeal = {
  id: string;
  name: string;
  vendor: string | null;
  portionSize: string | null;
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  mealType: FoodMealType | null;
  createdAt: string;
  updatedAt: string;
};

export type RestoreSnapshot = {
  serverTime: string;
  profile: RestoreProfile | null;
  prefs: RestorePrefs | null;
  dailyGoals: RestoreDailyGoals | null;
  xp: RestoreXp | null;
  loadout: RestoreLoadout | null;
  /** Live meals only; deleted tombstones are omitted. */
  savedMeals: RestoreSavedMeal[];
  /** Total server habit logs; fetch them with GET /v1/habits. */
  habitLogCount: number;
  trainingPlan: RestoreTrainingPlan | null;
  /** Total finished workouts; fetch them with GET /v1/workouts. */
  workoutSessionCount: number;
  weightJourney: RestoreWeightJourney | null;
};
