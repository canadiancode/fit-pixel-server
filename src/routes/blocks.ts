import { Router } from "express";
import { createUserSupabaseClient } from "../config/supabase";
import { requireAuth } from "../middleware/require-auth";
import { safetyWriteRateLimit } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import { blockUser, listBlockedUsers, unblockUser } from "../services/safety";
import { AppError } from "../types/api";
import { blockBodySchema, blockedUserIdParamSchema } from "../types/safety";
import { routeParam } from "../utils/route-param";

export const blocksRouter = Router();

blocksRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const auth = req.auth;
    if (!auth) {
      throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
    }
    const blocked = await listBlockedUsers(
      createUserSupabaseClient(auth.token),
      auth.userId,
    );
    res.json({ ok: true, blocked });
  } catch (err) {
    next(err);
  }
});

blocksRouter.post(
  "/",
  requireAuth,
  safetyWriteRateLimit,
  validate(blockBodySchema),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      await blockUser(
        createUserSupabaseClient(auth.token),
        auth.userId,
        req.body.userId,
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

blocksRouter.delete(
  "/:userId",
  requireAuth,
  validate(blockedUserIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      await unblockUser(
        createUserSupabaseClient(auth.token),
        auth.userId,
        routeParam(req.params.userId),
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
