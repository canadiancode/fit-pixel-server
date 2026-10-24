/** Clamp / reject bounds mirrored from the Expo app write boundaries. */

export const HABIT_LOG_LIMITS = {
  water: {
    oz: { minAbs: 0.1, maxAbs: 256 },
    ml: { minAbs: 1, maxAbs: 8_000 },
  },
  foodKcal: { min: 0, max: 10_000 },
  foodMacroG: { min: 0, max: 1_000 },
  foodNameMaxLen: 120,
  foodPortionMaxLen: 80,
  foodNotesMaxLen: 500,
  trainMinutes: { minAbs: 1, maxAbs: 720 },
  sleepHours: { minAbs: 0.05, maxAbs: 24 },
  weight: {
    lb: { min: 50, max: 700 },
    kg: { min: 20, max: 320 },
  },
  steps: { minAbs: 1, maxAbs: 100_000 },
  activeKcal: { minAbs: 1, maxAbs: 10_000 },
  trainTypeMaxLen: 80,
} as const;

export const DAILY_GOAL_LIMITS = {
  foodKcal: { min: 500, max: 6_000 },
  waterAmount: {
    oz: { min: 8, max: 256 },
    ml: { min: 250, max: 8_000 },
  },
  trainMinutes: { min: 15, max: 240 },
  sleepHours: { min: 6, max: 12 },
  steps: { min: 1_000, max: 50_000 },
  activeKcal: { min: 200, max: 5_000 },
  weightGoal: {
    lb: { min: 100, max: 400 },
    kg: { min: 45, max: 180 },
  },
} as const;

export const CHAT_LIMITS = {
  messageBodyMin: 1,
  messageBodyMax: 2_000,
  messagePageMax: 50,
  messageMinIntervalMs: 800,
  gymIdMax: 64,
} as const;

export const PROFILE_LIMITS = {
  displayNameMax: 80,
  bioMax: 500,
  homeGymIdMax: 64,
  homeGymNameMax: 120,
  socialMax: 200,
} as const;

export const DAY_STARTS_AT_MINUTES_MIN = 0;
export const DAY_STARTS_AT_MINUTES_MAX = 1439;

export const SAVED_MEAL_VENDOR_MAX = 80;

export const XP_PER_HABIT_LOG = 10;
/** Logs per type per day that earn XP_PER_HABIT_LOG (recompute_my_xp). */
export const XP_HABIT_LOGS_PER_TYPE_PER_DAY = 3;
export const XP_PER_GOAL_MET = 50;
export const XP_DAY_COMPLETE = 100;
export const XP_PER_LEVEL = 100;
/** Each completed set in a synced workout, up to XP_WORKOUT_SETS_PER_DAY a day. */
export const XP_PER_WORKOUT_SET = 5;
export const XP_WORKOUT_SETS_PER_DAY = 40;
/** A synced workout with at least one completed set, up to XP_WORKOUT_COMPLETES_PER_DAY a day. */
export const XP_WORKOUT_COMPLETE = 25;
export const XP_WORKOUT_COMPLETES_PER_DAY = 2;

/** Workout session + training plan bounds (workout_session / training_plan ops). */
export const TRAINING_LIMITS = {
  idMax: 64,
  nameMax: 80,
  exercisesMax: 30,
  setsMax: 20,
  weightMax: 2_000,
  /** Reps, or seconds for timed moves. */
  repsMax: 3_600,
  restSecMax: 900,
  /** A session can run at most this long (started → finished). */
  sessionHoursMax: 24,
  planWorkoutsMax: 14,
  planJsonMaxBytes: 65_536,
  sessionPageDefault: 200,
  sessionPageMax: 500,
} as const;

export const APP_THEME_IDS = ["blue", "coral", "emerald", "violet"] as const;
export type AppThemeId = (typeof APP_THEME_IDS)[number];
export const DEFAULT_THEME_ID: AppThemeId = "blue";

export const PIXEL_LAYER_IDS = [
  "background",
  "skin",
  "eyes",
  "nose",
  "mouth",
  "top",
  "bottom",
  "shoes",
  "hair",
  "item_left",
  "item_right",
] as const;
export type PixelLayerId = (typeof PIXEL_LAYER_IDS)[number];

export const DAILY_SUMMARY_GOAL_KEYS = [
  "food",
  "water",
  "train",
  "sleep",
  "steps",
  "active_kcal",
] as const;
export type DailySummaryGoalKey = (typeof DAILY_SUMMARY_GOAL_KEYS)[number];
