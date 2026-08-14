import { Router } from "express";
import { requireAuth } from "../middleware/require-auth";

export const meRouter = Router();

meRouter.get("/", requireAuth, (req, res) => {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({
      ok: false,
      code: "UNAUTHORIZED",
      message: "Missing auth context",
    });
    return;
  }

  res.json({
    ok: true,
    id: auth.userId,
    email: auth.email ?? "",
  });
});
