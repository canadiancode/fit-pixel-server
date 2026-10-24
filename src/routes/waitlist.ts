import cors from "cors";
import express, { Router } from "express";
import { createAnonSupabaseClient } from "../config/supabase";
import { waitlistRateLimit } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import { AppError } from "../types/api";
import { joinWaitlistBodySchema, WAITLIST_ORIGINS } from "../types/waitlist";

/**
 * POST /v1/waitlist from the fitpixel.app site. Public (no sign-in), so it is
 * mounted before the app-wide CORS middleware and carries its own: the
 * website's origins only, no credentials.
 */
export const waitlistRouter = Router();

waitlistRouter.use(cors({ origin: WAITLIST_ORIGINS, methods: ["POST"], maxAge: 86_400 }));
waitlistRouter.use(express.json({ limit: "4kb" }));

waitlistRouter.post("/", waitlistRateLimit, validate(joinWaitlistBodySchema), async (req, res, next) => {
  try {
    const { email, platform, source } = req.body;
    const { error } = await createAnonSupabaseClient().rpc("join_waitlist", {
      p_email: email,
      p_platform: platform,
      p_source: source ?? null,
    });
    if (error) {
      if (error.code === "22023") {
        throw new AppError(400, "VALIDATION_ERROR", "Check the email address");
      }
      console.error("Waitlist insert failed:", error.code, error.message);
      throw new AppError(503, "SERVICE_UNAVAILABLE", "Could not join the waitlist");
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
