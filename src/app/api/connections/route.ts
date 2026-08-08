import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { isBlockedBetween } from "@/lib/blocking";
import { rateLimitExceededResponse } from "@/lib/rate-limit";
import { enforceRateLimit } from "@/lib/rate-limit-rules";
import { triggerPusher } from "@/lib/pusher";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    const incoming = await prisma.connectionRequest.findMany({
      where: {
        receiverId: userId,
        status: "PENDING",
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            image: true,
            bio: true,
            location: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const outgoing = await prisma.connectionRequest.findMany({
      where: {
        senderId: userId,
        status: "PENDING",
      },
      include: {
        receiver: {
          select: {
            id: true,
            name: true,
            image: true,
            bio: true,
            location: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const accepted = await prisma.connectionRequest.findMany({
      where: {
        status: "ACCEPTED",
        OR: [
          { senderId: userId },
          { receiverId: userId },
        ],
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            image: true,
            bio: true,
            location: true,
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            image: true,
            bio: true,
            location: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    // Map accepted requests to connection objects representing the other user
    const connections = accepted.map((req) => {
      const otherUser = req.senderId === userId ? req.receiver : req.sender;
      return {
        requestId: req.id,
        user: otherUser,
        connectedAt: req.updatedAt,
      };
    });

    return NextResponse.json({
      incoming,
      outgoing,
      connections,
    });
  } catch (error) {
    console.error("Fetch connections error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const currentUserId = session.user.id;

  // A `send` writes a notification and pushes an event onto somebody else's
  // channel, which makes this the spam-facing endpoint of the pair.
  const rateLimit = await enforceRateLimit(
    req,
    "connectionAction",
    currentUserId,
  );

  if (!rateLimit.allowed) {
    return rateLimitExceededResponse(rateLimit);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { action, userId } = body;

  if (!action || !userId) {
    return NextResponse.json({ error: "action and userId are required" }, { status: 400 });
  }

  if (userId === currentUserId) {
    return NextResponse.json({ error: "Cannot connect with yourself" }, { status: 400 });
  }

  try {
    if (action === "send") {
      // Blocks are two-way: don't allow a request if either user has blocked
      // the other.
      if (await isBlockedBetween(currentUserId, userId)) {
        return NextResponse.json(
          { error: "Unable to send a connection request to this user" },
          { status: 403 }
        );
      }

      // Check for existing connection request
      const existing = await prisma.connectionRequest.findFirst({
        where: {
          OR: [
            { senderId: currentUserId, receiverId: userId },
            { senderId: userId, receiverId: currentUserId },
          ],
        },
      });

      if (existing) {
        if (existing.status === "ACCEPTED") {
          return NextResponse.json({ error: "Already connected" }, { status: 400 });
        }
        if (existing.status === "PENDING") {
          return NextResponse.json({ error: "Connection request already pending" }, { status: 400 });
        }
        // If it was declined, we let them send a new request by resetting/updating it
        if (existing.status === "DECLINED") {
          const updated = await prisma.connectionRequest.update({
            where: { id: existing.id },
            data: {
              senderId: currentUserId,
              receiverId: userId,
              status: "PENDING",
            },
            include: {
              sender: {
                select: { id: true, name: true, image: true },
              },
            },
          });

          await triggerPusher(`private-user-${userId}`, "connection-request", {
            request: updated,
          });

          return NextResponse.json({ success: true, request: updated });
        }
      }

      const newRequest = await prisma.connectionRequest.create({
        data: {
          senderId: currentUserId,
          receiverId: userId,
          status: "PENDING",
        },
        include: {
          sender: {
            select: { id: true, name: true, image: true },
          },
        },
      });

      await triggerPusher(`private-user-${userId}`, "connection-request", {
        request: newRequest,
      });

      return NextResponse.json({ success: true, request: newRequest });
    }

    if (action === "accept") {
      const request = await prisma.connectionRequest.findUnique({
        where: {
          senderId_receiverId: {
            senderId: userId,
            receiverId: currentUserId,
          },
        },
      });

      if (!request || request.status !== "PENDING") {
        return NextResponse.json({ error: "No pending connection request found" }, { status: 404 });
      }

      // A block may have been created after the request was sent. Accepting it
      // would open a conversation between two people who cannot message each
      // other, so refuse instead of creating a dead thread.
      if (await isBlockedBetween(currentUserId, userId)) {
        return NextResponse.json(
          { error: "Unable to accept a connection request from this user" },
          { status: 403 }
        );
      }

      // Update connection request
      await prisma.connectionRequest.update({
        where: { id: request.id },
        data: { status: "ACCEPTED" },
      });

      // Create conversation (or find if somehow exists already)
      let conversation = await prisma.conversation.findFirst({
        where: {
          AND: [
            { users: { some: { id: currentUserId } } },
            { users: { some: { id: userId } } },
          ],
        },
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            users: {
              connect: [
                { id: currentUserId },
                { id: userId },
              ],
            },
          },
        });
      }

      await triggerPusher(`private-user-${userId}`, "connection-accepted", {
        conversationId: conversation.id,
        connectedUser: {
          id: currentUserId,
          name: session.user.name || "A traveler",
        },
      });

      return NextResponse.json({ success: true, conversationId: conversation.id });
    }

    if (action === "decline") {
      const request = await prisma.connectionRequest.findUnique({
        where: {
          senderId_receiverId: {
            senderId: userId,
            receiverId: currentUserId,
          },
        },
      });

      if (!request || request.status !== "PENDING") {
        return NextResponse.json({ error: "No pending connection request found" }, { status: 404 });
      }

      const updated = await prisma.connectionRequest.update({
        where: { id: request.id },
        data: { status: "DECLINED" },
      });

      return NextResponse.json({ success: true, request: updated });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Connection action error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
