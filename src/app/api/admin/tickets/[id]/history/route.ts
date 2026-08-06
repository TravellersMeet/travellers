import type { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import {
  API_ERROR_CODES,
  logApiError,
} from "@/lib/api-error";
import {
  apiError,
  apiJson,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import {
  buildTimestampCursorWhere,
  createPaginatedResponse,
  PaginationError,
  parsePaginationParams,
} from "@/lib/pagination";
import prisma from "@/lib/prisma";
import { getRequestId } from "@/lib/request-id";

interface RouteContext {
  params: {
    id: string;
  };
}

export async function GET(
  request: NextRequest,
  { params }: RouteContext,
) {
  const requestId = getRequestId(request);
  const session = await auth();

  if (!session?.user?.id) {
    return apiError(
      requestId,
      API_ERROR_CODES.UNAUTHORIZED,
      "Authentication is required",
      401,
    );
  }

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: session.user.id,
      },
      select: {
        role: true,
      },
    });

    if (user?.role !== "ADMIN") {
      return apiError(
        requestId,
        API_ERROR_CODES.FORBIDDEN,
        "Administrator access is required",
        403,
      );
    }

    const ticket = await prisma.ticket.findUnique({
      where: {
        id: params.id,
      },
      select: {
        id: true,
      },
    });

    if (!ticket) {
      return apiError(
        requestId,
        API_ERROR_CODES.NOT_FOUND,
        "Ticket not found",
        404,
      );
    }

    const { limit, cursor } =
      parsePaginationParams(
        request.nextUrl.searchParams,
      );
    const cursorWhere =
      buildTimestampCursorWhere(
        "createdAt",
        cursor,
      );

    const where: Prisma.TicketAuditLogWhereInput = {
      ticketId: params.id,
      ...(cursorWhere ?? {}),
    };

    const records =
      await prisma.ticketAuditLog.findMany({
        where,
        orderBy: [
          {
            createdAt: "desc",
          },
          {
            id: "desc",
          },
        ],
        take: limit + 1,
        include: {
          admin: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

    return apiJson(
      createPaginatedResponse(
        records,
        limit,
        "createdAt",
      ),
      requestId,
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    if (error instanceof PaginationError) {
      return apiError(
        requestId,
        API_ERROR_CODES.VALIDATION_ERROR,
        error.message,
        400,
      );
    }

    logApiError(
      requestId,
      "Ticket audit history retrieval failed",
      error,
    );

    return apiError(
      requestId,
      API_ERROR_CODES.INTERNAL_ERROR,
      "Unable to retrieve ticket history",
      500,
    );
  }
}
