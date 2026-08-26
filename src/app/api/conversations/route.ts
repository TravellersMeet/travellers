import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getBlockedUserIds } from "@/lib/blocking";
import {
  buildTimestampCursorWhere,
  createPaginatedResponse,
  PaginationError,
  parsePaginationParams,
} from "@/lib/pagination";
import prisma from "@/lib/prisma";

/**
 * Columns the sidebar needs for the counterpart of a thread. Kept narrow so a
 * page of conversations does not drag whole user rows across the wire.
 */
const COUNTERPART_SELECT = {
  id: true,
  name: true,
  image: true,
  bio: true,
  location: true,
} as const;

/**
 * GET /api/conversations
 *
 * Cursor-paginated list of the caller's conversations, newest activity first,
 * matching the shape used by /api/messages, /api/notifications and
 * /api/routes.
 */
export async function GET(req: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const userId = session.user.id;

  try {
    const { limit, cursor } = parsePaginationParams(
      req.nextUrl.searchParams,
    );
    const cursorWhere = buildTimestampCursorWhere(
      "updatedAt",
      cursor,
    );

    // Resolve the block set once instead of per conversation: a thread with
    // somebody on either side of a block must not appear in the sidebar at
    // all. This is applied to the query itself, so it holds on every page
    // rather than only the first.
    const blockedUserIds = await getBlockedUserIds(userId);

    const conversations = await prisma.conversation.findMany({
      where: {
        users: {
          some: { id: userId },
          ...(blockedUserIds.length > 0
            ? { none: { id: { in: blockedUserIds } } }
            : {}),
        },
        ...(cursorWhere ?? {}),
      },
      include: {
        users: {
          where: {
            id: { not: userId },
          },
          select: COUNTERPART_SELECT,
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      // `updatedAt` alone is not a stable sort — conversations created in the
      // same transaction share a timestamp and can swap places between
      // requests, which would also make the cursor skip or repeat rows.
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    // Paginate over the raw rows so hasMore and nextCursor describe the query,
    // then shape the page. Filtering before this point would corrupt both.
    const page = createPaginatedResponse(
      conversations,
      limit,
      "updatedAt",
    );

    const formatted = page.items
      // A conversation with no counterpart (the caller is the only
      // participant) has nothing to render, so it is dropped here instead of
      // being sent as `otherUser: null` for the client to skip.
      .filter((conversation) => conversation.users.length > 0)
      .map((conversation) => ({
        id: conversation.id,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        otherUser: conversation.users[0],
        lastMessage: conversation.messages[0] ?? null,
      }));

    return NextResponse.json({
      conversations: formatted,
      pagination: page.pagination,
    });
  } catch (error) {
    if (error instanceof PaginationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      );
    }

    console.error("Fetch conversations error:", error);

    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}
