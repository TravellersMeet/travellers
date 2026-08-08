import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { isBlockedBetween } from "@/lib/blocking";
import {
  buildTimestampCursorWhere,
  createPaginatedResponse,
  PaginationError,
  parsePaginationParams,
} from "@/lib/pagination";
import { triggerPusher } from "@/lib/pusher";

const BLOCKED_CONVERSATION_ERROR =
  "This conversation is unavailable because one of you has blocked the other";

/**
 * Loads a conversation only if the caller belongs to it, along with the ids of
 * the other participants so callers can run a block check without a second
 * round-trip.
 */
async function loadConversationForUser(
  conversationId: string,
  userId: string,
): Promise<{ id: string; counterpartIds: string[] } | null> {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      users: {
        some: { id: userId },
      },
    },
    select: {
      id: true,
      users: { select: { id: true } },
    },
  });

  if (!conversation) {
    return null;
  }

  const users: Array<{ id: string }> = conversation.users ?? [];

  return {
    id: conversation.id,
    counterpartIds: users
      .map((user) => user.id)
      .filter((id) => id !== userId),
  };
}

/**
 * Columns returned for a message. Kept in one place because `GET` (the history
 * page) and `POST` (the echoed message) have to agree — the chat UI renders
 * both through the same component.
 */
const MESSAGE_INCLUDE = {
  sender: {
    select: {
      id: true,
      name: true,
      image: true,
    },
  },

  route: {
    select: {
      id: true,
      tripName: true,

      originName: true,
      destinationName: true,

      originLat: true,
      originLng: true,

      destinationLat: true,
      destinationLng: true,

      distance: true,
      duration: true,

      encodedPolyline: true,
    },
  },
} as const;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId");

  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

  try {
    const { limit, cursor } = parsePaginationParams(
      url.searchParams,
    );
    const cursorWhere = buildTimestampCursorWhere(
      "createdAt",
      cursor,
    );

    // Check if user is participant of conversation
    const conversation = await loadConversationForUser(conversationId, userId);

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // A block hides the history in both directions, so neither side can keep
    // reading the thread after one of them blocked the other.
    if (await isBlockedBetween(userId, conversation.counterpartIds)) {
      return NextResponse.json(
        { error: BLOCKED_CONVERSATION_ERROR },
        { status: 403 },
      );
    }

    // Newest first so the default page is the bottom of the thread, which is
    // what the chat opens on. The cursor then walks backwards through history.
    const messages = await prisma.message.findMany({
      where: {
        conversationId,
        ...(cursorWhere ?? {}),
      },
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: limit + 1,
      include: MESSAGE_INCLUDE,
    });

    const result = createPaginatedResponse(
      messages,
      limit,
      "createdAt",
    );

    return NextResponse.json({
      ...result,
      // Alias retained for existing API consumers, re-sorted oldest-first
      // because that is the order the transcript is rendered in.
      messages: [...result.items].reverse(),
    });
  } catch (error) {
    if (error instanceof PaginationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      );
    }

    console.error("Fetch messages error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const {
  conversationId,
  text,
  routeId,
} = body;

  if (!conversationId) {
  return NextResponse.json(
    { error: "conversationId is required" },
    { status: 400 }
  );
}

if ((!text || text.trim() === "") && !routeId) {
  return NextResponse.json(
    {
      error: "Either message text or a shared route is required",
    },
    { status: 400 }
  );
}

  try {
    // Check if user is participant of conversation
    const conversation = await loadConversationForUser(conversationId, userId);

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Blocks are two-way: the person who was blocked must not be able to keep
    // messaging, and the blocker must not be able to message them either.
    if (await isBlockedBetween(userId, conversation.counterpartIds)) {
      return NextResponse.json(
        { error: BLOCKED_CONVERSATION_ERROR },
        { status: 403 },
      );
    }

    // A shared route must belong to the sender — otherwise a user could attach
    // (and expose the details of) another user's route by passing its id.
    if (routeId) {
      const route = await prisma.route.findFirst({
        where: { id: routeId, userId },
        select: { id: true },
      });

      if (!route) {
        return NextResponse.json(
          { error: "Route not found or not owned by you" },
          { status: 403 }
        );
      }
    }

    // Save message and update conversation's updatedAt timestamp
    const [message] = await prisma.$transaction([
  prisma.message.create({
    data: {
      conversationId,
      senderId: userId,
      text: text?.trim() ?? "",
      routeId: routeId ?? null,
    },
    include: MESSAGE_INCLUDE,
  }),

  prisma.conversation.update({
    where: {
      id: conversationId,
    },
    data: {
      updatedAt: new Date(),
    },
  }),
]);

    // Trigger Pusher event
    await triggerPusher(`private-chat-${conversationId}`, "new-message", {
      message,
    });

    // Also trigger update on user sidebars for conversation lists. The
    // participant ids were already loaded for the membership and block checks,
    // so there is no need to query the conversation a second time here.
    const sidebarUserIds = [userId, ...conversation.counterpartIds];

    await Promise.all(
      sidebarUserIds.map((id) =>
        triggerPusher(`private-user-${id}`, "conversation-updated", {
          conversationId,
          lastMessage: message,
        })
      )
    );

    return NextResponse.json({ success: true, message });
  } catch (error) {
    console.error("Send message error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
