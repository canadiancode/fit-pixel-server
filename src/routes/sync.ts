import { Router } from "express";
import { createUserSupabaseClient } from "../config/supabase";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import { ingestSyncOps } from "../services/sync-ingest";
import { AppError } from "../types/api";
import { syncRequestBodySchema, type SyncResponse } from "../types/sync";

export const syncRouter = Router();

syncRouter.post(
  "/",
  requireAuth,
  validate(syncRequestBodySchema),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }

      const acks = await ingestSyncOps(
        createUserSupabaseClient(auth.token),
        auth.userId,
        req.body.ops,
      );

      const body: SyncResponse = {
        acks,
        serverTime: new Date().toISOString(),
      };
      res.json({ ok: true, ...body });
    } catch (err) {
      next(err);
    }
  },
);
