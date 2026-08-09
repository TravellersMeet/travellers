import { describe, it, expect, beforeEach, vi } from "vitest";

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
  checkRateLimit: vi.fn(),
  applyRateLimitHeaders: vi.fn((response) => response),
  rateLimitExceededResponse: vi.fn(),
  getRateLimitIdentifier: vi.fn((req, email) => email || "127.0.0.1"),
}));

import { POST } from "../forgot-password/route";
import prisma from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email";
import { RATE_LIMIT_CONFIG } from "@/lib/rate-limit-config";

beforeEach(() => {
  vi.clearAllMocks();
  
  const { checkRateLimit } = require("@/lib/rate-limit");
  vi.mocked(checkRateLimit).mockResolvedValue({
    allowed: true,
    limit: RATE_LIMIT_CONFIG.auth.forgotPassword.limit,
    remaining: RATE_LIMIT_CONFIG.auth.forgotPassword.limit - 1,
    resetAt: Date.now() + RATE_LIMIT_CONFIG.auth.forgotPassword.windowSeconds * 1000,
    retryAfter: 0,
    bypassed: false,
  });
});

describe("POST /api/auth/forgot-password", () => {
  const createRequest = (bodyData: any) => {
    return {
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === "content-type") {
            return "application/json";
          }
          return null;
        },
      } as any,
      json: async () => bodyData,
    } as any;
  };

  it("returns 400 for invalid email", async () => {
    const req = createRequest({ email: "not-an-email" });
    const res = await POST(req as any);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Invalid email input");
  });

  it("returns generic success even if user not found (security)", async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue(null);

    const req = createRequest({ email: "unknown@example.com" });
    const res = await POST(req as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.message).toContain("If an account exists");
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("returns 200, updates user token, and sends email if user exists", async () => {
    const mockUser = {
      id: "user123",
      email: "test@example.com",
      name: "Test User",
    };
    ;(prisma.user.findUnique as any).mockResolvedValue(mockUser);
    ;(prisma.user.update as any).mockResolvedValue(mockUser);

    const req = createRequest({ email: "test@example.com" });
    const res = await POST(req as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: "test@example.com" } });
    expect(prisma.user.update).toHaveBeenCalled();
    expect(sendPasswordResetEmail).toHaveBeenCalled();
  });

  it("uses configured rate limits for password reset", async () => {
    const { checkRateLimit } = require("@/lib/rate-limit");
    
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      limit: RATE_LIMIT_CONFIG.auth.forgotPassword.limit,
      remaining: RATE_LIMIT_CONFIG.auth.forgotPassword.limit - 1,
      resetAt: Date.now() + RATE_LIMIT_CONFIG.auth.forgotPassword.windowSeconds * 1000,
      retryAfter: 0,
      bypassed: false,
    });

    const req = createRequest({ email: "test@example.com" });
    await POST(req as any);

    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "auth:forgot-password",
        limit: RATE_LIMIT_CONFIG.auth.forgotPassword.limit,
        windowSeconds: RATE_LIMIT_CONFIG.auth.forgotPassword.windowSeconds,
      })
    );
  });

  it("returns 429 when password reset rate limit is exceeded", async () => {
    const { checkRateLimit, rateLimitExceededResponse } = require("@/lib/rate-limit");
    
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      limit: RATE_LIMIT_CONFIG.auth.forgotPassword.limit,
      remaining: 0,
      resetAt: Date.now() + RATE_LIMIT_CONFIG.auth.forgotPassword.windowSeconds * 1000,
      retryAfter: RATE_LIMIT_CONFIG.auth.forgotPassword.windowSeconds,
      bypassed: false,
    });

    vi.mocked(rateLimitExceededResponse).mockReturnValue({
      status: 429,
      json: async () => ({ error: "Too many requests", retryAfter: RATE_LIMIT_CONFIG.auth.forgotPassword.windowSeconds }),
    });

    const req = createRequest({ email: "test@example.com" });
    const res = await POST(req as any);

    expect(res.status).toBe(429);
  });
});
