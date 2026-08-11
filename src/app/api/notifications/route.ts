import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/lib/auth";
import {
  deleteNotificationsForUser,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsAsRead,
} from "@/lib/notifications";
import {
  buildTimestampCursorWhere,
  createPaginatedResponse,
  PaginationError,
  parsePaginationParams,
} from "@/lib/pagination";

/**
 * GET /api/notifications
 *
 * One page of the caller's notifications, newest first.
 *
 * This used to be a single unbounded `findMany`: every notification the user
 * had ever received was serialised on every page load, to render a dropdown
 * that shows about six of them. It now uses the same cursor helpers as
 * /api/messages, /api/routes and /api/tickets.
 *
 * Query parameters:
 *   limit       page size, default 20, capped at 100
 *   cursor      opaque cursor from a previous `pagination.nextCursor`
 *   unreadOnly  "true" to return only unread notifications
 */
export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const userId = session.user.id;

  try {
    const searchParams = new URL(request.url).searchParams;
    const { limit, cursor } =
      parsePaginationParams(searchParams);
    const cursorWhere = buildTimestampCursorWhere(
      "createdAt",
      cursor,
    );
    const unreadOnly =
      searchParams.get("unreadOnly") === "true";

    // One clock reading for both queries, so the page and the badge cannot
    // disagree about whether a notification expiring right now still counts.
    const now = new Date();

    const [records, unreadCount] = await Promise.all([
      listNotifications({
        userId,
        limit,
        cursorWhere,
        unreadOnly,
        now,
      }),
      getUnreadNotificationCount(userId, now),
    ]);

    const result = createPaginatedResponse(
      records,
      limit,
      "createdAt",
    );

    return NextResponse.json({
      ...result,
      // Alias retained for existing consumers of this endpoint.
      notifications: result.items,
      unreadCount,
    });
  } catch (error) {
    if (error instanceof PaginationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      );
    }

    console.error("Notification fetch error:", error);

    return NextResponse.json(
      { error: "Failed to fetch notifications" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/notifications
 *
 * Mark every unread notification as read.
 *
 * `markAllNotificationsAsRead` has been sitting in src/lib/notifications.ts
 * with no caller — the helper was written but never given a route, so the only
 * way to clear a long list was to click each row.
 */
export async function PATCH() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const result = await markAllNotificationsAsRead(
      session.user.id,
    );

    return NextResponse.json({
      ok: true,
      updated: result.count,
    });
  } catch (error) {
    console.error(
      "Mark all notifications read error:",
      error,
    );

    return NextResponse.json(
      { error: "Failed to update notifications" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/notifications
 *
 * Clears the caller's read notifications. Pass `?all=true` to clear the
 * unread ones too.
 */
export async function DELETE(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const clearAll =
      new URL(request.url).searchParams.get("all") ===
      "true";

    const deleted = await deleteNotificationsForUser(
      session.user.id,
      { onlyRead: !clearAll },
    );

    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    console.error(
      "Clear notifications error:",
      error,
    );

    return NextResponse.json(
      { error: "Failed to clear notifications" },
      { status: 500 },
    );
  }
}
