import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isValidOTPFormat } from "@/lib/otp";
import { withValidation } from "@/lib/withValidation";
import {
  applyRateLimitHeaders,
  checkRateLimit,
  getRateLimitIdentifier,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";

const verifySchema = z.object({
  email: z.string().email("Invalid email"),
  otp: z.string().length(6, "OTP must be 6 digits"),
});

export const POST = withValidation(verifySchema, async (req, data) => {
  try {
    const { email, otp } = data;

    const rateLimit = await checkRateLimit({
      namespace: "auth:verify-otp",
      identifier: getRateLimitIdentifier(req, email),
      limit: 10,
      windowSeconds: 10 * 60,
    });

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit);
    }

    if (!isValidOTPFormat(otp)) {
      return applyRateLimitHeaders(
        NextResponse.json(
          { error: "Invalid OTP format" },
          { status: 400 },
        ),
        rateLimit,
      ) as NextResponse;
    }

    // Find user
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return applyRateLimitHeaders(
        NextResponse.json(
          { error: "User not found" },
          { status: 404 },
        ),
        rateLimit,
      ) as NextResponse;
    }

    // Check if already verified
    if (user.emailVerified) {
      return applyRateLimitHeaders(
        NextResponse.json(
          { error: "Email already verified" },
          { status: 400 },
        ),
        rateLimit,
      ) as NextResponse;
    }

    // Check OTP
    if (!user.otp || !user.otpExpires) {
      return applyRateLimitHeaders(
        NextResponse.json(
          { error: "No OTP found. Please request a new one." },
          { status: 400 },
        ),
        rateLimit,
      ) as NextResponse;
    }

    // Check if expired
    if (new Date() > user.otpExpires) {
      return applyRateLimitHeaders(
        NextResponse.json(
          { error: "OTP has expired. Please request a new one." },
          { status: 400 },
        ),
        rateLimit,
      ) as NextResponse;
    }

    // Verify OTP
    if (user.otp !== otp) {
      return applyRateLimitHeaders(
        NextResponse.json(
          { error: "Invalid OTP" },
          { status: 400 },
        ),
        rateLimit,
      ) as NextResponse;
    }

    // Mark as verified and clear OTP
    await prisma.user.update({
      where: { email },
      data: {
        emailVerified: true,
        otp: null,
        otpExpires: null,
      },
    });

    return applyRateLimitHeaders(
      NextResponse.json({
        ok: true,
        message: "Email verified successfully",
      }),
      rateLimit,
    ) as NextResponse;
  } catch (error) {
    console.error("Verify OTP error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
});
