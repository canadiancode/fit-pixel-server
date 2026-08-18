import { Router } from "express";
import { createUserSupabaseClient } from "../config/supabase";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import {
  createOrGetDm,
  listDms,
  listMessages,
  sendMessage,
} from "../services/chat";
import { AppError } from "../types/api";
import {
  conversationIdParamSchema,
  createDmBodySchema,
  messagesQuerySchema,
  sendMessageBodySchema,
} from "../types/chat";
import { routeParam } from "../utils/route-param";

export const dmsRouter = Router();

dmsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const auth = req.auth;
    if (!auth) {
      throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
    }
    const dms = await listDms(createUserSupabaseClient(auth.token), auth.userId);
    res.json({ ok: true, dms });
  } catch (err) {
    next(err);
  }
});

dmsRouter.post(
  "/",
  requireAuth,
  validate(createDmBodySchema),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      if (req.body.peerUserId === auth.userId) {
        throw new AppError(400, "BAD_REQUEST", "Cannot message yourself");
      }
      const result = await createOrGetDm(
        createUserSupabaseClient(auth.token),
        req.body.peerUserId,
      );
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  },
);

dmsRouter.get(
  "/:conversationId/messages",
  requireAuth,
  validate(conversationIdParamSchema, "params"),
  validate(messagesQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      const messages = await listMessages(
        createUserSupabaseClient(auth.token),
        auth.userId,
        routeParam(req.params.conversationId),
        {
          before: typeof req.query.before === "string" ? req.query.before : undefined,
          limit: Number(req.query.limit ?? 50),
        },
      );
      res.json({
        ok: true,
        conversationId: routeParam(req.params.conversationId),
        messages,
      });
    } catch (err) {
      next(err);
    }
  },
);

dmsRouter.post(
  "/:conversationId/messages",
  requireAuth,
  validate(conversationIdParamSchema, "params"),
  validate(sendMessageBodySchema),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      const message = await sendMessage(
        createUserSupabaseClient(auth.token),
        auth.userId,
        routeParam(req.params.conversationId),
        req.body.body,
      );
      res.json({ ok: true, message });
    } catch (err) {
      next(err);
    }
  },
);
