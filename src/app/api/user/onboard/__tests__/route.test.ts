import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit-rules";
import { POST } from "../route";

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
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

function onboardRequest(body: unknown) {
  return new NextRequest("http://localhost/api/user/onboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function allowRateLimit(remaining = 9) {
  vi.mocked(enforceRateLimit).mockResolvedValue({
    allowed: true,
    limit: 10,
    remaining,
    resetAt: 1_700_000_000,
    retryAfter: 0,
  } as never);
}

function updateData() {
  return vi.mocked(prisma.user.update).mock.calls[0][0].data;
}

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1" },
  } as never);

  allowRateLimit();

  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    isDeleted: false,
  } as never);

  vi.mocked(prisma.user.update).mockResolvedValue({
    id: "user-1",
    name: "Asha Menon",
    onboarded: true,
  } as never);
});

describe("POST /api/user/onboard", () => {
  it("rejects an unauthenticated request", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await POST(
      onboardRequest({ name: "Asha Menon" }),
    );

    expect(response.status).toBe(401);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("marks the account onboarded and persists the payload", async () => {
    const response = await POST(
      onboardRequest({
        name: "Asha Menon",
        languages: ["Malayalam", "English"],
        age: 29,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
    });

    expect(updateData()).toMatchObject({
      onboarded: true,
      name: "Asha Menon",
      languages: ["Malayalam", "English"],
      age: 29,
    });
  });

  it("only writes the fields the client sent", async () => {
    await POST(onboardRequest({ bio: "Trains, mostly." }));

    expect(updateData()).toEqual({
      onboarded: true,
      bio: "Trains, mostly.",
    });
  });

  it("still completes onboarding for an empty payload", async () => {
    const response = await POST(onboardRequest({}));

    expect(response.status).toBe(200);
    expect(updateData()).toEqual({ onboarded: true });
  });

  describe("validation", () => {
    it("rejects a blank name rather than clearing the column", async () => {
      const response = await POST(
        onboardRequest({ name: "   " }),
      );

      expect(response.status).toBe(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("rejects a malformed array with 400, not an opaque 500", async () => {
      const response = await POST(
        onboardRequest({ languages: "hindi" }),
      );

      expect(response.status).toBe(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("rejects non-string array entries", async () => {
      const response = await POST(
        onboardRequest({ travelInterests: [1, 2, 3] }),
      );

      expect(response.status).toBe(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("refuses to coerce a partially numeric age", async () => {
      const response = await POST(
        onboardRequest({ age: "42-not-a-number" }),
      );

      expect(response.status).toBe(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("rejects an implausible age", async () => {
      const response = await POST(
        onboardRequest({ age: 999 }),
      );

      expect(response.status).toBe(400);
    });

    it("rejects an oversized bio", async () => {
      const response = await POST(
        onboardRequest({ bio: "x".repeat(5_000) }),
      );

      expect(response.status).toBe(400);
    });

    it("rejects a javascript: social link", async () => {
      const response = await POST(
        onboardRequest({
          socialLinks: ["javascript:alert(1)"],
        }),
      );

      expect(response.status).toBe(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("rejects an attempt to set the role", async () => {
      const response = await POST(
        onboardRequest({ name: "Asha Menon", role: "ADMIN" }),
      );

      expect(response.status).toBe(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("returns 400 for a malformed body instead of a fake success", async () => {
      const response = await POST(
        new NextRequest(
          "http://localhost/api/user/onboard",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{not json",
          },
        ),
      );

      expect(response.status).toBe(400);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe("soft-deleted accounts", () => {
    it("returns 404 when the account has been deleted", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        isDeleted: true,
      } as never);

      const response = await POST(
        onboardRequest({ name: "Asha Menon" }),
      );

      expect(response.status).toBe(404);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("returns 404 when the row no longer exists", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(
        null as never,
      );

      const response = await POST(
        onboardRequest({ name: "Asha Menon" }),
      );

      expect(response.status).toBe(404);
    });
  });

  describe("rate limiting", () => {
    it("throttles repeated submissions", async () => {
      vi.mocked(enforceRateLimit).mockResolvedValue({
        allowed: false,
        limit: 10,
        remaining: 0,
        resetAt: 1_700_000_000,
        retryAfter: 42,
      } as never);

      const response = await POST(
        onboardRequest({ name: "Asha Menon" }),
      );

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("42");
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("keys the limit on the signed-in user", async () => {
      await POST(onboardRequest({ name: "Asha Menon" }));

      expect(enforceRateLimit).toHaveBeenCalledWith(
        expect.anything(),
        "userOnboard",
        "user-1",
      );
    });

    it("exposes the remaining budget on a successful write", async () => {
      allowRateLimit(7);

      const response = await POST(
        onboardRequest({ name: "Asha Menon" }),
      );

      expect(
        response.headers.get("X-RateLimit-Remaining"),
      ).toBe("7");
    });
  });

  it("returns 500 when the update itself fails", async () => {
    vi.mocked(prisma.user.update).mockRejectedValue(
      new Error("db down") as never,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(
      onboardRequest({ name: "Asha Menon" }),
    );

    expect(response.status).toBe(500);
  });
});
