import { NextRequest } from "next/server";

import { API_ERROR_CODES, logApiError } from "@/lib/api-error";
import { apiError, apiJson } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getRequestId } from "@/lib/request-id";
import {
  MAX_TICKET_FILE_SIZE,
  verifyTicket,
} from "@/lib/ticket-verification";

interface RouteContext {
  params: { id: string };
}

const verificationLocks = new Set<string>();

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

const adminId = session.user.id;

const adminId = session.user.id;


  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });

  if (user?.role !== "ADMIN") {
    return apiError(requestId, API_ERROR_CODES.FORBIDDEN, "Administrator access is required", 403);
  }

  if (verificationLocks.has(params.id)) {
    return apiError(requestId, API_ERROR_CODES.CONFLICT, "Ticket verification is already in progress", 409);
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
      return apiError(requestId, API_ERROR_CODES.NOT_FOUND, "Ticket not found", 404);
    }

    await prisma.ticket.update({
      where: { id: params.id },
      data: { verificationStatus: "PROCESSING" },
    });

    const asset = await fetch(ticket.ticketUrl);
    if (!asset.ok) throw new Error("Unable to retrieve ticket asset");

    const contentType =
      asset.headers.get("content-type")?.split(";")[0].trim() ?? "application/octet-stream";
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

    const verificationStatus = duplicate
      ? "SUSPICIOUS"
      : result.status;
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
      logApiError(requestId, "Failed to persist ticket verification failure", updateError);
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
