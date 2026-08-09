import { NextRequest } from "next/server";

import {
  API_ERROR_CODES,
  logApiError,
} from "@/lib/api-error";
import { apiError, apiJson } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import {
  buildTimestampCursorWhere,
  createPaginatedResponse,
  PaginationError,
  parsePaginationParams,
} from "@/lib/pagination";
import prisma from "@/lib/prisma";
import { getRequestId } from "@/lib/request-id";

export async function GET(request: NextRequest) {
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
    const url = new URL(request.url);
    const search = url.searchParams.get("search") || undefined;

    let limit, cursor;
    try {
      const params = parsePaginationParams(
        url.searchParams,
      );
      limit = params.limit;
      cursor = params.cursor;
    } catch (error) {
      if (error instanceof PaginationError) {
        return apiError(
          requestId,
          API_ERROR_CODES.VALIDATION_ERROR,
          error.message,
          400,
        );
      }
      throw error;
    }

    const cursorWhere = buildTimestampCursorWhere(
      "createdAt",
      cursor,
    );

    const whereClause: any = {
      isDeleted: false,
      id: {
        not: session.user.id,
      },
      ...(cursorWhere ?? {}),
    };

    if (search) {
      whereClause.OR = [
        {
          name: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          email: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          location: {
            contains: search,
            mode: "insensitive",
          },
        },
      ];
    }

    const users = await prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        bio: true,
        location: true,
        createdAt: true,
      },
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: limit + 1,
    });

    const paginatedResponse = createPaginatedResponse(
      users,
      limit,
      "createdAt",
    );

    return apiJson(
      {
        users: paginatedResponse.items,
        nextCursor: paginatedResponse.pagination.nextCursor,
      },
      requestId,
    );
  } catch (error) {
    logApiError(requestId, "User search failed", error);

    return apiError(
      requestId,
      API_ERROR_CODES.INTERNAL_ERROR,
      "Unable to search users",
      500,
    );
  }
}
