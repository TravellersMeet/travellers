import { NextRequest } from "next/server";

import {
  API_ERROR_CODES,
  logApiError,
} from "@/lib/api-error";
import { apiError, apiJson } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getRequestId } from "@/lib/request-id";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const requestId = getRequestId(request);

  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(
        requestId,
        API_ERROR_CODES.UNAUTHORIZED,
        "Authentication is required",
        401,
      );
    }

    const route = await prisma.route.findUnique({
      where: {
        id: params.id,
        userId: session.user.id,
      },
    });

    if (!route) {
      return apiError(
        requestId,
        API_ERROR_CODES.NOT_FOUND,
        "Route was not found",
        404,
      );
    }

    const formattedRoute = {
      ...route,
      origin: {
        lat: route.originLat,
        lng: route.originLng,
      },
      destination: {
        lat: route.destinationLat,
        lng: route.destinationLng,
      },
      waypoints: route.waypoints
        ? JSON.parse(route.waypoints as string)
        : undefined,
    };

    return apiJson(formattedRoute, requestId);
  } catch (error) {
    logApiError(requestId, "Route fetch failed", error);

    return apiError(
      requestId,
      API_ERROR_CODES.INTERNAL_ERROR,
      "Unable to fetch the route",
      500,
    );
  }
}
