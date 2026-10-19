import { Router } from "express";
import { createUserSupabaseClient } from "../config/supabase";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import { registerPushToken, unregisterPushToken } from "../services/push-tokens";
import { AppError } from "../types/api";
import {
  registerPushTokenBodySchema,
  unregisterPushTokenBodySchema,
} from "../types/push";

export const pushTokensRouter = Router();

pushTokensRouter.post(
  "/",
  requireAuth,
  validate(registerPushTokenBodySchema),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      await registerPushToken(createUserSupabaseClient(auth.token), req.body);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

pushTokensRouter.delete(
  "/",
  requireAuth,
  validate(unregisterPushTokenBodySchema),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      await unregisterPushToken(
        createUserSupabaseClient(auth.token),
        auth.userId,
        req.body.token,
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
