import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

const REQUEST_ID_PATTERN =
  /^(?:req_[A-Za-z0-9_-]{8,64}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export const REQUEST_ID_HEADER = "X-Request-ID";

export function isValidRequestId(value: string): boolean {
  return REQUEST_ID_PATTERN.test(value.trim());
}

export function createRequestId(): string {
  return `req_${randomUUID().replace(/-/g, "")}`;
}

export function getRequestId(request: NextRequest): string {
  const provided = request.headers.get(REQUEST_ID_HEADER);

  if (provided && isValidRequestId(provided)) {
    return provided.trim();
  }

  return createRequestId();
}
