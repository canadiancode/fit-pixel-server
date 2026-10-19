import { Router } from "express";
import { createUserSupabaseClient } from "../config/supabase";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import { listHabitLogsPage } from "../services/restore";
import { AppError } from "../types/api";
import { habitsPageQuerySchema, RESTORE_LIMITS } from "../types/restore";

export const habitsRouter = Router();

/** Page through the caller's habit logs (restore to a new or reset device). */
habitsRouter.get(
  "/",
  requireAuth,
  validate(habitsPageQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      const page = await listHabitLogsPage(
        createUserSupabaseClient(auth.token),
        auth.userId,
        {
          after: typeof req.query.after === "string" ? req.query.after : undefined,
          limit: Number(req.query.limit ?? RESTORE_LIMITS.habitPageDefault),
        },
      );
      res.json({ ok: true, ...page });
    } catch (err) {
      next(err);
    }
  },
);
