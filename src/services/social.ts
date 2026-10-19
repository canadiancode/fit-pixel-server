import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../types/api";
import { PIXEL_LAYER_IDS } from "../types/limits";
import {
  SOCIAL_LIMITS,
  type FriendItem,
  type FriendRequestItem,
  type FriendsOverview,
  type FriendshipStatus,
  type NotificationItem,
  type NotificationKind,
  type PixelProfile,
} from "../types/social";
import { blockedUserIds } from "./safety";

type FriendshipRow = {
  user_lo: string;
  user_hi: string;
  requester_id: string;
  status: "pending" | "accepted";
  created_at: string;
  accepted_at: string | null;
};

type PixelCard = {
  displayName: string;
  bio: string;
  homeGymName: string | null;
  equipped: Record<string, string>;
};

function throwIfError(
  error: { message: string; code?: string } | null,
  fallback = "Social request failed",
): void {
  if (!error) return;
  console.error("Social query failed:", error.code, error.message);
  throw new AppError(503, "SERVICE_UNAVAILABLE", fallback);
}

/** Map RPC errors raised in the friends SQL functions to API errors. */
function throwRpcError(error: { message?: string; code?: string } | null): void {
  if (!error) return;
  const message = error.message ?? "";
  if (/invalid peer/i.test(message)) {
    throw new AppError(400, "BAD_REQUEST", "You can't friend yourself");
  }
  if (/peer not found/i.test(message)) {
    throw new AppError(404, "NOT_FOUND", "Pixel not found");
  }
  if (/request not found/i.test(message)) {
    throw new AppError(404, "NOT_FOUND", "That friend request is gone");
  }
  if (/blocked/i.test(message) || error.code === "42501") {
    throw new AppError(403, "FORBIDDEN", "You can't add this Pixel");
  }
  throwIfError({ message, code: error.code });
}

/** Keep only known layer → item id strings from a stored loadout. */
export function sanitizeEquipped(value: unknown): Record<string, string> {
  const equipped: Record<string, string> = {};
  if (value == null || typeof value !== "object") return equipped;
  const record = value as Record<string, unknown>;
  for (const layer of PIXEL_LAYER_IDS) {
    const itemId = record[layer];
    if (typeof itemId === "string" && itemId.length > 0 && itemId.length <= 120) {
      equipped[layer] = itemId;
    }
  }
  return equipped;
}

async function pixelCards(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<Map<string, PixelCard>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const cards = new Map<string, PixelCard>();
  if (unique.length === 0) return cards;

  const { data, error } = await supabase
    .from("pixel_cards")
    .select("user_id, display_name, bio, home_gym_name, equipped")
    .in("user_id", unique);
  throwIfError(error);

  for (const row of data ?? []) {
    cards.set(String(row.user_id), {
      displayName: String(row.display_name ?? "").trim() || "Pixel",
      bio: String(row.bio ?? "").trim(),
      homeGymName:
        typeof row.home_gym_name === "string" && row.home_gym_name.trim()
          ? row.home_gym_name.trim()
          : null,
      equipped: sanitizeEquipped(row.equipped),
    });
  }
  return cards;
}

function peerOf(row: FriendshipRow, userId: string): string {
  return row.user_lo === userId ? row.user_hi : row.user_lo;
}

async function friendshipRows(
  supabase: SupabaseClient,
  userId: string,
): Promise<FriendshipRow[]> {
  const { data, error } = await supabase
    .from("friendships")
    .select("user_lo, user_hi, requester_id, status, created_at, accepted_at")
    .or(`user_lo.eq.${userId},user_hi.eq.${userId}`);
  throwIfError(error);
  return (data ?? []) as FriendshipRow[];
}

export async function listFriends(
  supabase: SupabaseClient,
  userId: string,
): Promise<FriendsOverview> {
  const [rows, blocked] = await Promise.all([
    friendshipRows(supabase, userId),
    blockedUserIds(supabase, userId),
  ]);
  const blockedSet = new Set(blocked);
  const visible = rows.filter((row) => !blockedSet.has(peerOf(row, userId)));
  const cards = await pixelCards(
    supabase,
    visible.map((row) => peerOf(row, userId)),
  );

  const friends: FriendItem[] = [];
  const incoming: FriendRequestItem[] = [];
  const outgoing: FriendRequestItem[] = [];

  for (const row of visible) {
    const peer = peerOf(row, userId);
    const card = cards.get(peer);
    if (!card) continue; // account deleted between queries
    if (row.status === "accepted") {
      friends.push({
        userId: peer,
        displayName: card.displayName,
        equipped: card.equipped,
        since: row.accepted_at ?? row.created_at,
      });
      continue;
    }
    const request: FriendRequestItem = {
      userId: peer,
      displayName: card.displayName,
      equipped: card.equipped,
      requestedAt: row.created_at,
    };
    if (row.requester_id === userId) {
      outgoing.push(request);
    } else {
      incoming.push(request);
    }
  }

  friends.sort((a, b) => a.displayName.localeCompare(b.displayName));
  incoming.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  outgoing.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  return { friends, incoming, outgoing };
}

