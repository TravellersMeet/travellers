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

/**
 * A notification is "active" when it has no expiry, or its expiry is still in
 * the future.
 *
 * `cleanupExpiredNotifications` runs on a cron in batches of at most 500, so
 * between sweeps there are expired rows still sitting in the table. Read paths
 * must not depend on the sweeper having caught up — they filter on the same
 * rule the sweeper deletes by.
 */
export function activeNotificationWhere(
  now = new Date(),
): {
  OR: Array<Record<string, unknown>>;
} {
  return {
    OR: [
      { expiresAt: null },
      { expiresAt: { gt: now } },
    ],
  };
}

export async function getUnreadNotificationCount(
  userId: string,
  now = new Date(),
) {
  return prisma.notification.count({
    where: {
      userId,
      read: false,
      ...activeNotificationWhere(now),
    },
  });
}

/**
 * Dismiss a single notification.
 *
 * Scoped by `userId` via `deleteMany` rather than `delete` so a caller cannot
 * remove somebody else's row by guessing an id — a missing or foreign id is a
 * `count` of 0, not a thrown `RecordNotFound`.
 */
export async function deleteNotification(
  id: string,
  userId: string,
): Promise<number> {
  const result = await prisma.notification.deleteMany({
    where: {
      id,
      userId,
    },
  });

  return result.count;
}

/**
 * Clear a user's notifications. Defaults to the read ones, which is the
 * "tidy up" action; pass `onlyRead: false` for a full clear.
 */
export async function deleteNotificationsForUser(
  userId: string,
  { onlyRead = true }: { onlyRead?: boolean } = {},
): Promise<number> {
  const result = await prisma.notification.deleteMany({
    where: {
      userId,
      ...(onlyRead ? { read: true } : {}),
    },
  });

  return result.count;
}

/**
 * Mark one notification as read.
 *
 * Scoped by `userId` in the same statement as the id, for the same reason
 * `deleteNotification` above is: the ownership check and the write are one
 * operation, so there is no window between them and no way for a later edit
 * to reorder them apart. The two PATCH routes used to hand-roll this as a
 * `findFirst` followed by an `update` keyed on the id alone — correct only
 * because of the sequencing, and a `P2025` (surfaced as a 500) if the row was
 * deleted in between.
 *
 * `activeNotificationWhere` is applied so the write agrees with
 * `listNotifications` about which rows exist. Without it, an id captured
 * before expiry stayed mutable afterwards, even though the read path had
 * stopped returning it.
 *
 * Returns the updated row, or `null` when nothing matched — a foreign id, a
 * missing one and an expired one are indistinguishable to the caller, which
 * is what we want.
 */
export async function markNotificationAsRead(
  id: string,
  userId: string,
  now = new Date(),
): Promise<Notification | null> {
  const result = await prisma.notification.updateMany({
    where: {
      id,
      userId,
      ...activeNotificationWhere(now),
    },
    data: {
      read: true,
    },
  });

  if (result.count === 0) {
    return null;
  }

  // The write above is the authorised operation; this read is only to build
  // the response body, and it is already known to be the caller's row.
  return prisma.notification.findFirst({
    where: { id, userId },
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

export interface ListNotificationsParams {
  userId: string;
  limit: number;
  cursorWhere?: Record<string, unknown>;
  unreadOnly?: boolean;
  now?: Date;
}

/**
 * One page of a user's active notifications, newest first.
 *
 * Takes `limit + 1` rows so the caller can hand the result straight to
 * `createPaginatedResponse`, which uses the extra row to decide `hasMore`.
 */
export async function listNotifications({
  userId,
  limit,
  cursorWhere,
  unreadOnly = false,
  now = new Date(),
}: ListNotificationsParams): Promise<Notification[]> {
  return prisma.notification.findMany({
    where: {
      userId,
      ...(unreadOnly ? { read: false } : {}),
      AND: [
        activeNotificationWhere(now),
        ...(cursorWhere ? [cursorWhere] : []),
      ],
    },
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
    take: limit + 1,
  });
}
