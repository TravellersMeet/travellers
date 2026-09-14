import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { markNotificationAsRead } from "@/lib/notifications";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    notification: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

const ROW = { id: "n-1", userId: "user-1", read: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(
    prisma.notification.updateMany,
  ).mockResolvedValue({ count: 1 } as never);
  vi.mocked(
    prisma.notification.findFirst,
  ).mockResolvedValue(ROW as never);
});

describe("markNotificationAsRead", () => {
  it("returns the updated row", async () => {
    await expect(
      markNotificationAsRead("n-1", "user-1"),
    ).resolves.toEqual(ROW);
  });

  it("returns null when nothing matched", async () => {
    vi.mocked(
      prisma.notification.updateMany,
    ).mockResolvedValue({ count: 0 } as never);

    await expect(
      markNotificationAsRead("n-1", "user-1"),
    ).resolves.toBeNull();
  });

  it("scopes the write by id, owner and expiry together", async () => {
    const now = new Date("2026-01-01T00:00:00Z");

    await markNotificationAsRead("n-1", "user-1", now);

    expect(
      prisma.notification.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        id: "n-1",
        userId: "user-1",
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      data: { read: true },
    });
  });

  it("cannot mark another user's notification read", async () => {
    vi.mocked(
      prisma.notification.updateMany,
    ).mockResolvedValue({ count: 0 } as never);

    const result = await markNotificationAsRead(
      "n-1",
      "attacker",
    );

    expect(result).toBeNull();
    expect(
      prisma.notification.findFirst,
    ).not.toHaveBeenCalled();
  });

  it("accepts an injected clock so expiry is testable", async () => {
    const now = new Date("2030-06-01T12:00:00Z");

    await markNotificationAsRead("n-1", "user-1", now);

    const where = vi.mocked(
      prisma.notification.updateMany,
    ).mock.calls[0][0]!.where as Record<string, unknown>;

    expect(where.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gt: now } },
    ]);
  });
});
