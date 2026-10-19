import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../types/api";
import type {
  ChatMessage,
  DmListItem,
  GymChatListItem,
  GymListItem,
  PixelSearchItem,
} from "../types/chat";
import { CHAT_LIMITS } from "../types/limits";
import { blockedUserIds, postgrestInList } from "./safety";
import { markConversationNotificationsRead, sanitizeEquipped } from "./social";

type GymRow = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  image_key: string | null;
};

type ConversationRow = {
  id: string;
  kind: "gym" | "dm";
  gym_id: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
};

function throwIfError(
  error: { message: string; code?: string } | null,
  fallback = "Chat request failed",
): void {
  if (!error) return;
  console.error("Chat query failed:", error.code, error.message);
  throw new AppError(503, "SERVICE_UNAVAILABLE", fallback);
}

function mapGym(
  gym: GymRow,
  conversationId: string,
  memberCount: number,
  membership: Membership | undefined,
): GymListItem {
  return {
    id: gym.id,
    name: gym.name,
    latitude: gym.latitude,
    longitude: gym.longitude,
    imageKey: gym.image_key,
    conversationId,
    memberCount,
    joined: membership != null,
    favorite: membership?.favorite ?? false,
    lastVisitedAt: membership?.lastVisitedAt ?? null,
  };
}

async function authorNames(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;

  const { data, error } = await supabase
    .from("chat_authors")
    .select("user_id, display_name")
    .in("user_id", unique);
  throwIfError(error);

  for (const row of data ?? []) {
    const id = String(row.user_id ?? "");
    names.set(id, String(row.display_name ?? "").trim() || "Pixel");
  }
  return names;
}

function toChatMessage(
  row: MessageRow,
  names: Map<string, string>,
): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderDisplayName: names.get(row.sender_id) ?? "Pixel",
    body: row.body,
    createdAt: row.created_at,
  };
}

async function memberCounts(
  supabase: SupabaseClient,
  conversationIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (conversationIds.length === 0) return counts;

  // Counted in SQL: one row per gym, and includes members RLS would hide.
  const { data, error } = await supabase.rpc("gym_member_counts", {
    conversation_ids: conversationIds,
  });
  throwIfError(error);

  for (const row of (data ?? []) as {
    conversation_id: string;
    member_count: number;
  }[]) {
    counts.set(String(row.conversation_id ?? ""), Number(row.member_count ?? 0));
  }
  return counts;
}

type Membership = {
  favorite: boolean;
  /** last_read_at: set whenever the member opens the thread. */
  lastVisitedAt: string | null;
};

/** The caller's membership rows for these conversations, by conversation id. */
async function myMemberships(
  supabase: SupabaseClient,
  userId: string,
  conversationIds: string[],
): Promise<Map<string, Membership>> {
  const memberships = new Map<string, Membership>();
  if (conversationIds.length === 0) return memberships;

  const query = (columns: string) =>
    supabase
      .from("conversation_members")
      .select(columns)
      .eq("user_id", userId)
      .in("conversation_id", conversationIds);

  let { data, error } = await query("conversation_id, last_read_at, favorite");
  // 42703: favorite column missing (20261024000000_gym_favorites.sql not
  // applied yet). Keep the gym list working without favourites.
  if (error?.code === "42703") {
    ({ data, error } = await query("conversation_id, last_read_at"));
  }
  throwIfError(error);

  for (const row of (data ?? []) as unknown as {
    conversation_id: string;
    last_read_at: string | null;
    favorite?: boolean;
  }[]) {
    memberships.set(String(row.conversation_id ?? ""), {
      favorite: row.favorite === true,
      lastVisitedAt: row.last_read_at ? String(row.last_read_at) : null,
    });
  }
  return memberships;
}

export async function listGyms(
  supabase: SupabaseClient,
  userId: string,
): Promise<GymListItem[]> {
  const { data: gyms, error: gymsError } = await supabase
    .from("gyms")
    .select("id, name, latitude, longitude, image_key")
    .order("id", { ascending: true });
  throwIfError(gymsError);

  const { data: conversations, error: convError } = await supabase
    .from("conversations")
    .select("id, gym_id")
    .eq("kind", "gym");
  throwIfError(convError);

  const convByGym = new Map<string, string>();
  for (const row of conversations ?? []) {
    if (row.gym_id) convByGym.set(String(row.gym_id), String(row.id));
  }

  const conversationIds = [...convByGym.values()];
  const [counts, memberships] = await Promise.all([
    memberCounts(supabase, conversationIds),
    myMemberships(supabase, userId, conversationIds),
  ]);

  return (gyms ?? []).map((gym) => {
    const conversationId = convByGym.get(gym.id) ?? "";
    return mapGym(
      gym as GymRow,
      conversationId,
      counts.get(conversationId) ?? 0,
      memberships.get(conversationId),
    );
  });
}

