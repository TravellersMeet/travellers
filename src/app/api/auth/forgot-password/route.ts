import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { sendPasswordResetEmail } from "@/lib/email";
import { withValidation } from "@/lib/withValidation";
import {
  applyRateLimitHeaders,
  checkRateLimit,
  getRateLimitIdentifier,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const POST = withValidation(forgotPasswordSchema, async (req, data) => {
  try {
    const { email } = data;

    const rateLimit = await checkRateLimit({
      namespace: "auth:forgot-password",
      identifier: getRateLimitIdentifier(req, email),
      limit: 3,
      windowSeconds: 15 * 60,
    });

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit);
    }

    // Find user
    const user = await prisma.user.findUnique({ where: { email } });

    // To prevent email enumeration, return a generic success message even if email doesn't exist
    if (!user) {
      return applyRateLimitHeaders(
        NextResponse.json({
          ok: true,
          message: "If an account exists with this email, a password reset link has been sent.",
        }),
        rateLimit,
      ) as NextResponse;
    }

    // Generate secure reset token and expiry (1 hour)
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Update user record
    await prisma.user.update({
      where: { email },
      data: {
        resetToken,
        resetTokenExpires,
      },
    });

    // Send email
    try {
      await sendPasswordResetEmail(email, resetToken);
    } catch (emailError) {
      console.error("Forgot password email error (non-fatal):", emailError);
    }

    return applyRateLimitHeaders(
      NextResponse.json({
        ok: true,
        message: "If an account exists with this email, a password reset link has been sent.",
      }),
      rateLimit,
    ) as NextResponse;
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json(
      { error: "Server error", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}, "Invalid email input");
