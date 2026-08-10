import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deleteNotification } from "@/lib/notifications";
import prisma from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const notification = await prisma.notification.findFirst({
      where: {
        id: params.id,
        userId: session.user.id,
      },
    });

    if (!notification) {
      return NextResponse.json(
        { error: "Notification not found" },
        { status: 404 }
      );
    }

    const updated = await prisma.notification.update({
      where: {
        id: params.id,
      },
      data: {
        read: true,
      },
    });

    return NextResponse.json({
      ok: true,
      notification: updated,
    });
  } catch (error) {
    console.error("Notification update error:", error);

    return NextResponse.json(
      { error: "Failed to update notification" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/notifications/[id]
 *
 * Dismiss a single notification. The list had no removal path at all, so a
 * notification for a connection request that has since been declined stayed in
 * the bell forever.
 *
 * The delete is scoped by `userId` in the same statement as the id, so a
 * caller cannot remove somebody else's row by guessing an id — a foreign or
 * missing id deletes nothing and is reported as 404.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const deleted = await deleteNotification(
      params.id,
      session.user.id
    );

    if (deleted === 0) {
      return NextResponse.json(
        { error: "Notification not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Notification delete error:", error);

    return NextResponse.json(
      { error: "Failed to delete notification" },
      { status: 500 }
    );
  }
}
