import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getClientIp } from "@/lib/client-ip";
import redis from "@/lib/redis";

const RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
return { current, ttl }
`;

export interface RateLimitStore {
  eval(
    script: string,
    numberOfKeys: number,
    key: string,
    windowSeconds: number,
  ): Promise<unknown>;
}

export interface RateLimitRule {
  namespace: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter: number;
  bypassed: boolean;
}

interface RateLimitOptions extends RateLimitRule {
  identifier: string;
  store?: RateLimitStore | null;
  now?: () => number;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : fallback;
}

function hashIdentifier(identifier: string): string {
  return createHash("sha256")
    .update(identifier.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

export function buildRateLimitKey(
  namespace: string,
  identifier: string,
): string {
  const safeNamespace = namespace
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-");

  return `rate-limit:${safeNamespace}:${hashIdentifier(identifier)}`;
}

export async function checkRateLimit({
  namespace,
  identifier,
  limit,
  windowSeconds,
  store = redis,
  now = () => Date.now(),
}: RateLimitOptions): Promise<RateLimitResult> {
  const safeLimit = positiveInteger(limit, 1);
  const safeWindow = positiveInteger(windowSeconds, 60);
  const nowSeconds = Math.floor(now() / 1000);

  if (!store) {
    return {
      allowed: true,
      limit: safeLimit,
      remaining: safeLimit,
      resetAt: nowSeconds + safeWindow,
      retryAfter: 0,
      bypassed: true,
    };
  }

  try {
    const result = await store.eval(
      RATE_LIMIT_SCRIPT,
      1,
      buildRateLimitKey(namespace, identifier),
      safeWindow,
    );

    const values = Array.isArray(result) ? result : [];
    const current = positiveInteger(values[0], 1);
    const ttl = positiveInteger(values[1], safeWindow);
    const allowed = current <= safeLimit;

    return {
      allowed,
      limit: safeLimit,
      remaining: Math.max(0, safeLimit - current),
      resetAt: nowSeconds + ttl,
      retryAfter: allowed ? 0 : ttl,
      bypassed: false,
    };
  } catch (error) {
    console.warn(
      "Rate limiter unavailable; allowing request:",
      error instanceof Error ? error.message : error,
    );

    return {
      allowed: true,
      limit: safeLimit,
      remaining: safeLimit,
      resetAt: nowSeconds + safeWindow,
      retryAfter: 0,
      bypassed: true,
    };
  }
}

export function getRateLimitIdentifier(
  request: NextRequest,
  subject?: string | null,
): string {
  const ip = getClientIp(request);
  const normalizedSubject = subject?.trim().toLowerCase();

  return normalizedSubject
    ? `${normalizedSubject}|${ip}`
    : ip;
}

export function applyRateLimitHeaders(
  response: Response,
  result: RateLimitResult,
): Response {
  response.headers.set(
    "X-RateLimit-Limit",
    String(result.limit),
  );
  response.headers.set(
    "X-RateLimit-Remaining",
    String(result.remaining),
  );
  response.headers.set(
    "X-RateLimit-Reset",
    String(result.resetAt),
  );

  if (!result.allowed) {
    response.headers.set(
      "Retry-After",
      String(result.retryAfter),
    );
  }

  return response;
}

export function rateLimitExceededResponse(
  result: RateLimitResult,
): NextResponse {
  return applyRateLimitHeaders(
    NextResponse.json(
      {
        error: "Too many requests",
        retryAfter: result.retryAfter,
      },
      { status: 429 },
    ),
    result,
  ) as NextResponse;
}
