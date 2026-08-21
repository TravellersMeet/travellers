import type { Prisma } from "@prisma/client";
import { NotificationType, TicketStatus } from "@prisma/client";
import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  API_ERROR_CODES,
  logApiError,
} from "@/lib/api-error";
import { apiError, apiJson } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { invalidateMatchCachesForTicket } from "@/lib/match-cache";
import { createNotification } from "@/lib/notifications";
import {
  buildTimestampCursorWhere,
  createPaginatedResponse,
  PaginationError,
  parsePaginationParams,
} from "@/lib/pagination";
import prisma from "@/lib/prisma";
import { getRequestId } from "@/lib/request-id";

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

    const result = updateSchema.safeParse(body);
    if (!result.success) {
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

    const { status, reason: rawReason } = result.data;
    const reason = rawReason?.trim() ?? "";

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

    const transactionResult = await prisma.$transaction(async (tx) => {
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
        return { notFound: true as const };
      }

      if (existing.status === status) {
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

      const ticket = await tx.ticket.update({
        where: { id: params.id },
        data: { status },
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
          previousStatus: existing.status,
          newStatus: status,
          reason: reason || null,
          requestId,
        },
      });

      return {
        changed: true as const,
        ticket,
        previous: existing,
      };
    });

    if ("notFound" in transactionResult) {
      return apiError(
        requestId,
        API_ERROR_CODES.NOT_FOUND,
        "Ticket not found",
        404,
      );
    }

    if (transactionResult.changed) {
      try {
        await invalidateMatchCachesForTicket(
          {
            destination: transactionResult.ticket.destination,
            departureDate: transactionResult.ticket.departureDate,
          },
          {
            destination: transactionResult.previous.destination,
            departureDate: transactionResult.previous.departureDate,
          },
        );
      } catch (cacheError) {
        logApiError(
          requestId,
          "Match cache invalidation failed after ticket status change",
          cacheError,
        );
      }

      const verified = status === TicketStatus.VERIFIED;
      await createNotification({
        userId: transactionResult.ticket.user.id,
        type: verified
          ? NotificationType.TICKET_VERIFIED
          : NotificationType.TICKET_REJECTED,
        title: verified ? "Ticket verified" : "Ticket rejected",
        content: verified
          ? `Your ticket to ${transactionResult.ticket.destination} has been verified.`
          : `Your ticket to ${transactionResult.ticket.destination} was rejected. ${reason}`,
        link: verified ? "/dashboard" : "/upload",
      });
    }

    return apiJson(
      {
        ok: true,
        changed: transactionResult.changed,
        ticket: transactionResult.ticket,
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

