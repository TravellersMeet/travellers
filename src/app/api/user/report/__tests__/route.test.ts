import type { NextRequest } from "next/server";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit-rules";
import {
  MAX_REPORT_DETAILS_LENGTH,
  normalizeReportReason,
  REPORT_REASON_CODES,
} from "@/lib/report-reasons";
import { POST } from "../route";

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findFirst: vi.fn() },
    report: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/rate-limit-rules", () => ({
  enforceRateLimit: vi.fn(),
}));

const ALLOWED = {
  allowed: true,
  limit: 5,
  remaining: 4,
  resetAt: 0,
  retryAfter: 0,
  bypassed: false,
};

function reportRequest(body: unknown) {
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

function submit(body: Record<string, unknown>) {
  return POST(
    reportRequest({
      reportedId: "user-2",
      reason: "HARASSMENT",
      ...body,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1" },
  } as never);
  vi.mocked(enforceRateLimit).mockResolvedValue(ALLOWED);
  vi.mocked(prisma.user.findFirst).mockResolvedValue({
    id: "user-2",
  } as never);
  vi.mocked(prisma.report.findFirst).mockResolvedValue(
    null as never,
  );
  vi.mocked(prisma.report.create).mockResolvedValue({
    id: "report-1",
  } as never);
});

describe("POST /api/user/report", () => {
  it("rejects an unauthenticated caller", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await submit({});

    expect(response.status).toBe(401);
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("stores a report under its canonical code", async () => {
    const response = await submit({
      reason: "SPAM",
      details: "Posting ads in every thread",
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      success: true,
      reportId: "report-1",
    });
    expect(prisma.report.create).toHaveBeenCalledWith({
      data: {
        reporterId: "user-1",
        reportedId: "user-2",
        reason: "SPAM",
        details: "Posting ads in every thread",
      },
    });
  });

  it("refuses a self-report", async () => {
    const response = await submit({
      reportedId: "user-1",
    });

    expect(response.status).toBe(400);
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  describe("reason validation", () => {
    it.each(REPORT_REASON_CODES)(
      "accepts the %s code",
      async (code) => {
        const response = await submit({ reason: code });

        expect(response.status).toBe(201);
      },
    );

    it.each([
      ["Inappropriate behavior", "INAPPROPRIATE_CONTENT"],
      ["Spam or scams", "SPAM"],
      ["Fake profile", "IMPERSONATION"],
      ["Harassment", "HARASSMENT"],
      ["Other", "OTHER"],
    ])(
      "maps the legacy form value %s to %s",
      async (legacy, expected) => {
        // A client still running the previous bundle posts these display
        // strings. They must keep working through a deploy.
        await submit({ reason: legacy });

        expect(
          prisma.report.create,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              reason: expected,
            }),
          }),
        );
      },
    );

    it.each([
      ["free text", "he was rude to me"],
      ["empty", ""],
      ["whitespace", "   "],
      ["near miss", "harrassment"],
    ])("rejects %s", async (_label, reason) => {
      const response = await submit({ reason });

      expect(response.status).toBe(400);
      expect(
        prisma.report.create,
      ).not.toHaveBeenCalled();
    });
  });

  describe("payload bounds", () => {
    it("rejects details past the cap", async () => {
      const response = await submit({
        details: "a".repeat(
          MAX_REPORT_DETAILS_LENGTH + 1,
        ),
      });

      expect(response.status).toBe(400);
      expect(
        prisma.report.create,
      ).not.toHaveBeenCalled();
    });

    it("accepts details exactly at the cap", async () => {
      const response = await submit({
        details: "a".repeat(MAX_REPORT_DETAILS_LENGTH),
      });

      expect(response.status).toBe(201);
    });

    it("rejects a multi-megabyte details body", async () => {
      const response = await submit({
        details: "a".repeat(5_000_000),
      });

      expect(response.status).toBe(400);
    });

    it("rejects an oversized reportedId", async () => {
      const response = await submit({
        reportedId: "x".repeat(200),
      });

      expect(response.status).toBe(400);
    });

    it("stores null rather than an empty string for blank details", async () => {
      await submit({ details: "   " });

      expect(prisma.report.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            details: null,
          }),
        }),
      );
    });
  });

  describe("duplicates", () => {
    it("refuses a second report against the same user in the window", async () => {
      vi.mocked(
        prisma.report.findFirst,
      ).mockResolvedValue({
        id: "report-earlier",
      } as never);

      const response = await submit({});

      expect(response.status).toBe(409);
      expect(
        prisma.report.create,
      ).not.toHaveBeenCalled();
    });

    it("scopes the duplicate check to the reporter, target and window", async () => {
      await submit({});

      const where = vi.mocked(prisma.report.findFirst)
        .mock.calls[0][0]!.where as Record<
        string,
        unknown
      >;

      expect(where.reporterId).toBe("user-1");
      expect(where.reportedId).toBe("user-2");
      expect(where.createdAt).toMatchObject({
        gte: expect.any(Date),
      });
    });

    it("still allows reporting a different user", async () => {
      vi.mocked(
        prisma.report.findFirst,
      ).mockResolvedValue(null as never);

      const response = await submit({
        reportedId: "user-3",
      });

      expect(response.status).toBe(201);
    });
  });

  describe("target resolution", () => {
    it("does not confirm whether an unknown id exists", async () => {
      vi.mocked(
        prisma.user.findFirst,
      ).mockResolvedValue(null as never);

      const response = await submit({
        reportedId: "does-not-exist",
      });

      // Same status and shape as a real submission, so the endpoint stops
      // answering "is this a user id?".
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({
        success: true,
      });
      expect(
        prisma.report.create,
      ).not.toHaveBeenCalled();
    });

    it("excludes soft-deleted accounts from the lookup", async () => {
      await submit({});

      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "user-2",
            isDeleted: false,
          },
        }),
      );
    });
  });

  it("throttles the endpoint", async () => {
    vi.mocked(enforceRateLimit).mockResolvedValue({
      ...ALLOWED,
      allowed: false,
      remaining: 0,
      retryAfter: 120,
    });

    const response = await submit({});

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe(
      "120",
    );
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("reports rate-limit headers on success", async () => {
    const response = await submit({});

    expect(
      response.headers.get("X-RateLimit-Remaining"),
    ).toBe("4");
  });
});

describe("normalizeReportReason", () => {
  it("accepts a code in any casing, with whitespace", () => {
    expect(normalizeReportReason("  spam  ")).toBe(
      "SPAM",
    );
    expect(normalizeReportReason("Harassment")).toBe(
      "HARASSMENT",
    );
  });

  it("returns null rather than inventing a category", () => {
    expect(
      normalizeReportReason("something else entirely"),
    ).toBeNull();
    expect(normalizeReportReason("")).toBeNull();
  });
});
