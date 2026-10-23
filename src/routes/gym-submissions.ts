import { Router } from "express";
import { createUserSupabaseClient } from "../config/supabase";
import { gymSubmissionRateLimit } from "../middleware/rate-limit";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import {
  createGymSubmission,
  listMyGymSubmissions,
} from "../services/gym-submissions";
import { AppError } from "../types/api";
import { createGymSubmissionBodySchema } from "../types/gym-submissions";

export const gymSubmissionsRouter = Router();

/** Suggest a gym for the map. It goes live once approved in the dashboard. */
gymSubmissionsRouter.post(
  "/",
  requireAuth,
  gymSubmissionRateLimit,
  validate(createGymSubmissionBodySchema),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      const submission = await createGymSubmission(
        createUserSupabaseClient(auth.token),
        auth.userId,
        req.body,
      );
      res.status(201).json({ ok: true, submission });
    } catch (err) {
      next(err);
    }
  },
);

gymSubmissionsRouter.get("/mine", requireAuth, async (req, res, next) => {
  try {
    const auth = req.auth;
    if (!auth) {
      throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
    }
    const submissions = await listMyGymSubmissions(
      createUserSupabaseClient(auth.token),
      auth.userId,
    );
    res.json({ ok: true, submissions });
  } catch (err) {
    next(err);
  }
});
