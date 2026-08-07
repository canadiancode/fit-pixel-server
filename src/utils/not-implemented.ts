import type { Response } from "express";
import type { ApiErrorBody } from "../types/api";

export function sendNotImplemented(
  res: Response,
  message: string,
): Response<ApiErrorBody> {
  return res.status(501).json({
    ok: false,
    code: "NOT_IMPLEMENTED",
    message,
  });
}
