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
 * Keeping the policy in one place prevents auth routes from accidentally
 * drifting apart or sharing the wrong Redis namespace.
 *
 * These are *defaults*. Each entry can be overridden per environment — see
 * {@link resolveRateLimitRules} for how the variable names are derived. The
 * limits used to be literals with no override path at all, which meant the
 * `RATE_LIMIT_AUTH_*` variables documented in `.env.example` were read by a
 * table (`RATE_LIMIT_CONFIG`) that no route ever consulted.
 */
export const RATE_LIMIT_DEFAULTS = {
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

export type RateLimitRuleName = keyof typeof RATE_LIMIT_DEFAULTS;

export type ResolvedRateLimitRules = Record<
  RateLimitRuleName,
  RateLimitRule
>;

/** Minimal view of `process.env` so the resolver can be tested in isolation. */
export type RateLimitEnv = Record<
  string,
  string | undefined
>;

/**
 * `authForgotPassword` -> `AUTH_FORGOT_PASSWORD`.
 *
 * Deriving the suffix from the rule name is what keeps the table and the
 * documented variables from drifting: adding a rule automatically gives it an
 * override, and renaming one cannot leave a stale key behind. The mapping is
 * chosen to match the names already published in `.env.example`, so existing
 * deployments keep the variables they have.
 */
export function envSuffixForRule(
  ruleName: string,
): string {
  return ruleName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase();
}

export function envKeysForRule(ruleName: string): {
  limit: string;
  windowSeconds: string;
} {
  const suffix = envSuffixForRule(ruleName);

  return {
    limit: `RATE_LIMIT_${suffix}_LIMIT`,
    windowSeconds: `RATE_LIMIT_${suffix}_WINDOW_SECONDS`,
  };
}

/**
 * Reads one positive integer override.
 *
 * An unset variable is normal and silent. A *set but unusable* variable is
 * not — that is a typo in a deploy config, and silently serving the default
 * is how you end up believing a limit is tighter than it is. Those warn.
 */
function readOverride(
  env: RateLimitEnv,
  key: string,
  fallback: number,
  onWarn: (message: string) => void,
): number {
  const raw = env[key];

  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    onWarn(
      `${key}="${raw}" is not a positive number; falling back to ${fallback}.`,
    );
    return fallback;
  }

  if (!Number.isInteger(parsed)) {
    onWarn(
      `${key}="${raw}" is not a whole number; rounding down to ${Math.floor(parsed)}.`,
    );
  }

  return Math.floor(parsed);
}

export interface ResolveRateLimitRulesOptions {
  env?: RateLimitEnv;
  onWarn?: (message: string) => void;
}

/**
 * Builds the enforced rule table by layering environment overrides on top of
 * {@link RATE_LIMIT_DEFAULTS}.
 *
 * Namespaces are deliberately *not* overridable — they are Redis key prefixes,
 * and letting an environment variable change them would silently reset live
 * counters or collide two unrelated rules in the same bucket.
 */
export function resolveRateLimitRules({
  env = process.env as RateLimitEnv,
  onWarn = (message) =>
    console.warn(`Rate limit config: ${message}`),
}: ResolveRateLimitRulesOptions = {}): ResolvedRateLimitRules {
  const entries = (
    Object.keys(
      RATE_LIMIT_DEFAULTS,
    ) as RateLimitRuleName[]
  ).map((ruleName) => {
    const fallback = RATE_LIMIT_DEFAULTS[ruleName];
    const keys = envKeysForRule(ruleName);

    return [
      ruleName,
      {
        namespace: fallback.namespace,
        limit: readOverride(
          env,
          keys.limit,
          fallback.limit,
          onWarn,
        ),
        windowSeconds: readOverride(
          env,
          keys.windowSeconds,
          fallback.windowSeconds,
          onWarn,
        ),
      },
    ] as const;
  });

  return Object.fromEntries(
    entries,
  ) as ResolvedRateLimitRules;
}

/**
 * The table every route enforces, resolved once at module load.
 *
 * Resolving eagerly means a bad value warns at boot rather than on the first
 * request that happens to hit that route.
 */
export const RATE_LIMIT_RULES: ResolvedRateLimitRules =
  resolveRateLimitRules();

/** Apply a named rule to a request. */
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
