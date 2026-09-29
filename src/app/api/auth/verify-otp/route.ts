import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidOTPFormat, verifyOTP } from "@/lib/otp";
import { withValidation } from "@/lib/withValidation";
import {
  applyRateLimitHeaders,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { enforceRateLimit } from "@/lib/rate-limit-rules";

const verifySchema = z.object({
  email: z.string().email("Invalid email"),
  otp: z.string().length(6, "OTP must be 6 digits"),
});

/**
 * One message for every failure.
 *
 * The route used to distinguish "User not found" (404) from "No OTP found",
 * "OTP has expired" and "Invalid OTP" (all 400). Together those told an
 * unauthenticated caller whether an address had an account and whether a code
 * was currently outstanding for it. The user cannot act differently on any of
 * these — the remedy is always "request a new code" — so the distinction only
 * ever helped an enumerator.
 */
const INVALID_MESSAGE =
  "Invalid or expired code. Please request a new one.";

export const POST = withValidation(
  verifySchema,
  async (req, data) => {
    try {
      const { email, otp } = data;

      const rateLimit = await enforceRateLimit(
        req,
        "authVerifyOtp",
        email,
      );

      if (!rateLimit.allowed) {
        return rateLimitExceededResponse(rateLimit);
      }

      // A second ceiling keyed on the email alone. The rule above includes the
      // IP, so guessing a six-digit code was a matter of rotating source
      // addresses: 10 attempts per address, unbounded in aggregate. This one
      // follows the account.
      const accountLimit = await enforceRateLimit(
        req,
        "authVerifyOtpAccount",
        email,
        { scope: "subject" },
      );

      if (!accountLimit.allowed) {
        return rateLimitExceededResponse(accountLimit);
      }

      const invalid = () =>
        applyRateLimitHeaders(
          NextResponse.json(
            { error: INVALID_MESSAGE },
            { status: 400 },
          ),
          rateLimit,
        ) as NextResponse;

      if (!isValidOTPFormat(otp)) {
        return invalid();
      }

      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          emailVerified: true,
          otp: true,
          otpExpires: true,
        },
      });

      if (!user) {
        return invalid();
      }

      // Also generic. This branch runs *before* the code is compared, so
      // keeping its own message ("Email already verified") would answer
      // "does this address have a verified account?" to anyone submitting a
      // random six digits — the same oracle, one branch further down.
      //
      // A verified account has had its `otp` cleared anyway, so a legitimate
      // double-submit would land on the `!user.otp` check below and get this
      // same message either way.
      if (user.emailVerified) {
        return invalid();
      }

      if (!user.otp || !user.otpExpires) {
        return invalid();
      }

      if (new Date() > user.otpExpires) {
        return invalid();
      }

      // Constant-time comparison against the stored hash.
      if (!verifyOTP(otp, user.otp)) {
        return invalid();
      }

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
      return NextResponse.json(
        { error: "Server error" },
        { status: 500 },
      );
    }
  },
);
