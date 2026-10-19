import { Router } from "express";
import { createUserSupabaseClient } from "../config/supabase";
import { requireAuth } from "../middleware/require-auth";
import { safetyWriteRateLimit } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import { createReport } from "../services/safety";
import { AppError } from "../types/api";
import { createReportBodySchema } from "../types/safety";

export const reportsRouter = Router();

reportsRouter.post(
  "/",
  requireAuth,
  safetyWriteRateLimit,
  validate(createReportBodySchema),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      await createReport(
        createUserSupabaseClient(auth.token),
        auth.userId,
        req.body,
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
