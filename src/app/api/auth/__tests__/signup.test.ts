import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { hashMock } = vi.hoisted(() => ({
  hashMock: vi.fn(),
}));

vi.mock("bcryptjs", () => ({
  hash: hashMock,
}));

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
  isValidOTPFormat: vi.fn(() => true),
}));

vi.mock("@/lib/email", () => ({
  sendOTPEmail: vi.fn(() =>
    Promise.resolve({
      success: true,
    }),
  ),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  applyRateLimitHeaders: vi.fn((response) => response),
  rateLimitExceededResponse: vi.fn(),
  getRateLimitIdentifier: vi.fn((req, email) => email || "127.0.0.1"),
}));

import prisma from "@/lib/prisma";
import { POST } from "../signup/route";
import { RATE_LIMIT_CONFIG } from "@/lib/rate-limit-config";
// Import the mocked module as a namespace instead of rateLimit,
// which vitest can't resolve at runtime (the @ alias is transform-time only).
import * as rateLimit from "@/lib/rate-limit";

const createRequest = (
  data: Record<string, string>,
): NextRequest =>
  new NextRequest(
    "http://localhost:3000/api/auth/signup",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(data),
    },
  );

describe("POST /api/auth/signup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();

    hashMock.mockResolvedValue("mock-password-hash");
    
    const { checkRateLimit } = rateLimit;
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      limit: RATE_LIMIT_CONFIG.auth.signup.limit,
      remaining: RATE_LIMIT_CONFIG.auth.signup.limit - 1,
      resetAt: Date.now() + RATE_LIMIT_CONFIG.auth.signup.windowSeconds * 1000,
      retryAfter: 0,
      bypassed: false,
    });
  });

  it("returns 400 for missing name", async () => {
    const request = createRequest({
      email: "test@example.com",
      password: "password123",
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid input");

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(hashMock).not.toHaveBeenCalled();
  });

  it("returns 400 if email already exists", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "existing-user",
      name: "Existing User",
      email: "test@example.com",
    } as never);

    const request = createRequest({
      name: "Test User",
      email: "test@example.com",
      password: "password123",
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Email already in use");

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: {
        email: "test@example.com",
      },
    });

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(hashMock).not.toHaveBeenCalled();
  });

  it("returns 200 and creates an unverified user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test User",
      passwordHash: "mock-password-hash",
      otp: "123456",
      otpExpires: new Date(),
    } as never);

    const request = createRequest({
      name: "Test User",
      email: "test@example.com",
      password: "password123",
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.userId).toBe("user-1");
    expect(data.message).toBe("OTP sent to your email");

    expect(hashMock).toHaveBeenCalledWith(
      "password123",
      10,
    );

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Test User",
        email: "test@example.com",
        passwordHash: "mock-password-hash",
        otp: "123456",
        otpExpires: expect.any(Date),
      }),
    });
  });

  it("uses 12 saltRounds in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "user-2",
      email: "prod@example.com",
      name: "Prod User",
      passwordHash: "mock-password-hash",
      otp: "123456",
      otpExpires: new Date(),
    } as never);

    const request = createRequest({
      name: "Prod User",
      email: "prod@example.com",
      password: "password123",
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);

    expect(hashMock).toHaveBeenCalledWith(
      "password123",
      12,
    );
  });

  it("uses configured rate limits from environment", async () => {
    const { checkRateLimit } = rateLimit;
    
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      limit: RATE_LIMIT_CONFIG.auth.signup.limit,
      remaining: RATE_LIMIT_CONFIG.auth.signup.limit - 1,
      resetAt: Date.now() + RATE_LIMIT_CONFIG.auth.signup.windowSeconds * 1000,
      retryAfter: 0,
      bypassed: false,
    });

    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test User",
      passwordHash: "mock-password-hash",
      otp: "123456",
      otpExpires: new Date(),
    } as never);

    const request = createRequest({
      name: "Test User",
      email: "test@example.com",
      password: "password123",
    });

    const response = await POST(request);

    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "auth:signup",
        limit: RATE_LIMIT_CONFIG.auth.signup.limit,
        windowSeconds: RATE_LIMIT_CONFIG.auth.signup.windowSeconds,
      })
    );
  });

  it("returns 429 when rate limit is exceeded", async () => {
    const { checkRateLimit, rateLimitExceededResponse } = rateLimit;
    
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      limit: RATE_LIMIT_CONFIG.auth.signup.limit,
      remaining: 0,
      resetAt: Date.now() + RATE_LIMIT_CONFIG.auth.signup.windowSeconds * 1000,
      retryAfter: RATE_LIMIT_CONFIG.auth.signup.windowSeconds,
      bypassed: false,
    });

    vi.mocked(rateLimitExceededResponse).mockReturnValue(
      NextResponse.json(
        { error: "Too many requests", retryAfter: RATE_LIMIT_CONFIG.auth.signup.windowSeconds },
        { status: 429 },
      ),
    );

    const request = createRequest({
      name: "Test User",
      email: "test@example.com",
      password: "password123",
    });

    const response = await POST(request);

    expect(response.status).toBe(429);
  });
});
