import { Router } from "express";
import { createUserSupabaseClient } from "../config/supabase";
import { requireAuth } from "../middleware/require-auth";
import { AppError } from "../types/api";

export const meRouter = Router();

meRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const auth = req.auth;
    if (!auth) {
      throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
    }

    const supabase = createUserSupabaseClient(auth.token);
    const { error } = await supabase
      .from("prefs")
      .select("user_id")
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (error) {
      throw new AppError(
        503,
        "SERVICE_UNAVAILABLE",
        "Supabase is not reachable",
      );
    }

    res.json({
      ok: true,
      id: auth.userId,
      email: auth.email ?? "",
    });
  } catch (err) {
    next(err);
  }
});
