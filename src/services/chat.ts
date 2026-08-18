import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env";
import { AppError } from "../types/api";
import type {
  ChatMessage,
  DmListItem,
  GymChatListItem,
  GymListItem,
  PixelSearchItem,
} from "../types/chat";
import { CHAT_LIMITS } from "../types/limits";

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
  if (env.NODE_ENV !== "production") {
    console.error("Chat query failed:", error.code, error.message);
  }
  throw new AppError(503, "SERVICE_UNAVAILABLE", fallback);
}

function mapGym(
  gym: GymRow,
  conversationId: string,
  memberCount: number,
  joined: boolean,
): GymListItem {
  return {
    id: gym.id,
    name: gym.name,
    latitude: gym.latitude,
    longitude: gym.longitude,
    imageKey: gym.image_key,
    conversationId,
    memberCount,
    joined,
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

  const { data, error } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .in("conversation_id", conversationIds);
  throwIfError(error);

  for (const row of data ?? []) {
    const id = String(row.conversation_id ?? "");
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

async function joinedConversationIds(
  supabase: SupabaseClient,
  userId: string,
  conversationIds: string[],
): Promise<Set<string>> {
  const joined = new Set<string>();
  if (conversationIds.length === 0) return joined;

  const { data, error } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId)
    .in("conversation_id", conversationIds);
  throwIfError(error);

  for (const row of data ?? []) {
    joined.add(String(row.conversation_id ?? ""));
  }
  return joined;
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
  const [counts, joined] = await Promise.all([
    memberCounts(supabase, conversationIds),
    joinedConversationIds(supabase, userId, conversationIds),
  ]);

  return (gyms ?? []).map((gym) => {
    const conversationId = convByGym.get(gym.id) ?? "";
    return mapGym(
      gym as GymRow,
      conversationId,
      counts.get(conversationId) ?? 0,
      joined.has(conversationId),
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
  const [counts, joined] = await Promise.all([
    memberCounts(supabase, [conversation.id]),
    joinedConversationIds(supabase, userId, [conversation.id]),
  ]);

  return mapGym(
    gym as GymRow,
    conversation.id,
    counts.get(conversation.id) ?? 0,
    joined.has(conversation.id),
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
    { onConflict: "conversation_id,user_id" },
  );
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
  await requireMembership(supabase, userId, conversationId);

  let query = supabase
    .from("messages")
    .select("id, conversation_id, sender_id, body, created_at, deleted_at")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(options.limit);

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
    .select("conversation_id")
    .eq("user_id", userId);
  throwIfError(memberError);

  const memberIds = (memberships ?? []).map((row) =>
    String(row.conversation_id),
  );
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

  const peerByConv = new Map<string, string>();
  for (const row of peers ?? []) {
    peerByConv.set(String(row.conversation_id), String(row.user_id));
  }

  const names = await authorNames(supabase, [...peerByConv.values()]);

  const { data: recent, error: recentError } = await supabase
    .from("messages")
    .select("conversation_id, body, created_at")
    .in("conversation_id", conversationIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  throwIfError(recentError);

  const lastByConv = new Map<string, { body: string; createdAt: string }>();
  for (const row of recent ?? []) {
    const id = String(row.conversation_id);
    if (!lastByConv.has(id)) {
      lastByConv.set(id, {
        body: String(row.body ?? ""),
        createdAt: String(row.created_at),
      });
    }
  }

  const items: DmListItem[] = conversationIds.map((conversationId) => {
    const peerUserId = peerByConv.get(conversationId) ?? "";
    const last = lastByConv.get(conversationId);
    return {
      conversationId,
      peerUserId,
      peerDisplayName: names.get(peerUserId) ?? "Pixel",
      lastMessageBody: last?.body ?? null,
      lastMessageAt: last?.createdAt ?? null,
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
  const { data, error } = await supabase
    .from("chat_authors")
    .select("user_id, display_name")
    .neq("user_id", userId)
    .ilike("display_name", `%${escaped}%`)
    .limit(20);
  throwIfError(error);

  return (data ?? [])
    .map((row) => ({
      userId: String(row.user_id ?? ""),
      displayName: String(row.display_name ?? "").trim(),
    }))
    .filter((row) => row.userId && row.displayName);
}

export async function getPixel(
  supabase: SupabaseClient,
  userId: string,
): Promise<PixelSearchItem> {
  const { data, error } = await supabase
    .from("chat_authors")
    .select("user_id, display_name")
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(error);
  if (!data) {
    throw new AppError(404, "NOT_FOUND", "Pixel not found");
  }
  return {
    userId: String(data.user_id),
    displayName: String(data.display_name ?? "").trim() || "Pixel",
  };
}
