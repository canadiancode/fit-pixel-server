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
  _req: Request,
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

  if (env.NODE_ENV !== "production") {
    console.error(err);
  }

  res.status(500).json({
    ok: false,
    code: "INTERNAL_ERROR",
    message: "Internal server error",
  });
}
