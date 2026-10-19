import { Router } from "express";
import { createUserSupabaseClient } from "../config/supabase";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import { searchPixels } from "../services/chat";
import { getPixelProfile, listPixelLooks } from "../services/social";
import { AppError } from "../types/api";
import { pixelSearchQuerySchema } from "../types/chat";
import { peerUserIdParamSchema, pixelLooksQuerySchema } from "../types/social";
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

/** Batch looks (`?ids=a,b`) for chat avatars. Registered before `/:userId`. */
pixelsRouter.get("/looks", requireAuth, async (req, res, next) => {
  try {
    const auth = req.auth;
    if (!auth) {
      throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
    }
    const parsed = pixelLooksQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", {
        issues: parsed.error.issues,
      });
    }
    const looks = await listPixelLooks(
      createUserSupabaseClient(auth.token),
      parsed.data.ids,
    );
    res.json({ ok: true, looks });
  } catch (err) {
    next(err);
  }
});

/** Public Pixel card + the caller's friendship / block state with them. */
pixelsRouter.get(
  "/:userId",
  requireAuth,
  validate(peerUserIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      const pixel = await getPixelProfile(
        createUserSupabaseClient(auth.token),
        auth.userId,
        routeParam(req.params.userId),
      );
      res.json({ ok: true, pixel });
    } catch (err) {
      next(err);
    }
  },
);
