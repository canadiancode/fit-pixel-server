import type { NotificationKind } from "../types/social";

const EXPO_PUSH_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

/** Expo caps a send request at 100 messages and a receipt lookup at 1000 ids. */
export const EXPO_SEND_CHUNK = 100;
export const EXPO_RECEIPT_CHUNK = 1000;

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data: PushData;
  sound: "default";
  badge?: number;
  priority: "high";
  channelId: string;
};

/** What the app reads when the push is tapped. */
export type PushData = {
  notificationId: string;
  kind: NotificationKind;
  actorId: string | null;
  conversationId: string | null;
};

export type ExpoPushTicket =
  | { status: "ok"; id: string }
  | {
      status: "error";
      message?: string;
      details?: { error?: string };
    };

export type ExpoPushReceipt =
  | { status: "ok" }
  | { status: "error"; message?: string; details?: { error?: string } };

/** Android channel the app creates on launch. */
export const ANDROID_CHANNEL_ID = "social";

export type PushNotificationRow = {
  id: string;
  kind: NotificationKind;
  actorId: string | null;
  actorName: string;
  conversationId: string | null;
  body: string | null;
};

/** Title / body copy for one notifications row. */
export function pushCopy(row: PushNotificationRow): {
  title: string;
  body: string;
} {
  switch (row.kind) {
    case "friend_request":
      return {
        title: "Friend request",
        body: `${row.actorName} wants to be friends.`,
      };
    case "friend_accepted":
      return {
        title: "New friend",
        body: `${row.actorName} accepted your friend request.`,
      };
    case "dm_message":
      return {
        title: row.actorName,
        body: row.body?.trim() || "Sent you a message.",
      };
  }
}

export function buildPushMessage(
  row: PushNotificationRow,
  token: string,
  badge: number | undefined,
): ExpoPushMessage {
  const { title, body } = pushCopy(row);
  return {
    to: token,
    title,
    body,
    data: {
      notificationId: row.id,
      kind: row.kind,
      actorId: row.actorId,
      conversationId: row.conversationId,
    },
    sound: "default",
    ...(badge != null ? { badge } : {}),
    priority: "high",
    channelId: ANDROID_CHANNEL_ID,
  };
}

function headers(accessToken: string | undefined): Record<string, string> {
  return {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

export class ExpoPushError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ExpoPushError";
  }
}

/** One send request (≤ 100 messages). Tickets come back in message order. */
export async function sendExpoPushChunk(
  messages: ExpoPushMessage[],
  accessToken: string | undefined,
): Promise<ExpoPushTicket[]> {
  let response: Response;
  try {
    response = await fetch(EXPO_PUSH_SEND_URL, {
      method: "POST",
      headers: headers(accessToken),
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new ExpoPushError(`Expo push request failed: ${String(err)}`, true);
  }
  const json = (await response.json().catch(() => null)) as {
    data?: ExpoPushTicket[];
    errors?: { code?: string; message?: string }[];
  } | null;
  if (!response.ok || !Array.isArray(json?.data)) {
    const code = json?.errors?.[0]?.code ?? "";
    throw new ExpoPushError(
      `Expo push HTTP ${response.status} ${code}`.trim(),
      response.status === 429 || response.status >= 500,
    );
  }
  return json.data;
}

export async function getExpoPushReceipts(
  ids: string[],
  accessToken: string | undefined,
): Promise<Record<string, ExpoPushReceipt>> {
  const response = await fetch(EXPO_PUSH_RECEIPTS_URL, {
    method: "POST",
    headers: headers(accessToken),
    body: JSON.stringify({ ids }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await response.json().catch(() => null)) as {
    data?: Record<string, ExpoPushReceipt>;
  } | null;
  if (!response.ok || json?.data == null) {
    throw new ExpoPushError(`Expo receipts HTTP ${response.status}`, true);
  }
  return json.data;
}

export function isDeviceNotRegistered(
  result: ExpoPushTicket | ExpoPushReceipt,
): boolean {
  return (
    result.status === "error" && result.details?.error === "DeviceNotRegistered"
  );
}
