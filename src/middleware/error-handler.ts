import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError, type ApiErrorBody } from "../types/api";
import { env } from "../config/env";

export function notFoundHandler(
  _req: Request,
  res: Response<ApiErrorBody>,
): void {
  res.status(404).json({
    ok: false,
    code: "BAD_REQUEST",
    message: "Not found",
  });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response<ApiErrorBody>,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      ok: false,
      code: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: { issues: err.issues },
    });
    return;
  }

  // cors package may pass Error for blocked origins
  if (err instanceof Error && err.message.startsWith("CORS blocked")) {
    res.status(403).json({
      ok: false,
      code: "BAD_REQUEST",
      message: err.message,
    });
    return;
  }

  // express.json(): malformed JSON (400) or a body over the 1 MB limit (413).
  const bodyError = err as { type?: unknown; status?: unknown };
  if (
    bodyError?.type === "entity.parse.failed" ||
    bodyError?.type === "entity.too.large"
  ) {
    const tooLarge = bodyError.type === "entity.too.large";
    res.status(tooLarge ? 413 : 400).json({
      ok: false,
      code: "BAD_REQUEST",
      message: tooLarge ? "Request body is too large" : "Malformed JSON body",
    });
    return;
  }

  // Always log unexpected errors (PM2 keeps stdout/stderr). Method + path only:
  // no headers, query strings or bodies, which can carry tokens or user data.
  console.error(
    `Unhandled error on ${req.method} ${req.path}:`,
    env.NODE_ENV === "production" && err instanceof Error
      ? `${err.name}: ${err.message}\n${err.stack ?? ""}`
      : err,
  );

  res.status(500).json({
    ok: false,
    code: "INTERNAL_ERROR",
    message: "Internal server error",
  });
}
