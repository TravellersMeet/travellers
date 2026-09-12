import {
  RATE_LIMIT_RULES,
  resolveRateLimitRules,
  type RateLimitEnv,
} from "@/lib/rate-limit-rules";

/**
 * A read-only view of the auth slice of the enforced rule table.
 *
 * @deprecated Import `RATE_LIMIT_RULES` from `@/lib/rate-limit-rules` instead.
 *
 * This module used to hold a *second*, independent copy of the auth limits,
 * built from the `RATE_LIMIT_AUTH_*` environment variables. Nothing enforced
 * it — every route goes through `enforceRateLimit`, which reads
 * `RATE_LIMIT_RULES` — so the documented variables changed nothing while the
 * tests here asserted their values and passed.
 *
 * It is now derived from the same resolved table the routes enforce, so the
 * two can no longer disagree. It is kept only so existing imports keep
 * compiling; new code should read the rules directly.
 */

export interface AuthRateLimitEntry {
  limit: number;
  windowSeconds: number;
}

export interface AuthRateLimitConfig {
  signin: AuthRateLimitEntry;
  signup: AuthRateLimitEntry;
  forgotPassword: AuthRateLimitEntry;
  verifyOtp: AuthRateLimitEntry;
  resendOtp: AuthRateLimitEntry;
}

function toEntry({
  limit,
  windowSeconds,
}: {
  limit: number;
  windowSeconds: number;
}): AuthRateLimitEntry {
  return { limit, windowSeconds };
}

/**
 * Projects a resolved rule table onto the legacy `{ auth: { … } }` shape.
 *
 * Exported so tests can build the view from a mocked environment without
 * reaching into module-load state.
 */
export function buildRateLimitConfig(
  rules: typeof RATE_LIMIT_RULES = RATE_LIMIT_RULES,
): { auth: AuthRateLimitConfig } {
  return {
    auth: {
      signin: toEntry(rules.authSignin),
      signup: toEntry(rules.authSignup),
      forgotPassword: toEntry(rules.authForgotPassword),
      verifyOtp: toEntry(rules.authVerifyOtp),
      resendOtp: toEntry(rules.authResendOtp),
    },
  };
}

/**
 * Convenience wrapper for callers that want the legacy shape resolved against
 * a specific environment rather than `process.env`.
 */
export function resolveRateLimitConfig(
  env?: RateLimitEnv,
): { auth: AuthRateLimitConfig } {
  return buildRateLimitConfig(
    resolveRateLimitRules({ env }),
  );
}

export const RATE_LIMIT_CONFIG = buildRateLimitConfig();
