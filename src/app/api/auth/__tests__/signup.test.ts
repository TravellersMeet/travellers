import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { hashMock, enforceRateLimitMock } = vi.hoisted(() => ({
  hashMock: vi.fn(),
  enforceRateLimitMock: vi.fn(),
}));

vi.mock("bcryptjs", () => ({ hash: hashMock }));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/otp", () => ({
  generateOTP: vi.fn(() => "123456"),
  hashOTP: vi.fn((otp) => otp),
}));

vi.mock("@/lib/email", () => ({
  sendOTPEmail: vi.fn(() => Promise.resolve({ success: true })),
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

import prisma from "@/lib/prisma";
import { POST } from "../signup/route";

const allowed = () => ({
  allowed: true,
  limit: 5,
  remaining: 4,
  resetAt: Date.now() + 3600_000,
  retryAfter: 0,
  bypassed: false,
});

const createRequest = (data: Record<string, string>) =>
  new NextRequest("http://localhost:3000/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });

describe("POST /api/auth/signup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hashMock.mockResolvedValue("mock-password-hash");
    enforceRateLimitMock.mockResolvedValue(allowed());
  });

  it("returns 400 for missing name", async () => {
    const response = await POST(
      createRequest({ email: "test@example.com", password: "password123" }),
    );
    expect(response.status).toBe(400);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an existing email", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "existing" } as never);
    const response = await POST(
      createRequest({
        name: "Test User",
        email: "test@example.com",
        password: "password123",
      }),
    );
    expect(response.status).toBe(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("uses enforceRateLimit and creates an unverified user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test User",
    } as never);

    const response = await POST(
      createRequest({
        name: "Test User",
        email: "test@example.com",
        password: "password123",
      }),
    );

    expect(response.status).toBe(200);
    expect(enforceRateLimitMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      "authSignup",
      "test@example.com",
    );
    expect(hashMock).toHaveBeenCalledWith("password123", 10);
  });

  it("uses 12 salt rounds in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({ id: "user-2" } as never);

    const response = await POST(
      createRequest({
        name: "Prod User",
        email: "prod@example.com",
        password: "password123",
      }),
    );

    expect(response.status).toBe(200);
    expect(hashMock).toHaveBeenCalledWith("password123", 12);
  });

  it("returns 429 when the auth signup limit is exceeded", async () => {
    enforceRateLimitMock.mockResolvedValue({
      ...allowed(),
      allowed: false,
      remaining: 0,
      retryAfter: 3600,
    });

    const response = await POST(
      createRequest({
        name: "Test User",
        email: "test@example.com",
        password: "password123",
      }),
    );

    expect(response.status).toBe(429);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
