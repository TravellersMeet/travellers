import { NextRequest } from "next/server";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { PATCH } from "../route";
import { PATCH as READ_PATCH } from "../read/route";

vi.mock("@/lib/prisma", () => ({
  default: {
    notification: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

function request() {
  return new NextRequest(
    "http://localhost/api/notifications/n-1",
  );
}

const params = { params: { id: "n-1" } };

const ROW = {
  id: "n-1",
  userId: "user-1",
  read: true,
  title: "Connection accepted",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1" },
  } as never);
  vi.mocked(
    prisma.notification.updateMany,
  ).mockResolvedValue({ count: 1 } as never);
  vi.mocked(
    prisma.notification.findFirst,
  ).mockResolvedValue(ROW as never);
});

describe("PATCH /api/notifications/[id]", () => {
  it("returns 401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await PATCH(request(), params);

    expect(response.status).toBe(401);
    expect(
      prisma.notification.updateMany,
    ).not.toHaveBeenCalled();
  });

  it("marks the notification read and returns it", async () => {
    const response = await PATCH(request(), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      success: true,
      notification: ROW,
    });
  });

  it("scopes the write itself to the caller, not just a prior check", async () => {
    await PATCH(request(), params);

    const call = vi.mocked(
      prisma.notification.updateMany,
    ).mock.calls[0][0]!;
    const where = call.where as Record<string, unknown>;

    // The previous implementation checked ownership in a findFirst and then
    // wrote with `where: { id }` alone — safe only because of the sequencing.
    expect(where.id).toBe("n-1");
    expect(where.userId).toBe("user-1");
    expect(call.data).toEqual({ read: true });
  });

  it("does not mutate an expired notification", async () => {
    await PATCH(request(), params);

    const where = vi.mocked(
      prisma.notification.updateMany,
    ).mock.calls[0][0]!.where as Record<string, unknown>;

    // Matches the filter listNotifications reads through, so the write and
    // the read agree about which rows exist.
    expect(where.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gt: expect.any(Date) } },
    ]);
  });

  it("returns 404 for a foreign, missing or expired id", async () => {
    vi.mocked(
      prisma.notification.updateMany,
    ).mockResolvedValue({ count: 0 } as never);

    const response = await PATCH(request(), params);

    expect(response.status).toBe(404);
    // No second query: a zero count is the answer.
    expect(
      prisma.notification.findFirst,
    ).not.toHaveBeenCalled();
  });

  it("does not 500 when the row is deleted concurrently", async () => {
    // DELETE /api/notifications and the expiry sweeper both remove rows while
    // this runs. The old findFirst-then-update pair threw P2025 here and
    // surfaced it as "500 Failed to update notification".
    vi.mocked(
      prisma.notification.updateMany,
    ).mockResolvedValue({ count: 0 } as never);

    const response = await PATCH(request(), params);

    expect(response.status).toBe(404);
  });

  it("returns 500 if the database itself fails", async () => {
    vi.mocked(
      prisma.notification.updateMany,
    ).mockRejectedValue(new Error("connection lost"));

    const response = await PATCH(request(), params);

    expect(response.status).toBe(500);
  });
});

describe("PATCH /api/notifications/[id]/read", () => {
  it("is the same handler, not a second copy", () => {
    expect(READ_PATCH).toBe(PATCH);
  });

  it("still answers on the legacy path", async () => {
    const response = await READ_PATCH(request(), params);

    expect(response.status).toBe(200);
    const body = await response.json();

    // `success` was this route's original shape and is retained; `ok` is the
    // other route's. Both are present so either client keeps working.
    expect(body.success).toBe(true);
    expect(body.ok).toBe(true);
  });
});
