import type { NextRequest } from "next/server";

import {
  API_ERROR_CODES,
  logApiError,
} from "@/lib/api-error";
import { apiError, withRequestId } from "@/lib/api-response";
import { getRequestId } from "@/lib/request-id";

export interface ApiHandlerContext {
  requestId: string;
}

type ApiHandler = (
  request: NextRequest,
  context: ApiHandlerContext,
) => Promise<Response>;

export function withApiHandler(
  operation: string,
  handler: ApiHandler,
) {
  return async (request: NextRequest): Promise<Response> => {
    const requestId = getRequestId(request);

    try {
      const response = await handler(request, { requestId });
      return withRequestId(response, requestId);
    } catch (error) {
      logApiError(requestId, operation, error);

      return apiError(
        requestId,
        API_ERROR_CODES.INTERNAL_ERROR,
        "An unexpected server error occurred",
        500,
      );
    }
  };
}
