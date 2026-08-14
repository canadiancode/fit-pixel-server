export type ApiErrorCode =
  | "NOT_IMPLEMENTED"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "BAD_REQUEST"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";

export type ApiErrorBody = {
  ok: false;
  code: ApiErrorCode;
  message: string;
  details?: unknown;
};

export type ApiSuccessBody<T> = {
  ok: true;
} & T;

export class AppError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
