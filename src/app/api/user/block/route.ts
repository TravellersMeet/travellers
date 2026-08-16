import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import {
  buildTimestampCursorWhere,
  createPaginatedResponse,
  PaginationError,
  parsePaginationParams,
} from "@/lib/pagination";
import { withValidation } from "@/lib/withValidation";

const BlockSchema = z.object({
  blockedId: z.string().min(1, "Blocked user ID required"),
});

const UnblockSchema = z.object({
  blockedId: z.string().min(1, "Blocked user ID required"),
});

/**
 * The columns a caller is allowed to see about somebody they blocked. Selecting
 * the whole `User` row here would expose `passwordHash`, `otp` and
 * `resetToken`.
 */
const BLOCKED_USER_SELECT = {
  id: true,
  name: true,
  image: true,
  location: true,
} as const;

/**
 * GET /api/user/block — the people the caller has blocked, newest first.
 *
 * Paginated with the shared cursor helpers so a long block list behaves the
 * same way as /api/routes and /api/tickets.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { limit, cursor } = parsePaginationParams(
      request.nextUrl.searchParams,
    );
    const cursorWhere = buildTimestampCursorWhere(
      "createdAt",
      cursor,
    );

    const blocks = await prisma.block.findMany({
      where: {
        blockerId: session.user.id,
        ...(cursorWhere ?? {}),
      },
      select: {
        id: true,
        createdAt: true,
        blocked: {
          select: BLOCKED_USER_SELECT,
        },
      },
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: limit + 1,
    });

    const result = createPaginatedResponse(
      blocks,
      limit,
      "createdAt",
    );

    return NextResponse.json({
      ...result,
      // Flattened alias so the settings screen can render the list directly.
      blockedUsers: result.items.map(
        (block: {
          createdAt: Date | string;
          blocked: { id: string } | null;
        }) => ({
          ...block.blocked,
          blockedAt: block.createdAt,
        }),
      ),
    });
  } catch (error) {
    if (error instanceof PaginationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    console.error("Error listing blocked users:", error);
    return NextResponse.json(
      { error: "Failed to list blocked users" },
      { status: 500 }
    );
  }
}

export const POST = withValidation(BlockSchema, async (request, validatedData) => {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { blockedId } = validatedData;

    if (session.user.id === blockedId) {
      return NextResponse.json(
        { error: "You cannot block yourself" },
        { status: 400 }
      );
    }

    // Check if the target user exists. Only the two columns needed for the
    // decision are selected — this used to pull the entire user row,
    // credentials included.
    const targetUser = await prisma.user.findUnique({
      where: { id: blockedId },
      select: { id: true, isDeleted: true },
    });

    if (!targetUser || targetUser.isDeleted) {
      return NextResponse.json(
        { error: "User to block not found" },
        { status: 404 }
      );
    }

    // Upsert or create Block record
    const existingBlock = await prisma.block.findUnique({
      where: {
        blockerId_blockedId: {
          blockerId: session.user.id,
          blockedId,
        },
      },
    });

    if (existingBlock) {
      return NextResponse.json({ success: true, message: "User is already blocked" });
    }

    // Creating the block and clearing all connection requests go together:
    // leaving any connection requests (pending or accepted) behind would cause
    // inconsistent relationship state and keep blocked users listed as connections.
    await prisma.$transaction([
      prisma.block.create({
        data: {
          blockerId: session.user.id,
          blockedId,
        },
      }),
      prisma.connectionRequest.deleteMany({
        where: {
          OR: [
            { senderId: session.user.id, receiverId: blockedId },
            { senderId: blockedId, receiverId: session.user.id },
          ],
        },
      }),
    ]);

    return NextResponse.json({ success: true, message: "User blocked successfully" }, { status: 201 });
  } catch (error) {
    console.error("Error blocking user:", error);
    return NextResponse.json(
      { error: "Failed to block user" },
      { status: 500 }
    );
  }
});

/**
 * DELETE /api/user/block — remove a block the caller created.
 *
 * The body carries the target id, matching the existing DELETE
 * /api/user/account convention. Only the caller's own block row is ever
 * touched, so this cannot be used to lift somebody else's block.
 */
export const DELETE = withValidation(UnblockSchema, async (request, validatedData) => {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { blockedId } = validatedData;

    const deleted = await prisma.block.deleteMany({
      where: {
        blockerId: session.user.id,
        blockedId,
      },
    });

    if (deleted.count === 0) {
      return NextResponse.json(
        { error: "You have not blocked this user" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "User unblocked successfully",
    });
  } catch (error) {
    console.error("Error unblocking user:", error);
    return NextResponse.json(
      { error: "Failed to unblock user" },
      { status: 500 }
    );
  }
});
