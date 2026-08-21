import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { enforceRateLimitMock } = vi.hoisted(() => ({
  enforceRateLimitMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/email", () => ({
  sendPasswordResetEmail: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock("@/lib/rate-limit", () => ({
  applyRateLimitHeaders: vi.fn((response) => response),
  rateLimitExceededResponse: vi.fn((result) =>
    NextResponse.json(
      { error: "Too many requests", retryAfter: result.retryAfter },
      { status: 429 },
    ),
  ),
}));

vi.mock("@/lib/rate-limit-rules", () => ({
  enforceRateLimit: enforceRateLimitMock,
}));

import { POST } from "../forgot-password/route";
import prisma from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email";

const allowed = () => ({
  allowed: true,
  limit: 3,
  remaining: 2,
  resetAt: Date.now() + 900_000,
  retryAfter: 0,
  bypassed: false,
});

const createRequest = (body: unknown) =>
  ({
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? "application/json" : null,
    },
    json: async () => body,
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  enforceRateLimitMock.mockResolvedValue(allowed());
});

describe("POST /api/auth/forgot-password", () => {
  it("rejects an invalid email", async () => {
    const response = await POST(createRequest({ email: "not-an-email" }));
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("does not disclose whether an account exists", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const response = await POST(createRequest({ email: "unknown@example.com" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.message).toContain("If an account exists");
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("uses enforceRateLimit before processing the reset", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user123",
      email: "test@example.com",
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({ id: "user123" } as never);

    const response = await POST(createRequest({ email: "test@example.com" }));

    expect(response.status).toBe(200);
    expect(enforceRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      "authForgotPassword",
      "test@example.com",
    );
    expect(prisma.user.update).toHaveBeenCalled();
    expect(sendPasswordResetEmail).toHaveBeenCalled();
  });

  it("returns 429 when password reset is rate limited", async () => {
    enforceRateLimitMock.mockResolvedValue({
      ...allowed(),
      allowed: false,
      remaining: 0,
      retryAfter: 900,
    });

    const response = await POST(createRequest({ email: "test@example.com" }));
    expect(response.status).toBe(429);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
