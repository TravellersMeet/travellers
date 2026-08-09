import { NextRequest } from "next/server";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { auth } from "@/lib/auth";
import { invalidateMatchCachesForTicket } from "@/lib/match-cache";
import { createNotification } from "@/lib/notifications";
import prisma from "@/lib/prisma";
import { PATCH } from "../route";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
    ticket: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/match-cache", () => ({
  invalidateMatchCachesForTicket: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn(),
}));

const existingTicket = {
  id: "ticket-1",
  destination: "Goa",
  departureDate: new Date(
    "2026-08-15T00:00:00.000Z",
  ),
  status: "PENDING",
  userId: "traveller-1",
};

const updatedTicket = {
  ...existingTicket,
  status: "VERIFIED",
  user: {
    id: "traveller-1",
    name: "Traveller",
    email: "traveller@example.com",
  },
};

function transactionMock() {
  return {
    ticket: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    ticketAuditLog: {
      create: vi.fn(),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(auth).mockResolvedValue({
    user: { id: "admin-1" },
  } as never);
  vi.mocked(
    prisma.user.findUnique,
  ).mockResolvedValue({
    role: "ADMIN",
  } as never);
});

describe("admin ticket cache invalidation", () => {
  it.each(["VERIFIED", "REJECTED"])(
    "invalidates matching windows when status becomes %s",
    async (status) => {
      const tx = transactionMock();

      // The route calls prisma.ticket.findUnique outside the transaction first
      vi.mocked(
        prisma.ticket.findUnique,
      ).mockResolvedValue(existingTicket as never);

      tx.ticket.findUnique.mockResolvedValue(existingTicket as never);
      tx.ticket.update.mockResolvedValue({
        ...updatedTicket,
        status,
      } as never);

      vi.mocked(
        prisma.$transaction,
      ).mockImplementation(
        async (callback: any) => callback(tx),
      );

      const response = await PATCH(
        new NextRequest(
          "http://localhost/api/admin/tickets/ticket-1",
          {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({ 
              status,
              reason: status === "REJECTED" ? "Test reason" : undefined,
            }),
          },
        ),
        {
          params: { id: "ticket-1" },
        },
      );

      expect(response.status).toBe(200);
      expect(
        invalidateMatchCachesForTicket,
      ).toHaveBeenCalledWith(
        {
          destination: "Goa",
          departureDate:
            existingTicket.departureDate,
        },
        {
          destination: "Goa",
          departureDate:
            existingTicket.departureDate,
        },
      );
      expect(
        createNotification,
      ).toHaveBeenCalledOnce();
    },
  );

  it("does not fail verification when invalidation fails safely", async () => {
    const tx = transactionMock();

    vi.mocked(
      prisma.ticket.findUnique,
    ).mockResolvedValue(existingTicket as never);

    tx.ticket.findUnique.mockResolvedValue(existingTicket as never);
    tx.ticket.update.mockResolvedValue(updatedTicket as never);

    vi.mocked(
      prisma.$transaction,
    ).mockImplementation(
      async (callback: any) => callback(tx),
    );

    vi.mocked(
      invalidateMatchCachesForTicket,
    ).mockRejectedValue(
      new Error("Redis connection failed"),
    );

    const response = await PATCH(
      new NextRequest(
        "http://localhost/api/admin/tickets/ticket-1",
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            status: "VERIFIED",
          }),
        },
      ),
      {
        params: { id: "ticket-1" },
      },
    );

    expect(response.status).toBe(200);
  });
});
