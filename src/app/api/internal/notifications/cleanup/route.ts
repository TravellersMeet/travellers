import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import {
  API_ERROR_CODES,
  logApiError,
} from "@/lib/api-error";
import {
  apiError,
  apiJson,
} from "@/lib/api-response";
import {
  cleanupExpiredNotifications,
  normalizeCleanupBatchSize,
} from "@/lib/notifications";
import { getRequestId } from "@/lib/request-id";

const CLEANUP_SECRET_HEADER =
  "x-notification-cleanup-secret";

function secretsMatch(
  providedSecret: string | null,
  expectedSecret: string | undefined,
): boolean {
  if (!providedSecret || !expectedSecret) {
    return false;
  }

  const provided = Buffer.from(providedSecret);
  const expected = Buffer.from(expectedSecret);

  return (
    provided.length === expected.length &&
    timingSafeEqual(provided, expected)
  );
}

function parseLimit(request: NextRequest): number {
  const rawLimit =
    request.nextUrl.searchParams.get("limit");

  if (rawLimit === null) {
    return normalizeCleanupBatchSize();
  }

  const parsedLimit = Number(rawLimit);

  if (
    !Number.isInteger(parsedLimit) ||
    parsedLimit < 1
  ) {
    throw new Error(
      "Limit must be a positive integer",
    );
  }

  return normalizeCleanupBatchSize(parsedLimit);
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const expectedSecret =
    process.env.NOTIFICATION_CLEANUP_SECRET;
  const providedSecret =
    request.headers.get(CLEANUP_SECRET_HEADER);

  if (
    !secretsMatch(
      providedSecret,
      expectedSecret,
    )
  ) {
    return apiError(
      requestId,
      API_ERROR_CODES.UNAUTHORIZED,
      "Invalid cleanup credentials",
      401,
    );
  }

  let batchSize: number;

  try {
    batchSize = parseLimit(request);
  } catch (error) {
    return apiError(
      requestId,
      API_ERROR_CODES.VALIDATION_ERROR,
      error instanceof Error
        ? error.message
        : "Invalid cleanup limit",
      400,
    );
  }

  try {
    const result =
      await cleanupExpiredNotifications(
        batchSize,
      );

    return apiJson(
      {
        deletedCount: result.deletedCount,
        hasMore: result.hasMore,
        batchSize: result.batchSize,
      },
      requestId,
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    logApiError(
      requestId,
      "Notification cleanup failed",
      error,
    );

    return apiError(
      requestId,
      API_ERROR_CODES.INTERNAL_ERROR,
      "Unable to clean up expired notifications",
      500,
    );
  }
}
