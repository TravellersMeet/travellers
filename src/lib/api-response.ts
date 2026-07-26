import { NextResponse } from "next/server";

import type {
  ApiErrorBody,
  ApiErrorCode,
  ApiErrorDetails,
} from "@/lib/api-error";
import { REQUEST_ID_HEADER } from "@/lib/request-id";

export function withRequestId<T extends Response>(
  response: T,
  requestId: string,
): T {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export function apiJson<T>(
  data: T,
  requestId: string,
  init?: ResponseInit,
): NextResponse<T> {
  return withRequestId(
    NextResponse.json(data, init),
    requestId,
  );
}

export function apiError(
  requestId: string,
  code: ApiErrorCode,
  message: string,
  status: number,
  details: ApiErrorDetails = null,
): NextResponse<ApiErrorBody> {
  return apiJson<ApiErrorBody>(
    {
      error: {
        code,
        message,
        requestId,
        details,
      },
    },
    requestId,
    { status },
  );
}
