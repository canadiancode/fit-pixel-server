import { z } from "zod";

export const SOCIAL_LIMITS = {
  notificationPageMax: 50,
  markReadIdsMax: 100,
  looksIdsMax: 50,
} as const;

export const peerUserIdParamSchema = z.object({
  userId: z.string().uuid(),
});

/** Comma-separated user ids for batch avatar looks. */
export const pixelLooksQuerySchema = z.object({
  ids: z
    .string()
    .trim()
    .min(1)
    .transform((value) => [...new Set(value.split(",").map((id) => id.trim()))])
    .pipe(z.array(z.string().uuid()).min(1).max(SOCIAL_LIMITS.looksIdsMax)),
});

export const friendRequestBodySchema = z.object({
  userId: z.string().uuid(),
});

/** Omit `ids` to mark every notification read. */
export const markNotificationsReadBodySchema = z.object({
  ids: z.array(z.string().uuid()).max(SOCIAL_LIMITS.markReadIdsMax).optional(),
});

export type MarkNotificationsReadBody = z.infer<
  typeof markNotificationsReadBodySchema
>;

/** Caller's relationship to another Pixel. */
export type FriendshipStatus =
  | "self"
  | "none"
  | "pending_outgoing"
  | "pending_incoming"
  | "friends";

export type FriendItem = {
  userId: string;
  displayName: string;
  equipped: Record<string, string>;
  since: string;
};

export type FriendRequestItem = {
  userId: string;
  displayName: string;
  equipped: Record<string, string>;
  requestedAt: string;
};

export type FriendsOverview = {
  friends: FriendItem[];
  incoming: FriendRequestItem[];
  outgoing: FriendRequestItem[];
};

export type NotificationKind = "friend_request" | "friend_accepted" | "dm_message";

export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  actorId: string | null;
  actorDisplayName: string;
  conversationId: string | null;
  body: string | null;
  createdAt: string;
  read: boolean;
};

export type PixelProfile = {
  userId: string;
  displayName: string;
  bio: string;
  homeGymName: string | null;
  equipped: Record<string, string>;
  friendship: FriendshipStatus;
  isBlocked: boolean;
};
