import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../types/api";
import {
  GYM_SUBMISSION_LIMITS,
  type CreateGymSubmissionBody,
  type GymSubmissionItem,
} from "../types/gym-submissions";

/**
 * Gyms users suggest from the map. Rows go in as pending; the owner approves or
 * rejects them in fit-pixel-dashboard, which publishes approved ones to
 * public.gyms (see 20261028000000_gym_submissions.sql).
 */

const COLUMNS =
  "id, name, address, kind, notes, latitude, longitude, status, reviewer_notes, gym_id, created_at, reviewed_at";

type SubmissionRow = {
  id: string;
  name: string;
  address: string | null;
  kind: string | null;
  notes: string | null;
  latitude: number;
  longitude: number;
  status: GymSubmissionItem["status"];
  reviewer_notes: string | null;
  gym_id: string | null;
  created_at: string;
  reviewed_at: string | null;
};

function throwIfError(
  error: { message: string; code?: string } | null,
  fallback = "Couldn't save that gym right now. Try again shortly.",
): void {
  if (!error) return;
  console.error("Gym submission query failed:", error.code, error.message);
  throw new AppError(503, "SERVICE_UNAVAILABLE", fallback);
}

function mapSubmission(row: SubmissionRow): GymSubmissionItem {
  return {
    id: String(row.id),
    name: row.name,
    address: row.address,
    kind: row.kind as GymSubmissionItem["kind"],
    notes: row.notes,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    status: row.status,
    reviewerNotes: row.reviewer_notes,
    gymId: row.gym_id,
    createdAt: String(row.created_at),
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
  };
}

const tooManyPending = () =>
  new AppError(
    429,
    "RATE_LIMITED",
    `You have ${GYM_SUBMISSION_LIMITS.pendingMax} gyms waiting for review. Try again once they're checked.`,
  );

export async function createGymSubmission(
  supabase: SupabaseClient,
  userId: string,
  input: CreateGymSubmissionBody,
): Promise<GymSubmissionItem> {
  const { data: pending, error: countError } = await supabase.rpc(
    "my_pending_gym_submissions",
  );
  throwIfError(countError);
  if (Number(pending ?? 0) >= GYM_SUBMISSION_LIMITS.pendingMax) {
    throw tooManyPending();
  }

  const { data, error } = await supabase
    .from("gym_submissions")
    .insert({
      submitter_id: userId,
      name: input.name,
      address: input.address ?? null,
      kind: input.kind ?? null,
      notes: input.notes ?? null,
      latitude: input.latitude,
      longitude: input.longitude,
    })
    .select(COLUMNS)
    .single();
  // 42501: the insert policy's pending cap (a race past the check above).
  if (error?.code === "42501") throw tooManyPending();
  throwIfError(error);
  return mapSubmission(data as SubmissionRow);
}

/** The caller's submissions, newest first. RLS limits rows to their own. */
export async function listMyGymSubmissions(
  supabase: SupabaseClient,
  userId: string,
): Promise<GymSubmissionItem[]> {
  const { data, error } = await supabase
    .from("gym_submissions")
    .select(COLUMNS)
    .eq("submitter_id", userId)
    .order("created_at", { ascending: false })
    .limit(GYM_SUBMISSION_LIMITS.listMax);
  throwIfError(error);
  return ((data ?? []) as SubmissionRow[]).map(mapSubmission);
}
