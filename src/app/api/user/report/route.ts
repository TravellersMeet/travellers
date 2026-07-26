import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { withValidation } from "@/lib/withValidation";

const ReportSchema = z.object({
  reportedId: z.string().min(1, "Reported user ID required"),
  reason: z.string().min(1, "Reason for report required"),
  details: z.string().optional(),
});

export const POST = withValidation(ReportSchema, async (request, validatedData) => {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { reportedId, reason, details } = validatedData;

    if (session.user.id === reportedId) {
      return NextResponse.json(
        { error: "You cannot report yourself" },
        { status: 400 }
      );
    }

    // Check if the target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: reportedId },
    });

    if (!targetUser) {
      return NextResponse.json(
        { error: "User to report not found" },
        { status: 404 }
      );
    }

    // Create Report record
    const report = await prisma.report.create({
      data: {
        reporterId: session.user.id,
        reportedId,
        reason,
        details: details || null,
      },
    });

    return NextResponse.json({ success: true, reportId: report.id }, { status: 201 });
  } catch (error) {
    console.error("Error creating report:", error);
    return NextResponse.json(
      { error: "Failed to submit report" },
      { status: 500 }
    );
  }
});
