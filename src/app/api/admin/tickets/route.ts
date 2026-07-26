import { TicketStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import {
  buildTimestampCursorWhere,
  createPaginatedResponse,
  PaginationError,
  parsePaginationParams,
} from "@/lib/pagination";

const VALID_TICKET_STATUSES = new Set<string>(
  Object.values(TicketStatus),
);

// Get paginated tickets for admin review
export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 },
      );
    }

    const status =
      request.nextUrl.searchParams.get("status");

    if (
      status &&
      !VALID_TICKET_STATUSES.has(status)
    ) {
      return NextResponse.json(
        {
          error:
            "Status must be PENDING, VERIFIED, or REJECTED",
        },
        { status: 400 },
      );
    }

    const { limit, cursor } = parsePaginationParams(
      request.nextUrl.searchParams,
    );
    const cursorWhere = buildTimestampCursorWhere(
      "createdAt",
      cursor,
    );

    const tickets = await prisma.ticket.findMany({
      where: {
        ...(status
          ? {
              status: status as TicketStatus,
            }
          : {}),
        ...(cursorWhere ?? {}),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: limit + 1,
    });

    const result = createPaginatedResponse(
      tickets,
      limit,
      "createdAt",
    );

    return NextResponse.json({
      ...result,
      // Alias retained for existing API consumers.
      tickets: result.items,
    });
  } catch (error) {
    if (error instanceof PaginationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      );
    }

    console.error(
      "Get admin tickets error:",
      error,
    );
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}
