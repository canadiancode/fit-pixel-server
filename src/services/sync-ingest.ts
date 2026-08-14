import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../types/api";
import type {
  PendingServerOp,
  SyncAck,
} from "../types/sync";
import { trustForOpType } from "../types/sync";
import { getLocalDayKey } from "../utils/day-key";
import { parseSocialLink } from "../utils/social";
import { recomputeXpState } from "./xp-recompute";

type PrefsRow = {
  user_id: string;
  unit_system: string;
  selected_theme_id: string;
  notif_accountability: boolean;
  notif_news: boolean;
  day_starts_at_minutes: number;
  time_zone: string;
  updated_at: string;
};

function throwIfError(error: { message: string } | null): void {
  if (error) {
    throw new AppError(500, "INTERNAL_ERROR", "Sync persist failed");
  }
}

async function loadPrefs(
  supabase: SupabaseClient,
  userId: string,
): Promise<Pick<PrefsRow, "day_starts_at_minutes" | "time_zone">> {
  const { data, error } = await supabase
    .from("prefs")
    .select("day_starts_at_minutes,time_zone")
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(error);
  return {
    day_starts_at_minutes: data?.day_starts_at_minutes ?? 0,
    time_zone: data?.time_zone ?? "UTC",
  };
}

async function applyHabitLog(
  supabase: SupabaseClient,
  userId: string,
  op: Extract<PendingServerOp, { type: "habit_log" }>,
): Promise<void> {
  const prefs = await loadPrefs(supabase, userId);
  const timestamp = new Date(op.payload.timestamp);
  const dayKey = getLocalDayKey(
    timestamp,
    prefs.day_starts_at_minutes,
    prefs.time_zone,
  );
  const notes =
    op.payload.notes == null || op.payload.notes.trim() === ""
      ? null
      : op.payload.notes.trim();

  const { error } = await supabase.from("habit_logs").upsert(
    {
      id: op.payload.id,
      user_id: userId,
      type: op.payload.type,
      timestamp: op.payload.timestamp,
      created_at: op.payload.createdAt,
      notes,
      day_key: dayKey,
      source: op.payload.source,
      payload: op.payload.payload,
    },
    { onConflict: "user_id,id" },
  );
  throwIfError(error);
}

async function applyDailyGoals(
  supabase: SupabaseClient,
  userId: string,
  op: Extract<PendingServerOp, { type: "daily_goals" }>,
): Promise<void> {
  const p = op.payload;
  const { error } = await supabase.from("daily_goals").upsert(
    {
      user_id: userId,
      food_kcal: p.foodKcal,
      water_amount: p.waterAmount,
      water_unit: p.waterUnit,
      train_minutes: p.trainMinutes,
      sleep_hours: p.sleepHours,
      steps: p.steps,
      active_kcal: p.activeKcal,
      weight_goal: p.weightGoal,
      weight_unit: p.weightUnit,
      updated_at: p.updatedAt,
    },
    { onConflict: "user_id" },
  );
  throwIfError(error);
}

async function applyProfile(
  supabase: SupabaseClient,
  userId: string,
  op: Extract<PendingServerOp, { type: "profile" }>,
): Promise<void> {
  const p = op.payload;
  let instagram: string | null;
  let tiktok: string | null;
  let youtube: string | null;
  try {
    instagram = parseSocialLink("instagram", p.instagram);
    tiktok = parseSocialLink("tiktok", p.tiktok);
    youtube = parseSocialLink("youtube", p.youtube);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid social link";
    throw new AppError(400, "VALIDATION_ERROR", message);
  }

  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: userId,
      display_name: p.displayName,
      bio: p.bio,
      home_gym_id: p.homeGymId,
      home_gym_name: p.homeGymName,
      profile_visible: p.profileVisible,
      instagram,
      tiktok,
      youtube,
      updated_at: p.updatedAt,
    },
    { onConflict: "user_id" },
  );
  throwIfError(error);
}

