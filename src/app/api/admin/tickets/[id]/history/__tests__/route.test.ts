import { NextRequest } from "next/server";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { GET } from "@/app/api/admin/tickets/[id]/history/route";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

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
    ticketAuditLog: {
      findMany: vi.fn(),
    },
  },
}));

const mockedAuth = auth as unknown as {
  mockResolvedValue(value: unknown): void;
};

function request(query = "") {
  return new NextRequest(
    `http://localhost/api/admin/tickets/ticket-1/history${query}`,
    {
      headers: {
        "X-Request-ID":
          "req_historyaudit123",
      },
    },
  );
}

describe("GET admin ticket history", () => {
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
    vi.mocked(
      prisma.ticket.findUnique,
    ).mockResolvedValue({
      id: "ticket-1",
    } as never);
  });

  it("rejects non-admin users", async () => {
    vi.mocked(
      prisma.user.findUnique,
    ).mockResolvedValue({
      role: "USER",
    } as never);

    const response = await GET(
      request(),
      {
        params: {
          id: "ticket-1",
        },
      },
    );

    expect(response.status).toBe(403);
  });

  it("returns newest-first cursor pagination", async () => {
    const first = {
      id: "audit-2",
      ticketId: "ticket-1",
      createdAt: new Date(
        "2026-08-06T12:00:00.000Z",
      ),
    };
    const second = {
      id: "audit-1",
      ticketId: "ticket-1",
      createdAt: new Date(
        "2026-08-05T12:00:00.000Z",
      ),
    };

    vi.mocked(
      prisma.ticketAuditLog.findMany,
    ).mockResolvedValue([
      first,
      second,
    ] as never);

    const response = await GET(
      request("?limit=1"),
      {
        params: {
          id: "ticket-1",
        },
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      prisma.ticketAuditLog.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          {
            createdAt: "desc",
          },
          {
            id: "desc",
          },
        ],
        take: 2,
      }),
    );
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(
      "audit-2",
    );
    expect(body.pagination.hasMore).toBe(
      true,
    );
    expect(
      body.pagination.nextCursor,
    ).toEqual(expect.any(String));
  });

  it("validates malformed pagination parameters", async () => {
    const response = await GET(
      request("?limit=invalid"),
      {
        params: {
          id: "ticket-1",
        },
      },
    );

    expect(response.status).toBe(400);
  });
});
