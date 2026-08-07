import { Router } from "express";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import { syncRequestBodySchema, type SyncResponse } from "../types/sync";
import { sendNotImplemented } from "../utils/not-implemented";

export const syncRouter = Router();

/**
 * POST /v1/sync
 *
 * Planned (future Supabase pass):
 * - Auth required
 * - Body: { ops: PendingServerOp[] }
 * - Persist idempotently by op.id
 * - Apply FACT ops; ignore/reject UNTRUSTED for scoring
 * - Response: SyncResponse { acks, serverTime }
 *
 * This pass: validate + 501.
 */
syncRouter.post(
  "/",
  requireAuth,
  validate(syncRequestBodySchema),
  (_req, res) => {
    // Document expected shape for clients / future implementers
    const _planned: SyncResponse = {
      acks: [],
      serverTime: new Date().toISOString(),
    };
    void _planned;

    sendNotImplemented(
      res,
      "Sync ingest is not implemented yet. Supabase persistence comes in a later pass. Planned response: { acks: [{ id, status: \"synced\"|\"rejected\", reason? }], serverTime }",
    );
  },
);
