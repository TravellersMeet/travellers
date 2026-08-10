import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  activeNotificationWhere,
  deleteNotification,
  deleteNotificationsForUser,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsAsRead,
} from "@/lib/notifications";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    notification: {
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

const NOW = new Date("2026-08-10T12:00:00.000Z");

describe("activeNotificationWhere", () => {
  it("matches rows with no expiry and rows expiring in the future", () => {
    expect(activeNotificationWhere(NOW)).toEqual({
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: NOW } },
      ],
    });
  });

  it("uses a strict comparison so a row expiring exactly now is excluded", () => {
    // cleanupExpiredNotifications deletes with `lte: now`. Using `gt` here
    // means the two rules partition the table rather than overlapping — a row
    // is either sweepable or visible, never both and never neither.
    const where = activeNotificationWhere(NOW);
    const expiryClause = where.OR[1] as {
      expiresAt: { gt: Date };
    };

    expect(expiryClause.expiresAt).toHaveProperty("gt");
    expect(expiryClause.expiresAt).not.toHaveProperty("gte");
  });
});

describe("listNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.notification.findMany).mockResolvedValue(
      [] as never,
    );
  });

  it("takes one row beyond the page size so hasMore can be computed", async () => {
    await listNotifications({
      userId: "user-1",
      limit: 20,
      now: NOW,
    });

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 21 }),
    );
  });

  it("orders newest first with a stable id tiebreaker", async () => {
    await listNotifications({
      userId: "user-1",
      limit: 5,
      now: NOW,
    });

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
  });

  it("always filters out expired rows", async () => {
    await listNotifications({
      userId: "user-1",
      limit: 5,
      now: NOW,
    });

    const [{ where }] = vi.mocked(
      prisma.notification.findMany,
    ).mock.calls[0] as [{ where: any }];

    expect(where.userId).toBe("user-1");
    expect(where.AND).toContainEqual(
      activeNotificationWhere(NOW),
    );
  });

  it("nests the cursor filter alongside the expiry filter", async () => {
    const cursorWhere = {
      OR: [
        { createdAt: { lt: NOW } },
        { createdAt: NOW, id: { lt: "n-9" } },
      ],
    };

    await listNotifications({
      userId: "user-1",
      limit: 5,
      cursorWhere,
      now: NOW,
    });

    const [{ where }] = vi.mocked(
      prisma.notification.findMany,
    ).mock.calls[0] as [{ where: any }];

    // Both are OR groups. Spreading them into one object would make the
    // second silently replace the first, so they live under AND.
    expect(where.AND).toHaveLength(2);
    expect(where.AND[1]).toEqual(cursorWhere);
  });

  it("omits the read filter unless unreadOnly is set", async () => {
    await listNotifications({
      userId: "user-1",
      limit: 5,
      now: NOW,
    });

    const [{ where }] = vi.mocked(
      prisma.notification.findMany,
    ).mock.calls[0] as [{ where: any }];

    expect(where).not.toHaveProperty("read");
  });

  it("filters to unread when asked", async () => {
    await listNotifications({
      userId: "user-1",
      limit: 5,
      unreadOnly: true,
      now: NOW,
    });

    const [{ where }] = vi.mocked(
      prisma.notification.findMany,
    ).mock.calls[0] as [{ where: any }];

    expect(where.read).toBe(false);
  });
});

describe("getUnreadNotificationCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.notification.count).mockResolvedValue(
      7 as never,
    );
  });

  it("does not count expired notifications", async () => {
    const count = await getUnreadNotificationCount(
      "user-1",
      NOW,
    );

    expect(count).toBe(7);
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        read: false,
        ...activeNotificationWhere(NOW),
      },
    });
  });
});

describe("markAllNotificationsAsRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({
      count: 2,
    } as never);
  });

  it("only touches the caller's unread rows", async () => {
    await markAllNotificationsAsRead("user-1");

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", read: false },
      data: { read: true },
    });
  });
});

describe("deleteNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes the delete to the owner and reports the row count", async () => {
    vi.mocked(prisma.notification.deleteMany).mockResolvedValue({
      count: 1,
    } as never);

    const deleted = await deleteNotification("n-1", "user-1");

    expect(deleted).toBe(1);
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: "n-1", userId: "user-1" },
    });
  });

  it("reports 0 rather than throwing for a foreign id", async () => {
    vi.mocked(prisma.notification.deleteMany).mockResolvedValue({
      count: 0,
    } as never);

    await expect(
      deleteNotification("someone-elses", "user-1"),
    ).resolves.toBe(0);
  });
});

describe("deleteNotificationsForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.notification.deleteMany).mockResolvedValue({
      count: 4,
    } as never);
  });

  it("defaults to clearing only the read ones", async () => {
    const deleted =
      await deleteNotificationsForUser("user-1");

    expect(deleted).toBe(4);
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", read: true },
    });
  });

  it("clears everything when onlyRead is false", async () => {
    await deleteNotificationsForUser("user-1", {
      onlyRead: false,
    });

    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
  });
});
