import { Router } from "express";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import {
  forgotPasswordBodySchema,
  loginBodySchema,
  signupBodySchema,
} from "../types/auth";
import { sendNotImplemented } from "../utils/not-implemented";

export const authRouter = Router();

authRouter.post("/signup", validate(signupBodySchema), (_req, res) => {
  sendNotImplemented(
    res,
    "Auth signup is not implemented yet. Supabase auth comes in a later pass.",
  );
});

authRouter.post("/login", validate(loginBodySchema), (_req, res) => {
  sendNotImplemented(
    res,
    "Auth login is not implemented yet. Supabase auth comes in a later pass.",
  );
});

authRouter.post("/logout", requireAuth, (_req, res) => {
  sendNotImplemented(
    res,
    "Auth logout is not implemented yet. Supabase auth comes in a later pass.",
  );
});

authRouter.post(
  "/forgot-password",
  validate(forgotPasswordBodySchema),
  (_req, res) => {
    sendNotImplemented(
      res,
      "Forgot password is not implemented yet. Supabase auth comes in a later pass.",
    );
  },
);
