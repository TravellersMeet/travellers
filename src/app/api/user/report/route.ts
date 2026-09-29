import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  applyRateLimitHeaders,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { enforceRateLimit } from "@/lib/rate-limit-rules";
import {
  DUPLICATE_REPORT_WINDOW_HOURS,
  MAX_REPORT_DETAILS_LENGTH,
  normalizeReportReason,
  REPORT_REASON_CODES,
} from "@/lib/report-reasons";
import { withValidation } from "@/lib/withValidation";

/**
 * `reason` used to be `z.string().min(1)` — any value, any length. It is now
 * resolved to one of the codes in `REPORT_REASONS`, which is what makes the
 * moderation queue groupable. `normalizeReportReason` also accepts the display
 * strings the previous version of the report form submitted, so a client
 * running the old bundle keeps working through a deploy.
 */
const ReportSchema = z.object({
  reportedId: z
    .string()
    .trim()
    .min(1, "Reported user ID required")
    .max(64, "Reported user ID is malformed"),
  reason: z
    .string()
    .min(1, "Reason for report required")
    .transform((value, ctx) => {
      const code = normalizeReportReason(value);

      if (!code) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Reason must be one of: ${REPORT_REASON_CODES.join(", ")}`,
        });
        return z.NEVER;
      }

      return code;
    }),
  details: z
    .string()
    .trim()
    .max(
      MAX_REPORT_DETAILS_LENGTH,
      `Details are too long (max ${MAX_REPORT_DETAILS_LENGTH} characters)`,
    )
    .optional(),
});

export const POST = withValidation(
  ReportSchema,
  async (request, validatedData) => {
    try {
      const session = await auth();

      if (!session?.user?.id) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401 },
        );
      }

      // Filing reports in bulk is itself an abuse vector against the
      // moderation queue, so this limit is deliberately tighter than the
      // others.
      const rateLimit = await enforceRateLimit(
        request,
        "userReport",
        session.user.id,
      );

      if (!rateLimit.allowed) {
        return rateLimitExceededResponse(rateLimit);
      }

      const { reportedId, reason, details } =
        validatedData;

      if (session.user.id === reportedId) {
        return applyRateLimitHeaders(
          NextResponse.json(
            { error: "You cannot report yourself" },
            { status: 400 },
          ),
          rateLimit,
        ) as NextResponse;
      }

      // Acknowledging an unknown target the same way as a real one. The old
      // 404 ("User to report not found") made this endpoint a yes/no oracle
      // for whether any given user id existed — the same leak /api/users was
      // hardened against when `email` came out of its search columns.
      const acknowledged = () =>
        applyRateLimitHeaders(
          NextResponse.json(
            { success: true },
            { status: 201 },
          ),
          rateLimit,
        ) as NextResponse;

      // Soft-deleted accounts are excluded: reports against them cannot be
      // actioned, so they only add noise to the queue.
      const targetUser = await prisma.user.findFirst({
        where: { id: reportedId, isDeleted: false },
        select: { id: true },
      });

      if (!targetUser) {
        return acknowledged();
      }

      const duplicateSince = new Date(
        Date.now() -
          DUPLICATE_REPORT_WINDOW_HOURS *
            60 *
            60 *
            1000,
      );

      const existingReport =
        await prisma.report.findFirst({
          where: {
            reporterId: session.user.id,
            reportedId,
            createdAt: { gte: duplicateSince },
          },
          select: { id: true },
        });

      if (existingReport) {
        return applyRateLimitHeaders(
          NextResponse.json(
            {
              error:
                "You have already reported this user recently. Our moderation team is reviewing it.",
              reportId: existingReport.id,
            },
            { status: 409 },
          ),
          rateLimit,
        ) as NextResponse;
      }

      const report = await prisma.report.create({
        data: {
          reporterId: session.user.id,
          reportedId,
          reason,
          details: details || null,
        },
      });

      return applyRateLimitHeaders(
        NextResponse.json(
          { success: true, reportId: report.id },
          { status: 201 },
        ),
        rateLimit,
      ) as NextResponse;
    } catch (error) {
      console.error("Error creating report:", error);
      return NextResponse.json(
        { error: "Failed to submit report" },
        { status: 500 },
      );
    }
  },
);
