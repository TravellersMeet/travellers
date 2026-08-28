import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  isMockAuthAllowed,
  pusherServer,
} from "@/lib/pusher";
import {
  applyRateLimitHeaders,
  rateLimitExceededResponse,
} from "@/lib/rate-limit";
import { enforceRateLimit } from "@/lib/rate-limit-rules";
import { withValidation } from "@/lib/withValidation";

/**
 * Pusher's own limits. A channel name is at most 164 characters and a socket
 * id looks like `123.456`. Bounding both here means a malformed request is
 * rejected before it costs a database round trip — this used to be
 * `z.string()` with no ceiling, so a multi-megabyte channel name was accepted,
 * hashed for the rate-limit key and handed to `authorizeChannel`.
 */
const MAX_CHANNEL_NAME_LENGTH = 164;
const SOCKET_ID_PATTERN = /^\d+\.\d+$/;

/**
 * The two channel families this app uses, as anchored patterns.
 *
 * The previous check was `startsWith(prefix)` followed by
 * `replace(prefix, "")`, which does not express the grammar: `"private-user-"`
 * parsed to an empty id, and `"private-user-private-user-x"` stripped only the
 * leading occurrence. Neither was exploitable because the equality check below
 * caught them, but the safety came from a coincidence rather than the parse.
 */
const USER_CHANNEL_PATTERN = /^private-user-([A-Za-z0-9_-]{1,128})$/;
const CHAT_CHANNEL_PATTERN = /^private-chat-([A-Za-z0-9_-]{1,128})$/;

const pusherAuthSchema = z.object({
  socket_id: z
    .string()
    .trim()
    .min(1, "socket_id is required")
    .max(64, "socket_id is too long")
    .regex(SOCKET_ID_PATTERN, "socket_id is malformed"),
  channel_name: z
    .string()
    .trim()
    .min(1, "channel_name is required")
    .max(
      MAX_CHANNEL_NAME_LENGTH,
      `channel_name is too long (max ${MAX_CHANNEL_NAME_LENGTH} characters)`,
    ),
});

export const POST = withValidation(
  pusherAuthSchema,
  async (req, data) => {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const userId = session.user.id;
    const { socket_id, channel_name } = data;

    // Every branch below runs at least one query, and a client reconnecting
    // normally authorises a handful of channels — not hundreds. Without this,
    // looping over guessed conversation ids was a free database scan and a
    // membership oracle.
    const rateLimit = await enforceRateLimit(
      req,
      "pusherAuth",
      userId,
    );

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit);
    }

    const forbidden = () =>
      applyRateLimitHeaders(
        NextResponse.json(
          { error: "Forbidden" },
          { status: 403 },
        ),
        rateLimit,
      ) as NextResponse;

    // A soft-deleted account keeps a valid session token until it expires.
    // The rest of the API filters on `isDeleted: false`; without the same
    // check here a deleted user keeps receiving realtime traffic.
    const account = await prisma.user.findFirst({
      where: { id: userId, isDeleted: false },
      select: { id: true },
    });

    if (!account) {
      return forbidden();
    }

    const userChannel =
      USER_CHANNEL_PATTERN.exec(channel_name);
    const chatChannel =
      CHAT_CHANNEL_PATTERN.exec(channel_name);

    if (userChannel) {
      if (userChannel[1] !== userId) {
        return forbidden();
      }
    } else if (chatChannel) {
      const conversation =
        await prisma.conversation.findFirst({
          where: {
            id: chatChannel[1],
            users: { some: { id: userId } },
          },
          select: { id: true },
        });

      if (!conversation) {
        return forbidden();
      }
    } else {
      return applyRateLimitHeaders(
        NextResponse.json(
          { error: "Invalid channel name" },
          { status: 400 },
        ),
        rateLimit,
      ) as NextResponse;
    }

    if (!pusherServer) {
      if (!isMockAuthAllowed()) {
        // Fail closed. The client gets a real error it can surface and retry
        // against, instead of a signature that will be rejected downstream.
        return applyRateLimitHeaders(
          NextResponse.json(
            {
              error:
                "Realtime messaging is unavailable",
            },
            { status: 503 },
          ),
          rateLimit,
        ) as NextResponse;
      }

      // Deliberately carries no user id: the old body was
      // `mock-auth-signature-for-<userId>`, which put an account identifier
      // into a token-shaped field that logs and caches would retain.
      return applyRateLimitHeaders(
        NextResponse.json({
          auth: "mock-auth-signature",
          mock: true,
        }),
        rateLimit,
      ) as NextResponse;
    }

    try {
      const authResponse =
        pusherServer.authorizeChannel(
          socket_id,
          channel_name,
        );

      return applyRateLimitHeaders(
        NextResponse.json(authResponse),
        rateLimit,
      ) as NextResponse;
    } catch (error) {
      console.error("Pusher auth error:", error);

      return applyRateLimitHeaders(
        NextResponse.json(
          { error: "Pusher authorization failed" },
          { status: 500 },
        ),
        rateLimit,
      ) as NextResponse;
    }
  },
);
