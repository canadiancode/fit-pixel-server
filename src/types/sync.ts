import { z } from "zod";
import {
  FOOD_MEAL_TYPES,
  HABIT_LOG_SOURCES,
  HABIT_LOG_TYPES,
} from "./habits";
import {
  APP_THEME_IDS,
  DAILY_GOAL_LIMITS,
  DAY_STARTS_AT_MINUTES_MAX,
  DAY_STARTS_AT_MINUTES_MIN,
  HABIT_LOG_LIMITS,
  PIXEL_LAYER_IDS,
  PROFILE_LIMITS,
  SAVED_MEAL_VENDOR_MAX,
} from "./limits";

/**
 * Mobile outbox contract (wire format for POST /v1/sync).
 *
 * - FACTS are authoritative for persistence (after sanitization).
 * - UNTRUSTED ops must not drive scoring; recompute XP from habit_log + daily_goals.
 * - Do not trust client `dayKey` alone — re-derive from timestamps + day boundary/timezone.
 * - Never store raw HealthKit sample blobs.
 * - Ignore client `trust`; derive via `trustForOpType`.
 */

export const PENDING_OP_SCHEMA_VERSION = 1;

export const PENDING_SERVER_OP_TYPES = [
  "habit_log",
  "daily_goals",
  "xp_award",
  "inventory_unlock",
  "loadout",
  "profile",
  "prefs",
  "saved_meal",
] as const;

export type PendingServerOpType = (typeof PENDING_SERVER_OP_TYPES)[number];

export const PENDING_SERVER_OP_TRUST = ["fact", "untrusted_client"] as const;
export type PendingServerOpTrust = (typeof PENDING_SERVER_OP_TRUST)[number];

export const FACT_PENDING_OP_TYPES = [
  "habit_log",
  "daily_goals",
  "loadout",
  "profile",
  "prefs",
  "saved_meal",
] as const satisfies readonly PendingServerOpType[];

export const UNTRUSTED_PENDING_OP_TYPES = [
  "xp_award",
  "inventory_unlock",
] as const satisfies readonly PendingServerOpType[];

const UNTRUSTED_SET = new Set<string>(UNTRUSTED_PENDING_OP_TYPES);

export function trustForOpType(type: PendingServerOpType): PendingServerOpTrust {
  return UNTRUSTED_SET.has(type) ? "untrusted_client" : "fact";
}

export function isFactOpType(type: PendingServerOpType): boolean {
  return !UNTRUSTED_SET.has(type);
}

export type SyncAckStatus = "synced" | "rejected";

export type SyncAck = {
  id: string;
  status: SyncAckStatus;
  reason?: string;
};

export type SyncResponse = {
  acks: SyncAck[];
  serverTime: string;
};

const isoDatetime = z.iso.datetime({ offset: true });

function absInRange(minAbs: number, maxAbs: number) {
  return (value: number) => {
    const abs = Math.abs(value);
    return abs >= minAbs && abs <= maxAbs && value !== 0;
  };
}

const waterHabitPayloadSchema = z
  .object({
    amount: z.number().finite(),
    unit: z.enum(["oz", "ml"]),
  })
  .superRefine((data, ctx) => {
    const limits = HABIT_LOG_LIMITS.water[data.unit];
    if (!absInRange(limits.minAbs, limits.maxAbs)(data.amount)) {
      ctx.addIssue({
        code: "custom",
        message: `water amount magnitude must be ${limits.minAbs}–${limits.maxAbs} ${data.unit}`,
        path: ["amount"],
      });
    }
  });

