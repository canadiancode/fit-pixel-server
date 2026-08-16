import { Router } from "express";
import { isSupabaseUserClientConfigured } from "../config/env";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({ ok: true, status: "up" });
});

healthRouter.get("/ready", (_req, res) => {
  res.json({
    ok: true,
    status: "ready",
    supabaseConfigured: isSupabaseUserClientConfigured(),
  });
});
