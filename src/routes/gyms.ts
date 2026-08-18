import { Router } from "express";
import { createUserSupabaseClient } from "../config/supabase";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import {
  getGym,
  joinGymChat,
  leaveGymChat,
  listGymMessages,
  listGyms,
  sendGymMessage,
} from "../services/chat";
import { AppError } from "../types/api";
import {
  gymIdParamSchema,
  messagesQuerySchema,
  sendMessageBodySchema,
} from "../types/chat";
import { routeParam } from "../utils/route-param";

export const gymsRouter = Router();

gymsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const auth = req.auth;
    if (!auth) {
      throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
    }
    const gyms = await listGyms(createUserSupabaseClient(auth.token), auth.userId);
    res.json({ ok: true, gyms });
  } catch (err) {
    next(err);
  }
});

gymsRouter.post(
  "/:gymId/join",
  requireAuth,
  validate(gymIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      const gym = await joinGymChat(
        createUserSupabaseClient(auth.token),
        auth.userId,
        routeParam(req.params.gymId),
      );
      res.json({ ok: true, gym });
    } catch (err) {
      next(err);
    }
  },
);

gymsRouter.delete(
  "/:gymId/leave",
  requireAuth,
  validate(gymIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      await leaveGymChat(
        createUserSupabaseClient(auth.token),
        auth.userId,
        routeParam(req.params.gymId),
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

gymsRouter.get(
  "/:gymId/messages",
  requireAuth,
  validate(gymIdParamSchema, "params"),
  validate(messagesQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      const result = await listGymMessages(
        createUserSupabaseClient(auth.token),
        auth.userId,
        routeParam(req.params.gymId),
        {
          before: typeof req.query.before === "string" ? req.query.before : undefined,
          limit: Number(req.query.limit ?? 50),
        },
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  },
);

gymsRouter.post(
  "/:gymId/messages",
  requireAuth,
  validate(gymIdParamSchema, "params"),
  validate(sendMessageBodySchema),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      const message = await sendGymMessage(
        createUserSupabaseClient(auth.token),
        auth.userId,
        routeParam(req.params.gymId),
        req.body.body,
      );
      res.json({ ok: true, message });
    } catch (err) {
      next(err);
    }
  },
);

gymsRouter.get(
  "/:gymId",
  requireAuth,
  validate(gymIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      const gym = await getGym(
        createUserSupabaseClient(auth.token),
        auth.userId,
        routeParam(req.params.gymId),
      );
      res.json({ ok: true, gym });
    } catch (err) {
      next(err);
    }
  },
);
