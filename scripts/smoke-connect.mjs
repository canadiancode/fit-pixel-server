#!/usr/bin/env node
/**
 * End-to-end: Auth → GET /v1/me → POST /v1/sync (habit_log) → habit_logs row.
 * Mirrors the Expo outbox drain. Never prints tokens or connection strings.
 */
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const url = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const apiBase = (
  process.env.FIT_PIXEL_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3001}`
)
  .trim()
  .replace(/\/$/, "");

if (!url || !anonKey || !serviceKey) {
  console.error(
    "SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are required.",
  );
  process.exit(1);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function apiJson(path, { method = "GET", token, json } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

const ready = await apiJson("/ready");
if (ready.status !== 200 || ready.body?.supabaseConfigured !== true) {
  fail(
    `/ready did not report supabaseConfigured=true (status ${ready.status}). Is the API running?`,
  );
}
console.log("GET /ready ok");

const email = `smoke.${randomUUID().slice(0, 8)}@fitpixel.test`;
const password = `Smk-${randomUUID()}aA1`;

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const userClient = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const created = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (created.error || !created.data.user) {
  fail(`Could not create smoke user: ${created.error?.message ?? "unknown"}`);
}
const userId = created.data.user.id;

let accessToken = "";
try {
  const signedIn = await userClient.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session?.access_token) {
    fail(`Sign-in failed: ${signedIn.error?.message ?? "no session"}`);
  }
  accessToken = signedIn.data.session.access_token;
  console.log("Supabase Auth sign-in ok");

  const me = await apiJson("/v1/me", { token: accessToken });
  if (me.status !== 200 || me.body?.id !== userId) {
    fail(
      `GET /v1/me failed (status ${me.status}, code ${me.body?.code ?? "?"})`,
    );
  }
  console.log("GET /v1/me ok (JWT + prefs reachable)");

  const now = new Date().toISOString();
  const opId = randomUUID();
  const habitId = randomUUID();
  const sync = await apiJson("/v1/sync", {
    method: "POST",
    token: accessToken,
    json: {
      ops: [
        {
          id: opId,
          type: "habit_log",
          schemaVersion: 1,
          trust: "fact",
          clientClockAt: now,
          payload: {
            id: habitId,
            type: "water",
            timestamp: now,
            createdAt: now,
            source: "manual",
            notes: null,
            dayKey: "2000-01-01",
            payload: { amount: 8, unit: "oz" },
          },
        },
      ],
    },
  });

  const ack = sync.body?.acks?.[0];
  if (sync.status !== 200 || ack?.status !== "synced") {
    fail(
      `POST /v1/sync failed (status ${sync.status}, ack ${ack?.status ?? "none"}, reason ${ack?.reason ?? sync.body?.code ?? "?"})`,
    );
  }
  console.log("POST /v1/sync habit_log ack synced");

  const scoped = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await scoped
    .from("habit_logs")
    .select("id,user_id,type")
    .eq("id", habitId)
    .maybeSingle();
  if (error) {
    fail(`habit_logs select failed: ${error.message}`);
  }
  if (!data || data.user_id !== userId || data.type !== "water") {
    fail("habit_logs row missing or not scoped to the signed-in user");
  }
  console.log("habit_logs row present under RLS");
} finally {
  const deleted = await admin.auth.admin.deleteUser(userId);
  if (deleted.error) {
    console.error("Warning: could not delete smoke user");
  }
}

console.log(`Smoke ok against ${apiBase}`);
