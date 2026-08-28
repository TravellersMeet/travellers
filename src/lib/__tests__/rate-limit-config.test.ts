import { describe, expect, it } from "vitest";
import {
  buildRateLimitConfig,
  RATE_LIMIT_CONFIG,
  resolveRateLimitConfig,
} from "@/lib/rate-limit-config";
import {
  RATE_LIMIT_DEFAULTS,
  RATE_LIMIT_RULES,
  resolveRateLimitRules,
} from "@/lib/rate-limit-rules";

/**
 * `RATE_LIMIT_CONFIG` now reads the same resolved table the routes enforce,
 * so the default assertions below are pinned to an explicitly empty
 * environment. Reading `process.env` here would make the suite fail on any
 * machine that has tuned a limit locally — and, worse, pass while asserting
 * numbers nothing enforces, which is the bug this change removes.
 */
const defaults = resolveRateLimitConfig({});

describe("RATE_LIMIT_CONFIG", () => {
  it("provides appropriate security defaults for auth endpoints", () => {
    expect(defaults.auth.signin.limit).toBeGreaterThan(0);
    expect(defaults.auth.signin.windowSeconds).toBeGreaterThan(0);
    expect(defaults.auth.signup.limit).toBeLessThanOrEqual(defaults.auth.signin.limit);
    expect(defaults.auth.forgotPassword.limit).toBeLessThanOrEqual(defaults.auth.signin.limit);
    expect(defaults.auth.verifyOtp.limit).toBeGreaterThan(defaults.auth.forgotPassword.limit);
  });

  it("includes all required auth endpoints", () => {
    expect(RATE_LIMIT_CONFIG.auth).toHaveProperty("signin");
    expect(RATE_LIMIT_CONFIG.auth).toHaveProperty("signup");
    expect(RATE_LIMIT_CONFIG.auth).toHaveProperty("forgotPassword");
    expect(RATE_LIMIT_CONFIG.auth).toHaveProperty("verifyOtp");
    expect(RATE_LIMIT_CONFIG.auth).toHaveProperty("resendOtp");
  });

  it("has sensible default rate limits", () => {
    expect(defaults.auth.signin.limit).toBe(10);
    expect(defaults.auth.signin.windowSeconds).toBe(600); // 10 minutes
    expect(defaults.auth.signup.limit).toBe(5);
    expect(defaults.auth.signup.windowSeconds).toBe(3600); // 1 hour
    expect(defaults.auth.forgotPassword.limit).toBe(3);
    expect(defaults.auth.forgotPassword.windowSeconds).toBe(900); // 15 minutes
    expect(defaults.auth.verifyOtp.limit).toBe(10);
    expect(defaults.auth.verifyOtp.windowSeconds).toBe(600); // 10 minutes
    expect(defaults.auth.resendOtp.limit).toBe(3);
    expect(defaults.auth.resendOtp.windowSeconds).toBe(600); // 10 minutes
  });

  it("reports the same numbers the routes actually enforce", () => {
    // The whole point of the change: this view is derived from
    // RATE_LIMIT_RULES rather than being a second, unenforced copy of it.
    expect(RATE_LIMIT_CONFIG.auth.signin).toEqual({
      limit: RATE_LIMIT_RULES.authSignin.limit,
      windowSeconds: RATE_LIMIT_RULES.authSignin.windowSeconds,
    });
    expect(RATE_LIMIT_CONFIG.auth.signup).toEqual({
      limit: RATE_LIMIT_RULES.authSignup.limit,
      windowSeconds: RATE_LIMIT_RULES.authSignup.windowSeconds,
    });
    expect(RATE_LIMIT_CONFIG.auth.forgotPassword).toEqual({
      limit: RATE_LIMIT_RULES.authForgotPassword.limit,
      windowSeconds: RATE_LIMIT_RULES.authForgotPassword.windowSeconds,
    });
    expect(RATE_LIMIT_CONFIG.auth.verifyOtp).toEqual({
      limit: RATE_LIMIT_RULES.authVerifyOtp.limit,
      windowSeconds: RATE_LIMIT_RULES.authVerifyOtp.windowSeconds,
    });
    expect(RATE_LIMIT_CONFIG.auth.resendOtp).toEqual({
      limit: RATE_LIMIT_RULES.authResendOtp.limit,
      windowSeconds: RATE_LIMIT_RULES.authResendOtp.windowSeconds,
    });
  });

  it("tracks an environment override instead of ignoring it", () => {
    const configured = resolveRateLimitConfig({
      RATE_LIMIT_AUTH_SIGNIN_LIMIT: "2",
      RATE_LIMIT_AUTH_SIGNIN_WINDOW_SECONDS: "30",
    });

    expect(configured.auth.signin).toEqual({
      limit: 2,
      windowSeconds: 30,
    });
    // Untouched rules keep their defaults.
    expect(configured.auth.signup.limit).toBe(
      RATE_LIMIT_DEFAULTS.authSignup.limit,
    );
  });

  it("projects any resolved table, not just the module-level one", () => {
    const projected = buildRateLimitConfig(
      resolveRateLimitRules({
        env: { RATE_LIMIT_AUTH_RESEND_OTP_LIMIT: "1" },
        onWarn: () => {},
      }),
    );

    expect(projected.auth.resendOtp.limit).toBe(1);
  });
});
