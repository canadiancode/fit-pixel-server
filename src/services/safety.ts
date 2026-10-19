import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../types/api";
import type { BlockedUserItem, CreateReportBody } from "../types/safety";

function throwIfError(
  error: { message: string; code?: string } | null,
  fallback = "Safety request failed",
): void {
  if (!error) return;
  console.error("Safety query failed:", error.code, error.message);
  throw new AppError(503, "SERVICE_UNAVAILABLE", fallback);
}

/** Users the caller has blocked. RLS only exposes the caller's own rows. */
export async function blockedUserIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("user_blocks")
    .select("blocked_id")
    .eq("blocker_id", userId);
  throwIfError(error);
  return (data ?? []).map((row) => String(row.blocked_id));
}

/** PostgREST `in` list for uuids (already validated, so no quoting needed). */
export function postgrestInList(ids: string[]): string {
  return `(${ids.join(",")})`;
}

export async function listBlockedUsers(
  supabase: SupabaseClient,
  userId: string,
): Promise<BlockedUserItem[]> {
  const { data, error } = await supabase
    .from("user_blocks")
    .select("blocked_id, created_at")
    .eq("blocker_id", userId)
    .order("created_at", { ascending: false });
  throwIfError(error);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const { data: authors, error: authorsError } = await supabase
    .from("chat_authors")
    .select("user_id, display_name")
    .in(
      "user_id",
      rows.map((row) => String(row.blocked_id)),
    );
  throwIfError(authorsError);

  const names = new Map<string, string>();
  for (const row of authors ?? []) {
    names.set(
      String(row.user_id),
      String(row.display_name ?? "").trim() || "Pixel",
    );
  }

  return rows.map((row) => ({
    userId: String(row.blocked_id),
    displayName: names.get(String(row.blocked_id)) ?? "Pixel",
    blockedAt: String(row.created_at),
  }));
}

export async function blockUser(
  supabase: SupabaseClient,
  userId: string,
  blockedId: string,
): Promise<void> {
  if (blockedId === userId) {
    throw new AppError(400, "BAD_REQUEST", "You cannot block yourself");
  }
  const { error } = await supabase.from("user_blocks").upsert(
    { blocker_id: userId, blocked_id: blockedId },
    { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true },
  );
  if (error?.code === "23503") {
    throw new AppError(404, "NOT_FOUND", "Pixel not found");
  }
  throwIfError(error);
}

export async function unblockUser(
  supabase: SupabaseClient,
  userId: string,
  blockedId: string,
): Promise<void> {
  const { error } = await supabase
    .from("user_blocks")
    .delete()
    .eq("blocker_id", userId)
    .eq("blocked_id", blockedId);
  throwIfError(error);
}

/**
 * File a report. When a message is named, its body is snapshotted (the reporter
 * must be able to read it under RLS) so moderation still works if it is edited.
 */
export async function createReport(
  supabase: SupabaseClient,
  userId: string,
  input: CreateReportBody,
): Promise<void> {
  if (input.reportedUserId === userId) {
    throw new AppError(400, "BAD_REQUEST", "You cannot report yourself");
  }

  let conversationId: string | null = null;
  let messageBody: string | null = null;
  if (input.messageId) {
    const { data: message, error } = await supabase
      .from("messages")
      .select("conversation_id, sender_id, body")
      .eq("id", input.messageId)
      .maybeSingle();
    throwIfError(error);
    if (!message || String(message.sender_id) !== input.reportedUserId) {
      throw new AppError(404, "NOT_FOUND", "Message not found");
    }
    conversationId = String(message.conversation_id);
    messageBody = String(message.body ?? "");
  }

  const { error } = await supabase.from("content_reports").insert({
    reporter_id: userId,
    reported_user_id: input.reportedUserId,
    conversation_id: conversationId,
    message_id: input.messageId ?? null,
    message_body: messageBody,
    reason: input.reason,
    details: input.details || null,
  });
  // Same reporter + message twice: already on file, treat as success.
  if (error?.code === "23505") return;
  if (error?.code === "23503") {
    throw new AppError(404, "NOT_FOUND", "Pixel not found");
  }
  throwIfError(error);
}

/** Calls the security-definer RPC; cascades remove all of the user's rows. */
export async function deleteOwnAccount(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("delete_my_account");
  throwIfError(error, "Could not delete account");
}
