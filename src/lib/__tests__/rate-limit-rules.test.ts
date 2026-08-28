import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkRateLimit } from "@/lib/rate-limit";
import {
  enforceRateLimit,
  envKeysForRule,
  envSuffixForRule,
  RATE_LIMIT_DEFAULTS,
  RATE_LIMIT_RULES,
  resolveRateLimitRules,
  type RateLimitEnv,
  type RateLimitRuleName,
} from "@/lib/rate-limit-rules";

const RULE_NAMES = Object.keys(
  RATE_LIMIT_DEFAULTS,
) as RateLimitRuleName[];

function resolve(env: RateLimitEnv) {
  return resolveRateLimitRules({
    env,
    onWarn: () => {},
  });
}

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/rate-limit")
    >();

  return {
    ...actual,
    checkRateLimit: vi.fn(),
  };
});

function request(forwardedFor = "203.0.113.7") {
  return new NextRequest("http://localhost/api/messages", {
    headers: { "x-forwarded-for": forwardedFor },
  });
}

describe("RATE_LIMIT_RULES", () => {
  it("gives every rule its own namespace", () => {
    const namespaces = Object.values(
      RATE_LIMIT_RULES,
    ).map((rule) => rule.namespace);

    expect(new Set(namespaces).size).toBe(
      namespaces.length,
    );
  });

  it("declares a positive limit and window for every rule", () => {
    for (const [name, rule] of Object.entries(
      RATE_LIMIT_RULES,
    )) {
      expect(
        rule.limit,
        `${name}.limit`,
      ).toBeGreaterThan(0);
      expect(
        rule.windowSeconds,
        `${name}.windowSeconds`,
      ).toBeGreaterThan(0);
    }
  });

  it("preserves the limits the auth and chat routes already used", () => {
    // Moving these into one table must not change any existing policy.
    // Read from the default table rather than the resolved one: these are now
    // overridable per environment, and the guarantee under test is about the
    // shipped defaults, not about whatever a given deploy has configured.
    const RATE_LIMIT_RULES = RATE_LIMIT_DEFAULTS;

    expect(RATE_LIMIT_RULES.authSignup).toEqual({
      namespace: "auth:signup",
      limit: 5,
      windowSeconds: 3600,
    });
    expect(RATE_LIMIT_RULES.authSignin).toEqual({
      namespace: "auth:signin",
      limit: 10,
      windowSeconds: 600,
    });
    expect(RATE_LIMIT_RULES.authVerifyOtp).toEqual({
      namespace: "auth:verify-otp",
      limit: 10,
      windowSeconds: 600,
    });
    expect(RATE_LIMIT_RULES.authResendOtp).toEqual({
      namespace: "auth:resend-otp",
      limit: 3,
      windowSeconds: 600,
    });
    expect(RATE_LIMIT_RULES.authForgotPassword).toEqual({
      namespace: "auth:forgot-password",
      limit: 3,
      windowSeconds: 900,
    });
    expect(RATE_LIMIT_RULES.chat).toEqual({
      namespace: "chat",
      limit: 10,
      windowSeconds: 60,
    });
  });

  it("keeps reports tighter than ordinary messaging", () => {
    expect(RATE_LIMIT_RULES.userReport.limit).toBeLessThan(
      RATE_LIMIT_RULES.messageSend.limit,
    );
  });
});

