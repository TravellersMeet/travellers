import { NextResponse, NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  hashPassword,
  verifyOptionalPassword,
} from "@/lib/password";
import {
  applyRateLimitHeaders,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { enforceRateLimit } from "@/lib/rate-limit-rules";
import { z } from "zod";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // This endpoint takes the current password, which makes it a password
    // oracle for anybody holding a session cookie — and an unthrottled one,
    // while /api/auth/signin next door is throttled. Keyed on the account so
    // one user's mistyping cannot lock another out from a shared IP.
    const rateLimit = await enforceRateLimit(
      req,
      "authChangePassword",
      session.user.email,
    );

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit);
    }

    const body = await req.json();
    const result = changePasswordSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid input", details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { currentPassword, newPassword } = result.data;

    // An account that has been through deleteUserAccount() should not be able
    // to rotate its credentials.
    const user = await prisma.user.findFirst({
      where: {
        email: session.user.email,
        isDeleted: false,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Runs a comparison even when passwordHash is null, so the OAuth-account
    // branch below costs the same as a wrong password rather than returning
    // instantly.
    const isCurrentPasswordCorrect = await verifyOptionalPassword(
      currentPassword,
      user.passwordHash
    );

    // Check if the user is an OAuth user (no passwordHash)
    if (!user.passwordHash) {
      return applyRateLimitHeaders(
        NextResponse.json(
          { error: "Accounts authenticated via Google/Apple cannot change passwords directly" },
          { status: 400 }
        ),
        rateLimit
      ) as NextResponse;
    }

    if (!isCurrentPasswordCorrect) {
      return applyRateLimitHeaders(
        NextResponse.json(
          { error: "Incorrect current password" },
          { status: 400 }
        ),
        rateLimit
      ) as NextResponse;
    }

    // Reporting success for a password that did not change is misleading —
    // a user rotating a leaked password would walk away believing they had.
    if (currentPassword === newPassword) {
      return applyRateLimitHeaders(
        NextResponse.json(
          { error: "New password must be different from the current one" },
          { status: 400 }
        ),
        rateLimit
      ) as NextResponse;
    }

    // Cost factor comes from src/lib/password.ts. It used to be a hardcoded
    // 10 here while signup and reset-password used 12 in production, so
    // changing a password silently weakened the stored hash.
    const newPasswordHash = await hashPassword(newPassword);

    // Update user in DB
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newPasswordHash },
    });

    return applyRateLimitHeaders(
      NextResponse.json({ ok: true, message: "Password updated successfully" }),
      rateLimit
    ) as NextResponse;
  } catch (error) {
    console.error("Change password error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