export async function getGym(
  supabase: SupabaseClient,
  userId: string,
  gymId: string,
): Promise<GymListItem> {
  const { data: gym, error: gymError } = await supabase
    .from("gyms")
    .select("id, name, latitude, longitude, image_key")
    .eq("id", gymId)
    .maybeSingle();
  throwIfError(gymError);
  if (!gym) {
    throw new AppError(404, "NOT_FOUND", "Gym not found");
  }

  const conversation = await getGymConversation(supabase, gymId);
  const [counts, memberships] = await Promise.all([
    memberCounts(supabase, [conversation.id]),
    myMemberships(supabase, userId, [conversation.id]),
  ]);

  return mapGym(
    gym as GymRow,
    conversation.id,
    counts.get(conversation.id) ?? 0,
    memberships.get(conversation.id),
  );
}

async function getGymConversation(
  supabase: SupabaseClient,
  gymId: string,
): Promise<ConversationRow> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, kind, gym_id")
    .eq("kind", "gym")
    .eq("gym_id", gymId)
    .maybeSingle();
  throwIfError(error);
  if (!data) {
    throw new AppError(404, "NOT_FOUND", "Gym chat is not available");
  }
  return data as ConversationRow;
}

export async function joinGymChat(
  supabase: SupabaseClient,
  userId: string,
  gymId: string,
): Promise<GymListItem> {
  const conversation = await getGymConversation(supabase, gymId);
  const { error } = await supabase.from("conversation_members").upsert(
    {
      conversation_id: conversation.id,
      user_id: userId,
    },
    // DO NOTHING on a re-join: clients can only UPDATE last_read_at, muted
    // and favorite (20261024000000_gym_favorites.sql).
    { onConflict: "conversation_id,user_id", ignoreDuplicates: true },
  );
  throwIfError(error);
  return getGym(supabase, userId, gymId);
}

/** Star or un-star a gym chat. Favouriting a gym you haven't joined joins it. */
export async function setGymFavorite(
  supabase: SupabaseClient,
  userId: string,
  gymId: string,
  favorite: boolean,
): Promise<GymListItem> {
  const conversation = await getGymConversation(supabase, gymId);
  if (favorite) {
    const { error } = await supabase.from("conversation_members").upsert(
      { conversation_id: conversation.id, user_id: userId },
      { onConflict: "conversation_id,user_id", ignoreDuplicates: true },
    );
    throwIfError(error);
  }
  const { error } = await supabase
    .from("conversation_members")
    .update({ favorite })
    .eq("conversation_id", conversation.id)
    .eq("user_id", userId);
  if (error?.code === "42703") {
    throw new AppError(
      503,
      "SERVICE_UNAVAILABLE",
      "Favourites aren't available yet. Try again later.",
    );
  }
  throwIfError(error);
  return getGym(supabase, userId, gymId);
}

export async function leaveGymChat(
  supabase: SupabaseClient,
  userId: string,
  gymId: string,
): Promise<void> {
  const conversation = await getGymConversation(supabase, gymId);
  const { error } = await supabase
    .from("conversation_members")
    .delete()
    .eq("conversation_id", conversation.id)
    .eq("user_id", userId);
  throwIfError(error);
}

export async function listJoinedGymChats(
  supabase: SupabaseClient,
  userId: string,
): Promise<GymChatListItem[]> {
  const gyms = await listGyms(supabase, userId);
  return gyms
    .filter((gym) => gym.joined)
    .map((gym) => ({
      gymId: gym.id,
      name: gym.name,
      imageKey: gym.imageKey,
      conversationId: gym.conversationId,
      memberCount: gym.memberCount,
      favorite: gym.favorite,
      lastVisitedAt: gym.lastVisitedAt,
    }));
}

