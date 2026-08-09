import type { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import {
  API_ERROR_CODES,
  logApiError,
} from "@/lib/api-error";
import {
  apiError,
  apiJson,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import {
  buildTimestampCursorWhere,
  createPaginatedResponse,
  PaginationError,
  parsePaginationParams,
} from "@/lib/pagination";
import { invalidateMatchCachesForTicket } from "@/lib/match-cache";
import { createNotification } from "@/lib/notifications";
import prisma from "@/lib/prisma";
import { getRequestId } from "@/lib/request-id";
import { z } from "zod";

interface RouteContext {
  params: {
    id: string;
  };
}

const updateSchema = z.object({
  status: z.enum(["VERIFIED", "REJECTED"]),
  reason: z.string().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: RouteContext,
) {
  const requestId = getRequestId(request);
  const session = await auth();

  if (!session?.user?.id) {
    return apiError(
      requestId,
      API_ERROR_CODES.UNAUTHORIZED,
      "Authentication is required",
      401,
    );
  }

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: session.user.id,
      },
      select: {
        role: true,
      },
    });

    if (user?.role !== "ADMIN") {
      return apiError(
        requestId,
        API_ERROR_CODES.FORBIDDEN,
        "Administrator access is required",
        403,
      );
    }

    const body = await request.json();
    const result = updateSchema.safeParse(body);

    if (!result.success) {
      return apiError(
        requestId,
        API_ERROR_CODES.VALIDATION_ERROR,
        "Invalid request data",
        400,
        {
          status: result.success ? [] : ["Status must be VERIFIED or REJECTED"],
          reason: result.success ? [] : ["Reason is required for REJECTED status"],
        },
      );
    }

    const { status, reason } = result.data;

    if (status === "REJECTED" && !reason) {
      return apiError(
        requestId,
        API_ERROR_CODES.VALIDATION_ERROR,
        "Reason is required for rejection",
        400,
        {
          reason: ["Reason is required for REJECTED status"],
        },
      );
    }

    const existingTicket = await prisma.ticket.findUnique({
      where: {
        id: params.id,
      },
      select: {
        id: true,
        destination: true,
        departureDate: true,
        status: true,
        userId: true,
      },
    });

    if (!existingTicket) {
      return apiError(
        requestId,
        API_ERROR_CODES.NOT_FOUND,
        "Ticket not found",
        404,
      );
    }

    // Skip if status is already the same
    if (existingTicket.status === status) {
      return apiJson(
        {
          ok: true,
          changed: false,
          ticket: existingTicket,
        },
        requestId,
      );
    }

    const updatedTicket = await prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.update({
        where: {
          id: params.id,
        },
        data: {
          status,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      await tx.ticketAuditLog.create({
        data: {
          ticketId: params.id,
          adminId: session.user.id,
          previousStatus: existingTicket.status,
          newStatus: status,
          reason: reason || null,
          requestId,
        },
      });

      return ticket;
    });

    // Invalidate match caches for both old and new ticket data
    try {
      await invalidateMatchCachesForTicket(
        {
          destination: updatedTicket.destination,
          departureDate: updatedTicket.departureDate,
        },
        {
          destination: existingTicket.destination,
          departureDate: existingTicket.departureDate,
        },
      );
    } catch (error) {
      console.error(
        "Failed to invalidate match cache after ticket status update:",
        error,
      );
      // Continue with the operation even if cache invalidation fails
    }

    // Send notification
    if (status === "VERIFIED") {
      await createNotification({
        userId: updatedTicket.user.id,
        type: "TICKET_VERIFIED",
        title: "Ticket verified",
        content:
          "Your travel ticket has been verified. You can now appear in traveller matches.",
        link: "/dashboard",
      });
    }

    if (status === "REJECTED") {
      await createNotification({
        userId: updatedTicket.user.id,
        type: "TICKET_REJECTED",
        title: "Ticket rejected",
        content:
          `Your uploaded ticket was rejected. ${reason || "Please upload a valid ticket."}`,
        link: "/upload",
      });
    }

    return apiJson(
      {
        ok: true,
        changed: true,
        ticket: updatedTicket,
      },
      requestId,
    );
  } catch (error) {
    logApiError(
      requestId,
      "Ticket status update failed",
      error,
    );

    return apiError(
      requestId,
      API_ERROR_CODES.INTERNAL_ERROR,
      "Failed to update ticket status",
      500,
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: RouteContext,
) {
  const requestId = getRequestId(request);
  const session = await auth();

  if (!session?.user?.id) {
    return apiError(
      requestId,
      API_ERROR_CODES.UNAUTHORIZED,
      "Authentication is required",
      401,
    );
  }

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: session.user.id,
      },
      select: {
        role: true,
      },
    });

    if (user?.role !== "ADMIN") {
      return apiError(
        requestId,
        API_ERROR_CODES.FORBIDDEN,
        "Administrator access is required",
        403,
      );
    }

    const ticket = await prisma.ticket.findUnique({
      where: {
        id: params.id,
      },
      select: {
        id: true,
      },
    });

    if (!ticket) {
      return apiError(
        requestId,
        API_ERROR_CODES.NOT_FOUND,
        "Ticket not found",
        404,
      );
    }

    const { limit, cursor } =
      parsePaginationParams(
        request.nextUrl.searchParams,
      );
    const cursorWhere =
      buildTimestampCursorWhere(
        "createdAt",
        cursor,
      );

    const where: Prisma.TicketAuditLogWhereInput = {
      ticketId: params.id,
      ...(cursorWhere ?? {}),
    };

    const records =
      await prisma.ticketAuditLog.findMany({
        where,
        orderBy: [
          {
            createdAt: "desc",
          },
          {
            id: "desc",
          },
        ],
        take: limit + 1,
        include: {
          admin: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

    return apiJson(
      createPaginatedResponse(
        records,
        limit,
        "createdAt",
      ),
      requestId,
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    if (error instanceof PaginationError) {
      return apiError(
        requestId,
        API_ERROR_CODES.VALIDATION_ERROR,
        error.message,
        400,
      );
    }

    logApiError(
      requestId,
      "Ticket audit history retrieval failed",
      error,
    );

    return apiError(
      requestId,
      API_ERROR_CODES.INTERNAL_ERROR,
      "Unable to retrieve ticket history",
      500,
    );
  }
}
