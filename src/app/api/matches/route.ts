import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";
import {
  buildMatchCacheKey,
  readMatchCache,
  writeMatchCache,
} from "@/lib/match-cache";

import redis from "@/lib/redis";
import {
  API_ERROR_CODES,
  logApiError,
} from "@/lib/api-error";
import { apiError, apiJson } from "@/lib/api-response";
import { getRequestId } from "@/lib/request-id";

// Upper bound on candidate tickets pulled for a destination/date window before
// relevance scoring + pagination. Was a magic `100`, which made `total`/`hasMore`
// wrong and hid every match past #100 once a window had more than 100 tickets.
// The full candidate set is needed to rank by relevance, so this is a safety
// cap (not a page size) — raise it if popular windows legitimately exceed it.
const MAX_MATCH_CANDIDATES = 500;

function calculateRelevance(
  currentUser: any,
  matchedUser: any,
  departureDate: Date,
  targetDate: Date,
): number {
  if (!currentUser) {
    return 50;
  }

  let score = 0;

  if (currentUser.languages && matchedUser.languages) {
    const sharedLanguages = currentUser.languages.filter(
      (language: string) => matchedUser.languages.includes(language),
    );

    score += Math.min(sharedLanguages.length * 20, 40);
  }

  if (
    currentUser.travelInterests &&
    matchedUser.travelInterests
  ) {
    const sharedInterests = currentUser.travelInterests.filter(
      (interest: string) =>
        matchedUser.travelInterests.includes(interest),
    );

    score += Math.min(sharedInterests.length * 15, 30);
  }

  if (
    currentUser.budgetRange &&
    matchedUser.budgetRange &&
    currentUser.budgetRange === matchedUser.budgetRange
  ) {
    score += 20;
  }

  if (
    currentUser.travelStyle &&
    matchedUser.travelStyle &&
    currentUser.travelStyle === matchedUser.travelStyle
  ) {
    score += 10;
  }

  const difference = Math.abs(
    departureDate.getTime() - targetDate.getTime(),
  );
  const differenceInDays = Math.ceil(
    difference / (1000 * 60 * 60 * 24),
  );

  if (differenceInDays === 0) {
    score += 20;
  } else if (differenceInDays === 1) {
    score += 10;
  } else if (differenceInDays === 2) {
    score += 5;
  }

  return Math.round((score / 120) * 100);
}

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req);
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

  const url = new URL(req.url);
  const destination = url.searchParams.get("destination");
  const date = url.searchParams.get("date");

  if (!destination || !date) {
    return apiError(
      requestId,
      API_ERROR_CODES.VALIDATION_ERROR,
      "The request data is invalid",
      400,
      {
        destination: destination
          ? []
          : ["Destination is required"],
        date: date ? [] : ["Date is required"],
      },
    );
  }

  const genderFilter = url.searchParams.get("gender");
  const tripPurposeFilter =
    url.searchParams.get("tripPurpose");

  const ageMinRaw = url.searchParams.get("ageMin");
  const ageMaxRaw = url.searchParams.get("ageMax");
  const startDateRaw =
    url.searchParams.get("startDate");
  const endDateRaw = url.searchParams.get("endDate");

  const ageMin = ageMinRaw
    ? Number.parseInt(ageMinRaw, 10)
    : null;
  const ageMax = ageMaxRaw
    ? Number.parseInt(ageMaxRaw, 10)
    : null;
  const filterStartDate = startDateRaw
    ? new Date(startDateRaw)
    : null;
  const filterEndDate = endDateRaw
    ? new Date(endDateRaw)
    : null;

  const parsedPage = Number.parseInt(
    url.searchParams.get("page") ?? "1",
    10,
  );
  const parsedLimit = Number.parseInt(
    url.searchParams.get("limit") ?? "10",
    10,
  );

  const page =
    Number.isFinite(parsedPage) && parsedPage > 0
      ? parsedPage
      : 1;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 10;

  try {
    const cacheKey = await buildMatchCacheKey({
      destination,
      date,
      userId: currentUserId,
      filters: {
        gender: genderFilter,
        tripPurpose: tripPurposeFilter,
        ageMin,
        ageMax,
        startDate:
          filterStartDate &&
          !Number.isNaN(filterStartDate.getTime())
            ? filterStartDate.toISOString()
            : null,
        endDate:
          filterEndDate &&
          !Number.isNaN(filterEndDate.getTime())
            ? filterEndDate.toISOString()
            : null,
      },
    });

    // Blocks are two-way: exclude both users I've blocked and users who have
    // blocked me. Previously only { blockerId: currentUserId } was queried, so
    // a user who blocked me still showed up in my matches.
    const blocks = await prisma.block.findMany({
      where: {
        OR: [
          { blockerId: currentUserId },
          { blockedId: currentUserId },
        ],
      },
      select: {
        blockerId: true,
        blockedId: true,
      },
    });

    const blockedUserIds = blocks.map(
  (block: {
    blockerId: string;
    blockedId: string;
  }) =>
    block.blockerId === currentUserId
      ? block.blockedId
      : block.blockerId,
);

    const cachedMatches =
      await readMatchCache<any[]>(cacheKey);

    if (cachedMatches) {
      const filteredMatches = cachedMatches.filter(
        (match: any) =>
          !blockedUserIds.includes(match.userId),
      );

      const total = filteredMatches.length;
      const skip = (page - 1) * limit;
      const paginatedMatches = filteredMatches.slice(
        skip,
        skip + limit,
      );
      const hasMore = skip + limit < total;

      return apiJson(
        {
          matches: paginatedMatches,
          total,
          hasMore,
          page,
          limit,
          cached: true,
        },
        requestId,
      );
    }

    const currentUser = await prisma.user.findUnique({
      where: {
        id: session.user.id,
      },
      select: {
        languages: true,
        travelInterests: true,
        accommodationPrefs: true,
        budgetRange: true,
        travelStyle: true,
      },
    });

    const targetDate = new Date(date);

    if (Number.isNaN(targetDate.getTime())) {
      return apiError(
        requestId,
        API_ERROR_CODES.VALIDATION_ERROR,
        "The request data is invalid",
        400,
        {
          date: ["Date is invalid"],
        },
      );
    }

    const defaultStartDate = new Date(targetDate);
    defaultStartDate.setDate(
      defaultStartDate.getDate() - 3,
    );

    const defaultEndDate = new Date(targetDate);
    defaultEndDate.setDate(
      defaultEndDate.getDate() + 3,
    );

    const whereClause: any = {
      destination: {
        contains: destination,
        mode: "insensitive",
      },
      departureDate: {
        gte:
          filterStartDate &&
          !Number.isNaN(filterStartDate.getTime())
            ? filterStartDate
            : defaultStartDate,
        lte:
          filterEndDate &&
          !Number.isNaN(filterEndDate.getTime())
            ? filterEndDate
            : defaultEndDate,
      },
      status: "VERIFIED",
      userId: {
        notIn: [
          session.user.id,
          ...blockedUserIds,
        ],
      },
    };

    if (
      tripPurposeFilter &&
      tripPurposeFilter !== "All"
    ) {
      whereClause.tripPurpose = {
        equals: tripPurposeFilter,
        mode: "insensitive",
      };
    }

    const userWhere: any = {};

    if (
      genderFilter &&
      genderFilter !== "All"
    ) {
      userWhere.gender = {
        equals: genderFilter,
        mode: "insensitive",
      };
    }

    if (ageMin !== null || ageMax !== null) {
      userWhere.age = {};

      if (
        ageMin !== null &&
        Number.isFinite(ageMin)
      ) {
        userWhere.age.gte = ageMin;
      }

      if (
        ageMax !== null &&
        Number.isFinite(ageMax)
      ) {
        userWhere.age.lte = ageMax;
      }
    }

    if (Object.keys(userWhere).length > 0) {
      whereClause.user = userWhere;
    }

    const matches = await prisma.ticket.findMany({
      where: whereClause,
      take: MAX_MATCH_CANDIDATES,
      orderBy: { departureDate: "asc" },
      select: {
        id: true,
        destination: true,
        departureDate: true,
        status: true,
        ticketUrl: true,
        userId: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            bio: true,
            languages: true,
            travelInterests: true,
            accommodationPrefs: true,
            budgetRange: true,
            socialLinks: true,
            age: true,
            gender: true,
            travelStyle: true,
          },
        },
      },
    });

    const scoredMatches = matches
      .map((match: any) => ({
        ...match,
        relevanceScore: calculateRelevance(
          currentUser,
          match.user,
          new Date(match.departureDate),
          targetDate,
        ),
      }))
      .sort(
        (first: any, second: any) =>
          second.relevanceScore -
          first.relevanceScore,
      );

    await writeMatchCache(
      cacheKey,
      scoredMatches,
    );

    const total = scoredMatches.length;
    const skip = (page - 1) * limit;
    const paginatedMatches = scoredMatches.slice(
      skip,
      skip + limit,
    );
    const hasMore = skip + limit < total;

    return apiJson(
      {
        matches: paginatedMatches,
        total,
        hasMore,
        page,
        limit,
        cached: false,
      },
      requestId,
    );
  } catch (error) {
    logApiError(
      requestId,
      "Match search failed",
      error,
    );

    return apiError(
      requestId,
      API_ERROR_CODES.INTERNAL_ERROR,
      "Unable to search for traveller matches",
      500,
    );
  }
}