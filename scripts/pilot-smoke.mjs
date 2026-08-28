#!/usr/bin/env node
/**
 * Closed-pilot smoke: signup → /v1/me → habit sync → Postgres row →
 * food search (FatSecret) → gym join/message → password-reset page.
 * Cleans up the throwaway user. Never prints tokens, passwords, or env values.
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const API_BASE = (
  process.env.FIT_PIXEL_API_URL ?? "https://api.aurashields.com"
).replace(/\/$/, "");

const supabaseUrl = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!supabaseUrl || !anonKey || !serviceKey) {
  console.error(
    "Need SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const failures = [];
function pass(name) {
  console.log(`ok  ${name}`);
}
function fail(name, detail) {
  failures.push(name);
  console.error(`FAIL  ${name}${detail ? `: ${detail}` : ""}`);
}

async function api(path, { method = "GET", token, json } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

const email = `pilot-smoke-${Date.now()}@fitpixel.test`;
const password = `Sm0ke-${randomUUID().slice(0, 12)}-Aa`;
let userId = null;

const userClient = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function cleanup() {
  if (!userId) return;
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error("cleanup: could not delete throwaway user");
  } else {
    console.log("ok  cleanup throwaway user");
  }
}

try {
  const health = await api("/health", { token: undefined });
  if (health.status === 200 && health.body?.ok === true) pass("GET /health");
  else fail("GET /health", `status ${health.status}`);

  const ready = await api("/ready");
  if (ready.status === 200 && ready.body?.supabaseConfigured === true) {
    pass("GET /ready supabaseConfigured");
  } else {
    fail("GET /ready supabaseConfigured", `status ${ready.status}`);
  }

  const callback = await fetch(`${API_BASE}/auth/callback`);
  const callbackHtml = await callback.text();
  if (
    callback.status === 200 &&
    callback.headers.get("content-type")?.includes("text/html") &&
    /password/i.test(callbackHtml)
  ) {
    pass("GET /auth/callback password form");
  } else {
    fail("GET /auth/callback password form", `status ${callback.status}`);
  }

  const { data: signUpData, error: signUpError } = await userClient.auth.signUp({
    email,
    password,
  });
  if (signUpError) {
    fail("signup", signUpError.message);
    throw new Error("signup-failed");
  }
  if (!signUpData.session?.access_token || !signUpData.user?.id) {
    fail(
      "signup session",
      "no session — confirm-email may still be required",
    );
    throw new Error("signup-no-session");
  }
  userId = signUpData.user.id;
  const token = signUpData.session.access_token;
  pass("signup email/password (autoconfirm)");

  const me = await api("/v1/me", { token });
  if (me.status === 200 && me.body?.id === userId) pass("GET /v1/me");
  else fail("GET /v1/me", `status ${me.status} code ${me.body?.code ?? ""}`);

  const habitId = randomUUID();
  const now = new Date().toISOString();
  const dayKey = now.slice(0, 10);
  const sync = await api("/v1/sync", {
    method: "POST",
    token,
    json: {
      ops: [
        {
          id: habitId,
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
            dayKey,
            payload: { amount: 8, unit: "oz" },
          },
        },
      ],
    },
  });
  const ack = Array.isArray(sync.body?.acks) ? sync.body.acks[0] : null;
  if (sync.status === 200 && ack?.status === "synced") {
    pass("POST /v1/sync habit_log");
  } else {
    fail(
      "POST /v1/sync habit_log",
      `status ${sync.status} ack ${ack?.status ?? "none"} ${ack?.reason ?? ""}`,
    );
  }

  const { data: habitRow, error: habitErr } = await admin
    .from("habit_logs")
    .select("id")
    .eq("user_id", userId)
    .eq("id", habitId)
    .maybeSingle();
  if (!habitErr && habitRow?.id === habitId) {
    pass("habit_logs row in Postgres");
  } else {
    fail("habit_logs row in Postgres", habitErr?.message ?? "missing row");
  }

  const food = await api("/v1/food/search?q=toast", { token });
  if (food.status === 200 && Array.isArray(food.body?.foods)) {
    pass(`GET /v1/food/search (${food.body.foods.length} foods)`);
  } else if (food.status === 501) {
    fail("GET /v1/food/search", "501 FatSecret not configured on this host");
  } else {
    fail(
      "GET /v1/food/search",
      `status ${food.status} code ${food.body?.code ?? ""}`,
    );
  }

  const gyms = await api("/v1/gyms", { token });
  const gymList = Array.isArray(gyms.body?.gyms) ? gyms.body.gyms : [];
  if (gyms.status === 200 && gymList.length > 0) {
    pass(`GET /v1/gyms (${gymList.length})`);
    const gymId = gymList[0].id;
    const join = await api(`/v1/gyms/${encodeURIComponent(gymId)}/join`, {
      method: "POST",
      token,
    });
    if (join.status === 200 && join.body?.ok === true) pass("POST gym join");
    else fail("POST gym join", `status ${join.status}`);

    const msg = await api(`/v1/gyms/${encodeURIComponent(gymId)}/messages`, {
      method: "POST",
      token,
      json: { body: "pilot smoke" },
    });
    if (msg.status === 200 && msg.body?.message?.id) pass("POST gym message");
    else fail("POST gym message", `status ${msg.status}`);

    const leave = await api(`/v1/gyms/${encodeURIComponent(gymId)}/leave`, {
      method: "DELETE",
      token,
    });
    if (leave.status === 200) pass("DELETE gym leave");
    else fail("DELETE gym leave", `status ${leave.status}`);
  } else {
    fail("GET /v1/gyms", `status ${gyms.status} count ${gymList.length}`);
  }

  console.log(
    "note  sign-out wipe is client-side (wipeLocalUserData + deletePixelPersistedState)",
  );
} catch (err) {
  if (err instanceof Error && err.message !== "signup-failed" && err.message !== "signup-no-session") {
    fail("unexpected", err.message);
  }
} finally {
  await cleanup();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll smoke checks passed.");
