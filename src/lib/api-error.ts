import type { ZodError } from "zod";

export const API_ERROR_CODES = {
  BAD_REQUEST: "BAD_REQUEST",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ApiErrorCode =
  (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export type ApiErrorDetails =
  | Record<string, string[]>
  | Record<string, unknown>
  | null;

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    details: ApiErrorDetails;
  };
}

export function formatZodError(
  error: ZodError,
): Record<string, string[]> {
  const details: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = issue.path.length
      ? issue.path.join(".")
      : "_root";

    details[field] ??= [];
    details[field].push(issue.message);
  }

  return details;
}

export function logApiError(
  requestId: string,
  operation: string,
  error: unknown,
): void {
  const safeError =
    error instanceof Error
      ? {
          name: error.name,
          message: error.message,
        }
      : {
          value: String(error),
        };

  console.error(`[${requestId}] ${operation}`, safeError);
}
