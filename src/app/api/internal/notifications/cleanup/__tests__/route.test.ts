import { NextRequest } from "next/server";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { POST } from "@/app/api/internal/notifications/cleanup/route";
import { cleanupExpiredNotifications } from "@/lib/notifications";

vi.mock("@/lib/notifications", async () => {
  const actual =
    await vi.importActual<
      typeof import("@/lib/notifications")
    >("@/lib/notifications");

  return {
    ...actual,
    cleanupExpiredNotifications: vi.fn(),
  };
});

function createRequest(
  secret?: string,
  limit?: string,
) {
  const url = new URL(
    "http://localhost/api/internal/notifications/cleanup",
  );

  if (limit !== undefined) {
    url.searchParams.set("limit", limit);
  }

  return new NextRequest(url, {
    method: "POST",
    headers: secret
      ? {
          "x-notification-cleanup-secret":
            secret,
        }
      : undefined,
  });
}

describe("notification cleanup route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NOTIFICATION_CLEANUP_SECRET =
      "cleanup-secret";
  });

  it("rejects invalid secrets", async () => {
    const response = await POST(
      createRequest("wrong-secret"),
    );

    expect(response.status).toBe(401);
    expect(
      cleanupExpiredNotifications,
    ).not.toHaveBeenCalled();
  });

  it("validates the requested batch size", async () => {
    const response = await POST(
      createRequest("cleanup-secret", "invalid"),
    );

    expect(response.status).toBe(400);
  });

  it("returns cleanup results without exposing the secret", async () => {
    vi.mocked(
      cleanupExpiredNotifications,
    ).mockResolvedValue({
      deletedCount: 25,
      hasMore: true,
      batchSize: 25,
    });

    const response = await POST(
      createRequest("cleanup-secret", "25"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      response.headers.get("Cache-Control"),
    ).toBe("no-store");
    expect(body).toMatchObject({
      deletedCount: 25,
      hasMore: true,
      batchSize: 25,
    });
    expect(JSON.stringify(body)).not.toContain(
      "cleanup-secret",
    );
  });

  it("returns a safe error when cleanup fails", async () => {
    vi.mocked(
      cleanupExpiredNotifications,
    ).mockRejectedValue(
      new Error("database unavailable"),
    );

    const response = await POST(
      createRequest("cleanup-secret"),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.message).toBe(
      "Unable to clean up expired notifications",
    );
    expect(JSON.stringify(body)).not.toContain(
      "database unavailable",
    );
  });
});
