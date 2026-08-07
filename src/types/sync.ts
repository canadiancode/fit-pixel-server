import { z } from "zod";

/**
 * Mobile outbox contract (wire format for POST /v1/sync).
 * Local SQLite uses `payload_json: string`; the API accepts parsed `payload`.
 *
 * Future DB pass notes:
 * - FACTS are authoritative for persistence (after sanitization).
 * - UNTRUSTED ops must not drive scoring; recompute XP from habit_log + daily_goals.
 * - Do not trust client `dayKey` alone — re-derive from timestamps + day boundary/timezone.
 * - Never store raw HealthKit sample blobs.
 */

/** Payload schema version stamped on each enqueued op (bump when shape changes). */
export const PENDING_OP_SCHEMA_VERSION = 1;

export const PENDING_SERVER_OP_TYPES = [
  "habit_log",
  "daily_goals",
  "xp_award",
  "inventory_unlock",
  "loadout",
  "profile",
  "prefs",
  "saved_meal",
] as const;

export type PendingServerOpType = (typeof PENDING_SERVER_OP_TYPES)[number];

export const PENDING_SERVER_OP_TRUST = ["fact", "untrusted_client"] as const;
export type PendingServerOpTrust = (typeof PENDING_SERVER_OP_TRUST)[number];

export const FACT_PENDING_OP_TYPES = [
  "habit_log",
  "daily_goals",
  "loadout",
  "profile",
  "prefs",
  "saved_meal",
] as const satisfies readonly PendingServerOpType[];

export const UNTRUSTED_PENDING_OP_TYPES = [
  "xp_award",
  "inventory_unlock",
] as const satisfies readonly PendingServerOpType[];

const UNTRUSTED_SET = new Set<string>(UNTRUSTED_PENDING_OP_TYPES);

export function trustForOpType(type: PendingServerOpType): PendingServerOpTrust {
  return UNTRUSTED_SET.has(type) ? "untrusted_client" : "fact";
}

export function isFactOpType(type: PendingServerOpType): boolean {
  return !UNTRUSTED_SET.has(type);
}

/** Wire shape the client will POST (not the local SQLite row). */
export type PendingServerOp = {
  id: string;
  type: PendingServerOpType;
  payload: Record<string, unknown>;
  clientClockAt: string | null;
  schemaVersion: number;
  trust: PendingServerOpTrust;
};

export type SyncAckStatus = "synced" | "rejected";

export type SyncAck = {
  id: string;
  status: SyncAckStatus;
  reason?: string;
};

/**
 * Planned response for POST /v1/sync once Supabase ingest exists.
 * Stub handlers return NOT_IMPLEMENTED instead.
 */
export type SyncResponse = {
  acks: SyncAck[];
  serverTime: string;
};

export type SyncRequestBody = {
  ops: PendingServerOp[];
};

export const pendingServerOpSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(PENDING_SERVER_OP_TYPES),
  payload: z.record(z.string(), z.unknown()),
  clientClockAt: z.string().datetime({ offset: true }).nullable(),
  schemaVersion: z.number().int().positive(),
  trust: z.enum(PENDING_SERVER_OP_TRUST),
});

export const syncRequestBodySchema = z.object({
  ops: z.array(pendingServerOpSchema).max(500),
});
