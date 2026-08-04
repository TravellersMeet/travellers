import { NotificationType } from "@prisma/client";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  cleanupExpiredNotifications,
  createNotification,
  normalizeCleanupBatchSize,
} from "@/lib/notifications";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    notification: {
      create: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

describe("notification deduplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates ordinary notifications without a dedupe key", async () => {
    vi.mocked(
      prisma.notification.create,
    ).mockResolvedValue({
      id: "notification-1",
    } as never);

    await createNotification({
      userId: "user-1",
      type: NotificationType.MESSAGE,
      title: "Message",
      content: "You have a message",
    });

    expect(
      prisma.notification.create,
    ).toHaveBeenCalledOnce();
    expect(
      prisma.notification.upsert,
    ).not.toHaveBeenCalled();
  });

  it("uses the user and dedupe key for idempotent creation", async () => {
    vi.mocked(
      prisma.notification.upsert,
    ).mockResolvedValue({
      id: "notification-1",
    } as never);

    await createNotification({
      userId: "user-1",
      type: NotificationType.MATCH_FOUND,
      title: "Match found",
      content: "A matching traveller was found",
      dedupeKey: "match-found:ticket-1:user-1",
    });

    expect(
      prisma.notification.upsert,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_dedupeKey: {
            userId: "user-1",
            dedupeKey:
              "match-found:ticket-1:user-1",
          },
        },
        update: {},
      }),
    );
  });

  it("allows the same dedupe key for different users", async () => {
    vi.mocked(
      prisma.notification.upsert,
    ).mockResolvedValue({
      id: "notification",
    } as never);

    for (const userId of ["user-1", "user-2"]) {
      await createNotification({
        userId,
        type: NotificationType.MESSAGE,
        title: "Message",
        content: "Content",
        dedupeKey: "event-1",
      });
    }

    expect(
      prisma.notification.upsert,
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          userId_dedupeKey: {
            userId: "user-1",
            dedupeKey: "event-1",
          },
        },
      }),
    );
    expect(
      prisma.notification.upsert,
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          userId_dedupeKey: {
            userId: "user-2",
            dedupeKey: "event-1",
          },
        },
      }),
    );
  });
});

describe("notification cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes cleanup batch limits", () => {
    expect(normalizeCleanupBatchSize()).toBe(100);
    expect(normalizeCleanupBatchSize(0)).toBe(1);
    expect(normalizeCleanupBatchSize(900)).toBe(500);
  });

  it("deletes one batch and reports more expired rows", async () => {
    vi.mocked(
      prisma.notification.findMany,
    ).mockResolvedValue([
      { id: "one" },
      { id: "two" },
      { id: "three" },
    ] as never);
    vi.mocked(
      prisma.notification.deleteMany,
    ).mockResolvedValue({
      count: 2,
    });

    const result =
      await cleanupExpiredNotifications(
        2,
        new Date("2026-08-04T00:00:00Z"),
      );

    expect(result).toEqual({
      deletedCount: 2,
      hasMore: true,
      batchSize: 2,
    });
    expect(
      prisma.notification.deleteMany,
    ).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["one", "two"],
        },
      },
    });
  });

  it("does not delete when no expired rows exist", async () => {
    vi.mocked(
      prisma.notification.findMany,
    ).mockResolvedValue([]);

    await expect(
      cleanupExpiredNotifications(20),
    ).resolves.toEqual({
      deletedCount: 0,
      hasMore: false,
      batchSize: 20,
    });

    expect(
      prisma.notification.deleteMany,
    ).not.toHaveBeenCalled();
  });
});
