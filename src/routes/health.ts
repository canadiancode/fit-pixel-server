import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({ ok: true, status: "up" });
});

/**
 * Process readiness only for now (no DB).
 * Later: fail if Supabase/Postgres is unreachable.
 */
healthRouter.get("/ready", (_req, res) => {
  res.json({ ok: true, status: "ready" });
});
