import { NextRequest } from "next/server";

import { API_ERROR_CODES, logApiError } from "@/lib/api-error";
import { apiError, apiJson } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { invalidateMatchCachesForTicket } from "@/lib/match-cache";
import { createNotification } from "@/lib/notifications";
import { getRequestId } from "@/lib/request-id";

interface RouteContext {
  params: { id: string };
}

const TICKET_STATUSES = ["VERIFIED", "REJECTED"] as const;
type TicketStatus = (typeof TICKET_STATUSES)[number];

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
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== "ADMIN") {
      return apiError(
        requestId,
        API_ERROR_CODES.FORBIDDEN,
        "Administrator access is required",
        403,
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return apiError(
        requestId,
        API_ERROR_CODES.VALIDATION_ERROR,
        "The request data is invalid",
        400,
      );
    }

    const status = (body as { status?: unknown })?.status;
    const reasonRaw = (body as { reason?: unknown })?.reason;

    const reason =
      typeof reasonRaw === "string" ? reasonRaw.trim() : "";

    if (
      status !== TICKET_STATUSES[0] &&
      status !== TICKET_STATUSES[1]
    ) {
      return apiError(
        requestId,
        API_ERROR_CODES.VALIDATION_ERROR,
        "The request data is invalid",
        400,
        {
          status: ["Status must be VERIFIED or REJECTED"],
        },
      );
    }

    if (status === "REJECTED" && !reason) {
      return apiError(
        requestId,
        API_ERROR_CODES.VALIDATION_ERROR,
        "A reason is required to reject a ticket",
        400,
        {
          reason: ["A reason is required to reject a ticket"],
        },
      );
    }

    const ticketStatus = status as TicketStatus;
    const adminId = session.user.id;

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.ticket.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          userId: true,
          destination: true,
          departureDate: true,
          status: true,
        },
      });

      if (!existing) {
        return {
          notFound: true as const,
        };
      }

      if (existing.status === ticketStatus) {
        const ticket = await tx.ticket.findUnique({
          where: { id: params.id },
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

        return {
          changed: false as const,
          ticket,
        };
      }

      const updated = await tx.ticket.update({
        where: { id: params.id },
        data: {
          status: ticketStatus,
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
          adminId,
          previousStatus: existing.status,
          newStatus: ticketStatus,
          reason: reason || null,
          requestId,
        },
      });

      return {
        changed: true as const,
        ticket: updated,
        previous: existing,
      };
    });

    if ("notFound" in result) {
      return apiError(
        requestId,
        API_ERROR_CODES.NOT_FOUND,
        "Ticket not found",
        404,
      );
    }

    if (result.changed) {
      try {
        await invalidateMatchCachesForTicket(
          {
            destination: result.previous.destination,
            departureDate: result.previous.departureDate,
          },
          {
            destination: result.ticket.destination,
            departureDate: result.ticket.departureDate,
          },
        );
      } catch (cacheError) {
        logApiError(
          requestId,
          "Match cache invalidation failed after ticket status change",
          cacheError,
        );
      }

      const isVerified = ticketStatus === "VERIFIED";

      await createNotification({
        userId: result.ticket.user.id,
        type: isVerified
          ? "TICKET_VERIFIED"
          : "TICKET_REJECTED",
        title: isVerified
          ? "Ticket verified"
          : "Ticket rejected",
        content: isVerified
          ? `Your ticket to ${result.ticket.destination} has been verified.`
          : `Your ticket to ${result.ticket.destination} was rejected. ${reason}`,
        link: "/dashboard",
      });
    }

    return apiJson(
      {
        ticket: result.ticket,
        changed: result.changed,
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
      "Unable to update ticket status",
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
      where: { id: session.user.id },
      select: { role: true },
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
      where: { id: params.id },
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

    if (!ticket) {
      return apiError(
        requestId,
        API_ERROR_CODES.NOT_FOUND,
        "Ticket not found",
        404,
      );
    }

    return apiJson(
      { ticket },
      requestId,
    );
  } catch (error) {
    logApiError(
      requestId,
      "Failed to retrieve admin ticket",
      error,
    );

    return apiError(
      requestId,
      API_ERROR_CODES.INTERNAL_ERROR,
      "Unable to retrieve ticket",
      500,
    );
  }
}