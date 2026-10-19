import { Router } from "express";
import { createUserSupabaseClient } from "../config/supabase";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import { listNotifications, markNotificationsRead } from "../services/social";
import { AppError } from "../types/api";
import { markNotificationsReadBodySchema } from "../types/social";

export const notificationsRouter = Router();

notificationsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const auth = req.auth;
    if (!auth) {
      throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
    }
    const result = await listNotifications(
      createUserSupabaseClient(auth.token),
      auth.userId,
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post(
  "/read",
  requireAuth,
  validate(markNotificationsReadBodySchema),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      await markNotificationsRead(
        createUserSupabaseClient(auth.token),
        auth.userId,
        req.body.ids,
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
