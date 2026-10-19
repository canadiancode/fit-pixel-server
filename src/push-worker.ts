/**
 * Push worker (PM2 app `fit-pixel-push`, separate from the API process).
 *
 * Drains `public.push_outbox` — filled by a trigger on `public.notifications` —
 * and sends through the Expo Push API. Connects with DATABASE_URL (the droplet's
 * admin connection) because it must read other users' push tokens; the API
 * request paths never do. Wakes on `LISTEN push_outbox` and also polls, so a
 * pooled connection without LISTEN support still delivers.
 */
import pg from "pg";
import { env } from "./config/env";
import {
  EXPO_RECEIPT_CHUNK,
  EXPO_SEND_CHUNK,
  ExpoPushError,
  buildPushMessage,
  getExpoPushReceipts,
  isDeviceNotRegistered,
  sendExpoPushChunk,
  type ExpoPushMessage,
  type PushNotificationRow,
} from "./services/expo-push";
import type { NotificationKind } from "./types/social";

const BATCH_SIZE = 100;
const POLL_MS = 5_000;
const MAX_ATTEMPTS = 5;
/** Don't deliver pushes for notifications this old (worker was down). */
const STALE_AFTER_MS = 60 * 60 * 1000;
/** Expo receipts are ready ~15 min after sending and kept for 24 h. */
const RECEIPT_DELAY_MS = 15 * 60 * 1000;
const RECEIPT_CHECK_MS = 5 * 60 * 1000;
const RECEIPT_MAX_PENDING = 10_000;
const LISTEN_RETRY_MS = 10_000;

type DueRow = {
  outbox_id: string;
  attempts: number;
  id: string;
  user_id: string;
  actor_id: string | null;
  kind: NotificationKind;
  conversation_id: string | null;
  body: string | null;
  created_at: Date;
  read_at: Date | null;
  actor_name: string;
};

const SELECT_DUE = `
  select o.id::text as outbox_id, o.attempts,
         n.id, n.user_id, n.actor_id, n.kind, n.conversation_id, n.body,
         n.created_at, n.read_at,
         coalesce(nullif(btrim(p.display_name), ''), 'Pixel') as actor_name
  from public.push_outbox o
  join public.notifications n on n.id = o.notification_id
  left join public.profiles p on p.user_id = n.actor_id
  where o.next_attempt_at <= now()
  order by o.id
  limit $1
  for update of o skip locked
`;

function log(message: string, extra?: Record<string, unknown>): void {
  console.log(`[push] ${message}`, extra ? JSON.stringify(extra) : "");
}

function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });
}

/** Ticket id → token, for the DeviceNotRegistered receipt sweep. */
const pendingReceipts = new Map<string, { token: string; sentAt: number }>();

async function deleteTokens(pool: pg.Pool | pg.PoolClient, tokens: string[]) {
  if (tokens.length === 0) return;
  await pool.query(`delete from public.push_tokens where token = any($1::text[])`, [
    tokens,
  ]);
  log("removed unregistered tokens", { count: tokens.length });
}

