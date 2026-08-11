import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { z } from "zod";
import { withValidation } from "@/lib/withValidation";
import {
  applyRateLimitHeaders,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { enforceRateLimit } from "@/lib/rate-limit-rules";

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: z.string().min(8, "Password must be at least 8 characters long"),
});

export const POST = withValidation(resetPasswordSchema, async (req, data) => {
  try {
    const { token, password } = data;

    const rateLimit = await enforceRateLimit(req, "authResetPassword");

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit);
    }

    // Find the user with matching and unexpired reset token
    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpires: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      return applyRateLimitHeaders(
        NextResponse.json(
          { error: "Invalid or expired reset token" },
          { status: 400 }
        ),
        rateLimit,
      ) as NextResponse;
    }

    // Hash the new password
    const saltRounds = process.env.NODE_ENV === "production" ? 12 : 10;
    const passwordHash = await hash(password, saltRounds);

    // Update user password and clear reset token fields
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpires: null,
      },
    });

    return applyRateLimitHeaders(
      NextResponse.json({
        ok: true,
        message: "Password reset successful. You can now log in.",
      }),
      rateLimit,
    ) as NextResponse;
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json(
      { error: "Server error", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}, "Invalid inputs");
