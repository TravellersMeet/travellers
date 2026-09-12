import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  canResendOTP,
  generateOTP,
  hashOTP,
  OTP_TTL_MS,
} from "@/lib/otp";
import { sendOTPEmail } from "@/lib/email";
import { withValidation } from "@/lib/withValidation";
import {
  applyRateLimitHeaders,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { enforceRateLimit } from "@/lib/rate-limit-rules";

const resendSchema = z.object({
  email: z.string().email("Invalid email"),
});

/**
 * The single response this route gives, whatever the outcome.
 *
 * It used to answer in three distinguishable ways — 404 for an unknown
 * address, 400 for an already-verified one, 200 for an unverified one — which
 * made it an oracle for whether an address had an account and what state it
 * was in. The third bucket is the damaging one: it identifies half-finished
 * signups, whose owners are already expecting an OTP mail.
 *
 * /api/auth/forgot-password has always behaved this way; these two routes were
 * never brought in line.
 */
const GENERIC_RESPONSE = {
  ok: true,
  message:
    "If an unverified account exists for this email, a new code has been sent.",
} as const;

export const POST = withValidation(
  resendSchema,
  async (req, data) => {
    try {
      const { email } = data;

      const rateLimit = await enforceRateLimit(
        req,
        "authResendOtp",
        email,
      );

      if (!rateLimit.allowed) {
        return rateLimitExceededResponse(rateLimit);
      }

      const genericResponse = () =>
        applyRateLimitHeaders(
          NextResponse.json(GENERIC_RESPONSE),
          rateLimit,
        ) as NextResponse;

      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          emailVerified: true,
          otpExpires: true,
        },
      });

      // No account, or one that has already verified. Nothing to send, and
      // the caller must not be able to tell those apart from a real send.
      if (!user || user.emailVerified) {
        return genericResponse();
      }

      // A cooldown derived from stored state, rather than from the request
      // limiter. The limiter keys on `email|ip`, so rotating source addresses
      // multiplies it — and it fails open when Redis is unreachable. This
      // bounds how often one mailbox can be written to no matter where the
      // requests come from.
      const resend = canResendOTP(user.otpExpires);

      if (!resend.allowed) {
        return genericResponse();
      }

      const otp = generateOTP();
      const otpExpires = new Date(
        Date.now() + OTP_TTL_MS,
      );

      await prisma.user.update({
        where: { email },
        data: { otp: hashOTP(otp), otpExpires },
      });

      // A mail failure must not change the response either — a delivery error
      // for a real address would otherwise re-open the oracle.
      try {
        await sendOTPEmail(email, otp);
      } catch (emailError) {
        console.error(
          "Resend OTP email error (non-fatal):",
          emailError,
        );
      }

      return genericResponse();
    } catch (error) {
      console.error("Resend OTP error:", error);
      return NextResponse.json(
        { error: "Server error" },
        { status: 500 },
      );
    }
  },
);
