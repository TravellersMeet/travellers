import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  API_ERROR_CODES,
  formatZodError,
  logApiError,
} from "@/lib/api-error";
import { apiError, withRequestId } from "@/lib/api-response";
import { getRequestId } from "@/lib/request-id";

export interface ValidationContext {
  requestId: string;
}

type Handler<T> = (
  req: NextRequest,
  data: T,
  context: ValidationContext,
) => Promise<Response>;

interface ValidationOptions {
  standardizeErrors?: boolean;
}

export function withValidation<T>(
  schema: z.ZodSchema<T>,
  handler: Handler<T>,
  customErrorMsg?: string,
  options: ValidationOptions = {},
) {
  return async (req: NextRequest): Promise<Response> => {
    const requestId = getRequestId(req);
    const standardizeErrors =
      options.standardizeErrors === true;

    try {
      const contentType =
        req.headers?.get("content-type") ?? "";
      let rawData: unknown;

      try {
        if (contentType.includes("application/json")) {
          rawData = await req.json();
        } else if (
          contentType.includes("multipart/form-data") ||
          contentType.includes(
            "application/x-www-form-urlencoded",
          )
        ) {
          const form = await req.formData();
          rawData = Object.fromEntries(form.entries());
        } else if (typeof req.json === "function") {
          rawData = await req.json();
        } else if (typeof req.formData === "function") {
          const form = await req.formData();
          rawData = Object.fromEntries(form.entries());
        } else if (typeof req.text === "function") {
          const text = await req.text();
          rawData = text ? JSON.parse(text) : {};
        } else {
          rawData = {};
        }
      } catch (parseError) {
        logApiError(
          requestId,
          "Request payload parsing failed",
          parseError,
        );

        if (standardizeErrors) {
          return apiError(
            requestId,
            API_ERROR_CODES.BAD_REQUEST,
            "Invalid request format",
            400,
          );
        }

        return withRequestId(
          NextResponse.json(
            { error: "Invalid request format" },
            { status: 400 },
          ),
          requestId,
        );
      }

      const result = schema.safeParse(rawData);

      if (!result.success) {
        if (standardizeErrors) {
          return apiError(
            requestId,
            API_ERROR_CODES.VALIDATION_ERROR,
            customErrorMsg ?? "The request data is invalid",
            400,
            formatZodError(result.error),
          );
        }

        return withRequestId(
          NextResponse.json(
            {
              error: customErrorMsg ?? "Invalid input",
              details: result.error.flatten(),
            },
            { status: 400 },
          ),
          requestId,
        );
      }

      const response = await handler(req, result.data, {
        requestId,
      });

      return withRequestId(response, requestId);
    } catch (error) {
      logApiError(
        requestId,
        "API Error (withValidation wrapper)",
        error,
      );

      if (standardizeErrors) {
        return apiError(
          requestId,
          API_ERROR_CODES.INTERNAL_ERROR,
          "An unexpected server error occurred",
          500,
        );
      }

      return withRequestId(
        NextResponse.json(
          { error: "Internal server error" },
          { status: 500 },
        ),
        requestId,
      );
    }
  };
}
