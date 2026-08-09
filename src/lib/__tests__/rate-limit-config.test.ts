import { describe, expect, it } from "vitest";
import { RATE_LIMIT_CONFIG } from "@/lib/rate-limit-config";

describe("RATE_LIMIT_CONFIG", () => {
  it("provides appropriate security defaults for auth endpoints", () => {
    expect(RATE_LIMIT_CONFIG.auth.signin.limit).toBeGreaterThan(0);
    expect(RATE_LIMIT_CONFIG.auth.signin.windowSeconds).toBeGreaterThan(0);
    expect(RATE_LIMIT_CONFIG.auth.signup.limit).toBeLessThanOrEqual(RATE_LIMIT_CONFIG.auth.signin.limit);
    expect(RATE_LIMIT_CONFIG.auth.forgotPassword.limit).toBeLessThanOrEqual(RATE_LIMIT_CONFIG.auth.signin.limit);
    expect(RATE_LIMIT_CONFIG.auth.verifyOtp.limit).toBeGreaterThan(RATE_LIMIT_CONFIG.auth.forgotPassword.limit);
  });

  it("includes all required auth endpoints", () => {
    expect(RATE_LIMIT_CONFIG.auth).toHaveProperty("signin");
    expect(RATE_LIMIT_CONFIG.auth).toHaveProperty("signup");
    expect(RATE_LIMIT_CONFIG.auth).toHaveProperty("forgotPassword");
    expect(RATE_LIMIT_CONFIG.auth).toHaveProperty("verifyOtp");
    expect(RATE_LIMIT_CONFIG.auth).toHaveProperty("resendOtp");
  });

  it("has sensible default rate limits", () => {
    expect(RATE_LIMIT_CONFIG.auth.signin.limit).toBe(10);
    expect(RATE_LIMIT_CONFIG.auth.signin.windowSeconds).toBe(600); // 10 minutes
    expect(RATE_LIMIT_CONFIG.auth.signup.limit).toBe(5);
    expect(RATE_LIMIT_CONFIG.auth.signup.windowSeconds).toBe(3600); // 1 hour
    expect(RATE_LIMIT_CONFIG.auth.forgotPassword.limit).toBe(3);
    expect(RATE_LIMIT_CONFIG.auth.forgotPassword.windowSeconds).toBe(900); // 15 minutes
    expect(RATE_LIMIT_CONFIG.auth.verifyOtp.limit).toBe(10);
    expect(RATE_LIMIT_CONFIG.auth.verifyOtp.windowSeconds).toBe(600); // 10 minutes
    expect(RATE_LIMIT_CONFIG.auth.resendOtp.limit).toBe(3);
    expect(RATE_LIMIT_CONFIG.auth.resendOtp.windowSeconds).toBe(600); // 10 minutes
  });
});