async function requireMembership(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<ConversationRow> {
  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("id, kind, gym_id")
    .eq("id", conversationId)
    .maybeSingle();
  throwIfError(convError);
  if (!conversation) {
    throw new AppError(404, "NOT_FOUND", "Conversation not found");
  }

  const { data: member, error: memberError } = await supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(memberError);
  if (!member) {
    throw new AppError(403, "FORBIDDEN", "Join this chat to read messages");
  }

  return conversation as ConversationRow;
}

export async function listMessages(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
  options: { before?: string; limit: number },
): Promise<ChatMessage[]> {
  const conversation = await requireMembership(supabase, userId, conversationId);
  const blocked = await blockedUserIds(supabase, userId);

  let query = supabase
    .from("messages")
    .select("id, conversation_id, sender_id, body, created_at, deleted_at")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(options.limit);

  if (blocked.length > 0) {
    query = query.not("sender_id", "in", postgrestInList(blocked));
  }
  if (options.before) {
    query = query.lt("created_at", options.before);
  }

  const { data, error } = await query;
  throwIfError(error);

  const rows = ((data ?? []) as MessageRow[]).slice().reverse();
  const names = await authorNames(
    supabase,
    rows.map((row) => row.sender_id),
  );
  await markConversationRead(supabase, userId, conversationId);
  if (conversation.kind === "dm") {
    await markConversationNotificationsRead(supabase, userId, conversationId);
  }
  return rows.map((row) => toChatMessage(row, names));
}

async function enforceSendRate(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("sender_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfError(error);
  if (!data?.created_at) return;

  const elapsed = Date.now() - new Date(data.created_at).getTime();
  if (elapsed < CHAT_LIMITS.messageMinIntervalMs) {
    throw new AppError(429, "RATE_LIMITED", "Please wait before sending again");
  }
}

export async function sendMessage(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
  body: string,
): Promise<ChatMessage> {
  await requireMembership(supabase, userId, conversationId);
  await enforceSendRate(supabase, userId, conversationId);

  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: userId,
      body,
    })
    .select("id, conversation_id, sender_id, body, created_at, deleted_at")
    .single();
  // RLS rejects DM inserts once either side has blocked the other.
  if (error?.code === "42501") {
    throw new AppError(403, "FORBIDDEN", "You can't message this Pixel");
  }
  // DB-side send rate (messages_before_insert) caught a race enforceSendRate missed.
  if (error?.code === "PT429") {
    throw new AppError(429, "RATE_LIMITED", "Please wait before sending again");
  }
  throwIfError(error);
  if (!data) {
    throw new AppError(500, "INTERNAL_ERROR", "Message was not saved");
  }

  const names = await authorNames(supabase, [userId]);
  return toChatMessage(data as MessageRow, names);
}

