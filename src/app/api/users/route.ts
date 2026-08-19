import type { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";

import {
  API_ERROR_CODES,
  logApiError,
} from "@/lib/api-error";
import { apiError, apiJson } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getBlockedUserIds } from "@/lib/blocking";
import {
  buildTimestampCursorWhere,
  createPaginatedResponse,
  PaginationError,
  parsePaginationParams,
} from "@/lib/pagination";
import prisma from "@/lib/prisma";
import { getRequestId } from "@/lib/request-id";

/**
 * Fields a caller may see about somebody they have no relationship with.
 *
 * Deliberately mirrors the projection used by `/api/conversations` and
 * `/api/connections`: id, display name, avatar, bio, location. `email` is not
 * on the list — no screen in the product shows another user's address, and
 * returning it here made the endpoint an address-book dump for anyone with a
 * session.
 */
const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  image: true,
  bio: true,
  location: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

/**
 * Longest search term we will run a `contains` scan for. Anything past this is
 * not a realistic name or place and only costs the database a wider scan.
 */
const MAX_SEARCH_LENGTH = 100;

/**
 * Columns the search term is matched against.
 *
 * `email` used to be in here, which meant `?search=@gmail.com` was a working
 * account-harvesting query and `?search=someone@example.com` was a yes/no
 * oracle for whether an address had signed up. Search is for finding a
 * traveller by who they are and where they are, so name and location are the
 * only sensible columns.
 */
function buildSearchFilter(
  term: string,
): Prisma.UserWhereInput[] {
  return [
    { name: { contains: term, mode: "insensitive" } },
    { location: { contains: term, mode: "insensitive" } },
  ];
}

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

  const currentUserId = session.user.id;

  try {
    const url = new URL(request.url);
    const rawSearch = url.searchParams.get("search");
    const search = rawSearch?.trim() || undefined;

    if (search && search.length > MAX_SEARCH_LENGTH) {
      return apiError(
        requestId,
        API_ERROR_CODES.VALIDATION_ERROR,
        `Search term is too long (max ${MAX_SEARCH_LENGTH} characters)`,
        400,
      );
    }

    let limit: number;
    let cursor: ReturnType<
      typeof parsePaginationParams
    >["cursor"];

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

    // Blocking is symmetric (see src/lib/blocking.ts), so this one query
    // removes both the people the caller blocked and the people who blocked
    // them. `/api/conversations` already filters its list the same way; search
    // was the remaining place a blocked user could still surface.
    const blockedUserIds =
      await getBlockedUserIds(currentUserId);

    const excludedIds = [
      currentUserId,
      ...blockedUserIds,
    ];

    // Both the cursor and the search term are expressed as `OR` groups, so
    // spreading them into the same object made the second one overwrite the
    // first: `?search=x&cursor=y` silently dropped the cursor and served page
    // one forever. Nesting them under `AND` keeps both.
    const filters: Prisma.UserWhereInput[] = [];

    if (cursorWhere) {
      filters.push(cursorWhere as Prisma.UserWhereInput);
    }

    if (search) {
      filters.push({ OR: buildSearchFilter(search) });
    }

    const whereClause: Prisma.UserWhereInput = {
      isDeleted: false,
      id: { notIn: excludedIds },
      ...(filters.length > 0 ? { AND: filters } : {}),
    };

    const users = await prisma.user.findMany({
      where: whereClause,
      select: PUBLIC_USER_SELECT,
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
        nextCursor:
          paginatedResponse.pagination.nextCursor,
        hasMore: paginatedResponse.pagination.hasMore,
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
