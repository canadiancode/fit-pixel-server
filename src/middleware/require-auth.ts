import type { NextFunction, Request, Response } from "express";
import { AppError } from "../types/api";

export type AuthContext = {
  /** Raw Bearer token — not verified against a DB yet */
  token: string;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Stub auth: requires `Authorization: Bearer <token>`.
 * Does not verify JWT/session against Supabase or any store.
 * Later pass: validate token and attach user id.
 */
export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.header("authorization");
  if (!header) {
    next(new AppError(401, "UNAUTHORIZED", "Missing Authorization header"));
    return;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match?.[1]) {
    next(
      new AppError(
        401,
        "UNAUTHORIZED",
        "Authorization header must be Bearer <token>",
      ),
    );
    return;
  }

  const token = match[1].trim();
  if (!token) {
    next(new AppError(401, "UNAUTHORIZED", "Bearer token is empty"));
    return;
  }

  req.auth = { token };
  next();
}
