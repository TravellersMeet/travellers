import type { NextRequest } from "next/server";

import {
  checkRateLimit,
  getRateLimitIdentifier,
  type RateLimitResult,
  type RateLimitRule,
} from "@/lib/rate-limit";

/**
 * Every throttled route's policy in one table.
 *
 * These used to be literals at each call site, which made the overall policy
 * impossible to read and left nothing stopping two routes from sharing a
 * namespace — sharing one means they share a counter, so traffic to one would
 * lock the other out.
 *
 * Values here are exactly the ones the auth and chat routes already used;
 * moving them is not meant to change any existing limit.
 */
export const RATE_LIMIT_RULES = {
  /** Account creation. Keyed on email + IP. */
  authSignup: {
    namespace: "auth:signup",
    limit: 5,
    windowSeconds: 60 * 60,
  },
  /** Credential sign-in attempts. */
  authSignin: {
    namespace: "auth:signin",
    limit: 10,
    windowSeconds: 10 * 60,
  },
  /** OTP verification attempts. */
  authVerifyOtp: {
    namespace: "auth:verify-otp",
    limit: 10,
    windowSeconds: 10 * 60,
  },
  /** OTP resends — each one sends an email. */
  authResendOtp: {
    namespace: "auth:resend-otp",
    limit: 3,
    windowSeconds: 10 * 60,
  },
  /** Password reset emails. */
  authForgotPassword: {
    namespace: "auth:forgot-password",
    limit: 3,
    windowSeconds: 15 * 60,
  },
  /** Gemini calls, which are billed per request. */
  chat: {
    namespace: "chat",
    limit: 10,
    windowSeconds: 60,
  },
  /**
   * Sending a chat message. Generous enough for a fast typist in a live
   * conversation, low enough that a script cannot flood a thread — each
   * message also costs one Pusher event per participant.
   */
  messageSend: {
    namespace: "messages:send",
    limit: 30,
    windowSeconds: 60,
  },
  /**
   * Connection actions. A `send` creates a notification and a Pusher event on
   * somebody else's channel, so this is the spam-facing one.
   */
  connectionAction: {
    namespace: "connections:action",
    limit: 20,
    windowSeconds: 60,
  },
  /**
   * Reports. Deliberately tight: filing them in bulk is itself an abuse
   * vector against the moderation queue.
   */
  userReport: {
    namespace: "user:report",
    limit: 5,
    windowSeconds: 10 * 60,
  },
} satisfies Record<string, RateLimitRule>;

export type RateLimitRuleName = keyof typeof RATE_LIMIT_RULES;

/**
 * Apply a named rule to a request.
 *
 * `subject` scopes the counter to an actor as well as an IP — a session user
 * id for authenticated routes, an email for the auth flows. Omit it and the
 * limit is per-IP only.
 *
 * Inherits the fail-open behaviour of `checkRateLimit`: if Redis is missing or
 * unreachable the call is allowed with `bypassed: true`. For a social app,
 * locking everybody out because the cache is down is the worse failure.
 */
export async function enforceRateLimit(
  request: NextRequest,
  ruleName: RateLimitRuleName,
  subject?: string | null,
): Promise<RateLimitResult> {
  const rule = RATE_LIMIT_RULES[ruleName];

  return checkRateLimit({
    ...rule,
    identifier: getRateLimitIdentifier(request, subject),
  });
}
