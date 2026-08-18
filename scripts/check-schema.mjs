#!/usr/bin/env node
/**
 * Diff live PostgREST schema against the Fit Pixel ingest tables.
 * Uses the service role (bypasses RLS) and never prints secrets.
 */
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const EXPECTED = {
  profiles: [
    "user_id",
    "display_name",
    "bio",
    "home_gym_id",
    "home_gym_name",
    "profile_visible",
    "instagram",
    "tiktok",
    "youtube",
    "updated_at",
  ],
  prefs: [
    "user_id",
    "unit_system",
    "selected_theme_id",
    "notif_accountability",
    "notif_news",
    "day_starts_at_minutes",
    "time_zone",
    "updated_at",
  ],
  daily_goals: [
    "user_id",
    "food_kcal",
    "water_amount",
    "water_unit",
    "train_minutes",
    "sleep_hours",
    "steps",
    "active_kcal",
    "weight_goal",
    "weight_unit",
    "updated_at",
  ],
  habit_logs: [
    "id",
    "user_id",
    "type",
    "timestamp",
    "created_at",
    "notes",
    "day_key",
    "source",
    "payload",
  ],
  saved_meals: [
    "id",
    "user_id",
    "name",
    "vendor",
    "portion_size",
    "kcal",
    "protein_g",
    "carbs_g",
    "fat_g",
    "meal_type",
    "deleted",
    "deleted_at",
    "created_at",
    "updated_at",
  ],
  loadouts: ["user_id", "equipped", "updated_at"],
  sync_ops: ["id", "user_id", "type", "status", "reason", "created_at"],
  xp_state: ["user_id", "lifetime_xp", "level", "updated_at"],
  gyms: ["id", "name", "latitude", "longitude", "image_key", "created_at"],
  conversations: ["id", "kind", "gym_id", "created_at"],
  conversation_members: [
    "conversation_id",
    "user_id",
    "joined_at",
    "last_read_at",
    "muted",
  ],
  messages: [
    "id",
    "conversation_id",
    "sender_id",
    "body",
    "created_at",
    "deleted_at",
  ],
  dm_pairs: ["user_lo", "user_hi", "conversation_id"],
  chat_authors: ["user_id", "display_name"],
};

const url = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url || !serviceKey) {
  console.error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for db:check.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const missingTables = [];
const missingColumns = [];
const extraNotes = [];

for (const [table, columns] of Object.entries(EXPECTED)) {
  const { error } = await supabase.from(table).select("*").limit(0);
  if (error) {
    const message = error.message ?? "";
    if (
      /could not find the table|schema cache|does not exist|relation/i.test(
        message,
      )
    ) {
      missingTables.push(table);
      continue;
    }
    extraNotes.push(`${table}: ${message}`);
    continue;
  }

  for (const column of columns) {
    const probe = await supabase.from(table).select(column).limit(0);
    if (probe.error) {
      missingColumns.push(`${table}.${column}`);
    }
  }
}

if (missingTables.length) {
  console.error("Missing tables:", missingTables.join(", "));
}
if (missingColumns.length) {
  console.error("Missing columns:", missingColumns.join(", "));
}
if (extraNotes.length) {
  console.error("Other errors:");
  for (const note of extraNotes) console.error(" ", note);
}

if (missingTables.length || missingColumns.length || extraNotes.length) {
  console.error(
    "Schema does not match supabase/migrations. Run npm run db:migrate.",
  );
  process.exit(1);
}

console.log(
  `Schema ok: ${Object.keys(EXPECTED).length} tables, ingest columns present.`,
);
