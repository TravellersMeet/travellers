import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
import { invalidateMatchCachesForTicket } from "@/lib/match-cache";
import { createNotification } from "@/lib/notifications";
import prisma from "@/lib/prisma";
import { PATCH } from "../route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/match-cache", () => ({ invalidateMatchCachesForTicket: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const existingTicket = {
  id: "ticket-1",
  userId: "traveller-1",
  destination: "Goa",
  departureDate: new Date("2026-08-15T00:00:00.000Z"),
  status: "PENDING",
};

function transactionMock(status: string) {
  return {
    ticket: {
      findUnique: vi.fn().mockResolvedValue(existingTicket),
      update: vi.fn().mockResolvedValue({
        ...existingTicket,
        status,
        user: {
          id: "traveller-1",
          name: "Traveller",
          email: "traveller@example.com",
        },
      }),
    },
    ticketAuditLog: { create: vi.fn().mockResolvedValue({}) },
  };
}

function request(status: "VERIFIED" | "REJECTED") {
  return new NextRequest("http://localhost/api/admin/tickets/ticket-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status,
      ...(status === "REJECTED" ? { reason: "Reviewed by admin" } : {}),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "admin-1" } } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ role: "ADMIN" } as never);
  vi.mocked(invalidateMatchCachesForTicket).mockResolvedValue(undefined);
});

describe("admin ticket PATCH cache invalidation", () => {
  it.each(["VERIFIED", "REJECTED"] as const)(
    "invalidates both current and previous match windows for %s",
    async (status) => {
      const tx = transactionMock(status);
      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(tx));

      const response = await PATCH(request(status), { params: { id: "ticket-1" } });

      expect(response.status).toBe(200);
      expect(invalidateMatchCachesForTicket).toHaveBeenCalledWith(
        {
          destination: existingTicket.destination,
          departureDate: existingTicket.departureDate,
        },
        {
          destination: existingTicket.destination,
          departureDate: existingTicket.departureDate,
        },
      );
      expect(createNotification).toHaveBeenCalledOnce();
    },
  );

  it("does not fail the PATCH when cache invalidation throws", async () => {
    const tx = transactionMock("VERIFIED");
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(tx));
    vi.mocked(invalidateMatchCachesForTicket).mockRejectedValue(new Error("cache down"));

    const response = await PATCH(request("VERIFIED"), { params: { id: "ticket-1" } });

    expect(response.status).toBe(200);
    expect(createNotification).toHaveBeenCalledOnce();
  });
});
