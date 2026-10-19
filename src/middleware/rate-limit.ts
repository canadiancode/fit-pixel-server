import type { Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { AppError } from "../types/api";

/**
 * In-memory limits: fine for the single PM2 `fit-pixel-api` process. Move to a
 * shared store (Redis) before running more than one instance.
 *
 * `trust proxy` is 1 (nginx), so req.ip is the client address.
 */

function limiter(options: {
  windowMs: number;
  limit: number;
  keyGenerator: (req: Request) => string;
}) {
  return rateLimit({
    ...options,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(
        new AppError(429, "RATE_LIMITED", "Too many requests. Try again shortly."),
      );
    },
  });
}

const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? "");

/**
 * Baseline per IP across the whole API. Generous: a gym's shared Wi-Fi puts
 * many phones behind one address.
 */
export const ipRateLimit = limiter({
  windowMs: 60_000,
  limit: 600,
  keyGenerator: ipKey,
});

/**
 * Per signed-in user. Mount after requireAuth so req.auth is the verified
 * user; falls back to the IP if it is missing.
 */
export function userRateLimit(limit: number, windowMs = 60_000) {
  return limiter({
    windowMs,
    limit,
    keyGenerator: (req) => (req.auth?.userId ? `u:${req.auth.userId}` : ipKey(req)),
  });
}

/** FatSecret calls cost quota; typing in search fires one per debounce. */
export const foodRateLimit = userRateLimit(60);
/** Display-name search: enough to type, not enough to scrape every Pixel. */
export const pixelSearchRateLimit = userRateLimit(30);
/** Reports, blocks and friend requests: a person does a few, a script many. */
export const safetyWriteRateLimit = userRateLimit(20);
