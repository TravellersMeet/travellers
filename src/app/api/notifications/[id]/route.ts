import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  deleteNotification,
  markNotificationAsRead,
} from "@/lib/notifications";

/**
 * PATCH /api/notifications/[id]
 *
 * Mark one notification as read.
 *
 * This is the canonical handler; /api/notifications/[id]/read re-exports it
 * so the two endpoints cannot drift again. They were separate copies of the
 * same `findFirst`-then-`update` pair returning two different body shapes
 * (`{ ok, notification }` and `{ success }`), and the bell called both.
 */
export async function PATCH(
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
    const notification = await markNotificationAsRead(
      params.id,
      session.user.id
    );

    if (!notification) {
      return NextResponse.json(
        { error: "Notification not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      // Retained so a client reading either of the two previous shapes keeps
      // working.
      success: true,
      notification,
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