/** Sends one batch of due outbox rows. Returns how many rows it claimed. */
async function drainBatch(pool: pg.Pool): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<DueRow>(SELECT_DUE, [BATCH_SIZE]);
    if (rows.length === 0) {
      await client.query("commit");
      return 0;
    }

    // A DM burst can queue several rows for one notification: send it once.
    const byNotification = new Map<string, { row: DueRow; outboxIds: string[] }>();
    for (const row of rows) {
      const entry = byNotification.get(row.id);
      if (entry) entry.outboxIds.push(row.outbox_id);
      else byNotification.set(row.id, { row, outboxIds: [row.outbox_id] });
    }

    const now = Date.now();
    const live = [...byNotification.values()].filter(
      ({ row }) =>
        row.read_at == null && now - row.created_at.getTime() < STALE_AFTER_MS,
    );
    const recipients = [...new Set(live.map(({ row }) => row.user_id))];

    const tokensByUser = new Map<string, string[]>();
    const unreadByUser = new Map<string, number>();
    if (recipients.length > 0) {
      const tokens = await client.query<{ user_id: string; token: string }>(
        `select user_id, token from public.push_tokens where user_id = any($1::uuid[])`,
        [recipients],
      );
      for (const t of tokens.rows) {
        const list = tokensByUser.get(t.user_id) ?? [];
        list.push(t.token);
        tokensByUser.set(t.user_id, list);
      }
      const unread = await client.query<{ user_id: string; unread: number }>(
        `select user_id, count(*)::int as unread from public.notifications
         where user_id = any($1::uuid[]) and read_at is null
         group by user_id`,
        [recipients],
      );
      for (const u of unread.rows) unreadByUser.set(u.user_id, u.unread);
    }

    const messages: { message: ExpoPushMessage; notificationId: string }[] = [];
    for (const { row } of live) {
      const pushRow: PushNotificationRow = {
        id: row.id,
        kind: row.kind,
        actorId: row.actor_id,
        actorName: row.actor_name,
        conversationId: row.conversation_id,
        body: row.body,
      };
      for (const token of tokensByUser.get(row.user_id) ?? []) {
        messages.push({
          message: buildPushMessage(pushRow, token, unreadByUser.get(row.user_id)),
          notificationId: row.id,
        });
      }
    }

    const failed = new Set<string>();
    const deadTokens: string[] = [];
    let sent = 0;
    for (let i = 0; i < messages.length; i += EXPO_SEND_CHUNK) {
      const chunk = messages.slice(i, i + EXPO_SEND_CHUNK);
      try {
        const tickets = await sendExpoPushChunk(
          chunk.map((m) => m.message),
          env.EXPO_ACCESS_TOKEN,
        );
        tickets.forEach((ticket, index) => {
          const token = chunk[index]?.message.to;
          if (!token) return;
          if (ticket.status === "ok") {
            sent += 1;
            if (pendingReceipts.size < RECEIPT_MAX_PENDING) {
              pendingReceipts.set(ticket.id, { token, sentAt: Date.now() });
            }
          } else if (isDeviceNotRegistered(ticket)) {
            deadTokens.push(token);
          } else {
            log("ticket error", { error: ticket.details?.error ?? ticket.message });
          }
        });
      } catch (err) {
        const retryable = err instanceof ExpoPushError ? err.retryable : true;
        log("send failed", { error: String(err), retryable });
        if (retryable) {
          for (const m of chunk) failed.add(m.notificationId);
        }
      }
    }

    const done: string[] = [];
    const retry: string[] = [];
    for (const { row, outboxIds } of byNotification.values()) {
      if (failed.has(row.id) && row.attempts + 1 < MAX_ATTEMPTS) {
        retry.push(...outboxIds);
      } else {
        done.push(...outboxIds);
      }
    }
    if (done.length > 0) {
      await client.query(`delete from public.push_outbox where id = any($1::bigint[])`, [
        done,
      ]);
    }
    if (retry.length > 0) {
      await client.query(
        `update public.push_outbox
         set attempts = attempts + 1,
             next_attempt_at = now() + make_interval(secs => 15 * power(2, attempts))
         where id = any($1::bigint[])`,
        [retry],
      );
    }
    await deleteTokens(client, deadTokens);
    await client.query("commit");

    log("batch", {
      claimed: rows.length,
      notifications: byNotification.size,
      sent,
      retrying: retry.length,
    });
    return rows.length;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Drop tokens Apple / Google reported as gone after delivery. */
async function checkReceipts(pool: pg.Pool): Promise<void> {
  const cutoff = Date.now() - RECEIPT_DELAY_MS;
  const ready = [...pendingReceipts.entries()].filter(
    ([, v]) => v.sentAt <= cutoff,
  );
  for (let i = 0; i < ready.length; i += EXPO_RECEIPT_CHUNK) {
    const chunk = ready.slice(i, i + EXPO_RECEIPT_CHUNK);
    const receipts = await getExpoPushReceipts(
      chunk.map(([id]) => id),
      env.EXPO_ACCESS_TOKEN,
    );
    const dead: string[] = [];
    for (const [id, { token }] of chunk) {
      const receipt = receipts[id];
      if (receipt && isDeviceNotRegistered(receipt)) dead.push(token);
      pendingReceipts.delete(id);
    }
    await deleteTokens(pool, dead);
  }
}

function startListener(connectionString: string, onWake: () => void): () => void {
  let client: pg.Client | null = null;
  let stopped = false;
  let retryTimer: NodeJS.Timeout | null = null;

  const connect = async () => {
    if (stopped) return;
    const next = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    const retry = () => {
      if (client !== next) return;
      client = null;
      next.end().catch(() => undefined);
      if (!stopped) retryTimer = setTimeout(() => void connect(), LISTEN_RETRY_MS);
    };
    client = next;
    next.on("error", (err) => {
      log("listen connection error", { error: err.message });
      retry();
    });
    next.on("end", retry);
    next.on("notification", onWake);
    try {
      await next.connect();
      await next.query("listen push_outbox");
      log("listening");
      onWake();
    } catch (err) {
      log("listen failed; polling only until retry", { error: String(err) });
      retry();
    }
  };

  void connect();
  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    void client?.end().catch(() => undefined);
  };
}

function main(): void {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    console.error("[push] DATABASE_URL is missing; the push worker cannot start.");
    process.exit(1);
  }
  const pool = createPool(connectionString);
  pool.on("error", (err) => log("pool error", { error: err.message }));

  let draining = false;
  let again = false;
  const drain = async () => {
    if (draining) {
      again = true;
      return;
    }
    draining = true;
    try {
      do {
        again = false;
        while ((await drainBatch(pool)) === BATCH_SIZE) {
          // Keep going while full batches come back.
        }
      } while (again);
    } catch (err) {
      log("drain failed", { error: String(err) });
    } finally {
      draining = false;
    }
  };

  const stopListener = startListener(connectionString, () => void drain());
  const poll = setInterval(() => void drain(), POLL_MS);
  const receipts = setInterval(() => {
    checkReceipts(pool).catch((err) =>
      log("receipt check failed", { error: String(err) }),
    );
  }, RECEIPT_CHECK_MS);
  void drain();
  log("started", { pollMs: POLL_MS });

  const shutdown = () => {
    clearInterval(poll);
    clearInterval(receipts);
    stopListener();
    void pool.end().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
