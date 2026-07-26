import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withValidation } from "@/lib/withValidation";
import { uploadFileToCloudinary } from "@/lib/cloudinary-upload";
import {
  buildTimestampCursorWhere,
  createPaginatedResponse,
  PaginationError,
  parsePaginationParams,
} from "@/lib/pagination";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

const ticketSchema = z.object({
  destination: z
    .string()
    .min(1, "Destination required"),
  departureDate: z
    .string()
    .refine(
      (date) => !Number.isNaN(Date.parse(date)),
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

export const POST = withValidation(
  ticketSchema,
  async (_request, data) => {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    try {
      const uploaded = await uploadFileToCloudinary(
        data.file,
        "travellers/tickets",
      );

      const ticket = await prisma.ticket.create({
        data: {
          userId: session.user.id,
          destination: data.destination,
          departureDate: new Date(
            data.departureDate,
          ),
          ticketUrl: uploaded.url,
          status: "PENDING",
        },
      });

      return NextResponse.json({
        ok: true,
        ticket,
      });
    } catch (error) {
      console.error("Ticket upload error:", error);
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to upload ticket",
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
      // Alias retained for existing API consumers.
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