const foodHabitPayloadSchema = z.object({
  name: z.string().trim().min(1).max(HABIT_LOG_LIMITS.foodNameMaxLen),
  kcal: z
    .number()
    .finite()
    .min(HABIT_LOG_LIMITS.foodKcal.min)
    .max(HABIT_LOG_LIMITS.foodKcal.max),
  mealType: z.enum(FOOD_MEAL_TYPES).optional(),
  proteinG: z
    .number()
    .finite()
    .min(HABIT_LOG_LIMITS.foodMacroG.min)
    .max(HABIT_LOG_LIMITS.foodMacroG.max)
    .optional(),
  carbsG: z
    .number()
    .finite()
    .min(HABIT_LOG_LIMITS.foodMacroG.min)
    .max(HABIT_LOG_LIMITS.foodMacroG.max)
    .optional(),
  fatG: z
    .number()
    .finite()
    .min(HABIT_LOG_LIMITS.foodMacroG.min)
    .max(HABIT_LOG_LIMITS.foodMacroG.max)
    .optional(),
  portionSize: z.string().trim().max(HABIT_LOG_LIMITS.foodPortionMaxLen).optional(),
});

const trainHabitPayloadSchema = z.object({
  durationMin: z
    .number()
    .finite()
    .refine(
      absInRange(
        HABIT_LOG_LIMITS.trainMinutes.minAbs,
        HABIT_LOG_LIMITS.trainMinutes.maxAbs,
      ),
      "train duration magnitude out of range",
    ),
  trainType: z.string().trim().max(HABIT_LOG_LIMITS.trainTypeMaxLen).optional(),
});

const sleepHabitPayloadSchema = z.object({
  durationHours: z
    .number()
    .finite()
    .refine(
      absInRange(
        HABIT_LOG_LIMITS.sleepHours.minAbs,
        HABIT_LOG_LIMITS.sleepHours.maxAbs,
      ),
      "sleep duration magnitude out of range",
    ),
});

const weightHabitPayloadSchema = z
  .object({
    value: z.number().finite(),
    unit: z.enum(["lb", "kg"]),
  })
  .superRefine((data, ctx) => {
    const limits = HABIT_LOG_LIMITS.weight[data.unit];
    if (data.value < limits.min || data.value > limits.max) {
      ctx.addIssue({
        code: "custom",
        message: `weight must be ${limits.min}–${limits.max} ${data.unit}`,
        path: ["value"],
      });
    }
  });

const stepsHabitPayloadSchema = z.object({
  steps: z
    .number()
    .finite()
    .refine(
      absInRange(HABIT_LOG_LIMITS.steps.minAbs, HABIT_LOG_LIMITS.steps.maxAbs),
      "steps magnitude out of range",
    ),
});

const activeKcalHabitPayloadSchema = z.object({
  kcal: z
    .number()
    .finite()
    .refine(
      absInRange(
        HABIT_LOG_LIMITS.activeKcal.minAbs,
        HABIT_LOG_LIMITS.activeKcal.maxAbs,
      ),
      "active kcal magnitude out of range",
    ),
});

const habitDomainPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("water"), payload: waterHabitPayloadSchema }),
  z.object({ type: z.literal("food"), payload: foodHabitPayloadSchema }),
  z.object({ type: z.literal("train"), payload: trainHabitPayloadSchema }),
  z.object({ type: z.literal("sleep"), payload: sleepHabitPayloadSchema }),
  z.object({ type: z.literal("weight"), payload: weightHabitPayloadSchema }),
  z.object({ type: z.literal("steps"), payload: stepsHabitPayloadSchema }),
  z.object({
    type: z.literal("active_kcal"),
    payload: activeKcalHabitPayloadSchema,
  }),
]);

export const habitLogSyncPayloadSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(HABIT_LOG_TYPES),
    timestamp: isoDatetime,
    createdAt: isoDatetime,
    source: z.enum(HABIT_LOG_SOURCES),
    notes: z
      .string()
      .trim()
      .max(HABIT_LOG_LIMITS.foodNotesMaxLen)
      .nullable(),
    dayKey: z.string().max(32),
    payload: z.record(z.string(), z.unknown()),
  })
  .superRefine((data, ctx) => {
    const parsed = habitDomainPayloadSchema.safeParse({
      type: data.type,
      payload: data.payload,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["payload", ...issue.path.filter((p) => p !== "type")],
        });
      }
    }
  });