async function applyPrefs(
  supabase: SupabaseClient,
  userId: string,
  op: Extract<PendingServerOp, { type: "prefs" }>,
): Promise<void> {
  const p = op.payload;
  const existing = await supabase
    .from("prefs")
    .select(
      "unit_system,selected_theme_id,notif_accountability,notif_news,day_starts_at_minutes,time_zone,updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(existing.error);

  const updatedAt = p.updatedAt ?? new Date().toISOString();
  const row = {
    user_id: userId,
    unit_system: p.unitSystem ?? existing.data?.unit_system ?? "imperial",
    selected_theme_id:
      p.selectedThemeId ?? existing.data?.selected_theme_id ?? "blue",
    notif_accountability:
      p.notifAccountability ?? existing.data?.notif_accountability ?? false,
    notif_news: p.notifNews ?? existing.data?.notif_news ?? false,
    day_starts_at_minutes:
      p.dayStartsAtMinutes ?? existing.data?.day_starts_at_minutes ?? 0,
    time_zone: p.timeZone ?? existing.data?.time_zone ?? "UTC",
    updated_at: updatedAt,
  };

  const { error } = await supabase
    .from("prefs")
    .upsert(row, { onConflict: "user_id" });
  throwIfError(error);
}

async function applySavedMeal(
  supabase: SupabaseClient,
  userId: string,
  op: Extract<PendingServerOp, { type: "saved_meal" }>,
): Promise<void> {
  const p = op.payload;
  if ("deleted" in p && p.deleted === true && !("kcal" in p)) {
    const existing = await supabase
      .from("saved_meals")
      .select("id")
      .eq("user_id", userId)
      .eq("id", p.id)
      .maybeSingle();
    throwIfError(existing.error);

    if (existing.data) {
      const { error } = await supabase
        .from("saved_meals")
        .update({
          deleted: true,
          deleted_at: p.deletedAt,
          updated_at: p.deletedAt,
        })
        .eq("user_id", userId)
        .eq("id", p.id);
      throwIfError(error);
      return;
    }

    const { error } = await supabase.from("saved_meals").insert({
      id: p.id,
      user_id: userId,
      name: "",
      kcal: 0,
      deleted: true,
      deleted_at: p.deletedAt,
      updated_at: p.deletedAt,
    });
    throwIfError(error);
    return;
  }

  if (!("kcal" in p) || !("name" in p)) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid saved_meal payload");
  }

  const { error } = await supabase.from("saved_meals").upsert(
    {
      id: p.id,
      user_id: userId,
      name: p.name,
      vendor: p.vendor ?? null,
      portion_size: p.portionSize ?? null,
      kcal: p.kcal,
      protein_g: p.proteinG ?? null,
      carbs_g: p.carbsG ?? null,
      fat_g: p.fatG ?? null,
      meal_type: p.mealType ?? null,
      deleted: false,
      deleted_at: null,
      created_at: p.createdAt,
      updated_at: p.updatedAt,
    },
    { onConflict: "user_id,id" },
  );
  throwIfError(error);
}

async function applyLoadout(
  supabase: SupabaseClient,
  userId: string,
  op: Extract<PendingServerOp, { type: "loadout" }>,
): Promise<void> {
  const equipped = op.payload.equipped;
  const { error } = await supabase.from("loadouts").upsert(
    {
      user_id: userId,
      equipped,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  throwIfError(error);
}

async function recordAck(
  supabase: SupabaseClient,
  userId: string,
  op: PendingServerOp,
  ack: SyncAck,
): Promise<void> {
  const { error } = await supabase.from("sync_ops").insert({
    id: op.id,
    user_id: userId,
    type: op.type,
    status: ack.status,
    reason: ack.reason ?? null,
  });
  if (error) {
    if (error.code === "23505") {
      return;
    }
    throwIfError(error);
  }
}

async function ingestOne(
  supabase: SupabaseClient,
  userId: string,
  op: PendingServerOp,
): Promise<{ ack: SyncAck; recomputeXp: boolean }> {
  const existing = await supabase
    .from("sync_ops")
    .select("id,status,reason")
    .eq("user_id", userId)
    .eq("id", op.id)
    .maybeSingle();
  throwIfError(existing.error);
  if (existing.data) {
    return {
      ack: {
        id: op.id,
        status: existing.data.status as SyncAck["status"],
        ...(existing.data.reason ? { reason: existing.data.reason } : {}),
      },
      recomputeXp: false,
    };
  }

  if (trustForOpType(op.type) === "untrusted_client") {
    const ack: SyncAck = {
      id: op.id,
      status: "synced",
      reason: "ignored_untrusted",
    };
    await recordAck(supabase, userId, op, ack);
    return { ack, recomputeXp: false };
  }

  try {
    switch (op.type) {
      case "habit_log":
        await applyHabitLog(supabase, userId, op);
        break;
      case "daily_goals":
        await applyDailyGoals(supabase, userId, op);
        break;
      case "profile":
        await applyProfile(supabase, userId, op);
        break;
      case "prefs":
        await applyPrefs(supabase, userId, op);
        break;
      case "saved_meal":
        await applySavedMeal(supabase, userId, op);
        break;
      case "loadout":
        await applyLoadout(supabase, userId, op);
        break;
      default: {
        const ack: SyncAck = {
          id: op.id,
          status: "rejected",
          reason: "unsupported_type",
        };
        await recordAck(supabase, userId, op, ack);
        return { ack, recomputeXp: false };
      }
    }
  } catch (err) {
    if (err instanceof AppError && err.code === "VALIDATION_ERROR") {
      const ack: SyncAck = {
        id: op.id,
        status: "rejected",
        reason: err.message,
      };
      await recordAck(supabase, userId, op, ack);
      return { ack, recomputeXp: false };
    }
    throw err;
  }

  const ack: SyncAck = { id: op.id, status: "synced" };
  await recordAck(supabase, userId, op, ack);
  return {
    ack,
    recomputeXp: op.type === "habit_log" || op.type === "daily_goals",
  };
}

export async function ingestSyncOps(
  supabase: SupabaseClient,
  userId: string,
  ops: PendingServerOp[],
): Promise<SyncAck[]> {
  const acks: SyncAck[] = [];
  let recomputeXp = false;

  for (const op of ops) {
    const result = await ingestOne(supabase, userId, op);
    acks.push(result.ack);
    if (result.recomputeXp) {
      recomputeXp = true;
    }
  }

  if (recomputeXp) {
    await recomputeXpState(supabase, userId);
  }

  return acks;
}