export async function friendshipStatus(
  supabase: SupabaseClient,
  userId: string,
  peerUserId: string,
): Promise<FriendshipStatus> {
  if (peerUserId === userId) return "self";
  const [lo, hi] = userId < peerUserId ? [userId, peerUserId] : [peerUserId, userId];
  const { data, error } = await supabase
    .from("friendships")
    .select("requester_id, status")
    .eq("user_lo", lo)
    .eq("user_hi", hi)
    .maybeSingle();
  throwIfError(error);
  if (!data) return "none";
  if (data.status === "accepted") return "friends";
  return data.requester_id === userId ? "pending_outgoing" : "pending_incoming";
}

export async function sendFriendRequest(
  supabase: SupabaseClient,
  peerUserId: string,
): Promise<FriendshipStatus> {
  const { data, error } = await supabase.rpc("send_friend_request", {
    peer_user_id: peerUserId,
  });
  throwRpcError(error);
  return data === "accepted" ? "friends" : "pending_outgoing";
}

export async function respondFriendRequest(
  supabase: SupabaseClient,
  peerUserId: string,
  accept: boolean,
): Promise<FriendshipStatus> {
  const { data, error } = await supabase.rpc("respond_friend_request", {
    peer_user_id: peerUserId,
    accept,
  });
  throwRpcError(error);
  return data === "accepted" ? "friends" : "none";
}

export async function removeFriend(
  supabase: SupabaseClient,
  peerUserId: string,
): Promise<void> {
  const { error } = await supabase.rpc("remove_friend", {
    peer_user_id: peerUserId,
  });
  throwRpcError(error);
}

/** Looks for chat avatars; unknown / deleted ids are simply omitted. */
export async function listPixelLooks(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<{ userId: string; displayName: string; equipped: Record<string, string> }[]> {
  const cards = await pixelCards(supabase, userIds);
  return [...cards.entries()].map(([userId, card]) => ({
    userId,
    displayName: card.displayName,
    equipped: card.equipped,
  }));
}

/** Public card for another Pixel plus the caller's relationship to them. */
export async function getPixelProfile(
  supabase: SupabaseClient,
  userId: string,
  peerUserId: string,
): Promise<PixelProfile> {
  const [cards, friendship, blocked] = await Promise.all([
    pixelCards(supabase, [peerUserId]),
    friendshipStatus(supabase, userId, peerUserId),
    blockedUserIds(supabase, userId),
  ]);
  const card = cards.get(peerUserId);
  if (!card) {
    throw new AppError(404, "NOT_FOUND", "Pixel not found");
  }
  return {
    userId: peerUserId,
    ...card,
    friendship,
    isBlocked: blocked.includes(peerUserId),
  };
}

export async function listNotifications(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ notifications: NotificationItem[]; unreadCount: number }> {
  const [{ data, error }, { count, error: countError }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, kind, actor_id, conversation_id, body, created_at, read_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(SOCIAL_LIMITS.notificationPageMax),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null),
  ]);
  throwIfError(error);
  throwIfError(countError);

  const rows = data ?? [];
  const cards = await pixelCards(
    supabase,
    rows.map((row) => String(row.actor_id ?? "")),
  );

  const notifications = rows.map((row) => {
    const actorId = row.actor_id ? String(row.actor_id) : null;
    return {
      id: String(row.id),
      kind: row.kind as NotificationKind,
      actorId,
      actorDisplayName: (actorId && cards.get(actorId)?.displayName) || "Pixel",
      conversationId: row.conversation_id ? String(row.conversation_id) : null,
      body: typeof row.body === "string" ? row.body : null,
      createdAt: String(row.created_at),
      read: row.read_at != null,
    };
  });
  return { notifications, unreadCount: count ?? 0 };
}

export async function markNotificationsRead(
  supabase: SupabaseClient,
  userId: string,
  ids?: string[],
): Promise<void> {
  let query = supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
  if (ids && ids.length > 0) {
    query = query.in("id", ids);
  }
  const { error } = await query;
  throwIfError(error);
}

/** Opening a DM clears its message notification. */
export async function markConversationNotificationsRead(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .is("read_at", null);
  throwIfError(error);
}
