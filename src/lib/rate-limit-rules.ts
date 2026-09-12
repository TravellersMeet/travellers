import type { NextRequest } from "next/server";

import {
  checkRateLimit,
  getRateLimitIdentifier,
  type RateLimitResult,
  type RateLimitRule,
  type RateLimitScope,
} from "@/lib/rate-limit";

/**
 * Every throttled route's policy in one table.
 *
 * Keeping the policy in one place prevents auth routes from accidentally
 * drifting apart or sharing the wrong Redis namespace.
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
  /** OTP verification attempts, per email + IP. */
  authVerifyOtp: {
    namespace: "auth:verify-otp",
    limit: 10,
    windowSeconds: 10 * 60,
  },
  /**
   * OTP verification attempts against one account, keyed on the email alone.
   *
   * `authVerifyOtp` keys on `email|ip`, so an attacker guessing a six-digit
   * code just rotates source addresses to reset the counter. This rule is the
   * ceiling that actually protects the account.
   */
  authVerifyOtpAccount: {
    namespace: "auth:verify-otp:account",
    limit: 20,
    windowSeconds: 15 * 60,
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
  /** Password reset confirmation attempts. */
  authResetPassword: {
    namespace: "auth:reset-password",
    limit: 5,
    windowSeconds: 15 * 60,
  },
  /** Authenticated password changes. */
  authChangePassword: {
    namespace: "auth:change-password",
    limit: 5,
    windowSeconds: 15 * 60,
  },
  /** Gemini calls, which are billed per request. */
  chat: {
    namespace: "chat",
    limit: 10,
    windowSeconds: 60,
  },
  /** Saving a route — each write can carry a large encoded polyline. */
  routeWrite: {
    namespace: "routes:write",
    limit: 30,
    windowSeconds: 60,
  },
  /** Sending a chat message. */
  messageSend: {
    namespace: "messages:send",
    limit: 30,
    windowSeconds: 60,
  },
  /** Connection actions. */
  connectionAction: {
    namespace: "connections:action",
    limit: 20,
    windowSeconds: 60,
  },
  /** Onboarding submissions — each one is an unbounded profile write. */
  userOnboard: {
    namespace: "user:onboard",
    limit: 10,
    windowSeconds: 10 * 60,
  },
  /** User reports. */
  userReport: {
    namespace: "user:report",
    limit: 5,
    windowSeconds: 10 * 60,
  },
} satisfies Record<string, RateLimitRule>;

export type RateLimitRuleName = keyof typeof RATE_LIMIT_RULES;

export interface EnforceRateLimitOptions {
  /** See {@link RateLimitScope}. Defaults to `subject-and-ip`. */
  scope?: RateLimitScope;
}

/** Apply a named rule to a request. */
export async function enforceRateLimit(
  request: NextRequest,
  ruleName: RateLimitRuleName,
  subject?: string | null,
  { scope }: EnforceRateLimitOptions = {},
): Promise<RateLimitResult> {
  const rule = RATE_LIMIT_RULES[ruleName];

  return checkRateLimit({
    ...rule,
    identifier: getRateLimitIdentifier(
      request,
      subject,
      scope,
    ),
  });
}
