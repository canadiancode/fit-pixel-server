import { Router } from "express";
import { createUserSupabaseClient } from "../config/supabase";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import { listWorkoutSessionsPage } from "../services/restore";
import { AppError } from "../types/api";
import { TRAINING_LIMITS } from "../types/limits";
import { workoutsPageQuerySchema } from "../types/restore";

export const workoutsRouter = Router();

/** Page through the caller's finished workouts (restore to a new or reset device). */
workoutsRouter.get(
  "/",
  requireAuth,
  validate(workoutsPageQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      const page = await listWorkoutSessionsPage(
        createUserSupabaseClient(auth.token),
        auth.userId,
        {
          after: typeof req.query.after === "string" ? req.query.after : undefined,
          limit: Number(req.query.limit ?? TRAINING_LIMITS.sessionPageDefault),
        },
      );
      res.json({ ok: true, ...page });
    } catch (err) {
      next(err);
    }
  },
);
