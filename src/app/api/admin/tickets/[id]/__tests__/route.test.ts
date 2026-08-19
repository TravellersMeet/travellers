import { NextRequest } from "next/server";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { PATCH } from "@/app/api/admin/tickets/[id]/route";
import { auth } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import prisma from "@/lib/prisma";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn(),
}));

vi.mock("@/lib/match-cache", () => ({
  invalidateMatchCachesForTicket: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const mockedAuth = auth as unknown as {
  mockResolvedValue(value: unknown): void;
};

function request(body: unknown) {
  return new NextRequest(
    "http://localhost/api/admin/tickets/ticket-1",
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "X-Request-ID":
          "req_ticketaudit123",
      },
      body: JSON.stringify(body),
    },
  );
}

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

describe("PATCH admin ticket decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAuth.mockResolvedValue({
      user: {
        id: "admin-1",
      },
    });
    vi.mocked(
      prisma.user.findUnique,
    ).mockResolvedValue({
      role: "ADMIN",
    } as never);
  });

  it("requires an authenticated administrator", async () => {
    mockedAuth.mockResolvedValue(null);

    const response = await PATCH(
      request({
        status: "VERIFIED",
      }),
      {
        params: {
          id: "ticket-1",
        },
      },
    );

    expect(response.status).toBe(401);
  });

  it("requires a reason for rejection", async () => {
    const response = await PATCH(
      request({
        status: "REJECTED",
      }),
      {
        params: {
          id: "ticket-1",
        },
      },
    );

    expect(response.status).toBe(400);
    expect(
      prisma.$transaction,
    ).not.toHaveBeenCalled();
  });

  it("updates the ticket and writes one audit row atomically", async () => {
    const tx = transactionMock();

    tx.ticket.findUnique.mockResolvedValue({
      id: "ticket-1",
      userId: "user-1",
      destination: "Delhi",
      departureDate: new Date(
        "2026-09-01T00:00:00.000Z",
      ),
      status: "PENDING",
    });
    tx.ticket.update.mockResolvedValue({
      id: "ticket-1",
      status: "REJECTED",
      destination: "Delhi",
      departureDate: new Date(
        "2026-09-01T00:00:00.000Z",
      ),
      user: {
        id: "user-1",
        name: "Traveller",
        email: "user@example.com",
      },
    });

    vi.mocked(
      prisma.$transaction,
    ).mockImplementation(
      async (callback: any) => callback(tx),
    );

    const response = await PATCH(
      request({
        status: "REJECTED",
        reason: "Uploaded image is unreadable",
      }),
      {
        params: {
          id: "ticket-1",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(
      tx.ticketAuditLog.create,
    ).toHaveBeenCalledWith({
      data: {
        ticketId: "ticket-1",
        adminId: "admin-1",
        previousStatus: "PENDING",
        newStatus: "REJECTED",
        reason: "Uploaded image is unreadable",
        requestId:
          "req_ticketaudit123",
      },
    });
  });

  it("does not create duplicate audit rows for unchanged decisions", async () => {
    const tx = transactionMock();

    tx.ticket.findUnique
      .mockResolvedValueOnce({
        id: "ticket-1",
        userId: "user-1",
        destination: "Delhi",
        departureDate: new Date(),
        status: "VERIFIED",
      })
      .mockResolvedValueOnce({
        id: "ticket-1",
        status: "VERIFIED",
        user: {
          id: "user-1",
        },
      });

    vi.mocked(
      prisma.$transaction,
    ).mockImplementation(
      async (callback: any) => callback(tx),
    );

    const response = await PATCH(
      request({
        status: "VERIFIED",
      }),
      {
        params: {
          id: "ticket-1",
        },
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.changed).toBe(false);
    expect(
      tx.ticket.update,
    ).not.toHaveBeenCalled();
    expect(
      tx.ticketAuditLog.create,
    ).not.toHaveBeenCalled();
    expect(
      createNotification,
    ).not.toHaveBeenCalled();
  });

  it("does not send notifications when the transaction rolls back", async () => {
    vi.mocked(
      prisma.$transaction,
    ).mockRejectedValue(
      new Error("transaction failed"),
    );

    const response = await PATCH(
      request({
        status: "VERIFIED",
      }),
      {
        params: {
          id: "ticket-1",
        },
      },
    );

    expect(response.status).toBe(500);
    expect(
      createNotification,
    ).not.toHaveBeenCalled();
  });
});
