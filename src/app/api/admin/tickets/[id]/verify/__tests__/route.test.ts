import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/admin/tickets/[id]/verify/route";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { verifyTicket } from "@/lib/ticket-verification";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: vi.fn() },
    ticket: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/ticket-verification", () => ({
  MAX_TICKET_FILE_SIZE: 10 * 1024 * 1024,
  verifyTicket: vi.fn(),
}));

const request = () =>
  new NextRequest("http://localhost/api/admin/tickets/ticket-1/verify", {
    method: "POST",
    headers: { "X-Request-ID": "req_ticketverify123" },
  });

describe("POST /api/admin/tickets/[id]/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(auth).mockResolvedValue({ user: { id: "admin-1" } } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "ADMIN" } as never);
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue({
      id: "ticket-1",
      destination: "Delhi",
      departureDate: new Date("2026-09-01T00:00:00.000Z"),
      ticketUrl: "https://example.com/ticket.pdf",
      verificationStatus: "PENDING",
      metadataHash: null,
    } as never);
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null);

    vi.mocked(prisma.ticket.update).mockResolvedValue({
      id: "ticket-1",
      status: "PENDING",
      verificationStatus: "PASSED",
      verificationScore: 0.9,
      verificationReason: "strong verification signals",
      aiDetectionScore: null,
      ocrExtractedText: "Delhi PNR ABC123",
      metadataHash: "hash",
      verificationCheckedAt: new Date(),
    } as never);
    vi.mocked(verifyTicket).mockResolvedValue({
      status: "PASSED",
      score: 0.9,
      reason: "strong verification signals",
      ocrExtractedText: "Delhi PNR ABC123",
      metadataHash: "hash",
      aiDetectionScore: null,
    });
  });

  it("requires authentication", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await POST(request(), { params: { id: "ticket-1" } })).status).toBe(401);
  });

  it("requires an administrator", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "USER" } as never);
    expect((await POST(request(), { params: { id: "ticket-1" } })).status).toBe(403);
  });

  it("returns 404 for an unknown ticket", async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue(null);
    expect((await POST(request(), { params: { id: "missing" } })).status).toBe(404);
  });

  it("stores verification without changing manual ticket status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(Buffer.from("%PDF-1.7"), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    ));

    expect((await POST(request(), { params: { id: "ticket-1" } })).status).toBe(200);
    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ verificationStatus: "PASSED" }) }),
    );
  });

  it("marks duplicate ticket content as suspicious", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(Buffer.from("%PDF-1.7"), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    ));
    vi.mocked(prisma.ticket.findFirst).mockResolvedValue({ id: "ticket-2" } as never);

    await POST(request(), { params: { id: "ticket-1" } });

    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verificationStatus: "SUSPICIOUS",
          verificationScore: 0.49,
        }),
      }),
    );
  });

  it("does not expose internal verification errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private provider secret")));
    const response = await POST(request(), { params: { id: "ticket-1" } });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private provider secret");
  });
});
