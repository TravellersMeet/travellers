import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

import redis from "@/lib/redis";
import { createNotification } from "@/lib/notifications";
import { API_ERROR_CODES, logApiError } from "@/lib/api-error";
import { apiError, apiJson } from "@/lib/api-response";
import { getRequestId } from "@/lib/request-id";

function calculateRelevance(
  currentUser: any,
  matchedUser: any,
  departureDate: Date,
  targetDate: Date
) {
  if (!currentUser) return 50;

  let score = 0;

  // 1. Shared Languages: +20 points per language (capped at 40)
  if (currentUser.languages && matchedUser.languages) {
    const sharedLangs = currentUser.languages.filter((l: string) =>
      matchedUser.languages.includes(l)
    );
    score += Math.min(sharedLangs.length * 20, 40);
  }

  // 2. Shared Interests: +15 points per interest (capped at 30)
  if (currentUser.travelInterests && matchedUser.travelInterests) {
    const sharedInterests = currentUser.travelInterests.filter((i: string) =>
      matchedUser.travelInterests.includes(i)
    );
    score += Math.min(sharedInterests.length * 15, 30);
  }

  // 3. Same Budget Range: +20 points
  if (
    currentUser.budgetRange &&
    matchedUser.budgetRange &&
    currentUser.budgetRange === matchedUser.budgetRange
  ) {
    score += 20;
  }

  // 4. Same Travel Style: +10 points
  if (
    currentUser.travelStyle &&
    matchedUser.travelStyle &&
    currentUser.travelStyle === matchedUser.travelStyle
  ) {
    score += 10;
  }

  // 5. Date proximity: +20 points (same day), +10 (1 day diff), +5 (2 days diff)
  const diffTime = Math.abs(departureDate.getTime() - targetDate.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    score += 20;
  } else if (diffDays === 1) {
    score += 10;
  } else if (diffDays === 2) {
    score += 5;
  }

  // Max score: 40 + 30 + 20 + 10 + 20 = 120 points. Normalize to percentage match.
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

  // Extract advanced filters
  const genderFilter = url.searchParams.get("gender");
  const tripPurposeFilter = url.searchParams.get("tripPurpose");
  const ageMin = url.searchParams.get("ageMin") ? parseInt(url.searchParams.get("ageMin")!) : null;
  const ageMax = url.searchParams.get("ageMax") ? parseInt(url.searchParams.get("ageMax")!) : null;
  const filterStartDate = url.searchParams.get("startDate") ? new Date(url.searchParams.get("startDate")!) : null;
  const filterEndDate = url.searchParams.get("endDate") ? new Date(url.searchParams.get("endDate")!) : null;
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "10");

  try {
    console.log("===== MATCH API CALLED =====");
    console.log("User:", session.user.id);
    console.log("Destination:", destination);
    console.log("Date:", date);
    const cacheKey = `matches:${destination.toLowerCase()}:${date}:${session.user.id}`;

    // Get all blocked user IDs (both blocker and blocked)
    const blocks = await prisma.block.findMany({
      where: {
        OR: [
          { blockerId: session.user!.id },
          { blockedId: session.user!.id },
        ],
      },
      select: {
        blockerId: true,
        blockedId: true,
      },
    });
    const blockedUserIds = blocks.map((b) =>
      b.blockerId === session.user!.id ? b.blockedId : b.blockerId
    );

    // Check cache (skip if Redis is unavailable)
    let cachedMatches: string | null = null;
    try {
      if (redis) {
        cachedMatches = await redis.get(cacheKey);
      }
    } catch {
      console.warn("Redis unavailable. Skipping cache.");
    }

    if (cachedMatches) {
      const parsedMatches: any[] = JSON.parse(cachedMatches);
      // Filter out any newly blocked users from cached results
      const filteredMatches = parsedMatches.filter(
        (m: any) => !blockedUserIds.includes(m.userId)
      );
      const total = filteredMatches.length;
      const skip = (page - 1) * limit;
      const paginatedMatches = filteredMatches.slice(skip, skip + limit);
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

    // Load current user profile details for scoring comparisons
    const currentUser = await prisma.user.findUnique({
      where: { id: session.user!.id },
      select: {
        languages: true,
        travelInterests: true,
        accommodationPrefs: true,
        budgetRange: true,
        travelStyle: true,
      },
    });

    // Find verified tickets for same destination within ±3 days (or custom filter window)
    const targetDate = new Date(date);
    const defaultStartDate = new Date(targetDate);
    defaultStartDate.setDate(defaultStartDate.getDate() - 3);
    const defaultEndDate = new Date(targetDate);
    defaultEndDate.setDate(defaultEndDate.getDate() + 3);

    const whereClause: any = {
      destination: {
        contains: destination,
        mode: "insensitive",
      },
      departureDate: {
        gte: filterStartDate || defaultStartDate,
        lte: filterEndDate || defaultEndDate,
      },
      status: "VERIFIED",
      userId: {
        notIn: [session.user.id, ...blockedUserIds],
      },
    };

    if (tripPurposeFilter && tripPurposeFilter !== "All") {
      whereClause.tripPurpose = {
        equals: tripPurposeFilter,
        mode: "insensitive",
      };
    }

    const userWhere: any = {};
    if (genderFilter && genderFilter !== "All") {
      userWhere.gender = {
        equals: genderFilter,
        mode: "insensitive",
      };
    }
    if (ageMin !== null || ageMax !== null) {
      userWhere.age = {};
      if (ageMin !== null) userWhere.age.gte = ageMin;
      if (ageMax !== null) userWhere.age.lte = ageMax;
    }

    if (Object.keys(userWhere).length > 0) {
      whereClause.user = userWhere;
    }

    // Fetch up to 100 candidate tickets to prevent high-memory queries
    const matches = await prisma.ticket.findMany({
      where: whereClause,
      take: 100,
      include: {
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

    const foundMatches = matches || [];
    console.log("Matches found:", foundMatches.length);
    // Save to cache (TTL: 5 minutes)
    try {
      if (redis) {
        await redis.set(cacheKey, JSON.stringify(foundMatches), "EX", 300);
      }
    } catch {
      console.warn("Redis unavailable. Cache not saved.");
    }

    if (foundMatches.length > 0) {
      console.log("Creating MATCH_FOUND notification...");
      await createNotification({
        userId: session.user.id,
        type: "MATCH_FOUND",
        title: "New traveller match found",
        content: `We found ${foundMatches.length} traveller${foundMatches.length > 1 ? "s" : ""} matching your destination and travel date.`,
        link: "/dashboard",
      });
      console.log("Notification created.");
    }
    // Rank and score matches by compatibility
    const scoredMatches = foundMatches.map((match: any) => {
      const score = calculateRelevance(
        currentUser,
        match.user,
        new Date(match.departureDate),
        targetDate
      );
      return {
        ...match,
        relevanceScore: score,
      };
    }).sort((a: any, b: any) => b.relevanceScore - a.relevanceScore);

    // Save full scored matches list to cache (TTL: 5 minutes)
    try {
      if (redis) {
        await redis.set(cacheKey, JSON.stringify(scoredMatches), "EX", 300);
      }
    } catch {
      console.warn("Redis unavailable. Cache write skipped.");
    }

    // Apply pagination
    const total = scoredMatches.length;
    const skip = (page - 1) * limit;
    const paginatedMatches = scoredMatches.slice(skip, skip + limit);
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
    logApiError(requestId, "Match search failed", error);
    return apiError(
      requestId,
      API_ERROR_CODES.INTERNAL_ERROR,
      "Unable to search for traveller matches",
      500,
    );
  }
}
