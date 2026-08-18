import { Router } from "express";
import { createUserSupabaseClient } from "../config/supabase";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import { getPixel, searchPixels } from "../services/chat";
import { AppError } from "../types/api";
import { pixelSearchQuerySchema } from "../types/chat";
import { routeParam } from "../utils/route-param";

export const pixelsRouter = Router();

pixelsRouter.get(
  "/search",
  requireAuth,
  validate(pixelSearchQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      const q = String(req.query.q ?? "").trim();
      const pixels = await searchPixels(
        createUserSupabaseClient(auth.token),
        auth.userId,
        q,
      );
      res.json({ ok: true, pixels });
    } catch (err) {
      next(err);
    }
  },
);

pixelsRouter.get("/:userId", requireAuth, async (req, res, next) => {
  try {
    const auth = req.auth;
    if (!auth) {
      throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
    }
    const userId = routeParam(req.params.userId);
    if (!userId) {
      throw new AppError(400, "VALIDATION_ERROR", "User id is required");
    }
    const pixel = await getPixel(createUserSupabaseClient(auth.token), userId);
    res.json({ ok: true, pixel });
  } catch (err) {
    next(err);
  }
});