describe("enforceRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      limit: 30,
      remaining: 29,
      resetAt: 0,
      retryAfter: 0,
      bypassed: false,
    });
  });

  it("passes the named rule through to checkRateLimit", async () => {
    await enforceRateLimit(
      request(),
      "messageSend",
      "user-1",
    );

    expect(checkRateLimit).toHaveBeenCalledWith({
      namespace: "messages:send",
      limit: 30,
      windowSeconds: 60,
      identifier: "user-1|203.0.113.7",
    });
  });

  it("falls back to an IP-only identifier without a subject", async () => {
    await enforceRateLimit(request(), "chat");

    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "chat",
        identifier: "203.0.113.7",
      }),
    );
  });

  it("scopes the counter per subject", async () => {
    await enforceRateLimit(
      request(),
      "userReport",
      "user-1",
    );
    await enforceRateLimit(
      request(),
      "userReport",
      "user-2",
    );

    const identifiers = vi
      .mocked(checkRateLimit)
      .mock.calls.map(([options]) => options.identifier);

    expect(identifiers[0]).not.toBe(identifiers[1]);
  });

  it("returns whatever checkRateLimit decided", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      limit: 5,
      remaining: 0,
      resetAt: 100,
      retryAfter: 42,
      bypassed: false,
    });

    const result = await enforceRateLimit(
      request(),
      "userReport",
      "user-1",
    );

    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(42);
  });
});

