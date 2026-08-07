/**
 * Habit log shapes mirrored from the Expo app
 * (`one-rep-max/lib/db/habit-log/types.ts`).
 * Used for sync payload typing / future validation.
 */

export const HABIT_LOG_TYPES = [
  "water",
  "food",
  "train",
  "sleep",
  "weight",
  "steps",
  "active_kcal",
] as const;

export type HabitLogType = (typeof HABIT_LOG_TYPES)[number];

export const HABIT_LOG_SOURCES = ["manual", "healthkit", "import"] as const;
export type HabitLogSource = (typeof HABIT_LOG_SOURCES)[number];

export const FOOD_MEAL_TYPES = [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "other",
] as const;
export type FoodMealType = (typeof FOOD_MEAL_TYPES)[number];

export type WaterHabitPayload = { amount: number; unit: "oz" | "ml" };
export type FoodHabitPayload = {
  name: string;
  kcal: number;
  mealType?: FoodMealType;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  portionSize?: string;
};
export type TrainHabitPayload = { durationMin: number; trainType?: string };
export type SleepHabitPayload = { durationHours: number };
export type WeightHabitPayload = { value: number; unit: "lb" | "kg" };
export type StepsHabitPayload = { steps: number };
export type ActiveKcalHabitPayload = { kcal: number };

export type HabitLogPayloadByType = {
  water: WaterHabitPayload;
  food: FoodHabitPayload;
  train: TrainHabitPayload;
  sleep: SleepHabitPayload;
  weight: WeightHabitPayload;
  steps: StepsHabitPayload;
  active_kcal: ActiveKcalHabitPayload;
};

export type HabitLogPayload = HabitLogPayloadByType[HabitLogType];

/**
 * Wire payload for a `habit_log` pending server op
 * (object form; mobile stores this as JSON in `payload_json`).
 */
export type HabitLogSyncPayload = {
  id: string;
  type: HabitLogType;
  timestamp: string;
  createdAt: string;
  source: HabitLogSource;
  notes: string | null;
  dayKey: string;
  payload: HabitLogPayload;
};