export async function markConversationRead(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<void> {
  const { error } = await supabase
    .from("conversation_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
  throwIfError(error);
}

export async function listGymMessages(
  supabase: SupabaseClient,
  userId: string,
  gymId: string,
  options: { before?: string; limit: number },
): Promise<{ conversationId: string; messages: ChatMessage[] }> {
  const conversation = await getGymConversation(supabase, gymId);
  const messages = await listMessages(
    supabase,
    userId,
    conversation.id,
    options,
  );
  return { conversationId: conversation.id, messages };
}

export async function sendGymMessage(
  supabase: SupabaseClient,
  userId: string,
  gymId: string,
  body: string,
): Promise<ChatMessage> {
  const conversation = await getGymConversation(supabase, gymId);
  return sendMessage(supabase, userId, conversation.id, body);
}

export async function createOrGetDm(
  supabase: SupabaseClient,
  peerUserId: string,
): Promise<{ conversationId: string }> {
  const { data, error } = await supabase.rpc("create_or_get_dm", {
    peer_user_id: peerUserId,
  });
  if (error) {
    const message = error.message ?? "";
    if (/invalid peer/i.test(message)) {
      throw new AppError(400, "BAD_REQUEST", "Cannot message yourself");
    }
    if (/peer not found/i.test(message) || error.code === "P0002") {
      throw new AppError(404, "NOT_FOUND", "Pixel not found");
    }
    if (/blocked/i.test(message) || error.code === "42501") {
      throw new AppError(403, "FORBIDDEN", "You can't message this Pixel");
    }
    throwIfError(error);
  }
  const conversationId = typeof data === "string" ? data : String(data ?? "");
  if (!conversationId) {
    throw new AppError(500, "INTERNAL_ERROR", "Could not open direct message");
  }
  return { conversationId };
}

export async function listDms(
  supabase: SupabaseClient,
  userId: string,
): Promise<DmListItem[]> {
  const { data: memberships, error: memberError } = await supabase
    .from("conversation_members")
    .select("conversation_id, last_read_at")
    .eq("user_id", userId);
  throwIfError(memberError);

  const memberIds = (memberships ?? []).map((row) =>
    String(row.conversation_id),
  );
  const lastReadByConv = new Map<string, string | null>();
  for (const row of memberships ?? []) {
    lastReadByConv.set(
      String(row.conversation_id),
      row.last_read_at ? String(row.last_read_at) : null,
    );
  }
  if (memberIds.length === 0) return [];

  const { data: conversations, error: convError } = await supabase
    .from("conversations")
    .select("id, kind")
    .in("id", memberIds)
    .eq("kind", "dm");
  throwIfError(convError);

  const conversationIds = (conversations ?? []).map((row) => String(row.id));

  if (conversationIds.length === 0) return [];

  const { data: peers, error: peersError } = await supabase
    .from("conversation_members")
    .select("conversation_id, user_id")
    .in("conversation_id", conversationIds)
    .neq("user_id", userId);
  throwIfError(peersError);

  const blocked = new Set(await blockedUserIds(supabase, userId));
  const peerByConv = new Map<string, string>();
  for (const row of peers ?? []) {
    peerByConv.set(String(row.conversation_id), String(row.user_id));
  }

  const names = await authorNames(supabase, [...peerByConv.values()]);

  const visibleConversationIds = conversationIds.filter(
    (conversationId) => !blocked.has(peerByConv.get(conversationId) ?? ""),
  );

  // One row per conversation (its newest message), not every message.
  const { data: recent, error: recentError } =
    visibleConversationIds.length > 0
      ? await supabase.rpc("dm_last_messages", {
          conversation_ids: visibleConversationIds,
        })
      : { data: [], error: null };
  throwIfError(recentError);

  const lastByConv = new Map<
    string,
    { body: string; createdAt: string; senderId: string }
  >();
  for (const row of (recent ?? []) as Pick<
    MessageRow,
    "conversation_id" | "sender_id" | "body" | "created_at"
  >[]) {
    const id = String(row.conversation_id);
    if (!lastByConv.has(id)) {
      lastByConv.set(id, {
        body: String(row.body ?? ""),
        createdAt: String(row.created_at),
        senderId: String(row.sender_id ?? ""),
      });
    }
  }

  const items: DmListItem[] = visibleConversationIds.map((conversationId) => {
    const peerUserId = peerByConv.get(conversationId) ?? "";
    const last = lastByConv.get(conversationId);
    const lastReadAt = lastReadByConv.get(conversationId) ?? null;
    return {
      conversationId,
      peerUserId,
      peerDisplayName: names.get(peerUserId) ?? "Pixel",
      lastMessageBody: last?.body ?? null,
      lastMessageAt: last?.createdAt ?? null,
      hasUnread:
        last != null &&
        last.senderId !== userId &&
        (lastReadAt == null || last.createdAt > lastReadAt),
    };
  });

  items.sort((a, b) => {
    const aTime = a.lastMessageAt ?? "";
    const bTime = b.lastMessageAt ?? "";
    return bTime.localeCompare(aTime);
  });
  return items;
}

export async function searchPixels(
  supabase: SupabaseClient,
  userId: string,
  q: string,
): Promise<PixelSearchItem[]> {
  const escaped = q.replace(/[%_\\]/g, "\\$&");
  const blocked = await blockedUserIds(supabase, userId);
  let query = supabase
    .from("pixel_cards")
    .select("user_id, display_name, equipped")
    .neq("user_id", userId)
    .ilike("display_name", `%${escaped}%`)
    .order("display_name", { ascending: true })
    .limit(20);
  if (blocked.length > 0) {
    query = query.not("user_id", "in", postgrestInList(blocked));
  }
  const [{ data, error }, { data: friendships, error: friendsError }] =
    await Promise.all([
      query,
      supabase
        .from("friendships")
        .select("user_lo, user_hi, requester_id, status")
        .or(`user_lo.eq.${userId},user_hi.eq.${userId}`),
    ]);
  throwIfError(error);
  throwIfError(friendsError);

  const friendshipByPeer = new Map<string, PixelSearchItem["friendship"]>();
  for (const row of friendships ?? []) {
    const peer = String(row.user_lo === userId ? row.user_hi : row.user_lo);
    friendshipByPeer.set(
      peer,
      row.status === "accepted"
        ? "friends"
        : row.requester_id === userId
          ? "pending_outgoing"
          : "pending_incoming",
    );
  }

  return (data ?? [])
    .map((row) => {
      const id = String(row.user_id ?? "");
      return {
        userId: id,
        displayName: String(row.display_name ?? "").trim(),
        equipped: sanitizeEquipped(row.equipped),
        friendship: friendshipByPeer.get(id) ?? "none",
      };
    })
    .filter((row) => row.userId && row.displayName);
}
