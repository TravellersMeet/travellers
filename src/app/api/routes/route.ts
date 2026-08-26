/**
 * API Route: /api/routes
 * Handles route CRUD operations
 */

import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  buildTimestampCursorWhere,
  createPaginatedResponse,
  PaginationError,
  parsePaginationParams,
} from "@/lib/pagination";
import prisma from "@/lib/prisma";
import {
  applyRateLimitHeaders,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { enforceRateLimit } from "@/lib/rate-limit-rules";
import {
  ROUTE_LIMITS,
  routePayloadSchema,
} from "@/lib/validation/route-payload";
import { withValidation } from "@/lib/withValidation";

/**
 * GET /api/routes - Get paginated routes for authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { limit, cursor } = parsePaginationParams(
      request.nextUrl.searchParams,
    );
    const cursorWhere = buildTimestampCursorWhere(
      "updatedAt",
      cursor,
    );

    const routes = await prisma.route.findMany({
      where: {
        userId: session.user.id,
        ...(cursorWhere ?? {}),
      },
      orderBy: [
        { updatedAt: "desc" },
        { id: "desc" },
      ],
      take: limit + 1,
    });

    const result = createPaginatedResponse(
      routes,
      limit,
      "updatedAt",
    );

    return NextResponse.json({
      ...result,
      // Alias retained for existing API consumers.
      routes: result.items,
    });
  } catch (error) {
    if (error instanceof PaginationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      );
    }

    console.error("Error fetching routes:", error);
    return NextResponse.json(
      { error: "Failed to fetch routes" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/routes - Create or update a route
 */
export const POST = withValidation(
  routePayloadSchema,
  async (request, validatedData) => {
    try {
      const session = await auth();

      if (!session?.user?.id) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401 },
        );
      }

      const userId = session.user.id;

      const rateLimit = await enforceRateLimit(
        request,
        "routeWrite",
        userId,
      );

      if (!rateLimit.allowed) {
        return rateLimitExceededResponse(rateLimit);
      }

      // Shared by the create and update paths so a route reads back exactly
      // as it was written on either.
      const routeData = {
        originLat: validatedData.origin.lat,
        originLng: validatedData.origin.lng,
        destinationLat: validatedData.destination.lat,
        destinationLng: validatedData.destination.lng,
        originName: validatedData.originName,
        destinationName: validatedData.destinationName,
        distance: validatedData.distance,
        duration: validatedData.duration,
        encodedPolyline: validatedData.encodedPolyline,
        tripName: validatedData.tripName,
        notes: validatedData.notes,
        waypoints: validatedData.waypoints
          ? JSON.stringify(validatedData.waypoints)
          : null,
      };

      if (validatedData.id) {
        const existing = await prisma.route.findFirst({
          where: {
            id: validatedData.id,
            userId,
          },
          select: { id: true },
        });

        if (!existing) {
          return NextResponse.json(
            { error: "Route not found" },
            { status: 404 },
          );
        }

        const route = await prisma.route.update({
          where: {
            id: validatedData.id,
          },
          data: routeData,
        });

        return applyRateLimitHeaders(
          NextResponse.json(route),
          rateLimit,
        ) as NextResponse;
      }

      // Only creates are capped — an update replaces a row rather than adding
      // one, so it stays available even at the ceiling.
      const savedRoutes = await prisma.route.count({
        where: { userId },
      });

      if (savedRoutes >= ROUTE_LIMITS.routesPerUser) {
        return NextResponse.json(
          {
            error: `You can save at most ${ROUTE_LIMITS.routesPerUser} routes. Delete one to make room.`,
          },
          { status: 409 },
        );
      }

      const route = await prisma.route.create({
        data: {
          userId,
          ...routeData,
        },
      });

      return applyRateLimitHeaders(
        NextResponse.json(route, { status: 201 }),
        rateLimit,
      ) as NextResponse;
    } catch (error) {
      console.error("Error saving route:", error);
      return NextResponse.json(
        { error: "Failed to save route" },
        { status: 500 },
      );
    }
  },
);

/**
 * DELETE /api/routes - Delete a route
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const routeId =
      request.nextUrl.searchParams.get("id");

    if (!routeId) {
      return NextResponse.json(
        { error: "Route ID required" },
        { status: 400 },
      );
    }

    const existing = await prisma.route.findFirst({
      where: {
        id: routeId,
        userId: session.user.id,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Route not found" },
        { status: 404 },
      );
    }

    await prisma.route.delete({
      where: {
        id: routeId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting route:", error);
    return NextResponse.json(
      { error: "Failed to delete route" },
      { status: 500 },
    );
  }
}
