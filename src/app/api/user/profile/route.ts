import { NextRequest } from "next/server";

import {
  API_ERROR_CODES,
  logApiError,
} from "@/lib/api-error";
import { apiError, apiJson } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getRequestId } from "@/lib/request-id";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const session = await auth();

  if (!session?.user?.email) {
    return apiError(
      requestId,
      API_ERROR_CODES.UNAUTHORIZED,
      "Authentication is required",
      401,
    );
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: {
        name: true,
        email: true,
        bio: true,
        location: true,
        image: true,
        homeLocation: true,
        phone: true,
        emailVerified: true,
        createdAt: true,
        languages: true,
        travelInterests: true,
        accommodationPrefs: true,
        budgetRange: true,
        socialLinks: true,
        age: true,
        gender: true,
        travelStyle: true,
      },
    });

    if (!user) {
      return apiError(
        requestId,
        API_ERROR_CODES.NOT_FOUND,
        "User profile was not found",
        404,
      );
    }

    return apiJson(user, requestId);
  } catch (error) {
    logApiError(requestId, "Profile fetch failed", error);

    return apiError(
      requestId,
      API_ERROR_CODES.INTERNAL_ERROR,
      "Unable to fetch the profile",
      500,
    );
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = getRequestId(request);
  const session = await auth();

  if (!session?.user?.email) {
    return apiError(
      requestId,
      API_ERROR_CODES.UNAUTHORIZED,
      "Authentication is required",
      401,
    );
  }

  let body: Record<string, unknown>;

  try {
    body = await request.json();
  } catch (error) {
    logApiError(requestId, "Profile payload parsing failed", error);

    return apiError(
      requestId,
      API_ERROR_CODES.BAD_REQUEST,
      "Invalid request format",
      400,
    );
  }

  try {
    const ageValue = body.age;
    const parsedAge =
      ageValue !== undefined && ageValue !== null
        ? Number.parseInt(String(ageValue), 10)
        : undefined;

    const updatedUser = await prisma.user.update({
      where: { email: session.user.email },
      data: {
        name:
          typeof body.name === "string"
            ? body.name
            : undefined,
        bio:
          typeof body.bio === "string"
            ? body.bio
            : undefined,
        location:
          typeof body.location === "string"
            ? body.location
            : undefined,
        homeLocation:
          typeof body.homeLocation === "string"
            ? body.homeLocation
            : undefined,
        languages: Array.isArray(body.languages)
          ? body.languages
          : undefined,
        travelInterests: Array.isArray(body.travelInterests)
          ? body.travelInterests
          : undefined,
        accommodationPrefs: Array.isArray(
          body.accommodationPrefs,
        )
          ? body.accommodationPrefs
          : undefined,
        budgetRange:
          typeof body.budgetRange === "string"
            ? body.budgetRange
            : undefined,
        socialLinks:
          body.socialLinks &&
          typeof body.socialLinks === "object"
            ? body.socialLinks
            : undefined,
        age:
          parsedAge !== undefined &&
          Number.isFinite(parsedAge)
            ? parsedAge
            : undefined,
        gender:
          typeof body.gender === "string"
            ? body.gender
            : undefined,
        travelStyle:
          typeof body.travelStyle === "string"
            ? body.travelStyle
            : undefined,
      },
    });

    return apiJson(updatedUser, requestId);
  } catch (error) {
    logApiError(requestId, "Profile update failed", error);

    return apiError(
      requestId,
      API_ERROR_CODES.INTERNAL_ERROR,
      "Unable to update the profile",
      500,
    );
  }
}
