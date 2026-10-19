import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env";
import { AppError } from "../types/api";
import type {
  PendingServerOp,
  SyncAck,
} from "../types/sync";
import { trustForOpType } from "../types/sync";
import { parseSocialLink } from "../utils/social";
import { recomputeXpState } from "./xp-recompute";

function throwIfError(
  error: { message: string; code?: string } | null,
): void {
  if (error) {
    if (env.NODE_ENV !== "production") {
      console.error("Sync persist failed:", error.code, error.message);
    }
    throw new AppError(500, "INTERNAL_ERROR", "Sync persist failed");
  }
}

/** Per-batch caches so a 500-op batch costs O(1) lookups, not O(ops). */
type BatchContext = {
  /** Acks already stored for this batch's op ids (prefetched + recorded). */
  acks: Map<string, SyncAck>;
};

function storedAck(row: {
  id: string;
  status: string;
  reason: string | null;
}): SyncAck {
  return {
    id: row.id,
    status: row.status as SyncAck["status"],
    ...(row.reason ? { reason: row.reason } : {}),
  };
}

/** One call for the whole batch instead of one sync_ops lookup per op. */
async function loadStoredAcks(
  supabase: SupabaseClient,
  ops: PendingServerOp[],
): Promise<Map<string, SyncAck>> {
  const acks = new Map<string, SyncAck>();
  const ids = [...new Set(ops.map((op) => op.id))];
  if (ids.length === 0) return acks;

  const { data, error } = await supabase.rpc("my_sync_ops", { op_ids: ids });
  throwIfError(error);
  for (const row of (data ?? []) as {
    id: string;
    status: string;
    reason: string | null;
  }[]) {
    acks.set(String(row.id), storedAck(row));
  }
  return acks;
}

/**
 * habit_logs is read-only to clients. upsert_my_habit_log re-validates the
 * payload, trims notes, derives day_key from the stored prefs and stamps
 * created_at, so the client's dayKey / createdAt are not sent.
 */
async function applyHabitLog(
  supabase: SupabaseClient,
  op: Extract<PendingServerOp, { type: "habit_log" }>,
): Promise<void> {
  const { error } = await supabase.rpc("upsert_my_habit_log", {
    log_id: op.payload.id,
    log_type: op.payload.type,
    log_timestamp: op.payload.timestamp,
    log_source: op.payload.source,
    log_payload: op.payload.payload,
    log_notes: op.payload.notes,
  });
  if (error?.code === "22023") {
    throw new AppError(400, "VALIDATION_ERROR", error.message);
  }
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
  // Later habit_logs in this batch read the new day boundary in the DB.
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
  ctx: BatchContext,
): Promise<void> {
  const { error } = await supabase.from("sync_ops").insert({
    id: op.id,
    user_id: userId,
    type: op.type,
    status: ack.status,
    reason: ack.reason ?? null,
  });
  if (error && error.code !== "23505") {
    throwIfError(error);
  }
  // A repeat of this op id later in the batch replays the stored ack.
  ctx.acks.set(
    op.id,
    storedAck({ id: op.id, status: ack.status, reason: ack.reason ?? null }),
  );
}

async function ingestOne(
  supabase: SupabaseClient,
  userId: string,
  op: PendingServerOp,
  ctx: BatchContext,
): Promise<{ ack: SyncAck; recomputeXp: boolean }> {
  const existing = ctx.acks.get(op.id);
  if (existing) {
    return { ack: existing, recomputeXp: false };
  }

  if (trustForOpType(op.type) === "untrusted_client") {
    const ack: SyncAck = {
      id: op.id,
      status: "synced",
      reason: "ignored_untrusted",
    };
    await recordAck(supabase, userId, op, ack, ctx);
    return { ack, recomputeXp: false };
  }

  try {
    switch (op.type) {
      case "habit_log":
        await applyHabitLog(supabase, op);
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
        await recordAck(supabase, userId, op, ack, ctx);
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
      await recordAck(supabase, userId, op, ack, ctx);
      return { ack, recomputeXp: false };
    }
    throw err;
  }

  const ack: SyncAck = { id: op.id, status: "synced" };
  await recordAck(supabase, userId, op, ack, ctx);
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
  const ctx: BatchContext = {
    acks: await loadStoredAcks(supabase, ops),
  };

  for (const op of ops) {
    const result = await ingestOne(supabase, userId, op, ctx);
    acks.push(result.ack);
    if (result.recomputeXp) {
      recomputeXp = true;
    }
  }

  if (recomputeXp) {
    await recomputeXpState(supabase);
  }

  return acks;
}
