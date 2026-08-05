import {
  NotificationType,
  type Notification,
} from "@prisma/client";

import prisma from "@/lib/prisma";

const DEFAULT_CLEANUP_BATCH_SIZE = 100;
const MAX_CLEANUP_BATCH_SIZE = 500;

export interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  content: string;
  link?: string;
  dedupeKey?: string;
  expiresAt?: Date;
}

export interface NotificationCleanupResult {
  deletedCount: number;
  hasMore: boolean;
  batchSize: number;
}

function normalizeOptionalValue(
  value: string | undefined,
): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function normalizeCleanupBatchSize(
  requestedLimit?: number,
): number {
  if (
    requestedLimit === undefined ||
    !Number.isFinite(requestedLimit)
  ) {
    return DEFAULT_CLEANUP_BATCH_SIZE;
  }

  return Math.min(
    MAX_CLEANUP_BATCH_SIZE,
    Math.max(1, Math.trunc(requestedLimit)),
  );
}

export async function createNotification({
  userId,
  type,
  title,
  content,
  link,
  dedupeKey,
  expiresAt,
}: CreateNotificationParams): Promise<Notification> {
  const normalizedDedupeKey =
    normalizeOptionalValue(dedupeKey);
  const normalizedLink = normalizeOptionalValue(link);

  const data = {
    userId,
    type,
    title,
    content,
    link: normalizedLink,
    dedupeKey: normalizedDedupeKey,
    expiresAt,
  };

  if (!normalizedDedupeKey) {
    return prisma.notification.create({
      data,
    });
  }

  return prisma.notification.upsert({
    where: {
      userId_dedupeKey: {
        userId,
        dedupeKey: normalizedDedupeKey,
      },
    },
    update: {},
    create: data,
  });
}

export async function cleanupExpiredNotifications(
  requestedLimit?: number,
  now = new Date(),
): Promise<NotificationCleanupResult> {
  const batchSize =
    normalizeCleanupBatchSize(requestedLimit);

  const expiredNotifications =
    await prisma.notification.findMany({
      where: {
        expiresAt: {
          lte: now,
        },
      },
      select: {
        id: true,
      },
      orderBy: [
        {
          expiresAt: "asc",
        },
        {
          id: "asc",
        },
      ],
      take: batchSize + 1,
    });

  const hasMore =
    expiredNotifications.length > batchSize;
  const idsToDelete = expiredNotifications
    .slice(0, batchSize)
    .map(({ id }) => id);

  if (idsToDelete.length === 0) {
    return {
      deletedCount: 0,
      hasMore: false,
      batchSize,
    };
  }

  const result =
    await prisma.notification.deleteMany({
      where: {
        id: {
          in: idsToDelete,
        },
      },
    });

  return {
    deletedCount: result.count,
    hasMore,
    batchSize,
  };
}

export async function getUnreadNotificationCount(
  userId: string,
) {
  return prisma.notification.count({
    where: {
      userId,
      read: false,
    },
  });
}

export async function markNotificationAsRead(
  id: string,
  userId: string,
) {
  return prisma.notification.updateMany({
    where: {
      id,
      userId,
    },
    data: {
      read: true,
    },
  });
}

export async function markAllNotificationsAsRead(
  userId: string,
) {
  return prisma.notification.updateMany({
    where: {
      userId,
      read: false,
    },
    data: {
      read: true,
    },
  });
}
