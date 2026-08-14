import type { NextFunction, Request, Response } from "express";
import { getSupabaseUrl, isJwtConfigured } from "../config/env";
import { AppError } from "../types/api";

export type AuthContext = {
  userId: string;
  email?: string;
  token: string;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const CLOCK_TOLERANCE_SEC = 30;

type JwtPayload = {
  sub?: string;
  email?: unknown;
};

type JoseVerify = {
  jwtVerify: (
    token: string,
    key: unknown,
    options: {
      issuer: string;
      audience: string;
      clockTolerance: number;
    },
  ) => Promise<{ payload: JwtPayload }>;
  createRemoteJWKSet: (url: URL) => unknown;
};

let jose: JoseVerify | undefined;
let jwks: unknown;
let jwksUrl: string | undefined;

async function loadJose(): Promise<JoseVerify> {
  if (!jose) {
    jose = (await import("jose")) as unknown as JoseVerify;
  }
  return jose;
}

async function getJwks(supabaseUrl: string): Promise<unknown> {
  const { createRemoteJWKSet } = await loadJose();
  const url = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
  if (!jwks || jwksUrl !== url) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksUrl = url;
  }
  return jwks;
}

function emailFromPayload(payload: JwtPayload): string | undefined {
  const email = payload.email;
  return typeof email === "string" && email.length > 0 ? email : undefined;
}

/**
 * Verify a Supabase access token via JWKS.
 * Fail closed if SUPABASE_URL is missing — never accept a raw Bearer string.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!isJwtConfigured()) {
      next(
        new AppError(
          503,
          "SERVICE_UNAVAILABLE",
          "JWT verification is not configured",
        ),
      );
      return;
    }

    const supabaseUrl = getSupabaseUrl();
    if (!supabaseUrl) {
      next(
        new AppError(
          503,
          "SERVICE_UNAVAILABLE",
          "JWT verification is not configured",
        ),
      );
      return;
    }

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

    let payload: JwtPayload;
    try {
      const { jwtVerify } = await loadJose();
      const verified = await jwtVerify(token, await getJwks(supabaseUrl), {
        issuer: `${supabaseUrl}/auth/v1`,
        audience: "authenticated",
        clockTolerance: CLOCK_TOLERANCE_SEC,
      });
      payload = verified.payload;
    } catch {
      next(new AppError(401, "UNAUTHORIZED", "Invalid or expired token"));
      return;
    }

    const userId = payload.sub;
    if (!userId) {
      next(new AppError(401, "UNAUTHORIZED", "Token is missing subject"));
      return;
    }

    req.auth = {
      userId,
      email: emailFromPayload(payload),
      token,
    };
    next();
  } catch (err) {
    next(err);
  }
}
