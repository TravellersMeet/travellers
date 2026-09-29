import type { NextRequest } from "next/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { sendOTPEmail } from "@/lib/email";
import {
  canResendOTP,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  otpIssuedAt,
} from "@/lib/otp";
import prisma from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit-rules";
import { POST as resendPOST } from "../resend-otp/route";
import { POST as verifyPOST } from "../verify-otp/route";

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/email", () => ({
  sendOTPEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/rate-limit-rules", () => ({
  enforceRateLimit: vi.fn(),
}));

const ALLOWED = {
  allowed: true,
  limit: 3,
  remaining: 2,
  resetAt: 0,
  retryAfter: 0,
  bypassed: false,
};

function jsonRequest(body: unknown) {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type"
          ? "application/json"
          : null,
    },
    json: async () => body,
  } as unknown as NextRequest;
}

/** An OTP issued long enough ago that the resend cooldown has elapsed. */
function staleOtpExpiry() {
  return new Date(
    Date.now() +
      OTP_TTL_MS -
      OTP_RESEND_COOLDOWN_MS * 5,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(enforceRateLimit).mockResolvedValue(ALLOWED);
  vi.mocked(prisma.user.update).mockResolvedValue(
    {} as never,
  );
});

describe("POST /api/auth/resend-otp", () => {
  async function resend(email = "user@example.com") {
    const response = await resendPOST(
      jsonRequest({ email }),
    );
    return {
      status: response.status,
      body: await response.json(),
    };
  }

  it("answers identically for an unknown address, a verified one and an unverified one", async () => {
    const outcomes = [];

    vi.mocked(prisma.user.findUnique).mockResolvedValue(
      null as never,
    );
    outcomes.push(await resend());

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      emailVerified: true,
      otpExpires: null,
    } as never);
    outcomes.push(await resend());

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      emailVerified: false,
      otpExpires: null,
    } as never);
    outcomes.push(await resend());

    // This is the whole bug: these three used to be 404, 400 and 200.
    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(outcomes[1]).toEqual(outcomes[2]);
    expect(outcomes[0].status).toBe(200);
  });

  it("sends a code only for a real unverified account", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      emailVerified: false,
      otpExpires: null,
    } as never);

    await resend();

    expect(sendOTPEmail).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it.each([
    ["an unknown address", null],
    [
      "a verified account",
      { emailVerified: true, otpExpires: null },
    ],
  ])("sends nothing for %s", async (_label, user) => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(
      user as never,
    );

    await resend();

    expect(sendOTPEmail).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  describe("mailbox cooldown", () => {
    it("refuses a second send inside the cooldown", async () => {
      vi.mocked(
        prisma.user.findUnique,
      ).mockResolvedValue({
        emailVerified: false,
        // Issued just now.
        otpExpires: new Date(Date.now() + OTP_TTL_MS),
      } as never);

      const { status } = await resend();

      expect(status).toBe(200);
      expect(sendOTPEmail).not.toHaveBeenCalled();
      // The stored code is left intact, so a victim mid-signup does not have
      // the code in their inbox invalidated by an attacker's request.
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("allows a send once the cooldown has elapsed", async () => {
      vi.mocked(
        prisma.user.findUnique,
      ).mockResolvedValue({
        emailVerified: false,
        otpExpires: staleOtpExpiry(),
      } as never);

      await resend();

      expect(sendOTPEmail).toHaveBeenCalledTimes(1);
    });

    it("holds even when the request limiter has failed open", async () => {
      // checkRateLimit returns bypassed: true when Redis is unreachable, so
      // the cooldown must not depend on it.
      vi.mocked(enforceRateLimit).mockResolvedValue({
        ...ALLOWED,
        bypassed: true,
      });
      vi.mocked(
        prisma.user.findUnique,
      ).mockResolvedValue({
        emailVerified: false,
        otpExpires: new Date(Date.now() + OTP_TTL_MS),
      } as never);

      await resend();

      expect(sendOTPEmail).not.toHaveBeenCalled();
    });
  });

  it("keeps the response generic when delivery fails", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      emailVerified: false,
      otpExpires: null,
    } as never);
    vi.mocked(sendOTPEmail).mockRejectedValue(
      new Error("smtp down"),
    );

    const { status, body } = await resend();

    // A delivery error for a real address would otherwise re-open the oracle.
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("still honours the request rate limit", async () => {
    vi.mocked(enforceRateLimit).mockResolvedValue({
      ...ALLOWED,
      allowed: false,
      remaining: 0,
      retryAfter: 300,
    });

    const { status } = await resend();

    expect(status).toBe(429);
    expect(sendOTPEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/verify-otp", () => {
  async function verify(
    otp = "123456",
    email = "user@example.com",
  ) {
    const response = await verifyPOST(
      jsonRequest({ email, otp }),
    );
    return {
      status: response.status,
      body: await response.json(),
    };
  }

  it.each([
    ["an unknown address", null],
    [
      "an account with no outstanding code",
      { emailVerified: false, otp: null, otpExpires: null },
    ],
    [
      "an expired code",
      {
        emailVerified: false,
        otp: "hash",
        otpExpires: new Date(Date.now() - 1000),
      },
    ],
    [
      "an already-verified account",
      { emailVerified: true, otp: null, otpExpires: null },
    ],
  ])(
    "gives one indistinguishable failure for %s",
    async (_label, user) => {
      vi.mocked(
        prisma.user.findUnique,
      ).mockResolvedValue(user as never);

      const { status, body } = await verify();

      expect(status).toBe(400);
      expect(body.error).toBe(
        "Invalid or expired code. Please request a new one.",
      );
    },
  );

  it("rejects a malformed code without touching the database", async () => {
    const { status } = await verify("abc");

    expect(status).toBe(400);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("caps attempts per account regardless of source IP", async () => {
    vi.mocked(enforceRateLimit).mockImplementation(
      async (_req, rule) =>
        rule === "authVerifyOtpAccount"
          ? {
              ...ALLOWED,
              allowed: false,
              remaining: 0,
              retryAfter: 600,
            }
          : ALLOWED,
    );

    const { status } = await verify();

    expect(status).toBe(429);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(enforceRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      "authVerifyOtpAccount",
      "user@example.com",
      { scope: "subject" },
    );
  });

  it("verifies the account on a correct code", async () => {
    const { hashOTP } = await vi.importActual<
      typeof import("@/lib/otp")
    >("@/lib/otp");

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      emailVerified: false,
      otp: hashOTP("123456"),
      otpExpires: new Date(Date.now() + OTP_TTL_MS),
    } as never);

    const { status, body } = await verify("123456");

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { email: "user@example.com" },
      data: {
        emailVerified: true,
        otp: null,
        otpExpires: null,
      },
    });
  });

  it("rejects a wrong code against a live one", async () => {
    const { hashOTP } = await vi.importActual<
      typeof import("@/lib/otp")
    >("@/lib/otp");

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      emailVerified: false,
      otp: hashOTP("999999"),
      otpExpires: new Date(Date.now() + OTP_TTL_MS),
    } as never);

    const { status } = await verify("123456");

    expect(status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe("OTP resend helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("recovers the issue time from the expiry", () => {
    const expires = new Date("2026-01-01T12:10:00Z");

    expect(otpIssuedAt(expires)?.toISOString()).toBe(
      "2026-01-01T12:00:00.000Z",
    );
  });

  it("treats a missing expiry as 'nothing outstanding'", () => {
    expect(otpIssuedAt(null)).toBeNull();
    expect(canResendOTP(null)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("reports the remaining wait in whole seconds", () => {
    const now = new Date("2026-01-01T12:00:30Z");
    // Issued at 12:00:00, so 30s of a 60s cooldown remain.
    const expires = new Date("2026-01-01T12:10:00Z");

    expect(canResendOTP(expires, now)).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
  });

  it("allows a resend exactly on the cooldown boundary", () => {
    const expires = new Date("2026-01-01T12:10:00Z");
    const now = new Date(
      expires.getTime() -
        OTP_TTL_MS +
        OTP_RESEND_COOLDOWN_MS,
    );

    expect(canResendOTP(expires, now).allowed).toBe(true);
  });

  it("does not let a future issue time unlock a resend", () => {
    // Clock skew or a hand-edited row.
    const expires = new Date(
      Date.now() + OTP_TTL_MS + 60 * 60 * 1000,
    );

    expect(canResendOTP(expires).allowed).toBe(false);
  });
});
