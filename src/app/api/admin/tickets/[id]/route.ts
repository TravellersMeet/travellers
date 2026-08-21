import { TicketStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { API_ERROR_CODES, logApiError } from "@/lib/api-error";
import { apiError, apiJson } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getRequestId } from "@/lib/request-id";
import { MAX_TICKET_FILE_SIZE, verifyTicket } from "@/lib/ticket-verification";
import { invalidateMatchCachesForTicket } from "@/lib/match-cache";
import {
  buildTimestampCursorWhere,
  createPaginatedResponse,
  PaginationError,
  parsePaginationParams,
} from "@/lib/pagination";

interface RouteContext {
  params: { id: string };
}

const VALID_TICKET_STATUSES = new Set<string>(Object.values(TicketStatus));

const updateTicketSchema = z.object({
  status: z.enum(["PENDING", "VERIFIED", "REJECTED"]),
  reason: z.string().trim().max(2000).optional(),
});

const verificationLocks = new Set<string>();

export async function GET(request: NextRequest, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: params.id },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    return NextResponse.json({ ticket });
  } catch (error) {
    console.error("Get admin ticket error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteContext,
) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminId = session.user.id;

  try {
    const user = await prisma.user.findUnique({
      where: { id: adminId },
      select: { role: true },
    });

    if (user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = updateTicketSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const requestId = request.headers.get("x-request-id") ?? "unknown";

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.ticket.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          status: true,
          userId: true,
          destination: true,
          departureDate: true,
        },
      });

      if (!current) {
        throw new Error("TICKET_NOT_FOUND");
      }

      const updated = await tx.ticket.update({
        where: { id: params.id },
        data: { status: parsed.data.status as TicketStatus },
        select: {
          id: true,
          userId: true,
          destination: true,
          departureDate: true,
          status: true,
          ticketUrl: true,
          tripPurpose: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await tx.ticketAuditLog.create({
        data: {
          ticketId: params.id,
          adminId,
          previousStatus: current.status,
          newStatus: parsed.data.status as TicketStatus,
          reason: parsed.data.reason ?? null,
          requestId,
        },
      });

      return { current, updated };
    });

    try {
      await invalidateMatchCachesForTicket(result.updated, result.current);
    } catch (cacheError) {
      console.error(
        "Failed to invalidate match caches after ticket update:",
        cacheError,
      );
    }

    if (result.current.status !== result.updated.status) {
      try {
        await prisma.notification.create({
  data: {
    userId: result.updated.userId,
    type:
      result.updated.status === "VERIFIED"
        ? "TICKET_VERIFIED"
        : "TICKET_REJECTED",
    title:
      result.updated.status === "VERIFIED"
        ? "Ticket verified"
        : "Ticket rejected",
    content:
      result.updated.status === "VERIFIED"
        ? "Your travel ticket has been verified."
        : parsed.data.reason
          ? `Your travel ticket was rejected: ${parsed.data.reason}`
          : "Your travel ticket was rejected.",
  },
});
      } catch (notificationError) {
        console.error(
          "Failed to create ticket status notification:",
          notificationError,
        );
      }
    }

    return NextResponse.json({ ticket: result.updated });
  } catch (error) {
    if (error instanceof Error && error.message === "TICKET_NOT_FOUND") {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    console.error("Update admin ticket error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(
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

  if (verificationLocks.has(params.id)) {
    return apiError(
      requestId,
      API_ERROR_CODES.CONFLICT,
      "Ticket verification is already in progress",
      409,
    );
  }

  verificationLocks.add(params.id);

  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        destination: true,
        departureDate: true,
        ticketUrl: true,
        verificationStatus: true,
        metadataHash: true,
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

    await prisma.ticket.update({
      where: { id: params.id },
      data: { verificationStatus: "PROCESSING" },
    });

    const asset = await fetch(ticket.ticketUrl);
    if (!asset.ok) throw new Error("Unable to retrieve ticket asset");

    const contentType =
      asset.headers.get("content-type")?.split(";")[0].trim() ??
      "application/octet-stream";
    const bytes = Buffer.from(await asset.arrayBuffer());

    if (bytes.length > MAX_TICKET_FILE_SIZE) {
      throw new Error("Ticket asset exceeds the maximum supported size");
    }

    const result = await verifyTicket({
      bytes,
      mimeType: contentType,
      destination: ticket.destination,
      departureDate: ticket.departureDate,
    });

    const duplicate = await prisma.ticket.findFirst({
      where: {
        metadataHash: result.metadataHash,
        NOT: { id: params.id },
      },
      select: { id: true },
    });

    const verificationStatus = duplicate ? "SUSPICIOUS" : result.status;
    const verificationScore = duplicate
      ? Math.min(result.score, 0.49)
      : result.score;
    const verificationReason = duplicate
      ? `${result.reason}; duplicate ticket content detected`
      : result.reason;

    const updated = await prisma.ticket.update({
      where: { id: params.id },
      data: {
        verificationStatus,
        verificationScore,
        verificationReason,
        aiDetectionScore: result.aiDetectionScore,
        ocrExtractedText: result.ocrExtractedText,
        metadataHash: result.metadataHash,
        verificationCheckedAt: new Date(),
      },
      select: {
        id: true,
        status: true,
        verificationStatus: true,
        verificationScore: true,
        verificationReason: true,
        aiDetectionScore: true,
        ocrExtractedText: true,
        metadataHash: true,
        verificationCheckedAt: true,
      },
    });

    return apiJson({ ticket: updated }, requestId);
  } catch (error) {
    logApiError(requestId, "Automated ticket verification failed", error);

    try {
      await prisma.ticket.update({
        where: { id: params.id },
        data: {
          verificationStatus: "FAILED",
          verificationReason: "Automated verification could not be completed",
          verificationCheckedAt: new Date(),
        },
      });
    } catch (updateError) {
      logApiError(
        requestId,
        "Failed to persist ticket verification failure",
        updateError,
      );
    }

    return apiError(
      requestId,
      API_ERROR_CODES.INTERNAL_ERROR,
      "Unable to complete ticket verification",
      500,
    );
  } finally {
    verificationLocks.delete(params.id);
  }
}
