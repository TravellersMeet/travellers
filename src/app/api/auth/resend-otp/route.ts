import prisma from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateOTP } from "@/lib/otp";
import { sendOTPEmail } from "@/lib/email";
import { withValidation } from "@/lib/withValidation";
import {
  applyRateLimitHeaders,
  checkRateLimit,
  getRateLimitIdentifier,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";

const resendSchema = z.object({
  email: z.string().email("Invalid email"),
});

export const POST = withValidation(resendSchema, async (req, data) => {
  try {
    const { email } = data;

    const rateLimit = await checkRateLimit({
      namespace: "auth:resend-otp",
      identifier: getRateLimitIdentifier(req, email),
      limit: 3,
      windowSeconds: 10 * 60,
    });

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit);
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

    // Generate new OTP
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Update user with new OTP
    await prisma.user.update({
      where: { email },
      data: { otp, otpExpires },
    });

    // Send OTP email
    await sendOTPEmail(email, otp);

    return applyRateLimitHeaders(
      NextResponse.json({
        ok: true,
        message: "New OTP sent to your email",
      }),
      rateLimit,
    ) as NextResponse;
  } catch (error) {
    console.error("Resend OTP error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
});
