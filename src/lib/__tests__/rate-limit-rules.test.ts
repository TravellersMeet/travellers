import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkRateLimit } from "@/lib/rate-limit";
import {
  enforceRateLimit,
  RATE_LIMIT_RULES,
} from "@/lib/rate-limit-rules";

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
