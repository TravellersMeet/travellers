import { TicketStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { deleteCloudinaryAsset } from "@/lib/cloudinary-delete";
import { uploadFileToCloudinary } from "@/lib/cloudinary-upload";
import { getUtcDateRange } from "@/lib/date-range";
import {
  claimIdempotencyKey,
  releaseIdempotencyClaim,
  storeIdempotencyResult,
} from "@/lib/idempotency";
import { normalizeDestination } from "@/lib/normalize-destination";
import {
  buildTimestampCursorWhere,
  createPaginatedResponse,
  PaginationError,
  parsePaginationParams,
} from "@/lib/pagination";
import prisma from "@/lib/prisma";
import { withValidation } from "@/lib/withValidation";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

const ACTIVE_DUPLICATE_STATUSES: TicketStatus[] = [
  TicketStatus.PENDING,
  TicketStatus.VERIFIED,
];

const ticketSchema = z.object({
  destination: z
    .string()
    .trim()
    .min(1, "Destination required"),
  departureDate: z.string().refine(
    (date) => {
      try {
        getUtcDateRange(date);
        return true;
      } catch {
        return false;
      }
    },
    {
      message: "Invalid date format",
    },
  ),
  file: z
    .any()
    .refine(
      (value) => value instanceof File,
      "File required",
    )
    .refine(
      (value) =>
        value instanceof File && value.size > 0,
      "File required",
    )
    .refine(
      (value) =>
        value instanceof File &&
        value.size <= MAX_FILE_SIZE,
      "File size exceeds 10MB",
    )
    .refine(
      (value) =>
        value instanceof File &&
        ALLOWED_TYPES.includes(value.type),
      "Unsupported file type",
    ),
});

async function findDuplicateTicket(
  userId: string,
  destination: string,
  departureDate: string,
) {
  const normalizedDestination =
    normalizeDestination(destination);
  const { start, end } =
    getUtcDateRange(departureDate);

  const candidates = await prisma.ticket.findMany({
    where: {
      userId,
      status: {
        in: ACTIVE_DUPLICATE_STATUSES,
      },
      departureDate: {
        gte: start,
        lt: end,
      },
    },
    select: {
      id: true,
      destination: true,
    },
  });

  return candidates.find(
    (ticket) =>
      normalizeDestination(ticket.destination) ===
      normalizedDestination,
  );
}

export const POST = withValidation(
  ticketSchema,
  async (request, data) => {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const userId = session.user.id;

    let idempotencyClaim: Awaited<
      ReturnType<typeof claimIdempotencyKey>
    >;

    try {
      idempotencyClaim =
        await claimIdempotencyKey(
          userId,
          request.headers.get("Idempotency-Key"),
        );
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid Idempotency-Key",
        },
        { status: 400 },
      );
    }

    if (idempotencyClaim.state === "replay") {
      return NextResponse.json(
        idempotencyClaim.result.body,
        {
          status: idempotencyClaim.result.status,
          headers: {
            "Idempotency-Replayed": "true",
          },
        },
      );
    }

    if (idempotencyClaim.state === "in_progress") {
      return NextResponse.json(
        {
          error:
            "A request with this Idempotency-Key is already being processed",
        },
        {
          status: 409,
          headers: {
            "Retry-After": "2",
          },
        },
      );
    }

    let uploadedPublicId: string | null = null;

    try {
      const duplicate = await findDuplicateTicket(
        userId,
        data.destination,
        data.departureDate,
      );

      if (duplicate) {
        const body = {
          error:
            "A ticket for this destination and departure date already exists",
          ticketId: duplicate.id,
        };

        await storeIdempotencyResult(
          idempotencyClaim,
          {
            status: 409,
            body,
          },
        );

        return NextResponse.json(body, {
          status: 409,
        });
      }

      const uploaded = await uploadFileToCloudinary(
        data.file,
        "travellers/tickets",
      );

      uploadedPublicId = uploaded.publicId;

      const departureDate =
        getUtcDateRange(data.departureDate).start;

      const ticket = await prisma.ticket.create({
        data: {
          userId,
          destination: data.destination.trim(),
          departureDate,
          ticketUrl: uploaded.url,
          status: TicketStatus.PENDING,
        },
      });

      const body = {
        ok: true,
        ticket,
      };

      await storeIdempotencyResult(
        idempotencyClaim,
        {
          status: 201,
          body,
        },
      );

      return NextResponse.json(body, {
        status: 201,
      });
    } catch (error) {
      if (uploadedPublicId) {
        try {
          await deleteCloudinaryAsset(
            uploadedPublicId,
          );
        } catch (cleanupError) {
          console.error(
            "Cloudinary cleanup failed after ticket creation error:",
            cleanupError instanceof Error
              ? cleanupError.message
              : cleanupError,
          );
        }
      }

      await releaseIdempotencyClaim(
        idempotencyClaim,
      );

      console.error(
        "Ticket upload failed:",
        error instanceof Error
          ? error.message
          : error,
      );

      return NextResponse.json(
        {
          error: "Failed to upload ticket",
        },
        { status: 500 },
      );
    }
  },
);

// Get user's paginated tickets
export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const { limit, cursor } = parsePaginationParams(
      request.nextUrl.searchParams,
    );

    const cursorWhere = buildTimestampCursorWhere(
      "createdAt",
      cursor,
    );

    const tickets = await prisma.ticket.findMany({
      where: {
        userId: session.user.id,
        ...(cursorWhere ?? {}),
      },
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: limit + 1,
    });

    const result = createPaginatedResponse(
      tickets,
      limit,
      "createdAt",
    );

    return NextResponse.json({
      ...result,
      tickets: result.items,
    });
  } catch (error) {
    if (error instanceof PaginationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      );
    }

    console.error("Fetch tickets error:", error);

    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}