import { Router } from "express";
import { createUserSupabaseClient } from "../config/supabase";
import { requireAuth } from "../middleware/require-auth";
import { safetyWriteRateLimit } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import {
  listFriends,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest,
} from "../services/social";
import { AppError } from "../types/api";
import {
  friendRequestBodySchema,
  peerUserIdParamSchema,
} from "../types/social";
import { routeParam } from "../utils/route-param";

export const friendsRouter = Router();

/** Accepted friends plus pending requests in both directions. */
friendsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const auth = req.auth;
    if (!auth) {
      throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
    }
    const overview = await listFriends(
      createUserSupabaseClient(auth.token),
      auth.userId,
    );
    res.json({ ok: true, ...overview });
  } catch (err) {
    next(err);
  }
});

friendsRouter.post(
  "/requests",
  requireAuth,
  safetyWriteRateLimit,
  validate(friendRequestBodySchema),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      if (req.body.userId === auth.userId) {
        throw new AppError(400, "BAD_REQUEST", "You can't friend yourself");
      }
      const friendship = await sendFriendRequest(
        createUserSupabaseClient(auth.token),
        req.body.userId,
      );
      res.json({ ok: true, friendship });
    } catch (err) {
      next(err);
    }
  },
);

for (const action of ["accept", "decline"] as const) {
  friendsRouter.post(
    `/requests/:userId/${action}`,
    requireAuth,
    validate(peerUserIdParamSchema, "params"),
    async (req, res, next) => {
      try {
        const auth = req.auth;
        if (!auth) {
          throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
        }
        const friendship = await respondFriendRequest(
          createUserSupabaseClient(auth.token),
          routeParam(req.params.userId),
          action === "accept",
        );
        res.json({ ok: true, friendship });
      } catch (err) {
        next(err);
      }
    },
  );
}

/** Unfriend, or cancel an outgoing request. */
friendsRouter.delete(
  "/:userId",
  requireAuth,
  validate(peerUserIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      await removeFriend(
        createUserSupabaseClient(auth.token),
        routeParam(req.params.userId),
      );
      res.json({ ok: true, friendship: "none" });
    } catch (err) {
      next(err);
    }
  },
);