describe("envSuffixForRule", () => {
  it("maps rule names onto the documented variable names", () => {
    expect(envSuffixForRule("authSignin")).toBe(
      "AUTH_SIGNIN",
    );
    expect(
      envSuffixForRule("authForgotPassword"),
    ).toBe("AUTH_FORGOT_PASSWORD");
    expect(envSuffixForRule("authVerifyOtp")).toBe(
      "AUTH_VERIFY_OTP",
    );
    expect(envSuffixForRule("chat")).toBe("CHAT");
    expect(envSuffixForRule("messageSend")).toBe(
      "MESSAGE_SEND",
    );
  });

  it("keeps the five variable names already published in .env.example", () => {
    // These are live in existing deployments. Renaming any of them would
    // silently drop an operator's configured limit back to the default.
    expect(envKeysForRule("authSignin").limit).toBe(
      "RATE_LIMIT_AUTH_SIGNIN_LIMIT",
    );
    expect(
      envKeysForRule("authSignin").windowSeconds,
    ).toBe("RATE_LIMIT_AUTH_SIGNIN_WINDOW_SECONDS");
    expect(envKeysForRule("authSignup").limit).toBe(
      "RATE_LIMIT_AUTH_SIGNUP_LIMIT",
    );
    expect(
      envKeysForRule("authForgotPassword").limit,
    ).toBe("RATE_LIMIT_AUTH_FORGOT_PASSWORD_LIMIT");
    expect(envKeysForRule("authVerifyOtp").limit).toBe(
      "RATE_LIMIT_AUTH_VERIFY_OTP_LIMIT",
    );
    expect(envKeysForRule("authResendOtp").limit).toBe(
      "RATE_LIMIT_AUTH_RESEND_OTP_LIMIT",
    );
  });

  it("derives a unique key pair for every rule", () => {
    const keys = RULE_NAMES.flatMap((name) => {
      const pair = envKeysForRule(name);
      return [pair.limit, pair.windowSeconds];
    });

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("resolveRateLimitRules", () => {
  it("falls back to the defaults with an empty environment", () => {
    const rules = resolve({});

    for (const name of RULE_NAMES) {
      expect(rules[name]).toEqual(
        RATE_LIMIT_DEFAULTS[name],
      );
    }
  });

  it("applies an override — the regression this file exists for", () => {
    const rules = resolve({
      RATE_LIMIT_AUTH_SIGNIN_LIMIT: "3",
      RATE_LIMIT_AUTH_SIGNIN_WINDOW_SECONDS: "120",
    });

    expect(rules.authSignin.limit).toBe(3);
    expect(rules.authSignin.windowSeconds).toBe(120);
  });

  it("overrides one rule without disturbing the others", () => {
    const rules = resolve({
      RATE_LIMIT_CHAT_LIMIT: "1",
    });

    expect(rules.chat.limit).toBe(1);
    expect(rules.chat.windowSeconds).toBe(
      RATE_LIMIT_DEFAULTS.chat.windowSeconds,
    );
    expect(rules.authSignin).toEqual(
      RATE_LIMIT_DEFAULTS.authSignin,
    );
  });

  it("exposes an override for every rule, not just the auth ones", () => {
    const env: RateLimitEnv = {};

    RULE_NAMES.forEach((name, index) => {
      env[envKeysForRule(name).limit] = String(index + 1);
    });

    const rules = resolve(env);

    RULE_NAMES.forEach((name, index) => {
      expect(rules[name].limit).toBe(index + 1);
    });
  });

  it("never lets the environment change a Redis namespace", () => {
    const rules = resolve({
      RATE_LIMIT_CHAT_NAMESPACE: "somewhere-else",
    });

    expect(rules.chat.namespace).toBe(
      RATE_LIMIT_DEFAULTS.chat.namespace,
    );
  });

  describe("invalid values", () => {
    it.each([
      ["not a number", "abc"],
      ["zero", "0"],
      ["negative", "-5"],
      ["infinite", "Infinity"],
    ])("falls back and warns on %s", (_label, raw) => {
      const onWarn = vi.fn();

      const rules = resolveRateLimitRules({
        env: { RATE_LIMIT_AUTH_SIGNIN_LIMIT: raw },
        onWarn,
      });

      expect(rules.authSignin.limit).toBe(
        RATE_LIMIT_DEFAULTS.authSignin.limit,
      );
      expect(onWarn).toHaveBeenCalledTimes(1);
      expect(onWarn.mock.calls[0][0]).toContain(
        "RATE_LIMIT_AUTH_SIGNIN_LIMIT",
      );
    });

    it("treats unset and blank as 'use the default', silently", () => {
      const onWarn = vi.fn();

      const rules = resolveRateLimitRules({
        env: {
          RATE_LIMIT_AUTH_SIGNIN_LIMIT: "",
          RATE_LIMIT_CHAT_LIMIT: "   ",
        },
        onWarn,
      });

      expect(rules.authSignin.limit).toBe(
        RATE_LIMIT_DEFAULTS.authSignin.limit,
      );
      expect(rules.chat.limit).toBe(
        RATE_LIMIT_DEFAULTS.chat.limit,
      );
      expect(onWarn).not.toHaveBeenCalled();
    });

    it("rounds a fractional value down and says so", () => {
      const onWarn = vi.fn();

      const rules = resolveRateLimitRules({
        env: { RATE_LIMIT_CHAT_LIMIT: "7.9" },
        onWarn,
      });

      expect(rules.chat.limit).toBe(7);
      expect(onWarn).toHaveBeenCalledTimes(1);
    });
  });
});

describe("the enforced table", () => {
  it("covers every rule in the default table", () => {
    expect(Object.keys(RATE_LIMIT_RULES).sort()).toEqual(
      RULE_NAMES.slice().sort(),
    );
  });

  it("holds a usable policy for every rule", () => {
    for (const name of RULE_NAMES) {
      const rule = RATE_LIMIT_RULES[name];

      expect(rule.namespace).toMatch(/^[a-z0-9:_-]+$/);
      expect(Number.isInteger(rule.limit)).toBe(true);
      expect(rule.limit).toBeGreaterThan(0);
      expect(rule.windowSeconds).toBeGreaterThan(0);
    }
  });

  it("keeps the email-sending rules at least as tight as sign-in", () => {
    // Each of these sends mail to an address the caller supplied, so they
    // must never be looser than the plain credential-attempt limit.
    expect(
      RATE_LIMIT_DEFAULTS.authResendOtp.limit,
    ).toBeLessThanOrEqual(
      RATE_LIMIT_DEFAULTS.authSignin.limit,
    );
    expect(
      RATE_LIMIT_DEFAULTS.authForgotPassword.limit,
    ).toBeLessThanOrEqual(
      RATE_LIMIT_DEFAULTS.authSignin.limit,
    );
  });
});
