import { Router } from "express";
import { requireAuth } from "../middleware/require-auth";
import { sendNotImplemented } from "../utils/not-implemented";

export const meRouter = Router();

meRouter.get("/", requireAuth, (_req, res) => {
  sendNotImplemented(
    res,
    "GET /v1/me is not implemented yet. Supabase-backed profile comes in a later pass.",
  );
});
