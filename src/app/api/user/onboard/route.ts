import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  applyRateLimitHeaders,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { enforceRateLimit } from "@/lib/rate-limit-rules";
import {
  onboardingProfileSchema,
  toProfileUpdateData,
} from "@/lib/validation/profile";
import { withValidation } from "@/lib/withValidation";

/**
 * POST /api/user/onboard
 *
 * Completes onboarding for the signed-in account. Everything the client sends
 * is optional, but anything present is validated against the shared profile
 * bounds before it reaches Prisma — this is the first write most accounts ever
 * make, and it targets the same columns the public profile card renders.
 */
export const POST = withValidation(
  onboardingProfileSchema,
  async (request, data) => {
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
      "userOnboard",
      userId,
    );

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit);
    }

    // A session can outlive the account it belongs to: the row survives a
    // soft delete, so without this check a deleted user could keep writing to
    // it and flip `onboarded` back on. `PATCH /api/user/profile` already
    // guards this way.
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { isDeleted: true },
    });

    if (!existing || existing.isDeleted) {
      return NextResponse.json(
        { error: "User profile was not found" },
        { status: 404 },
      );
    }

    try {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: {
          onboarded: true,
          ...toProfileUpdateData(data),
        },
        select: {
          id: true,
          name: true,
          onboarded: true,
          bio: true,
          location: true,
          homeLocation: true,
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

      return applyRateLimitHeaders(
        NextResponse.json({
          success: true,
          message: "Onboarding completed",
          profile: updated,
        }),
        rateLimit,
      ) as NextResponse;
    } catch (error) {
      console.error("Error during onboarding:", error);

      return NextResponse.json(
        { error: "Failed to complete onboarding" },
        { status: 500 },
      );
    }
  },
);
