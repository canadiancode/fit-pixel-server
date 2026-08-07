import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { AppError } from "../types/api";

type RequestTarget = "body" | "query" | "params";

export function validate<T>(schema: ZodType<T>, target: RequestTarget = "body") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req[target]);
    if (!parsed.success) {
      next(
        new AppError(400, "VALIDATION_ERROR", "Request validation failed", {
          issues: parsed.error.issues,
        }),
      );
      return;
    }

    if (target === "body") {
      req.body = parsed.data;
    } else if (target === "query") {
      // Express 5 / typed query is read-only in some setups; assign for handlers
      (req as Request & { validatedQuery?: T }).validatedQuery = parsed.data;
      Object.assign(req.query, parsed.data as object);
    } else {
      Object.assign(req.params, parsed.data as object);
    }

    next();
  };
}
