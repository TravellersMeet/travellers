import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
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

const signupSchema = z.object({
  name: z.string().min(1, "Name required"),
  email: z.string().email("Invalid email"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters"),
});

export const POST = withValidation(
  signupSchema,
  async (_req, data) => {
    try {
      const { name, email, password } = data;

      const rateLimit = await checkRateLimit({
        namespace: "auth:signup",
        identifier: getRateLimitIdentifier(_req, email),
        limit: 5,
        windowSeconds: 60 * 60,
      });

      if (!rateLimit.allowed) {
        return rateLimitExceededResponse(rateLimit);
      }

      // Check whether a user already exists with this email.
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        return applyRateLimitHeaders(
          NextResponse.json(
            { error: "Email already in use" },
            { status: 400 },
          ),
          rateLimit,
        ) as NextResponse;
      }

      // Use stronger password hashing in production while keeping
      // development and test execution reasonably fast.
      const saltRounds =
        process.env.NODE_ENV === "production" ? 12 : 10;

      const passwordHash = await hash(password, saltRounds);

      // Generate an OTP that expires after 10 minutes.
      const otp = generateOTP();
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

      // Create the user in an unverified state.
      const user = await prisma.user.create({
        data: {
          name,
          email,
          passwordHash,
          otp,
          otpExpires,
        },
      });

      // Send the verification OTP.
      const emailResult = await sendOTPEmail(email, otp);

      if (!emailResult.success) {
        console.error(
          "Signup email error:",
          emailResult.error,
        );

        return applyRateLimitHeaders(
          NextResponse.json(
            {
              ok: true,
              userId: user.id,
              error:
                "Account created, but we couldn't send the verification email. Please use 'Resend OTP' or contact support.",
            },
            { status: 207 },
          ),
          rateLimit,
        ) as NextResponse;
      }

      return applyRateLimitHeaders(
        NextResponse.json({
          ok: true,
          userId: user.id,
          message: "OTP sent to your email",
        }),
        rateLimit,
      ) as NextResponse;
    } catch (error) {
      console.error("Signup error:", error);

      return NextResponse.json(
        {
          error: "Server error",
          message:
            error instanceof Error
              ? error.message
              : "Unknown error",
        },
        { status: 500 },
      );
    }
  },
);