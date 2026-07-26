import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { withValidation } from "@/lib/withValidation";

const BlockSchema = z.object({
  blockedId: z.string().min(1, "Blocked user ID required"),
});

export const POST = withValidation(BlockSchema, async (request, validatedData) => {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { blockedId } = validatedData;

    if (session.user.id === blockedId) {
      return NextResponse.json(
        { error: "You cannot block yourself" },
        { status: 400 }
      );
    }

    // Check if the target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: blockedId },
    });

    if (!targetUser) {
      return NextResponse.json(
        { error: "User to block not found" },
        { status: 404 }
      );
    }

    // Upsert or create Block record
    const existingBlock = await prisma.block.findUnique({
      where: {
        blockerId_blockedId: {
          blockerId: session.user.id,
          blockedId,
        },
      },
    });

    if (existingBlock) {
      return NextResponse.json({ success: true, message: "User is already blocked" });
    }

    await prisma.block.create({
      data: {
        blockerId: session.user.id,
        blockedId,
      },
    });

    return NextResponse.json({ success: true, message: "User blocked successfully" }, { status: 201 });
  } catch (error) {
    console.error("Error blocking user:", error);
    return NextResponse.json(
      { error: "Failed to block user" },
      { status: 500 }
    );
  }
});