export type HabitLogSyncPayloadParsed = z.infer<typeof habitLogSyncPayloadSchema>;

const dailyGoalsPayloadSchema = z
  .object({
    foodKcal: z
      .number()
      .finite()
      .min(DAILY_GOAL_LIMITS.foodKcal.min)
      .max(DAILY_GOAL_LIMITS.foodKcal.max),
    waterAmount: z.number().finite(),
    waterUnit: z.enum(["oz", "ml"]),
    trainMinutes: z
      .number()
      .finite()
      .min(DAILY_GOAL_LIMITS.trainMinutes.min)
      .max(DAILY_GOAL_LIMITS.trainMinutes.max),
    sleepHours: z
      .number()
      .finite()
      .min(DAILY_GOAL_LIMITS.sleepHours.min)
      .max(DAILY_GOAL_LIMITS.sleepHours.max),
    steps: z
      .number()
      .int()
      .min(DAILY_GOAL_LIMITS.steps.min)
      .max(DAILY_GOAL_LIMITS.steps.max),
    activeKcal: z
      .number()
      .finite()
      .min(DAILY_GOAL_LIMITS.activeKcal.min)
      .max(DAILY_GOAL_LIMITS.activeKcal.max),
    weightGoal: z.number().finite(),
    weightUnit: z.enum(["lb", "kg"]),
    updatedAt: isoDatetime,
  })
  .superRefine((data, ctx) => {
    const water = DAILY_GOAL_LIMITS.waterAmount[data.waterUnit];
    if (data.waterAmount < water.min || data.waterAmount > water.max) {
      ctx.addIssue({
        code: "custom",
        message: `waterAmount must be ${water.min}–${water.max} ${data.waterUnit}`,
        path: ["waterAmount"],
      });
    }
    const weight = DAILY_GOAL_LIMITS.weightGoal[data.weightUnit];
    if (data.weightGoal < weight.min || data.weightGoal > weight.max) {
      ctx.addIssue({
        code: "custom",
        message: `weightGoal must be ${weight.min}–${weight.max} ${data.weightUnit}`,
        path: ["weightGoal"],
      });
    }
  });

const socialValueSchema = z
  .string()
  .trim()
  .max(PROFILE_LIMITS.socialMax)
  .nullable();

export const profilePayloadSchema = z.object({
  displayName: z.string().trim().max(PROFILE_LIMITS.displayNameMax),
  bio: z.string().trim().max(PROFILE_LIMITS.bioMax),
  homeGymId: z.string().trim().max(PROFILE_LIMITS.homeGymIdMax).nullable(),
  homeGymName: z.string().trim().max(PROFILE_LIMITS.homeGymNameMax).nullable(),
  profileVisible: z.boolean(),
  instagram: socialValueSchema,
  tiktok: socialValueSchema,
  youtube: socialValueSchema,
  updatedAt: isoDatetime,
});

export const prefsPayloadSchema = z
  .object({
    unitSystem: z.enum(["metric", "imperial"]).optional(),
    selectedThemeId: z.enum(APP_THEME_IDS).optional(),
    unlockedThemeIds: z.array(z.string()).max(16).optional(),
    notifAccountability: z.boolean().optional(),
    notifNews: z.boolean().optional(),
    dayStartsAtMinutes: z
      .number()
      .int()
      .min(DAY_STARTS_AT_MINUTES_MIN)
      .max(DAY_STARTS_AT_MINUTES_MAX)
      .optional(),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_+\-\/]+$/)
      .optional(),
    updatedAt: isoDatetime.optional(),
  })
  .refine(
    (data) =>
      data.unitSystem !== undefined ||
      data.selectedThemeId !== undefined ||
      data.notifAccountability !== undefined ||
      data.notifNews !== undefined ||
      data.dayStartsAtMinutes !== undefined ||
      data.timeZone !== undefined,
    "prefs payload must include at least one setting",
  );

const loadoutItemIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);

