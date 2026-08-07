import { Router } from "express";
import { requireAuth } from "../middleware/require-auth";
import { sendNotImplemented } from "../utils/not-implemented";

export const habitsRouter = Router();

habitsRouter.get("/", requireAuth, (_req, res) => {
  sendNotImplemented(
    res,
    "GET /v1/habits is not implemented yet. Habit reads will come with Supabase persistence.",
  );
});
