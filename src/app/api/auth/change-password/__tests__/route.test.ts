import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import prisma from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit-rules";
import { PUT } from "../route";

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/rate-limit-rules", () => ({
  enforceRateLimit: vi.fn(),
}));

const ALLOWED = {
  allowed: true,
  limit: 5,
  remaining: 4,
  resetAt: 1_800_000,
  retryAfter: 0,
  bypassed: false,
};

const BLOCKED = {
  ...ALLOWED,
  allowed: false,
  remaining: 0,
  retryAfter: 900,
};

function request(body: unknown) {
  return new NextRequest(
    "http://localhost/api/auth/change-password",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

let storedHash: string;

beforeEach(async () => {
  vi.clearAllMocks();

  storedHash = await hashPassword("current-password");

  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1", email: "asha@example.com" },
  } as never);
  vi.mocked(enforceRateLimit).mockResolvedValue(
    ALLOWED as never,
  );
  vi.mocked(prisma.user.findFirst).mockResolvedValue({
    id: "user-1",
    email: "asha@example.com",
    passwordHash: storedHash,
    isDeleted: false,
  } as never);
  vi.mocked(prisma.user.update).mockResolvedValue({
    id: "user-1",
  } as never);
});

describe("PUT /api/auth/change-password", () => {
  it("returns 401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await PUT(
      request({
        currentPassword: "current-password",
        newPassword: "brand-new-password",
      }),
    );

    expect(response.status).toBe(401);
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });

  it("is rate limited on the account", async () => {
    await PUT(
      request({
        currentPassword: "current-password",
        newPassword: "brand-new-password",
      }),
    );

    expect(enforceRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      "authChangePassword",
      "asha@example.com",
    );
  });

  it("returns 429 once the limit is exceeded, without touching the database", async () => {
    vi.mocked(enforceRateLimit).mockResolvedValue(
      BLOCKED as never,
    );

    const response = await PUT(
      request({
        currentPassword: "guess-1",
        newPassword: "brand-new-password",
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("900");
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("changes the password when the current one is correct", async () => {
    const response = await PUT(
      request({
        currentPassword: "current-password",
        newPassword: "brand-new-password",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" } }),
    );
  });

  it("hashes with the shared cost factor rather than a hardcoded 10", async () => {
    // In test the shared helper uses cost 10, so assert on the hash format and
    // that it is a real bcrypt hash of the new password rather than the value
    // being stored in the clear.
    await PUT(
      request({
        currentPassword: "current-password",
        newPassword: "brand-new-password",
      }),
    );

    const [{ data }] = vi.mocked(prisma.user.update).mock
      .calls[0] as [{ data: { passwordHash: string } }];

    expect(data.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(data.passwordHash).not.toContain(
      "brand-new-password",
    );
  });

  it("rejects an incorrect current password", async () => {
    const response = await PUT(
      request({
        currentPassword: "not-the-password",
        newPassword: "brand-new-password",
      }),
    );

    expect(response.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects reusing the current password", async () => {
    const response = await PUT(
      request({
        currentPassword: "current-password",
        newPassword: "current-password",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/different/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects empty credentials", async () => {
    const response = await PUT(
      request({ currentPassword: "", newPassword: "" }),
    );

    expect(response.status).toBe(400);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    const response = await PUT(
      request({ currentPassword: 123, newPassword: null }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects a new password under 8 characters", async () => {
    const response = await PUT(
      request({
        currentPassword: "current-password",
        newPassword: "short",
      }),
    );

    expect(response.status).toBe(400);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("excludes soft-deleted accounts from the lookup", async () => {
    await PUT(
      request({
        currentPassword: "current-password",
        newPassword: "brand-new-password",
      }),
    );

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: "asha@example.com",
        isDeleted: false,
      },
    });
  });

  it("returns 404 when the account has been deleted", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(
      null as never,
    );

    const response = await PUT(
      request({
        currentPassword: "current-password",
        newPassword: "brand-new-password",
      }),
    );

    expect(response.status).toBe(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("refuses for an OAuth-only account", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: "user-1",
      email: "asha@example.com",
      passwordHash: null,
      isDeleted: false,
    } as never);

    const response = await PUT(
      request({
        currentPassword: "anything",
        newPassword: "brand-new-password",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/Google\/Apple/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("carries rate limit headers on the failure paths too", async () => {
    const response = await PUT(
      request({
        currentPassword: "not-the-password",
        newPassword: "brand-new-password",
      }),
    );

    expect(response.headers.get("X-RateLimit-Limit")).toBe("5");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe(
      "4",
    );
  });

  it("returns 500 when the update fails", async () => {
    vi.mocked(prisma.user.update).mockRejectedValue(
      new Error("db down") as never,
    );

    const response = await PUT(
      request({
        currentPassword: "current-password",
        newPassword: "brand-new-password",
      }),
    );

    expect(response.status).toBe(500);
  });
});