const loadoutMapSchema = z
  .record(z.string(), loadoutItemIdSchema)
  .transform((raw) => {
    const equipped: Partial<Record<(typeof PIXEL_LAYER_IDS)[number], string>> =
      {};
    for (const layer of PIXEL_LAYER_IDS) {
      const value = raw[layer];
      if (typeof value === "string") {
        equipped[layer] = value;
      }
    }
    return equipped;
  });

export const loadoutPayloadSchema = z.union([
  z.object({
    equipped: loadoutMapSchema,
    updatedAt: isoDatetime.optional(),
  }),
  loadoutMapSchema.transform((equipped) => ({ equipped })),
]);

const savedMealUpsertSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(HABIT_LOG_LIMITS.foodNameMaxLen),
  vendor: z.string().trim().max(SAVED_MEAL_VENDOR_MAX).optional(),
  portionSize: z.string().trim().max(HABIT_LOG_LIMITS.foodPortionMaxLen).optional(),
  kcal: z
    .number()
    .finite()
    .min(HABIT_LOG_LIMITS.foodKcal.min)
    .max(HABIT_LOG_LIMITS.foodKcal.max),
  proteinG: z
    .number()
    .finite()
    .min(HABIT_LOG_LIMITS.foodMacroG.min)
    .max(HABIT_LOG_LIMITS.foodMacroG.max)
    .optional(),
  carbsG: z
    .number()
    .finite()
    .min(HABIT_LOG_LIMITS.foodMacroG.min)
    .max(HABIT_LOG_LIMITS.foodMacroG.max)
    .optional(),
  fatG: z
    .number()
    .finite()
    .min(HABIT_LOG_LIMITS.foodMacroG.min)
    .max(HABIT_LOG_LIMITS.foodMacroG.max)
    .optional(),
  mealType: z.enum(FOOD_MEAL_TYPES).optional(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
  deleted: z.literal(true).optional(),
});

const savedMealDeleteSchema = z.object({
  id: z.string().uuid(),
  deleted: z.literal(true),
  deletedAt: isoDatetime,
});

export const savedMealPayloadSchema = z.union([
  savedMealDeleteSchema,
  savedMealUpsertSchema,
]);

const untrustedPayloadSchema = z.record(z.string(), z.unknown());

const opEnvelope = {
  id: z.string().uuid(),
  clientClockAt: isoDatetime.nullable(),
  schemaVersion: z.literal(PENDING_OP_SCHEMA_VERSION),
  trust: z.enum(PENDING_SERVER_OP_TRUST),
};

export const pendingServerOpSchema = z.discriminatedUnion("type", [
  z.object({
    ...opEnvelope,
    type: z.literal("habit_log"),
    payload: habitLogSyncPayloadSchema,
  }),
  z.object({
    ...opEnvelope,
    type: z.literal("daily_goals"),
    payload: dailyGoalsPayloadSchema,
  }),
  z.object({
    ...opEnvelope,
    type: z.literal("profile"),
    payload: profilePayloadSchema,
  }),
  z.object({
    ...opEnvelope,
    type: z.literal("prefs"),
    payload: prefsPayloadSchema,
  }),
  z.object({
    ...opEnvelope,
    type: z.literal("saved_meal"),
    payload: savedMealPayloadSchema,
  }),
  z.object({
    ...opEnvelope,
    type: z.literal("loadout"),
    payload: loadoutPayloadSchema,
  }),
  z.object({
    ...opEnvelope,
    type: z.literal("xp_award"),
    payload: untrustedPayloadSchema,
  }),
  z.object({
    ...opEnvelope,
    type: z.literal("inventory_unlock"),
    payload: untrustedPayloadSchema,
  }),
]);

export type PendingServerOp = z.infer<typeof pendingServerOpSchema>;

export type SyncRequestBody = {
  ops: PendingServerOp[];
};

export const syncRequestBodySchema = z.object({
  ops: z.array(pendingServerOpSchema).max(500),
});
